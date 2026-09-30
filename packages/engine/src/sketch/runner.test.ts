import { describe, expect, it, spyOn } from 'bun:test';
import { messageOf } from '../errors/message';
import * as C from '../generated/core';
import type { EngineCapabilities } from '../page/engine';
import { presetSettings } from '../quality/presets';
import type { Material, MeshGeometry } from '../scene/resources';
import { controlViews, createControlBuffer, Slot } from '../shared/control';
import type { CoreGlue } from '../shared/core';
import { createMetricsBuffer } from '../shared/metrics';
import { defineSketch, type SketchContext, type SketchOptions } from './define-sketch';
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

/**
 * A runner of a sketch whose callbacks come from `callbacks` on the Medium preset, with a log of
 * what each frame ran and of the settings that the page got.
 */
async function start(
	callbacks: (context: SketchContext, log: string[]) => object,
	options?: SketchOptions,
) {
	const log: string[] = [];
	const control = controlViews(createControlBuffer(false));
	control.slotFloats[Slot.CanvasCssWidth] = 320;
	control.slotFloats[Slot.CanvasCssHeight] = 180;
	control.slotFloats[Slot.PixelRatio] = 2;
	const memory = new WebAssembly.Memory({ initial: 2 });
	const runner = new SketchRunner(() => {}, createMetricsBuffer(false, 0), {
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
			shaderBits: 0,
			cellCulling: true,
		},
		capabilities: CAPABILITIES,
		quality: { preset: 'medium', settings: presetSettings('medium') },
		applyQuality: (settings) => log.push(`page ${JSON.stringify(settings)}`),
		sendImage: () => {},
		pageUrl: 'http://localhost/',
	});
	let context: SketchContext | undefined;
	await runner.setup(
		defineSketch((ctx) => {
			context = ctx;
			return callbacks(ctx, log);
		}, options),
	);
	return { runner, log, control, context: context as SketchContext };
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
			`page ${JSON.stringify({ maxPixelRatio: 1, maxAnisotropy: 2, uploadBytesPerFrame: 65_536 })}`,
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
