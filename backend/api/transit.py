"""Transit commute times over the TTC GTFS schedule.

`build_index` turns a GTFS zip into a compact index for one representative weekday
(a Tuesday, Wednesday or Thursday with the most scheduled trips). `commute_times`
answers "what is the latest I can leave each origin and still arrive at the
destination by a given time?" with a single backward Connection Scan over that
day's timetable, so every compared neighbourhood is answered in one pass.

Walking (to the first stop, between nearby stops, and from the last stop) is not
routed on streets: it is straight-line distance times a detour factor at a
steady walking pace. Everything else comes from the published schedule; no
real-time delays, crowding or service changes are modelled.
"""
from __future__ import annotations

import bisect
import csv
import io
import math
import os
import pickle
import threading
import zipfile
from array import array
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_GTFS_PATH = REPO_ROOT / "data" / "raw" / "ttc-merged.zip"
DEFAULT_INDEX_PATH = REPO_ROOT / "data" / "normalized" / "ttc-transit-index.pickle"
INDEX_FORMAT = 1

WALK_METRES_PER_SECOND = 4.8 * 1000 / 3600  # 4.8 km/h
WALK_DETOUR = 1.3  # straight line to street distance
MAX_ACCESS_METRES = 1000  # walk to or from a stop
MAX_TRANSFER_METRES = 250  # walk between stops when transferring
TRANSFER_BUFFER_SECONDS = 60  # time to change vehicles
MAX_JOURNEY_SECONDS = 150 * 60
# Connections kept in the index; arrive-by times must leave a full journey inside it.
WINDOW_START = 4 * 3600
WINDOW_END = 13 * 3600
ARRIVE_BY_MIN = 6 * 3600 + 30 * 60
ARRIVE_BY_MAX = WINDOW_END
ROUTE_TYPES = {0: "streetcar", 1: "subway", 2: "rail", 3: "bus"}
NO_SERVICE = 1  # GTFS pickup_type / drop_off_type: not available


class TransitUnavailable(Exception):
    """The transit index has not been built or cannot be read."""


def gtfs_path() -> Path:
    return Path(os.environ.get("TRANSIT_GTFS_PATH", DEFAULT_GTFS_PATH))


def index_path() -> Path:
    return Path(os.environ.get("TRANSIT_INDEX_PATH", DEFAULT_INDEX_PATH))


def haversine_metres(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(a))


def walk_seconds(metres: float) -> int:
    return round(metres * WALK_DETOUR / WALK_METRES_PER_SECOND)


def parse_time(value: str) -> int | None:
    """GTFS HH:MM:SS (hours may exceed 23) as seconds after midnight."""
    try:
        h, m, s = value.strip().split(":")
        return int(h) * 3600 + int(m) * 60 + int(s)
    except (ValueError, AttributeError):
        return None


def _rows(archive: zipfile.ZipFile, name: str):
    try:
        handle = archive.open(name)
    except KeyError:
        return
    with io.TextIOWrapper(handle, encoding="utf-8-sig", newline="") as text:
        yield from csv.DictReader(text)


def _active_services(archive: zipfile.ZipFile, day: date) -> set[str]:
    stamp = day.strftime("%Y%m%d")
    weekday = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][day.weekday()]
    active = {r["service_id"] for r in _rows(archive, "calendar.txt")
              if r[weekday] == "1" and r["start_date"] <= stamp <= r["end_date"]}
    for r in _rows(archive, "calendar_dates.txt"):
        if r["date"] == stamp:
            (active.add if r["exception_type"] == "1" else active.discard)(r["service_id"])
    return active


def _feed_range(archive: zipfile.ZipFile) -> tuple[date, date, dict]:
    info = next(_rows(archive, "feed_info.txt"), None) or {}
    starts, ends = [], []
    for r in _rows(archive, "calendar.txt"):
        starts.append(r["start_date"]); ends.append(r["end_date"])
    start = info.get("feed_start_date") or min(starts)
    end = info.get("feed_end_date") or max(ends)
    parse = lambda s: datetime.strptime(s, "%Y%m%d").date()  # noqa: E731
    return parse(start), parse(end), info


