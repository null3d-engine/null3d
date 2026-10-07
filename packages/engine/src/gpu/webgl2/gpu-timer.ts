// GPU time per frame on WebGL2, from `EXT_disjoint_timer_query_webgl2` where the browser offers
// it, which desktop browsers mostly do and phones mostly do not. A timed frame's replay runs inside
// one TIME_ELAPSED query, so the time covers the frame's GL commands on the GPU, without a part for
// each pass: GL runs one such query at a time. Results come back a few frames later. A frame that
// finds no free query goes untimed, and a disjoint result, after which the GPU's clock cannot be
// trusted, is dropped. Timing runs only while the page measures, on one drawn frame in every
// SAMPLED_EVERY, as the WebGPU timer does.

import { FrameRecorder, Role, SAMPLED_EVERY, UNTIMED } from '../../shared/metrics';

/** Frames whose results can be in flight at once. */
const SLOTS = 4;
const NS_PER_MS = 1e6;

/** The extension's names, which TypeScript's DOM types do not declare. */
interface TimerQueryExtension {
	readonly TIME_ELAPSED_EXT: number;
	readonly GPU_DISJOINT_EXT: number;
}

export class WebGL2GpuTimer {
	private readonly queries: WebGLQuery[] = [];
	private readonly pending = new Uint8Array(SLOTS);
	private readonly frames = new Uint32Array(SLOTS);
	/** The slot of the query that the frame being replayed runs inside, or -1. */
	private open = -1;
	private next = 0;
	private drawn = 0;

	private constructor(
		private readonly gl: WebGL2RenderingContext,
		private readonly ext: TimerQueryExtension,
		private readonly recorder: FrameRecorder,
	) {
		for (let slot = 0; slot < SLOTS; slot++) {
			const query = gl.createQuery();
			if (!query) throw new Error('WebGL2 could not create a timer query');
			this.queries.push(query);
		}
	}

	/** A timer when the context has GPU timer queries, else undefined. */
	static create(gl: WebGL2RenderingContext, metrics: ArrayBufferLike): WebGL2GpuTimer | undefined {
		const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExtension | null;
		if (!ext) return undefined;
		return new WebGL2GpuTimer(gl, ext, new FrameRecorder(metrics, Role.Gpu));
	}

	/**
	 * Records the results that came back, then starts timing frame `frame` when the page is
	 * measuring, it is a sampled frame, and a query is free. Call it before the frame's replay.
	 */
	beginFrame(frame: number): void {
		this.poll();
		this.open = -1;
		if (!this.recorder.measuring || this.drawn++ % SAMPLED_EVERY !== 0) return;
		if (this.pending[this.next] !== 0) return;
		const slot = this.next;
		this.next = (slot + 1) % SLOTS;
		this.frames[slot] = frame;
		this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.queries[slot] as WebGLQuery);
		this.open = slot;
	}

	/** Ends a timed frame's query. Call it after the frame's replay. */
	endFrame(): void {
		if (this.open < 0) return;
		this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
		this.pending[this.open] = 1;
		this.open = -1;
	}

	/** Records each pending frame whose result came back, in the order the frames ran. */
	private poll(): void {
		const gl = this.gl;
		for (let k = 0; k < SLOTS; k++) {
			const slot = (this.next + k) % SLOTS;
			if (this.pending[slot] === 0) continue;
			const query = this.queries[slot] as WebGLQuery;
			if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) !== true) return;
			this.pending[slot] = 0;
			if (gl.getParameter(this.ext.GPU_DISJOINT_EXT)) continue;
			const ns = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
			const recorder = this.recorder;
			recorder.begin(this.frames[slot] as number);
			recorder.gpuPasses(0, 0);
			recorder.gpuTime(0, UNTIMED);
			recorder.commit(ns / NS_PER_MS);
		}
	}

	destroy(): void {
		if (this.open >= 0) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
		for (const query of this.queries) this.gl.deleteQuery(query);
	}
}
