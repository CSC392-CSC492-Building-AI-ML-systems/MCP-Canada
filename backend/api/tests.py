from django.test import SimpleTestCase
from django.urls import reverse


class HealthTests(SimpleTestCase):
    def test_health_without_database(self):
        response = self.client.get(reverse("health"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "status": "ok", "service": "django", "database": "configured"
        })

    def test_health_rejects_post(self):
        self.assertEqual(self.client.post(reverse("health")).status_code, 405)


# Synthetic fixtures below test ingestion; they are never production seeds.
import io
import json
import tempfile
from pathlib import Path
from django.test import TestCase
from django.core.management import call_command
from django.core.management.base import CommandError
from .models import Observation, SourceRelease, Place
from .services import comparable_values


class ImportTests(TestCase):
    def bundle(self):
        return {
            'sources': [dict(id='test', publisher='Synthetic fixture', title='Not real data',
                url='https://example.org/test', licence='Test only',
                retrieved_at='2026-01-01T00:00:00Z', sha256='a'*64, coverage='Test')],
            'geography_sets': [dict(id='test-140', kind='neighbourhood', version='test', source_id='test')],
            'geographies': [dict(id='test-a', geography_set_id='test-140', code='1', name='Test area')],
            'indicators': [dict(id='population', label='Test count', unit='persons',
                definition='Synthetic', universe='Test', statistic='count')],
            'observations': [dict(source_id='test', geography_id='test-a', indicator_id='population',
                census_year=2021, reference_year=2020, period='annual', value='0',
                status='observed', source_locator='fixture')],
            'places': [dict(source_id='test', source_record_id='stop1', category='transit_stop',
                name='Test stop', latitude='43', longitude='-79', valid_on='2026-01-01')]}

    def run_import(self, data, **options):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'bundle.json'
            path.write_text(json.dumps(data))
            call_command('import_dataset', str(path), **options)

    def test_idempotent_and_zero_and_years(self):
        self.run_import(self.bundle())
        self.run_import(self.bundle())
        row = Observation.objects.get()
        self.assertEqual(row.value, 0)
        self.assertEqual((row.census_year, row.reference_year), (2021, 2020))
        self.assertEqual(Place.objects.count(), 1)

    def test_non_ascii_utf8_bundle_imports_exactly_and_repeats(self):
        """Regression: the bundle is UTF-8 bytes; decoding it as cp1252 stored 'MÃ©tis'."""
        from .models import SourceTableRow
        data = self.bundle()
        data['places'][0]['name'] = 'École Saint-Étienne'
        data['source_rows'] = [dict(source_id='test', locator='csv/1', label='    Métis',
            cells={'test-a': '©'}, metadata={'row_metadata': ['Québécois\xa0']})]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'bundle.json'
            path.write_bytes(json.dumps(data, ensure_ascii=False).encode('utf-8'))
            call_command('import_dataset', str(path))
            call_command('import_dataset', str(path))  # identical bundle: no conflict
        row = SourceTableRow.objects.get()
        self.assertEqual((row.label, row.cells, row.metadata), ('    Métis', {'test-a': '©'}, {'row_metadata': ['Québécois\xa0']}))
        self.assertEqual(Place.objects.get().name, 'École Saint-Étienne')

    def test_dry_run(self):
        self.run_import(self.bundle(), dry_run=True)
        self.assertFalse(SourceRelease.objects.exists())

    def test_bad_value_rolls_back_all(self):
        data = self.bundle()
        data['observations'][0]['status'] = 'suppressed'
        with self.assertRaises(CommandError):
            self.run_import(data)
        self.assertFalse(SourceRelease.objects.exists())

    def test_count_and_coordinate_validation(self):
        data = self.bundle()
        data['geography_sets'][0]['expected_count'] = 140
        with self.assertRaises(CommandError):
            self.run_import(data)
        data = self.bundle()
        data['places'][0]['latitude'] = '91'
        with self.assertRaises(CommandError):
            self.run_import(data)
        self.assertFalse(SourceRelease.objects.exists())

    def test_conflict_and_mixed_geography_rejected(self):
        self.run_import(self.bundle())
        data = self.bundle()
        data['observations'][0]['value'] = '5'
        with self.assertRaises(CommandError):
            self.run_import(data)
        row = Observation.objects.get()
        other = Observation(geography_id='different', indicator_id=row.indicator_id,
            source_id=row.source_id, status='observed')
        with self.assertRaises(ValueError):
            comparable_values([row, other])
        self.assertEqual(Observation.objects.get().value, 0)


