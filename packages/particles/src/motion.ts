// The particles' motion on the CPU, the same closed form that the particle shaders work out on the
// GPU: gravity and linear drag toward the wind, a ground that ends, bounces or stops a particle, and
// simplex-noise turbulence as a displacement. Systems use it where the CPU must know a particle's
// state: where a sub-emitter starts, when the ground ends a particle, and how far the particles
// reach, for the culling bounds. It allocates nothing.

/** The most bounces a particle makes off the ground, as in the shaders. */
const BOUNCES = 2;
/** Newton steps toward each impact, as in the shaders. */
const STEPS = 4;
/** Drag below which the motion is the plain ballistic one. */
const LITTLE_DRAG = 1e-4;

/** The ground's mode codes, as the shaders read them: none, kill, bounce and stick. */
export const GROUND_NONE = 0;
export const GROUND_KILL = 1;
export const GROUND_BOUNCE = 2;
export const GROUND_STICK = 3;

/** The motion values of a system, in the space of its object. */
export interface MotionValues {
	gx: number;
	gy: number;
	gz: number;
	drag: number;
	wx: number;
	wy: number;
	wz: number;
	turbulence: number;
	turbulenceScale: number;
	turbulenceSpeed: number;
	groundHeight: number;
	groundMode: number;
	restitution: number;
	friction: number;
}

/** A particle's place and velocity, which the motion functions write. */
export interface ParticleState {
	px: number;
	py: number;
	pz: number;
	vx: number;
	vy: number;
	vz: number;
	/** False once the ground ended the particle. */
	alive: boolean;
}

/** A new state at rest at the origin. */
export function particleState(): ParticleState {
	return { px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, alive: true };
}

/** Where a flight from (p, v) is after `t` seconds, written into `out`. */
function flight(
	m: MotionValues,
	px: number,
	py: number,
	pz: number,
	vx: number,
	vy: number,
	vz: number,
	t: number,
	out: ParticleState,
): void {
	const k = m.drag;
	if (k < LITTLE_DRAG) {
		out.px = px + vx * t + 0.5 * m.gx * t * t;
		out.py = py + vy * t + 0.5 * m.gy * t * t;
		out.pz = pz + vz * t + 0.5 * m.gz * t * t;
		out.vx = vx + m.gx * t;
		out.vy = vy + m.gy * t;
		out.vz = vz + m.gz * t;
		return;
	}
	const tx = m.wx + m.gx / k;
	const ty = m.wy + m.gy / k;
	const tz = m.wz + m.gz / k;
	const decay = Math.exp(-k * t);
	const share = (1 - decay) / k;
	out.px = px + tx * t + (vx - tx) * share;
	out.py = py + ty * t + (vy - ty) * share;
	out.pz = pz + tz * t + (vz - tz) * share;
	out.vx = tx + (vx - tx) * decay;
	out.vy = ty + (vy - ty) * decay;
	out.vz = tz + (vz - tz) * decay;
}

/** Scratch state of the impact search. */
const probe = particleState();

/**
 * The first time after 0 at which a flight from (p, v) falls onto the ground, or -1 for none within
 * `limit` seconds, found as the shaders find it.
 */
export function impact(
	m: MotionValues,
	px: number,
	py: number,
	pz: number,
	vx: number,
	vy: number,
	vz: number,
	limit: number,
): number {
	const ground = m.groundHeight;
	const g = m.gy;
	const rise = py - ground;
	let t = limit;
	const d = vy * vy - 2 * g * rise;
	if (g < 0 && d >= 0) t = (-vy - Math.sqrt(d)) / g;
	else if (vy < 0) t = rise / -vy;
	t = Math.min(Math.max(t, 0), limit);
	for (let k = 0; k < STEPS; k++) {
		flight(m, px, py, pz, vx, vy, vz, t, probe);
		const fall = Math.min(probe.vy, -1e-3);
		t = Math.min(Math.max(t - (probe.py - ground) / fall, 0), limit);
	}
	// A flight that ends near the ground counts only while it falls, so one that bounced up off it
	// does not meet it again at once.
	flight(m, px, py, pz, vx, vy, vz, t, probe);
	return Math.abs(probe.py - ground) < 0.01 && t > 0 && probe.vy < 0 ? t : -1;
}

/**
 * Writes the state of a particle born at (bx, by, bz) with the velocity (vx, vy, vz), `age`
 * seconds after its birth, with `seed` its seed, into `out`, as the shaders work it out.
 */
export function stateAt(
	m: MotionValues,
	bx: number,
	by: number,
	bz: number,
	vx0: number,
	vy0: number,
	vz0: number,
	age: number,
	seed: number,
	out: ParticleState,
): void {
	let [px, py, pz, vx, vy, vz, t] = [bx, by, bz, vx0, vy0, vz0, age];
	out.alive = true;
	let stopped = false;
	if (m.groundMode !== GROUND_NONE) {
		for (let b = 0; b <= BOUNCES; b++) {
			const hit = impact(m, px, py, pz, vx, vy, vz, t);
			if (hit < 0) break;
			flight(m, px, py, pz, vx, vy, vz, hit, probe);
			if (m.groundMode === GROUND_KILL) {
				out.alive = false;
				break;
			}
			px = probe.px;
			py = m.groundHeight;
			pz = probe.pz;
			if (m.groundMode === GROUND_STICK || b === BOUNCES) {
				vx = vy = vz = 0;
				t = 0;
				stopped = true;
				break;
			}
			const keep = 1 - m.friction;
			vx = probe.vx * keep;
			vy = -probe.vy * m.restitution;
			vz = probe.vz * keep;
			t -= hit;
		}
	}
	flight(m, px, py, pz, vx, vy, vz, t, out);
	if (stopped) out.vx = out.vy = out.vz = 0;
	if (m.turbulence > 0) {
		const s = (seed & 0xffff) * 0.013;
		const qx = bx * m.turbulenceScale + s;
		const qy = by * m.turbulenceScale + s;
		const qz = bz * m.turbulenceScale + s;
		const drift = m.turbulenceSpeed * age;
		out.px +=
			m.turbulence * (wander(qx + drift, qy + drift, qz + drift, 0) - wander(qx, qy, qz, 0));
		out.py +=
			m.turbulence * (wander(qx + drift, qy + drift, qz + drift, 1) - wander(qx, qy, qz, 1));
		out.pz +=
			m.turbulence * (wander(qx + drift, qy + drift, qz + drift, 2) - wander(qx, qy, qz, 2));
		if (m.groundMode !== GROUND_NONE) out.py = Math.max(out.py, m.groundHeight);
	}
}

