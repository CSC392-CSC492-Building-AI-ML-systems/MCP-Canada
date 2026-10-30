from django.db.models import Count
from django.http import JsonResponse
from django.views.decorators.http import require_GET

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
