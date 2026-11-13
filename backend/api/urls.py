from django.urls import path
from .views import boundaries, catalog, health, mcp_canada_cpi, observations

urlpatterns = [
    path("health/", health, name="health"),
    path("catalog/", catalog, name="catalog"),
    path("observations/", observations, name="observations"),
    path("boundaries/", boundaries, name="boundaries"),
    path("mcp-canada/cpi/", mcp_canada_cpi, name="mcp-canada-cpi"),
]
