// Summarises a runner's results: per folder and window label, the median over windows of each
// window's median GPU time, frame interval, render worker time, draws and triangles, and the GPU time
// per pass. For toggled pages it also gives the paired difference of each shown window with the
// hidden windows beside it. bun tb-summary.ts <results.jsonl>
import { readFileSync } from 'node:fs';

const lines = readFileSync(process.argv[2] as string, 'utf8')
	.trim()
	.split('\n');
// biome-ignore lint/suspicious/noExplicitAny: scratch
const visits = lines.map((l) => JSON.parse(l)).filter((v: any) => !v.bad);
const median = (xs: number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
const groups = new Map<string, any[]>();
const blocks = new Map<string, number[]>();
const pairs = new Map<string, number[][]>();
for (const v of visits) {
	const folder = v.folder.replace('target/', '');
	(blocks.get(folder) ?? blocks.set(folder, []).get(folder))?.push(v.result.blocks);
	const ws = v.result.windows;
	for (const w of ws) {
		const key = `${folder} ${w.label}`;
		(groups.get(key) ?? groups.set(key, []).get(key))?.push(w);
	}
	// Each hidden window paired with the shown windows next to it.
	for (let i = 0; i < ws.length; i++) {
		if (ws[i].label !== 'hidden') continue;
		const near = [ws[i - 1], ws[i + 1]].filter((x) => x && x.label === 'shown');
		if (!near.length) continue;
		const shown = median(near.map((x: any) => x.gpuMs.median));
		const interval = median(near.map((x: any) => x.intervalMs.median));
		const list = pairs.get(folder) ?? pairs.set(folder, []).get(folder);
		list?.push([shown - ws[i].gpuMs.median, interval - ws[i].intervalMs.median]);
	}
}
for (const [key, ws] of groups) {
	const passes = new Map<string, number[]>();
	for (const w of ws)
		for (const p of w.gpuPassMs ?? [])
			(passes.get(p.name) ?? passes.set(p.name, []).get(p.name))?.push(p.ms.median);
	console.log(
		`${key}: n=${ws.length} gpu ${median(ws.map((w) => w.gpuMs.median)).toFixed(2)} ms (spread ${Math.min(...ws.map((w) => w.gpuMs.median)).toFixed(2)}-${Math.max(...ws.map((w) => w.gpuMs.median)).toFixed(2)}), interval ${median(ws.map((w) => w.intervalMs.median)).toFixed(2)} ms, render ${median(ws.map((w) => w.render?.median ?? 0)).toFixed(2)} ms, sketch ${median(ws.map((w) => w.sketch?.median ?? 0)).toFixed(2)} ms, cpu ${median(ws.map((w) => w.cpuMs.median)).toFixed(2)} ms, draws ${median(ws.map((w) => w.drawCalls.median)).toFixed(0)}, triangles ${(median(ws.map((w) => w.triangles.median)) / 1e6).toFixed(3)} M`,
	);
	console.log(
		`   passes: ${[...passes].map(([n, v]) => `${n} ${median(v).toFixed(3)}`).join(', ')}`,
	);
}
for (const [folder, list] of pairs)
	console.log(
		`${folder} shown less hidden, paired: n=${list.length} gpu ${median(list.map((p) => p[0] as number)).toFixed(2)} ms (spread ${Math.min(...list.map((p) => p[0] as number)).toFixed(2)} to ${Math.max(...list.map((p) => p[0] as number)).toFixed(2)}), interval ${median(list.map((p) => p[1] as number)).toFixed(2)} ms`,
	);
for (const [folder, b] of blocks) console.log(`${folder} blocks ${b.join(',')}`);
console.log(`visits ${lines.length}, invalid ${lines.length - visits.length}`);
