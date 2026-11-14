# Prints what each hidden part saves in each load of the phones study: the step's GPU time and
# triangles against the mean of the whole-scene windows just before and after it, which cancels a
# slow drift over the load. Settings steps stack, so each is read against the step before it.
#   python3 bench/research/island-phones/scripts/summary.py <result files>
import json
import sys

for f in sorted(sys.argv[1:]):
    d = json.load(open(f))
    r = d['result']
    if not r.get('ok'):
        print('==', d['name'], 'failed:', r.get('error'))
        continue
    ws = r['windows']
    bases = [w['gpuMs'] for w in ws if w['step'] == 'base']
    tris = [w['triangles'] for w in ws if w['step'] == 'base']
    vp = r['census']['viewport']
    print('== %s  %dx%d  load %.1f->%.1f  base gpu %.2f ms (%.2f-%.2f), %.2fM triangles, %d draws' % (
        d['name'], vp['width'], vp['height'], d['loadBefore'], d['loadAfter'],
        sum(bases) / len(bases), min(bases), max(bases), min(tris) / 1e6,
        min(w['drawCalls'] for w in ws if w['step'] == 'base')))
    for i, w in enumerate(ws):
        if w['step'] == 'base':
            continue
        if w['step'].startswith('set:'):
            ref = ws[i - 1]
            around = [ref['gpuMs']]
            ref_tri = ref['triangles']
        else:
            around = [x['gpuMs'] for x in (ws[i - 1], ws[i + 1] if i + 1 < len(ws) else ws[i - 1])
                      if x['step'] == 'base']
            ref_tri = min(x['triangles'] for x in ws if x['step'] == 'base')
        mean = sum(around) / len(around)
        print('   %-34s gpu %5.2f  saves %5.2f ms (%3.0f%%)  triangles %5.2fM (%+.2fM)' % (
            w['step'][:34], w['gpuMs'], mean - w['gpuMs'], 100 * (mean - w['gpuMs']) / mean,
            w['triangles'] / 1e6, (w['triangles'] - ref_tri) / 1e6))
