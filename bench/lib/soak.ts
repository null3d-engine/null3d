// The soak test's judgment and its table. The soak runs a scene for many minutes and samples the
// JavaScript heap of each engine thread and the size of the engine's WebAssembly memory. After a
// warm-up, the heaps of the threads that run frame code must stay flat within a small allowance,
// the WebAssembly memory must not grow, and the engine must still draw at the end. Everything here
// is pure: bench/soak.ts runs the scene and takes the samples.
import { median } from './report';

/** One sample of the run. */
export interface SoakSample {
	/** Seconds since the first sample. */
	atSeconds: number;
	/**
	 * Each thread's JavaScript heap in bytes, by thread name, after a full garbage collection where
	 * the thread can run one. Null when the thread did not answer.
	 */
	heaps: Record<string, number | null>;
	/** The engine's WebAssembly memory in bytes. */
	wasmBytes: number;
}

export interface SoakRun {
	samples: readonly SoakSample[];
	/** Frames that the engine drew in a short measurement at the end of the run. */
	framesAtEnd: number;
	/** Errors that the page reported during the run. */
	pageErrors: readonly string[];
}

export interface SoakRules {
	/** Seconds from the first sample until the scene's memory and the browser's compiled code settle. */
	warmupSeconds: number;
	/** The most that a judged heap may grow after the warm-up, in bytes. */
	heapAllowanceBytes: number;
	/** The threads whose heaps must stay flat. */
	judged: readonly string[];
}

/** Samples at each end of the judged part of a run, whose medians the judge compares. */
export const END_SAMPLES = 3;

export interface SoakVerdict {
	/** Each judged heap's growth after the warm-up, in bytes. */
	heapGrowth: Record<string, number>;
	/** The WebAssembly memory's growth after the warm-up, in bytes. */
	wasmGrowth: number;
	/** Why the run fails, one sentence each. Empty when it passes. */
	problems: string[];
}

export const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;
export const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

/**
 * Judges a run. A heap's growth is the median of the last few samples less the median of the first
 * few after the warm-up, so one sample that a late collection or compile nudges decides nothing. The
 * WebAssembly memory never shrinks, so any growth after the warm-up counts.
 */
export function judgeSoak(run: SoakRun, rules: SoakRules): SoakVerdict {
	const verdict: SoakVerdict = { heapGrowth: {}, wasmGrowth: 0, problems: [] };
	for (const error of run.pageErrors) verdict.problems.push(`the page reported an error: ${error}`);
	if (run.framesAtEnd <= 0)
		verdict.problems.push('the engine drew no frames at the end of the run');
	const settled = run.samples.filter((s) => s.atSeconds >= rules.warmupSeconds);
	if (settled.length < 2 * END_SAMPLES) {
		verdict.problems.push(
			`the run is too short to judge: it needs ${2 * END_SAMPLES} samples after the ${rules.warmupSeconds}-second warm-up, and it has ${settled.length}`,
		);
		return verdict;
	}
	const first = settled.slice(0, END_SAMPLES);
	const last = settled.slice(-END_SAMPLES);
	for (const thread of rules.judged) {
		const heaps = (window: readonly SoakSample[]) =>
			window.flatMap((s) => {
				const bytes = s.heaps[thread];
				return typeof bytes === 'number' ? [bytes] : [];
			});
		const [before, after] = [heaps(first), heaps(last)];
		if (before.length < END_SAMPLES || after.length < END_SAMPLES) {
			verdict.problems.push(`the ${thread} did not report its heap in every sample`);
			continue;
		}
		const growth = median(after) - median(before);
		verdict.heapGrowth[thread] = growth;
		if (growth > rules.heapAllowanceBytes)
			verdict.problems.push(
				`the ${thread}'s heap grew ${kb(growth)} after the warm-up, more than its allowance of ${kb(rules.heapAllowanceBytes)}`,
			);
	}
	const [startBytes = 0, ...later] = settled.map((s) => s.wasmBytes);
	verdict.wasmGrowth = Math.max(startBytes, ...later) - startBytes;
	if (verdict.wasmGrowth > 0)
		verdict.problems.push(
			`the WebAssembly memory grew ${mb(verdict.wasmGrowth)} after the warm-up`,
		);
	return verdict;
}

/**
 * The samples as a Markdown table: one row per sample, a column per thread in the order given, and
 * the WebAssembly memory. Rows within the warm-up say so.
 */
export function soakTable(
	samples: readonly SoakSample[],
	threads: readonly string[],
	warmupSeconds: number,
): string[] {
	const cell = (bytes: number | null | undefined) =>
		typeof bytes === 'number' ? mb(bytes).replace(' MB', '') : '-';
	const title = (thread: string) => `${thread.charAt(0).toUpperCase()}${thread.slice(1)}`;
	const lines = [
		`| Time, s | ${threads.map((t) => `${title(t)} heap, MB`).join(' | ')} | WebAssembly memory, MB |`,
		`| --- | ${threads.map(() => '---').join(' | ')} | --- |`,
	];
	for (const sample of samples) {
		const warmup = sample.atSeconds < warmupSeconds ? ', warm-up' : '';
		const heaps = threads.map((t) => cell(sample.heaps[t]));
		lines.push(
			`| ${sample.atSeconds.toFixed(0)}${warmup} | ${heaps.join(' | ')} | ${cell(sample.wasmBytes)} |`,
		);
	}
	return lines;
}
