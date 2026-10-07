// The pose cases of glTF sample models, shared by the fixture script, which records what three.js's
// GLTFLoader and AnimationMixer give for them (bench/three-fixtures.ts writes gltf-poses.json), and
// the poses page, which loads the same files with the engine's parser and plays the same clips in
// the engine core. It is plain data with no engine imports.

/**
 * The address of a sample file on the dev server, as `sampleUrl` in tools/lib/samples.ts gives
 * it. Pages cannot import that module, and the sample check reads the names given here.
 */
const sampleUrl = (path: string) => `/samples/${path}`;

/** Where the sample files sit on the dev server. */
export const SAMPLES_PREFIX = '/samples/';

/** A model and the clips to sample, each at shares of its length. */
export interface PoseModel {
	url: string;
	clips: Readonly<Record<string, readonly number[]>>;
}

/**
 * The models: skinned characters (the KayKit Knight, Fox, RiggedFigure, RiggedSimple and
 * SimpleSkin), and models whose clips move meshes without a skin (BoxAnimated, and
 * InterpolationTest with its step, linear and cubic spline keys).
 */
export const POSE_MODELS: readonly PoseModel[] = [
	{
		url: sampleUrl('sources/characters/kaykit-knight/Knight.glb'),
		clips: {
			Walking_A: [0.23, 0.61],
			'1H_Melee_Attack_Chop': [0.37],
			Jump_Full_Long: [0.52],
		},
	},
	{
		url: sampleUrl('sources/khronos/Fox/glTF-Binary/Fox.glb'),
		clips: { Survey: [0.23, 0.61], Walk: [0.37], Run: [0.52] },
	},
	{
		url: sampleUrl('sources/khronos/RiggedFigure/glTF-Binary/RiggedFigure.glb'),
		clips: { animation_0: [0.23, 0.61] },
	},
	{
		url: sampleUrl('sources/khronos/RiggedSimple/glTF-Binary/RiggedSimple.glb'),
		clips: { animation_0: [0.23, 0.61] },
	},
	{
		url: sampleUrl('sources/khronos/SimpleSkin/glTF-Embedded/SimpleSkin.gltf'),
		clips: { animation_0: [0.23, 0.61] },
	},
	{
		url: sampleUrl('sources/khronos/BoxAnimated/glTF-Binary/BoxAnimated.glb'),
		clips: { animation_0: [0.23, 0.61] },
	},
	{
		url: sampleUrl('sources/khronos/InterpolationTest/glTF-Binary/InterpolationTest.glb'),
		clips: {
			'Step Scale': [0.37],
			'Linear Scale': [0.37],
			'CubicSpline Scale': [0.37],
			'Step Rotation': [0.37],
			'Linear Rotation': [0.37],
			'CubicSpline Rotation': [0.37],
			'Step Translation': [0.37],
			'Linear Translation': [0.37],
			'CubicSpline Translation': [0.37],
		},
	},
];

/** The time of a share of a clip's length, as a 32-bit float, as both engines take it. */
export function poseTime(share: number, duration: number): number {
	return Math.fround(share * duration);
}

/** What three.js gives for one clip at one time. */
export interface PoseCase {
	clip: string;
	time: number;
	/** Each skin's skinning matrices: its joints' world matrices times its inverse bind matrices, 12 numbers each by rows. */
	skins: number[][];
	/** The world matrix, 12 numbers by rows, of each mesh without a skin that a clip moves, by its node's name. */
	moved: Record<string, number[]>;
}

/** The fixture: three.js's revision, and each model's cases. */
export interface PoseFixture {
	revision: string;
	models: { url: string; cases: PoseCase[] }[];
}

/** What the poses page adds to a model's address for its clips after the asset tool. */
export const TOOL_SUFFIX = ' after the asset tool';

/** What the poses page reports for each model, and for each model's clips after the asset tool. */
export interface PoseResult {
	url: string;
	joints: number;
	clips: number;
	/** Milliseconds that the engine's parser took over the file. */
	parseMs: number;
	/** Milliseconds from the first clip handed to the job workers to the last one back. */
	resampleMs: number;
	/** The clips that the core resampled at each frame; it copied the others' keys. */
	resampled: number;
	/** The largest difference from three.js in the rotation and scale part of a matrix. */
	linear: number;
	/** The largest difference from three.js in a translation, as a share of the model's size. */
	translation: number;
	/** The matrices compared. */
	matrices: number;
	/** The clip, time and skeleton joint of the largest difference in a rotation and scale part. */
	worst: string;
}
