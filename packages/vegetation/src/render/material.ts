// The plant materials: one shader, render/plant.wgsl, in five roles: wood, shoot rows, cards,
// merged foliage and extras. Each role binds its own textures to the shader's six slots and sets its role in
// a uniform. The meshes that the roles draw keep the plant core's quantised bytes on the GPU, and
// the shader turns them back into metres. A stand-in kit takes the standard material in its
// record's colours instead, which no wind moves.
import type { Material, MeshGeometry, SketchContext, Texture, Textures } from '@null3d/engine';
import type { WindField } from '@null3d/wind';
import type { PlantAsset, PrototypeArrays, QuantisedArrays, SpeciesKitData } from '../asset';
import type { SpeciesBox } from '../core/box';
import { dequantisePosition } from '../lod/quantise';
import plantShader from './plant.wgsl';
import viewFaceShader from './plant-viewface.wgsl';
import { foliageOptics, transmissionShare } from './records';
import { standInMaterials } from './stand-in';
import { type SpeciesKit, writeFieldSettings } from './textures';

/**
 * One plant material: a role of the one plant shader.
 *
 * @category api/vegetation
 */
export type PlantMaterial = Material;

/**
 * The materials of a species, one per role.
 *
 * @category api/vegetation
 */
export interface PlantMaterials {
	/** Stems, limbs, branches, roots and fins. */
	readonly wood: PlantMaterial;
	/** The nearest level's shoot rows. */
	readonly shoots: PlantMaterial;
	/** The card levels. */
	readonly cards: PlantMaterial;
	/** Merged fronds, blades and rosette leaves. */
	readonly foliage: PlantMaterial;
	/**
	 * The card levels' foliage, drawn with the plain plant shader: its mesh carries no blade keel,
	 * so those levels pay nothing for the nearest level's view-facing width.
	 */
	readonly foliageFar: PlantMaterial;
	/** Cones, fruit, flowers, catkins, thorns and spines. */
	readonly extras: PlantMaterial;
}

/**
 * How `plantMaterials` makes a species' materials.
 *
 * @category api/vegetation
 */
export interface PlantMaterialOptions {
	/** The wind field the materials read; without one the plants stand still. */
	readonly wind?: WindField;
	/** The distance from the camera past which the plants stop swaying, in metres; 0 for none. */
	readonly swayDistance?: number;
	/**
	 * Draw the plants black, keeping their outline, their leaves' cut-outs and their sway, as a
	 * review's matte needs for an exact silhouette.
	 */
	readonly matte?: boolean;
}

/** The roles, as the shader's mode uniform names them. */
const MODE = { wood: 0, shoots: 1, cards: 2, foliage: 3, extras: 4 } as const;

/** A leaf's dielectric reflectance at normal incidence over the engine's default of 0.04. */
const LEAF_SPECULAR = 0.035 / 0.04;

/** The cutoff of every plant mask, the texture tool's coverage cutoff. */
const ALPHA_CUTOFF = 0.5;

/** The uniforms that a placement sets on a material after it is made. */
export interface PlacedUniforms {
	/** The distance from the camera inside which a near copy's cards give way to its real shoots. */
	readonly nearDistance?: number;
	/** How far into autumn the leaves stand, from 0 for summer to 1 for turned. */
	readonly season?: number;
	/** The season the plant stands in: 0 summer, 1 autumn, 2 winter, 3 blossom. */
	readonly seasonKind?: number;
}

/** What each material reads beyond its own textures: its kit's records and its wind state. */
interface Bound {
	readonly records: Texture;
	/** Sets the field's newest layer on the material. */
	readonly setLayer: (layer: number) => void;
	/** Sets the base wind's speed and heading, which a page's controls change. */
	readonly setBase: (speed: number, heading: number) => void;
	/** Sets the uniforms that a placement chooses. */
	readonly setPlaced: (uniforms: PlacedUniforms) => void;
	sentBorn: number;
}

const BOUND = new WeakMap<Material, Bound>();

/** A still field's texture, for materials that name no wind field. */
const STILL = new WeakMap<Textures, Texture>();

function stillWind(textures: Textures): Texture {
	const held = STILL.get(textures);
	if (held) return held;
	const made = textures.fromData({
		width: 1,
		height: 1,
		depth: 1,
		format: 'rgba16float',
		data: new Float32Array(4),
	});
	STILL.set(textures, made);
	return made;
}

/**
 * Makes a species' materials from its kit, one per role.
 *
 * @param ctx The sketch's context.
 * @param kit The species' kit, from `prepareSpecies`.
 * @param options The wind field, the sway distance and the matte.
 * @returns The materials.
 * @category api/vegetation
 */
