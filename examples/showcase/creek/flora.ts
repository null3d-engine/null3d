// The creek's own small life: fallen leaves that float out from the spring pool on its current, both
// ways to the lips, and fireflies that hover over the banks at night. Each is a particle system of the particles add-on, whose
// particles the GPU moves from their birth and age, so a held frame shows what the live scene shows
// at that time and the sketch runs no loop over them.
import type { SketchContext } from '@null3d/engine';
import { createParticles, type ParticleSystem, particleTextures } from '@null3d/particles';
import { EFFECT_LAYER } from '../../lib/layers';
import { LIPS, POOL, streamCurrent, streamHalf, streamZ, WATER } from './land';

/** The lengths of stream on each side of the pool that carry their own floating leaves, and the leaves on each. */
const REACHES = 3;
const FLOATING = 8;
/** Fireflies over each bank at night, and how long each glows. */
const FIREFLIES = 45;
const FIREFLY_LIFE: readonly [number, number] = [6, 12];

/** The floating leaves and the fireflies, with what each frame steps. */
export async function createFlora(ctx: SketchContext): Promise<{
	/** Steps the systems, which a frame calls in its late update. */
	update(): void;
	/** Lights the share, from 0 to 1, of the fireflies that the hour's look calls for. */
	nightLights(share: number): void;
}> {
	const { textures } = ctx;
	const effect = { layers: EFFECT_LAYER, prewarm: true } as const;
	// Floating leaves: each reach of the stream sets leaves down at its head, which drift along it
	// with the current, flat on the water, and fade as they pass into the next reach. The reaches
	// run out from the pool both ways, as the current does.
	const leafLook = particleTextures.leaves(textures);
	const reaches = [LIPS.west, LIPS.east].flatMap((lip) => {
		const length = (lip - POOL.x) / REACHES;
		return Array.from({ length: REACHES }, (_, k) => ({ x: POOL.x + k * length, length }));
	});
	const floating = await Promise.all(
		reaches.map(({ x, length }, k) => {
			const [vx, vz] = streamCurrent(x + length / 2);
			const time = Math.abs(length) / Math.max(0.05, Math.hypot(vx, vz));
			return createParticles(ctx, {
				...effect,
				...leafLook,
				seed: 61 + k,
				position: [x, WATER + 0.02, streamZ(x)],
				shape: { type: 'box', size: [0.5, 0.01, 1.4 * streamHalf(x)] },
				rate: FLOATING / time,
				lifetime: [time, time * 1.15],
				speed: [0, 0],
				velocity: [vx, 0, vz],
				turbulence: 0.15,
				turbulenceScale: 3,
				facing: 'ground',
				spin: [-0.25, 0.25],
				rotation: [0, Math.PI * 2],
				size: [0.15, 0.22],
				colors: ['#c8782a', '#a8461f'],
				alphaOverLife: [0, 1, 1, 1, 1, 1, 0],
				blending: 'normal',
			});
		}),
	);
	// Fireflies: soft dots of light over each bank, which drift and wander and glow through bloom.
	const glow = particleTextures.glow(textures, { size: 32 });
	const fireflies = await Promise.all(
		[-1, 1].map((side, k) =>
			createParticles(ctx, {
				...effect,
				...glow,
				seed: 62 + k,
				position: [0, 1.2, streamZ(0) + side * 6],
				shape: { type: 'box', size: [36, 0.8, 5] },
				rate: FIREFLIES / FIREFLY_LIFE[1],
				lifetime: FIREFLY_LIFE,
				speed: [0, 0.1],
				turbulence: 0.6,
				turbulenceScale: 1.5,
				turbulenceSpeed: 0.3,
				size: [0.05, 0.07],
				colors: [1, 0.83, 0.2],
				intensity: 6,
				alphaOverLife: [0, 1, 1, 0],
				blending: 'additive',
				opacity: 0,
			}),
		),
	);
	const systems: readonly ParticleSystem[] = [...floating, ...fireflies];
	/** The fireflies' opacity, written in place, so a change of hour allocates nothing. */
	const lit = { opacity: 0 };
	return {
		nightLights(share) {
			lit.opacity = Math.min(1, Math.max(0, share));
			for (const swarm of fireflies) swarm.set(lit);
		},
		update() {
			for (const system of systems) system.update();
		},
	};
}
