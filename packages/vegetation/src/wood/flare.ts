// The stem base: a stem's cross-section near the ground, after methods §4.6. The radius swells by
// the root flare, 1 + A·exp(−h / h0), and by buttress lobes, each a bump of its own size, angle and
// height of fade; flutes cut grooves up the stem. Lobes stand at uneven angles with uneven sizes,
// as an old oak's foot does, so no two variants share a ground line.
import { hashAt, unitAt } from '../core/hash';
import { cos, exp, PI, pow } from '../core/math';
import type { BaseSpec } from '../core/record';
import { spreadAt } from '../core/types';

/** Hash purposes of the stem base, apart from every other stage's. */
const Purpose = {
	Lobes: 0x51,
	Lobe: 0x52,
	Flutes: 0x53,
	Roots: 0x54,
} as const;

/** One buttress lobe: its angle, its share of the record's amount, and its height of fade. */
interface Lobe {
	readonly angle: number;
	readonly amount: number;
	readonly height: number;
}

/**
 * The cross-section of one stem near the ground: its radius at a height and an angle.
 */
export interface StemSection {
	/**
	 * The section's radius.
	 *
	 * @param h Metres above the ground; below it the section holds its ground value.
	 * @param theta Radians about the stem from the frame's normal.
	 * @param r The pipe radius at that height.
	 * @returns The radius in metres.
	 */
	radius(h: number, theta: number, r: number): number;
	/** Metres above the ground under which the section differs from the pipe radius. */
	readonly reach: number;
	/** The angles of the lobes in radians, from which surface roots leave. */
	readonly lobes: readonly number[];
}

/** Lobes of the buttress, spaced unevenly round the stem. */
function lobesOf(
	base: BaseSpec,
	seed: number,
	salt: number,
	variant: number,
	stem: number,
): Lobe[] {
	const buttress = base.buttress;
	if (!buttress || buttress.amount <= 0) return [];
	const count = Math.max(
		0,
		Math.round(spreadAt(buttress.lobes, unitAt(seed, salt, variant, Purpose.Lobes, stem))),
	);
	const turn = unitAt(seed, salt, variant, Purpose.Lobe, stem * 64) * 2 * PI;
	const lobes: Lobe[] = [];
	for (let k = 0; k < count; k++) {
		const key = stem * 64 + k + 1;
		const jitter = (unitAt(seed, salt, variant, Purpose.Lobe, key) - 0.5) * 0.5;
		lobes.push({
			angle: turn + ((k + jitter) / count) * 2 * PI,
			amount: buttress.amount * (0.6 + 0.6 * unitAt(seed, salt, variant, Purpose.Lobe, key + 1000)),
			height: buttress.height * (0.7 + 0.6 * unitAt(seed, salt, variant, Purpose.Lobe, key + 2000)),
		});
	}
	return lobes;
}

/** The smallest signed difference between two angles, in (−π, π]. */
function angleBetween(a: number, b: number): number {
	let d = (a - b) % (2 * PI);
	if (d > PI) d -= 2 * PI;
	if (d <= -PI) d += 2 * PI;
	return d;
}

/**
 * The section of one stem, or undefined when the record gives it no base.
 *
 * @param base The record's stem base.
 * @param seed The scene's seed.
 * @param salt The species' salt.
 * @param variant The variant.
 * @param stem The stem's index among the plant's stems.
 * @returns The section.
 */
export function stemSection(
	base: BaseSpec | undefined,
	seed: number,
	salt: number,
	variant: number,
	stem: number,
): StemSection | undefined {
	if (!base) return undefined;
	const flare = base.flare;
	const lobes = lobesOf(base, seed, salt, variant, stem);
	const sharpness = base.buttress?.sharpness ?? 2;
	// A lobe's bump reaches zero half a lobe's spacing from its crest.
	const width = lobes.length > 0 ? lobes.length : 1;
	const flutes = base.flutes;
	const fluteCount = flutes
		? Math.max(
				0,
				Math.round(spreadAt(flutes.count, unitAt(seed, salt, variant, Purpose.Flutes, stem))),
			)
		: 0;
	const flutePhase = (hashAt(seed, salt, variant, Purpose.Flutes, stem + 1) / 0x100000000) * 2 * PI;
	let reach = flare.amount > 0 ? flare.height * 7 : 0;
	for (const lobe of lobes) reach = Math.max(reach, lobe.height * 7);
	if (flutes && fluteCount > 0) reach = Math.max(reach, flutes.height);
	return {
		reach,
		lobes: lobes.map((lobe) => lobe.angle),
		radius(h: number, theta: number, r: number): number {
			const height = Math.max(0, h);
			let factor = 1 + (flare.height > 0 ? flare.amount * exp(-height / flare.height) : 0);
			let swell = 0;
			for (const lobe of lobes) {
				const d = angleBetween(theta, lobe.angle) * (width / 2);
				if (d <= -PI / 2 || d >= PI / 2) continue;
				swell += lobe.amount * pow(cos(d), sharpness) * exp(-height / lobe.height);
			}
			factor *= 1 + swell;
			let radius = r * factor;
			if (flutes && fluteCount > 0 && height < flutes.height) {
				const fade = 1 - height / flutes.height;
				const groove = 0.5 + 0.5 * cos(fluteCount * theta + flutePhase);
				radius -= flutes.depth * groove * groove * fade * fade;
			}
			return Math.max(radius, r * 0.5);
		},
	};
}

/**
 * The hash key of a stem's surface roots, so the roots and the lobes they leave from agree.
 *
 * @returns The purpose number.
 */
export function rootPurpose(): number {
	return Purpose.Roots;
}
