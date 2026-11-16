#!/bin/sh
# The browser runs of the measurement, once the GPU is free: null3D's desert walk per kind, with and
# without shadows and with GPU occlusion held on; three.js's meshlet pipeline per kind; then the
# Bistro views in both engines. Each page holds until the one-minute load falls below 8.
# Run from the worktree's root: sh target/group-culling/scripts/runs.sh <set>
set -e
cd "$(dirname "$0")/../pages"
export MESHLETS_MAX_LOAD=8
export MESHLETS_QUIET_WAIT_S=1800
N='null3d.html?view=walk&models=/models/null3d-final&direct=off&pump=1&warmup=8&seconds=40'
T='three.html?view=walk&warmup=8&seconds=40'
case "$1" in
desert)
	MESHLETS_OUT=../results/runs-desert-null3d.json bun run.ts --uncapped \
		"$N" "$N&only=arch" "$N&only=boulder" "$N&only=pebble" "$N&only=column" "$N&only=ground" \
		"$N&shadows=1" "$N&shadows=1&only=arch" "$N&shadows=1&only=pebble" \
		"$N&occlusion=1&occlusion-check=off" "$N&occlusion=1"
	;;
desert-three)
	MESHLETS_OUT=../results/runs-desert-three.json bun run.ts --uncapped \
		"$T" "$T&only=arch" "$T&only=boulder" "$T&only=pebble" "$T&only=column" "$T&only=ground" "$T&shadows=1"
	;;
bistro)
	B='null3d.html?scene=bistro&models=/models/bistro/null3d/bistro.glb&direct=off&pump=1&warmup=6&seconds=15'
	MESHLETS_OUT=../results/runs-bistro-null3d.json bun run.ts --uncapped \
		"$B&view=street" "$B&view=wide" "$B&view=street&shadows=1" "$B&view=wide&shadows=1" \
		"$B&view=street&occlusion=1&occlusion-check=off" "$B&view=wide&occlusion=1&occlusion-check=off"
	;;
bistro-three)
	B='three.html?scene=bistro&warmup=6&seconds=15'
	MESHLETS_OUT=../results/runs-bistro-three.json bun run.ts --uncapped "$B&view=street" "$B&view=wide"
	;;
*)
	echo "usage: runs.sh desert|desert-three|bistro|bistro-three" >&2
	exit 1
	;;
esac
