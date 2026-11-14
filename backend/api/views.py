from django.db.models.fields.json import KT
from django.http import JsonResponse
from django.views.decorators.http import require_GET
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
from .services import get_health


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

    rows = Observation.objects.filter(**filters).order_by(
        "reference_year", "period", "id",
    ).values(
        "census_year", "reference_year", "period", "value", "status",
        "source_locator", "notes",
    )
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
    })


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