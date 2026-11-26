import json
from datetime import date, timedelta

from django.db.models.fields.json import KT
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST
from .comparison_services import Budget

from .models import (
    Geography,
    GeographySet,
    Indicator,
    Observation,
    Place,
    SourceRelease,
    SourceTableRow,
)
from .agent import TeacherUnavailable, ask_teacher
from .mcp_canada_cache import fetch_from_mcp_canada
from .services import get_health
from . import derived_census
from .boundary_crosswalk import boundary_links
from .parks import ParksUnavailable, nearby_parks
from .land_use import LandUseUnavailable, land_use
from . import transit
from . import inflation


@require_GET
def health(request):
    return JsonResponse(get_health())


@require_GET
def catalog(request):
    return JsonResponse({
        "summary": {
            "sources": SourceRelease.objects.count(),
            "geography_sets": GeographySet.objects.count(),
            "geographies": Geography.objects.count(),
            "indicators": Indicator.objects.count(),
            "observations": Observation.objects.count(),
            "places": Place.objects.count(),
            "staged_source_rows": SourceTableRow.objects.count(),
        },
        "sources": list(SourceRelease.objects.order_by("title").values(
            "id", "publisher", "title", "url", "licence", "coverage",
        )),
        "geography_sets": list(GeographySet.objects.order_by("id").values(
            "id", "kind", "version", "expected_count", "source_id",
        )),
        "geographies": list(Geography.objects.select_related("geography_set")
            .order_by("geography_set_id", "name").values(
                "id", "code", "name", "geography_set_id",
                "geography_set__kind", "geography_set__version",
            )),
        "indicators": list(Indicator.objects.order_by("label").values(
            "id", "label", "unit", "definition", "universe", "statistic",
            "dimensions",
        )),
        # How each 2021 (158) neighbourhood relates to the earlier (140) ones.
        "boundary_links": boundary_links(),
    })


@require_GET
def observations(request):
    filters = {
        "geography_id": request.GET.get("geography_id", "").strip(),
        "indicator_id": request.GET.get("indicator_id", "").strip(),
        "source_id": request.GET.get("source_id", "").strip(),
    }
    missing = [field for field, value in filters.items() if not value]
    if missing:
        return JsonResponse(
            {"error": f"Required query parameters: {', '.join(missing)}"},
            status=400,
        )

    rows = list(Observation.objects.filter(**filters).order_by(
        "reference_year", "period", "id",
    ).values(
        "census_year", "reference_year", "period", "value", "status",
        "source_locator", "notes",
    ))
    if not rows:
        geography_set = Geography.objects.filter(id=filters["geography_id"]).values_list(
            "geography_set_id", flat=True).first()
        if geography_set and derived_census.applies(geography_set, filters["source_id"]):
            derived = derived_census.derive(filters["source_id"], filters["indicator_id"], [filters["geography_id"]])
            return JsonResponse({"observations": [
                {k: v for k, v in row.items() if k not in ("geography_id", "name")} for row in derived
            ]})
    return JsonResponse({
        "observations": [
            {**row, "value": str(row["value"]) if row["value"] is not None else None}
            for row in rows
        ],
    })


@require_GET
def observations_batch(request):
    """One indicator for every geography in a set, e.g. a Census row for all 158 neighbourhoods."""
    filters = {
        "geography__geography_set_id": request.GET.get("geography_set_id", "").strip(),
        "indicator_id": request.GET.get("indicator_id", "").strip(),
        "source_id": request.GET.get("source_id", "").strip(),
    }
    if not all(filters.values()):
        return JsonResponse(
            {"error": "Required query parameters: geography_set_id, indicator_id, source_id"},
            status=400,
        )
    year = request.GET.get("reference_year", "").strip()
    if year:
        if not year.isdigit():
            return JsonResponse({"error": "reference_year must be a year"}, status=400)
        filters["reference_year"] = int(year)
    if derived_census.applies(filters["geography__geography_set_id"], filters["source_id"]):
        # The 2021 Census is published only on the 158 boundaries; derive the 140 values.
        return JsonResponse({"observations": derived_census.derive(
            filters["source_id"], filters["indicator_id"], reference_year=filters.get("reference_year"))})
    rows = Observation.objects.filter(**filters).order_by(
        "geography_id", "reference_year", "period", "id",
    ).values(
        "geography_id", "geography__name", "census_year", "reference_year",
        "period", "value", "status", "source_locator",
    )
    return JsonResponse({
        "observations": [
            {
                **{k: v for k, v in row.items() if k != "geography__name"},
                "name": row["geography__name"],
                "value": str(row["value"]) if row["value"] is not None else None,
            }
            for row in rows
        ],
    })


