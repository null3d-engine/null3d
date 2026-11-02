// The splat garden's cloud: a captured glade of moss, stone and blossom, made from Gaussian splats
// rather than meshes. A shallow hollow of moss carries weathered boulders, a fallen log, a stone
// lantern and a blossoming tree, with ferns, petals and glowing spores. Every splat's color carries
// the light of the scene's golden hour, because a capture holds the light it was taken in.
//
// The cloud is built in code from seeded noise, so every run draws the same garden. The terrain,
// the tree and the lantern are surfaces sampled into overlapping soft ellipsoids, which is what a
// photogrammetry scan of this glade would hold.
import { timeOfDay } from '@null3d/engine';
import type { SplatData } from '@null3d/splats';
import { Noise } from '../../lib/procedural';

/** Half the width of the garden's square of land, in meters. */
export const LAND = 40;
/** The hour of the light that the capture holds, and the turn of the sun's path at that hour. */
export const HOUR = 16.4;
export const HEADING = 1.2;
/** The tree that the camera circles, and the lantern that the label names. */
export const TREE = { x: -3.5, z: -2.7 } as const;
export const LANTERN = { x: 3.2, z: 1.2 } as const;
/** How much taller the lantern stands than its own carved stone, so it reads from the route. */
export const LANTERN_SCALE = 1.35;

/** The most splats that the cloud holds, which bounds its arrays. */
const CAPACITY = 800_000;

const noise = new Noise(17);

/** The direction toward the sun that the capture holds, and its linear color at its strength. */
const DAY = timeOfDay(HOUR, { heading: HEADING, model: 'physical' });
const TO_SUN: readonly [number, number, number] = [
	-(DAY.light.direction[0] as number),
	-(DAY.light.direction[1] as number),
	-(DAY.light.direction[2] as number),
];
const SUN: readonly [number, number, number] = [
	(DAY.light.color[0] as number) * DAY.light.intensity,
	(DAY.light.color[1] as number) * DAY.light.intensity,
	(DAY.light.color[2] as number) * DAY.light.intensity,
];
/** The cool light that the sky adds to every upward face, and the warm light off the ground. */
const SKY: readonly [number, number, number] = [0.3, 0.36, 0.44];
const BOUNCE: readonly [number, number, number] = [0.055, 0.05, 0.035];
/** The albedo of moss, stone, bark, blossom and the glow of the lantern. */
const MOSS_DARK = [0.03, 0.075, 0.018] as const;
const MOSS_LIGHT = [0.09, 0.17, 0.038] as const;
const EARTH = [0.075, 0.055, 0.038] as const;
const STONE = [0.3, 0.29, 0.26] as const;
const BARK = [0.075, 0.052, 0.036] as const;
const BLOSSOM = [0.58, 0.42, 0.47] as const;
const BLOSSOM_CENTER = [0.36, 0.17, 0.19] as const;
const FERN = [0.06, 0.15, 0.03] as const;
const PETAL = [0.55, 0.34, 0.4] as const;

