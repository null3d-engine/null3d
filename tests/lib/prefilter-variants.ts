// Prototype L1's variants of the room's generator, as page switches. For each GPU path: the engine's
// packed path, half floats through a spare texture and straight into each face, and the 11-11-10
// format through a spare texture, all sized by each kind of draw's first step. Then the packed path
// with the engine's fixed split, with the first step's rate alone, with that rate corrected by
// pipeline, and sized from step times without the GPU's timer. On WebGL2 also a context without
// float color targets. The device plan and the Mac's driver share them.

export interface PrefilterVariant {
	id: string;
	gpu: 'webgpu' | 'compat' | 'webgl2';
	switches: string[];
}

const GPUS = ['webgpu', 'compat', 'webgl2'] as const;

export function prefilterVariants(): PrefilterVariant[] {
	const out: PrefilterVariant[] = [];
	for (const gpu of GPUS) {
		const add = (name: string, switches: string[]) =>
			out.push({ id: `prefilter-${gpu}-${name}`, gpu, switches: [`gpu=${gpu}`, ...switches] });
		add('pack', ['write=pack']);
		add('spare-half', ['write=spare', 'format=rgba16float']);
		add('spare-r11', ['write=spare', 'format=rg11b10ufloat']);
		add('direct-half', ['write=direct', 'format=rgba16float']);
		if (gpu === 'webgl2') add('nofloat', ['write=spare', 'format=rgba16float', 'nofloat=1']);
		add('pack-fixed', ['write=pack', 'sizing=fixed']);
		add('pack-first', ['write=pack', 'sizing=first']);
		add('pack-adaptive', ['write=pack', 'sizing=adaptive']);
		add('pack-wall', ['write=pack', 'measure=wall']);
	}
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
