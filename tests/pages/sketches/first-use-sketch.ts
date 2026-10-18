// One feature whose shader builds load on first use, on a plain ground, for the first-use test:
// ?feature= names it, as the shader manifest's first-use tables do. Each case uses that feature
// alone, so a page downloads that feature's shader file once, for its device's fixed bits. The
// scene keeps every other such feature out: no sun that casts shadows unless the feature needs one,
// and then no contact shadows, which would load ambient occlusion's file on a desktop. A feature
// with no case here fails the test, so a new first-use table needs a case.
import { defineSketch, type SketchContext, type StandardOptions } from '@null3d/engine';
import {
	animateObject,
	createAnimationRig,
	skinObject,
	texCoordsMaterial,
} from '@null3d/engine/internal';
import { CROWD_CLIPS, crowdMesh, crowdRig } from '../lib/crowd-rig';

const feature = new URL(import.meta.url).searchParams.get('feature') ?? '';

/** A white color map with a soft round cut-out, for the masked, hashed and covered cards. */
function roundCard({ textures }: SketchContext) {
	const size = 16;
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
			data.set(
				[230, 230, 230, Math.round(255 * Math.max(0, Math.min(1, (1 - r) * 3)))],
				(y * size + x) * 4,
			);
		}
	return textures.fromData({ width: size, height: size, data, colorSpace: 'srgb' });
}

/** A card that the camera faces, with a material of the given alpha options. */
function card(context: SketchContext, alpha: StandardOptions, castShadows = false) {
	const { scene, geometry, materials } = context;
	scene.createMesh({
		mesh: geometry.plane({ width: 1.5, height: 1.5 }),
		material: materials.standard({ map: roundCard(context), ...alpha }),
		position: [0, 1, 0],
		castShadows,
	});
}

/** A sphere whose levels of detail fade between them. */
function fadingLevels({ scene, geometry, materials }: SketchContext) {
	const base = geometry.sphere({ radius: 0.8, widthSegments: 32, heightSegments: 16 });
	base.setLevels([
		{ mesh: geometry.sphere({ radius: 0.8, widthSegments: 12, heightSegments: 6 }), error: 0.02 },
	]);
	scene.createMesh({
		mesh: base,
		material: materials.standard({ color: '#b0c4de' }),
		position: [0, 1, 0],
	});
}

/** One skinned character that plays a clip. */
function skinnedCharacter({ scene, geometry, materials }: SketchContext) {
	const joints = 8;
	const rig = createAnimationRig(scene, crowdRig(joints));
	const dancer = scene.createMesh({
		mesh: geometry.fromArrays(crowdMesh(joints)),
		material: materials.standard({ color: '#e8554e' }),
		position: [0, 0, 0],
	});
	const animator = animateObject(dancer, rig);
	skinObject(dancer, animator);
	animator.play(CROWD_CLIPS[0]);
}

/** A card with one morph target that lifts its top edge. */
function morphedCard({ scene, geometry, materials }: SketchContext) {
	const object = scene.createMesh({
		mesh: geometry.fromArrays({
			positions: new Float32Array([-0.75, 0, 0, 0.75, 0, 0, 0.75, 1.5, 0, -0.75, 1.5, 0]),
			normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
			indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
			morphTargets: { positions: [new Float32Array([0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0.5, 0])] },
		}),
		material: materials.standard({ color: '#9ad2ff' }),
		position: [0, 0.2, 0],
	});
	object.setMorphWeight(0, 0.5);
}

