// Generates trees for the tree generation timing page, off the page's thread, as the vegetation
// add-on will generate its species at start. It times each generation inside the worker, so the
// figures hold the work alone and none of the page's messaging.
import { type DetailName, generateTree, SPECIES } from './tree-generator';

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

self.onmessage = ({ data }: MessageEvent<GenerateRequest>) => {
	const species = SPECIES.find((candidate) => candidate.name === data.species);
	if (!species) {
		self.postMessage({ batch: data.batch, timesMs: [], error: `no species ${data.species}` });
		return;
	}
	// A few warm-up generations first, so a cold interpreter does not set the timed figures.
	let figures = generateTree(species, data.detail, 1);
	for (let warm = 0; warm < 3; warm++)
		figures = generateTree(species, data.detail, 11 + warm * 7919);
	const timesMs: number[] = [];
	for (let seed = 0; seed < data.seeds; seed++) {
		const started = performance.now();
		figures = generateTree(species, data.detail, 1 + seed * 7919);
		timesMs.push(performance.now() - started);
	}
	const reply: GenerateReply = {
		batch: data.batch,
		timesMs,
		triangles: figures.triangles,
		branchTriangles: figures.branchTriangles,
		leafTriangles: figures.leafTriangles,
		vertices: figures.vertices,
		leafCards: figures.leafCards,
		bytes: figures.bytes,
	};
	self.postMessage(reply);
};
