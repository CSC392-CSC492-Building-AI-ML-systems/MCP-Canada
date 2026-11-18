"""Stand-in for the MCP-Canada server, used only by tests. Same gateway shape."""
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("Fake MCP Canada", log_level="WARNING")


@mcp.tool()
def call_tool(name: str, arguments: dict | None = None) -> dict:
    if name == "boc_get_observations":
        series = (arguments or {}).get("series_names", "")
        if series != "V41690973":
            return {"error": {"code": "INVALID_SERIES", "message": f"Series '{series}' not found"}}
        return {
            "_meta": {
                "source": {"api": "bank-of-canada-valet", "url": "https://www.bankofcanada.ca/valet/"},
                "timestamp": "2026-11-07T23:49:47.279722+00:00",
            },
            "data": {"V41690973": {"label": "Total CPI",
                                   "observations": {"2026-09-01": 170, "2026-08-01": 169.8}}},
        }
    raise ValueError(f"Unknown tool: {name!r}")


if __name__ == "__main__":
    mcp.run(transport="stdio")
