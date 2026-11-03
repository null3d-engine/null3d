// The near pool: one per scene. It decides which plant copies draw real shoots, and which of their
// shoot rows, within the scene's caps: the copies nearest the camera, at most the preset's count, and
// every near shoot together within the preset's triangle budget. The frame-budget governor halves
// that budget under load.
//
// The page reads the camera once a frame. When it has moved half a metre, at most ten times a
// second, the pool starts the near task (render/near-task.ts and crates/null3d-vegetation-wasm) on a
// job worker. The task picks the copies, places their rows in the world and sorts them into the
// shoot batches of their prototype and leaf mesh tier. Its answer goes into the batches, the
// species' near tables and the cards' values with `TypedArray.set`, `markDirty` and
// `setActiveCount`, between frames. No loop over rows or copies runs here.
//
// Each placed species gives the pool its copies, its variants' rows and its batches when
// `placePlants` places it with this pool (render/place.ts), and takes them back when its placement
// is destroyed.
import {
	type Camera,
	defineFeature,
	FeatureHost,
	type FeatureValue,
	type InstanceBatch,
	runTask,
	type SketchContext,
	type Task,
	type Texture,
} from '@null3d/engine';
import { NEAR_CAPS } from '../core/caps';
import { DETAILS, type Detail } from '../core/types';
import { NAMESPACE } from '../namespace';
import { type NearGroup, nearScene, type TierBand } from './near-arrays';
import {
	type GroupArrays,
	MAX_NEAR,
	type NearAnswer,
	type NearInput,
	type NearLayout,
	type NearScene,
	nearLayout,
	SUMMARY_FLOATS,
	TABLE_FLOATS,
} from './near-task';
import { standInNearPool } from './stand-in';

/**
 * The near pool's caps; the preset's by default.
 *
 * @category api/vegetation
 */
export interface NearPoolOptions {
	/**
	 * The camera that the near copies follow, or anything that gives a world position as a camera
	 * does. A real pool needs one; a pool for stand-in kits does not.
	 */
	readonly camera?: Pick<Camera, 'getWorldPosition'>;
	/** Copies that draw real shoots, at most 16. */
	readonly copies?: number;
	/** Triangles that every near shoot may draw together, before the governor's steps. */
	readonly triangles?: number;
	/** A pool for stand-in kits, which draws no real shoots. */
	readonly placeholders?: boolean;
}

/**
 * The scene's near pool: which copies draw real shoots.
 *
 * @category api/vegetation
 */
export interface NearPool {
	/**
	 * Reads the camera, and starts the near task when it has moved half a metre since the last one,
	 * at most ten times a second. Call it once a frame. Allocates nothing while the camera stands.
	 */
	update(): void;
	/** Copies drawing real shoots now, for the stats overlay and the tests. */
	readonly copies: number;
	/** Triangles of real shoots drawn now, across every band and tier. */
	readonly triangles: number;
	/** The triangles that the near shoots may draw now: the preset's budget after the governor's steps. */
	readonly budget: number;
	/** The leaf mesh tier of the nearest band, which the pool's preset gives. */
	readonly detail: Detail;
	/** Resolves when the near task's answer for the camera where it now stands has been written. */
	settled(): Promise<void>;
	/** Removes the pool's feature and stops its task. Destroy the placements that use it first. */
	destroy(): void;
}

/** One shoot batch of a placed species, and its rows in the pool's output. */
export interface NearShootBatch {
	readonly batch: InstanceBatch;
	readonly capacity: number;
}

/** One card batch of a placed species: its rows take the card values of its variant's copies. */
export interface NearCardBatch {
	readonly batch: InstanceBatch;
	/** The variant's first card row in the species' card values, and its rows. */
	readonly first: number;
	readonly count: number;
}

/** What a placement gives the pool: its arrays and its batches. */
export interface NearSpecies {
	/** The species' near table, which its shoot rows read their copies from. */
	readonly table: Texture;
	/** The table's first slot the pool may take; fixed placements hold the slots below it. */
	readonly firstSlot: number;
	/** The split distance and the tier bands. */
	readonly split: number;
	readonly bands: readonly TierBand[];
	/** The species' arrays, in the task's order. */
	readonly arrays: GroupArrays;
	/** Copies, card rows, variants and prototypes in the arrays. */
	readonly copies: number;
	readonly variants: number;
	readonly prototypes: number;
	/** Prototype `p`'s band `k` at `p * bands + k`; a prototype no row uses has none. */
	readonly shoots: readonly (NearShootBatch | undefined)[];
	readonly cards: readonly NearCardBatch[];
	/** Card rows across the species' variants. */
	readonly cardRows: number;
}

