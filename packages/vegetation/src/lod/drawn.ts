// The triangles one copy of a plant draws at once. Every shoot row nearer the eye than the switch
// distance draws its prototype at the tier its distance asks for, and the nearest level's meshes
// draw whole. The count is taken from the worst of a few stated eyes: a standing person beside the
// trunk, one at the crown's edge, and, where asked, an eye inside the plant's fullest foliage,
// where most rows stand within the switch distance at once.
import type { PlantAsset, SpeciesKitData } from '../asset';
import { radians, tan } from '../core/math';
import { DETAILS, type Detail, spreadMax, type Vec3 } from '../core/types';
import { REFERENCE_VIEW } from './levels';

/** The tiers a near shoot row draws at, out from the eye, as shares of the switch distance. */
const NEAR_BANDS: readonly (readonly [share: number, detail: Detail])[] = [
	[0.25, 'high'],
	[0.5, 'medium'],
	[1.04, 'low'],
];

/** A standing person's eye height in metres. */
const EYE_HEIGHT = 1.7;

/** How far beside the trunk's line a standing eye stands, in metres along each level axis. */
const BESIDE_TRUNK = 0.5;

/** The most rows tried as the place of an eye inside the foliage. */
const FOLIAGE_EYES = 1024;

/** Where an eye stands. */
export type EyePlace = 'trunk' | 'edge' | 'foliage';

/** The worst count, and the eye it was taken from. */
export interface DrawnAtOnce {
	/** Triangles drawn at once. */
	readonly triangles: number;
	/** Which stated eye gives it, and where that eye stands in plant space. */
	readonly eye: EyePlace;
	readonly at: Vec3;
}

/**
 * The distance at which a copy hands its shoot rows to its first card level at the reference view:
 * where the kit's longest shoot, at its largest scale, covers the record's first switch pixels.
 *
 * @param kit The species' kit.
 * @returns Metres, at a copy's scale of 1.
 */
export function referenceShootSwitch(kit: SpeciesKitData): number {
	const record = kit.record;
	let longest = 0;
	for (const prototype of kit.prototypes) longest = Math.max(longest, prototype.length);
	longest *= record.shoots ? spreadMax(record.shoots.placement.scale) : 1;
	return (
		(longest * REFERENCE_VIEW.height) /
		(2 * tan(radians(REFERENCE_VIEW.fov / 2)) * record.lod.switchPixels[0])
	);
}

/**
 * The triangles one copy draws at once, from the worst of the stated eyes: beside the trunk and at
 * the crown's edge at a standing person's height, and, where asked, at the shoot row whose
 * neighbours within the switch distance draw the most. Each row inside the switch distance draws
 * at its band's tier, and the nearest level's meshes draw whole.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @param inside Whether an eye inside the foliage counts too. Without it, an eye inside the crown
 *   is the near pool's to bound, which cuts the switch distance nearer at run time.
 * @returns The worst count and its eye.
 */
export function drawnAtOnce(kit: SpeciesKitData, asset: PlantAsset, inside = true): DrawnAtOnce {
	const split = referenceShootSwitch(kit);
	const rows = asset.shoots;
	// Each row's reach past its place, and its triangles in each band, at each band's tier.
	const reach = new Float32Array(rows.count);
	const tiers = NEAR_BANDS.map(() => new Float64Array(rows.count));
	for (let r = 0; r < rows.count; r++) {
		const prototype = kit.prototypes[rows.prototype[r] as number];
		if (!prototype) continue;
		reach[r] = prototype.radius * (rows.scale[r] as number);
		NEAR_BANDS.forEach(([, detail], band) => {
			(tiers[band] as Float64Array)[r] =
				(prototype.tiers[DETAILS.indexOf(detail)]?.indices.length ?? 0) / 3;
		});
	}
	const countFrom = (eye: Readonly<Vec3>): number => {
		let triangles = asset.levels[0].triangles;
		for (let r = 0; r < rows.count; r++) {
			const distance =
				Math.hypot(
					(rows.position[r * 3] as number) - eye[0],
					(rows.position[r * 3 + 1] as number) - eye[1],
					(rows.position[r * 3 + 2] as number) - eye[2],
				) - (reach[r] as number);
			const band = NEAR_BANDS.findIndex(([share]) => distance < share * split);
			if (band >= 0) triangles += (tiers[band] as Float64Array)[r] as number;
		}
		return triangles;
	};
	const { centre, radius } = asset.crown;
	const eyes: [EyePlace, Vec3][] = [
		['trunk', [BESIDE_TRUNK, EYE_HEIGHT, BESIDE_TRUNK]],
		['edge', [(centre[0] as number) + radius, EYE_HEIGHT, centre[2] as number]],
	];
	const stride = Math.max(1, Math.ceil(rows.count / FOLIAGE_EYES));
	for (let r = 0; inside && r < rows.count; r += stride)
		eyes.push([
			'foliage',
			[
				rows.position[r * 3] as number,
				rows.position[r * 3 + 1] as number,
				rows.position[r * 3 + 2] as number,
			],
		]);
	let worst: DrawnAtOnce = { triangles: -1, eye: 'trunk', at: [0, 0, 0] };
	for (const [eye, at] of eyes) {
		const triangles = countFrom(at);
		if (triangles > worst.triangles) worst = { triangles, eye, at };
	}
	return worst;
}
