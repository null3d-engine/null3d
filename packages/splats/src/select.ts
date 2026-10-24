// The sketch's side of the selection: a buffer of chunks for the task, and the call that asks a job
// worker which splats draw. The buffer is shared where the page allows it, so a call copies nothing
// but the few numbers of its answer.
import { runTask, type Task } from '@null3d/engine';
import type { SplatChunk } from './chunks';
import { BUDGET, CHUNK_COUNT, EYE, HEADER, STRIDE } from './select-task';

/** The task that chooses the splats. Its module runs on its own in each job worker. */
export const SELECT_TASK: Task = {
	name: 'splats-select',
	script: new URL('./select-task.ts', import.meta.url),
};

/** How many splats draw of each chunk. */
export interface SplatSelection {
	/** One count for each chunk, in the chunks' order. */
	readonly counts: Float32Array;
	/** The number of splats that draw. */
	readonly total: number;
}

/** The buffer that the selection task reads, and the call that fills and sends it. */
export class SplatSelector {
	private readonly view: Float32Array;

	/** Makes the buffer of `chunks`, which stays the same while they do. */
	constructor(chunks: readonly SplatChunk[]) {
		const floats = HEADER + chunks.length * STRIDE + chunks.length;
		const buffer =
			typeof SharedArrayBuffer === 'undefined'
				? new ArrayBuffer(floats * 4)
				: new SharedArrayBuffer(floats * 4);
		this.view = new Float32Array(buffer);
		this.view[CHUNK_COUNT] = chunks.length;
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

	/** Asks a job worker which splats draw from `eye`, with `budget` splats at most. */
	async select(eye: readonly number[], budget: number): Promise<SplatSelection> {
		this.view[BUDGET] = budget;
		this.view[EYE] = eye[0] as number;
		this.view[EYE + 1] = eye[1] as number;
		this.view[EYE + 2] = eye[2] as number;
		const answer = await runTask<{ counts: number[]; total: number }>(SELECT_TASK, {
			view: this.view,
		});
		return { counts: Float32Array.from(answer.counts), total: answer.total };
	}
}
