import { describe, expect, it, spyOn } from 'bun:test';
import { messageOf } from '../errors/message';
import * as C from '../generated/core';
import { FORMAT_RGBA16_FLOAT } from '../generated/gpu';
import type { EngineCapabilities } from '../page/engine';
import { presetSettings } from '../quality/presets';
import type { Material, MeshGeometry } from '../scene/resources';
import { controlViews, createControlBuffer, Slot } from '../shared/control';
import type { CoreGlue } from '../shared/core';
import { createMetricsBuffer, FrameRecorder, Role } from '../shared/metrics';
import { defineSketch, type SketchContext, type SketchOptions } from './define-sketch';
import type { QualityStart, QualityUpdate } from './quality';
import { SketchRunner } from './runner';

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
	maxInstances: 2_097_152,
	depth: 'reversed',
};

/** Scene slots of the fake core, and records of its command ring. */
const CAPACITY = 15;
const RING = 64;
/** The fake core's first ring block, past room for every scene field. */
const RING_BLOCK = 16;

/** How the log shows a change of one of the core's texture settings. */
const textureOption = (option: number, value: number) => `setTextureOption ${option} ${value}`;

/**
 * A core that keeps the scene arrays and the command ring in memory, hands out slots, and logs each
 * frame step it takes and each texture setting it gets. Its transform updates clear the dirty bits,
 * as the core's do. Its other calls do nothing.
 */
function fakeGlue(log: string[], memory: WebAssembly.Memory): CoreGlue {
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
				if (FRAME_STEPS.has(name)) log.push(name);
				if (name === 'setTextureOption') log.push(textureOption(args[0] ?? -1, args[1] ?? -1));
				if (name === 'updateTransforms' || name === 'updateLateTransforms') clearDirty();
				return name === 'drawTablesRebuilt' ? false : 0;
			}),
	});
}

/** How the thread that draws behaves in a test: the intervals it records, in ms. */
interface FakeDrawing {
	presentedMs: number;
	completedMs: number;
}

/**
 * A stand-in for the thread that draws: each few ms it takes the newest published frame, reports
 * its pipelines built, and records a presented and a completed frame with the given intervals.
 * Returns a function that stops it.
 */
function drawFrames(
	control: ReturnType<typeof controlViews>,
	metrics: ArrayBufferLike,
	drawing: FakeDrawing,
): () => void {
	const { slots } = control;
	const render = new FrameRecorder(metrics, Role.Render);
	const completion = new FrameRecorder(metrics, Role.Completion);
	const timer = setInterval(() => {
		const published = Atomics.load(slots, Slot.FramesPublished);
		if (published <= Atomics.load(slots, Slot.FramesTaken)) return;
		Atomics.store(slots, Slot.PipelinesBuilt, published);
		Atomics.store(slots, Slot.FramesTaken, published);
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
 * draws takes the frames, and the engine runs, so waits for frames wait for that stand-in. The log
 * also shows the settings that the page got.
 */
async function start(
	callbacks: (context: SketchContext, log: string[]) => object,
	options?: SketchOptions,
	{ quality = MEDIUM, drawing }: { quality?: QualityStart; drawing?: FakeDrawing } = {},
) {
	const log: string[] = [];
	const updates: QualityUpdate[] = [];
	const control = controlViews(createControlBuffer(false));
	control.slotFloats[Slot.CanvasCssWidth] = 320;
	control.slotFloats[Slot.CanvasCssHeight] = 180;
	control.slotFloats[Slot.PixelRatio] = 2;
	const metrics = createMetricsBuffer(false, 0);
	const stopDrawing = drawing ? drawFrames(control, metrics, drawing) : () => {};
	if (drawing) Atomics.store(control.slots, Slot.Running, 1);
	const memory = new WebAssembly.Memory({ initial: 2 });
	const runner = new SketchRunner(() => {}, metrics, {
		glue: fakeGlue(log, memory),
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
			sceneColor: FORMAT_RGBA16_FLOAT,
			antialias: C.ANTIALIAS_MSAA,
			transparent: false,
			shaderBits: 0,
			cellCulling: true,
		},
		capabilities: CAPABILITIES,
		quality,
		applyQuality: (update) => {
			updates.push(update);
			log.push(`page ${JSON.stringify(update.settings)}`);
		},
		sendImage: () => {},
		pageUrl: 'http://localhost/',
	});
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
	return { runner, log, control, updates, stopDrawing, context: context as SketchContext };
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
