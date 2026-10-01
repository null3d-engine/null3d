// Test support for stale-calls.test.ts, which runs it as a development build and as a release
// build. A sketch with a bug calls a light, an object and an instance batch after it destroyed
// them, once a new one took each one's place. The fake core below hands out slots, light rows and
// batch memory again as the engine core does: a light row at once, and an object's slot once the
// slot comes back from its queue of freed slots.

import * as C from '../generated/core';
import type { CoreGlue } from '../shared/core';
import { CoreMemory } from './memory';
import { Material, MeshGeometry } from './resources';
import { Scene } from './scene';

/** What the calls on the destroyed things left behind. */
export interface StaleCallsResult {
	/** The code of the error that each call threw, by call. A call that threw nothing is absent. */
	errors: Record<string, string>;
	/** The light that took the destroyed light's row: whether its row holds it, and its values. */
	light: { live: boolean; intensity: number; color: number[] };
	/** The position of the object that took the destroyed object's slot. */
	position: number[];
	/** The first row of positions of the batch that took the destroyed batch's memory. */
	batchRow: number[];
}

/** Object slots in the fake core; its arrays have one more row, as the engine core's do. */
const CAPACITY = 7;
/** Records in the fake core's command ring. */
const RING = 16;
/** Where the fake core keeps each array in its memory, in bytes. */
const AT = {
	positions: 0,
	rotations: 128,
	scales: 256,
	radii: 384,
	centers: 448,
	dirty: 576,
	records: 1024,
	write: 1536,
	read: 1540,
	batch: 2048,
};
const SLOT_BITS = C.HANDLE_SLOT_BITS;
const SLOT_MASK = (1 << SLOT_BITS) - 1;
/** The core's codes for a handle whose object was destroyed, and for one that names nothing. */
const STALE_HANDLE = 1101;
const INVALID_HANDLE = 1103;

interface LightRow {
	live: boolean;
	intensity: number;
	color: number[];
}

/** A core that keeps the scene's arrays, a light table and one batch's memory. */
function fakeCore() {
	const memory = new WebAssembly.Memory({ initial: 1 });
	let failure = 0;
	const fail = (code: number) => {
		failure = code;
		return code;
	};
	let next = 1;
	/** The handle that the next object gets, when a test gives a freed slot back. */
	let reused: number | undefined;
	const rows: LightRow[] = [{ live: false, intensity: 0, color: [] }];
	const freeRows: number[] = [];
	const row = (light: number) => {
		const found = rows[light];
		return found?.live ? found : undefined;
	};
	/** The live batch's id, whose generation rises each time a batch takes the memory. */
	let batch = 0;
	let batchGeneration = 0;
	const fields: Record<number, number> = {
		[C.SCENE_FIELD_POSITIONS]: AT.positions,
		[C.SCENE_FIELD_ROTATIONS]: AT.rotations,
		[C.SCENE_FIELD_SCALES]: AT.scales,
		[C.SCENE_FIELD_LOCAL_RADII]: AT.radii,
		[C.SCENE_FIELD_LOCAL_CENTERS]: AT.centers,
		[C.SCENE_FIELD_DIRTY_WORDS]: AT.dirty,
	};
	const ring: Record<number, number> = {
		[C.RING_FIELD_RECORDS]: AT.records,
		[C.RING_FIELD_CAPACITY]: RING,
		[C.RING_FIELD_WRITE_INDEX]: AT.write,
		[C.RING_FIELD_READ_INDEX]: AT.read,
	};
	const glue = {
		sceneCapacity: () => CAPACITY,
		sceneArrays: (field: number) => fields[field],
		commandRing: (field: number) => ring[field],
		reserveObject: () => {
			const handle = reused ?? next++;
			reused = undefined;
			return handle;
		},
		createLight: () => {
			const light = freeRows.pop() ?? rows.length;
			rows[light] = { live: true, intensity: 1, color: [1, 1, 1] };
			return light;
		},
		destroyLight: (light: number) => {
			const found = row(light);
			if (!found) return fail(INVALID_HANDLE);
			found.live = false;
			freeRows.push(light);
			return 0;
		},
		setLightValue: (light: number, which: number, value: number) => {
			const found = row(light);
			if (!found) return fail(INVALID_HANDLE);
			if (which === C.LIGHT_VALUE_INTENSITY) found.intensity = value;
			return 0;
		},
		setLightColor: (light: number, _which: number, r: number, g: number, b: number) => {
			const found = row(light);
			if (!found) return fail(INVALID_HANDLE);
			found.color = [r, g, b];
			return 0;
		},
		createBatch: () => {
			batchGeneration++;
			new Float32Array(memory.buffer, AT.batch, 64).fill(0);
			batch = (batchGeneration << SLOT_BITS) | 1;
			return batch;
		},
		destroyBatch: (id: number) => {
			if (id !== batch) return fail(STALE_HANDLE);
			batch = 0;
			return 0;
		},
		batchArrays: (id: number, field: number) =>
			id === batch ? AT.batch + field * 64 : fail(STALE_HANDLE) && 0,
		setBatchActiveCount: (id: number) => (id === batch ? 0 : fail(STALE_HANDLE)),
		lastErrorCode: () => failure,
		lastErrorDetail: () => 0,
	};
	const core = new CoreMemory(glue as unknown as CoreGlue, memory);
	/** Gives the next object the slot of `handle`, with the next generation. */
	const reuseSlot = (handle: number) => {
		reused = (((handle >>> SLOT_BITS) + 1) << SLOT_BITS) | (handle & SLOT_MASK);
	};
	const position = (handle: number) => [
		...new Float32Array(memory.buffer, AT.positions + (handle & SLOT_MASK) * 12, 3),
	];
	return { core, rows, reuseSlot, position };
}