@require_GET
def places(request):
    """Point locations of one amenity category (e.g. library) with their source.

    Optional bbox=minLon,minLat,maxLon,maxLat limits the area. kind is the source's own
    subtype where one exists (the OSM shop tag for groceries), otherwise null."""
    category = request.GET.get("category", "").strip()
    if not category:
        return JsonResponse({"error": "Required query parameter: category"}, status=400)
    places_in = Place.objects.filter(category=category)
    if request.GET.get("bbox"):
        try:
            west, south, east, north = (float(x) for x in request.GET["bbox"].split(","))
        except ValueError:
            return JsonResponse({"error": "bbox must be minLon,minLat,maxLon,maxLat"}, status=400)
        if not (-180 <= west <= east <= 180 and -90 <= south <= north <= 90):
            return JsonResponse({"error": "bbox must be minLon,minLat,maxLon,maxLat"}, status=400)
        places_in = places_in.filter(longitude__gte=west, longitude__lte=east,
                                     latitude__gte=south, latitude__lte=north)
    rows = places_in.order_by("name").values(
        "name", "latitude", "longitude", "valid_on", "source_id", kind=KT("properties__tags__shop"),
    )
    return JsonResponse({
        "places": [
            {**row, "latitude": float(row["latitude"]), "longitude": float(row["longitude"]),
             "valid_on": row["valid_on"].isoformat()}
            for row in rows
        ],
        "sources": list(SourceRelease.objects.filter(
            id__in={row["source_id"] for row in rows},
        ).values("id", "publisher", "title", "url", "coverage")),
        # Tells "none in this area" apart from "this list was never imported".
        "category_loaded": Place.objects.filter(category=category).exists(),
    })


@require_GET
def parks_nearby(request):
    """City parks around a point: distance to each park's edge, the closest few, how many
    are within 1 km, and park outlines inside bbox=minLon,minLat,maxLon,maxLat."""
    try:
        longitude = float(request.GET.get("longitude", ""))
        latitude = float(request.GET.get("latitude", ""))
        west, south, east, north = (float(x) for x in request.GET.get("bbox", "").split(","))
    except ValueError:
        return JsonResponse({"error": "Required: longitude, latitude and bbox=minLon,minLat,maxLon,maxLat"}, status=400)
    if not (-180 <= longitude <= 180 and -90 <= latitude <= 90 and -180 <= west <= east <= 180 and -90 <= south <= north <= 90):
        return JsonResponse({"error": "Coordinates are out of range"}, status=400)
    try:
        return JsonResponse(nearby_parks(longitude, latitude, (west, south, east, north)))
    except ParksUnavailable as exc:
        # Not loaded is a normal state for a local database, not an error.
        return JsonResponse({"category_loaded": False, "reason": str(exc), "within_1km": None, "nearest": [],
                             "features": {"type": "FeatureCollection", "features": []}, "as_of": None, "source": None})


@require_GET
def land_use_view(request):
    """Zoning (By-law 569-2013) inside one neighbourhood: clipped zone polygons and each
    category's share of the neighbourhood's area. Permitted use, present day."""
    geography_id = request.GET.get("geography_id", "").strip()
    if not geography_id:
        return JsonResponse({"error": "Required query parameter: geography_id"}, status=400)
    try:
        return JsonResponse(land_use(geography_id))
    except LookupError as exc:
        return JsonResponse({"error": str(exc)}, status=404)
    except LandUseUnavailable as exc:
        # Not loaded is a normal state for a local database, not an error.
        return JsonResponse({"category_loaded": False, "reason": str(exc), "geography_id": geography_id,
                             "features": {"type": "FeatureCollection", "features": []}, "shares": [],
                             "not_covered_percent": None, "as_of": None, "source": None})


