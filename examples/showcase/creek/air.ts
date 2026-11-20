// What drifts in the creek's air: leaves that fall from the trees and tumble on the wind, motes of
// dust that glow in the low sun, and mist that lies over the water at dusk and at night. Each is a
// particle system of the particles add-on, whose particles the GPU moves from their birth and age,
// so a held frame shows what the live scene shows at that time and the sketch runs no loop over
// them. Particles are not lit, so each mood tints them.
import { math, type SketchContext } from '@null3d/engine';
import { createParticles, type ParticleSystem, particleTextures } from '@null3d/particles';
import type { WindField } from '@null3d/wind';
import { EFFECT_LAYER } from '../../lib/layers';
import type { Mood, MoodMix } from '../../lib/stage';
import { LIPS, streamCurrent, streamZ, WATER } from './land';

/** Leaves that fall from each crown each second, and how long a leaf takes to fall. */
const LEAF_RATE = 0.5;
const LEAF_LIFE: readonly [number, number] = [9, 15];
/** Dust motes over the near bank, and how long each glows. */
const MOTES = 220;
const MOTE_LIFE: readonly [number, number] = [6, 10];
/** The lengths of stream that each carry a bank of mist, and the puffs over each. */
const MIST_REACHES = 6;
const MIST_REACH = (LIPS.east - LIPS.west) / MIST_REACHES;
const MIST_PUFFS = 10;
const MIST_LIFE: readonly [number, number] = [14, 22];

/** A crown that leaves fall from: its middle on the ground, its height and its reach. */
export interface Crown {
	x: number;
	z: number;
	top: number;
	reach: number;
}

type Rgb = [number, number, number];

