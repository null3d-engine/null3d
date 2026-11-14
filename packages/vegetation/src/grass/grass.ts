// GPU grass for null3D: tufts of bent blades over a ground, placed by integer hashes. WebGPU makes
// the blade list in a compute pass, which writes the draw's rows and the count that its near
// shadows read; WebGL2 builds the same rows as an instance batch. The colour hands over to the
// terrain through the blades' own colours, and the per-preset share thins the field.
import {
	defineFeature,
	type InstanceBatch,
	type PerspectiveCamera,
	type QualityPreset,
	quat,
	type RenderPass,
	type ShaderOptions,
	type SketchContext,
	type Texture,
	type Textures,
} from '@null3d/engine';
import type { WindField } from '@null3d/wind';
import { unitAt } from '../core/hash';
import { radians } from '../core/math';
import type { GrassBlade } from '../core/record';
import { bladeWidth } from '../leaf/grass-blade';
import grassShader from './grass.wgsl';
import bladesShader from './grass-blades.wgsl';

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
/** The texels across the blade list's tuft data texture; two texels hold one tuft. */
const TUFT_COLUMNS = 2048;
/** The numbers that a blade-list pass takes: the camera and its lens, then the count and material. */
const CULL_VALUES = 24;

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
	/** The shapes of tuft, each one draw. The default is 1. */
	readonly shapes?: number;
	/** Says whether grass grows at a point, for ground that holds a road or a wall. Without it, grass grows everywhere. */
	readonly where?: (x: number, z: number) => boolean;
	/** The blades' color, which meets the ground's own at their roots. The default is a fresh green. */
	readonly color?: string;
	/**
	 * A species' blade, whose width, profile and tip the cover's blades take. Give it with the
	 * species' own colour, as `grassCover` returns them, so the cover reads as the same grass where
	 * a plant of that species stands in it. Without it a blade narrows to a point from its root.
	 */
	readonly blade?: GrassBlade;
	/** The steepest ground that a tuft grows on, as rise over run. The default is 0.6. */
	readonly maxSlope?: number;
	/**
	 * Where grass may grow. A candidate on ground that the mask refuses is skipped, as water, a rock
	 * or a footprint leaves no grass. Leave it out to grow grass wherever the ground is not steep.
	 */
	readonly mask?: (x: number, z: number) => boolean;
	/**
	 * The wind add-on's field, the one that the leaf material reads. The blades bend in its air,
	 * and a page that leaves it out grows grass that stands still.
	 */
	readonly wind?: WindField;
	/** How far a blade bends at its tip for each meter a second of air. The default is 0.04. */
	readonly sway?: number;
	/**
	 * The distance from the camera out to which the blades sway, in meters. Past it they stand
	 * still, so a far shadow cascade that only the grass reaches keeps the layer it holds. The
	 * default, 0, sways at every distance.
	 */
	readonly swayDistance?: number;
	/**
	 * The camera that draws the hill. Give it to cull the tiles outside the view and to thin the
	 * far tufts, which widens their blades so the cover stays the same. Without it every tuft in
	 * the preset's share draws at full width, as on a page that does not draw the hill.
	 */
	readonly camera?: PerspectiveCamera;
	/**
	 * True lets WebGPU build the blade list in a compute pass, and the grass's near shadows follow
	 * its count. The default is true. Give false for a page that drives the rows itself, which
	 * draws an instance batch on both GPU paths.
	 */
	readonly compute?: boolean;
}

/**
 * The grass that `createGrass` made: the draws, and the calls that draw a preset's share and give
 * them the frame's air.
 *
 * @category api/vegetation
 */
export interface Grass {
	/** The drives, one for each shape: WebGPU's compute list, or WebGL2's instance batch. */
	readonly draws: readonly GrassDraw[];
	/** The instance batches that draw, which is empty when a compute pass fills the rows. */
	readonly batches: readonly InstanceBatch[];
	/** Draws the preset's share of the tufts. */
	fit(preset: QualityPreset): void;
	/**
	 * Changes the distance from the camera out to which the blades sway, in meters. A page that
	 * gives the grass a preset's distance calls it when the preset changes.
	 */
	setSwayDistance(distance: number): void;
	/**
	 * Gives the blades the field's newest state for this frame, as the leaf material takes it, and
	 * the blade list the camera's view. Call it once in each frame, before the frame draws.
	 */
	setWindLayer(field: WindField): void;
}

