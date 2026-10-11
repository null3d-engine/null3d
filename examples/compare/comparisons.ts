// The comparisons with three.js. Each one is a folder of three files: scene.ts, the one description
// that both engines draw, with no engine imports; sketch.ts, the null3D half; and three.ts, the
// three.js half, which runs in a worker of its own. Each entry names its sketch and its worker with
// literal addresses, so a production build ships both, under any address prefix. A page starts a
// comparison with `startComparison` from examples/lib/compare.ts.

import type { DemoGroup } from '../demos';
import type { CompareMode } from '../lib/compare-scene';
import type { DeviceClass, RampPlan } from '../lib/ramp';
import { BATTLE_HOLD, BATTLE_RAMPS, battleObjects } from './battle/scene';
import { FACTORY_HOLD, FACTORY_RAMPS, factoryObjects, SPOT_COUNT } from './factory/scene';

/** The group that a page lists the comparisons under. */
export const COMPARE_GROUP: DemoGroup = 'Compare with three.js';

/** A comparison of null3D with three.js on the same scene. */
export interface Comparison {
	/** The comparison's folder under compare/: lowercase words joined by dashes. */
	name: string;
	/** The folder of its code under the examples folder, for its "View code" link. */
	code: string;
	title: string;
	/** What the comparison shows. */
	summary: string;
	/** What the count counts, for the slider's label. */
	countUnit: string;
	/** The address of the null3D half's sketch. */
	sketch: URL;
	/** Starts the three.js half's worker. */
	startThree(): Worker;
	/** The ramp of each device class. Its maximum is also the most the slider and a run reach. */
	ramps: Readonly<Record<DeviceClass, RampPlan>>;
	/** The frame that the image tests hold: its simulation time in seconds and its count. */
	hold: { readonly seconds: number; readonly count: number };
	/** Objects in the null3D scene at a count in a mode, which the engine makes room for at its start. */
	objectsAt(count: number, mode: CompareMode): number;
	/** Spot and point light shadow tiles that the scene needs in null3D. */
	shadowTiles: number;
	/** What each mode measures, for the "about this comparison" panel. */
	modes: Readonly<Record<CompareMode, string>>;
	/** How each engine draws the scene, for the "about this comparison" panel. */
	notes: readonly string[];
	/** Why the comparison loads files, when it does: the same files in both engines. */
	assets?: string;
	/** three.js's renderer in a mode that only it can draw, on both GPU paths. */
	threeRenderers?: Partial<Record<CompareMode, 'webgl' | 'webgpu'>>;
}

export const COMPARISONS: readonly Comparison[] = [
	{
		name: 'battle',
		code: 'compare/battle/',
		title: 'Battle',
		summary:
			'Two armies of animated soldiers and mechs, rifles in hand, with tanks behind each line, meet on a cratered field at dusk under tracers, shell fire and smoke.',
		countUnit: 'soldiers and mechs',
		sketch: new URL('./battle/sketch.ts', import.meta.url),
		startThree: () =>
			new Worker(new URL('./battle/three.ts', import.meta.url), {
				type: 'module',
				name: 'three.js',
			}),
		ramps: BATTLE_RAMPS,
		hold: BATTLE_HOLD,
		objectsAt: battleObjects,
		shadowTiles: 0,
		modes: {
			'scene-graph':
				"Scene graph measures characters built the usual way: each soldier and mech is its own copy of the model, with its own skeleton and animation, as each engine's examples load characters. null3D animates the copies on its job workers and draws those of one model together. three.js gives each copy its own AnimationMixer, poses its bones on the worker's thread and draws each copy on its own. Each tank is a tree of three parts.",
			instanced:
				'Instanced measures the most tuned build. three.js takes the route of its crowd example: one AnimationMixer per model poses each unit in turn, and one draw per model skins every unit from a table of bone matrices. That route needs WebGPURenderer, which runs in its WebGL2 mode on the WebGL2 path. null3D has one way to draw animated characters, the copies of the scene graph mode, which it already draws in batches. Each tank part is one batch of copies in both engines.',
		},
		notes: [
			"Both engines load the same soldier and mech files. The rifle is a mesh of its own on the soldier's right hand, and follows its joint in both engines.",
			"Each engine draws each effect its own way: null3D's generated sky and its environment light, cascaded sun shadows, height fog, bloom chain, ambient occlusion and grading table; three.js's Sky with its light through PMREMGenerator, the CSM add-on or the CSM shadow node, the same fog formula in a shader, UnrealBloomPass or the bloom node, GTAOPass or the GTAO node, and LUTPass or the 3D LUT node.",
			'Smoke, fire, sparks and muzzle flashes are sprites: a sprite batch in null3D, which sorts the smoke from back to front, and an instanced quad that faces the camera in three.js, which does not sort it.',
			"Grass and flags sway, and the wrecks' embers glow, through custom materials: WGSL surface and vertex functions in null3D, GLSL added to MeshStandardMaterial on WebGLRenderer, and node materials on WebGPURenderer.",
		],
		assets:
			'Shows both engines loading and animating the same ready-made character files: a soldier with a rifle on his hand, and a mech.',
		threeRenderers: { instanced: 'webgpu' },
	},
	{
		name: 'factory',
		code: 'compare/factory/',
		title: 'Factory',
		summary:
			'Rows of robot arms, each a tree of seven parts, pick crates off belts and stack them on pallets, under spot lights in a hazy hall.',
		countUnit: 'moving parts',
		sketch: new URL('./factory/sketch.ts', import.meta.url),
		startThree: () =>
			new Worker(new URL('./factory/three.ts', import.meta.url), {
				type: 'module',
				name: 'three.js',
			}),
		ramps: FACTORY_RAMPS,
		hold: FACTORY_HOLD,
		objectsAt: factoryObjects,
		shadowTiles: SPOT_COUNT,
		modes: {
			'scene-graph':
				"Scene graph measures a scene built the usual way: each arm is a tree of objects, one per part, as each engine's own examples build jointed models. The code writes each joint that moved, and each engine works out the world transforms of the trees. null3D does it on its job workers and draws parts that share a mesh and a material together. three.js walks its scene graph and draws each part on its own.",
			instanced:
				'Instanced measures the most tuned build: each kind of part is one batch of copies, and one loop of code works out every moving part in closed form, with no tree. null3D uses its instance batches, and three.js its InstancedMesh. Both upload the copies in use.',
		},
		notes: [
			"Each engine draws each effect its own way: null3D's shadow atlas, height fog, bloom chain, ambient occlusion and grading table, and three.js's spot light shadow maps, the same fog formula in a shader, UnrealBloomPass or the bloom node, GTAOPass or the GTAO node, and LUTPass or the 3D LUT node.",
			"Bloom is set once, as UnrealBloomPass's settings. The bloom node takes three times the strength, and null3D's bloom chain takes the mapped settings for the same glow.",
			'Ambient occlusion darkens only the ambient light in null3D and with the GTAO node. GTAOPass on WebGLRenderer darkens the whole image, so that path looks a little darker where parts meet.',
		],
	},
];
