// Projected decals: an evening street marked with road paint, a zebra crossing, puddles, cracks,
// mud, moss and a scorch mark, with house fronts worn by bare bricks, posters, graffiti and water
// stains. Each decal is a box with a decal material, which projects its maps
// onto every surface inside it, lit by the setting sun, the sky and the street lamps. Batches draw
// the many dashes, stripes and splashes in one draw each. A walker on a layer of its own crosses the puddles clean,
// since decals skip that layer. A click on the street throws mud or a scorch mark where it lands.
import { defineSketch, timeOfDay } from '@null3d/engine';
import { cracks, moss, mud, puddle, roadPaint, scorch } from '../lib/decal-textures';
import { interact } from '../lib/interact';
import { buildWear, decalTools } from './marks';
import { buildStreet, KERB, LENGTH, ROAD } from './street';
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

	// Every decal is a box with a decal material, which projects its maps onto every surface inside
	// it: the road paint and the zebra crossing, the puddles, the cracks, the scorch mark, the moss
	// along the kerbs and the mud splashes from the passing cars. The many dashes, stripes and
	// splashes of one mark come as batches, so each draws in one call.
	const tools = decalTools(ctx, street);
	const { decal, many, place, strewn, turned } = tools;
	const paint = decal(roadPaint(), { roughness: 0.6 });
	// The centre line's dashes, with a gap where the zebra crossing runs.
	const dashes = Array.from({ length: 12 }, (_, k) => -LENGTH / 2 + 3 + k * 5).filter(
		(z) => Math.abs(z - 8) > 2,
	);
	many(
		paint,
		strewn(dashes.length, (k) => [[0, 0, dashes[k] as number], 0, [0.22, 2.4, 0.6]]),
	);
	many(
		paint,
		strewn(8, (k) => [[-ROAD + 0.6 + k, 0, 8], 0, [0.6, 3.2, 0.6]]),
	);
	const water = decal(puddle(), { envIntensity: 0.35 });
	place(water, [-1.8, 0, 3], [3.4, 2.6, 0.5]);
	place(water, [2.4, 0, -5], [2.6, 3.4, 0.5], turned(0.6));
	place(water, [-ROAD - 1, KERB, -9], [2.2, 1.8, 0.6], turned(1.2));
	place(water, [1, 0, 13], [3, 2.2, 0.5], turned(2.2));
	const crazing = decal(cracks());
	place(crazing, [1.5, 0, 0], [4, 4, 0.6], turned(0.4));
	place(decal(scorch()), [-2.4, 0, -14], [4.5, 4.5, 1], turned(1));
	many(
		decal(moss()),
		strewn(10, (k) => [
			[(k % 2 ? 1 : -1) * (ROAD + 2.9), KERB, -LENGTH / 2 + 4 + k * 5.5],
			k * 0.9,
			[2.2, 2.2, 3],
		]),
	);
	many(
		decal(mud()),
		strewn(9, (k) => [[(k % 2 ? 1 : -1) * (ROAD - 0.5), 0, -22 + k * 5], k * 1.7, [1.6, 1.6, 0.8]]),
	);

	// The wear on the house fronts, and the marks that clicks throw, are scenery, so marks.ts
	// builds them with the same tools.
	const marks = buildWear(houses, tools, crazing);
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