/**
 * One shape's tufts: the rows that draw them and the draw that fills them.
 *
 * @category api/vegetation
 */
export interface GrassDraw {
	/** The instance batch that WebGL2 draws, or undefined when a compute pass fills the rows. */
	readonly batch?: InstanceBatch;
	/** The material that the rows draw with. */
	readonly material: GrassMaterial;
}

/**
 * The part of a grass material that the grass itself sets.
 *
 * @category api/vegetation
 */
export interface GrassMaterial {
	/** Sets one of the material's uniforms, by the name of its WGSL's field. */
	setUniform(name: string, value: number): void;
}

/**
 * A tuft's place, turn and traits, as the rows take them. The placement reads only integer
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
 * the option allows and the ground that the mask refuses. The calls with one seed, shape and count
 * give the same list on every device.
 *
 * @category api/vegetation
 */
export function placeTufts(options: GrassOptions, shape: number, count: number): GrassTuft[] {
	const { area, seed, height, mask } = options;
	const maxSlope = options.maxSlope ?? 0.6;
	const step = 0.25;
	const tufts: GrassTuft[] = [];
	for (let i = 0; tufts.length < count && i < count * ATTEMPTS; i++) {
		const x = area.x + (unitAt(seed, i, shape, 0) - 0.5) * area.size;
		const z = area.z + (unitAt(seed, i, shape, 1) - 0.5) * area.size;
		if (mask && !mask(x, z)) continue;
		const y = height(x, z);
		const dx = (height(x + step, z) - height(x - step, z)) / (2 * step);
		const dz = (height(x, z + step) - height(x, z - step)) / (2 * step);
		if (Math.hypot(dx, dz) > maxSlope || options.where?.(x, z) === false) continue;
		tufts.push({
			x,
			y: y - LIFT,
			z,
			turn: unitAt(seed, i, shape, 2) * Math.PI * 2,
			size: 0.75 + 0.6 * unitAt(seed, i, shape, 3),
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
 * One tuft's mesh: blades that lean out from its middle and curve over. Each blade is a strip
 * whose normal leans up so it lights like the ground, and whose colours run from a dark root to a
 * lighter tip. A blade narrows to a point, or takes the profile and tip that a species' blade
 * gives it.
 *
 * @category api/vegetation
 */
export function tuftMesh(
	seed: number,
	blades: number,
	segments: number,
	blade?: GrassBlade,
): TuftMesh {
	let index = 0;
	const next = () => unitAt(seed, index++);
	// A species' blade shows its keel: the two halves rise from the midrib by the record's fold, so
	// a row of its cross-section holds a vertex at the midrib between the two sides.
	const across = blade && blade.fold > 0 ? 3 : 2;
	const perBlade = segments * across + 1;
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
		const width = blade?.width ?? 0.016 + 0.012 * next();
		const twist = angle + Math.PI / 2 + (next() - 0.5) * 0.8;
		const [sx, sz] = [Math.cos(twist), Math.sin(twist)];
		// The face's normal, across the strip, leaned up by two thirds.
		const [fx, fz] = [-sz, sx];
		const length = Math.hypot(fx * 0.35, 1, fz * 0.35);
		const [nx, ny, nz] = [(fx * 0.35) / length, 1 / length, (fz * 0.35) / length];
		// A keel turns each half's normal away from the flat face by the fold, so the two halves
		// light apart as the plant's blade does. The across direction, square to the face, is the
		// axis the normal turns about.
		const fold = across === 3 && blade ? radians(blade.fold) : 0;
		const [sinFold, cosFold] = [Math.sin(fold), Math.cos(fold)];
		const along = sx * nx + sz * nz;
		const [ax, ay, az] = [sx - nx * along, -ny * along, sz - nz * along];
		const axis = Math.hypot(ax, ay, az) || 1;
		const first = b * perBlade;
		for (let j = 0; j <= segments; j++) {
			const t = j / segments;
			const cx = ox * (root + lean * t * t);
			const cz = oz * (root + lean * t * t);
			const cy = height * (t - 0.15 * t * t);
			const half = blade ? 0.5 * bladeWidth(width, blade, t) : (width / 2) * (1 - t) ** 0.9;
			// A keel lifts each side of the cross-section, and the tip closes on one vertex.
			const rise = across === 3 && blade ? half * Math.sin(radians(blade.fold)) : 0;
			const shade = 0.3 + 0.7 * t;
			if (j === segments) {
				const v = first + segments * across;
				positions.set([cx, cy, cz], v * 3);
				normals.set([nx, ny, nz], v * 3);
				colors.set([shade * (0.9 + 0.25 * t), shade, shade * (0.85 - 0.2 * t)], v * 3);
				uvs.set([0.5, t], v * 2);
				continue;
			}
			for (let s = 0; s < across; s++) {
				const side = across === 2 ? s * 2 - 1 : s - 1;
				const v = first + j * across + s;
				positions.set(
					[cx + sx * half * side, cy + Math.abs(side) * rise, cz + sz * half * side],
					v * 3,
				);
				const [tx, ty, tz] = [
					nx * cosFold - side * (ax / axis) * sinFold,
					ny * cosFold - side * (ay / axis) * sinFold,
					nz * cosFold - side * (az / axis) * sinFold,
				];
				const turn = Math.hypot(tx, ty, tz) || 1;
				normals.set([tx / turn, ty / turn, tz / turn], v * 3);
				colors.set([shade * (0.9 + 0.25 * t), shade, shade * (0.85 - 0.2 * t)], v * 3);
				uvs.set([s / (across - 1), t], v * 2);
			}
		}
		for (let j = 0; j < segments - 1; j++) {
			for (let s = 0; s < across - 1; s++) {
				const a = first + j * across + s;
				const b = first + (j + 1) * across + s;
				indices.push(a, a + 1, b, a + 1, b + 1, b);
			}
		}
		// The last row closes in the tip's one vertex.
		const last = first + (segments - 1) * across;
		const tip = first + segments * across;
		for (let s = 0; s < across - 1; s++) indices.push(last + s, last + s + 1, tip);
	}
	return { positions, normals, colors, uvs, indices };
}

/** A scratch quaternion for each tuft's turn. */
const spin = quat.create();

/**
 * Orders a draw's tufts so each preset's share is spread over the hill and nearby rows sit
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
 * Makes the grass: one draw for each tuft shape, filled with the placed tufts, and the calls that
 * draw a preset's share and give the blades the frame's air. A page awaits it in its setup.
 *
 * @param ctx The sketch's context.
 * @param options The ground, the area, the count and the seed.
 * @returns The grass's draws, ready to draw.
 * @category api/vegetation
 */
export async function createGrass(ctx: SketchContext, options: GrassOptions): Promise<Grass> {
	const shapes = Math.max(1, Math.floor(options.shapes ?? 1));
	const blades = Math.max(1, Math.floor(options.blades ?? 13));
	const segments = Math.max(1, Math.floor(options.segments ?? 3));
	/** The field's settings as the settings texture holds them, so a change costs one upload. */
	const held = options.wind ? readingData(options.wind.air) : undefined;
	const airSettings = held
		? readingTexture(ctx.textures, held)
		: stillTextures(ctx.textures).airSettings;
	const materialOptions = (): Omit<ShaderOptions, 'wgsl'> => ({
		...(options.wind
			? { textures: { wind: options.wind.texture, airSettings } }
			: { textures: stillTextures(ctx.textures) }),
		color: options.color ?? '#5f9a2a',
		vertexColors: true,
		roughness: 0.75,
		specularIntensity: 0.4,
		doubleSided: true,
		contactShadows: false,
		swayDistance: options.swayDistance ?? 0,
		uniforms: {
			windBox: options.wind?.size ?? 0,
			windStrength: options.wind ? 1 : 0,
			windLayer: 0,
			sway: options.sway ?? 0.04,
			swayDistance: options.swayDistance ?? 0,
			cull: options.camera ? 1 : 0,
		},
	});
	const draws: GrassDraw[] = [];
	const shares: number[] = [];
	const capacities: number[] = [];
	const passes: GradedPass[] = [];
	const compute = options.compute !== false && ctx.engine.capabilities.tier !== 'webgl2';
	const high = Math.max(1, Math.floor(options.count));
	for (let shape = 0; shape < shapes; shape++) {
		const shapeHigh = Math.ceil(high / shapes);
		const wanted = Math.ceil(shapeHigh * PRESET_SHARE.ultra);
		const rows = ordered(placeTufts(options, shape, wanted), shapeHigh);
		const capacity = rows.length;
		capacities.push(capacity);
		if (compute) {
			const draw = await ctx.scene.addComputeInstances(
				defineFeature({
					name: `grass-blades-${shape}`,
					frame: 'opaque',
					kind: 'draw',
					band: 'normal',
					views: ['main'],
				}),
				{
					...materialOptions(),
					shader: grassShader,
					vertices: tuftMesh(101 + shape, blades, segments, options.blade),
					capacity,
					count: 0,
				},
			);
			draw.object.setCastShadows(true);
			draw.object.setReceiveShadows(true);
			const texture = tuftTexture(ctx.textures, rows);
			// The pass's values: the camera's place and flag, its right, up and forward with its
			// lens, then the tufts that the preset draws, the material's index and the data
			// texture's width.
			const values = new Array<number>(CULL_VALUES).fill(0);
			values[16] = Math.min(capacity, shapeHigh);
			values[17] = draw.materialIndex;
			values[18] = TUFT_COLUMNS;
			passes.push({
				values,
				pass: ctx.render.addPass({
					kind: 'compute',
					description: defineFeature({
						name: `grass-blades-${shape}-fill`,
						frame: 'opaque',
						kind: 'compute',
						band: 'before',
					}),
					wgsl: bladesShader,
					buffers: [draw.counts, draw.instances],
					textures: [texture],
					dispatch: [1, 1, 1],
					values,
				}),
			});
			draws.push({ material: draw.material });
		} else {
			const material = ctx.materials.shader({ ...materialOptions(), wgsl: grassShader });
			const batch = ctx.scene.createInstances(
				// The wind bends the blades in the shader, and the field thins by distance itself.
				ctx.geometry.fromArrays({
					...tuftMesh(101 + shape, blades, segments, options.blade),
					levels: false,
				}),
				rows.length,
				{
					material,
					castShadows: true,
					receiveShadows: true,
				},
			);
			const positions = batch.positions;
			const rotations = batch.rotations;
			const scales = batch.scales;
			rows.forEach((tuft, row) => {
				positions.set([tuft.x, tuft.y, tuft.z], row * 3);
				rotations.set(quat.fromEuler(spin, 0, tuft.turn, 0), row * 4);
				scales.set([tuft.size, tuft.size, tuft.size], row * 3);
			});
			batch.markDirty();
			draws.push({ batch, material });
		}
		shares.push(shapeHigh);
	}
	const fit = (preset: QualityPreset) => {
		const share = PRESET_SHARE[preset];
		draws.forEach((entry, index) => {
			const active = Math.min(
				capacities[index] as number,
				Math.ceil((shares[index] as number) * share),
			);
			entry.batch?.setActiveCount(active);
			const filled = passes[index];
			if (filled) {
				filled.values[16] = active;
				ctx.render.setPassUniforms(filled.pass, filled.values);
			}
		});
	};
	fit(ctx.quality.preset);
	// The camera's basis and lens, which the blade list culls and thins by. The world matrix is
	// the frame before's, so a moving camera's cull lags one frame, and the tile's radius covers
	// the hill that the lag moves past the view's edge.
	const world = new Float64Array(16);
	const updateCull = (): void => {
		if (passes.length === 0) return;
		const camera = options.camera;
		const tanY = camera ? Math.tan((camera.fov * Math.PI) / 360) : 0;
		const view = ctx.engine.viewport;
		const aspect = view.width / Math.max(1, view.height);
		for (const filled of passes) {
			const values = filled.values;
			if (camera) {
				camera.getWorldMatrix(world);
				values[0] = world[12] as number;
				values[1] = world[13] as number;
				values[2] = world[14] as number;
				values[3] = 1;
				values[4] = world[0] as number;
				values[5] = world[1] as number;
				values[6] = world[2] as number;
				values[7] = tanY;
				values[8] = world[4] as number;
				values[9] = world[5] as number;
				values[10] = world[6] as number;
				values[11] = aspect;
				// The camera looks down its own -z, which is the world matrix's third column.
				values[12] = -(world[8] as number);
				values[13] = -(world[9] as number);
				values[14] = -(world[10] as number);
				values[15] = camera.near;
				values[19] = camera.far;
			} else {
				values[3] = 0;
			}
			ctx.render.setPassUniforms(filled.pass, values);
		}
	};
	updateCull();
	const setWindLayer = (field: WindField) => {
		for (const entry of draws) entry.material.setUniform('windLayer', field.texture.layer);
		// The cull follows the camera, so a moving page gives the blade list its view each frame.
		if (passes.length > 0) updateCull();
		// The base wind and a sent gust travel through the steady field, which the settings carry.
		// They go up when either changes, so a page's controls reach the blades at once.
		if (held && !sameReading(field.air, held)) {
			held.set(field.air.base, 0);
			held.set(field.air.gust, 4);
			held.set(field.air.swirl, 8);
			held.set(field.air.sent, 12);
			airSettings.update(held);
		}
	};
	const setSwayDistance = (distance: number) => {
		for (const entry of draws) entry.material.setUniform('swayDistance', distance);
	};
	return {
		draws,
		batches: draws.flatMap((entry) => (entry.batch ? [entry.batch] : [])),
		fit,
		setSwayDistance,
		setWindLayer,
	};
}

/** A shape's blade-list pass, which draws the preset's share of its hill. */
interface GradedPass {
	readonly pass: RenderPass;
	/** The pass's values, which the camera's movement changes each frame. */
	readonly values: number[];
}

/**
 * The tuft data that the blade list's pass reads: two texels for each tuft, the first with its
 * place rounded to whole meters and its turn, the second with the rest of the place and its size.
 * The rounding keeps a half float's precision under a millimetre, where a whole place in meters
 * would land centimeters from the tuft that the CPU path would place.
 */
function tuftTexture(textures: Textures, tufts: readonly GrassTuft[]): Texture {
	const texels = Math.max(2, tufts.length * 2);
	const height = Math.ceil(texels / TUFT_COLUMNS);
	const data = new Float32Array(TUFT_COLUMNS * height * 4);
	tufts.forEach((tuft, k) => {
		const x = Math.round(tuft.x);
		const y = Math.round(tuft.y);
		const z = Math.round(tuft.z);
		data.set([x, y, z, tuft.turn], k * 2 * 4);
		data.set([tuft.x - x, tuft.y - y, tuft.z - z, tuft.size], (k * 2 + 1) * 4);
	});
	return textures.fromData({
		width: TUFT_COLUMNS,
		height,
		format: 'rgba16float',
		colorSpace: 'linear',
		filter: 'nearest',
		data,
	});
}

/** The field's settings as the texture holds them: the air, the gust, the swirl and the sent gust. */
function readingData(air: WindField['air']): Float32Array {
	const data = new Float32Array(16);
	data.set(air.base, 0);
	data.set(air.gust, 4);
	data.set(air.swirl, 8);
	data.set(air.sent, 12);
	return data;
}

/** True when the field's settings differ from the numbers the settings texture holds. */
function sameReading(air: WindField['air'], held: Float32Array): boolean {
	// The texture holds the numbers as 32-bit floats, so compare at that precision, or a value
	// that the texture rounds would look changed in every frame.
	for (let i = 0; i < 4; i++)
		if (
			held[i] !== Math.fround(air.base[i] ?? 0) ||
			held[i + 4] !== Math.fround(air.gust[i] ?? 0) ||
			held[i + 8] !== Math.fround(air.swirl[i] ?? 0) ||
			held[i + 12] !== Math.fround(air.sent[i] ?? 0)
		)
			return false;
	return true;
}

/** The texture that holds the field's settings: four texels of four numbers each. */
function readingTexture(textures: Textures, data: Float32Array): Texture {
	return textures.fromData({ width: 4, height: 1, format: 'rgba16float', data });
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
