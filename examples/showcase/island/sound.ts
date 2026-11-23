// The island's sound: the sea all round it, the surf on the bay's beach, the wind, the leaves of the
// woods, and the traffic on the roads. Every source keeps a short reach, so the island is quiet where
// nothing stands near the camera: the opening view, high and far offshore, hears nothing. The page's speaker button starts it (examples/lib/sound-button.ts).
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
import { createSound, type Sound, type SoundGroup, type SoundLoop } from '@null3d/sound';
import type { Wind } from '@null3d/wind';
import { sampleUrl } from '../../lib/samples';
import { FOUNTAIN_WATER, groundHeight } from './ground';
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
/** The level of each of the sea's points, so three voices do not stack as loud as one loop. */
const SEA_POINT_LEVEL = 0.4;
/** How far the open-water sea rises, and the distance from shore and height over which it fades in. */
const SEA_OPEN = 0.55;
/** The wind's speed, in meters a second, at which the wind and the leaves reach their full level. */
const FULL_WIND = 9;
/** How fast a vehicle's level and pitch reach their curves, as a share of the gap each second. */
const SMOOTHING = 6;
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
	/** Gives the sound the island's moving vehicles, which the traffic writes in each frame. */
	setTraffic(traffic: {
		readonly vehicles: Float32Array;
		readonly speeds: Float32Array;
		readonly counts: { readonly cars: number; readonly buses: number };
	}): void;
	/** Writes the listener and every level. Call it once a frame in `onLateUpdate`, with the step. */
	update(dt?: number): void;
}

/**
 * A car's engine level at its speed: it fades in as the car pulls away from a stop and rises with its
 * speed. The curve is continuous through the stop, so a held car does not cut its engine off.
 */
export function carLevel(speed: number): number {
	return (0.4 + 0.35 * Math.min(1, speed / 14)) * smoothstep(0, 0.6, speed);
}

/** A bus's engine level at its speed: it idles at its stops and rises with its speed, crossing smoothly. */
export function busLevel(speed: number): number {
	return 0.26 + 0.3 * smoothstep(0.2, 2, speed);
}

/** A car's engine pitch at its speed, from a standing start to its fastest. */
export function carRate(speed: number): number {
	return 0.85 + Math.min(1, speed / 14) * 0.35 * smoothstep(0, 0.6, speed);
}

/** A bus's engine pitch at its speed. */
export function busRate(speed: number): number {
	return 0.9 + Math.min(1, speed / 12) * 0.25;
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
		near: 40,
		far: 300,
	});
	for (const [k, [x, z]] of shore.entries()) {
		seaShore.setPosition(k, x, SEA_LEVEL, z);
		seaShore.setLevel(k, SEA_POINT_LEVEL);
	}
	const seaOpen: SoundLoop = sound.loop({ file: seaFile, positional: false, level: 0 });

	const beach = surfPoints();
	const surf = sound.group({
		file: sampleUrl('sources/sound/loops/surf/surf.mp3'),
		count: beach.length,
		voices: 3,
		near: 30,
		far: 400,
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

	// The square's fountain runs at the town's middle. It is the only sound there, and the listener hears
	// it only from close by, so the square sounds like its fountain rather than like silence.
	const fountain = sound.loop({
		file: sampleUrl('sources/sound/loops/stream/stream.mp3'),
		near: 3,
		far: 50,
		level: 0.5,
	});
	fountain.setPosition(FOUNTAIN_WATER.x, FOUNTAIN_WATER.basinAbove + 1, FOUNTAIN_WATER.z);

	// The cars and the bus come from the road under them. A car keeps quiet while it stands, or while
	// the traffic holds it out of sight, and grows louder and higher as it runs.
	const carFile = sampleUrl('sources/sound/loops/car/car.mp3');
	const busFile = sampleUrl('sources/sound/loops/bus/bus.mp3');
	let cars: SoundGroup | undefined;
	let bus: SoundLoop | undefined;
	let traffic: Parameters<IslandSound['setTraffic']>[0] | undefined;
	// The levels and pitches the mixer is showing now, which move toward their curves rather than jumping.
	const carShown: number[] = [];
	const carPitch: number[] = [];
	let busShown = 0;
	let busPitch = 1;

	let field: Wind | undefined;
	const eye = new Float64Array(3);
	const air: [number, number, number] = [0, 0, 0];
	return {
		setWind(next) {
			field = next;
		},
		setTraffic(next) {
			// The models' traffic takes the placeholders' place with the same vehicles, so its sounds stay
			// and read the new arrays; a traffic of other counts gets sounds of its own size.
			const same =
				traffic !== undefined &&
				traffic.counts.cars === next.counts.cars &&
				traffic.counts.buses === next.counts.buses;
			traffic = next;
			if (same) return;
			cars?.destroy();
			bus?.destroy();
			bus = undefined;
			cars = sound.group({ file: carFile, count: next.counts.cars, voices: 4, near: 5, far: 120 });
			carShown.length = 0;
			carPitch.length = 0;
			for (let k = 0; k < next.counts.cars; k++) {
				carShown.push(0);
				carPitch.push(1);
			}
			busShown = 0;
			busPitch = 1;
			if (next.counts.buses > 0) bus = sound.loop({ file: busFile, near: 8, far: 200, level: 0 });
		},
		update(dt = 0) {
			camera.getWorldPosition(eye);
			const [x = 0, y = 0, z = 0] = eye;
			const ground = Math.max(groundHeight(x, z), SEA_LEVEL);
			const height = Math.max(0, y - ground);
			const out = -inland(x, z);

			// Far out at sea the water surrounds the camera; near the shore it comes from the shore's points.
			seaOpen.setLevel(SEA_OPEN * smoothstep(60, 400, out) * (1 - smoothstep(5, 60, height)));

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
			wind.setLevel(0.35 * strength * strength * exposure);
			wind.setTone(0.35 + 0.65 * strength * (0.6 + 0.4 * smoothstep(0, 150, height)));

			leaves.setLevel(0.5 * canopy * nearTrees * Math.min(1, 0.15 + 0.6 * strength));
			leaves.setTone(0.55 + 0.45 * strength);

			if (traffic) {
				// The levels and the pitches follow their curves through a smoothing step, so a car that
				// is held at a stop fades rather than cutting off, and a bus pulling away swells.
				const ease = Math.min(1, Math.max(0, dt) * SMOOTHING);
				const n = traffic.counts.cars;
				if (cars) {
					cars.positions.set(traffic.vehicles.subarray(0, n * 3));
					for (let k = 0; k < n; k++) {
						const speed = traffic.speeds[k] as number;
						const level = carLevel(speed);
						const rate = carRate(speed);
						carShown[k] = (carShown[k] as number) + (level - (carShown[k] as number)) * ease;
						carPitch[k] = (carPitch[k] as number) + (rate - (carPitch[k] as number)) * ease;
						cars.setLevel(k, carShown[k] as number);
						cars.setRate(k, carPitch[k] as number);
					}
				}
				if (bus) {
					const b = n;
					const speed = traffic.speeds[b] as number;
					bus.setPosition(
						traffic.vehicles[b * 3] as number,
						(traffic.vehicles[b * 3 + 1] as number) + 1,
						traffic.vehicles[b * 3 + 2] as number,
					);
					busShown = busShown + (busLevel(speed) - busShown) * ease;
					busPitch = busPitch + (busRate(speed) - busPitch) * ease;
					bus.setLevel(busShown);
					bus.setRate(busPitch);
				}
			}
			sound.update();
		},
	};
}
