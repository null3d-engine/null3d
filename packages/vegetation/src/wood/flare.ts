// The stem base: a stem's cross-section near the ground, after methods §4.6. The radius swells by
// the root flare, 1 + A·exp(−h / h0), with a bole taper that widens it evenly toward the ground, and
// by buttress lobes, each a bump of its own size, angle and height of fade; flutes cut grooves up
// the stem. Lobes stand at uneven angles with uneven sizes, as an old oak's foot does, so no two
// variants share a ground line.
import { hashAt, unitAt } from '../core/hash';
import { cos, exp, PI, pow, radians, sin } from '../core/math';
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
	/** How narrow this lobe's crest is: higher is narrower, and the record's own × a share. */
	readonly sharpness: number;
}

/** Heights of fade over which a rounded lobe eases from its full swell to none. */
const ROUND_SPAN = 2.5;

/**
 * A lobe's swell at a height, as a share of its amount: a fall from the ground over its height of
 * fade, blended with a rounded crest that keeps its full swell at the ground and eases out over a
 * few heights of fade, so the crest stands from the meadow as a root's flank does.
 */
function lobeFade(height: number, fade: number, round: number): number {
	const fall = exp(-height / fade);
	if (round <= 0) return fall;
	const u = height / (fade * ROUND_SPAN);
	const crest = u >= 1 ? 0 : 0.5 + 0.5 * cos(PI * u);
	return (1 - round) * fall + round * crest;
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
		// A real foot's lobes are not one shape repeated: each stands where its own draw puts it, a
		// little larger or smaller, taller or shorter, and narrower or broader than its neighbours.
		const jitter = (unitAt(seed, salt, variant, Purpose.Lobe, key) - 0.5) * 1.1;
		lobes.push({
			angle: turn + ((k + jitter) / count) * 2 * PI,
			amount: buttress.amount * (0.4 + 1.0 * unitAt(seed, salt, variant, Purpose.Lobe, key + 1000)),
			height:
				buttress.height * (0.45 + 1.1 * unitAt(seed, salt, variant, Purpose.Lobe, key + 2000)),
			sharpness: 0.55 + 0.9 * unitAt(seed, salt, variant, Purpose.Lobe, key + 3000),
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
	const round = Math.max(0, Math.min(1, base.buttress?.round ?? 0));
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
	// A fire scar carves the first stem alone: the strong trees carry one, and a multi-stemmed plant
	// would not show the same hollow on every stem.
	const scar = stem === 0 ? base.scar : undefined;
	const scarAngle = scar ? radians(scar.angle) : 0;
	const scarHalf = scar ? radians(scar.width) * 0.5 : 0;
	const scarCos = scar ? cos(scarHalf) : 1;
	const scarDepth = scar?.depth ?? 0;
	const scarFrom = scar?.from ?? 0;
	const scarSpan = scar ? scar.to - scar.from : 1;
	const taper =
		base.taper && base.taper.amount > 0 && base.taper.height > 0 ? base.taper : undefined;
	let reach = flare.amount > 0 ? flare.height * 7 : 0;
	if (taper) reach = Math.max(reach, taper.height);
	for (const lobe of lobes) reach = Math.max(reach, lobe.height * 7);
	if (flutes && fluteCount > 0) reach = Math.max(reach, flutes.height);
	return {
		reach,
		lobes: lobes.map((lobe) => lobe.angle),
		radius(h: number, theta: number, r: number): number {
			const height = Math.max(0, h);
			// The hollow's own share at this angle and height: full at its centre, zero at its edges
			// and at its foot and head. It holds the charred face smooth, so the bark's ridges fade
			// out inside it rather than running across it.
			let hollow = 0;
			if (scar && scarDepth > 0) {
				const turn = (cos(angleBetween(theta, scarAngle)) - scarCos) / Math.max(1e-6, 1 - scarCos);
				const across = Math.max(0, Math.min(1, turn));
				const angular = across * across * (3 - 2 * across);
				const up = (height - scarFrom) / scarSpan;
				const vertical = up > 0 && up < 1 ? sin(PI * up) ** 2 : 0;
				hollow = angular * vertical;
			}
			const smooth = 1 - hollow;
			const smoothEnough = smooth > 0 ? smooth : 0;
			let factor = 1 + (flare.height > 0 ? flare.amount * exp(-height / flare.height) : 0);
			if (taper && height < taper.height) factor += taper.amount * (1 - height / taper.height);
			let swell = 0;
			for (const lobe of lobes) {
				const d = angleBetween(theta, lobe.angle) * (width / 2);
				if (d <= -PI / 2 || d >= PI / 2) continue;
				swell +=
					lobe.amount *
					pow(cos(d), sharpness * lobe.sharpness) *
					lobeFade(height, lobe.height, round);
			}
			factor *= 1 + swell * smoothEnough;
			let radius = r * factor;
			if (flutes && fluteCount > 0 && height < flutes.height) {
				const fade = 1 - height / flutes.height;
				const groove = 0.5 + 0.5 * cos(fluteCount * theta + flutePhase);
				radius -= flutes.depth * groove * groove * fade * fade * smoothEnough;
			}
			radius -= scarDepth * hollow;
			return Math.max(radius, r * 0.5);
		},
	};
}

/**
 * One surface root: its points from inside the stem out along the ground and down into it, and its
 * radius at each.
 */
export interface SurfaceRoot {
	readonly points: Float64Array;
	readonly radii: Float64Array;
}

/**
 * A root's run along the ground: at each point, metres out from the stem's axis, the height of the
 * root's centre over the foot, and the share of the root's radius.
 */
interface RootRun {
	readonly along: number[];
	readonly rise: number[];
	readonly girth: number[];
}

/** A run half buried along the ground, from just above it at the stem. */
function halfBuriedRun(foot: number, length: number, r: number): RootRun {
	return {
		along: [0, foot * 0.9, foot + 0.35 * length, foot + 0.7 * length, foot + length],
		rise: [r, 0.55 * r, 0.3 * r, 0.15 * r, 0],
		girth: [1, 1, 0.85, 0.7, 0.55],
	};
}

/**
 * A ridge's run: at the stem it stands its share of the girth out of the ground, and it sinks as it
 * tapers to half its radius, slowly at first and faster toward its end, where its top meets the
 * ground.
 */
function ridgeRun(foot: number, length: number, r: number, ridge: number): RootRun {
	const stand = Math.max(0, Math.min(1, ridge));
	const along = [0, foot * 0.9, ...[0, 0.25, 0.5, 0.75, 1].map((u) => foot + u * length)];
	const rise: number[] = [];
	const girth: number[] = [];
	for (const out of along) {
		const u = Math.max(0, (out - foot) / length);
		const share = 1 - 0.5 * u;
		girth.push(share);
		rise.push(r * share * (2 * stand * (1 - u * u) - 1));
	}
	return { along, rise, girth };
}

/**
 * The surface roots of one stem, after methods §4.6: each leaves from a buttress lobe (or, with no
 * lobes, at an even angle), runs along the ground for the record's length, tapering, half buried or
 * as a ridge that sinks into it, and dives. A root starts on the stem's axis at or above the ground,
 * so the mesher welds it onto the stem's foot.
 *
 * @param base The record's stem base.
 * @param section The stem's section, whose lobes the roots leave from.
 * @param foot The stem's first node: its position and its radius.
 * @param normal The stem's frame's normal at its foot, where angle 0 points.
 * @param binormal The frame's binormal.
 * @param seed The scene's seed.
 * @param salt The species' salt.
 * @param variant The variant.
 * @param stem The stem's index among the plant's stems.
 * @returns The roots.
 */
export function surfaceRoots(
	base: BaseSpec | undefined,
	section: StemSection | undefined,
	foot: { readonly x: number; readonly y: number; readonly z: number; readonly radius: number },
	normal: readonly [number, number, number],
	binormal: readonly [number, number, number],
	seed: number,
	salt: number,
	variant: number,
	stem: number,
): SurfaceRoot[] {
	const roots = base?.roots;
	if (!roots || roots.radius <= 0) return [];
	const wanted = Math.max(
		0,
		Math.round(spreadAt(roots.count, unitAt(seed, salt, variant, Purpose.Roots, stem))),
	);
	const lobes = section?.lobes ?? [];
	const count = lobes.length > 0 ? Math.min(wanted, lobes.length) : wanted;
	const turn = unitAt(seed, salt, variant, Purpose.Roots, stem + 4096) * 2 * PI;
	const out: SurfaceRoot[] = [];
	const r = roots.radius;
	for (let k = 0; k < count; k++) {
		const key = stem * 64 + k;
		const angle =
			lobes.length > 0
				? (lobes[Math.floor((k * lobes.length) / count)] as number)
				: turn + (k / count) * 2 * PI;
		// Along the ground from the lobe's angle, and across it for a little wander.
		let dx = cos(angle) * normal[0] + sin(angle) * binormal[0];
		let dz = cos(angle) * normal[2] + sin(angle) * binormal[2];
		const l = Math.sqrt(dx * dx + dz * dz) || 1;
		dx /= l;
		dz /= l;
		const length = Math.max(
			r * 4,
			spreadAt(roots.length, unitAt(seed, salt, variant, Purpose.Roots, key + 8192)),
		);
		const wander = (unitAt(seed, salt, variant, Purpose.Roots, key + 16384) - 0.5) * 0.3 * length;
		const { along, rise, girth } =
			roots.ridge === undefined
				? halfBuriedRun(foot.radius, length, r)
				: ridgeRun(foot.radius, length, r, roots.ridge);
		// Then a dive deep enough to bury the whole girth. A shallower one leaves the tube's upper
		// surface lying in the ground, and the ground cuts it to a fin.
		const plunge = Math.max(roots.dive, 2 * r);
		along.push(foot.radius + length + plunge * 1.5, foot.radius + length + plunge * 3);
		rise.push(-plunge, -plunge * 1.6);
		girth.push(0.5, 0.4);
		const points = new Float64Array(along.length * 3);
		const radii = new Float64Array(along.length);
		for (let i = 0; i < along.length; i++) {
			const out = along[i] as number;
			const side = wander * Math.max(0, (out - foot.radius) / length) ** 2;
			points[i * 3] = foot.x + dx * out - dz * side;
			points[i * 3 + 1] = foot.y + (rise[i] as number);
			points[i * 3 + 2] = foot.z + dz * out + dx * side;
			radii[i] = r * (girth[i] as number);
		}
		out.push({ points, radii });
	}
	return out;
}
