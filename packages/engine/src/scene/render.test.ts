import { describe, expect, it } from 'bun:test';
import { coreFailure } from '../errors/core-failure';
import type { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
import type { CoreMemory } from './memory';
import { Render } from './render';
import type { Camera, Scene } from './scene';
import { ShaderPreloads } from './shader-preloads';

/** A camera that records the targets that it sends its lens to, with their layers. */
function camera(layers = 1) {
	const lenses: [number, number][] = [];
	const object = {
		layers,
		destroyedFrame: -1,
		describe: () => '"Map camera" (slot 3)',
		sendLens(_glue: unknown, target: number, sent = layers) {
			lenses.push([target, sent]);
		},
	};
	return { camera: object as unknown as Camera, lenses };
}

/**
 * A render namespace whose core gives each scene pass the next view place, fails with the graph's
 * error when a pass reads a name that no pass writes, and records the calls.
 */
function setup() {
	const calls: unknown[][] = [];
	const preloads: string[][] = [];
	let error: [number, string] = [0, ''];
	let next = 1;
	const written = new Set<string>();
	const glue = {
		addScenePass(...args: unknown[]) {
			calls.push(['add', ...args]);
			const [, target, reads] = args as [string, string, string];
			const missing = reads.split('\n').find((read) => read !== '' && !written.has(read));
			if (missing !== undefined) {
				error = [1502, `E1502: the pass "${args[0]}" uses "${missing}", but no pass creates it.`];
				return 0;
			}
			written.add(target);
			return next++;
		},
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
		check(result: number, call: string, what?: string, isStatus = false) {
			if (isStatus ? result !== 0 : result === 0) throw coreFailure(glue, call, what);
			return result;
		},
	} as unknown as CoreMemory;
	const cameras: [number, Camera | undefined, number | undefined][] = [];
	const scene = {
		setPassCamera(place: number, camera: Camera | undefined, layers: number | undefined) {
			cameras.push([place, camera, layers]);
			if (camera) camera.sendLens(glue as never, C.CAMERA_TARGET_PASS_VIEWS + place, layers);
		},
	} as unknown as Scene;
	const shaders = new ShaderPreloads((features) => preloads.push([...features]));
	return {
		render: new Render(core, scene, shaders, 4096),
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
		expect(calls[0]).toEqual(['add', 'minimap', 'minimap', '', 256, 128, false, 0, 0, 0, 1]);
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
		expect(add({ kind: 'fullscreen', camera: map, writes: 'a', size: [8, 8] }).code).toBe('E1220');
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
		expect(error.message).toContain(`at most ${C.SCENE_PASS_MAX} scene passes`);
	});

	it("dumps the core's graph", () => {
		const { render } = setup();
		expect(render.dumpGraph()).toBe('digraph "render graph" {}');
	});
});