/** Each mood's linear tint of the leaves, the motes' glow, and the mist's color and opacity. */
const LOOK: Record<Mood, { leaves: Rgb; motes: Rgb; mist: Rgb; mistOpacity: number }> = {
	Auto: {
		leaves: [1, 1, 0.95],
		motes: [0.5, 0.48, 0.4],
		mist: [0.85, 0.9, 0.95],
		mistOpacity: 0.06,
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
		mistOpacity: 0.025,
	},
	Midday: {
		leaves: [1, 1, 0.95],
		motes: [0.5, 0.5, 0.45],
		mist: [0.9, 0.94, 0.98],
		mistOpacity: 0.05,
	},
	Afternoon: {
		leaves: [1, 1, 0.95],
		motes: [0.5, 0.48, 0.4],
		mist: [0.85, 0.9, 0.95],
		mistOpacity: 0.06,
	},
	Golden: {
		leaves: [1, 0.78, 0.55],
		motes: [1.6, 1.0, 0.45],
		mist: [0.55, 0.45, 0.35],
		mistOpacity: 0.06,
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

/** The hue of each swarm of motes at its brightest channel's full strength: the day's and the golden hour's. */
const MOTE_HUE = { day: [1, 0.96, 0.8], golden: [1, 0.625, 0.28] } as const;

/** The brightest channel of a color. */
const peakOf = (rgb: Rgb) => Math.max(rgb[0], rgb[1], rgb[2]);
/** The brightness of a color, as the eye weighs its channels. */
const brightness = (rgb: Rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
/** How strongly the day's swarm of motes glows in a mood, and the golden hour's swarm. */
const dayGlow = (mood: Mood) => (mood === 'Golden' ? 0 : peakOf(LOOK[mood].motes));
const goldGlow = (mood: Mood) => (mood === 'Golden' ? peakOf(LOOK[mood].motes) : 0);

/** Makes the air's particle systems, with what each frame steps and what each mood sets. */
export async function createAir(
	ctx: SketchContext,
	crowns: readonly Crown[],
	wind: WindField,
): Promise<{
	/** Steps the systems, which a frame calls in its late update, after the wind's field steps. */
	update(): void;
	/** Shows the look of a mix of moods, each value blended between the two moods' own. */
	setLook(mix: MoodMix): void;
	setFireflies(on: boolean): void;
	/** Shows or hides the mist over the water, which the fog switch owns. */
	setMist(on: boolean): void;
}> {
	const { textures } = ctx;
	// What fills the air is on the effect layer, so the clearance guard never treats it as a wall,
	// and the water's reflection leaves it out.
	const air = { layers: EFFECT_LAYER, prewarm: true } as const;
	const leafLook = particleTextures.leaves(textures);
	// Leaves: each crown sheds a few, which fall slowly from inside it and tumble as the wind's field
	// carries them.
	const leaves = await Promise.all(
		crowns.map((crown, k) =>
			createParticles(ctx, {
				...air,
				...leafLook,
				seed: 71 + k,
				position: [crown.x, crown.top - crown.reach * 0.5, crown.z],
				shape: { type: 'sphere', radius: crown.reach * 0.6 },
				rate: LEAF_RATE,
				lifetime: LEAF_LIFE,
				speed: [0, 0.2],
				gravity: [0, -0.9, 0],
				drag: 1.2,
				windField: wind,
				turbulence: 0.35,
				turbulenceScale: 1.5,
				facing: 'tumble',
				spin: [-2.5, 2.5],
				size: [0.07, 0.11],
				colors: ['#6f8a2c', '#b8862e'],
				alphaOverLife: [0, 1, 1, 1, 1, 1, 0],
				groundHeight: WATER,
				groundMode: 'kill',
				blending: 'normal',
			}),
		),
	);
	// Motes: a box of dust over the creek and its banks, where the camera looks, that drifts and
	// swirls and glows through bloom. Two swarms share the box, one in the day's pale glow and one in
	// the golden hour's, so a change of hour changes only their strengths, which allocates nothing.
	const motes = await Promise.all(
		[MOTE_HUE.day, MOTE_HUE.golden].map((hue, k) =>
			createParticles(ctx, {
				...air,
				...particleTextures.glow(textures, { size: 16 }),
				seed: 72 + k * 31,
				position: [0, 1.8, streamZ(0)],
				shape: { type: 'box', size: [30, 3, 12] },
				rate: MOTES / MOTE_LIFE[1],
				lifetime: MOTE_LIFE,
				speed: [0, 0.05],
				turbulence: 0.5,
				turbulenceScale: 2,
				turbulenceSpeed: 0.2,
				size: [0.012, 0.032],
				colorOverLife: [hue, hue],
				alphaOverLife: [0, 1, 0.4, 1, 0],
				blending: 'additive',
			}),
		),
	);
	// Mist: broad puffs that lie low over each reach of the water and drift downstream with the
	// current, in each mood's own color.
	const smoke = particleTextures.smoke(textures);
	const mist = await Promise.all(
		Array.from({ length: MIST_REACHES }, (_, k) => {
			const x = LIPS.west + (k + 0.5) * MIST_REACH;
			const [vx, vz] = streamCurrent(x);
			return createParticles(ctx, {
				...air,
				...smoke,
				seed: 73 + k,
				position: [x, WATER + 0.5, streamZ(x)],
				shape: { type: 'box', size: [MIST_REACH, 0.5, 4] },
				rate: MIST_PUFFS / MIST_LIFE[1],
				lifetime: MIST_LIFE,
				speed: [0, 0],
				velocity: [vx * 0.4, 0, vz * 0.4],
				size: [1.5, 3],
				alphaOverLife: [0, 1, 1, 0],
				blending: 'normal',
			});
		}),
	);
	const haze: Rgb = [...LOOK.Afternoon.mist];
	let fireflies = false;
	let glowing = true;
	/** False while the fog is off, which hides the mist with it. */
	let mistShown = true;
	let mistOpacity = LOOK.Afternoon.mistOpacity;
	// The values that a change of hour writes, kept and written in place, so a change allocates
	// nothing: the leaves' brightness, and each swarm of motes' strength and opacity.
	const leafValues = { intensity: 1 };
	const moteValues: { intensity: number; opacity: number }[] = [
		{ intensity: 0, opacity: 1 },
		{ intensity: 0, opacity: 1 },
	];
	/** Shows the motes while the low sun lights them or the fireflies are on. */
	const showMotes = () => {
		for (let k = 0; k < motes.length; k++) {
			const values = moteValues[k] as { intensity: number; opacity: number };
			values.opacity = glowing || fireflies ? 1 : 0;
			(motes[k] as ParticleSystem).set(values);
		}
	};
	const showMist = () => {
		for (const bank of mist) bank.set({ opacity: mistShown ? mistOpacity : 0 });
	};
	const systems: readonly ParticleSystem[] = [...leaves, ...motes, ...mist];
	return {
		setLook({ from, to, share }) {
			const a = LOOK[from];
			const b = LOOK[to];
			for (let c = 0; c < 3; c++)
				haze[c] = math.lerp(a.mist[c] as number, b.mist[c] as number, share);
			mistOpacity = math.lerp(a.mistOpacity, b.mistOpacity, share);
			// The leaves keep their own colors and take the hour's light as their brightness.
			leafValues.intensity = math.lerp(brightness(a.leaves), brightness(b.leaves), share);
			for (const fall of leaves) fall.set(leafValues);
			// A particle's color stops at white, so the motes' glow, which bloom needs above white,
			// goes in as each swarm's intensity: the day's pale swarm, and the golden hour's.
			const day = math.lerp(dayGlow(from), dayGlow(to), share);
			const gold = math.lerp(goldGlow(from), goldGlow(to), share);
			(moteValues[0] as { intensity: number }).intensity = day;
			(moteValues[1] as { intensity: number }).intensity = gold;
			glowing = day + gold > 0;
			showMotes();
			for (const bank of mist) bank.set({ colorOverLife: [haze, haze] });
			showMist();
		},
		setFireflies(on) {
			fireflies = on;
			showMotes();
		},
		setMist(on) {
			mistShown = on;
			showMist();
		},
		update() {
			for (const system of systems) system.update();
		},
	};
}
