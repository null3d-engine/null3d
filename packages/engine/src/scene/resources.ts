// Meshes and materials, created through `ctx.geometry` and `ctx.materials`. Each is created once
// and shared by any number of objects and instance batches.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import {
	MAP_SLOT_ANISOTROPY,
	MAP_SLOT_BASE_COLOR,
	MAP_SLOT_BUMP,
	MAP_SLOT_COAT,
	MAP_SLOT_COAT_NORMAL,
	MAP_SLOT_COAT_ROUGHNESS,
	MAP_SLOT_DIFFUSE_TRANSMISSION,
	MAP_SLOT_DIFFUSE_TRANSMISSION_COLOR,
	MAP_SLOT_DISPLACEMENT,
	MAP_SLOT_EMISSIVE,
	MAP_SLOT_IRIDESCENCE,
	MAP_SLOT_IRIDESCENCE_THICKNESS,
	MAP_SLOT_LIGHT,
	MAP_SLOT_LIGHT_MAP_DIRECTION,
	MAP_SLOT_METAL_ROUGH,
	MAP_SLOT_NORMAL,
	MAP_SLOT_OCCLUSION,
	MAP_SLOT_SHEEN_COLOR,
	MAP_SLOT_SHEEN_ROUGHNESS,
	MAP_SLOT_SPECULAR_COLOR,
	MAP_SLOT_SPECULAR_INTENSITY,
	MAP_SLOT_THICKNESS,
	MAP_SLOT_TRANSMISSION,
	MATERIAL_FEATURE_ADDITIVE,
	MATERIAL_FEATURE_ALPHA_HASH,
	MATERIAL_FEATURE_ALPHA_MASK,
	MATERIAL_FEATURE_ALPHA_TO_COVERAGE,
	MATERIAL_FEATURE_ANISOTROPY,
	MATERIAL_FEATURE_BLEND,
	MATERIAL_FEATURE_COAT_SHEEN,
	MATERIAL_FEATURE_DECAL,
	MATERIAL_FEATURE_DOUBLE_SIDED,
	MATERIAL_FEATURE_FLAT_SHADING,
	MATERIAL_FEATURE_IRIDESCENCE,
	MATERIAL_FEATURE_LIGHT_MAP_RGBM,
	MATERIAL_FEATURE_MULTIPLY,
	MATERIAL_FEATURE_NO_CONTACT_SHADOWS,
	MATERIAL_FEATURE_NO_DEPTH_TEST,
	MATERIAL_FEATURE_NO_DEPTH_WRITE,
	MATERIAL_FEATURE_NO_FOG,
	MATERIAL_FEATURE_NO_TONE_MAP,
	MATERIAL_FEATURE_PARALLAX,
	MATERIAL_FEATURE_SCENE_DEPTH,
	MATERIAL_FEATURE_SHADOW_CATCHER,
	MATERIAL_FEATURE_SINGLE_PASS,
	MATERIAL_FEATURE_SUBSURFACE,
	MATERIAL_FEATURE_TRANSLUCENCY,
	MATERIAL_FEATURE_TRANSMISSION,
	MATERIAL_FEATURE_VERTEX_COLORS,
	MATERIAL_FEATURE_WEIGHTED,
	MATERIAL_FEATURE_WIREFRAME,
	MATERIAL_PARAM_ALPHA_CUTOFF,
	MATERIAL_PARAM_ANISOTROPY,
	MATERIAL_PARAM_ANISOTROPY_ROTATION,
	MATERIAL_PARAM_ATTENUATION_COLOR,
	MATERIAL_PARAM_ATTENUATION_DISTANCE,
	MATERIAL_PARAM_CLEARCOAT,
	MATERIAL_PARAM_CLEARCOAT_NORMAL_SCALE,
	MATERIAL_PARAM_CLEARCOAT_ROUGHNESS,
	MATERIAL_PARAM_COLOR,
	MATERIAL_PARAM_DECAL_EDGE_FADE,
	MATERIAL_PARAM_DECAL_FADE_END,
	MATERIAL_PARAM_DECAL_FADE_START,
	MATERIAL_PARAM_DIFFUSE_TRANSMISSION,
	MATERIAL_PARAM_DIFFUSE_TRANSMISSION_COLOR,
	MATERIAL_PARAM_EMISSIVE,
	MATERIAL_PARAM_EMISSIVE_INTENSITY,
	MATERIAL_PARAM_ENV_INTENSITY,
	MATERIAL_PARAM_IOR,
	MATERIAL_PARAM_IRIDESCENCE,
	MATERIAL_PARAM_IRIDESCENCE_IOR,
	MATERIAL_PARAM_IRIDESCENCE_THICKNESS_MAX,
	MATERIAL_PARAM_IRIDESCENCE_THICKNESS_MIN,
	MATERIAL_PARAM_LIGHT_MAP_INTENSITY,
	MATERIAL_PARAM_LIGHT_MAP_OFFSET,
	MATERIAL_PARAM_LIGHT_MAP_SCALE,
	MATERIAL_PARAM_METALNESS,
	MATERIAL_PARAM_NORMAL_SCALE,
	MATERIAL_PARAM_OCCLUSION_STRENGTH,
	MATERIAL_PARAM_OPACITY,
	MATERIAL_PARAM_REFLECTANCE,
	MATERIAL_PARAM_ROUGHNESS,
	MATERIAL_PARAM_SHEEN_COLOR,
	MATERIAL_PARAM_SHEEN_ROUGHNESS,
	MATERIAL_PARAM_SPECULAR_COLOR,
	MATERIAL_PARAM_SPECULAR_INTENSITY,
	MATERIAL_PARAM_SUBSURFACE_COLOR,
	MATERIAL_PARAM_SUBSURFACE_RADIUS,
	MATERIAL_PARAM_THICKNESS,
	MATERIAL_PARAM_TRANSMISSION,
	MATERIAL_PARAM_UV_U,
	MATERIAL_PARAM_UV_V,
	SHADING_CUSTOM_ATTRIBUTE_SHIFT,
	SHADING_CUSTOM_BASE_COLOR,
	SHADING_CUSTOM_CASTER,
	SHADING_CUSTOM_OBJECT_IDS,
	SHADING_CUSTOM_ROW_VALUES,
	SHADING_CUSTOM_TEXTURE_SHIFT,
	SHADING_CUSTOM_TRANSMISSION,
	SHADING_LIT,
	SHADING_TEXCOORDS,
	SHADING_UNLIT,
	SHADING_UNLIT_MAP,
	SHAPE_BOX,
	SHAPE_CAPSULE,
	SHAPE_CIRCLE,
	SHAPE_CYLINDER,
	SHAPE_PLANE,
	SHAPE_RING,
	SHAPE_SPHERE,
	SHAPE_TORUS,
} from '../generated/core';
import {
	PERMUTATION_CASTER,
	PERMUTATION_COAT_SHEEN,
	PERMUTATION_ROW_VALUES,
	PERMUTATION_TRANSLUCENCY,
	PERMUTATION_TRANSMISSION,
	SIZE_MAP_SLOTS,
} from '../generated/gpu';
import type { ShaderVariants } from '../generated/shaders';
import type { CustomShader } from '../shared/images';
import type { WgslUpdate } from '../shared/wgsl-updates';
import { type ColorInput, linearColor, writeLinearColor } from './color';
import type { SceneInput } from './features';
import type { CoreMemory } from './memory';
import {
	arraysProblem,
	meshFromArrays,
	meshFromLevel,
	morphTargetCount,
	replaceMeshIndices,
	updateVertices,
	type VertexLayout,
} from './mesh-arrays';
import { ShaderPreloads } from './shader-preloads';
import { type BuildsLoader, ShaderTemplates } from './shader-templates';
import { Texture } from './textures';
import type { TextureValues, UniformType, UniformValue, UniformValues } from './wgsl-uniforms';

/**
 * @internal What a destroy asks before it frees anything: a description of the first live object
 * or instance batch that uses one of `meshes` or `materials`, or that `rig` animates, or undefined
 * when none does. The scene answers.
 */
export interface ResourceUsers {
	userOf(
		meshes: ReadonlySet<MeshGeometry>,
		materials?: ReadonlySet<Material>,
		rig?: object,
	): string | undefined;
}

/**
 * A lower level of detail of a mesh: a simpler mesh that draws in the base mesh's place. Give its
 * `error`, the `distance` at which it switches in, or the screen `coverage` under which it draws.
 * A level with a measured error, which the asset tool writes, changes the picture by under a pixel
 * at its switch and switches at once. A level given by a distance, by a coverage or by a hand-set
 * error fades over a short band, so its switch does not pop.
 *
 * @category api/geometry
 */
export interface MeshLevel {
	/**
	 * The simpler mesh. It has the base mesh's vertex attributes, and draws with the object's
	 * material or the level's own.
	 */
	mesh: MeshGeometry;
	/**
	 * The level's error: the largest distance between its surface and the base mesh's, in the
	 * units of the base mesh's positions. An object's scale multiplies it. The asset tool stores it
	 * for each level that `--lod` makes.
	 */
	error?: number;
	/**
	 * The distance from the camera to the nearest point of the object's bounds at which the level
	 * switches in, for an object of scale 1. The switch stays there on every screen height and at
	 * every render scale.
	 */
	distance?: number;
	/**
	 * The share of the render's height that the object's bounds cover where the level switches in,
	 * from 0 to 1: it draws while they cover less. This is `MSFT_screencoverage` in a glTF file.
	 * It stays the same on every screen height.
	 */
	coverage?: number;
	/**
	 * True to hand over between two levels in a short band past each switch distance, where a
	 * dither pattern shares the pixels between them, so a switch does not pop. False to switch at
	 * once. The default is `fade` in the options. A level with a measured error changes the picture
	 * by under a pixel at its switch, so its band only costs; the glTF reader switches those at
	 * once.
	 */
	fade?: boolean;
	/**
	 * The material that the level's surface draws with, where it shades more cheaply than the base
	 * mesh's. A level without one draws with the material of the level before it, and the base
	 * level draws with the object's or the batch's own material. Give a far level a material
	 * without a normal map, or with an opaque mask in place of an alpha-tested one.
	 */
	material?: Material;
}

/**
 * Options for `mesh.setLevels`.
 *
 * @category api/geometry
 */
export interface MeshLevelOptions {
	/**
	 * True to hand over between two levels in a short band past each switch distance, where a
	 * dither pattern shares the pixels between them, so a switch does not pop. False to switch at
	 * once. The default is true. A level's own `fade` overrides it.
	 */
	fade?: boolean;
	/**
	 * The vertical field of view, in degrees, at which a level given by its error covers the
	 * threshold's pixels, and a level given by its coverage covers that share of the screen. The
	 * default is 50, three.js's default for a perspective camera.
	 */
	fov?: number;
}

/** The screen height in pixels at which the engine compares a level's error and coverage. */
const LEVEL_REFERENCE_HEIGHT = 1080;
/** The field of view in degrees at which the engine compares a level's error and coverage. */
const LEVEL_REFERENCE_FOV = 50;
/** The level's switch measures, as the engine core names them: error, distance and coverage. */
const LEVEL_SWITCH_ERROR = 0;
const LEVEL_SWITCH_DISTANCE = 1;
const LEVEL_SWITCH_COVERAGE = 2;
/** The most lower levels a mesh takes. */
const MAX_LOWER_LEVELS = 7;

/**
 * A mesh the engine can draw: its id in the engine core, its bounding radius, and its morph
 * targets.
 *
 * @category api/geometry
 */
export class MeshGeometry {
	/** The engine core's id, or 0 once the mesh is destroyed. */
	private liveId: number;
	/** The mesh's lower levels of detail, as `setLevels` gave them. */
	private lowerLevels: readonly MeshLevel[] = [];
	/** The vertex count and format, read from the engine core at the first update. */
	private layout: VertexLayout | undefined;

	/** @internal */
	constructor(
		id: number,
		/** The distance from the mesh's origin to its farthest vertex, at rest. */
		readonly radius: number,
		/** @internal */ readonly core: CoreMemory,
		/** How many morph targets the mesh has. 0 for a mesh without any. */
		readonly morphTargets = 0,
		/**
		 * The morph targets' names, by target, or none when the mesh's arrays named none. Like
		 * three.js's `morphTargetDictionary`, turned around. `mesh.setMorphWeight` takes a name too.
		 */
		readonly morphTargetNames: readonly string[] = [],
		/** The geometry that made the mesh, whose scene says which objects use it. */
		private readonly maker?: Geometry,
	) {
		this.liveId = id;
	}

	/** @internal The engine core's id. Throws E1101 once the mesh is destroyed. */
	get id(): number {
		if (this.liveId === 0)
			throw new EngineError('E1101', 'a call used a mesh after its destroy().');
		return this.liveId;
	}

	/** @internal True until `destroy` runs. */
	get live(): boolean {
		return this.liveId !== 0;
	}

	/**
	 * Destroys the mesh, like three.js's `geometry.dispose()`. The engine frees its GPU memory and
	 * its other data at once, and later meshes take its room. Destroy the objects and instance
	 * batches that use it first, in the same frame or before. Its lower levels go with it, since a
	 * level draws its base's vertices. Throws E1111 while one
	 * still uses it, and E1101 for a mesh that is destroyed already. Later calls that pass the mesh
	 * throw E1101.
	 */
	destroy(): void {
		const call = 'mesh.destroy';
		// A level draws its base mesh's vertices, so the base takes it along. A level that the
		// sketch destroyed itself is gone already.
		const meshes = [
			this,
			...this.lowerLevels.filter((level) => level.mesh.live).map((level) => level.mesh),
		];
		const user = this.maker?.users?.userOf(new Set(meshes));
		if (user)
			throw new EngineError(
				'E1111',
				`${call}() was called on a mesh that ${user} still uses. Destroy the objects and instance batches that use it first.`,
			);
		destroyMeshes(this.core, meshes, call);
	}

	/**
	 * Writes new values into one attribute of the mesh's vertices, like setting three.js's
	 * `attribute.needsUpdate` after a change. `values` holds the attribute's values of every
	 * vertex, in the array type the mesh was made with, as `geometry.fromArrays` takes them. Only
	 * vertices `start` to `start + count - 1` change, which the next frame uploads. The defaults
	 * update every vertex. Colors take three or four values per vertex: three keep each vertex's
	 * alpha. The mesh keeps the bounding sphere it was made with, so give objects that draw
	 * vertices outside it bounds with `setBounds`. Joints, weights, and a mesh with joints or morph
	 * targets take no updates. A level that draws its base mesh's vertices writes them, so the base
	 * and every level of it draw the new values. Throws E1206 for values that do not fit the mesh,
	 * and E1101 for a destroyed mesh. Allocates nothing, so a call in every frame makes no garbage.
	 */
	updateVertices(
		name: UpdatableAttribute,
		values: Float32Array | IntegerArray | readonly number[],
		start = 0,
		count?: number,
	): void {
		const call = 'mesh.updateVertices';
		const id = this.id;
		let layout = this.layout;
		if (layout === undefined) {
			const { glue } = this.core;
			layout = { count: glue.meshVertexCount(id), format: glue.meshFormat(id) };
			this.layout = layout;
		}
		const vertices = count ?? layout.count - start;
		updateVertices(this.core, id, layout, name, values, start, vertices, call);
	}

	/** @internal Marks the mesh destroyed, once the engine core freed it. */
	ended(): void {
		this.liveId = 0;
		this.lowerLevels = [];
	}

	/**
	 * The mesh's lower levels of detail, from the most detailed down, as `setLevels` gave them. A
	 * destroyed level takes every level away, as the engine does.
	 */
	get levels(): readonly MeshLevel[] {
		if (!this.lowerLevels.every((level) => level.mesh.live)) this.lowerLevels = [];
		return this.lowerLevels;
	}

	/**
	 * Gives the mesh lower levels of detail, from the most detailed down, like three.js's
	 * `LOD.addLevel`. Every object and instance batch that draws the mesh then picks one level per
	 * frame. It draws the coarsest level whose error covers fewer pixels on the screen than the
	 * `lodThreshold` quality setting. A level may name a material of its own, so a far level shades
	 * more cheaply; a level without one draws with the level before's material. A bound that
	 * covers fewer pixels than the threshold draws nothing, so the mesh's last level holds no
	 * geometry. The shadow maps pick a coarser level still. An empty list takes the levels away.
	 * Morphed objects, and materials that blend or let light through, draw the base mesh. A
	 * skinned object draws a level while the level names the base mesh's own vertices.
	 * Destroying a level's mesh takes every level away. Throws E1221 for levels the mesh
	 * cannot take, and E1101 for a destroyed mesh.
	 */
	setLevels(levels: readonly MeshLevel[], options: MeshLevelOptions = {}): void {
		const call = 'mesh.setLevels';
		const id = this.id;
		const fov = options.fov ?? LEVEL_REFERENCE_FOV;
		if (levels.length > MAX_LOWER_LEVELS)
			throw new EngineError(
				'E1221',
				`${call}() got ${levels.length} levels. A mesh takes at most ${MAX_LOWER_LEVELS}.`,
			);
		if (!(fov > 0 && fov < 180))
			throw new EngineError('E1221', `${call}() got a fov of ${fov}, not between 0 and 180.`);
		// The reference view turns every measure into the distance at which its level switches, so
		// that the levels of one set compare with each other.
		const p11 = 1 / Math.tan((fov * Math.PI) / 360);
		const radius = this.radius;
		const defaultFade = options.fade ?? true;
		let fades = 0;
		let before = 0;
		const values: number[] = [];
		const switches: number[] = [];
		for (const [k, level] of levels.entries()) {
			const { error, distance, coverage } = level;
			const given = [error, distance, coverage].filter((value) => value !== undefined);
			if (given.length !== 1)
				throw new EngineError(
					'E1221',
					`${call}() got level ${k + 1} with ${given.length === 0 ? 'none of an error, a distance and a coverage' : 'more than one of an error, a distance and a coverage'}. Give one of them.`,
				);
			if (level.mesh.core !== this.core || level.mesh === this)
				throw new EngineError(
					'E1221',
					`${call}() got level ${k + 1} with ${level.mesh === this ? 'the base mesh itself' : 'a mesh from another engine'}.`,
				);
			const value = given[0] as number;
			if (!(Number.isFinite(value) && value > 0))
				throw new EngineError(
					'E1221',
					`${call}() got ${error !== undefined ? `an error of ${error}` : distance !== undefined ? `a distance of ${distance}` : `a coverage of ${coverage}`} for level ${k + 1}, not a number above 0.`,
				);
			const switchValue =
				error !== undefined
					? LEVEL_SWITCH_ERROR
					: distance !== undefined
						? LEVEL_SWITCH_DISTANCE
						: LEVEL_SWITCH_COVERAGE;
			// The distance at which the level switches on the reference view, which grows from
			// level to level.
			const at =
				switchValue === LEVEL_SWITCH_ERROR
					? (value * LEVEL_REFERENCE_HEIGHT * p11) / 2
					: switchValue === LEVEL_SWITCH_DISTANCE
						? value
						: (radius * p11) / value;
			if (k > 0 && at <= before)
				throw new EngineError(
					'E1221',
					`${call}() got level ${k + 1} with a switch at ${at.toFixed(3)} m, not past the ${before.toFixed(3)} m of level ${k}. The switch distances grow from level to level.`,
				);
			before = at;
			values.push(value);
			switches.push(switchValue);
			if (level.fade ?? defaultFade) fades |= 1 << (k + 1);
		}
		const count = levels.length;
		const ids = levels.map((level) => level.mesh.id);
		const materials = levels.map((level, k) => {
			const { material } = level;
			if (!material) return 0;
			if (!material.live)
				throw new EngineError(
					'E1221',
					`${call}() got level ${k + 1} with a material that is destroyed.`,
				);
			if (material.core !== this.core)
				throw new EngineError(
					'E1221',
					`${call}() got level ${k + 1} with a material from another engine.`,
				);
			return material.id;
		});
		const at = this.core.checkGrowth(this.core.glue.meshArrays(4 * count), call);
		this.core.u32(at, count).set(ids);
		this.core.f32(at + 4 * count, count).set(values);
		this.core.u32(at + 8 * count, count).set(switches);
		this.core.u32(at + 12 * count, count).set(materials);
		this.core.check(this.core.glue.setMeshLevels(id, count, fades), call, 'a mesh', true);
		this.lowerLevels = levels.map((level) => ({ ...level }));
	}

