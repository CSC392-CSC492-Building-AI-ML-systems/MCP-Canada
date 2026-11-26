"""AI teacher tests. A fake Gemini client and a fake MCP-Canada stand in for the
real services, so these run offline, with no API key and no quota used."""
import json
from datetime import datetime, timezone
from unittest import mock

from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from google.genai import errors, types

from .agent import GeminiModel, TeacherTools, TeacherUnavailable, _tidy_numbers, ask_teacher
from .mcp_canada import MCPCanadaError
from .models import Geography, GeographySet, Indicator, Observation, SourceRelease


# Keep the [teacher] progress lines out of the test output.
_quiet = mock.patch("api.agent.log")


def setUpModule():
    _quiet.start()


def tearDownModule():
    _quiet.stop()


# ---------------------------------------------------------------- fakes

class FakeMCPClient:
    """Answers discover_tools like MCP-Canada does, or fails if told to."""

    def __init__(self, tools=None, fail=False):
        self.tools = tools if tools is not None else [{
            "name": "toronto_get_neighbourhood_profile",
            "description": "Census profile for one Toronto neighbourhood",
            "inputSchema": {"properties": {"neighbourhood": {"type": "string"}}},
        }]
        self.fail = fail

    def call_server_tool(self, name, arguments):
        if self.fail:
            raise MCPCanadaError("server did not start")
        return self.tools


def fake_fetch(data=None, status="fresh"):
    """Stands in for fetch_from_mcp_canada (the DB-cached MCP-Canada call)."""
    def fetch(tool, arguments, *, max_age, client=None):
        if status == "unavailable":
            return {"status": "unavailable", "error": "MCP-Canada is down", "data": None,
                    "source": {"tool": tool}}
        return {"status": status, "error": None, "data": data,
                "source": {"tool": tool, "api": "toronto-open-data", "url": "https://example.org/profile"}}
    return fetch


def reply(*parts):
    """A Gemini response holding the given parts (text or function calls)."""
    return types.GenerateContentResponse(candidates=[
        types.Candidate(content=types.Content(role="model", parts=list(parts)))])


def call(name, **args):
    return types.Part.from_function_call(name=name, args=args)


def text(value):
    return types.Part.from_text(text=value)


class FakeGemini:
    """A fake genai.Client: plays back a script of responses or errors, one per request."""

    def __init__(self, *script):
        self.script = list(script)
        self.requests = []  # (model, contents) for each request
        self.models = self

    def generate_content(self, *, model, contents, config):
        self.requests.append((model, list(contents)))
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


def busy(code=503):
    return errors.APIError(code, {"error": {"code": code, "message": "busy", "status": "UNAVAILABLE"}})


def result(tools, name, **args):
    return json.loads(tools.run(name, args))


# ---------------------------------------------------------------- number cleanup

class TidyNumbersTests(SimpleTestCase):
    def test_drops_padding_but_keeps_codes_and_formatted_text(self):
        self.assertEqual(
            _tidy_numbers({"median": "1740.00000000", "code": "095", "rows": [
                {"v": "12.50"}, {"v": "-0.50"}, "30,526", "4.60%", None, 3, "Annex"]}),
            {"median": "1740", "code": "095", "rows": [
                {"v": "12.5"}, {"v": "-0.5"}, "30,526", "4.60%", None, 3, "Annex"]})

    def test_round_numbers_stay_plain(self):
        # normalize() alone would give "1E+3".
        self.assertEqual(_tidy_numbers("1000.00"), "1000")


# ---------------------------------------------------------------- tools

class MCPFirstTests(SimpleTestCase):
    def tools(self, **kwargs):
        return TeacherTools({}, mcp_client=kwargs.get("client", FakeMCPClient()),
                            fetch=kwargs.get("fetch", fake_fetch()))

    def test_app_database_refused_before_mcp_canada(self):
        tools = self.tools()
        for name in ("find_app_data", "get_app_observations"):
            self.assertIn("MCP-Canada first", result(tools, name, query="Annex rent")["error"])

    def test_app_database_allowed_after_searching_mcp_canada(self):
        tools = self.tools()
        result(tools, "find_canada_data_tools", query="rent")
        with mock.patch.object(TeacherTools, "_find_app", return_value='"app data"'):
            self.assertEqual(tools.run("find_app_data", {"query": "Annex rent"}), '"app data"')

    def test_failed_mcp_canada_still_counts_as_tried(self):
        tools = self.tools(client=FakeMCPClient(fail=True))
        self.assertIn("MCP-Canada is unavailable", result(tools, "find_canada_data_tools", query="rent")["error"])
        self.assertTrue(tools.tried_mcp)

    def test_screen_values_need_no_mcp_canada(self):
        tools = TeacherTools({"title": "Annex"}, mcp_client=FakeMCPClient(), fetch=fake_fetch())
        self.assertEqual(result(tools, "get_screen_values"), {"title": "Annex"})
        self.assertFalse(tools.tried_mcp)