export function plantMaterials(
	ctx: SketchContext,
	kit: SpeciesKit,
	options?: PlantMaterialOptions,
): PlantMaterials {
	if (kit.placeholders === true) return standInMaterials(ctx, kit);
	const field = options?.wind;
	const t = kit.textures;
	if (field) writeFieldSettings(t.records, field.air);
	const swayDistance = Math.max(0, options?.swayDistance ?? 0);
	const matte = options?.matte === true;
	const optics = foliageOptics(kit.record);
	const share = optics ? transmissionShare(optics.reflectance, optics.transmittance) : 0;
	const make = (
		role: keyof typeof MODE,
		textures: { colour: Texture; relief: Texture; second?: Texture; third?: Texture },
		leafy: boolean,
		wgsl = plantShader,
	) => {
		const material = ctx.materials.shader({
			wgsl,
			textures: {
				wind: field?.texture ?? stillWind(ctx.textures),
				records: t.records,
				...textures,
			},
			vertexColors: true,
			roughness: 0.8,
			metalness: 0,
			specularIntensity: matte ? 0 : LEAF_SPECULAR,
			doubleSided: leafy,
			// A matte carries each texel's own coverage, so it blends that coverage over the white
			// ground. A cut at the leaf's cutoff would turn a partly covered texel whole or clear,
			// and the review could not weigh the part. Every colour role keeps the cut that draws
			// its blade solid to its edge. The matte keeps the cutoff for its shadow caster, and
			// writes no depth so that every leaf over a texel adds its coverage to the matte's own.
			alphaMode: matte ? 'blend' : 'mask',
			alphaCutoff: ALPHA_CUTOFF,
			...(matte ? { depthWrite: false } : {}),
			...(leafy && share > 0 && { diffuseTransmission: share }),
			...(swayDistance > 0 && { swayDistance }),
			uniforms: {
				windBox: field?.size ?? 0,
				windStrength: field ? 1 : 0,
				windSpeed: field?.air.base[0] ?? 0,
				windHeading: field?.air.base[1] ?? 0,
				windLayer: field?.texture.layer ?? 0,
				swayDistance,
				mode: MODE[role],
				nearDistance: 0,
				displacement: 0,
				season: 0,
				seasonKind: 0,
				matte: matte ? 1 : 0,
			},
		});
		BOUND.set(material, {
			records: t.records,
			setLayer: (layer) => material.setUniform('windLayer', layer),
			setBase: (speed, heading) => {
				material.setUniform('windSpeed', speed);
				material.setUniform('windHeading', heading);
			},
			setPlaced: (uniforms) => {
				if (uniforms.nearDistance !== undefined)
					material.setUniform('nearDistance', uniforms.nearDistance);
				if (uniforms.season !== undefined) material.setUniform('season', uniforms.season);
				if (uniforms.seasonKind !== undefined)
					material.setUniform('seasonKind', uniforms.seasonKind);
			},
			sentBorn: field?.air.sent[3] ?? Number.NaN,
		});
		return material;
	};
	return {
		wood: make(
			'wood',
			{ colour: t.barkColor, relief: t.barkNormal, second: t.youngColor, third: t.youngNormal },
			false,
		),
		shoots: make(
			'shoots',
			{ colour: t.leafColor, relief: t.leafNormal, second: t.near, third: t.youngColor },
			true,
		),
		cards: make('cards', { colour: t.cardColor, relief: t.cardSurface }, true),
		foliage: make(
			'foliage',
			{ colour: t.leafColor, relief: t.leafNormal },
			true,
			kit.record.foliage.kind === 'grass-blade' ? viewFaceShader : plantShader,
		),
		foliageFar: make('foliage', { colour: t.leafColor, relief: t.leafNormal }, true),
		extras: make('extras', { colour: t.leafColor, relief: t.leafNormal }, true),
	};
}

/**
 * Gives each frame's newest wind state to the plant materials. The newest layer and the base wind
 * go up every frame, so a page's controls reach the plants at once. The rest of the field's
 * settings, which the materials read beyond its box, go up again only when a page has sent a gust.
 *
 * @param materials The materials that read the field.
 * @param field The wind field.
 * @category api/vegetation
 */
export function setWindLayer(materials: readonly PlantMaterial[], field: WindField): void {
	const layer = field.texture.layer;
	const born = field.air.sent[3];
	const speed = field.air.base[0];
	const heading = field.air.base[1];
	for (const material of materials) {
		const bound = BOUND.get(material);
		if (!bound) continue;
		bound.setLayer(layer);
		bound.setBase(speed, heading);
		if (bound.sentBorn !== born) {
			bound.sentBorn = born;
			writeFieldSettings(bound.records, field.air);
		}
	}
}

/**
 * Sets the uniforms that a placement chooses on plant materials: the distance at which near copies
 * hand their shoots to their cards, and the season of the leaves. Materials that `plantMaterials`
 * did not make, such as a stand-in kit's, are passed over.
 *
 * @param materials The materials.
 * @param uniforms The values to set.
 */
export function setPlacedUniforms(
	materials: readonly PlantMaterial[],
	uniforms: PlacedUniforms,
): void {
	for (const material of materials) BOUND.get(material)?.setPlaced(uniforms);
}

