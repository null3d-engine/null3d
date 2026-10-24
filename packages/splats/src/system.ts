// The splats of a scene, drawn through the engine's feature draw: one instance batch whose rows are
// the splats that draw, a surface function that turns a row into a soft Gaussian card, and a
// selection that a job worker makes each time the camera or the budget changes.
//
// The cloud is cut into chunks. Each chunk keeps its splats in importance order, so a prefix of the
// list is a coarser level of it. A job worker chooses a prefix for each chunk by its distance and by
// the preset's budget, and the sketch packs the chosen splats into the batch. The engine then culls
// and sorts the rows back to front in the transparent pass, which is what lets the splats mix with
// each other and with the scene's opaque meshes.
import {
	checkAddonVersion,
	declareAddonNamespace,
	defineFeature,
	type FeatureHandle,
	FeatureHost,
	type InstanceBatch,
	type Material,
	type SketchContext,
	type Vec3Like,
} from '@null3d/engine';
import { chunkSplats, type SplatChunk } from './chunks';
import { checkSplats, type SplatData, splatsError } from './format';
// The module registers the glTF extension as the add-on loads.
import './gltf';
import { SplatSelector } from './select';
import splatShader from './splats.wgsl';
import { VERSION } from './version';

checkAddonVersion('@null3d/splats', VERSION);

/** The add-on's names, claimed once as the sketch's module loads. */
const NAMESPACE = declareAddonNamespace({ name: 'splats', errorCodes: [2100, 2199] });

/** The splats that draw at full quality on each preset, from Low to Ultra. */
const PRESET_SPLATS = [100_000, 250_000, 500_000, 800_000] as const;

/** The WebGL2 presets, which sort and upload the same splats with fewer threads in reach. */
const WEBGL2_SPLATS = [50_000, 120_000, 250_000, 400_000] as const;

/** The bytes of one batch row: its place, rotation, scales and color. */
const ROW_BYTES = (3 + 4 + 3 + 4) * 4;

/** One quad, which every row of the batch repeats. */
const QUAD = {
	positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
	normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
	uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
	indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
};

/**
 * Options of `createSplats`. Give the cloud itself, or the address of an SPZ file.
 *
 * @category api/splats
 */
export interface SplatsOptions {
	/** The cloud to draw, decoded already, such as `decodeSpz` gives it. */
	readonly data?: SplatData;
	/** The address of an SPZ file to download and draw. */
	readonly url?: string | URL;
	/**
	 * The point that the splats' positions are relative to, which keeps them precise far from the
	 * world's origin. The default is (0, 0, 0).
	 */
	readonly origin?: Vec3Like;
	/**
	 * How far in front of an opaque mesh a splat fades in, in meters. The default is 0.25, which
	 * softens the edge where a splat meets a wall or the ground. 0 keeps a hard edge.
	 */
	readonly softness?: number;
	/** How many standard deviations of a splat its card covers. The default is 3.3. */
	readonly extent?: number;
	/**
	 * The most splats that the batch holds, which caps every preset's budget. The default is the
	 * preset's own count on this device, or the cloud's own count where that is smaller, so a
	 * cloud allocates what the device may draw.
	 */
	readonly capacity?: number;
}

/**
 * The draw that a cloud fills: the instance batch whose rows are the splats that draw. Write the
 * rows, mark them, and set the number that draw. The draw's material is the add-on's shader.
 *
 * @category api/splats
 */
export interface SplatsDraw {
	/** The batch whose rows place the splats. Write its arrays, then mark the rows that draw. */
	readonly batch: InstanceBatch;
	/** The draw's material, which the cloud makes. */
	readonly material: Material;
	/** Draws the first `count` rows, and hides the rest. */
	setCount(count: number): void;
	/** Frees the rows, the material and the shape. */
	destroy(): void;
}

/**
 * A cloud of Gaussian splats that a scene draws, with its levels and its budget.
 *
 * @category api/splats
 */
export interface Splats {
	/** The add-on feature, whose settings, budget and figures the engine resolves. */
	readonly feature: FeatureHandle;
	/** The draw: its batch's rows are the splats that draw. */
	readonly draw: SplatsDraw;
	/** The number of splats that the cloud holds. */
	readonly total: number;
	/** The number of splats that draw now. */
	readonly drawn: number;
	/** The number of chunks that the cut made. */
	readonly chunks: number;
	/** Resolves when every chunk is ready. The cloud draws the chunks that are ready before it. */
	readonly ready: Promise<void>;
	/**
	 * Resolves once the splats that draw are chosen and packed, which a test or a still picture
	 * waits for. Call it after `update`.
	 */
	settle(): Promise<void>;
	/** Caps the splats that draw below the preset's budget, as a device or a test needs. */
	setBudget(count: number): void;
	/** Chooses the splats that draw from a camera's position. Call it once in each frame. */
	update(eye: Vec3Like): void;
	/** Stops the draw and frees its memory. The glTF reader stays registered. */
	destroy(): void;
}

