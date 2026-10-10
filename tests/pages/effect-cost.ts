// Measures what an effect costs on this device: ?effect=bloom (the default), ?effect=ao,
// ?effect=dof or ?effect=effects names it. The last adds ?count= custom effects, 4 by default, to
// bloom's scene. With dof, ?taps= sets the quality setting dofSamples, the gather's taps, which is
// otherwise the preset's.
// ?antialias= sets the engine's anti-aliasing mode: with ?gpu=compat, msaa starts on the 8-bit path
// and fxaa on HDR color, so two loads with count=0 give the cost of the move to HDR color. The effect's scene fills the window at the render scale that ?scale= fixes, 1 by default,
// with the governor off. After a warm-up, the page measures play with the effect off and on in
// turns, three times each, and reports the medians of each side's GPU time per frame, where the
// device has a GPU timer, of its frame interval and CPU time, and of each thread's CPU time. With
// ?gltiming it also reports each side's WebGL calls on the thread that draws, with their time and
// count per frame. The device runner's bloom and ao
// plans run it on each GPU path at the scales of 1 and 0.5. With bloom, ?size= sets the quality
// setting bloomSize, the base of its chain, as the bloom-sizes plan does.
//
// With effects, the effects join (D-71): ?join=off keeps each in a pass of its own, and the page
// reports how long each joined shader took to build, where development builds keep the times.
// ?heavy makes the GPU the limit where it has no timer: 8 effects by default, at the display's
// whole pixel ratio, so the frame interval shows what joining saves.
import { createEngine } from '@null3d/engine';
import {
	JOIN_TIMING_CHANNEL,
	JOIN_TIMING_REQUEST,
	type JoinTimingReport,
} from '../../packages/engine/src/gpu/effect-join';
import {
	GL_TIMING_CHANNEL,
	GL_TIMING_REQUEST,
	type GlTimingReport,
} from '../../packages/engine/src/gpu/webgl2/call-timing';
import { featureCost } from './lib/feature-cost';
import { run } from './lib/result';

/**
 * Each effect's sketch, which turns the effect on at the message of the effect's name, posts
 * 'settled' once its pipelines are built, and turns it off at the name followed by '-off'.
 */
const SKETCHES = {
	bloom: './sketches/bloom-sketch.ts',
	ao: './sketches/ao-sketch.ts',
	dof: './sketches/dof-sketch.ts',
	effects: './sketches/effects-cost-sketch.ts',
	// The temporal anti-aliasing prototype (M2-EX18) and FXAA over MSAA, in the Creek showcase, or
	// in the thin geometry scene with ?scene=thin.
	taa: '../../examples/showcase/creek/sketch.ts',
	msaafxaa: '../../examples/showcase/creek/sketch.ts',
} as const;

type Effect = keyof typeof SKETCHES;

const params = new URLSearchParams(location.search);
const scale = Number(params.get('scale') ?? '1');
const size = params.get('size');
const taps = params.get('taps');
const heavy = params.has('heavy');
const count = params.get('count') ?? (heavy ? '8' : null);
const antialias = params.get('antialias');
if (antialias !== null && antialias !== 'msaa' && antialias !== 'fxaa' && antialias !== 'none')
	throw new Error(`the page takes no anti-aliasing mode ${antialias}`);
const asked = params.get('effect') ?? 'bloom';
if (!Object.hasOwn(SKETCHES, asked)) throw new Error(`the page measures no effect ${asked}`);
const effect = asked as Effect;
// ?gltiming times each WebGL call of the thread that draws. The device runner takes switch names
// of letters only, so the page passes it on as the engine's own ?gl-timing switch.
const glTiming = params.has('gltiming');
if (glTiming && !params.has('gl-timing')) {
	params.set('gl-timing', '');
	history.replaceState(null, '', `${location.pathname}?${params}`);
}