/** The cases, by the shader manifest's names of the features. */
const CASES: Record<string, (context: SketchContext) => void> = {
	ao: ({ post }) => post.set({ ao: {} }),
	bloom: ({ post }) => post.set({ bloom: { intensity: 0.4 } }),
	dof: ({ post }) => post.set({ dof: { focusDistance: 4, aperture: 4 } }),
	exposure: ({ post }) => post.set({ autoExposure: {} }),
	fog_volume: ({ scene }) =>
		scene.setFog({ color: '#8090a0', density: 0.05, heightFalloff: 0.2, volumetric: true }),
	// Two effects that each read their own pixel: the engine joins them into one pass and builds that
	// pass's shader from their pieces, so the page loads the effects' host and the final pass's.
	effect_groups: ({ post }) => {
		post.addEffect({ wgsl: TINT, uniforms: { color: [1, 0.9, 0.8] } });
		post.addEffect({ wgsl: TINT, uniforms: { color: [0.9, 0.95, 1] } });
	},
	views: ({ scene, render, textures, geometry, materials }) => {
		const top = scene.createOrthographicCamera({
			height: 6,
			near: 1,
			far: 20,
			position: [0, 10, 0],
		});
		top.setRotationEuler(-Math.PI / 2, 0, 0);
		const pass = render.addPass({ kind: 'scene', camera: top, writes: 'map', size: [64, 64] });
		scene.createMesh({
			mesh: geometry.plane({ width: 1.5, height: 1.5 }),
			material: materials.unlit({ map: textures.fromPass(pass) }),
			position: [0, 1, 0],
		});
	},
	area_lights: ({ scene }) => {
		scene.createRectAreaLight({
			width: 2,
			height: 1,
			range: 6,
			color: '#ffd29a',
			position: [0, 2, 1],
		});
	},
	cutout: (context) => {
		context.quality.set({ contactShadowSteps: 0 });
		context.scene.createDirectionalLight({ direction: [-0.4, -1, -0.3], castShadows: true });
		card(context, { alphaMode: 'mask', alphaCutoff: 0.5, alphaToCoverage: false }, true);
	},
	coverage: (context) =>
		card(context, { alphaMode: 'mask', alphaCutoff: 0.5, alphaToCoverage: true }),
	hash: (context) => card(context, { alphaMode: 'hash' }),
	sky: ({ scene }) => scene.setBackground({ sky: { sunPosition: [0, 0.2, -1] } }),
	physical_sky: ({ scene }) => scene.setBackground({ atmosphere: { sunPosition: [0, 0.2, -1] } }),
	skinning: skinnedCharacter,
	morph: morphedCard,
	texcoords: ({ scene, geometry, materials }) => {
		scene.createMesh({
			mesh: geometry.box(),
			material: texCoordsMaterial(materials),
			position: [0, 1, 0],
		});
	},
	// The page's ?instances=index switch draws the batch's bucket with index-only instance data.
	instance_index: ({ scene, geometry, materials }) => {
		const batch = scene.createInstances(geometry.box(), 4, {
			material: materials.standard({ color: '#c0a080' }),
		});
		for (let k = 0; k < 4; k++) batch.positions.set([k - 1.5, 0.5, 0], k * 3);
		batch.markDirty();
	},
	row_values: ({ scene, geometry, materials }) => {
		const batch = scene.createInstances(geometry.box(), 4, {
			material: materials.standard({ color: '#ffffff' }),
			colors: true,
		});
		for (let k = 0; k < 4; k++) {
			batch.positions.set([k - 1.5, 0.5, 0], k * 3);
			batch.colors?.set([k / 3, 0.5, 1 - k / 3, 1], k * 4);
		}
		batch.markDirty();
	},
	lod_fade: fadingLevels,
	// A pick draws the scene into the pass's id target, whose builds load with the first call.
	picking: ({ scene }) => {
		void scene.pick(0, 0).catch(() => {});
	},
	// The page's ?occlusion=on switch runs GPU occlusion culling, which a marked occluder starts.
	occlusion: ({ scene, geometry, materials }) => {
		scene.createMesh({
			mesh: geometry.box({ width: 4, height: 2, depth: 0.2 }),
			material: materials.standard({ color: '#808890' }),
			position: [0, 1, 1],
			occluder: true,
		});
	},
};

/** A custom effect that tints each pixel toward a color. */
const TINT = /* wgsl */ `
struct Uniforms { color: vec3f }

fn effect(input: EffectInput) -> vec4f {
    return vec4f(input.color.rgb * uniforms.color, input.color.a);
}
`;

export default defineSketch((context) => {
	const { scene, geometry, materials } = context;
	const use = CASES[feature];
	if (!use)
		throw new Error(
			`the first-use sketch has no case for '${feature}': add one that uses that feature alone`,
		);
	scene.setBackground('#8fa3b8');
	scene.createHemisphereLight({ skyColor: '#a8c4ff', groundColor: '#5a4a3a', intensity: 1 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 50, position: [0, 2, 5], target: [0, 0.8, 0] }),
	);
	const ground = scene.createMesh({
		mesh: geometry.plane({ width: 6, height: 6 }),
		material: materials.standard({ color: '#9a948a', roughness: 0.85 }),
		receiveShadows: true,
	});
	ground.setRotationEuler(-Math.PI / 2, 0, 0);
	use(context);
	return {};
});
