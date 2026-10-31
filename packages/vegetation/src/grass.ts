// GPU grass for null3D: tufts of bent blades over a ground, placed by integer hashes and drawn in
// instance batches. The CPU path below builds the rows once and both GPU paths draw them; the
// WebGPU blade list, which culls in a compute pass, comes later. Distance bands give the far tufts
// fewer blade segments at the same density and width, so cover holds while far ground costs fewer
// triangles. The colour hands over to the terrain through the blades' own colours, and the
// per-preset share thins the field.
import {
	type InstanceBatch,
	type QualityPreset,
	quat,
	type SketchContext,
	type Texture,
	type Textures,
} from '@null3d/engine';
import type { WindField } from '@null3d/wind';
import grassShader from './grass.wgsl';
import { unitAt } from './hash';

/** The share of the High count that each preset draws. */
const PRESET_SHARE: Record<QualityPreset, number> = {
	low: 0.35,
	medium: 0.6,
	high: 1,
	ultra: 1.25,
};
/** The presets from the thinnest to the thickest. */
const PRESETS: readonly QualityPreset[] = ['low', 'medium', 'high', 'ultra'];
/** The width of the squares that group nearby rows, in meters. */
const CELL = 4;
/** The most attempts per tuft, so a ground that mostly refuses grass still ends. */
const ATTEMPTS = 8;
/** A blade's root's lift above the ground, in meters. */
const LIFT = 0.02;

/**
 * What `createGrass` takes: the ground, the area, the count at the High preset, and the seed.
 *
 * @category api/vegetation
 */
export interface GrassOptions {
	/** The ground's height at a point, in meters. The grass stands on it and avoids steep ground. */
	readonly height: (x: number, z: number) => number;
	/** The square that the grass fills, centered on `x` and `z`, with a side of `size` meters. */
	readonly area: { readonly x: number; readonly z: number; readonly size: number };
	/** The tufts at the High preset. Low, Medium and Ultra draw 0.35, 0.6 and 1.25 of it. */
	readonly count: number;
	/** The seed that places every tuft and grows every blade, the same on every device. */
	readonly seed: number;
	/** The blades in each tuft. The default is 13. */
	readonly blades?: number;
	/** The segments of each blade. The default is 3. */
	readonly segments?: number;
	/** The shapes of tuft, each one batch. The default is 1. */
	readonly shapes?: number;
	/** The steepest ground that a tuft grows on, as rise over run. The default is 0.6. */
	readonly maxSlope?: number;
	/**
	 * The wind add-on's field, the one that the leaf material reads. The blades bend in its air,
	 * and a page that leaves it out grows grass that stands still.
	 */
	readonly wind?: WindField;
	/** How far a blade bends at its tip for each meter a second of air. The default is 0.04. */
	readonly sway?: number;
	/**
	 * The distance bands, from the nearest to the farthest. The default is two: the first ends at
	 * half the area's side and grows blades of the segments that `segments` gives, and the second
	 * carries the hill to 1.6 times the side with blades of one segment fewer. Both bands place the
	 * same tufts at the same width, so the far ground costs fewer triangles without thinning and no
	 * line of a changed density crosses the hill. Each band's `far` must lie beyond the band before
	 * it.
	 */
	readonly bands?: readonly GrassBandOptions[];
}

/**
 * One distance band of the grass: where it stops drawing, how many tufts it places and how wide
 * its blades are. The near band's rows draw nearest the camera and the far band's beyond it, so one
 * set of tufts covers the hill at every distance while the far rows cost fewer triangles.
 *
 * @category api/vegetation
 */
export interface GrassBandOptions {
	/** The distance from the camera beyond which this band stops drawing, in meters. */
	readonly far: number;
	/** This band's tufts as a share of the near band's. The default is 1, which keeps them. */
	readonly share?: number;
	/** The segments of each blade in this band. The default is one fewer for each band out. */
	readonly segments?: number;
	/**
	 * How much wider this band's blades are. The default holds the ground's cover, which is the
	 * inverse of `share`: a band with half the tufts draws blades twice as wide. A wide blade reads
	 * as a stick past a small widening, so thinning a band is a choice to weigh against its look.
	 */
	readonly widen?: number;
}

