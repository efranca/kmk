#!/usr/bin/env bash
# Scan the dependencies for known vulnerabilities. Exit 0 only if both ecosystems are clean.
#   Python:     pip-audit on the installed backend environment (any known vulnerability counts)
#   JavaScript: npm audit for production dependencies, "high" severity or worse
# Needs network access (it queries the public vulnerability databases). Run it before every deploy.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
py_status=0
js_status=0

echo "== Python (pip-audit) =="
PIP_AUDIT="$ROOT/backend/.venv/bin/pip-audit"
if [[ ! -x "$PIP_AUDIT" ]]; then
  echo "pip-audit is not installed. Run: cd backend && .venv/bin/pip install -e '.[dev]'" >&2
  py_status=1
else
  "$PIP_AUDIT" --skip-editable || py_status=$?
fi

echo
echo "== JavaScript (npm audit, production dependencies, high or worse) =="
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed" >&2
  js_status=1
else
  (cd "$ROOT/frontend" && npm audit --omit=dev --audit-level=high) || js_status=$?
fi

echo
echo "== Summary =="
if [[ $py_status -eq 0 ]]; then echo "Python:     clean"; else echo "Python:     FINDINGS (or the scan could not run)"; fi
if [[ $js_status -eq 0 ]]; then echo "JavaScript: clean"; else echo "JavaScript: FINDINGS (or the scan could not run)"; fi
[[ $py_status -eq 0 && $js_status -eq 0 ]]
