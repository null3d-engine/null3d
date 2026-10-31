// The water add-on's surface: one material that draws a river and a lake from their descriptions,
// with waves and ripples that the current carries, caustics on the bed, foam, a soft shore that
// reads the scene's own depth, and a mirror of the banks and the sky that redraws as often as the
// quality preset affords. The same material draws from below, so a camera that dips under the water
// keeps its surface. Where two bodies meet, as at a river's mouth, the junction map gives each point
// to one body and lets the river's waves give way to the lake's without a seam.
import {
	declareAddonNamespace,
	defineFeature,
	FeatureHost,
	type MeshArrays,
	type QualityPreset,
	type ShaderOptions,
	type SketchContext,
	type Texture,
} from '@null3d/engine';
import { type Junctions, junctions } from './junction';
import { bodyMesh, type MeshDetail } from './mesh';
import { type WaterBody, type WaterShape, waterBody } from './shape';
import waterShader from './water.wgsl';

/** The add-on's names, claimed once as the sketch's module loads. */
const NAMESPACE = declareAddonNamespace({
	name: 'water',
	package: '@null3d/water',
	errorCodes: [2200, 2299],
});

/** The presets in the order that a setting's row gives them. */
const PRESETS = ['low', 'medium', 'high', 'ultra'] as const;
/** The frames between two draws of the reflection at each preset, before the governor's steps. */
const REFLECT_EVERY = [2, 2, 1, 1] as const;
/** The most frames between two reflection draws that the governor may reach. */
const REFLECT_EVERY_MAX = 16;
/**
 * The reflection pass's time at full quality, per frame, on each preset: the shared figure from
 * the S25's check of planar reflections, halved where the cadence draws every other frame.
 */
const REFLECT_MS: readonly [number, number, number, number] = [1.7, 1.7, 3.4, 3.4];

/** The ripple strength that the water takes when the caller gives none. */
const RIPPLE = 1;
/** The meters of the gap to the bed over which the water fades to nothing at a shore. */
const SOFTNESS = 0.12;

/** The long waves that move the water's vertices: each one's direction, wave number and speed. */
export const LONG_WAVES = [
	[1.0, 0.15, 2.3, 0.9],
	[0.8, -0.6, 3.7, 0.7],
	[0.6, 0.8, 5.9, 0.5],
] as const;

/**
 * A map of the foam around things that break the water's surface, such as stones.
 *
 * @category api/water
 */
export interface FoamMap {
	/**
	 * The map. Its red channel holds how near each point lies to something that breaks the surface,
	 * from 1 at the thing's edge to 0 a little way off.
	 */
	texture: Texture;
	/** The world point that the map's first texel covers, as [x, z] in meters. */
	origin: readonly [x: number, z: number];
	/** The world size that the map covers, as [x, z] in meters. */
	size: readonly [x: number, z: number];
}

/**
 * The standard material values that the water's surface takes.
 *
 * @category api/water
 */
export type WaterMaterialOptions = Omit<
	ShaderOptions<typeof waterShader>,
	'wgsl' | 'uniforms' | 'textures' | 'sceneInputs'
>;

/**
 * Options of `createWater`.
 *
 * @category api/water
 */
export interface WaterOptions {
	/**
	 * The water's body or bodies: a river, a lake, or several of them that share one surface
	 * material and one reflection.
	 */
	readonly shapes: WaterShape | readonly WaterShape[];
	/** The height of the water's surface, in meters. It is 0 by default. */
	readonly level?: number;
	/**
	 * A map of foam around the things that break the surface. Without one the water foams only
	 * where it thins at a shore.
	 */
	readonly foam?: FoamMap;
	/** The water's ripples, as a factor of their base height, from 0. It is 1 by default. */
	readonly ripple?: number;
	/** The meters of the gap to the bed over which the water fades at a shore. It is 0.12 by default. */
	readonly softness?: number;
	/**
	 * The frames between two draws of the reflection at each preset, which replaces the add-on's
	 * own cadence for the presets that it names. The frame-budget governor may still double it while
	 * frames take too long. It is 2 on Low and Medium and 1 on High and Ultra.
	 */
	readonly reflectionEvery?: Partial<Record<QualityPreset, number>>;
	/**
	 * The layers that the reflection pass draws, as a 32-bit mask. It is the camera's layers by
	 * default. Give the layer of the objects that the water mirrors to leave out the things that lie
	 * on or under its surface.
	 */
	readonly layers?: number;
	/**
	 * The reflection's size as a share of the render size each way: 1, 0.5 or 0.25. It is the render
	 * size by default. A smaller share softens the reflection and costs less.
	 */
	readonly reflectionScale?: 1 | 0.5 | 0.25;
	/** How fine the surface's mesh is, for the bodies that give no detail of their own. */
	readonly mesh?: MeshDetail;
	/**
	 * Where the surface reads the depth of the bed: `'scene'`, the copy of the opaque scene's depth
	 * behind each pixel, or `'shape'`, the depth that each shape describes, carried in the mesh's
	 * vertex colors. It is `'scene'` by default. `'shape'` suits a bed that the scene states rather
	 * than draws, or one whose drawn shape differs from the depth that the water should read.
	 */
	readonly bed?: 'scene' | 'shape';
	/** The standard material values, such as the volume's tint and its thickness. */
	readonly material?: WaterMaterialOptions;
}