	/**
	 * @internal Gives the mesh the triangles `indices` in place of the ones it draws, which name its
	 * own vertices. A staged level uses it to make its base the finer level as it arrives, so the
	 * objects that draw the base draw the new geometry at once. Returns false when the mesh cannot
	 * take another triangle list. It changes nothing else about the mesh: its vertices, bounds and
	 * levels stay.
	 */
	replaceTriangles(indices: Uint16Array | Uint32Array | readonly number[]): boolean {
		return replaceMeshIndices(this.core, this.id, indices, 'mesh.replaceTriangles');
	}
}

/**
 * @internal Frees live meshes in the engine core in one pass, which no object or batch uses any
 * more, and marks them destroyed. The meshes that stay move once for all of them.
 */
export function destroyMeshes(
	core: CoreMemory,
	meshes: readonly MeshGeometry[],
	call: string,
): void {
	if (meshes.length === 0) return;
	const ids = meshes.map((mesh) => mesh.id);
	const at = core.checkGrowth(core.glue.meshArrays(ids.length), call);
	core.u32(at, ids.length).set(ids);
	core.check(core.glue.destroyMeshes(meshes.length), call, 'a mesh', true);
	for (const mesh of meshes) mesh.ended();
}

/**
 * Options for `geometry.box`. The box is centered on its origin. Segment counts are whole numbers
 * of at least 1.
 *
 * @category api/geometry
 */
export interface BoxOptions {
	/** The size along the X axis. The default is 1. */
	width?: number;
	/** The size along the Y axis. The default is 1. */
	height?: number;
	/** The size along the Z axis. The default is 1. */
	depth?: number;
	/** How many faces divide each side along the width. The default is 1. */
	widthSegments?: number;
	/** How many faces divide each side along the height. The default is 1. */
	heightSegments?: number;
	/** How many faces divide each side along the depth. The default is 1. */
	depthSegments?: number;
}

/**
 * Options for `geometry.sphere`. The sphere is centered on its origin, with its poles on the Y
 * axis. Angles are in radians.
 *
 * @category api/geometry
 */
export interface SphereOptions {
	/** The radius. The default is 1. */
	radius?: number;
	/** How many faces go around the Y axis. The default is 32, and the least is 3. */
	widthSegments?: number;
	/** How many faces go from pole to pole. The default is 16, and the least is 2. */
	heightSegments?: number;
	/** Where the sphere starts around the Y axis, from the -X axis. The default is 0. */
	phiStart?: number;
	/** How far the sphere goes around the Y axis. The default is `Math.PI * 2`, all the way. */
	phiLength?: number;
	/** Where the sphere starts, down from the top pole. The default is 0. */
	thetaStart?: number;
	/** How far the sphere goes down from `thetaStart`. The default is `Math.PI`, to the bottom pole. */
	thetaLength?: number;
}

/**
 * Options for `geometry.plane`. The plane lies in the XY plane, centered on its origin, and faces
 * +Z. Segment counts are whole numbers of at least 1.
 *
 * @category api/geometry
 */
export interface PlaneOptions {
	/** The size along the X axis. The default is 1. */
	width?: number;
	/** The size along the Y axis. The default is 1. */
	height?: number;
	/** How many faces divide the width. The default is 1. */
	widthSegments?: number;
	/** How many faces divide the height. The default is 1. */
	heightSegments?: number;
}

/**
 * Options for `geometry.cylinder`. The cylinder stands on the Y axis, centered on its origin.
 * Angles are in radians, and segment counts are whole numbers of at least 1.
 *
 * @category api/geometry
 */
export interface CylinderOptions {
	/** The radius of the top. The default is 1. With 0, the top is a point. */
	radiusTop?: number;
	/** The radius of the bottom. The default is 1. With 0, the bottom is a point. */
	radiusBottom?: number;
	/** The height. The default is 1. */
	height?: number;
	/** How many faces go around the cylinder. The default is 32. */
	radialSegments?: number;
	/** How many rows of faces go up the side. The default is 1. */
	heightSegments?: number;
	/** Leaves out the top and the bottom, so the cylinder is a tube. The default is false. */
	openEnded?: boolean;
	/** Where the side starts around the Y axis, from the +Z axis. The default is 0. */
	thetaStart?: number;
	/** How far the side goes around the Y axis. The default is `Math.PI * 2`, all the way. */
	thetaLength?: number;
}

/**
 * Options for `geometry.cone`. The cone stands on the Y axis, centered on its origin, with its
 * point at the top. Angles are in radians, and segment counts are whole numbers of at least 1.
 *
 * @category api/geometry
 */
export interface ConeOptions {
	/** The radius of the bottom. The default is 1. */
	radius?: number;
	/** The height. The default is 1. */
	height?: number;
	/** How many faces go around the cone. The default is 32. */
	radialSegments?: number;
	/** How many rows of faces go up the side. The default is 1. */
	heightSegments?: number;
	/** Leaves out the bottom. The default is false. */
	openEnded?: boolean;
	/** Where the side starts around the Y axis, from the +Z axis. The default is 0. */
	thetaStart?: number;
	/** How far the side goes around the Y axis. The default is `Math.PI * 2`, all the way. */
	thetaLength?: number;
}

/**
 * Options for `geometry.torus`. The torus is centered on its origin, around the Z axis. Angles are
 * in radians, and segment counts are whole numbers of at least 1.
 *
 * @category api/geometry
 */
export interface TorusOptions {
	/** The distance from the center of the torus to the center of its tube. The default is 1. */
	radius?: number;
	/** The radius of the tube. The default is 0.4. */
	tube?: number;
	/** How many faces go around the tube. The default is 12. */
	radialSegments?: number;
	/** How many faces go around the torus. The default is 48. */
	tubularSegments?: number;
	/** How far the torus goes around its center. The default is `Math.PI * 2`, all the way. */
	arc?: number;
	/** Where the tube starts around its own center. The default is 0. */
	thetaStart?: number;
	/** How far the tube goes around its own center. The default is `Math.PI * 2`, all the way. */
	thetaLength?: number;
}

/**
 * Options for `geometry.capsule`: a cylinder with a half sphere on each end. The capsule stands on
 * the Y axis, centered on its origin, and its full height is `height` plus twice the radius.
 * Segment counts are whole numbers.
 *
 * @category api/geometry
 */
export interface CapsuleOptions {
	/** The radius of the capsule and of its half spheres. The default is 1. */
	radius?: number;
	/** The height of the middle part, between the half spheres. The default is 1. */
	height?: number;
	/** How many rows of faces go along each half sphere. The default is 4, and the least is 1. */
	capSegments?: number;
	/** How many faces go around the capsule. The default is 8, and the least is 3. */
	radialSegments?: number;
	/** How many rows of faces go along the middle part. The default is 1, and the least is 1. */
	heightSegments?: number;
}

/**
 * Options for `geometry.circle`: a flat disc of triangles around its center. The circle lies in
 * the XY plane, centered on its origin, and faces +Z. Angles are in radians.
 *
 * @category api/geometry
 */
export interface CircleOptions {
	/** The radius. The default is 1. */
	radius?: number;
	/** How many triangles make the circle: a whole number. The default is 32, and the least is 3. */
	segments?: number;
	/** Where the circle starts, from the +X axis toward +Y. The default is 0. */
	thetaStart?: number;
	/** How far the circle goes. The default is `Math.PI * 2`. Less makes a slice of the circle. */
	thetaLength?: number;
}

/**
 * Options for `geometry.ring`: a flat disc with a hole. The ring lies in the XY plane, centered on
 * its origin, and faces +Z. Angles are in radians, and segment counts are whole numbers.
 *
 * @category api/geometry
 */
export interface RingOptions {
	/** The radius of the hole. The default is 0.5. */
	innerRadius?: number;
	/** The radius of the outer edge. The default is 1. */
	outerRadius?: number;
	/** How many faces go around the ring. The default is 32, and the least is 3. */
	thetaSegments?: number;
	/** How many faces go from the inner edge to the outer edge. The default is 1, and the least is 1. */
	phiSegments?: number;
	/** Where the ring starts, from the +X axis toward +Y. The default is 0. */
	thetaStart?: number;
	/** How far the ring goes. The default is `Math.PI * 2`, all the way. */
	thetaLength?: number;
}

const TAU = Math.PI * 2;

// Each generator's options with their defaults, in the order of the arguments of the three.js
// class's constructor, which is the order the engine core reads them in.
const BOX: Required<BoxOptions> = {
	width: 1,
	height: 1,
	depth: 1,
	widthSegments: 1,
	heightSegments: 1,
	depthSegments: 1,
};
const SPHERE: Required<SphereOptions> = {
	radius: 1,
	widthSegments: 32,
	heightSegments: 16,
	phiStart: 0,
	phiLength: TAU,
	thetaStart: 0,
	thetaLength: Math.PI,
};
const PLANE: Required<PlaneOptions> = { width: 1, height: 1, widthSegments: 1, heightSegments: 1 };
const CYLINDER: Required<CylinderOptions> = {
	radiusTop: 1,
	radiusBottom: 1,
	height: 1,
	radialSegments: 32,
	heightSegments: 1,
	openEnded: false,
	thetaStart: 0,
	thetaLength: TAU,
};
const CONE: Required<ConeOptions> = {
	radius: 1,
	height: 1,
	radialSegments: 32,
	heightSegments: 1,
	openEnded: false,
	thetaStart: 0,
	thetaLength: TAU,
};
const TORUS: Required<TorusOptions> = {
	radius: 1,
	tube: 0.4,
	radialSegments: 12,
	tubularSegments: 48,
	arc: TAU,
	thetaStart: 0,
	thetaLength: TAU,
};
const CAPSULE: Required<CapsuleOptions> = {
	radius: 1,
	height: 1,
	capSegments: 4,
	radialSegments: 8,
	heightSegments: 1,
};
const CIRCLE: Required<CircleOptions> = {
	radius: 1,
	segments: 32,
	thetaStart: 0,
	thetaLength: TAU,
};
const RING: Required<RingOptions> = {
	innerRadius: 0.5,
	outerRadius: 1,
	thetaSegments: 32,
	phiSegments: 1,
	thetaStart: 0,
	thetaLength: TAU,
};

/**
 * The vertex attributes that `mesh.updateVertices` writes, by their names in `MeshArrays`.
 *
 * @category api/geometry
 */
export type UpdatableAttribute = 'positions' | 'normals' | 'uvs' | 'uvs1' | 'colors' | 'tangents';

/**
 * The integer typed arrays that vertex attributes take: 8-bit and 16-bit, signed and unsigned.
 *
 * @category api/geometry
 */
export type IntegerArray = Int8Array | Uint8Array | Int16Array | Uint16Array;

/**
 * One attribute's numbers with a note on how its integers read, like three.js's `BufferAttribute`,
 * whose `array` and `normalized` fields it shares. Normalized integers read as fractions: from 0
 * to 1 when unsigned, and from -1 to 1 when signed. Plain integers read as whole numbers.
 *
 * @category api/geometry
 */
export interface VertexArray {
	/** The numbers, as `MeshArrays` takes them. */
	array: Float32Array | IntegerArray | readonly number[];
	/**
	 * True when the integers are normalized. The default is false, as in three.js and glTF. It
	 * applies to positions and texture coordinates. The other attributes read integers one way
	 * only, so they refuse a value that says otherwise.
	 */
	normalized?: boolean;
}

/**
 * The numbers of one vertex attribute: a typed array, a plain array of numbers, or a
 * `VertexArray` that also says whether its integers are normalized. Plain arrays hold 32-bit
 * floats, except joints, which hold 16-bit integers.
 *
 * @category api/geometry
 */
export type VertexValues = Float32Array | IntegerArray | readonly number[] | VertexArray;

/**
 * A mesh's morph targets, like three.js's `morphAttributes` with `morphTargetsRelative` set, as
 * glTF stores them. Each list holds one array per target, of three numbers per vertex, or for
 * colors as many as the mesh's `colors` hold. They say how far the target moves the vertex's
 * position, normal, tangent or color at weight 1. Every list has the same number of targets, from
 * 1 to 256. A mesh's targets move its vertices by their weights, which each object sets with
 * `setMorphWeight`, and clips animate.
 *
 * @category api/geometry
 */
export interface MorphTargets {
	/** For each target, how far it moves each position. Like `morphAttributes.position`. */
	positions?: readonly (Float32Array | readonly number[])[];
	/** For each target, how far it turns each normal. Like `morphAttributes.normal`. */
	normals?: readonly (Float32Array | readonly number[])[];
	/**
	 * For each target, how far it turns each tangent's direction: three numbers per vertex, as
	 * glTF gives them. three.js does not morph tangents.
	 */
	tangents?: readonly (Float32Array | readonly number[])[];
	/**
	 * For each target, how far it changes each vertex color: three or four numbers per vertex, as
	 * many as the mesh's `colors` hold, in linear color. Like `morphAttributes.color`. A morphed
	 * color is clamped to the range 0 to 1, as the glTF specification asks. Needs `colors`.
	 */
	colors?: readonly (Float32Array | readonly number[])[];
	/** The targets' names, one per target, which `setMorphWeight` takes in place of numbers. */
	names?: readonly string[];
}

/**
 * The arrays of a mesh for `geometry.fromArrays`. Each array holds its values for vertex 0, then
 * vertex 1, and so on, as three.js's `BufferGeometry` keeps its attributes. The engine copies
 * them.
 *
 * An attribute can come as 32-bit floats, or as the 8-bit and 16-bit integers that glTF's
 * `KHR_mesh_quantization` allows for it. The mesh keeps that type on the GPU. Smaller types take
 * less memory and upload faster. Integer positions keep their own scale, so give the object
 * the scale that turns them into meters, as a glTF node does. Meshes share GPU buffers with the
 * meshes whose attributes have the same types.
 *
 * @category api/geometry
 */
export interface MeshArrays {
	/**
	 * Three numbers per vertex: x, y and z. Like three.js's `position` attribute. Takes floats,
	 * or 8-bit or 16-bit integers, normalized or plain.
	 */
	positions: VertexValues;
	/**
	 * Three numbers per vertex: a direction of length 1 away from the surface. Like three.js's
	 * `normal` attribute. Pass normals, or set `computeNormals` instead. Takes floats, or an
	 * `Int8Array` or `Int16Array`, whose integers read as fractions from -1 to 1.
	 */
	normals?: VertexValues;
	/**
	 * Texture coordinates: two numbers per vertex, u and v. Like three.js's `uv` attribute. Takes
	 * floats, or 8-bit or 16-bit integers, normalized or plain.
	 */
	uvs?: VertexValues;
	/**
	 * A second set of texture coordinates, two numbers per vertex, such as those of a light map.
	 * Like three.js's `uv1` attribute. Takes the same types as `uvs`.
	 */
	uvs1?: VertexValues;
	/**
	 * Linear colors, three numbers per vertex from 0 to 1, or four with alpha. Like three.js's
	 * `color` attribute. Takes floats, or a `Uint8Array` or `Uint16Array`, whose integers read as
	 * fractions from 0 to 1.
	 */
	colors?: VertexValues;
	/**
	 * Four numbers per vertex: the direction in which u grows along the surface, then 1 or -1 for
	 * the direction in which v grows. Like three.js's `tangent` attribute. Takes the same types as
	 * `normals`.
	 */
	tangents?: VertexValues;
	/**
	 * The joints that move each vertex of a skinned mesh: four joint indices per vertex, in a
	 * `Uint8Array`, a `Uint16Array` or a plain array. Like three.js's `skinIndex` attribute. Give
	 * `weights` with them.
	 */
	joints?: VertexValues;
	/**
	 * How much each of a vertex's four joints moves it: four numbers per vertex, which add up to
	 * 1. Like three.js's `skinWeight` attribute. Takes floats, or a `Uint8Array` or `Uint16Array`,
	 * whose integers read as fractions from 0 to 1.
	 */
	weights?: VertexValues;
	/**
	 * Three vertex indices per triangle, counter-clockwise when you look at its front. 16-bit and
	 * 32-bit indices both work. Without indices, each three vertices in a row make a triangle.
	 * Like three.js's `setIndex`.
	 */
	indices?: Uint16Array | Uint32Array | readonly number[];
	/**
	 * Computes the normals from the triangles, as three.js's `computeVertexNormals` does: each
	 * vertex gets the average of its triangles' normals, weighted by their areas.
	 */
	computeNormals?: boolean;
	/**
	 * Computes the tangents from the positions, the normals and `uvs`, as three.js's
	 * `computeTangents` does, on the job workers.
	 */
	computeTangents?: boolean;
	/**
	 * The mesh's morph targets: shapes that each object of the mesh blends in by its own weights.
	 * The engine keeps, for each vertex, only the targets that move it.
	 */
	morphTargets?: MorphTargets;
}

/**
 * Mesh generators with the parameters and defaults of three.js's geometry classes, and meshes
 * from arrays.
 *
 * @category api/geometry
 */
export class Geometry {
	/** @internal The scene, which says which objects use a mesh that a destroy names. */
	users: ResourceUsers | undefined;

	constructor(private readonly core: CoreMemory) {}

	/**
	 * The GPU bytes that every mesh holds: the shared vertex and index buffers, which keep room to
	 * grow, and the texture of morph target deltas. It counts what the frames made so far, so it
	 * grows once a frame draws a new mesh. Destroyed meshes give their room to later ones, so a
	 * scene that loads and destroys the same models keeps the same figure.
	 */
	get memoryBytes(): number {
		return this.core.glue.meshMemoryBytes();
	}

	/**
	 * @internal Frees live meshes that no object or batch uses any more, in one pass, as a model's
	 * destroy does.
	 */
	destroyMeshes(meshes: readonly MeshGeometry[], call: string): void {
		destroyMeshes(this.core, meshes, call);
	}

	private mesh(id: number, call: string): MeshGeometry {
		this.core.checkGrowth(id, call);
		return new MeshGeometry(id, this.core.glue.meshRadius(id), this.core, 0, [], this);
	}

