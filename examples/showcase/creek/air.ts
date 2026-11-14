// What drifts in the creek's air: leaves that fall from the trees and spin on the breeze, motes of
// dust that glow in the low sun, and mist that lies over the water at dusk and at night. Each is a
// sprite batch whose rows the sketch moves from the time alone, so a held frame shows what the live
// scene shows at that time. Sprites are not lit, so each mood tints them.
//
// The particles add-on will take these over when it ships: emitters with their own update on the
// GPU. Until then, sprite batches carry them.
import { type Camera, math, type SketchContext, type Texture } from '@null3d/engine';
import { createFloatingLeaves, type FloatingLeaves } from '@null3d/vegetation';
import type { WindField } from '@null3d/wind';
import { markEffect } from '../../lib/layers';
import { random } from '../../lib/procedural';
import type { Mood, MoodMix } from '../../lib/stage';
import { streamZ, WATER } from './land';

/** Falling leaves, dust motes and puffs of mist. */
const LEAVES = 80;
const MOTES = 220;
const MIST = 40;

type Rgb = [number, number, number];

/** Each mood's linear tint of the leaves, the motes' glow, and the mist's color and opacity. */
const LOOK: Record<Mood, { leaves: Rgb; motes: Rgb; mist: Rgb; mistOpacity: number }> = {
	Auto: {
		leaves: [1, 1, 0.95],
		motes: [0.5, 0.48, 0.4],
		mist: [0.85, 0.9, 0.95],
		mistOpacity: 0.15,
	},
	Dawn: {
		leaves: [0.8, 0.82, 0.9],
		motes: [0.6, 0.5, 0.4],
		mist: [0.7, 0.72, 0.85],
		mistOpacity: 0.35,
	},
	Morning: {
		leaves: [0.95, 1, 0.9],
		motes: [0.45, 0.5, 0.42],
		mist: [0.85, 0.9, 0.95],
		mistOpacity: 0.2,
	},
	Midday: {
		leaves: [1, 1, 0.95],
		motes: [0.5, 0.5, 0.45],
		mist: [0.9, 0.94, 0.98],
		mistOpacity: 0.12,
	},
	Afternoon: {
		leaves: [1, 1, 0.95],
		motes: [0.5, 0.48, 0.4],
		mist: [0.85, 0.9, 0.95],
		mistOpacity: 0.15,
	},
	Golden: {
		leaves: [1, 0.78, 0.55],
		motes: [1.6, 1.0, 0.45],
		mist: [1, 0.82, 0.62],
		mistOpacity: 0.4,
	},
	Dusk: {
		leaves: [0.28, 0.32, 0.45],
		motes: [0, 0, 0],
		mist: [0.05, 0.06, 0.09],
		mistOpacity: 0.3,
	},
	Night: {
		leaves: [0.07, 0.08, 0.12],
		motes: [0, 0, 0],
		mist: [0.02, 0.025, 0.04],
		mistOpacity: 0.3,
	},
	Studio: { leaves: [0.8, 0.8, 0.8], motes: [0, 0, 0], mist: [0, 0, 0], mistOpacity: 0 },
};

/** A soft round puff, brightest in its middle, for motes and mist. */
function puff({ textures }: SketchContext, size: number, falloff: number): Texture {
	const data = new Uint8Array(size * size * 4);
	for (let i = 0; i < size * size; i++) {
		const r =
			Math.hypot((i % size) - (size - 1) / 2, Math.floor(i / size) - (size - 1) / 2) / (size / 2);
		data.set([255, 255, 255, Math.round(255 * Math.max(0, 1 - r) ** falloff)], i * 4);
	}
	return textures.fromData({ width: size, height: size, data, mipmaps: true });
}

