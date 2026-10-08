import { describe, expect, it } from 'bun:test';
import { JoinedBuilds } from '../gpu/effect-join';
import { controlViews, createControlBuffer, Slot } from '../shared/control';
import { BUILD_WAIT_LIMIT_MS, FrameReplay } from './scene-renderer';

/**
 * A backend whose pipelines build while `building` is true. It lists where each list it prepared
 * starts, and where each replay started. Each list creates pipelines in its first word.
 */
function fakeBackend() {
	return {
		building: false,
		replayed: 0,
		prepared: [] as number[],
		replayedFrom: [] as number[],
		counts: {
			uploadBytes: 0,
			drawCalls: 0,
			pipelines: 0,
			skippedDraws: 0,
			objects: 0,
			triangles: 0,
			instances: 0,
		},
		prepare(_words: Uint32Array, start: number) {
			this.prepared.push(start);
			return start + 1;
		},
		replay(_words: Uint32Array, _floats: Float32Array, from: number) {
			this.replayed++;
			this.replayedFrom.push(from);
		},
		resetCounts() {},
		joins: new JoinedBuilds(new Map()),
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

	it('waits for the builds, then gives the frame taken last, whose list the sketch has not reused', async () => {
		const { slots, backend, replay } = setup();
		Atomics.store(slots, Slot.FramesTaken, 3);
		backend.building = true;
		const taken = replay.builtTaken();
		// Frames go on during the wait, and the sketch thread records frame 5 into frame 3's list.
		Atomics.store(slots, Slot.FramesTaken, 4);
		backend.building = false;
		expect(await taken).toBe(4);
	});

	it('starts the builds of each list once, though a capture replays a frame the loop has passed', async () => {
		const { slots, backend, replay } = setup();
		// The lists of even and odd frames start at word 100 and word 200.
		Atomics.store(slots, Slot.DrawListAddress0, 400);
		Atomics.store(slots, Slot.DrawListAddress1, 800);
		Atomics.store(slots, Slot.DrawListWords0, 10);
		Atomics.store(slots, Slot.DrawListWords1, 10);
		expect(replay.prepare(4)).toBe(true);
		replay.replay(4);
		Atomics.store(slots, Slot.FramesTaken, 4);
		// The loop prepares frame 5 before its turn comes, and a capture of frame 4 comes first.
		expect(replay.prepare(5)).toBe(true);
		const frame = await replay.builtTaken();
		expect(frame).toBe(4);
		replay.replay(frame);
		expect(replay.prepare(5)).toBe(true);
		replay.replay(5);
		expect(backend.prepared).toEqual([100, 200]);
		expect(backend.replayedFrom).toEqual([101, 101, 201]);
	});

	it('stops a capture that waits for builds when the renderer is destroyed', async () => {
		const { slots, backend, replay } = setup();
		Atomics.store(slots, Slot.FramesTaken, 1);
		backend.building = true;
		const taken = replay.builtTaken();
		replay.abandon();
		await expect(taken).rejects.toThrow('the GPU was lost or the engine stopped');
	});

	it('stops a capture whose builds take longer than the limit', async () => {
		const { slots, backend, replay } = setup();
		Atomics.store(slots, Slot.FramesTaken, 1);
		backend.building = true;
		const clock = performance.now;
		let now = 0;
		performance.now = () => now;
		try {
			const taken = replay.builtTaken();
			now = BUILD_WAIT_LIMIT_MS;
			await expect(taken).rejects.toThrow('still building after 30 s');
		} finally {
			performance.now = clock;
		}
	});
});
