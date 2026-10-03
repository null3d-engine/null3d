// The three.js twin of the skinning scene (bench/scenes/skinning.ts), which null3D's image tests
// draw. Each character is a SkinnedMesh bound to a chain of bones at rest, as three.js's examples
// build one, with an AnimationMixer that plays the clip of poses at the character's speed through
// the held time. It draws the scene once into an offscreen target of the image's size, and
// publishes the pixels as the hold pages do. `?renderer=webgl` draws with WebGLRenderer, and
// `?renderer=webgpu` with WebGPURenderer.
import type * as ThreeModule from 'three';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	CHAIN,
	CHARACTERS,
	CLIP,
	characterMesh,
	KEY_TIMES,
	rotationKeys,
	SKINNING_CAMERA,
	SKINNING_HOLD,
	SKINNING_IMAGE,
} from '../../scenes/skinning';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { lightScene, RENDERERS, startThree } from './harness';

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const rendererName = readChoice(params, 'renderer', RENDERERS);
	const { three, renderer, readFrame } = await startThree(rendererName);
	const scene = new three.Scene();
	lightScene(three, scene);

	const arrays = characterMesh();
	const geometry = new three.BufferGeometry();
	geometry.setAttribute('position', new three.BufferAttribute(arrays.positions, 3));
	geometry.setAttribute('normal', new three.BufferAttribute(arrays.normals, 3));
	geometry.setAttribute('skinIndex', new three.Uint16BufferAttribute(arrays.joints, 4));
	geometry.setAttribute('skinWeight', new three.BufferAttribute(arrays.weights, 4));
	geometry.setIndex(new three.BufferAttribute(arrays.indices, 1));
	const tracks = CHAIN.map(
		(_, j) =>
			new three.QuaternionKeyframeTrack(
				`joint${j}.quaternion`,
				[...KEY_TIMES],
				rotationKeys(j),
				three.InterpolateDiscrete,
			),
	);
	const clip = new three.AnimationClip(CLIP, -1, tracks);

	for (const character of CHARACTERS) {
		const bones: ThreeModule.Bone[] = CHAIN.map((joint, j) => {
			const bone = new three.Bone();
			bone.name = `joint${j}`;
			bone.position.set(...joint.translation);
			return bone;
		});
		for (const [j, joint] of CHAIN.entries())
			if (joint.parent >= 0) bones[joint.parent]?.add(bones[j] as ThreeModule.Bone);
		const mesh = new three.SkinnedMesh(
			geometry,
			new three.MeshStandardMaterial({ color: character.color }),
		);
		mesh.position.set(...character.position);
		mesh.add(bones[0] as ThreeModule.Bone);
		mesh.updateMatrixWorld(true);
		mesh.bind(new three.Skeleton(bones));
		const mixer = new three.AnimationMixer(mesh);
		mixer.clipAction(clip).setEffectiveTimeScale(character.speed).play();
		mixer.update(SKINNING_HOLD);
		scene.add(mesh);
	}

	const { width, height } = SKINNING_IMAGE;
	const { fov, position, target, near, far } = SKINNING_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: 'skinning',
		renderer: rendererName,
		n: CHARACTERS.length,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
