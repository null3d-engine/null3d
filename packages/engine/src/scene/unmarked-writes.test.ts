// The development check for writes that skip a setter, on a scene over a fake engine core. Each
// test frame runs the check where the sketch runner runs it, before the transform update, then
// clears the dirty bits as the core's update does.
import { beforeEach, describe, expect, test } from 'bun:test';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import * as C from '../generated/core';
import type { CoreGlue } from '../shared/core';
import { CoreMemory } from './memory';
import type { Material, MeshGeometry } from './resources';
import { Scene } from './scene';
import { UnmarkedRows } from './unmarked-writes';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** The objects the fake core holds, and the room of its command ring. */
const CAPACITY = 63;
const RING = 64;

/** A scene over a fake core: the scene arrays, the dirty bits and the command ring. */
function fakeScene() {
	const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });
	// Each field in its own 4 KB block, the way the core's arrays sit apart in its memory.
	const block = (index: number) => 4096 * (index + 1);
	const scene = [
		C.SCENE_FIELD_POSITIONS,
		C.SCENE_FIELD_ROTATIONS,
		C.SCENE_FIELD_SCALES,
		C.SCENE_FIELD_LOCAL_RADII,
		C.SCENE_FIELD_LOCAL_CENTERS,
		C.SCENE_FIELD_DIRTY_WORDS,
	];
	const ring = [C.RING_FIELD_RECORDS, C.RING_FIELD_WRITE_INDEX, C.RING_FIELD_READ_INDEX];
	// Each batch's fields in 512-byte parts of a block of its own, after the scene's and the ring's.
	const batchArrays = (id: number, field: number) =>
		block(scene.length + ring.length + id) + 512 * field;
	const batchDirty = (id: number) =>
		new Uint32Array(memory.buffer, batchArrays(id, C.BATCH_FIELD_DIRTY_WORDS), 2);
	let slots = 0;
	let batches = 0;
	const glue = {
		sceneCapacity: () => CAPACITY,
		sceneArrays: (field: number) => block(scene.indexOf(field)),
		commandRing: (field: number) =>
			field === C.RING_FIELD_CAPACITY ? RING : block(scene.length + ring.indexOf(field)),
		reserveObject: () => ++slots,
		createBatch: (count: number) => {
			const id = ++batches;
			// The core's rows start dirty.
			batchDirty(id)[0] = 2 ** count - 1;
			return id;
		},
		batchArrays,
		setBatchActiveCount: () => 0,
		markBatchDirty: (id: number, start: number, count: number) => {
			const dirty = batchDirty(id);
			for (let row = start; row < start + count; row++)
				dirty[0] = (dirty[0] as number) | (1 << row);
			return 0;
		},
		destroyBatch: () => 0,
		lastErrorCode: () => 0,
		lastErrorDetail: () => 0,
	};
	const core = new CoreMemory(glue as unknown as CoreGlue, memory);
	const time = { frame: 0 };
	const s = new Scene(core, time, false);
	const mesh = { id: 1, radius: 1, core } as unknown as MeshGeometry;
	const material = { id: 1, core } as unknown as Material;
	return {
		scene: s,
		/** Creates a mesh with a name. */
		create: (name: string, dynamic = false) => s.createMesh({ name, mesh, material, dynamic }),
		/** Creates an instance batch of 4 rows. */
		createBatch: (dynamic = false) => s.createInstances(mesh, 4, { material, dynamic }),
		/**
		 * Runs a frame's batch check, then clears every batch's dirty rows as the batch update does.
		 */
		batchFrame(): string | undefined {
			time.frame++;
			core.refresh();
			const error = s.unmarkedRows?.check();
			for (let id = 1; id <= batches; id++) batchDirty(id).fill(0);
			return error?.message;
		},
		/** Runs a frame's check, then clears the dirty bits as the transform update does. */
		frame(): string | undefined {
			time.frame++;
			core.refresh();
			const error = s.unmarkedWrites?.check();
			s.views.dirty.fill(0);
			return error?.message;
		},
		/** Makes the engine's memory grow, which gives it a new buffer. */
		grow: () => memory.grow(1),
	};
}

/** The start of E1110's message, up to the fix. */
const unmarked = (detail: string) => `E1110: ${detail} ${ERROR_FIXES.E1110}`;