def choose_service_date(archive: zipfile.ZipFile, trips_per_service: dict[str, int]) -> date:
    """The Tuesday–Thursday in the feed with the most scheduled trips (earliest on ties)."""
    start, end, _ = _feed_range(archive)
    best, best_count = None, -1
    day = start
    while day <= end:
        if day.weekday() in (1, 2, 3):
            count = sum(trips_per_service.get(s, 0) for s in _active_services(archive, day))
            if count > best_count:
                best, best_count = day, count
        day += timedelta(days=1)
    if best is None or best_count <= 0:
        raise ValueError("The GTFS feed has no weekday service.")
    return best


def build_index(gtfs: Path, output: Path, service_date: date | None = None) -> dict:
    """Read a GTFS zip and write the weekday index. Returns a short summary."""
    with zipfile.ZipFile(gtfs) as archive:
        _, _, info = _feed_range(archive)
        routes = {r["route_id"]: (r.get("route_short_name") or r.get("route_long_name") or r["route_id"],
                                  r.get("route_long_name") or "", int(r.get("route_type") or 3))
                  for r in _rows(archive, "routes.txt")}
        trip_rows = list(_rows(archive, "trips.txt"))
        per_service: dict[str, int] = defaultdict(int)
        for r in trip_rows:
            per_service[r["service_id"]] += 1
        day = service_date or choose_service_date(archive, per_service)
        active = _active_services(archive, day)

        route_ids = sorted(routes)
        route_index = {rid: i for i, rid in enumerate(route_ids)}
        trip_index: dict[str, int] = {}
        trip_route = array("i")
        for r in trip_rows:
            if r["service_id"] in active and r["route_id"] in route_index:
                trip_index[r["trip_id"]] = len(trip_route)
                trip_route.append(route_index[r["route_id"]])

        stop_index: dict[str, int] = {}
        stop_lat, stop_lng, stop_names = array("d"), array("d"), []
        for r in _rows(archive, "stops.txt"):
            if (r.get("location_type") or "0") not in ("0", ""):
                continue
            try:
                lat, lng = float(r["stop_lat"]), float(r["stop_lon"])
            except (KeyError, ValueError):
                continue
            stop_index[r["stop_id"]] = len(stop_names)
            stop_lat.append(lat); stop_lng.append(lng); stop_names.append(r.get("stop_name") or r["stop_id"])

        # trip -> [(sequence, arrival, departure, stop, pickup_ok, dropoff_ok)]
        by_trip: dict[int, list[tuple[int, int, int, int, bool, bool]]] = defaultdict(list)
        for r in _rows(archive, "stop_times.txt"):
            trip = trip_index.get(r["trip_id"])
            stop = stop_index.get(r["stop_id"])
            if trip is None or stop is None:
                continue
            arrival = parse_time(r["arrival_time"])
            departure = parse_time(r["departure_time"])
            if arrival is None and departure is None:
                continue  # untimed stop; GTFS allows interpolation but TTC times every stop
            arrival = departure if arrival is None else arrival
            departure = arrival if departure is None else departure
            if departure < WINDOW_START - 3 * 3600 or arrival > WINDOW_END + 3 * 3600:
                continue
            by_trip[trip].append((int(r["stop_sequence"]), arrival, departure, stop,
                                  (r.get("pickup_type") or "0") != str(NO_SERVICE),
                                  (r.get("drop_off_type") or "0") != str(NO_SERVICE)))

    connections = []
    for trip, stops in by_trip.items():
        stops.sort()
        for (seq, _, dep, a, pick, _), (_, arr, _, b, _, drop) in zip(stops, stops[1:]):
            if arr < dep or dep < WINDOW_START or dep > WINDOW_END:
                continue
            connections.append((dep, arr, seq, a, b, trip, (1 if pick else 0) | (2 if drop else 0)))
    del by_trip
    # Backward scan order: latest departure first; within a trip, later stops first.
    connections.sort(reverse=True)
    columns = {name: array("i") for name in ("dep", "arr", "from_stop", "to_stop", "trip", "flags")}
    for dep, arr, _, a, b, trip, flags in connections:
        columns["dep"].append(dep); columns["arr"].append(arr)
        columns["from_stop"].append(a); columns["to_stop"].append(b)
        columns["trip"].append(trip); columns["flags"].append(flags)

    index = {
        "format": INDEX_FORMAT,
        "service_date": day.isoformat(),
        "feed": {"publisher": info.get("feed_publisher_name", "TTC"), "url": info.get("feed_publisher_url", ""),
                 "version": info.get("feed_version", ""), "start": info.get("feed_start_date", ""),
                 "end": info.get("feed_end_date", "")},
        "built_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "stop_lat": stop_lat, "stop_lng": stop_lng, "stop_names": stop_names,
        "routes": [routes[r] for r in route_ids], "trip_route": trip_route,
        "transfers": _transfers(stop_lat, stop_lng),
        **columns,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    with open(temporary, "wb") as handle:
        pickle.dump(index, handle, protocol=pickle.HIGHEST_PROTOCOL)
    os.replace(temporary, output)
    return {"service_date": day.isoformat(), "stops": len(stop_names), "trips": len(trip_route),
            "connections": len(columns["dep"]), "feed_version": index["feed"]["version"]}


class _Grid:
    """Buckets stops into ~0.01° cells for radius lookups."""
    CELL = 0.01

    def __init__(self, lats, lngs):
        self.lats, self.lngs = lats, lngs
        self.cells: dict[tuple[int, int], list[int]] = defaultdict(list)
        for i, (lat, lng) in enumerate(zip(lats, lngs)):
            self.cells[(int(lat // self.CELL), int(lng // self.CELL))].append(i)

    def within(self, lat: float, lng: float, metres: float):
        """(stop, metres) pairs within the radius."""
        span_lat = metres / 111_000 / self.CELL
        span_lng = metres / (111_000 * max(math.cos(math.radians(lat)), 0.1)) / self.CELL
        cy, cx = int(lat // self.CELL), int(lng // self.CELL)
        for y in range(cy - math.ceil(span_lat), cy + math.ceil(span_lat) + 1):
            for x in range(cx - math.ceil(span_lng), cx + math.ceil(span_lng) + 1):
                for i in self.cells.get((y, x), ()):
                    d = haversine_metres(lat, lng, self.lats[i], self.lngs[i])
                    if d <= metres:
                        yield i, d


def _transfers(lats, lngs) -> list[list[tuple[int, int]]]:
    grid = _Grid(lats, lngs)
    return [[(j, walk_seconds(d)) for j, d in grid.within(lats[i], lngs[i], MAX_TRANSFER_METRES) if j != i]
            for i in range(len(lats))]


_lock = threading.Lock()
_cache: dict = {}


def load_index(path: Path | None = None) -> dict:
    path = path or index_path()
    try:
        stamp = path.stat().st_mtime
    except OSError as exc:
        raise TransitUnavailable(
            "The transit schedule index has not been built. Run "
            "`python manage.py build_transit_index` in backend/.") from exc
    with _lock:
        if _cache.get("key") != (str(path), stamp):
            with open(path, "rb") as handle:  # a local file this module wrote, not user input
                index = pickle.load(handle)
            if index.get("format") != INDEX_FORMAT:
                raise TransitUnavailable("The transit index is out of date. Rerun `python manage.py build_transit_index`.")
            index["grid"] = _Grid(index["stop_lat"], index["stop_lng"])
            index["neg_dep"] = array("i", (-d for d in index["dep"]))  # ascending, for bisect
            _cache.clear()
            _cache.update(key=(str(path), stamp), index=index)
        return _cache["index"]


def _clock(seconds: int) -> str:
    seconds %= 24 * 3600
    return f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}"


def commute_times(index: dict, destination: tuple[float, float], origins: list[tuple[str, float, float]],
                  arrive_by: int = 9 * 3600) -> list[dict]:
    """Latest departure from each origin that still arrives by `arrive_by` (seconds after midnight)."""
    lats, lngs, grid = index["stop_lat"], index["stop_lng"], index["grid"]
    dep, arr, from_stop, to_stop = index["dep"], index["arr"], index["from_stop"], index["to_stop"]
    trips, flags, transfers = index["trip"], index["flags"], index["transfers"]
    none = -10 ** 9
    latest = [none] * len(lats)  # latest time on foot at a stop that still makes the destination
    final = [none] * len(lats)  # same, walking straight to the destination
    # How each stop's `latest` was reached: ("walk", None) | ("ride", connection) | ("transfer", stop)
    parent: list[tuple[str, int | None] | None] = [None] * len(lats)
    for stop, metres in grid.within(destination[0], destination[1], MAX_ACCESS_METRES):
        final[stop] = latest[stop] = arrive_by - walk_seconds(metres)
        parent[stop] = ("walk", None)

    trip_ok = bytearray(len(index["trip_route"]))
    trip_exit: dict[int, int] = {}  # trip -> connection where the rider alights
    earliest = arrive_by - MAX_JOURNEY_SECONDS
    for c in range(bisect.bisect_left(index["neg_dep"], -arrive_by), len(dep)):
        d = dep[c]
        if d < earliest:
            break
        t, b = trips[c], to_stop[c]
        if not trip_ok[t]:
            a_t = arr[c]
            if flags[c] & 2 and (a_t <= final[b] or a_t + TRANSFER_BUFFER_SECONDS <= latest[b]):
                trip_ok[t] = 1
                trip_exit[t] = c
            else:
                continue
        a = from_stop[c]
        if flags[c] & 1 and d > latest[a]:
            latest[a] = d
            parent[a] = ("ride", c)
            for other, w in transfers[a]:
                if d - w > latest[other]:
                    latest[other] = d - w
                    parent[other] = ("transfer", a)

    results = []
    for origin_id, lat, lng in origins:
        direct = arrive_by - walk_seconds(haversine_metres(lat, lng, *destination))
        best, best_stop, access = direct, None, 0
        for stop, metres in grid.within(lat, lng, MAX_ACCESS_METRES):
            if latest[stop] == none:
                continue
            w = walk_seconds(metres)
            if latest[stop] - w > best:
                best, best_stop, access = latest[stop] - w, stop, w
        legs = _legs(index, best_stop, parent, trip_exit, final) if best_stop is not None else []
        if best_stop is not None and not legs:
            # Only walking between stops near both ends: count it as a walk.
            best, best_stop = direct, None
        if arrive_by - best > MAX_JOURNEY_SECONDS:
            results.append({"id": origin_id, "minutes": None, "reason": "No scheduled TTC trip within 2.5 hours."})
            continue
        results.append({"id": origin_id, "minutes": math.ceil((arrive_by - best) / 60), "leave_by": _clock(best),
                        "walk_only": best_stop is None, "first_walk_minutes": round(access / 60), "legs": legs})
    return results


def _legs(index: dict, stop: int, parent, trip_exit, final) -> list[dict]:
    """Rides on the chosen journey, origin to destination."""
    legs, seen = [], set()
    routes, trip_route, names = index["routes"], index["trip_route"], index["stop_names"]
    while stop is not None and stop not in seen and parent[stop] is not None:
        seen.add(stop)
        kind, ref = parent[stop]
        if kind == "walk":
            break
        if kind == "transfer":
            stop = ref
            continue
        trip = index["trip"][ref]
        exit_c = trip_exit[trip]
        name, long_name, route_type = routes[trip_route[trip]]
        legs.append({"route": name, "name": long_name, "mode": ROUTE_TYPES.get(route_type, "transit"),
                     "board": names[stop], "alight": names[index["to_stop"][exit_c]],
                     "depart": _clock(index["dep"][ref]), "arrive": _clock(index["arr"][exit_c])})
        stop = index["to_stop"][exit_c]
        if index["arr"][exit_c] <= final[stop]:
            break  # walk from here to the destination
    return legs


def parse_arrive_by(value) -> int:
    if value in (None, ""):
        return 9 * 3600
    seconds = parse_time(f"{value}:00") if isinstance(value, str) and value.count(":") == 1 else None
    if seconds is None or not ARRIVE_BY_MIN <= seconds <= ARRIVE_BY_MAX:
        raise ValueError(f"arrive_by must be HH:MM between {_clock(ARRIVE_BY_MIN)} and {_clock(ARRIVE_BY_MAX)}.")
    return seconds
