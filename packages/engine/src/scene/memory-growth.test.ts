// The single-threaded build's memory detaches every view when it grows, so a write through a view
// made before the growth is lost. These tests grow a fake core's memory in each call that can grow
// the real core's, and check that the sketch's next writes land, in the same callback.
import { beforeEach, describe, expect, test } from 'bun:test';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import * as C from '../generated/core';
import type { CoreGlue } from '../shared/core';
import { CoreMemory } from './memory';
import { type Material, Materials, type MeshGeometry } from './resources';
import { Scene } from './scene';
import { Textures } from './textures';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** Object slots, and records of the command ring, in the fake core. */
const CAPACITY = 15;
const RING = 64;
/** Rows of the fake core's one instance batch. */
const ROWS = 4;
/** Where the fake core keeps its arrays: each scene field, the ring, the batch and texel data. */
const AT = { fields: 0, records: 8192, write: 12288, read: 12292, batch: 16384, texels: 20480 };

/**
 * A core whose memory is not shared, as the single-threaded build's, and grows by a page in each
 * call that can make the engine core allocate.
 */
function growingCore() {
	const memory = new WebAssembly.Memory({ initial: 1, maximum: 64 });
	let growths = 0;
	/** Grows the memory, which detaches every view of the old buffer, and passes `result` on. */
	const grow = <T>(result: T): T => {
		memory.grow(1);
		growths++;
		return result;
	};
	let next = 0;
	const glue = {
		sceneCapacity: () => CAPACITY,
		sceneArrays: (field: number) => AT.fields + field * 512,
		commandRing: (field: number) => [AT.records, RING, AT.write, AT.read][field] as number,
		reserveObject: () => ++next,
		createLight: () => grow(1),
		setLightValue: () => 0,
		setLightColor: () => 0,
		createMaterial: () => grow(1),
		setMaterialValue: () => 0,
		createTexture: () => grow(1),
		setTextureData: () => grow(AT.texels),
		textureStat: () => 64,
		createBatch: () => grow(1),
		batchArrays: (_id: number, field: number) => AT.batch + field * 64,
		setBatchActiveCount: () => 0,
		lastErrorCode: () => 0,
		lastErrorDetail: () => 0,
	};
	const core = new CoreMemory(glue as unknown as CoreGlue, memory);
	const time = { frame: 1 };
	const scene = new Scene(core, time, false);
	const materials = new Materials(core);
	const textures = new Textures(core, () => {}, time, 0);
	const floats = (at: number, length: number) => [...new Float32Array(memory.buffer, at, length)];
	return { core, scene, materials, textures, floats, growths: () => growths };
}

/** A mesh the fake core never needs to know. */
const box = (core: CoreMemory) => ({ id: 1, radius: 1, core }) as unknown as MeshGeometry;
/** A material the fake core never needs to know. */
const paint = (core: CoreMemory) => ({ id: 1, core }) as unknown as Material;

describe('writes after a call that grows the engine memory', () => {
	const calls: Record<string, (c: ReturnType<typeof growingCore>) => void> = {
		createPointLight: ({ scene }) => scene.createPointLight({ range: 5 }),
		'materials.standard': ({ materials }) => materials.standard(),
		'textures.fromData': ({ textures }) =>
			textures.fromData({ width: 4, height: 4, data: new Uint8Array(4 * 4 * 4) }),
		'a texture from a file': ({ textures }) =>
			textures.fromTexels(
				{
					width: 4,
					height: 4,
					depth: 1,
					levels: 1,
					format: 'rgba8unorm',
					colorSpace: 'srgb',
					texels: new Uint8Array(4 * 4 * 4),
				},
				{},
				'assets.loadTexture',
			),
	};
	for (const [name, call] of Object.entries(calls)) {
		test(`land in a batch, an object and the command ring after ${name}`, () => {
			const growing = growingCore();
			const { core, scene, floats } = growing;
			const material = new Materials(core).unlit();
			const flock = scene.createInstances(box(core), ROWS, { material });
			const crate = scene.createMesh({ mesh: box(core), material });
			flock.positions.fill(0);
			const before = growing.growths();
			call(growing);
			expect(growing.growths()).toBeGreaterThan(before);
			flock.positions[0] = 5;
			crate.setPosition(7, 8, 9);
			crate.setVisible(false);
			const batchPositions = AT.batch + C.BATCH_FIELD_POSITIONS * 64;
			expect(floats(batchPositions, 1)).toEqual([5]);
			const positions = AT.fields + C.SCENE_FIELD_POSITIONS * 512;
			expect(floats(positions + crate.slot * 12, 3)).toEqual([7, 8, 9]);
		});
	}
});

/**
 * A core whose scene starts with room for `start` objects and moves its arrays to a larger place,
 * as the engine core's scene does when it grows, on the reserve that finds it full. The core
 * counts each move in a word that the views check.
 */
function growingScene(start: number) {
	const memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
	const at = { small: 0, large: 16384, records: 8192, write: 12288, read: 12292, moved: 12296 };
	let capacity = start;
	let base = at.small;
	let next = 0;
	const moved = new Uint32Array(memory.buffer, at.moved, 1);
	const grow = () => {
		capacity = capacity * 2 + 1;
		base = at.large;
		moved[0] = (moved[0] as number) + 1;
	};
	const room = (count: number) => {
		if (next + count > capacity) grow();
	};
	const glue = {
		sceneCapacity: () => capacity,
		sceneArrays: (field: number) => base + field * 1024,
		commandRing: (field: number) => [at.records, RING, at.write, at.read][field] as number,
		reserveObject: () => {
			room(1);
			return ++next;
		},
		lastErrorCode: () => 0,
		lastErrorDetail: () => 0,
	};
	const core = new CoreMemory(glue as unknown as CoreGlue, memory, at.moved);
	const scene = new Scene(core, { frame: 1 }, false);
	const position = (slot: number) => [
		...new Float32Array(memory.buffer, base + C.SCENE_FIELD_POSITIONS * 1024 + slot * 12, 3),
	];
	return { core, scene, position, grow, base: () => base, at };
}

describe('writes after the scene grows', () => {
	test('land in the moved arrays, for the object that made it grow and for older ones', () => {
		const { core, scene, position, base, at } = growingScene(2);
		const generation = core.generation;
		const [mesh, material] = [box(core), paint(core)];
		const first = scene.createMesh({ mesh, material, position: [1, 2, 3] });
		scene.createMesh({ mesh, material });
		expect(base()).toBe(at.small);
		const third = scene.createMesh({ mesh, material, position: [4, 5, 6] });
		expect(base()).toBe(at.large);
		expect(core.generation).toBeGreaterThan(generation);
		expect(position(third.slot)).toEqual([4, 5, 6]);
		first.setPosition(7, 8, 9);
		expect(position(first.slot)).toEqual([7, 8, 9]);
	});

	test("land in the moved arrays after a growth at a frame's start", () => {
		const { core, scene, position, grow } = growingScene(15);
		const crate = scene.createMesh({ mesh: box(core), material: paint(core) });
		grow();
		expect(core.refresh()).toBe(true);
		expect(core.refresh()).toBe(false);
		crate.setPosition(1, 1, 1);
		expect(position(crate.slot)).toEqual([1, 1, 1]);
	});
});
