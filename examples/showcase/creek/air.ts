// What drifts in the creek's air: leaves that fall from the trees and spin on the breeze, motes of
// dust that glow in the low sun, and mist that lies over the water at dusk and at night. Each is a
// sprite batch whose rows the sketch moves from the time alone, so a held frame shows what the live
// scene shows at that time. Sprites are not lit, so each mood tints them.
//
// The particles add-on will take these over when it ships: emitters with their own update on the
// GPU. Until then, sprite batches carry them.
import type { SketchContext, Texture } from '@null3d/engine';
import { markEffect } from '../../lib/layers';
import { random } from '../../lib/procedural';
import type { Mood } from '../../lib/stage';
import { groundHeight, streamZ, WATER } from './land';

/** Falling leaves, dust motes and puffs of mist. */
const LEAVES = 80;
const MOTES = 220;
const MIST = 40;
/** The breeze that carries the leaves, in meters a second along x and z. */
const BREEZE = [0.35, 0.25] as const;

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

/** An atlas of four leaves, side by side: two greens, a yellow and a russet, each tip up. */
function leafAtlas({ textures }: SketchContext): Texture {
	const size = 32;
	const tones = [
		[78, 120, 40],
		[110, 140, 50],
		[200, 160, 50],
		[170, 80, 35],
	];
	const data = new Uint8Array(size * 4 * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size * 4; x++) {
			const frame = Math.floor(x / size);
			const u = ((x % size) + 0.5) / size - 0.5;
			const v = (y + 0.5) / size;
			// An ovate leaf with a point, inside a border of a few texels.
			const half =
				0.3 * Math.max(Math.sin(Math.PI * Math.min(Math.max((v - 0.1) / 0.8, 0), 1)), 0) ** 0.8;
			const inside = Math.min(Math.max((half - Math.abs(u)) * size + 0.5, 0), 1);
			const midrib = Math.abs(u) < 0.03 ? 1.15 : 1;
			const tone = tones[frame] as number[];
			data.set(
				[
					Math.min(255, tone[0] * midrib),
					Math.min(255, tone[1] * midrib),
					Math.min(255, tone[2] * midrib),
					Math.round(255 * inside),
				],
				(y * size * 4 + x) * 4,
			);
		}
	return textures.fromData({
		width: size * 4,
		height: size,
		data,
		colorSpace: 'srgb',
		mipmaps: true,
	});
}

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
	crowns: readonly Crown[],
): Promise<{
	update(t: number): void;
	setMood(mood: Mood): void;
	setFireflies(on: boolean): void;
}> {
	const { scene } = ctx;
	const next = random(71);
	const [leaves, motes, mist] = await Promise.all([
		scene.createSprites({
			count: LEAVES,
			map: leafAtlas(ctx),
			atlas: { columns: 4, rows: 1 },
			alphaMode: 'mask',
			dynamic: true,
		}),
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
	// The air fills the scene, so the clearance guard must not treat a leaf, a mote or the mist as a
	// wall.
	markEffect(leaves);
	markEffect(motes);
	markEffect(mist);
	// Each row's own four numbers from 0 to 1: where it starts in its cycle, its speed and its path.
	const seeds = (count: number) => Float32Array.from({ length: count * 4 }, () => next());
	const leafSeed = seeds(LEAVES);
	const moteSeed = seeds(MOTES);
	const mistSeed = seeds(MIST);
	for (let k = 0; k < LEAVES; k++) leaves.frames[k] = k % 4;
	let glow: Rgb = LOOK.Afternoon.motes;
	let fireflies = false;
	return {
		setMood(mood) {
			const look = LOOK[mood];
			leaves.material.set({ color: look.leaves });
			// A material's color stops at white, so the motes' glow, which bloom needs above white,
			// goes into each row's color.
			glow = look.motes;
			motes.setActiveCount(glow[0] === 0 && !fireflies ? 0 : MOTES);
			mist.setActiveCount(look.mistOpacity === 0 ? 0 : MIST);
			mist.material.set({ color: look.mist, opacity: look.mistOpacity });
		},
		setFireflies(on) {
			fireflies = on;
			motes.setActiveCount(on || glow[0] !== 0 ? MOTES : 0);
		},
		update(t) {
			// Leaves: each falls from a crown over its own time, swaying and spinning, carried on the
			// breeze, then starts again from the crown.
			{
				const { positions, sizes, rotations, colors } = leaves;
				for (let k = 0; k < LEAVES; k++) {
					const a = leafSeed[k * 4] as number;
					const b = leafSeed[k * 4 + 1] as number;
					const c = leafSeed[k * 4 + 2] as number;
					const d = leafSeed[k * 4 + 3] as number;
					const crown = crowns[Math.floor(a * crowns.length)] as Crown;
					const fall = 9 + 6 * b;
					const age = (t / fall + c) % 1;
					const lap = Math.floor(t / fall + c);
					const turn = d * 6.283 + lap * 2.4;
					const x0 = crown.x + Math.cos(turn) * crown.reach * 0.7;
					const z0 = crown.z + Math.sin(turn) * crown.reach * 0.7;
					const drift = age * fall;
					const x = x0 + BREEZE[0] * drift + 0.5 * Math.sin(t * 1.3 + d * 20);
					const z = z0 + BREEZE[1] * drift + 0.4 * Math.cos(t * 1.1 + b * 20);
					const ground = groundHeight(x, z);
					const y = Math.max(crown.top - (crown.top - ground) * age, ground + 0.02);
					positions[k * 3] = x;
					positions[k * 3 + 1] = Math.max(y, WATER + 0.02);
					positions[k * 3 + 2] = z;
					const flutter = Math.sin(t * 3 + a * 30);
					const size = 0.07 + 0.04 * b;
					sizes[k * 2] = size * (0.55 + 0.45 * Math.abs(flutter));
					sizes[k * 2 + 1] = size;
					rotations[k] = t * (0.8 + c) + d * 6.283;
					colors[k * 4 + 3] = Math.min(1, age * 20, (1 - age) * 12);
				}
			}
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
