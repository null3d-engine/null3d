// Projected decals: an evening street marked with road paint, a zebra crossing, puddles, cracks,
// mud, moss and a scorch mark, with house fronts worn by bare bricks, posters, graffiti and water
// stains. Each decal is a box with a decal material, which projects its maps
// onto every surface inside it, lit by the setting sun, the sky and the street lamps. Batches draw
// the many dashes, stripes and splashes in one draw each. A walker on a layer of its own crosses the puddles clean,
// since decals skip that layer. A click on the street throws mud or a scorch mark where it lands.
import { defineSketch, timeOfDay } from '@null3d/engine';
import { interact } from '../lib/interact';
import { buildMarks } from './marks';
import { buildStreet } from './street';
import { createWalker } from './walker';

/** The layer of the walker, which decals skip. */
const WALKER = 1 << 1;

export default defineSketch(async (ctx) => {
	const { scene, assets, post, time } = ctx;
	// The golden hour sun sets at the street's far end, so the puddles and the paint catch its glare.
	const day = timeOfDay('goldenHour', { heading: -Math.PI / 2 });
	const sky = { intensity: day.skyIntensity };
	scene.setBackground({ sky: day.sky }, sky);
	scene.setEnvironment(await assets.skyEnvironment(), sky);
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 50 } });
	scene.setFog({ color: day.fog.color, density: 0.0025, sunGlow: day.fog.sunGlow * 0.35 });
	post.set({
		exposure: day.exposure,
		bloom: { intensity: 0.15, threshold: 1 },
		ao: { radius: 0.5 },
	});
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		position: [5.5, 4.2, 13.5],
		target: [-0.5, 0, 3],
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [-0.5, 0, 3] });
	const { ground: street, houses } = buildStreet(ctx);
	scene.setDecalLayers(~WALKER);

	// Every paint dash, puddle, crack, moss patch and muddy splash, and the wear on the house fronts.
	const marks = buildMarks(ctx, street, houses);
	street.on('click', (event) => marks.throwAt(event.point));

	// The walker strolls across the street and through the puddles, on a layer that decals skip.
	const walker = createWalker(ctx, 1 | WALKER);
	return {
		onUpdate(dt) {
			view.update(dt);
			const t = time.now * 0.25;
			walker.update(Math.sin(t) * 2.5, 3 + Math.sin(t * 0.5) * 9);
		},
	};
});
