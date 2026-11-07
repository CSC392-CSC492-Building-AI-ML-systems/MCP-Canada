# MCP Canada

A Next.js / React frontend and a Python / Django API. SQLite persistence uses Django models and migrations.

## Requirements

- Node.js 24 LTS recommended (or 20.19+ / 22.13+) and npm. With [nvm](https://github.com/nvm-sh/nvm),
  run `nvm install` in the repository root; it reads `.nvmrc`.
- Python 3.12 (Django 5.2 LTS), installed automatically by [uv](https://docs.astral.sh/uv/).

## Local development

Run these commands from the repository root. Keep each server running in its own terminal.

### Backend — terminal 1

Install uv once (`curl -LsSf https://astral.sh/uv/install.sh | sh`), then:

```sh
cd backend
uv sync                                   # creates backend/.venv with Python 3.12 from uv.lock
uv run python manage.py migrate
uv run python manage.py runserver 127.0.0.1:8000
```

The `backend/.venv/bin/python …` commands elsewhere in this README still work, since
uv puts the environment in the same place. Without uv, create the environment with
`python3.12 -m venv backend/.venv` and
`backend/.venv/bin/python -m pip install -r backend/requirements.txt`.
CI still installs from `requirements.txt`, so update it alongside `pyproject.toml`
when adding dependencies.

#### Working with uv

Run these from `backend/`.

| Situation | What to do |
| --- | --- |
| You pulled changes to `pyproject.toml` or `uv.lock` | `uv sync` |
| You need a new package | `uv add 'package==x.y.z'`, add the same pin to `requirements.txt`, and commit `pyproject.toml`, `uv.lock` and `requirements.txt` together |
| uv says the lockfile is out of date, or `uv.lock` has a merge conflict | Keep the `pyproject.toml` you want, then run `uv lock` to regenerate `uv.lock` and commit it. Never edit `uv.lock` by hand. |
| `uv lock` keeps failing, or `uv.lock` is badly broken | `rm uv.lock && uv lock && uv sync`, then commit the new `uv.lock`. Indirect dependency versions may change, so rerun the tests. |
| Imports fail, the environment points to a missing Python, or you moved the repository folder | `rm -rf .venv && uv sync` (safe: the environment is rebuilt from `uv.lock`) |

`uv sync` removes packages that are not in `uv.lock`, so install packages with
`uv add`, not `pip install`. `.venv` is never committed; `uv.lock`,
`pyproject.toml` and `.python-version` are.

### Frontend — terminal 2

```sh
cd frontend
npm ci
npm run dev
```

Open http://localhost:3000 (use `localhost`, not your machine's network IP; the dev
server blocks page scripts on other origins). The starter page checks the Django connection.
The API is available directly at http://127.0.0.1:8000/api/health/.

Next.js forwards `/api/*` requests to Django, so browser requests stay on the
same origin and do not need CORS configuration. To change the backend address,
copy `frontend/.env.local.example` to `frontend/.env.local`, edit `BACKEND_URL`,
and restart Next.js. The default works without an environment file.

## Structure

```text
frontend/
  src/app/          React pages, layout, and CSS (Next.js App Router / TypeScript)
  next.config.ts    API proxy
backend/
  config/           Django settings, URLs, ASGI / WSGI entry points
  api/              JSON API views, routes, and tests
  manage.py         Django commands
```

## Checks

```sh
backend/.venv/bin/python backend/manage.py check
cd backend && .venv/bin/python manage.py test && cd ..
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
```

GitHub Actions runs these checks on every push and pull request
(`.github/workflows/ci.yml`).

After building, `npm start` serves the frontend production build. Django must
still be running for API requests to work.

## Backend settings

Django reads environment variables from the shell, not from `.env` files.
See `backend/.env.example` for names and defaults. For example:

```sh
export DJANGO_DEBUG=false
export DJANGO_SECRET_KEY='your-random-secret'
export DJANGO_ALLOWED_HOSTS='your-domain.example'
```

The defaults and Django development server are intended for local development.
Configure a production ASGI/WSGI server, HTTPS, allowed hosts, and a secret before deployment.

The database MVP uses Django's built-in SQLite backend. No credentials or database
server are needed. See [database setup and imports](docs/database.md). The health
response reports configuration, not database readiness; `manage.py migrate` must
succeed before data queries. Existing comparison input classes remain unchanged.

## Dependency audit

At setup, npm reports five high-severity findings in the development-only
`eslint-config-next` → `fast-glob` → `micromatch` → `braces` dependency chain
([advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)). npm currently offers
no compatible fix; its suggested forced fix downgrades the Next.js lint config to
an older major version. Recheck with `npm audit` when updating dependencies.

## Python MCP server

`backend/mcp_server.py` uses the [official Python MCP SDK](https://py.sdk.modelcontextprotocol.io/v1/),
pinned to the v1 maintenance line. It runs alongside Django as a separate local
**stdio** process. An MCP client launches it on demand; there is no extra port.
No database or API key is required.

The initial read-only tool is `health_check`. It calls the same application
service as `GET /api/health/` and returns:

```json
{"status": "ok", "service": "django", "database": "configured"}
```

It initializes Django directly, so you do not need the Django HTTP server running
to use this tool. This checks application initialization, not HTTP server uptime.
Add future application logic in `backend/api/services.py` and expose it through
explicit `@mcp.tool()` functions in `backend/mcp_server.py`.

Install dependencies using the backend setup commands above. For clients that
accept an `mcpServers` JSON configuration, copy the entry from
`mcp-client.example.json` into the client's configuration and replace both
`/absolute/path/to/MCP-Canada` placeholders with your actual repository path.
The client configuration has not been installed automatically.

To launch manually from the repository root:

```sh
backend/.venv/bin/python backend/mcp_server.py
```

The process waits for MCP protocol input; it is not a browser endpoint or an
interactive terminal. Normally, let your MCP client launch it. Avoid writing
logs to stdout, which is reserved for protocol messages.

Run the protocol integration test:

```sh
backend/.venv/bin/python backend/test_mcp.py
```

This launches the server, initializes a real MCP session, discovers its tools,
and invokes `health_check` without a database or running HTTP server.

## Imported public data

The local database now includes reviewed Census/CMHC/CPI measurements, place
locations and complete source-table staging. See [import instructions and coverage](docs/official-data-import.md)
and [loaded data inventory](docs/data-import-status.md). To reproduce imports,
use the pinned manifest and preparation script; local downloads and database files
are ignored by Git. Run `backend/.venv/bin/python backend/manage.py data_inventory`
to inspect the actual database.
