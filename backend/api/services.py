"""Database-free application logic shared by HTTP and MCP."""


def get_health() -> dict[str, str]:
    return {"status": "ok", "service": "django", "database": "disabled"}
