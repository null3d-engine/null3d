#!/bin/zsh
# Measurement only: S4 on one browser, with one setting changed at a time, in two rounds (the second
# in reverse order), so heat and other load slow each variant alike.
# Usage, from the repository root of a built checkout:
#   zsh bench/ab-s4.sh [--set pixel|pixel-webgpu|pixel-bound|pixel-quick|medium] [--uncapped [--scale <n>]] <runner options...>
# For example: zsh bench/ab-s4.sh --lan ipad-safari    or    zsh bench/ab-s4.sh --set medium Safari
# The pixel set runs S4 at Low, so edge smoothing and the larger shadow filter stay out of the way,
# and takes one per-pixel cost away from WebGL2 in each variant. The pixel-webgpu set takes the same
# costs away from WebGPU, to compare what each one saves on both paths. The pixel-bound set is the
# pixel set at a pixel ratio of 2, so that a fast GPU, such as the Mac's, cannot keep up with the
# display on WebGL2, and the frame rate shows each cost. The medium set changes Medium's settings
# one at a time.
# With --uncapped, Playwright's Chrome runs the pages without waiting for the display (bench:run's
# --uncapped), so the frame interval is the cost when the GPU sets the pace, and the runner options
# are not used, and --scale sets the pages' device pixel ratio. The pixel-quick set is the
# pixel-bound set's controls, unlit materials and no sun shadows. It writes one line per run to target/ab-s4-<set>.tsv, or ab-s4-<set>-uncapped.tsv.
emulate -L zsh
set=pixel
ratio=''
uncapped=''
if [[ $1 == --set ]]; then set=$2; shift 2; fi
scale=1
if [[ $1 == --uncapped ]]; then uncapped=1; shift; fi
if [[ $1 == --scale ]]; then scale=$2; shift 2; fi
case $set in
	pixel-quick)
		base='preset=low&governor=off&render=main'
		ratio='maxPixelRatio=2'
		variants=('webgpu|' 'webgl2|' 'webgl2|material=unlit' 'webgl2|sunShadows=off')
		;;
	pixel|pixel-webgpu|pixel-bound)
		base='preset=low&governor=off&render=main'
		gpu=webgl2
		[[ $set == pixel-webgpu ]] && gpu=webgpu
		# A page reads the first value of a switch, so the pixel ratio variant replaces this one.
		[[ $set == pixel-bound ]] && ratio='maxPixelRatio=2'
		variants=(
			'webgpu|'
			'webgl2|'
			"$gpu|material=unlit"
			"$gpu|material=plain"
			"$gpu|sunShadows=off"
			"$gpu|pointLights=off"
			"$gpu|hdr=off"
			"$gpu|half=on"
			"$gpu|prepass=on"
			"$gpu|maxPixelRatio=${${ratio:+1.5}:-1}"
		)
		;;
	medium)
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
			'webgl2|preset=low'
		)
		;;
	*) print -u2 "unknown set $set: use pixel, pixel-webgpu, pixel-bound, pixel-quick or medium"; exit 2 ;;
esac
out=target/ab-s4-$set${uncapped:+-uncapped}${${scale:#1}:+-x$scale}.tsv
[[ -f $out ]] || print -r -- $'round\tpage\tswitches\trun\tfps\tinterval_ms\tgpu_delay_ms\tgpu_ms\tcpu_ms' > $out
for round in 1 2; do
	order=($variants)
	(( round == 2 )) && order=(${(Oa)variants})
	for v in $order; do
		page=null3d-${v%%|*}
		extra=${v#*|}
		switches=$base${extra:+&$extra}
		[[ -n $ratio && $extra != maxPixelRatio=* ]] && switches+="&$ratio"
		# A later preset= wins over the first, as the page reads the last value.
		[[ $extra == preset=* ]] && switches="governor=off&render=main&$extra"
		if [[ -n $uncapped ]]; then
			before=$(ls -d target/bench/*-bench(N/om[1]) 2>/dev/null)
			bun bench/run.ts --uncapped --scale $scale --scenes s4 --pages $page --runs 1 --seconds 20 \
				--switches "$switches"
			run=$(ls -d target/bench/*-bench(N/om[1]))
			results=($run/s4-$page-1.json(N))
		else
			before=$(ls -d target/runs/*-bench(N/om[1]) 2>/dev/null)
			bun tests/real-browsers.ts --plan bench "$@" --scenes s4 --pages $page --runs 1 --seconds 20 \
				--only bench-s4-$page-1 --switches "$switches"
			run=$(ls -d target/runs/*-bench(N/om[1]))
			results=($run/*/bench-s4-$page-1.json(N))
		fi
		[[ $run == $before ]] && { print "no new run for $v"; continue; }
		for f in $results; do
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
