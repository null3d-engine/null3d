#!/bin/zsh
# Measurement only: S4 at Medium on one browser, with one setting changed at a time, in two rounds
# (the second in reverse order), so heat and other load slow each variant alike.
# Usage, from the repository root of a built checkout:
#   zsh bench/ab-s4-medium.sh <runner options...>
# For example: zsh bench/ab-s4-medium.sh --lan ipad-safari    or    zsh bench/ab-s4-medium.sh Safari
# It writes one line per run to target/ab-s4-medium.tsv.
emulate -L zsh
base='preset=medium&governor=off&render=main'
variants=(
	'webgpu|'
	'webgl2|'
	'webgl2|antialias=fxaa'
	'webgl2|maxPixelRatio=1.5'
	'webgl2|shadowFilter=3'
	'webgl2|shadowCascades=2&shadowMapSize=1024'
	'webgl2|far=4'
	'webgl2|shadowCascadeBlend=0'
	'webgl2|occlusion=off'
	'webgl2|glshadow=implicit'
	'webgl2|glshadow=nearest'
	'webgl2|glshadow=fetch'
	'webgl2|preset=low'
)
out=target/ab-s4-medium.tsv
[[ -f $out ]] || print -r -- $'round\tpage\tswitches\trun\tfps\tinterval_ms\tgpu_delay_ms\tgpu_ms\tcpu_ms' > $out
for round in 1 2; do
	order=($variants)
	(( round == 2 )) && order=(${(Oa)variants})
	for v in $order; do
		page=null3d-${v%%|*}
		extra=${v#*|}
		switches=$base${extra:+&$extra}
		# A later preset= wins over the first, as the page reads the last value.
		[[ $extra == preset=* ]] && switches="governor=off&render=main&$extra"
		before=$(ls -d target/runs/*-bench(N/om[1]) 2>/dev/null)
		bun tests/real-browsers.ts --plan bench "$@" --scenes s4 --pages $page --runs 1 --seconds 20 \
			--only bench-s4-$page-1 --switches "$switches"
		run=$(ls -d target/runs/*-bench(N/om[1]))
		[[ $run == $before ]] && { print "no new run for $v"; continue; }
		for f in $run/*/bench-s4-$page-1.json(N); do
			bun -e '
				const r = await Bun.file(process.argv[1]).json();
				const s = r.stats ?? {};
				const m = (x) => (x?.median ?? NaN).toFixed(2);
				console.log([process.argv[2], process.argv[3], process.argv[4], process.argv[5],
					(s.presentedFps ?? NaN).toFixed(1), m(s.intervalMs), m(s.gpuLatencyMs), m(s.gpuMs),
					m(s.cpuMs)].join("\t"));
			' $f $round $page "$extra" ${run:t} | tee -a $out
		done
	done
done
