from django.urls import path
from .views import boundaries, catalog, health, observations

urlpatterns = [
    path("health/", health, name="health"),
    path("catalog/", catalog, name="catalog"),
    path("observations/", observations, name="observations"),
    path("boundaries/", boundaries, name="boundaries"),
]
