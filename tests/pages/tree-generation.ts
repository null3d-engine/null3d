// Times the vegetation add-on's generation in a worker on the device, for the budgets that M3-V4's
// figures set: each species at each preset's detail, generated once for each of several seeds, with
// the median of the times. The page reports the triangles, the vertices and the bytes of each
// variant beside its time. It fails when the worker reported an error or gave no time.
// ?seeds= changes the seeds per run, and ?presets= picks presets, such as low,high.
import type { QualityPreset } from '@null3d/engine';
import { speciesIds } from '@null3d/vegetation';
import { progress, run } from './lib/result';
import type { GenerateReply, GenerateRequest } from './lib/tree-generation-worker';

const params = new URLSearchParams(location.search);

/** The seeds that each species is generated for at each preset. */
const SEEDS = Number(params.get('seeds') ?? 6);
/** The presets to measure, in this order. */
const PRESETS = (params.get('presets')?.split(',').filter(Boolean) ?? [
	'low',
	'medium',
	'high',
	'ultra',
]) as QualityPreset[];

/** The species the package ships. */
const SPECIES = speciesIds();

/** The median of a list of numbers, or 0 when it is empty. */
function median(values: readonly number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
		: (sorted[middle] as number);
}

run('tree-generation', async () => {
	const worker = new Worker(new URL('./lib/tree-generation-worker.ts', import.meta.url), {
		type: 'module',
		name: 'tree-generator',
	});
	const started = performance.now();
	let batch = 0;
	let pending:
		| { resolve: (reply: GenerateReply) => void; reject: (error: Error) => void }
		| undefined;
	worker.onmessage = ({ data }: MessageEvent<GenerateReply>) => pending?.resolve(data);
	worker.onerror = (event) => {
		const error =
			event instanceof ErrorEvent
				? `the tree worker failed: ${event.message}`
				: 'the tree worker or a file it imports did not load';
		pending?.reject(new Error(error));
	};
	/** Generates one species at one detail and resolves to what the worker reported. */
	const generate = (species: string, detail: QualityPreset): Promise<GenerateReply> => {
		const request: GenerateRequest = {
			batch: batch++,
			detail: detail as GenerateRequest['detail'],
			species: species as GenerateRequest['species'],
			seeds: SEEDS,
			// The page's `sparse=1` grows each species' light form, which is what a phone or a
			// tablet asks for; without it the set is measured at the record's own form.
			sparse: new URLSearchParams(location.search).has('sparse') ? 1 : 0,
		};
		return new Promise((resolve, reject) => {
			pending = { resolve, reject };
			worker.postMessage(request);
		});
	};

	const runs: {
		preset: QualityPreset;
		species: string;
		medianMs: number;
		worstMs: number;
		triangles: number;
		bytes: number;
	}[] = [];
	const totals: Record<string, { variants: number; ms: number; triangles: number; bytes: number }> =
		{};
	for (const preset of PRESETS) {
		const total = { variants: 0, ms: 0, triangles: 0, bytes: 0 };
		for (const species of SPECIES) {
			const reply = await generate(species, preset);
			if (reply.error) throw new Error(`the tree worker failed: ${reply.error}`);
			if (reply.timesMs.length === 0) throw new Error('the tree worker gave no time');
			const times = reply.timesMs;
			runs.push({
				preset,
				species,
				medianMs: median(times),
				worstMs: Math.max(...times),
				triangles: reply.triangles,
				bytes: reply.bytes,
			});
			// A variant set of one of each species: the figures add up as a scene's start would pay.
			total.variants += times.length;
			total.ms += times.reduce((sum, time) => sum + time, 0);
			total.triangles += reply.triangles * times.length;
			total.bytes += reply.bytes * times.length;
		}
		totals[preset] = total;
		progress(`${preset}: ${total.variants} variants in ${total.ms.toFixed(1)} ms`);
	}
	const totalMs = performance.now() - started;
	worker.terminate();
	return {
		seeds: SEEDS,
		totalMs,
		runs,
		totals,
		species: SPECIES,
	};
});
