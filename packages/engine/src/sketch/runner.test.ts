import { describe, expect, it, spyOn } from 'bun:test';
import { messageOf } from '../errors/message';
import * as C from '../generated/core';
import { FORMAT_RGBA16_FLOAT } from '../generated/gpu';
import type { EngineCapabilities } from '../page/engine';
import { presetSettings } from '../quality/presets';
import type { Material, MeshGeometry } from '../scene/resources';
import {
	controlViews,
	createControlBuffer,
	frameAfter,
	frameReached,
	nextFrame,
	Slot,
} from '../shared/control';
import type { CoreGlue } from '../shared/core';
import { onEngineStop } from '../shared/helper-workers';
import { createMetricsBuffer, FrameRecorder, Role } from '../shared/metrics';
import { defineSketch, type SketchContext, type SketchOptions } from './define-sketch';
import type { QualityStart, QualityUpdate } from './quality';
import { runPipelined, SketchRunner } from './runner';

/** The core's frame steps, which the tests follow among the sketch's callbacks. */
const FRAME_STEPS = new Set([
	'beginFrame',
	'updateTransforms',
	'updateLateTransforms',
	'updateBatches',
	'cullFrame',
	'recordFrame',
]);

const CAPABILITIES: EngineCapabilities = {
	tier: 'webgl2',
	threaded: false,
	features: ['WEBGL_multi_draw'],
	limits: {},
	hdr: true,
	halfPrecision: false,
	maxInstances: 2_097_152,
	maxCanvasSize: 4096,
	depth: 'reversed',
};

/** Scene slots of the fake core, and records of its command ring. */
const CAPACITY = 15;
const RING = 64;
/** The fake core's first ring block, past room for every scene field. */
const RING_BLOCK = 16;

/** The calls whose arguments the fake core keeps. */
const KEPT_ARGUMENTS = new Set([
	'recordFrame',
	'setRenderScaling',
	'setShadowQuality',
	'setLightDefault',
]);

/** How the log shows a change of one of the core's texture settings. */
const textureOption = (option: number, value: number) => `setTextureOption ${option} ${value}`;

/**
 * A core that keeps the scene arrays and the command ring in memory, hands out slots, and logs each
 * frame step it takes and each texture setting it gets. It keeps the arguments of some calls in
 * `calls`. Its transform updates clear the dirty bits, as the core's do. With `grows`, each frame
 * step grows the memory, which detaches the views of a memory that is not shared, as the
 * single-threaded build's is. Its other calls do nothing.
 */
function fakeGlue(
	log: string[],
	memory: WebAssembly.Memory,
	calls: unknown[][] = [],
	grows = false,
): CoreGlue {
	// Each scene field, then each ring field, in its own 4 KB block.
	const block = (index: number) => 4096 * (index + 1);
	let slots = 0;
	const kept: Partial<Record<keyof CoreGlue, (field: number) => number>> = {
		sceneCapacity: () => CAPACITY,
		sceneArrays: block,
		commandRing: (field) => (field === C.RING_FIELD_CAPACITY ? RING : block(RING_BLOCK + field)),
		reserveObject: () => ++slots,
	};
	const clearDirty = () =>
		new Uint32Array(
			memory.buffer,
			block(C.SCENE_FIELD_DIRTY_WORDS),
			Math.ceil((CAPACITY + 1) / 32),
		).fill(0);
	return new Proxy({} as CoreGlue, {
		get: (_, name: string) =>
			kept[name as keyof CoreGlue] ??
			((...args: number[]) => {
				if (KEPT_ARGUMENTS.has(name)) calls.push([name, ...args]);
				if (FRAME_STEPS.has(name)) log.push(name);
				if (grows && FRAME_STEPS.has(name)) memory.grow(1);
				if (name === 'setTextureOption') log.push(textureOption(args[0] ?? -1, args[1] ?? -1));
				if (name === 'updateTransforms' || name === 'updateLateTransforms') clearDirty();
				return name === 'drawTablesRebuilt' ? false : 0;
			}),
	});
}

