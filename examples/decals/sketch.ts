// Projected decals: an evening street marked with road paint, a zebra crossing, puddles, cracks,
// mud, moss and a scorch mark. Each decal is a box with a decal material, which projects its maps
// onto every surface inside it, lit by the setting sun, the sky and the street lamps. Batches draw
// the many dashes, stripes and splashes in one draw each. A walker on a layer of its own crosses the puddles clean,
// since decals skip that layer. A click on the street throws mud or a scorch mark where it lands.
import { defineSketch, type Material, type Quat, timeOfDay, type Vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';
import { cracks, type DecalTexels, moss, mud, puddle, roadPaint, scorch } from './decal-textures';
import { buildStreet, KERB, LENGTH, ROAD } from './street';
import { createWalker } from './walker';

/** The layer of the walker, which decals skip. */
const WALKER = 1 << 1;
/** A rotation that turns a box's +z axis up, so it projects down onto the ground. */
const DOWN: Quat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
/** The down rotation, turned about the vertical by `angle`. */
const turned = (angle: number): Quat => {
	const [c, s] = [Math.SQRT1_2 * Math.cos(angle / 2), Math.SQRT1_2 * Math.sin(angle / 2)];
	return [-c, s, s, c];
};
/** Rows of the pool of marks that clicks throw, which reuse the oldest row. */
const THROWN = 24;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, time } = ctx;
	// The golden hour sun sets at the street's far end, so the puddles and the paint catch its glare.
	const day = timeOfDay('goldenHour', { heading: -Math.PI / 2 });
	const sky = { intensity: day.skyIntensity };
	scene.setBackground({ sky: day.sky }, sky);
	scene.setEnvironment(await assets.skyEnvironment(), sky);
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 50 } });
	scene.setFog({ color: day.fog.color, density: 0.006, sunGlow: day.fog.sunGlow });
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
	const street = buildStreet(ctx);
	scene.setDecalLayers(~WALKER);

	// Each decal's maps from the code-made textures, with mip levels for the far ones.
	const look = { mipmaps: true, anisotropy: 8 } as const;
	const decal = (texels: DecalTexels, values: Parameters<typeof materials.decal>[0] = {}) => {
		const at = { width: texels.size, height: texels.size, ...look };
		return materials.decal({
			map: textures.fromData({ ...at, data: texels.color, colorSpace: 'srgb' }),
			metalnessRoughnessMap: textures.fromData({ ...at, data: texels.finish }),
			normalMap: textures.fromData({ ...at, data: texels.normal }),
			...values,
		});
	};
	const box = geometry.box();
	const place = (material: Material, position: Vec3, scale: Vec3, rotation = DOWN) =>
		scene.createMesh({ mesh: box, material, position, scale, rotation, parent: street });
	/** A batch of `count` decals, each placed by `at` as a position, a turn and a size. */
	const many = (material: Material, count: number, at: (k: number) => [Vec3, number, Vec3]) => {
		const batch = scene.createInstances(box, count, { material, colors: true });
		for (let k = 0; k < count; k++) {
			const [position, angle, size] = at(k);
			batch.positions.set(position, k * 3);
			batch.rotations.set(turned(angle), k * 4);
			batch.scales.set(size, k * 3);
		}
		return batch;
	};

	const paint = decal(roadPaint(), { roughness: 0.6 });
	many(paint, 12, (k) => [[0, 0, -LENGTH / 2 + 3 + k * 5], 0, [0.22, 2.4, 0.6]]);
	many(paint, 8, (k) => [[-ROAD + 0.6 + k, 0, 8], 0, [0.6, 3.2, 0.6]]);
	const water = decal(puddle());
	place(water, [-1.8, 0, 3], [3.4, 2.6, 0.5]);
	place(water, [2.4, 0, -5], [2.6, 3.4, 0.5], turned(0.6));
	place(water, [-ROAD - 1, KERB, -9], [2.2, 1.8, 0.6], turned(1.2));
	place(water, [1, 0, 13], [3, 2.2, 0.5], turned(2.2));
	const crazing = decal(cracks());
	place(crazing, [1.5, 0, 0], [4, 4, 0.6], turned(0.4));
	place(crazing, [-ROAD - 3, 1.4, 0.6], [1.3, 2.4, 1.4], [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
	place(decal(scorch()), [-2.4, 0, -14], [4.5, 4.5, 1], turned(1));
	many(decal(moss()), 10, (k) => [
		[(k % 2 ? 1 : -1) * (ROAD + 2.9), KERB, -LENGTH / 2 + 4 + k * 5.5],
		k * 0.9,
		[2.2, 2.2, 3],
	]);
	many(decal(mud()), 9, (k) => [
		[(k % 2 ? 1 : -1) * (ROAD - 0.5), 0, -22 + k * 5],
		k * 1.7,
		[1.6, 1.6, 0.8],
	]);

	// Marks that clicks throw: mud and scorch in turns, from pools that hide their unused rows.
	const thrown = [decal(mud()), decal(scorch())].map((material) =>
		many(material, THROWN, () => [[0, -100, 0], 0, [1.8, 1.8, 1]]),
	);
	let throws = 0;
	street.on('click', (event) => {
		const pool = thrown[throws % 2] as (typeof thrown)[number];
		const row = Math.floor(throws / 2) % THROWN;
		pool.positions.set([event.point[0], 0, event.point[2]], row * 3);
		pool.rotations.set(turned(throws * 2.4), row * 4);
		pool.markDirty(row);
		throws++;
	});

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
