// Gathers the benchmark scenes' runs of `medium-occlusion.ts --part bench` into one file in the shape
// of this folder's runner's results, so `occlusion-table.ts` prints them as it prints the desert's:
// each run's scene with its mode's switches as the address, its GPU time and passes, triangles,
// hidden objects, draw path and load. `bun bench-records.ts` writes results/medium-occlusion-bench.json,
// and the runs of folders named `repeat-<mode>-...`, made again for pages whose load reached 8, into
// results/medium-occlusion-bench-repeat.json, which the table reads in their place.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const folder = join(import.meta.dirname, '../results/medium-occlusion-bench');
const SWITCHES: Record<string, string> = {
	off: 'occlusion=off',
	forced: 'occlusion=on&occlusion-check=off',
	check: 'occlusion=on',
};
const runs: object[] = [];
const repeats: object[] = [];
for (const run of readdirSync(folder).sort()) {
	const dir = join(folder, run);
	if (!statSync(dir).isDirectory()) continue;
	const mode = run.split('-')[1] as string;
	for (const file of readdirSync(dir).filter((f) => /^s\d.*\.json$/.test(f))) {
		// biome-ignore lint/suspicious/noExplicitAny: a benchmark record read as JSON
		const r = JSON.parse(readFileSync(join(dir, file), 'utf8')) as any;
		const s = r.stats ?? {};
		(run.startsWith('repeat') ? repeats : runs).push({
			address: `${r.scene ?? file.split('-')[0]}?${SWITCHES[mode]}`,
			round: run.split('-')[0],
			invalid: r.ok === false || !s.gpuMs,
			gpuMs: s.gpuMs,
			gpuPassMs: s.gpuPassMs,
			triangles: s.triangles,
			occludedEntries: s.occludedEntries,
			visibleEntries: s.visibleEntries,
			intervalMs: s.intervalMs,
			drawPath: r.drawPath,
			load: r.machineLoad,
			problems: r.problems ?? [],
		});
	}
}
const out = join(import.meta.dirname, '../results/medium-occlusion-bench.json');
writeFileSync(out, JSON.stringify(runs, null, '\t'));
writeFileSync(out.replace(/\.json$/, '-repeat.json'), JSON.stringify(repeats, null, '\t'));
console.log(`${runs.length} runs and ${repeats.length} repeated runs into ${out}`);
