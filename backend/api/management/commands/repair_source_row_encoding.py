"""Repair staged source rows that an earlier import decoded as cp1252 instead of UTF-8.

Dry run by default. A row is repaired only when every stored field that differs from the
normalized bundle equals exactly what UTF-8-read-as-cp1252 does to the bundle value. Any other
difference, or a source release whose artifact hash differs, aborts the whole run unchanged.
Only SourceTableRow.label, .metadata and .cells are ever written."""
import json
from collections import Counter
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from api.models import SourceRelease, SourceTableRow

FIELDS = ("label", "metadata", "cells")


def cp1252_corrupted(value):
    """The value as it reads after its UTF-8 bytes are decoded as cp1252 (strict).
    Raises UnicodeDecodeError when that corruption could not have produced a stored value."""
    if isinstance(value, str):
        return value.encode("utf-8").decode("cp1252")
    if isinstance(value, list):
        return [cp1252_corrupted(v) for v in value]
    if isinstance(value, dict):
        return {cp1252_corrupted(k): cp1252_corrupted(v) for k, v in value.items()}
    return value


def plan_repairs(bundle):
    """[(row, {field: correct value})] for verified rows, and a list of unexpected differences."""
    expected = {(r["source_id"], r["locator"]): r for r in bundle.get("source_rows", [])}
    hashes = {s["id"]: s.get("sha256") for s in bundle.get("sources", [])}
    problems, repairs = [], []
    for release in SourceRelease.objects.filter(id__in={k[0] for k in expected}):
        if hashes.get(release.id) != release.sha256:
            problems.append(f"{release.id}: stored artifact sha256 differs from the bundle")
    for row in SourceTableRow.objects.filter(source_id__in={k[0] for k in expected}).order_by("id").iterator():
        new = expected.get((row.source_id, row.locator))
        if new is None:
            continue  # Not in this bundle; left untouched.
        changes = {}
        for field in FIELDS:
            stored = getattr(row, field)
            correct = new.get(field, "" if field == "label" else {})
            if stored == correct:
                continue
            try:
                explained = cp1252_corrupted(correct) == stored
            except UnicodeDecodeError:
                explained = False
            if not explained:
                problems.append(f"{row.source_id} {row.locator}: {field} differs in a way cp1252 decoding does not explain")
            changes[field] = correct
        if changes:
            repairs.append((row, changes))
    return repairs, problems


class Command(BaseCommand):
    help = "Dry-run (default) or apply a verified cp1252-to-UTF-8 repair of staged source rows."

    def add_arguments(self, parser):
        parser.add_argument("bundle", help="Normalized UTF-8 bundle, e.g. data/normalized/official.json")
        parser.add_argument("--apply", action="store_true", help="Write the repair; without it nothing is changed")

    def handle(self, *args, **options):
        try:
            bundle = json.loads(Path(options["bundle"]).read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise CommandError(str(exc)) from exc
        with transaction.atomic():
            repairs, problems = plan_repairs(bundle)
            if problems:
                shown = "\n  ".join(problems[:20])
                raise CommandError(f"{len(problems)} unexpected difference(s); nothing changed:\n  {shown}")
            by_source = Counter(row.source_id for row, _ in repairs)
            by_field = Counter(f for _, changes in repairs for f in changes)
            for source_id, count in sorted(by_source.items()):
                self.stdout.write(f"{source_id}: {count} row(s)")
            for row, changes in repairs[:5]:
                field = next(iter(changes))
                self.stdout.write(f"  e.g. {row.source_id} {row.locator} {field}: "
                                  f"{ascii(getattr(row, field))[:70]} -> {ascii(changes[field])[:70]}")
            self.stdout.write(f"Fields: {dict(by_field)}; rows: {len(repairs)}")
            if not options["apply"]:
                self.stdout.write(self.style.SUCCESS("Dry run: verified, nothing written. Re-run with --apply to repair."))
                return
            for row, changes in repairs:
                if SourceTableRow.objects.filter(pk=row.pk).update(**changes) != 1:
                    raise CommandError(f"Row {row.pk} changed during repair; nothing written")
        self.stdout.write(self.style.SUCCESS(f"Repaired {len(repairs)} row(s)."))