/** Makes the air's batches, with what moves them in each frame and what each mood sets. */
export async function createAir(
	ctx: SketchContext,
	camera: Camera,
	wind: WindField,
): Promise<{
	update(t: number, dt: number): void;
	/** Shows the look of a mix of moods, each value blended between the two moods' own. */
	setLook(mix: MoodMix): void;
	setFireflies(on: boolean): void;
	/** Shows or hides the mist over the water, which the fog switch owns. */
	setMist(on: boolean): void;
}> {
	const { scene } = ctx;
	const next = random(71);
	// The leaves ride the wind add-on's field on the GPU: each keeps a place and a speed of its own
	// that the field steps, so a gust carries it along rather than pushing it where it stands. The
	// box follows the camera, so the leaves fill whatever part of the valley the view shows.
	const leaves: FloatingLeaves = createFloatingLeaves(ctx, {
		wind,
		camera,
		count: LEAVES,
		area: { x: 0, z: 0, size: 40, high: 12, low: WATER + 0.02 },
		size: 0.1,
		seed: 71,
		ride: 'state',
	});
	markEffect(leaves.batch);
	const [motes, mist] = await Promise.all([
		scene.createSprites({
			count: MOTES,
			map: puff(ctx, 16, 2),
			blending: 'additive',
			depthWrite: false,
			dynamic: true,
		}),
		// The mist takes no fog: its color is the fog's own, for each mood.
		scene.createSprites({
			count: MIST,
			map: puff(ctx, 64, 1.6),
			depthWrite: false,
			fog: false,
			dynamic: true,
		}),
	]);
	// The air fills the scene, so the clearance guard must not treat a mote or the mist as a wall.
	markEffect(motes);
	markEffect(mist);
	// Each row's own four numbers from 0 to 1: where it starts in its cycle, its speed and its path.
	const seeds = (count: number) => Float32Array.from({ length: count * 4 }, () => next());
	const moteSeed = seeds(MOTES);
	const mistSeed = seeds(MIST);
	const glow: Rgb = [...LOOK.Afternoon.motes];
	const tint: Rgb = [...LOOK.Afternoon.leaves];
	const haze: Rgb = [...LOOK.Afternoon.mist];
	let fireflies = false;
	/** False while the fog is off, which hides the mist with it. */
	let mistShown = true;
	return {
		setLook({ from, to, share }) {
			const a = LOOK[from];
			const b = LOOK[to];
			for (let c = 0; c < 3; c++) {
				tint[c] = math.lerp(a.leaves[c] as number, b.leaves[c] as number, share);
				// A material's color stops at white, so the motes' glow, which bloom needs above white,
				// goes into each row's color.
				glow[c] = math.lerp(a.motes[c] as number, b.motes[c] as number, share);
				haze[c] = math.lerp(a.mist[c] as number, b.mist[c] as number, share);
			}
			const opacity = math.lerp(a.mistOpacity, b.mistOpacity, share);
			leaves.setColor(tint);
			motes.setActiveCount(glow[0] === 0 && !fireflies ? 0 : MOTES);
			mist.setActiveCount(!mistShown || opacity === 0 ? 0 : MIST);
			mist.material.set({ color: haze, opacity });
		},
		setFireflies(on) {
			fireflies = on;
			motes.setActiveCount(on || glow[0] !== 0 ? MOTES : 0);
		},
		setMist(on) {
			mistShown = on;
			mist.setActiveCount(on ? MIST : 0);
		},
		update(t, dt) {
			// The leaves keep their place and speed in the field's own step, so a gust carries them.
			leaves.update(dt);
			// Motes: each wanders in a box over the near bank and the water, where the camera looks.
			{
				const { positions, sizes, colors } = motes;
				for (let k = 0; k < MOTES; k++) {
					const a = moteSeed[k * 4] as number;
					const b = moteSeed[k * 4 + 1] as number;
					const c = moteSeed[k * 4 + 2] as number;
					const d = moteSeed[k * 4 + 3] as number;
					positions[k * 3] = -7 + 16 * a + 0.4 * Math.sin(t * 0.21 + d * 40);
					positions[k * 3 + 1] = 0.3 + 3 * b + 0.3 * Math.sin(t * 0.17 + c * 40);
					positions[k * 3 + 2] = -4 + 8 * c + 0.4 * Math.cos(t * 0.19 + a * 40);
					const s = 0.012 + 0.02 * d;
					sizes[k * 2] = s;
					sizes[k * 2 + 1] = s;
					colors[k * 4] = glow[0];
					colors[k * 4 + 1] = glow[1];
					colors[k * 4 + 2] = glow[2];
					colors[k * 4 + 3] = 0.35 + 0.65 * Math.max(0, Math.sin(t * 0.7 + a * 60));
				}
			}
			// Mist: broad puffs that lie low over the water and drift downstream, fading in and out.
			{
				const { positions, sizes, colors } = mist;
				for (let k = 0; k < MIST; k++) {
					const a = mistSeed[k * 4] as number;
					const b = mistSeed[k * 4 + 1] as number;
					const c = mistSeed[k * 4 + 2] as number;
					const d = mistSeed[k * 4 + 3] as number;
					const run = 60;
					const x = ((((a * run + t * (0.12 + 0.1 * b)) % run) + run) % run) - run / 2;
					positions[k * 3] = x;
					positions[k * 3 + 1] = WATER + 0.25 + 0.5 * c;
					positions[k * 3 + 2] = streamZ(x) + (d - 0.5) * 6;
					const s = 3 + 3 * b;
					sizes[k * 2] = s * 1.5;
					sizes[k * 2 + 1] = s * 0.4;
					colors[k * 4 + 3] = 0.12 + 0.1 * Math.sin(t * 0.13 + a * 40);
				}
			}
		},
	};
}
