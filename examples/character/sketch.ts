// A character: the KayKit Knight walks a circle in a small courtyard, at a speed that rises and
// falls. A 1D blend mixes its idle, walk and run clips by speed, in step. A second layer, masked to
// the spine and above, swings the sword now and then, and a 'finished' event fades the swing out.
// The engine samples and blends the clips on its job workers, so the sketch only sets the speed.
// The sun casts the Knight's skinned shadow, the sky's light fills the shade, and the cobblestones
// are maps made in code. The pointer leads the Knight: it walks to the point, and runs when far.
import { defineSketch, math, timeOfDay, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';
import { sampleUrl } from '../lib/samples';

/** The Knight's accessories that it leaves behind: it carries one sword and one round shield. */
const HIDDEN = ['1H_Sword_Offhand', '2H_Sword', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield'];
/** The walk's radius, in meters. */
const RADIUS = 2.5;
/** The highest speed, in meters per second, and how fast the speed rises and falls. */
const TOP = 5;
const RATE = 0.4;
/** A led walk's speed for each meter left to walk, up to the highest speed. */
const EAGERNESS = 1.5;
/** Seconds between two sword swings. */
const SWING_EVERY = 4;
const SWING = '1H_Melee_Attack_Chop';
/** Frozen options are read once, so starting a swing allocates nothing. */
const SWING_OPTIONS = Object.freeze({ layer: 1, fade: 0.15, loop: false });
const FADE_OUT = Object.freeze({ fade: 0.25 });
/** Texels along each side of the cobblestone maps, and along each stone. */
const SIZE = 128;
const STONE = 16;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, time } = ctx;
	// The afternoon sun lights the courtyard from the front left, and the sky fills the shade.
	const day = timeOfDay(15, { heading: 0.9 });
	const sky = { intensity: day.skyIntensity };
	scene.setBackground({ sky: { ...day.sky, cloudCoverage: 0.4 } }, sky);
	scene.setEnvironment(await assets.skyEnvironment(), sky);
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 30 } });
	scene.setFog({ color: day.fog.color, density: 0.004, sunGlow: day.fog.sunGlow });
	const look = { bloom: { intensity: 0.1, threshold: 1 }, ao: { radius: 0.4 }, vignette: {} };
	post.set({ exposure: day.exposure, ...look });
	// Cobblestones: rows of rounded stones, each row half a stone along from the last. A stone is
	// high in its middle and falls to its joints. The height shades the color, and its slope tilts
	// the normal map. Each stone takes a shade of its own from the seeded generator.
	math.seed(4);
	const shades = Array.from({ length: (SIZE / STONE) ** 2 }, () => math.randFloat(0.45, 1));
	const [albedo, bumps] = [new Uint8Array(SIZE * SIZE * 4), new Uint8Array(SIZE * SIZE * 4)];
	for (let i = 0; i < SIZE * SIZE; i++) {
		const y = Math.floor(i / SIZE);
		const x = (i % SIZE) + (Math.floor(y / STONE) % 2) * (STONE / 2);
		const [u, v] = [(x % STONE) / STONE - 0.5 + 1e-3, (y % STONE) / STONE - 0.5 + 1e-3];
		// The distance from the middle, in a rounded square, and the height that falls with it.
		const [au, av] = [Math.abs(u), Math.abs(v)];
		const r = (au ** 3 + av ** 3) ** (1 / 3);
		const height = Math.min(1, (0.5 - r) * 5);
		const stone = Math.floor(y / STONE) * (SIZE / STONE) + (Math.floor(x / STONE) % (SIZE / STONE));
		const tone = shades[stone] * (0.3 + 0.7 * Math.max(height, 0)) * math.randFloat(0.9, 1);
		albedo.set([176 * tone, 150 * tone, 118 * tone, 255], i * 4);
		// Where the stone curves down, the normal leans out from its middle.
		const lean = height < 1 ? 1.5 / r ** 2 : 0;
		const [nx, ny] = [lean * Math.sign(u) * au ** 2, lean * Math.sign(v) * av ** 2];
		const k = 127 / Math.hypot(nx, ny, 1);
		bumps.set([128 + k * nx, 128 - k * ny, 128 + k, 255], i * 4);
	}
	const tiled = { width: SIZE, height: SIZE, wrap: 'repeat', mipmaps: true } as const;
	scene.createMesh({
		mesh: geometry.circle({ radius: 60, segments: 64 }),
		// Both faces draw, so the ground stays in view when a pan takes the camera below it.
		material: materials.standard({
			map: textures.fromData({ ...tiled, data: albedo, colorSpace: 'srgb', anisotropy: 8 }),
			normalMap: textures.fromData({ ...tiled, data: bumps }),
			roughness: 0.75,
			doubleSided: true,
			uvTransform: { repeat: [45, 45] },
		}),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});
	// The courtyard's walls on three sides, and a stone pillar at each corner.
	const box = geometry.box();
	const plaster = materials.standard({ color: '#d8c8a8' });
	const stone = materials.standard({ color: '#9a9288' });
	const solid = { castShadows: true, receiveShadows: true };
	const block = (material: typeof stone, x: number, z: number, w: number, h: number, d: number) =>
		scene.createMesh({ mesh: box, material, position: [x, h / 2, z], scale: [w, h, d], ...solid });
	block(plaster, 0, -9, 18, 2, 0.6);
	block(plaster, -9, 0, 0.6, 2, 18);
	block(plaster, 9, 0, 0.6, 2, 18);
	for (const x of [-9, 9]) for (const z of [-9, 9]) block(stone, x, z, 1, 2.8, 1);

	const camera = scene.createPerspectiveCamera({ fov: 45, far: 500, position: [0, 3, 7.5] });
	camera.lookAt(0, 0.5, 0);
	scene.setActiveCamera(camera);
	const limits = { maxPolarAngle: Math.PI * 0.48, minDistance: 3, maxDistance: 20 };
	const lead = { groundY: 0, bounds: [-8, 0, -8, 8, 0, 8] } as const;
	const view = interact(ctx, camera, { target: [0, 0.5, 0], ...limits, ...lead });

	const knight = await assets.loadGltf(sampleUrl('sources/characters/kaykit-knight/Knight.glb'));
	const walker = scene.instantiate(knight, { dynamic: true, castShadows: true });
	for (const name of HIDDEN) walker.find(name)?.setVisible(false);
	const animator = walker.animator();
	animator.playBlend({ Idle: 0, Walking_A: 1.4, Running_A: 4.5 });
	animator.setLayerMask(1, 'spine');
	animator.onEvent('finished', (event) => {
		if (event.clip === SWING) animator.stop(SWING, FADE_OUT);
	});

	// The Knight's place on the circle, and its led walk: where it is, the way it faces, its speed.
	const [at, led] = [vec3.create(), vec3.create()];
	let [heading, pace, swings] = [0, 0, 0];
	return {
		onUpdate(dt) {
			// The speed eases between 0 and TOP. The distance walked is its integral, so every frame
			// at the same time puts the Knight in the same place.
			const t = time.now;
			const speed = (TOP / 2) * (1 - Math.cos(RATE * t));
			const angle = ((TOP / 2) * (t - Math.sin(RATE * t) / RATE)) / RADIUS;
			vec3.set(at, Math.cos(angle) * RADIUS, 0, -Math.sin(angle) * RADIUS);
			view.update(dt);
			const { point, steering } = view;
			if (steering === 0) {
				// A led walk starts from the Knight's place on the circle. The Knight faces +Z.
				vec3.copy(led, at);
				heading = angle + Math.PI;
				pace = speed;
			} else {
				const [dx, dz] = [point[0] - led[0], point[2] - led[2]];
				const left = Math.hypot(dx, dz);
				pace = Math.min(TOP, left * EAGERNESS);
				if (left > 0.1) {
					heading = Math.atan2(dx, dz);
					const step = (pace * dt) / left;
					led[0] += dx * step;
					led[2] += dz * step;
				}
			}
			// Blend from the circle to the led walk, turning the shorter way.
			const turn = heading - angle - Math.PI;
			const shorter = turn - Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
			vec3.lerp(at, at, led, steering);
			walker.setPosition(at[0], at[1], at[2]);
			walker.setRotationEuler(0, angle + Math.PI + shorter * steering, 0);
			animator.setBlend(math.lerp(speed, pace, steering));
			if (Math.floor(t / SWING_EVERY) > swings) {
				swings = Math.floor(t / SWING_EVERY);
				animator.play(SWING, SWING_OPTIONS);
			}
		},
	};
});