class SourceRowTests(TestCase):
    bundle = ImportTests.bundle
    run_import = ImportTests.run_import
    def test_source_rows_idempotent_and_conflicting(self):
        from .models import SourceTableRow
        data = self.bundle()
        data['source_rows'] = [dict(source_id='test', locator='sheet/1', label='Original label',
            metadata={'comparison_ready': False}, cells={'test-a':'..','test-b':0})]
        self.run_import(data)
        self.run_import(data)
        self.assertEqual(SourceTableRow.objects.count(), 1)
        self.assertEqual(SourceTableRow.objects.get().cells['test-a'], '..')
        data['source_rows'][0]['cells']['test-a'] = 10
        with self.assertRaises(CommandError):self.run_import(data)
        self.assertEqual(SourceTableRow.objects.get().cells['test-a'], '..')

    def test_source_rows_unknown_source_rolls_back(self):
        data=self.bundle()
        data['source_rows']=[dict(source_id='absent',locator='sheet/1',cells={})]
        with self.assertRaises(CommandError):self.run_import(data)
        self.assertFalse(SourceRelease.objects.exists())


class SourceParserTests(SimpleTestCase):
    def test_numeric_tokens_keep_suppression_and_zero(self):
        from scripts.prepare_official_data import number
        self.assertEqual(number('1,234'), ('1234', 'observed'))
        self.assertEqual(number('0'), ('0', 'observed'))
        self.assertEqual(number(''), (None, 'missing'))
        self.assertEqual(number('x'), (None, 'suppressed'))
        self.assertEqual(number('...'), (None, 'not_applicable'))
        with self.assertRaises(ValueError):number('unreviewed token')

    def test_name_key_handles_punctuation_and_boundary_suffix(self):
        from scripts.prepare_official_data import name_key
        self.assertEqual(name_key('Brookhaven-Amesbury (30)'),name_key('Brookhaven-Amesbury'))


class RepairSourceRowEncodingTests(TestCase):
    """Synthetic rows; checks the repair only ever reverses verified cp1252 corruption."""
    def setUp(self):
        from .models import SourceTableRow
        self.Row = SourceTableRow
        self.source = SourceRelease.objects.create(id='test', publisher='Synthetic fixture', title='Not real data',
            url='https://example.org/test', licence='Test only', retrieved_at='2026-01-01T00:00:00Z', sha256='a'*64, coverage='Test')
        self.correct = {'csv/1': dict(label='    Métis', metadata={'row_metadata': ['Éwé']}, cells={'a': '© 2025'}),
                        'csv/2': dict(label='Plain', metadata={}, cells={'a': '1'})}
        bad = lambda v: v.encode('utf-8').decode('cp1252')
        self.Row.objects.create(source=self.source, locator='csv/1', label=bad('    Métis'),
            metadata={'row_metadata': [bad('Éwé')]}, cells={'a': bad('© 2025')})
        self.Row.objects.create(source=self.source, locator='csv/2', label='Plain', metadata={}, cells={'a': '1'})

    def run_repair(self, rows=None, sha='a'*64, **options):
        bundle = {'sources': [{'id': 'test', 'sha256': sha}],
                  'source_rows': [dict(source_id='test', locator=k, **v) for k, v in (rows or self.correct).items()]}
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'bundle.json'
            path.write_bytes(json.dumps(bundle, ensure_ascii=False).encode('utf-8'))
            call_command('repair_source_row_encoding', str(path), stdout=out, **options)
        return out.getvalue()

    def snapshot(self):
        return list(self.Row.objects.order_by('locator').values('locator', 'label', 'metadata', 'cells'))

    def test_dry_run_is_default_and_writes_nothing(self):
        before = self.snapshot()
        self.assertIn('rows: 1', self.run_repair())
        self.assertEqual(self.snapshot(), before)

    def test_apply_restores_exact_utf8_and_leaves_clean_rows(self):
        self.run_repair(apply=True)
        fixed = self.Row.objects.get(locator='csv/1')
        self.assertEqual((fixed.label, fixed.metadata, fixed.cells), ('    Métis', {'row_metadata': ['Éwé']}, {'a': '© 2025'}))
        self.assertEqual(self.Row.objects.get(locator='csv/2').label, 'Plain')
        self.assertIn('rows: 0', self.run_repair())  # second run finds nothing left

    def test_any_unexplained_difference_aborts_everything(self):
        before = self.snapshot()
        rows = {**self.correct, 'csv/2': dict(label='Plain', metadata={}, cells={'a': '2'})}
        with self.assertRaises(CommandError): self.run_repair(rows, apply=True)
        self.assertEqual(self.snapshot(), before)

    def test_fresh_database_has_nothing_to_repair(self):
        self.Row.objects.all().delete(); SourceRelease.objects.all().delete()
        self.assertIn('rows: 0', self.run_repair(apply=True))

    def test_artifact_hash_mismatch_aborts(self):
        before = self.snapshot()
        with self.assertRaises(CommandError): self.run_repair(sha='b'*64, apply=True)
        self.assertEqual(self.snapshot(), before)


