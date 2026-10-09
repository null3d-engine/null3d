// Runs a comparison with three.js through the shared shell, with one engine: `?compare=` names the
// comparison and `?engine=` the engine. With `?hold=<seconds>`, the engine draws the comparison's
// held frame at its hold count and the page publishes the frame, as the image tests read it. Without
// it, the engine runs live, and the page runs a short ramp and publishes its steps; `?ramp=full`
// runs the device class's whole ramp instead, and `?renderer=webgpu` puts three.js on
// WebGPURenderer on a WebGPU device, or `?renderer=webgl` on WebGLRenderer. `?size=` sets the
// canvas's size in CSS pixels.
import { COMPARISONS } from '../../examples/compare/comparisons';
import { type EngineName, rampComparison, startComparison } from '../../examples/lib/compare';
import { run, toBase64 } from './lib/result';

/** A ramp of three steps, which shows that the shell raises the count and measures each step. */
const SHORT_RAMP = { start: 100, factor: 2, max: 400 };

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
	// The image tests and the short ramp draw three.js with the renderer of the tier; the full ramp
	// takes the faster one unless the address names one.
	const named = params.get('renderer');
	const threeRenderer =
		named === 'webgpu' || named === 'webgl'
			? named
			: full
				? undefined
				: gpu === 'webgpu'
					? 'webgpu'
					: 'webgl';
	const started = await startComparison({
		canvas,
		comparison,
		engine,
		gpu,
		count: hold === undefined ? SHORT_RAMP.start : comparison.hold.count,
		hold,
		threeRenderer,
		stats: hold === undefined,
	});
	const report = { engine, label: started.label, tier: started.gpu, mode: { hold: hold ?? null } };
	if (started.held) {
		const { width, height, pixels } = started.held;
		await started.destroy();
		return { ...report, width, height, pixels: toBase64(pixels) };
	}
	const ramp = await rampComparison(
		started,
		full ? {} : { plan: SHORT_RAMP, warmupSeconds: 1, stepSeconds: 1, settleSeconds: 0.4 },
	);
	await started.destroy();
	return { ...report, ramp };
});
