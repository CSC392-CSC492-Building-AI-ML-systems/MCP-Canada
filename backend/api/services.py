"""Application application logic shared by HTTP and MCP."""


def get_health() -> dict[str, str]:
    return {"status": "ok", "service": "django", "database": "configured"}


def get_observations(*, geography_id, indicator_id, source_id):
    """Explicit scope: never silently substitute CMA/zone data or boundary sets."""
    from .models import Observation
    return Observation.objects.filter(geography_id=geography_id,
        indicator_id=indicator_id, source_id=source_id).order_by("reference_year", "period")


def comparable_values(observations):
    """Reject mixed boundaries, definitions, releases and unavailable values."""
    rows = list(observations)
    signatures = {(o.geography_id, o.indicator_id, o.source_id) for o in rows}
    if len(signatures) > 1 or any(o.status != "observed" for o in rows):
        raise ValueError("Comparison requires one geography, definition and release, with observed values")
    return rows
