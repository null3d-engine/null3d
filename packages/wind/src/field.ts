// The wind's analytic field in the engine's job workers: the task, the request that the sketch
// fills for it, and the call that asks for the air at places. A page that moves its own objects
// with the air asks here in a frame; the worker answers before the next frame's update.
//
// The call keeps one request buffer, so a frame's ask allocates nothing but the task's promise. The
// buffer grows when a page first asks for more places than it held before.
import { runTask, type Task } from '@null3d/engine';
import type { WindReading } from './analytic';
import { fillRequest, MAX_PLACES, POINTS, STEP } from './field-layout';
import { FIELD_TASK } from './field-task';

/** The first code that the add-on's own errors use. */
export const WIND_CODES = 2400;

/** An error that the add-on raises, with its own code and a message that says how to fix it. */
export function windError(code: number, detail: string): Error {
	return new Error(`wind E${code}: ${detail}`);
}

/**
 * The air at places, worked out in a job worker. A call fills one request and sends it; the answer
 * lands in the page's own array before the next frame's update. A call that arrives while an answer
 * is still on its way fills the other buffer and sends one more ask when that answer comes, so a
 * page that asks in every frame never queues more than one ask. The two buffers matter where the
 * page shares its memory: the engine hands a shared buffer to the worker without copying it, so a
 * second call may not write the bytes of the ask before it.
 */
export class WindProbes {
	/** The two request buffers, of which one is filled while the other's answer is on its way. */
	private readonly requests: [Float32Array, Float32Array];
	/** The buffer that a call fills. The other buffer is the ask that is on its way. */
	private fill = 0;
	/** The task's input, which keeps its shape so a call makes no object. */
	private readonly input: { request: Float32Array; answer: Float32Array };
	/** The answer array of the ask that is on its way. */
	private out: Float32Array | undefined;
	private nextOut: Float32Array | undefined;
	private inFlight = false;
	private queued = false;
	private reported = false;
	private dropReported = false;
	private stopped = false;
	/** True where the page's memory can be shared with a worker, so the answer needs no copy back. */
	private readonly shared = typeof SharedArrayBuffer !== 'undefined';

	/** `run` sends a task, which a test replaces to run one without a worker. */
	constructor(private readonly run: (task: Task, input: unknown) => Promise<unknown> = runTask) {
		this.requests = [this.make(2 * POINTS), this.make(2 * POINTS)];
		this.input = { request: this.requests[0] as Float32Array, answer: new Float32Array(3) };
	}

	/**
	 * Asks for the air at each place in `points`, three numbers a place across the ground, and puts
	 * the velocities in `out`, three numbers a place. `numbers` holds the push's width and the sketch
	 * time, which a frame writes into an array rather than passing as arguments, so the call takes no
	 * fraction that the browser would make a number object of. The answer arrives before the next
	 * frame.
	 */
	ask(
		points: Float32Array,
		out: Float32Array,
		reading: WindReading,
		ring: Float32Array,
		numbers: Float64Array,
	): void {
		if (this.stopped) return;
		if (points.length % 3 !== 0)
			throw windError(
				WIND_CODES,
				`got ${points.length} numbers for the places, which take three numbers each.`,
			);
		const count = points.length / 3;
		if (count > MAX_PLACES)
			throw windError(
				WIND_CODES + 1,
				`got ${count} places; one call takes ${MAX_PLACES} at most. Ask the rest in the next frame.`,
			);
		if (out.length < points.length)
			throw windError(
				WIND_CODES + 2,
				`got ${out.length} numbers for the answer; ${points.length} places take three numbers each.`,
			);
		this.reserve(points.length);
		fillRequest(this.requests[this.fill] as Float32Array, points, reading, ring, numbers);
		this.nextOut = out;
		if (this.inFlight) {
			// One ask can wait for the answer that is on its way. A second one replaces it, because
			// the free buffer holds the ask that waits, so the newest ask wins and the one it
			// replaces is dropped: its array keeps the numbers it held. Say so, rather than let a
			// page read an array that no answer will fill.
			if (this.queued) this.reportDrop();
			this.queued = true;
			return;
		}
		this.send();
	}

	/** Stops asking, and ignores the answer that is still on its way. */
	stop(): void {
		this.stopped = true;
	}

	/** Grows the buffer that a call fills, when the call asks for more places than it held. */
	private reserve(numbers: number): void {
		const request = this.requests[this.fill] as Float32Array;
		if (request.length >= POINTS + numbers) return;
		const floats = Math.ceil((POINTS + numbers) / STEP) * STEP;
		this.requests[this.fill] = this.make(floats);
	}

	/** Sends the buffer that the last call filled, and frees the one that is on its way. */
	private send(): void {
		const out = this.nextOut as Float32Array;
		const sent = this.fill;
		// The other buffer takes the next call, so the ask that is on its way keeps its bytes.
		this.fill = 1 - this.fill;
		this.inFlight = true;
		this.out = out;
		// The worker writes into the page's array where the memory is shared, and gives the answer
		// back otherwise, which the engine moves rather than copies.
		this.input.request = this.requests[sent] as Float32Array;
		this.input.answer = out;
		this.run(FIELD_TASK, this.input).then(this.answered, this.refused);
	}

	/** Takes the answer, or sends the ask that waited for it. */
	private readonly answered = (answer: unknown): void => {
		this.inFlight = false;
		if (this.stopped) return;
		// A shared answer is already in the page's array; a copied one lands in it here.
		if (answer) this.out?.set(answer as Float32Array);
		if (this.queued) {
			this.queued = false;
			this.send();
		}
	};

	/** Reports the first dropped ask, and keeps the frames going. */
	private reportDrop(): void {
		if (this.dropReported) return;
		this.dropReported = true;
		console.error(
			"wind: a read arrived while one already waited for its answer, so the newest ask replaced it and the earlier answer's array keeps its numbers. Keep one read in a frame, and read its answer in the next frame's update.",
		);
	}

	/** Reports the first failure and keeps the frames going. */
	private readonly refused = (error: unknown): void => {
		this.inFlight = false;
		this.queued = false;
		if (this.reported) return;
		this.reported = true;
		console.error(
			`wind: the field's job worker did not answer, so the air at a page's own places stays as it was. ${error instanceof Error ? error.message : String(error)}`,
		);
	};

	/** Makes a buffer that a worker may share, where the page allows sharing. */
	private make(floats: number): Float32Array {
		const bytes = floats * 4;
		return new Float32Array(this.shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes));
	}
}
