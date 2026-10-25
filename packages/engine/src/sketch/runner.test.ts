import { describe, expect, it, spyOn } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { messageOf } from '../errors/message';
import * as C from '../generated/core';
import { FORMAT_CANVAS, FORMAT_RGBA16_FLOAT } from '../generated/gpu';
import type { EngineCapabilities } from '../page/engine';
import type { HoldScript } from '../page/hold';
import type { CoreDevice } from '../page/limits';
import { presetSettings } from '../quality/presets';
import { callValueArguments } from '../scene/fake-call-values';
import type { Material, MeshGeometry } from '../scene/resources';
import {
	controlViews,
	createControlBuffer,
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	frameAfter,
	frameReached,
	nextFrame,
	Slot,
	writeInputEvent,
} from '../shared/control';
import type { CoreGlue } from '../shared/core';
import { onEngineStop } from '../shared/helper-workers';
import {
	createMetricsBuffer,
	FrameRecorder,
	MemoryFigure,
	memoryFigures,
	Role,
	sampleFrames,
} from '../shared/metrics';
import { decodeRecording, type ReplayProgram } from '../shared/recording';
import { jobAsker } from '../shared/task-host';
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
	directDraws: false,
};

/** Scene slots of the fake core, and records of its command ring. */
const CAPACITY = 15;
const RING = 64;
/** The fake core's first ring block, past room for every scene field. */
const RING_BLOCK = 16;

/** The GPU bytes of every mesh, as the fake core reports them. */
const MESH_BYTES = 4096;

/** The calls whose arguments the fake core keeps. */
const KEPT_ARGUMENTS = new Set([
	'recordFrame',
	'setRenderScaling',
	'setShadowQuality',
	'setLightDefault',
	'setCanvasOutput',
]);

/** How the log shows a change of one of the core's texture settings. */
const textureOption = (option: number, value: number) => `setTextureOption ${option} ${value}`;

/**
 * A core that keeps the scene arrays and the command ring in memory, hands out slots, and logs each
 * frame step it takes and each texture setting it gets. It reports `MESH_BYTES` of meshes. It
 * keeps the arguments of some calls in `calls`. Its transform updates clear the dirty bits, as the
 * core's do. With `grows`, each frame step grows the memory, which detaches the views of a memory
 * that is not shared, as the single-threaded build's is. `cellsRefused` gives the core's count of
 * refused grid cells. Its other calls do nothing.
 */
