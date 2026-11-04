// Pairs each valid visit with the next valid visit of the other build, in run order, and gives the
// prototype less the baseline for each pair: GPU time, frame interval, render worker time, and the
// GPU time of the passes after the copies. Only windows with the terrain shown count.
// bun tb-pairs.ts <results.jsonl>
import { readFileSync } from 'node:fs';

const median = (xs: number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
// biome-ignore lint/suspicious/noExplicitAny: scratch
const visits = readFileSync(process.argv[2] as string, 'utf8')
	.trim()
	.split('\n')
	.map((l) => JSON.parse(l))
	.filter((v: any) => !v.bad)
	.map((v: any) => {
		const ws = v.result.windows.filter((w: any) => w.label === 'shown');
		const passes = (w: any) =>
			(w.gpuPassMs ?? [])
				.filter((p: any) => p.name !== 'copies')
				.reduce((s: number, p: any) => s + p.ms.median, 0);
		return {
			proto: v.folder.includes('proto') || v.folder.includes('shared'),
			gpu: median(ws.map((w: any) => w.gpuMs.median)),
			interval: median(ws.map((w: any) => w.intervalMs.median)),
			render: median(ws.map((w: any) => w.render.median)),
			passes: median(ws.map(passes)),
			copies: median(
				ws.map((w: any) => w.gpuPassMs?.find((p: any) => p.name === 'copies')?.ms.median ?? 0),
			),
		};
	});
const diffs: Record<string, number[]> = {
	gpu: [],
	interval: [],
	render: [],
	passes: [],
	copies: [],
};
for (let i = 0; i + 1 < visits.length; i += 2) {
	const a = visits[i];
	const b = visits[i + 1];
	if (!a || !b || a.proto === b.proto) continue;
	const [proto, baseline] = a.proto ? [a, b] : [b, a];
	for (const key of Object.keys(diffs))
		diffs[key]?.push((proto as any)[key] - (baseline as any)[key]);
}
for (const [key, list] of Object.entries(diffs))
	console.log(
		`${key}: prototype less baseline, ${list.length} pairs: median ${median(list).toFixed(2)} ms, each ${list.map((x) => x.toFixed(2)).join(' ')}`,
	);
