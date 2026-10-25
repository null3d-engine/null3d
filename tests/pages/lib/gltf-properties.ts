// The property cases of `KHR_animation_pointer`: the models whose clips move material, light and
// node values, the times to sample, and the properties to read. `bench/three-fixtures.ts` records
// what three.js's GLTFLoader, its animation-pointer plugin and AnimationMixer give at each time;
// the properties page loads the same files with the engine and compares the values that its
// animator wrote. It is plain data with the one model that code builds, so Bun and the page share
// it.

import { boxPrimitive, GltfBuilder } from './gltf-files';

/**
 * The address of a sample file on the dev server, as `sampleUrl` in tools/lib/samples.ts gives
 * it. Pages cannot import that module, and the sample check reads the names given here.
 */
const sampleUrl = (path: string) => `/samples/${path}`;

/** A model whose clips move properties, and the properties to compare. */
export interface PropertyModel {
	/** The name that the fixture and the page know the model by. */
	id: string;
	/**
	 * The address of the file, relative to the test page, or under `/samples/` for the sample
	 * content. Empty for the file that `builtFile` makes.
	 */
	url: string;
	clip: string;
	/** The times in seconds at which to sample the clip. */
	times: readonly number[];
	/**
	 * The properties to read, as the engine's animator names them: a material's value such as
	 * `materials/0/color`, a light's such as `lights/0/intensity`, or a node's visibility.
	 */
	keys: readonly string[];
}

/**
 * The models: every Khronos sample whose clip a `KHR_animation_pointer` moves, and a light that
 * code builds, because no Khronos sample moves a light's values. The two small samples sit beside
 * this repository's tests, and the large one in the sample content.
 */
export const PROPERTY_MODELS: readonly PropertyModel[] = [
	{
		id: 'animated-colors-cube',
		url: 'assets/models/sources/khronos/AnimatedColorsCube/AnimatedColorsCube.gltf',
		clip: 'Cube Animation',
		times: [0, 0.75, 1.5, 2.25, 2.9],
		keys: ['materials/0/color', 'materials/0/opacity'],
	},
	{
		id: 'light-visibility',
		url: 'assets/models/sources/khronos/LightVisibility/LightVisibility.gltf',
		clip: 'BlinkingBlueLight',
		times: [0, 0.45, 0.9, 1.5, 2.1],
		keys: ['nodes/5/visible'],
	},
	{
		id: 'cube-visibility',
		url: 'assets/models/sources/khronos/CubeVisibility/CubeVisibility.gltf',
		clip: 'BlinkingBlueCube',
		times: [0, 0.25, 0.5, 0.75, 1.2, 1.6],
		keys: ['nodes/5/visible'],
	},
	{
		id: 'animation-pointer-uvs',
		url: sampleUrl('sources/khronos/AnimationPointerUVs/glTF/AnimationPointerUVs.gltf'),
		clip: 'animation_0',
		times: [0, 1.5, 3, 4.5, 5.9],
		// The four texture transforms that three.js's animation-pointer plugin moves, of the
		// sample's 103 channels. The plugin moves no other texture, and neither does the engine.
		keys: [
			'materials/10/baseColorOffset',
			'materials/11/baseColorScale',
			'materials/19/emissiveOffset',
			'materials/20/emissiveScale',
		],
	},
	{
		id: 'pointer-light',
		url: '',
		clip: 'Pulse',
		// Inside the clip: a repeating clip wraps a time at its length to its start.
		times: [0, 0.5, 1, 1.5, 1.9],
		keys: ['lights/0/intensity', 'lights/0/color', 'lights/0/range'],
	},
];

/** What three.js gave for one model's clip at one time. */
export interface PropertyCase {
	time: number;
	/** The value of each of the model's keys, as three.js wrote it. */
	values: Readonly<Record<string, readonly number[]>>;
}

/** The fixture: three.js's revision, and each model's cases. */
export interface PropertyFixture {
	revision: string;
	models: { id: string; cases: PropertyCase[] }[];
}

/** The time of a sample, as both engines take it: a 32-bit float. */
export function propertyTime(seconds: number): number {
	return Math.fround(seconds);
}

/**
 * A spot light and a box, whose clip moves the light's intensity, color and range through
 * `KHR_animation_pointer`. It has no node tracks, so the engine's rig holds no joint but the one
 * that a property-only model takes.
 */
export function builtFile(): Uint8Array {
	const b = new GltfBuilder();
	b.json.extensionsUsed = ['KHR_animation_pointer', 'KHR_lights_punctual'];
	b.json.extensions = {
		KHR_lights_punctual: {
			lights: [
				{
					type: 'spot',
					color: [0.6, 0.6, 0.6],
					intensity: 2,
					range: 6,
					spot: { innerConeAngle: 0.2, outerConeAngle: 0.6 },
				},
			],
		},
	};
	const material = b.material({
		name: 'grey',
		pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1], metallicFactor: 0 },
	});
	const mesh = b.mesh([boxPrimitive(b, material)], 'box');
	const box = b.node({ name: 'Box', mesh });
	const lamp = b.node({ name: 'Lamp', translation: [0, 1.5, 0] });
	b.json.nodes[lamp].extensions = { KHR_lights_punctual: { light: 0 } };
	b.json.scenes[0].nodes = [box, lamp];
	const pointer = (path: string) => ({
		path: 'pointer',
		extensions: { KHR_animation_pointer: { pointer: path } },
	});
	b.json.animations = [
		{
			name: 'Pulse',
			samplers: [
				{
					input: b.accessor(new Float32Array([0, 1, 2]), 1, { min: [0], max: [2] }),
					output: b.accessor(new Float32Array([1, 5, 1]), 1),
				},
				{
					input: b.accessor(new Float32Array([0, 1, 2]), 1, { min: [0], max: [2] }),
					output: b.accessor(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), 3),
				},
				{
					input: b.accessor(new Float32Array([0, 1, 2]), 1, { min: [0], max: [2] }),
					output: b.accessor(new Float32Array([4, 8, 4]), 1),
					interpolation: 'STEP',
				},
			],
			channels: [
				{
					sampler: 0,
					target: pointer('/extensions/KHR_lights_punctual/lights/0/intensity'),
				},
				{ sampler: 1, target: pointer('/extensions/KHR_lights_punctual/lights/0/color') },
				{ sampler: 2, target: pointer('/extensions/KHR_lights_punctual/lights/0/range') },
			],
		},
	];
	return b.glb();
}

/** The address of a file that code builds, which a loader reads as any other address. */
export function builtUrl(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return `data:model/gltf-binary;base64,${btoa(binary)}`;
}

/** What the properties page reports: the models' values, and the sketch's own animations. */
export interface PropertyReport {
	readings: PropertyReading[];
	/** The values that reached a light and a camera from `scene.animateProperty`. */
	values: { color: number[]; fov: number };
	/** The code of each call of `scene.animateProperty` that must fail. */
	failures: Readonly<Record<string, string>>;
}

/** What the engine's animator wrote to each property of one model's clip at one time. */
export interface PropertyReading {
	/** The model's id in `PROPERTY_MODELS`. */
	id: string;
	time: number;
	/** The value of each of the model's keys, or nothing for a property that no clip played. */
	values: Readonly<Record<string, number[]>>;
}
