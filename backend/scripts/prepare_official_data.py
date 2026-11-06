"""Prepare checked official snapshots; use from repo root. Never infer missing data."""
import argparse
import csv
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
from pathlib import Path
import re
import urllib.request
import zipfile

import openpyxl
import shapefile

ROOT = Path(__file__).resolve().parents[2]


def number(raw):
    if raw is None or str(raw).strip() == '':
        return None, 'missing'
    token = str(raw).strip()
    if token in ('x', 'X', '**', 'F'):
        return None, 'suppressed'
    if token in ('...', '…'):
        return None, 'not_applicable'
    if token in ('..', '-', 'n/a', 'N/A'):
        return None, 'missing'
    try:
        value = Decimal(token.replace(',', '').replace('%', '').replace('$', ''))
    except InvalidOperation:
        raise ValueError(f'Unrecognized numeric token: {raw!r}')
    if not value.is_finite():
        raise ValueError('Non-finite source measurement')
    return str(value), 'observed'


def name_key(name):
    return re.sub('[^a-z0-9]', '', re.sub(r'\s*\(\d+\)$', '', name).lower())


def build(raw_dir, manifest):
    out = {x: [] for x in ['sources','geography_sets','geographies','indicators','observations','places','source_rows']}
    releases = {}
    def source(filename, publisher, title, coverage, licence='Catalogue licence not specified; verify source terms before redistribution', notes=''):
        item = manifest[filename]
        digest = hashlib.sha256((raw_dir/filename).read_bytes()).hexdigest()
        if digest != item['sha256']:
            raise ValueError(f'Checksum mismatch: {filename}')
        sid = re.sub('[^a-z0-9-]', '-', filename.lower()).strip('-')[:35]+'-'+digest[:10]
        if sid not in releases:
            out['sources'].append(dict(id=sid, publisher=publisher, title=title, coverage=coverage,
                licence=licence, url=item['url'], retrieved_at=item['retrieved_at'],sha256=digest,notes=notes))
            releases[sid]=filename
        return sid
    def geo_set(gid,kind,version,sid,count=None):
        out['geography_sets'].append(dict(id=gid,kind=kind,version=version,source_id=sid,expected_count=count))
    def staged(sid,locator,label,cells,metadata=None):
        out['source_rows'].append(dict(source_id=sid,locator=locator,label=str(label or ''),cells=cells,metadata=metadata or {}))
    def observe(sid,gid,iid,year,period,raw,locator,census=None,notes=''):
        value,status=number(raw)
        out['observations'].append(dict(source_id=sid,geography_id=gid,indicator_id=iid,
            reference_year=year,period=period,value=value,status=status,census_year=census,
            source_locator=locator,notes=notes+(f'; raw token={raw!r}' if status!='observed' else '')))
    def indicator(iid,label,unit,definition,universe,statistic,dimensions):
        out['indicators'].append(dict(id=iid,label=label[:250],unit=unit,definition=definition,
            universe=universe,statistic=statistic,dimensions=dimensions))

    by_name={}
    for count in [140,158]:
        filename=f'boundaries-{count}.geojson'
        sid=source(filename,'City of Toronto',f'Toronto social planning neighbourhoods – {count}',f'{count} neighbourhood boundary model')
        gset=f'toronto-{count}'
        geo_set(gset,'neighbourhood',f'{count} boundary model; downloaded source snapshot',sid,count)
        features=json.loads((raw_dir/filename).read_text())['features']
        if len(features)!=count:raise ValueError('Unexpected boundary count')
        for f in features:
            p=f['properties'];code=str(int(p['AREA_SHORT_CODE']));gid=f'{gset}-{code}'
            out['geographies'].append(dict(id=gid,geography_set_id=gset,code=code,
                name=re.sub(r'\s*\(\d+\)$','',p['AREA_NAME']),geometry=f['geometry']))
            if count==140:
                key=name_key(p['AREA_NAME'])
                if key in by_name:raise ValueError('Ambiguous boundary name')
                by_name[key]=gid
            staged(sid,f'feature/{code}',p['AREA_NAME'],p)
    # Source-specific checked row positions; pinned artifact hashes prevent silent drift.
    selections={
        2001: [(3,'persons',2001),*[(i,'persons',2001) for i in range(6,28)],
               (522,'CAD/year',2000),(523,'CAD/year',2000),(741,'households',2001),
               (742,'CAD/month',2001),(743,'households',2001),(745,'households',2001)],
        2006: [(3,'persons',2006),*[(i,'persons',2006) for i in range(6,28)],(28,'years',2006),
               (577,'CAD/year',2005),(578,'CAD/year',2005),(607,'CAD/year',2005),(608,'CAD/year',2005),
               (803,'persons',2006),(905,'persons',2006),(1197,'households',2006),
               (1198,'CAD/month',2006),(1199,'households',2006),(1201,'households',2006)],
        2011: [(2,'persons',2011),*[(i,'persons',2011) for i in range(9,39)],(39,'years',2011),
               *[(i,'CAD/year',2010) for i in range(757,761)],(835,'persons',2011),(998,'persons',2011),
               (1352,'households',2011),(1354,'households',2011),(1356,'households',2011),
               (1358,'percent',2011),(1359,'CAD/month',2011),(1360,'CAD/month',2011),
               (1363,'households',2011),(1365,'percent',2011),(1366,'CAD/month',2011),(1367,'CAD/month',2011)],
        2016: [(4,'persons',2016),(7,'dwellings',2016),(8,'dwellings',2016),
               *[(i,'persons',2016) for i in range(11,17)],(1020,'CAD/year',2015),(1021,'CAD/year',2015),
               (1029,'CAD/year',2015),(1154,'persons',2016),(1338,'persons',2016),
               (1678,'households',2016),(1680,'households',2016),(1683,'percent',2016),
               (1684,'households',2016),(1690,'percent',2016),(1694,'percent',2016),(1695,'percent',2016)],
        2021: [*[(i,'persons',2021) for i in range(4,30)],*[(i,'percent',2021) for i in range(30,35)],
               (35,'years',2021),(36,'years',2021),*[(i,'CAD/year',2020) for i in range(245,249)],
               (301,'households',2021),(302,'households',2021),(361,'households',2021),(363,'households',2021),
               (368,'households',2021),(370,'percent',2021),(372,'CAD/month',2021),(373,'CAD/month',2021),
               (376,'households',2021),(378,'percent',2021),(380,'CAD/month',2021),(381,'CAD/month',2021),
               (1487,'persons',2021),(1488,'persons',2021),(1643,'persons',2021)]}
    for year in [2001,2006,2011,2016,2021]:
        filename=f'census-{year}.'+('xlsx' if year==2021 else 'csv')
        sid=source(filename,'City of Toronto / Statistics Canada',f'{year} neighbourhood full Census profile',
            f'Toronto {158 if year==2021 else 140} neighbourhood model; city aggregate where published',
            notes='Original tables preserved without corrections. 2011 income/housing include NHS-era measures. Some 2016 rows are incomplete/misaligned; unreviewed rows are staging only. Monetary values are nominal.')
        if year==2021:
            book=openpyxl.load_workbook(raw_dir/filename,read_only=True,data_only=True)
            sheet=book.worksheets[0];rows=list(sheet.values);offset=1;label_col=0
            columns=[f'toronto-158-{int(n)}' for n in rows[1][1:]]
            if len(set(columns))!=158:raise ValueError('Unexpected 2021 columns')
            for extra in book.worksheets[1:]:
                for n,row in enumerate(extra.values,1):staged(sid,f'{extra.title}/{n}',row[0],{str(i+1):v for i,v in enumerate(row)})
        else:
            rows=list(csv.reader((raw_dir/filename).open(encoding='utf-8-sig',newline='')))
            offset=6 if year==2016 else 5;label_col=offset-2
            columns=[by_name[name_key(n)] for n in rows[0][offset:]]
            if len(set(columns))!=140:raise ValueError('Unexpected historical columns')
        contexts={};current=''
        for n,row in enumerate(rows,1):
            label=str(row[label_col] or '')
            if label.lstrip().startswith(('Total -','Total number','Household income in','Number of tenant','Number of owner')):
                current=label.strip()
            contexts[n]=current
            cells={gid:row[i+offset] for i,gid in enumerate(columns)}
            meta=dict(census_year=year,source_header=list(rows[0][:offset]),row_metadata=list(row[:offset]),
                universe_context=current,comparison_ready=False)
            if year!=2021:cells['source_city_of_toronto']=row[offset-1]
            staged(sid,f'{"hd2021_census_profile" if year==2021 else "csv"}/{n}',label,cells,meta)
        for n,unit,ref in selections[year]:
            row=rows[n-1];label=str(row[label_col]).strip();iid=f'census-{year}-row-{n}'
            statistic=('median' if 'median' in label.lower() else 'average' if 'average' in label.lower() else
                       'percentage' if unit=='percent' else 'count')
            indicator(iid,label,unit,label,contexts[n] or 'See original source table and category/topic',statistic,
                dict(census_year=year,row=n,source_columns=list(row[:offset]),price_basis='nominal' if unit.startswith('CAD') else 'not monetary'))
            for i,gid in enumerate(columns):
                observe(sid,gid,iid,ref,'annual',row[i+offset],f'{"hd2021_census_profile" if year==2021 else "csv"}!row={n};column={i+offset+1}',year,
                        'Source-defined measure; no cross-boundary harmonization. See source row context.')
    # National CPI, not Toronto neighbourhood inflation.
    sid=source('cpi.json','Bank of Canada / Statistics Canada','Total CPI V41690973','Canada – national',
        'Bank of Canada Valet terms: https://www.bankofcanada.ca/terms/; Statistics Canada attribution')
    geo_set('canada-cpi','country','National coverage of V41690973',sid)
    out['geographies'].append(dict(id='canada-cpi',geography_set_id='canada-cpi',code='CA',name='Canada'))
    iid='canada-cpi-v41690973'
    cpi=json.loads((raw_dir/'cpi.json').read_text())
    staged(sid,'seriesDetail','CPI series metadata',cpi['seriesDetail'])
    indicator(iid,'Canada all-items CPI, not seasonally adjusted','index, 2002=100',cpi['seriesDetail']['V41690973']['description'],
        'Canadian consumers; national all-items basket','index',dict(series='V41690973',base='2002=100',frequency='monthly',seasonally_adjusted=False))
    for row in cpi['observations']:
        observe(sid,'canada-cpi',iid,int(row['d'][:4]),row['d'][:7],row.get('V41690973',{}).get('v'),f'observations/{row["d"]}')
    # Full national CMHC workbook staging, Toronto CMA reviewed summary measures.
    filename='cmhc-canada-2025.xlsx'
    sid=source(filename,'Canada Mortgage and Housing Corporation','2025 Rental Market Survey – Canada tables',
        'Canada, provinces and major centres; normalized measurements below are Toronto CMA only',
        '© CMHC 2025; source workbook and CMHC terms apply')
    geo_set('cmhc-cma-2025','cma','CMHC 2025 published CMA coverage',sid)
    out['geographies'].append(dict(id='cmhc-toronto-cma',geography_set_id='cmhc-cma-2025',code='Toronto CMA',name='Toronto CMA (CMHC)'))
    book=openpyxl.load_workbook(raw_dir/filename,read_only=True,data_only=True)
    for sheet in book:
        for n,row in enumerate(sheet.values,1):
            staged(sid,f'{sheet.title}/{n}',row[0],{str(i+1):v for i,v in enumerate(row)})
    rows=list(book['Table 1.0'].values)
    n,row=next((n,r) for n,r in enumerate(rows,1) if r[0]=='Toronto CMA')
    for metric,unit,cols,bedrooms in [('vacancy-rate','percent',[1,3],'all'),('turnover-rate','percent',[6,8],'all'),('average-two-bedroom-rent','CAD/month',[11,13],2)]:
        iid='cmhc-'+metric
        indicator(iid,metric.replace('-',' ').title(),unit,rows[2][0]+'; '+metric,
            'Privately initiated apartment structures of three units and over; Toronto CMA',
            'average' if metric.startswith('average') else 'percentage',dict(bedrooms=bedrooms,price_basis='nominal',survey='RMS',coverage='Toronto CMA'))
        for year,col in zip([2024,2025],cols):
            observe(sid,'cmhc-toronto-cma',iid,year,f'{year}-10',row[col],f'Table 1.0!row={n};column={col+1}',notes=f'Source reliability code: {row[col+1]}')
    # Additional Toronto editions are preserved in full without guessing zone IDs/columns.
    for path in sorted(raw_dir.glob('cmhc-toronto-*.xlsx')):
        sid=source(path.name,'Canada Mortgage and Housing Corporation',path.stem,
            'CMHC Greater Toronto Area workbook: native CMA/zone/municipality coverage; see each sheet',
            '© CMHC; source workbook and CMHC terms apply')
        book=openpyxl.load_workbook(path,read_only=True,data_only=True)
        for sheet in book:
            for n,row in enumerate(sheet.values,1):
                staged(sid,f'{sheet.title}/{n}',row[0],{str(i+1):v for i,v in enumerate(row)},dict(comparison_ready=False))
    # Source-native CMHC zones are versioned independently for each release edition.
    for path in sorted(raw_dir.glob('cmhc-toronto-*.xlsx')):
        edition=int(path.stem.split('-')[-1])
        sid=next(k for k,v in releases.items() if v==path.name)
        book=openpyxl.load_workbook(path,read_only=True,data_only=True)
        zset=f'cmhc-zones-{edition}'
        cset=f'cmhc-cma-{edition}-native'
        geo_set(zset,'cmhc_zone',f'CMHC Toronto workbook {edition} zone labels; no city neighbourhood mapping',sid)
        geo_set(cset,'cma',f'CMHC Toronto workbook {edition} CMA coverage',sid)
        known={}
        for table,metric,unit in [('Table 1.1.1','apartment-vacancy','percent'),
                                  ('Table 1.1.2','apartment-rent','CAD/month'),
                                  ('Table 1.1.3','apartment-universe','units'),
                                  ('Table 1.1.6','apartment-turnover','percent')]:
            rows=list(book[table].values)
            h=next(i for i,r in enumerate(rows) if r[0]=='Zone' and any(re.fullmatch(r'Oct-\d{2}',str(v)) for v in r[1:]))
            bedrooms=rows[h-1]
            if not all(any(str(v)==label for v in bedrooms) for label in ['1 Bedroom','2 Bedroom','Total']):
                raise ValueError(f'Unexpected CMHC bedroom headings in {path.name}/{table}')
            cols=[];bed=None
            for col in range(1,len(rows[h])):
                if bedrooms[col] is not None:bed=str(bedrooms[col]).strip()
                m=re.fullmatch(r'Oct-(\d{2})',str(rows[h][col]))
                if not m:continue
                bcode={'Bachelor':'studio','Studio':'studio','1 Bedroom':'1','2 Bedroom':'2','3 Bedroom +':'3plus','Total':'all'}[bed]
                yr=2000+int(m[1])
                iid=f'cmhc-{edition}-{metric}-{bcode}'
                if not any(x['id']==iid for x in out['indicators']):
                    indicator(iid,f'{metric} / {bed}',unit,
                        '; '.join(str(r[0]) for r in rows[:h] if r[0]),
                        'CMHC private apartment rental universe; see workbook methodology',
                        'average' if metric=='apartment-rent' else 'count' if unit=='units' else 'percentage',
                        dict(bedrooms=bed,edition=edition,price_basis='nominal',survey='RMS',table=table))
                cols.append((col,yr,iid))
            for n,row in enumerate(rows[h+1:],h+2):
                label=re.sub(r'\s+',' ',str(row[0] or '')).strip()
                match=re.match(r'^Zone (\d+) - ',label)
                if match:
                    code=match[1];gid=f'{zset}-{code}';gset=zset
                elif label=='Toronto CMA':
                    code='Toronto CMA';gid=f'cmhc-toronto-{edition}';gset=cset
                else:continue  # Subtotals remain in source staging; do not relabel them.
                if gid not in known:
                    out['geographies'].append(dict(id=gid,geography_set_id=gset,code=code,name=label))
                    known[gid]=label
                elif known[gid]!=label:
                    raise ValueError('CMHC zone label changed between tables')
                for col,yr,iid in cols:
                    quality=row[col+1] if col+1<len(row) and str(row[col+1]) in ['a','b','c','d'] else ''
                    observe(sid,gid,iid,yr,f'{yr}-10',row[col],f'{table}!row={n};column={col+1}',
                        notes=f'CMHC published geography; source reliability code: {quality}; no neighbourhood allocation')
    # Library feature geometries and original attributes.
    if (raw_dir/'libraries.geojson').exists():
        sid=source('libraries.geojson','Toronto Public Library / City of Toronto','Library branch general information','Toronto library branches; source snapshot, not historical amenity presence')
        date=manifest['libraries.geojson']['retrieved_at'][:10]
        for f in json.loads((raw_dir/'libraries.geojson').read_text())['features']:
            p=f['properties'];g=f['geometry'];code=str(p['BranchCode'])
            staged(sid,f'feature/{code}',p['BranchName'],dict(properties=p,geometry=g))
            if not p.get('PhysicalBranch'):continue
            if g is None:continue
            if g['type']=='MultiPoint' and len(g['coordinates'])!=1:raise ValueError('Multiple library locations in one feature')
            xy=g['coordinates'][0] if g['type']=='MultiPoint' else g['coordinates']
            if g['type'] not in ['Point','MultiPoint']:raise ValueError('Unexpected library geometry')
            out['places'].append(dict(source_id=sid,source_record_id=code,category='library',name=p['BranchName'],
                longitude=str(xy[0]),latitude=str(xy[1]),valid_on=date,properties=dict(source_attributes=p,date_basis='retrieval snapshot; not opening date')))
    # Preserve all park polygons; no invented entrance/centroid locations.
    if (raw_dir/'parks.zip').exists():
        sid=source('parks.zip','City of Toronto','City green spaces / parks WGS84','Toronto city green space polygons; source snapshot')
        z=zipfile.ZipFile(raw_dir/'parks.zip')
        parts={n.rsplit('.',1)[-1]:io.BytesIO(z.read(n)) for n in z.namelist() if n.endswith(('.shp','.shx','.dbf')) and not n.startswith('__MACOSX')}
        reader=shapefile.Reader(**parts)
        for sr in reader.iterShapeRecords():
            p=sr.record.as_dict()
            staged(sid,f'feature/{p["OBJECTID"]}',p.get('NAME',''),dict(properties=p,geometry=sr.shape.__geo_interface__),dict(comparison_ready=False))
    # Optional source-native GTFS stops. Empty feeds fail clearly and aren't fabricated.
    for path in [raw_dir/'ttc-merged.zip',raw_dir/'ttc.zip']:
        if not path.exists():continue
        z=zipfile.ZipFile(path)
        stops=next((n for n in z.namelist() if n.endswith('stops.txt')),None)
        if not stops:continue
        sid=source(path.name,'Toronto Transit Commission','TTC GTFS stops','Published feed snapshot; not a historical neighbourhood transit score')
        date=manifest[path.name]['retrieved_at'][:10]
        for row in csv.DictReader(io.TextIOWrapper(z.open(stops),encoding='utf-8-sig')):
            if not row.get('stop_lat') or not row.get('stop_lon'):continue
            out['places'].append(dict(source_id=sid,source_record_id=row['stop_id'],category='transit_stop',name=row.get('stop_name') or row['stop_id'],
                latitude=str(Decimal(row['stop_lat']).quantize(Decimal('0.0000001'))),longitude=str(Decimal(row['stop_lon']).quantize(Decimal('0.0000001'))),valid_on=date,properties=dict(source_attributes=row,date_basis='feed retrieval snapshot')))
        break
    if (raw_dir/'schools.csv').exists():
        # Full source retained pending checked coordinate/name field mapping.
        sid=source('schools.csv','City of Toronto','School locations – all types','Toronto schools; source snapshot')
        with (raw_dir/'schools.csv').open(encoding='utf-8-sig',newline='') as f:
            for n,row in enumerate(csv.DictReader(f),2):
                staged(sid,f'csv/{n}',row.get('NAME',''),row,dict(comparison_ready=False))
                g=json.loads(row['geometry'])
                if g['type'] not in ['Point','MultiPoint']:raise ValueError('Unexpected school geometry')
                if g['type']=='MultiPoint' and len(g['coordinates'])!=1:raise ValueError('Multiple school locations in one feature')
                xy=g['coordinates'][0] if g['type']=='MultiPoint' else g['coordinates']
                out['places'].append(dict(source_id=sid,source_record_id=row['OBJECTID'],category='school',name=row['NAME'],
                    latitude=str(Decimal(str(xy[1])).quantize(Decimal('0.0000001'))),
                    longitude=str(Decimal(str(xy[0])).quantize(Decimal('0.0000001'))),valid_on=manifest['schools.csv']['retrieved_at'][:10],
                    properties=dict(source_attributes=row,date_basis='retrieval snapshot; not historic opening date')))
    for path in ([] if any(x['category']=='transit_stop' for x in out['places']) else sorted(raw_dir.glob('ttc-stops-*.geojson'))):
        sid=source(path.name,'City of Toronto / Toronto Transit Commission','TTC stop GIS layer snapshot page',
            'Native TTC stop coverage, including any stops outside Toronto; no historical service claim')
        for f in json.loads(path.read_text())['features']:
            p=f['properties'];g=f['geometry']
            staged(sid,f'feature/{f.get("id",p.get("OBJECTID"))}',p.get('STOP_NAME',''),dict(properties=p,geometry=g))
            if g is None:continue
            if g['type']!='Point':raise ValueError('Unexpected TTC point geometry')
            xy=g['coordinates'];code=str(p.get('STOP_ID') or f.get('id') or p.get('OBJECTID'))
            out['places'].append(dict(source_id=sid,source_record_id=code,category='transit_stop',
                name=str(p.get('STOP_NAME') or code),
                longitude=str(Decimal(str(xy[0])).quantize(Decimal('0.0000001'))),
                latitude=str(Decimal(str(xy[1])).quantize(Decimal('0.0000001'))),
                valid_on=manifest[path.name]['retrieved_at'][:10],properties=dict(source_attributes=p,date_basis='GIS retrieval snapshot; service date unverified')))
    if (raw_dir/'osm-groceries.json').exists():
        sid=source('osm-groceries.json','OpenStreetMap contributors','Grocery-related shops from OpenStreetMap',
            'Bounding box 43.58,-79.65 to 43.86,-79.11; includes adjacent municipalities; not neighbourhood counts',
            'Open Database Licence 1.0; © OpenStreetMap contributors; https://www.openstreetmap.org/copyright')
        osm=json.loads((raw_dir/'osm-groceries.json').read_text())
        if 'remark' in osm:raise ValueError('Incomplete Overpass response')
        for e in osm['elements']:
            code=f'{e["type"]}/{e["id"]}';tags=e.get('tags',{})
            staged(sid,code,tags.get('name',''),e)
            xy=e if 'lat' in e else e.get('center',{})
            if not xy:continue
            out['places'].append(dict(source_id=sid,source_record_id=code,category='grocery',name=tags.get('name') or tags.get('shop') or code,
                latitude=str(Decimal(str(xy['lat'])).quantize(Decimal('0.0000001'))),
                longitude=str(Decimal(str(xy['lon'])).quantize(Decimal('0.0000001'))),
                valid_on=manifest['osm-groceries.json']['retrieved_at'][:10],
                properties=dict(tags=tags,osm_type=e['type'],osm_id=e['id'],coordinate_role='source node' if 'lat' in e else 'source bounding-box centre; not entrance',
                                date_basis='OSM retrieval snapshot; historical opening unknown',coverage='Toronto-area bounding box, includes adjacent municipalities')))
    return out


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download',action='store_true',help='Fetch exact pinned snapshots; fail on changed bytes')
    parser.add_argument('--raw-dir',type=Path,default=ROOT/'data/raw')
    parser.add_argument('--output',type=Path,default=ROOT/'data/normalized/official.json')
    args=parser.parse_args()
    manifest=json.loads((ROOT/'data/official-sources.json').read_text())
    args.raw_dir.mkdir(parents=True,exist_ok=True)
    if args.download:
        for name,item in manifest.items():
            path=args.raw_dir/name
            if path.exists():continue
            with urllib.request.urlopen(item['url'],timeout=120) as response:data=response.read()
            if hashlib.sha256(data).hexdigest()!=item['sha256']:
                raise ValueError(f'Upstream changed {name}; review a new snapshot instead of overwriting provenance')
            path.write_bytes(data)
    bundle=build(args.raw_dir,manifest)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(bundle,ensure_ascii=False,separators=(',',':')))
    print(json.dumps({k:len(v) for k,v in bundle.items()},indent=2))

if __name__=='__main__':main()
