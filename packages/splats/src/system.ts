// The splats of a scene, drawn through the engine's feature draw: one instance batch whose rows are
// the splats that draw, a surface function that turns a row into a soft Gaussian card, and a
// selection that a job worker makes each time the camera or the budget changes.
//
// The cloud is cut into chunks. Each chunk keeps its splats in importance order, so a prefix of the
// list is a coarser level of it. A job worker chooses a prefix for each chunk by its distance and by
// the preset's budget, and the sketch packs the chosen splats into the batch. The engine then culls
// and sorts the rows back to front in the transparent pass, which is what lets the splats mix with
// each other and with the scene's opaque meshes.
//
// A file that a page downloads whole is cut as the bytes arrive. A splat stream names its chunks in
// a small index, so the cloud starts at once and the loader fetches only the chunks that the
// selection asks for, nearest first.
import {
	checkAddonVersion,
	declareAddonNamespace,
	type FeatureHandle,
	FeatureHost,
	type InstanceBatch,
	type Material,
	type SketchContext,
	type Vec3Like,
} from '@null3d/engine';
import { chunkSplats, type SplatChunk } from './chunks';
import { splatsFeature } from './feature';
import { checkSplats, type SplatData, splatsError } from './format';
// The module registers the glTF extension as the add-on loads.
import './gltf';
import { type PrefixView, packRows, type SplatRows } from './pack';
import { SplatSelector } from './select';
import splatShader from './splats.wgsl';
import {
	firstViewCount,
	parseStreamIndex,
	type SplatStream,
	SplatStreamLoader,
	startsStreamIndex,
} from './stream';
import { VERSION } from './version';

checkAddonVersion('@null3d/splats', VERSION);

/** The add-on's names, claimed once as the sketch's module loads. */
const NAMESPACE = declareAddonNamespace({
	name: 'splats',
	package: '@null3d/splats',
	errorCodes: [2100, 2199],
});

/** The bytes of one batch row: its place, rotation, scales and color. */
const ROW_BYTES = (3 + 4 + 3 + 4) * 4;

/** One quad, which every row of the batch repeats. */
const QUAD = {
	positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
	normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
	uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
	indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
};

/** How far the camera moves before a selection is made again, in meters. */
const MOVE_EPSILON = 0.25;

/**
 * Options of `createSplats`. Give the cloud itself, or the address of a splat file or a stream
 * index.
 *
 * @category api/splats
 */