class SetupScriptTests(SimpleTestCase):
    """setup_official_data.py file handling; local folders only, no network."""
    def setUp(self):
        import hashlib
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.raw, self.share = base/'raw', base/'share'
        self.raw.mkdir(); self.share.mkdir()
        (self.share/'a.csv').write_bytes(b'pinned bytes')
        self.manifest = {'a.csv': {'url': (base/'nowhere.csv').as_uri(), 'sha256': hashlib.sha256(b'pinned bytes').hexdigest()}}

    def tearDown(self):
        self.tmp.cleanup()

    def test_missing_file_is_copied_only_when_hash_matches(self):
        from scripts.setup_official_data import check_raw_files
        check_raw_files(self.raw, self.manifest, from_dir=str(self.share))
        self.assertEqual((self.raw/'a.csv').read_bytes(), b'pinned bytes')
        check_raw_files(self.raw, self.manifest, from_dir=str(self.share))  # repeat run: nothing to do

    def test_changed_bytes_are_rejected_and_leave_nothing_behind(self):
        from scripts.setup_official_data import SetupError, check_raw_files
        (self.share/'a.csv').write_bytes(b'upstream changed')
        with self.assertRaises(SetupError):
            check_raw_files(self.raw, self.manifest, from_dir=str(self.share))
        self.assertEqual(list(self.raw.iterdir()), [])

    def test_existing_wrong_file_is_never_overwritten(self):
        from scripts.setup_official_data import SetupError, check_raw_files
        (self.raw/'a.csv').write_bytes(b'local edit')
        with self.assertRaises(SetupError):
            check_raw_files(self.raw, self.manifest, from_dir=str(self.share))
        self.assertEqual((self.raw/'a.csv').read_bytes(), b'local edit')

    def test_offline_reports_missing_files(self):
        from scripts.setup_official_data import SetupError, check_raw_files
        with self.assertRaises(SetupError):
            check_raw_files(self.raw, self.manifest, offline=True)

    def test_download_retries_only_certificate_failures_with_the_next_trust_store(self):
        import io, ssl, urllib.error
        from unittest import mock
        from scripts.setup_official_data import download
        part = self.raw/'x.part'
        cert = urllib.error.URLError(ssl.SSLCertVerificationError('unable to get issuer certificate'))
        with mock.patch('scripts.setup_official_data.tls_contexts', return_value=['system', 'certifi']), \
             mock.patch('urllib.request.urlopen', side_effect=[cert, io.BytesIO(b'ok')]) as urlopen:
            download('https://example.test/f', part, 5)
        self.assertEqual(part.read_bytes(), b'ok')
        self.assertEqual([c.kwargs['context'] for c in urlopen.call_args_list], ['system', 'certifi'])
        with mock.patch('scripts.setup_official_data.tls_contexts', return_value=['system', 'certifi']), \
             mock.patch('urllib.request.urlopen', side_effect=[urllib.error.URLError('timed out')]) as urlopen:
            with self.assertRaises(urllib.error.URLError):
                download('https://example.test/f', part, 5)
        self.assertEqual(urlopen.call_count, 1)

    def test_repair_needs_typed_confirmation(self):
        from unittest import mock
        from scripts.setup_official_data import SetupError, confirm_repair
        with mock.patch('sys.stdin') as stdin:
            stdin.isatty.return_value = False
            with self.assertRaises(SetupError): confirm_repair(3)
            stdin.isatty.return_value = True
            for reply in [EOFError(), 'yes', 'repair']:
                with mock.patch('builtins.input', side_effect=[reply]), self.assertRaises(SetupError):
                    confirm_repair(3)
            with mock.patch('builtins.input', return_value='REPAIR'):
                confirm_repair(3)  # confirmed: returns without error

    def test_backups_never_overwrite_each_other(self):
        from scripts.setup_official_data import backup
        db = self.raw/'db.sqlite3'
        db.write_bytes(b'v1')
        first = backup(db)
        db.write_bytes(b'v2')
        second = backup(db)
        self.assertNotEqual(first, second)
        self.assertEqual((first.read_bytes(), second.read_bytes()), (b'v1', b'v2'))


