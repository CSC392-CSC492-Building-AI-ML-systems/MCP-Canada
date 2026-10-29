from django.urls import path
from .views import catalog, health, observations

urlpatterns = [
    path("health/", health, name="health"),
    path("catalog/", catalog, name="catalog"),
    path("observations/", observations, name="observations"),
]
