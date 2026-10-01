import { describe, expect, it } from 'bun:test';
import { controlViews, createControlBuffer, Slot } from '../shared/control';
import { FrameReplay } from './scene-renderer';

/** A backend whose pipelines build while `building` is true, and which lists the frames it drew. */
function fakeBackend() {
	return {
		building: false,
		replayed: 0,
		counts: { uploadBytes: 0, drawCalls: 0, pipelines: 0, skippedDraws: 0, objects: 0 },
		prepare: (_words: Uint32Array, start: number) => start,
		replay() {
			this.replayed++;
		},
		resetCounts() {},
	};
}

function setup() {
	const control = createControlBuffer(false);
	const { slots } = controlViews(control);
	const backend = fakeBackend();
	const replay = new FrameReplay(backend, new WebAssembly.Memory({ initial: 1 }), control);
	return { slots, backend, replay };
}

describe('FrameReplay', () => {
	it('holds the first frame until its pipelines are built, and later frames draw at once', () => {
		const { backend, replay } = setup();
		backend.building = true;
		expect(replay.prepare(1)).toBe(false);
		backend.building = false;
		expect(replay.prepare(1)).toBe(true);
		replay.replay(1);
		backend.building = true;
		expect(replay.prepare(2)).toBe(true);
	});

	it('holds frames again from the frame that a change of preset names', () => {
		const { slots, backend, replay } = setup();
		replay.replay(1);
		Atomics.store(slots, Slot.PipelineHold, 3);
		backend.building = true;
		// A frame recorded before the change still draws at once.
		expect(replay.prepare(2)).toBe(true);
		replay.replay(2);
		expect(replay.prepare(3)).toBe(false);
		expect(replay.prepare(4)).toBe(false);
		backend.building = false;
		expect(replay.prepare(4)).toBe(true);
		replay.replay(4);
		// The hold ends once a frame has drawn with every pipeline built.
		backend.building = true;
		expect(replay.prepare(5)).toBe(true);
	});

	it('holds again for each new change, and never for the same one twice', () => {
		const { slots, backend, replay } = setup();
		replay.replay(1);
		Atomics.store(slots, Slot.PipelineHold, 2);
		expect(replay.prepare(2)).toBe(true);
		replay.replay(2);
		backend.building = true;
		expect(replay.prepare(3)).toBe(true);
		Atomics.store(slots, Slot.PipelineHold, 4);
		expect(replay.prepare(4)).toBe(false);
	});
});
