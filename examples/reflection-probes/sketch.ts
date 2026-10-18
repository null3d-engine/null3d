// Reflection probes: a gallery of two rooms, warm and cool, joined by a doorway, over one floor
// of polished stone. Each room has a probe whose box fills the room, so the floor reflects the
// room's own walls, columns and light panels where they stand, and the two blend across the
// doorway. A chrome ball and a gold ring drift from room to room and take each room's light in
// turn. They stay out of the probes' captures on a layer of their own, which only the camera draws,
// so they never reflect themselves. B turns box projection off and on: without it, the floor
// reflects the rooms as if they lay far away, and the reflections slide as the camera moves.
import { defineSketch, type ReflectionProbe, type ReflectionProbeOptions } from '@null3d/engine';
import { interact } from '../lib/interact';
import { buildHall, DEPTH, HEIGHT, ROOM } from './hall';

/** The layer of the moving objects, which the camera draws and the probes leave out. */
const MOVERS = 2;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, time, input } = ctx;
	scene.setBackground('#08070a');
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.2 });
	post.set({ bloom: { intensity: 0.3, threshold: 1 }, ao: { radius: 0.6 }, vignette: {} });
	const camera = scene.createPerspectiveCamera({
		fov: 60,
		far: 200,
		position: [-11, 1.7, 1.2],
		target: [4, 1.1, -0.2],
		layers: 1 | MOVERS,
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [4, 1.1, -0.2], groundY: 1 });
	buildHall(ctx);

	// One probe per room, its point at eye height in the room's middle. They blend over a meter
	// either side of the doorway.
	const rooms = [-1, 1].map(
		(side): ReflectionProbeOptions => ({
			box: {
				min: [side < 0 ? -ROOM : -0.5, 0, -DEPTH / 2],
				max: [side < 0 ? 0.5 : ROOM, HEIGHT, DEPTH / 2],
			},
			position: [(side * ROOM) / 2, 1.6, 0],
			blend: 1,
		}),
	);
	const probes: ReflectionProbe[] = rooms.map((room) => scene.createReflectionProbe(room));
	let projected = true;

	const ball = scene.createMesh({
		mesh: geometry.sphere({ radius: 0.7, widthSegments: 64, heightSegments: 32 }),
		material: materials.standard({ color: '#f4f4f4', metalness: 1, roughness: 0.04 }),
		dynamic: true,
		castShadows: true,
		layers: MOVERS,
	});
	const ring = scene.createMesh({
		mesh: geometry.torus({ radius: 0.6, tube: 0.18, radialSegments: 24, tubularSegments: 96 }),
		material: materials.standard({ color: '#f2c14e', metalness: 1, roughness: 0.22 }),
		dynamic: true,
		castShadows: true,
		layers: MOVERS,
	});

	return {
		onUpdate(dt) {
			view.update(dt);
			if (input.wasPressed('KeyB')) {
				projected = !projected;
				for (const [k, probe] of probes.entries())
					probe.set({ ...(rooms[k] as ReflectionProbeOptions), boxProjection: projected });
			}
			// The ball loops through the doorway from room to room; the pointer leads it.
			const t = time.now * 0.35;
			const x = 8 * Math.sin(t);
			const z = 1.2 * Math.sin(2 * t);
			const ballX = x + (view.point[0] - x) * view.steering;
			const ballZ = z + (view.point[2] - z) * view.steering;
			ball.setPosition(ballX, 1 + 0.15 * Math.sin(time.now * 2), ballZ);
			// The ring follows a quarter lap behind, standing and turning.
			const lag = t - Math.PI / 2;
			ring.setPosition(8 * Math.sin(lag), 1.3, 1.2 * Math.sin(2 * lag));
			ring.setRotationEuler(0, time.now * 0.8, 0.3);
		},
	};
});
