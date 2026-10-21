// Multiple views: one scene, drawn from two cameras in the same frame. The left half draws from a
// camera high over a sunlit courtyard, and the right half from a camera low among the stones. The
// camera's own view fills the canvas first, and each view covers its half of it, with its own
// culling and its own lens shape. The Layout button or the V key switches to a picture in picture:
// the wide camera over the canvas, and the low camera in a small rectangle at its top right.
import { defineSketch, type Material, math, timeOfDay } from '@null3d/engine';
import { interact } from '../lib/interact';

/** The cameras' rectangles: the two halves of a split screen, or the full canvas and an inset. */
const SPLIT = [
	[0, 0, 0.5, 1],
	[0.5, 0, 0.5, 1],
] as const;
const INSET = [0.7, 0.03, 0.27, 0.27] as const;
/** The stones of the courtyard's ring. */
const STONES = 9;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, time, input, page } = ctx;
	const day = timeOfDay(17.2, { heading: 0.8 });
	const sky = { ...day.sky, cloudCoverage: 0.3 };
	scene.setBackground({ sky }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity });
	scene.setFog({ color: day.fog.color, density: 0.01, sunGlow: day.fog.sunGlow });
	post.set({ exposure: day.exposure, bloom: { threshold: 1 }, ao: {}, vignette: {} });
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 40 } });

	// Two cameras on one scene: a high, wide one that shows the ring, and a low one that looks
	// through it, so each view frames the courtyard in its own way.
	const wide = scene.createPerspectiveCamera({
		fov: 50,
		far: 500,
		position: [-11, 8, 2],
		target: [0, 1, 0],
	});
	scene.setActiveCamera(wide);
	const low = scene.createPerspectiveCamera({
		fov: 70,
		far: 500,
		position: [-1.8, 1.3, 2.6],
		target: [1.2, 1.6, -1],
	});
	const orbit = interact(ctx, wide, { target: [0, 1, 0], maxPolarAngle: Math.PI * 0.47 });

	// A pavement of warm flags, each flag its own shade, with darker joints between.
	math.seed(7);
	const data = new Uint8Array(64 * 64 * 4).fill(255);
	for (let y = 0; y < 64; y++)
		for (let x = 0; x < 64; x++) {
			const joint = x % 16 === 0 || y % 16 === 0;
			const shade = joint ? 0.42 : 0.78 + (0.14 * ((x * 7 + y * 13) % 5)) / 4;
			data.set([230 * shade, 205 * shade, 172 * shade, 255], (y * 64 + x) * 4);
		}
	const flags = materials.standard({
		map: textures.fromData({ data, width: 64, height: 64, colorSpace: 'srgb', mipmaps: true }),
		uvTransform: { repeat: [20, 20] },
		roughness: 0.9,
	});
	scene.createMesh({
		mesh: geometry.plane({ width: 40, height: 40 }),
		material: flags,
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	// A ring of standing stones in three warm sandstones, each cut as a tall slab, and a low dais
	// under them that catches the sun.
	const sand = (color: string): Material => materials.standard({ color, roughness: 0.85 });
	const tones = [sand('#d8b98a'), sand('#c9a273'), sand('#e6cba0')];
	const slab = geometry.box({ width: 1.1, height: 3.4, depth: 0.55 });
	for (let i = 0; i < STONES; i++) {
		const angle = (i / STONES) * Math.PI * 2;
		const radius = 4.2;
		const stone = scene.createMesh({
			mesh: slab,
			material: tones[i % tones.length] as Material,
			position: [Math.cos(angle) * radius, 1.7, Math.sin(angle) * radius],
			castShadows: true,
			receiveShadows: true,
		});
		stone.setRotationEuler(math.randFloat(-0.06, 0.06), -angle, 0);
	}
	scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 1.6, radiusBottom: 1.8, height: 0.5 }),
		material: tones[0] as Material,
		position: [0, 0.25, 0],
		castShadows: true,
		receiveShadows: true,
	});
	// A brass orb on the dais, so the low camera has a bright point to look at, and the wide one a
	// highlight that its bloom picks up.
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.55 }),
		material: materials.standard({ color: '#e8c27a', metalness: 1, roughness: 0.25 }),
		position: [0, 1.05, 0],
		castShadows: true,
	});

	// The views: the left and right halves, or the wide camera over the canvas and the low one in
	// a small rectangle.
	let inset = false;
	let views = SPLIT.map((rect) => scene.createView({ camera: rect[0] === 0 ? wide : low, rect }));
	const layout = () => {
		for (const view of views) view.destroy();
		views = inset
			? [scene.createView({ camera: low, rect: INSET })]
			: SPLIT.map((rect) => scene.createView({ camera: rect[0] === 0 ? wide : low, rect }));
	};
	input.actions.define({ layout: ['KeyV'] });
	page.onMessage((name, value) => {
		if (name !== 'layout') return;
		inset = value === 'Inset';
		layout();
	});

	return {
		onUpdate(dt) {
			// The wide camera drifts around the ring until the user takes it, so both views move.
			if (!orbit.userCamera) {
				const t = time.now * 0.12;
				wide.setPosition(Math.cos(t) * -11, 8, Math.sin(t) * 11 + 2);
				wide.lookAt(0, 1, 0);
			}
			orbit.update(dt);
			if (input.wasPressed('layout')) {
				inset = !inset;
				layout();
			}
		},
	};
});
