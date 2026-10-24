// Two panels of one bright unlit color, the left with toneMapped: false and the right with the
// default. The 8-bit path applies the output transform in each material's shader. The HDR path's
// final pass reads the mask of the surfaces that keep their display color and skips the tone curve
// for those pixels. So each path keeps the left panel's color as the display shows it and tone maps
// the right one. tests/image/tone-mapped.spec.ts reads the mean color inside each panel.
import { defineSketch } from '@null3d/engine';
import { CAMERA, PANEL, PANEL_COLOR } from '../lib/tone-mapped';

export default defineSketch(({ scene, materials, geometry, post }) => {
	post.set({ toneMapping: 'agx-punchy', exposure: 1 });
	scene.setBackground('#203040');
	const camera = scene.createPerspectiveCamera({
		fov: CAMERA.fov,
		near: CAMERA.near,
		far: CAMERA.far,
		position: [...CAMERA.position],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	const panel = geometry.plane({ width: PANEL.width, height: PANEL.height });
	for (const [x, toneMapped] of [
		[PANEL.x[0], false],
		[PANEL.x[1], true],
	] as const)
		scene.createMesh({
			mesh: panel,
			material: materials.unlit({ color: PANEL_COLOR, toneMapped }),
			position: [x, 0, 0],
		});
	return {};
});
