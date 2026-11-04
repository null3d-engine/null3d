// What the scene renderers of both GPU paths share. The sketch thread records each frame into a
// draw list in engine memory; a renderer replays the frame's list straight from that memory, and
// records the frame's GPU time where it has one, its upload bytes and its draw calls. A frame's list
// starts with the pipelines it creates, which begin to build, without blocking, when the frame is
// first prepared. Each path's renderers are in a file of their own, which a thread downloads only
// for the path that it draws with.

import type { JoinedBuilds } from '../gpu/effect-join';
import type { GpuMemory } from '../gpu/memory';
import { ReadSink } from '../gpu/readback';
import { controlViews, frameAfter, frameReached, Slot } from '../shared/control';
import { MemoryViews } from '../shared/memory-views';
import { Counter, type FrameRecorder } from '../shared/metrics';

/** How often a capture checks whether the pipelines it waits for are built. */
const BUILD_POLL_MS = 4;
/** The longest that a capture waits for pipelines to build. */
export const BUILD_WAIT_LIMIT_MS = 30_000;

/** What the scene renderers ask of a GPU backend. */
interface SceneBackend {
	prepare(words: Uint32Array, start: number, end: number): number;
	/** Where a list's draw section begins, after the pipelines it creates, starting no build. */
	restStart(words: Uint32Array, start: number, end: number): number;
	readonly building: boolean;
	replay(
		words: Uint32Array,
		floats: Float32Array,
		start: number,
		end: number,
		memory: ArrayBufferLike,
	): void;
	/** What the replays since the last reset did; WebGL2 dispatches no compute work. */
	readonly counts: {
		uploadBytes: number;
		drawCalls: number;
		dispatches?: number;
		pipelines: number;
		skippedDraws: number;
		/** GPU objects other than pipelines that the replays made. */
		objects: number;
		/** Triangles that the draws drew. */
		triangles: number;
		/** Instances that the draws drew. */
		instances: number;
	};
	resetCounts(): void;
	/** The GPU memory that the backend holds. */
	readonly gpuMemory: GpuMemory;
	/** The backend's builds of joined effects' shaders. */
	readonly joins: JoinedBuilds;
	/** Where the bytes of the draw lists' reads land, which the frame replay sets. */
	readSink: ReadSink | undefined;
}

/**
 * Adds what the backend did since its last reset to a frame's record, then resets its counts. While
 * the page reads the frame figures, it also publishes the GPU memory that the backend holds.
 */
export function recordCounts(record: FrameRecorder, backend: SceneBackend): void {
	const { counts } = backend;
	if (record.figures) record.publishGpuMemory(backend.gpuMemory.bytes);
	record.count(Counter.UploadBytes, counts.uploadBytes);
	record.count(Counter.DrawCalls, counts.drawCalls);
	record.count(Counter.Dispatches, counts.dispatches ?? 0);
	record.count(Counter.Pipelines, counts.pipelines);
	record.count(Counter.SkippedDraws, counts.skippedDraws);
	record.count(Counter.GpuObjects, counts.objects);
	record.count(Counter.Triangles, counts.triangles);
	record.count(Counter.DrawnObjects, counts.instances);
	backend.resetCounts();
}

/**
 * The replay of each frame's draw list, as the sketch thread published it, which both scene
 * renderers share. Its views of engine memory are made again only when the memory grows. A frame's
 * pipelines start to build the first time the frame is prepared or replayed. Until a frame has
 * drawn with every pipeline built, a frame waits for its pipelines. A change of quality preset
 * starts that wait again, from the frame that the control block's hold names.
 */
export class FrameReplay {
	/** The engine memory's views, which it makes again when the memory grows. */
	private readonly views: MemoryViews;
	private end = 0;
	private readonly slots: Int32Array;
	/** The newest frame whose pipelines started to build. */
	private prepared = 0;
	/**
	 * Where the rest of each list starts, after the pipelines it creates, by the parity of the
	 * frame that the list holds.
	 */
	private readonly rests = new Int32Array(2);
	/** True once the renderer is destroyed: a capture that waits then stops waiting. */
	private abandoned = false;
	/** True once a frame has drawn with every pipeline built, since the last hold began. */
	private complete = false;
	/** The first frame of the last hold that a prepared frame reached. */
	private held = 0;

	constructor(
		private readonly backend: SceneBackend,
		memory: WebAssembly.Memory,
		control: ArrayBufferLike,
	) {
		this.views = new MemoryViews(memory);
		this.slots = controlViews(control).slots;
		backend.readSink = new ReadSink(this.views, this.slots);
		backend.joins.onFailed = (template) => Atomics.store(this.slots, Slot.JoinFailed, template);
	}

	/** Starts the builds of a frame's pipelines, once, and returns true when the frame may draw. */
	prepare(frame: number): boolean {
		this.restOf(frame);
		const hold = Atomics.load(this.slots, Slot.PipelineHold);
		if (frameAfter(hold, this.held) && frameReached(frame, hold)) {
			this.held = hold;
			this.complete = false;
		}
		return this.complete || !this.backend.building;
	}

