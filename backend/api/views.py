from django.db.models import Count
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
    # Toronto CMA average rent matching the selected Census snapshot.
    housing_rent = None

    # Identify the selected Census year from its source.
    census_year_by_source = {
        "census-2001-csv-8d3542c5b0": 2001,
        "census-2006-csv-f5eaa4478e": 2006,
        "census-2011-csv-2fc83b4b8e": 2011,
        "census-2016-csv-9d45a882dd": 2016,
        "census-2021-xlsx-9a3c372907": 2021,
}

    census_year = census_year_by_source.get(source_id)

    # Historical CMHC rent is currently available for the 2021 snapshot.
    rent_reference_years = {
        2021: 2021,
}
    rent_reference_year = rent_reference_years.get(census_year)

    if budget and rent_reference_year is not None:
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

        rent_observation = (
            Observation.objects
            .filter(
                geography__name="Toronto CMA",
                geography__geography_set__kind="cma",
                indicator_id=f"cmhc-2021-apartment-rent-{bedroom_category}",
                reference_year=rent_reference_year,
                status="observed",
            )
            .first()
        )

        if rent_observation:
            housing_rent = {
                "value": str(rent_observation.value),
                "bedrooms": bedroom_category,
                "reference_year": rent_observation.reference_year,
                "geography": "Toronto CMA",}


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