	/**
	 * A generator's mesh: each option, or its default, in the order of the three.js class's
	 * arguments, after the numbers in `first`. Throws E1203 for an option that is not a finite
	 * number.
	 */
	private shape<T extends object>(
		shape: number,
		call: string,
		options: T,
		defaults: Required<T>,
		...first: number[]
	): MeshGeometry {
		for (const name in defaults) {
			const given = options[name];
			const value = Number(given ?? defaults[name]);
			if (DEV && !Number.isFinite(value))
				throw new EngineError('E1203', `${call}() got ${given} for ${name}.`);
			first.push(value);
		}
		const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = first;
		return this.mesh(this.core.glue.createShapeMesh(shape, a, b, c, d, e, f, g, h), call);
	}

	/** A box, like three.js's `BoxGeometry`. */
	box(options: BoxOptions = {}): MeshGeometry {
		return this.shape(SHAPE_BOX, 'geometry.box', options, BOX);
	}

	/** A sphere, like three.js's `SphereGeometry`. */
	sphere(options: SphereOptions = {}): MeshGeometry {
		return this.shape(SHAPE_SPHERE, 'geometry.sphere', options, SPHERE);
	}

	/** A flat rectangle, like three.js's `PlaneGeometry`. */
	plane(options: PlaneOptions = {}): MeshGeometry {
		return this.shape(SHAPE_PLANE, 'geometry.plane', options, PLANE);
	}

	/** A cylinder, like three.js's `CylinderGeometry`. */
	cylinder(options: CylinderOptions = {}): MeshGeometry {
		return this.shape(SHAPE_CYLINDER, 'geometry.cylinder', options, CYLINDER);
	}

	/** A cone, like three.js's `ConeGeometry`: a cylinder whose top is a point. */
	cone(options: ConeOptions = {}): MeshGeometry {
		return this.shape(SHAPE_CYLINDER, 'geometry.cone', options, CONE, 0);
	}

	/** A torus, like three.js's `TorusGeometry`. */
	torus(options: TorusOptions = {}): MeshGeometry {
		return this.shape(SHAPE_TORUS, 'geometry.torus', options, TORUS);
	}

	/** A capsule, like three.js's `CapsuleGeometry`. */
	capsule(options: CapsuleOptions = {}): MeshGeometry {
		return this.shape(SHAPE_CAPSULE, 'geometry.capsule', options, CAPSULE);
	}

	/** A flat circle, like three.js's `CircleGeometry`. */
	circle(options: CircleOptions = {}): MeshGeometry {
		return this.shape(SHAPE_CIRCLE, 'geometry.circle', options, CIRCLE);
	}

	/** A flat ring, like three.js's `RingGeometry`. */
	ring(options: RingOptions = {}): MeshGeometry {
		return this.shape(SHAPE_RING, 'geometry.ring', options, RING);
	}

	/**
	 * A mesh from arrays of vertex attributes and triangle indices, like three.js's
	 * `BufferGeometry` with `setAttribute` and `setIndex`. The mesh keeps the attributes it gets,
	 * each in the type of number it came in, and meshes whose attributes have the same types share
	 * GPU buffers. A mesh can have any number of vertices. Throws E1206 when an array's length does
	 * not fit the vertex count, when its attribute does not take its type of number, when an index
	 * names no vertex, for a value that is not a finite number, and for morph targets whose arrays
	 * do not fit the vertices or whose lists hold different numbers of targets.
	 */
	fromArrays(arrays: MeshArrays): MeshGeometry {
		const call = 'geometry.fromArrays';
		const problem = arraysProblem(arrays);
		if (problem) throw new EngineError('E1206', `${call}() ${problem}`);
		const id = meshFromArrays(this.core, arrays, call);
		this.core.checkGrowth(id, call);
		const { morphTargets } = arrays;
		return new MeshGeometry(
			id,
			this.core.glue.meshRadius(id),
			this.core,
			morphTargetCount(morphTargets),
			morphTargets?.names?.slice() ?? [],
			this,
		);
	}

	/**
	 * @internal A level that draws `base`'s vertices with the given triangles, or undefined when the
	 * engine cannot share them and the caller gives the level its own arrays. Files whose levels
	 * keep the base's vertex streams load every level this way, so a level costs indices alone.
	 */
	fromLevel(
		base: MeshGeometry,
		indices: Uint16Array | Uint32Array | readonly number[],
	): MeshGeometry | undefined {
		const call = 'geometry.fromLevel';
		const id = meshFromLevel(this.core, base.id, indices, call);
		if (id === undefined) return undefined;
		return new MeshGeometry(id, this.core.glue.meshRadius(id), this.core, 0, [], this);
	}
}

/**
 * Options every material takes.
 *
 * @category api/materials
 */
export interface MaterialOptions {
	/** The base color: a hex string or a number in sRGB, or three linear components from 0 to 1. */
	color?: ColorInput;
	/**
	 * How opaque the surface is, from 0 to 1. The default is 1. It is part of the alpha, which the
	 * `mask` alpha mode tests and the `blend` alpha mode blends with. The `opaque` alpha mode
	 * ignores it.
	 */
	opacity?: number;
	/**
	 * With the `mask` alpha mode, the alpha below which the surface draws nothing, from 0 to 1.
	 * The default is 0.5, as in glTF.
	 */
	alphaCutoff?: number;
}

/**
 * How a material uses its alpha: its opacity, times its base color map's alpha, and times its
 * mesh's vertex alpha with `vertexColors`. The `opaque` mode ignores the alpha. The `mask` mode
 * draws nothing where the alpha falls below `alphaCutoff`, and draws the rest opaque, as three.js's
 * `alphaTest` does. The `hash` mode draws each point of the surface opaque or not at all, by a
 * pattern that stays on the mesh. The alpha then sets how much of the surface draws, as three.js's
 * `alphaHash` does. The `blend` mode blends the surface over what lies behind it, as three.js's
 * `transparent: true` does. Blended objects draw after the opaque ones, farthest first.
 *
 * @category api/materials
 */
export type AlphaMode = 'opaque' | 'mask' | 'hash' | 'blend';

/**
 * How a blended surface meets what lies behind it. The `normal` blending covers it as far as the
 * alpha says. The `additive` blending adds the surface's light, for glows and fire. The `multiply`
 * blending tints it, for stains and tinted glass. The `weighted` blending covers it as `normal`
 * does, but blends the surfaces of this blending in any order, by a weighted average, as
 * three.js's `OITPassNode` does. Use it for smoke, dense particles and many overlapping panes,
 * where sorting by object leaves surfaces in the wrong order.
 *
 * @category api/materials
 */
export type Blending = 'normal' | 'additive' | 'multiply' | 'weighted';

/**
 * A depth bias, as three.js's polygon offset gives. It moves a surface's depth, so a decal on a
 * wall wins the depth test and does not fight with the wall. Negative values pull the surface
 * toward the camera, as in three.js.
 *
 * @category api/materials
 */
export interface DepthBias {
	/**
	 * Steps of the depth buffer's smallest difference, as three.js's `polygonOffsetUnits`. A
	 * fraction rounds to the nearest whole number, as WebGPU takes it. The default is 0.
	 */
	constant?: number;
	/**
	 * A factor of how steeply the surface's depth changes across the screen, as three.js's
	 * `polygonOffsetFactor`. The default is 0.
	 */
	slopeScale?: number;
}

/**
 * The values of a standard material, which `set` changes at any time.
 *
 * @category api/materials
 */
export interface StandardValues extends MaterialOptions {
	/** How much the surface acts like a metal, from 0 to 1. The default is 0. */
	metalness?: number;
	/** How rough the surface is, from 0 (a mirror) to 1 (fully matte). The default is 1. */
	roughness?: number;
	/**
	 * The color the surface gives off without any light, in the forms that `color` takes. The
	 * default is black, which gives off nothing.
	 */
	emissive?: ColorInput;
	/** The factor of the emissive color: 0 or more. The default is 1. */
	emissiveIntensity?: number;
	/**
	 * How strongly the normal map bends normals along u and along v. The default is `[1, 1]`, and
	 * negative values flip a direction.
	 */
	normalScale?: readonly [number, number];
	/**
	 * How strongly the bump map bends normals, as three.js's `bumpScale`: the change of its red
	 * channel from one pixel to the next times this. Negative values turn bumps into dents. The
	 * default is 1.
	 */
	bumpScale?: number;
	/**
	 * How far the displacement map's white moves each vertex along its normal, in the mesh's units,
	 * as three.js's `displacementScale`. The default is 1.
	 */
	displacementScale?: number;
	/**
	 * How far the displacement map moves every vertex along its normal, added to its texel's
	 * share of `displacementScale`, in the mesh's units, as three.js's `displacementBias`. The
	 * default is 0.
	 */
	displacementBias?: number;
	/** How much the occlusion map darkens ambient light, from 0 to 1. The default is 1. */
	aoMapIntensity?: number;
	/** The factor of the light map's light: 0 or more. The default is 1. */
	lightMapIntensity?: number;
	/**
	 * The index of refraction of the surface's non-metallic part, 1 or more, as three.js's
	 * `MeshPhysicalMaterial.ior`. It sets how much light the surface reflects when seen head on:
	 * `((ior - 1) / (ior + 1))^2`. The default is 1.5, which reflects 4%, as glTF's metallic-roughness
	 * model does.
	 */
	ior?: number;
	/**
	 * The strength of the specular reflection of the surface's non-metallic part, from 0 to 1, as
	 * three.js's `specularIntensity`. It scales the reflection at every angle, so 0 leaves only
	 * diffuse light. Metals ignore it. The default is 1.
	 */
	specularIntensity?: number;
	/**
	 * The color that tints the specular reflection of the surface's non-metallic part when seen head
	 * on, as three.js's `specularColor`. At grazing angles the reflection stays white, and metals
	 * ignore it. It takes the forms that `color` takes, and its three linear components may also
	 * exceed 1, as glTF allows, to reflect more than the index of refraction gives, up to all the
	 * light. The default is white.
	 */
	specularColor?: ColorInput;
	/**
	 * The factor of the scene environment's light on the surface, 0 or more, as three.js's
	 * `envMapIntensity`. It multiplies the intensity that `scene.setEnvironment` gives. The
	 * default is 1.
	 */
	envIntensity?: number;
	/** Where the maps sit on the texture coordinates. The default leaves them as they are. */
	uvTransform?: UvTransform;
	/**
	 * How much of the light behind the surface passes through it, from 0 to 1, for glass and clear
	 * water, as three.js's `MeshPhysicalMaterial.transmission`. That share of the diffuse light
	 * becomes the light from behind, and the reflections stay. Roughness blurs what shows through.
	 * Give it when you create the material, even as 0, to change it later. A material created
	 * without it lets no light through. Such a material draws after the opaque objects, with the
	 * blended ones, and only opaque objects show through it. It takes the `opaque`, `mask` or
	 * `blend` alpha mode. A mask decides which pixels draw, and the light from behind fills the
	 * pixels that remain, as three.js's `alphaTest` does. The default is 0.
	 */
	transmission?: number;
	/**
	 * The thickness of the volume under the surface, in the mesh's own units, 0 or more, as
	 * three.js's `thickness`. Light that passes through bends by `ior` over this distance, and the
	 * volume's color absorbs part of it. 0 is a thin wall, which bends no light. The default is 0.
	 */
	thickness?: number;
	/**
	 * The color that white light takes after it travels `attenuationDistance` through the
	 * volume, as three.js's `attenuationColor`, in the forms that `color` takes. The default is
	 * white, which absorbs nothing.
	 */
	attenuationColor?: ColorInput;
	/**
	 * The distance in world units over which light in the volume takes `attenuationColor`, above
	 * 0, as three.js's `attenuationDistance`. `Infinity` absorbs nothing. The default is
	 * `Infinity`.
	 */
	attenuationDistance?: number;
	/**
	 * How much of the surface's diffuse light passes through it to its other side, from 0 to 1, as
	 * glTF's `KHR_materials_diffuse_transmission` gives it. Light that reaches the back, such as the
	 * sun behind a leaf, a petal or an ear, then shows on the front through
	 * `diffuseTransmissionColor`, and the front keeps the rest of its diffuse light. Shadows fall on
	 * that light too. Give it when you create the material, even as 0, to change it later. A
	 * material created without it lets no light through to its other side. Over `thickness`, the
	 * volume's `attenuationColor` tints the light. `transmission` wins where a material has both.
	 * The default is 0.
	 */
	diffuseTransmission?: number;
	/**
	 * The color that tints the light that passes through to the surface's other side, in the forms
	 * that `color` takes. The base color does not tint it, as glTF says, so give a leaf its green
	 * here. The default is white.
	 */
	diffuseTransmissionColor?: ColorInput;
	/**
	 * How far light spreads under the surface before it leaves it, in world units taken as
	 * meters, 0 or more, as in skin, wax or marble. The subsurface blur spreads the surface's
	 * diffuse light over this distance, so the edges of its shadows and the detail of its maps
	 * soften, and its highlights stay sharp. Skin takes about 0.01. Give it when you create the
	 * material, even as 0, to change it later. A material created without it draws no blur. The
	 * blur draws on the High and Ultra quality presets, where the quality setting
	 * `subsurfaceSamples` gives it taps, on the HDR path. Materials that blend or let light
	 * through take none. The default is 0.
	 */
	subsurfaceRadius?: number;
	/**
	 * How far each color channel's light spreads, as a share of `subsurfaceRadius`, in the forms
	 * that `color` takes: each linear channel is its share. Skin's red light spreads furthest, so
	 * it takes about `[1, 0.4, 0.25]`. The default is white, which spreads every channel as far.
	 */
	subsurfaceColor?: ColorInput;
	/**
	 * How much of a clear coat covers the surface, from 0 to 1, as three.js's
	 * `MeshPhysicalMaterial.clearcoat`: a thin, shiny layer, as on car paint, varnish or a wet
	 * stone, with its own highlights and reflection. It dims what lies below it where it reflects
	 * light. Give it, or another option of a clear coat or a sheen, when you create the material, to
	 * change it later. The default is 0.
	 */
	clearcoat?: number;
	/** How rough the clear coat is, from 0 (a mirror) to 1, as three.js's `clearcoatRoughness`. The default is 0. */
	clearcoatRoughness?: number;
	/**
	 * How strongly the coat normal map bends the coat's normals along u and along v, as three.js's
	 * `clearcoatNormalScale`. The default is `[1, 1]`, and negative values flip a direction.
	 */
	clearcoatNormalScale?: readonly [number, number];
	/**
	 * The color of a sheen, the soft glow at grazing angles of velvet, cloth and fuzz, as three.js's
	 * `sheenColor`, in the forms that `color` takes. three.js's `sheen` multiplies it; here the
	 * color alone sets the sheen. Black gives none. Give it, or another option of a clear coat or a
	 * sheen, when you create the material, to change it later. The default is black.
	 */
	sheenColor?: ColorInput;
	/** How rough the sheen is, from 0 to 1, as three.js's `sheenRoughness`: rougher sheens spread wider. The default is 1. */
	sheenRoughness?: number;
	/**
	 * How much a thin film above the surface tints its reflection, from 0 to 1, as three.js's
	 * `iridescence`: soap bubbles, oil and beetle shells show the colors of the film's thickness.
	 * Give it, or another option of iridescence, when you create the material, to change it later.
	 * The default is 0.
	 */
	iridescence?: number;
	/**
	 * The thin film's index of refraction, 1 or more, as three.js's `iridescenceIOR`: 1 makes the
	 * film reflect as the surface does, and a value near 2 shows its colors most strongly. The
	 * default is 1.3.
	 */
	iridescenceIor?: number;
	/**
	 * The thinnest and thickest parts of the film, in nanometers, as three.js's
	 * `iridescenceThicknessRange`: the map's green channel mixes between them. The default is
	 * `[100, 400]`.
	 */
	iridescenceThicknessRange?: readonly [number, number];
	/**
	 * How far the specular reflection stretches along one direction of the surface, from 0 (round)
	 * to 1, as three.js's `anisotropy`: brushed metal shows a highlight across its grooves rather
	 * than around. A material with it needs a map, whose coordinates give the surface's tangent
	 * frame. Give it, or `anisotropyRotation`, when you create the material, to change it later.
	 * The default is 0.
	 */
	anisotropy?: number;
	/**
	 * The direction along which the reflection stretches, in radians from the surface's tangent,
	 * as three.js's `anisotropyRotation`. The default is 0.
	 */
	anisotropyRotation?: number;
}

/**
 * Where a material's maps sit on the texture coordinates, as three.js's texture `offset`, `repeat`
 * and `rotation` place a texture, with its `center` at the coordinates' origin. A transform that
 * leaves a value out takes its default.
 *
 * @category api/materials
 */
export interface UvTransform {
	/** The shift along u and v. The default is `[0, 0]`. */
	offset?: readonly [number, number];
	/** How many times the maps repeat along u and v. The default is `[1, 1]`. */
	repeat?: readonly [number, number];
	/** The turn in radians, about the coordinates' origin. The default is 0. */
	rotation?: number;
}

/**
 * The texture maps of a standard material. They are fixed when the material is created, because
 * each set of maps draws with a pipeline of its own. A map reads the texture coordinates that its
 * texture's `uvSet` names, through the material's `uvTransform`. Meshes need texture coordinates to
 * show maps, and the material draws without a map until its texture's image is on the GPU.
 *
 * @category api/materials
 */