/**
 * How the thread that draws behaves in a test: the intervals it records, in ms. With `replayMs`,
 * each frame's replay lasts that long after the frame is taken, and `overwritten` gets each frame
 * whose list the sketch recorded again during its replay.
 */
interface FakeDrawing {
	presentedMs: number;
	completedMs: number;
	replayMs?: number;
	overwritten?: number[];
}

/**
 * A stand-in for the thread that draws: each few ms it takes the newest published frame, reports
 * its pipelines built, and records a presented and a completed frame with the given intervals. As
 * the real thread does, it marks a frame taken before it replays the frame's list. Returns a
 * function that stops it.
 */
function drawFrames(
	control: ReturnType<typeof controlViews>,
	metrics: ArrayBufferLike,
	drawing: FakeDrawing,
): () => void {
	const { slots } = control;
	const render = new FrameRecorder(metrics, Role.Render);
	const completion = new FrameRecorder(metrics, Role.Completion);
	let replaying = 0;
	let replayEnd = 0;
	const timer = setInterval(() => {
		if (replaying !== 0) {
			// The frame two after shares the list.
			if (frameReached(Atomics.load(slots, Slot.FramesPublished), nextFrame(nextFrame(replaying))))
				drawing.overwritten?.push(replaying);
			else if (performance.now() < replayEnd) return;
			replaying = 0;
		}
		const published = Atomics.load(slots, Slot.FramesPublished);
		if (!frameAfter(published, Atomics.load(slots, Slot.FramesTaken))) return;
		Atomics.store(slots, Slot.PipelinesBuilt, published);
		Atomics.store(slots, Slot.FramesTaken, published);
		if (slots.buffer instanceof SharedArrayBuffer) Atomics.notify(slots, Slot.FramesTaken);
		if (drawing.replayMs) {
			replaying = published;
			replayEnd = performance.now() + drawing.replayMs;
		}
		for (const [recorder, ms] of [
			[render, drawing.presentedMs],
			[completion, drawing.completedMs],
		] as const) {
			recorder.begin(published);
			recorder.interval(ms);
			recorder.commit(0);
		}
	}, 2);
	return () => clearInterval(timer);
}

/** The quality that the tests' page chose: Medium, with no check. */
const MEDIUM: QualityStart = {
	preset: 'medium',
	settings: presetSettings('medium'),
	options: {},
	highest: 'ultra',
};

/**
 * A runner of a sketch whose callbacks come from `callbacks`, with a log of what each frame ran.
 * `quality` replaces the page's quality start. With `drawing`, a stand-in for the thread that
 * draws takes the frames, and the engine runs, so waits for frames wait for that stand-in. With
 * `grows`, each frame step grows the memory. The log also shows the settings that the page got.
 */
async function start(
	callbacks: (context: SketchContext, log: string[]) => object,
	options?: SketchOptions,
	{
		quality = MEDIUM,
		drawing,
		grows = false,
		holdSeconds,
		shared = false,
	}: {
		quality?: QualityStart;
		drawing?: FakeDrawing;
		grows?: boolean;
		holdSeconds?: number;
		shared?: boolean;
	} = {},
) {
	const log: string[] = [];
	const calls: unknown[][] = [];
	const updates: QualityUpdate[] = [];
	const control = controlViews(createControlBuffer(shared));
	control.slotFloats[Slot.CanvasCssWidth] = 320;
	control.slotFloats[Slot.CanvasCssHeight] = 180;
	control.slotFloats[Slot.PixelRatio] = 2;
	const metrics = createMetricsBuffer(false, 0);
	const stopDrawing = drawing ? drawFrames(control, metrics, drawing) : () => {};
	if (drawing) Atomics.store(control.slots, Slot.Running, 1);
	const memory = new WebAssembly.Memory({ initial: 2 });
	const runner = new SketchRunner(
		() => {},
		metrics,
		{
			glue: fakeGlue(log, memory, calls, grows),
			memory,
			control,
			keyCodes: [],
			jobWorkers: 0,
			device: {
				webgl2: true,
				storageBindingBytes: 0,
				capabilities: 0,
				maxTextureSize: 4096,
				sharedUploads: false,
				depth: 'reversed',
				parallelCompile: true,
				freshShaders: false,
				sceneColor: FORMAT_RGBA16_FLOAT,
				antialias: C.ANTIALIAS_MSAA,
				effectsSceneColor: FORMAT_RGBA16_FLOAT,
				effectsAntialias: C.ANTIALIAS_MSAA,
				occlusionTargets: true,
				transparent: false,
				shaderBits: 0,
				cellCulling: true,
				joinEffects: true,
				depthPrepass: false,
				vertexSkinning: false,
				indexInstances: false,
				shadowDepthBits: 16,
				largeWorld: false,
				gpuOcclusion: false,
			},
			capabilities: CAPABILITIES,
			quality,
			applyQuality: (update) => {
				updates.push(update);
				log.push(`page ${JSON.stringify(update.settings)}`);
			},
			sendImage: () => {},
			sendShader: () => {},
			sendPreload: () => {},
			pageUrl: 'http://localhost/',
			threads: [['sketch-worker', [Role.Sketch, Role.Render]]],
			showStats: (show) => log.push(`stats ${show}`),
			sendLabelSlot: () => {},
		},
		holdSeconds,
	);
	let context: SketchContext | undefined;
	try {
		await runner.setup(
			defineSketch((ctx) => {
				context = ctx;
				return callbacks(ctx, log);
			}, options),
		);
	} catch (error) {
		stopDrawing();
		throw error;
	}
	return { runner, log, calls, control, updates, stopDrawing, context: context as SketchContext };
}

