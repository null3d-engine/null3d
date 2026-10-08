// The occlusion-s6 plan, T-36: S6's occlusion turns on WebGL2 at each preset that a phone or a
// tablet may run, with the software occlusion buffer at its default size and at the larger size
// of the first round of measurements. Each load times the culling off and on over the same
// stretches of the route, and checks for popping at stops along it (tests/pages/lib/occlusion.ts).
// D-22 records the results, and the preset rows rest on them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	type OcclusionTurnsResult,
	occlusionMeasurementProblems,
	occlusionVerdict,
	POP_MARGIN_PIXELS,
	poppingProblems,
} from '../pages/lib/occlusion.ts';
import { BENCH_BUILD, loadPath } from './load-routes.ts';
import { failureText, type ItemResult, type PlanItem } from './runs.ts';

/** One load of S6's occlusion turns at one preset, with one size of the occlusion buffer. */
export interface OcclusionS6Check {
	kind: 'occlusion-s6';
	/** WebGL2, where the job workers cull: a device without it skips the load. */
	tier: 'webgl2';
	preset: string;
	buffer: string;
}

/** The presets that the plan measures: those that a phone or a tablet may run on WebGL2. */
export const OCCLUSION_S6_PRESETS = ['low', 'medium', 'high'] as const;
/**
 * The occlusion buffer's sizes: the core's default, and the larger size of the first round of
 * measurements, which hides objects behind narrower gaps for more work.
 */
export const OCCLUSION_S6_BUFFERS = ['256x144', '384x216'] as const;
/** Seconds that each side measures in each round, unless the plan names another number. */
export const OCCLUSION_S6_SECONDS = 10;
/** Rounds of the two sides in each load. */
const ROUNDS = 4;
/** Stops of the popping check along the route. */
const STOPS = 24;
/**
 * How long a load may take: the city's start and stream on a phone, about a minute, then the
 * rounds with their settling, and the popping check's captures, about a second each on a phone.
 */
const timeoutSeconds = (seconds: number) => 180 + 2 * ROUNDS * (seconds + 2) + 3 * STOPS * 2;

/**
 * The loads of the plan: each preset with each buffer size, the sizes in turns. Every load forces
 * WebGL2, where the job workers cull, and turns the governor off, so the render scale holds while
 * the sides take turns.
 */
export function occlusionS6Plan({
	seconds = OCCLUSION_S6_SECONDS,
}: {
	seconds?: number;
} = {}): PlanItem<OcclusionS6Check>[] {
	return OCCLUSION_S6_PRESETS.flatMap((preset) =>
		OCCLUSION_S6_BUFFERS.map((buffer) => {
			const switches = [
				'gpu=webgl2',
				`preset=${preset}`,
				'governor=off',
				'occlusion-turns',
				`occlusion-buffer=${buffer}`,
				`rounds=${ROUNDS}`,
				`seconds=${seconds}`,
				`stops=${STOPS}`,
			];
			return {
				id: `occlusion-s6-${preset}-${buffer}`,
				path: loadPath(BENCH_BUILD, `bench/pages/null3d/s6.html?${switches.join('&')}`),
				timeoutSeconds: timeoutSeconds(seconds),
				check: { kind: 'occlusion-s6' as const, tier: 'webgl2' as const, preset, buffer },
			};
		}),
	);
}

/**
 * Writes a load's popped stops' frames into `folder` as `<name>.png`, so people can see what the
 * culling hid. A load without popping writes nothing.
 */
export function saveOcclusionS6Images(folder: string, result: OcclusionTurnsResult): void {
	const images = Object.entries(result.images ?? {});
	if (images.length === 0) return;
	mkdirSync(folder, { recursive: true });
	for (const [name, png] of images)
		writeFileSync(join(folder, `${name}.png`), Buffer.from(png, 'base64'));
}

/** A time in ms with three decimals, signed when `signed`, or a dash for none. */
const ms = (value: number | null, signed = false) =>
	value === null ? '-' : `${signed && value > 0 ? '+' : ''}${value.toFixed(3)}`;

/**
 * The T-36 table of one runner's results: for each preset and buffer size, the share of the
 * entries that the culling hid, the CPU time it added, the render worker's, the GPU's and the
 * frame interval's saving, the popped stops, and whether the culling paid. Loads that failed their
 * check stay out, with their problems below the table. Undefined when the plan has no such loads.
 */
export function occlusionS6Summary(
	items: readonly PlanItem<{ kind: string }>[],
	resultOf: (id: string) => ItemResult | undefined,
): string | undefined {
	const rows: string[] = [];
	const failures: string[] = [];
	let loads = 0;
	for (const { id, check } of items) {
		if (check.kind !== 'occlusion-s6') continue;
		loads++;
		const { preset, buffer } = check as OcclusionS6Check;
		const result = resultOf(id);
		const turns = result?.ok ? (result as ItemResult & OcclusionTurnsResult) : undefined;
		if (!turns) {
			failures.push(`${id}: ${result ? failureText(result) : 'no result'}`);
			continue;
		}
		// A load whose stops popped still has figures; its row shows the popping, and the list below
		// names the stops.
		const measurement = occlusionMeasurementProblems(turns);
		const problems = [...measurement, ...poppingProblems(turns)];
		if (problems.length > 0) failures.push(`${id}: ${problems.join('; ')}`);
		if (measurement.length > 0) continue;
		const verdict = occlusionVerdict(turns);
		const noise = Math.max(0, ...turns.stops.map((stop) => stop.noise));
		rows.push(
			`| ${[
				preset,
				buffer,
				`${(100 * verdict.hiddenShare).toFixed(1)}%`,
				ms(verdict.addedCpuMs, true),
				ms(verdict.savedRenderMs),
				ms(verdict.savedGpuMs),
				`${ms(turns.off.intervalMs)} / ${ms(turns.on.intervalMs)}`,
				`${verdict.poppedStops} of ${turns.stops.length} (noise ${noise})`,
				verdict.pays ? 'yes' : 'no',
			].join(' | ')} |`,
		);
	}
	if (loads === 0) return undefined;
	return [
		`T-36, S6's occlusion turns on WebGL2: medians per frame in ms. Hidden: the entries that culling took out of those in the view. Added: the job workers' and the culling step's added CPU time. Saved: the render worker's and the GPU's time (a dash where the device has no GPU timer). Popped: stops where culling on differs from culling off by more than ${POP_MARGIN_PIXELS} pixels past the noise of two frames with it off. Pays: the savings exceed the added time and nothing popped.`,
		'',
		'| Preset | Buffer | Hidden | Added | Saved, render | Saved, GPU | Interval, off / on | Popped | Pays |',
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
		...rows,
		...(failures.length > 0 ? ['', 'Loads with problems:', ...failures] : []),
	].join('\n');
}