function fakeGlue(
	log: string[],
	memory: WebAssembly.Memory,
	calls: unknown[][] = [],
	grows = false,
	cellsRefused = () => 0,
	handed: { handedMs: number; timing?: boolean[] } = { handedMs: 0 },
): CoreGlue {
	// Each scene field, then each ring field, in its own 4 KB block.
	const block = (index: number) => 4096 * (index + 1);
	let slots = 0;
	const kept: Partial<Record<keyof CoreGlue, (field: number) => number>> = {
		sceneCapacity: () => CAPACITY,
		sceneArrays: block,
		commandRing: (field) => (field === C.RING_FIELD_CAPACITY ? RING : block(RING_BLOCK + field)),
		reserveObject: () => ++slots,
		// The first block holds no field, so the call values take its start.
		callValues: () => 0,
		cellsRefused,
		meshMemoryBytes: () => MESH_BYTES,
		takeHandedUs: () => (handed.timing?.at(-1) === false ? 0 : Math.round(handed.handedMs * 1000)),
		// The fake takes numbers, so the flag arrives as one.
		timeHandedLoops: (on) => handed.timing?.push(Boolean(on)) ?? 0,
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
				if (KEPT_ARGUMENTS.has(name))
					calls.push([name, ...args, ...callValueArguments(name, memory, 0)]);
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
 * `grows`, each frame step grows the memory. `cellsRefused` gives the core's count of refused grid
 * cells. `control` gives the page's control block, which the test can write. `maxTargetFps` is the
 * highest target that the page allows. `device` replaces fields of the stand-in device. The log
 * also shows the settings that the page got.
 */
async function start(
	callbacks: (context: SketchContext, log: string[]) => object,
	options?: SketchOptions,
	{
		quality = MEDIUM,
		drawing,
		grows = false,
		holdSeconds,
		holdScript,
		replay,
		record = false,
		keyCodes = [],
		shared = false,
		cellsRefused,
		control = controlViews(createControlBuffer(shared)),
		maxTargetFps = 60,
		jobs = { most: 0, handedMs: 0, asked: [] },
		device,
	}: {
		quality?: QualityStart;
		drawing?: FakeDrawing;
		grows?: boolean;
		holdSeconds?: number;
		holdScript?: HoldScript;
		replay?: ReplayProgram;
		record?: boolean;
		keyCodes?: readonly string[];
		shared?: boolean;
		cellsRefused?: () => number;
		control?: ReturnType<typeof controlViews>;
		maxTargetFps?: number;
		/**
		 * The most job workers, the parallel work each frame hands out in ms, and where the counts
		 * of job workers that the runner asks for go.
		 */
		jobs?: { most: number; handedMs: number; asked: number[]; timing?: boolean[] };
		device?: Partial<CoreDevice>;
	} = {},
) {
	const log: string[] = [];
	const calls: unknown[][] = [];
	const updates: QualityUpdate[] = [];
	control.slotFloats[Slot.CanvasCssWidth] = 320;
	control.slotFloats[Slot.CanvasCssHeight] = 180;
	control.slotFloats[Slot.PixelRatio] = 2;
	const metrics = createMetricsBuffer(false, jobs.most);
	const stopDrawing = drawing ? drawFrames(control, metrics, drawing) : () => {};
	if (drawing) Atomics.store(control.slots, Slot.Running, 1);
	const memory = new WebAssembly.Memory({ initial: 2 });
	const runner = new SketchRunner(
		() => {},
		metrics,
		{
			glue: fakeGlue(log, memory, calls, grows, cellsRefused, jobs),
			memory,
			control,
			keyCodes,
			jobWorkers: jobs.most,
			device: {
				webgl2: true,
				softwareRenderer: false,
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
				motionTargets: [true, true],
				transparent: false,
				shaderBits: 0,
				cellCulling: true,
				joinEffects: true,
				gradingHdr: false,
				depthPrepass: false,
				skinning: C.SKINNING_VERTEX,
				indexInstances: false,
				shadowDepthBits: 16,
				largeWorld: false,
				expectedObjects: 0,
				gpuOcclusion: false,
				directDraws: false,
				textureCache: true,
				occlusionBuffer: 0,
				...device,
			},
			capabilities: CAPABILITIES,
			quality,
			applyQuality: (update) => {
				updates.push(update);
				log.push(`page ${JSON.stringify(update.settings)}`);
			},
			sendImage: () => {},
			sendShader: () => {},
			sendBuilds: () => {},
			sendPreload: () => {},
			onAskBuilds: () => {},
			pageUrl: 'http://localhost/',
			sketchUrl: 'http://localhost/sketch.ts',
			maxTargetFps,
			threads: [['sketch-worker', [Role.Sketch, Role.Render]]],
			showStats: (show) => log.push(`stats ${show}`),
			twoStepProbe: false,
			wantJobs: jobAsker(jobs.most, (count) => jobs.asked.push(count)),
			sendLabelSlot: () => {},
		},
		holdSeconds,
		holdScript,
		replay,
		record,
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
	return {
		runner,
		log,
		calls,
		control,
		metrics,
		updates,
		stopDrawing,
		context: context as SketchContext,
	};
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

	it('asks for twice the job workers, up to the most, after each 30 frames that hand out 0.2 ms or more of parallel work', async () => {
		const busy = { most: 6, handedMs: 0.25, asked: [] as number[], timing: [] as boolean[] };
		const { runner } = await start(() => ({}), undefined, { jobs: busy });
		for (let frame = 0; frame < 29; frame++) runner.step(frame * 16);
		expect(busy.asked).toEqual([]);
		for (let frame = 29; frame < 200; frame++) runner.step(frame * 16);
		expect(busy.asked).toEqual([2, 4, 6]);

		// With every job worker asked for, the loops go untimed.
		expect(busy.timing).toEqual([false]);

		const light = { most: 6, handedMs: 0.15, asked: [] as number[], timing: [] as boolean[] };
		const quiet = await start(() => ({}), undefined, { jobs: light });
		for (let frame = 0; frame < 200; frame++) quiet.runner.step(frame * 16);
		expect(light.asked).toEqual([]);
		// A window with too little work stops the timing for 4.5 s of sketch time, then it times again.
		expect(light.timing).toEqual([false]);
		for (let frame = 200; frame < 311; frame++) quiet.runner.step(frame * 16);
		expect(light.timing).toEqual([false]);
		quiet.runner.step(311 * 16);
		expect(light.timing).toEqual([false, true]);
		light.handedMs = 0.3;
		for (let frame = 312; frame < 342; frame++) quiet.runner.step(frame * 16);
		expect(light.asked).toEqual([2]);
	});

	it('times its parallel loops again after the same sketch time at a slow frame rate', async () => {
		// About 9 frames a second, as CI's software GPU draws some pages. The first window has too
		// little work, as a page's first frames before its heavy work starts.
		const slow = { most: 2, handedMs: 0.1, asked: [] as number[], timing: [] as boolean[] };
		const { runner } = await start(() => ({}), undefined, { jobs: slow });
		for (let frame = 0; frame < 70; frame++) runner.step(frame * 111);
		expect(slow.timing).toEqual([false]);
		runner.step(70 * 111);
		expect(slow.timing).toEqual([false, true]);
		slow.handedMs = 5;
		for (let frame = 71; frame < 101; frame++) runner.step(frame * 111);
		expect(slow.asked).toEqual([2]);
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

	it('warns once, from the first frame in which the grid cells ran out', async () => {
		const warn = spyOn(console, 'warn').mockImplementation(() => {});
		try {
			let refused = 0;
			const { runner } = await start(() => ({}), undefined, { cellsRefused: () => refused });
			runner.step(0);
			runner.step(16);
			expect(warn).not.toHaveBeenCalled();
			refused = 1;
			runner.step(32);
			refused = 5;
			runner.step(48);
			expect(warn).toHaveBeenCalledTimes(1);
			expect(String(warn.mock.calls[0]?.[0])).toContain(`all ${C.CELL_MAX} grid cells are in use`);
		} finally {
			warn.mockRestore();
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

	it('moves an 8-bit device to HDR color for the subsurface blur only once the page or the sketch gives it taps', async () => {
		const eightBit = { sceneColor: FORMAT_CANVAS, antialias: C.ANTIALIAS_MSAA };
		const high: QualityStart = { ...MEDIUM, preset: 'high', settings: presetSettings('high') };
		const moves = (calls: unknown[][]) => calls.filter((call) => call[0] === 'setCanvasOutput');
		const preset = await start(() => ({}), undefined, { quality: high, device: eightBit });
		preset.runner.step(0);
		expect(preset.context.quality.settings.subsurfaceSamples).toBeGreaterThan(0);
		expect(moves(preset.calls)).toEqual([]);
		const chosen = await start(() => ({}), undefined, { device: eightBit });
		chosen.runner.step(0);
		chosen.context.quality.set({ subsurfaceSamples: 0 });
		chosen.runner.step(1000 / 60);
		expect(moves(chosen.calls)).toEqual([]);
		chosen.context.quality.set({ subsurfaceSamples: 11 });
		chosen.runner.step(2000 / 60);
		chosen.runner.step(3000 / 60);
		expect(moves(chosen.calls)).toEqual([
			['setCanvasOutput', FORMAT_RGBA16_FLOAT, C.ANTIALIAS_MSAA],
		]);
		const page = await start(() => ({}), undefined, {
			quality: {
				...MEDIUM,
				settings: { ...MEDIUM.settings, subsurfaceSamples: 17 },
				options: { subsurfaceSamples: 17 },
			},
			device: eightBit,
		});
		page.runner.step(0);
		expect(moves(page.calls)).toHaveLength(1);
	});

	it("gives new directional lights the preset's shadow cascades, map size and hero tile size", async () => {
		const { calls } = await start(() => ({}));
		const medium = presetSettings('medium');
		expect(calls.filter((call) => call[0] === 'setLightDefault')).toEqual([
			['setLightDefault', C.LIGHT_VALUE_SHADOW_CASCADES, medium.shadowCascades],
			['setLightDefault', C.LIGHT_VALUE_SHADOW_MAP_SIZE, medium.shadowMapSize],
			['setLightDefault', C.LIGHT_VALUE_HERO_SIZE, medium.heroTileSize],
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

	it('tells a held sketch that no reduced motion is asked for, and of no change, whatever the page reports', async () => {
		/** A sketch that logs the preference, and whose first update has the page report a change. */
		const motion =
			(control: ReturnType<typeof controlViews>) => (context: SketchContext, log: string[]) => {
				const { preferences } = context;
				log.push(`setup ${preferences.reducedMotion}`);
				preferences.onChange(() => log.push(`change ${preferences.reducedMotion}`));
				return {
					onUpdate() {
						log.push(`update ${preferences.reducedMotion}`);
						Atomics.store(control.slots, Slot.ReducedMotion, 0);
					},
				};
			};
		const preferenceLines = (log: string[]) =>
			log.filter((line) => /^(setup|change|update) /.test(line));
		const asking = () => {
			const control = controlViews(createControlBuffer(false));
			Atomics.store(control.slots, Slot.ReducedMotion, 1);
			return control;
		};

		const liveControl = asking();
		const live = await start(motion(liveControl), undefined, { control: liveControl });
		live.runner.step(0);
		live.runner.step(1000 / 60);
		expect(preferenceLines(live.log)).toEqual([
			'setup true',
			'update true',
			'change false',
			'update false',
		]);

		const heldControl = asking();
		const held = await start(motion(heldControl), undefined, {
			control: heldControl,
			holdSeconds: 0.1,
		});
		const lines = preferenceLines(held.log);
		expect(lines.length).toBeGreaterThan(2);
		expect(new Set(lines)).toEqual(new Set(['setup false', 'update false']));
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
			textureOption(C.TEXTURE_OPTION_MEMORY_BUDGET_KIB, medium.textureMemoryMiB * 1024),
			textureOption(C.TEXTURE_OPTION_KEEP_COPIES, 0),
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

	it('keeps the texture copies when the page keeps them, and frees them otherwise', async () => {
		const kept = await start(() => ({}), undefined, {
			quality: { ...MEDIUM, keepCopies: true },
		});
		expect(kept.log.filter((line) => line.startsWith('setTextureOption'))).toContain(
			textureOption(C.TEXTURE_OPTION_KEEP_COPIES, 1),
		);
		const freed = await start(() => ({}), undefined, {
			quality: { ...MEDIUM, keepCopies: false },
		});
		expect(freed.log.filter((line) => line.startsWith('setTextureOption'))).toContain(
			textureOption(C.TEXTURE_OPTION_KEEP_COPIES, 0),
		);
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

	it('asks the page for the stats overlay at each call, and gives the sketch frame figures', async () => {
		const { runner, context, control, log, stopDrawing } = await start(() => ({}), undefined, {
			drawing: { presentedMs: 20, completedMs: 25 },
		});
		try {
			const { debug } = context;
			// The page may have changed the overlay since the sketch's last call, so each call goes on.
			debug.stats(true);
			debug.stats();
			debug.stats(false);
			expect(log.filter((entry) => entry.startsWith('stats'))).toEqual([
				'stats true',
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

	it('publishes the memory figures from the first frame that samples, then one frame in eight', async () => {
		const { runner, metrics } = await start(() => ({}));
		const figures = memoryFigures(metrics);
		const meshBytes = () => figures[MemoryFigure.MeshBytes];
		let time = 0;
		const step = () => {
			time += 16;
			return runner.step(time);
		};
		// Sampling starts on a frame whose number is not a multiple of eight.
		let frame = step();
		while (frame % 8 !== 2) frame = step();
		expect(meshBytes()).toBe(0);
		sampleFrames(metrics, true);
		step();
		expect(meshBytes()).toBe(MESH_BYTES);
		// The figures stay current: the eighth frame after the first publishes them again.
		const published: number[] = [];
		for (let k = 1; k <= 16; k++) {
			figures[MemoryFigure.MeshBytes] = 0;
			step();
			if (meshBytes() === MESH_BYTES) published.push(k);
		}
		expect(published).toEqual([8, 16]);
		// A reader that samples again after a pause gets the figures in its first frame.
		sampleFrames(metrics, false);
		step();
		figures[MemoryFigure.MeshBytes] = 0;
		sampleFrames(metrics, true);
		step();
		expect(meshBytes()).toBe(MESH_BYTES);
	});

	it('checks the preset after the setup, and keeps a preset that holds the target', async () => {
		const { context, updates, log, stopDrawing } = await start(
			(_, log) => ({ onUpdate: () => log.push('update') }),
			undefined,
			{ quality: { ...MEDIUM, check: true }, drawing: { presentedMs: 16, completedMs: 16.5 } },
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

	it(
		'lowers the preset when the GPU finishes too few frames, down to Low',
		async () => {
			const { context, updates, stopDrawing } = await start(() => ({}), undefined, {
				quality: { ...MEDIUM, check: true },
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
		},
		scaledBudget(10_000),
	);

	it(
		"keeps the settings that the sketch's setup chose when the check lowers the preset",
		async () => {
			const { context, log, stopDrawing } = await start(
				(ctx, log) => {
					ctx.textures.setUploadBudget(2048);
					ctx.quality.set({ maxAnisotropy: 16 });
					log.length = 0;
					return {};
				},
				undefined,
				{ quality: { ...MEDIUM, check: true }, drawing: { presentedMs: 16, completedMs: 40 } },
			);
			stopDrawing();
			expect(context.quality.preset).toBe('low');
			// Low's pixel ratio cap and texture memory budget apply, and the sketch's own anisotropy cap
			// and upload budget stay.
			expect(context.quality.settings.maxPixelRatio).toBe(1.5);
			expect(context.quality.settings.maxAnisotropy).toBe(16);
			expect(log.filter((line) => line.startsWith('setTextureOption'))).toEqual([
				textureOption(
					C.TEXTURE_OPTION_MEMORY_BUDGET_KIB,
					presetSettings('low').textureMemoryMiB * 1024,
				),
			]);
		},
		scaledBudget(10_000),
	);

	it('asks for no more than the highest target that the page and ?fps= allow', async () => {
		const { context, updates, stopDrawing } = await start(() => ({}), undefined, {
			quality: { ...MEDIUM, check: true },
			maxTargetFps: 30,
			drawing: { presentedMs: 1000 / 30, completedMs: 1000 / 30 },
		});
		stopDrawing();
		expect(context.quality.preset).toBe('medium');
		expect(updates.at(-1)?.check?.targetFps).toBe(30);
	});
});

describe('hold mode with a timed script', () => {
	/** A hold of `seconds` that performs `steps`, with a group named Car in the scene. */
	const holdOf = (
		steps: HoldScript['steps'],
		seconds = 0.5,
		keyCodes: readonly string[] = [],
		log: (context: SketchContext, seconds: number) => object = () => ({}),
	) =>
		start(
			(context) => {
				context.scene.createGroup({ name: 'Car' });
				return log(context, seconds);
			},
			undefined,
			{ holdSeconds: seconds, holdScript: { steps }, keyCodes },
		);

	it('writes a property before the frame at its time, and dumps it after', async () => {
		const { runner } = await holdOf([
			{ at: 0, verb: 'set', target: 'Car', path: 'position', value: [1, 2, 3] },
			{ at: 0.25, verb: 'set', target: 'Car', path: 'visible', value: [0] },
			{ at: 0.25, verb: 'dump', target: 'Car', path: 'position' },
			{ at: 0.5, verb: 'dump', target: 'Car' },
		]);
		const result = runner.holdScriptResult;
		expect(result?.problems).toEqual([]);
		expect(result?.dumps[0]).toEqual({
			at: 0.25,
			target: 'Car',
			path: 'position',
			value: [1, 2, 3],
		});
		expect(result?.dumps[1]).toMatchObject({
			at: 0.5,
			target: 'Car',
			value: { name: 'Car', kind: 'object', position: [1, 2, 3], visible: false },
		});
	});

	it('gives a key pressed at its time to the frames that follow, and releases it', async () => {
		/** The key's state at each frame from a third of a second to a half. */
		const states: boolean[] = [];
		const { runner } = await holdOf(
			[
				{ at: 0, verb: 'key', code: 'KeyW', down: true },
				{ at: 0.4, verb: 'key', code: 'KeyW', down: false },
			],
			0.5,
			['KeyW'],
			({ input, time }) => ({
				onUpdate: () => {
					if (time.now > 0.3 && time.now < 0.5) states.push(input.isDown('KeyW'));
				},
			}),
		);
		expect(runner.holdScriptResult?.problems).toEqual([]);
		expect(states.length).toBeGreaterThan(3);
		expect(states.slice(0, -2)).toContain(true);
		expect(states.slice(-1)).toEqual([false]);
	});

	it('moves and presses the pointer, which the frames read as the mouse', async () => {
		/** The pointer's position and main button in the frame at a half second. */
		let seen: [number, number, number] = [0, 0, 0];
		const { runner } = await holdOf(
			[
				{ at: 0, verb: 'pointer', action: 'move', x: 100, y: 50 },
				// A press without a place keeps the pointer where it is.
				{ at: 0.2, verb: 'pointer', action: 'down' },
			],
			0.5,
			[],
			({ input, time }) => ({
				onUpdate: () => {
					if (time.now === 0.5) seen = [input.pointer.x, input.pointer.y, input.pointer.buttons];
				},
			}),
		);
		expect(runner.holdScriptResult?.problems).toEqual([]);
		expect(seen).toEqual([100, 50, 1]);
	});

	it('says why a target is not in the scene, and names those that are close', async () => {
		const { runner } = await holdOf([
			{ at: 0.1, verb: 'set', target: 'Cr', path: 'position', value: [0, 0, 0] },
		]);
		expect(runner.holdScriptResult?.problems).toEqual([
			{
				at: 0.1,
				step: 'set "Cr".position',
				error: 'the scene has no object named "Cr". Names that are close: "Car".',
			},
		]);
	});

	it('says why a property is not one that the object takes', async () => {
		const { runner } = await holdOf([
			{ at: 0, verb: 'set', target: 'Car', path: 'speed', value: [1] },
		]);
		const problem = runner.holdScriptResult?.problems[0];
		expect(problem?.step).toBe('set "Car".speed');
		expect(problem?.error).toContain('set() got "speed" on "Car"');
		expect(problem?.error).toContain('position');
	});

	it('says why a key is not one that the engine reads, and goes on', async () => {
		const { runner } = await holdOf([
			{ at: 0, verb: 'key', code: 'KeyZ', down: true },
			{ at: 0.5, verb: 'dump', target: 'Car', path: 'position' },
		]);
		expect(runner.holdScriptResult?.problems).toEqual([
			{
				at: 0,
				step: 'key KeyZ down',
				error:
					'the engine reads no key named "KeyZ". Name a key by its code on a standard keyboard, such as KeyA, Space or ArrowLeft.',
			},
		]);
		expect(runner.holdScriptResult?.dumps).toHaveLength(1);
	});
});

describe('recording a session and replaying it', () => {
	/** The key that the session presses, as the harness numbers it. */
	const KEYS = ['KeyW'];

	/** What a frame showed the sketch: its time, its step and whether the key was down. */
	const seenLine = (now: number, dt: number, down: boolean) =>
		`${now.toFixed(6)} ${dt.toFixed(6)} ${down ? 1 : 0}`;

	/** A sketch that logs what each frame gave it: its time, its step and the key that drove it. */
	const logging = (lines: string[]) => (context: SketchContext) => {
		const { input, time } = context;
		return {
			onUpdate(dt: number) {
				lines.push(seenLine(time.now, dt, input.isDown('KeyW')));
			},
		};
	};

	it('records each frame’s step and the input it read, and replays them to the same states', async () => {
		/** What the live session's frames gave the sketch. */
		const live: string[] = [];
		const session = await start(logging(live), undefined, { keyCodes: KEYS, record: true });
		session.runner.step(0);
		// A key press lands before the second frame, then a long frame, then a release.
		writeInputEvent(session.control, EVENT_KEY_DOWN, 0, 0, 0, 0, 0, 0, 0);
		session.runner.step(1000 / 60);
		session.runner.step(1000 / 60 + 200);
		writeInputEvent(session.control, EVENT_KEY_UP, 0, 0, 0, 0, 0, 0, 0);
		session.runner.step(1000 / 60 + 216);
		session.runner.step(1000 / 60 + 232);

		const bytes = await session.runner.saveRecording();
		expect(bytes).toBeDefined();
		const program = decodeRecording(bytes as Uint8Array);
		expect(program.fixedRate).toBe(60);
		expect(program.steps.length).toBe(5);

		/** What the replay's frames gave the sketch. */
		const replayed: string[] = [];
		const replay = await start(logging(replayed), undefined, { keyCodes: KEYS, replay: program });
		expect(replayed).toEqual(live);
		expect(replay.runner.replayOutcome).toEqual({
			frames: 5,
			seconds: program.steps.reduce((sum, step) => sum + step, 0),
			sketch: 'http://localhost/sketch.ts',
			stopped: false,
		});
	});

	it('runs no recording when the page does not record, and no replay when it gives none', async () => {
		const lines: string[] = [];
		const session = await start(logging(lines), undefined, { keyCodes: KEYS });
		session.runner.step(0);
		expect(await session.runner.saveRecording()).toBeUndefined();
		expect(session.runner.replayOutcome).toBeUndefined();
	});

	it('refuses a recording of a sketch with another fixed rate, naming both rates', async () => {
		const program = {
			seed: 1,
			fixedRate: 30,
			sketch: 'http://localhost/sketch.ts',
			stopped: false,
			steps: new Float64Array([0]),
			starts: new Uint32Array([0]),
			counts: new Uint32Array([0]),
			events: new Float64Array(0),
			keyNames: [],
			stride: 7,
		} satisfies ReplayProgram;
		await expect(
			start(logging([]), undefined, { keyCodes: KEYS, replay: program }),
		).rejects.toThrow('the recording runs 30 fixed steps a second, and this sketch runs 60');
	});

	it('refuses a recording that names a key that this engine does not have', async () => {
		const program = {
			seed: 1,
			fixedRate: 60,
			sketch: 'http://localhost/sketch.ts',
			stopped: false,
			steps: new Float64Array([0]),
			starts: new Uint32Array([0]),
			counts: new Uint32Array([1]),
			events: new Float64Array([EVENT_KEY_DOWN, 0, 0, 0, 0, 0, 0]),
			keyNames: ['KeyZ'],
			stride: 7,
		} satisfies ReplayProgram;
		await expect(
			start(logging([]), undefined, { keyCodes: KEYS, replay: program }),
		).rejects.toThrow('the recording used the key "KeyZ"');
	});
});
