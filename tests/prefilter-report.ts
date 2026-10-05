// Prototype L1's tables, from the Mac driver's results file (tests/prefilter-cost.ts) or from a
// device run's folder (target/runs/<run>), with one table per browser or device:
//   bun tests/prefilter-report.ts target/prefilter/mac-chrome-<time>.json
//   bun tests/prefilter-report.ts target/runs/<run>
// Times are medians over the rounds, in ms. "First map" is the map made right after the pipelines
// were built; "later maps" are the maps after it. A step's time is the GPU's own where the device
// times the GPU, else the step's time less an empty step's. "Most" is the longest step of any map,
// by that time or by the time the call itself took on the CPU, whichever is longer.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

type Result = Record<string, unknown>;
interface MapSummary {
	steps: number;
	totalMs: number;
	maxMs: number;
	cpuMaxMs: number;
	gpuTotalMs?: number;
}

const source = process.argv[2];
if (!source || !existsSync(source)) throw new Error('name a results file or a run folder');

/** Results by device, then by variant id, a list of rounds each. */
const devices = new Map<string, Map<string, Result[]>>();
const add = (device: string, id: string, result: Result) => {
	const variants = devices.get(device) ?? new Map<string, Result[]>();
	variants.set(id, [...(variants.get(id) ?? []), result]);
	devices.set(device, variants);
};
if (statSync(source).isDirectory()) {
	for (const runner of readdirSync(source)) {
		const dir = join(source, runner);
		if (!statSync(dir).isDirectory()) continue;
		for (const file of readdirSync(dir).filter((f) => /^prefilter-.*\.json$/.test(f)))
			add(
				runner,
				file.replace(/(-round-\d+)?\.json$/, ''),
				JSON.parse(readFileSync(join(dir, file), 'utf8')),
			);
	}
} else {
	const all = JSON.parse(readFileSync(source, 'utf8')) as Record<string, Result[]>;
	for (const [id, rounds] of Object.entries(all)) for (const r of rounds) add('Mac Chrome', id, r);
}

const median = (xs: number[]) => {
	const sorted = xs.filter(Number.isFinite).sort((a, b) => a - b);
	return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] as number) : Number.NaN;
};
const text = (x: number, digits = 1) => (Number.isFinite(x) ? x.toFixed(digits) : '-');

for (const [device, variants] of devices) {
	const any = [...variants.values()].flat().find((r) => r.ok && !r.unsupported);
	console.log(`\n### ${device}${any ? `: ${any.adapter ?? any.renderer ?? ''}` : ''}\n`);
	console.log(
		'| Variant | Format, write | Matches (worst level mean / p99, light) | First map: steps, total, most | Later maps: steps, total, most | Whole map in one step: at load, after the maps | Prepare | Notes |',
	);
	console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
	for (const [id, rounds] of variants) {
		const ok = rounds.filter((r) => r.ok && !r.unsupported);
		const name = id.replace(/^prefilter-/, '');
		if (ok.length === 0) {
			const r = rounds[0] as Result;
			console.log(`| ${name} | | | | | | | ${r.unsupported ?? `failed: ${r.error}`} |`);
			continue;
		}
		const first = ok[0] as Result;
		const levels = ok.flatMap(
			(r) => r.levels as { mean: number; p99: number; ratio: number; ok: boolean }[],
		);
		const matched = ok.every((r) => (r.levels as { ok: boolean }[]).every((l) => l.ok));
		const worst = `${Math.max(...levels.map((l) => l.mean)).toFixed(3)} / ${Math.max(...levels.map((l) => l.p99)).toFixed(2)}, ${Math.max(...levels.map((l) => Math.abs(l.ratio - 1))).toFixed(4)}`;
		const maps = (r: Result) => r.maps as MapSummary[];
		const cold = ok.map((r) => maps(r)[0] as MapSummary);
		const warm = ok.flatMap((r) => maps(r).slice(1));
		const most = (ms: MapSummary[]) => Math.max(...ms.map((m) => Math.max(m.maxMs, m.cpuMaxMs)));
		const mapText = (ms: MapSummary[]) =>
			`${text(median(ms.map((m) => m.steps)), 0)}, ${text(median(ms.map((m) => m.totalMs)))}, ${text(most(ms))}`;
		// A map in one step: the GPU's time where the device has a timer, else the time from the call
		// until the GPU had finished it.
		type Time = { gpuMs?: number; wallMs: number };
		const oneStep = (t: Time | undefined) => (t ? (t.gpuMs ?? t.wallMs) : Number.NaN);
		const load = median(ok.map((r) => oneStep(r.load as Time | undefined)));
		const whole = median(ok.map((r) => oneStep(r.whole as Time)));
		const errors = [...new Set(ok.flatMap((r) => r.errors as string[]))];
		const schedule = first.samples as { first: number; most: number } | undefined;
		const notes = [
			...(schedule && (schedule.first !== 512 || schedule.most !== 8192)
				? [`filter directions ${schedule.first} to ${schedule.most}`]
				: []),
			...(first.fallback ? ['fell back to packing'] : []),
			...(first.measure === 'gpu' && first.timestamps === false ? ['no GPU timer'] : []),
			...(first.measure === 'gpu' && first.timer === false ? ['no GPU timer'] : []),
			...errors.map((e) => `error: ${e}`),
			...(rounds.length > ok.length ? [`${rounds.length - ok.length} rounds failed`] : []),
		];
		console.log(
			`| ${name} | ${first.format}, ${first.write}, ${first.sizing} | ${matched ? 'yes' : 'NO'}: ${worst} | ${mapText(cold)} | ${mapText(warm)} | ${text(load)}, ${text(whole)} | ${text(median(ok.map((r) => r.prepareMs as number)))} | ${notes.join('; ')} |`,
		);
	}
	// Each draw's cost, from the engine's packed path, against its modelled work.
	const pack = [...variants.entries()].find(([id]) => /-(webgpu|webgl2)-pack$/.test(id))?.[1];
	const draws = pack?.find((r) => r.ok && r.draws)?.draws as
		| { pipeline: string; level: number; ms: number; unitsPerUs: number }[]
		| undefined;
	if (draws)
		console.log(
			`\nEach draw alone (${pack?.[0]?.gpu}, ms and modelled units per microsecond): ${draws
				.filter((d) => d.pipeline !== 'half')
				.map((d) => `${d.pipeline} ${d.level}: ${d.ms} (${d.unitsPerUs})`)
				.join(', ')}; the chain's halvings ${draws
				.filter((d) => d.pipeline === 'half')
				.reduce((s, d) => s + d.ms, 0)
				.toFixed(2)} ms in all.`,
		);
}