/**
 * Draws a cloud of Gaussian splats in a sketch. The cloud comes from an SPZ file, or from the data
 * of another reader. A glTF model that carries `KHR_gaussian_splatting` loads through
 * `assets.loadGltf`, because the add-on's module registers the reader as it loads. A cloud draws
 * with detail levels, a budget that follows the quality preset and the GPU path, and a soft mix
 * with the scene's opaque meshes.
 *
 * Call `splats.update(eye)` once in each frame, with the camera's position from `getPosition`, and
 * free the cloud with `splats.destroy()`.
 *
 * @category api/splats
 */
export async function createSplats(ctx: SketchContext, options: SplatsOptions): Promise<Splats> {
	if (options.data === undefined && options.url === undefined)
		throw splatsError(2110, 'give createSplats() the cloud as data, or the url of an SPZ file.');
	const data = checkSplats(
		options.data ?? (await decodeFile(options.url as string | URL)),
		'the splat cloud',
	);
	// The rows that the batch holds, which the preset and the GPU path decide once the host has
	// resolved them: a phone then pays for the splats that it may draw, not for the Ultra count.
	let capacity = 1;
	const description = defineFeature({
		name: 'splats',
		frame: 'transparent',
		kind: 'draw',
		views: ['main'],
		settings: {
			drawn: {
				presets: PRESET_SPLATS,
				webgl2: WEBGL2_SPLATS,
				values: { min: 0, max: 8_000_000, whole: true },
				governor: 'scale',
			},
		},
		budget: { presets: [2, 3, 4, 6], min: 0.2 },
		memory: () => capacity * ROW_BYTES + QUAD.positions.byteLength * 4,
	});
	const host = new FeatureHost({
		quality: ctx.quality,
		tier: ctx.engine.capabilities.tier,
		page: ctx.page,
		namespace: NAMESPACE,
	});
	const feature = host.add(description);
	capacity = Math.max(
		1,
		Math.min(
			Math.floor(options.capacity ?? (feature.settings.drawn as number)),
			Math.max(data.count, 1),
		),
	);
	const draw = await ctx.scene.addFeatureInstances(description, {
		shader: splatShader,
		vertices: QUAD,
		instances: capacity,
		rows: { colors: true },
		origin: options.origin as [number, number, number] | undefined,
		uniforms: {
			extent: options.extent ?? 3.3,
			blur: 0,
			softness: options.softness ?? 0.25,
			cutoff: 1 / 255,
		},
		alphaMode: 'blend',
		depthWrite: false,
		doubleSided: true,
		sceneInputs: ['sceneDepth'],
	});
	// A splat's card reaches past its center, so its rows need a sphere that holds it.
	draw.batch.setBoundingRadius(4);
	// A new batch draws every row, whose colors and places are still zero: draw none until the
	// first selection fills them.
	draw.setCount(0);

	const chunks: SplatChunk[] = [];
	let version = 0;
	let selector: SplatSelector | undefined;
	let selectorChunks = 0;
	// The counts and the total of the selection that fills the draw, which keeps its own copy so a
	// later selection in the shared buffer can differ from it without allocating.
	let lastCounts = new Float32Array(0);
	let lastTotal = -1;
	// The camera's position at the last ask, in a typed array, so a frame's ask allocates nothing.
	const eye = new Float64Array(3);
	const lastEye = new Float64Array(3);
	let lastBudget = -1;
	let dirty = true;
	let inFlight = false;
	let stop = false;
	let override: number | undefined;
	let drawn = 0;
	let reported: Error | undefined;

	const ready = chunkSplats(data, {
		yieldTo: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
		onChunk: (chunk) => {
			chunks.push(chunk);
			version++;
			dirty = true;
		},
	}).then(() => undefined);

	/** The callers that wait for a settled selection, which the next one answers. */
	const waiters: (() => void)[] = [];
	const settleWaiters = (): void => {
		if (inFlight || dirty || waiters.length === 0) return;
		for (const resolve of waiters.splice(0)) resolve();
	};

	const budgetNow = (): number =>
		Math.min(capacity, Math.floor(override ?? (feature.settings.drawn as number)));

	/** The prefix views of each chunk, which change only when its chosen count does. */
	const prefixes: (
		| {
				count: number;
				positions: Float32Array;
				rotations: Float32Array;
				scales: Float32Array;
				colors: Float32Array;
		  }
		| undefined
	)[] = [];

	const pack = (counts: Float32Array): void => {
		const { batch } = draw;
		const { positions, rotations, scales, colors } = batch;
		if (!colors)
			throw splatsError(2111, 'the splats batch has no row colors, which its draw needs.');
		let at = 0;
		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i] as SplatChunk;
			// A chunk that arrived after the worker chose takes its turn in the next selection.
			const count = Math.min(counts[i] as number, chunk.count);
			if (!(count > 0)) {
				prefixes[i] = undefined;
				continue;
			}
			let prefix = prefixes[i];
			if (!prefix || prefix.count !== count) {
				prefix = {
					count,
					positions: chunk.positions.subarray(0, count * 3),
					rotations: chunk.rotations.subarray(0, count * 4),
					scales: chunk.scales.subarray(0, count * 3),
					colors: chunk.colors.subarray(0, count * 4),
				};
				prefixes[i] = prefix;
			}
			positions.set(prefix.positions, at * 3);
			rotations.set(prefix.rotations, at * 4);
			scales.set(prefix.scales, at * 3);
			colors.set(prefix.colors, at * 4);
			at += count;
		}
		if (at > 0) batch.markDirty(0, at);
		batch.setActiveCount(at);
		drawn = at;
	};

	/** The ask that waits for its answer, and the chunk version that it saw. */
	let asking: SplatSelector | undefined;
	let askedVersion = 0;

	/** Takes the answer: fills the draw again when the counts or the total changed. */
	const selected = (_output: boolean): void => {
		inFlight = false;
		const asked = asking;
		asking = undefined;
		if (stop || !asked) return;
		const total = asked.total;
		const changed = total !== lastTotal || differs(asked.counts, lastCounts);
		if (changed) {
			lastTotal = total;
			// A chunk that arrived while the worker chose changed the list's length.
			if (lastCounts.length !== asked.counts.length)
				lastCounts = new Float32Array(asked.counts.length);
			lastCounts.set(asked.counts);
			pack(asked.counts);
		}
		// A chunk that arrived while the worker chose draws in the next selection.
		dirty = version !== askedVersion;
		settleWaiters();
		// A caller that waits for a settled set keeps the selections coming.
		if (waiters.length > 0) choose();
	};

	/** Gives up on the selection, and reports the first failure. */
	const failed = (error: unknown): void => {
		inFlight = false;
		dirty = false;
		asking = undefined;
		if (reported === undefined) {
			reported = error instanceof Error ? error : new Error(String(error));
			console.error(`splats: the selection failed. ${reported.message}`);
		}
		settleWaiters();
	};

	const choose = (): void => {
		if (stop || !selector || inFlight) return;
		const budget = budgetNow();
		const moved =
			Math.abs((eye[0] as number) - (lastEye[0] as number)) +
				Math.abs((eye[1] as number) - (lastEye[1] as number)) +
				Math.abs((eye[2] as number) - (lastEye[2] as number)) >
			0.25;
		if (!dirty && !moved && budget === lastBudget) return;
		inFlight = true;
		askedVersion = version;
		asking = selector;
		lastEye[0] = eye[0] as number;
		lastEye[1] = eye[1] as number;
		lastEye[2] = eye[2] as number;
		lastBudget = budget;
		selector.select(eye, budget).then(selected, failed);
	};

	return {
		feature,
		draw: draw as SplatsDraw,
		total: data.count,
		ready,
		get drawn() {
			return drawn;
		},
		get chunks() {
			return chunks.length;
		},
		setBudget(count) {
			override = Math.max(0, Math.floor(count));
			dirty = true;
		},
		settle() {
			return new Promise<void>((resolve) => {
				waiters.push(resolve);
				choose();
				settleWaiters();
			});
		},
		update(next) {
			eye[0] = next[0] ?? 0;
			eye[1] = next[1] ?? 0;
			eye[2] = next[2] ?? 0;
			if (chunks.length !== selectorChunks) {
				selectorChunks = chunks.length;
				selector = selectorChunks > 0 ? new SplatSelector(chunks) : undefined;
				// A new selector has counts of its own, and the draw keeps the last set until the
				// worker answers for this one.
				lastCounts = new Float32Array(selectorChunks);
				lastTotal = -1;
				dirty = true;
			}
			choose();
		},
		destroy() {
			stop = true;
			host.destroy();
			draw.destroy();
		},
	};
}

/** True when two lists of chunk counts differ, in length or in any count. */
function differs(a: Float32Array, b: Float32Array): boolean {
	if (a.length !== b.length) return true;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
	return false;
}

/** Downloads an SPZ file, and decodes it. */
async function decodeFile(url: string | URL): Promise<SplatData> {
	const address =
		url instanceof URL
			? url
			: new URL(
					url,
					(globalThis as { location?: { href: string } }).location?.href ?? 'http://localhost/',
				);
	const response = await fetch(address);
	if (!response.ok)
		throw splatsError(
			2109,
			`the splat file ${address} answered ${response.status}. Give the address of an SPZ file that the page may read.`,
		);
	const file = new Uint8Array(await response.arrayBuffer());
	const { decodeSpz } = await import('./spz');
	return decodeSpz(file);
}