describe('SketchRunner', () => {
	it('runs the fixed steps and the update, the transforms, then the late update and its transforms', async () => {
		const { runner, log } = await start(
			(_, log) => ({
				onFixedUpdate: (step: number) => log.push(`fixed ${step}`),
				onUpdate: () => log.push('update'),
				onLateUpdate: () => log.push('late'),
			}),
			{ fixedRate: 30 },
		);
		runner.step(0);
		log.length = 0;
		runner.step(1000 / 15);
		expect(log).toEqual([
			'fixed 0.03333333333333333',
			'fixed 0.03333333333333333',
			'update',
			'beginFrame',
			'updateTransforms',
			'late',
			'updateLateTransforms',
			'updateBatches',
			'cullFrame',
			'recordFrame',
		]);
	});

	it('updates no transforms a second time for a sketch without a late update', async () => {
		const { runner, log } = await start((_, log) => ({ onUpdate: () => log.push('update') }));
		runner.step(0);
		runner.step(16);
		expect(log).not.toContain('updateLateTransforms');
		expect(log.filter((entry) => entry === 'update')).toHaveLength(2);
	});

	it('writes through views of the current memory after frame steps that grow it', async () => {
		const { runner, context } = await start(
			({ scene }) => {
				const box = scene.createGroup();
				return {
					onUpdate: () => box.setPosition(1, 2, 3),
					onLateUpdate: () => box.translate(1, 0, 0),
				};
			},
			undefined,
			{ grows: true },
		);
		const position = (slot: number) => [
			...context.scene.views.positions.subarray(slot * 3, slot * 3 + 3),
		];
		runner.step(0);
		// The late update runs after the commands and the transform update grew the memory.
		expect(position(1)).toEqual([2, 2, 3]);
		// Code between frames runs after the frame's last steps grew it.
		const other = context.scene.createGroup();
		other.setPosition(5, 6, 7);
		expect(position(other.slot)).toEqual([5, 6, 7]);
	});

	it("gives time.dt the frame's step, which the update and the late update also get", async () => {
		const seen: number[][] = [];
		const { runner, context } = await start(({ time }) => ({
			onUpdate: (dt: number) => seen.push([time.frame, time.dt, dt]),
			onLateUpdate: (dt: number) => seen.push([time.frame, time.dt, dt]),
		}));
		expect([context.time.now, context.time.dt, context.time.frame]).toEqual([0, 0, 0]);
		runner.step(1000);
		runner.step(1020);
		expect(seen[0]).toEqual([1, 0, 0]);
		expect(seen[1]).toEqual([1, 0, 0]);
		expect(seen[2]?.[0]).toBe(2);
		expect(seen[2]?.[1]).toBeCloseTo(0.02, 12);
		expect(seen[3]).toEqual(seen[2] as number[]);
		expect(context.time.now).toBeCloseTo(0.02, 12);
	});

	it("shows the canvas's size at the start of each frame, and the page's capabilities", async () => {
		const { runner, control, context } = await start(() => ({}));
		const { viewport, capabilities } = context.engine;
		expect([viewport.width, viewport.height, viewport.pixelRatio]).toEqual([320, 180, 2]);
		expect(capabilities).toEqual(CAPABILITIES);
		control.slotFloats[Slot.CanvasCssWidth] = 640.5;
		control.slotFloats[Slot.PixelRatio] = 1.5;
		runner.step(0);
		// The page counts each size it writes; without a new count the frame keeps the size it has.
		expect(viewport.width).toBe(320);
		Atomics.add(control.slots, Slot.ResizeSerial, 1);
		runner.step(16);
		expect([viewport.width, viewport.height, viewport.pixelRatio]).toEqual([640.5, 180, 1.5]);
	});

	it('logs an error in a fixed step once, and runs the rest of the frame', async () => {
		const error = spyOn(console, 'error').mockImplementation(() => {});
		try {
			const { runner, log } = await start(
				(_, log) => ({
					onFixedUpdate: () => {
						log.push('fixed');
						throw new Error('the step failed');
					},
					onUpdate: () => log.push('update'),
				}),
				{ fixedRate: 120 },
			);
			runner.step(0);
			runner.step(1000 / 60);
			expect(log.filter((entry) => entry === 'fixed')).toHaveLength(2);
			expect(log).toContain('update');
			expect(error).toHaveBeenCalledTimes(1);
		} finally {
			error.mockRestore();
		}
	});

	it('checks static objects before the late transform update too, which clears the marks of its setters', async () => {
		const error = spyOn(console, 'error').mockImplementation(() => {});
		try {
			let skip = false;
			const { runner } = await start(({ scene, time }) => {
				const { core } = scene;
				const mesh = { id: 1, radius: 1, core } as unknown as MeshGeometry;
				const material = { id: 1, core } as unknown as Material;
				const crate = scene.createMesh({ name: 'Crate', mesh, material });
				const sign = scene.createMesh({ name: 'Sign', mesh, material });
				return {
					onLateUpdate: () => {
						sign.setPosition(time.frame, 0, 0);
						if (skip) scene.views.positions[crate.slot * 3] = time.frame;
					},
				};
			});
			for (let k = 0; k < 3; k++) runner.step(k * 16);
			expect(error).not.toHaveBeenCalled();
			// A write that skips a setter in the late update shows in the same frame.
			skip = true;
			runner.step(48);
			expect(error).toHaveBeenCalledTimes(1);
			expect(messageOf(error.mock.calls[0]?.[0])).toStartWith(
				'E1110: the position of "Crate" (slot 1) changed without a setter.',
			);
		} finally {
			error.mockRestore();
		}
	});

	it("draws at the range's highest render scale, and lets the core scale while the scale can drop", async () => {
		const { runner, calls } = await start(() => ({}));
		runner.step(0);
		expect(calls.find((call) => call[0] === 'setRenderScaling')).toEqual([
			'setRenderScaling',
			true,
		]);
		const record = calls.find((call) => call[0] === 'recordFrame');
		expect(record?.[4]).toBe(1000);
	});

	it("gives the core the preset's shadow filter, far cascade interval, moving casters and cascade blend, and each change", async () => {
		const { runner, calls } = await start(({ quality }) => ({
			onUpdate: () => {
				quality.set({
					shadowFilter: 3,
					farCascadeInterval: 1,
					followMovingCasters: false,
					shadowCascadeBlend: 0.2,
				});
			},
		}));
		const shadowCalls = () => calls.filter((call) => call[0] === 'setShadowQuality');
		expect(shadowCalls()).toEqual([['setShadowQuality', 5, 3, true, 0.1]]);
		runner.step(0);
		expect(shadowCalls().at(-1)).toEqual(['setShadowQuality', 3, 1, false, 0.2]);
	});

	it("gives new directional lights the preset's shadow cascades and map size before the setup", async () => {
		const { calls } = await start(() => ({}));
		const medium = presetSettings('medium');
		expect(calls.filter((call) => call[0] === 'setLightDefault')).toEqual([
			['setLightDefault', C.LIGHT_VALUE_SHADOW_CASCADES, medium.shadowCascades],
			['setLightDefault', C.LIGHT_VALUE_SHADOW_MAP_SIZE, medium.shadowMapSize],
		]);
	});

	it('draws the frame being drawn at a range that the sketch fixes in its update', async () => {
		const { runner, calls } = await start(({ quality }) => ({
			onUpdate: () => {
				quality.set({ minRenderScale: 0.5, maxRenderScale: 0.5 });
				expect(quality.renderScale).toBe(0.5);
			},
		}));
		runner.step(0);
		const records = calls.filter((call) => call[0] === 'recordFrame');
		expect(records.map((call) => call[4])).toEqual([500]);
		expect(calls.filter((call) => call[0] === 'setRenderScaling').at(-1)).toEqual([
			'setRenderScaling',
			true,
		]);
	});

	it('draws at the highest render scale with the settings as set while the governor is off', async () => {
		const { runner, calls, context } = await start(({ quality }) => {
			quality.set({ minRenderScale: 0.5, maxRenderScale: 0.75, governor: false });
			return {};
		});
		runner.step(0);
		const scaling = () => calls.filter((call) => call[0] === 'setRenderScaling').at(-1);
		expect(scaling()).toEqual(['setRenderScaling', true]);
		expect(calls.find((call) => call[0] === 'recordFrame')?.[4]).toBe(750);
		context.quality.set({ maxRenderScale: 1 });
		expect(scaling()).toEqual(['setRenderScaling', false]);
		const { governor, settings } = context.quality;
		expect([governor.steps, governor.shadowFilter, governor.farCascadeInterval]).toEqual([
			0,
			settings.shadowFilter,
			settings.farCascadeInterval,
		]);
	});

	it('holds at the highest render scale, with the passes of its range', async () => {
		const whole = await start(
			({ quality }) => {
				quality.set({ minRenderScale: 1 });
				return {};
			},
			undefined,
			{ holdSeconds: 0 },
		);
		expect(whole.calls.filter((call) => call[0] === 'setRenderScaling').at(-1)).toEqual([
			'setRenderScaling',
			false,
		]);
		expect(whole.calls.find((call) => call[0] === 'recordFrame')?.[4]).toBe(1000);
		const preset = await start(() => ({}), undefined, { holdSeconds: 0 });
		expect(preset.calls.filter((call) => call[0] === 'setRenderScaling')).toEqual([
			['setRenderScaling', true],
		]);
		expect(preset.calls.find((call) => call[0] === 'recordFrame')?.[4]).toBe(1000);
		const scaled = await start(
			({ quality }) => {
				quality.set({ minRenderScale: 0.5, maxRenderScale: 0.75 });
				return {};
			},
			undefined,
			{ holdSeconds: 0 },
		);
		expect(scaled.calls.filter((call) => call[0] === 'setRenderScaling').at(-1)).toEqual([
			'setRenderScaling',
			true,
		]);
		expect(scaled.calls.find((call) => call[0] === 'recordFrame')?.[4]).toBe(750);
	});

	it("gives the core the preset's texture settings before the setup, then only those that change", async () => {
		const { log, context } = await start((ctx, log) => {
			log.push('setup');
			ctx.textures.setUploadBudget(2048);
			return {};
		});
		const medium = presetSettings('medium');
		expect(log).toEqual([
			textureOption(C.TEXTURE_OPTION_UPLOAD_BUDGET, medium.uploadBytesPerFrame),
			textureOption(C.TEXTURE_OPTION_MAX_ANISOTROPY, medium.maxAnisotropy),
			'setup',
			textureOption(C.TEXTURE_OPTION_UPLOAD_BUDGET, 2048),
		]);
		// Another setting's change leaves the sketch's own budget in place.
		log.length = 0;
		context.quality.set({ maxPixelRatio: 1 });
		expect(log).toEqual([`page ${JSON.stringify({ ...medium, maxPixelRatio: 1 })}`]);
		log.length = 0;
		context.quality.set({ maxAnisotropy: 2, uploadBytesPerFrame: 65_536 });
		expect(log).toEqual([
			textureOption(C.TEXTURE_OPTION_UPLOAD_BUDGET, 65_536),
			textureOption(C.TEXTURE_OPTION_MAX_ANISOTROPY, 2),
			`page ${JSON.stringify({ ...medium, maxPixelRatio: 1, maxAnisotropy: 2, uploadBytesPerFrame: 65_536 })}`,
		]);
	});

	it('records no setup frame into the list of a frame that the thread that draws still replays', async () => {
		const drawing = { presentedMs: 16, completedMs: 16, replayMs: 10, overwritten: [] as number[] };
		const { stopDrawing } = await start(
			async ({ scene }) => {
				await Promise.all([scene.warmUp(), scene.warmUp(), scene.warmUp(), scene.warmUp()]);
				return {};
			},
			undefined,
			{ drawing },
		);
		stopDrawing();
		expect(drawing.overwritten).toEqual([]);
	});

	it('records no frame of the loop while warm-ups that the setup did not wait for record', async () => {
		const drawing = { presentedMs: 16, completedMs: 16, replayMs: 10, overwritten: [] as number[] };
		const { runner, control, stopDrawing } = await start(
			({ scene }) => {
				void scene.warmUp();
				void scene.warmUp();
				return {};
			},
			undefined,
			{ drawing, shared: true },
		);
		const faults: unknown[] = [];
		const loop = runPipelined(runner, control.slots.buffer, (error) => faults.push(error));
		await new Promise((resolve) => setTimeout(resolve, 150));
		Atomics.store(control.slots, Slot.Running, 0);
		await loop;
		stopDrawing();
		expect(faults).toEqual([]);
		expect(drawing.overwritten).toEqual([]);
	});

	it('counts frames on past the last of the 32-bit count, with no frame 0 or -1', async () => {
		const drawing = { presentedMs: 16, completedMs: 16, replayMs: 2, overwritten: [] as number[] };
		const { runner, control, calls, stopDrawing } = await start(() => ({}), undefined, {
			drawing,
			shared: true,
		});
		// The engine's count stands four frames before the end of the circle.
		(runner as unknown as { recorded: { frame: number } }).recorded.frame = -5;
		Atomics.store(control.slots, Slot.FramesPublished, -5);
		Atomics.store(control.slots, Slot.FramesTaken, -5);
		calls.length = 0;
		const loop = runPipelined(runner, control.slots.buffer, () => {});
		await new Promise((resolve) => setTimeout(resolve, 150));
		Atomics.store(control.slots, Slot.Running, 0);
		await loop;
		stopDrawing();
		const frames = calls.filter(([name]) => name === 'recordFrame').map(([, frame]) => frame);
		expect(frames.slice(0, 6)).toEqual([-4, -3, -2, 1, 2, 3]);
		expect(frames).not.toContain(0);
		expect(frames).not.toContain(-1);
		expect(Atomics.load(control.slots, Slot.FramesTaken)).toBeGreaterThan(3);
		expect(drawing.overwritten).toEqual([]);
	});

	it('ends the pipelined loop with a fault when a frame step throws', async () => {
		const drawing = { presentedMs: 16, completedMs: 16 };
		let frames = 0;
		const { runner, control, stopDrawing } = await start(
			() => ({
				onUpdate() {
					frames++;
					if (frames === 3) throw new Error('a sketch error is reported, and play goes on');
				},
			}),
			undefined,
			{ drawing, shared: true },
		);
		const step = runner.step.bind(runner);
		let steps = 0;
		runner.step = (timestamp) => {
			if (++steps === 5) throw new Error('the core trapped');
			return step(timestamp);
		};
		const faults: unknown[] = [];
		const errors = spyOn(console, 'error').mockImplementation(() => {});
		await runPipelined(runner, control.slots.buffer, (error) => faults.push(error));
		errors.mockRestore();
		stopDrawing();
		expect(faults.map(messageOf)).toEqual(['the core trapped']);
		expect(frames).toBe(4);
	});

	it('runs onDestroy once when the engine stops, then refuses every call with E1420', async () => {
		let destroyed = 0;
		const { runner, context } = await start(() => ({
			onDestroy() {
				destroyed++;
			},
		}));
		let helperStopped = 0;
		onEngineStop(() => helperStopped++);
		runner.dispose();
		runner.dispose();
		expect(destroyed).toBe(1);
		expect(helperStopped).toBe(1);
		expect(() => context.geometry.box()).toThrow('E1420');
		expect(() => context.scene.createGroup()).toThrow('E1420');
	});

	it('refuses options out of range with E1214, before the setup function runs', async () => {
		let ran = false;
		const failed = start(
			() => {
				ran = true;
				return {};
			},
			{ fixedRate: 0 },
		);
		await expect(failed).rejects.toThrow('E1214: defineSketch() got 0 for fixedRate.');
		expect(ran).toBe(false);
	});
});

