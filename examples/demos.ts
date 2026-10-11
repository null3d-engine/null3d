// The feature demos. Each demo is a sketch of under 150 lines in a folder of its own, such as
// instances/sketch.ts. The examples page lists the demos by group and runs each one live, and the image test
// manifest draws each one in hold mode at its hold time. Each entry names its sketch with a literal
// `new URL('./<name>/sketch.ts', import.meta.url)`, so a production build of the page ships every
// sketch, under any address prefix.

/** The groups of demos, in the order that a page lists them. */
export const DEMO_GROUPS = [
	'Showcase',
	'Compare with three.js',
	'Building scenes',
	'Light, materials and effects',
	'Motion and interaction',
	'Scale',
	'Testing and tools',
] as const;

/** The group that a demo belongs to. */
export type DemoGroup = (typeof DEMO_GROUPS)[number];

/** A demo in the examples folder. */
export interface Demo {
	/** The demo's folder, which holds its sketch.ts: lowercase words joined by dashes. */
	name: string;
	/** The group that a page lists the demo under. */
	group: DemoGroup;
	/** The address of the demo's sketch module. */
	sketch: URL;
	/**
	 * The demo's code under the examples folder, for a demo that is not one `<name>/sketch.ts`: a
	 * file, or a folder of several files that ends with a slash, such as `showcase/city/`.
	 */
	code?: string;
	/** The feature that the demo shows. */
	title: string;
	/** The scene that shows it, which a page shows after the title, such as "Drone swarm". */
	scene: string;
	/** What the demo shows. */
	summary: string;
	/**
	 * How to interact with the demo. Every demo takes the user's input while it runs: the camera at
	 * any moment, and the pointer where the demo has something to lead.
	 */
	controls: string;
	/** The sketch time, in seconds, that the demo's image test holds at. */
	hold: number;
	/** True for a demo that starts the engine in large-world mode. */
	largeWorld?: boolean;
	/**
	 * True for a demo whose mouse look wants the pointer lock: a click on the canvas asks the
	 * browser for it, and Esc gives the pointer back.
	 */
	pointerLock?: boolean;
	/**
	 * How long the demo's image test may take, in seconds, for a demo that loads large files or
	 * makes the room environment.
	 */
	timeoutSeconds?: number;
	/**
	 * Why the demo loads files. A demo makes its meshes, textures, environments and grading tables
	 * in code, and loads files only when loading them is what it shows.
	 */
	assets?: string;
}

/** How every demo's camera moves: the first sentence of most demos' controls. */
const CAMERA =
	'Drag to turn the camera, scroll or pinch to zoom, and right-drag or drag two fingers to pan.';

