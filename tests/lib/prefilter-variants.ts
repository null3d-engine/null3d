// Prototype L1's variants of the room's generator, as page switches, for the second sitting of the
// cloud phones. The first sitting (5 October 2026) ruled out the 11-11-10 format and drawing
// straight into the cube's faces, and showed that the filter's small levels cost as much a row as
// a whole level. So each GPU path runs the packed path sized by kind (the first sitting's, which
// here also makes one map in a single step first, as a room made at load would), then
// with the small filter levels whole, then that with fewer filter directions per texel. WebGL2
// also runs its two other paths that passed: half floats through a spare texture, and a context
// without float color targets. The device plan and the Mac's driver share them.

export interface PrefilterVariant {
	id: string;
	gpu: 'webgpu' | 'compat' | 'webgl2';
	switches: string[];
}

/** Filter directions per texel at level 1 and the most at any level, by variant name. */
const SCHEDULES = { s2048: '512,2048', s1024: '512,1024', s256: '256,1024' } as const;

export function prefilterVariants(): PrefilterVariant[] {
	const out: PrefilterVariant[] = [];
	const add = (gpu: PrefilterVariant['gpu'], name: string, switches: string[]) =>
		out.push({ id: `prefilter-${gpu}-${name}`, gpu, switches: [`gpu=${gpu}`, ...switches] });
	for (const gpu of ['webgpu', 'webgl2'] as const) {
		add(gpu, 'pack', ['write=pack', 'load=1']);
		add(gpu, 'pack-level', ['write=pack', 'sizing=level']);
		for (const [name, samples] of Object.entries(SCHEDULES))
			add(gpu, `pack-level-${name}`, ['write=pack', 'sizing=level', `samples=${samples}`]);
	}
	add('compat', 'pack-level', ['write=pack', 'sizing=level']);
	add('webgl2', 'spare-half-level', ['write=spare', 'format=rgba16float', 'sizing=level']);
	add('webgl2', 'nofloat-level', [
		'write=spare',
		'format=rgba16float',
		'nofloat=1',
		'sizing=level',
	]);
	return out;
}

/** One line of a page's figures. */
export function prefilterLine(r: Record<string, unknown>): string {
	if (!r.ok) return `FAILED: ${r.error}`;
	if (r.unsupported) return `${r.unsupported}`;
	type Map = {
		steps: number;
		totalMs: number;
		maxMs: number;
		cpuMaxMs: number;
		wallTotalMs: number;
		gpuTotalMs?: number;
	};
	type Time = { cpuMs?: number; wallMs?: number; gpuMs?: number };
	const maps = r.maps as Map[];
	const levels = r.levels as { mean: number; p99: number; ratio: number }[];
	const worst = levels.reduce(
		(w, l) => ({
			mean: Math.max(w.mean, l.mean),
			p99: Math.max(w.p99, l.p99),
			ratio: Math.max(w.ratio, Math.abs(l.ratio - 1)),
		}),
		{ mean: 0, p99: 0, ratio: 0 },
	);
	const mapText = maps
		.map((m) => `${m.steps} steps ${m.totalMs} ms, most ${m.maxMs} (CPU most ${m.cpuMaxMs})`)
		.join(' | ');
	const time = (t: Time) => `${t.gpuMs ?? '-'} GPU / ${t.wallMs} wall / ${t.cpuMs} CPU`;
	const warm = r.warm as Record<string, Time> | undefined;
	const warmText = warm
		? Object.entries(warm)
				.map(([k, t]) => `${k} ${t.cpuMs}/${t.wallMs}`)
				.join(', ')
		: 'none';
	return [
		`${r.format} ${r.write}${r.fallback ? ' (fallback)' : ''}, sized by ${r.measure}`,
		`maps: ${mapText}`,
		`whole ${time(r.whole as Time)}`,
		`prepare ${r.prepareMs} ms, empty step ${r.delayMs} ms, warm-up CPU/wall ${warmText}`,
		`match worst ${worst.mean} / ${worst.p99}, light ${worst.ratio.toFixed(4)}`,
		`pass ${JSON.stringify(r.pass)}`,
		...((r.errors as string[]).length ? [`errors ${JSON.stringify(r.errors)}`] : []),
	].join('; ');
}
