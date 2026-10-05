// The null3d version of S5, the crowd: copies of the optimized KayKit Knight walk in rings on a lit
// ground, each blending a walk with a run by clip weights, under a sun that casts shadows. The
// engine samples and blends every character's clips on its job workers, and skins them on the GPU.
// The engine runs it with the quality preset that it chooses, as S4 does.
//
// Feature: an environment light. S5 lights its crowd with the sun and an ambient light until the
// engine draws environment maps. The pull request that builds them adds the environment here and
// to the three.js twin, and makes S5's image references again.
//
// With `?demo`, the page is the playable demo: the stats overlay shows the frame's phases, the GPU
// path and the preset; dragging turns the camera around the crowd, the wheel or a pinch zooms, and
// Space pauses and resumes the crowd.
import { createOrbitControls } from '@null3d/controls';
import { type Animator, defineSketch, type Object3D } from '@null3d/engine';
import {
	createS5,
	S5_BACKGROUND,
	S5_CHARACTER,
	S5_DEFAULT_COUNT,
	S5_GROUND,
	S5_ORBIT,
	S5_VIEW_LIGHTS,
	s5Camera,
	s5CharactersAt,
} from '../../scenes/s5';
import { S5_MODEL_URL } from '../lib/s5-model';
import { followPath, readCount, readGovernor, setUpView, watchQuality } from './sketch-common';

export default defineSketch(async (context) => {
	const { scene, materials, geometry, assets, time, input, debug } = context;
	const demo = new URL(import.meta.url).searchParams.has('demo');
	// S5 measures how a preset holds its frame rate with a crowd, so it keeps the preset's render
	// scale range and the quality governor, as S4 does. A comparison of two builds turns the
	// governor off.
	const camera = setUpView(context, S5_VIEW_LIGHTS, S5_BACKGROUND, { dynamicResolution: true });
	context.quality.set({ governor: readGovernor(import.meta.url) });
	const reportQuality = watchQuality(context);

	const { size, thickness, color, roughness } = S5_GROUND;
	scene.createMesh({
		mesh: geometry.box({ width: size, height: thickness, depth: size }),
		material: materials.standard({ color, roughness, metalness: 0 }),
		position: [0, -thickness / 2, 0],
		receiveShadows: true,
	});

	const data = createS5(readCount(import.meta.url) || S5_DEFAULT_COUNT);
	const knight = await assets.loadGltf(S5_MODEL_URL);
	const characters: Object3D[] = [];
	const animators: Animator[] = [];
	for (let i = 0; i < data.count; i++) {
		const character = scene.instantiate(knight, {
			name: `knight${i}`,
			dynamic: true,
			castShadows: true,
			receiveShadows: true,
		});
		for (const name of S5_CHARACTER.removed) character.find(name)?.destroy();
		// The walk and the run play side by side, at weights that add up to 1, from the character's
		// start time: the three.js twin's two actions with their time and effective weight.
		const animator = character.animator();
		const run = data.weight[i] as number;
		const time = data.start[i] as number;
		animator.play(S5_CHARACTER.walk, { time, weight: 1 - run });
		animator.play(S5_CHARACTER.run, { time, weight: run });
		animator.setTimeScale(data.rate[i] as number);
		characters.push(character);
		animators.push(animator);
	}

	// The characters move in a function of their own that takes no fraction, so the browser
	// allocates nothing for its call whether it inlines it or not. The time reaches it in `clock`.
	const clock = new Float64Array(1);
	const positions = new Float64Array(data.count * 3);
	const rotations = new Float64Array(data.count * 4);
	const moveCharacters = (): void => {
		s5CharactersAt(data, clock, positions, rotations);
		for (let i = 0; i < data.count; i++) {
			const character = characters[i] as Object3D;
			character.setPosition(
				positions[i * 3] as number,
				positions[i * 3 + 1] as number,
				positions[i * 3 + 2] as number,
			);
			character.setRotation(
				rotations[i * 4] as number,
				rotations[i * 4 + 1] as number,
				rotations[i * 4 + 2] as number,
				rotations[i * 4 + 3] as number,
			);
		}
	};

	if (demo) return playable();
	const moveCamera = followPath(camera, (t, position, target) =>
		s5Camera(data, t, position, target),
	);
	const pose = (t: number): void => {
		clock[0] = t;
		moveCharacters();
		moveCamera(t);
	};
	pose(time.now);
	return {
		onUpdate() {
			pose(time.now);
			reportQuality();
		},
	};

	/** The demo: the stats overlay, a camera that the pointer turns, and a crowd that Space pauses. */
	function playable() {
		debug.stats(true);
		const start = new Float64Array(3);
		s5Camera(data, 0, start, new Float64Array(3));
		camera.setPosition(start[0] as number, start[1] as number, start[2] as number);
		const controls = createOrbitControls(context, camera, {
			target: [0, S5_ORBIT.lookHeight, 0],
			enableDamping: true,
			maxPolarAngle: 1.45,
		});
		clock[0] = 0;
		let paused = false;
		moveCharacters();
		return {
			onUpdate() {
				if (input.wasPressed('Space')) {
					paused = !paused;
					for (let i = 0; i < animators.length; i++)
						(animators[i] as Animator).setTimeScale(paused ? 0 : (data.rate[i] as number));
				}
				if (!paused) {
					clock[0] = (clock[0] as number) + time.dt;
					moveCharacters();
				}
				controls.update(time.dt);
				reportQuality();
			},
		};
	}
});