@require_GET
def comparison(request):
    """Compare real observations across selected Toronto neighbourhoods."""

    geography_ids = list(dict.fromkeys(
        x.strip() for x in request.GET.get("geography_ids", "").split(",")
        if x.strip()
    ))
    indicator_ids = list(dict.fromkeys(
        x.strip() for x in request.GET.get("indicator_ids", "").split(",")
        if x.strip()
    ))
    source_id = request.GET.get("source_id", "").strip()

    try:
        income = request.GET.get("before_tax_income")
        rent = request.GET.get("monthly_rent")
        bedrooms = request.GET.get("bedrooms")

        budget = None

        if income is not None or rent is not None or bedrooms is not None:
            budget = Budget(
                before_tax_income=float(income) if income else None,
                monthly_rent=float(rent) if rent else None,
                bedrooms=int(bedrooms) if bedrooms else 0,
            )

    except (ValueError, TypeError):
        return JsonResponse(
            {"error": "Invalid budget preferences."},
            status=400,
        )
    if not 3 <= len(geography_ids) <= 5:
        return JsonResponse(
            {"error": "Select between 3 and 5 neighbourhoods."},
            status=400,
        )

    if not indicator_ids or len(indicator_ids) > 20 or not source_id:
        return JsonResponse(
            {"error": "Provide a source_id and between 1 and 20 indicator_ids."},
            status=400,
        )
    if budget:
        if (
            budget.get_monthly_income() is not None
            and budget.get_monthly_income() < 0
        ):
            return JsonResponse(
                {"error": "Income cannot be negative."},
                status=400,
            )

        if (
            budget.get_monthly_rent() is not None
            and budget.get_monthly_rent() < 0
        ):
            return JsonResponse(
                {"error": "Rent budget cannot be negative."},
                status=400,
            )

        if budget.get_bedrooms() not in range(0, 6):
            return JsonResponse(
                {"error": "Bedrooms must be between 0 and 5."},
                status=400,
            )
    
    historical_source_ids = {
        "census-2001-csv-8d3542c5b0",
        "census-2006-csv-f5eaa4478e",
        "census-2011-csv-2fc83b4b8e",
        "census-2016-csv-9d45a882dd",
    }

    geography_set_id = (
        "toronto-140"
        if source_id in historical_source_ids
        else "toronto-158"
    )

    selected_geographies = list(
        Geography.objects.filter(
            id__in=geography_ids,
            geography_set_id="toronto-158",
        ).values("id", "name")
    )

    if len(selected_geographies) != len(geography_ids):
        return JsonResponse(
            {"error": "One or more neighbourhood IDs are invalid."},
            status=400,
        )

    if geography_set_id == "toronto-140":
        historical_names = [g["name"] for g in selected_geographies]

        geographies = list(
            Geography.objects.filter(
                name__in=historical_names,
                geography_set_id="toronto-140",
            ).values("id", "name")
        )

        if len(geographies) != len(selected_geographies):
            return JsonResponse(
                {"error": "Historical neighbourhood mapping is incomplete."},
                status=400,
            )
    else:
        geographies = selected_geographies

    observation_geography_ids = [g["id"] for g in geographies]

    indicators = list(
        Indicator.objects.filter(id__in=indicator_ids).values(
            "id", "label", "unit", "dimensions"
        )
    )

    if len(indicators) != len(indicator_ids):
        return JsonResponse(
            {"error": "One or more indicator IDs are invalid."},
            status=400,
        )

    rows = Observation.objects.filter(
        source_id=source_id,
        geography_id__in=observation_geography_ids,
        indicator_id__in=indicator_ids,
    ).values(
        "geography_id",
        "indicator_id",
        "census_year",
        "reference_year",
        "period",
        "value",
        "status",
    )

    housing_rent = None

    if budget:
        bedroom_categories = {
            0: "studio",
            1: "1",
            2: "2",
            3: "3plus",
            4: "3plus",
            5: "3plus",
        }

        bedroom_category = bedroom_categories.get(
            budget.get_bedrooms(), "1"
        )

        rent_observation = Observation.objects.filter(
            source_id="cmhc-toronto-2025-xlsx-99ad5966be",
            geography__name="Toronto CMA",
            geography__geography_set__kind="cma",
            indicator_id=f"cmhc-2025-apartment-rent-{bedroom_category}",
            reference_year=2025,
            status="observed",
        ).first()

        if rent_observation:
            housing_rent = {
                "value": float(rent_observation.value),
                "bedrooms": budget.get_bedrooms(),
                "reference_year": 2025,
                "geography": "Toronto CMA",
            }


    return JsonResponse({
        "geographies": geographies,
        "indicators": indicators,
        "observations": [
            {
                **row,
                "value": str(row["value"]) if row["value"] is not None else None,
            }
            for row in rows
        ],
        "budget": {
            "monthly_income": budget.get_monthly_income(),
            "monthly_rent": budget.get_monthly_rent(),
            "bedrooms": budget.get_bedrooms(),
        } if budget else None,
        "housing_rent": housing_rent,
    })
    
