#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_port="${BACKEND_PORT:-8000}"
frontend_port="${FRONTEND_PORT:-3000}"

for tool in node npm uv curl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing $tool. See the README requirements before running this script." >&2
    exit 1
  fi
done

# Check both ports before installing dependencies or applying migrations.
node - "$backend_port" "$frontend_port" <<'JS'
const net = require('node:net');
const ports = process.argv.slice(2).map(Number);
if (ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535) || ports[0] === ports[1]) {
  console.error('BACKEND_PORT and FRONTEND_PORT must be distinct integers from 1 to 65535.');
  process.exit(1);
}
for (const port of ports) {
  const server = net.createServer();
  server.once('error', error => {
    console.error(`Cannot use 127.0.0.1:${port} (${error.code}). Stop the other server or choose a different port.`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => server.close());
}
JS

(
  cd "$root/backend"
  uv sync --locked
  uv run --no-sync python manage.py migrate
)
(
  cd "$root/frontend"
  npm ci --engine-strict
)

backend_pid=
frontend_pid=
cleanup() {
  local pid
  for pid in "$frontend_pid" "$backend_pid"; do
    if [[ -n "$pid" ]]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  for pid in "$frontend_pid" "$backend_pid"; do
    if [[ -n "$pid" ]]; then
      wait "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

(
  cd "$root/backend"
  exec uv run --no-sync python manage.py runserver "127.0.0.1:$backend_port" --noreload
) &
backend_pid=$!

(
  cd "$root/frontend"
  export BACKEND_URL="http://127.0.0.1:$backend_port"
  exec node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port "$frontend_port"
) &
frontend_pid=$!

check_servers() {
  if ! kill -0 "$backend_pid" 2>/dev/null; then
    echo 'Django stopped. Check its output above.' >&2
    exit 1
  fi
  if ! kill -0 "$frontend_pid" 2>/dev/null; then
    echo 'Next.js stopped. Check its output above.' >&2
    exit 1
  fi
}

# The proxied health endpoint checks Next.js, Django, and the rewrite together.
health="http://localhost:$frontend_port/api/health/"
echo 'Waiting for both servers to respond...'
for ((attempt = 0; attempt < 30; attempt++)); do
  check_servers
  if curl --fail --silent --max-time 2 "$health" >/dev/null; then
    break
  fi
  sleep 1
done
if ((attempt == 30)); then
  echo 'The API did not become reachable through Next.js. Check the server output above.' >&2
  exit 1
fi

echo "Frontend: http://localhost:$frontend_port"
echo "Backend:  http://127.0.0.1:$backend_port/api/health/"
echo 'Press Ctrl+C to stop both servers.'
while true; do
  check_servers
  sleep 1
done
