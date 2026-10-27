// Measures what an effect costs on this device: ?effect=bloom (the default), ?effect=ao,
// ?effect=dof, ?effect=subsurface, ?effect=exposure, ?effect=fog, ?effect=contact (the sun's contact
// shadows, with ?steps= steps per march, 8 by default), ?effect=sky, ?effect=effects, ?effect=tone,
// ?effect=vignette, ?effect=sharpen, ?effect=lens or ?effect=motion names it. The effects effect adds ?count=
// custom effects, 4 by default, to bloom's scene. Motion measures the motion vectors with their
// debug view, so it runs in development builds only. ?effect=area measures ?count= area lights over the light scenes' floor,
// 4 by default: rectangle lights, or ?kind=point or ?kind=tube lights, and ?image gives the rectangle
// lights pictures. With exposure, ?meter=downsample asks for the downsample meter, which is
// otherwise the preset's. The physical sky's side is measured against three.js's analytic sky,
// or a color with ?base=none, with the sun still, or moving in every frame with ?moving. With
// dof, ?taps= sets the quality setting dofSamples, the gather's taps, which is otherwise the
// preset's. With fog, the volumetric fog, ?slices= sets the quality setting fogSlices, and
// ?night draws its night scene of street lamps in place of the low sun. Subsurface draws the
// subsurface test's two panels, one of skin, and its ?taps= sets the quality setting
// subsurfaceSamples. The tone effect is
// punchy AgX against plain AgX, in bloom's scene with bloom off. The vignette effect draws lit
// boxes over a background color: with ?fill=covered a wall of them covers the view, else the
// background covers most of it. ?background=none leaves out its background color. The sharpen
// effect draws the same wall of boxes, in two colors, and sharpens it at `?strength=`, 0.6 by
// default, at the whole canvas's render scale, where the sharpening runs in the second step of the
// two-step pass.
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
	GL_TIMING_CHANNEL,
	GL_TIMING_REQUEST,
	type GlTimingReport,
} from '../../packages/engine/src/gpu/webgl2/call-timing';
import { featureCost } from './lib/feature-cost';
import { requestJoinTiming } from './lib/join-timing';
import { overlayMemory, waitForOverlay } from './lib/overlay-figures';
import { run } from './lib/result';
import type { SideMemory } from './lib/side-memory';

/**
 * Each effect's sketch, which turns the effect on at the message of the effect's name, posts
 * 'settled' once its pipelines are built, and turns it off at the name followed by '-off'.
 */
const SKETCHES = {
	bloom: './sketches/bloom-sketch.ts',
	ao: './sketches/ao-sketch.ts',
	tone: './sketches/bloom-sketch.ts',
	dof: './sketches/dof-sketch.ts',
	subsurface: './sketches/subsurface-sketch.ts',
	exposure: './sketches/exposure-sketch.ts',
	contact: './sketches/contact-shadows-sketch.ts',
	fog: './sketches/fog-volume-sketch.ts',
	effects: './sketches/effects-cost-sketch.ts',
	motion: './sketches/motion-cost-sketch.ts',
	area: './sketches/area-cost-sketch.ts',
	sky: './sketches/sky-cost-sketch.ts',
	vignette: './sketches/vignette-cost-sketch.ts',
	sharpen: './sketches/sharpen-cost-sketch.ts',
	lens: './sketches/lens-cost-sketch.ts',
	compute: './sketches/compute-cost-sketch.ts',
} as const;

type Effect = keyof typeof SKETCHES;

const params = new URLSearchParams(location.search);
const scale = Number(params.get('scale') ?? '1');
const size = params.get('size');
const taps = params.get('taps');
const meter = params.get('meter');
const slices = params.get('slices');
const night = params.has('night');
const fill = params.get('fill');
const background = params.get('background');
const steps = params.get('steps');
const strength = params.get('strength');
const moving = params.has('moving');
const aoScale = params.get('aoscale');
const base = params.get('base');
const heavy = params.has('heavy');
const count = params.get('count') ?? (heavy ? '8' : null);
const antialias = params.get('antialias');
if (antialias !== null && antialias !== 'msaa' && antialias !== 'fxaa' && antialias !== 'none')
	throw new Error(`the page takes no anti-aliasing mode ${antialias}`);
