// Prints each visit of a device's terrain-batching run: the path and preset, the blocks, and the
// medians over its windows of the GPU time, frame interval, render and sketch worker times, draws
// and triangles, with the worst frame interval. bun tb-device.ts <run folder>/<runner>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] as string;
const median = (xs: number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
const files = readdirSync(dir)
	.filter((f) => f.startsWith('island-terrain-'))
	.sort((a, b) => Number(a.match(/(\d+)\.json$/)?.[1]) - Number(b.match(/(\d+)\.json$/)?.[1]));
for (const file of files) {
	const raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
	const r = raw.result ?? raw;
	const ws = r.windows ?? [];
	const f = (get: (w: any) => number | undefined) => {
		const xs = ws.map(get).filter((x: number | undefined) => typeof x === 'number');
		return xs.length ? median(xs).toFixed(2) : 'none';
	};
	console.log(
		`${file.replace('.json', '')}: ${r.tier} ${r.mode?.preset} ${r.mode?.renderThread} blocks ${r.blocks} | gpu ${f((w) => w.gpuMs?.median)} ms, interval ${f((w) => w.intervalMs?.median)} ms (worst ${Math.max(...ws.map((w: any) => w.intervalMs?.max ?? 0)).toFixed(1)}), render ${f((w) => w.render?.median)} ms, sketch ${f((w) => w.sketch?.median)} ms, cpu ${f((w) => w.cpuMs?.median)} ms, draws ${f((w) => w.drawCalls?.median)}, triangles ${f((w) => (w.triangles?.median ?? 0) / 1e6)} M${raw.heat ? ` | heat ${JSON.stringify(raw.heat).slice(0, 120)}` : ''}`,
	);
}