/** The pool's side that `placePlants` reaches: adding and removing a placed species. */
export interface NearPoolHost {
	/** The detail tier of the nearest band, which the preset gives. */
	readonly detail: Detail;
	/** The most copies and triangles the pool may ever draw, which size the batches. */
	readonly maxCopies: number;
	readonly maxTriangles: number;
	add(species: NearSpecies): void;
	remove(species: NearSpecies): void;
}

const HOSTS = new WeakMap<NearPool, NearPoolHost>();

/**
 * The side of a near pool that placement reaches, or none for a stand-in pool.
 *
 * @param pool The pool.
 * @returns Its host.
 */
export function nearPoolHost(pool: NearPool): NearPoolHost | undefined {
	return HOSTS.get(pool);
}

/** The task that composes the near rows: its module and the WebAssembly module it calls. */
const NEAR_TASK: Task = {
	name: 'vegetation-near',
	script: new URL('./near-task.ts', import.meta.url),
	wasm: [
		{
			name: 'vegetation',
			url: new URL('../../dist/vegetation.wasm', import.meta.url),
			what: 'the plant near task',
		},
	],
};

/** Metres the camera moves before the pool composes again. */
const MOVE = 0.5;
/** The fewest milliseconds between two calls of the task. */
const INTERVAL_MS = 100;
/** Rows a batch's view covers per step, so the views a copy needs are made once and kept. */
const VIEW_STEP = 256;

/** The near foliage's GPU time per frame at full quality on each preset, which the governor shares. */
const BUDGET_MS = [2, 4, 6, 8] as const;
/** The governor's lowest share of the triangle budget: half. */
const BUDGET_MIN = 0.5;

/** The views of one shoot batch's rows in the output, one set per count of `VIEW_STEP` rows. */
interface RowViews {
	readonly batch: InstanceBatch;
	/** The batch's place in the task's batch table, which its count in the output follows. */
	readonly slot: number;
	readonly first: number;
	readonly capacity: number;
	readonly positions: (Float32Array | undefined)[];
	readonly rotations: (Float32Array | undefined)[];
	readonly scales: (Float32Array | undefined)[];
	readonly values: (Float32Array | undefined)[];
	/** The rows it drew after the last answer. */
	drawn: number;
}

/**
 * A view of a batch's rows in one output array: `step` times `VIEW_STEP` rows from its first, or
 * its whole capacity where that is fewer. Each view is made at its first use and kept, so an answer
 * that draws a count seen before makes none.
 */
function viewOf(
	kept: (Float32Array | undefined)[],
	array: Float32Array,
	view: RowViews,
	step: number,
	per: number,
): Float32Array {
	let made = kept[step];
	if (!made) {
		const rows = Math.min(step * VIEW_STEP, view.capacity);
		made = array.subarray(view.first * per, (view.first + rows) * per);
		kept[step] = made;
	}
	return made;
}

/** Everything one scene of placed species holds in the pool. */
interface Built {
	readonly scene: NearScene;
	readonly layout: NearLayout;
	readonly out: Uint8Array;
	readonly summary: Float64Array;
	readonly counts: Uint32Array;
	readonly positions: Float32Array;
	readonly rotations: Float32Array;
	readonly scales: Float32Array;
	readonly values: Float32Array;
	readonly rows: readonly RowViews[];
	readonly tables: readonly { readonly texture: Texture; readonly data: Float32Array }[];
	readonly cards: readonly { readonly batch: InstanceBatch; readonly values: Float32Array }[];
}

/** A buffer that the job workers share where the page allows it. */
function buffer(bytes: number): ArrayBuffer | SharedArrayBuffer {
	return typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true
		? new SharedArrayBuffer(bytes)
		: new ArrayBuffer(bytes);
}