describe('unmarked writes to static objects', () => {
	test('a direct write to the position is reported in the frame it happens, with the name', () => {
		const { scene, create, frame } = fakeScene();
		const crate = create('Crate');
		expect(frame()).toBeUndefined();
		scene.views.positions[crate.slot * 3] = 5;
		const message = frame();
		expect(
			message?.startsWith(unmarked('the position of "Crate" (slot 1) changed without a setter.')),
		).toBe(true);
		expect(message).toContain('/docs/errors/E1110.md');
		// Each write is reported once.
		expect(frame()).toBeUndefined();
	});

	test('setters mark their object, so their changes are not reported', () => {
		const { create, frame } = fakeScene();
		const crate = create('Crate');
		frame();
		crate.setPosition(1, 2, 3);
		crate.setRotationEuler(0, 1, 0);
		crate.setScale(2, 2, 2);
		crate.lookAt(0, 0, 0);
		expect(frame()).toBeUndefined();
		expect(frame()).toBeUndefined();
	});

	test('names the field that changed and counts the other objects', () => {
		const { scene, create, frame } = fakeScene();
		const [a, b, c] = [create('A'), create('B'), create('C')];
		frame();
		const v = scene.views;
		v.rotations[a.slot * 4 + 3] = 0.5;
		v.scales[b.slot * 3 + 1] = 3;
		v.radii[c.slot] = 9;
		expect(frame()).toStartWith(
			'E1110: the rotation of "A" (slot 1) changed without a setter. 2 more static objects changed that way too.',
		);
		v.radii[c.slot] = 4;
		expect(frame()).toStartWith(
			'E1110: the bounding sphere of "C" (slot 3) changed without a setter.',
		);
		v.centers[b.slot * 3 + 2] = -1;
		expect(frame()).toStartWith(
			'E1110: the bounding sphere of "B" (slot 2) changed without a setter.',
		);
	});

	test('setBounds and setMesh leave no report once the core marks their object', () => {
		const { scene, create, frame } = fakeScene();
		const crate = create('Crate');
		frame();
		crate.setBounds([0, 2, 0], 3);
		// The core marks the object when it applies the command that each setter queues.
		scene.markDirty(crate.slot);
		expect(frame()).toBeUndefined();
		crate.setMesh({ id: 2, radius: 5, core: scene.core } as unknown as MeshGeometry);
		scene.markDirty(crate.slot);
		expect(frame()).toBeUndefined();
	});

	test('setBounds and setMesh in the late update leave no report before the core marks it', () => {
		const { scene, create, frame } = fakeScene();
		const crate = create('Crate');
		frame();
		// A call in onLateUpdate queues its change for the next frame, after the late check.
		crate.setBounds([0, 2, 0], 3);
		expect(frame()).toBeUndefined();
		crate.setMesh({ id: 2, radius: 5, core: scene.core } as unknown as MeshGeometry);
		expect(frame()).toBeUndefined();
		// Writes that skip a setter still show, before and after such a call.
		scene.views.positions[crate.slot * 3] = 4;
		crate.setBounds([0, 1, 0], 2);
		expect(frame()).toStartWith('E1110: the position of "Crate" (slot 1) changed');
		crate.setBounds([0, 1, 0], 3);
		scene.views.radii[crate.slot] = 9;
		expect(frame()).toStartWith('E1110: the bounding sphere of "Crate" (slot 1) changed');
	});

	test('a write the dirty bit marks is not reported', () => {
		const { scene, create, frame } = fakeScene();
		const crate = create('Crate');
		frame();
		scene.views.positions[crate.slot * 3 + 2] = 7;
		scene.markDirty(crate.slot);
		expect(frame()).toBeUndefined();
	});

	test('dynamic and destroyed objects are not watched', () => {
		const { scene, create, frame } = fakeScene();
		const ball = create('Ball', true);
		const crate = create('Crate');
		frame();
		const p = scene.views.positions;
		p[ball.slot * 3] = 1;
		expect(frame()).toBeUndefined();
		crate.setDynamic(true);
		p[crate.slot * 3] = 1;
		expect(frame()).toBeUndefined();
		// The core resets a destroyed object's values when the next frame starts.
		crate.destroy();
		p[crate.slot * 3] = 0;
		expect(frame()).toBeUndefined();
	});

	test('an object made static is watched from its values at that call', () => {
		const { scene, create, frame } = fakeScene();
		const ball = create('Ball', true);
		frame();
		const p = scene.views.positions;
		p[ball.slot * 3] = 4;
		ball.setDynamic(false);
		expect(frame()).toBeUndefined();
		p[ball.slot * 3] = 5;
		expect(frame()).toStartWith('E1110: the position of "Ball" (slot 1) changed');
	});

	test('making a static object static again keeps a write before the call', () => {
		const { scene, create, frame } = fakeScene();
		const crate = create('Crate');
		frame();
		scene.views.rotations[crate.slot * 4] = 0.5;
		crate.setDynamic(false);
		expect(frame()).toStartWith('E1110: the rotation of "Crate" (slot 1) changed');
	});

	test('an object the core has not created yet is not reported, whatever its dirty bit', () => {
		const { create, frame } = fakeScene();
		create('Crate');
		// No frame marks it: a create command that the core rejects leaves the bit clear.
		expect(frame()).toBeUndefined();
	});

	test('sees every bit of a value, far from the origin too', () => {
		const { scene, create, frame } = fakeScene();
		const far = create('Far');
		far.setPosition(1_000_000, 0, -0);
		frame();
		const p = scene.views.positions;
		// One step of a 32-bit float at 1,000 km is 6.25 cm; the grid cell stays the same.
		p[far.slot * 3] = Math.fround(1_000_000 + 0.0625);
		expect(frame()).toStartWith('E1110: the position of "Far" (slot 1) changed');
		p[far.slot * 3 + 2] = 0;
		expect(frame()).toStartWith('E1110: the position of "Far" (slot 1) changed');
	});

	test('keeps watching after the engine memory grows', () => {
		const { scene, create, frame, grow } = fakeScene();
		const crate = create('Crate');
		frame();
		grow();
		expect(frame()).toBeUndefined();
		scene.views.scales[crate.slot * 3] = 2;
		expect(frame()).toStartWith('E1110: the scale of "Crate" (slot 1) changed');
	});
});

