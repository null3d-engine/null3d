// The demos. Each feature demo is a sketch of under 150 lines in a folder of its own, such as
// instances/sketch.ts. A showcase scene has no line limit, and its folder, such as
// showcase/creek/, holds its sketch.ts and the modules that it imports. The examples page lists the demos by group and runs each one live, and the image test
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
	/**
	 * Choices that the page offers as buttons, such as a time of day. The page sends each pick to the
	 * sketch as a message named by the choice, with the option's text as its value.
	 */
	choices?: readonly DemoChoice[];
}

/** A choice that a page offers for a demo: one button for each option. */
export interface DemoChoice {
	/** The name of the message that the page sends to the sketch. */
	name: string;
	/** The choice's label, such as "Time of day". */
	label: string;
	/** The options, as the buttons show them. The first is the sketch's own at its start. */
	options: readonly string[];
}

/** The demo's sketch module, from the examples folder. */
export const sketchPath = (demo: Demo) =>
	demo.code?.endsWith('/') ? `${demo.code}sketch.ts` : `${demo.name}/sketch.ts`;

export const DEMOS: readonly Demo[] = [
	{
		name: 'creek',
		group: 'Showcase',
		sketch: new URL('./showcase/creek/sketch.ts', import.meta.url),
		code: 'showcase/creek/',
		title: 'Creek',
		scene: 'A stream in a grassy valley',
		summary:
			'Clear water over a stony bed, which mirrors the banks and shows the stones under it, with dense swaying grass, mossy rocks and leaves that float on the current, under the sky of the time of day. Trees, ferns and a cave mouth stand on the banks.',
		assets:
			'Shows organic models loaded from files: its trees, plants and cave mouth are built by script in Blender and optimized by the asset tool. The land, water, grass and rocks are made in code.',
		hold: 0.5,
		timeoutSeconds: 60,
	},
	{
		name: 'night-town',
		group: 'Showcase',
		sketch: new URL('./showcase/night-town/sketch.ts', import.meta.url),
		code: 'showcase/night-town/',
		title: 'Night town',
		scene: 'A snowy town square under the moon',
		summary:
			'Timber houses with lit windows around a cobbled square on a snowy night, with a stone clock tower, iron lamps that throw warm light, a well, market stalls, snow pines and bare trees strung with fairy lights, falling snow and smoke from the chimneys.',
		hold: 0.5,
		timeoutSeconds: 60,
	},
	{
		name: 'generators',
		group: 'Building scenes',
		sketch: new URL('./generators/sketch.ts', import.meta.url),
		title: 'Geometry generators',
		scene: 'Shape gallery',
		summary:
			'The nine shapes that geometry makes, from a box to a ring, with the parameters of three.js geometry classes, in metal, plastic and a tile texture made in code.',
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
		hold: 1,
		timeoutSeconds: 60,
	},
	{
		name: 'extra-shapes',
		group: 'Building scenes',
		sketch: new URL('./extra-shapes/sketch.ts', import.meta.url),
		title: 'Extra shapes',
		scene: 'Mirror floor at dusk',
		summary:
			'A torus knot, polyhedra, a lathe, an extruded star, a tube and a flat heart from @null3d/geometry, with the parameters of three.js geometry classes, in glass, metals and glazed clay over a polished stone floor.',
		hold: 1,
		timeoutSeconds: 60,
	},
	{
		name: 'vertex-updates',
		group: 'Building scenes',
		sketch: new URL('./vertex-updates/sketch.ts', import.meta.url),
		title: 'Vertex updates',
		scene: 'Pool at golden hour',
		summary:
			"A glowing float leaves rings on a pool. Each frame the sketch rewrites the water's positions and normals and passes them to mesh.updateVertices, which allocates nothing.",
		hold: 2.5,
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
		hold: 1,
		timeoutSeconds: 60,
	},
	{
		name: 'coat-and-sheen',
		group: 'Light, materials and effects',
		sketch: new URL('./coat-and-sheen/sketch.ts', import.meta.url),
		code: 'coat-and-sheen/',
		title: 'Clear coat and sheen',
		scene: 'Rainy showroom',
		summary:
			'A car built in code, its paint with metal flakes under a mirror-smooth clear coat, on a varnished plinth. Rain falls on wet cobbles whose puddles are a clear coat with rain rings, and velvet glows at its edges with sheen.',
		hold: 1,
		timeoutSeconds: 120,
	},
	{
		name: 'shader-inputs',
		group: 'Light, materials and effects',
		sketch: new URL('./shader-inputs/sketch.ts', import.meta.url),
		code: 'shader-inputs/',
		title: 'Custom shader inputs',
		scene: 'Crystal spiral',
		summary:
			"900 crystals in one batch take their color and their place in a wave from their row, which a custom material reads as input.instance. Three stones share one material, whose bands follow each stone's own axis through object.worldMatrix, and the picked stone lights up by object.id.",
		hold: 1,
		timeoutSeconds: 60,
	},
	{
		name: 'weighted-transparency',
		group: 'Light, materials and effects',
		sketch: new URL('./weighted-transparency/sketch.ts', import.meta.url),
		code: 'weighted-transparency/',
		title: 'Weighted transparency',
		scene: 'Glass pavilion',
		summary:
			"Eight panes of stained glass that cross each other, and 600 puffs of smoke from a brazier, blend in any order with the weighted blending, as three.js's OITPassNode blends them. Sorting by object cannot order them, so with normal blending they pop as the camera turns.",
		hold: 2,
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
		hold: 6,
		timeoutSeconds: 60,
	},
	{
		name: 'decals',
		group: 'Light, materials and effects',
		sketch: new URL('./decals/sketch.ts', import.meta.url),
		code: 'decals/',
		title: 'Projected decals',
		scene: 'Evening street',
		summary:
			'Road paint, a zebra crossing, puddles, cracks, moss, mud and a scorch mark on a street at dusk, with bare bricks, posters, graffiti and stains on the house fronts, each a box that projects its maps onto the surfaces inside it, lit by the low sun and the street lamps. A walker on a layer of its own crosses the puddles clean.',
		hold: 2,
		timeoutSeconds: 60,
	},
	{
		name: 'atmosphere',
		group: 'Light, materials and effects',
		sketch: new URL('./atmosphere/sketch.ts', import.meta.url),
		code: 'atmosphere/',
		title: 'Atmosphere',
		scene: 'Valley of ridges',
		summary:
			'A day passes over a valley in a minute, under the physical sky. The air turns the sky gold and rose at sunset and hazes each ridge by its distance. At night the moon lights the air and the stars come out.',
		hold: 2,
		timeoutSeconds: 60,
	},
	{
		name: 'contact-shadows',
		group: 'Light, materials and effects',
		sketch: new URL('./contact-shadows/sketch.ts', import.meta.url),
		code: 'contact-shadows/',
		title: 'Contact shadows',
		scene: 'Stone garden',
		summary:
			'A stone garden in the low evening sun, made in code: raked sand, mossy granite rocks, 640 pebbles and moss clumps in one batch, tufts of grass, a stone lantern, and a plaster wall with bamboo and pines beyond it. Contact shadows give each pebble, blade and stone the dark line where it meets the sand, which the shadow map is too coarse to hold. Every 3 seconds they turn off and on again.',
		hold: 1,
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
		hold: 3,
		timeoutSeconds: 60,
	},
	{
		name: 'auto-exposure',
		group: 'Light, materials and effects',
		sketch: new URL('./auto-exposure/sketch.ts', import.meta.url),
		code: 'auto-exposure/',
		title: 'Automatic exposure',
		scene: 'Courtyard and hall',
		summary:
			'A walk from a sunny courtyard into a dark stone hall and back. The hall starts almost black, then the eye opens and its lamps and golden sphere come out of the dark. Turned toward the door, the courtyard blazes white until the eye closes again, faster, as eyes do.',
		hold: 6,
	},
	{
		name: 'light-shafts',
		group: 'Light, materials and effects',
		sketch: new URL('./light-shafts/sketch.ts', import.meta.url),
		code: 'light-shafts/',
		title: 'Light shafts and lit fog',
		scene: 'Pine wood at sunset',
		summary:
			"A path through a pine wood in haze. The volumetric fog takes the light of the low sun between the trunks, so rays fall through the gaps and the trunks' shadows cut dark lanes. At dusk the lanterns light up, and each casts a glowing cone into the fog.",
		hold: 2,
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
		hold: 2,
		timeoutSeconds: 60,
	},
	{
		name: 'particles',
		group: 'Light, materials and effects',
		sketch: new URL('./particles/sketch.ts', import.meta.url),
		code: 'particles/',
		title: 'Particles',
		scene: 'Campfire glade',
		summary:
			'A campfire in an autumn glade at dusk: flames from a flipbook made in code, rising embers, thin smoke lit from below, leaves that tumble from a birch and settle, and blinking fireflies. The GPU moves every particle, and the sketch writes only the births.',
		hold: 4,
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
		hold: 2,
		timeoutSeconds: 60,
	},
	{
		name: 'area-lights',
		group: 'Light, materials and effects',
		sketch: new URL('./area-lights/sketch.ts', import.meta.url),
		code: 'area-lights/',
		title: 'Area lights',
		scene: 'Neon street after rain',
		summary:
			"Shop windows are rectangle lights and a neon sign is made of tube lights. The wet street shows each light's whole shape, stretched toward the camera, where a point light would leave a dot.",
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
		hold: 4.5,
		timeoutSeconds: 60,
	},
	{
		name: 'look-at',
		group: 'Motion and interaction',
		sketch: new URL('./look-at/sketch.ts', import.meta.url),
		title: 'Joint overrides',
		scene: 'Knights watch a wisp',
		summary:
			'Seven KayKit Knights stand in a ring in a castle courtyard at dusk and watch a wisp of light. Each plays its own idle clip, and a look-at turns its spine, chest and head toward the wisp on top of the clip, each joint within its limit.',
		assets:
			'Shows joint overrides on a skinned character and its clips, which load from a glTF file.',
		hold: 3,
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
		hold: 8,
		timeoutSeconds: 60,
	},
	{
		name: 'terrain',
		group: 'Scale',
		sketch: new URL('./terrain/sketch.ts', import.meta.url),
		code: 'terrain/',
		title: 'Terrain',
		scene: 'Golden valley',
		summary:
			'A 1.2 km valley from the terrain add-on. The ground near the camera draws at about a meter of detail and the far hills draw coarser blocks, each with a skirt that hides the seam. Grass, soil, rock and snow blend by a splat map filled from the height and the slope, and boulders made in code stand on the ground.',
		hold: 3,
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
		hold: 2,
		timeoutSeconds: 60,
	},
	{
		name: 'forest',
		group: 'Scale',
		sketch: new URL('./forest/sketch.ts', import.meta.url),
		code: 'forest/',
		title: 'Levels of detail',
		scene: 'Mixed forest',
		summary:
			'56,000 trees of four kinds over rolling hills at golden hour, and 8,000 on phones. Three firs and a broadleaf tree are made in code at four levels of detail, and an understory of bushes covers the ground between the trunks. Each tree picks its own level in every frame by its size on the screen, and the levels share the pixels through a dither at a switch. On phones the nearest trees draw in full and the rest as cut-out cards.',
		hold: 2,
		timeoutSeconds: 300,
	},
	{
		name: 'far-from-origin',
		group: 'Scale',
		sketch: new URL('./far-from-origin/sketch.ts', import.meta.url),
		title: 'Far from the origin',
		scene: 'Keys and brass wheel',
		summary:
			"A tray of 2 cm keys and a spinning brass wheel on a desk, 1,000 km from the origin, seen from 40 cm. Grid cells keep every position precise to a fraction of a millimeter, and a label gives the camera's distance from the origin.",
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
		hold: 3,
		timeoutSeconds: 60,
	},
];
