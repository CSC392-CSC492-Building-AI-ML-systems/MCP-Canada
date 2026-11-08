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


class ObservationQueryTests(TestCase):
    def setUp(self):
        from .models import Geography, GeographySet, Indicator
        source = SourceRelease.objects.create(id='test', publisher='Synthetic fixture', title='Not real data',
            url='https://example.org/test', licence='Test only', retrieved_at='2026-01-01T00:00:00Z',
            sha256='a'*64, coverage='Test')
        indicator = Indicator.objects.create(id='rent', label='Test rent', unit='CAD', definition='Synthetic',
            universe='Test', statistic='median')
        for set_id in ['test-140', 'test-158']:
            GeographySet.objects.create(id=set_id, kind='neighbourhood', version='test', source=source)
            for code in ['1', '2']:
                geography = Geography.objects.create(id=f'{set_id}-{code}', geography_set_id=set_id, code=code, name='Test')
                Observation.objects.create(source=source, geography=geography, indicator=indicator, census_year=2021,
                    reference_year=2021, period='annual', value=code, status='observed', source_locator='fixture')

    def get(self, **params):
        return self.client.get('/api/observations/', {'indicator_id': 'rent', 'source_id': 'test', **params})

    def test_single_geography_unchanged(self):
        rows = self.get(geography_id='test-140-1').json()['observations']
        self.assertEqual([(r['geography_id'], r['value']) for r in rows], [('test-140-1', '1.00000000')])

    def test_whole_set_stays_within_that_set(self):
        rows = self.get(geography_set_id='test-158').json()['observations']
        self.assertEqual([r['geography_id'] for r in rows], ['test-158-1', 'test-158-2'])

    def test_requires_exactly_one_geography_filter(self):
        self.assertEqual(self.get().status_code, 400)
        self.assertEqual(self.get(geography_id='test-140-1', geography_set_id='test-140').status_code, 400)
