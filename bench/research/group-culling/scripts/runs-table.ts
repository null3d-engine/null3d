// Prints the browser runs of a results file as a table: the page's switches, the median triangles
// and draws, the GPU time per pass, the machine's load, and whether the run was valid.
import { readFileSync } from 'node:fs';

/** One pass's timings, and one browser run, as the results file writes them. */
interface Pass {
	readonly name?: string;
	readonly ms?: { readonly median?: number };
}
interface Run {
	readonly gpuPassMs?: readonly Pass[];
	readonly address?: string;
	[key: string]: unknown;
}

for (const path of process.argv.slice(2)) {
	const runs = JSON.parse(readFileSync(path, 'utf8')) as Run[];
	console.log(`\n${path}`);
	console.log('| Page | Triangles (M) | Draws | GPU ms | Passes (ms) | Load | Valid |');
	console.log('| --- | --- | --- | --- | --- | --- | --- |');
	for (const r of runs) {
		const passes = (r.gpuPassMs ?? [])
			.map((p) => `${p.name} ${p.ms?.median?.toFixed(2)}`)
			.join(', ');
		const page = r.address
			.replace(/^[a-z0-9]+\.html\?/, '')
			.replace(/(view=walk|models=[^&]*|direct=off|pump=1|warmup=\d+|seconds=\d+)&?/g, '');
		console.log(
			`| ${r.address.split('.html')[0]} ${page || '(all)'} | ${((r.triangles?.median ?? 0) / 1e6).toFixed(3)} | ${Math.round(r.drawCalls?.median ?? 0)} | ${r.gpuMs?.median?.toFixed(2) ?? '-'} | ${passes} | ${r.load?.before?.toFixed(1)} | ${r.invalid ? `no: ${String(r.problems?.[0] ?? r.error).slice(0, 80)}` : 'yes'} |`,
		);
	}
}