export interface StandardMaps {
	/** The base color map, in sRGB. Its color multiplies `color`. */
	map?: Texture;
	/**
	 * Roughness in green and metalness in blue, as glTF packs them, in linear color. They multiply
	 * `roughness` and `metalness`.
	 */
	metalnessRoughnessMap?: Texture;
	/** Normals in tangent space, in linear color, which `normalScale` scales. */
	normalMap?: Texture;
	/**
	 * Heights in red, in linear color, which bend the normals as three.js's bump map does, by
	 * `bumpScale`. A normal map wins over it, as in three.js, and so does a wireframe.
	 */
	bumpMap?: Texture;
	/**
	 * Heights in red, in linear color, which move each vertex along its normal by
	 * `displacementScale` and `displacementBias`, as three.js's displacement map does. Shadows and
	 * the depth prepass follow the moved vertices, and culling grows each object's bounds to hold
	 * them. Without a normal or bump map, the map's slope also bends the normals, so the light
	 * follows the new shape, which three.js does not do. The vertex shader reads the map at its
	 * full size, so the mesh needs vertices about as dense as the detail it should show. Raycasts,
	 * outlines and debug views see the mesh before it moves.
	 */
	displacementMap?: Texture;
	/**
	 * With a `displacementMap`, also shifts where each pixel reads the maps, by parallax occlusion
	 * mapping: relief finer than the mesh's vertices hides and shows the surface behind it as the
	 * view turns. It costs a dozen or more texture reads per pixel, so the quality presets may turn
	 * it off. Only opaque and masked surfaces take it. The default is false.
	 */
	parallax?: boolean;
	/** Ambient occlusion in red, in linear color, which darkens ambient light. */
	aoMap?: Texture;
	/** The emissive color map, in sRGB. Its color multiplies `emissive`. */
	emissiveMap?: Texture;
	/** Baked light, added to the ambient light. Light maps usually use the second coordinates. */
	lightMap?: Texture;
	/** The specular intensity in alpha, in linear color. Its alpha multiplies `specularIntensity`. */
	specularIntensityMap?: Texture;
	/** The specular color, in sRGB. Its color multiplies `specularColor`. */
	specularColorMap?: Texture;
	/**
	 * The diffuse transmission in alpha, in linear color. Its alpha multiplies
	 * `diffuseTransmission`. Only a material created with `diffuseTransmission` takes it, and such
	 * a material takes no specular maps.
	 */
	diffuseTransmissionMap?: Texture;
	/**
	 * The diffuse transmission color, in sRGB. Its color multiplies `diffuseTransmissionColor`.
	 * Only a material created with `diffuseTransmission` takes it, and such a material takes no
	 * specular maps.
	 */
	diffuseTransmissionColorMap?: Texture;
	/**
	 * The share of the light behind the surface that passes through it, in red, in linear color.
	 * Its red multiplies `transmission`. Only a material created with `transmission` takes it, and
	 * such a material takes no specular intensity map, since these maps take its slot. A material
	 * with layers keeps it unless a layer map fills the slot: a clear coat's normal map and
	 * iridescence's thickness map do.
	 */
	transmissionMap?: Texture;
	/**
	 * The thickness of the volume under the surface, in green, in linear color. Its green
	 * multiplies `thickness`. Only a material created with `transmission` takes it, and such a
	 * material takes no specular color map, since these maps take its slot. A material with layers
	 * keeps it unless a layer map fills the slot: the sheen's maps and an anisotropy map do.
	 */
	thicknessMap?: Texture;
	/**
	 * The clear coat in red, in linear color, which multiplies `clearcoat`. A material with a clear
	 * coat or a sheen takes no light map and no specular maps, since its layers' maps take their
	 * places.
	 */
	clearcoatMap?: Texture;
	/**
	 * The clear coat's roughness in green, in linear color, which multiplies `clearcoatRoughness`.
	 * With `clearcoatMap`, it is the same texture, as glTF packs them.
	 */
	clearcoatRoughnessMap?: Texture;
	/** The clear coat's normals in tangent space, in linear color, which `clearcoatNormalScale` scales. */
	clearcoatNormalMap?: Texture;
	/** The sheen color, in sRGB, whose color multiplies `sheenColor`. */
	sheenColorMap?: Texture;
	/**
	 * The sheen's roughness in alpha, which multiplies `sheenRoughness`. With `sheenColorMap`, it is
	 * the same texture, as glTF packs them: an sRGB texture keeps its alpha linear.
	 */
	sheenRoughnessMap?: Texture;
	/**
	 * How much of the thin film's reflection shows, in red, in linear color, which multiplies
	 * `iridescence`. A material with iridescence or anisotropy takes no light map and no specular
	 * maps, since its maps take their places.
	 */
	iridescenceMap?: Texture;
	/**
	 * The film's thickness in green, in linear color, which mixes `iridescenceThicknessRange`. A
	 * material with both iridescence maps takes no light map and no specular maps.
	 */
	iridescenceThicknessMap?: Texture;
	/**
	 * The anisotropy's direction in red and green and its strength in blue, in linear color: red
	 * and green are a direction in the tangent plane, and blue multiplies `anisotropy`. A material
	 * with it takes no light map, no specular maps and no clear coat or sheen map.
	 */
	anisotropyMap?: Texture;
}

/**
 * The options that choose how a material's shader and pipeline draw it. They are fixed when the
 * material is created, as most of them would need a new pipeline.
 *
 * @category api/materials
 */
export interface MaterialFeatures {
	/** Draws both faces of each triangle. Back faces light as if they faced the camera. The default is false. */
	doubleSided?: boolean;
	/**
	 * Multiplies the base color by the mesh's vertex colors, and the alpha by their alpha, on
	 * meshes that have them. The default is false.
	 */
	vertexColors?: boolean;
	/** Takes the scene's fog. False keeps the material's color at every distance. The default is true. */
	fog?: boolean;
	/**
	 * Keeps the color as the display shows it, as three.js's `toneMapped: false` does. The tone
	 * curve leaves it alone: the 8-bit path decides that in the shader of the material's own build,
	 * and the HDR path's final pass reads a mask of these surfaces and skips the curve where one
	 * draws. A blended surface keeps the curve on the HDR path, since a blended pixel mixes two
	 * surfaces. The vignette and the sRGB encoding still apply, and the exposure already scales
	 * the material's colors, so the color shows brighter than the same color tone mapped. The
	 * default is true.
	 */
	toneMapped?: boolean;
	/** How the material uses its alpha. The default is `opaque`. */
	alphaMode?: AlphaMode;
	/**
	 * With the `mask` alpha mode, smooths the cut edges with MSAA, as three.js's
	 * `alphaToCoverage` does: the alpha fades over about one pixel above `alphaCutoff`, and covers
	 * that share of the pixel. Without MSAA the mask cuts as without it. False gives three.js's hard
	 * cut edges of `alphaTest`. Custom materials do not take it. The default is true.
	 */
	alphaToCoverage?: boolean;
	/**
	 * With the `blend` alpha mode and `doubleSided`, draws both faces in one draw, in the mesh's
	 * order, as three.js's `forceSinglePass` does. By default such a surface draws its back faces
	 * first and then its front faces, so its near side always covers its far side. The default is
	 * false.
	 */
	forceSinglePass?: boolean;
	/** With the `blend` alpha mode, how the surface meets what lies behind it. The default is `normal`. */
	blending?: Blending;
	/** False to write no depth, so the surface hides nothing behind it. The default is true. */
	depthWrite?: boolean;
	/**
	 * False to draw the surface whatever lies in front of it. It then writes no depth either, as
	 * in three.js's WebGL renderer. The default is true.
	 */
	depthTest?: boolean;
	/** Moves the surface's depth, as three.js's polygon offset does. The default is no bias. */
	depthBias?: DepthBias;
	/**
	 * Draws the edges of each triangle as lines one pixel wide, with the material's own shading,
	 * as three.js's `wireframe` does. Edges that two triangles share draw twice. Its shadows draw
	 * lines too. Flat shading and bump maps have no effect on it. The default is false.
	 */
	wireframe?: boolean;
}

/**
 * The options of `materials.standard` besides its texture maps. Custom materials take them too.
 *
 * @category api/materials
 */
export interface StandardBaseOptions extends StandardValues, MaterialFeatures {
	/**
	 * Lights each triangle with one normal, the normal of its face, so the mesh looks faceted. It
	 * is fixed when the material is created. The default is false.
	 */
	flatShading?: boolean;
	/**
	 * Where a light map's texture coordinates start, as three.js's `texture.offset`. A bake places
	 * each light map on a mesh with its own scale and offset, apart from the other maps. It takes
	 * two numbers, and needs a `lightMap`. The default leaves the coordinates alone.
	 */
	lightMapOffset?: readonly [number, number];
	/**
	 * How a light map's texture coordinates stretch, as three.js's `texture.repeat`. It takes two
	 * numbers, and needs a `lightMap`. The default is `[1, 1]`.
	 */
	lightMapRepeat?: readonly [number, number];
	/**
	 * How the engine reads the light map's texels: `srgb` (the default) takes the texture as sRGB
	 * color, which the sampler turns linear, or `rgbm` multiplies each texel's color by its alpha
	 * times 8 and then decodes it as sRGB, as Needle's viewer reads its light maps. With `rgbm`,
	 * give a texture in linear color, whose raw bytes the shader decodes. It needs a `lightMap`.
	 */
	lightMapDecode?: 'srgb' | 'rgbm';
	/**
	 * The direction of the light that a directional light map stores at each texel, in linear
	 * color: red, green and blue map the direction's x, y and z from -1 to 1. A normal map then
	 * bends the light that the bake stored, instead of lighting it evenly. Give the texture that
	 * `assets.loadLightMap` returns beside the radiance: the engine reads the direction through
	 * the light map's own texture binding, so both must have one size, format and color space,
	 * as `loadLightMap` makes them. Needs a `lightMap`.
	 */
	lightMapDirection?: Texture;
	/**
	 * Takes the main directional light's contact shadows. False leaves them off this surface,
	 * which keeps the shadow map's shadows. Set it on thin surfaces that crowd together or sway,
	 * such as grass blades and leaf cards: the contact shadows take each blade for a solid wall,
	 * so they darken such surfaces and flicker as they move. The surfaces under them keep their
	 * contact shadows. It is fixed when the material is created. The default is true.
	 */
	contactShadows?: boolean;
}

/**
 * Options of `materials.standard`.
 *
 * @category api/materials
 */
export interface StandardOptions extends StandardBaseOptions, StandardMaps {}

/**
 * The values of an unlit material, which `set` changes at any time.
 *
 * @category api/materials
 */
export interface UnlitValues extends MaterialOptions {
	/** Where the map sits on the texture coordinates. The default leaves it as it is. */
	uvTransform?: UvTransform;
}

/**
 * The values of a decal material, which `set` changes at any time: the standard material's values
 * that a decal shows, and how the decal fades.
 *
 * @category api/materials
 */
export interface DecalValues
	extends Omit<
		StandardValues,
		| 'alphaCutoff'
		| 'lightMapIntensity'
		| 'transmission'
		| 'thickness'
		| 'attenuationColor'
		| 'attenuationDistance'
	> {
	/**
	 * The angles in radians, from the decal's direction, at which the decal starts to fade and
	 * past which it shows nothing. The direction is the +z axis of the decal's box, which points
	 * out of the surfaces that it marks. A surface at an angle past the second shows none of the
	 * decal, so the decal does not smear along walls and edges. Each angle runs from 0 to π, and
	 * the first is at most the second. The default is `[π / 3, 4π / 9]`: 60 and 80 degrees.
	 */
	angleFade?: readonly [number, number];
	/**
	 * The share of the box's depth, from 0 to 1, over which the decal fades out toward each end
	 * of its z axis, so a decal that reaches past a surface's edge fades rather than stops. The
	 * default is 0.2.
	 */
	edgeFade?: number;
}

/**
 * Options of `materials.decal`: its values and the standard material's maps, which the decal
 * projects along its box. The light map is left out.
 *
 * @category api/materials
 */
export interface DecalOptions
	extends DecalValues,
		Omit<StandardMaps, 'lightMap' | 'transmissionMap' | 'thicknessMap'> {}

/**
 * Options of `materials.unlit`.
 *
 * @category api/materials
 */
export interface UnlitOptions extends UnlitValues, MaterialFeatures {
	/**
	 * A color map, in sRGB, whose color multiplies `color`. It is fixed when the material is
	 * created, and meshes need texture coordinates to show it.
	 */
	map?: Texture;
}

/**
 * The values of a shadow-catcher material, which `set` changes at any time.
 *
 * @category api/materials
 */
export interface ShadowCatcherValues extends MaterialOptions {}

/**
 * Options of `materials.shadowCatcher`, a material that draws only the shadows that fall on it, as
 * three.js's `ShadowMaterial`.
 *
 * @category api/materials
 */
export interface ShadowCatcherOptions extends ShadowCatcherValues {
	/** Draws both faces of each triangle. Back faces light as if they faced the camera. The default is false. */
	doubleSided?: boolean;
	/** False to write no depth, so the surface hides nothing behind it. The default is true. */
	depthWrite?: boolean;
}

/**
 * WGSL that the null3D Vite plugin compiled: a template literal that a `wgsl` block comment tags,
 * or a `.wgsl` file that a module imports. TypeScript sees a tagged literal as a string, and the
 * plugin puts the compiled WGSL in its place.
 *
 * @category api/materials
 */
export interface CompiledWgsl {
	/**
	 * `'material'` for the functions of a custom material, `'effect'` for a custom effect,
	 * `'toneCurve'` for a custom tone curve, `'skyLayer'` for a sky layer, and `'shader'` for a
	 * whole shader.
	 */
	readonly kind: 'material' | 'effect' | 'toneCurve' | 'skyLayer' | 'shader';
	/**
	 * True for a draw shader: a custom material's `@vertex` entry point takes the vertex and
	 * instance indices and no mesh attribute, and `scene.createVertexDraw` draws it from a vertex
	 * count.
	 */
	readonly meshless?: boolean;
}

/**
 * The values of a custom material, which `set` changes at any time: the standard values but the
 * texture coordinate transform of maps, and the uniforms that its WGSL's `struct Uniforms`
 * declares, by name. `Wgsl` is the type of the material's WGSL, which gives the uniforms' names
 * and types, as `WgslUniforms` says.
 *
 * @category api/materials
 */
export type ShaderValues<Wgsl = string | CompiledWgsl> = [Wgsl] extends [unknown]
	? Omit<StandardValues, MapValues> & UniformValues<Wgsl>
	: never;

/** The standard values that only the standard material's maps read. */
type MapValues = 'uvTransform' | 'bumpScale' | 'displacementScale' | 'displacementBias';

/**
 * Options of `materials.shader`: the material's WGSL, the first values of its uniforms, and the
 * textures that its WGSL samples. It also takes every option of `materials.standard` but the
 * texture maps. `defaultSurface` applies the standard values. Custom materials take no standard
 * maps, so the values of maps have no effect on them. `Wgsl` is the type of the material's WGSL. It
 * gives the names and types of the uniforms, and the names of the textures.
 *
 * @category api/materials
 */
export interface ShaderOptions<Wgsl extends string | CompiledWgsl = string | CompiledWgsl>
	extends StandardBaseOptions {
	/**
	 * The material's WGSL, compiled by the null3D Vite plugin. It declares
	 * `fn surface(input: SurfaceInput) -> Surface`, which the engine calls for each pixel, and
	 * which can start from `defaultSurface(input)`. The engine lights the surface that it returns.
	 * It can declare `struct Uniforms`, whose fields the surface function reads from `material`,
	 * `fn vertexOffset`, which moves the mesh's vertices, and `fn lobe(input: LobeInput) -> vec3f`,
	 * which adds specular for the main light beside the base lobe. A full shader has a `@vertex`
	 * entry point that takes an `InstanceIn`, and a `@fragment` one, instead. Materials made from the
	 * same WGSL share their shader.
	 */
	wgsl: Wgsl;
	/**
	 * The first value of each uniform, by name. A uniform without one starts at 0. When TypeScript
	 * can see the WGSL's uniforms, a name that the WGSL does not declare fails the type check, and
	 * WGSL without uniforms takes none.
	 */
	uniforms?: NoInfer<
		[keyof UniformValues<Wgsl>] extends [never]
			? { readonly [name: string]: never }
			: UniformValues<Wgsl>
	>;
	/**
	 * The texture of each `var name: texture_2d<f32>;` or `var name: texture_2d_array<f32>;` that
	 * the WGSL declares, by name. The WGSL samples a 2D texture as
	 * `textureSample(name, nameSampler, uv)`, with the sampler of the texture's `wrap` and `filter`
	 * options, and a texture array as `textureSample(name, nameSampler, uv, layer)`, where it picks
	 * the layer of a texture of several layers. A texture samples as white until its image is on
	 * the GPU, and a declared texture without one stays white. The textures are fixed when the
	 * material is created. When TypeScript can see the WGSL, a name that it does not declare fails
	 * the type check.
	 */
	textures?: NoInfer<TextureValues<Wgsl>>;
	/**
	 * The scene inputs that the material's surface function reads. Today that is `'sceneDepth'`:
	 * the WGSL calls `sceneDepth(uv)` or `sceneDistance(uv)`, and the engine binds the copy of the
	 * opaque scene's depth. A material that declares it draws after that copy exists, so it reads
	 * it in the transparent pass; a surface that draws earlier reads 0, the far plane. A material
	 * that declares it takes at most seven textures of its own: its maps' group gives up one slot,
	 * so that the copy fits the fragment stage beside the maps under WebGPU's limit of sixteen
	 * sampled textures. The engine checks that the declaration and the WGSL agree.
	 */
	sceneInputs?: readonly SceneInput[];
}

/** A uniform of a custom material: its type, and the float of the row of custom values it starts at. */
interface CompiledUniform {
	readonly name: string;
	readonly type: UniformType;
	readonly offset: number;
}

/**
 * A custom material's WGSL as the plugin compiles it: the standard material's variants with it, or
 * a full shader's, with the vertex attributes that its vertex stage reads.
 */
interface CompiledMaterial extends CompiledWgsl {
	readonly kind: 'material';
	/** The builds, which a module's value leaves out: they load on first use through `builds`. */
	readonly variants: ShaderVariants;
	/** Imports a set of the builds, which load on first use, by GPU path and permutation bits. */
	readonly builds?: BuildsLoader;
	/** Every permutation bit of the builds, joined, where the value leaves the builds out. */
	readonly permutations?: number;
	readonly locations: readonly number[];
	/** The optional vertex attributes (`VERTEX_*` bits) that the vertex stage reads. */
	readonly attributes: number;
	/** True when the shader reads the material's base color and opacity, as the template does. */
	readonly baseColor: boolean;
	/** True when the WGSL reads an instance's index or an object's id. */
	readonly objectIds?: boolean;
	/** True when the WGSL reads the copy of the scene's depth through `sceneDepth`. */
	readonly sceneDepth?: boolean;
	readonly uniforms: readonly CompiledUniform[];
	/** The textures that the WGSL declares, in the order of their map slots. */
	readonly textures: readonly {
		readonly name: string;
		/** True for a declaration of a texture array, whose layers the WGSL picks. */
		readonly array?: boolean;
	}[];
	/** On the dev server, the key of the WGSL's hot updates. */
	readonly hot?: string;
}

/**
 * What the thread that draws builds a custom material's pipelines from. Its builds come on first
 * use, unless the compiled WGSL holds them, as a hot update's does.
 */
function customShader(compiled: CompiledMaterial): CustomShader {
	return {
		variants: compiled.variants,
		locations: compiled.locations,
		textures: compiled.textures.length,
		...(compiled.meshless === true && { meshless: true }),
		...(compiled.sceneDepth === true && { sceneDepth: true }),
		...(compiled.builds && { builds: true }),
	};
}

/** True when one of a custom material's builds has any of the permutation bits of `bits`. */
function builds(compiled: CompiledMaterial, bits: number): boolean {
	if (compiled.permutations !== undefined) return (compiled.permutations & bits) !== 0;
	return Object.values(compiled.variants).some((v) => v.permutation & bits);
}

/** True when a custom material's WGSL has the builds that let light through. */
function lets(compiled: CompiledMaterial): boolean {
	return builds(compiled, PERMUTATION_TRANSMISSION);
}

/** Every value of either material, which `set` writes. */
type AnyValues = StandardValues & UnlitValues & Pick<DecalValues, 'angleFade' | 'edgeFade'>;

/** The options of the values that are numbers, with the range each takes. */
type Ranged =
	| 'opacity'
	| 'alphaCutoff'
	| 'metalness'
	| 'roughness'
	| 'emissiveIntensity'
	| 'aoMapIntensity'
	| 'lightMapIntensity'
	| 'specularIntensity'
	| 'envIntensity'
	| 'transmission'
	| 'thickness'
	| 'diffuseTransmission'
	| 'subsurfaceRadius'
	| 'clearcoat'
	| 'clearcoatRoughness'
	| 'sheenRoughness'
	| 'iridescence'
	| 'anisotropy'
	| 'edgeFade';

