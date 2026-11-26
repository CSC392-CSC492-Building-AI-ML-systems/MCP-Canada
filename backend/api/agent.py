"""The AI teacher: a small tool-using agent behind POST /api/teacher/ask/.

The model answers only from tools and must quote their values exactly, never
calculate new ones. For data it looks in MCP-Canada first and falls back to the
app's own database for what MCP-Canada doesn't have (Census 2001, CMHC, OSM...):

  * on screen     get_screen_values      the profiles the student has on screen
  * MCP-Canada    find_canada_data_tools search MCP-Canada's 300+ data tools
                  get_canada_data        run one of them (through the DB cache)
  * app database  find_app_data          search our sources, indicators, geographies
                  get_app_observations   stored values for one geography+indicator+source

Provider: Google Gemini (free tier) through the google-genai SDK. Only
GeminiModel below knows about Gemini, so switching to another provider later
means replacing that one class. Configure with environment variables:

    GEMINI_API_KEY      key from Google AI Studio (required)
    TEACHER_MODEL       model ids to try in order, comma-separated: the next one is
                        used when one is overloaded or rate-limited
                        (default gemini-3.5-flash-lite,gemini-3.1-flash-lite,
                        gemini-3.5-flash; the Lite models answered in under 1s on
                        the free tier while 3.5/3.8 Flash took 50s to 5 min)
    TEACHER_TIMEOUT     seconds to wait for one Gemini request (default 30)
    TEACHER_MAX_STEPS   most tool rounds per question (default 6)
"""
import json
import os
import re
import time
from datetime import timedelta
from decimal import Decimal

from .mcp_canada import MCPCanadaError, get_client
from .mcp_canada_cache import fetch_from_mcp_canada

DEFAULT_MODEL = "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.5-flash"
RETRY_ON = {404, 429, 500, 503, 504}  # retired, busy or rate-limited: try the next model


def log(message):
    """One progress line in the runserver terminal."""
    print(f"[teacher] {message}", flush=True)
CACHE_MAX_AGE = timedelta(days=7)
MAX_RESULT_CHARS = 12_000  # keeps one tool result from filling the prompt
# Text like "1740.00000000". Needs a decimal point, so codes like "095" are left alone.
DECIMAL_TEXT = re.compile(r"-?\d+\.\d+")

SYSTEM_PROMPT = """You are the AI teacher in a Toronto housing explorer for students.
You explain published data: Census neighbourhood profiles and other Canadian open data.

Rules for numbers (these matter most):
- Use only numbers that a tool returned. Quote each one exactly as given, with its year
  and source. Never calculate, add, subtract, average, rank, round, convert, or estimate.
- If the student asks for a calculation (a change, a difference, a percentage), say the
  app does not compute that, and quote the published values it would use instead.
- A missing value is unavailable, never zero. Say so instead of guessing.
- If a tool returns a measure but its value is blank, null, or has status "missing", say
  the source includes that measure but publishes no value for it. Never say the data is
  "not tracked" or "not collected" in that case.
- Before putting two values side by side, check that they are the same measure and the
  same boundaries. If the measure differs (for example "average gross rent" in one year
  and "median shelter cost" in another) or the neighbourhood boundaries differ (the 140
  neighbourhoods vs the 158 neighbourhoods), quote both but say clearly that they are
  not directly comparable, and why.
- Dollar amounts are nominal (not adjusted for inflation) and are not current asking rents.

How to answer:
- For anything about the neighbourhoods on screen, call get_screen_values first.
- Match scores: get_screen_values may include match_scores, the app's scores exactly as
  shown on screen, with each factor's score, weight and note, and the "why" lines. Quote
  them and explain them from those factors and notes. Never compute, change or re-weight a
  score. A factor marked unavailable was left out, not counted as zero.
- For data that is not on screen, look in MCP-Canada first: find_canada_data_tools,
  then get_canada_data.
- Only if MCP-Canada has no tool for it, or its tool fails or returns no rows, check the
  app's database: find_app_data, then get_app_observations. The app database tools refuse
  to run until you have tried MCP-Canada for this question.
- Name the source of every number you use.
- If no tool has the data, say it is not available. Do not answer from memory.
- Keep answers short (under 150 words), plain, and friendly. Explain what a value means
  and its limits, like a teacher would."""


