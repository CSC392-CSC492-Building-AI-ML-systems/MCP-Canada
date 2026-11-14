"""One-command local setup of the official datasets. Safe to run more than once.

Run with the backend environment's Python, from any directory:
    Windows:      backend\\.venv\\Scripts\\python backend\\scripts\\setup_official_data.py
    macOS/Linux:  backend/.venv/bin/python backend/scripts/setup_official_data.py

Steps, stopping at the first failure:
 1. Check Python and the pinned backend dependencies.
 2. Check every raw file in data/official-sources.json against its pinned SHA-256. Missing files
    are copied from --from-dir or downloaded (release mirror first, then the official URL) and
    accepted only when the bytes match. Existing files are never overwritten.
 3. Prepare data/normalized/official.json with prepare_official_data.py.
 4. Dry run on a temporary copy of the database: migrate, encoding repair, a full all-or-nothing
    import, and a count check that every bundle record is present.
 5. Only then change the real database. Fresh setup: the validated copy becomes the new database
    (never replacing a file). Existing database: back it up, migrate, repair (only after you type
    REPAIR), import, and verify the final counts. Already up to date: nothing is written.
Nothing is deleted, the importer's conflict checks are unchanged, and --dry-run stops after step 4."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import ssl
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / 'backend'
MANIFEST = ROOT / 'data' / 'official-sources.json'
BUNDLE = ROOT / 'data' / 'normalized' / 'official.json'
REQUIRED_PYTHON = (3, 12)
TABLES = {  # bundle section -> (table, how bundle records are matched in the database)
    'sources': ('api_sourcerelease', 'id'), 'geography_sets': ('api_geographyset', 'id'),
    'geographies': ('api_geography', 'id'), 'indicators': ('api_indicator', 'id'),
    'observations': ('api_observation', 'source'), 'places': ('api_place', 'source'),
    'source_rows': ('api_sourcetablerow', 'source'),
}


class SetupError(Exception):
    """A step failed; the message says what to do."""


def say(message=''):
    print(message, flush=True)


_START = None


def step(title):
    global _START
    import time
    _START = _START or time.monotonic()
    say(f'\n== {title}   [{time.monotonic() - _START:,.0f}s]')


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


# ---------- 1. Python and dependencies ----------

def check_dependencies():
    if sys.version_info[:2] < REQUIRED_PYTHON:
        raise SetupError(f'Python {".".join(map(str, REQUIRED_PYTHON))}+ is required; this is {sys.version.split()[0]}. '
                         'Run the script with backend/.venv Python (see docs/local-data-setup.md).')
    pins = {}
    for line in (BACKEND / 'requirements.txt').read_text(encoding='utf-8').splitlines():
        line = line.split('#', 1)[0].strip()
        if line:
            name, _, version = line.partition('==')
            pins[name.strip()] = version.strip()
    problems = []
    for name, version in pins.items():
        try:
            installed = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            problems.append(f'{name} is not installed (need {version})')
            continue
        if version and installed != version:
            problems.append(f'{name} {installed} is installed, but requirements.txt pins {version}')
    try:
        importlib.metadata.version('numpy')  # required by shapely; version comes from uv.lock
    except importlib.metadata.PackageNotFoundError:
        problems.append('numpy is not installed (shapely needs it)')
    if problems:
        raise SetupError('Backend dependencies do not match the pins:\n  ' + '\n  '.join(problems) +
                         '\nFix: cd backend && uv sync   (or: pip install -r backend/requirements.txt)')
    say(f'Python {sys.version.split()[0]}; {len(pins)} pinned packages match requirements.txt; '
        f'shapely {importlib.metadata.version("shapely")}, numpy {importlib.metadata.version("numpy")}')


# ---------- 2. Raw files ----------

def candidates(name, item, from_dir):
    """Where a missing file may come from, in order of preference."""
    if from_dir:
        yield f'folder {from_dir}', (Path(from_dir) / name).resolve().as_uri()
    if item.get('mirror'):
        yield 'release mirror', item['mirror']
    yield 'official source', item['url']


def tls_contexts():
    """System trust store first, then certifi's CA bundle when installed (a uv.lock dependency).
    Both verify certificates; certifi helps where the system store cannot complete a server's
    chain (seen with bankofcanada.ca on Windows)."""
    contexts = [ssl.create_default_context()]
    try:
        import certifi
        contexts.append(ssl.create_default_context(cafile=certifi.where()))
    except ImportError:
        pass
    return contexts


def download(url, part, timeout):
    """Write url to part. Only a certificate-verification failure is retried, with the next trust store."""
    request = urllib.request.Request(url, headers={'User-Agent': 'official-data-setup/1.0'})
    contexts = tls_contexts()
    for n, context in enumerate(contexts):
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=context) as response, open(part, 'wb') as out:
                shutil.copyfileobj(response, out, 1 << 20)
            return
        except urllib.error.URLError as exc:
            if not isinstance(exc.reason, ssl.SSLCertVerificationError) or n == len(contexts) - 1:
                raise


def fetch(name, item, raw_dir, from_dir=None, timeout=300):
    """Copy or download one missing file; keep it only when its SHA-256 matches the pin."""
    target = raw_dir / name
    part = raw_dir / f'.{name}.part'
    tried = []
    for label, url in candidates(name, item, from_dir):
        try:
            download(url, part, timeout)
        except Exception as exc:  # network, 404, missing folder file: try the next source
            tried.append(f'{label}: {type(exc).__name__}: {str(exc)[:120]}')
            part.unlink(missing_ok=True)
            continue
        digest = sha256(part)
        if digest == item['sha256']:
            os.replace(part, target)
            return label
        tried.append(f'{label}: different bytes (sha256 {digest[:12]}..., expected {item["sha256"][:12]}...); not used')
        part.unlink(missing_ok=True)
    raise SetupError(f'Could not obtain the pinned snapshot of {name}.\n  ' + '\n  '.join(tried) +
                     f'\nFix: download {name} from the project data release (docs/local-data-setup.md) '
                     f'into {raw_dir}, or rerun with --from-dir pointing at a folder that has it.')


def check_raw_files(raw_dir, manifest, from_dir=None, offline=False):
    raw_dir.mkdir(parents=True, exist_ok=True)
    wrong, missing = [], []
    for name, item in manifest.items():
        path = raw_dir / name
        if not path.exists():
            missing.append(name)
        elif sha256(path) != item['sha256']:
            wrong.append(name)
    if wrong:
        raise SetupError('These raw files exist but differ from the pinned snapshot; they were left untouched:\n  ' +
                         '\n  '.join(wrong) + '\nFix: move each one out of data/raw (keep it if it is a newer snapshot '
                         'you want reviewed), then rerun this script to fetch the pinned version.')
    if missing and offline:
        raise SetupError('Missing raw files and --offline was given:\n  ' + '\n  '.join(missing))
    for name in missing:
        say(f'  fetching {name} ...')
        say(f'  {name}: verified, from {fetch(name, manifest[name], raw_dir, from_dir)}')
    say(f'All {len(manifest)} raw files match their pinned SHA-256 ({len(missing)} fetched).')


# ---------- 3-5. Prepare, validate, import ----------

def run(args, db_path, capture=False):
    """Run a backend command against db_path; any failure stops setup."""
    env = {**os.environ, 'DJANGO_DB_PATH': str(db_path)}
    result = subprocess.run([sys.executable, *map(str, args)], cwd=ROOT, env=env, text=True,
                            encoding='utf-8', errors='replace', capture_output=capture)
    if capture and result.stdout:
        print(result.stdout, end='', flush=True)
    if result.returncode:
        if capture and result.stderr:
            print(result.stderr, end='', file=sys.stderr, flush=True)
        raise SetupError(f'Step failed (exit {result.returncode}): {" ".join(map(str, args[:2]))}')
    return result.stdout if capture else ''


def manage(db_path, *args, capture=False):
    return run([BACKEND / 'manage.py', *args], db_path, capture)


def database_counts(db_path, bundle):
    """{section: (records of this bundle present in the database, records in the bundle)}."""
    db = sqlite3.connect(f'file:{Path(db_path).as_posix()}?mode=ro', uri=True)
    try:
        if not db.execute("select 1 from sqlite_master where name='api_sourcerelease'").fetchone():
            return {section: (0, len(bundle.get(section, []))) for section in TABLES}
        source_ids = {s['id'] for s in bundle.get('sources', [])}
        counts = {}
        for section, (table, match) in TABLES.items():
            if match == 'id':
                present = {r[0] for r in db.execute(f'select id from {table}')}
                found = sum(1 for r in bundle.get(section, []) if r['id'] in present)
            else:
                found = sum(n for sid, n in db.execute(f'select source_id, count(*) from {table} group by source_id')
                            if sid in source_ids)
            counts[section] = (found, len(bundle.get(section, [])))
        return counts
    finally:
        db.close()


def check_counts(db_path, bundle, label):
    counts = database_counts(db_path, bundle)
    width = max(map(len, counts))
    for section, (found, expected) in counts.items():
        say(f'  {section:<{width}}  {found:>7,} of {expected:>7,} bundle records')
    short = [s for s, (found, expected) in counts.items() if found < expected]
    extra = [s for s, (found, expected) in counts.items() if found > expected]
    if short:
        raise SetupError(f'{label}: records missing after import: {", ".join(short)}')
    if extra:
        say(f'  Note: the database also holds older records from these releases ({", ".join(extra)}); none were changed.')
    return counts


def repair_rows(db_path, apply=False):
    output = manage(db_path, 'repair_source_row_encoding', BUNDLE, *(['--apply'] if apply else []), capture=True)
    match = re.search(r'rows: (\d+)', output)
    return int(match[1]) if match else 0


def confirm_repair(rows):
    say(f'\n{rows:,} staged source rows hold text that an earlier Windows import mis-decoded (UTF-8 read as cp1252).')
    say('The repair rewrites only their label/metadata/cells to the exact UTF-8 source text (examples in step 4).')
    say('Nothing else changes, and the database is backed up first.')
    if not sys.stdin.isatty():
        raise SetupError('This repair needs confirmation, and no interactive terminal is attached. '
                         'Nothing was changed. Rerun the script in a terminal and type REPAIR when asked.')
    try:
        answer = input('Type REPAIR to back up, repair and import, or anything else to stop: ')
    except EOFError:  # e.g. input redirected from NUL on Windows, which still reports a terminal
        raise SetupError('No confirmation was received; nothing was changed. Rerun in a terminal and type REPAIR.')
    if answer.strip() != 'REPAIR':
        raise SetupError('Repair not confirmed; the database was not changed.')


def backup(db_path):
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target = db_path.with_name(f'{db_path.name}.backup-{stamp}')
    n = 1
    while target.exists():  # never overwrite an existing backup
        target = db_path.with_name(f'{db_path.name}.backup-{stamp}-{n}')
        n += 1
    shutil.copy2(db_path, target)
    return target


def migrations_pending(db_path):
    env = {**os.environ, 'DJANGO_DB_PATH': str(db_path)}
    result = subprocess.run([sys.executable, str(BACKEND / 'manage.py'), 'migrate', '--check'],
                            cwd=ROOT, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return result.returncode != 0


def default_db_path():
    """The same database Django uses (backend/config/settings.py)."""
    return Path(os.environ.get('DJANGO_DB_PATH') or BACKEND / 'db.sqlite3').resolve()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--dry-run', action='store_true', help='Validate everything on a temporary copy; never change the real database')
    parser.add_argument('--from-dir', help='Folder holding raw snapshot files (e.g. an unzipped shared copy); used before downloading')
    parser.add_argument('--offline', action='store_true', help='Never download; fail if a raw file is missing')
    parser.add_argument('--no-backup', action='store_true', help='Skip the timestamped backup of an existing database')
    parser.add_argument('--raw-dir', type=Path, default=ROOT / 'data' / 'raw', help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    db_path = default_db_path()
    try:
        step('1/5 Python and dependencies')
        check_dependencies()

        step('2/5 Raw dataset files')
        manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
        check_raw_files(args.raw_dir.resolve(), manifest, args.from_dir, args.offline)

        step('3/5 Prepare normalized bundle')
        run([BACKEND / 'scripts' / 'prepare_official_data.py', '--raw-dir', args.raw_dir.resolve(), '--output', BUNDLE], db_path)
        bundle = json.loads(BUNDLE.read_text(encoding='utf-8'))

        fresh = not db_path.exists()
        step(f'4/5 Validate on a temporary copy ({"fresh setup: no database at " if fresh else "existing database "}{db_path})')
        db_path.parent.mkdir(parents=True, exist_ok=True)
        # The trial lives next to the database so a fresh setup can move it into place.
        with tempfile.TemporaryDirectory(prefix='.official-data-check-', dir=db_path.parent) as tmp:
            trial = Path(tmp) / 'trial.sqlite3'
            if not fresh:
                shutil.copy2(db_path, trial)
            manage(trial, 'migrate', '--noinput', capture=True)
            to_repair = repair_rows(trial)
            if to_repair:
                repair_rows(trial, apply=True)  # on the copy only, to prove the rest of the pipeline
            up_to_date = not to_repair and all(found >= expected for found, expected in database_counts(trial, bundle).values())
            # Always import into the copy, even when every record is present: the importer compares
            # each stored record with the bundle, so this is what detects conflicting data.
            say('Importing into the copy (all-or-nothing; this is the dry run, and takes several minutes) ...')
            manage(trial, 'import_dataset', BUNDLE, capture=True)
            check_counts(trial, bundle, 'Validation copy')
            say('Validation passed on the temporary copy.')
            if args.dry_run:
                say('\n--dry-run: the real database was not changed.' +
                    (f' A real run would repair {to_repair:,} rows (after confirmation).' if to_repair else ''))
                return 0

            step('5/5 Update the real database')
            if fresh:
                # Nothing exists to replace: publish the validated copy. Linking fails if a file appeared meanwhile.
                try:
                    os.link(trial, db_path)
                except FileExistsError:
                    raise SetupError(f'{db_path} appeared while setup was running; it was not touched. Rerun setup.')
                except OSError:
                    with open(db_path, 'xb') as out, open(trial, 'rb') as src:  # 'x' never overwrites
                        shutil.copyfileobj(src, out, 1 << 20)
                say(f'Created {db_path} from the validated copy.')
                check_counts(db_path, bundle, 'Database')
                say(f'\nSuccess: new database {db_path} holds every record of the official bundle.')
                return 0
        if up_to_date and not migrations_pending(db_path):
            say('Already up to date: every bundle record is present and matches (checked by the import on the copy). Nothing was changed.')
            check_counts(db_path, bundle, 'Database')
            return 0
        if to_repair:
            confirm_repair(to_repair)  # before any write; the rows were listed in step 4
        if not args.no_backup:
            say(f'Backup: {backup(db_path)}')
        manage(db_path, 'migrate', '--noinput')
        if to_repair:
            # Re-verifies every row against the bundle; any unexpected difference aborts unchanged.
            repair_rows(db_path, apply=True)
        say('Importing (all-or-nothing; the same import already passed on the copy) ...')
        manage(db_path, 'import_dataset', BUNDLE)
        check_counts(db_path, bundle, 'Database')
        say(f'\nSuccess: {db_path} holds every record of the official bundle; existing records were kept.')
        return 0
    except SetupError as exc:
        print(f'\nSETUP STOPPED: {exc}', file=sys.stderr, flush=True)
        return 1
    except KeyboardInterrupt:
        print('\nSETUP STOPPED: interrupted.', file=sys.stderr, flush=True)
        return 130


if __name__ == '__main__':
    sys.exit(main())