class GreenSpaceMeasureTests(SimpleTestCase):
    """Synthetic squares in degrees near Toronto; not real data."""
    @staticmethod
    def square(x, y, size):
        return {'type': 'Polygon', 'coordinates': [[[x, y], [x+size, y], [x+size, y+size], [x, y+size], [x, y]]]}

    def feature(self, area_id, cls, geometry):
        return {'properties': {'AREA_ID': area_id, 'AREA_CLASS': cls}, 'geometry': geometry}

    def test_counts_parks_once_and_measures_share_without_double_counting(self):
        from scripts.prepare_official_data import green_space_measures
        hood = self.square(-79.40, 43.65, 0.02)                         # ~1.6 km x 2.2 km
        features = [
            self.feature(1, 'Park', self.square(-79.40, 43.65, 0.01)),  # inside: quarter of the area
            self.feature(1, 'Park', self.square(-79.39, 43.66, 0.001)), # same AREA_ID: still one park
            self.feature(2, 'OTHER_TRCA', self.square(-79.40, 43.65, 0.01)),  # overlaps park 1: share not doubled
            self.feature(3, 'Park', self.square(-79.375, 43.655, 0.001)),     # ~0.4 km east of the edge
            self.feature(4, 'Park', self.square(-79.30, 43.655, 0.001)),      # ~8 km away
            self.feature(5, 'Golf Course', self.square(-79.39, 43.65, 0.01)), # excluded from the share
        ]
        parks, share = green_space_measures(features, {'hood': hood})['hood']
        self.assertEqual(parks, 2)
        self.assertAlmostEqual(share, 25 + 0.25, places=1)

    def test_places_within_1km_counts_inside_and_near_each_boundary(self):
        from scripts.prepare_official_data import places_within_km
        boundaries = {'a': self.square(-79.40, 43.65, 0.01), 'b': self.square(-79.30, 43.65, 0.01)}
        points = [(-79.395, 43.655),   # inside a
                  (-79.385, 43.655),   # ~0.4 km east of a
                  (-79.370, 43.655),   # ~1.6 km east of a: not counted
                  (-79.295, 43.655)]   # inside b only
        self.assertEqual(places_within_km(points, boundaries), {'a': 2, 'b': 1})
        self.assertEqual(places_within_km([], boundaries), {'a': 0, 'b': 0})

    def test_area_within_1km_grows_with_the_boundary(self):
        from scripts.prepare_official_data import area_within_km
        small, large = area_within_km({'s': self.square(-79.40, 43.65, 0.01), 'l': self.square(-79.40, 43.65, 0.05)}).values()
        # ~0.80 x 1.11 km square + 1 km band ≈ 0.89 + 2*(0.80+1.11) + π ≈ 8.0 km²
        self.assertAlmostEqual(small, 0.80 * 1.106 + 2 * (0.805 + 1.106) + 3.1416, delta=0.05)
        self.assertGreater(large, small)

    def test_unreviewed_class_or_missing_geometry_stops(self):
        from scripts.prepare_official_data import green_space_measures
        hood = {'hood': self.square(-79.40, 43.65, 0.02)}
        with self.assertRaises(ValueError):
            green_space_measures([self.feature(1, 'Skate Park', self.square(-79.40, 43.65, 0.01))], hood)
        with self.assertRaises(ValueError):
            green_space_measures([self.feature(1, 'Park', None)], hood)


