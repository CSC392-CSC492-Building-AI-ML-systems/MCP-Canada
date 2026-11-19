"""2021 Census values on the earlier (140) neighbourhood boundaries.

The City published the 2021 Census only for its 158 neighbourhoods. Because
every 158 area lies wholly inside one 140 area (see boundary_crosswalk), a 140
area's 2021 value can be derived without estimation:

- unchanged area: the published value of its identical 158 area;
- split area: counts are summed over its parts; an average or a percentage is
  combined as a weighted average using the count it is averaged over (e.g.
  average renter shelter cost weighted by tenant households). Medians and
  anything without a known weight are reported as missing, never estimated.

Nothing is stored: values are computed per request from the published rows, and
every derived row says how it was produced.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from .boundary_crosswalk import OLD_SET, load_links
from .models import Geography, Indicator, Observation

# Indicator -> (count rows whose sum weights it, what the weight counts). The
# weight must be the population the published average or percentage describes.
WEIGHTS = {
    "census-2021-row-381": (["census-2021-row-376"], "tenant households"),   # average renter shelter cost
    "census-2021-row-378": (["census-2021-row-376"], "tenant households"),   # % tenants spending 30%+
    "census-2021-row-246": (["census-2021-row-301", "census-2021-row-302"],  # average household income
                            "private households (owners plus renters)"),
    "census-2021-row-248": (["census-2021-row-301", "census-2021-row-302"],  # average after-tax income
                            "private households (owners plus renters)"),
}


def applies(geography_set_id: str, source_id: str) -> bool:
    """True for a 2021 Census request on the earlier boundaries, which has no published rows."""
    return geography_set_id == OLD_SET and source_id.startswith("census-2021-")


def _number(value: Decimal) -> str:
    return str(value.quantize(Decimal(1)) if value == value.to_integral() else value.quantize(Decimal("0.01")))


def _published(source_id: str, indicator_ids: list[str], geography_ids: set[str]):
    """{indicator: {geography: row}} keeping only geographies with exactly one annual row."""
    found: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    for row in Observation.objects.filter(source_id=source_id, indicator_id__in=indicator_ids,
                                          geography_id__in=geography_ids, period="annual"):
        found[row.indicator_id][row.geography_id].append(row)
    return {ind: {geo: rows[0] for geo, rows in by_geo.items() if len(rows) == 1} for ind, by_geo in found.items()}


def derive(source_id: str, indicator_id: str, parent_ids: list[str] | None = None,
           reference_year: int | None = None) -> list[dict]:
    """Rows in the observations API shape, one per 140 area that has any 2021 part."""
    indicator = Indicator.objects.filter(id=indicator_id).values("statistic").first()
    if not indicator:
        return []
    children: dict[str, list[str]] = defaultdict(list)
    relation: dict[str, str] = {}
    for child, link in load_links().items():
        if parent_ids is None or link["parent"] in parent_ids:
            children[link["parent"]].append(child)
            relation[link["parent"]] = link["relation"]
    if not children:
        return []
    every_child = {c for group in children.values() for c in group}
    weights, weight_label = WEIGHTS.get(indicator_id, ([], ""))
    published = _published(source_id, [indicator_id, *weights], every_child)
    values, weight_rows = published.get(indicator_id, {}), [published.get(w, {}) for w in weights]
    names = dict(Geography.objects.filter(id__in=[*every_child, *children]).values_list("id", "name"))
    observed = lambda row: row is not None and row.status == "observed" and row.value is not None  # noqa: E731

    result = []
    for parent, parts in sorted(children.items()):
        parts = sorted(parts)
        rows = [values.get(c) for c in parts]
        template = next((r for r in rows if r is not None), None)
        if template is None or (reference_year is not None and template.reference_year != reference_year):
            continue
        part_names = [names.get(c, c) for c in parts]
        base = {"geography_id": parent, "name": names.get(parent, parent), "census_year": template.census_year,
                "reference_year": template.reference_year, "period": "annual",
                "source_locator": "; ".join(r.source_locator for r in rows if r is not None)}

        if relation[parent] == "same":
            row = rows[0]
            method = (f"The boundary did not change in 2021; this is the value published for {part_names[0]} "
                      "on the 2021 boundaries.")
            result.append({**base, "value": _number(row.value) if observed(row) else None,
                           "status": row.status if row is not None else "missing", "notes": method,
                           "derived": {"relation": "same", "method": method, "parts": part_names}})
            continue

        method, value = None, None
        listed = ", ".join(part_names)
        if not all(observed(r) for r in rows):
            missing = [n for n, r in zip(part_names, rows) if not observed(r)]
            method = f"Not combined: the 2021 value is not published for {', '.join(missing)}."
        elif indicator["statistic"] == "count":
            value = sum(r.value for r in rows)
            method = f"Sum of the 2021 values for {listed}, which together make up this neighbourhood."
        elif weights:
            def part_weight(child):
                counts = [w.get(child) for w in weight_rows]
                return sum(r.value for r in counts) if all(observed(r) for r in counts) else None
            part_weights = [part_weight(c) for c in parts]
            if any(w is None for w in part_weights) or sum(part_weights) <= 0:
                method = f"Not combined: the number of {weight_label} is not published for every part."
            else:
                value = sum(r.value * w for r, w in zip(rows, part_weights)) / sum(part_weights)
                method = (f"Average of the 2021 values for {listed}, weighted by their number of "
                          f"{weight_label}; together they make up this neighbourhood.")
        else:
            method = (f"Not combined: a {indicator['statistic']} cannot be calculated exactly from the parts "
                      f"({listed}) of a neighbourhood that was split in 2021.")
        result.append({**base, "value": _number(value) if value is not None else None,
                       "status": "observed" if value is not None else "missing", "notes": method,
                       "derived": {"relation": "combined" if value is not None else "not_combined",
                                   "method": method, "parts": part_names}})
    return result
