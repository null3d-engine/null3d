// A test species for the leaf and shoot tests: the stand-in record given the pedunculate oak's
// leaf and shoots as the reference stills show them (slots 21 to 25): a leaf of about ten
// centimetres on a very short stalk, two-year shoots whose leaves crowd at the tip on a 2/5
// spiral round a cluster of five buds, and a manifest whose leaf outline is traced from the oak
// leaf's own coverage. The oak's real record lands with its species folder.
import type { SpeciesKitData } from '../asset';
import type { ShootSpec, Species } from '../core/record';
import { standInRecord } from '../core/stand-in';
import type { TextureManifest } from '../core/textures';
import { DETAILS } from '../core/types';
import { maskFromRuns, traceOutline } from './coverage.test-support';
import oakCoverage from './fixtures/pedunculate-oak-leaf-coverage.json' with { type: 'json' };
import { builder } from './leaf-mesh';
import { shootPrototypes } from './shoot';

/** The oak leaf's frame and outline, from its coverage. */
function oakLeaf(): NonNullable<TextureManifest['leaf']> {
	const mask = maskFromRuns(oakCoverage);
	const { size, covered } = mask;
	let low = -1;
	let base = -1;
	let top = -1;
	for (let row = 0; row < size; row++) {
		let width = 0;
		for (let x = 0; x < size; x++) width += covered[row * size + x] as number;
		if (width === 0) continue;
		if (low < 0) low = row;
		if (base < 0 && width > size * 0.15) base = row;
		top = row + 1;
	}
	return {
		size: 1024,
		layers: ['upper', 'lower'],
		length: (top - base) / size,
		frame: { petiole: [0.5, low / size], base: [0.5, base / size], tip: [0.5, top / size] },
		outline: traceOutline(mask, 64),
		mean: { upper: [0.046, 0.105, 0.032], lower: [0.11, 0.16, 0.09] },
		veins: { luminance: 0.5, contrast: 1 },
		profile: {
			upper: [0.9, 0.95, 1, 1.02, 1.03, 1.02, 1, 0.97],
			lower: [0.95, 0.98, 1, 1.01, 1.01, 1, 0.99, 0.97],
		},
		coverage: 0.372,
	};
}

/** A manifest that holds the oak leaf's figures and nothing else. */
export const OAK_MANIFEST: TextureManifest = {
	format: 1,
	species: 'test-oak',
	source: { repository: 'null3d-engine/plant-references', commit: '', files: [] },
	tool: { version: '', encoder: '' },
	leaf: oakLeaf(),
	outputs: [],
};

/** Internodes of an oak shoot: one long first internode, then the leaves crowded at the tip. */
const ROSETTE: readonly (readonly [number, number])[] = [
	[0, 20],
	[0.15, 0.6],
	[1, 0.3],
];

/**
 * The oak's shoots, as the reference stills show them. The unit is the current-year shoot of still
 * 23: a straight twig of about 12 cm ending in one rosette of six or seven large leaves, opening
 * outward and turned toward the sky, round a stack of buds of about 12 by 8 mm. The long
 * class is two years: last year's twig, whose end cluster put out this year's rosettes.
 */
export const OAK_SHOOTS: ShootSpec = {
	prototypes: 6,
	classes: [
		{
			name: 'short',
			vigor: [0, 0.5],
			share: 0.5,
			years: 1,
			length: { mean: 0.12, spread: 0.02 },
			nodes: { mean: 6, spread: 0.5 },
			internode: ROSETTE,
			leafScale: [
				[0, 0.8],
				[1, 0.9],
			],
			leafAngle: [
				[0, 130],
				[0.5, 75],
				[1, 25],
			],
			droop: 3,
		},
		{
			name: 'long',
			vigor: [0.5, 1],
			share: 0.5,
			years: 2,
			length: { mean: 0.3, spread: 0.05 },
			nodes: { mean: 7, spread: 1 },
			internode: ROSETTE,
			leafScale: [
				[0, 0.8],
				[1, 1],
			],
			leafAngle: [
				[0, 125],
				[0.5, 75],
				[1, 25],
			],
			droop: 5,
		},
	],
	phyllotaxis: { kind: 'spiral', divergence: 144 },
	orders: 2,
	years: 2,
	leafYears: 1,
	stem: { radius: [0.0035, 0.0025], zigzag: 6 },
	bud: { length: 0.012, width: 0.008, tipCluster: 7 },
	placement: {
		perMetre: [
			[0, 6],
			[1, 10],
		],
		shadePrune: 0.1,
		skyward: 0.75,
		scale: { mean: 1, spread: 0.15 },
	},
};

/** The test oak's record: the stand-in's, with the oak's leaf and shoots. */
export function oakRecord(overrides: Partial<Species> = {}): Species {
	const base = standInRecord('test-oak', { height: { mean: 20, spread: 3 }, aspect: 1.2 });
	return {
		...base,
		shoots: OAK_SHOOTS,
		foliage: {
			kind: 'blade',
			leaf: {
				length: { mean: 0.1, spread: 0.02 },
				outline: 'texture',
				petiole: { length: 0.005, radius: 0.0009, flat: 0, droop: 15 },
				fold: 16,
				curl: 18,
				crossCurl: -6,
				twist: 6,
				wave: [0.003, 5],
				optics: {
					reflectance: [0.046, 0.105, 0.032],
					reflectanceBack: [0.11, 0.16, 0.09],
					transmittance: [0.06, 0.14, 0.02],
					roughness: [0.45, 0.6],
				},
			},
		},
		...overrides,
	};
}

/** The parts of a kit that the leaf and shoot stages read, for a record and the oak's manifest. */
export function testKit(
	record: Species,
	detail: SpeciesKitData['detail'] = 'high',
): SpeciesKitData {
	const leaves = DETAILS.map((tier) => builder.leaves(record, OAK_MANIFEST, tier));
	const prototypes = shootPrototypes(record, OAK_MANIFEST, leaves).map((prototype) => ({
		...prototype,
		card: { planes: [] },
	}));
	return {
		record,
		manifest: OAK_MANIFEST,
		key: 'test',
		detail,
		box: { min: [-20, -1, -20], max: [20, 40, 20] },
		prototypes,
		leaves: leaves[DETAILS.indexOf(detail)] ?? [],
		cards: { size: 0, color: new Uint8Array(0), surface: new Uint8Array(0) },
		header: new Float32Array(0),
		placeholders: false,
	} as SpeciesKitData;
}
