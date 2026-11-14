// The level switches: the distance at which each level starts, from the record's switch pixels.
// A switch happens where a size covers its number of pixels on the screen: the species' longest
// shoot for the near band's edge and the first card level, a shoot card for the second card level,
// and the plant's height for the impostor. The asset's distances are measured at a reference view;
// a page turns the same sizes and pixels into its own distances from its render height and field of
// view, so a small or narrow render switches nearer.
import type { SpeciesKitData } from '../asset';
import { radians, tan } from '../core/math';
import { spreadMax } from '../core/types';
import type { MeshInput } from '../stages';

/**
 * The view the asset's level distances are measured for: a 1080-pixel render at 60 degrees.
 *
 * @category api/vegetation
 */
export const REFERENCE_VIEW = { height: 1080, fov: 60 } as const;

/** A render's height in pixels and its vertical field of view in degrees. */
export interface SwitchView {
	readonly height: number;
	readonly fov: number;
}

/**
 * The distance in metres at which a size covers a number of pixels on a render.
 *
 * @param size The size in metres.
 * @param pixels The pixels it covers at the switch.
 * @param view The render's height and field of view.
 * @returns The distance.
 */
export function switchDistance(size: number, pixels: number, view: SwitchView): number {
	return (size * view.height) / (2 * tan(radians(view.fov / 2)) * Math.max(pixels, 1e-3));
}

/** The largest extent of a mesh's positions about the origin, in metres. */
function meshReach(positions: Float32Array): number {
	let reach = 0;
	for (let i = 0; i < positions.length; i += 3) {
		const x = positions[i] as number;
		const y = positions[i + 1] as number;
		const z = positions[i + 2] as number;
		reach = Math.max(reach, x * x + y * y + z * z);
	}
	return Math.sqrt(reach);
}

/**
 * The sizes that the switches measure: the longest shoot, from its attach point to its farthest tip
 * at the largest row scale, and the widest shoot card. A plant with merged foliage measures its
 * longest leaf for both.
 *
 * @param kit The species' kit.
 * @returns The shoot's length and the card's width, in metres.
 */
export function switchSizes(kit: SpeciesKitData): {
	readonly shoot: number;
	readonly card: number;
} {
	const record = kit.record;
	const scale = record.shoots ? spreadMax(record.shoots.placement.scale) : 1;
	let shoot = 0;
	let card = 0;
	for (const prototype of kit.prototypes) {
		shoot = Math.max(shoot, prototype.length * scale);
		card = Math.max(card, prototype.radius * 2 * scale);
	}
	if (shoot === 0)
		for (const leaf of kit.leaves) {
			const reach = meshReach(leaf.positions);
			shoot = Math.max(shoot, reach);
			card = Math.max(card, reach);
		}
	const least = 0.05;
	return { shoot: Math.max(shoot, least), card: Math.max(card, least) };
}

/**
 * Metres at which the first card level, the second card level and the impostor start, at a view.
 * Each starts past the one before it.
 *
 * @param kit The species' kit.
 * @param height The plant's height in metres.
 * @param view The render's height and field of view.
 * @returns The three distances.
 */
export function levelDistances(
	kit: SpeciesKitData,
	height: number,
	view: SwitchView,
): readonly [number, number, number] {
	const [near, card, far] = kit.record.lod.switchPixels;
	const sizes = switchSizes(kit);
	const first = switchDistance(sizes.shoot, near, view);
	const second = Math.max(switchDistance(sizes.card, card, view), first * 1.25);
	const impostor = Math.max(switchDistance(height, far, view), second * 1.25);
	return [first, second, impostor];
}

/**
 * The shortest shoot the first card level's start is measured from, in metres: a plant whose shoots
 * are small tufts, such as a cactus's spine clusters, still draws its nearest wood near the camera.
 */
const LEAST_SHOOT = 0.4;

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
 * placement scale, spans the record's first switch pixels. The page's hand-over from real shoots to
 * cards and the asset's own level distances both come from this one rule. Most records ask for more
 * pixels than a card's cell holds texels, so near its start a card is drawn larger than its picture.
 *
 * @param kit The species' kit.
 * @param view The render height in pixels and the vertical field of view in degrees.
 * @returns Metres, at a copy's scale of 1.
 * @category api/vegetation
 */
export function firstCardStart(
	kit: Pick<SpeciesKitData, 'record' | 'prototypes'>,
	view: { readonly height: number; readonly fov: number },
): number {
	return (
		(shootReach(kit) * view.height) /
		(2 * tan(radians(view.fov / 2)) * kit.record.lod.switchPixels[0])
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
	return levelDistances(input.kit, input.skeleton.height, REFERENCE_VIEW);
}