/** Each value that is a number, and the most it takes, or none above 0. */
const RANGED: readonly (readonly [Ranged, number])[] = [
	['opacity', 1],
	['alphaCutoff', 1],
	['metalness', 1],
	['roughness', 1],
	['emissiveIntensity', Number.POSITIVE_INFINITY],
	['aoMapIntensity', 1],
	['lightMapIntensity', Number.POSITIVE_INFINITY],
	['specularIntensity', 1],
	['envIntensity', Number.POSITIVE_INFINITY],
	['transmission', 1],
	['thickness', Number.POSITIVE_INFINITY],
	['diffuseTransmission', 1],
	['subsurfaceRadius', Number.POSITIVE_INFINITY],
	['clearcoat', 1],
	['clearcoatRoughness', 1],
	['sheenRoughness', 1],
	['iridescence', 1],
	['anisotropy', 1],
	['edgeFade', 1],
];

/** The highest value that each ranged value takes, by its name. */
const ONE_VALUE_MAX: ReadonlyMap<string, number> = new Map(RANGED);

/** Each whole-number value's name, in `RANGED`'s order, for the development checks. */
const RANGED_NAMES: readonly string[] = [
	'opacity',
	'alpha cutoff',
	'metalness',
	'roughness',
	'emissive intensity',
	'aoMapIntensity',
	'lightMapIntensity',
	'specularIntensity',
	'envIntensity',
	'transmission',
	'thickness',
	'diffuseTransmission',
	'subsurfaceRadius',
	'clearcoat',
	'clearcoatRoughness',
	'sheenRoughness',
	'iridescence',
	'anisotropy',
	'edgeFade',
];

/** The core's slot of each map option. */
const MAP_OPTIONS: readonly (readonly [Exclude<keyof StandardMaps, 'parallax'>, number])[] = [
	['map', MAP_SLOT_BASE_COLOR],
	['metalnessRoughnessMap', MAP_SLOT_METAL_ROUGH],
	['normalMap', MAP_SLOT_NORMAL],
	['aoMap', MAP_SLOT_OCCLUSION],
	['emissiveMap', MAP_SLOT_EMISSIVE],
	['lightMap', MAP_SLOT_LIGHT],
	['specularIntensityMap', MAP_SLOT_SPECULAR_INTENSITY],
	['specularColorMap', MAP_SLOT_SPECULAR_COLOR],
	['diffuseTransmissionMap', MAP_SLOT_DIFFUSE_TRANSMISSION],
	['diffuseTransmissionColorMap', MAP_SLOT_DIFFUSE_TRANSMISSION_COLOR],
	['transmissionMap', MAP_SLOT_TRANSMISSION],
	['thicknessMap', MAP_SLOT_THICKNESS],
	['clearcoatMap', MAP_SLOT_COAT],
	['clearcoatRoughnessMap', MAP_SLOT_COAT_ROUGHNESS],
	['clearcoatNormalMap', MAP_SLOT_COAT_NORMAL],
	['sheenColorMap', MAP_SLOT_SHEEN_COLOR],
	['sheenRoughnessMap', MAP_SLOT_SHEEN_ROUGHNESS],
	['iridescenceMap', MAP_SLOT_IRIDESCENCE],
	['iridescenceThicknessMap', MAP_SLOT_IRIDESCENCE_THICKNESS],
	['anisotropyMap', MAP_SLOT_ANISOTROPY],
];

/** The maps that share their slots with the diffuse transmission maps. */
const SPECULAR_MAPS: ReadonlySet<keyof StandardMaps> = new Set([
	'specularIntensityMap',
	'specularColorMap',
]);

/** The maps that only a material that lets light through to its other side takes. */
const TRANSLUCENCY_MAPS: ReadonlySet<keyof StandardMaps> = new Set([
	'diffuseTransmissionMap',
	'diffuseTransmissionColorMap',
]);

/**
 * The maps that share their slots with the specular maps, of a material that lets light through:
 * the slots of the one hold the maps of the other.
 */
const TRANSMISSION_MAPS: ReadonlySet<keyof StandardMaps> = new Set([
	'transmissionMap',
	'thicknessMap',
]);

/**
 * True when a map option does not fit a material with `features`: the diffuse transmission maps
 * without diffuse transmission, and the specular maps with it, which would take the same slots.
 */
function skipsMap(key: keyof StandardMaps, features: number): boolean {
	const translucent = (features & MATERIAL_FEATURE_TRANSLUCENCY) !== 0;
	return translucent ? SPECULAR_MAPS.has(key) : TRANSLUCENCY_MAPS.has(key);
}

/**
 * True for a transmission or thickness map that a material leaves out, because it gives no
 * transmission, lets light through to its other side, or gives a specular map: each of them takes
 * the specular maps' slots. Development builds refuse these with E1217 instead.
 */
function skipsTransmissionMap(options: StandardOptions, key: keyof StandardMaps): boolean {
	if (!TRANSMISSION_MAPS.has(key)) return false;
	return (
		options.transmission === undefined ||
		options.diffuseTransmission !== undefined ||
		options.specularIntensityMap !== undefined ||
		options.specularColorMap !== undefined
	);
}

/** The values of a clear coat, a sheen, iridescence or anisotropy, any of which gives a material its layers. */
const LAYER_VALUES = [
	'clearcoat',
	'clearcoatRoughness',
	'clearcoatNormalScale',
	'sheenColor',
	'sheenRoughness',
	'iridescence',
	'iridescenceIor',
	'iridescenceThicknessRange',
	'anisotropy',
	'anisotropyRotation',
] as const;

/** The maps of a clear coat and a sheen. */
const LAYER_MAPS = [
	'clearcoatMap',
	'clearcoatRoughnessMap',
	'clearcoatNormalMap',
	'sheenColorMap',
	'sheenRoughnessMap',
	'iridescenceMap',
	'iridescenceThicknessMap',
	'anisotropyMap',
] as const;

/** The layer maps that hold a clear coat or a sheen. */
const COAT_SHEEN_MAPS: readonly (keyof StandardMaps)[] = [
	'clearcoatMap',
	'clearcoatRoughnessMap',
	'clearcoatNormalMap',
	'sheenColorMap',
	'sheenRoughnessMap',
];

/** The layer maps that hold iridescence. */
const IRIDESCENCE_MAPS: readonly (keyof StandardMaps)[] = [
	'iridescenceMap',
	'iridescenceThicknessMap',
];

/** The layer maps that fill the specular intensity map's slot, which a transmission map takes. */
const SPECULAR_INTENSITY_LAYER_MAPS: readonly (keyof StandardMaps)[] = [
	'clearcoatNormalMap',
	'iridescenceThicknessMap',
];

/** The layer maps that fill the specular color map's slot, which a thickness map takes. */
const SPECULAR_COLOR_LAYER_MAPS: readonly (keyof StandardMaps)[] = [
	'sheenColorMap',
	'sheenRoughnessMap',
	'anisotropyMap',
];

/**
 * The layer map that fills the slot that a transmission or a thickness map takes, or none: the
 * transmission map shares the specular intensity map's slot and the thickness map the specular
 * color map's. A material with layers may keep the two maps beside the one layer map of the light
 * map's slot, so this names the clash that remains.
 */
function volumeSlotOwner(
	options: StandardOptions,
	key: keyof StandardMaps,
): keyof StandardMaps | undefined {
	const owners =
		key === 'transmissionMap'
			? SPECULAR_INTENSITY_LAYER_MAPS
			: key === 'thicknessMap'
				? SPECULAR_COLOR_LAYER_MAPS
				: undefined;
	return owners?.find((owner) => options[owner] !== undefined);
}

/** True when `options` give any map of `keys`. */
function takesAnyMap(options: StandardOptions, keys: readonly (keyof StandardMaps)[]): boolean {
	return keys.some((key) => options[key] !== undefined);
}

/** True when `options` give the material a thin film above its surface. */
function takesIridescence(options: StandardOptions): boolean {
	return (
		options.iridescence !== undefined ||
		options.iridescenceIor !== undefined ||
		options.iridescenceThicknessRange !== undefined ||
		options.iridescenceMap !== undefined ||
		options.iridescenceThicknessMap !== undefined
	);
}

/** True when `options` give the material a stretched specular lobe. */
function takesAnisotropy(options: StandardOptions): boolean {
	return (
		options.anisotropy !== undefined ||
		options.anisotropyRotation !== undefined ||
		options.anisotropyMap !== undefined
	);
}

/**
 * True for a map that a layered material leaves out, which development builds refuse with E1217:
 * a map whose slot another layer's maps take, and the second map of a pair that is not the texture
 * of the first. A material takes its layer maps from one family: the coat's and the sheen's, or
 * iridescence's and the anisotropy's. Production builds skip the check, so the material draws
 * without the map rather than read it as another layer's.
 */
function skipsLayerMap(options: StandardOptions, key: keyof StandardMaps): boolean {
	if (key === 'lightMap' || SPECULAR_MAPS.has(key) || TRANSLUCENCY_MAPS.has(key)) return true;
	// A transmission map takes the specular intensity map's slot and a thickness map the specular
	// color map's, so each stays out only where a layer map fills that slot.
	if (TRANSMISSION_MAPS.has(key)) return volumeSlotOwner(options, key) !== undefined;
	if (key === 'clearcoatRoughnessMap')
		return !!options.clearcoatMap && options.clearcoatMap !== options.clearcoatRoughnessMap;
	if (key === 'sheenRoughnessMap')
		return !!options.sheenColorMap && options.sheenColorMap !== options.sheenRoughnessMap;
	if (takesAnyMap(options, COAT_SHEEN_MAPS))
		return IRIDESCENCE_MAPS.includes(key) || key === 'anisotropyMap';
	return false;
}

/** True when `options` give the material layers above its base. */
function hasLayers(options: StandardOptions): boolean {
	return (
		LAYER_VALUES.some((key) => options[key] !== undefined) ||
		LAYER_MAPS.some((key) => options[key] !== undefined)
	);
}

/** Throws E1108 for a pair or a transform with a number that is not finite. */
function checkNumbers(values: AnyValues, call: string): void {
	const {
		normalScale,
		clearcoatNormalScale,
		uvTransform,
		bumpScale,
		displacementScale,
		displacementBias,
	} = values;
	const numbers = [
		...(normalScale ?? []),
		...(clearcoatNormalScale ?? []),
		...(uvTransform?.offset ?? []),
		...(uvTransform?.repeat ?? []),
		uvTransform?.rotation ?? 0,
		bumpScale ?? 0,
		displacementScale ?? 0,
		displacementBias ?? 0,
	];
	if (!numbers.every(Number.isFinite))
		throw new EngineError(
			'E1108',
			`${call}() got a normalScale, clearcoatNormalScale, uvTransform, bumpScale, displacementScale or displacementBias that is not finite.`,
		);
}

/** Throws E1108 for each number of `values` outside its range. Call it inside `if (DEV)`. */
function checkValues(values: AnyValues, call: string): void {
	checkNumbers(values, call);
	const { ior, attenuationDistance: distance, angleFade } = values;
	const { iridescenceIor, iridescenceThicknessRange, anisotropyRotation } = values as {
		iridescenceIor?: number;
		iridescenceThicknessRange?: readonly [number, number];
		anisotropyRotation?: number;
	};
	if (
		iridescenceIor !== undefined &&
		!(iridescenceIor >= 1 && iridescenceIor < Number.POSITIVE_INFINITY)
	)
		throw new EngineError(
			'E1108',
			`${call}() got the iridescenceIor ${iridescenceIor}; it takes a finite 1 or more.`,
		);
	if (
		iridescenceThicknessRange !== undefined &&
		!(
			iridescenceThicknessRange.length === 2 &&
			iridescenceThicknessRange[0] >= 0 &&
			iridescenceThicknessRange[0] <= iridescenceThicknessRange[1] &&
			Number.isFinite(iridescenceThicknessRange[1])
		)
	)
		throw new EngineError(
			'E1108',
			`${call}() got the iridescenceThicknessRange ${JSON.stringify(iridescenceThicknessRange)}; it takes two thicknesses in nanometers, the first no larger than the second.`,
		);
	if (anisotropyRotation !== undefined && !Number.isFinite(anisotropyRotation))
		throw new EngineError(
			'E1108',
			`${call}() got the anisotropyRotation ${anisotropyRotation}; it takes a finite number of radians.`,
		);
	if (
		angleFade !== undefined &&
		!(
			angleFade.length === 2 &&
			angleFade[0] >= 0 &&
			angleFade[0] <= angleFade[1] &&
			angleFade[1] <= Math.PI
		)
	)
		throw new EngineError(
			'E1108',
			`${call}() got the angleFade ${JSON.stringify(angleFade)}; it takes two angles from 0 to π, the first no larger than the second.`,
		);
	if (ior !== undefined && !(ior >= 1 && ior < Number.POSITIVE_INFINITY))
		throw new EngineError('E1108', `${call}() got the ior ${ior}; it takes a finite 1 or more.`);
	if (distance !== undefined && !(distance > 0))
		throw new EngineError(
			'E1108',
			`${call}() got the attenuationDistance ${distance}; it takes more than 0, or Infinity.`,
		);
	for (let k = 0; k < RANGED.length; k++) {
		const [key, most] = RANGED[k] as readonly [Ranged, number];
		const value = values[key];
		if (value === undefined) continue;
		if (!(value >= 0 && value <= most)) {
			const name = RANGED_NAMES[k] as string;
			throw new EngineError(
				'E1108',
				most === 1
					? `${call}() got the ${name} ${value}, outside 0 to 1.`
					: `${call}() got the ${name} ${value}; it takes 0 or more.`,
			);
		}
	}
}

/**
 * Writes the numbers of `values` that are set, and the linear colors that are given, into the
 * core's row of material `id`. Every value was checked and every color converted before, so a
 * call that throws changes nothing. Each number option is read once, by its name, only from an
 * object that holds it, and goes to the core through its call values. A fraction read by a key
 * that changes, read where some objects lack it and the read gives `undefined`, or passed as an
 * argument to a call that the browser does not inline, would each make a number object.
 */
function writeValues(
	core: CoreMemory,
	id: number,
	call: string,
	values: AnyValues,
	color: Float64Array | undefined,
	emissive: Float64Array | undefined,
	specular: Float64Array | undefined,
	attenuation: Float64Array | undefined,
	through: Float64Array | undefined,
	scatter: Float64Array | undefined,
	sheen: Float64Array | undefined,
): void {
	if (color) sendColor(core, id, MATERIAL_PARAM_COLOR, color, call);
	if (emissive) sendColor(core, id, MATERIAL_PARAM_EMISSIVE, emissive, call);
	if (specular) sendColor(core, id, MATERIAL_PARAM_SPECULAR_COLOR, specular, call);
	if (attenuation) sendColor(core, id, MATERIAL_PARAM_ATTENUATION_COLOR, attenuation, call);
	if (through) sendColor(core, id, MATERIAL_PARAM_DIFFUSE_TRANSMISSION_COLOR, through, call);
	if (scatter) sendColor(core, id, MATERIAL_PARAM_SUBSURFACE_COLOR, scatter, call);
	if (sheen) sendColor(core, id, MATERIAL_PARAM_SHEEN_COLOR, sheen, call);
	const numbers = core.callValues();
	const { normalScale, clearcoatNormalScale, uvTransform, angleFade } = values;
	if ('opacity' in values) {
		const value = values.opacity;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_OPACITY, call);
		}
	}
	if ('alphaCutoff' in values) {
		const value = values.alphaCutoff;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_ALPHA_CUTOFF, call);
		}
	}
	if ('metalness' in values) {
		const value = values.metalness;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_METALNESS, call);
		}
	}
	if ('roughness' in values) {
		const value = values.roughness;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_ROUGHNESS, call);
		}
	}
	if ('emissiveIntensity' in values) {
		const value = values.emissiveIntensity;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_EMISSIVE_INTENSITY, call);
		}
	}
	if ('aoMapIntensity' in values) {
		const value = values.aoMapIntensity;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_OCCLUSION_STRENGTH, call);
		}
	}
	if ('lightMapIntensity' in values) {
		const value = values.lightMapIntensity;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_LIGHT_MAP_INTENSITY, call);
		}
	}
	if ('specularIntensity' in values) {
		const value = values.specularIntensity;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_SPECULAR_INTENSITY, call);
		}
	}
	if ('envIntensity' in values) {
		const value = values.envIntensity;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_ENV_INTENSITY, call);
		}
	}
	if ('transmission' in values) {
		const value = values.transmission;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_TRANSMISSION, call);
		}
	}
	if ('thickness' in values) {
		const value = values.thickness;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_THICKNESS, call);
		}
	}
	if ('diffuseTransmission' in values) {
		const value = values.diffuseTransmission;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_DIFFUSE_TRANSMISSION, call);
		}
	}
	if ('subsurfaceRadius' in values) {
		const value = values.subsurfaceRadius;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_SUBSURFACE_RADIUS, call);
		}
	}
	if ('clearcoat' in values) {
		const value = values.clearcoat;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_CLEARCOAT, call);
		}
	}
	if ('clearcoatRoughness' in values) {
		const value = values.clearcoatRoughness;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_CLEARCOAT_ROUGHNESS, call);
		}
	}
	if ('sheenRoughness' in values) {
		const value = values.sheenRoughness;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_SHEEN_ROUGHNESS, call);
		}
	}
	if ('iridescence' in values) {
		const value = values.iridescence;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_IRIDESCENCE, call);
		}
	}
	if ('iridescenceIor' in values) {
		const value = values.iridescenceIor;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_IRIDESCENCE_IOR, call);
		}
	}
	if ('anisotropy' in values) {
		const value = values.anisotropy;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_ANISOTROPY, call);
		}
	}
	if ('anisotropyRotation' in values) {
		const value = values.anisotropyRotation;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_ANISOTROPY_ROTATION, call);
		}
	}
	// The film's thickness at each end of its map's green channel.
	const thickness = (values as { iridescenceThicknessRange?: readonly [number, number] })
		.iridescenceThicknessRange;
	if (thickness) {
		numbers[0] = thickness[0];
		sendValue(core, id, MATERIAL_PARAM_IRIDESCENCE_THICKNESS_MIN, call);
		numbers[0] = thickness[1];
		sendValue(core, id, MATERIAL_PARAM_IRIDESCENCE_THICKNESS_MAX, call);
	}
	if ('edgeFade' in values) {
		const value = values.edgeFade;
		if (value !== undefined) {
			numbers[0] = value;
			sendValue(core, id, MATERIAL_PARAM_DECAL_EDGE_FADE, call);
		}
	}
	// A decal's fade from its direction: the cosines of the two angles the material carries.
	if (angleFade) {
		numbers[0] = Math.cos(angleFade[0]);
		sendValue(core, id, MATERIAL_PARAM_DECAL_FADE_START, call);
		numbers[0] = Math.cos(angleFade[1]);
		sendValue(core, id, MATERIAL_PARAM_DECAL_FADE_END, call);
	}
	if ('ior' in values) {
		const ior = values.ior;
		if (ior !== undefined) {
			numbers[0] = reflectance(ior);
			sendValue(core, id, MATERIAL_PARAM_REFLECTANCE, call);
			numbers[0] = ior;
			sendValue(core, id, MATERIAL_PARAM_IOR, call);
		}
	}
	// The core keeps 0 for a volume that absorbs nothing.
	if ('attenuationDistance' in values) {
		const distance = values.attenuationDistance;
		if (distance !== undefined) {
			numbers[0] = distance < Infinity ? distance : 0;
			sendValue(core, id, MATERIAL_PARAM_ATTENUATION_DISTANCE, call);
		}
	}
	if (normalScale) {
		numbers[0] = normalScale[0];
		numbers[1] = normalScale[1];
		sendValue(core, id, MATERIAL_PARAM_NORMAL_SCALE, call);
	}
	if (clearcoatNormalScale) {
		numbers[0] = clearcoatNormalScale[0];
		numbers[1] = clearcoatNormalScale[1];
		sendValue(core, id, MATERIAL_PARAM_CLEARCOAT_NORMAL_SCALE, call);
	}
	if (uvTransform) {
		const { offset, repeat, rotation = 0 } = uvTransform;
		writeUvMatrix(
			core,
			id,
			offset ? offset[0] : 0,
			offset ? offset[1] : 0,
			repeat ? repeat[0] : 1,
			repeat ? repeat[1] : 1,
			rotation,
			call,
		);
	}
}