@require_GET
def boundaries(request):
    """Return one boundary set as a GeoJSON FeatureCollection."""
    geography_set_id = request.GET.get("geography_set_id", "").strip()

    if not geography_set_id:
        return JsonResponse(
            {"error": "Required query parameter: geography_set_id"},
            status=400,
        )

    rows = Geography.objects.filter(
        geography_set_id=geography_set_id,
        geometry__isnull=False,
    ).order_by("code").values("id", "code", "name", "geometry")

    return JsonResponse({
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": row["geometry"],
                "properties": {
                    "geography_id": row["id"],
                    "code": row["code"],
                    "name": row["name"],
                },
            }
            for row in rows
        ],
    })


CPI_SERIES = "V41690973"  # Total CPI, Bank of Canada Valet (same series as official-sources.json)


@require_GET
def mcp_canada_cpi(request):
    """Monthly total CPI, fetched live from MCP-Canada and cached for 24 hours."""
    start_date = request.GET.get("start_date", "2020-01-01").strip()
    try:
        date.fromisoformat(start_date)
    except ValueError:
        return JsonResponse({"error": "start_date must be YYYY-MM-DD"}, status=400)

    result = fetch_from_mcp_canada(
        "boc_get_observations",
        {"series_names": CPI_SERIES, "start_date": start_date},
        max_age=timedelta(hours=24),
        refresh=request.GET.get("refresh") == "1",
    )
    series = (result.pop("data") or {}).get(CPI_SERIES, {})
    result["label"] = series.get("label")
    result["observations"] = [
        {"period": period, "value": value}
        for period, value in sorted(series.get("observations", {}).items())
    ]
    return JsonResponse(result, status=503 if result["status"] == "unavailable" else 200)


MAX_TEACHER_CONTEXT_BYTES = 200_000


@csrf_exempt  # JSON API with no login or cookies; the frontend posts through the Next.js proxy
@require_POST
def teacher_ask(request):
    """Answer one AI-teacher question: {"question": str, "context": {title, profiles} | null}.

    503 means the model is not configured or not reachable, so the frontend
    falls back to its prepared explanations.
    """
    if len(request.body) > MAX_TEACHER_CONTEXT_BYTES:
        return JsonResponse({"error": "Request is too large"}, status=413)
    try:
        body = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Body must be JSON"}, status=400)
    question = body.get("question") if isinstance(body, dict) else None
    context = body.get("context") if isinstance(body, dict) else None
    if not isinstance(question, str) or not question.strip():
        return JsonResponse({"error": "question is required"}, status=400)
    if context is not None and not isinstance(context, dict):
        return JsonResponse({"error": "context must be an object or null"}, status=400)
    try:
        return JsonResponse(ask_teacher(question, context))
    except TeacherUnavailable as exc:
        return JsonResponse({"error": str(exc)}, status=503)


MAX_TRANSIT_ORIGINS = 10
# Greater Toronto: the TTC network plus a margin for destinations just outside the city.
TRANSIT_BOUNDS = (43.40, 44.05, -79.90, -78.90)  # min lat, max lat, min lng, max lng


def _point(value):
    if not isinstance(value, dict):
        return None
    lat, lng = value.get("lat"), value.get("lng")
    if not all(isinstance(n, (int, float)) and not isinstance(n, bool) for n in (lat, lng)):
        return None
    min_lat, max_lat, min_lng, max_lng = TRANSIT_BOUNDS
    return (float(lat), float(lng)) if min_lat <= lat <= max_lat and min_lng <= lng <= max_lng else None


