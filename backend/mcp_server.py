"""Local MCP entry point. Run with the project's virtual-environment Python."""
import os

import django
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from api.services import get_health  # noqa: E402

mcp = FastMCP("MCP Canada")


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True))
def health_check() -> dict[str, str]:
    """Return the Django application's health and database configuration status.

    Runs shared application logic directly; the HTTP development server is not required.
    """
    return get_health()


if __name__ == "__main__":
    # stdout is reserved for MCP protocol messages; log only to stderr.
    mcp.run(transport="stdio")