/**
 * Writes where material `id`'s maps sit on the texture coordinates, as three.js's texture matrix
 * with its center at the origin, by rows. It allocates nothing.
 */
function writeUvMatrix(
	core: CoreMemory,
	id: number,
	offsetU: number,
	offsetV: number,
	scaleU: number,
	scaleV: number,
	rotation: number,
	call: string,
): void {
	const numbers = core.callValues();
	const c = Math.cos(rotation);
	const s = Math.sin(rotation);
	numbers[0] = scaleU * c;
	numbers[1] = scaleU * s;
	numbers[2] = offsetU;
	sendValue(core, id, MATERIAL_PARAM_UV_U, call);
	numbers[0] = -scaleV * s;
	numbers[1] = scaleV * c;
	numbers[2] = offsetV;
	sendValue(core, id, MATERIAL_PARAM_UV_V, call);
}

/** Sets material `id`'s value `param` to the core's call values. */
function sendValue(core: CoreMemory, id: number, param: number, call: string): void {
	core.check(core.glue.setMaterialValue(id, param), call, undefined, true);
}

/**
 * The core's parameter of each standard value that `setUniform` writes by name: the numbers and the
 * colors that a sketch changes in every frame. A value that takes more than one parameter, as the
 * texture transform, the normal scales, the angle fade and the index of refraction do, goes through
 * `set`.
 */
const ONE_VALUE_PARAMS: ReadonlyMap<string, number> = new Map<string, number>([
	['color', MATERIAL_PARAM_COLOR],
	['emissive', MATERIAL_PARAM_EMISSIVE],
	['specularColor', MATERIAL_PARAM_SPECULAR_COLOR],
	['attenuationColor', MATERIAL_PARAM_ATTENUATION_COLOR],
	['sheenColor', MATERIAL_PARAM_SHEEN_COLOR],
	['opacity', MATERIAL_PARAM_OPACITY],
	['alphaCutoff', MATERIAL_PARAM_ALPHA_CUTOFF],
	['metalness', MATERIAL_PARAM_METALNESS],
	['roughness', MATERIAL_PARAM_ROUGHNESS],
	['emissiveIntensity', MATERIAL_PARAM_EMISSIVE_INTENSITY],
	['aoMapIntensity', MATERIAL_PARAM_OCCLUSION_STRENGTH],
	['lightMapIntensity', MATERIAL_PARAM_LIGHT_MAP_INTENSITY],
	['specularIntensity', MATERIAL_PARAM_SPECULAR_INTENSITY],
	['envIntensity', MATERIAL_PARAM_ENV_INTENSITY],
	['transmission', MATERIAL_PARAM_TRANSMISSION],
	['thickness', MATERIAL_PARAM_THICKNESS],
	['diffuseTransmission', MATERIAL_PARAM_DIFFUSE_TRANSMISSION],
	['subsurfaceRadius', MATERIAL_PARAM_SUBSURFACE_RADIUS],
	['clearcoat', MATERIAL_PARAM_CLEARCOAT],
	['clearcoatRoughness', MATERIAL_PARAM_CLEARCOAT_ROUGHNESS],
	['sheenRoughness', MATERIAL_PARAM_SHEEN_ROUGHNESS],
	['iridescence', MATERIAL_PARAM_IRIDESCENCE],
	['iridescenceIor', MATERIAL_PARAM_IRIDESCENCE_IOR],
	['anisotropy', MATERIAL_PARAM_ANISOTROPY],
	['anisotropyRotation', MATERIAL_PARAM_ANISOTROPY_ROTATION],
	['edgeFade', MATERIAL_PARAM_DECAL_EDGE_FADE],
]);

/** The values of `ONE_VALUE_PARAMS` that take a color; every other takes a number. */
const COLOR_VALUES: ReadonlySet<string> = new Set([
	'color',
	'emissive',
	'specularColor',
	'attenuationColor',
	'sheenColor',
]);

/**
 * The material values that take a pair of numbers: where the maps sit on the texture coordinates.
 * Every map of a material shares the transform, so a pair moves them all.
 */
const UV_VALUES: ReadonlySet<string> = new Set(['uvOffset', 'uvScale']);

/**
 * Numbers per key that a material value takes: 3 for a color, 2 for the maps' offset or scale, 1
 * for a number, and 0 for a name that the value has none. It reads the tables that `setUniform`
 * uses, so a name that it takes is a name that `setUniform` takes.
 *
 * @internal
 */
export function materialValueComponents(name: string): number {
	if (UV_VALUES.has(name)) return 2;
	if (!ONE_VALUE_PARAMS.has(name)) return 0;
	return COLOR_VALUES.has(name) ? 3 : 1;
}

/** The name that messages give `setUniform`, from a material's `set` call string. */
function setUniformCall(call: string): string {
	return call.replace(/\.set$/, '.setUniform');
}

/**
 * Writes one standard value of material `id` by name, through the core's call values. It allocates
 * nothing: the value crosses the call, where `set` reads it from a field of an options object.
 * Throws E1216 for a name or a value that `setUniform` does not take, and, in a development build,
 * E1203 or E1108 for a number that the value does not take.
 */
function writeOneValue(
	core: CoreMemory,
	id: number,
	call: string,
	name: string,
	value: number | ColorInput,
): void {
	const param = ONE_VALUE_PARAMS.get(name);
	if (param === undefined)
		throw new EngineError(
			'E1216',
			`${call}() got ${name}, which it does not take: a number or a color that set() takes on its own, such as roughness or color, or a uniform of a custom material's WGSL.`,
		);
	if (COLOR_VALUES.has(name)) {
		sendColor(
			core,
			id,
			param,
			writeLinearColor(core.callValues(), value as ColorInput, call),
			call,
		);
		return;
	}
	if (DEV) {
		if (typeof value !== 'number' || !Number.isFinite(value))
			throw new EngineError(
				'E1203',
				`${call}() got ${String(value)} for ${name}, which takes a finite number.`,
			);
		for (let k = 0; k < RANGED.length; k++) {
			const [key, most] = RANGED[k] as readonly [string, number];
			if (key !== name) continue;
			if (value < 0 || value > most) {
				const label = RANGED_NAMES[k] as string;
				throw new EngineError(
					'E1108',
					most === 1
						? `${call}() got the ${label} ${value}, outside 0 to 1.`
						: `${call}() got the ${label} ${value}; it takes 0 or more.`,
				);
			}
			break;
		}
	}
	core.callValues()[0] = value as number;
	sendValue(core, id, param, call);
}

/** Sets material `id`'s color `param` to a linear color. */
function sendColor(
	core: CoreMemory,
	id: number,
	param: number,
	color: Float64Array,
	call: string,
): void {
	core.callValues().set(color);
	sendValue(core, id, param, call);
}

/**
 * The arrays that a material's color options convert into: the color, the emissive color, the
 * specular color, the attenuation color, the diffuse transmission color, the scatter color and the
 * sheen color, then a uniform's color while it is checked. Each call converts its colors before it
 * writes any, and nothing reads them after the call, so the calls share them and converting a
 * color allocates nothing.
 */
const COLOR = new Float64Array(3);
const EMISSIVE = new Float64Array(3);
const SPECULAR = new Float64Array(3);
const ATTENUATION = new Float64Array(3);
const THROUGH = new Float64Array(3);
const SCATTER = new Float64Array(3);
const SHEEN = new Float64Array(3);
const UNIFORM_COLOR = new Float64Array(3);

/** The linear value of a color option in `out`, or none when it is not set. */
function linearOrNone(
	color: ColorInput | undefined,
	call: string,
	out: Float64Array,
): Float64Array | undefined {
	return color === undefined ? undefined : writeLinearColor(out, color, call);
}

/**
 * The linear value of a specular color option in `out`, or none when it is not set. Its three
 * linear components may exceed 1, as glTF's specular color factor may.
 */
function specularOrNone(color: ColorInput | undefined, call: string): Float64Array | undefined {
	if (Array.isArray(color) && color.length === 3) {
		const r = color[0];
		const g = color[1];
		const b = color[2];
		if (r >= 0 && r < Infinity && g >= 0 && g < Infinity && b >= 0 && b < Infinity) {
			SPECULAR[0] = r;
			SPECULAR[1] = g;
			SPECULAR[2] = b;
			return SPECULAR;
		}
	}
	return linearOrNone(color, call, SPECULAR);
}

/**
 * The dielectric reflectance at normal incidence of a surface with index of refraction `ior`, by
 * the Fresnel equations, as three.js's physical material computes it.
 */
function reflectance(ior: number): number {
	return ((ior - 1) / (ior + 1)) ** 2;
}

/** The alpha modes, each with the core's feature bit that draws it. */
const ALPHA_MODES: Readonly<Record<AlphaMode, number>> = {
	opaque: 0,
	mask: MATERIAL_FEATURE_ALPHA_MASK,
	hash: MATERIAL_FEATURE_ALPHA_MASK | MATERIAL_FEATURE_ALPHA_HASH,
	blend: MATERIAL_FEATURE_BLEND,
};

/** The blendings, each with the core's feature bit that draws it. */
const BLENDINGS: Readonly<Record<Blending, number>> = {
	normal: 0,
	additive: MATERIAL_FEATURE_ADDITIVE,
	multiply: MATERIAL_FEATURE_MULTIPLY,
	weighted: MATERIAL_FEATURE_WEIGHTED,
};

/**
 * Throws E1217 for an option that fixes the material's pipeline but takes no such value, and
 * E1203 for a depth bias that is not a finite number. Call it inside `if (DEV)`.
 */
function checkFeatures(options: StandardOptions, call: string): void {
	const { alphaMode, blending, depthBias, transmission } = options;
	const features = featureBits(options);
	for (const [name, pair] of [
		['lightMapOffset', options.lightMapOffset],
		['lightMapRepeat', options.lightMapRepeat],
	] as const) {
		if (pair === undefined) continue;
		if (!(pair.length === 2 && pair.every(Number.isFinite)))
			throw new EngineError(
				'E1108',
				`${call}() got the ${name} ${JSON.stringify(pair)}; it takes two finite numbers.`,
			);
	}
	for (const [name, given] of [
		['lightMapDirection', options.lightMapDirection !== undefined],
		['lightMapOffset', options.lightMapOffset !== undefined],
		['lightMapRepeat', options.lightMapRepeat !== undefined],
		['lightMapDecode', options.lightMapDecode !== undefined],
	] as const) {
		if (given && options.lightMap === undefined)
			throw new EngineError(
				'E1217',
				`${call}() got ${name} without lightMap; it sets how the engine reads a light map that the material does not have. Give the material a lightMap.`,
			);
	}
	if (
		options.lightMapDecode !== undefined &&
		options.lightMapDecode !== 'srgb' &&
		options.lightMapDecode !== 'rgbm'
	)
		throw new EngineError(
			'E1217',
			`${call}() got the lightMapDecode ${JSON.stringify(options.lightMapDecode)}; it takes 'srgb' or 'rgbm'.`,
		);
	for (const key of ['transmissionMap', 'thicknessMap'] as const) {
		if (options[key] === undefined) continue;
		if (transmission === undefined)
			throw new EngineError(
				'E1217',
				`${call}() got ${key} without transmission; give transmission, even as 0, to create a material that lets light through.`,
			);
		if (options.diffuseTransmission !== undefined)
			throw new EngineError(
				'E1217',
				`${call}() got ${key} with diffuseTransmission; a material that lets light through to its other side keeps its diffuse transmission maps in the same slots. Give the material one kind of map or the other.`,
			);
		const specular =
			options.specularIntensityMap !== undefined
				? 'specularIntensityMap'
				: options.specularColorMap !== undefined
					? 'specularColorMap'
					: undefined;
		if (specular)
			throw new EngineError(
				'E1217',
				`${call}() got ${specular} with ${key}; the transmission and thickness maps take the specular maps' slots. Give the material the specular maps or those two, not both.`,
			);
	}
	for (const [key] of MAP_OPTIONS)
		if (options[key] && skipsMap(key, features))
			throw new EngineError(
				'E1217',
				SPECULAR_MAPS.has(key)
					? `${call}() got ${key} with diffuseTransmission; a material that lets light through to its other side keeps its diffuse transmission maps in the specular maps' place, so it takes no specular maps.`
					: `${call}() got ${key} without diffuseTransmission; give diffuseTransmission, even as 0, to create a material that takes it.`,
			);
	if (options.diffuseTransmission !== undefined && hasLayers(options))
		throw new EngineError(
			'E1217',
			`${call}() got diffuseTransmission with a clear coat or a sheen; a layered material lets no light through to its other side, since the layers' maps take the places of its maps. Use a material without layers.`,
		);
	if (options.diffuseTransmission !== undefined && blending === 'weighted')
		throw new EngineError(
			'E1217',
			`${call}() got diffuseTransmission with the 'weighted' blending; a material of the weighted blending lets no light through to its other side. Give it the 'normal' blending.`,
		);
	if (hasLayers(options)) checkLayerMaps(options, call);
	if (options.anisotropy !== undefined && !MAP_OPTIONS.some(([key]) => options[key] !== undefined))
		throw new EngineError(
			'E1217',
			`${call}() got anisotropy with no map. The direction that the reflection stretches along comes from the surface's texture coordinates, so give the material a map.`,
		);
	if (options.parallax && !options.displacementMap)
		throw new EngineError(
			'E1217',
			`${call}() got parallax without a displacementMap; parallax reads the displacement map's heights.`,
		);
	if (
		options.parallax &&
		(alphaMode === 'blend' ||
			transmission !== undefined ||
			options.diffuseTransmission !== undefined)
	)
		throw new EngineError(
			'E1217',
			`${call}() got parallax with ${transmission !== undefined ? 'transmission' : options.diffuseTransmission !== undefined ? 'diffuseTransmission' : "the alpha mode 'blend'"}; parallax takes an opaque or masked surface. Leave parallax out to keep the displacement alone.`,
		);
	if (transmission !== undefined && alphaMode === 'hash')
		throw new EngineError(
			'E1217',
			`${call}() got transmission with the alpha mode 'hash'; a material that lets light through takes 'opaque', 'mask' or 'blend'.`,
		);
	if (transmission !== undefined && blending === 'weighted')
		throw new EngineError(
			'E1217',
			`${call}() got transmission with the 'weighted' blending; a material that lets light through draws back to front. Give it the 'normal' blending.`,
		);
	if (alphaMode !== undefined && !Object.hasOwn(ALPHA_MODES, alphaMode))
		throw new EngineError(
			'E1217',
			`${call}() got the alpha mode ${JSON.stringify(alphaMode)}; it takes 'opaque', 'mask', 'hash' or 'blend'.`,
		);
	if (blending !== undefined && !Object.hasOwn(BLENDINGS, blending))
		throw new EngineError(
			'E1217',
			`${call}() got the blending ${JSON.stringify(blending)}; it takes 'normal', 'additive', 'multiply' or 'weighted'.`,
		);
	for (const key of ['constant', 'slopeScale'] as const) {
		const value = depthBias?.[key] ?? 0;
		if (!Number.isFinite(value))
			throw new EngineError('E1203', `${call}() got ${value} for depthBias.${key}.`);
	}
}

/**
 * Throws E1217 for a layered material with a map whose slot its layers take, for a transmission
 * or a thickness map beside the layer map of its own slot, and for a pair of layer maps that glTF
 * packs into one texture but that are two. Call it inside `if (DEV)`.
 */
function checkLayerMaps(options: StandardOptions, call: string): void {
	const sharedSlot =
		options.lightMap !== undefined
			? 'lightMap'
			: options.specularIntensityMap !== undefined
				? 'specularIntensityMap'
				: options.specularColorMap !== undefined
					? 'specularColorMap'
					: undefined;
	if (sharedSlot)
		throw new EngineError(
			'E1217',
			`${call}() got ${sharedSlot} with a clear coat, a sheen, iridescence or anisotropy, whose maps take its place. Bake its light or specular values into the other maps, or use a material without layers.`,
		);
	// The transmission and thickness maps take the specular maps' slots, which a layer map fills
	// only when the material gives one of that slot: the light map's slot stays free for its layer
	// map beside them.
	for (const key of TRANSMISSION_MAPS) {
		if (options[key] === undefined) continue;
		const owner = volumeSlotOwner(options, key);
		if (owner)
			throw new EngineError(
				'E1217',
				`${call}() got ${key} with ${owner}, which fills the same slot. Give the material one map of that slot or the other.`,
			);
	}
	for (const [first, second, packed] of [
		['clearcoatMap', 'clearcoatRoughnessMap', 'the roughness in the green of the clear coat map'],
		['sheenColorMap', 'sheenRoughnessMap', 'the roughness in the alpha of the sheen color map'],
	] as const) {
		const a = options[first];
		const b = options[second];
		if (a && b && a !== b)
			throw new EngineError(
				'E1217',
				`${call}() got a ${first} and a ${second} that are two textures. Give one texture for both, with ${packed}, as glTF packs them.`,
			);
	}
	// A material's maps come from one family of layers, since the maps of each take the same slots.
	// The layers' values may mix freely: the row says which family's maps the slots hold.
	if (takesAnyMap(options, COAT_SHEEN_MAPS)) {
		const clash =
			(options.iridescenceMap !== undefined && 'iridescenceMap') ||
			(options.iridescenceThicknessMap !== undefined && 'iridescenceThicknessMap') ||
			(options.anisotropyMap !== undefined && 'anisotropyMap') ||
			'';
		if (clash)
			throw new EngineError(
				'E1217',
				`${call}() got ${clash} with the maps of a clear coat or a sheen, which take the same slots. Give a material either the coat's and the sheen's maps, or iridescence's and the anisotropy's, and keep the other layers' values alone.`,
			);
	}
}

/** True when a standard material's bump map draws: no normal map or wireframe takes its place. */
const bumps = (options: StandardOptions): boolean =>
	!!options.bumpMap && !options.normalMap && !options.wireframe;

