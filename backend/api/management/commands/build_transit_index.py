from datetime import date
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from api.transit import build_index, gtfs_path, index_path


class Command(BaseCommand):
    help = "Build the weekday TTC schedule index used for transit commute times."

    def add_arguments(self, parser):
        parser.add_argument("--gtfs", type=Path, default=None, help=f"GTFS zip (default {gtfs_path()})")
        parser.add_argument("--output", type=Path, default=None, help=f"Index file (default {index_path()})")
        parser.add_argument("--date", type=date.fromisoformat, default=None,
                            help="Service date YYYY-MM-DD (default: the busiest Tuesday–Thursday in the feed)")

    def handle(self, *args, **options):
        source = options["gtfs"] or gtfs_path()
        output = options["output"] or index_path()
        if not source.exists():
            raise CommandError(f"{source} not found. Run backend/scripts/setup_official_data.py to download the TTC feed.")
        self.stdout.write(f"Reading {source} (this can take a minute)...")
        try:
            summary = build_index(source, output, options["date"])
        except (ValueError, KeyError) as exc:
            raise CommandError(f"Could not build the transit index: {exc}") from exc
        self.stdout.write(self.style.SUCCESS(
            f"Wrote {output}: service date {summary['service_date']}, {summary['stops']:,} stops, "
            f"{summary['trips']:,} trips, {summary['connections']:,} connections (feed {summary['feed_version']})."))
