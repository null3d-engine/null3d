// The triangles one copy of a plant draws at once, as the engine draws it. The nearest level's
// meshes draw whole, and every shoot row whose bounds come within the shoot switch distance, and
// the little past it that rows draw to, draws its prototype at the kit's one tier. The switch
// distance follows the page's view: its render height, its lens and its switch bias. The count is
// taken from the worst of a few stated eyes: a standing person beside the trunk, one at the crown's
// edge, and, where asked, an eye inside the plant's fullest foliage, where most rows stand within
// the switch distance at once.
import type { PlantAsset, SpeciesKitData } from '../asset';
import { pow } from '../core/math';
import { DETAILS, spreadMax, type Vec3 } from '../core/types';

/**
 * The page's view, which turns every species' switch pixels into metres. A page gives one view to
 * every `placePlants` call, so its switch bias moves the level switches of all its species at once.
 *
 * @category api/vegetation
 */
export interface PlantView {
	/** The page's render height in pixels. */
	readonly height: number;
	/** The camera's vertical field of view in degrees. */
	readonly fov: number;
	/**
	 * Stops by which every level switch moves nearer: each switch distance is multiplied by two to the
	 * power of minus the bias. 1 switches at half the distance, -1 at twice it, 0 as the species
	 * gives. 0 by default.
	 */
	readonly switchBias?: number;
}

/** How far past the switch distance a shoot row draws, and how far inside it a card gives way. */
export const SHOOT_REACH = 1.04;

/** A standing person's eye height in metres. */
const EYE_HEIGHT = 1.7;

/** How far beside the trunk's line a standing eye stands, in metres along each level axis. */
const BESIDE_TRUNK = 0.5;

/** The most rows tried as the place of an eye inside the foliage. */
const FOLIAGE_EYES = 1024;

/**
 * The factor that a page's distance-switch bias gives every switch distance: two to the power of
 * minus the bias, so a bias of 1 switches each level at half the distance and -1 at twice it.
 *
 * @param bias The bias in stops; 0 leaves every distance as it is.
 * @returns The factor.
 * @category api/vegetation
 */
export function switchScale(bias = 0): number {
	if (!Number.isFinite(bias))
		throw new Error(`@null3d/vegetation: a switch bias of ${bias} is not a number of stops.`);
	return bias === 0 ? 1 : pow(2, -bias);
}

/**
 * The distance at which a copy hands its shoots to its first card level: where the species'
 * longest shoot, at its largest scale, covers the record's first switch pixels at the page's view.
 *
 * @param kit The species' kit.
 * @param view The page's render height and vertical field of view.
 * @returns Metres, at a copy's scale of 1.
 */
export function shootSwitchDistance(kit: SpeciesKitData, view: PlantView): number {
	let longest = 0;
	for (const prototype of kit.prototypes) longest = Math.max(longest, prototype.length);
	const scale = kit.record.shoots ? spreadMax(kit.record.shoots.placement.scale) : 1;
	longest *= scale;
	const pixels = kit.record.lod.switchPixels[0];
	return (longest * view.height) / (2 * Math.tan((view.fov * Math.PI) / 360) * pixels);
}

/** Where an eye stands. */
export type EyePlace = 'trunk' | 'edge' | 'foliage';

/** The worst count, and the eye it was taken from. */
export interface DrawnAtOnce {
	/** Triangles drawn at once. */
	readonly triangles: number;
	/** The shoot rows drawn at once. */
	readonly rows: number;
	/** Which stated eye gives it, and where that eye stands in plant space. */
	readonly eye: EyePlace;
	readonly at: Vec3;
}

/**
 * The triangles one copy draws at once from the worst of the stated eyes: beside the trunk and at
 * the crown's edge at a standing person's height, and, where asked, at the shoot row whose
 * neighbours draw the most. The nearest level's meshes draw whole, and each row whose bounds come
 * within the switch distance at the view, past which rows give way to cards, draws at the kit's
 * tier. A row's bounds are its prototype's reach from the row's place at the row's scale.
 *
 * @param kit The species' kit.
 * @param asset The grown variant, at a copy's scale of 1.
 * @param view The page's render height, lens and switch bias.
 * @param inside Whether an eye inside the foliage counts too.
 * @returns The worst count and its eye.
 * @category api/vegetation
 */
export function drawnAtOnce(
	kit: SpeciesKitData,
	asset: PlantAsset,
	view: PlantView,
	inside = true,
): DrawnAtOnce {
	const range = shootSwitchDistance(kit, view) * switchScale(view.switchBias) * SHOOT_REACH;
	const rows = asset.shoots;
	const tier = DETAILS.indexOf(kit.detail);
	// Each row's reach past its place and its triangles at the kit's tier.
	const reach = new Float32Array(rows.count);
	const triangles = new Float64Array(rows.count);
	for (let r = 0; r < rows.count; r++) {
		const prototype = kit.prototypes[rows.prototype[r] as number];
		if (!prototype) continue;
		reach[r] = prototype.radius * (rows.scale[r] as number);
		triangles[r] = (prototype.tiers[tier]?.indices.length ?? 0) / 3;
	}
	const countFrom = (eye: Readonly<Vec3>): { triangles: number; rows: number } => {
		let sum = asset.levels[0].triangles;
		let drawn = 0;
		for (let r = 0; r < rows.count; r++) {
			const distance =
				Math.hypot(
					(rows.position[r * 3] as number) - eye[0],
					(rows.position[r * 3 + 1] as number) - eye[1],
					(rows.position[r * 3 + 2] as number) - eye[2],
				) - (reach[r] as number);
			if (distance >= range) continue;
			sum += triangles[r] as number;
			drawn++;
		}
		return { triangles: sum, rows: drawn };
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
	let worst: DrawnAtOnce = { triangles: -1, rows: 0, eye: 'trunk', at: [0, 0, 0] };
	for (const [eye, at] of eyes) {
		const count = countFrom(at);
		if (count.triangles > worst.triangles) worst = { ...count, eye, at };
	}
	return worst;
}
