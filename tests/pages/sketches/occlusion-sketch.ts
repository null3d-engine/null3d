// The occlusion scene (bench/scenes/occlusion.ts): a room with a doorway in each wall, and a field
// of detailed spheres outside that the walls hide, but for those seen through a doorway. ?view=
// names the view to start in, by its place in the scene's list, 0 by default. The render scale
// stays at 1 with the governor off, so frames compare from engine to engine and time alike. On the page's 'view'
// message, with a view's place, the sketch turns the camera to that view and posts 'turned' with
// whether the engine culls occluded objects on the GPU.
import { defineSketch } from '@null3d/engine';
import {
	OCCLUSION_CAMERA,
	OCCLUSION_COLORS,
	OCCLUSION_GROUND,
	OCCLUSION_SPHERES,
	OCCLUSION_VIEWS,
	OCCLUSION_WALLS,
	SPHERE_RADIUS,
	SPHERE_SEGMENTS,
	viewTarget,
} from '../../../bench/scenes/occlusion';

const params = new URL(import.meta.url).searchParams;
const START = Number(params.get('view') ?? '0');

export default defineSketch(({ scene, materials, geometry, quality, page }) => {
	quality.set({ minRenderScale: 1, maxRenderScale: 1, governor: false });
	scene.setBackground(OCCLUSION_COLORS.background);
	const camera = scene.createPerspectiveCamera({
		fov: OCCLUSION_CAMERA.fov,
		near: OCCLUSION_CAMERA.near,
		far: OCCLUSION_CAMERA.far,
		position: [0, OCCLUSION_CAMERA.height, 0],
		target: [...viewTarget(OCCLUSION_VIEWS[START] ?? 0)],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.4, -1, -0.6], intensity: 2 });
	scene.createAmbientLight({ intensity: 0.4 });
	const box = (size: readonly number[], position: readonly number[], color: string) =>
		scene.createMesh({
			mesh: geometry.box({ width: size[0], height: size[1], depth: size[2] }),
			material: materials.standard({ color, roughness: 0.9 }),
			position: [position[0] ?? 0, position[1] ?? 0, position[2] ?? 0],
		});
	box(OCCLUSION_GROUND.size, OCCLUSION_GROUND.position, OCCLUSION_COLORS.ground);
	for (const wall of OCCLUSION_WALLS) box(wall.size, wall.position, OCCLUSION_COLORS.wall);
	const sphere = geometry.sphere({
		radius: SPHERE_RADIUS,
		widthSegments: SPHERE_SEGMENTS[0],
		heightSegments: SPHERE_SEGMENTS[1],
	});
	const colors = OCCLUSION_COLORS.spheres.map((color) =>
		materials.standard({ color, roughness: 0.5 }),
	);
	OCCLUSION_SPHERES.forEach((position, k) => {
		const material = colors[k % colors.length] ?? colors[0];
		if (material) scene.createMesh({ mesh: sphere, material, position: [...position] });
	});
	page.onMessage((message, data) => {
		if (message !== 'view' || typeof data !== 'number') return;
		const [x, y, z] = viewTarget(OCCLUSION_VIEWS[data] ?? 0);
		camera.lookAt(x, y, z);
		page.post('turned', quality.settings.gpuOcclusion);
	});
});
