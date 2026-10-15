"""Exercise the real MCP subprocess, including initialization and tool invocation."""
import asyncio
import sys
import unittest
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


class MCPTests(unittest.TestCase):
    def test_stdio_health_tool(self):
        asyncio.run(self._check_server())

    async def _check_server(self):
        server = StdioServerParameters(
            command=sys.executable,
            args=[str(Path(__file__).with_name("mcp_server.py").resolve())],
        )
        async with asyncio.timeout(20):
            async with stdio_client(server) as (read, write):
                async with ClientSession(read, write) as client:
                    await client.initialize()
                    tools = await client.list_tools()
                    self.assertIn("health_check", [tool.name for tool in tools.tools])
                    result = await client.call_tool("health_check", {})
                    self.assertFalse(result.isError)
                    self.assertEqual(result.structuredContent, {
                        "status": "ok", "service": "django", "database": "disabled"
                    })


if __name__ == "__main__":
    unittest.main()
