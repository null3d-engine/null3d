// The level switches: the distance at which each level starts, from the record's switch pixels at a
// reference view. A page turns the same pixels into its own distances from its render height and
// field of view. It throws until the levels are built; the first card level's start is built, and
// the page and the stand-in levels both read it.
import type { SpeciesKitData } from '../asset';
import { radians, tan } from '../core/math';
import { notBuilt } from '../core/not-built';
import type { Species } from '../core/record';
import { type Detail, spreadMax } from '../core/types';
import type { MeshInput } from '../stages';
import { cardTexels } from './card-bake';

/**
 * The view the asset's level distances are measured for: a 1080-pixel render at 60 degrees.
 *
 * @category api/vegetation
 */
export const REFERENCE_VIEW = { height: 1080, fov: 60 } as const;

/**
 * The shortest shoot the first card level's start is measured from, in metres: a plant whose shoots
 * are small tufts, such as a cactus's spine clusters, still draws its nearest wood near the camera.
 */
const LEAST_SHOOT = 0.4;

/**
 * The pixels the longest shoot spans where the first card level starts: the record's first switch
 * pixels, but never more than the texels its card's picture gives the shoot at the kit's tier, so a
 * card is never drawn larger than its own picture. A plant whose foliage is one mesh draws no shoot
 * cards and keeps the record's pixels.
 *
 * @param record The species record.
 * @param detail The kit's tier, which sets the card cells.
 * @returns The pixels.
 * @category api/vegetation
 */
export function firstCardPixels(record: Species, detail: Detail): number {
	const pixels = record.lod.switchPixels[0];
	if (record.lod.nearFoliage === 'merged') return pixels;
	return Math.min(pixels, cardTexels(record, detail));
}

/**
 * The longest shoot of a kit at its largest placement scale, in metres, and never shorter than the
 * least the first card level's start is measured from.
 *
 * @param kit The species' kit.
 * @returns Metres.
 * @category api/vegetation
 */
export function shootReach(kit: Pick<SpeciesKitData, 'record' | 'prototypes'>): number {
	let longest = 0;
	for (const prototype of kit.prototypes) longest = Math.max(longest, prototype.length);
	const shoots = kit.record.shoots;
	const scale = shoots ? spreadMax(shoots.placement.scale) : 1;
	return Math.max(LEAST_SHOOT, longest * scale);
}

/**
 * Metres at which the first card level starts at a view: where the longest shoot, at its largest
 * placement scale, spans the first card pixels at the kit's tier. The page's hand-over from real
 * shoots to cards and the asset's own level distances both come from this one rule.
 *
 * @param kit The species' kit.
 * @param view The render height in pixels and the vertical field of view in degrees.
 * @returns Metres, at a copy's scale of 1.
 * @category api/vegetation
 */
export function firstCardStart(
	kit: Pick<SpeciesKitData, 'record' | 'prototypes' | 'detail'>,
	view: { readonly height: number; readonly fov: number },
): number {
	return (
		(shootReach(kit) * view.height) /
		(2 * tan(radians(view.fov / 2)) * firstCardPixels(kit.record, kit.detail))
	);
}

/**
 * Metres at which the first card level, the second card level and the impostor start, at the
 * reference view.
 *
 * @param input The dressed variant.
 * @returns The three distances.
 */
export function levelStarts(input: MeshInput): readonly [number, number, number] {
	void input;
	throw notBuilt('level distances');
}
