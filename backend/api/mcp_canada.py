"""Client for the external MCP-Canada data server (a separate project).

Django keeps one long-lived stdio connection to the server, so only the first
request pays the start-up cost. Configure the launch command with environment
variables (see backend/.env.example):

    MCP_CANADA_COMMAND   executable that starts the server (required)
    MCP_CANADA_ARGS      its arguments, as one shell-style string
    MCP_CANADA_CWD       working directory for the server (optional)
    MCP_CANADA_TIMEOUT   seconds to wait for one call (default 20)
"""
import asyncio
import json
import os
import shlex
import threading

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# MCP-Canada exposes its 300+ data tools through one gateway tool.
GATEWAY_TOOL = "call_tool"


class MCPCanadaError(Exception):
    """MCP-Canada could not be reached, timed out, or returned an error."""


def root_cause(exc: BaseException) -> BaseException:
    """Unwrap the exception groups that anyio raises around the real error."""
    while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        exc = exc.exceptions[0]
    return exc


def server_parameters() -> StdioServerParameters:
    command = os.environ.get("MCP_CANADA_COMMAND", "").strip()
    if not command:
        raise MCPCanadaError("MCP_CANADA_COMMAND is not set")
    return StdioServerParameters(
        command=command,
        args=shlex.split(os.environ.get("MCP_CANADA_ARGS", "")),
        cwd=os.environ.get("MCP_CANADA_CWD") or None,
        env=dict(os.environ),
    )


def default_timeout() -> float:
    return float(os.environ.get("MCP_CANADA_TIMEOUT", "20"))


def parse_result(result) -> dict:
    """Turn an MCP CallToolResult from the gateway into the tool's JSON payload."""
    text = "\n".join(getattr(c, "text", "") for c in result.content).strip()
    if result.isError:
        raise MCPCanadaError(text or "MCP-Canada returned an error")
    payload = result.structuredContent
    if payload is None:
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            raise MCPCanadaError(f"MCP-Canada returned non-JSON output: {text[:200]}") from exc
    # FastMCP wraps non-object return values as {"result": ...}.
    if isinstance(payload, dict) and set(payload) == {"result"}:
        payload = payload["result"]
    if isinstance(payload, dict) and "error" in payload and "data" not in payload:
        error = payload["error"]
        message = error.get("message") if isinstance(error, dict) else str(error)
        raise MCPCanadaError(message or "MCP-Canada tool failed")
    if not isinstance(payload, dict):
        raise MCPCanadaError("MCP-Canada returned an unexpected payload")
    return payload


class MCPCanadaClient:
    """Thread-safe, synchronous wrapper around one persistent MCP session.

    The session lives on a background event loop, so Django's synchronous
    views can call it directly. If the server exits, the next call reconnects.
    """

    def __init__(self, params_factory=server_parameters):
        self._params_factory = params_factory
        self._lock = threading.Lock()
        self._loop = None
        self._session = None
        self._closed = None

    def _ensure_loop(self):
        if self._loop is None:
            self._loop = asyncio.new_event_loop()
            threading.Thread(target=self._loop.run_forever, daemon=True,
                             name="mcp-canada-client").start()

    async def _hold_session(self, params, ready):
        # Entering and leaving the stdio/session contexts must happen in one task.
        try:
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    self._session = session
                    self._closed = asyncio.Event()
                    ready.set_result(None)
                    await self._closed.wait()
        except BaseException as exc:  # noqa: BLE001 - reported to the caller
            if not ready.done():
                ready.set_exception(exc)
        finally:
            self._session = None

    async def _open(self, params):
        ready = asyncio.get_running_loop().create_future()
        asyncio.create_task(self._hold_session(params, ready))
        await ready

    def _connect(self, timeout):
        params = self._params_factory()
        future = asyncio.run_coroutine_threadsafe(self._open(params), self._loop)
        try:
            future.result(timeout)
        except TimeoutError as exc:
            future.cancel()
            raise MCPCanadaError(f"MCP-Canada did not start within {timeout:g}s") from exc
        except MCPCanadaError:
            raise
        except Exception as exc:
            cause = root_cause(exc)
            command = " ".join([params.command, *params.args])
            raise MCPCanadaError(
                f"Could not start MCP-Canada with `{command}`: "
                f"{type(cause).__name__}: {cause}. Check the server's own error above."
            ) from exc

    def call(self, tool: str, arguments: dict | None = None, timeout: float | None = None) -> dict:
        """Run one MCP-Canada data tool, such as boc_get_observations."""
        timeout = timeout or default_timeout()
        with self._lock:
            self._ensure_loop()
            if self._session is None:
                self._connect(timeout)
            session = self._session
        if session is None:
            raise MCPCanadaError("MCP-Canada connection closed")
        future = asyncio.run_coroutine_threadsafe(
            session.call_tool(GATEWAY_TOOL, {"name": tool, "arguments": arguments or {}}),
            self._loop,
        )
        try:
            result = future.result(timeout)
        except TimeoutError as exc:
            future.cancel()
            raise MCPCanadaError(f"{tool} timed out after {timeout:g}s") from exc
        except Exception as exc:
            cause = root_cause(exc)
            raise MCPCanadaError(f"{tool} failed: {type(cause).__name__}: {cause}") from exc
        return parse_result(result)

    def close(self):
        if self._loop is not None and self._closed is not None:
            self._loop.call_soon_threadsafe(self._closed.set)


_client = None
_client_lock = threading.Lock()


def get_client() -> MCPCanadaClient:
    """The process-wide client shared by every request."""
    global _client
    with _client_lock:
        if _client is None:
            _client = MCPCanadaClient()
        return _client
