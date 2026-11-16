// GPU time per pass of one benchmark page in two builds. The GPU check judges a frame's whole GPU
// time, so a page that gets slower names no part of the frame that pays. This split puts each pass's
// GPU time per frame in the two builds side by side, with the difference that the new build adds.
// The arithmetic is pure, so its test needs no browser.
import { type Build, measurementChangedLines } from './compare';
import { median } from './report';

/** The passes that one run timed, in the order that the frame runs them. */
export interface PassRun {
	build: Build;
	/** The round of the comparison that the run belongs to, from 1. */
	round: number;
	passes: readonly PassTime[];
}

/** One pass's GPU time per frame in one run. */
export interface PassTime {
	name: string;
	ms: number;
}

/** One pass's GPU time per frame in each build, and what the new build adds. */
export interface PassChange {
	name: string;
	/** The build's median over the runs that timed the pass, or null when none did. */
	baselineMs: number | null;
	newMs: number | null;
	/** The new build's median less the baseline's, or null unless both builds timed the pass. */
	deltaMs: number | null;
	/** The difference as a share of the baseline's median, or null where it has no time to divide. */
	change: number | null;
}

/** A row's place in the table: a pass that both builds timed ranks by the time the new one adds. */
const rank = ({ deltaMs }: PassChange) => (deltaMs === null ? Number.NEGATIVE_INFINITY : deltaMs);

/**
 * Each pass's GPU time per frame in each build, with the difference between them. A build's figure
 * is the median of the runs that timed the pass. A pass that only one build timed keeps its figure
 * for that build, and has no difference. Rows sort by the difference, largest increase first, and
 * the passes that only one build timed follow, by name.
 */
export function passChanges(runs: readonly PassRun[]): PassChange[] {
	const values = new Map<string, { baseline: number[]; new: number[] }>();
	for (const run of runs)
		for (const pass of run.passes) {
			const entry = values.get(pass.name) ?? { baseline: [], new: [] };
			entry[run.build].push(pass.ms);
			values.set(pass.name, entry);
		}
	const row = ([name, entry]: [string, { baseline: number[]; new: number[] }]): PassChange => {
		const baselineMs = entry.baseline.length > 0 ? median(entry.baseline) : null;
		const newMs = entry.new.length > 0 ? median(entry.new) : null;
		const deltaMs = baselineMs !== null && newMs !== null ? newMs - baselineMs : null;
		return {
			name,
			baselineMs,
			newMs,
			deltaMs,
			change:
				deltaMs !== null && baselineMs !== null && baselineMs > 0 ? deltaMs / baselineMs : null,
		};
	};
	return [...values].map(row).sort((a, b) => {
		const order = rank(b) - rank(a);
		if (order !== 0 && !Number.isNaN(order)) return order;
		return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
	});
}

/**
 * The lines that refuse a split, when the two builds measured different pages, or null when they
 * measured the same ones. The comparison judges no time then, so the split names no pass from it.
 */
export function splitRefusal(measurementChanges: readonly string[]): string[] | null {
	return measurementChanges.length > 0 ? measurementChangedLines(measurementChanges) : null;
}

/** A difference with two decimals and its sign, without a signed zero. */
const difference = (value: number) =>
	`${value > 0 ? '+' : ''}${(Math.abs(value) < 0.005 ? 0 : value).toFixed(2)}`;

/** A time with two decimals, or a dash where a build timed no run of the pass. */
const time = (value: number | null) => (value === null ? '-' : value.toFixed(2));

/** A change as a signed percentage, or `n/a` where it has no baseline to divide by. */
const percent = (change: number | null) =>
	change === null ? 'n/a' : `${change > 0 ? '+' : ''}${(change * 100).toFixed(1)}%`;

/** The table's columns and how each cell sits. */
const COLUMNS = [
	{ header: 'Pass', align: 'left' },
	{ header: 'Baseline ms', align: 'right' },
	{ header: 'New ms', align: 'right' },
	{ header: 'Difference', align: 'right' },
	{ header: 'Change', align: 'right' },
] as const;

/** The table of a page's passes, with a last line that names the largest increase. */
export function passTable(rows: readonly PassChange[]): string[] {
	if (rows.length === 0) return ['No pass has GPU time in either build.'];
	const cells = rows.map((row) => [
		row.name,
		time(row.baselineMs),
		time(row.newMs),
		row.deltaMs === null ? '-' : difference(row.deltaMs),
		percent(row.change),
	]);
	const widths = COLUMNS.map((column, k) =>
		Math.max(column.header.length, ...cells.map((row) => (row[k] ?? '').length)),
	);
	const line = (values: readonly string[]) =>
		values
			.map((value, k) =>
				COLUMNS[k]?.align === 'left'
					? value.padEnd(widths[k] ?? 0)
					: value.padStart(widths[k] ?? 0),
			)
			.join('  ');
	const both = rows.filter((row) => row.deltaMs !== null);
	const largest = both[0];
	let last: string;
	if (largest?.deltaMs == null) last = 'No pass has GPU time in both builds.';
	else if (largest.deltaMs > 0)
		last = `Largest increase: ${largest.name}, ${difference(largest.deltaMs)} ms (${percent(largest.change)}), from ${time(largest.baselineMs)} to ${time(largest.newMs)} ms.`;
	else if (largest.deltaMs === 0) last = 'No pass changed.';
	else {
		const most = both[both.length - 1] as PassChange;
		last = `No pass increased; ${most.name} fell most, ${difference(most.deltaMs as number)} ms (${percent(most.change)}).`;
	}
	const sided = rows.filter((row) => row.deltaMs === null);
	const oneSided =
		sided.length > 0
			? [
					'',
					`Timed in one build only: ${sided.map((row) => `${row.name} (${row.baselineMs === null ? 'new' : 'baseline'} ${time(row.baselineMs ?? row.newMs)} ms)`).join('; ')}.`,
				]
			: [];
	return [line(COLUMNS.map((column) => column.header)), ...cells.map(line), '', last, ...oneSided];
}
