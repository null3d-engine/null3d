// TEMPORARY DIAGNOSTIC for the texture-arrays stall on CI's WebGPU (drawing on the main thread).
// Remove it with the diagnostic job once the stall's cause is known.
//
// Records, from the page alone, what the thread that draws on the page met while it took no frame:
// the page's animation frame callbacks, the GPU queue's submits and completions, the pipeline
// builds, and the engine's frame counters, polled from a timer, which runs while frame callbacks
// stop. `frameReport` sums them up from a given time.

import { Slot } from '../../../packages/engine/src/shared/control';
import { engineSlots } from './engine-watch';

const callbacks: number[] = [];
const submits: number[] = [];
/** For each wait on the queue, when it was asked for and when it settled, or -1 while it waits. */
const waits: [number, number][] = [];
/** For each pipeline build, when it started and when it ended, or -1 while it builds. */
const builds: [number, number][] = [];
/** Each change of the counters: time, published, taken, presented, pipelines built. */
const counters: [number, number, number, number, number][] = [];

const now = () => performance.now();

const pageRequest = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (callback: FrameRequestCallback) =>
	pageRequest((timestamp) => {
		callbacks.push(now());
		callback(timestamp);
	});

if (typeof GPUQueue !== 'undefined') {
	const submit = GPUQueue.prototype.submit;
	GPUQueue.prototype.submit = function (this: GPUQueue, buffers: Iterable<GPUCommandBuffer>) {
		submits.push(now());
		return submit.call(this, buffers);
	};
	const workDone = GPUQueue.prototype.onSubmittedWorkDone;
	GPUQueue.prototype.onSubmittedWorkDone = function (this: GPUQueue) {
		const wait: [number, number] = [now(), -1];
		waits.push(wait);
		const done = workDone.call(this);
		void done.then(
			() => {
				wait[1] = now();
			},
			() => {
				wait[1] = now();
			},
		);
		return done;
	};
	for (const name of ['createRenderPipelineAsync', 'createComputePipelineAsync'] as const) {
		const create = GPUDevice.prototype[name] as (...args: unknown[]) => Promise<unknown>;
		(GPUDevice.prototype as unknown as Record<string, unknown>)[name] = function (
			this: GPUDevice,
			...args: unknown[]
		) {
			const build: [number, number] = [now(), -1];
			builds.push(build);
			const made = create.apply(this, args);
			void made.then(
				() => {
					build[1] = now();
				},
				() => {
					build[1] = now();
				},
			);
			return made;
		};
	}
}

setInterval(() => {
	const slots = engineSlots();
	if (!slots) return;
	const row: [number, number, number, number, number] = [
		now(),
		Atomics.load(slots, Slot.FramesPublished),
		Atomics.load(slots, Slot.FramesTaken),
		Atomics.load(slots, Slot.FramePresented),
		Atomics.load(slots, Slot.PipelinesBuilt),
	];
	const last = counters.at(-1);
	if (!last || row.slice(1).some((value, k) => value !== last[k + 1])) counters.push(row);
}, 5);

const ms = (time: number) => (time < 0 ? 'never' : `${Math.round(time)}`);

/**
 * The longest stretch from `from` on in which the thread that draws took no frame, and what the
 * page met in it, in one line.
 */
