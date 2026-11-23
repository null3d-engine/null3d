// Positional sound with @null3d/sound: a thunderstorm on a moor at night. Lightning strikes the moor
// every few seconds, and a click strikes where it lands. Each strike's thunder plays from where it
// struck once sound could have crossed to the camera, at 343 meters a second, so a far strike's
// rumble comes seconds after its flash, quieter and duller with distance. A label at each strike
// counts the seconds and then gives the distance. Near strikes crack and far ones roll, from two
// recordings. The rain fills both ears. A brook winds past a ring of standing stones: a group of
// points along it, of which the mixer plays the nearest three, so the water sounds from the nearest
// stretch as the camera circles. The page's speaker button turns the sound off and on.
import { defineSketch } from '@null3d/engine';
import { createSound } from '@null3d/sound';
import { createRain } from '../addons/weather/index';
import { interact } from '../lib/interact';
import { sampleUrl } from '../lib/samples';
import { brookPoints, buildMoor, moorHeight } from './moor';
import { createStorm, FIRST_STRIKE, SKY, scheduledStrike, seeded } from './storm';

/** How fast sound crosses the air, in meters a second. */
const SPEED_OF_SOUND = 343;
/** The strikes whose thunder can travel at once; a new strike takes the oldest one's place. */
const MOST_STRIKES = 6;
/** Strikes nearer than this crack, and farther ones roll, in meters. */
const CRACK_WITHIN = 700;
/** How long a label stays after its thunder arrives, in seconds. */
const LABEL_STAYS = 3;
/** The camera's circle around the stones: its radius, its height and its pace in radians a second. */
const ORBIT = 30;
const EYE = 6.5;
const PACE = 0.035;
const TARGET = [0, 1, 0] as const;

/** The loops and one-shots that the scene plays, from the sample content. */
const file = (name: string) => sampleUrl(`sources/sound/loops/${name}/${name}.mp3`);

export default defineSketch(async (ctx) => {
	const { scene, post, page, time, ui } = ctx;
	scene.setBackground(SKY);
	scene.setFog({ color: SKY, density: 0.0012 });
	post.set({ exposure: 3.5, bloom: { intensity: 0.8, threshold: 1 }, vignette: {} });

	const ground = buildMoor(ctx);

	const camera = scene.createPerspectiveCamera({
		fov: 55,
		position: [0, EYE, ORBIT],
		target: TARGET,
		far: 8000,
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: TARGET });
	const rain = createRain(ctx, { streaks: 3600, reach: 40 });
	const storm = await createStorm(ctx);

	// The sound: rain in both ears, the brook as a group of points, and the thunder's two one-shots,
	// whose distances fade and muffle a far strike.
	const sound = createSound(ctx, { listener: camera });
	sound.loop({ file: file('rain'), positional: false, level: 0.5 });
	const water = brookPoints(5);
	const brook = sound.group({
		file: file('stream'),
		count: water.length / 3,
		voices: 3,
		near: 3,
		far: 80,
	});
	brook.positions.set(water);
	const crack = sound.shot({ file: file('thunder-near'), near: 250, far: 6000 });
	const roll = sound.shot({ file: file('thunder-far'), near: 900, far: 14_000 });

	// Each strike keeps its place, its time and its label until its thunder has come and gone.
	const strikes = Array.from({ length: MOST_STRIKES }, (_, k) => ({
		id: `strike-${k}`,
		marker: scene.createGroup({ dynamic: true }),
		x: 0,
		y: 0,
		z: 0,
		at: -1,
		heard: false,
		number: 0,
	}));
	let made = 0;
	const label = (id: string, text: string) => page.post('label', { id, text });
	const strike = (x: number, z: number, at = time.now) => {
		const slot = strikes[made % MOST_STRIKES] as (typeof strikes)[number];
		Object.assign(slot, {
			x,
			y: moorHeight(x, z),
			z,
			at,
			heard: false,
			number: made,
		});
		slot.marker.setPosition(x, slot.y, z);
		ui.trackLabel(slot.marker, slot.id, { offset: [0, 60, 0] });
		label(slot.id, '0 s');
		storm.strike(x, slot.y, z, at, made++);
	};
	ground.on('click', (event) => strike(event.point[0], event.point[2]));

	const place = new Float64Array(2);
	const eye = new Float64Array(3);
	let scheduled = 0;
	let nextAt = FIRST_STRIKE;
	return {
		onUpdate(dt) {
			if (!view.userCamera) {
				const turn = time.now * PACE;
				camera.setPosition(Math.sin(turn) * ORBIT, EYE, Math.cos(turn) * ORBIT);
				camera.lookAt(TARGET[0], TARGET[1], TARGET[2]);
			}
			view.update(dt);
			while (time.now >= nextAt) {
				const at = nextAt;
				nextAt += scheduledStrike(scheduled++, place);
				strike(place[0] as number, place[1] as number, at);
			}
		},
		onLateUpdate() {
			camera.getWorldPosition(eye);
			for (const slot of strikes) {
				if (slot.at < 0) continue;
				const since = time.now - slot.at;
				const distance = Math.hypot(
					slot.x - (eye[0] as number),
					slot.y - (eye[1] as number),
					slot.z - (eye[2] as number),
				);
				if (!slot.heard && since * SPEED_OF_SOUND >= distance) {
					// The sound front reaches the camera now: the thunder plays from the strike's place.
					slot.heard = true;
					const shot = distance < CRACK_WITHIN ? crack : roll;
					shot.play(slot.x, slot.y + 120, slot.z, 1, 0.85 + 0.25 * seeded(slot.number, 6));
					label(
						slot.id,
						distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`,
					);
				} else if (!slot.heard && Math.floor(since) > Math.floor(since - time.dt)) {
					// Another whole second has passed since the flash.
					label(slot.id, `${Math.floor(since)} s`);
				} else if (slot.heard && since > distance / SPEED_OF_SOUND + LABEL_STAYS) {
					ui.untrackLabel(slot.id);
					slot.at = -1;
				}
			}
			storm.update(time.now);
			rain.follow(camera);
			sound.update();
		},
	};
});