/** The scratch linear color that a surface's lit shade is written into. */
const LIT = new Float32Array(3);

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoothstep = (x: number, a: number, b: number) => {
	const t = clamp01((x - a) / (b - a));
	return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** A repeatable number from 0 to 1, from a splat's index and a channel, without a generator. */
function hash(index: number, channel: number): number {
	let x = (index * 374761393 + channel * 668265263) >>> 0;
	x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
	return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** The height of the garden's ground at a point, in meters. */
export function gardenHeight(x: number, z: number): number {
	const r = Math.hypot(x, z);
	const bowl = -0.55 * Math.exp(-(r * r) / 120);
	const roll = 0.5 * noise.fbm2(x * 0.06 + 2.1, z * 0.06 - 0.7, 3);
	const rise = 2.4 * smoothstep(r, 19, 35) + 2.2 * smoothstep(r, 29, 40);
	return bowl + roll * (0.35 + 0.65 * smoothstep(r, 5, 22)) + rise;
}

/** The ground's normal at a point. */
function groundNormal(x: number, z: number, out: Float32Array): void {
	const e = 0.2;
	const dx = gardenHeight(x - e, z) - gardenHeight(x + e, z);
	const dz = gardenHeight(x, z - e) - gardenHeight(x, z + e);
	const length = Math.hypot(dx, 2 * e, dz);
	out[0] = dx / length;
	out[1] = (2 * e) / length;
	out[2] = dz / length;
}

/** The linear light that an upward face at a point receives, from the sun and the sky. */
function shade(
	r: number,
	g: number,
	b: number,
	nx: number,
	ny: number,
	nz: number,
	occlusion: number,
	translucent = 0,
): void {
	const lambert = Math.max(0, nx * TO_SUN[0] + ny * TO_SUN[1] + nz * TO_SUN[2]);
	const sky = 0.5 + 0.5 * ny;
	// A thin leaf or petal lets the light behind it through, which glows at the rim against a low sun.
	const behind = translucent * Math.max(0, -(nx * TO_SUN[0] + ny * TO_SUN[1] + nz * TO_SUN[2]));
	LIT[0] = Math.min(6, r * (SUN[0] * lambert * 0.55 + SKY[0] * sky + BOUNCE[0] + SUN[0] * behind));
	LIT[1] = Math.min(6, g * (SUN[1] * lambert * 0.55 + SKY[1] * sky + BOUNCE[1] + SUN[1] * behind));
	LIT[2] = Math.min(6, b * (SUN[2] * lambert * 0.55 + SKY[2] * sky + BOUNCE[2] + SUN[2] * behind));
	LIT[0] *= occlusion;
	LIT[1] *= occlusion;
	LIT[2] *= occlusion;
}

/** The cloud as it is built: flat arrays of splats, in the form that the add-on draws. */
class Builder {
	readonly positions = new Float32Array(CAPACITY * 3);
	readonly scales = new Float32Array(CAPACITY * 3);
	readonly rotations = new Float32Array(CAPACITY * 4);
	readonly colors = new Float32Array(CAPACITY * 4);
	count = 0;

	/** Adds a splat with a rotation of its own, which the caller gives as four numbers. */
	add(
		x: number,
		y: number,
		z: number,
		sx: number,
		sy: number,
		sz: number,
		qx: number,
		qy: number,
		qz: number,
		qw: number,
		r: number,
		g: number,
		b: number,
		a: number,
	): void {
		if (this.count >= CAPACITY) return;
		const i = this.count++;
		this.positions[i * 3] = x;
		this.positions[i * 3 + 1] = y;
		this.positions[i * 3 + 2] = z;
		this.scales[i * 3] = sx;
		this.scales[i * 3 + 1] = sy;
		this.scales[i * 3 + 2] = sz;
		this.rotations[i * 4] = qx;
		this.rotations[i * 4 + 1] = qy;
		this.rotations[i * 4 + 2] = qz;
		this.rotations[i * 4 + 3] = qw;
		this.colors[i * 4] = r;
		this.colors[i * 4 + 1] = g;
		this.colors[i * 4 + 2] = b;
		this.colors[i * 4 + 3] = a;
	}

	/** Adds a splat that is flattened across a surface's normal, with a turn about it. */
	flat(
		x: number,
		y: number,
		z: number,
		sx: number,
		sy: number,
		nx: number,
		ny: number,
		nz: number,
		turn: number,
		r: number,
		g: number,
		b: number,
		a: number,
	): void {
		const length = Math.hypot(nx, ny, nz) || 1;
		nx /= length;
		ny /= length;
		nz /= length;
		// The short turn from +Y to the normal, then the splat's own turn about it.
		let qx: number;
		let qy: number;
		let qz: number;
		let qw: number;
		if (ny < -0.9999) {
			qx = 1;
			qy = 0;
			qz = 0;
			qw = 0;
		} else {
			const ix = nz;
			const iy = 0;
			const iz = -nx;
			const iw = 1 + ny;
			const norm = Math.hypot(ix, iy, iz, iw) || 1;
			qx = ix / norm;
			qy = iy / norm;
			qz = iz / norm;
			qw = iw / norm;
		}
		const s = Math.sin(turn * 0.5);
		const c = Math.cos(turn * 0.5);
		const rx = qx * c + qz * s;
		const ry = qy * c + qw * s;
		const rz = qz * c - qx * s;
		const rw = qw * c - qy * s;
		this.add(x, y, z, sx, sy, sx, rx, ry, rz, rw, r, g, b, a);
	}
}

/** A unit quaternion from a repeatable number, which turns a splat to no face in particular. */
function quaternion(index: number, out: Float32Array): void {
	const u1 = hash(index, 1);
	const u2 = hash(index, 2);
	const u3 = hash(index, 3);
	const a = Math.sqrt(1 - u1);
	const b = Math.sqrt(u1);
	const t1 = 2 * Math.PI * u2;
	const t2 = 2 * Math.PI * u3;
	out[0] = a * Math.sin(t1);
	out[1] = a * Math.cos(t1);
	out[2] = b * Math.sin(t2);
	out[3] = b * Math.cos(t2);
}

const TURN = new Float32Array(4);
const NORMAL = new Float32Array(3);
const GROUND_RGB = new Float32Array(3);

/** The ground: moss with patches of earth, thinning to the hollow's slopes and up to the mountains. */
function addGround(cloud: Builder): void {
	let index = 0;
	const core = 13;
	const step = 0.075;
	for (let gx = -core; gx <= core; gx += step)
		for (let gz = -core; gz <= core; gz += step) {
			index++;
			const x = gx + (hash(index, 1) - 0.5) * step * 0.9;
			const z = gz + (hash(index, 2) - 0.5) * step * 0.9;
			addGroundSplat(cloud, index, x, z, 0.038 + hash(index, 3) * 0.022);
		}
	const outer = LAND - 0.6;
	const far = 0.27;
	for (let gx = -outer; gx <= outer; gx += far)
		for (let gz = -outer; gz <= outer; gz += far) {
			index++;
			if (Math.abs(gx) < core + far && Math.abs(gz) < core + far) continue;
			const x = gx + (hash(index, 1) - 0.5) * far * 0.9;
			const z = gz + (hash(index, 2) - 0.5) * far * 0.9;
			addGroundSplat(cloud, index, x, z, 0.1 + hash(index, 3) * 0.09);
		}
}

/**
 * The moss and earth of the ground at a point, in linear color, which the cloud's ground splats and
 * the mesh beneath them both wear.
 */
export function groundColor(x: number, z: number, out: number[] | Float32Array): void {
	const patch = noise.fbm2(x * 0.5 + 11, z * 0.5 - 3, 3);
	const grain = noise.fbm2(x * 2.6 - 5, z * 2.6 + 8, 2);
	const earth = smoothstep(patch, 0.08, 0.58);
	const light = clamp01(0.5 + grain * 0.7);
	out[0] = mix(mix(MOSS_DARK[0], MOSS_LIGHT[0], light), EARTH[0], earth);
	out[1] = mix(mix(MOSS_DARK[1], MOSS_LIGHT[1], light), EARTH[1], earth);
	out[2] = mix(mix(MOSS_DARK[2], MOSS_LIGHT[2], light), EARTH[2], earth);
}

/** One splat of the ground, shaded by where it lies. */
function addGroundSplat(cloud: Builder, index: number, x: number, z: number, size: number): void {
	const y = gardenHeight(x, z);
	groundNormal(x, z, NORMAL);
	groundColor(x, z, GROUND_RGB);
	const occlusion = 0.62 + 0.38 * (0.5 + 0.5 * noise.fbm2(x * 0.16 + 4, z * 0.16 - 9, 2));
	shade(
		GROUND_RGB[0] as number,
		GROUND_RGB[1] as number,
		GROUND_RGB[2] as number,
		NORMAL[0] as number,
		NORMAL[1] as number,
		NORMAL[2] as number,
		occlusion,
	);
	cloud.flat(
		x,
		y + 0.01,
		z,
		size,
		size * 0.35,
		NORMAL[0] as number,
		NORMAL[1] as number,
		NORMAL[2] as number,
		hash(index, 4) * Math.PI * 2,
		LIT[0] as number,
		LIT[1] as number,
		LIT[2] as number,
		0.9,
	);
}

/** Fallen petals over the ground beneath the blossom. */
function addPetals(cloud: Builder, count: number): void {
	for (let i = 0; i < count; i++) {
		const angle = hash(i, 1) * Math.PI * 2;
		const reach = 9 * Math.sqrt(hash(i, 2));
		const x = Math.cos(angle) * reach;
		const z = Math.sin(angle) * reach;
		const y = gardenHeight(x, z) + 0.015;
		const pale = hash(i, 3);
		const r = mix(PETAL[0], 0.98, pale);
		const g = mix(PETAL[1], 0.82, pale);
		const b = mix(PETAL[2], 0.86, pale);
		shade(r, g, b, 0, 1, 0, 0.9, 0.25);
		cloud.flat(
			x,
			y,
			z,
			0.02 + hash(i, 4) * 0.014,
			0.006,
			0,
			1,
			0,
			hash(i, 5) * Math.PI * 2,
			LIT[0] as number,
			LIT[1] as number,
			LIT[2] as number,
			0.85,
		);
	}
}

/** A boulder of the glade: where it stands, its half axes and the turn that lays its grain. */
interface Rock {
	readonly x: number;
	readonly z: number;
	readonly rx: number;
	readonly ry: number;
	readonly rz: number;
	readonly yaw: number;
}
const ROCKS: readonly Rock[] = [
	{ x: 5.8, z: -2.4, rx: 1.4, ry: 1.0, rz: 1.1, yaw: 0.4 },
	{ x: -6.2, z: 2.9, rx: 1.15, ry: 1.3, rz: 1.0, yaw: 1.2 },
	{ x: 1.0, z: -6.6, rx: 0.9, ry: 0.75, rz: 0.85, yaw: 2.1 },
	{ x: -5.4, z: -6.4, rx: 1.3, ry: 0.95, rz: 1.1, yaw: 2.8 },
	{ x: 7.2, z: 5.8, rx: 0.85, ry: 0.62, rz: 0.72, yaw: 0.9 },
	{ x: -2.2, z: 7.0, rx: 0.72, ry: 0.48, rz: 0.6, yaw: 1.7 },
	{ x: 8.8, z: 0.9, rx: 1.1, ry: 0.8, rz: 0.9, yaw: 2.4 },
];

/** The surface area of an ellipsoid, at about, which sets how many splats cover it. */
function ellipsoidArea(rx: number, ry: number, rz: number): number {
	const p = 1.6;
	const a = (rx * ry) ** p;
	const b = (rx * rz) ** p;
	const c = (ry * rz) ** p;
	return 4 * Math.PI * ((a + b + c) / 3) ** (1 / p);
}

/** The boulders, each sampled over its surface and mossed on its upward faces. */
function addRocks(cloud: Builder): void {
	for (let k = 0; k < ROCKS.length; k++) {
		const rock = ROCKS[k] as Rock;
		const baseY = gardenHeight(rock.x, rock.z) + rock.ry * 0.25;
		const count = Math.round(ellipsoidArea(rock.rx, rock.ry, rock.rz) * 520);
		const cos = Math.cos(rock.yaw);
		const sin = Math.sin(rock.yaw);
		for (let i = 0; i < count; i++) {
			const index = k * 1_000_000 + i;
			const up = 1 - 2 * hash(index, 1);
			const around = hash(index, 2) * Math.PI * 2;
			const across = Math.sqrt(Math.max(0, 1 - up * up));
			const dx = Math.cos(around) * across;
			const dy = up;
			const dz = Math.sin(around) * across;
			const bump = 1 + 0.16 * noise.fbm3(dx * 2.1 + k, dy * 2.1, dz * 2.1 - 3, 2);
			const lx = rock.rx * dx * bump;
			const ly = rock.ry * dy * bump;
			const lz = rock.rz * dz * bump;
			const x = rock.x + lx * cos - lz * sin;
			const z = rock.z + lx * sin + lz * cos;
			const y = baseY + ly;
			// The ellipsoid's normal, turned back into the world.
			const gx0 = dx / rock.rx;
			const gy0 = dy / rock.ry;
			const gz0 = dz / rock.rz;
			const gl = Math.hypot(gx0, gy0, gz0) || 1;
			const nx = (gx0 * cos - gz0 * sin) / gl;
			const ny = gy0 / gl;
			const nz = (gx0 * sin + gz0 * cos) / gl;
			const moss =
				smoothstep(ny, 0.12, 0.6) * smoothstep(noise.fbm2(x * 1.6, z * 1.6, 2), -0.15, 0.4);
			const lichen = smoothstep(noise.fbm2(x * 3.1 + 7, y * 3.1 - 2, 2), 0.35, 0.72);
			const grain = 0.6 + 0.4 * noise.fbm3(x * 5, y * 5, z * 5, 2);
			const r = mix(STONE[0] * grain, MOSS_LIGHT[0], moss) + lichen * 0.06;
			const g = mix(STONE[1] * grain, MOSS_LIGHT[1], moss) + lichen * 0.07;
			const b = mix(STONE[2] * grain, MOSS_LIGHT[2], moss) + lichen * 0.05;
			shade(r, g, b, nx, ny, nz, 0.72 + 0.28 * smoothstep(y - baseY, -rock.ry, rock.ry));
			const size = 0.026 + hash(index, 3) * 0.02;
			quaternion(index, TURN);
			cloud.add(
				x,
				y,
				z,
				size,
				size * (0.75 + hash(index, 4) * 0.6),
				size * (0.75 + hash(index, 5) * 0.6),
				TURN[0] as number,
				TURN[1] as number,
				TURN[2] as number,
				TURN[3] as number,
				LIT[0] as number,
				LIT[1] as number,
				LIT[2] as number,
				0.92,
			);
		}
	}
}

/** The fallen log that lies across the near bank, mossed on top. */
function addLog(cloud: Builder): void {
	const cx = -1.2;
	const cz = 4.3;
	const baseY = gardenHeight(cx, cz) + 0.3;
	const ax = 0.96;
	const az = 0.28;
	const length = 2.0;
	const radius = 0.3;
	const steps = Math.round((length * 2) / 0.03);
	const sides = Math.round((Math.PI * 2 * radius) / 0.03);
	for (let s = 0; s <= steps; s++) {
		const along = -length + (2 * length * s) / steps;
		const x0 = cx + ax * along;
		const z0 = cz + az * along;
		const flare = 0.85 + 0.25 * Math.cos((along / length) * Math.PI * 0.5);
		for (let k = 0; k < sides; k++) {
			const index = 7_000_000 + s * 500 + k;
			const angle = (k / sides) * Math.PI * 2 + hash(index, 1) * 0.05;
			// The side's frame: across the log and up.
			const nx = -az * Math.cos(angle);
			const ny = Math.sin(angle);
			const nz = ax * Math.cos(angle);
			const r = radius * flare * (1 + 0.1 * hash(index, 2));
			const x = x0 + nx * r;
			const y = baseY + ny * r;
			const z = z0 + nz * r;
			const moss =
				smoothstep(ny, 0.25, 0.75) * smoothstep(noise.fbm2(x * 2.4, z * 2.4, 2), -0.3, 0.3);
			const grain = 0.7 + 0.3 * noise.fbm3(x * 8, y * 8, z * 8, 2);
			const ar = mix(BARK[0] * grain, MOSS_LIGHT[0], moss);
			const ag = mix(BARK[1] * grain, MOSS_LIGHT[1], moss);
			const ab = mix(BARK[2] * grain, MOSS_LIGHT[2], moss);
			shade(ar, ag, ab, nx, ny, nz, 0.75 + 0.25 * (ny * 0.5 + 0.5));
			const size = 0.026 + hash(index, 3) * 0.014;
			quaternion(index, TURN);
			cloud.add(
				x,
				y,
				z,
				size,
				size,
				size,
				TURN[0] as number,
				TURN[1] as number,
				TURN[2] as number,
				TURN[3] as number,
				LIT[0] as number,
				LIT[1] as number,
				LIT[2] as number,
				0.92,
			);
		}
	}
}

/** The tree's trunk and branches: tapered tubes along curves, barked and mossed. */
function addTree(cloud: Builder): void {
	const baseY = gardenHeight(TREE.x, TREE.z);
	/** The trunk's own curve, from the root to the fork. */
	const trunk = (t: number): [number, number, number] => [
		TREE.x + 0.95 * t + 0.16 * Math.sin(3.1 * t),
		baseY + 3.0 * t,
		TREE.z + 0.3 * t + 0.1 * Math.sin(2 * t),
	];
	let seed = 20_000_000;
	const tube = (
		curve: (t: number) => [number, number, number],
		radius: (t: number) => number,
		steps: number,
		sides: number,
		mossy: number,
	): void => {
		for (let s = 0; s <= steps; s++) {
			const t = s / steps;
			const [x, y, z] = curve(t);
			const [x1, y1, z1] = curve(Math.max(0, t - 0.01));
			const [x2, y2, z2] = curve(Math.min(1, t + 0.01));
			let tx = x2 - x1;
			let ty = y2 - y1;
			let tz = z2 - z1;
			const tl = Math.hypot(tx, ty, tz) || 1;
			tx /= tl;
			ty /= tl;
			tz /= tl;
			// A frame across the tube: across the tangent and the up axis.
			let ux = ty * 0 - tz * 1;
			let uy = tz * 0 - tx * 0;
			let uz = tx * 1 - ty * 0;
			const ul = Math.hypot(ux, uy, uz) || 1;
			if (ul < 1e-5) {
				ux = 1;
				uy = 0;
				uz = 0;
			} else {
				ux /= ul;
				uy /= ul;
				uz /= ul;
			}
			const vx = ty * uz - tz * uy;
			const vy = tz * ux - tx * uz;
			const vz = tx * uy - ty * ux;
			const r = radius(t);
			for (let k = 0; k < sides; k++) {
				seed++;
				const angle = (k / sides) * Math.PI * 2 + hash(seed, 1) * 0.05;
				const cos = Math.cos(angle);
				const sin = Math.sin(angle);
				const nx = ux * cos + vx * sin;
				const ny = uy * cos + vy * sin;
				const nz = uz * cos + vz * sin;
				const rr = r * (1 + (hash(seed, 2) - 0.5) * 0.12);
				const px = x + nx * rr;
				const py = y + ny * rr;
				const pz = z + nz * rr;
				const moss =
					mossy *
					smoothstep(ny, -0.2, 0.6) *
					smoothstep(noise.fbm2(px * 2.4, pz * 2.4, 2), -0.25, 0.35);
				const grain = 0.65 + 0.35 * noise.fbm3(px * 9, py * 9, pz * 9, 2);
				const ar = mix(BARK[0] * grain, MOSS_LIGHT[0], moss);
				const ag = mix(BARK[1] * grain, MOSS_LIGHT[1], moss);
				const ab = mix(BARK[2] * grain, MOSS_LIGHT[2], moss);
				shade(ar, ag, ab, nx, ny, nz, 0.7 + 0.3 * (ny * 0.5 + 0.5));
				// The branches keep a size that survives a coarse level, so the crown never floats free.
				const size = Math.min(0.05, Math.max(0.03, r * 0.2)) + hash(seed, 3) * 0.008;
				quaternion(seed, TURN);
				cloud.add(
					px,
					py,
					pz,
					size,
					size,
					size,
					TURN[0] as number,
					TURN[1] as number,
					TURN[2] as number,
					TURN[3] as number,
					LIT[0] as number,
					LIT[1] as number,
					LIT[2] as number,
					0.93,
				);
			}
		}
	};
	tube(trunk, (t) => mix(0.32, 0.16, t), 90, 40, 1);
	const fork = trunk(1);
	const ends: [number, number, number][] = [
		[fork[0] + 2.4, fork[1] + 1.5, fork[2] + 1.5],
		[fork[0] + 0.3, fork[1] + 2.2, fork[2] - 1.9],
		[fork[0] - 1.9, fork[1] + 1.5, fork[2] + 0.2],
		[fork[0] + 1.5, fork[1] + 2.5, fork[2] - 0.5],
	];
	for (let b = 0; b < ends.length; b++) {
		const [ex, ey, ez] = ends[b] as [number, number, number];
		const lift = 0.7 + b * 0.12;
		const branch = (t: number): [number, number, number] => {
			const mt = 1 - t;
			const p0 = fork;
			const p1: [number, number, number] = [
				(fork[0] + ex) / 2,
				(fork[1] + ey) / 2 + lift,
				(fork[2] + ez) / 2,
			];
			const p2 = [ex, ey, ez] as const;
			return [
				mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
				mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
				mt * mt * p0[2] + 2 * mt * t * p1[2] + t * t * p2[2],
			];
		};
		tube(branch, (t) => mix(0.13, 0.035, t), 55, 22, 0.5);
		// Twigs from the branch to the tips of its blossom lobe.
		for (let w = 0; w < 3; w++) {
			const t0 = 0.55 + w * 0.15;
			const start = branch(t0);
			const angle = w * 2.1 + b;
			const tip: [number, number, number] = [
				start[0] + Math.cos(angle) * 0.8,
				start[1] + 0.5 + w * 0.2,
				start[2] + Math.sin(angle) * 0.8,
			];
			const twig = (t: number): [number, number, number] => [
				start[0] + (tip[0] - start[0]) * t,
				start[1] + (tip[1] - start[1]) * t,
				start[2] + (tip[2] - start[2]) * t,
			];
			tube(twig, (t) => mix(0.04, 0.014, t), 12, 10, 0.2);
		}
	}
	addBlossoms(cloud, fork, ends);
}

/** The blossom lobes, their flowers and the petals that hang in the air beneath them. */
function addBlossoms(
	cloud: Builder,
	fork: readonly [number, number, number],
	ends: readonly (readonly [number, number, number])[],
): void {
	// Each lobe of blossom sits at a branch's end, wider across than deep.
	const lobes = ends.map((end, k) => ({
		x: end[0] + (k % 2 === 0 ? 0.3 : -0.2),
		y: end[1] + 0.35 + (k % 3) * 0.15,
		z: end[2] + (k % 2 === 0 ? -0.2 : 0.25),
		rx: 1.55 - k * 0.1,
		ry: 0.8 + (k % 2) * 0.15,
		rz: 1.45 - k * 0.08,
	}));
	const volume = lobes.map((l) => l.rx * l.ry * l.rz);
	const totalVolume = volume.reduce((a, b) => a + b, 0);
	const flowers = 5_400;
	let index = 30_000_000;
	for (let l = 0; l < lobes.length; l++) {
		const lobe = lobes[l] as (typeof lobes)[number];
		const count = Math.round((flowers * (volume[l] as number)) / totalVolume);
		for (let i = 0; i < count; i++) {
			index++;
			const up = 1 - 2 * hash(index, 1);
			const around = hash(index, 2) * Math.PI * 2;
			const across = Math.sqrt(Math.max(0, 1 - up * up));
			// The flowers gather toward the lobe's outside, so the canopy keeps air between its sprays.
			const radius = 0.55 + 0.45 * Math.cbrt(hash(index, 3));
			const dx = Math.cos(around) * across;
			const dy = up;
			const dz = Math.sin(around) * across;
			const x = lobe.x + dx * lobe.rx * radius;
			const y = lobe.y + dy * lobe.ry * radius;
			const z = lobe.z + dz * lobe.rz * radius;
			if (y < fork[1]) continue;
			// A few sprays of young leaf break up the blossom.
			if (hash(index, 7) < 0.14) addLeaf(cloud, index, x, y, z);
			else addFlower(cloud, index, x, y, z, dx, dy, dz);
		}
	}
	// A looser spray of flowers outside each lobe, which softens the canopy's outline.
	for (let i = 0; i < 1_400; i++) {
		const index = 32_000_000 + i;
		const lobe = lobes[i % lobes.length] as (typeof lobes)[number];
		const up = 1 - 2 * hash(index, 1);
		const around = hash(index, 2) * Math.PI * 2;
		const across = Math.sqrt(Math.max(0, 1 - up * up));
		const reach = 1 + hash(index, 3) * 0.38;
		const dx = Math.cos(around) * across;
		const dy = up;
		const dz = Math.sin(around) * across;
		addFlower(
			cloud,
			index,
			lobe.x + dx * lobe.rx * reach,
			lobe.y + dy * lobe.ry * reach,
			lobe.z + dz * lobe.rz * reach,
			dx,
			dy,
			dz,
		);
	}
	// Petals on the air and on the ground under the blossom.
	for (let i = 0; i < 700; i++) {
		const index = 31_000_000 + i;
		const lobe = lobes[i % lobes.length] as (typeof lobes)[number];
		const x = lobe.x + (hash(index, 1) - 0.5) * 4.6;
		const z = lobe.z + (hash(index, 2) - 0.5) * 4.4;
		const y = Math.max(gardenHeight(x, z) + 0.2, lobe.y - 0.4 - hash(index, 3) * 1.8);
		const r = mix(PETAL[0], 0.98, hash(index, 4));
		const g = mix(PETAL[1], 0.84, hash(index, 4));
		const b = mix(PETAL[2], 0.88, hash(index, 4));
		shade(r, g, b, 0, 1, 0, 0.95, 0.5);
		cloud.flat(
			x,
			y,
			z,
			0.018,
			0.005,
			0.1,
			0.7,
			0.5,
			hash(index, 5) * Math.PI * 2,
			LIT[0] as number,
			LIT[1] as number,
			LIT[2] as number,
			0.8,
		);
	}
}

/** One spray of young leaves among the blossom: a few flat green splats about a point. */
function addLeaf(cloud: Builder, index: number, x: number, y: number, z: number): void {
	for (let k = 0; k < 6; k++) {
		const a = hash(index, 8 + k) * Math.PI * 2;
		const reach = 0.03 + hash(index, 14 + k) * 0.05;
		const px = x + Math.cos(a) * reach;
		const pz = z + Math.sin(a) * reach;
		const py = y + (hash(index, 20 + k) - 0.6) * 0.05;
		shade(FERN[0] * 1.5, FERN[1] * 1.3, FERN[2] * 1.5, 0.2, 0.7, 0.2, 1, 0.55);
		cloud.flat(
			px,
			py,
			pz,
			0.03 + hash(index, 26 + k) * 0.02,
			0.008,
			0.2,
			0.7,
			0.2,
			a,
			LIT[0] as number,
			LIT[1] as number,
			LIT[2] as number,
			0.86,
		);
	}
}

/** One blossom: five petals of four soft splats, and a darker heart. */
function addFlower(
	cloud: Builder,
	index: number,
	x: number,
	y: number,
	z: number,
	nx: number,
	ny: number,
	nz: number,
): void {
	const nl = Math.hypot(nx, ny, nz) || 1;
	const ux = nx / nl;
	const uy = ny / nl;
	const uz = nz / nl;
	// A frame across the flower's face.
	let ax = -uz;
	let ay = 0;
	let az = ux;
	let al = Math.hypot(ax, ay, az);
	if (al < 1e-5) {
		ax = 1;
		ay = 0;
		az = 0;
		al = 1;
	}
	ax /= al;
	ay /= al;
	az /= al;
	const bx = uy * az - uz * ay;
	const by = uz * ax - ux * az;
	const bz = ux * ay - uy * ax;
	const size = 0.7 + hash(index, 4) * 0.6;
	const pale = hash(index, 5);
	const r = mix(BLOSSOM[0], 0.74, pale);
	const g = mix(BLOSSOM[1], 0.57, pale);
	const b = mix(BLOSSOM[2], 0.63, pale);
	for (let petal = 0; petal < 5; petal++) {
		const angle = (petal / 5) * Math.PI * 2 + hash(index, 6) * 0.5;
		const px = Math.cos(angle);
		const pz = Math.sin(angle);
		for (let step = 0; step < 4; step++) {
			const reach = 0.012 + step * 0.016;
			const sx = x + (ax * px + bx * pz) * reach;
			const sy = y + (ay * px + by * pz) * reach;
			const sz = z + (az * px + bz * pz) * reach;
			shade(r, g, b, ux, uy, uz, 0.95, 0.32);
			cloud.flat(
				sx,
				sy,
				sz,
				0.026 * size,
				0.009 * size,
				ux,
				uy,
				uz,
				angle + step,
				LIT[0] as number,
				LIT[1] as number,
				LIT[2] as number,
				0.74,
			);
		}
	}
	shade(BLOSSOM_CENTER[0], BLOSSOM_CENTER[1], BLOSSOM_CENTER[2], ux, uy, uz, 0.9, 0.2);
	for (let k = 0; k < 2; k++) {
		cloud.flat(
			x + ux * 0.005 * k,
			y + uy * 0.005 * k,
			z + uz * 0.005 * k,
			0.014 * size,
			0.008 * size,
			ux,
			uy,
			uz,
			0,
			LIT[0] as number,
			LIT[1] as number,
			LIT[2] as number,
			0.9,
		);
	}
}

/** The ferns of the glade: fronds that arch out of the moss with leaflets either side. */
const FERNS: readonly (readonly [number, number])[] = [
	[-4.9, 0.3],
	[-5.8, 3.9],
	[0.7, 3.3],
	[2.5, 5.4],
	[6.2, 3.5],
	[6.8, -0.6],
	[4.0, -4.5],
	[-2.5, -5.0],
	[-6.4, -2.2],
	[0.3, -2.6],
	[-1.1, 5.8],
	[4.7, 1.7],
	[-7.5, 5.4],
	[7.9, 2.3],
	[8.3, 7.4],
	[7.0, 9.2],
	[5.9, 6.2],
	[9.6, 5.2],
];
function addFerns(cloud: Builder): void {
	let index = 40_000_000;
	for (let f = 0; f < FERNS.length; f++) {
		const [fx, fz] = FERNS[f] as readonly [number, number];
		const baseY = gardenHeight(fx, fz);
		const fronds = 11;
		for (let frond = 0; frond < fronds; frond++) {
			const angle = (frond / fronds) * Math.PI * 2 + hash(f * 100 + frond, 1) * 0.7;
			const dirx = Math.cos(angle);
			const dirz = Math.sin(angle);
			const length = 0.6 + hash(f * 100 + frond, 2) * 0.6;
			const steps = 20;
			for (let s = 1; s <= steps; s++) {
				const t = s / steps;
				const px = fx + dirx * length * (t + 0.12 * t * t);
				const pz = fz + dirz * length * (t + 0.12 * t * t);
				const py = baseY + length * (0.55 * Math.sin(Math.PI * t * 0.82) - 0.28 * t * t);
				index++;
				// The rachis.
				shade(FERN[0], FERN[1], FERN[2], 0.2, 0.8, 0.2, 0.95, 0.4);
				cloud.flat(
					px,
					py,
					pz,
					0.014,
					0.006,
					0.2,
					0.8,
					0.2,
					-angle,
					LIT[0] as number,
					LIT[1] as number,
					LIT[2] as number,
					0.9,
				);
				// The leaflets, each a pair across the rachis.
				const leaflet = 0.2 * length * (1 - t) + 0.025;
				for (const side of [-1, 1] as const) {
					const ox = -dirz * side;
					const oz = dirx * side;
					for (let k = 0; k < 2; k++) {
						index++;
						const reach = leaflet * (0.35 + 0.65 * k);
						const lx = px + ox * reach;
						const lz = pz + oz * reach;
						const ly = py + 0.012 * k - 0.02 * reach;
						const varied = 0.85 + hash(index, 3) * 0.35;
						shade(FERN[0], FERN[1], FERN[2], ox * 0.3, 0.75, oz * 0.3, 1, 0.55);
						cloud.flat(
							lx,
							ly,
							lz,
							leaflet * 0.45 * varied,
							0.007,
							ox * 0.3,
							0.75,
							oz * 0.3,
							angle + side * 0.9 + hash(index, 4),
							LIT[0] as number,
							LIT[1] as number,
							LIT[2] as number,
							0.88,
						);
					}
				}
			}
		}
	}
}

/** Soft tufts of moss on the ground, thickest around the stones and the tree's root. */
function addTufts(cloud: Builder, count: number): void {
	for (let i = 0; i < count; i++) {
		const index = 50_000_000 + i;
		// Points gather near the boulders, the log and the tree, and thin over the open moss.
		const pick = hash(index, 1);
		let x: number;
		let z: number;
		if (pick < 0.55) {
			const rock = ROCKS[Math.floor(hash(index, 2) * ROCKS.length) % ROCKS.length] as Rock;
			const angle = hash(index, 3) * Math.PI * 2;
			const reach = rock.rx * (1 + hash(index, 4) * 0.7);
			x = rock.x + Math.cos(angle) * reach;
			z = rock.z + Math.sin(angle) * reach;
		} else if (pick < 0.75) {
			x = TREE.x + (hash(index, 3) - 0.5) * 3.4;
			z = TREE.z + (hash(index, 4) - 0.5) * 3.4;
		} else {
			x = (hash(index, 3) - 0.5) * 18;
			z = (hash(index, 4) - 0.5) * 18;
		}
		const size = 0.02 + hash(index, 5) * 0.02;
		const shadeMix = clamp01(0.4 + noise.fbm2(x * 1.3 + 5, z * 1.3, 2));
		const r = mix(MOSS_DARK[0], MOSS_LIGHT[0], shadeMix);
		const g = mix(MOSS_DARK[1], MOSS_LIGHT[1], shadeMix);
		const b = mix(MOSS_DARK[2], MOSS_LIGHT[2], shadeMix);
		for (let k = 0; k < 6; k++) {
			const a = hash(index, 6 + k);
			const spread = size * 2.2;
			const px = x + (hash(index, 12 + k) - 0.5) * spread;
			const pz = z + (hash(index, 18 + k) - 0.5) * spread;
			const py = gardenHeight(px, pz) + 0.012 + a * 0.05;
			groundNormal(px, pz, NORMAL);
			shade(r, g, b, NORMAL[0] as number, NORMAL[1] as number, NORMAL[2] as number, 0.95 + a * 0.1);
			cloud.flat(
				px,
				py,
				pz,
				size * (0.7 + a * 0.6),
				size * 0.8,
				NORMAL[0] as number,
				NORMAL[1] as number,
				NORMAL[2] as number,
				a * Math.PI * 2,
				LIT[0] as number,
				LIT[1] as number,
				LIT[2] as number,
				0.72,
			);
		}
	}
}

/** The glowing spores that hang in the air of the glade, which bloom when it is turned on. */
function addSpores(cloud: Builder): void {
	for (let i = 0; i < 360; i++) {
		const index = 60_000_000 + i;
		const angle = hash(index, 1) * Math.PI * 2;
		const reach = 0.5 + Math.sqrt(hash(index, 2)) * 10;
		const x = Math.cos(angle) * reach;
		const z = Math.sin(angle) * reach;
		const y = gardenHeight(x, z) + 0.35 + hash(index, 3) * 2.3;
		const warm = hash(index, 4);
		quaternion(index, TURN);
		cloud.add(
			x,
			y,
			z,
			0.012 + hash(index, 5) * 0.014,
			0.012,
			0.012,
			TURN[0] as number,
			TURN[1] as number,
			TURN[2] as number,
			TURN[3] as number,
			mix(1.6, 2.6, warm),
			mix(2.2, 1.8, warm),
			mix(0.7, 0.5, warm),
			0.65,
		);
	}
}

/** A path of flat stepping stones that leads from the near ground to the lantern. */
function addPath(cloud: Builder): void {
	const stones = 9;
	let index = 70_000_000;
	for (let k = 0; k < stones; k++) {
		const t = k / (stones - 1);
		const x = mix(6.2, 3.6, t) + Math.sin(t * 4.2) * 0.35;
		const z = mix(7.6, 2.6, t);
		const across = 0.5 + hash(k, 1) * 0.2;
		const along = 0.4 + hash(k, 2) * 0.16;
		const turn = hash(k, 3) * Math.PI;
		const grain = 0.6 + 0.4 * hash(k, 4);
		const count = 70;
		for (let i = 0; i < count; i++) {
			index++;
			const angle = hash(index, 1) * Math.PI * 2;
			const reach = Math.sqrt(hash(index, 2));
			const lx = Math.cos(angle) * reach * across;
			const lz = Math.sin(angle) * reach * along;
			const px = x + lx * Math.cos(turn) - lz * Math.sin(turn);
			const pz = z + lx * Math.sin(turn) + lz * Math.cos(turn);
			const py = gardenHeight(px, pz) + 0.1 + hash(index, 3) * 0.02;
			groundNormal(px, pz, NORMAL);
			const moss = smoothstep(hash(index, 4), 0.7, 1);
			const stone = 1.25;
			const r = mix(STONE[0] * grain * stone, MOSS_LIGHT[0], moss * 0.5);
			const g = mix(STONE[1] * grain * stone, MOSS_LIGHT[1], moss * 0.5);
			const b = mix(STONE[2] * grain * stone, MOSS_LIGHT[2], moss * 0.5);
			shade(r, g, b, NORMAL[0] as number, NORMAL[1] as number, NORMAL[2] as number, 0.9);
			cloud.flat(
				px,
				py,
				pz,
				0.02 + hash(index, 5) * 0.012,
				0.009,
				NORMAL[0] as number,
				NORMAL[1] as number,
				NORMAL[2] as number,
				hash(index, 6) * Math.PI * 2,
				LIT[0] as number,
				LIT[1] as number,
				LIT[2] as number,
				0.9,
			);
		}
		// The slab's rim, so it stands out of the moss rather than blending into it.
		for (let i = 0; i < 26; i++) {
			index++;
			const angle = (i / 26) * Math.PI * 2;
			const px =
				x +
				Math.cos(angle) * across * 0.95 * Math.cos(turn) -
				Math.sin(angle) * along * 0.95 * Math.sin(turn);
			const pz =
				z +
				Math.cos(angle) * across * 0.95 * Math.sin(turn) +
				Math.sin(angle) * along * 0.95 * Math.cos(turn);
			const py = gardenHeight(px, pz) + 0.045 + hash(index, 3) * 0.02;
			groundNormal(px, pz, NORMAL);
			shade(
				STONE[0] * 1.35,
				STONE[1] * 1.35,
				STONE[2] * 1.35,
				NORMAL[0] as number,
				NORMAL[1] as number,
				NORMAL[2] as number,
				0.85,
			);
			cloud.flat(
				px,
				py,
				pz,
				0.022,
				0.012,
				NORMAL[0] as number,
				NORMAL[1] as number,
				NORMAL[2] as number,
				angle,
				LIT[0] as number,
				LIT[1] as number,
				LIT[2] as number,
				0.95,
			);
		}
	}
}

/** Builds the garden's whole cloud, in the form that the splats add-on draws. */
export function createCloud(): SplatData {
	const cloud = new Builder();
	addGround(cloud);
	addPetals(cloud, 16_000);
	addRocks(cloud);
	addLog(cloud);
	addTree(cloud);
	addFerns(cloud);
	addPath(cloud);
	addTufts(cloud, 2_600);
	addSpores(cloud);
	const count = cloud.count;
	return {
		count,
		positions: cloud.positions.subarray(0, count * 3),
		scales: cloud.scales.subarray(0, count * 3),
		rotations: cloud.rotations.subarray(0, count * 4),
		colors: cloud.colors.subarray(0, count * 4),
	};
}
