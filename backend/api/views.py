from django.http import JsonResponse
from django.views.decorators.http import require_GET

from .services import get_health


@require_GET
def health(request):
    return JsonResponse(get_health())
