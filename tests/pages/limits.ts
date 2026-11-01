// Asks the engine for instance batches around its limits: one past the limit that every WebGPU
// device draws, one as large as the device's own limit, and a small one after both. Reports the device's
// limit, what each request returned, and how many pixels the large batch drew. Then asks for a mesh
// larger than engine memory holds, and a small batch after it.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** Rows of the batch that passes the limit every WebGPU device draws. */
const PAST_PORTABLE = 3_000_000;
/** Vertices of a mesh whose buffers, with normals to compute, pass 1 GiB of engine memory. */
const HUGE_MESH = 12_000_000;
/**
 * How long a batch may take to show on a loaded machine, in milliseconds. A capture returns the
 * frame drawn last when no new frame comes within its own wait, so a busy runner can make one
 * capture read the frame from before the batch.
 */
const SHOW_WAIT_MS = 30_000;

interface BatchResult {
	ok: boolean;
	code?: string;
	message?: string;
}

/** The pixels that a batch drew, and how long the page waited for them. */
interface Drawn {
	drawn: number;
	waitedMs: number;
}

/** The objects that the scene has room for: its rows, but for the row of slot 0, which no object takes. */
const SCENE_OBJECTS = 16_383;

run('limits', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const replies = new Map<string, (data: unknown) => void>();
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/limit-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
		// The scene's places count toward the GPU's limit, so they stay at a known number.
		expectedObjects: SCENE_OBJECTS,
		onSketchMessage: (name, data) => replies.get(name)?.(data),
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	const ask = <T>(name: string, reply: string, data?: unknown) =>
		new Promise<T>((resolve) => {
			replies.set(reply, resolve as (data: unknown) => void);
			engine.postToSketch(name, data);
		});
	const batch = (count: number) => ask<BatchResult>('batch', 'batch', count);
	const drawnPixels = async () => {
		await engine.measure(1);
		const { pixels } = await engine.captureFrame();
		let lit = 0;
		for (let i = 0; i < pixels.length; i += 4) if ((pixels[i] ?? 0) > 128) lit++;
		return lit;
	};
	/** The pixels a batch draws once one of its frames shows, waiting out a loaded machine. */
	const drawnPixelsSoon = async (): Promise<Drawn> => {
		const start = performance.now();
		let drawn = 0;
		while (drawn === 0 && performance.now() - start < SHOW_WAIT_MS) drawn = await drawnPixels();
		return { drawn, waitedMs: Math.round(performance.now() - start) };
	};

	await engine.firstFrame;
	const { maxInstances } = engine.capabilities;
	const pastPortable = await batch(PAST_PORTABLE);
	const pastPortableShown = pastPortable.ok ? await drawnPixelsSoon() : { drawn: 0, waitedMs: 0 };
	if (pastPortable.ok) await ask('destroy', 'destroyed');
	// The scene's object slots count toward the limit, so this batch fills it exactly.
	const full = await batch(maxInstances - (SCENE_OBJECTS + 1));
	if (full.ok) await ask('destroy', 'destroyed');
	const after = await batch(1000);
	const afterShown = after.ok ? await drawnPixelsSoon() : { drawn: 0, waitedMs: 0 };
	const hugeMesh = await ask<BatchResult>('mesh', 'mesh', HUGE_MESH);
	await ask('destroy', 'destroyed');
	const afterMesh = await batch(1000);
	const afterMeshShown = afterMesh.ok ? await drawnPixelsSoon() : { drawn: 0, waitedMs: 0 };
	await engine.destroy();
	return {
		mode: engine.mode,
		maxInstances,
		pastPortable,
		pastPortableDrawn: pastPortableShown.drawn,
		pastPortableWaitMs: pastPortableShown.waitedMs,
		full,
		after,
		afterDrawn: afterShown.drawn,
		afterWaitMs: afterShown.waitedMs,
		hugeMesh,
		afterMesh,
		afterMeshDrawn: afterMeshShown.drawn,
		afterMeshWaitMs: afterMeshShown.waitedMs,
		failures,
	};
});