/**
 * A distance band as `createGrass` built it: its rows, the band's place in the field, and what one
 * of its tufts draws.
 *
 * @category api/vegetation
 */
export interface GrassBand {
	/** The distance from the camera at which this band starts drawing. */
	readonly near: number;
	/** The distance from the camera beyond which it stops. */
	readonly far: number;
	/** The tufts that the band places at the High preset. */
	readonly count: number;
	/** The triangles of one of the band's tufts. */
	readonly triangles: number;
	/** The band's batches, one for each tuft shape. Each draws its active rows. */
	readonly batches: readonly InstanceBatch[];
}

/**
 * The grass that `createGrass` made: one instance batch for each tuft shape, and the call that
 * draws a preset's share of them.
 *
 * @category api/vegetation
 */
export interface Grass {
	/** The distance bands, nearest first. */
	readonly bands: readonly GrassBand[];
	/** Every band's batches, in band order. Each draws its active rows. */
	readonly batches: readonly InstanceBatch[];
	/** Draws the preset's share of each band's tufts, from the first row of each batch. */
	fit(preset: QualityPreset): void;
	/**
	 * Gives the blades the field's newest state for this frame, as the leaf material takes it. Call
	 * it once in each frame, before the frame draws.
	 */
	setWindLayer(field: WindField): void;
}

/**
 * A tuft's place, turn and traits, as the batch rows take them. The placement reads only integer
 * hashes, so every device places the same tufts from the same seed.
 *
 * @category api/vegetation
 */
export interface GrassTuft {
	/** The place on the ground, with the root's lift. */
	readonly x: number;
	readonly y: number;
	readonly z: number;
	/** The turn about up, in radians. */
	readonly turn: number;
	/** The tuft's size, as a scale of its grown shape. */
	readonly size: number;
	/** A value from 0 to 1 that picks the tuft's tint. */
	readonly tint: number;
}

/**
 * Places the tufts of one shape on the ground, by integer hash, and skips the ground steeper than
 * the option allows. The calls with one seed, shape, count and salt give the same list on every
 * device. A band places its own tufts by giving its own salt, so two bands never share a tuft.
 *
 * @category api/vegetation
 */
export function placeTufts(
	options: GrassOptions,
	shape: number,
	count: number,
	salt = 0,
): GrassTuft[] {
	const { area, seed, height } = options;
	const maxSlope = options.maxSlope ?? 0.6;
	const step = 0.25;
	const tufts: GrassTuft[] = [];
	for (let i = 0; tufts.length < count && i < count * ATTEMPTS; i++) {
		const x = area.x + (unitAt(seed, i, shape, 0, salt) - 0.5) * area.size;
		const z = area.z + (unitAt(seed, i, shape, 1, salt) - 0.5) * area.size;
		const y = height(x, z);
		const dx = (height(x + step, z) - height(x - step, z)) / (2 * step);
		const dz = (height(x, z + step) - height(x, z - step)) / (2 * step);
		if (Math.hypot(dx, dz) > maxSlope) continue;
		tufts.push({
			x,
			y: y - LIFT,
			z,
			turn: unitAt(seed, i, shape, 2, salt) * Math.PI * 2,
			size: 0.75 + 0.6 * unitAt(seed, i, shape, 3, salt),
			tint: unitAt(seed, i, shape, 5, salt),
		});
	}
	return tufts;
}

/**
 * One tuft's mesh arrays, which `scene.geometry.fromArrays` takes.
 *
 * @category api/vegetation
 */
export interface TuftMesh {
	readonly positions: Float32Array;
	readonly normals: Float32Array;
	readonly colors: Float32Array;
	readonly uvs: Float32Array;
	readonly indices: number[];
}

/**
 * One tuft's mesh: blades that lean out from its middle and curve over. Each blade is a strip that
 * narrows to a point, its normal leans up so it lights like the ground, and its colours run from a
 * dark root to a lighter tip. A band beyond the first widens its blades so a thinned field keeps
 * the ground covered.
 *
 * @category api/vegetation
 */
