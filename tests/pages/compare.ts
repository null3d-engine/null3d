// Runs a comparison with three.js through the shared shell, with one engine: `?compare=` names the
// comparison, `?engine=` the engine, and `?effects=` the effects, every one by default. With `?hold=<seconds>`, the engine draws the comparison's
// held frame at its hold count, or at `?count=`, and the page publishes the frame, as the image
// tests read it. Without
// it, the engine runs live, and the page runs a short ramp and publishes its steps; `?ramp=full`
// runs the device class's whole ramp instead, and `?renderer=webgpu` or `?renderer=webgl` puts
// three.js on that renderer in place of the one that the GPU path names. `?measure=<count>`
// runs at that count in place of a ramp, and measures the frames over `?seconds=` (5 by default)
// and then the whole page's memory, which `?memory=off` leaves out, as the browser can take a
// minute or more to measure it. `?size=` sets the canvas's size in CSS pixels. `?max=` sets the
// most the count reaches, in place of the device class's ramp maximum. `?warmup=` sets the seconds
// the page runs before a ramp or a measurement starts, so a scene that makes its objects over many
// frames has made them all. `?step=` sets the seconds of each step of the short ramp, which settles
// for 0.4 of each step and measures the rest.
import { measurePageMemory } from '@null3d/engine/stats';
import { COMPARISONS } from '../../examples/compare/comparisons';
import type { SceneSignature } from '../../examples/compare/scene-signature';
import { type EngineName, rampComparison, startComparison } from '../../examples/lib/compare';
import { effectsFromText } from '../../examples/lib/compare-scene';
import { run, toBase64 } from './lib/result';

/** A ramp of three steps, which shows that the shell raises the count and measures each step. */
const SHORT_RAMP = { start: 100, factor: 2, max: 400 };

/**
 * The browser's measurement of the page's memory in parts: bytes per thread scope and script, and
 * per kind of memory, as Chrome reports them. A memory that threads share shows in each of them.
 */
async function memoryParts(): Promise<Record<string, number> | null> {
	// Chromium's headless shell throws in place of measuring, and the page then reports no parts.
	const measured = await measurePageMemory()?.catch(() => null);
	if (!measured) return null;
	const { breakdown } = measured;
	const parts: Record<string, number> = {};
	for (const { bytes, types, attribution } of breakdown) {
		const where =
			attribution.map((a) => `${a.scope ?? '?'} ${a.url?.split('/').pop() ?? ''}`).join('+') ||
			'unattributed';
		const key = `${where} [${(types ?? []).join(',')}]`;
		parts[key] = (parts[key] ?? 0) + bytes;
	}
	return parts;
}

run('compare', async () => {
	const params = new URLSearchParams(location.search);
	const comparison = COMPARISONS.find((entry) => entry.name === params.get('compare'));
	if (!comparison)
		throw new Error(`Add ?compare= with a comparison's name, not ${params.get('compare')}.`);
	const engine = params.get('engine') as EngineName;
	if (engine !== 'null3d' && engine !== 'threejs')
		throw new Error(`Add ?engine=null3d or ?engine=threejs, not ${engine}.`);
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	// `?size=1280x720` draws a larger canvas than the image tests' one, as a ramp on a desktop does.
	const [width, height] = (params.get('size') ?? '').split('x').map(Number);
	if (width && height) Object.assign(canvas.style, { width: `${width}px`, height: `${height}px` });
	const gpu = params.get('gpu') === 'webgl2' ? 'webgl2' : 'webgpu';
	const hold = params.has('hold') ? Number(params.get('hold')) : undefined;
	const full = params.get('ramp') === 'full';
	const fixed = params.has('measure') ? Number(params.get('measure')) : undefined;
	const warmup = params.has('warmup') ? Number(params.get('warmup')) : undefined;
	// three.js draws on the renderer of the GPU path unless the address names one.
	const named = params.get('renderer');
	const threeRenderer = named === 'webgpu' || named === 'webgl' ? named : undefined;
	const started = await startComparison({
		canvas,
		comparison,
		engine,
		effects: effectsFromText(params.get('effects')),
		gpu,
		count:
			hold === undefined
				? (fixed ?? SHORT_RAMP.start)
				: Number(params.get('count') ?? comparison.hold.count),
		hold,
		threeRenderer,
		stats: hold === undefined,
		maxCount: params.has('max') ? Number(params.get('max')) : undefined,
	});
	const report = {
		engine,
		label: started.label,
		tier: started.gpu,
		limit: started.limit ?? null,
		mode: { hold: hold ?? null },
	};
	if (started.held) {
		const { width, height, pixels } = started.held;
		await started.destroy();
		return { ...report, width, height, pixels: toBase64(pixels) };
	}
	if (fixed !== undefined) {
		started.collapseStats(true);
		await new Promise((resolve) => setTimeout(resolve, (warmup ?? 2) * 1000));
		const frames = await started.measure(Number(params.get('seconds') ?? 5));
		const skipMemory = params.get('memory') === 'off';
		const memory = skipMemory ? null : await started.measureMemory();
		const parts = skipMemory ? null : await memoryParts();
		await started.destroy();
		return { ...report, measured: { count: started.count, ...frames, memory, parts } };
	}
	const step = Number(params.get('step') ?? 1);
	// `?probe=1` asks the sketch for its scene signature at each ramp step, which the ramp's tests
	// read to check that the scene keeps moving.
	const probing = params.has('probe');
	const signatures: Promise<SceneSignature | null>[] = [];
	const onStep = probing
		? () => signatures.push(started.sceneSignature?.() ?? Promise.resolve(null))
		: undefined;
	const ramp = await rampComparison(
		started,
		full
			? { warmupSeconds: warmup, onStep }
			: {
					// A run with a limit below the short ramp's top, such as three.js's light limit on
					// WebGLRenderer, stops there.
					plan: { ...SHORT_RAMP, max: Math.min(SHORT_RAMP.max, started.plan.max) },
					warmupSeconds: warmup ?? 1,
					stepSeconds: step,
					settleSeconds: step * 0.4,
					onStep,
				},
	);
	await started.destroy();
	if (probing) return { ...report, ramp, signatures: await Promise.all(signatures) };
	return { ...report, ramp };
});
