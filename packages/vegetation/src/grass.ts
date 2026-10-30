// GPU grass for null3D: tufts of bent blades over a ground, placed by integer hashes and drawn in
// instance batches. The CPU path below builds the rows once and both GPU paths draw them; the
// WebGPU blade list, which culls in a compute pass, comes later. The colour hands over to the
// terrain through the blades' own colours, and the per-preset share thins the field.
import { type InstanceBatch, type QualityPreset, quat, type SketchContext } from '@null3d/engine';
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
	/** The wind's direction in plan, which the blades bend toward. The default is (0.8, 0.6). */
	readonly wind?: readonly [number, number];
	/** How far the blades bend at their tips, in meters. The default is 0.12. */
	readonly sway?: number;
}

/**
 * The grass that `createGrass` made: one instance batch for each tuft shape, and the call that
 * draws a preset's share of them.
 *
 * @category api/vegetation
 */
export interface Grass {
	/** The batches, one for each shape. Each draws its active rows. */
	readonly batches: readonly InstanceBatch[];
	/** Draws the preset's share of the tufts, from the first row of each batch. */
	fit(preset: QualityPreset): void;
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
	/** The tuft's phase in the wind, in radians. */
	readonly phase: number;
	/** A value from 0 to 1 that picks the tuft's tint. */
	readonly tint: number;
}

/**
 * Places the tufts of one shape on the ground, by integer hash, and skips the ground steeper than
 * the option allows. The calls with one seed, shape and count give the same list on every device.
 *
 * @category api/vegetation
 */
export function placeTufts(options: GrassOptions, shape: number, count: number): GrassTuft[] {
	const { area, seed, height } = options;
	const maxSlope = options.maxSlope ?? 0.6;
	const step = 0.25;
	const tufts: GrassTuft[] = [];
	for (let i = 0; tufts.length < count && i < count * ATTEMPTS; i++) {
		const x = area.x + (unitAt(seed, i, shape, 0) - 0.5) * area.size;
		const z = area.z + (unitAt(seed, i, shape, 1) - 0.5) * area.size;
		const y = height(x, z);
		const dx = (height(x + step, z) - height(x - step, z)) / (2 * step);
		const dz = (height(x, z + step) - height(x, z - step)) / (2 * step);
		if (Math.hypot(dx, dz) > maxSlope) continue;
		tufts.push({
			x,
			y: y - LIFT,
			z,
			turn: unitAt(seed, i, shape, 2) * Math.PI * 2,
			size: 0.75 + 0.6 * unitAt(seed, i, shape, 3),
			phase: unitAt(seed, i, shape, 4) * Math.PI * 2,
			tint: unitAt(seed, i, shape, 5),
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
 * dark root to a lighter tip.
 *
 * @category api/vegetation
 */
export function tuftMesh(seed: number, blades: number, segments: number): TuftMesh {
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
		const width = 0.016 + 0.012 * next();
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
 * Makes the grass: one batch for each tuft shape, filled with the placed tufts, and the call that
 * draws a preset's share. The page calls `fit` with the preset that the engine runs.
 *
 * @param ctx The sketch's context.
 * @param options The ground, the area, the count and the seed.
 * @returns The grass's batches, ready to draw.
 * @category api/vegetation
 */
export function createGrass(ctx: SketchContext, options: GrassOptions): Grass {
	const shapes = Math.max(1, Math.floor(options.shapes ?? 1));
	const blades = Math.max(1, Math.floor(options.blades ?? 13));
	const segments = Math.max(1, Math.floor(options.segments ?? 3));
	const high = Math.max(1, Math.floor(options.count));
	const material = ctx.materials.shader({
		wgsl: grassShader,
		color: '#5f9a2a',
		vertexColors: true,
		roughness: 0.75,
		specularIntensity: 0.4,
		doubleSided: true,
		contactShadows: false,
		uniforms: {
			wind: options.wind ?? [0.8, 0.6],
			sway: options.sway ?? 0.12,
		},
	});
	const batches: InstanceBatch[] = [];
	const shares: number[] = [];
	for (let shape = 0; shape < shapes; shape++) {
		const shapeHigh = Math.ceil(high / shapes);
		const capacity = Math.ceil(shapeHigh * PRESET_SHARE.ultra);
		const rows = ordered(placeTufts(options, shape, capacity), shapeHigh);
		const batch = ctx.scene.createInstances(
			ctx.geometry.fromArrays(tuftMesh(101 + shape, blades, segments)),
			rows.length,
			{
				material,
				castShadows: false,
				receiveShadows: true,
				values: true,
			},
		);
		const positions = batch.positions;
		const rotations = batch.rotations;
		const scales = batch.scales;
		const values = batch.values as Float32Array;
		rows.forEach((tuft, row) => {
			positions.set([tuft.x, tuft.y, tuft.z], row * 3);
			rotations.set(quat.fromEuler(spin, 0, tuft.turn, 0), row * 4);
			scales.set([tuft.size, tuft.size, tuft.size], row * 3);
			values.set([tuft.phase, tuft.tint, Math.cos(tuft.turn), Math.sin(tuft.turn)], row * 4);
		});
		batch.markDirty();
		batches.push(batch);
		shares.push(shapeHigh);
	}
	const fit = (preset: QualityPreset) => {
		const share = PRESET_SHARE[preset];
		batches.forEach((batch, index) => {
			batch.setActiveCount(Math.min(batch.count, Math.ceil((shares[index] as number) * share)));
		});
	};
	fit(ctx.quality.preset);
	return { batches, fit };
}
