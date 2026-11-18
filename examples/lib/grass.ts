// A tuft of grass made in code, for any demo: thin blades that lean out from the middle and taper
// to a point. The parts take the shared generator's four levels of detail (meshOf in ./trees.ts),
// and the shared sway material bends each blade along its length.
import { math } from '@null3d/engine';
import { lean, type Part, smooth, TURN } from './trees';

/**
 * A tuft of grass 1 high, rooted at the origin. Each blade is dark at its foot and green along its
 * length, and some dry to straw at the tip. The blades carry their own colors, so a material that
 * reads the vertex colors needs no texture.
 *
 * @param blades The blades in the tuft.
 * @param seed The seed that places the blades.
 * @returns The tuft's parts, for meshOf.
 */
export function grassParts(blades = 11, seed = 17): Part[] {
	math.seed(seed);
	return Array.from({ length: blades }, (_, k): Part => {
		const a = (k / blades) * TURN + math.randFloat(-0.3, 0.3);
		const [foot, tall, out, wide] = [
			math.randFloat(0, 0.07),
			math.randFloat(0.6, 1),
			math.randFloat(0.12, 0.5),
			math.randFloat(0.022, 0.034),
		];
		const twist = math.randFloat(-0.6, 0.6);
		const dry = math.random() < 0.3 ? math.randFloat(0.4, 1) : 0;
		const [sx, sz] = [-Math.sin(a + twist), Math.cos(a + twist)];
		return {
			at: (u, v) => {
				const reach = foot + out * v ** 1.7;
				const y = tall * v * (1 - 0.25 * out * v * v);
				const side = (u - 0.5) * wide * (1 - v) ** 0.9;
				const green = 0.15 + 0.85 * smooth(0, 0.35, v);
				const straw = dry * smooth(0.45, 1, v);
				const color = [
					(0.11 + 0.1 * v) * green * (1 - straw) + 0.46 * straw,
					(0.2 + 0.12 * v) * green * (1 - straw) + 0.4 * straw,
					0.045 * green * (1 - straw) + 0.14 * straw,
				];
				const [x, z] = [Math.cos(a) * reach + sx * side, Math.sin(a) * reach + sz * side];
				return [x, y, z, ...lean(a, 0.8 + 1.5 * v), u, v, ...color];
			},
			grids: [
				[1, 4],
				[1, 3],
				[1, 2],
				[1, 1],
			],
		};
	});
}
