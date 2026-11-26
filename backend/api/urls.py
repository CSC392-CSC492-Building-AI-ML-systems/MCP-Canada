from django.urls import path
from .views import boundaries, cpi_affordability_trend, cpi_annual, cpi_census_adjust, cpi_convert, cpi_convert_month, cpi_latest, cpi_rates, cpi_real_change, cpi_series, land_use_view, parks_nearby, catalog, comparison, health, mcp_canada_cpi, observations, observations_batch, places, teacher_ask, transit_commute

urlpatterns = [
    path("health/", health, name="health"),
    path("catalog/", catalog, name="catalog"),
    path("observations/", observations, name="observations"),
    path("observations/batch/", observations_batch, name="observations-batch"),
    path("places/", places, name="places"),
    path("parks/nearby/", parks_nearby, name="parks-nearby"),
    path("land-use/", land_use_view, name="land-use"),
    path("comparison/", comparison, name="comparison"),
    path("boundaries/", boundaries, name="boundaries"),
    path("mcp-canada/cpi/", mcp_canada_cpi, name="mcp-canada-cpi"),
    path("cpi/annual/", cpi_annual, name="cpi-annual"),
    path("cpi/convert/", cpi_convert, name="cpi-convert"),
    path("cpi/real-change/", cpi_real_change, name="cpi-real-change"),
    path("cpi/convert-month/", cpi_convert_month, name="cpi-convert-month"),
    path("cpi/latest/", cpi_latest, name="cpi-latest"),
    path("cpi/series/", cpi_series, name="cpi-series"),
    path("cpi/rates/", cpi_rates, name="cpi-rates"),
    path("cpi/census-adjust/", cpi_census_adjust, name="cpi-census-adjust"),
    path("cpi/affordability-trend/", cpi_affordability_trend, name="cpi-affordability-trend"),
    path("teacher/ask/", teacher_ask, name="teacher-ask"),
    path("transit/commute/", transit_commute, name="transit-commute"),
]
