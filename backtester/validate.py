"""
Port-validation harness: compares JS signal engine output to Python port.
HARD GATE — exits non-zero if any case diverges beyond tolerance.

Usage:
    python validate.py
"""
import json
import math
import os
import subprocess
import sys

REPO  = os.path.dirname(__file__)
TESTS = os.path.join(REPO, 'tests')
FIXTURES_PATH   = os.path.join(TESTS, 'fixtures.json')
JS_RESULTS_PATH = os.path.join(TESTS, 'js_results.json')

TOLERANCE = 0.001  # absolute tolerance for float comparison

# ── generate fixtures if missing ──────────────────────────────────────────

if not os.path.exists(FIXTURES_PATH):
    print('Generating fixtures...')
    r = subprocess.run([sys.executable, os.path.join(REPO, 'generate_fixtures.py')], check=True)

# ── run JS engine ─────────────────────────────────────────────────────────

print('Running JS engine...')
r = subprocess.run(['node', os.path.join(REPO, 'run_js_engine.js')], capture_output=True, text=True)
if r.returncode != 0:
    print('JS engine failed:')
    print(r.stderr)
    sys.exit(1)
print(r.stdout.strip())

# ── load both results ─────────────────────────────────────────────────────

with open(FIXTURES_PATH)   as f: fixtures    = json.load(f)
with open(JS_RESULTS_PATH) as f: js_results  = json.load(f)

js_by_id = {r['id']: r['result'] for r in js_results}

# ── run Python engine ─────────────────────────────────────────────────────

sys.path.insert(0, REPO)
from signal_engine import generate_signal

NUMERIC_FIELDS = ['entry', 'stop', 'tp1', 'tp2', 'atr', 'confidence', 'rr', 'total']

# ── comparison ────────────────────────────────────────────────────────────

failures = []
passes   = []

for fix in fixtures:
    fid    = fix['id']
    js_res = js_by_id.get(fid)

    try:
        py_res = generate_signal(
            candles      = fix['candles'],
            verdicts     = fix['verdicts'],
            weights      = fix['weights'],
            last_signal  = fix.get('last_signal'),
            candle_idx   = fix.get('candle_idx'),
        )
    except Exception as e:
        failures.append({'id': fid, 'group': fix['group'], 'desc': fix['desc'],
                         'reason': f'Python raised: {e}', 'js': js_res, 'py': None})
        continue

    # Both null → pass
    if js_res is None and py_res is None:
        passes.append(fid)
        continue

    # One null, other not → fail
    if (js_res is None) != (py_res is None):
        failures.append({'id': fid, 'group': fix['group'], 'desc': fix['desc'],
                         'reason': f'null mismatch: js={js_res is None}, py={py_res is None}',
                         'js': js_res, 'py': py_res})
        continue

    # JS returned error
    if isinstance(js_res, dict) and 'error' in js_res:
        failures.append({'id': fid, 'group': fix['group'], 'desc': fix['desc'],
                         'reason': f'JS error: {js_res["error"]}', 'js': js_res, 'py': py_res})
        continue

    # Compare action
    if js_res.get('action') != py_res.get('action'):
        failures.append({'id': fid, 'group': fix['group'], 'desc': fix['desc'],
                         'reason': f'action mismatch: js={js_res.get("action")}, py={py_res.get("action")}',
                         'js': js_res, 'py': py_res})
        continue

    # Compare numeric fields
    field_fails = []
    for field in NUMERIC_FIELDS:
        jv = js_res.get(field)
        pv = py_res.get(field)
        if jv is None and pv is None:
            continue
        if jv is None or pv is None:
            field_fails.append(f'{field}: js={jv} py={pv}')
            continue
        if not math.isfinite(jv) and not math.isfinite(pv):
            continue
        if abs(jv - pv) > TOLERANCE:
            field_fails.append(f'{field}: js={jv:.8f} py={pv:.8f} Δ={abs(jv-pv):.2e}')

    if field_fails:
        failures.append({'id': fid, 'group': fix['group'], 'desc': fix['desc'],
                         'reason': 'numeric divergence: ' + '; '.join(field_fails),
                         'js': js_res, 'py': py_res})
    else:
        passes.append(fid)

# ── report ────────────────────────────────────────────────────────────────

total = len(fixtures)
print(f'\n{"="*60}')
print(f'VALIDATION REPORT  ({total} fixtures, tolerance={TOLERANCE})')
print(f'{"="*60}')
print(f'  PASS: {len(passes)}/{total}')
print(f'  FAIL: {len(failures)}/{total}')

if failures:
    print(f'\n{"─"*60}')
    print('FAILURES:')
    for i, fail in enumerate(failures, 1):
        print(f'\n  [{i}] {fail["id"]} ({fail["group"]}) — {fail["desc"]}')
        print(f'      REASON: {fail["reason"]}')
        if fail.get('js') is not None and fail.get('py') is not None:
            for field in NUMERIC_FIELDS + ['action']:
                jv = fail['js'].get(field) if isinstance(fail['js'], dict) else 'N/A'
                pv = fail['py'].get(field) if isinstance(fail['py'], dict) else 'N/A'
                if jv != pv:
                    print(f'      {field:12s}  js={jv}  py={pv}')
    print(f'\n{"="*60}')
    print('GATE: FAIL — do not proceed to Phase 1C until all cases pass.')
    sys.exit(1)
else:
    print(f'\n{"="*60}')
    print('GATE: PASS — Python port matches JS within tolerance on all 60 cases.')
    print('Phase 1B complete. Ready for Phase 1C (data fetcher).')
    sys.exit(0)
