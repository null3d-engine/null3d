// Prints the timing of GPU occlusion culling at Medium as a table: for each page and mode (off, held
// on, check deciding), the median over the rounds of each run's median GPU time, the spread from the
// fastest to the slowest round, the main pass, the occluders' pass and the culling passes, the
// triangles, the objects hidden, the draw path, the load and the invalid runs. The last column
// compares each mode's median GPU time with the page's run without culling. GPU time is the measure;
// the frame interval, which the machine's other work stretches, is a second figure only.
// A run whose one-minute load reached 8 or more, before or after its page, is left out when a file
// of repeated runs (`<name>-repeat.json`, from `medium-occlusion.ts --repeat`) holds the same page.
// `bun occlusion-table.ts <results.json>...`
import { existsSync, readFileSync } from 'node:fs';

type Run = Record<string, unknown>;
const median = (values: number[]) => {
	const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
	if (sorted.length === 0) return Number.NaN;
	const mid = sorted.length >> 1;
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const pass = (r: Run, name: string) =>
	(r.gpuPassMs ?? []).find((p: Run) => p.name === name)?.ms?.median ?? Number.NaN;
/** The shadow passes' GPU time, summed over the cascades that report one. */
const shadowPasses = (r: Run) => {
	const list = (r.gpuPassMs ?? []).filter((p: Run) => String(p.name).startsWith('shadow'));
	return list.length === 0
		? Number.NaN
		: list.reduce((s: number, p: Run) => s + (p.ms?.median ?? 0), 0);
};
/** The highest one-minute load around a run's page. */
export const loadOf = (r: Run) => Math.max(r.load?.before ?? 0, r.load?.after ?? 0);
const f = (v: number, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : '-');

for (const path of process.argv.slice(2)) {
	let runs = JSON.parse(readFileSync(path, 'utf8')) as Run[];
	const repeatPath = path.replace(/\.json$/, '-repeat.json');
	if (existsSync(repeatPath)) {
		const repeats = JSON.parse(readFileSync(repeatPath, 'utf8')) as Run[];
		const repeated = new Set(repeats.map((r) => r.address));
		runs = [...runs.filter((r) => !(repeated.has(r.address) && loadOf(r) >= 8)), ...repeats];
	}
	const pages = new Map<string, Map<string, Run[]>>();
	for (const r of runs) {
		const address: string = r.address;
		const mode = address.includes('occlusion-check=off')
			? 'forced'
			: address.includes('occlusion=on')
				? 'check'
				: 'off';
		const base = address
			.replace(/&?occlusion(-check)?=(on|off)/g, '')
			.replace(
				/(models=[^&]*|direct=off|pump=1|warmup=\d+|warm=\d+|seconds=\d+|preset=medium|still-camera=off)&?/g,
				'',
			)
			.replace(/[?&]$/, '');
		const modes = pages.get(base) ?? new Map<string, Run[]>();
		pages.set(base, modes);
		const list = modes.get(mode) ?? [];
		list.push(r);
		modes.set(mode, list);
	}
	console.log(`\n${path}\n`);
	console.log(
		'| Page | Mode | Valid rounds | GPU ms, median | Spread (min-max) | Main pass | Shadows | Occluders | Compute | Triangles (M) | Hidden objects | Path | Load | Interval ms | vs off |',
	);
	console.log(
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
	);
	for (const [base, modes] of pages) {
		const offMedian = median(
			(modes.get('off') ?? []).filter((r) => !r.invalid).map((r) => r.gpuMs?.median),
		);
		for (const mode of ['off', 'forced', 'check']) {
			const all = modes.get(mode) ?? [];
			const valid = all.filter((r) => !r.invalid);
			const gpu = valid.map((r) => r.gpuMs?.median as number);
			const m = median(gpu);
			const loads = valid.map(loadOf);
			console.log(
				`| ${base} | ${mode} | ${valid.length} of ${all.length} | ${f(m)} | ${f(Math.min(...gpu))}-${f(Math.max(...gpu))} | ${f(median(valid.map((r) => pass(r, 'opaque'))))} | ${f(median(valid.map(shadowPasses)))} | ${f(median(valid.map((r) => pass(r, 'occluders'))))} | ${f(median(valid.map((r) => pass(r, 'compute'))))} | ${f(median(valid.map((r) => r.triangles?.median / 1e6)), 3)} | ${f(median(valid.map((r) => r.occludedEntries?.median)), 0)} | ${[...new Set(valid.map((r) => r.drawPath ?? (r.directDraws ? 'direct' : 'indirect')))].join(',')} | ${f(Math.min(...loads), 1)}-${f(Math.max(...loads), 1)} | ${f(median(valid.map((r) => r.intervalMs?.median)))} | ${mode === 'off' ? '' : `${f((100 * (m - offMedian)) / offMedian, 0)}%`} |`,
			);
		}
	}
	const problems = runs.flatMap((r) => (r.problems ?? []) as string[]);
	const dropped = problems.filter((p) => p.includes('dropped'));
	console.log(
		`\n${runs.filter((r) => r.invalid).length} invalid runs; ${dropped.length} problems name dropped copies`,
	);
}
