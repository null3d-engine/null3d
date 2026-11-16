#!/bin/bash
# Times the desert's lap with null3D at its default and at a camera threshold of 2 px, without and
# with the sun's shadows, through the repository's benchmark runner. Before each timing it waits
# until the computer's 1-minute load falls below 8, and it prints the load at the start.
# Run from the repository's root: bash bench/research/triangle-budget/scripts/timings.sh <log folder>
out=${1:-target/triangle-budget}
for switches in "" "lod=2" "shadows=3" "shadows=3&lod=2"; do
	until [ "$(sysctl -n vm.loadavg | awk '{print ($2 < 8)}')" = "1" ]; do sleep 15; done
	name=$(echo "default${switches:+-$switches}" | tr '=&' '--')
	echo "$name: load at start $(sysctl -n vm.loadavg)"
	if [ -n "$switches" ]; then
		bun run bench:run --scenes desert --pages null3d-webgpu --runs 3 --seconds 10 --switches "$switches" > "$out/bench-$name.log" 2>&1
	else
		bun run bench:run --scenes desert --pages null3d-webgpu --runs 3 --seconds 10 > "$out/bench-$name.log" 2>&1
	fi
	grep -E "^\| desert \| null3d-webgpu \| null3d|load average|^results" "$out/bench-$name.log"
done
