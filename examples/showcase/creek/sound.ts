// The creek garden's sound: the creek over its stones, the two falls off the rim, the wind over the
// cliff top, and the leaves of the pines and the maples. The page's speaker button starts it
// (examples/lib/sound-button.ts).
//
// The creek and the leaves are groups of points, of which the add-on's mixer plays the nearest
// few, so the water comes from the nearest stretch of the creek and the leaves from the nearest
// crowns as the camera moves. The creek sounds louder where its current runs quick, over the sills
// and toward each lip. The leaves' level follows the wind's speed at the camera, so a gust from
// the G key raises every crown's rustle as it passes the camera. The falls each come from the
// middle of their drop. The wind fills both ears: the garden stands on a cliff above the cloud,
// open to the air, so it follows the air's speed where the camera stands and grows brighter as the
// air quickens.
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
/** The wind's speed, in meters a second, at which the wind and the leaves reach their full level. */
const FULL_WIND = 11;

/** The creek garden's sound, which the sketch updates once a frame after the camera moves. */
export interface CreekSound {
	/** Writes the listener and every level. Call it once a frame in `onLateUpdate`. */
	update(): void;
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
		voices: 3,
		near: 2.5,
		far: 70,
	});
	xs.forEach((x, k) => {
		const [along, across] = streamCurrent(x);
		creek.setPosition(k, x, WATER + 0.1, streamZ(x));
		creek.setLevel(k, 0.35 + 0.65 * Math.min(1, Math.hypot(along, across) / QUICK));
	});

	// Each fall sounds from the middle of its drop, a little out from the rim.
	const fallFile = sampleUrl('sources/sound/loops/waterfall/waterfall.mp3');
	for (const x of [LIPS.west, LIPS.east]) {
		const out = Math.sign(x) * 1.5;
		sound.loop({
			file: fallFile,
			near: 5,
			far: 260,
			position: [x + out, WATER - FALL.drop / 2, streamZ(x)],
		});
	}

	// The crowns that rustle: every pine, and every maple that still has its leaves.
	const crowns = [
		...TREES.map(([, x, z]) => [x, z] as const),
		...MAPLE_SPOTS.filter(([, , , color]) => color !== 'bare').map(([, x, z]) => [x, z] as const),
	];
	const leaves = sound.group({
		file: sampleUrl('sources/sound/loops/leaves/leaves.mp3'),
		count: crowns.length,
		voices: 4,
		near: 3,
		far: 45,
	});
	for (const [k, [x, z]] of crowns.entries())
		leaves.setPosition(k, x, groundHeight(x, z) + CROWN, z);

	const air = sound.loop({
		file: sampleUrl('sources/sound/loops/wind/wind.mp3'),
		positional: false,
		level: 0,
	});

	const eye = new Float64Array(3);
	const flow: [number, number, number] = [0, 0, 0];
	return {
		update() {
			camera.getWorldPosition(eye);
			wind.sample(eye[0] as number, eye[1] as number, eye[2] as number, flow);
			const strength = Math.min(1, Math.hypot(flow[0], flow[2]) / FULL_WIND);
			air.setLevel(0.25 + 0.6 * strength);
			air.setTone(0.4 + 0.6 * strength);
			// Every crown rustles with the air at the camera, which a gust raises as it passes.
			leaves.levels.fill(Math.min(1, 0.2 + 1.2 * strength));
			leaves.tones.fill(0.55 + 0.45 * strength);
			sound.update();
		},
	};
}
