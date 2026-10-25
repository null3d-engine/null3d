// The scene of three.js's CSS3D molecules example (examples/css3d_molecules.html, r186): caffeine,
// its atoms as billboarded balls and its bonds as turned bars, under a root that turns. The data is
// the example's own PDB file, centred on the atoms' bounding box as the example centres it. The
// example loads any of sixteen molecules from files and tints a white ball image per element; this
// port keeps the example's default molecule and draws the balls in code, so a held picture repeats
// without files.
import { type Quat, quat, type Vec3 } from '@null3d/engine';

/** The example's camera: its lens, and the distance of its place on the z axis. */
export const CAMERA = { fov: 70, near: 1, far: 5000, distance: 1000 };

/** World units per Ångström, which the example multiplies each atom's place by. */
export const ATOM_SCALE = 75;

/** The root's turn at sketch time `time`, in radians: the example's own two rates. */
export const rootTurn = (time: number): [number, number] => [time, time * 0.7];

/** One atom: its element's symbol, its place from the molecule's centre, and its CPK color. */
export interface Atom {
	readonly element: string;
	readonly position: Vec3;
	readonly color: string;
}

/** Caffeine's atoms, in the example's PDB order. */
export const ATOMS: readonly Atom[] = [
	{ element: 'c', position: [-2.06, 1.11, 0], color: '#909090' },
	{ element: 'c', position: [-2.76, -1.3, 0], color: '#909090' },
	{ element: 'c', position: [2.03, 2.48, 0], color: '#909090' },
	{ element: 'c', position: [2.74, -2.31, 0], color: '#909090' },
	{ element: 'o', position: [0.07, -2.56, 0], color: '#ff0d0d' },
	{ element: 'o', position: [3.49, 0.24, 0], color: '#ff0d0d' },
	{ element: 'c', position: [0.49, -1.42, 0], color: '#909090' },
	{ element: 'c', position: [2.29, 0.06, 0], color: '#909090' },
	{ element: 'c', position: [-0.41, -0.33, 0], color: '#909090' },
	{ element: 'c', position: [0.1, 0.95, 0], color: '#909090' },
	{ element: 'n', position: [-0.94, 1.79, 0], color: '#3050f8' },
	{ element: 'n', position: [1.47, 1.13, 0], color: '#3050f8' },
	{ element: 'n', position: [1.81, -1.18, 0], color: '#3050f8' },
	{ element: 'n', position: [-1.78, -0.2, 0], color: '#3050f8' },
	{ element: 'h', position: [-3.05, 1.54, 0], color: '#ffffff' },
	{ element: 'h', position: [-3, -1.57, 1.02], color: '#ffffff' },
	{ element: 'h', position: [-3.66, -0.98, -0.51], color: '#ffffff' },
	{ element: 'h', position: [-2.33, -2.16, -0.51], color: '#ffffff' },
	{ element: 'h', position: [2.17, 2.82, 1.02], color: '#ffffff' },
	{ element: 'h', position: [2.99, 2.48, -0.51], color: '#ffffff' },
	{ element: 'h', position: [1.35, 3.16, -0.51], color: '#ffffff' },
	{ element: 'h', position: [2.97, -2.59, -1.02], color: '#ffffff' },
	{ element: 'h', position: [3.66, -2.02, 0.51], color: '#ffffff' },
	{ element: 'h', position: [2.29, -3.16, 0.51], color: '#ffffff' },
];

/** The example's bonds, as pairs of indices into `ATOMS`. */
export const BONDS: readonly (readonly [number, number])[] = [
	[0, 13],
	[0, 10],
	[0, 14],
	[1, 13],
	[1, 15],
	[1, 16],
	[1, 17],
	[2, 11],
	[2, 18],
	[2, 19],
	[2, 20],
	[3, 12],
	[3, 21],
	[3, 22],
	[3, 23],
	[4, 6],
	[5, 7],
	[6, 8],
	[6, 12],
	[7, 11],
	[7, 12],
	[8, 9],
	[8, 13],
	[9, 11],
	[9, 10],
];

/** A bond's place and turn in the scene, and the length its element takes. */
export interface Bond {
	/** The midpoint of the two atoms, in world units from the molecule's centre. */
	readonly position: Vec3;
	/** The turn that lays the element's y axis along the bond. */
	readonly rotation: Quat;
	/** The element's height in CSS pixels, which are world units. */
	readonly length: number;
}

/**
 * The bond between two atoms, as the example builds it: the element's midpoint, a turn that lays
 * its y axis along the bond, and a height shorter than the atoms' distance by the gap that the
 * example leaves at each ball.
 */
export function bondBetween(from: Vec3, to: Vec3): Bond {
	const dx = to[0] - from[0];
	const dy = to[1] - from[1];
	const dz = to[2] - from[2];
	const distance = Math.hypot(dx, dy, dz);
	const length = distance * ATOM_SCALE - 50;
	const position: Vec3 = [
		((from[0] + to[0]) / 2) * ATOM_SCALE,
		((from[1] + to[1]) / 2) * ATOM_SCALE,
		((from[2] + to[2]) / 2) * ATOM_SCALE,
	];
	// The turn from the y axis to the bond's direction, as the example takes it.
	const y = dy / distance;
	const axis: Vec3 = [dz / distance, 0, -dx / distance];
	const angle = Math.acos(Math.min(1, Math.max(-1, y)));
	const rotation = quat.create();
	const axisLength = Math.hypot(axis[0], axis[1], axis[2]);
	if (axisLength < 1e-9) {
		if (y < 0) quat.setAxisAngle(rotation, [1, 0, 0], Math.PI);
	} else {
		quat.setAxisAngle(rotation, [axis[0] / axisLength, 0, axis[2] / axisLength], angle);
	}
	return { position, rotation, length };
}

/** The bonds of `ATOMS`, in the example's order. */
export const BOND_SHAPES: readonly Bond[] = BONDS.map(([from, to]) =>
	bondBetween(ATOMS[from]?.position as Vec3, ATOMS[to]?.position as Vec3),
);

/** A ball of `color`, as a data URL: the shading of the example's ball image, tinted by the element. */
export function ballImage(color: string): string {
	const canvas = document.createElement('canvas');
	canvas.width = 64;
	canvas.height = 64;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('the page lacks a 2D canvas');
	// A white ball that darkens to its rim, as the example's ball image, lit from the front.
	const shade = context.createRadialGradient(32, 32, 1, 32, 32, 33);
	shade.addColorStop(0, '#ffffff');
	shade.addColorStop(0.5, '#ececec');
	shade.addColorStop(0.85, '#9a9a9a');
	shade.addColorStop(1, '#202020');
	context.fillStyle = shade;
	context.beginPath();
	context.arc(32, 32, 32, 0, Math.PI * 2);
	context.fill();
	// The example tints the white ball with the element's own color.
	context.globalCompositeOperation = 'multiply';
	context.fillStyle = color;
	context.beginPath();
	context.arc(32, 32, 32, 0, Math.PI * 2);
	context.fill();
	context.globalCompositeOperation = 'source-over';
	return canvas.toDataURL();
}

/** The element of an atom: the example's tinted ball image. */
export function atomElement(atom: Atom): HTMLImageElement {
	const image = document.createElement('img');
	image.src = ballImage(atom.color);
	image.alt = atom.element;
	return image;
}

/** The element of a bond: the example's bar, sized to the bond. */
export function bondElement(bond: Bond): HTMLDivElement {
	const element = document.createElement('div');
	element.className = 'bond';
	element.style.height = `${bond.length}px`;
	return element;
}
