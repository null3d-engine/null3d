// Watches a live engine's frame loop from the page, for test pages whose runs can stall. It reads
// the control block and the frame records that the page hands to the engine's workers, and notes
// the frame loop's counters in the page's trail: once a second while they change, and a few times
// while they stand still, then with the newest frame that each thread recorded. The trail of a page
// that gave no result then tells which thread stopped: the sketch thread that publishes frames, the
// thread that draws and takes them, or the GPU that finishes them. The notes of counters that stand
// still are few, so the last steps that a runner quotes still show what the page did last.

import { Slot } from '../../../packages/engine/src/shared/control';
import { MetricsReader, Role } from '../../../packages/engine/src/shared/metrics';
import { progress } from './result';

const WATCH_MS = 1000;
/** When the trail first notes counters that stand still, and how often after that. */
const FIRST_STILL_NOTE_MS = 5000;
const STILL_NOTE_MS = 10_000;

/** The frame loop's counters in the control block, by the names the trail gives them. */
const COUNTERS: readonly (readonly [string, number])[] = [
	['published', Slot.FramesPublished],
	['taken', Slot.FramesTaken],
	['presented', Slot.FramePresented],
	['images', Slot.ImagesArrived],
	['pipelines built', Slot.PipelinesBuilt],
	['GPU epoch', Slot.GpuEpoch],
	['paused', Slot.Paused],
	['running', Slot.Running],
	['display µs', Slot.DisplayInterval],
];

/** The shared buffers of the engine that the page started last. */
let engine: { slots: Int32Array; metrics: SharedArrayBuffer } | undefined;

// The page hands each engine worker the control block and the frame records in its first message.
let workerProto: object = Worker.prototype;
while (!Object.hasOwn(workerProto, 'postMessage')) workerProto = Object.getPrototypeOf(workerProto);
const post = (workerProto as Worker).postMessage;
(workerProto as Worker).postMessage = function (
	this: Worker,
	message: unknown,
	transfer?: Transferable[] | StructuredSerializeOptions,
) {
	const { type, control, metrics } = (message ?? {}) as Record<string, unknown>;
	const shared = control instanceof SharedArrayBuffer && metrics instanceof SharedArrayBuffer;
	if (type === 'init' && shared && engine?.slots.buffer !== control)
		engine = { slots: new Int32Array(control), metrics };
	post.call(this, message, transfer as StructuredSerializeOptions);
};

function counters(slots: Int32Array): string {
	return COUNTERS.map(([name, slot]) => `${name} ${Atomics.load(slots, slot)}`).join(', ');
}

/** The newest frame that the sketch thread, the thread that draws and the GPU each recorded. */
function newestFrames(metrics: SharedArrayBuffer): string {
	const reader = new MetricsReader(metrics);
	const rings = reader.readWritten();
	const newest = (role: number) => rings[role]?.frames.at(-1) ?? 'none';
	return `newest frames: sketch ${newest(Role.Sketch)}, drawn ${newest(Role.Render)}, GPU done ${newest(Role.Completion)}; refresh ${reader.refreshHz} Hz`;
}

/**
 * Notes the frame loop's counters of the engine that the page starts next, or started last, in the
 * page's trail until the returned function stops it. A page whose engine runs on its own thread
 * alone has no counters to note.
 */
export function watchEngine(): () => void {
	let noted = '';
	let changedAt = 0;
	let notedAt = 0;
	const timer = setInterval(() => {
		if (!engine) return;
		const now = performance.now();
		const current = counters(engine.slots);
		if (current !== noted) {
			noted = current;
			changedAt = now;
			notedAt = now;
			progress(`engine: ${current}`);
		} else if (now - notedAt >= (notedAt === changedAt ? FIRST_STILL_NOTE_MS : STILL_NOTE_MS)) {
			notedAt = now;
			const still = Math.round((now - changedAt) / 1000);
			progress(`engine still for ${still} s: ${current}; ${newestFrames(engine.metrics)}`);
		}
	}, WATCH_MS);
	return () => clearInterval(timer);
}
