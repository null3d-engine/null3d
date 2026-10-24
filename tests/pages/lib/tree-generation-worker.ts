// Generates trees for the tree generation timing page, off the page's thread, as the vegetation
// add-on grows its species at start. It times each generation inside the worker, so the figures hold
// the work alone and none of the page's messaging.
import { ALL_SPECIES, generatePlant, type PlantAsset } from '@null3d/vegetation';

export type DetailName = 'low' | 'medium' | 'high' | 'ultra';

/** One run of the page: a species at a detail, generated once for each of several seeds. */
export interface GenerateRequest {
	batch: number;
	detail: DetailName;
	species: string;
	seeds: number;
}

/** What one run reported. */
export interface GenerateReply {
	batch: number;
	/** Milliseconds of each timed generation, in seed order. */
	timesMs: number[];
	/** The figures of the last generation, which every seed of a species shares. */
	triangles: number;
	branchTriangles: number;
	leafTriangles: number;
	vertices: number;
	leafCards: number;
	bytes: number;
	error?: string;
}

/** The detail levels that a preset builds: the coarse presets leave the finest that few use. */
const LEVELS: Record<DetailName, number> = { low: 2, medium: 2, high: 3, ultra: 3 };

/** The triangles of the parts whose names are wood, and of the rest. */
function splitTriangles(asset: PlantAsset): { wood: number; leaves: number; leafCards: number } {
	let wood = 0;
	let leaves = 0;
	let leafVertices = 0;
	for (const level of asset.levels)
		for (const part of level.parts) {
			const triangles = part.arrays.indices.length / 3;
			if (part.name === 'wood') wood += triangles;
			else {
				leaves += triangles;
				leafVertices += part.arrays.positions.length / 3;
			}
		}
	// A folded cluster card holds six vertices; the figure shows cards rather than triangles.
	return { wood, leaves, leafCards: Math.round(leafVertices / 6) };
}

self.onmessage = ({ data }: MessageEvent<GenerateRequest>) => {
	const species = ALL_SPECIES.find((candidate) => candidate.id === data.species);
	if (!species) {
		self.postMessage({ batch: data.batch, timesMs: [], error: `no species ${data.species}` });
		return;
	}
	const levels = LEVELS[data.detail];
	// A few warm-up generations first, so a cold interpreter does not set the timed figures.
	let asset = generatePlant(species, { seed: 1, levels });
	for (let warm = 0; warm < 3; warm++) generatePlant(species, { seed: 11 + warm * 7919, levels });
	const timesMs: number[] = [];
	for (let seed = 0; seed < data.seeds; seed++) {
		const started = performance.now();
		asset = generatePlant(species, { seed: 1 + seed * 7919, levels });
		timesMs.push(performance.now() - started);
	}
	const split = splitTriangles(asset);
	const reply: GenerateReply = {
		batch: data.batch,
		timesMs,
		triangles: asset.stats.triangles,
		branchTriangles: split.wood,
		leafTriangles: split.leaves,
		vertices: asset.stats.vertices,
		leafCards: split.leafCards,
		bytes: asset.stats.bytes,
	};
	self.postMessage(reply);
};
