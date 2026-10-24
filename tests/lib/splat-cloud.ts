// The splat cloud that the test pages draw: splats through the tube of a (2, 3) torus knot, each
// with a turn and a palette color of its own. The knot crosses itself as its angle and its turn
// differ, so a chunk of the cloud lies in front of another and the depth sort shows.
//
// The page that writes the cloud as a file and the test server that serves a stream of chunks both
// build it here, so their pictures match.

/** The splats' palette, which each splat picks from. */
const PALETTE = ['#ff6b5e', '#ffc44d', '#6ee7a8', '#5bb8ff', '#c58bff', '#ff8ad8'];

/** Linear RGB from an sRGB component, with the engine's constants, so the pictures match. */
function srgbToLinear(component: number): number {
	return component < 0.04045
		? component * 0.0773993808
		: (component * 0.9478672986 + 0.0521327014) ** 2.4;
}

/** The linear color of a `#rrggbb` string, as the engine's color helper gives it. */
function linearOfHex(hex: string): [number, number, number] {
	const value = Number.parseInt(hex.slice(1), 16);
	return [
		srgbToLinear(((value >> 16) & 255) / 255),
		srgbToLinear(((value >> 8) & 255) / 255),
		srgbToLinear((value & 255) / 255),
	];
}

/** A repeatable number from an index and a channel, from 0 to 1, without a random generator. */
function hash(index: number, channel: number): number {
	let x = (index * 374761393 + channel * 668265263) >>> 0;
	x = ((x ^ (x >>> 13)) * 1274126177) >>> 0;
	return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** The point of a (2, 3) torus knot at `t`, lying flat above the ground, and the frame across its tube. */
function knot(t: number): { centre: number[]; across: number[]; along: number[] } {
	const r = Math.cos(3 * t) + 2;
	const centre = [r * Math.cos(2 * t), Math.sin(3 * t), r * Math.sin(2 * t)];
	const tx = -2 * r * Math.sin(2 * t) - 3 * Math.sin(3 * t) * Math.cos(2 * t);
	const ty = 3 * Math.cos(3 * t);
	const tz = 2 * r * Math.cos(2 * t) - 3 * Math.sin(3 * t) * Math.sin(2 * t);
	const length = Math.hypot(tx, ty, tz);
	const tangent = [tx / length, ty / length, tz / length];
	// Cross the tangent with the world's up axis, and keep the result's direction across the tube.
	const up = [0, 1, 0];
	const normal = [
		(tangent[1] as number) * (up[2] as number) - (tangent[2] as number) * (up[1] as number),
		(tangent[2] as number) * (up[0] as number) - (tangent[0] as number) * (up[2] as number),
		(tangent[0] as number) * (up[1] as number) - (tangent[1] as number) * (up[0] as number),
	];
	// A tangent that runs straight up has no direction across it; the world's x axis stands in.
	if (Math.hypot(normal[0] as number, normal[1] as number, normal[2] as number) < 1e-6) {
		normal[0] = 1;
		normal[1] = 0;
		normal[2] = 0;
	}
	const nl = Math.hypot(normal[0] as number, normal[1] as number, normal[2] as number) || 1;
	const n = normal.map((value) => value / nl);
	const binormal = [
		(tangent[1] as number) * (n[2] as number) - (tangent[2] as number) * (n[1] as number),
		(tangent[2] as number) * (n[0] as number) - (tangent[0] as number) * (n[2] as number),
		(tangent[0] as number) * (n[1] as number) - (tangent[1] as number) * (n[0] as number),
	];
	return { centre, across: n, along: binormal };
}

/** A cloud and its arrays, in the form that the splats add-on reads. */
export interface TestCloud {
	count: number;
	positions: Float32Array;
	scales: Float32Array;
	rotations: Float32Array;
	colors: Float32Array;
}

/** The cloud: `count` splats through the tube of a knot, each with a turn of its own. */
export function splatCloud(count: number): TestCloud {
	const positions = new Float32Array(count * 3);
	const scales = new Float32Array(count * 3);
	const rotations = new Float32Array(count * 4);
	const colors = new Float32Array(count * 4);
	const tube = 0.2;
	for (let i = 0; i < count; i++) {
		const t = (i / count) * Math.PI * 2;
		const { centre, across, along } = knot(t);
		const angle = hash(i, 1) * Math.PI * 2;
		const radius = tube * (0.7 + 0.3 * hash(i, 2));
		positions.set(
			[
				(centre[0] as number) +
					radius *
						(Math.cos(angle) * (across[0] as number) + Math.sin(angle) * (along[0] as number)),
				(centre[1] as number) +
					radius *
						(Math.cos(angle) * (across[1] as number) + Math.sin(angle) * (along[1] as number)),
				(centre[2] as number) +
					radius *
						(Math.cos(angle) * (across[2] as number) + Math.sin(angle) * (along[2] as number)),
			],
			i * 3,
		);
		const spread = 0.025 + hash(i, 3) * 0.025;
		scales.set(
			[spread, spread * (0.6 + hash(i, 4) * 0.8), spread * (0.6 + hash(i, 5) * 0.8)],
			i * 3,
		);
		const turn = [hash(i, 6) * 2 - 1, hash(i, 7) * 2 - 1, hash(i, 8) * 2 - 1, hash(i, 9) * 2 - 1];
		const turnLength = Math.hypot(...turn) || 1;
		for (let k = 0; k < 4; k++) rotations[i * 4 + k] = (turn[k] as number) / turnLength;
		const hex = PALETTE[Math.floor(hash(i, 10) * PALETTE.length) % PALETTE.length] as string;
		const linear = linearOfHex(hex);
		colors.set([linear[0], linear[1], linear[2], 0.5 + hash(i, 11) * 0.4], i * 4);
	}
	return { count, positions, scales, rotations, colors };
}