class TeacherUnavailable(Exception):
    """The model is not configured or could not be reached."""


# ---------------------------------------------------------------- tools (provider-neutral)

def _tidy_numbers(value):
    """Turn "1740.00000000" into "1740" anywhere inside MCP-Canada's data."""
    if isinstance(value, dict):
        return {key: _tidy_numbers(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_tidy_numbers(item) for item in value]
    if isinstance(value, str) and DECIMAL_TEXT.fullmatch(value):
        return format(Decimal(value).normalize(), "f")
    return value


def _clip(payload) -> str:
    text = json.dumps(payload, ensure_ascii=False, default=str)
    if len(text) > MAX_RESULT_CHARS:
        text = text[:MAX_RESULT_CHARS] + ' ... [cut: ask for fewer rows with "limit" or a narrower filter]'
    return text


class TeacherTools:
    """The tools for one question. Records every source it hands to the model."""

    def __init__(self, screen, *, mcp_client=None, fetch=fetch_from_mcp_canada):
        self.screen = screen or {}
        self.mcp_client = mcp_client
        self.fetch = fetch
        self.sources = []
        self.calls = []
        # MCP-Canada first: the app database tools refuse until an MCP-Canada tool was called.
        self.tried_mcp = False

    declarations = [
        {
            "name": "get_screen_values",
            "description": "The page title, the match scores shown on screen (with each factor's score, "
                           "weight and note), and the neighbourhood profiles the student is looking at, "
                           "with each value's year and source. Quote these values exactly.",
            "parameters": {"type": "object", "properties": {}},
        },
        {
            "name": "find_canada_data_tools",
            "description": "Search MCP-Canada for data tools (Toronto neighbourhood profiles for 2006-2021, "
                           "CPI, Bank of Canada, Statistics Canada, and more). Returns tool names, "
                           "descriptions and argument schemas to use with get_canada_data.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "What data you need, in plain words"}},
                "required": ["query"],
            },
        },
        {
            "name": "get_canada_data",
            "description": "Run one MCP-Canada data tool found with find_canada_data_tools and get its rows "
                           "and source. Use a small 'limit' and a narrow filter when the tool has them.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tool": {"type": "string", "description": "Exact tool name, e.g. toronto_get_neighbourhood_profile"},
                    "arguments": {"type": "object", "description": "Arguments that match the tool's schema"},
                },
                "required": ["tool"],
            },
        },
        {
            "name": "find_app_data",
            "description": "Fallback only, after trying MCP-Canada: search the app's own database "
                           "(e.g. Census 2001, CMHC rents, OSM places) for sources, indicators and "
                           "geographies whose names match the words. Returns their ids.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Words to match, e.g. 'Annex rent 2001'"}},
                "required": ["query"],
            },
        },
        {
            "name": "get_app_observations",
            "description": "Stored values from the app's database for one geography, one indicator and "
                           "one source (ids from find_app_data), with year, status and source.",
            "parameters": {
                "type": "object",
                "properties": {
                    "geography_id": {"type": "string"},
                    "indicator_id": {"type": "string"},
                    "source_id": {"type": "string"},
                },
                "required": ["geography_id", "indicator_id", "source_id"],
            },
        },
    ]

    def run(self, name: str, args: dict) -> str:
        self.calls.append({"tool": name, "arguments": args})
        log(f"tool {name} {json.dumps(args, ensure_ascii=False)[:200]}")
        started = time.perf_counter()
        result = self._dispatch(name, args)
        log(f"tool {name} done in {time.perf_counter() - started:.1f}s ({len(result)} chars)")
        return result

    def _dispatch(self, name: str, args: dict) -> str:
        if name in ("find_canada_data_tools", "get_canada_data"):
            self.tried_mcp = True  # set before the call, so a failed lookup still counts
        if name in ("find_app_data", "get_app_observations") and not self.tried_mcp:
            log(f"refused {name}: MCP-Canada not tried yet")
            return _clip({"error": "Look in MCP-Canada first: call find_canada_data_tools, then "
                                   "get_canada_data. Use the app database only if MCP-Canada "
                                   "has no tool for this, or its tool fails or returns no rows."})
        try:
            if name == "get_screen_values":
                return _clip(self.screen or {"note": "Nothing is selected on screen."})
            if name == "find_canada_data_tools":
                return self._find(str(args.get("query", "")))
            if name == "get_canada_data":
                return self._get(str(args.get("tool", "")), args.get("arguments") or {})
            if name == "find_app_data":
                return self._find_app(str(args.get("query", "")))
            if name == "get_app_observations":
                return self._app_observations(**{k: str(args.get(k, "")) for k in
                                                 ("geography_id", "indicator_id", "source_id")})
            return _clip({"error": f"Unknown tool {name}"})
        except MCPCanadaError as exc:
            return _clip({"error": f"MCP-Canada is unavailable: {exc}"})

    def _find(self, query):
        client = self.mcp_client or get_client()
        found = client.call_server_tool("discover_tools", {"query": query})
        tools = found.get("result", found) if isinstance(found, dict) else found
        return _clip([
            {"name": t.get("name"), "description": (t.get("description") or "")[:600],
             "arguments": t.get("inputSchema", {}).get("properties", {})}
            for t in (tools or [])[:5]
        ])

    def _get(self, tool, arguments):
        if not tool:
            return _clip({"error": "Give the tool name."})
        result = self.fetch(tool, arguments, max_age=CACHE_MAX_AGE, client=self.mcp_client)
        if result["status"] == "unavailable":
            return _clip({"error": result["error"] or "No data"})
        source = result["source"]
        if source not in self.sources:
            self.sources.append(source)
        return _clip({"status": result["status"], "source": source, "data": _tidy_numbers(result["data"])})

    def _find_app(self, query, per_kind=10):
        from django.db.models import Q
        from .models import Geography, Indicator, Observation, SourceRelease

        words = [w.lower() for w in query.replace(",", " ").split() if len(w) > 2][:6]
        if not words:
            return _clip({"error": "Give a few words to search for."})

        def best(model, fields, values):
            """Rows matching any word, best first: the most words matched across the fields."""
            q = Q()
            for word in words:
                for field in fields:
                    q |= Q(**{f"{field}__icontains": word})
            rows = list(model.objects.filter(q).values(*values)[:2000])

            def score(row):
                text = " ".join(str(row.get(field, "")) for field in fields).lower()
                return sum(word in text for word in words)

            rows.sort(key=score, reverse=True)
            return rows[:per_kind]

        indicators = best(Indicator, ["label", "id"], ["id", "label", "unit"])
        for indicator in indicators:
            # Which source and boundary set this indicator has values in, so the agent
            # passes a matching trio to get_app_observations (2001 uses the 140 model).
            indicator["available_in"] = [
                {"source_id": source, "geography_set_id": geography_set}
                for source, geography_set in Observation.objects
                .filter(indicator_id=indicator["id"])
                .values_list("source_id", "geography__geography_set_id").distinct()[:5]
            ]
        return _clip({
            "indicators": indicators,
            "geographies": best(Geography, ["name", "code"], ["id", "name", "geography_set_id"]),
            "sources": best(SourceRelease, ["title", "coverage"], ["id", "title", "publisher"]),
        })

    def _app_observations(self, geography_id, indicator_id, source_id):
        from .models import SourceRelease
        from .services import get_observations

        rows = get_observations(geography_id=geography_id, indicator_id=indicator_id, source_id=source_id)
        # Decimal("1023.50000000") -> "1023.5": same value, without the storage padding.
        rows = [{**row, "value": format(row["value"].normalize(), "f") if row["value"] is not None else None}
                for row in rows.values("census_year", "reference_year", "period", "value", "status", "notes")[:50]]
        if not rows:
            return _clip({"error": "No stored values for that geography, indicator and source."})
        release = SourceRelease.objects.filter(id=source_id).values("title", "publisher", "url").first() or {}
        source = {"tool": "app_database", "api": release.get("title", source_id), "url": release.get("url", "")}
        if source not in self.sources:
            self.sources.append(source)
        return _clip({"source": source, "observations": rows})