export function tuftMesh(seed: number, blades: number, segments: number, widen = 1): TuftMesh {
	let index = 0;
	const next = () => unitAt(seed, index++);
	const perBlade = segments * 2 + 1;
	const positions = new Float32Array(blades * perBlade * 3);
	const normals = new Float32Array(blades * perBlade * 3);
	const colors = new Float32Array(blades * perBlade * 3);
	const uvs = new Float32Array(blades * perBlade * 2);
	const indices: number[] = [];
	for (let b = 0; b < blades; b++) {
		const angle = next() * Math.PI * 2;
		const [ox, oz] = [Math.cos(angle), Math.sin(angle)];
		const root = 0.015 + 0.11 * next();
		const height = 0.12 + 0.22 * next() ** 1.5;
		const lean = (0.1 + 0.25 * next()) * height;
		const width = (0.016 + 0.012 * next()) * widen;
		const twist = angle + Math.PI / 2 + (next() - 0.5) * 0.8;
		const [sx, sz] = [Math.cos(twist), Math.sin(twist)];
		// The face's normal, across the strip, leaned up by two thirds.
		const [fx, fz] = [-sz, sx];
		const length = Math.hypot(fx * 0.35, 1, fz * 0.35);
		const first = b * perBlade;
		for (let j = 0; j <= segments; j++) {
			const t = j / segments;
			const cx = ox * (root + lean * t * t);
			const cz = oz * (root + lean * t * t);
			const cy = height * (t - 0.15 * t * t);
			const half = (width / 2) * (1 - t) ** 0.9;
			const sides = j === segments ? [0] : [-1, 1];
			for (const side of sides) {
				const v = first + (j === segments ? segments * 2 : j * 2 + (side + 1) / 2);
				positions.set([cx + sx * half * side, cy, cz + sz * half * side], v * 3);
				normals.set([(fx * 0.35) / length, 1 / length, (fz * 0.35) / length], v * 3);
				const shade = 0.3 + 0.7 * t;
				colors.set([shade * (0.9 + 0.25 * t), shade, shade * (0.85 - 0.2 * t)], v * 3);
				uvs.set([(side + 1) / 2, t], v * 2);
			}
		}
		for (let j = 0; j < segments - 1; j++) {
			const a = first + j * 2;
			indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
		}
		indices.push(first + segments * 2 - 2, first + segments * 2 - 1, first + segments * 2);
	}
	return { positions, normals, colors, uvs, indices };
}

/** A scratch quaternion for each tuft's turn. */
const spin = quat.create();

/**
 * Orders a batch's tufts so each preset's share is spread over the hill and nearby rows sit
 * together, which lets the engine's culling skip groups of 64 rows that are out of view.
 */
function ordered(tufts: readonly GrassTuft[], high: number): GrassTuft[] {
	const key = (t: GrassTuft) => Math.floor(t.x / CELL) * 1000 + Math.floor(t.z / CELL);
	const bands: GrassTuft[] = [];
	let from = 0;
	for (const preset of PRESETS) {
		const to = Math.min(tufts.length, Math.ceil(high * PRESET_SHARE[preset]));
		bands.push(...tufts.slice(from, to).sort((a, b) => key(a) - key(b)));
		from = to;
	}
	return bands;
}

/**
 * The far edges of the default bands, as fractions of the area's side. The first band ends at the
 * distance where a blade's shape stops showing, and the second carries the hill to its far corner.
 */
const DEFAULT_BAND_EDGES = [0.5, 1.6] as const;
/**
 * The default bands' tufts, as shares of the near band's. The default keeps every band's tufts and
 * blade width, so a band changes its blades' geometry alone and no contour of density shows on the
 * ground. A page that thins a band widens its blades by the same factor, which the review of this
 * work found turns them into sticks past a small widening, so the default does not thin.
 */
const DEFAULT_BAND_SHARES = [1, 1] as const;
/** The floats of one row: its place, its turn, its size, its values and its two distances. */
const ROW_FLOATS = 3 + 4 + 3 + 4 + 2;
/**
 * The bytes of one of the grass's instance rows, which the engine keeps.
 *
 * @category api/vegetation
 */
export const GRASS_ROW_BYTES = ROW_FLOATS * 4;
/**
 * A band as `grassBands` works it out: where it draws, what each preset asks of it, and the memory
 * its rows take. A page reads this to size what it builds or to report what it holds.
 *
 * @category api/vegetation
 */
