// The sketch's side of the selection: a buffer of chunks for the task, and the call that asks a job
// worker which splats draw. The buffer is shared where the page allows it, so a call copies nothing
// but the few numbers of its answer. The task writes the counts into the buffer, which the sketch
// reads straight from it, so no count crosses a message and a call allocates no array.
import { runTask, type Task } from '@null3d/engine';
import type { SplatChunk } from './chunks';
import { BUDGET, CHUNK_COUNT, EYE, HEADER, STRIDE, TOTAL } from './select-task';

/** What the selection needs of a chunk: its bounds and its count, before its data arrives. */
export type ChunkBounds = Pick<SplatChunk, 'center' | 'radius' | 'count'>;

/** The task that chooses the splats. Its module runs on its own in each job worker. */
export const SELECT_TASK: Task = {
	name: 'splats-select',
	script: new URL('./select-task.ts', import.meta.url),
};

/** The buffer that the selection task reads, and the call that fills and sends it. */
export class SplatSelector {
	private readonly view: Float32Array;
	/** The task's input, which keeps its shape so a call makes no object. */
	private readonly input: { view: Float32Array };
	/** How many splats draw of each chunk, which the task writes in the shared buffer. */
	readonly counts: Float32Array;

	/** Makes the buffer of `chunks`, which stays the same while they do. */
	constructor(chunks: readonly ChunkBounds[]) {
		const floats = HEADER + chunks.length * STRIDE + chunks.length;
		const buffer =
			typeof SharedArrayBuffer === 'undefined'
				? new ArrayBuffer(floats * 4)
				: new SharedArrayBuffer(floats * 4);
		this.view = new Float32Array(buffer);
		this.input = { view: this.view };
		this.view[CHUNK_COUNT] = chunks.length;
		this.counts = this.view.subarray(HEADER + chunks.length * STRIDE, floats);
		chunks.forEach((chunk, i) => {
			const at = HEADER + i * STRIDE;
			this.view[at] = chunk.center[0];
			this.view[at + 1] = chunk.center[1];
			this.view[at + 2] = chunk.center[2];
			this.view[at + 3] = chunk.radius;
			// Each level keeps a fraction of the chunk: all of it, a half, a quarter, an eighth.
			for (let level = 0; level < 4; level++)
				this.view[at + 4 + level] = Math.ceil(chunk.count / 2 ** level);
		});
	}

	/**
	 * Asks a job worker which splats draw from `eye`, with `budget` splats at most. The answer's
	 * promise settles when the worker has filled `counts` and `total`.
	 */
	select(eye: ArrayLike<number>, budget: number): Promise<boolean> {
		this.view[BUDGET] = budget;
		this.view[EYE] = eye[0] as number;
		this.view[EYE + 1] = eye[1] as number;
		this.view[EYE + 2] = eye[2] as number;
		return runTask<boolean>(SELECT_TASK, this.input);
	}

	/** The number of splats that draw, which the task wrote in the shared buffer. */
	get total(): number {
		return this.view[TOTAL] as number;
	}
}