/** The core's feature bits of `options`. */
function featureBits(options: StandardOptions): number {
	return (
		(options.doubleSided ? MATERIAL_FEATURE_DOUBLE_SIDED : 0) |
		(options.vertexColors ? MATERIAL_FEATURE_VERTEX_COLORS : 0) |
		(options.flatShading ? MATERIAL_FEATURE_FLAT_SHADING : 0) |
		ALPHA_MODES[options.alphaMode ?? 'opaque'] |
		BLENDINGS[options.blending ?? 'normal'] |
		(options.depthWrite === false ? MATERIAL_FEATURE_NO_DEPTH_WRITE : 0) |
		(options.depthTest === false ? MATERIAL_FEATURE_NO_DEPTH_TEST : 0) |
		(options.fog === false ? MATERIAL_FEATURE_NO_FOG : 0) |
		(options.toneMapped === false ? MATERIAL_FEATURE_NO_TONE_MAP : 0) |
		(options.contactShadows === false ? MATERIAL_FEATURE_NO_CONTACT_SHADOWS : 0) |
		(options.alphaMode === 'mask' && options.alphaToCoverage !== false
			? MATERIAL_FEATURE_ALPHA_TO_COVERAGE
			: 0) |
		(options.forceSinglePass ? MATERIAL_FEATURE_SINGLE_PASS : 0) |
		(options.transmission !== undefined ? MATERIAL_FEATURE_TRANSMISSION : 0) |
		(options.diffuseTransmission !== undefined ? MATERIAL_FEATURE_TRANSLUCENCY : 0) |
		(options.subsurfaceRadius !== undefined ? MATERIAL_FEATURE_SUBSURFACE : 0) |
		(hasLayers(options) ? MATERIAL_FEATURE_COAT_SHEEN : 0) |
		(takesIridescence(options) ? MATERIAL_FEATURE_IRIDESCENCE : 0) |
		(takesAnisotropy(options) ? MATERIAL_FEATURE_ANISOTROPY : 0) |
		(options.wireframe ? MATERIAL_FEATURE_WIREFRAME : 0) |
		(options.parallax ? MATERIAL_FEATURE_PARALLAX : 0) |
		(options.lightMapDecode === 'rgbm' ? MATERIAL_FEATURE_LIGHT_MAP_RGBM : 0)
	);
}

/** The scene inputs that a material or a feature may declare. */
const SCENE_INPUTS: readonly SceneInput[] = [
	'sceneColor',
	'sceneDepth',
	'normals',
	'motionVectors',
];

/**
 * The most textures a material that reads the scene's depth takes. Its maps' group leaves out the
 * last slot, so the frame group's eight sampled textures, the maps' and the copy stay within the
 * sixteen that WebGPU's fragment stage allows.
 */
const MAX_SCENE_DEPTH_TEXTURES = SIZE_MAP_SLOTS - 1;

/**
 * Checks the scene inputs that a custom material declares against the ones its WGSL reads. Today
 * the engine binds the copy of the opaque scene's depth alone; a feature declares the other scene
 * resources in its reads, which the render graph orders.
 */
function checkSceneInputs(
	declared: readonly SceneInput[],
	sceneDepth: boolean,
	textures: number,
	call: string,
): void {
	const seen = new Set<string>();
	for (const input of declared as readonly string[]) {
		if (!SCENE_INPUTS.includes(input as SceneInput))
			throw new EngineError(
				'E1217',
				`${call}() got the scene input ${JSON.stringify(input)}; it takes 'sceneColor', 'sceneDepth', 'normals' or 'motionVectors'.`,
			);
		if (seen.has(input))
			throw new EngineError(
				'E1217',
				`${call}() got the scene input '${input}' twice in sceneInputs; give each one once.`,
			);
		seen.add(input);
		if (input !== 'sceneDepth')
			throw new EngineError(
				'E1217',
				`${call}() got the scene input '${input}', which custom materials do not read yet. Read the scene's depth with 'sceneDepth', or declare '${input}' in a feature's reads.`,
			);
	}
	const wantsDepth = seen.has('sceneDepth');
	if (wantsDepth && !sceneDepth)
		throw new EngineError(
			'E1217',
			`${call}() got the scene input 'sceneDepth', but its WGSL never calls sceneDepth or sceneDistance. Read it in fn surface, such as let behind = sceneDistance(uv).`,
		);
	if (sceneDepth && !wantsDepth)
		throw new EngineError(
			'E1217',
			`${call}() got WGSL that reads the scene's depth, but sceneInputs does not declare it. Add sceneInputs: ['sceneDepth'].`,
		);
	if (sceneDepth && textures > MAX_SCENE_DEPTH_TEXTURES)
		throw new EngineError(
			'E1217',
			`${call}() got WGSL that reads the scene's depth and declares ${textures} textures. A material that reads the depth takes at most ${MAX_SCENE_DEPTH_TEXTURES}: its maps' group gives up one slot so that the copy of the depth fits the fragment stage beside them. Drop ${textures - MAX_SCENE_DEPTH_TEXTURES} of the textures, or read the depth another way.`,
		);
}

/** The numbers each type of uniform takes. */
const UNIFORM_FLOATS: Readonly<Record<CompiledUniform['type'], number>> = {
	f32: 1,
	i32: 1,
	u32: 1,
	vec2f: 2,
	vec3f: 3,
	vec4f: 4,
};

/** The values that `set` changes on every standard material, which no uniform may be named. */
const STANDARD_VALUES: ReadonlySet<string> = new Set([
	'color',
	'emissive',
	'specularColor',
	'ior',
	'attenuationColor',
	'attenuationDistance',
	'diffuseTransmissionColor',
	'subsurfaceColor',
	'sheenColor',
	'clearcoatNormalScale',
	'bumpScale',
	'displacementScale',
	'displacementBias',
	...RANGED.map(([key]) => key),
]);

/**
 * True for a plain number that a uniform of `type` takes on its own: any finite number for a float
 * type, a whole one for an integer type. A type that holds several numbers takes an array, or a
 * `vec3f` a color, so a single number is not enough for it.
 */
function numberFits(type: CompiledUniform['type'], value: number): boolean {
	return UNIFORM_FLOATS[type] === 1 && (type === 'f32' || Number.isInteger(value));
}

/**
 * Throws E1216 for a value of another kind than `uniform` takes: a number, a whole number for an
 * integer, or an array of as many numbers as the type holds. A `vec3f` takes an sRGB color too,
 * which converts to linear. It allocates nothing.
 */
function checkUniform(uniform: CompiledUniform, value: UniformValue, call: string): void {
	const { type } = uniform;
	if (type === 'vec3f' && !Array.isArray(value)) {
		writeLinearColor(UNIFORM_COLOR, value as ColorInput, call);
		return;
	}
	const count = UNIFORM_FLOATS[type];
	if (typeof value === 'number') {
		if (Number.isFinite(value) && numberFits(type, value)) return;
	} else if (Array.isArray(value)) {
		let fits = value.length === count;
		for (let k = 0; fits && k < count; k++) {
			const number = value[k];
			fits = typeof number === 'number' && Number.isFinite(number);
		}
		if (fits && (type === 'f32' || type.startsWith('vec') || Number.isInteger(value[0]))) return;
	}
	const takes =
		count === 1
			? type === 'f32'
				? 'a number'
				: 'a whole number'
			: `an array of ${count} numbers${count === 3 ? ', or a color' : ''}`;
	throw new EngineError(
		'E1216',
		`${call}() got ${JSON.stringify(value)} for the ${type} uniform ${uniform.name}; it takes ${takes}.`,
	);
}

/** True for a standard value that `set` writes itself, which the uniform writes skip. */
function isStandard(name: string, call: string): boolean {
	return STANDARD_VALUES.has(name) && call.endsWith('.set');
}

/**
 * Checks each uniform of `values`, so a caller can check every value before it writes any. `set`
 * calls skip the standard values, which `set` writes itself. Throws E1216 for a name that is not
 * a uniform, and for a value of another kind.
 */
function checkUniforms(
	uniforms: ReadonlyMap<string, CompiledUniform>,
	values: Readonly<Record<string, UniformValue | undefined>>,
	call: string,
): void {
	for (const name in values) {
		if (isStandard(name, call)) continue;
		const value = values[name];
		if (value === undefined) continue;
		const uniform = uniforms.get(name);
		if (!uniform) {
			const names = [...uniforms.keys()].join(', ') || 'none';
			throw new EngineError(
				'E1216',
				`${call}() got ${name}, which is not a uniform of the material's WGSL. Its uniforms: ${names}.`,
			);
		}
		checkUniform(uniform, value, call);
	}
}

/**
 * Writes the uniforms of `values`, which `checkUniforms` checked, into material `id`'s row of
 * custom values, through the core's call values. It allocates nothing: a color converts into the
 * call values too.
 */
/**
 * Writes one uniform into material `id`'s row of custom values, through the core's call values,
 * which `checkUniform` checked. It allocates nothing: a color converts into the call values too.
 */
function writeUniform(
	core: CoreMemory,
	id: number,
	uniform: CompiledUniform,
	value: UniformValue,
	call: string,
): void {
	const numbers = core.callValues();
	const count = UNIFORM_FLOATS[uniform.type];
	if (typeof value === 'number') numbers[0] = value;
	else if (Array.isArray(value)) for (let k = 0; k < count; k++) numbers[k] = value[k] as number;
	else writeLinearColor(numbers, value as ColorInput, call);
	core.check(core.glue.setMaterialValues(id, uniform.offset, count), call, undefined, true);
}

function writeUniforms(
	core: CoreMemory,
	id: number,
	uniforms: ReadonlyMap<string, CompiledUniform>,
	values: Readonly<Record<string, UniformValue | undefined>>,
	call: string,
): void {
	const numbers = core.callValues();
	for (const name in values) {
		if (isStandard(name, call)) continue;
		const value = values[name];
		if (value === undefined) continue;
		const uniform = uniforms.get(name) as CompiledUniform;
		const count = UNIFORM_FLOATS[uniform.type];
		if (typeof value === 'number') numbers[0] = value;
		else if (Array.isArray(value)) for (let k = 0; k < count; k++) numbers[k] = value[k] as number;
		else writeLinearColor(numbers, value as ColorInput, call);
		core.check(core.glue.setMaterialValues(id, uniform.offset, count), call, undefined, true);
	}
}

/**
 * The texture of each slot that a custom material's or effect's WGSL declares, from its `textures`
 * option, with none where the option gives none. A slot that the WGSL declares as
 * `texture_2d_array<f32>` takes a texture of one or more layers, whose layers the WGSL picks; a
 * slot that it declares as `texture_2d<f32>` takes a texture of one layer. Throws E1216 for a name
 * that the WGSL does not declare, and for a value that is not a texture of the layers that the
 * slot takes.
 */
export function textureSlots(
	declared: readonly { readonly name: string; readonly array?: boolean }[],
	given: Readonly<Record<string, unknown>>,
	call: string,
): (Texture | undefined)[] {
	const slots: (Texture | undefined)[] = declared.map(() => undefined);
	for (const name in given) {
		const value = given[name];
		if (value === undefined) continue;
		const slot = declared.findIndex((texture) => texture.name === name);
		if (slot < 0) {
			const names = declared.map((texture) => texture.name).join(', ') || 'none';
			throw new EngineError(
				'E1216',
				`${call}() got the texture ${name}, which the WGSL does not declare. Its textures: ${names}.`,
			);
		}
		const array = declared[slot]?.array === true;
		if (!(value instanceof Texture))
			throw new EngineError(
				'E1216',
				array
					? `${call}() got ${String(value)} for the texture array ${name}; it takes a texture of several layers, from textures or assets.`
					: `${call}() got ${String(value)} for the texture ${name}; it takes a texture of one layer, from textures or assets.`,
			);
		if (!array && value.depth !== 1)
			throw new EngineError(
				'E1216',
				`${call}() got a texture of ${value.depth} layers for the texture ${name}; a texture declared \`var ${name}: texture_2d<f32>;\` takes one layer. Declare \`var ${name}: texture_2d_array<f32>;\`, and pick the layer in the shader.`,
			);
		slots[slot] = value;
	}
	return slots;
}

/**
 * A material: how the surfaces of the objects that use it look. `Values` are the options that
 * `set` changes.
 *
 * @category api/materials
 */
export class Material<Values extends MaterialOptions = MaterialOptions> {
	/** The engine core's id, or 0 once the material is destroyed. */
	private liveId: number;
	/** The name that errors from `setUniform` give the call, made once. */
	protected readonly oneCall: string;

	/**
	 * @internal How far the material's displacement moves vertices at most, in the mesh's units,
	 * which grows the bounds of objects with it: the farthest it has moved them, or 0.
	 */
	boundsMargin = 0;

	/** True when the normal map's slot holds a bump map, whose strength `bumpScale` sets. */
	private bump = false;

	/** The displacement map's scale and bias, which `set` changes one at a time, where it has one. */
	private displacement: [number, number] | undefined;

	/**
	 * Where the maps sit on the texture coordinates, as `set` last gave them: the offset's two
	 * numbers, the scale's two and the rotation, so an animation can change one pair and keep the
	 * rest.
	 */
	private uv: [number, number, number, number, number] | undefined;

	/** @internal */
	constructor(
		id: number,
		/** @internal */ readonly core: CoreMemory,
		/** The name that errors from `set` give the call, such as 'materials.standard.set'. */
		protected readonly call: string,
		/** @internal The engine core's shading code, which decides what the material draws. */
		readonly shading: number = SHADING_LIT,
	) {
		this.liveId = id;
		this.oneCall = setUniformCall(call);
	}

	/** @internal True until `destroy` runs. */
	get live(): boolean {
		return this.liveId !== 0;
	}

	/** @internal The engine core's id. Throws E1101 once the material is destroyed. */
	get id(): number {
		if (this.liveId === 0)
			throw new EngineError(
				'E1101',
				`a call used a material of ${this.call.replace(/\.set$/, '')}() after its destroy().`,
			);
		return this.liveId;
	}

	/**
	 * Changes the values that it gets and keeps the others. Every object that uses the material
	 * changes with it. Set up a material with it, and with `setUniform` change the values that a
	 * frame changes: a value that changes in every frame crosses the `setUniform` call itself,
	 * where this call reads it from a field of the options object, and a field that holds a
	 * fraction holds a copy of it of its own. Throws E1101 once the material is destroyed.
	 */
	set(options: Values): void {
		const { core, call } = this;
		const values = options as AnyValues;
		const id = this.id;
		if (DEV) checkValues(values, call);
		const color = linearOrNone(values.color, call, COLOR);
		const emissive = linearOrNone(values.emissive, call, EMISSIVE);
		const specular = specularOrNone(values.specularColor, call);
		const attenuation = linearOrNone(values.attenuationColor, call, ATTENUATION);
		const through = linearOrNone(values.diffuseTransmissionColor, call, THROUGH);
		const scatter = linearOrNone(values.subsurfaceColor, call, SCATTER);
		const sheen = linearOrNone(values.sheenColor, call, SHEEN);
		// A bump map's strength takes the normal scale's place.
		const kept = this.bump && values.normalScale ? { ...values, normalScale: undefined } : values;
		if (values.uvTransform !== undefined) this.recordUv(values.uvTransform);
		writeValues(
			core,
			id,
			call,
			kept,
			color,
			emissive,
			specular,
			attenuation,
			through,
			scatter,
			sheen,
		);
		this.writeHeights(values);
	}

	/**
	 * @internal Sets up the height maps of a standard material that `options` creates: a bump map
	 * in the normal map's slot, unless a normal map or a wireframe takes it, and a displacement map.
	 * Then writes their values.
	 */
	heights(options: StandardOptions): void {
		const { core, call } = this;
		const id = this.id;
		const maps: [Texture | undefined, number][] = [];
		this.bump = bumps(options);
		if (this.bump) maps.push([options.bumpMap, MAP_SLOT_BUMP]);
		if (options.displacementMap) {
			this.displacement = [1, 0];
			this.boundsMargin = 1;
			maps.push([options.displacementMap, MAP_SLOT_DISPLACEMENT]);
		}
		for (const [map, slot] of maps) {
			if (!map) continue;
			const second = map.uvSet === 1 ? 1 : 0;
			core.checkGrowth(
				core.glue.setMaterialMap(id, slot, map.handle, second),
				call,
				undefined,
				true,
			);
		}
		this.writeHeights(options);
	}

	/** Writes the bump map's strength and the displacement's scale and bias that `values` give. */
	private writeHeights(values: AnyValues): void {
		const { core, call } = this;
		const { bumpScale, displacementScale, displacementBias } = values;
		if (this.bump && bumpScale !== undefined) {
			const numbers = core.callValues();
			numbers[0] = bumpScale;
			numbers[1] = bumpScale;
			sendValue(core, this.id, MATERIAL_PARAM_NORMAL_SCALE, call);
		}
		const held = this.displacement;
		if (held && (displacementScale !== undefined || displacementBias !== undefined)) {
			const scale = displacementScale ?? held[0];
			const bias = displacementBias ?? held[1];
			held[0] = scale;
			held[1] = bias;
			const status = core.glue.setMaterialDisplacement(this.id, scale, bias);
			core.check(status, call, undefined, true);
			this.boundsMargin = Math.max(this.boundsMargin, Math.abs(bias), Math.abs(scale + bias));
		}
	}

	/**
	 * Changes one value by name, and keeps the others: a number, such as `roughness`, `opacity` or
	 * `emissiveIntensity`, or a color, such as `color`, `emissive` or `sheenColor`. It allocates
	 * nothing, so a sketch can change a value in every frame. Every object that uses the material
	 * changes with it. Throws E1101 once the material is destroyed, and E1216 for a name that it
	 * does not take: a value that takes more than one parameter, as the texture transform, the
	 * normal scales, the angle fade and the index of refraction do, goes through `set`.
	 */
	setUniform<Name extends keyof Values & string>(
		name: Name,
		value: NonNullable<Values[Name]>,
	): void {
		writeOneValue(this.core, this.id, this.oneCall, name, value as unknown as number | ColorInput);
	}

	/**
	 * @internal Writes one value by name, for a property animation: a number, or a linear color as
	 * three numbers. A number stays within the range that the value takes, because a cubic key can
	 * overshoot. It allocates nothing, so a track writes a value in every frame.
	 */
	writeUniform(name: string, value: number | readonly [number, number, number]): void {
		if (typeof value === 'number') {
			const most = ONE_VALUE_MAX.get(name) ?? Number.POSITIVE_INFINITY;
			writeOneValue(this.core, this.id, this.oneCall, name, Math.max(0, Math.min(value, most)));
			return;
		}
		writeOneValue(this.core, this.id, this.oneCall, name, value);
	}

	/**
	 * @internal Changes the maps' offset or their scale, for a property animation, and keeps the
	 * rest of the transform. The maps share one transform, so every map of the material moves. It
	 * allocates nothing, so a track writes a pair in every frame.
	 */
	writeUvPair(name: 'uvOffset' | 'uvScale', u: number, v: number): void {
		const uv = this.uvValues();
		if (name === 'uvOffset') {
			uv[0] = u;
			uv[1] = v;
		} else {
			uv[2] = u;
			uv[3] = v;
		}
		writeUvMatrix(this.core, this.id, uv[0], uv[1], uv[2], uv[3], uv[4], this.call);
	}

