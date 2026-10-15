from django.test import SimpleTestCase
from django.urls import reverse


class HealthTests(SimpleTestCase):
    def test_health_without_database(self):
        response = self.client.get(reverse("health"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "status": "ok", "service": "django", "database": "disabled"
        })

    def test_health_rejects_post(self):
        self.assertEqual(self.client.post(reverse("health")).status_code, 405)