/**
 * Water that `createWater` made.
 *
 * @category api/water
 */
export interface Water {
	/** The height of the water's surface, in meters. */
	readonly level: number;
	/** The bodies of water that the surface draws, in the order that the shapes give. */
	readonly bodies: readonly WaterBody[];
	/** The frames between two draws of the reflection now. */
	readonly reflectionEvery: number;
	/**
	 * Draws the reflection in its turn if this frame's cadence draws it. Call once in each frame,
	 * after the camera moves and before the engine draws.
	 */
	update(): void;
	/**
	 * The height of the water's surface at a point and a sketch time, in meters, as its long waves
	 * move it. It uses the current of the body that the point lies over. Where two bodies meet, it
	 * follows the surface there, which lies flat and mixes the river's waves into the lake's.
	 */
	surfaceHeight(x: number, z: number, t: number): number;
	/**
	 * The current of the body that a point lies over, as a velocity in meters a second, written into
	 * `out`. It is zero for still water and outside every body. Where a river runs into
	 * a lake, the lake owns the water inside its shore.
	 */
	currentAt(x: number, z: number, out: [x: number, z: number]): void;
	/** Sets the light that the ripples focus on the bed, as a linear color. */
	setCaustics(light: readonly [x: number, y: number, z: number]): void;
	/** Removes the surface, its reflection pass and its material. */
	destroy(): void;
}

/** The passes that the add-on added, so that each one names a texture of its own. */
let passes = 0;

/** The bodies that a shape or a list of shapes gives. */
function bodyList(shapes: WaterShape | readonly WaterShape[]): WaterBody[] {
	const list = Array.isArray(shapes) ? shapes : [shapes as WaterShape];
	if (list.length === 0) throw new Error('@null3d/water: createWater needs at least one shape');
	return list.map((shape) => waterBody(shape));
}

/**
 * The cadence that each preset takes, with the caller's own cadence where it names one. It is the
 * row that the feature host resolves for the preset in use.
 */
function cadenceRow(
	cadence: Partial<Record<QualityPreset, number>> | undefined,
): [number, number, number, number] {
	const row = PRESETS.map((preset, index) => {
		const given = cadence?.[preset];
		const every = Math.round(given ?? (REFLECT_EVERY[index] as number));
		if (!Number.isFinite(every) || every < 1 || every > REFLECT_EVERY_MAX)
			throw new Error(
				`@null3d/water: a reflection cadence must be from 1 to ${REFLECT_EVERY_MAX} frames, and it is ${given}`,
			);
		return every;
	});
	return row as [number, number, number, number];
}

/**
 * The height of a water surface at a point and a sketch time, in meters, as its long waves move it.
 * A `current` carries the whole set downstream, with each wave's direction turned into the
 * current's frame; still water keeps the authored directions and each wave's own speed. `ripple`
 * scales them.
 *
 * @category api/water
 */
export function waveHeight(
	x: number,
	z: number,
	t: number,
	level: number,
	current: readonly [x: number, z: number],
	ripple: number,
): number {
	const speed = Math.hypot(current[0], current[1]);
	const moving = speed > 1e-5;
	const cx = moving ? current[0] / speed : 0;
	const cz = moving ? current[1] / speed : 0;
	let height = level;
	for (const [ownX, ownZ, k, ownSpeed] of LONG_WAVES) {
		const length = Math.hypot(ownX, ownZ);
		const along = ownX / length;
		const across = ownZ / length;
		// The authored direction turned into the current's frame, and the current's phase.
		const dx = moving ? cx * along - cz * across : along;
		const dz = moving ? cz * along + cx * across : across;
		const phase = moving
			? k * (dx * x + dz * z - speed * t * (dx * cx + dz * cz))
			: k * (along * x + across * z) - ownSpeed * t;
		height += (ripple * 0.05 * Math.sin(phase)) / k;
	}
	return height;
}

