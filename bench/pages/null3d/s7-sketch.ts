// The null3D version of S7, the reflection: one paved surface under a sky with a layer over it. The
// surface is a smooth dielectric, so at the grazing angles that the camera sees most of it at it
// mirrors the sky, and the light it reflects comes from the sky's map, which holds the layer. Nothing
// moves. The page's ?reflection=off switch gives the scene no environment map, so the surface keeps
// no reflection and the two runs differ by that alone.
import { defineFeature, defineSketch } from '@null3d/engine';
import {
	S7_AMBIENT,
	S7_CAMERA,
	S7_PAVING,
	S7_PLANE,
	S7_SKY,
	S7_SUN,
	S7_SURFACE,
	s7Paving,
} from '../../scenes/s7';
import layer from './s7-layer.wgsl';

/** The layer's description: it draws over the background, in every view that a sky is seen in. */
const DESCRIPTION = defineFeature({
	name: 's7-bands',
	frame: 'background',
	kind: 'draw',
	provides: ['sky'],
	views: ['main', 'scenePass', 'reflection'],
});

export default defineSketch(async ({ scene, assets, geometry, materials, textures }) => {
	const switches = new URL(import.meta.url).searchParams;
	const camera = scene.createPerspectiveCamera({
		fov: S7_CAMERA.fov,
		near: S7_CAMERA.near,
		far: S7_CAMERA.far,
		position: [...S7_CAMERA.position],
	});
	camera.lookAt(...S7_CAMERA.target);
	scene.setActiveCamera(camera);
	scene.setBackground({ sky: { ...S7_SKY, sunPosition: [...S7_SKY.sunPosition] } });
	scene.createDirectionalLight({ ...S7_SUN, direction: [...S7_SUN.direction] });
	scene.createAmbientLight({ ...S7_AMBIENT });
	// The sky's map holds the layer, so a surface that reflects it shows the layer as the sky does.
	scene.setSkyLayer(DESCRIPTION, { wgsl: layer, refresh: 0 });
	if (switches.get('reflection') !== 'off')
		scene.setEnvironment(await assets.skyEnvironment(), { intensity: 1 });
	// The plane is built facing +Z, and this quarter turn stands it level with its face upward.
	const paving = textures.fromData({
		...s7Paving(),
		colorSpace: 'srgb',
		wrap: 'repeat',
		mipmaps: true,
		anisotropy: 8,
	});
	const half = Math.SQRT1_2;
	scene.createMesh({
		mesh: geometry.plane({ width: S7_PLANE.width, height: S7_PLANE.height }),
		material: materials.standard({
			...S7_SURFACE,
			map: paving,
			uvTransform: { repeat: [S7_PAVING.repeat, S7_PAVING.repeat] },
		}),
		rotation: [-half, 0, 0, half],
	});
	return {};
});
