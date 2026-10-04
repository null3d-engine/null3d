// The room scene (bench/scenes/room.ts): a room with a doorway in each wall, and a field of detailed
// spheres outside that the walls hide, but for those seen through a doorway. The walls are
// occluders. ?view= names the view to start in, by its place in the scene's list, 0 by default.
// The render scale stays at 1 with the governor off, so frames compare from engine to engine and
// time alike. ?segments= sets the segments around each sphere, to make hidden objects cost more.
// On the page's 'view' message, with a view's place, the sketch turns the camera to that view. A few
// frames later, once the thread that draws has taken a frame with the turn, it posts 'turned' with
// whether the engine culls occluded objects on the GPU.
import { defineSketch } from '@null3d/engine';
import {
	ROOM_CAMERA,
	ROOM_COLORS,
	ROOM_GROUND,
	ROOM_SPHERES,
	ROOM_VIEWS,
	ROOM_WALLS,
	SPHERE_RADIUS,
	SPHERE_SEGMENTS,
	viewTarget,
} from '../../../bench/scenes/room';

const params = new URL(import.meta.url).searchParams;
const START = Number(params.get('view') ?? '0');
/** Frames that the sketch runs after a turn before it posts 'turned'. A pipelined engine draws a
 * frame or two behind the sketch, so after these the newest frame drawn holds the turn. */
const TURN_FRAMES = 3;
/** Segments around each sphere, from ?segments=; the scene's own count without it. */
const SEGMENTS = Number(params.get('segments') ?? SPHERE_SEGMENTS[0]);

export default defineSketch(({ scene, materials, geometry, quality, page }) => {
	quality.set({ minRenderScale: 1, maxRenderScale: 1, governor: false });
	scene.setBackground(ROOM_COLORS.background);
	const camera = scene.createPerspectiveCamera({
		fov: ROOM_CAMERA.fov,
		near: ROOM_CAMERA.near,
		far: ROOM_CAMERA.far,
		position: [0, ROOM_CAMERA.height, 0],
		target: [...viewTarget(ROOM_VIEWS[START] ?? 0)],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.4, -1, -0.6], intensity: 2 });
	scene.createAmbientLight({ intensity: 0.4 });
	const box = (
		size: readonly number[],
		position: readonly number[],
		color: string,
		occluder: boolean,
	) =>
		scene.createMesh({
			mesh: geometry.box({ width: size[0], height: size[1], depth: size[2] }),
			material: materials.standard({ color, roughness: 0.9 }),
			position: [position[0] ?? 0, position[1] ?? 0, position[2] ?? 0],
			occluder,
		});
	box(ROOM_GROUND.size, ROOM_GROUND.position, ROOM_COLORS.ground, false);
	for (const wall of ROOM_WALLS) box(wall.size, wall.position, ROOM_COLORS.wall, true);
	const sphere = geometry.sphere({
		radius: SPHERE_RADIUS,
		widthSegments: SEGMENTS,
		heightSegments: SEGMENTS / 2,
	});
	const colors = ROOM_COLORS.spheres.map((color) => materials.standard({ color, roughness: 0.5 }));
	ROOM_SPHERES.forEach((position, k) => {
		const material = colors[k % colors.length] ?? colors[0];
		if (material) scene.createMesh({ mesh: sphere, material, position: [...position] });
	});
	let framesToTurned = 0;
	page.onMessage((message, data) => {
		if (message !== 'view' || typeof data !== 'number') return;
		const [x, y, z] = viewTarget(ROOM_VIEWS[data] ?? 0);
		camera.lookAt(x, y, z);
		framesToTurned = TURN_FRAMES;
	});
	return {
		onUpdate() {
			if (framesToTurned === 0) return;
			framesToTurned -= 1;
			if (framesToTurned === 0) page.post('turned', quality.settings.gpuOcclusion);
		},
	};
});
