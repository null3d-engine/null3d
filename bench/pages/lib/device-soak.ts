// The device soak: a benchmark page runs its scene for many minutes and measures the engine once a
// minute, for the frame rates, the GPU losses that the engine recovered from, and the memory. It
// stops early when the engine fails. The runner tool runs it on phones and tablets, where browsers
// are reported to lose the GPU after a while, and judges and tabulates the result with the pure
// helpers here, which import nothing from the engine, so the tool's Node code can load them.
import { median } from '../../../packages/cli/src/protocol.js';

/** The calls of a running engine that the soak makes. */
interface SoakedEngine {
	onFailure(handler: (error: { code: string; message: string }) => void): () => void;
	measure(seconds: number): Promise<{
		presentedFps: number;
		completedFps: number | null;
		cpuMs: { median: number };
		gpuMs: { median: number } | null;
		gpuLosses: number;
		memory: { wasmBytes: number | null };
		pipelines: number;
	}>;
}

/** Seconds of each measurement. */
export const SOAK_SAMPLE_SECONDS = 60;

/** One minute of the soak. */
export interface SoakMinute {
	/** The minute's number, from 1. */
	minute: number;
	presentedFps: number;
	completedFps: number | null;
	/** Median CPU time per frame of the busiest thread. */
	cpuMs: number;
	/** Median GPU time per frame, where the device times it. */
	gpuMs: number | null;
	/** GPU losses since the engine started, at the end of the minute. */
	gpuLosses: number;
	wasmBytes: number | null;
	/** GPU pipelines built in the minute: a new device after a loss builds them again. */
	pipelines: number;
}

/** What the soak reports. */
export interface SoakReport {
	minutes: number;
	samples: SoakMinute[];
	/** The engine's failures, each as its code and message. */
	failures: string[];
}

/** Runs the soak on a started engine: one measurement a minute until the minutes end or it fails. */
export async function soakEngine(engine: SoakedEngine, minutes: number): Promise<SoakReport> {
	const failures: string[] = [];
	const off = engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
	const samples: SoakMinute[] = [];
	for (let minute = 1; minute <= minutes && failures.length === 0; minute++) {
		const metrics = await engine.measure(SOAK_SAMPLE_SECONDS);
		samples.push({
			minute,
			presentedFps: metrics.presentedFps,
			completedFps: metrics.completedFps,
			cpuMs: metrics.cpuMs.median,
			gpuMs: metrics.gpuMs?.median ?? null,
			gpuLosses: metrics.gpuLosses,
			wasmBytes: metrics.memory.wasmBytes,
			pipelines: metrics.pipelines,
		});
	}
	off();
	return { minutes, samples, failures };
}

/**
 * What is wrong with a soak; empty when nothing is. The engine must not fail, and must draw in
 * every minute. A GPU loss that the engine recovered from is a finding, not a failure.
 */
export function soakProblems(report: SoakReport | undefined): string[] {
	if (!report) return ['the page reported no soak'];
	const problems = report.failures.map((failure) => `the engine failed: ${failure}`);
	if (report.failures.length === 0 && report.samples.length < report.minutes)
		problems.push(`the soak measured ${report.samples.length} of ${report.minutes} minutes`);
	for (const sample of report.samples)
		if (sample.presentedFps <= 0)
			problems.push(`the engine drew no frames in minute ${sample.minute}`);
	return problems;
}

/** The GPU losses during the soak: those since the engine started, at its last minute. */
export const soakLosses = (report: SoakReport) => report.samples.at(-1)?.gpuLosses ?? 0;

const fps = (value: number) => value.toFixed(1);

/** The engine's mode as a soak page reports it: the preset that ran, and the preset check's rounds. */
export interface SoakMode {
	preset?: string;
	presetCheck?: {
		rounds: { preset: string; presentedFps: number; completedFps: number }[];
		reused: boolean;
	} | null;
}

/**
 * The preset that a soak ran, with the frame rate at which the preset check measured each preset,
 * the lower of the presented and completed rates, as the check judges them. A page that names its
 * preset runs no check.
 */
export function soakPreset(mode: SoakMode | undefined): string {
	if (!mode?.preset) return '-';
	const check = mode.presetCheck;
	if (!check || check.rounds.length === 0) return mode.preset;
	const rounds = check.rounds.map(
		(round) => `${round.preset} ${fps(Math.min(round.presentedFps, round.completedFps))} fps`,
	);
	return `${mode.preset} (${check.reused ? 'stored check' : 'check'}: ${rounds.join(', ')})`;
}

/**
 * A row of the soak table: the scene, the path, the preset, the minutes, the losses, the frame
 * rates and the memory.
 */
export function soakRow(scene: string, tier: string, report: SoakReport, mode?: SoakMode): string {
	const { samples } = report;
	const lowest = samples.reduce<SoakMinute | undefined>(
		(low, sample) => (low && low.presentedFps <= sample.presentedFps ? low : sample),
		undefined,
	);
	const lossMinutes = samples
		.filter((sample, i) => sample.gpuLosses > (samples[i - 1]?.gpuLosses ?? 0))
		.map((sample) => sample.minute);
	const first = samples[0]?.wasmBytes;
	const last = samples.at(-1)?.wasmBytes;
	const growth =
		typeof first === 'number' && typeof last === 'number'
			? `${((last - first) / (1024 * 1024)).toFixed(1)} MiB`
			: '-';
	const cells = [
		scene,
		tier,
		soakPreset(mode),
		`${samples.length} of ${report.minutes}`,
		`${soakLosses(report)}${lossMinutes.length > 0 ? ` (minutes ${lossMinutes.join(', ')})` : ''}`,
		fps(median(samples.map((sample) => sample.presentedFps))),
		lowest ? `${fps(lowest.presentedFps)} (minute ${lowest.minute})` : '-',
		growth,
		report.failures.join('; ').replaceAll('|', '/') || 'none',
	];
	return `| ${cells.join(' | ')} |`;
}

/** The header of the soak table. */
export const SOAK_TABLE_HEAD = [
	'| Scene | Path | Preset | Minutes measured | GPU losses | Median fps | Lowest fps | WebAssembly memory growth | Engine failures |',
	'| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];
