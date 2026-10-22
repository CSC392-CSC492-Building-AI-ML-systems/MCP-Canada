# MCP Canada

A Next.js / React frontend and a Python / Django API. No database is configured.

## Requirements

- Node.js 24 LTS recommended (or 20.19+ / 22.13+) and npm
- Python 3.11+ (Django 5.2 LTS)

## Local development

Run these commands from the repository root. Keep each server running in its own terminal.

### Backend — terminal 1

```sh
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
backend/.venv/bin/python backend/manage.py runserver 127.0.0.1:8000
```

### Frontend — terminal 2

```sh
cd frontend
npm ci
npm run dev
```

Open http://localhost:3000. The starter page checks the Django connection.
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

`DATABASES` is empty. Django admin, authentication, and database-backed sessions
are not installed; there are no migrations to run. Add a database and the relevant
Django apps when persistence is needed. API endpoints currently use Django's
built-in `JsonResponse`; no REST framework is required for this starter.
For future state-changing endpoints, retain CSRF protection and add an appropriate
CSRF token flow and authentication for the chosen deployment.

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
{"status": "ok", "service": "django", "database": "disabled"}
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
