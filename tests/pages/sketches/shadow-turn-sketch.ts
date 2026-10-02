// A camera that turns on the spot over a ground with posts and boxes that cast long shadows, for
// the test that shadow edges stay still as the camera turns. ?yaw= turns the camera by that many
// degrees about the world's up, from looking along -z, and ?off draws the same frame with a light
// that casts no shadows. One cascade of few texels holds every shadow, so a shadow edge that moved
// by part of a texel would move by several pixels.
import { defineSketch } from '@null3d/engine';
import { TURN } from '../lib/shadow-turn';

const params = new URL(import.meta.url).searchParams;
/** The camera's turn in degrees, from the sketch module's ?yaw switch. */
const YAW = (Number(params.get('yaw') ?? 0) * Math.PI) / 180;
/** True when the sketch module's ?off switch draws the frame without shadows. */
const OFF = params.has('off');

export default defineSketch(({ scene, materials, geometry, quality }) => {
	quality.set({ shadowFilter: 3, farCascadeInterval: 1 });
	scene.setBackground('#101418');
	const pitch = (TURN.pitchDegrees * Math.PI) / 180;
	const [x, y, z] = TURN.position;
	const camera = scene.createPerspectiveCamera({
		fov: TURN.fovDegrees,
		position: [x, y, z],
		target: [
			x - Math.sin(YAW) * Math.cos(pitch),
			y + Math.sin(pitch),
			z - Math.cos(YAW) * Math.cos(pitch),
		],
		far: 300,
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({
		direction: [-1, -1.4, -0.35],
		intensity: 3,
		castShadows: !OFF,
		shadow: { cascades: 1, mapSize: 256, distance: 60 },
	});
	scene.createAmbientLight({ intensity: 0.5 });

	scene.createMesh({
		mesh: geometry.box({ width: 200, height: 0.2, depth: 200 }),
		material: materials.standard({ color: '#9aa0a8' }),
		position: [0, -0.1, 0],
		receiveShadows: true,
	});
	const post = geometry.box({ width: 0.5, height: 4, depth: 0.5 });
	const box = geometry.box({ width: 1.5, height: 1.5, depth: 1.5 });
	const blue = materials.standard({ color: '#4a8cff' });
	const red = materials.standard({ color: '#e8554e' });
	const casts = { castShadows: true };
	for (let k = 0; k < 8; k++) {
		const across = -9 + k * 2.6;
		const ahead = -9 - (k % 3) * 5;
		scene.createMesh({ mesh: post, material: blue, position: [across, 2, ahead], ...casts });
		scene.createMesh({
			mesh: box,
			material: red,
			position: [across + 1.2, 0.75, ahead + 3.5],
			...casts,
		});
	}
});
