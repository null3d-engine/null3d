// The time of each WebGL call on the thread that draws, for benchmarks that ask for it with
// ?gl-timing. A browser that runs WebGL in a process of its own, as Safari does, answers a call that
// returns a value only after that process has run every call before it, so the call that waits
// shows where the thread that draws blocks. The engine loads this module only with the switch: the
// timed context wraps every call, and allocates for each one.
//
// The thread that draws counts calls only while the page measures. It answers requests for the
// counts on a broadcast channel, so a benchmark page reads them without a message to the worker.

import { FrameRecorder, Role } from '../../shared/metrics';

/** The broadcast channel on which the thread that draws answers requests for its call times. */
export const GL_TIMING_CHANNEL = 'null3d-gl-timing';
/** The message that asks for the call times; the answer is a `GlTimingReport`. */
export const GL_TIMING_REQUEST = 'gl-timing-request';

/** One WebGL call's figures over the measured frames. */
export interface GlCallTimes {
	/** The call's name, as `extension.call` for a call of an extension object. */
	name: string;
	/** Time in the call, summed over the measured frames, in milliseconds. */
	ms: number;
	calls: number;
	/** The longest single call, in milliseconds. */
	longestMs: number;
}

/** The call times of the measured frames. A frame counts at its fence, which ends each frame. */
export interface GlTimingReport {
	type: 'gl-timing';
	frames: number;
	calls: GlCallTimes[];
}

type Method = (...args: unknown[]) => unknown;

/**
 * Returns a stand-in for `gl` that times each call while the page measures, and starts answering
 * requests for the times. Constants and properties read through to `gl`. Without `metrics` it
 * times every call.
 */
export function timeGlCalls(
	gl: WebGL2RenderingContext,
	metrics: ArrayBufferLike | undefined,
): WebGL2RenderingContext {
	const recorder = metrics && new FrameRecorder(metrics, Role.Render);
	const times = new Map<string, GlCallTimes>();
	let frames = 0;

	const timed = (name: string, target: object, method: Method): Method => {
		const figures: GlCallTimes = { name, ms: 0, calls: 0, longestMs: 0 };
		times.set(name, figures);
		return (...args) => {
			if (recorder && !recorder.measuring) return method.apply(target, args);
			if (name === 'fenceSync') frames++;
			const start = performance.now();
			try {
				return method.apply(target, args);
			} finally {
				const ms = performance.now() - start;
				figures.ms += ms;
				figures.calls++;
				if (ms > figures.longestMs) figures.longestMs = ms;
			}
		};
	};

	/** An object whose functions are timed calls on `target`, and whose other properties read it. */
	const wrap = (target: object, prefix: string, prototype: object): Record<string, unknown> => {
		const stand: Record<string, unknown> = {};
		for (let from: object | null = prototype; from && from !== Object.prototype; ) {
			for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(from))) {
				if (key in stand || key === 'constructor') continue;
				if (typeof descriptor.value === 'function')
					stand[key] = timed(`${prefix}${key}`, target, descriptor.value as Method);
				else
					Object.defineProperty(stand, key, {
						get: () => (target as Record<string, unknown>)[key],
						enumerable: true,
					});
			}
			from = Object.getPrototypeOf(from);
		}
		return stand;
	};

	const stand = wrap(gl, '', Object.getPrototypeOf(gl));
	// Extension objects with calls of their own, such as multi-draw, are timed as well.
	const extensions = new Map<string, unknown>();
	const getExtension = stand.getExtension as Method;
	stand.getExtension = (name: unknown) => {
		const key = String(name);
		if (!extensions.has(key)) {
			const extension = getExtension(name);
			extensions.set(
				key,
				extension && typeof extension === 'object'
					? wrap(extension, `${key}.`, extension)
					: extension,
			);
		}
		return extensions.get(key);
	};

	const channel = new BroadcastChannel(GL_TIMING_CHANNEL);
	channel.onmessage = (event: MessageEvent<unknown>) => {
		if (event.data !== GL_TIMING_REQUEST) return;
		const calls = [...times.values()].filter((call) => call.calls > 0).sort((a, b) => b.ms - a.ms);
		channel.postMessage({ type: 'gl-timing', frames, calls } satisfies GlTimingReport);
	};
	return stand as unknown as WebGL2RenderingContext;
}
