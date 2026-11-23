// The creek garden's sound: the creek over its stones, the two falls off the rim, the wind over the
// cliff top, and the leaves of the pines and the maples. The page's speaker button starts it
// (examples/lib/sound-button.ts).
//
// The creek is a group of points, of which the add-on's mixer plays the nearest few, so the water
// comes from the nearest stretch of the creek as the camera moves, and it sounds louder where its
// current runs quick, over the sills and toward each lip. The leaves are one bed in both ears whose
// level follows the nearest crown and the wind's speed at the camera: the rustle comes from the
// wood around the camera rather than from the crowns as sources, so a camera that flies through a
// maple hears it swell and fall instead of copies swapping from side to side. The falls each come
// from the middle of their drop. The wind fills both ears: the garden stands on a cliff above the
// cloud, open to the air, so it follows the air's speed where the camera stands and grows brighter
// as the air quickens.
import type { Camera, SketchContext } from '@null3d/engine';
import { createSound } from '@null3d/sound';
import type { Wind } from '@null3d/wind';
import { sampleUrl } from '../../lib/samples';
import { FALL, groundHeight, LIPS, streamCurrent, streamZ, WATER } from './land';
import { MAPLE_SPOTS, TREES } from './valley';

/** The spacing of the creek's points along its course, in meters. */
const CREEK_STEP = 2.5;
/** The current, in meters a second, at which the creek reaches its full level. */
const QUICK = 0.9;
/** How high over its ground a crown's leaves rustle, in meters. */
const CROWN = 4.5;
/** How far a crown's leaves reach out from its middle, in meters. */
const CROWN_SPREAD = 2.5;
/** The distance to a crown, in meters, within which its leaves rustle at their full level. */
const RUSTLE_NEAR = 4;
/** The distance to a crown, in meters, past which its leaves are not heard. */
const RUSTLE_FAR = 30;
/** The wind's speed, in meters a second, at which the wind and the leaves reach their full level. */
const FULL_WIND = 11;
/** How long the wind's speed takes to follow the camera's, as a time constant in seconds. */
const AIR_TIME = 0.28;

/** The creek garden's sound, which the sketch updates once a frame after the camera moves. */
export interface CreekSound {
	/** Writes the listener and every level. Call it once a frame in `onLateUpdate`, with its step. */
	update(dt: number): void;
}

/** A smooth step from 0 at `low` to 1 at `high`. */
function smoothstep(low: number, high: number, value: number): number {
	if (value <= low) return 0;
	if (value >= high) return 1;
	const t = (value - low) / (high - low);
	return t * t * (3 - 2 * t);
}

/** Makes the creek garden's sound for the camera that hears it, from the garden's wind. */
export function createCreekSound(ctx: SketchContext, camera: Camera, wind: Wind): CreekSound {
	const sound = createSound(ctx, { listener: camera });

	// The creek's points run along its middle from lip to lip, louder where the water runs quick.
	const xs: number[] = [];
	for (let x = LIPS.west + 1; x <= LIPS.east - 1; x += CREEK_STEP) xs.push(x);
	const creek = sound.group({
		file: sampleUrl('sources/sound/loops/stream/stream.mp3'),
		count: xs.length,
		voices: 4,
		near: 4,
		far: 50,
	});
	xs.forEach((x, k) => {
		const [along, across] = streamCurrent(x);
		creek.setPosition(k, x, WATER + 0.1, streamZ(x));
		creek.setLevel(k, 0.4 + 0.4 * Math.min(1, Math.hypot(along, across) / QUICK));
	});

	// Each fall sounds from the middle of its drop, a little out from the rim.
	const fallFile = sampleUrl('sources/sound/loops/waterfall/waterfall.mp3');
	for (const [n, x] of [LIPS.west, LIPS.east].entries()) {
		const out = Math.sign(x) * 1.5;
		const fall = sound.loop({
			file: fallFile,
			near: 6,
			far: 120,
			position: [x + out, WATER - FALL.drop / 2, streamZ(x)],
		});
		// Two falls play one recording, so a few per cent apart they sound like two falls.
		fall.setRate(n === 0 ? 0.97 : 1.03);
	}

	// The crowns whose leaves rustle: every pine, and every maple that still has its leaves. They
	// are places to measure from, not sources: the rustle is one bed that swells near the wood.
	const crowns = [
		...TREES.map(([, x, z]) => [x, groundHeight(x, z) + CROWN, z] as const),
		...MAPLE_SPOTS.filter(([, , , color]) => color !== 'bare').map(
			([, x, z]) => [x, groundHeight(x, z) + CROWN, z] as const,
		),
	];
	const leaves = sound.loop({
		file: sampleUrl('sources/sound/loops/leaves/leaves.mp3'),
		positional: false,
		level: 0,
	});

	const air = sound.loop({
		file: sampleUrl('sources/sound/loops/wind/wind.mp3'),
		positional: false,
		level: 0,
	});

	const eye = new Float64Array(3);
	const flow: [number, number, number] = [0, 0, 0];
	// The air's speed at the camera jumps as the camera moves through the field's gusts, and a tone
	// that followed it frame by frame made the whole mix brighten and darken with the walk. It now
	// follows over about half a second.
	let airSpeed = Number.NaN;
	return {
		update(dt) {
			camera.getWorldPosition(eye);
			wind.sample(eye[0] as number, eye[1] as number, eye[2] as number, flow);
			const sampled = Math.hypot(flow[0], flow[2]);
			// The step is the share of the gap that a time constant crosses in this frame, so a fast
			// display settles the wind as slowly as a slow one.
			const follow = 1 - Math.exp(-Math.max(0, dt) / AIR_TIME);
			airSpeed = Number.isNaN(airSpeed) ? sampled : airSpeed + (sampled - airSpeed) * follow;
			const strength = Math.min(1, airSpeed / FULL_WIND);
			air.setLevel(0.02 + 0.18 * strength * strength);
			air.setTone(0.62 + 0.2 * strength);
			// The bed's level follows the nearest crown, so the wood rustles as the camera nears it,
			// and it swells with the air at the camera, which a gust raises as it passes.
			let nearest = Number.POSITIVE_INFINITY;
			for (const [x, y, z] of crowns) {
				const gap = Math.hypot(eye[0] - x, eye[1] - y, eye[2] - z) - CROWN_SPREAD;
				if (gap < nearest) nearest = gap;
			}
			const rustle = 1 - smoothstep(RUSTLE_NEAR, RUSTLE_FAR, Math.max(0, nearest));
			leaves.setLevel(0.5 * rustle * Math.min(1, 0.15 + 0.6 * strength));
			leaves.setTone(0.68 + 0.2 * strength);
			sound.update();
		},
	};
}
