// The subject check of a close picture, on the tool's side. The page posts each close view's
// subject with its contract: whether the plant has the subject at all, whether its points land in
// the frame, and the parts of the picture that must show plant or open ground. A picture whose
// subject is missing is void: the tool measures nothing on it, and its row is neither passed nor
// failed by it. A missing subject is a fault of the tool's camera or of the reference's mapping,
// never a judgement of the plant.

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
	/** Whether the subject's points land in the frame as the view's contract asks, and why not. */
	readonly contract?: { readonly present: boolean; readonly reason?: string };
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

/** The share of a frame box that a mask marks as plant; the box is cut to the frame. */
export function regionCover(
	mask: Uint8Array,
	width: number,
	height: number,
	box: FrameBox,
): number {
	const left = Math.max(0, Math.min(width, Math.round(box[0] * width)));
	const top = Math.max(0, Math.min(height, Math.round(box[1] * height)));
	const right = Math.max(left, Math.min(width, Math.round(box[2] * width)));
	const bottom = Math.max(top, Math.min(height, Math.round(box[3] * height)));
	const area = (right - left) * (bottom - top);
	if (area === 0) return 0;
	let plant = 0;
	for (let y = top; y < bottom; y++)
		for (let x = left; x < right; x++) plant += mask[y * width + x] ? 1 : 0;
	return plant / area;
}

/** What a matte shows of a view's contract: each region's cover, and the first that fails it. */
export interface MatteCheck {
	readonly present: boolean;
	readonly reason?: string;
	readonly covers: readonly { readonly name: string; readonly cover: number }[];
}

/**
 * Whether a picture's matte shows what the view's contract asks: the plant covers each region no
 * less than its least share and no more than its most. A region under its least share shows air
 * where the subject should stand; one over its most shows a wall of plant where the photograph has
 * open ground.
 */
export function matteCheck(
	mask: Uint8Array,
	width: number,
	height: number,
	regions: readonly ContractRegion[],
): MatteCheck {
	const failures: string[] = [];
	const covers = regions.map((region) => {
		const cover = regionCover(mask, width, height, region.box);
		if (region.min !== undefined && cover < region.min)
			failures.push(
				`${region.name} shows plant over ${cover.toFixed(2)} of its part of the picture, under ${region.min}`,
			);
		if (region.max !== undefined && cover > region.max)
			failures.push(
				`${region.name} shows plant over ${cover.toFixed(2)} of its part of the picture, over ${region.max}`,
			);
		return { name: region.name, cover: Number(cover.toFixed(4)) };
	});
	return failures.length === 0
		? { present: true, covers }
		: { present: false, reason: failures.join('; '), covers };
}

/** A picture's matte as a mask, at its own size. */
export interface Matte {
	readonly mask: Uint8Array;
	readonly width: number;
	readonly height: number;
}

/**
 * Why a picture is void, or undefined when its subject is in it. The page's own statement comes
 * first: the plant has no such subject, or the solved camera does not hold it. Then, where the run
 * drew a matte and the view names regions, the picture itself is read.
 */
export function voidReason(facts: unknown, matte?: Matte): string | undefined {
	const subject = postedSubject(facts);
	if (!subject) return undefined;
	if (subject.missing !== undefined) return `the view has no subject: ${subject.missing}`;
	if (subject.contract && !subject.contract.present)
		return `the subject is not in the frame: ${subject.contract.reason ?? 'no reason given'}`;
	if (!matte || !subject.regions || subject.regions.length === 0) return undefined;
	const read = matteCheck(matte.mask, matte.width, matte.height, subject.regions);
	return read.present ? undefined : `the picture does not show the subject: ${read.reason}`;
}
