import { describe, expect, it } from 'bun:test';
import { coreFailure } from '../errors/core-failure';
import type { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
import { FORMAT_R32_FLOAT, FORMAT_RGBA16_FLOAT } from '../generated/gpu';
import { defineFeature } from './features';
import type { CoreMemory } from './memory';
import { Render } from './render';
import type { Camera, Scene } from './scene';
import { ShaderPreloads } from './shader-preloads';
import { ShaderTemplates } from './shader-templates';
import { Texture } from './textures';

/** A camera that records the targets that it sends its lens to, with their layers. */
function camera(layers = 1) {
	const lenses: [number, number][] = [];
	const object = {
		layers,
		destroyedFrame: -1,
		describe: () => '"Map camera" (slot 3)',
		sendLens(_core: unknown, target: number, sent = layers) {
			lenses.push([target, sent]);
		},
	};
	return { camera: object as unknown as Camera, lenses };
}

/**
 * A render namespace whose core gives each scene pass the next view place, fails with the graph's
 * error when a pass reads a name that no pass writes, and records the calls.
 */
function setup(webgl2 = false) {
	const calls: unknown[][] = [];
	const preloads: string[][] = [];
	let error: [number, string] = [0, ''];
	let next = 1;
	const written = new Set<string>();
	// The core's memory, with the block of values first and the block of texture handles after it.
	const memory = new ArrayBuffer(512);
	const values = new Float32Array(memory, 0, C.EFFECT_FLOATS);
	const textures = new Uint32Array(memory, 256, C.EFFECT_TEXTURES);
	const glue = {
		addPass(...args: unknown[]) {
			calls.push(['add', ...args]);
			const [, pass, target, reads] = args as [number, string, string, string];
			const missing = reads.split('\n').find((read) => read !== '' && !written.has(read));
			if (missing !== undefined) {
				error = [1502, `E1502: the pass "${pass}" uses "${missing}", but no pass creates it.`];
				return 0;
			}
			written.add(target);
			return next++;
		},
		addFullscreenPass(...args: unknown[]) {
			calls.push(['fullscreen', ...args, [...values], [...textures]]);
			return next++;
		},
		addComputePass(...args: unknown[]) {
			calls.push(['compute', ...args, [...values], [...textures]]);
			return next++;
		},
		setComputeValues(place: number) {
			calls.push(['compute-values', place, [...values], [...textures]]);
			return 0;
		},
		setPassValues(place: number) {
			calls.push(['values', place, [...values], [...textures]]);
			return 0;
		},
		effectValues: () => 0,
		effectTextures: () => 256,
		removeScenePass(place: number) {
			calls.push(['remove', place]);
			return 0;
		},
		setScenePassEnabled(place: number, on: boolean) {
			calls.push(['enabled', place, on]);
			return 0;
		},
		renderGraphDot: () => 'digraph "render graph" {}',
		renderGraphMessage: () => error[1],
		lastErrorCode: () => error[0],
		lastErrorDetail: () => 0,
	};
	const core = {
		glue,
		generation: 0,
		heap: (type: typeof Float32Array | typeof Uint32Array) => new type(memory),
		check(result: number, call: string, what?: string, isStatus = false) {
			if (isStatus ? result !== 0 : result === 0) throw coreFailure(glue, call, what);
			return result;
		},
	} as unknown as CoreMemory;
	const cameras: [number, Camera | undefined, number | undefined][] = [];
	const scene = {
		setPassCamera(place: number, camera: Camera | undefined, layers: number | undefined) {
			cameras.push([place, camera, layers]);
			if (camera) camera.sendLens(core, C.CAMERA_TARGET_PASS_VIEWS + place, layers);
		},
	} as unknown as Scene;
	const shaders = new ShaderPreloads((features) => preloads.push([...features]));
	const sent: number[] = [];
	const templates = new ShaderTemplates((template) => sent.push(template));
	return {
		render: new Render(core, scene, shaders, templates, 4096, webgl2),
		sent,
		scene: scene as unknown as Scene,
		calls,
		cameras,
		preloads,
	};
}

/** The error that `run` throws. */
function thrown(run: () => unknown): EngineError {
	try {
		run();
	} catch (error) {
		return error as EngineError;
	}
	throw new Error('the call did not throw');
}

/** A compiled compute shader: a whole module with a `@compute` entry point. */
function computeWgsl(source = '@compute @workgroup_size(8, 8) fn main() {}') {
	return {
		kind: 'shader',
		webgpu: { permutation: 0, wgsl: { source, pipelines: {} }, glsl: null },
		webgl2: null,
	};
}

/** Options of a compute pass whose description publishes the texture `field`. */
function computePass(extra: Record<string, unknown> = {}): never {
	const description = defineFeature({
		name: 'ocean',
		frame: 'background',
		kind: 'compute',
		outputs: { field: { default: 'black' } },
	});
	return { kind: 'compute', description, wgsl: computeWgsl(), ...extra } as never;
}

/** Options of a compute pass that fills the two buffers of an instance draw. */
function computeBuffers(extra: Record<string, unknown> = {}): never {
	const description = defineFeature({
		name: 'quad-fill',
		frame: 'opaque',
		kind: 'compute',
		band: 'before',
	});
	return {
		kind: 'compute',
		description,
		wgsl: computeWgsl(),
		buffers: [
			{ buffer: 41, bytes: 4 },
			{ buffer: 42, bytes: 4096 },
		],
		dispatch: [1, 1, 1],
		...extra,
	} as never;
}

describe('render passes', () => {
	it('adds a scene pass with its camera, size and reads, and asks for its shader file once', () => {
		const { render, calls, preloads } = setup();
		const { camera: map, lenses } = camera(0b11);
		const pass = render.addPass({
			kind: 'scene',
			camera: map,
			writes: 'minimap',
			size: [256, 128],
		});
		expect(pass.live).toBe(true);
		expect([pass.name, pass.writes, pass.width, pass.height, pass.enabled]).toEqual([
			'minimap',
			'minimap',
			256,
			128,
			true,
		]);
		// A scene pass of its own size, whose camera sends its layers.
		expect(calls[0]).toEqual([
			'add',
			C.PASS_KIND_SCENE,
			'minimap',
			'minimap',
			'',
			256,
			128,
			false,
			0,
			0,
			0,
			1,
			1,
			1,
			-1,
			0,
			1,
			0,
			0,
			0,
			0,
		]);
		// The camera sends its lens to the pass's view, with its own layers.
		expect(lenses).toEqual([[C.CAMERA_TARGET_PASS_VIEWS + 1, 0b11]]);

		const { camera: other } = camera();
		render.addPass({
			kind: 'scene',
			camera: other,
			writes: 'mirror',
			name: 'Mirror',
			size: [64, 64],
			reads: ['minimap'],
			layers: 4,
			clearColor: [0.5, 0.25, 1],
			clearAlpha: 0.5,
		});
		expect(calls[1]).toEqual([
			'add',
			C.PASS_KIND_SCENE,
			'Mirror',
			'mirror',
			'minimap',
			64,
			64,
			true,
			0.5,
			0.25,
			1,
			0.5,
			1,
			1,
			4,
			0,
			1,
			0,
			0,
			0,
			0,
		]);
		expect(preloads).toEqual([['views']]);
		expect(render.takeNewPipelines()).toBe(true);
		expect(render.takeNewPipelines()).toBe(false);
	});

	it('switches and removes passes, and destroys the textures of a removed pass', () => {
		const { render, calls, cameras } = setup();
		const pass = render.addPass({
			kind: 'scene',
			camera: camera().camera,
			writes: 'map',
			size: [8, 8],
		});
		render.setPassEnabled(pass, false);
		render.setPassEnabled(pass, false);
		expect(pass.enabled).toBe(false);
		let destroyed = 0;
		pass.textures.push(
			{ live: true, destroy: () => destroyed++ },
			{ live: false, destroy: () => destroyed++ },
		);
		render.removePass(pass);
		expect(calls.slice(1)).toEqual([
			['enabled', 1, false],
			['remove', 1],
		]);
		expect(destroyed).toBe(1);
		expect(pass.live).toBe(false);
		expect(cameras.at(-1)).toEqual([1, undefined, undefined]);
		expect(thrown(() => render.setPassEnabled(pass, true)).code).toBe('E1101');
		expect(thrown(() => render.removePass(pass)).code).toBe('E1101');
		// Its texture name is free again.
		render.addPass({ kind: 'scene', camera: camera().camera, writes: 'map', size: [8, 8] });
	});

	it('throws the graph error with its names, and the pass is not added', () => {
		const { render } = setup();
		const error = thrown(() =>
			render.addPass({
				kind: 'scene',
				camera: camera().camera,
				writes: 'map',
				size: [8, 8],
				reads: ['mirror'],
			}),
		);
		expect(error.code).toBe('E1502');
		expect(error.message).toContain(
			'render.addPass() failed: the pass "map" uses "mirror", but no pass creates it.',
		);
	});

	it('refuses options that a scene pass does not take', () => {
		const { render } = setup();
		const map = camera().camera;
		const add = (options: object) => thrown(() => render.addPass(options as never));
		expect(add({ kind: 'blur', camera: map, writes: 'a', size: [8, 8] }).code).toBe('E1220');
		expect(add({ kind: 'scene', camera: map, writes: 'a' }).code).toBe('E1220');
		expect(add({ kind: 'scene', camera: map, writes: 'a', size: [8, 8], scale: 1 }).code).toBe(
			'E1220',
		);
		expect(add({ kind: 'scene', camera: map, writes: 'a', scale: 0.3 }).code).toBe('E1220');
		expect(add({ kind: 'scene', writes: 'a', size: [8, 8] }).code).toBe('E1220');
		expect(add({ kind: 'scene', camera: map, writes: '', size: [8, 8] }).code).toBe('E1220');
		expect(add({ kind: 'scene', camera: map, writes: 'a', size: [0, 8] }).code).toBe('E1220');
		expect(add({ kind: 'scene', camera: map, writes: 'a', size: [8, 4097] }).code).toBe('E1220');
		expect(
			add({ kind: 'scene', camera: map, writes: 'a', size: [8, 8], before: 'Post' }).code,
		).toBe('E1220');
		expect(add({ kind: 'scene', camera: map, writes: 'a', size: [8, 8], layers: 0.5 }).code).toBe(
			'E1207',
		);
		expect(add({ kind: 'scene', camera: map, writes: 'a', size: [8, 8], clearAlpha: 2 }).code).toBe(
			'E1220',
		);
		expect(add({ kind: 'scene', camera: map, writes: 'a', size: [8, 8], reads: ['a'] }).code).toBe(
			'E1504',
		);
		render.addPass({ kind: 'scene', camera: map, writes: 'a', size: [8, 8] });
		const twice = add({ kind: 'scene', camera: map, writes: 'a', size: [8, 8], name: 'Other' });
		expect(twice.code).toBe('E1220');
		expect(twice.message).toContain('which the pass "a" writes already');
		const dead = {
			...map,
			destroyedFrame: 4,
			sendLens: map.sendLens,
			describe: () => '"Old" (slot 2)',
		};
		expect(add({ kind: 'scene', camera: dead, writes: 'b', size: [8, 8] }).code).toBe('E1101');
	});

	it('refuses a scene pass past the most that draw at once', () => {
		const { render } = setup();
		const map = camera().camera;
		for (let index = 0; index < C.SCENE_PASS_MAX; index++)
			render.addPass({ kind: 'scene', camera: map, writes: `t${index}`, size: [8, 8] });
		const error = thrown(() =>
			render.addPass({ kind: 'scene', camera: map, writes: 'last', size: [8, 8] }),
		);
		expect(error.code).toBe('E1220');
		expect(error.message).toContain(`at most ${C.SCENE_PASS_MAX} passes`);
	});

	it('adds a reflection pass with its plane, size, pace and layers, and no camera', () => {
		const { render, calls, cameras, preloads } = setup();
		const water = render.addPass({
			kind: 'reflection',
			writes: 'water',
			plane: { point: [1, -2, 3] },
		});
		expect([water.kind, water.name, water.width, water.height]).toEqual([
			'reflection',
			'water',
			0,
			0,
		]);
		// Without a scale, the preset's sets the size; without layers, the camera's are drawn.
		expect(calls[0]).toEqual([
			'add',
			C.PASS_KIND_REFLECTION,
			'water',
			'water',
			'',
			0,
			0,
			false,
			0,
			0,
			0,
			1,
			0,
			1,
			-1,
			0,
			1,
			0,
			1,
			-2,
			3,
		]);
		render.addPass({
			kind: 'reflection',
			writes: 'floor',
			name: 'Floor',
			plane: { point: [0, 0, 0], normal: [0, 0, 2] },
			scale: 0.25,
			every: 3,
			layers: 2,
			reads: ['water'],
			clearColor: [0.5, 0.25, 1],
		});
		expect(calls[1]).toEqual([
			'add',
			C.PASS_KIND_REFLECTION,
			'Floor',
			'floor',
			'water',
			0,
			0,
			true,
			0.5,
			0.25,
			1,
			1,
			0.25,
			3,
			2,
			0,
			0,
			2,
			0,
			0,
			0,
		]);
		expect(cameras).toEqual([]);
		expect(preloads).toEqual([['views']]);
		render.setPassEnabled(water, false);
		render.removePass(water);
		expect(calls.slice(2)).toEqual([
			['enabled', 1, false],
			['remove', 1],
		]);
	});

	it('refuses options that a reflection pass does not take', () => {
		const { render } = setup();
		const add = (options: object) =>
			thrown(() => render.addPass({ kind: 'reflection', writes: 'w', ...options } as never));
		const point = [0, 0, 0];
		expect(add({}).code).toBe('E1220');
		expect(add({ plane: { normal: [0, 1, 0] } }).code).toBe('E1220');
		expect(add({ plane: { point: [0, Number.NaN, 0] } }).code).toBe('E1220');
		expect(add({ plane: { point, normal: [0, 0, 0] } }).code).toBe('E1220');
		expect(add({ plane: { point }, scale: 0.3 }).code).toBe('E1220');
		expect(add({ plane: { point }, every: 0 }).code).toBe('E1220');
		expect(add({ plane: { point }, every: 1.5 }).code).toBe('E1220');
		const sized = add({ plane: { point }, size: [8, 8] });
		expect(sized.code).toBe('E1220');
		expect(sized.message).toContain('which a reflection pass does not take');
		expect(add({ plane: { point }, layers: 0.5 }).code).toBe('E1207');
		expect(add({ plane: { point }, reads: ['w'] }).code).toBe('E1504');
	});

	it('adds a scene pass that takes a share of the render size', () => {
		const { render, calls } = setup();
		const pass = render.addPass({
			kind: 'scene',
			camera: camera().camera,
			writes: 'half',
			scale: 0.5,
			every: 2,
		});
		expect([pass.width, pass.height]).toEqual([0, 0]);
		const [, kind, , , , width, height, , , , , , scale, every] = calls[0] as number[];
		expect([kind, width, height, scale, every]).toEqual([C.PASS_KIND_SCENE, 0, 0, 0.5, 2]);
	});

	it('adds a full-screen pass with its template, size, input, uniforms and textures', () => {
		const { render, calls, sent } = setup();
		const texture = Object.assign(Object.create(Texture.prototype), { handle: 77, depth: 1 });
		const wgsl = {
			kind: 'effect',
			uniforms: [{ name: 'spread', type: 'vec2f', offset: 0 }],
			depth: true,
			joins: false,
			textures: [
				{ name: 'mask', offset: 31 },
				{ name: 'noise', offset: 30 },
			],
			variants: {},
			pieces: { group: {}, fold: {} },
		};
		const pass = render.addPass({
			kind: 'fullscreen',
			wgsl: wgsl as never,
			writes: 'edges',
			scale: 0.5,
			input: 'outlineMask',
			uniforms: { spread: [2, 3] } as never,
			textures: { mask: texture } as never,
		});
		expect([pass.kind, pass.width, pass.height, pass.camera]).toEqual([
			'fullscreen',
			0,
			0,
			undefined,
		]);
		expect(sent.length).toBe(1);
		const call = calls[0] as unknown[];
		expect(call.slice(0, 10)).toEqual([
			'fullscreen',
			'edges',
			'edges',
			0,
			0,
			0.5,
			1,
			sent[0],
			C.EFFECT_DEPTH,
			C.PASS_SOURCE_OUTLINE_MASK,
		]);
		const [values, handles] = call.slice(10) as [number[], number[]];
		expect(values.slice(0, 2)).toEqual([2, 3]);
		// The texture that the option leaves out samples as white.
		expect(values[30]).toBe(-1);
		expect(handles.slice(0, 3)).toEqual([77, 0, 0]);
		render.setPassUniform(pass, 'spread', [4, 5]);
		const update = calls[1] as [string, number, number[], number[]];
		expect([update[0], update[1], update[2].slice(0, 2), update[3][0]]).toEqual([
			'values',
			1,
			[4, 5],
			77,
		]);
		expect(thrown(() => render.setPassUniform(pass, 'radius', 1)).code).toBe('E1216');
		const scene = render.addPass({
			kind: 'scene',
			camera: camera().camera,
			writes: 'map',
			size: [8, 8],
		});
		expect(thrown(() => render.setPassUniform(scene, 'spread', [1, 1])).code).toBe('E1220');
	});

	it('refuses options that a full-screen pass does not take', () => {
		const { render } = setup();
		const wgsl = {
			kind: 'effect',
			uniforms: [],
			depth: false,
			joins: true,
			textures: [],
			variants: {},
			pieces: { group: {}, fold: {} },
		};
		const add = (options: object) =>
			thrown(() => render.addPass({ kind: 'fullscreen', writes: 'f', wgsl, ...options } as never));
		expect(add({ wgsl: 'fn effect() {}' }).code).toBe('E1215');
		expect(add({ wgsl: { kind: 'material' } }).code).toBe('E1215');
		expect(add({ input: 'sceneDepth' }).code).toBe('E1220');
		expect(add({ scale: 2 }).code).toBe('E1220');
		expect(add({ size: [8, 8], scale: 0.5 }).code).toBe('E1220');
		expect(add({ reads: ['map'] }).code).toBe('E1220');
		expect(add({ textures: { mask: {} } }).code).toBe('E1216');
		expect(add({ uniforms: { radius: 1 } }).code).toBe('E1216');
	});

	it('adds a compute pass that covers its target, and changes its values', () => {
		const { render, calls } = setup();
		const pass = render.addPass(computePass({ values: [0.5, 2] }));
		const call = calls[0] as unknown[];
		expect(call.slice(0, 11)).toEqual([
			'compute',
			'field',
			'field',
			0,
			0,
			1,
			1,
			expect.any(Number),
			FORMAT_RGBA16_FLOAT,
			// 8 along x, 8 along y, one along z.
			8 | (8 << 8) | (1 << 16),
			// No counts: the pass covers its target.
			0,
		]);
		// The three buffer operands follow the counts; a texture pass names none of them.
		expect(call.slice(11, 14)).toEqual([0, 0, 0]);
		const [values, handles] = call.slice(15) as [number[], number[]];
		expect(values.slice(0, 2)).toEqual([0.5, 2]);
		expect([...handles].every((handle) => handle === 0)).toBe(true);
		render.setPassUniforms(pass, [1, 3]);
		const update = calls[1] as [string, number, number[]];
		expect([update[0], update[1], update[2].slice(0, 2)]).toEqual(['compute-values', 1, [1, 3]]);
		expect(thrown(() => render.setPassUniform(pass, 'time', 1)).code).toBe('E1220');
	});

	it('dispatches the workgroup counts that a compute pass gives', () => {
		const { render, calls } = setup();
		render.addPass(computePass({ dispatch: [4, 2, 1], format: 'r32float', scale: 0.5 }));
		const call = calls[0] as unknown[];
		expect([call[5], call[8], call[10]]).toEqual([0.5, FORMAT_R32_FLOAT, 4 | (2 << 8) | 65536]);
	});

	it('refuses a compute pass whose description or options it cannot place', () => {
		const { render } = setup();
		const add = (options: object) => thrown(() => render.addPass(options as never));
		const description = (extra: object = {}) =>
			defineFeature({
				name: 'ocean',
				frame: 'background',
				kind: 'compute',
				outputs: { field: { default: 'black' } },
				...extra,
			} as never);
		expect(add(computePass({ description: description({ outputs: undefined }) })).code).toBe(
			'E1223',
		);
		expect(
			add(computePass({ description: description({ outputs: { f: { default: 'white' } } }) })).code,
		).toBe('E1223');
		expect(
			add(
				computePass({
					description: description({ views: ['scenePass'] }),
				}),
			).code,
		).toBe('E1223');
		expect(add(computePass({ workgroupSize: [4, 4, 1] })).code).toBe('E1220');
		expect(add(computePass({ workgroupSize: [64, 64, 1] })).code).toBe('E1220');
		expect(add(computePass({ wgsl: 'fn main() {}' })).code).toBe('E1215');
		expect(add(computePass({ format: 'rgba32float' as never })).code).toBe('E1220');
	});

	it('runs a compute pass of a WebGL2 page as its fragment form, or refuses it', () => {
		const { render, calls } = setup(true);
		expect(thrown(() => render.addPass(computePass())).code).toBe('E1220');
		const fallback = {
			kind: 'effect',
			uniforms: [],
			depth: false,
			joins: true,
			textures: [],
			variants: {},
			pieces: { group: {}, fold: {} },
		};
		const pass = render.addPass(computePass({ fallback: { wgsl: fallback } }));
		const call = calls[0] as [string, ...unknown[]];
		expect(call[0]).toBe('fullscreen');
		expect([call[1], call[2], call[3], call[4]]).toEqual(['field', 'field', 0, 0]);
		render.setPassUniforms(pass, [7]);
		expect((calls[1] as unknown[])[0]).toBe('values');
	});

	it("dumps the core's graph", () => {
		const { render } = setup();
		expect(render.dumpGraph()).toBe('digraph "render graph" {}');
	});

	it("adds a compute pass that fills an instance draw's two buffers", () => {
		const { render, calls } = setup();
		render.addPass(computeBuffers());
		const call = calls[0] as unknown[];
		// No texture: the pass keeps a 1 by 1 view target of its own, which nothing samples.
		expect(call.slice(0, 10)).toEqual([
			'compute',
			'quad-fill',
			'quad-fill target',
			1,
			1,
			1,
			1,
			expect.any(Number),
			0,
			8 | (8 << 8) | (1 << 16),
		]);
		expect(call.slice(10, 14)).toEqual([1 | (1 << 8) | 65536, 0, 41, 42]);
		expect(call[14]).toBe(4096);
	});

	it('refuses a buffers pass that cannot place its target or its handles', () => {
		const { render } = setup();
		const add = (options: object) => thrown(() => render.addPass(options as never));
		const description = (extra: object = {}) =>
			defineFeature({ name: 'quad-fill', frame: 'opaque', kind: 'compute', ...extra } as never);
		expect(
			add(
				computeBuffers({
					description: description({ outputs: { field: { default: 'black' } } }),
				}),
			).code,
		).toBe('E1223');
		expect(add(computeBuffers({ description: description({ views: ['scenePass'] }) })).code).toBe(
			'E1223',
		);
		expect(add(computeBuffers({ dispatch: undefined })).code).toBe('E1220');
		expect(add(computeBuffers({ dispatch: 'writes' })).code).toBe('E1220');
		expect(add(computeBuffers({ format: 'r32float' })).code).toBe('E1220');
		expect(add(computeBuffers({ size: [8, 8] })).code).toBe('E1220');
		expect(add(computeBuffers({ fallback: { wgsl: computeWgsl() } })).code).toBe('E1220');
		expect(
			add(
				computeBuffers({
					buffers: [
						{ buffer: 0, bytes: 0 },
						{ buffer: 42, bytes: 4096 },
					],
				}),
			).code,
		).toBe('E1220');
		expect(
			add(
				computeBuffers({
					buffers: [
						{ buffer: 41, bytes: 4 },
						{ buffer: 41, bytes: 4 },
					],
				}),
			).code,
		).toBe('E1220');
	});

	it('refuses a buffers pass on a WebGL2 page', () => {
		const { render } = setup(true);
		expect(thrown(() => render.addPass(computeBuffers())).code).toBe('E1220');
	});
});
