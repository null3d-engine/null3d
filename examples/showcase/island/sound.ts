// The island's sound: the sea all round it, the surf on the bay's beach, the wind, and the leaves of
// the woods. The page's speaker button starts it (examples/lib/sound-button.ts).
//
// The sea and the surf come from places. Each is a group of points along the water, of which the
// add-on's mixer plays the nearest few, so the sound comes from the nearest stretch of sea or beach
// and passes from one to the next as the camera moves, with no search in a frame. The sea's points
// stand offshore all round the island, and the surf's stand just past the bay's waterline. Far out at
// sea the water surrounds the camera, so a second copy of the sea that fills both ears rises with
// the distance from the shore.
//
// The wind and the leaves fill both ears, and their levels come from the scene where the camera
// stands. The wind follows the air's speed at the camera, which the wind add-on works out, and rises
// with the camera's height and over open water, where nothing shelters it. The leaves follow the
// trees around the camera and the wind that moves them, and fade as the camera climbs above the
// woods, past the reach where the trees sway.
import type { Camera, SketchContext } from '@null3d/engine';
import { createSound, type Sound, type SoundLoop } from '@null3d/sound';
import type { Wind } from '@null3d/wind';
import { sampleUrl } from '../../lib/samples';
import { groundHeight } from './ground';
import { BAY, beachShare, inland, SEA_LEVEL } from './island';
import { canopyAt } from './plan';

/** The directions from the island's middle that the sea's points stand along. */
const SEA_POINTS = 48;
/** How far out from the shore the sea's points stand, in meters. */
const SEA_OFFSHORE = 60;
/** The points along the bay's beach that the surf comes from. */
const SURF_POINTS = 28;
/** How far past the waterline the surf's points stand, where the breakers run, in meters. */
const SURF_OFFSHORE = 18;
/** The wind's speed, in meters a second, at which the wind and the leaves reach their full level. */
const FULL_WIND = 9;
/** The wind's speed before the wind add-on runs: its steady wind. */
const STEADY_WIND = 4;

/** A smooth step from 0 at `low` to 1 at `high`. */
function smoothstep(low: number, high: number, value: number): number {
	const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
	return t * t * (3 - 2 * t);
}

/** A point `offshore` meters out at sea along a ray from the island's middle, or null if none. */
function offshoreAlong(angle: number, offshore: number): [number, number] | null {
	const dx = Math.cos(angle);
	const dz = Math.sin(angle);
	// The shore field reads true within the ground's square, so the march stays inside it.
	for (let r = 0; r < 880; r += 4) {
		const x = dx * r;
		const z = dz * r;
		if (inland(x, z) < -offshore) return [x, z];
	}
	return null;
}

/** Points just past the bay's waterline, along the beach's arc, each with how much beach it faces. */
function surfPoints(): { x: number; z: number; beach: number }[] {
	const points: { x: number; z: number; beach: number }[] = [];
	for (let k = 0; k < SURF_POINTS; k++) {
		const angle = BAY.from + (BAY.sweep * (k + 0.5)) / SURF_POINTS;
		const dx = Math.cos(angle);
		const dz = Math.sin(angle);
		// From the bay's middle outward to the waterline, then past it to where the breakers run.
		for (let r = 0; r < BAY.radius + 200; r += 2) {
			const x = BAY.x + dx * r;
			const z = BAY.z + dz * r;
			if (inland(x, z) >= 0) {
				const back = SURF_OFFSHORE;
				const beach = beachShare(x, z);
				if (beach > 0.05) points.push({ x: x - dx * back, z: z - dz * back, beach });
				break;
			}
		}
	}
	return points;
}

/** The island's sound, which the sketch updates once a frame after the camera moves. */
export interface IslandSound {
	/** Gives the sound the wind add-on's field, once the trees have made it. */
	setWind(wind: Wind): void;
	/** Writes the listener and every level. Call it once a frame in `onLateUpdate`. */
	update(): void;
}

/** Makes the island's sound for the camera that hears it. */
export function createIslandSound(ctx: SketchContext, camera: Camera): IslandSound {
	const sound: Sound = createSound(ctx, { listener: camera });

	const seaFile = sampleUrl('sources/sound/loops/sea/sea.mp3');
	const shore: [number, number][] = [];
	for (let k = 0; k < SEA_POINTS; k++) {
		const point = offshoreAlong((k / SEA_POINTS) * Math.PI * 2, SEA_OFFSHORE);
		if (point) shore.push(point);
	}
	const seaShore = sound.group({
		file: seaFile,
		count: shore.length,
		voices: 3,
		near: 70,
		far: 1600,
	});
	for (const [k, [x, z]] of shore.entries()) seaShore.setPosition(k, x, SEA_LEVEL, z);
	const seaOpen: SoundLoop = sound.loop({ file: seaFile, positional: false, level: 0 });

	const beach = surfPoints();
	const surf = sound.group({
		file: sampleUrl('sources/sound/loops/surf/surf.mp3'),
		count: beach.length,
		voices: 3,
		near: 25,
		far: 700,
	});
	beach.forEach((point, k) => {
		surf.setPosition(k, point.x, SEA_LEVEL + 1, point.z);
		surf.setLevel(k, point.beach);
	});

	const wind = sound.loop({
		file: sampleUrl('sources/sound/loops/wind/wind.mp3'),
		positional: false,
		level: 0,
	});
	const leaves = sound.loop({
		file: sampleUrl('sources/sound/loops/leaves/leaves.mp3'),
		positional: false,
		level: 0,
	});

	let field: Wind | undefined;
	const eye = new Float64Array(3);
	const air: [number, number, number] = [0, 0, 0];
	return {
		setWind(next) {
			field = next;
		},
		update() {
			camera.getWorldPosition(eye);
			const [x = 0, y = 0, z = 0] = eye;
			const ground = Math.max(groundHeight(x, z), SEA_LEVEL);
			const height = Math.max(0, y - ground);
			const out = -inland(x, z);

			// Far out at sea the water surrounds the camera; near the shore it comes from the shore's points.
			seaOpen.setLevel(0.7 * smoothstep(40, 400, out) * (1 - 0.5 * smoothstep(80, 700, height)));

			let speed = STEADY_WIND;
			if (field) {
				field.sample(x, y, z, air);
				speed = Math.hypot(air[0], air[2]);
			}
			const strength = Math.min(1, speed / FULL_WIND);
			const canopy = canopyAt(x, z);
			const nearTrees = 1 - smoothstep(12, 90, height);
			// Height and open water leave the wind unsheltered; the woods shelter the ground under them.
			const exposure =
				(0.35 + 0.5 * smoothstep(2, 160, height) + 0.15 * smoothstep(0, 250, out)) *
				(1 - 0.5 * canopy * nearTrees);
			wind.setLevel(0.85 * strength * exposure);
			wind.setTone(0.35 + 0.65 * strength * (0.6 + 0.4 * smoothstep(0, 150, height)));

			leaves.setLevel(canopy * nearTrees * Math.min(1, 0.25 + strength));
			leaves.setTone(0.55 + 0.45 * strength);
			sound.update();
		},
	};
}