/** Lays out the placed species' arrays for the task and the views of its output. */
function build(species: readonly NearSpecies[]): Built {
	const tables: Texture[] = [];
	const groups = species.map((s): NearGroup => {
		let table = tables.indexOf(s.table);
		if (table < 0) table = tables.push(s.table) - 1;
		return { ...s, table, capacities: s.shoots.map((shoot) => shoot?.capacity ?? 0) };
	});
	const scene = nearScene(groups, tables.length);
	const { batches, rows } = scene;
	const layout = nearLayout(scene);
	const bytes = buffer(layout.bytes);
	const f32 = (at: number, count: number) => new Float32Array(bytes, at, count);
	const positions = f32(layout.positions, rows * 3);
	const rotations = f32(layout.rotations, rows * 4);
	const scales = f32(layout.scales, rows * 3);
	const values = f32(layout.values, rows * 4);
	const views: RowViews[] = [];
	const shoots = species.flatMap((s) => s.shoots);
	shoots.forEach((shoot, b) => {
		if (!shoot) return;
		views.push({
			batch: shoot.batch,
			slot: b,
			first: batches[b * 2] as number,
			capacity: shoot.capacity,
			positions: [],
			rotations: [],
			scales: [],
			values: [],
			drawn: 0,
		});
	});
	const cardValues = f32(layout.cardValues, scene.cards * 4);
	const cards: Built['cards'][number][] = [];
	let cardBase = 0;
	for (const s of species) {
		for (const card of s.cards)
			cards.push({
				batch: card.batch,
				values: cardValues.subarray(
					(cardBase + card.first) * 4,
					(cardBase + card.first + card.count) * 4,
				),
			});
		cardBase += s.cardRows;
	}
	return {
		scene,
		layout,
		out: new Uint8Array(bytes),
		summary: new Float64Array(bytes, layout.summary, SUMMARY_FLOATS),
		counts: new Uint32Array(bytes, layout.counts, batches.length / 2),
		positions,
		rotations,
		scales,
		values,
		rows: views,
		tables: tables.map((texture, t) => ({
			texture,
			data: f32(layout.tables + t * TABLE_FLOATS * 4, TABLE_FLOATS),
		})),
		cards,
	};
}

/** The pool's quality settings by preset: copies, then triangles. */
const COPIES_ROW = DETAILS.map((d) => NEAR_CAPS[d].copies) as unknown as readonly [
	number,
	number,
	number,
	number,
];
const TRIANGLES_ROW = DETAILS.map((d) => NEAR_CAPS[d].triangles) as unknown as readonly [
	number,
	number,
	number,
	number,
];

/** The pools made on this thread, so each feature takes a name of its own. */
let pools = 0;

/**
 * Makes the scene's near pool. Give it to every `placePlants` call whose copies may draw real
 * shoots, and call its `update` once a frame.
 *
 * @param ctx The sketch's context.
 * @param options The camera, and caps in place of the preset's.
 * @returns The pool.
 * @category api/vegetation
 */
