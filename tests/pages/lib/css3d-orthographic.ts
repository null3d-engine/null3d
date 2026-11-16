// The scene of three.js's CSS3D orthographic example (examples/css3d_orthographic.html, r186): four
// coloured planes around a point, each with a wireframe plane drawn over it by WebGL, seen through a
// camera whose view has no perspective. The example sizes that view at 500 world units tall and
// lets its width follow the window's aspect, which a held stage fixes.
import { type Quat, quat, type Vec3 } from '@null3d/engine';

/** The example's camera: its lens and place. */
export const CAMERA = {
	frustum: 500,
	near: 1,
	far: 1000,
	position: [-200, 200, 200] as Vec3,
};

/** One plane: its size, colour, place and turn. */
export interface Plate {
	readonly width: number;
	readonly height: number;
	readonly color: string;
	readonly position: Vec3;
	readonly rotation: Quat;
}

/** The example's four planes: left, right, top and bottom. */
export const PLATES: readonly Plate[] = [
	{
		width: 100,
		height: 100,
		color: 'chocolate',
		position: [-50, 0, 0],
		rotation: quat.fromEuler(quat.create(), 0, -Math.PI / 2, 0),
	},
	{
		width: 100,
		height: 100,
		color: 'saddlebrown',
		position: [0, 0, 50],
		rotation: quat.create(),
	},
	{
		width: 100,
		height: 100,
		color: 'yellowgreen',
		position: [0, 50, 0],
		rotation: quat.fromEuler(quat.create(), -Math.PI / 2, 0, 0),
	},
	{
		width: 300,
		height: 300,
		color: 'seagreen',
		position: [0, -50, 0],
		rotation: quat.fromEuler(quat.create(), -Math.PI / 2, 0, 0),
	},
];

/** The element of a plane: the example's plain div, sized and coloured, three quarters opaque. */
export function plateElement(plate: Plate): HTMLDivElement {
	const element = document.createElement('div');
	element.style.width = `${plate.width}px`;
	element.style.height = `${plate.height}px`;
	element.style.opacity = '0.75';
	element.style.backgroundColor = plate.color;
	return element;
}