/** The offsets of the three noise channels of the turbulence, as in the shaders. */
const CHANNELS = [0, 0, 0, 31.4, 17.3, 5.9, -11.7, 41.2, 23.5] as const;

/** One channel of the turbulence's vector of simplex noise at (x, y, z). */
function wander(x: number, y: number, z: number, channel: number): number {
	const o = channel * 3;
	return simplex3(
		x + (CHANNELS[o] as number),
		y + (CHANNELS[o + 1] as number),
		z + (CHANNELS[o + 2] as number),
	);
}

/** The low 32 bits of a product, as WGSL's u32 multiply keeps them. */
const mul = Math.imul;

/** The pcg3d hash's first word of a lattice point, as the shaders hash it. */
function lattice(x: number, y: number, z: number): number {
	let px = (mul(x, 1664525) + 1013904223) >>> 0;
	let py = (mul(y, 1664525) + 1013904223) >>> 0;
	let pz = (mul(z, 1664525) + 1013904223) >>> 0;
	px = (px + mul(py, pz)) >>> 0;
	py = (py + mul(pz, px)) >>> 0;
	pz = (pz + mul(px, py)) >>> 0;
	px ^= px >>> 16;
	py ^= py >>> 16;
	pz ^= pz >>> 16;
	px = (px + mul(py, pz)) >>> 0;
	return px;
}

/** Perlin's gradient of hash `h` at offset (x, y, z), as the shaders pick it. */
function gradient(h: number, x: number, y: number, z: number): number {
	const k = h & 15;
	const u = k < 8 ? x : y;
	const v = k < 4 ? y : k === 12 || k === 14 ? x : z;
	return ((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v);
}

/** One corner's part of simplex noise, as the shaders add it. */
function corner(cx: number, cy: number, cz: number, x: number, y: number, z: number): number {
	const t = Math.max(0.6 - (x * x + y * y + z * z), 0);
	const t2 = t * t;
	return t2 * t2 * gradient(lattice(cx, cy, cz), x, y, z);
}

/** Simplex noise in 3D, from about -1 to 1, as the shaders' `simplex3` gives it. */
export function simplex3(x: number, y: number, z: number): number {
	const skew = (x + y + z) / 3;
	const cx = Math.floor(x + skew);
	const cy = Math.floor(y + skew);
	const cz = Math.floor(z + skew);
	const unskew = (cx + cy + cz) / 6;
	const x0 = x - (cx - unskew);
	const y0 = y - (cy - unskew);
	const z0 = z - (cz - unskew);
	// step(x0.yzx, x0.xyz): 1 where the first is no larger.
	const gx = y0 <= x0 ? 1 : 0;
	const gy = z0 <= y0 ? 1 : 0;
	const gz = x0 <= z0 ? 1 : 0;
	const lx = 1 - gx;
	const ly = 1 - gy;
	const lz = 1 - gz;
	// i1 = min(g, l.zxy), i2 = max(g, l.zxy).
	const i1x = Math.min(gx, lz);
	const i1y = Math.min(gy, lx);
	const i1z = Math.min(gz, ly);
	const i2x = Math.max(gx, lz);
	const i2y = Math.max(gy, lx);
	const i2z = Math.max(gz, ly);
	const n =
		corner(cx, cy, cz, x0, y0, z0) +
		corner(cx + i1x, cy + i1y, cz + i1z, x0 - i1x + 1 / 6, y0 - i1y + 1 / 6, z0 - i1z + 1 / 6) +
		corner(cx + i2x, cy + i2y, cz + i2z, x0 - i2x + 1 / 3, y0 - i2y + 1 / 3, z0 - i2z + 1 / 3) +
		corner(cx + 1, cy + 1, cz + 1, x0 - 0.5, y0 - 0.5, z0 - 0.5);
	return 32 * n;
}

/**
 * How far a particle may move from its birth place in `lifetime` seconds with a start speed of at
 * most `speed`: a bound for the culling sphere, which leaves out the ground.
 */
export function reach(m: MotionValues, speed: number, lifetime: number): number {
	const g = Math.hypot(m.gx, m.gy, m.gz);
	const turbulence = 2 * m.turbulence;
	if (m.drag < LITTLE_DRAG) return speed * lifetime + 0.5 * g * lifetime * lifetime + turbulence;
	const terminal = Math.hypot(m.wx + m.gx / m.drag, m.wy + m.gy / m.drag, m.wz + m.gz / m.drag);
	const settle = Math.min(lifetime, 1 / m.drag);
	return terminal * lifetime + (speed + terminal) * settle + turbulence;
}
