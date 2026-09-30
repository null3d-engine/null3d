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
		C.SCENE_FIELD_DIRTY_WORDS,
	];
	const ring = [C.RING_FIELD_RECORDS, C.RING_FIELD_WRITE_INDEX, C.RING_FIELD_READ_INDEX];
	let slots = 0;
	const glue = {
		sceneCapacity: () => CAPACITY,
		sceneArrays: (field: number) => block(scene.indexOf(field)),
		commandRing: (field: number) =>
			field === C.RING_FIELD_CAPACITY ? RING : block(scene.length + ring.indexOf(field)),
		reserveObject: () => ++slots,
		lastErrorCode: () => 0,
		lastErrorDetail: () => 0,
	};
	const core = new CoreMemory(glue as unknown as CoreGlue, memory);
	const time = { frame: 0 };
	const s = new Scene(core, time);
	const mesh = { id: 1, radius: 1 } as MeshGeometry;
	const material = { id: 1 } as Material;
	return {
		scene: s,
		/** Creates a mesh with a name. */
		create: (name: string, dynamic = false) => s.createMesh({ name, mesh, material, dynamic }),
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
			'E1110: the bounding radius of "C" (slot 3) changed without a setter.',
		);
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