	/** @internal Keeps where `values` puts the maps on the texture coordinates, for a part write. */
	recordUv(values: UvTransform): void {
		const uv = this.uvValues();
		const { offset, repeat, rotation = 0 } = values;
		uv[0] = offset ? offset[0] : 0;
		uv[1] = offset ? offset[1] : 0;
		uv[2] = repeat ? repeat[0] : 1;
		uv[3] = repeat ? repeat[1] : 1;
		uv[4] = rotation;
	}

	/** The maps' transform, which a value makes where the material has none. */
	private uvValues(): [number, number, number, number, number] {
		this.uv ??= [0, 0, 1, 1, 0];
		return this.uv;
	}

	/**
	 * Destroys the material, like three.js's `material.dispose()`. Objects and instance batches that
	 * still use it draw nothing until `setMaterial` gives them another material. Once no object uses
	 * it, its place in the engine's table of materials goes to the next material. When the last
	 * material of a custom material's WGSL goes, the engine frees that WGSL's pipelines. The
	 * material's textures stay, so destroy them apart. Later calls on the material, and calls that
	 * pass it, throw E1101.
	 */
	destroy(): void {
		const { core } = this;
		const call = `${this.call.replace(/\.set$/, '')}.destroy`;
		core.check(core.glue.destroyMaterial(this.id), call, undefined, true);
		this.liveId = 0;
	}
}

/** A custom material, whose `set` changes its uniforms too. */
class ShaderMaterial extends Material<ShaderValues> {
	constructor(
		id: number,
		core: CoreMemory,
		call: string,
		/** The uniforms that the material's WGSL declares, by name. */
		private readonly uniforms: ReadonlyMap<string, CompiledUniform>,
		shading: number,
	) {
		super(id, core, call, shading);
	}

	/**
	 * Changes the standard values and the uniforms that it gets, and keeps the others. It checks
	 * every value before it changes any. It allocates nothing, so a sketch can change a uniform in
	 * every frame.
	 */
	override set(options: ShaderValues): void {
		const { uniforms, call } = this;
		checkUniforms(uniforms, options, call);
		super.set(options);
		writeUniforms(this.core, this.id, uniforms, options, call);
	}

	/**
	 * Changes one of the material's uniforms, or one of the standard values, by name. It allocates
	 * nothing, so a sketch can change a uniform in every frame. Throws E1216 for a name that is no
	 * uniform of the WGSL and no standard value, and for a value of another kind than the uniform
	 * takes.
	 */
	override setUniform<Name extends keyof ShaderValues & string>(
		name: Name,
		value: NonNullable<ShaderValues[Name]>,
	): void {
		const uniform = this.uniforms.get(name);
		if (uniform) {
			// A number that the uniform takes goes straight through: its check is a length test and a
			// whole-number test, and a number passed to a call that the browser does not inline becomes
			// an object of its own. Every other value goes through the check, the rejected ones too.
			if (typeof value !== 'number' || !Number.isFinite(value) || !numberFits(uniform.type, value))
				checkUniform(uniform, value as unknown as UniformValue, this.oneCall);
			writeUniform(this.core, this.id, uniform, value as unknown as UniformValue, this.oneCall);
			return;
		}
		super.setUniform(name, value);
	}
}

/**
 * Material factories. The standard material follows glTF's metallic-roughness model and shades
 * with the formulas of three.js's `MeshStandardMaterial`. The unlit material shows its color as
 * three.js's `MeshBasicMaterial` does. The shadow-catcher material shows only the main directional
 * light's shadows, as three.js's `ShadowMaterial`.
 *
 * @category api/materials
 */
export class Materials {
	/** @internal */
	constructor(
		private readonly core: CoreMemory,
		/** The templates of compiled WGSL, which send each custom material's shader once. */
		private readonly templates = new ShaderTemplates(),
		/** @internal Asks the thread that draws for the shader files of features early. */
		readonly shaders: ShaderPreloads = new ShaderPreloads(),
	) {}

	/** @internal The templates of compiled WGSL, which each shader a page writes goes to once. */
	get shaderTemplates(): ShaderTemplates {
		return this.templates;
	}

	/**
	 * @internal Creates a material that shades as the engine core's shading code says, with the
	 * features and values of `options`.
	 */
	create<Values extends MaterialOptions>(
		shading: number,
		options: StandardOptions & UnlitOptions,
		call: string,
		features = 0,
	): Material<Values> {
		const material = new Material<Values>(
			this.createId(shading, options, call, hasLayers(options), features),
			this.core,
			`${call}.set`,
			shading,
		);
		if (options.uvTransform !== undefined) material.recordUv(options.uvTransform);
		if (options.bumpMap || options.displacementMap) material.heights(options);
		return material;
	}

	/**
	 * Creates a material in the engine core, with its standard options and the feature bits
	 * `extra` and its layers, and returns its id.
	 */
	private createId(
		shading: number,
		options: StandardOptions,
		call: string,
		layered = hasLayers(options),
		extra = 0,
	): number {
		const [r, g, b] = linearColor(options.color ?? '#ffffff', call);
		const emissive = linearOrNone(options.emissive, call, EMISSIVE);
		const specular = specularOrNone(options.specularColor, call);
		const attenuation = linearOrNone(options.attenuationColor, call, ATTENUATION);
		const through = linearOrNone(options.diffuseTransmissionColor, call, THROUGH);
		const scatter = linearOrNone(options.subsurfaceColor, call, SCATTER);
		const sheen = linearOrNone(options.sheenColor, call, SHEEN);
		if (DEV) {
			checkValues(options, call);
			checkFeatures(options, call);
		}
		const opacity = options.opacity ?? 1;
		const features =
			(featureBits(options) & ~MATERIAL_FEATURE_COAT_SHEEN) |
			(layered ? MATERIAL_FEATURE_COAT_SHEEN : 0) |
			extra;
		// The shaders that let light through, decals' and those of a clear coat and a sheen,
		// load on first use: the download starts with the material, before any object draws
		// with it.
		if (features & MATERIAL_FEATURE_TRANSMISSION) this.shaders.need('transmission');
		else if (features & MATERIAL_FEATURE_TRANSLUCENCY) this.shaders.need('translucency');
		if (features & MATERIAL_FEATURE_COAT_SHEEN) this.shaders.need('coat_sheen');
		// So do the builds of the weighted layer.
		if (options.alphaMode === 'blend' && options.blending === 'weighted')
			this.shaders.need('weighted');
		if (features & MATERIAL_FEATURE_DECAL) this.shaders.need('decals');
		if (bumps(options)) this.shaders.need('bump');
		if (options.displacementMap) this.shaders.need('displacement');
		const { constant = 0, slopeScale = 0 } = options.depthBias ?? {};
		const { core } = this;
		const id = core.checkGrowth(
			core.glue.createMaterial(shading, features, r, g, b, opacity, constant, slopeScale),
			call,
		);
		const values = { ...options, color: undefined, opacity: undefined };
		const colors = [undefined, emissive, specular, attenuation, through, scatter, sheen] as const;
		writeValues(core, id, call, values, ...colors);
		for (const [key, slot] of MAP_OPTIONS) {
			const map = options[key];
			// A production build leaves out a map that would take another map's slot.
			if (
				!map ||
				skipsMap(key, features) ||
				skipsTransmissionMap(options, key) ||
				(layered && skipsLayerMap(options, key))
			)
				continue;
			const second = map.uvSet === 1 ? 1 : 0;
			core.checkGrowth(
				core.glue.setMaterialMap(id, slot, map.handle, second),
				call,
				undefined,
				true,
			);
		}
		// A direction map needs the light map whose binding reads it, and a production build leaves
		// out both where the layers take the light map's slot.
		if (options.lightMapDirection && options.lightMap && !layered) {
			core.checkGrowth(
				core.glue.setMaterialMap(
					id,
					MAP_SLOT_LIGHT_MAP_DIRECTION,
					options.lightMapDirection.handle,
					0,
				),
				call,
				undefined,
				true,
			);
		}
		const { lightMapOffset, lightMapRepeat } = options;
		if (lightMapOffset || lightMapRepeat) {
			const numbers = core.callValues();
			const [repeatU, repeatV] = lightMapRepeat ?? [1, 1];
			const [offsetU, offsetV] = lightMapOffset ?? [0, 0];
			numbers[0] = repeatU;
			numbers[1] = repeatV;
			sendValue(core, id, MATERIAL_PARAM_LIGHT_MAP_SCALE, call);
			numbers[0] = offsetU;
			numbers[1] = offsetV;
			sendValue(core, id, MATERIAL_PARAM_LIGHT_MAP_OFFSET, call);
		}
		return id;
	}

	/**
	 * A lit material with glTF's metallic-roughness model, like three.js's
	 * `MeshStandardMaterial`.
	 */
	standard(options: StandardOptions = {}): Material<StandardValues> {
		return this.create<StandardValues>(SHADING_LIT, options, 'materials.standard');
	}

	/**
	 * A decal's material: the standard material, projected onto every opaque surface inside the
	 * box of each object that it draws, as three.js's `DecalGeometry` places a decal. Give it to a
	 * mesh of `geometry.box()`: the object's position, rotation and scale place the box, and the
	 * material's maps stretch over the box's x and y sides, seen along its z axis. The surfaces
	 * inside take its color, roughness, metalness, normal map and emissive light, lit by the
	 * scene's lights, and blend with them as far as its alpha says. A decal draws after the opaque
	 * objects, and marks no blended surface. It casts no shadow.
	 */
	decal(options: DecalOptions = {}): Material<DecalValues> {
		return this.create<DecalValues>(
			SHADING_LIT,
			options,
			'materials.decal',
			MATERIAL_FEATURE_DECAL,
		);
	}

	/**
	 * A material that ignores lights and shows its color unlit, like three.js's
	 * `MeshBasicMaterial`. The exposure and the tone mapping still apply to it, as three.js applies
	 * them to that material.
	 */
	unlit(options: UnlitOptions = {}): Material<UnlitValues> {
		const shading = options.map ? SHADING_UNLIT_MAP : SHADING_UNLIT;
		return this.create<UnlitValues>(shading, options, 'materials.unlit');
	}

	/**
	 * A material that draws only the shadows that fall on it, as three.js's `ShadowMaterial`: its
	 * `color` where the main directional light's shadow falls, and nothing where the light reaches
	 * it, at `opacity`. The mesh must receive shadows (`setReceiveShadows(true)`), as three.js's
	 * `receiveShadow` must be set. Every shadow that falls on the surface comes from the main
	 * directional light; point and spot lights cast none onto it. The default color is black, as
	 * three.js's. The material blends, so it draws in the transparent pass after the opaque
	 * objects, and the scene's fog leaves it alone. It takes no texture maps.
	 */
	shadowCatcher(options: ShadowCatcherOptions = {}): Material<ShadowCatcherValues> {
		return this.create<ShadowCatcherValues>(
			SHADING_LIT,
			{ ...options, color: options.color ?? '#000000', alphaMode: 'blend' },
			'materials.shadowCatcher',
			MATERIAL_FEATURE_SHADOW_CATCHER,
		);
	}

	/**
	 * A custom material: the standard material with a surface function in WGSL, which changes how
	 * each pixel of the surface looks before the engine lights it, or a full shader of your own. It
	 * takes every option of `materials.standard` but the texture maps, the first values of the
	 * uniforms that its WGSL declares, and the textures that its WGSL samples, a texture of
	 * several layers among them for a declaration of a texture array. `set` changes the
	 * standard values and the uniforms. Meshes need texture coordinates to draw with a surface
	 * function, and the attributes that a full shader reads. Throws E1215 for WGSL that the null3D
	 * Vite plugin did not compile, and for a whole shader whose `@vertex` entry point takes no
	 * `InstanceIn`. Throws E1216 for a uniform or a texture that the WGSL does not declare, for a
	 * value of the wrong kind, and for a uniform named as a standard value, such as `color`. Throws
	 * E1217 for the `hash` alpha mode and for `alphaToCoverage`, which custom materials do not take,
	 * for `transmission` where the WGSL never sets the surface's `transmission`, and for
	 * `diffuseTransmission` where it never names the surface's `diffuseTransmission` or
	 * `diffuseTransmissionColor`: only WGSL that does has the builds that let light through.
	 * When
	 * TypeScript can see the WGSL, a wrong name or a value of the wrong kind also fails the type
	 * check.
	 */
	shader<const Wgsl extends string | CompiledWgsl>(
		options: ShaderOptions<Wgsl>,
	): Material<ShaderValues<Wgsl>> {
		const call = 'materials.shader';
		if (DEV && (options.alphaMode === 'hash' || options.alphaToCoverage === true))
			throw new EngineError(
				'E1217',
				`${call}() got ${options.alphaMode === 'hash' ? "the alpha mode 'hash'" : 'alphaToCoverage'}; a custom material takes 'opaque', 'mask' or 'blend', and tests its alpha against alphaCutoff.`,
			);
		if (DEV && options.blending === 'weighted')
			throw new EngineError(
				'E1217',
				`${call}() got the 'weighted' blending, which custom materials do not take. Give it the 'normal' blending, which draws back to front.`,
			);
		const compiled = this.compiledMaterial(options.wgsl, call);
		const sceneDepth = compiled.sceneDepth === true;
		if (DEV)
			checkSceneInputs(options.sceneInputs ?? [], sceneDepth, compiled.textures.length, call);
		if (DEV && options.transmission !== undefined && !lets(compiled))
			throw new EngineError(
				'E1217',
				`${call}() got transmission, but its WGSL never sets the surface's transmission, so it has no builds that let light through. Set it in fn surface, such as s.transmission = 1.0.`,
			);
		if (DEV && options.subsurfaceRadius !== undefined)
			throw new EngineError(
				'E1217',
				`${call}() got subsurfaceRadius; custom materials draw no subsurface blur. Give it to materials.standard.`,
			);
		const translucent = builds(compiled, PERMUTATION_TRANSLUCENCY);
		if (DEV && options.diffuseTransmission !== undefined && !translucent)
			throw new EngineError(
				'E1217',
				`${call}() got diffuseTransmission, but its WGSL never names the surface's diffuseTransmission, so it has no builds that let light through to its other side. Set it in fn surface, such as s.diffuseTransmission = 0.5.`,
			);
		const layered = builds(compiled, PERMUTATION_COAT_SHEEN);
		if (DEV && !layered && hasLayers(options))
			throw new EngineError(
				'E1217',
				`${call}() got a clear coat, a sheen or iridescence, but its WGSL never names the surface's layers, so it has no builds that light them. Set them in fn surface, such as s.clearcoat = 1.0 or s.sheenColor = vec3f(1.0).`,
			);
		const uniforms = new Map(compiled.uniforms.map((u) => [u.name, u]));
		for (const name of uniforms.keys())
			if (STANDARD_VALUES.has(name))
				throw new EngineError(
					'E1216',
					`${call}() got WGSL whose uniform ${name} has the name of a standard value. Rename the field of struct Uniforms.`,
				);
		const uniformValues = options.uniforms ?? {};
		checkUniforms(uniforms, uniformValues, call);
		const declared = compiled.textures;
		const textures = textureSlots(declared, options.textures ?? {}, call);
		const shading =
			this.templateOf(compiled) |
			(compiled.attributes << SHADING_CUSTOM_ATTRIBUTE_SHIFT) |
			(compiled.baseColor ? SHADING_CUSTOM_BASE_COLOR : 0) |
			(declared.length << SHADING_CUSTOM_TEXTURE_SHIFT) |
			(lets(compiled) ? SHADING_CUSTOM_TRANSMISSION : 0) |
			(builds(compiled, PERMUTATION_ROW_VALUES) ? SHADING_CUSTOM_ROW_VALUES : 0) |
			(builds(compiled, PERMUTATION_CASTER) ? SHADING_CUSTOM_CASTER : 0) |
			(compiled.objectIds ? SHADING_CUSTOM_OBJECT_IDS : 0);
		// A production build draws such a material without the light through it, as it has no
		// builds for it.
		const diffuseTransmission = translucent ? options.diffuseTransmission : undefined;
		const id = this.createId(
			shading,
			{ ...options, alphaToCoverage: false, diffuseTransmission, subsurfaceRadius: undefined },
			call,
			layered,
			sceneDepth ? MATERIAL_FEATURE_SCENE_DEPTH : 0,
		);
		// The copy of the opaque depth draws with the particle depth shaders, so the file loads
		// with the material, before its first frame.
		if (sceneDepth) this.shaders.need('particles');
		const material = new ShaderMaterial(id, this.core, `${call}.set`, uniforms, shading);
		if (options.uvTransform !== undefined) material.recordUv(options.uvTransform);
		const { core } = this;
		writeUniforms(core, id, uniforms, uniformValues, call);
		textures.forEach((texture, slot) => {
			if (!texture) return;
			core.checkGrowth(
				core.glue.setMaterialMap(id, slot, texture.handle, 0),
				call,
				undefined,
				true,
			);
		});
		return material;
	}

	/**
	 * A custom material's compiled WGSL, or throws E1215 for WGSL that the plugin did not compile
	 * and for a whole shader.
	 */
	private compiledMaterial(wgsl: string | CompiledWgsl, call: string): CompiledMaterial {
		if (typeof wgsl !== 'object' || wgsl?.kind !== 'material') {
			throw new EngineError(
				'E1215',
				typeof wgsl === 'object' && wgsl?.kind === 'shader'
					? `${call}() got a whole shader whose @vertex entry point takes no InstanceIn. A full shader of a custom material finds each instance with InstanceIn and find_instance from null3d::mesh.`
					: `${call}() got WGSL as ${typeof wgsl === 'string' ? 'text' : String(wgsl)}, which the null3D Vite plugin did not compile.`,
			);
		}
		return wgsl as CompiledMaterial;
	}

	/**
	 * The template of a custom material's WGSL, which goes to the thread that draws once. On the
	 * dev server, WGSL under one hot update key shares one template, which takes the newest WGSL.
	 */
	private templateOf(compiled: CompiledMaterial): number {
		return this.templates.of(
			compiled,
			() => [customShader(compiled)],
			compiled.hot,
			compiled.builds,
		);
	}

	/**
	 * @internal Swaps the shader of every custom material made from WGSL under the keys of hot
	 * updates. The plugin sends an update only when the new WGSL keeps the material's uniforms,
	 * textures and vertex inputs, so the materials keep their values.
	 */
	updateShaders(updates: readonly WgslUpdate[]): void {
		if (!DEV) return;
		for (const { key, shader } of updates) {
			if (shader.kind !== 'material') continue;
			this.templates.update(key, [customShader(shader as CompiledMaterial)]);
		}
	}
}

/**
 * A material that shows a mesh's first texture coordinates as colors: u in red and v in green,
 * with no color encoding. Only meshes with texture coordinates draw with it. The engine's own
 * tests use it to check vertex formats.
 */
export function texCoordsMaterial(materials: Materials): Material {
	return materials.create(SHADING_TEXCOORDS, {}, 'texCoordsMaterial');
}
