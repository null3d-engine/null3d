// The storm's light for the sound demo: a bolt of lightning drawn as lines from the cloud to the
// ground, a flash that lights the moor from the strike's side, and the cloud that glows above. A
// bolt flickers for less than half a second, in three pulses, as a real bolt's return strokes do.
// The schedule of strikes comes from the time alone, so a held frame always shows the same bolt.
import type { SketchContext } from '@null3d/engine';

/** When the schedule's first strike falls, in seconds. */
export const FIRST_STRIKE = 0.99;
/** How high the cloud base stands over the ground at a strike, in meters. */
const CLOUD = 340;
/** The bolt's main channel and its one branch, in straight pieces. */
const CHANNEL = 24;
const BRANCH = 7;
/** Each pulse of a bolt: its start after the strike, in seconds, and its strength. */
const PULSES = [0, 1, 0.09, 0.7, 0.21, 0.85] as const;
/** How fast a pulse fades, as a time constant in seconds, and how long a bolt shows. */
const DECAY = 0.045;
const LASTS = 0.45;
/** The sky's light on the moor at rest, and what a flash adds at its brightest. */
const SKY_LIGHT = 1.3;
const SKY_LIGHT_FLASH = 7;
/** The cloud's color at rest, which the fog shares, and at the brightest flash, linear. */
export const SKY = [0.022, 0.028, 0.042] as const;
const SKY_FLASH = [0.13, 0.15, 0.21] as const;

/** A number from 0 to 1 for strike `k` and draw `j`, the same on every run. */
export function seeded(k: number, j: number): number {
	let h = Math.imul(k * 7919 + j * 104_729 + 1, 0x9e3779b1);
	h ^= h >>> 15;
	h = Math.imul(h, 0x85ebca6b);
	h ^= h >>> 13;
	return (h >>> 0) / 4_294_967_296;
}

/**
 * Writes the place of the schedule's strike `k` into `out` as x and z, and returns the seconds
 * from it to the next strike. The first falls ahead of the camera, about a kilometer out.
 */
export function scheduledStrike(k: number, out: Float64Array): number {
	const angle = k === 0 ? -1.9 : seeded(k, 0) * Math.PI * 2;
	const distance = k === 0 ? 940 : 300 + 2500 * seeded(k, 1) ** 1.5;
	out[0] = Math.cos(angle) * distance;
	out[1] = Math.sin(angle) * distance;
	return 4 + 5 * seeded(k, 2);
}

/** The storm's light. */
export interface Storm {
	/** Strikes the ground at `x`, `y`, `z` at the time `now`, as strike number `k`. */
	strike(x: number, y: number, z: number, now: number, k: number): void;
	/** Draws the bolt and the flash for the time `now`. Call it once a frame. */
	update(now: number): void;
}

/** Makes the storm's bolt, its flash and its cloud. */
export async function createStorm(ctx: SketchContext): Promise<Storm> {
	const { scene, geometry, materials } = ctx;
	const points = (CHANNEL + BRANCH) * 2;
	const bolt = await scene.createLines({
		positions: new Float32Array(points * 3),
		mode: 'segments',
		width: 2.5,
		// A glow past 1, so the bloom spreads it, and clear of the fog, so a far bolt still blazes.
		lit: true,
		color: '#000000',
		emissive: '#d4defe',
		emissiveIntensity: 9,
		fog: false,
		alphaMode: 'blend',
		blending: 'additive',
		depthWrite: false,
		opacity: 0,
	});
	bolt.setActiveCount(0);
	const boltLook = { opacity: 0 };
	// The cloud: a dome far past the land, which the fog leaves alone, so it glows in a flash.
	const skyColor: [number, number, number] = [SKY[0], SKY[1], SKY[2]];
	const skyLook = { color: skyColor };
	const cloud = materials.unlit({ color: skyColor, fog: false, doubleSided: true });
	scene.createMesh({ mesh: geometry.sphere({ radius: 6000 }), material: cloud });
	// The night sky's dim light, which the whole cloud raises in a flash, and the flash's own light.
	const sky = scene.createHemisphereLight({
		skyColor: '#6f7f9c',
		groundColor: '#07090b',
		intensity: SKY_LIGHT,
	});
	// A dim, cool light through the cloud, so the stones and the moor show between flashes.
	scene.createDirectionalLight({ direction: [0.3, -1, -0.5], intensity: 1.1, color: '#9db8e0' });
	const flash = scene.createDirectionalLight({
		direction: [0, -1, 0],
		intensity: 0,
		color: '#c8d4ff',
	});
	const glow = scene.createPointLight({
		position: [0, -999, 0],
		intensity: 0,
		range: 900,
		color: '#c8d4ff',
	});
	let at = Number.NEGATIVE_INFINITY;
	let lit = false;

	return {
		strike(x, y, z, now, k) {
			at = now;
			const p = bolt.positions;
			// The channel wanders down from the cloud in jagged steps and ends where the strike lands.
			let [px, pz] = [x + 160 * (seeded(k, 3) - 0.5), z + 160 * (seeded(k, 4) - 0.5)];
			for (let i = 0; i < CHANNEL; i++) {
				const t = (i + 1) / CHANNEL;
				const nx = i === CHANNEL - 1 ? x : px + 46 * (seeded(k, 10 + i) - 0.5) + (x - px) * t;
				const nz = i === CHANNEL - 1 ? z : pz + 46 * (seeded(k, 40 + i) - 0.5) + (z - pz) * t;
				p.set([px, y + CLOUD * (1 - i / CHANNEL), pz, nx, y + CLOUD * (1 - t), nz], i * 6);
				[px, pz] = [nx, nz];
			}
			// A branch leaves the channel a third of the way down and dies out in the air.
			const from = Math.floor(CHANNEL / 3) * 6 + 3;
			let [bx, by, bz] = [p[from] as number, p[from + 1] as number, p[from + 2] as number];
			const side = seeded(k, 5) < 0.5 ? -1 : 1;
			for (let i = 0; i < BRANCH; i++) {
				const [nx, ny, nz] = [
					bx + side * (8 + 10 * seeded(k, 70 + i)),
					by - 14,
					bz + 12 * (seeded(k, 80 + i) - 0.5),
				];
				p.set([bx, by, bz, nx, ny, nz], (CHANNEL + i) * 6);
				[bx, by, bz] = [nx, ny, nz];
			}
			bolt.markDirty(0, points);
			bolt.setActiveCount(points);
			// The flash lights the moor from high on the strike's side.
			const reach = Math.hypot(x, z) || 1;
			flash.setDirection((-0.5 * x) / reach, -1, (-0.5 * z) / reach);
			glow.setPosition(x, y + 60, z);
		},
		update(now) {
			const since = now - at;
			if (since > LASTS) {
				if (!lit) return;
				lit = false;
				bolt.setActiveCount(0);
			} else lit = true;
			let strength = 0;
			for (let i = 0; i < PULSES.length && lit; i += 2) {
				const after = since - (PULSES[i] as number);
				if (after >= 0) strength += (PULSES[i + 1] as number) * Math.exp(-after / DECAY);
			}
			boltLook.opacity = Math.min(1, strength);
			bolt.material.set(boltLook);
			for (let c = 0; c < 3; c++)
				skyColor[c] =
					(SKY[c] as number) +
					((SKY_FLASH[c] as number) - (SKY[c] as number)) * Math.min(1, strength);
			cloud.set(skyLook);
			flash.setIntensity(3 * strength);
			sky.setIntensity(SKY_LIGHT + SKY_LIGHT_FLASH * strength);
			glow.setIntensity(4e5 * strength);
		},
	};
}