/** A pixel ratio held for both sides, for a cost that the canvas size would otherwise hide. */
const pixelRatio = params.get('pixel-ratio');
if (pixelRatio !== null && !(Number(pixelRatio) >= 0.5))
	throw new Error(`the page takes no pixel ratio ${pixelRatio}`);
/** A case's own look, such as one mark of an effect, passed on to its sketch. */
const look = params.get('look');
/** The rounds of each side, with the sides in the opposite order on alternate rounds. */
const rounds = params.get('rounds');
if (rounds !== null && !(Number.isSafeInteger(Number(rounds)) && Number(rounds) >= 1))
	throw new Error(`the page takes no round count ${rounds}`);
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
	const sketch = new URL(SKETCHES[effect], import.meta.url);
	const kind = params.get('kind');
	const area = `${kind === null ? '' : `&kind=${kind}`}${params.has('image') ? '&image' : ''}`;
	sketch.search = `?scale=${scale}&fixed${size === null ? '' : `&size=${size}`}${count === null ? '' : `&count=${count}`}${taps === null ? '' : `&taps=${taps}`}${meter === null ? '' : `&meter=${meter}`}${slices === null ? '' : `&slices=${slices}`}${steps === null ? '' : `&steps=${steps}`}${strength === null ? '' : `&strength=${strength}`}${aoScale === null ? '' : `&aoscale=${aoScale}`}${area}${moving ? '&moving' : ''}${base === null ? '' : `&base=${base}`}${fill === null ? '' : `&fill=${fill}`}${background === null ? '' : `&background=${background}`}${night ? '&night' : ''}${look === null ? '' : `&look=${encodeURIComponent(look)}`}`;
	const engine = await createEngine({
		canvas,
		sketch,
		antialias: antialias ?? undefined,
		maxPixelRatio: heavy ? devicePixelRatio : pixelRatio === null ? undefined : Number(pixelRatio),
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const settled = () =>
		new Promise<void>((resolve) => {
			// A message that the sketch sent before this handler waited is handed over as this call
			// registers it, so the stop call must already exist when the handler first runs.
			let stop: () => void = () => {};
			stop = engine.onSketchMessage((name) => {
				if (name !== 'settled') return;
				stop();
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
		rounds === null ? undefined : { rounds: Number(rounds), alternate: true },
	);
	// The memory figures come from the overlay, which samples the GPUs' tables and the wasm file.
	// It shows after the timing, so its sampling costs none of the frames above.
	const wasmBytes = (await engine.measure(0.5)).memory.wasmBytes;
	const memory: { off?: SideMemory; on?: SideMemory } = {};
	for (const side of ['off', 'on'] as const) {
		engine.postToSketch(side === 'on' ? effect : `${effect}-off`, null);
		engine.stats(true);
		const ready = await waitForOverlay('triangles');
		memory[side] = { ready, ...overlayMemory(wasmBytes) };
		engine.stats(false);
	}
	const joinBuilds = effect === 'effects' ? await requestJoinTiming() : undefined;
	await engine.destroy();
	return {
		effect,
		tier: engine.capabilities.tier,
		hdr: engine.capabilities.hdr,
		scale,
		bloomSize: size === null ? null : Number(size),
		dofSamples: effect === 'dof' && taps !== null ? Number(taps) : null,
		subsurfaceSamples: effect === 'subsurface' && taps !== null ? Number(taps) : null,
		exposureMeter: meter,
		fogSlices: slices === null ? null : Number(slices),
		sharpenStrength: effect === 'sharpen' && strength !== null ? Number(strength) : null,
		night,
		effects: effect === 'effects' ? Number(count ?? '4') : null,
		lights:
			effect === 'area'
				? { count: Number(count ?? '4'), kind: kind ?? 'rect', image: params.has('image') }
				: null,
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
		memory,
		// The line that the two-step probe printed, for the plan that asks for it, which keeps it in
		// the run's result to read beside the other browsers' lines.
		twoStep: (globalThis as { __null3dTwoStep?: string }).__null3dTwoStep ?? null,
		...(glTiming && {
			glTiming: {
				frames: glFrames,
				off: glSummary('off'),
				on: glSummary('on'),
				// The measured frame's calls in order, which a stand-alone page can replay.
				slowestFrame: glLast?.slowestFrame,
			},
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
