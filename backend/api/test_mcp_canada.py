"""MCP-Canada client and cache tests. They use a local fake server, never the network."""
import sys
from datetime import timedelta
from pathlib import Path
from unittest import mock

from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from django.utils import timezone
from mcp import StdioServerParameters

from .mcp_canada import MCPCanadaClient, MCPCanadaError
from .mcp_canada_cache import fetch_from_mcp_canada
from .models import MCPCacheEntry

FAKE_SERVER = Path(__file__).with_name("fake_mcp_canada_server.py")
CPI_ARGS = {"series_names": "V41690973"}


def fake_client():
    return MCPCanadaClient(lambda: StdioServerParameters(
        command=sys.executable, args=[str(FAKE_SERVER)]))


class ClientTests(SimpleTestCase):
    """Runs the real stdio protocol against the fake server."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.client_ = fake_client()

    @classmethod
    def tearDownClass(cls):
        cls.client_.close()
        super().tearDownClass()

    def test_returns_payload_with_source(self):
        payload = self.client_.call("boc_get_observations", CPI_ARGS)
        self.assertEqual(payload["_meta"]["source"]["api"], "bank-of-canada-valet")
        self.assertEqual(payload["data"]["V41690973"]["observations"]["2026-09-01"], 170)

    def test_reuses_one_connection(self):
        self.client_.call("boc_get_observations", CPI_ARGS)
        session = self.client_._session
        self.client_.call("boc_get_observations", CPI_ARGS)
        self.assertIs(self.client_._session, session)

    def test_tool_error_payload_raises(self):
        with self.assertRaisesMessage(MCPCanadaError, "not found"):
            self.client_.call("boc_get_observations", {"series_names": "NOPE"})

    def test_unknown_tool_raises(self):
        with self.assertRaises(MCPCanadaError):
            self.client_.call("no_such_tool")

    def test_missing_command_raises(self):
        with mock.patch.dict("os.environ", {"MCP_CANADA_COMMAND": ""}):
            with self.assertRaisesMessage(MCPCanadaError, "MCP_CANADA_COMMAND"):
                MCPCanadaClient().call("boc_get_observations", CPI_ARGS)


class CacheTests(TestCase):
    def setUp(self):
        self.client_ = mock.Mock()
        self.client_.call.return_value = {
            "_meta": {"source": {"api": "bank-of-canada-valet", "url": "https://www.bankofcanada.ca/valet/"},
                      "timestamp": "2026-11-07T23:49:47+00:00"},
            "data": {"V41690973": {"observations": {"2026-09-01": 170}}},
        }

    def fetch(self, **kwargs):
        return fetch_from_mcp_canada("boc_get_observations", CPI_ARGS,
                                     max_age=timedelta(hours=1), client=self.client_, **kwargs)

    def test_live_call_is_saved_with_source(self):
        result = self.fetch()
        self.assertEqual((result["status"], result["from_cache"]), ("fresh", False))
        self.assertEqual(result["source"]["api"], "bank-of-canada-valet")
        self.assertEqual(result["source"]["reported_at"], "2026-11-07T23:49:47+00:00")
        self.assertEqual(MCPCacheEntry.objects.count(), 1)

    def test_fresh_copy_skips_mcp(self):
        self.fetch()
        result = self.fetch()
        self.assertTrue(result["from_cache"])
        self.assertEqual(self.client_.call.call_count, 1)

    def test_refresh_forces_live_call(self):
        self.fetch()
        self.fetch(refresh=True)
        self.assertEqual(self.client_.call.call_count, 2)

    def test_stale_copy_is_refetched(self):
        self.fetch()
        MCPCacheEntry.objects.update(fetched_at=timezone.now() - timedelta(hours=2))
        self.assertFalse(self.fetch()["from_cache"])

    def test_failure_returns_saved_copy_as_outdated(self):
        self.fetch()
        MCPCacheEntry.objects.update(fetched_at=timezone.now() - timedelta(hours=2))
        self.client_.call.side_effect = MCPCanadaError("timed out")
        result = self.fetch()
        self.assertEqual(result["status"], "may_be_outdated")
        self.assertEqual(result["data"]["V41690973"]["observations"]["2026-09-01"], 170)
        self.assertEqual(result["error"], "timed out")

    def test_failure_without_copy_is_unavailable(self):
        self.client_.call.side_effect = MCPCanadaError("not running")
        result = self.fetch()
        self.assertEqual((result["status"], result["data"]), ("unavailable", None))


class CpiEndpointTests(TestCase):
    def test_returns_sorted_observations(self):
        client = fake_client()
        self.addCleanup(client.close)
        with mock.patch("api.mcp_canada_cache.get_client", return_value=client):
            response = self.client.get(reverse("mcp-canada-cpi"), {"start_date": "2026-01-01"})
        body = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["status"], "fresh")
        self.assertEqual(body["label"], "Total CPI")
        self.assertEqual([o["period"] for o in body["observations"]], ["2026-08-01", "2026-09-01"])

    def test_unavailable_is_503(self):
        broken = mock.Mock()
        broken.call.side_effect = MCPCanadaError("not running")
        with mock.patch("api.mcp_canada_cache.get_client", return_value=broken):
            response = self.client.get(reverse("mcp-canada-cpi"))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "unavailable")

    def test_rejects_bad_date(self):
        self.assertEqual(self.client.get(reverse("mcp-canada-cpi"), {"start_date": "soon"}).status_code, 400)