/** The bytes of one array that a water mesh was made from: a typed array's bytes, or four a number. */
function arrayBytes(values: unknown): number {
	if (values === undefined) return 0;
	const array = values as { readonly byteLength?: number; readonly length?: number };
	return array.byteLength ?? (array.length ?? 0) * 4;
}

/** The bytes of the arrays of one water mesh that the add-on made. */
function meshArrayBytes(arrays: MeshArrays): number {
	return (
		arrayBytes(arrays.positions) +
		arrayBytes(arrays.normals) +
		arrayBytes(arrays.uvs) +
		arrayBytes(arrays.uvs1) +
		arrayBytes(arrays.colors) +
		arrayBytes(arrays.indices)
	);
}

/** A texture of one black texel, which a water without a foam map samples. */
function noFoam({ textures }: SketchContext): Texture {
	return textures.fromData({
		width: 1,
		height: 1,
		data: new Uint8Array(4),
		colorSpace: 'linear',
	});
}

/** The junction map's texture, or one texel that names no junction where no two bodies meet. */
function junctionTexture({ textures }: SketchContext, map: Junctions | undefined): Texture {
	return textures.fromData({
		width: map?.width ?? 1,
		height: map?.height ?? 1,
		data: map?.data ?? new Uint8Array([0, 255, 0, 255]),
		colorSpace: 'linear',
	});
}

/**
 * Makes the water that a scene draws, and the reflection pass that mirrors the scene in it. The
 * bodies come from one description: a river that follows a line, or a lake that fills an outline.
 * The surface reads the copy of the opaque scene's depth, or the bed that the shapes describe, so
 * its shores fade against the bed, and the reflection redraws as often as the quality preset
 * affords.
 *
 * @category api/water
 */