export function createNearPool(ctx: SketchContext, options: NearPoolOptions = {}): NearPool {
	if (options.placeholders) return standInNearPool();
	const camera = options.camera;
	if (!camera)
		throw new Error(
			'@null3d/vegetation: createNearPool() got no camera. Give the camera that the near copies follow as `camera`.',
		);
	if (options.copies !== undefined && !(options.copies >= 0 && options.copies <= MAX_NEAR))
		throw new RangeError(
			`@null3d/vegetation: createNearPool() got ${options.copies} copies, not a whole number from 0 to ${MAX_NEAR}.`,
		);
	if (options.triangles !== undefined && !(options.triangles >= 0))
		throw new RangeError(
			`@null3d/vegetation: createNearPool() got ${options.triangles} triangles, not a number from 0.`,
		);
	const preset = ctx.quality.preset;
	const detail = NEAR_CAPS[preset].detail;
	const maxCopies = Math.min(MAX_NEAR, options.copies ?? Math.max(...COPIES_ROW));
	const maxTriangles = options.triangles ?? Math.max(...TRIANGLES_ROW);
	const id = ++pools;
	const species: NearSpecies[] = [];
	let built: Built | undefined;
	let version = 0;
	let busy = false;
	let dirty = true;
	let last = -Infinity;
	let stopped = false;
	let copiesNow = 0;
	let trianglesNow = 0;
	let capCopies = options.copies ?? COPIES_ROW[DETAILS.indexOf(preset)] ?? 1;
	let capTriangles = options.triangles ?? TRIANGLES_ROW[DETAILS.indexOf(preset)] ?? 0;
	const eye = [0, 0, 0];
	const asked = [Number.NaN, Number.NaN, Number.NaN];
	const waiting: (() => void)[] = [];

	// The near shoots' caps are a quality feature: the preset gives them, and the governor's steps
	// scale the triangle budget down to half of it under load.
	const host = new FeatureHost({
		quality: ctx.quality,
		tier: ctx.engine.capabilities.tier,
		page: ctx.page,
		namespace: NAMESPACE,
	});
	// The preset's budget comes governed by the engine; a page's own budget takes the same share.
	const apply = (own: Readonly<Record<string, FeatureValue>>, scale: number): void => {
		capCopies = Math.min(maxCopies, options.copies ?? (own.nearCopies as number));
		capTriangles =
			options.triangles === undefined
				? (own.nearTriangleBudget as number)
				: Math.round(options.triangles * Math.max(BUDGET_MIN, scale));
		dirty = true;
	};
	host.add(
		defineFeature({
			name: pools === 1 ? 'near-shoots' : `near-shoots-${id}`,
			settings: {
				nearCopies: { presets: COPIES_ROW, values: { min: 0, max: MAX_NEAR, whole: true } },
				nearTriangleBudget: {
					presets: TRIANGLES_ROW,
					values: { min: 0, max: 100_000_000, whole: true },
					governor: 'scale',
				},
			},
			budget: { presets: BUDGET_MS, min: BUDGET_MIN },
			quality: (_preset, _settings, own) => apply(own.settings, own.budgetScale),
		}),
	);

	const input: NearInput = {
		op: 'compose',
		id,
		version: 0,
		scene: {
			groups: new Float64Array(0),
			arrays: [],
			batches: new Uint32Array(0),
			rows: 0,
			tables: 0,
			cards: 0,
		},
		eyeX: 0,
		eyeY: 0,
		eyeZ: 0,
		copies: 0,
		triangles: 0,
		margin: 1,
		out: new Uint8Array(0),
	};

	const rebuild = (): void => {
		built = species.length > 0 ? build(species) : undefined;
		version++;
		dirty = true;
		if (built) {
			input.scene = built.scene;
			input.out = built.out;
		}
		input.version = version;
	};

	const release = (): void => {
		const done = waiting.splice(0);
		for (const resolve of done) resolve();
	};

	/** The scene's version that the task in flight composes for. */
	let sent = 0;

	/** Writes an answer into the batches, the tables and the cards' values. */
	const write = (answer: NearAnswer): void => {
		busy = false;
		if (stopped) return;
		const now = built;
		if (!now || sent !== version) {
			dirty = true;
			return;
		}
		if (answer.bytes) now.out.set(new Uint8Array(answer.bytes));
		for (let b = 0; b < now.rows.length; b++) {
			const view = now.rows[b] as RowViews;
			const count = Math.min(now.counts[view.slot] as number, view.capacity);
			const step = Math.ceil(count / VIEW_STEP);
			const batch = view.batch;
			if (step > 0) {
				batch.positions.set(viewOf(view.positions, now.positions, view, step, 3));
				batch.rotations.set(viewOf(view.rotations, now.rotations, view, step, 4));
				batch.scales.set(viewOf(view.scales, now.scales, view, step, 3));
				(batch.values as Float32Array).set(viewOf(view.values, now.values, view, step, 4));
				batch.markDirty(0, count);
			}
			if (count !== view.drawn) {
				batch.setActiveCount(count);
				view.drawn = count;
			}
		}
		for (const table of now.tables) table.texture.update(table.data);
		for (const card of now.cards) {
			(card.batch.values as Float32Array).set(card.values);
			card.batch.markDirty();
		}
		trianglesNow = now.summary[0] as number;
		copiesNow = now.summary[1] as number;
		if (!dirty) release();
	};
	const failed = (error: unknown): void => {
		busy = false;
		dirty = true;
		console.error('@null3d/vegetation: the near task failed', error);
	};

	const start = (moved: number, at: number): void => {
		const now = built as Built;
		busy = true;
		dirty = false;
		last = at;
		asked[0] = eye[0] as number;
		asked[1] = eye[1] as number;
		asked[2] = eye[2] as number;
		input.eyeX = asked[0];
		input.eyeY = asked[1];
		input.eyeZ = asked[2];
		input.copies = capCopies;
		input.triangles = capTriangles;
		// The camera keeps moving while the task runs: the rows reach as far past the split as it may
		// move before the answer arrives, at its speed over the last call.
		input.margin = Math.min(5, MOVE + 2 * moved);
		input.scene = now.scene;
		sent = version;
		runTask<NearAnswer>(NEAR_TASK, input).then(write, failed);
	};

	const pool: NearPool = {
		update() {
			if (stopped || busy || !built) return;
			camera.getWorldPosition(eye);
			const dx = (eye[0] as number) - (asked[0] as number);
			const dy = (eye[1] as number) - (asked[1] as number);
			const dz = (eye[2] as number) - (asked[2] as number);
			const moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
			if (!dirty && moved < MOVE) return;
			const at = performance.now();
			if (at - last < INTERVAL_MS) return;
			start(Number.isFinite(moved) ? moved : 0, at);
		},
		get copies() {
			return copiesNow;
		},
		get triangles() {
			return trianglesNow;
		},
		get budget() {
			return capTriangles;
		},
		get detail() {
			return detail;
		},
		settled() {
			if (!built || (!busy && !dirty)) return Promise.resolve();
			return new Promise<void>((resolve) => waiting.push(resolve));
		},
		destroy() {
			stopped = true;
			host.destroy();
			release();
		},
	};
	HOSTS.set(pool, {
		detail,
		maxCopies,
		maxTriangles,
		add(entry) {
			species.push(entry);
			rebuild();
		},
		remove(entry) {
			const at = species.indexOf(entry);
			if (at >= 0) species.splice(at, 1);
			rebuild();
		},
	});
	return pool;
}