/**
 * A part's quantised arrays as a mesh that the plant materials draw: 16-bit positions inside the
 * species box, which the shader reads as fractions of the box and turns into metres, 8-bit normals,
 * the texture coordinates in the part's own steps, the second coordinates as fractions and the
 * vertex bytes as the shader reads them. The mesh keeps every byte the plant core made.
 *
 * @param ctx The sketch's context.
 * @param arrays The part's arrays.
 * @returns The mesh.
 */
export function plantGeometry(ctx: SketchContext, arrays: QuantisedArrays): MeshGeometry {
	return ctx.geometry.fromArrays({
		// The engine adds the shader's offset to the position it reads, in 32-bit floats. Read as
		// fractions of the box, that position stays near 1 and the sum keeps a few micrometres;
		// read as whole steps, it runs to 65,535 and the sum loses millimetres.
		positions: { array: arrays.positions, normalized: true },
		normals: arrays.normals,
		uvs: arrays.uvs,
		uvs1: { array: arrays.uvs1, normalized: true },
		colors: arrays.colors,
		// The foliage's blade keels ride the tangent attribute, four packed bytes a vertex.
		...(arrays.tangents && { tangents: arrays.tangents }),
		indices: arrays.indices,
		// The plant core grows its own levels, tiers and far cards from the skeleton, and the plant
		// shader sways every vertex, so the engine plans no levels of its own for the mesh.
		levels: false,
	});
}

/**
 * A shoot prototype's mesh at one tier, which the shoot role draws as instance rows.
 *
 * @param ctx The sketch's context.
 * @param arrays The prototype's arrays at one tier.
 * @returns The mesh.
 */
export function prototypeGeometry(ctx: SketchContext, arrays: PrototypeArrays): MeshGeometry {
	return ctx.geometry.fromArrays({
		positions: arrays.positions,
		normals: arrays.normals,
		uvs: arrays.uvs,
		uvs1: arrays.uvs1,
		colors: arrays.colors,
		...(arrays.tangents && { tangents: arrays.tangents }),
		indices: arrays.indices,
		// A prototype has a mesh for each tier, which the plant core picks, and the plant shader
		// sways every vertex, so the engine plans no levels of its own for the mesh.
		levels: false,
	});
}

/**
 * The sphere around the species box, in metres, which an object that draws a quantised part gives
 * `setBounds`: the mesh's own sphere lies around the positions as the shader reads them, fractions
 * of the box, not around the box in metres.
 *
 * @param box The species box.
 * @returns The sphere's center about the object's origin, and its radius, at scale 1.
 */
export function plantBounds(box: SpeciesBox): { center: [number, number, number]; radius: number } {
	const center: [number, number, number] = [0, 1, 2].map(
		(k) => ((box.min[k] as number) + (box.max[k] as number)) / 2,
	) as [number, number, number];
	const radius = Math.hypot(
		(box.max[0] as number) - (box.min[0] as number),
		(box.max[1] as number) - (box.min[1] as number),
		(box.max[2] as number) - (box.min[2] as number),
	);
	return { center, radius: radius / 2 };
}

/** The room a variant's sphere leaves round its own reach for the wind's sway: a share and metres. */
const SWAY_SHARE = 0.1;
const SWAY_ROOM = 0.5;

/**
 * The radius about a copy's origin that holds everything one variant draws, which a batch of its
 * quantised parts gives `setBoundingRadius`: every vertex of each level's parts and the reach of
 * each shoot row, with room for the wind's sway. The mesh's own sphere holds the positions as the
 * shader reads them, fractions of the species box, not metres. The engine keeps that sphere's
 * center, under a metre from the origin, and grows the radius by its distance, so each copy's
 * sphere holds its plant. Culling and the level bands both read the sphere's nearest point, so a
 * camera inside or beside the crown draws the nearest level, and the next level starts by the
 * plant's own reach, not by the species box, which holds every variant with room to spare.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @returns The radius in metres at scale 1.
 */
export function plantBoundingRadius(kit: SpeciesKitData, asset: PlantAsset): number {
	let farthest = 0;
	const at: [number, number, number] = [0, 0, 0];
	for (const level of asset.levels)
		for (const part of level.parts) {
			const positions = part.arrays.positions;
			for (let i = 0; i < positions.length / 3; i++) {
				dequantisePosition(positions, i, kit.box, at);
				farthest = Math.max(farthest, at[0] * at[0] + at[1] * at[1] + at[2] * at[2]);
			}
		}
	let reach = Math.sqrt(farthest);
	const rows = asset.shoots;
	for (let r = 0; r < rows.count; r++) {
		const x = rows.position[r * 3] as number;
		const y = rows.position[r * 3 + 1] as number;
		const z = rows.position[r * 3 + 2] as number;
		const shoot =
			(kit.prototypes[rows.prototype[r] as number]?.radius ?? 0) * (rows.scale[r] as number);
		reach = Math.max(reach, Math.hypot(x, y, z) + shoot);
	}
	return reach * (1 + SWAY_SHARE) + SWAY_ROOM;
}