export interface GrassBandPlan {
	/** The distance from the camera at which the band starts drawing, in meters. */
	readonly near: number;
	/** The distance from the camera beyond which it stops. */
	readonly far: number;
	/** The tufts that the band places at each preset. */
	readonly counts: Readonly<Record<QualityPreset, number>>;
	/** The triangles of one of the band's tufts. */
	readonly triangles: number;
	/** The rows that the band allocates, which hold the Ultra preset's share. */
	readonly rows: number;
	/** The bytes of the band's row arrays. */
	readonly rowBytes: number;
	/** The share of the near band's tufts that this band places. */
	readonly share: number;
	/** The segments of each blade in this band. */
	readonly segments: number;
	/** How much wider this band's blades are than the near band's. */
	readonly widen: number;
}

/**
 * Resolves the distance bands nearest first, filling in what the page left out, and gives each
 * band's tufts, triangles and rows. `createGrass` builds exactly this, and a page can read it to
 * size the grass's memory before it builds any.
 *
 * @param options The ground, the area, the count and the bands.
 * @returns One plan for each band, nearest first.
 * @category api/vegetation
 */
export function grassBands(options: GrassOptions): GrassBandPlan[] {
	const area = options.area.size;
	const shapes = Math.max(1, Math.floor(options.shapes ?? 1));
	const blades = Math.max(1, Math.floor(options.blades ?? 13));
	const segments = Math.max(1, Math.floor(options.segments ?? 3));
	const high = Math.max(1, Math.floor(options.count));
	const given = options.bands;
	const total = given?.length ?? DEFAULT_BAND_EDGES.length;
	if (total === 0) throw new Error('the grass needs at least one distance band, and got none.');
	const plans: GrassBandPlan[] = [];
	for (let index = 0; index < total; index++) {
		const band = given?.[index];
		const before = plans[index - 1];
		const far =
			band?.far ??
			(index < DEFAULT_BAND_EDGES.length
				? (DEFAULT_BAND_EDGES[index] as number) * area
				: (before as GrassBandPlan).far * 1.8);
		if (!(far > 0) || !Number.isFinite(far))
			throw new Error(
				`band ${index} of the grass needs a far distance that is a finite number above 0, and got ${far}.`,
			);
		if (before && far <= before.far)
			throw new Error(
				`band ${index} of the grass ends at ${far} m, which is not beyond the band before it at ${before.far} m.`,
			);
		const share =
			band?.share ??
			(index < DEFAULT_BAND_SHARES.length
				? (DEFAULT_BAND_SHARES[index] as number)
				: (before as GrassBandPlan).share * 0.5);
		if (!(share > 0) || share > 1)
			throw new Error(
				`band ${index} of the grass needs a share above 0 and at most 1, and got ${share}.`,
			);
		const nearShare = plans.length > 0 ? (plans[0] as GrassBandPlan).share : share;
		const bandSegments = Math.max(1, Math.floor(band?.segments ?? segments - index));
		const bandHigh = Math.max(1, Math.round(high * share));
		const shapeHigh = Math.ceil(bandHigh / shapes);
		// Each batch draws its own share of its rows, so a band's count at a preset is the sum of the
		// batches' shares, which can exceed the band's High count when the shapes do not divide it.
		const countAt = (preset: QualityPreset) => shapes * Math.ceil(shapeHigh * PRESET_SHARE[preset]);
		const rows = countAt('ultra');
		plans.push({
			near: index === 0 ? 0 : (before as GrassBandPlan).far,
			far,
			counts: {
				low: countAt('low'),
				medium: countAt('medium'),
				high: countAt('high'),
				ultra: rows,
			},
			triangles: blades * (2 * bandSegments - 1),
			rows,
			rowBytes: rows * GRASS_ROW_BYTES,
			share,
			segments: bandSegments,
			widen: band?.widen ?? nearShare / share,
		});
	}
	return plans;
}

/**
 * Makes the grass: bands by distance from the camera, each with a batch for every tuft shape, and
 * the call that draws a preset's share. The page calls `fit` with the preset that the engine runs.
 *
 * @param ctx The sketch's context.
 * @param options The ground, the area, the count, the seed and the bands.
 * @returns The grass's bands and batches, ready to draw.
 * @category api/vegetation
 */