@csrf_exempt  # JSON API with no login or cookies; the frontend posts through the Next.js proxy
@require_POST
def transit_commute(request):
    """Scheduled TTC travel time from each origin to one destination, arriving by a weekday time.

    Body: {"destination": {lat, lng}, "origins": [{id, lat, lng}], "arrive_by": "HH:MM"?}.
    POST keeps the destination out of URLs and server logs; nothing is stored.
    """
    if len(request.body) > 20_000:
        return JsonResponse({"error": "Request is too large"}, status=413)
    try:
        body = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Body must be JSON"}, status=400)
    if not isinstance(body, dict):
        return JsonResponse({"error": "Body must be an object"}, status=400)
    destination = _point(body.get("destination"))
    if destination is None:
        return JsonResponse({"error": "destination must be {lat, lng} in the Toronto area"}, status=400)
    raw_origins = body.get("origins")
    if not isinstance(raw_origins, list) or not 1 <= len(raw_origins) <= MAX_TRANSIT_ORIGINS:
        return JsonResponse({"error": f"origins must list 1 to {MAX_TRANSIT_ORIGINS} places"}, status=400)
    origins = []
    for item in raw_origins:
        point = _point(item)
        if point is None or not isinstance(item.get("id"), str) or not item["id"]:
            return JsonResponse({"error": "each origin needs an id and {lat, lng} in the Toronto area"}, status=400)
        origins.append((item["id"], *point))
    try:
        arrive_by = transit.parse_arrive_by(body.get("arrive_by"))
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    try:
        index = transit.load_index()
    except transit.TransitUnavailable as exc:
        return JsonResponse({"status": "unavailable", "error": str(exc)}, status=503)
    feed = index["feed"]
    return JsonResponse({
        "status": "ok",
        "service_date": index["service_date"],
        "arrive_by": f"{arrive_by // 3600:02d}:{arrive_by % 3600 // 60:02d}",
        "source": {"id": f"ttc-gtfs-{feed['version']}", "title": "Merged GTFS – TTC routes and schedules",
                   "publisher": "Toronto Transit Commission",
                   "url": "https://open.toronto.ca/dataset/merged-gtfs-ttc-routes-and-schedules/",
                   "version": feed["version"], "valid_from": feed["start"], "valid_to": feed["end"]},
        "method": ("Published TTC weekday schedule, no real-time delays. Walking to, between and from stops "
                   "is estimated from straight-line distance (x1.3) at 4.8 km/h, up to 1 km at each end and "
                   "250 m between stops, with 1 minute to change vehicles."),
        "results": transit.commute_times(index, destination, origins, arrive_by),
    })


# --------------------------------------------------------------------------- inflation (CPI)

def _optional_year(request, name):
    """A year query parameter that may be left out; raises InvalidInflationRequest when malformed."""
    raw = request.GET.get(name)
    if raw is None or raw.strip() == "":
        return None
    return inflation.parse_year(raw, name)


@require_GET
def cpi_annual(request):
    """Annual CPI for every year in the database, with each year's status.

    Optional query parameters: start_year and end_year (inclusive).
    """
    try:
        start_year = _optional_year(request, "start_year")
        end_year = _optional_year(request, "end_year")
    except inflation.InvalidInflationRequest as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    if start_year is not None and end_year is not None and start_year > end_year:
        return JsonResponse({"error": "start_year must not be after end_year."}, status=400)

    try:
        table = inflation.load_cpi_table()
    except inflation.InflationDataUnavailable as exc:
        return JsonResponse({"error": str(exc)}, status=503)

    return JsonResponse(inflation.table_as_dict(table, start_year, end_year))


@require_GET
def cpi_convert(request):
    """Convert an amount from one year's dollars into another year's dollars.

    Required query parameters: amount, from_year, to_year.
    A year without a complete CPI gives status "not_adjusted" with a reason, never a guess.
    """
    try:
        amount = inflation.parse_amount(request.GET.get("amount"), "amount")
        from_year = inflation.parse_year(request.GET.get("from_year"), "from_year")
        to_year = inflation.parse_year(request.GET.get("to_year"), "to_year")
    except inflation.InvalidInflationRequest as exc:
        return JsonResponse({"error": str(exc)}, status=400)

    try:
        table = inflation.load_cpi_table()
    except inflation.InflationDataUnavailable as exc:
        return JsonResponse({"error": str(exc)}, status=503)

    result = inflation.adjust_amount(amount, from_year, to_year, table)
    return JsonResponse({
        **result.as_dict(),
        "source": table.source.as_dict() if table.source else None,
    })


@require_GET
def cpi_real_change(request):
    """Change between two values from two years, before and after inflation.

    Required query parameters: from_value, to_value, from_year, to_year.
    """
    try:
        from_value = inflation.parse_amount(request.GET.get("from_value"), "from_value")
        to_value = inflation.parse_amount(request.GET.get("to_value"), "to_value")
        from_year = inflation.parse_year(request.GET.get("from_year"), "from_year")
        to_year = inflation.parse_year(request.GET.get("to_year"), "to_year")
    except inflation.InvalidInflationRequest as exc:
        return JsonResponse({"error": str(exc)}, status=400)

    try:
        table = inflation.load_cpi_table()
    except inflation.InflationDataUnavailable as exc:
        return JsonResponse({"error": str(exc)}, status=503)

    result = inflation.real_change(from_value, to_value, from_year, to_year, table)
    return JsonResponse({
        **result.as_dict(),
        "source": table.source.as_dict() if table.source else None,
    })
