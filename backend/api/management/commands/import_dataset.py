"""Import a normalized, provenance-bearing JSON bundle atomically."""
import json
import math
from pathlib import Path
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction, IntegrityError
from api.models import SourceRelease, GeographySet, Geography, Indicator, Observation, Place, SourceTableRow

MODELS = {"sources": SourceRelease, "geography_sets": GeographySet,
          "geographies": Geography, "indicators": Indicator,
          "observations": Observation, "places": Place, "source_rows": SourceTableRow}

def validate_geometry(g):
    if g is None:
        return
    if not isinstance(g, dict) or g.get("type") not in ("Polygon", "MultiPolygon"):
        raise ValueError("Boundaries must be Polygon/MultiPolygon WGS84 GeoJSON")
    polygons = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    if not polygons:
        raise ValueError("Empty geometry")
    for polygon in polygons:
        if not polygon:
            raise ValueError("Empty polygon")
        for ring in polygon:
            if len(ring) < 4 or ring[0] != ring[-1]:
                raise ValueError("Boundary rings must be closed")
            for point in ring:
                if len(point) != 2 or not all(isinstance(v,(int,float)) and math.isfinite(v) for v in point) or not (-180 <= point[0] <= 180 and -90 <= point[1] <= 90):
                    raise ValueError("Invalid WGS84 coordinate")

class Command(BaseCommand):
    help = "Import normalized JSON; repeat identical bundles safely; reject conflicting records."
    def add_arguments(self, parser):
        parser.add_argument("bundle")
        parser.add_argument("--dry-run", action="store_true")
    def handle(self, *args, **options):
        try:
            data = json.loads(Path(options["bundle"]).read_text())
            if set(data) - set(MODELS):
                raise ValueError("Unknown bundle section")
            with transaction.atomic():
                for section, model in MODELS.items():
                    if model == SourceTableRow:
                        # Stage wide source tables in batches without one query per cell.
                        existing_rows = {(x.source_id, x.locator): x for x in model.objects.all()}
                        source_ids = set(SourceRelease.objects.values_list("pk", flat=True))
                        pending = []
                        for row in data.get(section, []):
                            obj = model(**row)
                            key = (obj.source_id, obj.locator)
                            if obj.source_id not in source_ids:
                                raise ValueError("Unknown source for staged row")
                            obj.full_clean(exclude=["source"], validate_unique=False, validate_constraints=False)
                            old = existing_rows.get(key)
                            if old:
                                if any(getattr(old, f.attname) != getattr(obj, f.attname)
                                       for f in model._meta.concrete_fields if f.attname in row):
                                    raise ValueError(f"Conflicting source row {key}")
                            else:
                                pending.append(obj)
                                existing_rows[key] = obj
                        model.objects.bulk_create(pending, batch_size=200)
                        continue
                    for row in data.get(section, []):
                        if section == "sources":
                            digest = row.get("sha256", "")
                            if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
                                raise ValueError("Source sha256 must identify the original downloaded artifact")
                        if section == "geographies":
                            validate_geometry(row.get("geometry"))
                        obj = model(**row)
                        if model in (Observation, Place, SourceTableRow):
                            keys = (["source_id","geography_id","indicator_id","reference_year","period"]
                                    if model == Observation else ["source_id","source_record_id"])
                            lookup = {k: getattr(obj,k) for k in keys}
                        else:
                            lookup = {"pk": obj.pk}
                        existing = model.objects.filter(**lookup).first()
                        if existing:
                            if any(getattr(existing, field.attname) != field.to_python(getattr(obj, field.attname))
                                   for field in model._meta.concrete_fields
                                   if field.attname in row):
                                raise ValueError(f"Conflicting {section} record: {lookup}; use a new release ID")
                            continue
                        obj.full_clean()
                        obj.save()
                for gs in GeographySet.objects.exclude(expected_count=None):
                    count = Geography.objects.filter(geography_set=gs).count()
                    if count != gs.expected_count:
                        raise ValueError(f"{gs.pk}: expected {gs.expected_count} boundaries, got {count}")
                if options["dry_run"]:
                    transaction.set_rollback(True)
        except (ValueError, TypeError, KeyError, OSError, ValidationError, IntegrityError) as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS("Validated (rolled back)" if options["dry_run"] else "Imported"))
