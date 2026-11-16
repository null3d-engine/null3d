# Prints the phones study's results: each load's machine load, the drawing size, the objects of each
# part, and for each step its GPU time, frame interval, triangles, draws and the GPU parts of the frame.
#   python3 bench/research/island-phones/scripts/show.py <result files>
import json
import sys

for f in sorted(sys.argv[1:]):
    d = json.load(open(f))
    r = d['result']
    print('==', d['name'], 'round', d['round'], 'load %.1f->%.1f' % (d['loadBefore'], d['loadAfter']),
          'errors', d['errors'][:2], 'display', d['displayProblem'])
    if not r.get('ok'):
        print(r.get('error'))
        continue
    c = r['census']
    print('  viewport', c['viewport'], 'preset', c['preset'])
    print('  groups', {k: (v['objects'], v['rows']) for k, v in c['groups'].items() if v['objects']})
    for w in r['windows']:
        parts = ' '.join('%s=%.2f' % (k.replace('shadow cascade ', 'c').replace(' passes', ''), v)
                         for k, v in w['gpuPassMs'].items() if v > 0.05)
        print('  %-44s gpu %6.2f  int %6.2f tri %5.2fM draws %6d  %s' % (
            w['step'][:44], w['gpuMs'], w['intervalMs'], w['triangles'] / 1e6, w['drawCalls'], parts))
