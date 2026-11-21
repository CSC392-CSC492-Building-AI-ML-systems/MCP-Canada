# A tiny synthetic GTFS feed; these stops, routes and times are not real TTC data.
import io
import json
import os
import tempfile
import zipfile
from datetime import date
from pathlib import Path
from unittest import mock

from django.core.management import call_command
from django.test import SimpleTestCase
from django.urls import reverse

from . import transit

FEED = {
    "feed_info.txt": "feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version\n"
                     "Test,https://example.org,en,20260105,20260111,T1\n",
    "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
                    "wk,1,1,1,1,1,0,0,20260105,20260111\nsat,0,0,0,0,0,1,0,20260105,20260111\n",
    "calendar_dates.txt": "service_id,date,exception_type\nwk,20260106,2\n",
    "routes.txt": "route_id,route_short_name,route_long_name,route_type\n"
                  "east,1,East Line,1\nnorth,52,North Bus,3\n",
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon,location_type\n"
                 "A,West,43.7000,-79.4200,0\nB,Middle,43.7000,-79.4000,0\nB2,Middle bus bay,43.7010,-79.4000,0\n"
                 "C,East,43.7000,-79.3800,0\nN,North,43.7300,-79.4000,0\nS,Station,43.7000,-79.4000,1\n",
    "trips.txt": "route_id,service_id,trip_id\neast,wk,e1\neast,wk,e2\neast,sat,e3\nnorth,wk,n1\n",
    "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n"
                      "e1,08:00:00,08:00:00,A,1,0,0\ne1,08:05:00,08:05:00,B,2,0,0\ne1,08:10:00,08:10:00,C,3,0,0\n"
                      "e2,08:30:00,08:30:00,A,1,0,0\ne2,08:35:00,08:35:00,B,2,0,0\ne2,08:40:00,08:40:00,C,3,0,0\n"
                      "e3,08:45:00,08:45:00,A,1,0,0\ne3,08:50:00,08:50:00,C,2,0,0\n"
                      "n1,08:00:00,08:00:00,N,1,0,1\nn1,08:15:00,08:15:00,B2,2,1,0\n",
}
WEST, EAST, NORTH = (43.7000, -79.4205), (43.7000, -79.3795), (43.7305, -79.4000)


class TransitIndexTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.tmp = tempfile.TemporaryDirectory()
        cls.gtfs = Path(cls.tmp.name) / "feed.zip"
        with zipfile.ZipFile(cls.gtfs, "w") as archive:
            for name, text in FEED.items():
                archive.writestr(name, text)
        cls.index_file = Path(cls.tmp.name) / "index.pickle"
        cls.summary = transit.build_index(cls.gtfs, cls.index_file)
        cls.index = transit.load_index(cls.index_file)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()
        super().tearDownClass()

    def test_chooses_a_midweek_day_with_service(self):
        # Tuesday 6 January is removed by calendar_dates, so Wednesday is the first busiest day.
        self.assertEqual(self.summary["service_date"], "2026-01-07")
        self.assertEqual(self.summary["trips"], 3)  # the Saturday trip is excluded
        self.assertEqual(self.summary["stops"], 5)  # the parent station is not a boarding stop

    def test_latest_departure_that_arrives_in_time(self):
        [late] = transit.commute_times(self.index, EAST, [("w", *WEST)], arrive_by=9 * 3600)
        self.assertEqual(late["legs"][0]["depart"], "08:30")
        self.assertFalse(late["walk_only"])
        self.assertEqual(late["leave_by"][:4], "08:2")  # a short walk before 08:30
        self.assertEqual(late["minutes"], 31)  # 30 minutes on board and waiting, plus a 40 m walk
        [early] = transit.commute_times(self.index, EAST, [("w", *WEST)], arrive_by=8 * 3600 + 20 * 60)
        self.assertEqual(early["legs"][0]["depart"], "08:00")
        self.assertGreater(early["minutes"], 20)

    def test_transfers_between_nearby_stops_and_respects_no_pickup(self):
        [result] = transit.commute_times(self.index, EAST, [("n", *NORTH)], arrive_by=9 * 3600)
        self.assertEqual([leg["route"] for leg in result["legs"]], ["52", "1"])
        self.assertEqual(result["legs"][1]["board"], "Middle")  # walked from the bus bay
        self.assertEqual(result["legs"][1]["depart"], "08:35")
        # Nobody can board the bus at the bay, so it gives no way back north.
        [back] = transit.commute_times(self.index, NORTH, [("b", 43.7010, -79.4000)], arrive_by=9 * 3600)
        self.assertTrue(back["walk_only"])

    def test_walks_when_destination_is_close(self):
        [result] = transit.commute_times(self.index, EAST, [("near", 43.7003, -79.3800)])
        self.assertTrue(result["walk_only"])
        self.assertEqual(result["legs"], [])
        self.assertLessEqual(result["minutes"], 2)

    def test_parse_arrive_by(self):
        self.assertEqual(transit.parse_arrive_by(None), 9 * 3600)
        self.assertEqual(transit.parse_arrive_by("08:15"), 8 * 3600 + 15 * 60)
        for bad in ("8", "05:00", "23:00", 900, "aa:bb"):
            with self.assertRaises(ValueError):
                transit.parse_arrive_by(bad)

    def test_endpoint(self):
        url = reverse("transit-commute")
        post = lambda body: self.client.post(url, json.dumps(body), content_type="application/json")  # noqa: E731
        body = {"destination": {"lat": EAST[0], "lng": EAST[1]}, "origins": [{"id": "w", "lat": WEST[0], "lng": WEST[1]}]}
        with mock.patch.dict(os.environ, {"TRANSIT_INDEX_PATH": str(self.index_file)}):
            response = post(body)
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["service_date"], "2026-01-07")
            self.assertEqual(data["results"][0]["legs"][0]["route"], "1")
            self.assertEqual(post({**body, "destination": {"lat": 45.0, "lng": -75.0}}).status_code, 400)
            self.assertEqual(post({**body, "origins": []}).status_code, 400)
            self.assertEqual(post({**body, "origins": [{"lat": 43.7, "lng": -79.4}]}).status_code, 400)
            self.assertEqual(post({**body, "arrive_by": "03:00"}).status_code, 400)
            self.assertEqual(self.client.get(url).status_code, 405)
        with mock.patch.dict(os.environ, {"TRANSIT_INDEX_PATH": str(Path(self.tmp.name) / "missing.pickle")}):
            response = post(body)
            self.assertEqual(response.status_code, 503)
            self.assertIn("build_transit_index", response.json()["error"])

    def test_command(self):
        output = Path(self.tmp.name) / "command.pickle"
        call_command("build_transit_index", gtfs=self.gtfs, output=output, date=date(2026, 1, 8), stdout=io.StringIO())
        self.assertEqual(transit.load_index(output)["service_date"], "2026-01-08")