class CrimeParserTests(SimpleTestCase):
    """Synthetic two-neighbourhood rows in the TPS column layout; not real data."""
    def rows(self):
        from scripts.prepare_official_data import CRIME_OFFENCES
        def row(code, name):
            r = {'OBJECTID_1': code, 'NEIGHBOURHOOD_NAME': name, 'HOOD_158': code, 'Shape__Area': '1', 'Shape__Length': '1'}
            for key in CRIME_OFFENCES:
                r.update({f'{key}_2024': '3', f'{key}_RATE_2024': '30.5'})
            return {**r, 'POPULATION_2024': '9000'}
        return [row('1', 'Alpha'), row('2', 'Beta-Gamma')]

    def test_cells_cover_every_series_and_neighbourhood(self):
        from scripts.prepare_official_data import CRIME_OFFENCES, crime_cells
        cells = crime_cells(self.rows(), {'1': 'Alpha', '2': 'Beta-Gamma (2)'})
        self.assertEqual(len(cells), 2 * (2 * len(CRIME_OFFENCES) + 1))
        self.assertIn(('2', 'ASSAULT_RATE', 2024, '30.5', 'ASSAULT_RATE_2024'), cells)
        self.assertIn(('1', 'POPULATION', 2024, '9000', 'POPULATION_2024'), cells)

    def test_rejects_unknown_column_missing_place_and_renamed_place(self):
        from scripts.prepare_official_data import crime_cells
        names = {'1': 'Alpha', '2': 'Beta-Gamma'}
        extra = self.rows()
        for r in extra: r['ARSON_2024'] = '1'
        for rows, places in [(extra, names), (self.rows(), {**names, '3': 'Delta'}), (self.rows(), {**names, '2': 'Other'})]:
            with self.assertRaises(ValueError): crime_cells(rows, places)

    def test_rejects_duplicate_neighbourhood_and_missing_series(self):
        from scripts.prepare_official_data import crime_cells
        rows = self.rows(); rows[1]['HOOD_158'] = '1'
        with self.assertRaises(ValueError): crime_cells(rows, {'1': 'Alpha'})
        rows = self.rows()
        for r in rows: del r['POPULATION_2024']
        with self.assertRaises(ValueError): crime_cells(rows, {'1': 'Alpha', '2': 'Beta-Gamma'})


class BoundaryTests(TestCase):
    def setUp(self):
        from .models import Geography, GeographySet
        source = SourceRelease.objects.create(id='test', publisher='Synthetic fixture', title='Not real data',
            url='https://example.org/test', licence='Test only', retrieved_at='2026-01-01T00:00:00Z',
            sha256='a'*64, coverage='Test')
        square = {'type': 'Polygon', 'coordinates': [[[-79.4, 43.6], [-79.3, 43.6], [-79.3, 43.7], [-79.4, 43.6]]]}
        for set_id in ['test-140', 'test-158']:
            GeographySet.objects.create(id=set_id, kind='neighbourhood', version='test', source=source)
            Geography.objects.create(id=f'{set_id}-1', geography_set_id=set_id, code='1', name='Test area', geometry=square)
        Geography.objects.create(id='test-140-2', geography_set_id='test-140', code='2', name='No shape')

    def test_returns_only_requested_set_with_geometry(self):
        data = self.client.get('/api/boundaries/', {'geography_set_id': 'test-140'}).json()
        self.assertEqual(data['type'], 'FeatureCollection')
        self.assertEqual([f['properties']['geography_id'] for f in data['features']], ['test-140-1'])

    def test_requires_set(self):
        self.assertEqual(self.client.get('/api/boundaries/').status_code, 400)


