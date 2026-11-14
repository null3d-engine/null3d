// Gaussian splats: Dok11's drone scan of Bolton Priory, 1.7 million splats that the splats add-on
// streams from 84 chunk files. The add-on fetches the chunks that the view needs, nearest first,
// and draws as many splats as the preset's budget allows. A chunk far from the camera draws only
// its most covering splats, grown so they still cover its ground. A survey drone, made in code,
// circles the ruins: the splats and its meshes hide each other by depth. The camera holds its first
// view while the scan streams in, then circles the site.
import { defineSketch } from '@null3d/engine';
import { createSplats } from '@null3d/splats';
import { interact } from '../lib/interact';
import { sampleUrl } from '../lib/samples';

/** The camera's circle around the site: its radius and height, in the scan's units. */
const ORBIT = 26;
const HEIGHT = 24;
/** The seconds that the camera holds its first view, and the seconds that its circle eases in. */
const START = 2;
const EASE = 3;
/** How fast the camera circles once it moves, in radians a second. */
const SPEED = 0.05;
/** The drone's circle over the ruins, and its height. */
const FLIGHT = 7;
const FLIGHT_HEIGHT = 5;
/** The drone's four corners, where its arms reach and its rotors spin. */
const CORNERS = [
	[-1, -1],
	[1, -1],
	[-1, 1],
	[1, 1],
] as const;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, page, time } = ctx;
	// A scan's colors are the colors that its photographs saw, so no tone curve changes them.
	post.set({ toneMapping: 'none' });
	scene.setBackground('#eceff1');
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.6 });
	scene.createDirectionalLight({ direction: [0.4, -1, -0.3], color: '#fff8ee', intensity: 2 });

	const target: [number, number, number] = [0, 1, 0];
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		near: 0.1,
		far: 400,
		position: [0, HEIGHT, ORBIT],
		target,
	});
	scene.setActiveCamera(camera);

	// The drone: a body, four arms, and a rotor at the end of each arm.
	const drone = scene.createGroup({ dynamic: true });
	const shell = materials.standard({ color: '#e8e8e4', roughness: 0.4 });
	const dark = materials.standard({ color: '#24262a', roughness: 0.6 });
	scene.createMesh({
		mesh: geometry.box({ width: 0.5, height: 0.18, depth: 0.7 }),
		material: shell,
		parent: drone,
	});
	const arm = geometry.box({ width: 0.06, height: 0.05, depth: 1.5 });
	const blade = geometry.box({ width: 0.62, height: 0.02, depth: 0.06 });
	const rotors = CORNERS.map(([x, z]) => {
		const turn = (x * z * Math.PI) / 8;
		scene.createMesh({
			mesh: arm,
			material: dark,
			parent: drone,
			position: [x * 0.25, 0.05, z * 0.25],
			rotation: [0, Math.sin(turn), 0, Math.cos(turn)],
		});
		const rotor = scene.createGroup({ parent: drone, position: [x * 0.5, 0.12, z * 0.5] });
		scene.createMesh({ mesh: blade, material: dark, parent: rotor });
		return rotor;
	});

	const splats = await createSplats(ctx, {
		url: sampleUrl('sources/splats/bolton-priory-stream/index.json'),
	});
	const eye: [number, number, number] = [0, 0, 0];
	camera.getPosition(eye);
	splats.update(eye);
	// The first view waits for every chunk that it asks for, and the loading overlay counts them.
	const counting = setInterval(() => {
		page.post('loading', {
			text: `${splats.loaded} of ${splats.chunks} parts of the scan loaded`,
			value: splats.loaded / splats.chunks,
		});
	}, 100);
	await splats.ready;
	await splats.settle();
	clearInterval(counting);

	const view = interact(ctx, camera, { target, minDistance: 3, maxDistance: 80 });
	return {
		onUpdate(dt) {
			const t = time.now;
			const flight = t * 0.25;
			drone.setPosition(
				Math.sin(flight) * FLIGHT,
				FLIGHT_HEIGHT + 0.3 * Math.sin(t * 1.3),
				Math.cos(flight) * FLIGHT,
			);
			drone.setRotationEuler(0.08 * Math.sin(t), flight + Math.PI / 2, 0);
			for (const rotor of rotors) rotor.setRotationEuler(0, t * 40, 0);
			if (!view.userCamera) {
				// The circle's speed rises evenly over the ease, so the camera starts without a jolt.
				const moving = Math.max(0, t - START);
				const travelled = moving < EASE ? (moving * moving) / (2 * EASE) : moving - EASE / 2;
				const angle = SPEED * travelled;
				camera.setPosition(Math.sin(angle) * ORBIT, HEIGHT, Math.cos(angle) * ORBIT);
				camera.lookAt(...target);
			}
			view.update(dt);
			camera.getPosition(eye);
			splats.update(eye);
		},
	};
});
