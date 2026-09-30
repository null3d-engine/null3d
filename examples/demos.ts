// The feature demos. Each demo is a sketch of under 150 lines in a folder of its own, such as
// instances/sketch.ts. The examples page lists the demos and runs each one live, and the image test
// manifest draws each one in hold mode at its hold time.

/** A demo in the examples folder. */
export interface Demo {
	/** The demo's folder, which holds its sketch.ts: lowercase words joined by dashes. */
	name: string;
	title: string;
	/** What the demo shows. */
	summary: string;
	/** How to steer the demo, for a demo that takes input. */
	controls?: string;
	/** The sketch time, in seconds, that the demo's image test holds at. */
	hold: number;
}

export const DEMOS: readonly Demo[] = [
	{
		name: 'instances',
		title: 'Instance batches',
		summary:
			'10,000 boxes in one batch. Each frame the sketch writes every row into the batch arrays, with no call per row.',
		hold: 2,
	},
	{
		name: 'mesh-arrays',
		title: 'Meshes from arrays',
		summary:
			'A height field and a crystal made with geometry.fromArrays. The engine computes their normals: smooth where triangles share vertices, and hard edges where they do not.',
		hold: 1,
	},
	{
		name: 'generators',
		title: 'Geometry generators',
		summary:
			'The nine shapes that geometry makes, from a box to a ring, with the parameters of three.js geometry classes.',
		hold: 1,
	},
	{
		name: 'math',
		title: 'Math helpers',
		summary:
			'300 drones chase a moving light. vec3 and quat helpers ease and turn each drone with no allocation, and a seeded math.random places them.',
		hold: 8,
	},
	{
		name: 'input',
		title: 'Input and actions',
		summary: 'An action map moves a box with the keyboard or a gamepad. The camera follows it.',
		controls:
			'Move with WASD, the arrow keys or the left stick. Jump with Space or A, and change color with E or X. Drag to turn the camera, and scroll or pinch to zoom.',
		hold: 0,
	},
	{
		name: 'far-from-origin',
		title: 'Far from the origin',
		summary:
			'A tray of 2 cm keys and a spinning wheel 1,000 km from the origin, seen from 40 cm. Grid cells keep every position precise to a fraction of a millimeter.',
		hold: 2,
	},
	{
		name: 'layers',
		title: 'Render layers',
		summary:
			'A street of houses with roofs and map pins on layers of their own. Every 2 seconds the camera draws another set of layers.',
		hold: 5,
	},
	{
		name: 'hold-mode',
		title: 'Hold mode',
		summary:
			'400 balls drop from random places and bounce. Each live run differs, and the held frame is the same on every run.',
		hold: 3,
	},
];
