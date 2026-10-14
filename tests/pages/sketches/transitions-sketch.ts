// Prototype A4: Knights that switch between a walk and a run while standing in one line. The left
// half cross-fades the two clips, as three.js does; the right half switches with an inertial
// transition, which samples only the new clip. Every Knight starts its walk at the same time and
// switches at the same moments, so a pair across the line shows the same step: a cross-fade passes
// through a pose that is half of each gait, where the feet slide, and an inertial transition
// carries the outgoing pose into the new clip without mixing them.
//
// `?transition=blend` and `?transition=inertial` show those Knights alone; without it, both halves.
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

/** The Knights, the space between them, and the seconds each gait lasts. */
const HALF = 3;
const SPACING = 1.7;
const SWITCH_EVERY = 1.6;
const FADE = 0.5;

/** `?transition=blend|inertial` shows that half alone; without it, the blend left, inertial right. */
const ONE = new URL(import.meta.url).searchParams.get('transition');
const MODES: readonly ('blend' | 'inertial')[] =
	ONE === 'blend' || ONE === 'inertial'
		? new Array(HALF).fill(ONE)
		: [...new Array(HALF).fill('blend'), ...new Array(HALF).fill('inertial')];

/** Frozen options: the inertial switch and the cross-fade, which allocate nothing to reuse. */
const TO_RUN = Object.freeze({ fade: FADE, transition: 'inertial' as const });
const TO_WALK = Object.freeze({ fade: FADE, transition: 'inertial' as const });
const CROSS_FADE = Object.freeze({ fade: FADE });

export default defineSketch(async ({ scene, assets, geometry, materials, time }) => {
	const knight = await assets.loadGltf('/samples/sources/characters/kaykit-knight/Knight.glb');
	scene.setBackground('#8fa4b8');
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: 0.8 });
	const count = MODES.length;
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 40,
			near: 0.1,
			far: 100,
			position: [3.5, 2.1, 8],
			target: [0, 0.95, 0],
		}),
	);
	scene.createDirectionalLight({ direction: [-1, -2.5, -1], intensity: 2.5 });
	scene.createMesh({
		mesh: geometry.box({ width: count * SPACING + 8, height: 0.2, depth: 12 }),
		material: materials.standard({ color: '#7d8b6c', roughness: 1 }),
		position: [0, -0.1, 0],
		receiveShadows: true,
	});

	const characters: Object3D[] = [];
	const animators: Animator[] = [];
	for (let i = 0; i < count; i++) {
		const character = scene.instantiate(knight, {
			dynamic: true,
			castShadows: true,
			receiveShadows: true,
		});
		for (const name of REMOVED) character.find(name)?.destroy();
		character.setPosition((i - (count - 1) / 2) * SPACING, 0, 0);
		animators.push(character.animator());
		characters.push(character);
	}
	// Every Knight starts its walk at the same moment, so a step falls at the same time in all.
	for (const animator of animators) animator.play(WALK);
	const phase = characters.map(() => 0);
	const switchGait = (i: number): void => {
		const toRun = phase[i] === 0;
		if (MODES[i] === 'inertial') animators[i]?.play(toRun ? RUN : WALK, toRun ? TO_RUN : TO_WALK);
		else animators[i]?.play(toRun ? RUN : WALK, CROSS_FADE);
		phase[i] = toRun ? 1 : 0;
	};
	let nextSwitch = SWITCH_EVERY;
	return {
		onUpdate() {
			if (time.now >= nextSwitch) {
				nextSwitch += SWITCH_EVERY;
				for (let i = 0; i < count; i++) switchGait(i);
			}
		},
	};
});