# ---------------------------------------------------------------- Gemini (the only provider-specific part)

class GeminiModel:
    def __init__(self, model=None, api_key=None, client=None):
        names = model or os.environ.get("TEACHER_MODEL") or DEFAULT_MODEL
        self.models = [m.strip() for m in names.split(",") if m.strip()]
        self.model = self.models[0]  # the model currently in use
        if client is None:
            api_key = api_key or os.environ.get("GEMINI_API_KEY")
            if not api_key:
                raise TeacherUnavailable("GEMINI_API_KEY is not set")
            from google import genai
            from google.genai import types
            timeout_ms = int(float(os.environ.get("TEACHER_TIMEOUT", "30")) * 1000)
            # One quick retry at most: when a model is busy we move to the next one
            # instead of letting the SDK back off for minutes.
            client = genai.Client(api_key=api_key, http_options=types.HttpOptions(
                timeout=timeout_ms, retry_options=types.HttpRetryOptions(attempts=2, max_delay=3)))
        self.client = client

    def _generate(self, contents, config):
        """One request, moving down the model list while models are busy."""
        from google.genai import errors

        while True:
            started = time.perf_counter()
            try:
                response = self.client.models.generate_content(
                    model=self.model, contents=contents, config=config)
                log(f"{self.model} answered in {time.perf_counter() - started:.1f}s")
                return response
            except errors.APIError as exc:
                problem, retry = f"Gemini error {exc.code}: {exc.message}", exc.code in RETRY_ON
            except Exception as exc:  # timeouts and network errors from the HTTP client
                problem, retry = f"Gemini request failed: {type(exc).__name__}: {exc}", True
            log(f"{self.model} failed after {time.perf_counter() - started:.1f}s: {problem}")
            later = self.models[self.models.index(self.model) + 1:]
            if not retry or not later:
                raise TeacherUnavailable(problem)
            self.model = later[0]
            log(f"trying {self.model} instead")

    def answer(self, question: str, tools: TeacherTools, max_steps: int) -> tuple[str, dict]:
        from google.genai import types

        config = types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            tools=[types.Tool(function_declarations=[
                types.FunctionDeclaration(name=d["name"], description=d["description"],
                                          parameters_json_schema=d["parameters"])
                for d in tools.declarations
            ])],
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
        contents = [types.Content(role="user", parts=[types.Part.from_text(text=question)])]
        usage = {"input_tokens": 0, "output_tokens": 0, "requests": 0}

        for _ in range(max_steps + 1):
            response = self._generate(contents, config)
            usage["requests"] += 1
            meta = response.usage_metadata
            if meta:
                usage["input_tokens"] += meta.prompt_token_count or 0
                usage["output_tokens"] += (meta.candidates_token_count or 0) + (meta.thoughts_token_count or 0)

            calls = response.function_calls or []
            if not calls:
                return (response.text or "").strip(), usage
            # Keep the model's turn unchanged: Gemini 3 needs its thought signatures back.
            contents.append(response.candidates[0].content)
            contents.append(types.Content(role="user", parts=[
                types.Part.from_function_response(
                    name=call.name, response={"result": tools.run(call.name, dict(call.args or {}))})
                for call in calls
            ]))
        return "I could not finish looking that up. Try a narrower question.", usage


# ---------------------------------------------------------------- entry point for the view

def ask_teacher(question: str, screen: dict | None, *, model=None, mcp_client=None,
                fetch=fetch_from_mcp_canada) -> dict:
    """Answer one student question. Raises TeacherUnavailable if the model can't be used."""
    question = (question or "").strip()[:1000]
    if not question:
        raise ValueError("question is empty")
    log(f"question: {question[:120]}")
    tools = TeacherTools(screen, mcp_client=mcp_client, fetch=fetch)
    model = model or GeminiModel()
    max_steps = int(os.environ.get("TEACHER_MAX_STEPS", "6"))
    answer, usage = model.answer(question, tools, max_steps)
    return {
        "answer": answer or "I don't have an answer for that.",
        "sources": tools.sources,
        "tool_calls": tools.calls,
        "model": getattr(model, "model", None),
        "usage": usage,
    }
