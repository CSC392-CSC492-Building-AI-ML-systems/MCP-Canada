"""Source-native geography and measurements. No inferred neighbourhood joins."""
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

class SourceRelease(models.Model):
    id = models.SlugField(primary_key=True)
    publisher = models.CharField(max_length=200)
    title = models.CharField(max_length=300)
    url = models.URLField(max_length=1000)
    licence = models.CharField(max_length=300)
    retrieved_at = models.DateTimeField()
    sha256 = models.CharField(max_length=64)
    coverage = models.TextField()
    notes = models.TextField(blank=True)

class GeographySet(models.Model):
    id = models.SlugField(primary_key=True)
    kind = models.CharField(max_length=30, choices=[(x,x) for x in
        ["neighbourhood", "municipality", "cma", "cmhc_zone", "province", "country"]])
    version = models.CharField(max_length=100)
    expected_count = models.PositiveIntegerField(null=True, blank=True)
    source = models.ForeignKey(SourceRelease, on_delete=models.PROTECT)

class Geography(models.Model):
    id = models.SlugField(primary_key=True)
    geography_set = models.ForeignKey(GeographySet, on_delete=models.PROTECT)
    code = models.CharField(max_length=100)
    name = models.CharField(max_length=200)
    geometry = models.JSONField(null=True, blank=True, help_text="WGS84 GeoJSON geometry")
    class Meta:
        constraints = [models.UniqueConstraint(fields=["geography_set", "code"], name="unique_geo_code")]

class Indicator(models.Model):
    id = models.SlugField(primary_key=True)
    label = models.CharField(max_length=250)
    unit = models.CharField(max_length=100)
    definition = models.TextField()
    universe = models.TextField()
    statistic = models.CharField(max_length=100)
    dimensions = models.JSONField(default=dict, blank=True)
    # Dimensions include tenure, bedroom count, age/sex, CPI basket/base,
    # income tax basis and currency price basis. Each definition gets its own ID.

class Observation(models.Model):
    source = models.ForeignKey(SourceRelease, on_delete=models.PROTECT)
    geography = models.ForeignKey(Geography, on_delete=models.PROTECT)
    indicator = models.ForeignKey(Indicator, on_delete=models.PROTECT)
    census_year = models.PositiveSmallIntegerField(null=True, blank=True)
    reference_year = models.PositiveSmallIntegerField()
    period = models.CharField(max_length=32, help_text="annual, YYYY-MM, or source-defined period")
    value = models.DecimalField(max_digits=24, decimal_places=8, null=True, blank=True)
    status = models.CharField(max_length=24, choices=[(x,x) for x in
        ["observed", "missing", "suppressed", "not_applicable"]])
    source_locator = models.TextField(help_text="Table/sheet/row/column or source variable code")
    notes = models.TextField(blank=True)
    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["source","geography","indicator","reference_year","period"], name="unique_observation"),
            models.CheckConstraint(condition=(Q(status="observed",value__isnull=False) |
                Q(status__in=["missing","suppressed","not_applicable"],value__isnull=True)), name="value_matches_status")]

class Place(models.Model):
    source = models.ForeignKey(SourceRelease, on_delete=models.PROTECT)
    source_record_id = models.CharField(max_length=200)
    category = models.CharField(max_length=100, help_text="amenity category or transit_stop")
    name = models.CharField(max_length=250)
    latitude = models.DecimalField(max_digits=10, decimal_places=7)
    longitude = models.DecimalField(max_digits=11, decimal_places=7)
    valid_on = models.DateField()
    properties = models.JSONField(default=dict, blank=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=["source","source_record_id"], name="unique_place"),
            models.CheckConstraint(condition=Q(latitude__gte=-90,latitude__lte=90,longitude__gte=-180,longitude__lte=180),name="valid_coordinates")]


class SourceTableRow(models.Model):
    """Lossless source table staging; never treated as a comparable indicator."""
    source = models.ForeignKey(SourceRelease, on_delete=models.PROTECT)
    locator = models.CharField(max_length=200)
    label = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    cells = models.JSONField(default=dict, blank=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=["source", "locator"], name="unique_source_row")]
