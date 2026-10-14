// Prototype A4: a row of Knights that switch between a walk and a run. Every character walks for
// a while, switches to a run with a fade, then switches back, so both transitions run often. The
// URL picks which one: `?transition=inertial` samples only the new clip, anything else (or
// `?transition=blend`) cross-fades the two, which is what three.js does. Compare the two by eye on
// the feet: a cross-fade passes through a pose that is half of each gait, where the feet slide.
import { type Animator, defineSketch, type Object3D } from '@null3d/engine';

/** The Knight's walk and run clips, and the accessories it leaves behind. */
const WALK = 'Walking_A';
const RUN = 'Running_B';
const REMOVED = [
	'1H_Sword_Offhand',
	'2H_Sword',
	'Badge_Shield',
	'Rectangle_Shield',
	'Spike_Shield',
];

/** The characters, the space between them, and the seconds each gait lasts. */
const COUNT = 8;
const SPACING = 1.6;
const SWITCH_EVERY = 1.6;
const FADE = 0.5;

/** Ground speeds in meters per second: a walk and a run, as S5's characters use. */
const SPEEDS = { walk: 1.5, run: 4 } as const;

/** `?transition=inertial` switches with an inertial transition; `blend` cross-fades. */
const TRANSITION = new URL(import.meta.url).searchParams.get('transition') ?? 'blend';

/** Frozen options for each switch, so a switch allocates nothing. */
const TO_RUN = Object.freeze({ fade: FADE, transition: 'inertial' as const });
const TO_WALK = Object.freeze({ fade: FADE, transition: 'inertial' as const });
const CROSS_FADE = Object.freeze({ fade: FADE });

export default defineSketch(async ({ scene, assets, geometry, materials, time }) => {
	const knight = await assets.loadGltf('/samples/sources/characters/kaykit-knight/Knight.glb');
	scene.setBackground('#8fa4b8');
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: 0.8 });
	const camera = scene.createPerspectiveCamera({
		fov: 40,
		near: 0.1,
		far: 100,
		position: [10, 3.5, 12],
		target: [0, 1, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2.5, -1], intensity: 2.5 });
	scene.createMesh({
		mesh: geometry.box({ width: COUNT * SPACING + 10, height: 0.2, depth: 60 }),
		material: materials.standard({ color: '#7d8b6c', roughness: 1 }),
		position: [0, -0.1, 0],
		receiveShadows: true,
	});

	const characters: Object3D[] = [];
	const animators: Animator[] = [];
	for (let k = 0; k < COUNT; k++) {
		const character = scene.instantiate(knight, {
			name: `knight${k}`,
			dynamic: true,
			castShadows: true,
			receiveShadows: true,
		});
		for (const name of REMOVED) character.find(name)?.destroy();
		character.setPosition((k - (COUNT - 1) / 2) * SPACING, 0, 0);
		character.setRotationEuler(0, Math.PI, 0);
		animators.push(character.animator());
		characters.push(character);
	}
	for (const animator of animators) animator.play(WALK);
	// Each character switches on its own phase, so a walk and a run share the screen.
	const phase: number[] = new Array(COUNT).fill(0);
	const z: number[] = new Array(COUNT).fill(0);
	for (let k = 0; k < COUNT; k++) z[k] = -((k * 3) % 12);
	const switchGait = (k: number): void => {
		const toRun = phase[k] === 0;
		if (TRANSITION === 'inertial') animators[k]?.play(toRun ? RUN : WALK, toRun ? TO_RUN : TO_WALK);
		else animators[k]?.play(toRun ? RUN : WALK, CROSS_FADE);
		phase[k] = toRun ? 1 : 0;
	};
	let nextSwitch = SWITCH_EVERY;
	return {
		onUpdate(dt) {
			for (let k = 0; k < COUNT; k++) {
				const speed = phase[k] === 1 ? SPEEDS.run : SPEEDS.walk;
				z[k] = (z[k] as number) + speed * dt;
				if ((z[k] as number) > 14) z[k] = -14;
				characters[k]?.setPosition((k - (COUNT - 1) / 2) * SPACING, 0, z[k] as number);
			}
			if (time.now >= nextSwitch) {
				nextSwitch += SWITCH_EVERY;
				for (let k = 0; k < COUNT; k++) switchGait(k);
			}
		},
	};
});
