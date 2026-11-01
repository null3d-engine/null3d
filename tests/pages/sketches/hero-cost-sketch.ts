// The hero shadow's cost scene: the hero demo's car on the demo's yard, under the demo's low sun,
// with stone blocks around the pad whose shadows come from the cascades. ?moving makes the car cross
// the pad in every frame, so the sun's hero tile draws in every frame; without it the car stands
// still, and the tile draws once and then rests.
//
// The hero cost page passes ?fixed, ?scale= and ?tile=: the scene then draws at that render scale
// alone, with the hero tile at that size or the preset's, with the governor off, and starts with
// the hero off. On the page's 'hero' message it names the car's body as the hero, waits until its
// pipelines are built, and posts 'settled'. 'hero-off' turns the hero off again.
//
// The sky, the environment and the post effects are left out, because they draw the same on both
// sides and only add noise. The sun, the car, the yard and the stones are the demo's.
import { defineSketch, math, timeOfDay } from '@null3d/engine';
import { car } from '../../../examples/hero-shadow/car';

const params = new URL(import.meta.url).searchParams;
const MOVING = params.has('moving');
const FIXED = params.has('fixed');
const SCALE = Number(params.get('scale') ?? 1);
/** The hero tile size to time, or 0 for the preset's default. */
const TILE = Number(params.get('tile') ?? 0) as 0 | 1024 | 2048 | 4096;
/** The hour of the light, a low sun before sunset, and the sun's heading across the yard. */
const HOUR = 17.3;
const HEADING = -2.1;
/** What the camera looks at, and where it stands on a wide screen. */
const TARGET = [0, 0.6, 0] as const;
const EYE = [4.2, 2.4, 6.4] as const;
/** The meters the car travels each way, and the seconds of a full crossing. */
const TRAVEL = 0.9;
const CROSSING = 4;

export default defineSketch((ctx) => {
	const { scene, geometry, materials, quality, page, time } = ctx;
	quality.set({ governor: false });
	if (FIXED) quality.set({ minRenderScale: SCALE, maxRenderScale: SCALE });
	const day = timeOfDay(HOUR);
	const [sx, rise, sz] = day.sky.sunPosition;
	const reach = Math.hypot(sx, sz);
	scene.setBackground('#9fb4c8');
	scene.createAmbientLight({ color: '#c8d8ff', intensity: 0.5 });

	const camera = scene.createPerspectiveCamera({ fov: 42, near: 0.05, far: 1000 });
	camera.setPosition(...EYE);
	camera.lookAt(...TARGET);
	scene.setActiveCamera(camera);

	// The sun keeps the hour's height, with its heading across the yard.
	const sun = scene.createDirectionalLight({
		...day.light,
		direction: [-Math.sin(HEADING) * reach, -rise, -Math.cos(HEADING) * reach],
		castShadows: true,
		shadow: { distance: 60 },
	});

	const yard = materials.standard({ color: '#9a958c', roughness: 0.85 });
	const stone = materials.standard({ color: '#7d7a72', roughness: 0.9 });
	scene.createMesh({
		mesh: geometry.box({ width: 40, height: 0.2, depth: 40 }),
		material: yard,
		position: [0, -0.1, 0],
		receiveShadows: true,
	});

	// Stone blocks around the pad, far enough that the car's tile holds none of them. Their
	// shadows come from the cascades, which the hero's sharp one shows against.
	math.seed(11);
	for (let k = 0; k < 7; k++) {
		const angle = (k / 7) * Math.PI * 2 + 0.4;
		const distance = math.randFloat(5.5, 8);
		const size = math.randFloat(0.6, 1.3);
		const block = scene.createMesh({
			mesh: geometry.box({ width: size, height: size * 1.4, depth: size }),
			material: stone,
			position: [Math.sin(angle) * distance, size * 0.7, Math.cos(angle) * distance],
			castShadows: true,
			receiveShadows: true,
		});
		block.setRotationEuler(0, math.randFloat(0, Math.PI), 0);
	}

	const group = scene.createGroup({ position: [0, 0, 0] });
	const body = car(ctx, group);

	page.onMessage((message) => {
		if (message === 'hero-off') {
			sun.setHeroShadow(null);
			page.post('settled', quality.preset);
			return;
		}
		if (message !== 'hero') return;
		sun.setHeroShadow(body, TILE || undefined);
		// Two warm-ups: the first builds the hero's pipelines, and the second passes a frame with
		// the tile held, so a still car's single tile draw does not land in the measured seconds.
		void scene
			.warmUp()
			.then(() => scene.warmUp())
			.then(() => page.post('settled', quality.preset));
	});

	return {
		onUpdate() {
			if (!MOVING) return;
			group.setPosition(TRAVEL * Math.sin((time.now / CROSSING) * Math.PI * 2), 0, 0);
		},
	};
});