export interface SplatsOptions {
	/** The cloud to draw, decoded already, such as `decodeSpz` gives it. */
	readonly data?: SplatData;
	/** The address of an SPZ file or of a splat stream index to download and draw. */
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
	/** The number of chunks that the cloud has. */
	readonly chunks: number;
	/** The number of chunks whose data has loaded. */
	readonly loaded: number;
	/** The number of chunks that stayed unreachable. */
	readonly failed: number;
	/** The bytes of the whole cloud: the file's size, or the chunk sizes that a stream index gives. */
	readonly bytes: number;
	/** The bytes of the cloud that have downloaded. */
	readonly loadedBytes: number;
	/**
	 * Resolves when the cloud can draw its first view. For a file, every chunk is ready. For a
	 * stream, the nearest chunks that the last `update` needs are loaded, about a megabyte of files
	 * or the nearest chunk alone, and the rest keep loading behind the frames: call `update` once
	 * before awaiting it.
	 */
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

/** One slot of the selection: a chunk's bounds, its count, and the data that has arrived. */
interface ChunkSlot {
	readonly center: readonly [number, number, number];
	readonly radius: number;
	readonly count: number;
	data: SplatChunk | undefined;
}

/** What a page downloads: a cloud's whole file, or a stream's index. */
type Source =
	| { readonly data: SplatData; readonly bytes: number }
	| { readonly stream: SplatStream; readonly bytes: number };

/**
 * Draws a cloud of Gaussian splats in a sketch. The cloud comes from an SPZ file, from a splat
 * stream index, or from the data of another reader. A glTF model that carries
 * `KHR_gaussian_splatting` loads through `assets.loadGltf`, because the add-on's module registers
 * the reader as it loads. A cloud draws with detail levels, a budget that follows the quality
 * preset and the GPU path, and a soft mix with the scene's opaque meshes.
 *
 * A splat stream starts drawing before its whole cloud has downloaded: give the address of its
 * index, and the add-on fetches the chunks that the view needs as it needs them. Each chunk of the
 * cloud is an SPZ file, and the index names them.
 *
 * Call `splats.update(eye)` once in each frame, with the camera's position from `getPosition`, and
 * free the cloud with `splats.destroy()`.
 *
 * @category api/splats
 */
export async function createSplats(ctx: SketchContext, options: SplatsOptions): Promise<Splats> {
	if (options.data === undefined && options.url === undefined)
		throw splatsError(
			2110,
			'give createSplats() the cloud as data, or the url of an SPZ file or a splat stream index.',
		);
	const source: Source =
		options.data !== undefined
			? { data: checkSplats(options.data, 'the splat cloud'), bytes: 0 }
			: await readSource(options.url as string | URL);
	const data = 'data' in source ? source.data : undefined;
	const stream = 'stream' in source ? source.stream : undefined;
	const totalSplats = data ? data.count : (stream as SplatStream).count;
	// The slots that the selection reads: a stream names all of them at once, and a file adds them
	// as its cut makes them.
	const slots: ChunkSlot[] = [];
	if (stream)
		for (const chunk of stream.chunks)
			slots.push({
				center: chunk.center,
				radius: chunk.radius,
				count: chunk.count,
				data: undefined,
			});
	// The size of each chunk's file, which decides the chunks that the first view waits for.
	const chunkBytes = stream
		? Float64Array.from(stream.chunks, (chunk) => chunk.bytes)
		: new Float64Array(0);
	// The rows that the batch holds, which the preset and the GPU path decide once the host has
	// resolved them: a phone then pays for the splats that it may draw, not for the Ultra count.
	let capacity = 1;
	const description = splatsFeature(() => capacity * ROW_BYTES + QUAD.positions.byteLength * 4);
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
			Math.max(totalSplats, 1),
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

	let version = 0;
	let selector: SplatSelector | undefined;
	let selectorChunks = 0;
	// The counts and the total of the selection that fills the draw, which keeps its own copy so a
	// later selection in the shared buffer can differ from it without allocating.
	let lastCounts = new Float32Array(stream ? slots.length : 0);
	let lastTotal = -1;
	/** The chunk version that the rows hold, so a chunk that arrives repacks them once. */
	let packedVersion = -1;
	// The camera's position at the last ask, in a typed array, so a frame's ask allocates nothing.
	const eye = new Float64Array(3);
	const lastEye = new Float64Array(3);
	let lastBudget = -1;
	let dirty = true;
	let inFlight = false;
	let stop = false;
	let override: number | undefined;
	let drawn = 0;
	let loadedChunks = 0;
	let reported: Error | undefined;

	/** The prefix views of each slot, which change only when its chosen count does. */
	const prefixes: (PrefixView | undefined)[] = [];
	/** The batch rows of a pack, which point at the batch's own views of the current memory. */
	const rows: SplatRows = {
		positions: new Float32Array(0),
		rotations: new Float32Array(0),
		scales: new Float32Array(0),
		colors: new Float32Array(0),
		markDirty: (start, count) => draw.batch.markDirty(start, count),
		setActiveCount: (count) => draw.batch.setActiveCount(count),
	};

	const pack = (counts: Float32Array): void => {
		const views = draw.batch;
		if (!views.colors)
			throw splatsError(2111, 'the splats batch has no row colors, which its draw needs.');
		rows.positions = views.positions;
		rows.rotations = views.rotations;
		rows.scales = views.scales;
		rows.colors = views.colors;
		drawn = packRows(rows, slots, counts, prefixes);
		packedVersion = version;
	};

	/** The ask that waits for its answer, and the chunk version that it saw. */
	let asking: SplatSelector | undefined;
	let askedVersion = 0;

	/** The chunks that the stream should fetch, nearest first, in buffers that a selection reuses. */
	const wanted: number[] = [];
	const wantedDistance: number[] = [];
	/** The nearest wanted chunks that the first view waits for, and whether it has drawn. */
	const firstView: number[] = [];
	let firstViewDone = false;

	/**
	 * Asks the loader for the chunks that the selection wants and that have not arrived, nearest
	 * first. A chunk behind the camera still counts: the budget decides what the view needs, and
	 * the distance decides what it needs first.
	 */
	const askForChunks = (loader: SplatStreamLoader, counts: Float32Array): void => {
		wanted.length = 0;
		wantedDistance.length = 0;
		const eyeX = eye[0] as number;
		const eyeY = eye[1] as number;
		const eyeZ = eye[2] as number;
		for (let i = 0; i < slots.length; i++) {
			const slot = slots[i] as ChunkSlot;
			if (slot.data || !(i < counts.length && (counts[i] as number) > 0)) continue;
			const dx = (slot.center[0] as number) - eyeX;
			const dy = (slot.center[1] as number) - eyeY;
			const dz = (slot.center[2] as number) - eyeZ;
			const distance = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz) - slot.radius, 0);
			// Keep the list nearest first, so the closest chunk's splats arrive first.
			let at = wanted.length;
			while (at > 0 && (wantedDistance[at - 1] as number) > distance) {
				wanted[at] = wanted[at - 1] as number;
				wantedDistance[at] = wantedDistance[at - 1] as number;
				at--;
			}
			wanted[at] = i;
			wantedDistance[at] = distance;
		}
		// The first view draws from the nearest chunks, and the rest keep loading behind the frames
		// that draw, so a large cloud never leaves the screen empty while its whole first view loads.
		firstView.length = 0;
		if (!firstViewDone && wanted.length > 0) {
			const count = firstViewCount(wanted, chunkBytes);
			for (let k = 0; k < count; k++) firstView.push(wanted[k] as number);
		}
		loader.load(wanted);
	};

	let loader: SplatStreamLoader | undefined;
	let settledOnce = false;
	let readyResolved = false;
	let resolveReady: () => void = () => undefined;
	const streamReady = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});
	/** True when the chunks that the first view waits for have arrived, or have stayed unreachable. */
	const firstViewLoaded = (): boolean => {
		if (loader === undefined) return true;
		if (firstView.length === 0) return loader.idle;
		for (const index of firstView) if (!loader.settled(index)) return false;
		return true;
	};
	const maybeReady = (): void => {
		if (readyResolved) return;
		if (!settledOnce || !firstViewLoaded()) return;
		readyResolved = true;
		firstViewDone = true;
		resolveReady();
	};

	/** Starts the loader's requests, and resolves the stream's readiness once they settle. */
	const loadFor = (counts: Float32Array): void => {
		if (loader) askForChunks(loader, counts);
		maybeReady();
	};

	/** True when the camera has moved far enough that the last selection no longer fits it. */
	const movedSinceLastSelection = (): boolean =>
		Math.abs((eye[0] as number) - (lastEye[0] as number)) +
			Math.abs((eye[1] as number) - (lastEye[1] as number)) +
			Math.abs((eye[2] as number) - (lastEye[2] as number)) >
		MOVE_EPSILON;

	/**
	 * Packs a chunk that arrived with the last selection's counts, unless the camera has moved: a
	 * chunk that the view no longer wants takes no row, and the next selection places the rest.
	 */
	const packArrived = (): void => {
		if (lastTotal < 0 || lastCounts.length !== slots.length) return;
		if (inFlight || movedSinceLastSelection()) return;
		pack(lastCounts);
	};

	/** The callers that wait for a settled selection, which the next one answers. */
	const waiters: (() => void)[] = [];
	const settleWaiters = (): void => {
		if (inFlight || dirty || waiters.length === 0) return;
		for (const resolve of waiters.splice(0)) resolve();
	};

	const budgetNow = (): number =>
		Math.min(capacity, Math.floor(override ?? (feature.settings.drawn as number)));

	/** Takes the answer: fills the draw again when the counts or the total changed. */
	const selected = (_output: boolean): void => {
		inFlight = false;
		const asked = asking;
		asking = undefined;
		if (stop || !asked) return;
		const total = asked.total;
		const changed =
			total !== lastTotal || version !== packedVersion || differs(asked.counts, lastCounts);
		if (changed) {
			lastTotal = total;
			// A chunk that arrived while the worker chose changed the list's length.
			if (lastCounts.length !== asked.counts.length)
				lastCounts = new Float32Array(asked.counts.length);
			lastCounts.set(asked.counts);
			pack(asked.counts);
		}
		settledOnce = true;
		// A new file chunk joins the selector, so the next selection includes it. A stream's
		// chunks are all known from its index, and an arrival repacks the rows on its own.
		dirty = stream ? false : version !== askedVersion;
		if (stream) loadFor(asked.counts);
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
		settledOnce = true;
		maybeReady();
		settleWaiters();
	};

	const choose = (): void => {
		if (stop || !selector || inFlight) return;
		const budget = budgetNow();
		const moved = movedSinceLastSelection();
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

	/** Makes the selector read every chunk that the cloud has, when the list's length changed. */
	const syncSelector = (): void => {
		if (slots.length === selectorChunks) return;
		selectorChunks = slots.length;
		selector = selectorChunks > 0 ? new SplatSelector(slots) : undefined;
		// A new selector has counts of its own, and the draw keeps the last set until the worker
		// answers for this one.
		lastCounts = new Float32Array(selectorChunks);
		lastTotal = -1;
		dirty = true;
	};

	let ready: Promise<void>;
	if (stream) {
		loader = new SplatStreamLoader(stream, {
			decode: decodeChunk,
			onChunk: (index, chunk) => {
				const slot = slots[index] as ChunkSlot;
				slot.data = chunk;
				loadedChunks++;
				version++;
				packArrived();
				maybeReady();
			},
			onFailed: (index, error) => {
				console.error(
					`splats: chunk ${index} of the splat stream did not load, so that part of the cloud stays empty. ${error.message}`,
				);
				maybeReady();
			},
			onIdle: maybeReady,
		});
		ready = streamReady;
		syncSelector();
		// A sketch usually names its view in the same turn as this call returns, so the first
		// selection waits a turn: it then asks for that view's chunks instead of the origin's. A
		// sketch that never calls update still gets a selection, and its ready resolves.
		setTimeout(() => {
			if (!stop && !settledOnce) choose();
		}, 0);
	} else {
		const cut = chunkSplats(data as SplatData, {
			yieldTo: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
			onChunk: (chunk) => {
				slots.push({
					center: chunk.center,
					radius: chunk.radius,
					count: chunk.count,
					data: chunk,
				});
				loadedChunks++;
				version++;
				dirty = true;
			},
		}).then(() => undefined);
		ready = cut;
	}

	return {
		feature,
		draw: draw as SplatsDraw,
		total: totalSplats,
		ready,
		get drawn() {
			return drawn;
		},
		get chunks() {
			return slots.length;
		},
		get loaded() {
			return loadedChunks;
		},
		get failed() {
			return loader?.failed ?? 0;
		},
		bytes: source.bytes,
		get loadedBytes() {
			return loader ? loader.receivedBytes : source.bytes;
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
			syncSelector();
			choose();
		},
		destroy() {
			stop = true;
			loader?.abort();
			host.destroy();
			draw.destroy();
		},
	};
}

/** Reads one chunk file of a stream, which is an SPZ file. */
async function decodeChunk(bytes: Uint8Array): Promise<SplatData> {
	const { decodeSpz } = await import('./spz');
	return decodeSpz(bytes);
}

/** True when two lists of chunk counts differ, in length or in any count. */
function differs(a: Float32Array, b: Float32Array): boolean {
	if (a.length !== b.length) return true;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
	return false;
}

/**
 * Downloads a cloud. A stream index is a small JSON file, so it arrives at once. Any other file is
 * an SPZ file, which the reader decodes whole.
 */
async function readSource(url: string | URL): Promise<Source> {
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
			`the splat file ${address} answered ${response.status}. Give the address of an SPZ file or a splat stream index that the page may read.`,
		);
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (startsStreamIndex(bytes)) {
		const text = new TextDecoder().decode(bytes);
		const stream = parseStreamIndex(text, address, `the splat stream ${address}`);
		return { stream, bytes: stream.bytes };
	}
	const { decodeSpz } = await import('./spz');
	return { data: await decodeSpz(bytes), bytes: bytes.byteLength };
}
