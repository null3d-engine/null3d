// The plant materials: one shader, render/plant.wgsl, in five roles: wood, shoot rows, cards,
// merged foliage and extras. Each role binds its own textures to the shader's six slots and sets its role in
// a uniform. The meshes that the roles draw keep the plant core's quantised bytes on the GPU, and
// the shader turns them back into metres. A stand-in kit takes the standard material in its
// record's colours instead, which no wind moves.
import type { Material, MeshGeometry, SketchContext, Texture, Textures } from '@null3d/engine';
import type { WindField } from '@null3d/wind';
import type { PrototypeArrays, QuantisedArrays } from '../asset';
import type { SpeciesBox } from '../core/box';
import plantShader from './plant.wgsl';
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

/** What each material reads beyond its own textures: its kit's records and its wind state. */
interface Bound {
	readonly records: Texture;
	/** Sets the field's newest layer on the material. */
	readonly setLayer: (layer: number) => void;
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
	if (kit.placeholders) return standInMaterials(ctx, kit);
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
	) => {
		const material = ctx.materials.shader({
			wgsl: plantShader,
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
			alphaMode: 'mask',
			alphaCutoff: ALPHA_CUTOFF,
			...(leafy && share > 0 && { diffuseTransmission: share }),
			...(swayDistance > 0 && { swayDistance }),
			uniforms: {
				windBox: field?.size ?? 0,
				windStrength: field ? 1 : 0,
				windLayer: field?.texture.layer ?? 0,
				swayDistance,
				mode: MODE[role],
				displacement: 0,
				season: 0,
				matte: matte ? 1 : 0,
			},
		});
		BOUND.set(material, {
			records: t.records,
			setLayer: (layer) => material.setUniform('windLayer', layer),
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
		foliage: make('foliage', { colour: t.leafColor, relief: t.leafNormal }, true),
		extras: make('extras', { colour: t.leafColor, relief: t.leafNormal }, true),
	};
}

/**
 * Gives each frame's newest wind state to the plant materials. The field's settings, which the
 * materials read beyond its box, go up again only when a page has sent a gust.
 *
 * @param materials The materials that read the field.
 * @param field The wind field.
 * @category api/vegetation
 */
export function setWindLayer(materials: readonly PlantMaterial[], field: WindField): void {
	const layer = field.texture.layer;
	const born = field.air.sent[3];
	for (const material of materials) {
		const bound = BOUND.get(material);
		if (!bound) continue;
		bound.setLayer(layer);
		if (bound.sentBorn !== born) {
			bound.sentBorn = born;
			writeFieldSettings(bound.records, field.air);
		}
	}
}

/**
 * A part's quantised arrays as a mesh that the plant materials draw: 16-bit positions inside the
 * species box, which the shader turns into metres, 8-bit normals, the texture coordinates in the
 * part's own steps, the second coordinates as fractions and the vertex bytes as the shader reads
 * them. The mesh keeps every byte the plant core made.
 *
 * @param ctx The sketch's context.
 * @param arrays The part's arrays.
 * @returns The mesh.
 */
export function plantGeometry(ctx: SketchContext, arrays: QuantisedArrays): MeshGeometry {
	return ctx.geometry.fromArrays({
		positions: arrays.positions,
		normals: arrays.normals,
		uvs: arrays.uvs,
		uvs1: { array: arrays.uvs1, normalized: true },
		colors: arrays.colors,
		indices: arrays.indices,
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
		indices: arrays.indices,
	});
}

/**
 * The radius about a copy's origin that holds the whole species box, which a batch of quantised
 * parts gives `setBoundingRadius`: the mesh's own sphere holds the 16-bit steps, not metres.
 *
 * @param box The species box.
 * @returns The radius in metres at scale 1.
 */
export function plantBoundingRadius(box: SpeciesBox): number {
	let widest = 0;
	for (const x of [box.min[0], box.max[0]])
		for (const y of [box.min[1], box.max[1]])
			for (const z of [box.min[2], box.max[2]]) widest = Math.max(widest, Math.hypot(x, y, z));
	return widest;
}
