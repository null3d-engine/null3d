// The subject check of a close picture, on the tool's side. The page posts each close view's
// subject with its contract: whether the plant has the subject at all, whether its points land in
// the frame, and the parts of the picture that must show plant or open ground. A picture whose
// subject is missing is void: the tool measures nothing on it, and its row is neither passed nor
// failed by it. A missing subject is a fault of the tool's camera or of the reference's mapping.
// Where the page says the plant itself has no such part, that is a judgement of the plant, and
// the tool fails the picture's rows.
//
// A region is read from the picture of the plant's parts in flat colours, which the page draws
// from the same camera with the colour picture's own cut edges and layers. A matte can stand in
// for a region of the whole plant, and cannot read a region of wood or of foliage.

import type {
	ContractRegion,
	FrameBox,
} from '../../../tests/pages/lib/plant-review/subject-shots.ts';

/** What the page posted of a close view's subject. */
export interface PostedSubject {
	/** What the camera framed, in words. */
	readonly kind: string;
	/** Why the plant gives the view no subject, when it gives none. */
	readonly missing?: string;
	/**
	 * Whether the subject is missing because the plant has no such part. Otherwise the generator's
	 * data cannot name the part, or a slot asked for one that is not there, which is the tool's fault.
	 */
	readonly lacks?: boolean;
	/** Whether the subject's points land in the frame as the view's contract asks, and why not. */
	readonly contract?: { readonly present: boolean; readonly reason?: string };
	/** What the solve could not do, such as a stand that no turn round the subject leaves clear. */
	readonly warning?: string;
	/** The parts of the picture that must show plant or open ground. */
	readonly regions?: readonly ContractRegion[];
}

/** The subject a page posted with its facts, if it posted one. */
export function postedSubject(facts: unknown): PostedSubject | undefined {
	const subject = (facts as { subject?: Record<string, unknown> } | undefined)?.subject;
	if (!subject || typeof subject.kind !== 'string') return undefined;
	const contract = subject.contract as { present?: unknown; reason?: unknown } | undefined;
	return {
		kind: subject.kind,
		...(typeof subject.missing === 'string' && { missing: subject.missing }),
		...(subject.lacks === true && { lacks: true }),
		...(typeof subject.warning === 'string' && { warning: subject.warning }),
		...(contract &&
			typeof contract.present === 'boolean' && {
				contract: {
					present: contract.present,
					...(typeof contract.reason === 'string' && { reason: contract.reason }),
				},
			}),
		...(Array.isArray(subject.regions) && {
			regions: subject.regions as readonly ContractRegion[],
		}),
	};
}

/** What a texel of a picture of the parts shows. */
export const PART = { none: 0, wood: 1, foliage: 2, extras: 3 } as const;

/** The radius, in metres, that the blue channel of a wood texel spans, as the plant shader writes it. */
export const PART_RADIUS_SPAN = 4;

/** A picture of the plant's parts, read: each texel's part, and a wood texel's radius in metres. */
export interface Parts {
	readonly kind: Uint8Array;
	readonly radius: Float32Array;
	readonly width: number;
	readonly height: number;
}

