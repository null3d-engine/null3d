// Generates trees for the tree generation timing page, off the page's thread, as the vegetation
// add-on grows its species at start. It times each generation inside the worker, so the figures hold
// the work alone and none of the page's messaging.
import {
	buildKitNow,
	growPlantNow,
	loadPlantCode,
	loadSpecies,
	type PlantAsset,
	type SpeciesId,
} from '@null3d/vegetation';

export type DetailName = 'low' | 'medium' | 'high' | 'ultra';

/** One run of the page: a species at a detail, generated once for each of several seeds. */
export interface GenerateRequest {
	batch: number;
	detail: DetailName;
	/** How far toward its sparse form each species grows, 0 or 1: a phone set asks for 1. */
	sparse?: number;
	species: SpeciesId;
	seeds: number;
}

/** What one run reported. */
export interface GenerateReply {
	batch: number;
	/** Milliseconds of each timed generation, in seed order. */
	timesMs: number[];
	/** The figures of the last generation, which every seed of a species shares. */
	triangles: number;
	bytes: number;
	error?: string;
}

/** How many generations run before the timed ones, so a cold interpreter sets no figure. */
const WARM_UPS = 4;

self.onmessage = async ({ data }: MessageEvent<GenerateRequest>) => {
	try {
		const module = await loadSpecies(data.species);
		// The kit's foliage builder loads per species kind, as a page's start loads it.
		await loadPlantCode(module.record);
		// The page draws nothing, so the kit takes placeholders rather than decoded texture files;
		// the work measured is the generation itself, as a scene's start pays for it.
		const kit = buildKitNow(module, { placeholders: 'missing', detail: data.detail });
		const grow = (seed: number): PlantAsset =>
			growPlantNow(kit, { seed, variant: 0, sparse: data.sparse ?? 0 });
		for (let warm = 0; warm < WARM_UPS; warm++) grow(11 + warm * 7919);
		const timesMs: number[] = [];
		let asset: PlantAsset | undefined;
		for (let seed = 0; seed < data.seeds; seed++) {
			const started = performance.now();
			asset = grow(1 + seed * 7919);
			timesMs.push(performance.now() - started);
		}
		self.postMessage({
			batch: data.batch,
			timesMs,
			triangles: (asset?.stats.triangles ?? [0, 0, 0]).reduce((sum, n) => sum + n, 0),
			bytes: asset?.stats.bytes ?? 0,
		} satisfies GenerateReply);
	} catch (error) {
		self.postMessage({
			batch: data.batch,
			timesMs: [],
			triangles: 0,
			bytes: 0,
			error: error instanceof Error ? error.message : String(error),
		} satisfies GenerateReply);
	}
};