export const DEMOS: readonly Demo[] = [
	{
		name: 'generators',
		group: 'Building scenes',
		sketch: new URL('./generators/sketch.ts', import.meta.url),
		title: 'Geometry generators',
		scene: 'Shape gallery',
		summary:
			'The nine shapes that geometry makes, from a box to a ring, with the parameters of three.js geometry classes, in metal, plastic and a tile texture made in code.',
		controls: `${CAMERA} Move the mouse, or tap, and the shapes turn toward it.`,
		hold: 1,
		timeoutSeconds: 60,
	},
	{
		name: 'mesh-arrays',
		group: 'Building scenes',
		sketch: new URL('./mesh-arrays/sketch.ts', import.meta.url),
		title: 'Meshes from arrays',
		scene: 'Crystal island',
		summary:
			'An island and a crystal made with geometry.fromArrays. The engine computes their normals: smooth where triangles share vertices, and hard edges where they do not. Each vertex of the island has a color of its own, and a reflection pass mirrors the island in the water.',
		controls: `${CAMERA} Move the mouse, or tap, to lead the crystal over the hills.`,
		hold: 1,
		timeoutSeconds: 60,
	},
	{
		name: 'objects',
		group: 'Building scenes',
		sketch: new URL('./objects/sketch.ts', import.meta.url),
		title: 'Objects and parents',
		scene: 'Turntable stage',
		summary:
			'Crates of six materials ride a turntable on a studio stage and step off in turn. setParent with keepWorld moves each crate between the table and the stage without moving it in the world.',
		controls: CAMERA,
		hold: 2.5,
		timeoutSeconds: 60,
	},
	{
		name: 'layers',
		group: 'Building scenes',
		sketch: new URL('./layers/sketch.ts', import.meta.url),
		title: 'Render layers',
		scene: 'Cottage street',
		summary:
			'A street of brick cottages in the late afternoon sun, with roofs and map pins on layers of their own. Every 2 seconds the camera draws another set of layers.',
		controls: CAMERA,
		hold: 5,
		timeoutSeconds: 60,
	},
	{
		name: 'environment',
		group: 'Light, materials and effects',
		sketch: new URL('./environment/sketch.ts', import.meta.url),
		title: 'Environment light',
		scene: 'Sphere gallery',
		summary:
			'Plastic and metal spheres, from rough to smooth, over a polished floor that reflects them, lit only by an environment. Every 4 seconds it changes: a sunset from an HDR file, a studio from an EXR file, then the light of the generated sky.',
		assets: 'Shows how environment maps load from Radiance HDR and OpenEXR files.',
		controls: CAMERA,
		hold: 1,
		timeoutSeconds: 60,
	},
	{
		name: 'time-of-day',
		group: 'Light, materials and effects',
		sketch: new URL('./time-of-day/sketch.ts', import.meta.url),
		title: 'Time of day',
		scene: 'Lighthouse point',
		summary:
			"A day passes over a lighthouse in 40 seconds. timeOfDay gives each hour's sky, sun or moon, fog and exposure, and the sky's light follows the sun. At dusk the windows light up and the lighthouse beams sweep the sea.",
		controls: `${CAMERA} Move the mouse across the scene, or tap, to pick the hour: left is morning, right is evening.`,
		hold: 6,
		timeoutSeconds: 60,
	},
	{
		name: 'camera-lens',
		group: 'Light, materials and effects',
		sketch: new URL('./camera-lens/sketch.ts', import.meta.url),
		title: 'Depth of field and focal length',
		scene: 'Chess endgame',
		summary:
			'A low shot across a chess board. The focus racks from a near pawn to the far king, and a dolly zoom takes the lens from 35 to 85 mm, so the string lights behind swell into wide discs of light.',
		controls: `${CAMERA} Point at a piece, or tap it, to focus on it.`,
		hold: 3,
		timeoutSeconds: 60,
	},
	{
		name: 'wet-street',
		group: 'Light, materials and effects',
		sketch: new URL('./wet-street/sketch.ts', import.meta.url),
		title: 'Screen-space reflections',
		scene: 'Wet street at night',
		summary:
			'A street after the rain, whose puddles mirror the lit windows, the neon signs and the street lamps, while the dry asphalt between them stays matte. Wet curbs and chrome bollards shine too.',
		controls: `${CAMERA} Move the mouse over the street, or tap it, to move the taxi's headlights.`,
		hold: 3,
		timeoutSeconds: 60,
	},
	{
		name: 'gltf-model',
		group: 'Light, materials and effects',
		sketch: new URL('./gltf-model/sketch.ts', import.meta.url),
		title: 'glTF models',
		scene: 'Studio turntable',
		summary:
			'The Khronos BoomBox, loaded with assets.loadGltf, on a turntable with a polished top in a dark studio, lit by a key light and the built-in room environment, with depth of field. Its base color, normal, occlusion, roughness, metalness and emissive maps all come from the file.',
		assets: "Shows how a glTF model's meshes, materials and texture maps load from a file.",
		controls: CAMERA,
		hold: 2,
		timeoutSeconds: 60,
	},
	{
		name: 'post-effects',
		group: 'Light, materials and effects',
		sketch: new URL('./post-effects/sketch.ts', import.meta.url),
		title: 'Post effects',
		scene: 'Neon alley',
		summary:
			'Crates in a neon alley at night on wet ground, with bloom, ambient occlusion, an outline, depth of field, a vignette and a custom lens effect. Every 3 seconds the color grading table changes: none, warm, then cool.',
		controls: `${CAMERA} Move the mouse, or tap, to move the pink lamp.`,
		hold: 4,
	},
	{
		name: 'sprites-lines',
		group: 'Light, materials and effects',
		sketch: new URL('./sprites-lines/sketch.ts', import.meta.url),
		title: 'Sprites and lines',
		scene: 'Spark fountain',
		summary:
			'A fountain of 2,000 glowing sparks in one sprite batch at nightfall, a neon helix of wide lines in world units, and dashes that run around the rim of a pool that reflects them all.',
		controls: `${CAMERA} Move the mouse, or tap, to move the fountain.`,
		hold: 2,
		timeoutSeconds: 60,
	},
	{
		name: 'security-camera',
		group: 'Light, materials and effects',
		sketch: new URL('./security-camera/sketch.ts', import.meta.url),
		title: 'Render to texture',
		scene: 'Security camera',
		summary:
			'At nightfall, a camera on a pole sweeps a wet yard behind a wall under a floodlight. A scene pass draws its view into a texture, and a monitor on the near side of the wall shows the robot that patrols there, as a night camera with scan lines.',
		controls: `${CAMERA} Move the mouse, or tap, to aim the security camera.`,
		hold: 2,
		timeoutSeconds: 60,
	},
	{
		name: 'character',
		group: 'Motion and interaction',
		sketch: new URL('./character/sketch.ts', import.meta.url),
		title: 'Animated characters',
		scene: 'Knight in a courtyard',
		summary:
			'The KayKit Knight walks a circle in a cobbled courtyard at a speed that rises and falls. A blend mixes its idle, walk and run clips by speed, and an upper-body layer swings its sword every 4 seconds.',
		assets: 'Shows how a skinned character and its animation clips load from a glTF file.',
		controls: `${CAMERA} Move the mouse, or tap, to lead the Knight.`,
		hold: 4.5,
		timeoutSeconds: 60,
	},
	{
		name: 'input',
		group: 'Motion and interaction',
		sketch: new URL('./input/sketch.ts', import.meta.url),
		title: 'Input and actions',
		scene: 'Walking robot',
		summary:
			'An action map moves a small robot with the keyboard or a gamepad. Its legs and arms swing on joints as it walks, and the camera follows it.',
		controls:
			'Move with WASD, the arrow keys or the left stick. Jump with Space or A, and change color with E or X. Drag or use the right stick to turn the camera, scroll or pinch to zoom, and right-drag or drag two fingers to pan.',
		hold: 0,
		timeoutSeconds: 60,
	},
	{
		name: 'walk-and-fly',
		group: 'Motion and interaction',
		sketch: new URL('./walk-and-fly/sketch.ts', import.meta.url),
		title: 'First-person and fly controls',
		scene: 'Temple ruins',
		summary:
			'A walk through a ruined temple at golden hour. First-person controls walk and look, the pointer lock turns the view with the mouse as in a game, and fly controls soar over the columns.',
		controls:
			'Walk with WASD or the arrow keys, and drag to look. Click to lock the pointer, so the mouse looks, and press Esc to free it. Press Space to fly: W and S move along the view, Q and E roll, R and F rise and sink. On a touch screen, drag one finger to look and walk.',
		hold: 3,
		timeoutSeconds: 60,
		pointerLock: true,
	},
	{
		name: 'morph-flowers',
		group: 'Motion and interaction',
		sketch: new URL('./morph-flowers/sketch.ts', import.meta.url),
		title: 'Morph targets',
		scene: 'Tulip bed',
		summary:
			'A bed of tulips made in code opens in a wave in the morning sun. Each head has one morph target that moves its petals, turns their normals and changes their color, and each tulip has a weight of its own.',
		controls: `${CAMERA} Move the mouse, or tap, and the tulips near it open.`,
		hold: 3,
		timeoutSeconds: 60,
	},
	{
		name: 'picking',
		group: 'Motion and interaction',
		sketch: new URL('./picking/sketch.ts', import.meta.url),
		title: 'Picking and labels',
		scene: 'Gallery plinth',
		summary:
			'Six polished pieces turn on pedestals on a plinth in a dark gallery under spotlights, each with an HTML label that follows it. The pointer lights up the piece under it, and a click outlines it and marks the point that the ray hit.',
		controls: `Point at a shape to light it up, and click or tap it to select it. ${CAMERA}`,
		hold: 2,
		timeoutSeconds: 60,
	},
	{
		name: 'math',
		group: 'Motion and interaction',
		sketch: new URL('./math/sketch.ts', import.meta.url),
		title: 'Vector and quaternion math',
		scene: 'Drone swarm',
		summary:
			'A flock of 300 drones, each with its own light, chases a lamp over a landing pad at dusk, each at its own lag and speed. vec3 and quat helpers place, turn and bank each drone from the time, with no allocation.',
		controls: `${CAMERA} Move the mouse, or tap, to lead the lamp.`,
		hold: 8,
		timeoutSeconds: 60,
	},
	{
		name: 'galaxy',
		group: 'Scale',
		sketch: new URL('./galaxy/sketch.ts', import.meta.url),
		title: 'Points',
		scene: 'Spiral galaxy',
		summary:
			'A spiral galaxy of 120,000 stars in one points batch, and 30,000 on phones. Each star is a soft point with a color of its own, the light adds up into a glowing core, and each ring of stars turns at its own speed, so the arms swirl.',
		controls: CAMERA,
		hold: 4,
	},
	{
		name: 'instances',
		group: 'Scale',
		sketch: new URL('./instances/sketch.ts', import.meta.url),
		title: 'Instancing',
		scene: '100,000 columns',
		summary:
			'100,000 columns in one batch at golden hour, and 10,000 on phones. Each frame the sketch writes the height of every row into the batch arrays, with no call per row.',
		controls: `${CAMERA} Move the mouse, or tap, to move the center of the wave.`,
		hold: 2,
		timeoutSeconds: 60,
	},
	{
		name: 'far-from-origin',
		group: 'Scale',
		sketch: new URL('./far-from-origin/sketch.ts', import.meta.url),
		title: 'Far from the origin',
		scene: 'Keys and brass wheel',
		summary:
			"A tray of 2 cm keys and a spinning brass wheel on a desk, 1,000 km from the origin, seen from 40 cm. Grid cells keep every position precise to a fraction of a millimeter, and a label gives the camera's distance from the origin.",
		controls: CAMERA,
		hold: 2,
		timeoutSeconds: 60,
	},
	{
		name: 'large-world',
		group: 'Scale',
		sketch: new URL('./large-world/sketch.ts', import.meta.url),
		title: 'Large worlds',
		scene: 'Road at golden hour',
		summary:
			"A drive along a road on the Earth's surface at golden hour, 6,378 km from the origin, lit by the sky, with hills that fade into the fog. Large-world mode keeps the 15 cm lane marks sharp and the camera smooth.",
		controls: CAMERA,
		hold: 3,
		largeWorld: true,
		timeoutSeconds: 60,
	},
	{
		name: 'hold-mode',
		group: 'Testing and tools',
		sketch: new URL('./hold-mode/sketch.ts', import.meta.url),
		title: 'Repeatable frames',
		scene: 'Bouncing balls',
		summary:
			'400 glossy balls drop from random places into a pen and bounce. Each live run differs, and the held frame is the same on every run.',
		controls: `${CAMERA} Move the mouse, or tap, to bring up a paddle that kicks the balls up.`,
		hold: 3,
		timeoutSeconds: 60,
	},
];