export function createWater(ctx: SketchContext, options: WaterOptions): Water {
	const { scene, geometry, materials, textures, render, quality } = ctx;
	const level = options.level ?? 0;
	const bodies = bodyList(options.shapes);
	const foam = options.foam;
	const foamOrigin = foam?.origin ?? [0, 0];
	const foamSize = foam?.size ?? [1, 1];
	for (const size of foamSize)
		if (!Number.isFinite(size) || size <= 0)
			throw new Error('@null3d/water: a foam map size must be above 0 in each axis');
	const pass = render.addPass({
		kind: 'reflection',
		writes: passes === 0 ? 'water' : `water${passes + 1}`,
		plane: { point: [0, level, 0] },
		...(options.layers !== undefined && { layers: options.layers }),
		...(options.reflectionScale !== undefined && { scale: options.reflectionScale }),
	});
	passes++;
	const mirror = textures.fromPass(pass);
	const ownFoam = foam === undefined;
	const foamMap = foam?.texture ?? noFoam(ctx);
	const shapes = Array.isArray(options.shapes) ? options.shapes : [options.shapes as WaterShape];
	const bedFromShape = options.bed === 'shape';
	const arrays = bodies.map((body, index) => {
		const shape = shapes[index] as WaterShape;
		return bodyMesh(shape, body, level, shape.mesh ?? options.mesh ?? {}, index, bedFromShape);
	});
	// The junction map also gives the vertices near a meeting the river's current there.
	const junction = junctions(bodies, arrays);
	const junctionMap = junctionTexture(ctx, junction);
	const material = materials.shader({
		color: '#ffffff',
		roughness: 0.03,
		metalness: 0,
		ior: 1.33,
		transmission: 1,
		// Both faces draw, so the surface shows from under the water too.
		doubleSided: true,
		alphaMode: 'blend',
		thickness: 0.5,
		attenuationColor: '#93b59a',
		attenuationDistance: 0.9,
		...options.material,
		// The shape's bed rides in the vertex colors, which the material reads there.
		...(bedFromShape && { vertexColors: true }),
		wgsl: waterShader,
		// The water's depth comes from the scene's own bed behind each pixel, or from the shapes.
		sceneInputs: ['sceneDepth'],
		textures: { mirror, foamMap, junctionMap },
		uniforms: {
			ripple: options.ripple ?? RIPPLE,
			softness: options.softness ?? SOFTNESS,
			caustics: [0, 0, 0],
			foamOrigin: [foamOrigin[0], foamOrigin[1]],
			foamSize: [foamSize[0], foamSize[1]],
			junctionOrigin: junction ? [junction.origin[0], junction.origin[1]] : [0, 0],
			junctionSize: junction ? [junction.size[0], junction.size[1]] : [0, 0],
			bedFromShape: bedFromShape ? 1 : 0,
		},
	});
	let meshBytes = 0;
	const meshes = arrays.map((mesh) => {
		meshBytes += meshArrayBytes(mesh);
		return scene.createMesh({
			mesh: geometry.fromArrays(mesh),
			material,
			position: [0, 0, 0],
			receiveShadows: true,
		});
	});
	// The feature carries the cadence through the sketch's quality: the preset gives the row, and
	// the frame-budget governor doubles it while frames take too long. The stats overlay reads the
	// cadence and the pass's share of a frame from the host's figures.
	let every = 1;
	/** True while the `water-bounds` debug view draws. */
	let debugBounds = false;
	const host = new FeatureHost({
		quality,
		tier: ctx.engine.capabilities.tier,
		page: ctx.page,
		namespace: NAMESPACE,
	});
	host.add(
		defineFeature({
			name: 'water',
			gpu: { passes: [pass] },
			settings: {
				reflectionEvery: {
					presets: cadenceRow(options.reflectionEvery),
					values: { min: 1, max: REFLECT_EVERY_MAX, whole: true },
					governor: 'double',
				},
			},
			budget: { presets: REFLECT_MS, min: 0.25 },
			// The reflection target is the render graph's, so the figure counts the arrays, the
			// junction map and the foam texture that the add-on made.
			memory: () => meshBytes + junctionMap.bytes + (ownFoam ? foamMap.bytes : 0),
			quality: (_preset, _settings, own) => {
				every = own.settings.reflectionEvery as number;
			},
			// A debug view of the add-on's own: the bounds of each water body at the surface.
			debugViews: [
				{
					name: 'water-bounds',
					set: (active) => {
						debugBounds = active;
					},
				},
			],
		}),
	);
	let frame = 0;
	const current: [number, number] = [0, 0];
	const causticLight: [number, number, number] = [0, 0, 0];
	const still: [number, number] = [0, 0];
	const carried: [number, number] = [0, 0];
	// The body that owns a point: the one that the junction map names, else a lake whose shore holds
	// it, else the first body that holds it, as the surface draws them.
	const over = (x: number, z: number): WaterBody | undefined => {
		const owner = junction?.ownerAt(x, z) ?? -1;
		if (owner >= 0) return bodies[owner];
		let first: WaterBody | undefined;
		for (const body of bodies)
			if (body.contains(x, z)) {
				if (body.kind === 'lake') return body;
				first ??= body;
			}
		return first;
	};
	return {
		level,
		bodies,
		get reflectionEvery() {
			return every;
		},
		update() {
			// The add-on draws its own debug view: each body's bounds at the water's surface.
			if (debugBounds) {
				for (const body of bodies)
					ctx.debug.box([body.minX, level, body.minZ], [body.maxX, level, body.maxZ], '#4fc3f7');
			}
			if (every <= 1) {
				render.setPassEnabled(pass, true);
				return;
			}
			frame = (frame + 1) % every;
			render.setPassEnabled(pass, frame === 0);
		},
		surfaceHeight(x, z, t) {
			const ripple = options.ripple ?? RIPPLE;
			(over(x, z) ?? bodies[0])?.currentAt(x, z, current);
			if (!junction) return waveHeight(x, z, t, level, current, ripple);
			const share = junction.shareAt(x, z);
			const flatness = junction.flatnessAt(x, z);
			if (share >= 1 && flatness <= 0) return waveHeight(x, z, t, level, current, ripple);
			const moving = junction.currentAt(x, z, carried) ? carried : current;
			let height = waveHeight(x, z, t, level, moving, ripple);
			if (share < 1) height += (waveHeight(x, z, t, level, still, ripple) - height) * (1 - share);
			return level + (height - level) * (1 - flatness);
		},
		currentAt(x, z, out) {
			const body = over(x, z);
			if (!body) {
				out[0] = 0;
				out[1] = 0;
				return;
			}
			body.currentAt(x, z, out);
		},
		setCaustics(light) {
			// A caller may set the mood every frame, so an unchanged light costs nothing.
			if (
				causticLight[0] === light[0] &&
				causticLight[1] === light[1] &&
				causticLight[2] === light[2]
			)
				return;
			causticLight[0] = light[0];
			causticLight[1] = light[1];
			causticLight[2] = light[2];
			material.set({ caustics: causticLight });
		},
		destroy() {
			host.destroy();
			for (const mesh of meshes) mesh.destroy();
			render.removePass(pass);
			material.destroy();
			junctionMap.destroy();
			if (ownFoam) foamMap.destroy();
		},
	};
}