describe('unmarked writes to static batch rows', () => {
	test('a row written without markDirty is reported once, with its row', () => {
		const { createBatch, batchFrame } = fakeScene();
		const batch = createBatch();
		expect(batchFrame()).toBeUndefined();
		batch.positions[2 * 3 + 1] = 5;
		expect(batchFrame()).toStartWith(
			'E1110: row 2 of an instance batch of 4 rows changed without markDirty.',
		);
		expect(batchFrame()).toBeUndefined();
	});

	test('counts the other rows, in every field', () => {
		const { createBatch, batchFrame } = fakeScene();
		const batch = createBatch();
		batchFrame();
		batch.rotations[1 * 4 + 3] = 0.5;
		batch.scales[3 * 3] = 2;
		expect(batchFrame()).toStartWith(
			'E1110: row 1 of an instance batch of 4 rows changed without markDirty. 1 more row changed that way too.',
		);
	});

	test('rows that markDirty marks are not reported', () => {
		const { createBatch, batchFrame } = fakeScene();
		const batch = createBatch();
		batchFrame();
		batch.positions[0] = 1;
		batch.positions[3 * 3] = 1;
		batch.markDirty(0, 1);
		batch.markDirty(3, 1);
		expect(batchFrame()).toBeUndefined();
	});

	test('dynamic batches, rows past the active count and destroyed batches are not checked', () => {
		const { createBatch, batchFrame } = fakeScene();
		const dynamic = createBatch(true);
		const fewer = createBatch();
		const gone = createBatch();
		batchFrame();
		dynamic.positions[0] = 1;
		fewer.setActiveCount(2);
		fewer.positions[3 * 3] = 1;
		gone.destroy();
		expect(batchFrame()).toBeUndefined();
	});
});

describe('unmarked writes to the rows of a large batch', () => {
	/** A batch of 8 rows of one word each, whose check hashes 3 rows a frame. */
	function largeBatch() {
		const rows = new Int32Array(8);
		const dirty = new Int32Array(2);
		const core = {
			generation: 0,
			glue: { batchArrays: (_id: number, field: number) => field },
			i32: (address: number) => (address === C.BATCH_FIELD_DIRTY_WORDS ? dirty : rows),
		};
		const check = new UnmarkedRows(core, 3);
		check.watch({ id: 1, count: 8, activeRows: 8, describe: () => 'the batch' }, [
			[C.BATCH_FIELD_POSITIONS, 1],
		]);
		return {
			rows,
			mark: (row: number) => {
				dirty[0] = (dirty[0] as number) | (1 << row);
			},
			/** Runs a frame's check, then clears the marks as the batch update does. */
			frame: () => {
				const message = check.check()?.message;
				dirty.fill(0);
				return message;
			},
		};
	}

	test('finds a write within the frames that one turn over the rows takes', () => {
		const { rows, frame } = largeBatch();
		for (let k = 0; k < 3; k++) expect(frame()).toBeUndefined();
		rows[7] = 1;
		expect([frame(), frame(), frame()].filter(Boolean)).toEqual([
			expect.stringContaining('row 7 of the batch changed without markDirty.'),
		]);
	});

	test('keeps a mark until its row comes round, so a marked write is never reported', () => {
		const { rows, mark, frame } = largeBatch();
		for (let k = 0; k < 3; k++) frame();
		rows[7] = 1;
		mark(7);
		for (let k = 0; k < 6; k++) expect(frame()).toBeUndefined();
	});
});