class ComparisonDataTests(TestCase):
    def setUp(self):
        from .models import Geography, GeographySet, Indicator
        source = SourceRelease.objects.create(id='test', publisher='Synthetic fixture', title='Not real data',
            url='https://example.org/test', licence='Test only', retrieved_at='2026-01-01T00:00:00Z',
            sha256='a'*64, coverage='Test')
        Indicator.objects.create(id='population', label='Test count', unit='persons',
            definition='Synthetic', universe='Test', statistic='count')
        for set_id in ['test-140', 'test-158']:
            GeographySet.objects.create(id=set_id, kind='neighbourhood', version='test', source=source)
            Geography.objects.create(id=f'{set_id}-1', geography_set_id=set_id, code='1', name='Test area')
            Observation.objects.create(source=source, geography_id=f'{set_id}-1', indicator_id='population',
                census_year=2021, reference_year=2021, period='annual', value=0, status='observed',
                source_locator='fixture')
        Place.objects.create(source=source, source_record_id='lib1', category='library', name='Test branch',
            latitude='43.6', longitude='-79.4', valid_on='2026-01-01')
        Place.objects.create(source=source, source_record_id='stop1', category='transit_stop', name='Stop',
            latitude='43.6', longitude='-79.4', valid_on='2026-01-01')

    def test_batch_returns_only_requested_set(self):
        data = self.client.get('/api/observations/batch/', {
            'geography_set_id': 'test-158', 'indicator_id': 'population', 'source_id': 'test'}).json()
        self.assertEqual([(o['geography_id'], o['name'], float(o['value'])) for o in data['observations']],
            [('test-158-1', 'Test area', 0.0)])

    def test_batch_requires_all_filters(self):
        self.assertEqual(self.client.get('/api/observations/batch/', {'indicator_id': 'population'}).status_code, 400)

    def test_batch_optional_year_filter(self):
        query = {'geography_set_id': 'test-158', 'indicator_id': 'population', 'source_id': 'test'}
        self.assertEqual(len(self.client.get('/api/observations/batch/', {**query, 'reference_year': '2021'}).json()['observations']), 1)
        self.assertEqual(self.client.get('/api/observations/batch/', {**query, 'reference_year': '2020'}).json()['observations'], [])
        self.assertEqual(self.client.get('/api/observations/batch/', {**query, 'reference_year': 'x'}).status_code, 400)

    def test_places_bbox_and_kind(self):
        Place.objects.create(source_id='test', source_record_id='node/1', category='grocery', name='Shop',
            latitude='43.7', longitude='-79.3', valid_on='2026-01-01', properties={'tags': {'shop': 'supermarket'}})
        data = self.client.get('/api/places/', {'category': 'grocery'}).json()
        self.assertEqual([p['kind'] for p in data['places']], ['supermarket'])
        self.assertIsNone(self.client.get('/api/places/', {'category': 'library'}).json()['places'][0]['kind'])
        inside = self.client.get('/api/places/', {'category': 'grocery', 'bbox': '-79.35,43.65,-79.25,43.75'}).json()
        outside = self.client.get('/api/places/', {'category': 'grocery', 'bbox': '-79.5,43.5,-79.45,43.55'}).json()
        self.assertEqual((len(inside['places']), len(outside['places']), outside['sources']), (1, 0, []))
        for bad in ['1,2,3', '-79,44,-80,43', 'a,b,c,d']:
            self.assertEqual(self.client.get('/api/places/', {'category': 'grocery', 'bbox': bad}).status_code, 400)

    def test_places_filters_category_and_lists_source(self):
        data = self.client.get('/api/places/', {'category': 'library'}).json()
        self.assertEqual([(p['name'], p['latitude']) for p in data['places']], [('Test branch', 43.6)])
        self.assertEqual([s['id'] for s in data['sources']], ['test'])
        self.assertEqual(self.client.get('/api/places/').status_code, 400)
