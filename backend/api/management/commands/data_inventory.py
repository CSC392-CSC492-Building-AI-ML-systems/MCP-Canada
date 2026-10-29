"""Summarize persisted data and distinguish staging from reviewed measurements."""
import json
from django.core.management.base import BaseCommand
from django.db.models import Count, Min, Max
from api.models import SourceRelease, Geography, Indicator, Observation, Place, SourceTableRow

class Command(BaseCommand):
    help = 'Print source coverage, availability and persisted row counts as JSON'
    def handle(self,*args,**options):
        result = dict(
            sources=SourceRelease.objects.count(),
            geography_counts=list(Geography.objects.values('geography_set_id').annotate(count=Count('pk')).order_by('geography_set_id')),
            indicators=Indicator.objects.count(),
            observations=Observation.objects.count(),
            availability=list(Observation.objects.values('status').annotate(count=Count('pk')).order_by('status')),
            census_years=list(Observation.objects.exclude(census_year=None).values('census_year').annotate(count=Count('pk')).order_by('census_year')),
            place_categories=list(Place.objects.values('category').annotate(count=Count('pk')).order_by('category')),
            staged_source_rows=SourceTableRow.objects.count(),
            source_coverage=list(SourceRelease.objects.values('id','title','coverage','retrieved_at','sha256').order_by('id')),
        )
        self.stdout.write(json.dumps(result,indent=2,default=str))
