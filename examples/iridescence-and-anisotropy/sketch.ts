// A jeweller's bench at night. A jewel beetle turns on a plinth of brushed metal, its shell a thin
// film whose colors run in rings over the wing cases, and soap bubbles drift above it, each with a
// film of its own. The oil slick under the bench swirls a slower spectrum. Moving the pointer turns
// the bench and its beams of light, so the stretched highlight across the brushed disc and the
// ring of the beetle's shell shift as the view does. The beetle, bench, bubbles and slick are in
// scene.ts.
import { defineSketch } from '@null3d/engine';
import { interact } from '../lib/interact';
import { createBeetle, createBench, createBubbles, createSlick } from './scene';

export default defineSketch(async (ctx) => {
	const { scene, assets, materials, post, time, engine } = ctx;
	scene.setBackground('#05070a');
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.55 });
	post.set({ bloom: { intensity: 0.22, threshold: 1.1 }, ao: { radius: 0.35 }, vignette: {} });
	const portrait = engine.viewport.height > engine.viewport.width;
	const camera = scene.createPerspectiveCamera({
		fov: portrait ? 48 : 38,
		position: portrait ? [2.6, 2.2, 4.9] : [2.2, 1.7, 4.1],
		target: [0, 0.75, 0],
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 0.75, 0], groundY: 0 });
	// A warm key light and a cold rim, so the film's colors read against the dark room.
	scene.createDirectionalLight({
		direction: [0.5, -0.85, -0.45],
		color: '#ffe6c8',
		intensity: 2.4,
		castShadows: true,
		shadow: { distance: 14 },
	});
	const rim = scene.createPointLight({
		position: [-1.6, 1.5, -1.8],
		color: '#7fb6ff',
		intensity: 22,
		range: 8,
		dynamic: true,
	});

	// The floor: dark stone, which the slick rests on.
	scene.createMesh({
		mesh: ctx.geometry.plane({ width: 26, height: 26 }),
		material: materials.standard({ color: '#15171c', roughness: 0.55, metalness: 0.1 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		position: [0, -0.001, 0],
		receiveShadows: true,
	});
	createSlick(ctx);
	const root = scene.createGroup({ dynamic: true });
	const bench = createBench(ctx, root);
	const beetle = createBeetle(ctx, bench);
	const bubbles = createBubbles(ctx, root);

	return {
		onUpdate(dt) {
			view.update(dt);
			// The bench turns under its lights, and the beetle turns a little faster.
			root.setRotationEuler(0, time.now * 0.16, 0);
			beetle.setRotationEuler(0, time.now * 0.1, 0);
			// The bubbles drift in slow circles of their own.
			bubbles.forEach((bubble, k) => {
				const phase = time.now * (0.25 + k * 0.05) + k * 2.1;
				bubble.setPosition(
					Math.cos(phase) * (1.0 + k * 0.15),
					0.85 + Math.sin(phase * 1.3) * 0.12 + k * 0.22,
					0.15 + Math.sin(phase) * (0.5 + k * 0.12),
				);
			});
			// The rim light circles the bench, so the film's colors sweep across the shell.
			rim.setPosition(Math.cos(time.now * 0.35) * 2.2, 1.5, Math.sin(time.now * 0.35) * 2.2 - 0.6);
		},
	};
});
