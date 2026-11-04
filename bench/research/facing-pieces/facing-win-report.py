import json
import statistics
import sys
from collections import defaultdict

# facing-win-report.py <runs.jsonl>: per copy, the median and lowest quartile of each figure over
# the windows that a reference pass marks undisturbed.
REFERENCE = ('shadow cascade', 'ambient occlusion')


def q1(values):
    values = sorted(values)
    return values[len(values) // 4] if values else float('nan')


windows = defaultdict(list)
visits = []
for line in open(sys.argv[1]):
    r = json.loads(line)
    visits.append(r)
    if r['bad']:
        continue
    for w in r['result']['windows']:
        passes = {p['name']: p['ms']['median'] for p in w['gpuPassMs']}
        ref = sum(v for k, v in passes.items() if k.startswith(REFERENCE))
        windows[r['folder']].append({'w': w, 'passes': passes, 'ref': ref, 'load': r['gated'], 'apps': r['apps']})

all_refs = [x['ref'] for ws in windows.values() for x in ws]
ref_median = statistics.median(all_refs)
print(f'reference passes (shadow cascades + ambient occlusion): median {ref_median:.2f} ms over all windows')
for r in visits:
    print(f"  {r['folder'].split('/')[-1]} visit {r['visit']} attempt {r['attempt']} load {r['gated']:.1f}->{r['after']:.1f}{' INVALID: ' + r['problems'][0][:80] if r['bad'] else ''} | top app {r['apps'][0] if r['apps'] else ''}")
for folder, ws in windows.items():
    kept = [x for x in ws if abs(x['ref'] - ref_median) <= 0.15 * ref_median]
    print(f"\n{folder}: {len(kept)} of {len(ws)} windows undisturbed")
    def stat(values):
        return f"median {statistics.median(values):6.2f}  q1 {q1(values):6.2f}"
    print(f"  gpu ms        {stat([x['w']['gpuMs']['median'] for x in kept])}")
    print(f"  interval ms   {stat([x['w']['intervalMs']['median'] for x in kept])}")
    print(f"  triangles M   {stat([x['w']['triangles']['median'] / 1e6 for x in kept])}")
    print(f"  draws         {stat([x['w']['drawCalls']['median'] for x in kept])}")
    names = []
    for x in kept:
        for k in x['passes']:
            if k not in names:
                names.append(k)
    for k in names:
        values = [x['passes'][k] for x in kept if k in x['passes']]
        print(f"  {k:20} {stat(values)}  ({len(values)} windows)")
