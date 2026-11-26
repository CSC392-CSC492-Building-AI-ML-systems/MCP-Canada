"""Rebuild api/data/toronto_158_to_140.json from the boundary geometries in the database."""
import json

from django.core.management.base import BaseCommand, CommandError

from api.boundary_crosswalk import CROSSWALK_PATH, NEW_SET, OLD_SET, build_links
from api.models import Geography


class Command(BaseCommand):
    help = "Link each 2021 (158) Toronto neighbourhood to the earlier (140) neighbourhood that contains it."

    def handle(self, *args, **options):
        def areas(set_id):
            return list(Geography.objects.filter(geography_set_id=set_id, geometry__isnull=False)
                        .order_by("id").values("id", "code", "name", "geometry"))
        old, new = areas(OLD_SET), areas(NEW_SET)
        if len(old) != 140 or len(new) != 158:
            raise CommandError(f"Expected 140 and 158 boundaries with geometry; found {len(old)} and {len(new)}. "
                               "Run backend/scripts/setup_official_data.py first.")
        try:
            links = build_links(old, new)
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        parts = [link for link in links.values() if link["relation"] == "part"]
        CROSSWALK_PATH.parent.mkdir(parents=True, exist_ok=True)
        CROSSWALK_PATH.write_text(json.dumps({
            "description": "Each City of Toronto 2021 (158) neighbourhood and the earlier (140) neighbourhood "
                           "that wholly contains it. relation 'same' = unchanged boundary; 'part' = one piece "
                           "of a neighbourhood split in 2021.",
            "method": "Built by manage.py build_boundary_crosswalk from the City boundary files: every 2021 "
                      "area was tested on an evenly spaced grid of interior points and required to fall "
                      "at least 95% inside a single earlier area.",
            "links": links,
        }, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        self.stdout.write(f"Wrote {CROSSWALK_PATH}: {len(links) - len(parts)} unchanged, {len(parts)} parts of "
                          f"{len({link['parent'] for link in parts})} split neighbourhoods.")
