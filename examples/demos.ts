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
	/** True for a demo that starts the engine in large-world mode. */
	largeWorld?: boolean;
	/** How long the demo's image test may take, in seconds, for a demo that loads large files. */
	timeoutSeconds?: number;
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
		name: 'objects',
		title: 'Objects and parents',
		summary:
			'Crates ride a turntable and step off in turn. setParent with keepWorld moves each crate between the table and the ground without moving it in the world.',
		hold: 2.5,
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
	{
		name: 'gltf-model',
		title: 'A glTF model',
		summary:
			'The Khronos BoomBox, loaded with assets.loadGltf and lit by the built-in room environment. Its base color, normal, occlusion, roughness, metalness and emissive maps all come from the file.',
		controls: 'Drag to turn the camera, and scroll or pinch to zoom.',
		hold: 2,
		timeoutSeconds: 60,
	},
	{
		name: 'character',
		title: 'An animated character',
		summary:
			'The KayKit Knight walks a circle at a speed that rises and falls. A blend mixes its idle, walk and run clips by speed, and an upper-body layer swings its sword every 4 seconds.',
		controls: 'Drag to turn the camera, and scroll or pinch to zoom.',
		hold: 4.5,
		timeoutSeconds: 60,
	},
	{
		name: 'picking',
		title: 'Picking with labels',
		summary:
			'Six shapes turn on a table, each with an HTML label that follows it. The pointer lights up the shape under it, and a click outlines it and marks the point that the ray hit.',
		controls: 'Point at a shape to light it up, and click or tap it to select it.',
		hold: 2,
	},
	{
		name: 'environment',
		title: 'Environment light',
		summary:
			'Plastic and metal spheres, from rough to smooth, lit only by an environment. Every 4 seconds it changes: a sunset from an HDR file, a studio from an EXR file, then the built-in room.',
		controls: 'Drag to turn the camera, and scroll or pinch to zoom.',
		hold: 1,
		timeoutSeconds: 60,
	},
	{
		name: 'post-effects',
		title: 'Post effects',
		summary:
			'Crates under neon lights, with bloom, ambient occlusion, an outline, a vignette and a custom lens effect. Every 3 seconds the color grading table changes: none, warm, then cool.',
		hold: 4,
	},
	{
		name: 'security-camera',
		title: 'A security camera',
		summary:
			'A camera on a pole sweeps a yard behind a wall. A scene pass draws its view into a texture, and a monitor on the near side of the wall shows the robot that patrols there.',
		controls: 'Drag to turn the camera, and scroll or pinch to zoom.',
		hold: 2,
	},
	{
		name: 'sprites-lines',
		title: 'Sprites and lines',
		summary:
			'A fountain of 2,000 sparks in one sprite batch, a lit helix of wide lines in world units, and dashes that run around a ring.',
		hold: 2,
	},
	{
		name: 'large-world',
		title: 'A large world',
		summary:
			"A drive along a road on the Earth's surface, 6,378 km from the origin, under a sky with fog. Large-world mode keeps the 15 cm lane marks sharp and the camera smooth.",
		hold: 3,
		largeWorld: true,
	},
];
