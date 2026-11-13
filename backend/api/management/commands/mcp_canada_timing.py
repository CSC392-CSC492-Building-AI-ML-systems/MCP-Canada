"""Time MCP-Canada calls: first call (starts the server), live call, cached read."""
import time
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError

from api.mcp_canada import get_client
from api.mcp_canada_cache import fetch_from_mcp_canada

ARGS = {"series_names": "V41690973", "start_date": "2020-01-01"}


class Command(BaseCommand):
    help = "Measure how long the app waits for MCP-Canada (CPI example)."

    def handle(self, *args, **options):
        steps = [
            ("First call (starts the server + live call)", True),
            ("Second live call (server already running)", True),
            ("Cached read (no MCP call)", False),
        ]
        for label, refresh in steps:
            started = time.perf_counter()
            result = fetch_from_mcp_canada("boc_get_observations", ARGS,
                                           max_age=timedelta(hours=24), refresh=refresh)
            elapsed = (time.perf_counter() - started) * 1000
            if result["status"] == "unavailable":
                raise CommandError(f"MCP-Canada unavailable: {result['error']}")
            count = len(result["data"]["V41690973"]["observations"])
            self.stdout.write(f"{label}: {elapsed:,.0f} ms ({count} observations, "
                              f"status={result['status']}, from_cache={result['from_cache']})")
        get_client().close()
