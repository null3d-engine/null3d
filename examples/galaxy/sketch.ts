// Points: a spiral galaxy of 120,000 stars in one points batch, and 30,000 on phones. Each star is
// a soft round point whose color comes from its place: a gold core, blue-white arms and a few red
// giants. The colors are brighter than white, so the additive blend and the bloom make the core
// glow. The sketch splits the stars into rings by their distance, turns each ring by its own
// angle, and writes the batch's position array in each frame: the galaxy turns, and its inner
// rings sway ahead of the outer ones and back, so the arms swirl without winding up.
import { defineSketch, math } from '@null3d/engine';
import { interact } from '../lib/interact';

/** Stars, the galaxy's radius, its arms and how far they wind, and the rings that turn together. */
const STARS = 120_000;
const [RADIUS, ARMS, WIND, RINGS] = [12, 3, 0.45, 48];
/** The stars that each preset draws, as the instances demo does with its columns. */
const DRAWN = { low: 30_000, medium: 80_000, high: STARS, ultra: STARS };

export default defineSketch(async (ctx) => {
	const { scene, textures, post, quality, time } = ctx;
	scene.setBackground('#010103');
	post.set({ bloom: { intensity: 0.5, threshold: 0.8 }, vignette: { intensity: 0.8 } });
	const camera = scene.createPerspectiveCamera({ fov: 45, far: 500, position: [0, 9, 22] });
	camera.lookAt(0, 0, 0);
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 0, 0], minDistance: 4, maxDistance: 60 });

	// A soft round spot: white, with an alpha that falls off from the middle.
	const spot = new Uint8Array(32 * 32 * 4).fill(255);
	for (let i = 0; i < 32 * 32; i++) {
		const r = Math.hypot((i % 32) - 15.5, Math.floor(i / 32) - 15.5) / 16;
		spot[i * 4 + 3] = 255 * Math.max(0, 1 - r) ** 2;
	}
	const map = textures.fromData({
		width: 32,
		height: 32,
		data: spot,
		colorSpace: 'srgb',
		mipmaps: true,
	});
	const glow = { map, alphaMode: 'blend', blending: 'additive', depthWrite: false } as const;

	// Each star: a distance that thins out from the core, an arm, and a scatter around the arm that
	// grows with the distance. The disc is thin, and the core is a bulge.
	math.seed(5);
	const [start, colors] = [new Float32Array(STARS * 3), new Float32Array(STARS * 3)];
	const rings = new Uint16Array(STARS);
	for (let s = 0; s < STARS; s++) {
		const r = -Math.log(1 - math.random() * (1 - Math.exp(-1 / 0.28))) * RADIUS * 0.28;
		const arm = (s % ARMS) * ((2 * Math.PI) / ARMS);
		const spread = (math.random() - 0.5) * (0.25 + r * 0.06) * 2;
		const angle = arm + r * WIND + spread + (math.random() < 0.15 ? math.random() * 6.3 : 0);
		const bulge = Math.exp(-r * 0.6) * 1.2 + 0.12;
		start.set([Math.cos(angle) * r, (math.random() - 0.5) * bulge, Math.sin(angle) * r], s * 3);
		rings[s] = Math.min(RINGS - 1, Math.floor((r / RADIUS) * RINGS)) * 2;
		// Gold in the core, blue-white in the arms, and a red giant now and then.
		const core = Math.exp(-r * 0.5);
		const red = math.random() < 0.02;
		const shine = 0.6 + 1.4 * core + (math.random() < 0.01 ? 4 : 0);
		const [cr, cg, cb] = red
			? [2.2, 0.5, 0.35]
			: [math.lerp(0.55, 1.6, core), math.lerp(0.7, 1.1, core), math.lerp(1.3, 0.5, core)];
		colors.set([cr * shine, cg * shine, cb * shine], s * 3);
	}
	const stars = await scene.createPoints({
		positions: start,
		colors,
		size: 0.07,
		dynamic: true,
		...glow,
	});

	// A far sky of faint stars, a pixel or two wide, that never move.
	const sky = new Float32Array(4000 * 3);
	for (let s = 0; s < sky.length; s += 3) {
		const [u, v] = [math.random() * 2 - 1, math.random() * 2 * Math.PI];
		sky.set(
			[Math.sqrt(1 - u * u) * Math.cos(v) * 300, u * 300, Math.sqrt(1 - u * u) * Math.sin(v) * 300],
			s,
		);
	}
	await scene.createPoints({
		positions: sky,
		size: 2,
		sizeAttenuation: false,
		color: '#8a90a8',
		fog: false,
	});

	let drawn = 0;
	const fit = () => {
		drawn = DRAWN[quality.preset];
		stars.setActiveCount(drawn);
	};
	fit();
	quality.onChange(fit);
	// Each ring's turn in this frame, as a cosine and a sine.
	const turns = new Float32Array(RINGS * 2);
	return {
		onUpdate(dt) {
			if (!view.userCamera) {
				// The camera circles the galaxy slowly, and rises and sinks.
				const a = time.now * 0.05;
				camera.setPosition(Math.sin(a) * 22, 7 + 3 * Math.sin(time.now * 0.11), Math.cos(a) * 22);
				camera.lookAt(0, 0, 0);
			}
			view.update(dt);
			// The whole galaxy turns, and each ring sways by a share that falls with its distance.
			const sway = Math.sin(time.now * 0.3);
			for (let k = 0; k < RINGS; k++) {
				const angle = -time.now * 0.06 - sway * 0.6 * (1 - k / RINGS) ** 2;
				turns[k * 2] = Math.cos(angle);
				turns[k * 2 + 1] = Math.sin(angle);
			}
			const out = stars.positions;
			for (let s = 0; s < drawn; s++) {
				const c = turns[rings[s]];
				const n = turns[rings[s] + 1];
				const x = start[s * 3];
				const z = start[s * 3 + 2];
				out[s * 3] = x * c - z * n;
				out[s * 3 + 1] = start[s * 3 + 1];
				out[s * 3 + 2] = x * n + z * c;
			}
		},
	};
});