/** A display value of 0 to 255 as the linear value the shader wrote. */
function linear(value: number): number {
	const v = value / 255;
	return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/**
 * Reads a picture of the parts. The ground is white. Wood is red, and its blue holds the square
 * root of its radius as a share of the radius span. Foliage is green. Extras are green and blue. A
 * texel that an edge blends between two parts takes the nearer colour, and one blended with the
 * white ground past half is ground.
 */
export function partsOf(image: {
	readonly data: Uint8Array | Uint8ClampedArray;
	readonly width: number;
	readonly height: number;
}): Parts {
	const { width, height, data } = image;
	const kind = new Uint8Array(width * height);
	const radius = new Float32Array(width * height);
	for (let at = 0; at < kind.length; at++) {
		const r = data[at * 4] as number;
		const g = data[at * 4 + 1] as number;
		const b = data[at * 4 + 2] as number;
		const red = r >= 128;
		const green = g >= 128;
		if (red && !green) {
			kind[at] = PART.wood;
			radius[at] = linear(b) ** 2 * PART_RADIUS_SPAN;
		} else if (green && !red) kind[at] = b >= 128 ? PART.extras : PART.foliage;
	}
	return { kind, radius, width, height };
}

/** The texels of a frame box, cut to the frame: its bounds and its area. */
function boxOf(width: number, height: number, box: FrameBox) {
	const left = Math.max(0, Math.min(width, Math.round(box[0] * width)));
	const top = Math.max(0, Math.min(height, Math.round(box[1] * height)));
	const right = Math.max(left, Math.min(width, Math.round(box[2] * width)));
	const bottom = Math.max(top, Math.min(height, Math.round(box[3] * height)));
	return { left, top, right, bottom, area: (right - left) * (bottom - top) };
}

/** The share of a frame box that a mask marks as plant; the box is cut to the frame. */
export function regionCover(
	mask: Uint8Array,
	width: number,
	height: number,
	box: FrameBox,
): number {
	const { left, top, right, bottom, area } = boxOf(width, height, box);
	if (area === 0) return 0;
	let plant = 0;
	for (let y = top; y < bottom; y++)
		for (let x = left; x < right; x++) plant += mask[y * width + x] ? 1 : 0;
	return plant / area;
}

/**
 * The share of a region's box that the parts it names cover in a picture of the parts: every part
 * of the plant, the foliage, or the wood, which counts from the region's least radius up.
 */
export function partCover(parts: Parts, region: ContractRegion): number {
	const { left, top, right, bottom, area } = boxOf(parts.width, parts.height, region.box);
	if (area === 0) return 0;
	const thick = region.thick ?? 0;
	const most = region.thickMost ?? Infinity;
	let count = 0;
	for (let y = top; y < bottom; y++)
		for (let x = left; x < right; x++) {
			const at = y * parts.width + x;
			const kind = parts.kind[at] as number;
			if (region.of === 'wood')
				count +=
					kind === PART.wood &&
					(parts.radius[at] as number) >= thick &&
					(parts.radius[at] as number) <= most
						? 1
						: 0;
			else if (region.of === 'foliage') count += kind === PART.foliage ? 1 : 0;
			else count += kind === PART.none ? 0 : 1;
		}
	return count / area;
}

/**
 * The share of a crown's plant pixels that foliage covers, read from a picture of the parts: the
 * wood and the foliage layers inside the crown's box. Extras are neither layer, so they count
 * toward neither. The region is in the measure's work pixels, and `scale` maps it to the picture's.
 */
export function partsFoliageShare(
	parts: Parts,
	region: {
		readonly left: number;
		readonly top: number;
		readonly right: number;
		readonly bottom: number;
	},
	scale: number,
): { readonly share: number; readonly pixels: number } | null {
	const left = Math.max(0, Math.floor(region.left * scale));
	const top = Math.max(0, Math.floor(region.top * scale));
	const right = Math.min(parts.width - 1, Math.ceil(region.right * scale));
	const bottom = Math.min(parts.height - 1, Math.ceil(region.bottom * scale));
	if (right < left || bottom < top) return null;
	let wood = 0;
	let foliage = 0;
	for (let y = top; y <= bottom; y++)
		for (let x = left; x <= right; x++) {
			const kind = parts.kind[y * parts.width + x] as number;
			if (kind === PART.wood) wood++;
			else if (kind === PART.foliage) foliage++;
		}
	const pixels = wood + foliage;
	if (pixels === 0) return null;
	return { share: Number((foliage / pixels).toFixed(4)), pixels };
}

/** What a matte shows of a view's contract: each region's cover, and the first that fails it. */
export interface MatteCheck {
	readonly present: boolean;
	readonly reason?: string;
	readonly covers: readonly { readonly name: string; readonly cover: number }[];
}

/** What a region's cover is a cover of, in words. */
function coveredBy(region: ContractRegion): string {
	if (region.of === 'foliage') return 'leaves';
	if (region.of !== 'wood') return 'plant';
	if (region.thick && region.thickMost)
		return `wood ${region.thick.toFixed(2)} to ${region.thickMost.toFixed(2)} m in radius`;
	return region.thick ? `wood ${region.thick.toFixed(2)} m in radius or more` : 'wood';
}

/** The regions' covers as a check: the first under its least share or over its most fails it. */
function checkCovers(
	read: readonly { readonly region: ContractRegion; readonly cover: number }[],
): MatteCheck {
	const failures: string[] = [];
	const covers = read.map(({ region, cover }) => {
		// The cover is a share of the region's box and the least and the most are shares too, so each
		// figure names its box: a wood region also names a radius in metres, and two bare decimals in
		// one clause read as one scale.
		const shows = `${region.name}: ${coveredBy(region)} covers ${cover.toFixed(2)} of its box`;
		// An area that is only reported gives its figure and judges nothing.
		if (!region.report && region.min !== undefined && cover < region.min)
			failures.push(`${shows}, under the least ${region.min.toFixed(2)}`);
		if (!region.report && region.max !== undefined && cover > region.max)
			failures.push(`${shows}, over the most ${region.max.toFixed(2)}`);
		return { name: region.name, cover: Number(cover.toFixed(4)) };
	});
	return failures.length === 0
		? { present: true, covers }
		: { present: false, reason: failures.join('; '), covers };
}

/**
 * Whether a picture's matte shows what the view's contract asks: the plant covers each region no
 * less than its least share and no more than its most. A region under its least share shows air
 * where the subject should stand; one over its most shows a wall of plant where the photograph has
 * open ground. A region of wood or of foliage is left out: a matte cannot tell the parts apart.
 */
export function matteCheck(
	mask: Uint8Array,
	width: number,
	height: number,
	regions: readonly ContractRegion[],
): MatteCheck {
	return checkCovers(
		regions
			.filter((region) => region.of === undefined)
			.map((region) => ({ region, cover: regionCover(mask, width, height, region.box) })),
	);
}

/**
 * Whether a picture of the parts shows what the view's contract asks: each region's parts cover
 * it no less than its least share and no more than its most. This is the check that sees leaves
 * or thin wood lying across a subject whose points are all in the frame.
 */
export function partsCheck(parts: Parts, regions: readonly ContractRegion[]): MatteCheck {
	return checkCovers(regions.map((region) => ({ region, cover: partCover(parts, region) })));
}

/**
 * Why the plant fails the picture, or undefined when it does not: it has no such part as its
 * photograph shows, or the camera holds the part's place and the picture does not show it. A
 * species' reference set holds the picture, so the species has the part and shows it. This is a
 * judgement of the plant, where a void is a fault of the tool.
 */
export function lackReason(facts: unknown, matte?: Matte, parts?: Parts): string | undefined {
	const fault = subjectFault(facts, matte, parts);
	return fault?.kind === 'plant' ? fault.reason : undefined;
}

/** Whether a solved view's camera holds the whole plant in its frame, as the page posted it. */
export function holdsWholePlant(facts: unknown): boolean {
	return (facts as { subject?: { whole?: unknown } } | undefined)?.subject?.whole === true;
}

/** Whether a solved view's contract held on the camera that drew the picture. */
export function contractHeld(facts: unknown): boolean {
	return postedSubject(facts)?.contract?.present === true;
}

/** A picture's matte as a mask, at its own size. */
export interface Matte {
	readonly mask: Uint8Array;
	readonly width: number;
	readonly height: number;
}

/** What a picture's own reading says of its subject, where it says the subject is not shown. */
export interface SubjectFault {
	/**
	 * Whose fault it is. `void`: the camera or the framing failed, so the picture decides nothing.
	 * `plant`: the camera took its stand and holds the subject's place, and the picture does not
	 * show the subject there, so the plant lacks it or hides it, and the picture's rows fail.
	 */
	readonly kind: 'void' | 'plant';
	readonly reason: string;
}

/**
 * Whether a picture shows its subject, and whose fault it is where it does not.
 *
 * The page's own statement comes first. A view that cannot name its subject is void, and so is a
 * camera that does not hold the subject's points. Then the picture is read: from its picture of
 * the parts where the run drew one, and from its matte where not. An area that fails after the
 * solve held is the plant's fault: the camera stands where the contract asks and the limb, the
 * bark or the open sky is not there to see. Where the solve itself said it could take no clear
 * stand, the failed area is the camera's, and the picture is void.
 */
export function subjectFault(
	facts: unknown,
	matte?: Matte,
	parts?: Parts,
): SubjectFault | undefined {
	const subject = postedSubject(facts);
	if (!subject) return undefined;
	if (subject.missing !== undefined)
		return subject.lacks
			? { kind: 'plant', reason: subject.missing }
			: { kind: 'void', reason: `the view has no subject: ${subject.missing}` };
	if (subject.contract && !subject.contract.present)
		return {
			kind: 'void',
			reason: `the subject is not in the frame: ${subject.contract.reason ?? 'no reason given'}`,
		};
	if (!subject.regions || subject.regions.length === 0) return undefined;
	const read = parts
		? partsCheck(parts, subject.regions)
		: matte
			? matteCheck(matte.mask, matte.width, matte.height, subject.regions)
			: undefined;
	if (!read || read.present) return undefined;
	return subject.warning !== undefined
		? {
				kind: 'void',
				reason: `the camera took no clear stand (${subject.warning}), and the picture does not show the subject: ${read.reason}`,
			}
		: {
				kind: 'plant',
				reason: `the camera holds the subject's place and the picture does not show it: ${read.reason}`,
			};
}

/**
 * Why a picture is void, or undefined when it is not: the camera or the framing failed. A picture
 * whose plant lacks or hides the subject is not void; `lackReason` gives that.
 */
export function voidReason(facts: unknown, matte?: Matte, parts?: Parts): string | undefined {
	const fault = subjectFault(facts, matte, parts);
	return fault?.kind === 'void' ? fault.reason : undefined;
}

/** The cover of each area of a solved view's contract, read from its picture of the parts. */
export function areaCovers(
	facts: unknown,
	parts: Parts | undefined,
): readonly { readonly name: string; readonly cover: number }[] {
	const regions = postedSubject(facts)?.regions ?? [];
	return parts && regions.length > 0 ? partsCheck(parts, regions).covers : [];
}

/** The least and the greatest wood radius, in metres, that a bark view's colour reads. */
export interface WoodBounds {
	readonly least: number;
	readonly most: number;
}

/**
 * The wood radius bounds a bark view's colour reads: the subject's own where the page posted a
 * region of wood, the radius the slot asks for where the view has no contract, and every wood
 * where it names neither. A bark close view draws other wood behind the subject, such as the
 * trunk below a limb, so the radius keeps the colour on the material the photograph shows.
 */
export function subjectWoodBounds(facts: unknown, thin: number | undefined): WoodBounds {
	const wood = (postedSubject(facts)?.regions ?? []).find((region) => region.of === 'wood');
	if (wood) return { least: wood.thick ?? 0, most: wood.thickMost ?? Number.POSITIVE_INFINITY };
	if (thin !== undefined) return { least: 0.75 * thin, most: 1.4 * thin };
	return { least: 0, most: Number.POSITIVE_INFINITY };
}

/**
 * Whether a picture's regions were read: a view that names regions of wood or of foliage is
 * checked only where the run drew its picture of the parts.
 */
export function regionsRead(facts: unknown, matte: boolean, parts: boolean): boolean {
	const regions = postedSubject(facts)?.regions ?? [];
	if (regions.length === 0) return true;
	return parts || (matte && regions.every((region) => region.of === undefined));
}
