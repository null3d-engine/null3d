// Automatic exposure: a walk from a sunny courtyard into a dark stone hall and back. The camera's
// exposure suits the courtyard, so the hall starts almost black; then the eye opens, over a few
// seconds, and the lamps, the columns and the golden sphere come out of the dark. Turned toward
// the door, the courtyard outside blazes white until the eye closes again, faster, as eyes do. The
// meter runs on the GPU in each frame. Press E to turn automatic exposure off and on, and see the
// fixed exposure the camera would have.
import { defineSketch, math, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';
import { buildHall, HALL } from './hall';

/** A point toward the sun: high in the afternoon, behind the camera's walk in. */
const SUN = [0.45, 0.62, 0.65] as const;
/** The walk's turns: walk in, turn round, walk out, turn back, in seconds each. */
const LEGS = [7, 3, 7, 3] as const;
const LOOP = LEGS[0] + LEGS[1] + LEGS[2] + LEGS[3];
/** Where the walk starts, out in the courtyard, and where it turns, deep in the hall. */
const [OUTSIDE, INSIDE] = [16, HALL.back + 9];
const EYE = 1.7;
/** The eye: it adapts to scenes from 7 stops darker than the sun's exposure to 1 brighter. */
const EYES = { minEv: -7, maxEv: 1, speedUp: 2.5, speedDown: 0.8, centerWeight: 0.6 } as const;

export default defineSketch(async (ctx) => {
	const { scene, assets, post, time, input } = ctx;
	scene.setBackground({
		sky: { sunPosition: SUN, turbidity: 4, rayleigh: 1.2, cloudCoverage: 0.25, time: 0 },
	});
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.2 });
	scene.setFog({ color: '#c9d6e4', density: 0.004 });
	post.set({
		toneMapping: 'agx',
		bloom: { intensity: 0.15, threshold: 1 },
		ao: { radius: 0.6 },
		vignette: { intensity: 0.5 },
		autoExposure: EYES,
	});
	scene.createDirectionalLight({
		direction: [-SUN[0], -SUN[1], -SUN[2]],
		color: '#fff1dc',
		intensity: 4,
		castShadows: true,
		shadow: { distance: 60 },
	});
	scene.createAmbientLight({ color: '#9fb4d8', intensity: 0.06 });
	buildHall(ctx);

	const camera = scene.createPerspectiveCamera({
		fov: 60,
		near: 0.1,
		far: 5000,
		position: [0, EYE, OUTSIDE],
	});
	scene.setActiveCamera(camera);
	const target = vec3.set(vec3.create(), 0, EYE, 0);
	const view = interact(ctx, camera, { target, maxDistance: 30 });
	const eye = vec3.create();
	let adapting = true;

	return {
		onUpdate(dt) {
			if (input.wasPressed('KeyE')) {
				adapting = !adapting;
				post.set({ autoExposure: adapting ? EYES : false });
			}
			if (!view.userCamera) {
				// Where the walk is: the share of each leg done, eased so each leg starts and stops
				// gently, and the way the camera faces, 0 into the hall and 1 out.
				let t = time.now % LOOP;
				let leg = 0;
				for (const length of LEGS) {
					if (t <= length) break;
					t -= length;
					leg++;
				}
				const done = math.smoothstep(t / (LEGS[leg] ?? 1), 0, 1);
				const going = leg < 2 ? 1 : 0;
				const z =
					leg % 2 === 0
						? math.lerp(going ? OUTSIDE : INSIDE, going ? INSIDE : OUTSIDE, done)
						: going
							? INSIDE
							: OUTSIDE;
				const facing = leg % 2 === 0 ? 1 - going : going ? done : 1 - done;
				const turn = facing * Math.PI;
				vec3.set(eye, 0, EYE + 0.03 * Math.sin(time.now * 7), z);
				vec3.set(target, eye[0] + 6 * Math.sin(turn), EYE, eye[2] - 6 * Math.cos(turn));
				camera.setPosition(eye[0], eye[1], eye[2]);
				camera.lookAt(target[0], target[1], target[2]);
			}
			view.update(dt);
		},
	};
});