export function frameReport(from: number): string {
	const end = now();
	const takes = [from];
	let taken = -1;
	for (const [time, , frame] of counters) {
		if (frame !== taken && time >= from) takes.push(time);
		taken = frame;
	}
	takes.push(end);
	let gapStart = from;
	let gapEnd = from;
	for (let k = 1; k < takes.length; k++)
		if ((takes[k] as number) - (takes[k - 1] as number) > gapEnd - gapStart) {
			gapStart = takes[k - 1] as number;
			gapEnd = takes[k] as number;
		}
	const inGap = (time: number) => time > gapStart && time < gapEnd;
	const counted = (times: number[]) => times.filter(inGap).length;
	const longestCallbackGap = callbacks.reduce(
		(longest, time, k) =>
			k > 0 && inGap(time) ? Math.max(longest, time - (callbacks[k - 1] as number)) : longest,
		0,
	);
	const pendingAtStart = waits.filter(
		([asked, settled]) => asked <= gapStart && (settled < 0 || settled > gapStart),
	);
	const buildsInGap = builds.filter(
		([start, done]) => start < gapEnd && (done < 0 || done > gapStart),
	);
	const counterRows = counters
		.filter(([time]) => time >= gapStart - 50 && time <= gapEnd + 50)
		.slice(0, 12)
		.map(([time, ...values]) => `${ms(time)}:${values.join('/')}`)
		.join(' ');
	return [
		`steady from ${ms(from)}; frames taken ${takes.length - 2}`,
		`longest wait for a frame ${ms(gapEnd - gapStart)} ms (${ms(gapStart)} to ${ms(gapEnd)})`,
		`in it: ${counted(callbacks)} frame callbacks (longest gap ${ms(longestCallbackGap)} ms), ${counted(submits)} submits, ${waits.filter(([, settled]) => inGap(settled)).length} completions`,
		`queue waits open at its start ${pendingAtStart.length} (asked ${pendingAtStart.map(([asked, settled]) => `${ms(asked)}->${ms(settled)}`).join(',')})`,
		`builds over it ${buildsInGap.length} (${buildsInGap
			.slice(0, 8)
			.map(([start, done]) => `${ms(start)}->${ms(done)}`)
			.join(',')})`,
		`builds in all ${builds.length}, last ended ${ms(Math.max(-1, ...builds.map(([, done]) => done)))}, open ${builds.filter(([, done]) => done < 0).length}`,
		`counters (time:published/taken/presented/built) ${counterRows}`,
	].join('; ');
}

/**
 * Every wait for a frame of at least `least` ms over the whole run, once the thread that draws took
 * its first frame, each with what the page met in it, and when the pipeline builds started and
 * ended.
 */
export function longWaits(least: number): string {
	const takes: number[] = [];
	let taken = 0;
	for (const [time, , frame] of counters) {
		if (frame !== taken && frame > 0) takes.push(time);
		taken = frame;
	}
	const found: string[] = [];
	for (let k = 1; k < takes.length; k++) {
		const start = takes[k - 1] as number;
		const end = takes[k] as number;
		if (end - start < least) continue;
		const inGap = (time: number) => time > start && time < end;
		const frame = counters.find(([time]) => time >= start)?.[2] ?? -1;
		const longestCallbackGap = callbacks.reduce(
			(longest, time, j) =>
				j > 0 && inGap(time) ? Math.max(longest, time - (callbacks[j - 1] as number)) : longest,
			0,
		);
		const open = waits.filter(
			([asked, settled]) => asked <= start && (settled < 0 || settled > start),
		);
		found.push(
			`${ms(end - start)} ms after frame ${frame} (${ms(start)} to ${ms(end)}): ` +
				`${callbacks.filter(inGap).length} callbacks (longest gap ${ms(longestCallbackGap)}), ` +
				`${submits.filter(inGap).length} submits, ${waits.filter(([, settled]) => inGap(settled)).length} completions, ` +
				`${open.length} queue waits open at its start, ` +
				`${builds.filter(([, done]) => inGap(done)).length} builds ended in it, ` +
				`${builds.filter(([begun, done]) => begun <= start && (done < 0 || done >= end)).length} builds over all of it`,
		);
	}
	const first = Math.min(...builds.map(([begun]) => begun));
	const last = Math.max(-1, ...builds.map(([, done]) => done));
	const ends = builds
		.map(([, done]) => done)
		.filter((done) => done >= 0)
		.sort((a, b) => a - b);
	return (
		`builds ${builds.length} from ${ms(first)} to ${ms(last)}, ends ${ends.map(ms).join(',')}; ` +
		`first take ${ms(takes[0] ?? -1)}; waits of ${least} ms or more: ${found.length > 0 ? found.join(' | ') : 'none'}`
	);
}
