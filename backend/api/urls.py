from django.urls import path
from .views import boundaries, catalog, comparison, health, observations, observations_batch, places

urlpatterns = [
    path("health/", health, name="health"),
    path("catalog/", catalog, name="catalog"),
    path("observations/", observations, name="observations"),
    path("observations/batch/", observations_batch, name="observations-batch"),
    path("places/", places, name="places"),
    path("comparison/", comparison, name="comparison"),
    path("boundaries/", boundaries, name="boundaries"),
]