/**
 * Destroys a light, an object and an instance batch, lets a new one take each one's place, and
 * then calls the destroyed ones. Returns what the calls threw and what the new ones hold.
 */
export function staleCalls(): StaleCallsResult {
	const { core, rows, reuseSlot, position } = fakeCore();
	const scene = new Scene(core, { frame: 5 }, false);
	const box = new MeshGeometry(1, 0.87, core);
	const paint = new Material(1, core, 'materials.standard.set');
	const errors: Record<string, string> = {};
	const attempt = (name: string, call: () => void) => {
		try {
			call();
		} catch (error) {
			errors[name] = (error as { code?: string }).code ?? String(error);
		}
	};

	const lamp = scene.createPointLight({ range: 10 });
	lamp.destroy();
	const lantern = scene.createPointLight({ range: 10 });
	attempt('light.setIntensity', () => lamp.setIntensity(5));
	attempt('light.setColor', () => lamp.setColor('#ff0000'));
	attempt('light.destroy', () => lamp.destroy());

	const rock = scene.createMesh({ mesh: box, material: paint });
	rock.destroy();
	reuseSlot(rock.handle);
	const stone = scene.createMesh({ mesh: box, material: paint, position: [1, 2, 3] });
	attempt('object.setPosition', () => rock.setPosition(9, 9, 9));
	attempt('object.translate', () => rock.translate(9, 9, 9));
	attempt('object.destroy', () => rock.destroy());

	const flock = scene.createInstances(box, 4, { material: paint });
	flock.positions.fill(0);
	flock.destroy();
	const herd = scene.createInstances(box, 4, { material: paint });
	attempt('batch.positions', () => flock.positions.fill(7));
	attempt('batch.destroy', () => flock.destroy());

	const light = rows[lantern.id] ?? { live: false, intensity: 0, color: [] };
	return {
		errors,
		light: { live: light.live, intensity: light.intensity, color: light.color },
		position: position(stone.handle),
		batchRow: [...herd.positions.subarray(0, 3)],
	};
}
