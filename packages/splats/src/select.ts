// The sketch's side of the selection: a buffer of chunks for the task, and the call that asks a job
// worker which splats draw. The selection and its distance sort run in the add-on's WebAssembly
// module in the worker (hard rule 42), so a frame's loop over chunks runs in Rust. The buffer is
// shared where the page allows it, so a call copies nothing but the few numbers of its answer and
// the counts. The task writes the counts into the buffer, which the sketch reads straight from it,
// so no count crosses a message on a page with shared memory and a call allocates no array.
import { runTask, type Task } from '@null3d/engine';
import type { SplatChunk } from './chunks';
import {
	BUDGET,
	CHUNK_COUNT,
	CLOUD_RADIUS,
	type DropInput,
	EYE,
	HEADER,
	type SelectAnswer,
	type SelectInput,
	STRIDE,
} from './select-task';

/** What the selection needs of a chunk: its bounds and its count, before its data arrives. */
export type ChunkBounds = Pick<SplatChunk, 'center' | 'radius' | 'count'>;

/** The task that chooses the splats: its module, and the WebAssembly module that it calls. */
export const SELECT_TASK: Task = {
	name: 'splats-select',
	script: new URL('./select-task.ts', import.meta.url),
	wasm: [
		{
			name: 'splats',
			url: new URL('../dist/splats.wasm', import.meta.url),
			what: 'the splat selector',
		},
	],
};

/** One selector's number each, so a worker keeps each selector's arrays apart. */
let lastId = 0;
/** A number for each buffer of a selector, so a worker copies the chunk table again. */
let lastVersion = 0;

/** The buffer that the selection task reads, and the call that fills and sends it. */
export class SplatSelector {
	private readonly view: Float32Array;
	/** The task's input, which keeps its shape so a call makes no object. */
	private readonly input: SelectInput;
	/** How many splats draw of each chunk, which the task writes in the shared buffer. */
	readonly counts: Float32Array;
	/** This selector's number, which a grown cloud hands to its next selector. */
	readonly id: number;

	/**
	 * Makes the buffer of `chunks`, which stays the same while they do. `previousId` names the
	 * selector that this one replaces when a cloud grows, so the worker keeps its arrays while
	 * they hold the new chunk count.
	 */
	constructor(chunks: readonly ChunkBounds[], previousId?: number) {
		const floats = HEADER + chunks.length * STRIDE + chunks.length;
		const buffer =
			typeof SharedArrayBuffer === 'undefined'
				? new ArrayBuffer(floats * 4)
				: new SharedArrayBuffer(floats * 4);
		this.view = new Float32Array(buffer);
		this.id = previousId ?? ++lastId;
		this.input = {
			op: 'select',
			id: this.id,
			version: ++lastVersion,
			chunks: chunks.length,
			budget: 0,
			eyeX: 0,
			eyeY: 0,
			eyeZ: 0,
			view: this.view,
		};
		this.view[CHUNK_COUNT] = chunks.length;
		this.view[CLOUD_RADIUS] = cloudRadiusOf(chunks);
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
	 * promise settles when the worker has filled `counts` and `total`. Without shared memory, the
	 * caller writes the answer's counts into `counts`.
	 */
	select(eye: ArrayLike<number>, budget: number): Promise<SelectAnswer> {
		this.view[BUDGET] = budget;
		this.view[EYE] = eye[0] as number;
		this.view[EYE + 1] = eye[1] as number;
		this.view[EYE + 2] = eye[2] as number;
		this.input.budget = budget;
		this.input.eyeX = eye[0] as number;
		this.input.eyeY = eye[1] as number;
		this.input.eyeZ = eye[2] as number;
		return runTask<SelectAnswer>(SELECT_TASK, this.input);
	}

	/**
	 * Frees this selector's arrays in the worker. A cloud's next selector takes them, or a later
	 * cloud does, so a page that makes and frees clouds does not grow the module's memory.
	 */
	drop(): void {
		void runTask<SelectAnswer>(SELECT_TASK, { op: 'drop', id: this.id } as DropInput).catch(
			() => undefined,
		);
	}
}

/**
 * The radius of a sphere that holds the cloud: the farthest chunk's own radius from the cloud's
 * center. The selection measures distance in this size, so a finer cut does not thin the view.
 */
function cloudRadiusOf(chunks: readonly ChunkBounds[]): number {
	if (chunks.length === 0) return 0;
	let x = 0;
	let y = 0;
	let z = 0;
	for (const chunk of chunks) {
		x += chunk.center[0];
		y += chunk.center[1];
		z += chunk.center[2];
	}
	x /= chunks.length;
	y /= chunks.length;
	z /= chunks.length;
	let radius = 0;
	for (const chunk of chunks) {
		const dx = chunk.center[0] - x;
		const dy = chunk.center[1] - y;
		const dz = chunk.center[2] - z;
		radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy + dz * dz) + chunk.radius);
	}
	return radius;
}
