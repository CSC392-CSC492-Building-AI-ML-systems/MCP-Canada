"""Fetch MCP-Canada results through a database cache that records their source."""
import hashlib
import json
import time

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .mcp_canada import MCPCanadaError, get_client
from .models import MCPCacheEntry


def fetch_from_mcp_canada(tool, arguments=None, *, max_age, refresh=False, client=None):
    """Return an MCP-Canada result, reusing the saved copy while it is fresh.

    status is "fresh" (live call, or a saved copy younger than max_age),
    "may_be_outdated" (live call failed, so an older saved copy is returned)
    or "unavailable" (live call failed and nothing is saved).
    """
    arguments = arguments or {}
    started = time.perf_counter()
    key = hashlib.sha256(json.dumps([tool, arguments], sort_keys=True).encode()).hexdigest()
    entry = MCPCacheEntry.objects.filter(key=key).first()

    def response(status, entry=None, error=None, from_cache=False):
        return {
            "status": status,
            "from_cache": from_cache,
            "data": entry.payload.get("data") if entry else None,
            "source": {
                "tool": tool,
                "api": entry.source_api,
                "url": entry.source_url,
                "reported_at": entry.source_timestamp.isoformat() if entry.source_timestamp else None,
                "fetched_at": entry.fetched_at.isoformat(),
            } if entry else {"tool": tool},
            "error": error,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
        }

    if entry and not refresh and timezone.now() - entry.fetched_at < max_age:
        return response("fresh", entry, from_cache=True)

    try:
        payload = (client or get_client()).call(tool, arguments)
    except MCPCanadaError as exc:
        if entry:
            return response("may_be_outdated", entry, error=str(exc), from_cache=True)
        return response("unavailable", error=str(exc))

    meta = payload.get("_meta", {})
    source = meta.get("source", {})
    entry, _ = MCPCacheEntry.objects.update_or_create(key=key, defaults={
        "tool": tool,
        "arguments": arguments,
        "payload": payload,
        "source_api": source.get("api", ""),
        "source_url": source.get("url", ""),
        "source_timestamp": parse_datetime(meta["timestamp"]) if meta.get("timestamp") else None,
        "fetched_at": timezone.now(),
    })
    return response("fresh", entry)
