// The wood's pine crowns, made in code at four levels of detail. A crown is four tiers of needles.
// Each tier is a closed shell: a rounded top that rises from its rim to its tip, and a dished
// underside that rises from the rim back to the trunk, so a crown seen from below or close up has
// thickness. The rim breaks into clumps that droop a little, and vertex colors darken toward each
// tier's base and on its underside.
import type { Geometry, MeshGeometry } from '@null3d/engine';

/** Each level's segments around a tier, and its rings up each side of the tier. */
const LEVELS: readonly (readonly [number, number])[] = [
	[48, 10],
	[24, 5],
	[12, 3],
	[6, 1],
];
/** The tiers of a crown 1 high: base height, radius and height. */
const TIERS = [0.34, 0.27, 0.2, 0.12].map((radius, k) => [0.12 + k * 0.2, radius, 0.5 - k * 0.07]);
/** The needles' linear color, and the share of it that the underside keeps. */
const NEEDLES = [0.05, 0.17, 0.08];
const UNDERSIDE = 0.45;
const TURN = Math.PI * 2;

/** A tier's rim at angle `a`: its clumps, as a share of the tier's radius around 1. */
const clumps = (a: number, tier: number) =>
	1 + 0.14 * Math.sin(5 * a + tier * 1.7) + 0.06 * Math.sin(13 * a + tier);

/**
 * A point of tier `tier`, at `u` around it and `h` up one side: the top from the rim (0) to the
 * tip (1), or the underside from the rim (0) to the trunk (1). Gives x, y, z and the color's shade.
 */
function point(tier: number, top: boolean, u: number, h: number): number[] {
	const [base, radius, height] = TIERS[tier] as number[];
	const a = u * TURN;
	const lobe = clumps(a, tier);
	const droop = 0.4 * height * (lobe - 1) * (1 - h);
	const r = top ? radius * lobe * (1 - h) ** 1.2 * (1 + 0.6 * h) : radius * lobe * (1 - h);
	const y = top ? base + height * h - droop : base - droop * (1 - h) + 0.3 * height * h ** 0.7;
	const shade = top ? 0.6 + 0.4 * h : UNDERSIDE;
	return [Math.cos(a) * r, y, Math.sin(a) * r, shade];
}

type Arrays = { positions: number[]; colors: number[]; indices: number[] };

/** A crown 1 high at the level of `segments` and `rings`, with its vertex colors. */
function crown(segments: number, rings: number) {
	const out: Arrays = { positions: [], colors: [], indices: [] };
	for (let tier = 0; tier < TIERS.length; tier++)
		for (const top of [true, false]) {
			const start = out.positions.length / 3;
			for (let r = 0; r <= rings; r++)
				for (let c = 0; c <= segments; c++) {
					// The underside runs the other way around, so its faces look down.
					const u = top ? c / segments : 1 - c / segments;
					const [x, y, z, shade] = point(tier, top, u, r / rings) as number[];
					out.positions.push(x as number, y as number, z as number);
					out.colors.push(...NEEDLES.map((value) => value * (shade as number)));
					const k = start + r * (segments + 1) + c;
					if (r < rings && c < segments)
						out.indices.push(k, k + segments + 1, k + 1, k + 1, k + segments + 1, k + segments + 2);
				}
		}
	return { ...out, computeNormals: true };
}

/**
 * How far a level strays from the true surface of the widest tier's top, for a crown 1 high: the
 * farthest gap, over a fine sampling, between a true point and the level's flat quad at the same
 * place on the tier. It bounds the gap to the nearest point of the level from above.
 */
function strayOf(segments: number, rings: number): number {
	let most = 0;
	const [U, H] = [360, 40];
	for (let i = 0; i <= U; i++)
		for (let j = 0; j <= H; j++) {
			const [u, h] = [i / U, j / H];
			const [cu, ch] = [
				Math.min(Math.floor(u * segments), segments - 1),
				Math.min(Math.floor(h * rings), rings - 1),
			];
			const [fu, fh] = [u * segments - cu, h * rings - ch];
			const corner = (du: number, dh: number) =>
				point(0, true, (cu + du) / segments, (ch + dh) / rings);
			const [p00, p10, p01, p11] = [corner(0, 0), corner(1, 0), corner(0, 1), corner(1, 1)];
			const truth = point(0, true, u, h);
			let gap = 0;
			for (let axis = 0; axis < 3; axis++) {
				const low = (p00[axis] as number) * (1 - fu) + (p10[axis] as number) * fu;
				const high = (p01[axis] as number) * (1 - fu) + (p11[axis] as number) * fu;
				gap += (low * (1 - fh) + high * fh - (truth[axis] as number)) ** 2;
			}
			most = Math.max(most, Math.sqrt(gap));
		}
	return most;
}

/** A crown 1 high whose base mesh names its three coarser levels, each with its error. */
export function crownWithLevels(geometry: Geometry): MeshGeometry {
	const [full, ...coarser] = LEVELS.map(([segments, rings]) =>
		geometry.fromArrays(crown(segments, rings)),
	);
	const base = full as MeshGeometry;
	base.setLevels(
		coarser.map((mesh, k) => {
			const [segments, rings] = LEVELS[k + 1] as readonly [number, number];
			return { mesh, error: strayOf(segments, rings) };
		}),
	);
	return base;
}
