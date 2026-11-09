// Stand-in species: a plain record for a species whose folder has not landed yet, so a scene names
// the species it places now and draws a simple stand-in until the real record arrives. A stand-in is
// a small self-organizing broadleaf scaled to the size it is given, in the leaf and bark colours it
// is given, and placed by the ecology it is given. Its kit grows the stand-in of every stage, so it
// draws the same as the real stages land. `loadSpeciesOrStandIn` takes the real species as soon as its folder exists.
import { hashText } from './hash';
import type { Species, SpeciesEcology, SpeciesModule } from './record';
import { isSpeciesId, loadSpecies } from './registry';
import { noTextureFiles, STAND_IN_BARK } from './textures';
import type { Rgb, Spread } from './types';

/**
 * The size, colours and placement of a stand-in species.
 *
 * @category api/vegetation
 */
export interface StandInOptions {
	/** A readable name; the id by default. */
	readonly name?: string;
	/** Height of a mature plant in metres; 8 by default. */
	readonly height?: Spread;
	/** Crown width over height; 0.8 by default. */
	readonly aspect?: number;
	/** Stem diameter at 1.3 m in metres; a fortieth of the height by default. */
	readonly dbh?: number;
	/** Linear colour of the leaves. */
	readonly leaf?: Rgb;
	/** Linear colour of the bark. */
	readonly bark?: Rgb;
	/** Variants grown, 1 to 8; 3 by default. */
	readonly variants?: number;
	/** Where the scatter places it. */
	readonly ecology?: SpeciesEcology;
}

/** The stand-in's leaf and bark colours when a scene gives none. */
const LEAF: Rgb = [0.08, 0.16, 0.04];

/**
 * The record of a stand-in species: a small self-organizing broadleaf at the size and in the
 * colours it is given.
 *
 * @param id The species' id, such as 'pedunculate-oak'.
 * @param options Its size, colours, variants and ecology.
 * @returns The record.
 * @category api/vegetation
 */
export function standInRecord(id: string, options: StandInOptions = {}): Species {
	const height = options.height ?? { mean: 8, spread: 1 };
	const mean = typeof height === 'number' ? height : height.mean;
	const leaf = options.leaf ?? LEAF;
	return {
		id,
		name: options.name ?? id,
		latin: 'Planta vicaria',
		form: 'a stand-in until the species lands',
		size: { height, dbh: options.dbh ?? mean / 40, aspect: options.aspect ?? 0.8 },
		growth: {
			model: 'self-organizing',
			years: 12,
			macroOrders: 3,
			internode: { length: Math.max(0.05, mean / 16), ageFactor: 0.9 },
			stems: { count: 1, lean: { mean: 2, spread: 2 }, stool: 0, fused: 0 },
			buds: {
				arrangement: { kind: 'spiral', divergence: 137.5 },
				angle: 50,
				angleSpread: 10,
				extinction: [0.02, 0.1],
			},
			apical: { control: 0.5, dominance: [1, 0.5, 0.9], wander: 5 },
			light: { apical: 1.2, lateral: 1.5, shadow: [6, 0.5, 2], cells: 48 },
			tropism: { photo: 0.2, gravi: 0.2 },
			shedding: { threshold: 0.15, cleanBole: 0.3, stubs: 0.2 },
			bending: { strength: 0.3, upturn: 0.2 },
			relay: false,
			pipe: { exponent: 2.5, tipRadius: 0.004 },
		},
		envelope: {
			kind: 'radial',
			heights: [0.3, 0.45, 0.6, 0.75, 0.9, 1],
			radii: [0.2, 0.38, 0.42, 0.38, 0.25, 0.02],
			source: { method: 'hand', from: 'none: a stand-in draws no reference' },
		},
		shoots: {
			prototypes: 4,
			classes: [
				{
					name: 'long',
					vigor: [0, 1],
					share: 1,
					length: Math.max(0.05, mean / 24),
					nodes: 5,
					internode: 1,
					leafScale: 1,
					leafAngle: 50,
					droop: 5,
				},
			],
			phyllotaxis: { kind: 'spiral', divergence: 137.5 },
			orders: 1,
			years: 1,
			leafYears: 1,
			stem: { radius: [0.003, 0.0015], zigzag: 0 },
			bud: { length: 0.006, width: 0.003, tipCluster: 1 },
			placement: {
				perMetre: 6,
				shadePrune: 0.1,
				tipPrune: 0.05,
				skyward: 0.3,
				scale: { mean: 1, spread: 0.15 },
			},
		},
		foliage: {
			kind: 'blade',
			leaf: {
				length: Math.max(0.02, mean / 60),
				outline: { width: 0.3, tip: 'acute', base: 'rounded' },
				petiole: { length: 0.02, radius: 0.001, flat: 0, droop: 10 },
				fold: 10,
				curl: 10,
				crossCurl: 0,
				twist: 5,
				wave: [0, 0],
				optics: {
					reflectance: leaf,
					reflectanceBack: leaf,
					transmittance: leaf,
					roughness: [0.5, 0.6],
				},
			},
		},
		bark: {
			zones: [
				{ layer: 0, by: 'height', from: 0, to: 100, blend: 0, tint: options.bark ?? STAND_IN_BARK },
			],
			young: 0,
			youngRadius: 0.02,
			girthScale: 1,
			displacement: 0,
			collar: { swell: 0.15, length: 1.5, ridge: 0.5 },
		},
		seasons: { default: 'summer', deciduous: true, winter: 'bare' },
		wind: {
			stiffness: [
				[0, 0.9],
				[1, 0.2],
			],
			sway: { frequency: 0.4, amplitude: 0.05 },
			flutter: { kind: 'blade', amplitude: 0.3, frequency: 3 },
		},
		lod: {
			nearFoliage: 'instanced',
			switchPixels: [24, 12, 160],
			woodOrders: [2, 1],
			impostor: { views: 8, texels: 32 },
			shadowLevel: 1,
			budget: {
				kitBytes: { low: 2_000_000, medium: 2_000_000, high: 2_000_000, ultra: 2_000_000 },
				variantBytes: { low: 2_000_000, medium: 2_000_000, high: 2_000_000, ultra: 2_000_000 },
				lod0Triangles: 1_000_000,
				lod1Triangles: 60_000,
				lod2Triangles: 20_000,
				downloadBytes: 0,
				downloadHalfBytes: 0,
				growMilliseconds: 600,
			},
		},
		textures: 'own',
		variants: options.variants ?? 3,
		seedSalt: Number.parseInt(hashText(id).slice(0, 8), 16),
		...(options.ecology && { ecology: options.ecology }),
	};
}

/**
 * A stand-in species: its record, and no texture files, so it draws in flat colours.
 *
 * @param id The species' id, such as 'pedunculate-oak'.
 * @param options Its size, colours, variants and ecology.
 * @returns The species module.
 * @category api/vegetation
 */
export function standInSpecies(id: string, options: StandInOptions = {}): SpeciesModule {
	return { record: standInRecord(id, options), textures: noTextureFiles(id) };
}

/**
 * Loads a species by its id when its folder exists, or makes its stand-in until it does. A scene
 * that places species not yet in the registry names them so, and draws each real one as soon as it
 * lands.
 *
 * @param id The species' id.
 * @param options The stand-in's size, colours, variants and ecology.
 * @returns The species module.
 * @category api/vegetation
 */
export function loadSpeciesOrStandIn(
	id: string,
	options: StandInOptions = {},
): Promise<SpeciesModule> {
	return isSpeciesId(id) ? loadSpecies(id) : Promise.resolve(standInSpecies(id, options));
}
