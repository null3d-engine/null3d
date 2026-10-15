// What drifts in the night town's air: snow that falls and settles nowhere, smoke that rises from
// the chimneys, and mist that lies low over the square. Each is a sprite batch whose rows the sketch
// moves from the time alone, so a held frame shows what the live scene shows at that time.
import type { QualityPreset, SketchContext } from '@null3d/engine';
import { markEffect } from '../../lib/layers';
import { random } from '../../lib/procedural';
import type { Home } from './houses';
import { groundHeight, SQUARE } from './land';

/** Snowflakes at each preset. */
const SNOW: Record<QualityPreset, number> = { low: 700, medium: 1400, high: 2200, ultra: 2800 };
/** Puffs of smoke on one chimney. */
const PLUME = 6;
/** Puffs of mist over the square. */
const MIST = 26;
/** How high the snow falls from, in meters. */
const FALL = 26;

/** A soft round puff, brightest in its middle. */
function puff({ textures }: SketchContext, size: number, falloff: number) {
	const data = new Uint8Array(size * size * 4);
	for (let i = 0; i < size * size; i++) {
		const r =
			Math.hypot((i % size) - (size - 1) / 2, Math.floor(i / size) - (size - 1) / 2) / (size / 2);
		data.set([255, 255, 255, Math.round(255 * Math.max(0, 1 - r) ** falloff)], i * 4);
	}
	return textures.fromData({ width: size, height: size, data, mipmaps: true });
}

/** The air's batches, with what moves them in each frame and how many the preset draws. */
export async function createAir(
	ctx: SketchContext,
	homes: readonly Home[],
): Promise<{
	update(t: number): void;
	fit(preset: QualityPreset): void;
	setSnow(on: boolean): void;
}> {
	const { scene } = ctx;
	const next = random(191);
	const [snow, smoke, mist] = await Promise.all([
		scene.createSprites({
			count: SNOW.ultra,
			map: puff(ctx, 24, 2),
			depthWrite: false,
			dynamic: true,
		}),
		scene.createSprites({
			count: PLUME * Math.min(homes.length, 10),
			map: puff(ctx, 48, 1.5),
			depthWrite: false,
			dynamic: true,
		}),
		scene.createSprites({
			count: MIST,
			map: puff(ctx, 64, 1.4),
			depthWrite: false,
			fog: false,
			dynamic: true,
		}),
	]);
	// The air fills the scene, so the clearance guard must not treat a snowflake as a wall.
	markEffect(snow);
	markEffect(smoke);
	markEffect(mist);
	const seeds = Float32Array.from({ length: SNOW.ultra * 4 }, () => next());
	const plumes = Math.min(homes.length, 10);
	const smokeSeed = Float32Array.from({ length: PLUME * plumes * 3 }, () => next());
	let snowCount = SNOW.ultra;
	smoke.material.set({ color: [0.16, 0.17, 0.2], opacity: 0.32 });
	const mistSeed = Float32Array.from({ length: MIST * 3 }, () => next());
	mist.material.set({ color: [0.06, 0.07, 0.1], opacity: 0.22 });

	return {
		fit(preset) {
			snowCount = SNOW[preset];
			snow.setActiveCount(snowCount);
		},
		setSnow(on) {
			snow.setActiveCount(on ? snowCount : 0);
		},
		update(t) {
			const { positions: sp, sizes: ss, colors: sc } = snow;
			const count = snow.count;
			for (let k = 0; k < count; k++) {
				const a = seeds[k * 4] as number;
				const b = seeds[k * 4 + 1] as number;
				const c = seeds[k * 4 + 2] as number;
				const d = seeds[k * 4 + 3] as number;
				const speed = 0.6 + 1.1 * b;
				const y = FALL - ((((a * FALL + t * speed) % FALL) + FALL) % FALL);
				sp[k * 3] = (c * 2 - 1) * 44 + 1.6 * Math.sin(t * 0.5 + d * 20);
				sp[k * 3 + 1] = y;
				sp[k * 3 + 2] = (d * 2 - 1) * 44 + 1.4 * Math.cos(t * 0.42 + a * 20);
				const size = 0.05 + 0.08 * b;
				ss[k * 2] = size;
				ss[k * 2 + 1] = size;
				sc[k * 4] = 0.85;
				sc[k * 4 + 1] = 0.9;
				sc[k * 4 + 2] = 1;
				sc[k * 4 + 3] = 0.5 + 0.5 * Math.min(1, y / 3) * Math.min(1, (FALL - y) / 3);
			}
			// The smoke: a plume of puffs that rises, swells and fades, leaning on the air.
			const { positions: mp, sizes: ms, colors: mc } = smoke;
			for (let h = 0; h < plumes; h++) {
				const home = homes[h] as Home;
				for (let k = 0; k < PLUME; k++) {
					const row = h * PLUME + k;
					const age = (t / 7 + k / PLUME + (smokeSeed[row * 3] as number)) % 1;
					const drift = age * 4.5;
					mp[row * 3] = home.x + drift * 0.6 + 0.5 * Math.sin(t * 0.3 + row);
					mp[row * 3 + 1] = home.top + age * 6.5;
					mp[row * 3 + 2] = home.z + drift * 0.3;
					const size = 0.9 + 2.6 * age;
					ms[row * 2] = size;
					ms[row * 2 + 1] = size;
					mc[row * 4 + 3] = Math.min(1, age * 6) * (1 - age) * 0.9;
				}
			}
			// The mist: broad puffs that lie low over the square and drift slowly.
			const { positions: ip, sizes: is, colors: ic } = mist;
			for (let k = 0; k < MIST; k++) {
				const a = mistSeed[k * 3] as number;
				const b = mistSeed[k * 3 + 1] as number;
				const c = mistSeed[k * 3 + 2] as number;
				const x = (a * 2 - 1) * (SQUARE.x + 8);
				const z = (b * 2 - 1) * (SQUARE.z + 8);
				ip[k * 3] = x + 1.5 * Math.sin(t * 0.1 + c * 20);
				ip[k * 3 + 1] = groundHeight(x, z) + 0.4 + 0.8 * c;
				ip[k * 3 + 2] = z;
				const size = 4 + 4 * c;
				is[k * 2] = size * 1.6;
				is[k * 2 + 1] = size * 0.45;
				ic[k * 4 + 3] = 0.12 + 0.08 * Math.sin(t * 0.09 + a * 30);
			}
		},
	};
}
