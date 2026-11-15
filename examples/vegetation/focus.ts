// The camera's flight to a plant: the double-press picks the plant nearest the point under the
// pointer, and the camera eases from where it stands to a view close enough to read the leaves and
// back far enough to hold the whole plant in the frame.
import type { PerspectiveCamera } from '@null3d/engine';
import type { MeadowPlant } from './meadow';

/** A flight of the camera to a plant: where it starts, where it ends and when it began. */
export interface Flight {
	from: [number, number, number];
	fromAim: [number, number, number];
	to: [number, number, number];
	toAim: [number, number, number];
	began: number;
	length: number;
}

/** Ease in and out: slow at both ends, quickest halfway. */
const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * The flight to the plant that stands nearest the picture point under the pointer, or undefined
 * when no plant is within reach of it.
 */
export function focusAt(
	camera: PerspectiveCamera,
	plants: readonly MeadowPlant[],
	aim: readonly number[],
	x: number,
	y: number,
): Flight | undefined {
	let best: MeadowPlant | undefined;
	let nearest = 60 * 60;
	const at: [number, number, number] = [0, 0, 0];
	for (const plant of plants) {
		camera.worldToScreen([plant.x, plant.height * 0.5, plant.z], at);
		const d = (at[0] - x) ** 2 + (at[1] - y) ** 2;
		if (d < nearest) {
			nearest = d;
			best = plant;
		}
	}
	if (!best) return undefined;
	const height = Math.max(0.6, best.height);
	// Close enough to read the leaves, and back far enough to hold the whole plant in the frame.
	const away = height * 1.7 + 3;
	const target: [number, number, number] = [best.x, height * 0.55, best.z];
	const to: [number, number, number] = [
		best.x + away * 0.4,
		height * 0.55 + away * 0.5,
		best.z + away * 0.75,
	];
	const from: [number, number, number] = [0, 0, 0];
	camera.getPosition(from);
	return {
		from,
		fromAim: [aim[0] as number, aim[1] as number, aim[2] as number],
		to,
		toAim: target,
		began: performance.now(),
		length: Math.min(3000, 900 + away * 12),
	};
}

/**
 * Advances a flight by the clock: the camera and its aim move along the ease, and the flight comes
 * back undefined once it has landed.
 */
export function stepFlight(
	flight: Flight,
	camera: PerspectiveCamera,
	aim: [number, number, number],
	now: number,
): Flight | undefined {
	const t = Math.min(1, (now - flight.began) / flight.length);
	const k = ease(t);
	camera.setPosition(
		mix(flight.from[0], flight.to[0], k),
		mix(flight.from[1], flight.to[1], k),
		mix(flight.from[2], flight.to[2], k),
	);
	aim[0] = mix(flight.fromAim[0], flight.toAim[0], k);
	aim[1] = mix(flight.fromAim[1], flight.toAim[1], k);
	aim[2] = mix(flight.fromAim[2], flight.toAim[2], k);
	return t >= 1 ? undefined : flight;
}
