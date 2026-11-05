# Compares two picture-test logs, test by test: the share of pixels that differ from each reference
# in a run of one engine build and in a run of another. A test that fails by the same share in both
# fails for a reason that the change between the builds did not bring.
# Run: python3 bench/research/triangle-budget/scripts/picture-diff.py <base log> <changed log>
import re
import sys

PATTERN = re.compile(r"pipelined: ([0-9.]+)% of pixels differ from the reference chrome-real-gpu/(\w+)/([\w-]+)\.png")


def shares(path):
    found = {}
    for match in PATTERN.finditer(open(path).read()):
        share, tier, test = match.groups()
        found[f"{test} {tier}"] = float(share)
    return found


base, changed = shares(sys.argv[1]), shares(sys.argv[2])
print(f"{'test':48} {'base %':>8} {'changed %':>10}")
for key in sorted(set(base) | set(changed)):
    a, b = base.get(key), changed.get(key)
    mark = "" if a is not None and b is not None and abs(a - b) < 0.01 else "  <- differs"
    print(f"{key:48} {'' if a is None else a:>8} {'' if b is None else b:>10}{mark}")