class CanadaDataTests(SimpleTestCase):
    def test_find_returns_tool_names_and_arguments(self):
        tools = TeacherTools({}, mcp_client=FakeMCPClient(), fetch=fake_fetch())
        found = result(tools, "find_canada_data_tools", query="neighbourhood profile")
        self.assertEqual(found[0]["name"], "toronto_get_neighbourhood_profile")
        self.assertIn("neighbourhood", found[0]["arguments"])

    def test_get_tidies_numbers_and_records_the_source_once(self):
        tools = TeacherTools({}, mcp_client=FakeMCPClient(),
                             fetch=fake_fetch({"value": "1740.00000000"}))
        for _ in range(2):
            data = result(tools, "get_canada_data", tool="toronto_get_neighbourhood_profile",
                          arguments={"neighbourhood": "Annex"})
        self.assertEqual(data["data"], {"value": "1740"})
        self.assertEqual(len(tools.sources), 1)
        self.assertEqual(tools.sources[0]["api"], "toronto-open-data")

    def test_unavailable_is_an_error_not_data(self):
        tools = TeacherTools({}, mcp_client=FakeMCPClient(), fetch=fake_fetch(status="unavailable"))
        self.assertEqual(result(tools, "get_canada_data", tool="x")["error"], "MCP-Canada is down")
        self.assertEqual(tools.sources, [])

    def test_unknown_tool(self):
        tools = TeacherTools({}, mcp_client=FakeMCPClient(), fetch=fake_fetch())
        self.assertIn("Unknown tool", result(tools, "make_up_numbers")["error"])


class AppDataTests(TestCase):
    """find_app_data and get_app_observations against a small synthetic database."""

    @classmethod
    def setUpTestData(cls):
        source = SourceRelease.objects.create(
            id="census-2001", publisher="Synthetic fixture", title="Census 2001 test profile",
            url="https://example.org/2001", licence="Test only", sha256="a" * 64,
            retrieved_at=datetime(2026, 1, 1, tzinfo=timezone.utc), coverage="Toronto 2001")
        boundaries = GeographySet.objects.create(id="toronto-140", kind="neighbourhood",
                                                 version="140", source=source)
        annex = Geography.objects.create(id="toronto-140-95", geography_set=boundaries,
                                         code="95", name="Annex")
        common = dict(unit="dollars", definition="Synthetic", universe="Test", statistic="mean")
        Indicator.objects.create(id="census-2001-population", label="Population", **common)
        rent = Indicator.objects.create(id="census-2001-rent", label="Average rent", **common)
        income = Indicator.objects.create(id="census-2001-income", label="Average income", **common)
        Observation.objects.create(source=source, geography=annex, indicator=rent, census_year=2001,
                                   reference_year=2001, period="annual", value=None, status="missing",
                                   source_locator="row 742")
        Observation.objects.create(source=source, geography=annex, indicator=income, census_year=2001,
                                   reference_year=2001, period="annual", value="1023.50000000",
                                   status="observed", source_locator="row 10")

    def tools(self):
        tools = TeacherTools({}, mcp_client=FakeMCPClient(tools=[]), fetch=fake_fetch())
        result(tools, "find_canada_data_tools", query="rent 2001")  # MCP-Canada first
        return tools

    def test_find_ranks_the_best_match_first_and_says_where_it_has_values(self):
        found = result(self.tools(), "find_app_data", query="Annex average rent 2001")
        best = found["indicators"][0]
        self.assertEqual(best["id"], "census-2001-rent")
        self.assertEqual(best["available_in"],
                         [{"source_id": "census-2001", "geography_set_id": "toronto-140"}])
        self.assertEqual(found["geographies"][0]["id"], "toronto-140-95")

    def test_observations_keep_missing_as_missing_and_tidy_values(self):
        tools = self.tools()
        rent = result(tools, "get_app_observations", geography_id="toronto-140-95",
                      indicator_id="census-2001-rent", source_id="census-2001")
        self.assertEqual(rent["observations"][0]["status"], "missing")
        self.assertIsNone(rent["observations"][0]["value"])
        income = result(tools, "get_app_observations", geography_id="toronto-140-95",
                        indicator_id="census-2001-income", source_id="census-2001")
        self.assertEqual(income["observations"][0]["value"], "1023.5")
        self.assertEqual(tools.sources, [{"tool": "app_database", "api": "Census 2001 test profile",
                                          "url": "https://example.org/2001"}])


