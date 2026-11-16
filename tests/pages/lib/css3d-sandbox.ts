// The scene of three.js's CSS3D sandbox example (examples/css3d_sandbox.html, r186): ten square
// elements at random places, turns and scales, each with a wireframe plane drawn over it by WebGL,
// so the element and the plane must coincide. The example picks every value with `Math.random()`,
// which a held picture cannot repeat; this port takes all of them from an integer hash of the
// element's place, so the null3D sketch and three.js's twin draw the same ten squares.
import { type Quat, quat, type Vec3 } from '@null3d/engine';
import { unit } from './css3d-shared';

/** The example's camera: its lens and place. */
export const CAMERA = { fov: 45, near: 1, far: 1000, position: [200, 200, 200] as Vec3 };

/** The squares' number, as the example counts them. */
export const SQUARES = 10;

/** The size of a square, in CSS pixels, which are the scene's units here. */
export const SIZE = 100;

/** One square: its place, turn and scale in the scene, and how its element looks. */
export interface Square {
	readonly position: Vec3;
	readonly rotation: Quat;
	readonly scale: Vec3;
	readonly color: string;
	readonly opacity: number;
}

/** The ten squares, with every scattered value from the hash of the square's place. */
export const SQUARES_LAYOUT: readonly Square[] = Array.from(
	{ length: SQUARES },
	(_unused, index): Square => {
		const turn: Vec3 = [unit(index, 13), unit(index, 14), unit(index, 15)];
		return {
			position: [
				unit(index, 10) * 200 - 100,
				unit(index, 11) * 200 - 100,
				unit(index, 12) * 200 - 100,
			],
			rotation: quat.fromEuler(quat.create(), turn[0], turn[1], turn[2]),
			// The example scales the square in its own plane, and leaves the depth at one.
			scale: [unit(index, 16) + 0.5, unit(index, 17) + 0.5, 1],
			color: `#${Math.floor(unit(index, 18) * 0xffffff)
				.toString(16)
				.padStart(6, '0')}`,
			// The example's first five squares are half see-through.
			opacity: index < 5 ? 0.5 : 1,
		};
	},
);

/** The element of a square: the example's plain div, sized and coloured. */
export function squareElement(square: Square): HTMLDivElement {
	const element = document.createElement('div');
	element.className = 'square';
	element.style.backgroundColor = square.color;
	element.style.opacity = String(square.opacity);
	return element;
}
