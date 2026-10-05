// The three.js twin of S5, the crowd: copies of the optimized KayKit Knight walk in rings on a lit
// ground, each blending a walk with a run by clip weights, under a sun that casts shadows.
//
// It gives three.js its best way to draw the scene with its core and addons:
// - GLTFLoader loads the optimized file once, with KTX2Loader for its texture and MeshoptDecoder
//   for its compressed buffers. SkeletonUtils.clone copies it for each character, so the copies
//   share their geometries and materials, and each gets a skeleton of its own.
// - Each character is a set of SkinnedMesh objects with one AnimationMixer, which plays the walk
//   and the run as two actions whose weights add up to 1, from the character's start time and at
//   its rate. three.js has no instanced skinning in its core, so each SkinnedMesh draws on its
//   own, skinned in the vertex shader of each pass that draws it, the shadow passes included.
// - The sun's shadows come from three.js's cascaded shadow addon, as in S4's twin. Its cascades end
//   at the distance where null3D's shadows end.
// - The cascade count, the shadow map size and the pixel ratio are the settings of the quality
//   preset that null3D chooses on this device for the renderer's GPU path, or the preset that
//   `?preset=` names.
import type * as ThreeModule from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import {
	createS5,
	S5_BACKGROUND,
	S5_CHARACTER,
	S5_DEFAULT_COUNT,
	S5_GROUND,
	S5_SHADOW_DISTANCE,
	S5_VIEW_LIGHTS,
	s5Camera,
	s5CharactersAt,
} from '../../scenes/s5';
import { chosenPreset, twinSettings } from '../lib/preset';
import { S5_MODEL_URL } from '../lib/s5-model';
import { castCascadedShadows } from './cascades';
import { runThreePage } from './harness';

runThreePage(
	's5',
	async (three, scene, options, context) => {
		const tier = context.rendererName === 'webgl' ? 'webgl2' : 'webgpu';
		const preset = chosenPreset(tier, context.params);
		const settings = twinSettings(preset);
		const data = createS5(options.count ?? S5_DEFAULT_COUNT);

		const { size, thickness, color, roughness } = S5_GROUND;
		const groundMaterial = new three.MeshStandardMaterial({ color, roughness, metalness: 0 });
		const ground = new three.Mesh(new three.BoxGeometry(size, thickness, size), groundMaterial);
		ground.position.y = -thickness / 2;
		ground.receiveShadow = true;
		scene.add(ground);

		// KTX2Loader finds the transcoder that three.js ships beside it, which the build copies.
		const ktx2 = new KTX2Loader();
		if (context.rendererName === 'webgpu') await ktx2.detectSupportAsync(context.renderer as never);
		else ktx2.detectSupport(context.renderer as never);
		const gltf = await new GLTFLoader()
			.setKTX2Loader(ktx2)
			.setMeshoptDecoder(MeshoptDecoder)
			.loadAsync(S5_MODEL_URL);
		ktx2.dispose();
		for (const name of S5_CHARACTER.removed) gltf.scene.getObjectByName(name)?.removeFromParent();
		const materials = new Set<ThreeModule.Material>([groundMaterial]);
		gltf.scene.traverse((node) => {
			const mesh = node as ThreeModule.Mesh;
			if (!mesh.isMesh) return;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			materials.add(mesh.material as ThreeModule.Material);
		});
		const clip = (name: string) => {
			const found = three.AnimationClip.findByName(gltf.animations, name);
			if (!found) throw new Error(`the Knight has no clip named ${name}`);
			return found;
		};
		const walk = clip(S5_CHARACTER.walk);
		const run = clip(S5_CHARACTER.run);
		const shadows = await castCascadedShadows(
			three,
			scene,
			context,
			settings,
			[...materials],
			S5_VIEW_LIGHTS,
			S5_SHADOW_DISTANCE,
		);

		const characters: ThreeModule.Object3D[] = [];
		const mixers: ThreeModule.AnimationMixer[] = [];
		for (let i = 0; i < data.count; i++) {
			const character = clone(gltf.scene);
			const mixer = new three.AnimationMixer(character);
			const weight = data.weight[i] as number;
			const walking = mixer.clipAction(walk).setEffectiveWeight(1 - weight);
			const running = mixer.clipAction(run).setEffectiveWeight(weight);
			for (const action of [walking, running]) {
				action.time = data.start[i] as number;
				action.play();
			}
			mixer.timeScale = data.rate[i] as number;
			characters.push(character);
			mixers.push(mixer);
			scene.add(character);
		}

		const clock = new Float64Array(1);
		const positions = new Float64Array(data.count * 3);
		const rotations = new Float64Array(data.count * 4);
		// The harness gives each frame its scene time; the mixers take the step since the last frame.
		let last = 0;
		return {
			n: data.count,
			update(t) {
				const dt = Math.max(0, t - last);
				last = t;
				clock[0] = t;
				s5CharactersAt(data, clock, positions, rotations);
				for (let i = 0; i < data.count; i++) {
					const character = characters[i] as ThreeModule.Object3D;
					character.position.fromArray(positions, i * 3);
					character.quaternion.fromArray(rotations, i * 4);
					(mixers[i] as ThreeModule.AnimationMixer).update(dt);
				}
			},
			camera: (t, position, target) => s5Camera(data, t, position, target),
			...shadows,
			maxPixelRatio: settings.maxPixelRatio,
			report: { preset, settings },
		};
	},
	{ lights: S5_VIEW_LIGHTS, background: S5_BACKGROUND, fillWindow: true, trace: true },
);