describe('SketchRunner and quality presets', () => {
	it('holds the frame after a change of preset, whose handlers hear of it, until it draws', async () => {
		const heard: string[] = [];
		const drawing = { presentedMs: 16, completedMs: 16 };
		const { runner, control, context, stopDrawing } = await start(
			({ quality }) => {
				quality.onChange(() => heard.push(quality.preset));
				return {};
			},
			undefined,
			{ drawing },
		);
		try {
			const { slots } = control;
			const publish = (frame: number) => Atomics.store(slots, Slot.FramesPublished, frame);
			publish(runner.step(0));
			let drawn = false;
			const changed = context.quality.setPreset('low').then(() => {
				drawn = true;
			});
			const frame = runner.step(16);
			expect(heard).toEqual(['low']);
			expect(Atomics.load(slots, Slot.PipelineHold)).toBe(frame);
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(drawn).toBe(false);
			publish(frame);
			await changed;
			expect(Atomics.load(slots, Slot.FramesTaken)).toBeGreaterThanOrEqual(frame);
			// Later frames draw at once.
			publish(runner.step(32));
			expect(Atomics.load(slots, Slot.PipelineHold)).toBe(frame);
		} finally {
			stopDrawing();
		}
	});

	it('holds the frame whose own update changed the preset, as it records with the new settings', async () => {
		const drawing = { presentedMs: 16, completedMs: 16 };
		let change: Promise<void> | undefined;
		const { runner, control, context, stopDrawing } = await start(
			({ quality }) => ({
				onUpdate: () => {
					change ??= quality.setPreset('low');
				},
			}),
			undefined,
			{ drawing },
		);
		try {
			const frame = runner.step(0);
			expect(context.quality.preset).toBe('low');
			expect(Atomics.load(control.slots, Slot.PipelineHold)).toBe(frame);
			// The next frame's handlers hear of the change, so it holds too.
			const next = runner.step(16);
			expect(Atomics.load(control.slots, Slot.PipelineHold)).toBe(next);
			Atomics.store(control.slots, Slot.FramesPublished, next);
			await change;
		} finally {
			stopDrawing();
		}
	});

	it('holds a setup frame for a change in the setup, and the first frame of play for its handlers', async () => {
		const heard: string[] = [];
		const { runner, control, log, stopDrawing } = await start(
			async ({ quality, time }, log) => {
				quality.onChange(() => heard.push(quality.preset));
				await quality.setPreset('low');
				log.push(`set up at frame ${time.frame}`);
				return {};
			},
			undefined,
			{ drawing: { presentedMs: 16, completedMs: 16 } },
		);
		try {
			// The setup's frame is the engine's first, and the sketch's time counts no frame yet.
			expect(log).toContain('set up at frame 0');
			expect(heard).toEqual([]);
			expect(Atomics.load(control.slots, Slot.PipelineHold)).toBe(1);
			const played = runner.step(0);
			expect(heard).toEqual(['low']);
			expect(Atomics.load(control.slots, Slot.PipelineHold)).toBe(played);
		} finally {
			stopDrawing();
		}
	});

	it('asks the page for the stats overlay once per change, and gives the sketch frame figures', async () => {
		const { runner, context, control, log, stopDrawing } = await start(() => ({}), undefined, {
			drawing: { presentedMs: 20, completedMs: 25 },
		});
		try {
			const { debug } = context;
			debug.stats(true);
			debug.stats();
			debug.stats(false);
			debug.stats(false);
			expect(log.filter((entry) => entry.startsWith('stats'))).toEqual([
				'stats true',
				'stats false',
			]);
			expect(debug.frameStats().frames).toBe(0);
			expect(debug.frameStats().preset).toBe('medium');
			let time = 0;
			for (let k = 0; k < 200 && debug.frameStats().frames === 0; k++) {
				Atomics.store(control.slots, Slot.FramesPublished, runner.step(time));
				time += 20;
				await new Promise((resolve) => setTimeout(resolve, 3));
			}
			const stats = debug.frameStats();
			expect(stats.frames).toBeGreaterThan(0);
			expect(stats.presentedFps).toBeCloseTo(50, 6);
			expect(stats.completedFps).toBeCloseTo(40, 6);
			expect(stats.renderScale).toBe(1);
			expect(stats.threads.map((thread) => thread.name)).toEqual(['sketch-worker']);
			expect(Atomics.load(control.slots, Slot.RenderScale)).toBe(1000);
		} finally {
			stopDrawing();
		}
	});

	it('checks the preset after the setup, and keeps a preset that holds the target', async () => {
		const { context, updates, log, stopDrawing } = await start(
			(_, log) => ({ onUpdate: () => log.push('update') }),
			undefined,
			{ quality: { ...MEDIUM, check: {} }, drawing: { presentedMs: 16, completedMs: 16.5 } },
		);
		stopDrawing();
		expect(context.quality.preset).toBe('medium');
		// The check draws the scene as the setup built it, without the sketch's update.
		expect(log).not.toContain('update');
		const check = updates.at(-1)?.check;
		expect(check?.from).toBe('medium');
		expect(check?.targetFps).toBe(60);
		expect(check?.rounds).toEqual([{ preset: 'medium', presentedFps: 62.5, completedFps: 60.6 }]);
	});

	it('lowers the preset when the GPU finishes too few frames, down to Low', async () => {
		const { context, updates, stopDrawing } = await start(() => ({}), undefined, {
			quality: { ...MEDIUM, check: {} },
			drawing: { presentedMs: 16, completedMs: 40 },
		});
		stopDrawing();
		expect(context.quality.preset).toBe('low');
		expect(context.quality.settings.maxPixelRatio).toBe(1.5);
		const last = updates.at(-1);
		expect(last?.preset).toBe('low');
		expect(last?.check?.rounds.map((round) => [round.preset, round.completedFps])).toEqual([
			['medium', 25],
			['low', 25],
		]);
	}, 10_000);

	it("keeps the settings that the sketch's setup chose when the check lowers the preset", async () => {
		const { context, log, stopDrawing } = await start(
			(ctx, log) => {
				ctx.textures.setUploadBudget(2048);
				ctx.quality.set({ maxAnisotropy: 16 });
				log.length = 0;
				return {};
			},
			undefined,
			{ quality: { ...MEDIUM, check: {} }, drawing: { presentedMs: 16, completedMs: 40 } },
		);
		stopDrawing();
		expect(context.quality.preset).toBe('low');
		// Low's pixel ratio cap applies, and the sketch's own anisotropy cap and upload budget stay.
		expect(context.quality.settings.maxPixelRatio).toBe(1.5);
		expect(context.quality.settings.maxAnisotropy).toBe(16);
		expect(log.filter((line) => line.startsWith('setTextureOption'))).toEqual([]);
	}, 10_000);

	it('asks for no more than the frame rate that ?fps= holds', async () => {
		const { context, updates, stopDrawing } = await start(() => ({}), undefined, {
			quality: { ...MEDIUM, check: { fps: 30 } },
			drawing: { presentedMs: 1000 / 30, completedMs: 1000 / 30 },
		});
		stopDrawing();
		expect(context.quality.preset).toBe('medium');
		expect(updates.at(-1)?.check?.targetFps).toBe(30);
	});
});
