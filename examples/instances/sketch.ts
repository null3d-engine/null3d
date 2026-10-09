// Instance batches: a field of 100,000 columns in one dynamic batch, at golden hour. Each frame the
// sketch writes the height of every row straight into the batch's arrays, with no call per row. The
// engine then computes, culls and draws the rows in bulk. A row's place across the field never
// changes, so the setup writes it once, in square rings from the middle out. The Low preset of
// phones then draws only the first rows, the middle of the field. A lamp hovers over the center of
// the wave, which drifts by itself and follows the pointer, and lights the columns around it.
// Batches cast no shadows yet, so the low sun, the sky's light, the lamp, ambient occlusion and fog
// give the field its depth.
import { defineSketch, timeOfDay, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** Columns along each side of the field at each preset: 100,489 in all above Low. */
const SIDES = { low: 101, medium: 317, high: 317, ultra: 317 } as const;
/** The ring of columns farthest from the middle. */
const MID = (SIDES.high - 1) / 2;
/** The distance between the centers of neighboring columns, in meters. */
const SPACING = 0.3;
/** The distance from the field's center to its outer rows. */
const HALF = MID * SPACING;
/** The point that the camera looks at, above the field's middle. */
const TARGET = [0, 2, 0] as const;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, quality, time } = ctx;
	// Golden hour, with the sun low beyond the field. The sky's own light lights the columns and
	// shows in their metal. Clouds that drifted would make that light again in every frame.
	const day = timeOfDay('goldenHour', { heading: -2.4 });
	const intensity = day.skyIntensity;
	scene.setBackground({ sky: { ...day.sky, cloudCoverage: 0.3 } }, { intensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity });
	// The fog takes an amber between the sky's rim across the view and its glow toward the sun.
	const haze = { color: [0.4, 0.22, 0.14], density: 0.012, heightFalloff: 0.2 } as const;
	scene.setFog({ ...haze, sunGlow: day.fog.sunGlow });
	post.set({
		exposure: day.exposure * 1.3,
		bloom: { intensity: 0.25, threshold: 1 },
		vignette: {},
	});
	post.set({ ao: { radius: 0.4 } });
	const camera = scene.createPerspectiveCamera({ fov: 50, near: 0.5, far: 5000 });
	scene.setActiveCamera(camera);
	// The pointer points at the columns' mean height.
	const view = interact(ctx, camera, {
		target: TARGET,
		groundY: 1.6,
		bounds: [-HALF, 0, -HALF, HALF, 2, HALF],
	});
	scene.createDirectionalLight(day.light);
	scene.createAmbientLight(day.ambient);

	scene.createMesh({
		mesh: geometry.box({ width: 10_000, height: 0.2, depth: 10_000 }),
		material: materials.standard({ color: '#2a2624', roughness: 0.9 }),
		position: [0, -0.1, 0],
	});
	const steel = materials.standard({ color: '#8fa3c8', metalness: 0.5, roughness: 0.35 });
	const column = geometry.box({ width: 0.22, depth: 0.22 });
	const field = scene.createInstances(column, SIDES.high ** 2, { material: steel, dynamic: true });
	// Each row's place across the field, ring by ring from the middle out, so that the first rows
	// fill a square in the middle. The heights change in every frame.
	const places = field.positions;
	let placed = 0;
	for (let ring = 0; ring <= MID; ring++)
		for (let z = -ring; z <= ring; z++)
			for (let x = -ring; x <= ring; x++) {
				if (Math.max(Math.abs(x), Math.abs(z)) < ring) continue;
				places[placed * 3] = x * SPACING;
				places[placed * 3 + 2] = z * SPACING;
				placed++;
			}
	// The preset's square of columns: the engine's start-up check may lower the preset on a slow GPU.
	let rows = 0;
	const fit = () => {
		rows = SIDES[quality.preset] ** 2;
		field.setActiveCount(rows);
	};
	fit();
	quality.onChange(fit);
	// The lamp: a bulb bright enough to bloom, with a warm point light in it.
	const bulb = scene.createMesh({
		mesh: geometry.sphere({ radius: 0.5 }),
		material: materials.standard({ color: '#000000', emissive: '#ffb35c', emissiveIntensity: 12 }),
		dynamic: true,
	});
	scene.createPointLight({ parent: bulb, color: '#ffb35c', intensity: 120, range: 16 });

	const center = vec3.create();
	/** The part of each row's height that depends only on its column, worked out once per frame. */
	const ripple = new Float32Array(SIDES.high);
	return {
		onUpdate(dt) {
			const t = time.now;
			if (!view.userCamera) {
				camera.setPosition(Math.sin(t * 0.1) * 40, 11, Math.cos(t * 0.1) * 40);
				camera.lookAt(TARGET[0], TARGET[1], TARGET[2]);
			}
			view.update(dt);
			view.steer(vec3.set(center, Math.sin(t * 0.3) * 12, 0, Math.sin(t * 0.23) * 9));
			bulb.setPosition(center[0], 5, center[2]);
			for (let i = 0; i < SIDES.high; i++)
				ripple[i] = 1.6 + 0.4 * Math.sin((i - MID) * SPACING * 0.3 + t);
			// Read the arrays in each frame: they are views of engine memory, which moves when it grows.
			const positions = field.positions;
			const scales = field.scales;
			for (let row = 0; row < rows; row++) {
				const x = positions[row * 3];
				const dx = x - center[0];
				const dz = positions[row * 3 + 2] - center[2];
				const wave = Math.sin(Math.sqrt(dx * dx + dz * dz) * 0.4 - t * 2);
				const height = ripple[Math.round(x / SPACING) + MID] + wave;
				positions[row * 3 + 1] = height / 2;
				scales[row * 3 + 1] = height;
			}
		},
	};
});