run('effect-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const scene = params.get('scene') ?? '';
	const thin = scene.startsWith('thin') && (effect === 'taa' || effect === 'msaafxaa');
	const sketch = new URL(
		thin ? './sketches/taa-thin-sketch.ts' : SKETCHES[effect],
		import.meta.url,
	);
	sketch.search = `?scale=${scale}&fixed${size === null ? '' : `&size=${size}`}${count === null ? '' : `&count=${count}`}${taps === null ? '' : `&taps=${taps}`}${thin && scene === 'thin-hdr' ? '&bloom' : ''}`;
	const engine = await createEngine({
		canvas,
		sketch,
		antialias: antialias ?? undefined,
		maxPixelRatio: heavy ? devicePixelRatio : undefined,
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const settled = () =>
		new Promise<void>((resolve) => {
			const off = engine.onSketchMessage((name) => {
				if (name !== 'settled') return;
				off();
				resolve();
			});
		});
	// With ?gltiming, the WebGL calls of each side's measurements, from the totals that the thread
	// that draws keeps.
	const glCalls = {
		off: new Map<string, [number, number]>(),
		on: new Map<string, [number, number]>(),
	};
	const glFrames = { off: 0, on: 0 };
	let glLast: GlTimingReport | undefined;
	const glSnapshot = async (side: 'off' | 'on') => {
		if (!glTiming) return;
		const report = await requestGlTiming();
		if (!report) return;
		const before = new Map(glLast?.calls.map((c) => [c.name, c]));
		glFrames[side] += report.frames - (glLast?.frames ?? 0);
		for (const call of report.calls) {
			const was = before.get(call.name);
			const sum = glCalls[side].get(call.name) ?? [0, 0];
			sum[0] += call.ms - (was?.ms ?? 0);
			sum[1] += call.calls - (was?.calls ?? 0);
			glCalls[side].set(call.name, sum);
		}
		glLast = report;
	};
	const glSummary = (side: 'off' | 'on') =>
		[...glCalls[side]]
			.sort((a, b) => b[1][0] - a[1][0])
			.slice(0, 20)
			.map(([name, [ms, calls]]) => ({
				name,
				msPerFrame: +(ms / Math.max(1, glFrames[side])).toFixed(4),
				callsPerFrame: +(calls / Math.max(1, glFrames[side])).toFixed(2),
			}));
	const { off, on } = await featureCost(
		engine,
		async (drawn) => {
			if (!drawn) {
				engine.postToSketch(`${effect}-off`, null);
				return;
			}
			const built = settled();
			engine.postToSketch(effect, null);
			await built;
		},
		glSnapshot,
	);
	const joinBuilds = effect === 'effects' ? await requestJoinTiming() : undefined;
	await engine.destroy();
	return {
		effect,
		tier: engine.capabilities.tier,
		hdr: engine.capabilities.hdr,
		scale,
		bloomSize: size === null ? null : Number(size),
		dofSamples: taps === null ? null : Number(taps),
		effects: effect === 'effects' ? Number(count ?? '4') : null,
		joined: effect === 'effects' ? params.get('join') !== 'off' : null,
		heavy,
		joinBuilds,
		antialias,
		// The window in CSS pixels and the screen's pixel ratio: the preset's cap on the ratio sets
		// the drawing buffer's size from them.
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off,
		on,
		...(glTiming && {
			glTiming: { frames: glFrames, off: glSummary('off'), on: glSummary('on') },
		}),
		failures,
	};
});

/** The thread that draws' WebGL call totals, or undefined when none come: a WebGPU page times none. */
function requestGlTiming(): Promise<GlTimingReport | undefined> {
	const channel = new BroadcastChannel(GL_TIMING_CHANNEL);
	return new Promise<GlTimingReport | undefined>((resolve) => {
		const timeout = setTimeout(() => resolve(undefined), 2000);
		channel.onmessage = (event: MessageEvent<GlTimingReport>) => {
			if (event.data?.type !== 'gl-timing') return;
			clearTimeout(timeout);
			resolve(event.data);
		};
		channel.postMessage(GL_TIMING_REQUEST);
	}).finally(() => channel.close());
}

/**
 * The joined shaders' build times that the thread that draws kept, or undefined when none comes:
 * a release build keeps none.
 */
function requestJoinTiming(): Promise<JoinTimingReport | undefined> {
	const channel = new BroadcastChannel(JOIN_TIMING_CHANNEL);
	return new Promise<JoinTimingReport | undefined>((resolve) => {
		const timeout = setTimeout(() => resolve(undefined), 2000);
		channel.onmessage = (event: MessageEvent<JoinTimingReport>) => {
			if (event.data?.type !== 'join-timing') return;
			clearTimeout(timeout);
			resolve(event.data);
		};
		channel.postMessage(JOIN_TIMING_REQUEST);
	}).finally(() => channel.close());
}
