from django.urls import path
from .views import boundaries, catalog, comparison, health, mcp_canada_cpi, observations, observations_batch, places, teacher_ask

urlpatterns = [
    path("health/", health, name="health"),
    path("catalog/", catalog, name="catalog"),
    path("observations/", observations, name="observations"),
    path("observations/batch/", observations_batch, name="observations-batch"),
    path("places/", places, name="places"),
    path("comparison/", comparison, name="comparison"),
    path("boundaries/", boundaries, name="boundaries"),
    path("mcp-canada/cpi/", mcp_canada_cpi, name="mcp-canada-cpi"),
    path("teacher/ask/", teacher_ask, name="teacher-ask"),
]