	/** Replays a frame's list, apart from the pipelines it creates, which are building already. */
	replay(frame: number): void {
		const delay = Atomics.load(this.slots, Slot.ReplayDelayMs);
		if (delay > 0) {
			// The test switch's wait: the sketch thread steps the next frame meanwhile.
			const until = performance.now() + delay;
			while (performance.now() < until);
		}
		const from = this.restOf(frame);
		const words = this.views.heap(Uint32Array);
		this.backend.replay(words, this.views.heap(Float32Array), from, this.end, words.buffer);
		if (!this.backend.building) this.complete = true;
	}

	/** Replays the list that a capture draws for the frame taken last. */
	replayForCapture(frame: number): void {
		const range = this.captureRange(frame);
		const words = this.views.heap(Uint32Array);
		const floats = this.views.heap(Float32Array);
		// With neither list holding an op there is nothing to draw, and the empty replay draws none.
		const from = range?.from ?? this.end;
		const end = range?.end ?? this.end;
		this.backend.replay(words, floats, from, end, words.buffer);
	}

	/**
	 * The part of a list that a capture draws. The list of the frame taken last draws from the place
	 * after the pipelines it creates, which the renderer found when it prepared the frame. A view
	 * that rests records every frame, so the sketch rewrites that frame's list after the renderer
	 * took it, and the pipelines at the front then hold different words: the draw section is found
	 * again, starting no build. A list that a failed device cleared holds no op, so the other
	 * frame's slot then holds the list that drew last, which is the frame the screen shows. A list
	 * that a device that the browser took away recorded names that device's objects, so neither it
	 * nor its slot draws. Null when no list draws.
	 */
	private captureRange(frame: number): { from: number; end: number } | null {
		const words = this.views.heap(Uint32Array);
		const parity = frame & 1;
		const start = (Atomics.load(this.slots, Slot.DrawListAddress0 + parity) >>> 0) / 4;
		this.end = start + Atomics.load(this.slots, Slot.DrawListWords0 + parity);
		const end = this.end;
		// A list whose first word is zero is the one a failed device cleared.
		if (this.drawable(parity) && end > start && words[start] !== 0) {
			const found = this.restOf(frame);
			const rest =
				end > found && words[found] !== 0 ? found : this.backend.restStart(words, start, end);
			if (end > rest && words[rest] !== 0) return { from: rest, end };
		}
		const other = parity ^ 1;
		const otherStart = (Atomics.load(this.slots, Slot.DrawListAddress0 + other) >>> 0) / 4;
		const otherEnd = otherStart + Atomics.load(this.slots, Slot.DrawListWords0 + other);
		if (this.drawable(other) && otherEnd > otherStart && words[otherStart] !== 0)
			return { from: otherStart, end: otherEnd };
		return null;
	}

	/**
	 * True when the list of a frame's parity was recorded for the GPU device that draws now and
	 * under the plan's current generation: a list of an older plan names textures that the frame
	 * after replaced.
	 */
	private drawable(parity: number): boolean {
		return (
			Atomics.load(this.slots, Slot.FrameEpoch0 + parity) ===
				Atomics.load(this.slots, Slot.GpuEpoch) &&
			Atomics.load(this.slots, Slot.FramePlan0 + parity) ===
				Atomics.load(this.slots, Slot.PlanEpoch)
		);
	}

	/**
	 * Resolves with the frame that this thread took last, once every pipeline is built, including
	 * those of that frame's list. Frames go on while it waits, and the sketch thread records into a
	 * taken frame's list again once the next frame is taken, so the caller replays the frame at
	 * once, before this thread can take another. It fails when the renderer is destroyed during the
	 * wait, as after a GPU loss, or when the builds take longer than the wait's limit. A frame that
	 * a failure cleared recorded no list, so the capture waits for a frame with a list to draw:
	 * after a GPU loss the frame taken then is the cleared one, and the next frame records again.
	 */
	async builtTaken(): Promise<number> {
		const deadline = performance.now() + BUILD_WAIT_LIMIT_MS;
		for (;;) {
			if (this.abandoned)
				throw new Error('the GPU was lost or the engine stopped during the capture');
			const frame = Atomics.load(this.slots, Slot.FramesTaken);
			if (!this.backend.building && this.captureRange(frame) !== null) return frame;
			if (performance.now() >= deadline)
				throw new Error(
					`the frame's pipelines were still building after ${BUILD_WAIT_LIMIT_MS / 1000} s`,
				);
			await new Promise((resolve) => setTimeout(resolve, BUILD_POLL_MS));
		}
	}

	/** Ends every wait for builds, for a renderer that is destroyed. */
	abandon(): void {
		this.abandoned = true;
	}

	/**
	 * Finds the list of `frame`, and returns where the rest of the list starts. Frames only grow,
	 * so the pipelines of a list start to build only for a frame newer than any prepared before.
	 * An older frame, such as one that a capture replays while the loop has prepared the next,
	 * reuses the place that its list's preparation found.
	 */
	private restOf(frame: number): number {
		const parity = frame & 1;
		// The address is stored in the shared Int32 slots, so it reads signed above 2 GiB. The
		// page may raise the memory's maximum to 4096 MiB (hard rule 31).
		const start = (Atomics.load(this.slots, Slot.DrawListAddress0 + parity) >>> 0) / 4;
		this.end = start + Atomics.load(this.slots, Slot.DrawListWords0 + parity);
		if (frameAfter(frame, this.prepared)) {
			this.rests[parity] = this.backend.prepare(this.views.heap(Uint32Array), start, this.end);
			this.prepared = frame;
		}
		return this.rests[parity] as number;
	}
}