# ---------------------------------------------------------------- Gemini loop

class GeminiModelTests(SimpleTestCase):
    def tools(self):
        return TeacherTools({"title": "Annex"}, mcp_client=FakeMCPClient(), fetch=fake_fetch())

    def test_runs_the_tools_the_model_asks_for_then_returns_its_answer(self):
        client = FakeGemini(reply(call("get_screen_values")), reply(text("The Annex is on screen.")))
        tools = self.tools()
        answer, usage = GeminiModel(model="m1", client=client).answer("What's on screen?", tools, 6)
        self.assertEqual(answer, "The Annex is on screen.")
        self.assertEqual(usage["requests"], 2)
        self.assertEqual(tools.calls, [{"tool": "get_screen_values", "arguments": {}}])
        # The tool result went back to the model in the second request.
        sent = client.requests[1][1][-1].parts[0].function_response
        self.assertEqual(sent.name, "get_screen_values")
        self.assertIn("Annex", sent.response["result"])

    def test_busy_model_moves_to_the_next_one(self):
        client = FakeGemini(busy(503), busy(429), reply(text("Hi")))
        model = GeminiModel(model="m1,m2,m3", client=client)
        self.assertEqual(model.answer("Hi", self.tools(), 6)[0], "Hi")
        self.assertEqual([name for name, _ in client.requests], ["m1", "m2", "m3"])
        self.assertEqual(model.model, "m3")

    def test_unavailable_when_every_model_is_busy(self):
        model = GeminiModel(model="m1,m2", client=FakeGemini(busy(), busy()))
        with self.assertRaises(TeacherUnavailable):
            model.answer("Hi", self.tools(), 6)

    def test_bad_request_is_not_retried(self):
        client = FakeGemini(busy(400), reply(text("never sent")))
        with self.assertRaises(TeacherUnavailable):
            GeminiModel(model="m1,m2", client=client).answer("Hi", self.tools(), 6)
        self.assertEqual(len(client.requests), 1)

    def test_stops_after_max_steps(self):
        client = FakeGemini(*[reply(call("get_screen_values")) for _ in range(3)])
        answer, _ = GeminiModel(model="m1", client=client).answer("Loop", self.tools(), 2)
        self.assertIn("could not finish", answer)

    def test_no_key_means_unavailable(self):
        with mock.patch.dict("os.environ", {"GEMINI_API_KEY": ""}):
            with self.assertRaises(TeacherUnavailable):
                GeminiModel()


class AskTeacherTests(SimpleTestCase):
    def test_returns_answer_sources_and_tool_calls(self):
        client = FakeGemini(
            reply(call("get_canada_data", tool="toronto_get_neighbourhood_profile",
                       arguments={"neighbourhood": "Annex"})),
            reply(text("Median shelter cost was $1,740 (City of Toronto).")))
        out = ask_teacher("Annex rent 2021?", None, model=GeminiModel(model="m1", client=client),
                          mcp_client=FakeMCPClient(), fetch=fake_fetch({"value": "1740.00000000"}))
        self.assertEqual(out["answer"], "Median shelter cost was $1,740 (City of Toronto).")
        self.assertEqual(out["sources"][0]["api"], "toronto-open-data")
        self.assertEqual(out["tool_calls"][0]["tool"], "get_canada_data")
        self.assertEqual(out["model"], "m1")

    def test_empty_question_is_rejected(self):
        with self.assertRaises(ValueError):
            ask_teacher("   ", None, model=GeminiModel(model="m1", client=FakeGemini()))


class TeacherViewTests(SimpleTestCase):
    def post(self, body):
        return self.client.post(reverse("teacher-ask"), body, content_type="application/json")

    def test_answer(self):
        with mock.patch("api.views.ask_teacher", return_value={"answer": "Hi"}) as ask:
            response = self.post({"question": "Hi", "context": {"title": "Annex"}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"answer": "Hi"})
        ask.assert_called_once_with("Hi", {"title": "Annex"})

    def test_503_when_the_model_is_unavailable(self):
        with mock.patch("api.views.ask_teacher", side_effect=TeacherUnavailable("GEMINI_API_KEY is not set")):
            response = self.post({"question": "Hi", "context": None})
        self.assertEqual(response.status_code, 503)

    def test_bad_input(self):
        self.assertEqual(self.post({"question": ""}).status_code, 400)
        self.assertEqual(self.post({"question": "Hi", "context": "Annex"}).status_code, 400)
        self.assertEqual(self.client.post(reverse("teacher-ask"), "not json",
                                          content_type="application/json").status_code, 400)

    def test_get_not_allowed(self):
        self.assertEqual(self.client.get(reverse("teacher-ask")).status_code, 405)