export function createGrass(ctx: SketchContext, options: GrassOptions): Grass {
	const shapes = Math.max(1, Math.floor(options.shapes ?? 1));
	const blades = Math.max(1, Math.floor(options.blades ?? 13));
	const material = ctx.materials.shader({
		wgsl: grassShader,
		textures: options.wind
			? { wind: options.wind.texture, airSettings: readingTexture(ctx.textures, options.wind.air) }
			: stillTextures(ctx.textures),
		color: '#5f9a2a',
		vertexColors: true,
		roughness: 0.75,
		specularIntensity: 0.4,
		doubleSided: true,
		contactShadows: false,
		uniforms: {
			windBox: options.wind?.size ?? 0,
			windStrength: options.wind ? 1 : 0,
			windLayer: 0,
			sway: options.sway ?? 0.04,
		},
	});
	const batches: InstanceBatch[] = [];
	const shares: number[] = [];
	const bands: {
		near: number;
		far: number;
		count: number;
		triangles: number;
		batches: InstanceBatch[];
	}[] = [];
	const plans = grassBands(options);
	for (let index = 0; index < plans.length; index++) {
		const plan = plans[index] as GrassBandPlan;
		const bandHigh = plan.counts.high;
		const own: InstanceBatch[] = [];
		for (let shape = 0; shape < shapes; shape++) {
			const shapeHigh = Math.ceil(bandHigh / shapes);
			const capacity = Math.ceil(shapeHigh * PRESET_SHARE.ultra);
			const salt = index * shapes;
			const rows = ordered(placeTufts(options, shape, capacity, salt), shapeHigh);
			const batch = ctx.scene.createInstances(
				ctx.geometry.fromArrays(tuftMesh(101 + shape, blades, plan.segments, plan.widen)),
				rows.length,
				{
					material,
					castShadows: false,
					receiveShadows: true,
					values: true,
					ranges: true,
				},
			);
			const positions = batch.positions;
			const rotations = batch.rotations;
			const scales = batch.scales;
			const values = batch.values as Float32Array;
			const ranges = batch.ranges as Float32Array;
			rows.forEach((tuft, row) => {
				positions.set([tuft.x, tuft.y, tuft.z], row * 3);
				rotations.set(quat.fromEuler(spin, 0, tuft.turn, 0), row * 4);
				scales.set([tuft.size, tuft.size, tuft.size], row * 3);
				// The shader reads the tint from the row's second value.
				values[row * 4 + 1] = tuft.tint;
				// The row draws between the band's distances. The engine fades each edge over a
				// share of the range, so the two bands' tufts cross-fade along the boundary instead
				// of one set of blades stopping where the next starts.
				ranges[row * 2] = plan.near;
				ranges[row * 2 + 1] = plan.far;
			});
			batch.markDirty();
			batches.push(batch);
			own.push(batch);
			shares.push(shapeHigh);
		}
		bands.push({
			near: plan.near,
			far: plan.far,
			count: bandHigh,
			triangles: plan.triangles,
			batches: own,
		});
	}
	const fit = (preset: QualityPreset) => {
		const share = PRESET_SHARE[preset];
		batches.forEach((batch, index) => {
			batch.setActiveCount(Math.min(batch.count, Math.ceil((shares[index] as number) * share)));
		});
	};
	fit(ctx.quality.preset);
	const setWindLayer = (field: WindField) => material.setUniform('windLayer', field.texture.layer);
	return { bands, batches, fit, setWindLayer };
}

/** The texture that holds the field's steady settings, three texels of four numbers each. */
function readingTexture(textures: Textures, air: WindField['air']): Texture {
	const data = new Float32Array(12);
	data.set(air.base, 0);
	data.set(air.gust, 4);
	data.set(air.swirl, 8);
	return textures.fromData({ width: 3, height: 1, format: 'rgba16float', data });
}

/** A still field's textures, for grass that names no wind field. */
const STILL = new WeakMap<Textures, { wind: Texture; airSettings: Texture }>();

function stillTextures(textures: Textures): { wind: Texture; airSettings: Texture } {
	const held = STILL.get(textures);
	if (held) return held;
	const black = new Float32Array(4);
	const made = {
		wind: textures.fromData({ width: 1, height: 1, depth: 1, format: 'rgba16float', data: black }),
		airSettings: textures.fromData({ width: 1, height: 1, format: 'rgba16float', data: black }),
	};
	STILL.set(textures, made);
	return made;
}
