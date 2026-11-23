// Skyway's sound: the hero car's engine, the hover cars that roam the streets and fly the lanes, the
// rain on the city and thunder in a storm. The page's speaker button starts
// it (examples/lib/sound-button.ts).
//
// The hero's engine follows the car: its pitch rises with the car's speed, and it sits close in the
// seat's view. The roamers and the lane cars are groups, of which the add-on's mixer plays the
// nearest few. The roamers' places are the rows that the scene writes for them each frame, copied in
// one call. The lane cars move in their shader, so the lanes give the places of the few cars nearest
// the camera, which their real lights hold. The rain and the thunder fill both ears. From the seat,
// the glass dulls the rain.
import type { Camera, SketchContext } from '@null3d/engine';
import { createSound } from '@null3d/sound';
import type { TrafficLanes } from '../../addons/traffic-lanes/index';
import { sampleUrl } from '../../lib/samples';
import { SOUND_GAIN } from '../../lib/sound-gain';
import type { Hero } from './hero';
import { ROAMERS, type Roamers } from './roamers';

/** The most roamers that fly at once, on the heaviest preset: the size of their batch. */
const MOST_ROAMERS = Math.max(...Object.values(ROAMERS));
/** The lane cars whose places the lanes give: the cars that hold their real lights. */
const LANE_CARS = 6;
/** The hero's speed, in meters a second, at which its engine reaches its highest pitch. */
const TOP_SPEED = 60;
/** The seconds between two thunderclaps in a storm, at the least and at the most. */
const THUNDER_EVERY = [9, 26] as const;

/** Skyway's sound, which the sketch updates once a frame after the camera and the cars move. */
export interface SkywaySound {
	/** Writes the listener, the cars' places and every level. Call it once a frame. */
	update(time: number, rain: boolean, storm: boolean): void;
}

/** The parts of the scene that make sound. Any that a page leaves out stays silent. */
export interface SkywaySoundParts {
	camera: Camera;
	hero: Hero;
	roamers: Roamers | undefined;
	traffic: TrafficLanes | undefined;
}

/** Makes Skyway's sound for the scene's camera and cars. */
export function createSkywaySound(ctx: SketchContext, parts: SkywaySoundParts): SkywaySound {
	const { camera, hero, roamers, traffic } = parts;
	const sound = createSound(ctx, { listener: camera });
	const engine = sound.loop({
		file: sampleUrl('sources/sound/loops/hover/hover.mp3'),
		near: 3,
		far: 200,
	});
	// The cars that pass play a lighter hum than the hero's own engine.
	const passing = sampleUrl('sources/sound/loops/hover-pass/hover-pass.mp3');
	const roaming = sound.group({ file: passing, count: MOST_ROAMERS, voices: 4, near: 4, far: 160 });
	// Each roamer's engine runs at a pitch of its own, so a street of them is not one note.
	for (let k = 0; k < MOST_ROAMERS; k++) roaming.setRate(k, 0.9 + 0.25 * ((k * 0.618034) % 1));
	const lanes = sound.group({ file: passing, count: LANE_CARS, voices: 4, near: 5, far: 200 });
	lanes.rates.fill(1.15);
	lanes.levels.fill(0);
	const lanePlaces = new Float32Array(LANE_CARS * 3);
	/** 1 for each lane slot that holds a car, which is each lane member's level. */
	const laneHeard = new Float32Array(LANE_CARS);

	const rainBed = sound.loop({
		file: sampleUrl('sources/sound/rain/rain.mp3'),
		positional: false,
		level: 0,
	});
	// Thunder is heard across the city and beyond, and falls with distance like the lightning's own air.
	const near = sound.shot({
		file: sampleUrl('sources/sound/thunder-near/thunder-near.mp3'),
		near: 100,
		far: 4000,
	});
	const far = sound.shot({
		file: sampleUrl('sources/sound/thunder-far/thunder-far.mp3'),
		near: 100,
		far: 4000,
	});

	const at = new Float64Array(3);
	/** A seeded draw from 0 to 1, so a storm's thunder falls the same on every run. */
	let seed = 0x5eed;
	const draw = (): number => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
	let nextThunder = Number.POSITIVE_INFINITY;
	return {
		update(time, rain, storm) {
			hero.group.getWorldPosition(at);
			engine.setPosition(at[0] as number, at[1] as number, at[2] as number);
			const pace = Math.min(1, hero.speed / TOP_SPEED);
			engine.setRate(0.8 + 0.55 * pace);
			engine.setLevel(0.55 + 0.45 * pace);

			if (roamers) {
				// The whole batch's rows copy in one call; the roamers past the active count fall silent. The
				// group holds as many members as the batch has rows.
				const active = Math.min(roamers.active, MOST_ROAMERS);
				roaming.positions.set(roamers.places);
				roaming.levels.fill(1, 0, active);
				roaming.levels.fill(0, active);
			}
			if (traffic) {
				traffic.nearest(lanePlaces, laneHeard, time);
				lanes.positions.set(lanePlaces);
				lanes.levels.set(laneHeard);
			}

			// The glass of the seat dulls what lies outside it, and muffles it.
			const inside = hero.view === 'cockpit';
			const sheltered = inside ? 0.55 : 1;
			rainBed.setLevel(rain ? (storm ? 0.85 : 0.6) * sheltered : 0);
			rainBed.setTone(inside ? 0.45 : storm ? 1 : 0.85);
			// A storm rolls thunder now and then, mostly far off, around the camera.
			if (!storm) nextThunder = Number.POSITIVE_INFINITY;
			else if (nextThunder === Number.POSITIVE_INFINITY)
				nextThunder = time + THUNDER_EVERY[0] * draw();
			else if (time >= nextThunder) {
				camera.getWorldPosition(at);
				const bearing = draw() * Math.PI * 2;
				const close = draw() < 0.3;
				const distance = close ? 250 + 250 * draw() : 600 + 900 * draw();
				const shot = close ? near : far;
				shot.play(
					(at[0] as number) + Math.cos(bearing) * distance,
					(at[1] as number) + 200,
					(at[2] as number) + Math.sin(bearing) * distance,
					(close ? 0.6 : 0.45 + 0.15 * draw()) *
						(close ? SOUND_GAIN.thunderNear : SOUND_GAIN.thunderFar),
					0.9 + 0.2 * draw(),
				);
				nextThunder = time + THUNDER_EVERY[0] + (THUNDER_EVERY[1] - THUNDER_EVERY[0]) * draw();
			}
			sound.update();
		},
	};
}
