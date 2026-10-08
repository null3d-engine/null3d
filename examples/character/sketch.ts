// A character: the KayKit Knight walks a circle, and its speed rises and falls. A 1D blend mixes its
// idle, walk and run clips by speed, and keeps their steps in phase. A second layer, masked to the
// spine and every joint above it, swings the sword now and then while the legs keep walking. A
// 'finished' event fades the swing out. The engine samples and blends the clips on its job workers,
// so the sketch only sets the speed. The sun casts the Knight's skinned shadow.
import { createOrbitControls } from '@null3d/controls';
import { defineSketch } from '@null3d/engine';
import { sampleUrl } from '../lib/samples';

/** The Knight's accessories that it carries: one sword and one shield. */
const KEPT = new Set(['1H_Sword', 'Round_Shield']);
const ACCESSORIES = [
	'1H_Sword',
	'1H_Sword_Offhand',
	'2H_Sword',
	'Badge_Shield',
	'Rectangle_Shield',
	'Round_Shield',
	'Spike_Shield',
];
/** The walk's radius, in meters. */
const RADIUS = 2.5;
/** The highest speed, in meters per second, and how fast the speed rises and falls. */
const TOP = 5;
const RATE = 0.4;
/** Seconds between two sword swings. */
const SWING_EVERY = 4;
const SWING = '1H_Melee_Attack_Chop';
/** Frozen options are read once, so starting a swing allocates nothing. */
const SWING_OPTIONS = Object.freeze({ layer: 1, fade: 0.15, loop: false });
const FADE_OUT = Object.freeze({ fade: 0.25 });

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, time } = ctx;
	scene.setBackground('#8fb3cf');
	scene.createDirectionalLight({
		direction: [-1, -2.5, -1.2],
		intensity: 3,
		castShadows: true,
		shadow: { distance: 30 },
	});
	scene.createAmbientLight({ color: '#dbe8ff', intensity: 0.8 });
	scene.createMesh({
		mesh: geometry.circle({ radius: 60, segments: 64 }),
		material: materials.standard({ color: '#7c9a52' }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});
	const camera = scene.createPerspectiveCamera({ fov: 45, position: [0, 3, 7.5] });
	scene.setActiveCamera(camera);
	const controls = createOrbitControls(ctx, camera, {
		target: [0, 0.5, 0],
		enableDamping: true,
		maxPolarAngle: Math.PI * 0.48,
		minDistance: 3,
		maxDistance: 20,
	});

	const knight = await assets.loadGltf(sampleUrl('sources/characters/kaykit-knight/Knight.glb'));
	const walker = scene.instantiate(knight, { dynamic: true, castShadows: true });
	for (const name of ACCESSORIES) if (!KEPT.has(name)) walker.find(name)?.setVisible(false);
	const animator = walker.animator();
	animator.playBlend({ Idle: 0, Walking_A: 1.4, Running_A: 4.5 });
	animator.setLayerMask(1, 'spine');
	animator.onEvent('finished', (event) => {
		if (event.clip === SWING) animator.stop(SWING, FADE_OUT);
	});

	let swings = 0;
	return {
		onUpdate(dt) {
			// The speed eases between 0 and TOP. The distance walked is its integral, so every frame
			// at the same time puts the Knight in the same place.
			const t = time.now;
			const speed = (TOP / 2) * (1 - Math.cos(RATE * t));
			const angle = ((TOP / 2) * (t - Math.sin(RATE * t) / RATE)) / RADIUS;
			walker.setPosition(Math.cos(angle) * RADIUS, 0, -Math.sin(angle) * RADIUS);
			// The Knight faces +Z, so turn it to face along the circle.
			walker.setRotationEuler(0, angle + Math.PI, 0);
			animator.setBlend(speed);
			if (Math.floor(t / SWING_EVERY) > swings) {
				swings = Math.floor(t / SWING_EVERY);
				animator.play(SWING, SWING_OPTIONS);
			}
			controls.update(dt);
		},
	};
});
