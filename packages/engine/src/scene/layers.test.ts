import { beforeEach, describe, expect, test } from 'bun:test';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import * as C from '../generated/core';
import type { CoreGlue } from '../shared/core';
import { CoreMemory } from './memory';
import { Material, MeshGeometry } from './resources';
import { Scene } from './scene';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** Scene slots of the fake core, and records of its command ring. */
const CAPACITY = 15;
const RING = 64;
/** Where the fake core keeps its arrays in memory: the scene's fields, then the ring. */
const AT = { fields: 0, records: 2048, write: 4096, read: 4100 };

/** A core that hands out slots, keeps the command ring in memory, and records its other calls. */
function fakeCore() {
	const memory = new WebAssembly.Memory({ initial: 1 });
	let slot = 0;
	const cameras: number[][] = [];
	const batchLayers: [number, number][] = [];
	const glue = {
		sceneCapacity: () => CAPACITY,
		sceneArrays: (field: number) => AT.fields + field * 256,
		commandRing: (field: number) => [AT.records, RING, AT.write, AT.read][field] as number,
		reserveObject: () => ++slot,
		setPerspectiveCamera: (...values: number[]) => {
			cameras.push(values);
			return 0;
		},
		setOrthographicCamera: (...values: number[]) => {
			cameras.push(values);
			return 0;
		},
		createBatch: () => 7,
		setBatchActiveCount: () => 0,
		setBatchLayers: (batch: number, mask: number) => {
			batchLayers.push([batch, mask]);
			return 0;
		},
		lastErrorCode: () => 0,
		lastErrorDetail: () => 0,
	};
	const core = new CoreMemory(glue as unknown as CoreGlue, memory);
	const scene = new Scene(core, { frame: 1 });
	/** The command records the scene queued, as [operation, handle, a, b]. */
	const commands = () => {
		const words = new Uint32Array(memory.buffer, AT.records, RING * C.COMMAND_WORDS);
		const written = new Uint32Array(memory.buffer, AT.write, 1)[0] as number;
		return Array.from({ length: written }, (_, k) => [...words.subarray(k * 4, k * 4 + 4)]);
	};
	const box = new MeshGeometry(1, 1, core);
	const paint = new Material(1, core, 'materials.standard');
	return { scene, commands, cameras, batchLayers, box, paint };
}

/** The layer commands among `records`, as [handle, mask]. */
const layerCommands = (records: number[][]) =>
	records.filter((r) => r[0] === C.COMMAND_SET_LAYERS).map((r) => [r[1], r[2]]);

/** The error that `call` throws. */
function thrown(call: () => void): EngineError {
	try {
		call();
	} catch (error) {
		return error as EngineError;
	}
	throw new Error('the call did not throw');
}

describe('layers', () => {
	test('a mesh created on the default layer queues no layer change', () => {
		const { scene, commands, box, paint } = fakeCore();
		scene.createMesh({ mesh: box, material: paint });
		scene.createMesh({ mesh: box, material: paint, layers: 1 });
		expect(layerCommands(commands())).toEqual([]);
	});

	test('a mesh created on other layers takes them right after it is created', () => {
		const { scene, commands, box, paint } = fakeCore();
		const mesh = scene.createMesh({ mesh: box, material: paint, layers: 0b110 });
		const records = commands();
		expect(records[0]?.[0]).toBe(C.COMMAND_CREATE | ((C.FLAG_VISIBLE << 8) >>> 0));
		expect(records[1]).toEqual([C.COMMAND_SET_LAYERS, mesh.handle, 0b110, 0]);
	});

	test('setLayers queues the mask as 32 unsigned bits, layer 31 too', () => {
		const { scene, commands, box, paint } = fakeCore();
		const mesh = scene.createMesh({ mesh: box, material: paint });
		mesh.setLayers(1 << 31);
		mesh.setLayers(0);
		expect(layerCommands(commands())).toEqual([
			[mesh.handle, 0x8000_0000],
			[mesh.handle, 0],
		]);
	});

	test("the active camera's layers reach the view it draws", () => {
		const { scene, commands, cameras } = fakeCore();
		const camera = scene.createPerspectiveCamera({ layers: 0b100 });
		scene.setActiveCamera(camera);
		expect(cameras.at(-1)).toEqual([camera.handle, 50, 0.1, 2000, 0b100]);
		camera.setLayers(0b11);
		expect(cameras.at(-1)).toEqual([camera.handle, 50, 0.1, 2000, 0b11]);
		// The camera object keeps the same mask, as every object does.
		expect(layerCommands(commands())).toEqual([
			[camera.handle, 0b100],
			[camera.handle, 0b11],
		]);
		// A camera that is not active changes no view.
		const other = scene.createPerspectiveCamera();
		other.setLayers(0b1000);
		expect(cameras.at(-1)).toEqual([camera.handle, 50, 0.1, 2000, 0b11]);
		scene.setActiveCamera(other);
		expect(cameras.at(-1)).toEqual([other.handle, 50, 0.1, 2000, 0b1000]);
		// An orthographic camera's view takes its layers with its lens.
		const map = scene.createOrthographicCamera({ height: 10, layers: 0b10 });
		scene.setActiveCamera(map);
		expect(cameras.at(-1)).toEqual([map.handle, 10, 0, 0, 0, 0.1, 2000, 0b10]);
		map.setOrthoHeight(20);
		expect(cameras.at(-1)).toEqual([map.handle, 20, 0, 0, 0, 0.1, 2000, 0b10]);
	});

	test("a batch's rows take its layers from the create options and from setLayers", () => {
		const { scene, batchLayers, box, paint } = fakeCore();
		const batch = scene.createInstances(box, 10, { material: paint, layers: 0b10 });
		batch.setLayers(-1);
		expect(batchLayers).toEqual([
			[7, 0b10],
			[7, 0xffff_ffff],
		]);
	});

	test('a number that is not a 32-bit mask throws E1207 before anything changes', () => {
		const { scene, commands, batchLayers, box, paint } = fakeCore();
		const mesh = scene.createMesh({ mesh: box, material: paint, name: 'Player' });
		const before = commands().length;
		for (const mask of [2.5, Number.NaN, 2 ** 32, -(2 ** 31) - 1]) {
			const error = thrown(() => mesh.setLayers(mask));
			expect(error.code).toBe('E1207');
			expect(error.message).toStartWith(
				`E1207: setLayers() got ${mask} on "Player" (slot 1), which is not a 32-bit layer mask.`,
			);
		}
		expect(thrown(() => scene.createMesh({ mesh: box, material: paint, layers: 0.5 })).code).toBe(
			'E1207',
		);
		expect(
			thrown(() => scene.createInstances(box, 4, { material: paint, layers: Number.NaN })).code,
		).toBe('E1207');
		expect(commands().length).toBe(before);
		expect(batchLayers).toEqual([]);
	});
});
