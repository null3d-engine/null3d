// What the specs that time an effect's cost share: the result that a cost page publishes, the wait
// for a quiet computer before each measurement, and the lines that print each side's medians. Each
// spec times its effect off and on, in turns, on a computer with a GPU of its own, and prints the
// load beside its figures, as other work on the computer would spoil them.
import type { SideMemory } from '../pages/lib/side-memory';
import { LOAD_WAIT_MS, load, waitForQuietLoad } from './cost-runs.ts';

/** The memory figures of one side of a cost page's turns, from the engine's stats overlay. */
export type { SideMemory };

/** One side of a cost page's turns: the medians with the effect off, or with it on. */
export interface Side {
	gpuMs: number | null;
	intervalMs: number | null;
	cpuMs: number | null;
	/** Draw calls per frame, where the page reports them. */
	draws?: number | null;
	/** Each part of the frame's GPU time, where the device times its passes. */
	passes?: { name: string; ms: number | null }[];
	threads: Record<string, number | null>;
}

/** What a cost page publishes. */
export interface CostResult {
	error?: string;
	tier: string;
	off: Side;
	on: Side;
	memory?: { off?: SideMemory; on?: SideMemory };
	failures: string[];
}

/**
 * A cost test's time limit: the longest wait for a quiet computer, and the measurement's own
 * time after it.
 */
export const costTimeout = (measureMs: number) => LOAD_WAIT_MS + measureMs;

/** The computer's 1-minute load, as a report prints it. */
export const loadNow = load;

/**
 * Waits for a quiet computer as waitForQuietLoad does, and returns the load. `NULL3D_COST_TRIAL`
 * skips the wait, for an untimed trial that only checks that the pages run.
 */
export async function waitForQuiet(): Promise<string> {
	await waitForQuietLoad();
	return loadNow();
}

/** A side's medians in one line, with each thread's busy time when `threads` is set. */
export function sideLine(name: string, side: Side, digits: number, threads = false): string {
	const ms = (value: number | null) => (value === null ? 'none' : value.toFixed(digits));
	const busy = threads
		? `, ${Object.entries(side.threads)
				.map(([thread, time]) => `${thread} ${ms(time)}`)
				.join(', ')}`
		: '';
	return `${name}: GPU ${ms(side.gpuMs)} ms, interval ${ms(side.intervalMs)} ms, CPU ${ms(side.cpuMs)} ms${busy}`;
}

/** A side's memory in one line, in mebibytes, from the engine's stats overlay. */
export function memoryLine(name: string, memory: SideMemory | undefined): string {
	if (!memory) return `${name} memory: none`;
	const mib = (value: number | null) =>
		value === null ? 'n/a' : `${(value / (1024 * 1024)).toFixed(1)} MiB`;
	return [
		`${name} memory:`,
		`textures ${mib(memory.gpuTextureBytes)},`,
		`buffers ${mib(memory.gpuBufferBytes)},`,
		`wasm ${mib(memory.wasmBytes)},`,
		`engine ${mib(memory.engineBytes)},`,
		`total ${mib(memory.totalBytes)}`,
	].join(' ');
}
