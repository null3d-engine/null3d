// The particles' motion on the CPU, the same closed form that the particle shaders work out on the
// GPU: gravity and linear drag toward the wind, a ground that ends, bounces or stops a particle, and
// simplex-noise turbulence as a displacement. Systems use it where the CPU must know a particle's
// state: when the ground ends a particle and where a sub-emitter starts. The functions take and give
// their numbers in typed arrays and objects, never as arguments or results, so a call allocates
// nothing even where the engine does not inline it.

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

/** A particle's place and velocity, which `stateAt` writes. */
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

/**
 * The places of a flight's numbers: it starts at P with the velocity V, and runs for T seconds.
 * `flight` writes where it ends at OUT_P and its velocity there at OUT_V. `impact` reads T as the
 * longest time to look over, and writes the impact's time at HIT, or -1 for none.
 */
export const P = 0;
export const V = 3;
export const T = 6;
export const HIT = 7;
export const OUT_P = 8;
export const OUT_V = 11;
/** The floats of a flight's numbers. */
export const FLIGHT_FLOATS = 14;

/** Where a flight that `io` describes ends after its time, written into `io`. */
export function flight(m: MotionValues, io: Float64Array): void {
	const t = io[T] as number;
	const k = m.drag;
	if (k < LITTLE_DRAG) {
		io[OUT_P] = (io[P] as number) + (io[V] as number) * t + 0.5 * m.gx * t * t;
		io[OUT_P + 1] = (io[P + 1] as number) + (io[V + 1] as number) * t + 0.5 * m.gy * t * t;
		io[OUT_P + 2] = (io[P + 2] as number) + (io[V + 2] as number) * t + 0.5 * m.gz * t * t;
		io[OUT_V] = (io[V] as number) + m.gx * t;
		io[OUT_V + 1] = (io[V + 1] as number) + m.gy * t;
		io[OUT_V + 2] = (io[V + 2] as number) + m.gz * t;
		return;
	}
	const decay = Math.exp(-k * t);
	const share = (1 - decay) / k;
	for (let c = 0; c < 3; c++) {
		// The terminal velocity of the axis, which drag eases the velocity toward.
		const end = c === 0 ? m.wx + m.gx / k : c === 1 ? m.wy + m.gy / k : m.wz + m.gz / k;
		const v = (io[V + c] as number) - end;
		io[OUT_P + c] = (io[P + c] as number) + end * t + v * share;
		io[OUT_V + c] = end + v * decay;
	}
}

/** Scratch numbers of the impact search. */
const probe = new Float64Array(FLIGHT_FLOATS);

/**
 * Finds the first time after 0 at which the flight that `io` describes falls onto the ground,
 * within its time, as the shaders find it, and writes it at HIT, or -1 for none.
 */
export function impact(m: MotionValues, io: Float64Array): void {
	const ground = m.groundHeight;
	const g = m.gy;
	const limit = io[T] as number;
	const vy = io[V + 1] as number;
	const rise = (io[P + 1] as number) - ground;
	let t = limit;
	const d = vy * vy - 2 * g * rise;
	if (g < 0 && d >= 0) t = (-vy - Math.sqrt(d)) / g;
	else if (vy < 0) t = rise / -vy;
	t = Math.min(Math.max(t, 0), limit);
	for (let k = 0; k < 6; k++) probe[k] = io[k] as number;
	for (let k = 0; k < STEPS; k++) {
		probe[T] = t;
		flight(m, probe);
		const fall = Math.min(probe[OUT_V + 1] as number, -1e-3);
		t = Math.min(Math.max(t - ((probe[OUT_P + 1] as number) - ground) / fall, 0), limit);
	}
	// A flight that ends near the ground counts only while it falls, so one that bounced up off it
	// does not meet it again at once.
	probe[T] = t;
	flight(m, probe);
	const near = Math.abs((probe[OUT_P + 1] as number) - ground) < 0.01;
	io[HIT] = near && t > 0 && (probe[OUT_V + 1] as number) < 0 ? t : -1;
}

/** The places of a particle's numbers that `stateAt` reads: its birth place, velocity, age and seed. */
export const BIRTH = 0;
export const VELOCITY = 3;
export const AGE = 6;
export const SEED = 7;
/** The floats of a particle's numbers. */
export const PARTICLE_FLOATS = 8;

/** Scratch numbers of `stateAt`. */
const leg = new Float64Array(FLIGHT_FLOATS);
const noise = new Float64Array(4);

/** The offsets of the three noise channels of the turbulence, as in the shaders. */
const CHANNELS = [0, 0, 0, 31.4, 17.3, 5.9, -11.7, 41.2, 23.5] as const;

/**
 * Writes the state of the particle that `input` describes, at its age, into `out`, as the shaders
 * work it out.
 */
export function stateAt(m: MotionValues, input: Float64Array, out: ParticleState): void {
	for (let k = 0; k < 6; k++) leg[k] = input[k] as number;
	leg[T] = input[AGE] as number;
	out.alive = true;
	let stopped = false;
	if (m.groundMode !== GROUND_NONE) {
		for (let b = 0; b <= BOUNCES; b++) {
			impact(m, leg);
			const hit = leg[HIT] as number;
			if (hit < 0) break;
			const left: number = (leg[T] as number) - hit;
			leg[T] = hit;
			flight(m, leg);
			if (m.groundMode === GROUND_KILL) {
				out.alive = false;
				break;
			}
			leg[P] = leg[OUT_P] as number;
			leg[P + 1] = m.groundHeight;
			leg[P + 2] = leg[OUT_P + 2] as number;
			if (m.groundMode === GROUND_STICK || b === BOUNCES) {
				leg[V] = leg[V + 1] = leg[V + 2] = 0;
				leg[T] = 0;
				stopped = true;
				break;
			}
			const keep = 1 - m.friction;
			leg[V] = (leg[OUT_V] as number) * keep;
			leg[V + 1] = -(leg[OUT_V + 1] as number) * m.restitution;
			leg[V + 2] = (leg[OUT_V + 2] as number) * keep;
			leg[T] = left;
		}
	}
	flight(m, leg);
	out.px = leg[OUT_P] as number;
	out.py = leg[OUT_P + 1] as number;
	out.pz = leg[OUT_P + 2] as number;
	out.vx = stopped ? 0 : (leg[OUT_V] as number);
	out.vy = stopped ? 0 : (leg[OUT_V + 1] as number);
	out.vz = stopped ? 0 : (leg[OUT_V + 2] as number);
	if (m.turbulence <= 0) return;
	const s = ((input[SEED] as number) & 0xffff) * 0.013;
	const q = m.turbulenceScale;
	const drift = m.turbulenceSpeed * (input[AGE] as number);
	for (let c = 0; c < 3; c++) {
		let move = 0;
		for (let later = 1; later >= 0; later--) {
			for (let a = 0; a < 3; a++)
				noise[a] =
					(input[BIRTH + a] as number) * q + s + later * drift + (CHANNELS[c * 3 + a] as number);
			simplex3(noise);
			move += (later * 2 - 1) * (noise[3] as number);
		}
		if (c === 0) out.px += m.turbulence * move;
		else if (c === 1) out.py += m.turbulence * move;
		else out.pz += m.turbulence * move;
	}
	if (m.groundMode !== GROUND_NONE) out.py = Math.max(out.py, m.groundHeight);
}

/**
 * One corner's part of simplex noise at the corner (cx, cy, cz), from the offset in `io`'s first
 * three numbers, added to its fourth, as the shaders add it.
 */
function corner(cx: number, cy: number, cz: number, io: Float64Array): void {
	const x = io[0] as number;
	const y = io[1] as number;
	const z = io[2] as number;
	const t = Math.max(0.6 - (x * x + y * y + z * z), 0);
	if (t === 0) return;
	// The first word of the pcg3d hash of the lattice point, then Perlin's gradient that it picks.
	let px = (Math.imul(cx, 1664525) + 1013904223) >>> 0;
	let py = (Math.imul(cy, 1664525) + 1013904223) >>> 0;
	let pz = (Math.imul(cz, 1664525) + 1013904223) >>> 0;
	px = (px + Math.imul(py, pz)) >>> 0;
	py = (py + Math.imul(pz, px)) >>> 0;
	pz = (pz + Math.imul(px, py)) >>> 0;
	px ^= px >>> 16;
	py ^= py >>> 16;
	pz ^= pz >>> 16;
	const k = ((px + Math.imul(py, pz)) >>> 0) & 15;
	const u = k < 8 ? x : y;
	const v = k < 4 ? y : k === 12 || k === 14 ? x : z;
	const t2 = t * t;
	io[3] = (io[3] as number) + t2 * t2 * (((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v));
}

/** Scratch offset of a simplex corner. */
const offset = new Float64Array(4);

/**
 * Simplex noise in 3D at the point in `io`'s first three numbers, from about -1 to 1, as the
 * shaders' `simplex3` gives it, written into its fourth.
 */
export function simplex3(io: Float64Array): void {
	const x = io[0] as number;
	const y = io[1] as number;
	const z = io[2] as number;
	const skew = (x + y + z) / 3;
	const cx = Math.floor(x + skew);
	const cy = Math.floor(y + skew);
	const cz = Math.floor(z + skew);
	const unskew = (cx + cy + cz) / 6;
	const x0 = x - (cx - unskew);
	const y0 = y - (cy - unskew);
	const z0 = z - (cz - unskew);
	// step(x0.yzx, x0.xyz): 1 where the first is no larger; i1 = min(g, l.zxy), i2 = max(g, l.zxy).
	const gx = y0 <= x0 ? 1 : 0;
	const gy = z0 <= y0 ? 1 : 0;
	const gz = x0 <= z0 ? 1 : 0;
	const i1x = Math.min(gx, 1 - gz);
	const i1y = Math.min(gy, 1 - gx);
	const i1z = Math.min(gz, 1 - gy);
	const i2x = Math.max(gx, 1 - gz);
	const i2y = Math.max(gy, 1 - gx);
	const i2z = Math.max(gz, 1 - gy);
	offset[3] = 0;
	for (let c = 0; c < 4; c++) {
		const ox = c === 0 ? 0 : c === 1 ? i1x : c === 2 ? i2x : 1;
		const oy = c === 0 ? 0 : c === 1 ? i1y : c === 2 ? i2y : 1;
		const oz = c === 0 ? 0 : c === 1 ? i1z : c === 2 ? i2z : 1;
		const back = c / 6;
		offset[0] = x0 - ox + back;
		offset[1] = y0 - oy + back;
		offset[2] = z0 - oz + back;
		corner(cx + ox, cy + oy, cz + oz, offset);
	}
	io[3] = 32 * (offset[3] as number);
}

/**
 * How far a particle may move from its birth place in `lifetime` seconds with a start speed of at
 * most `speed`: a bound for the culling sphere, which leaves out the ground. The systems work it out
 * when their motion changes, not in each frame.
 */
export function reach(m: MotionValues, speed: number, lifetime: number): number {
	const g = Math.sqrt(m.gx * m.gx + m.gy * m.gy + m.gz * m.gz);
	const turbulence = 2 * m.turbulence;
	if (m.drag < LITTLE_DRAG) return speed * lifetime + 0.5 * g * lifetime * lifetime + turbulence;
	const tx = m.wx + m.gx / m.drag;
	const ty = m.wy + m.gy / m.drag;
	const tz = m.wz + m.gz / m.drag;
	const end = Math.sqrt(tx * tx + ty * ty + tz * tz);
	const settle = Math.min(lifetime, 1 / m.drag);
	return end * lifetime + (speed + end) * settle + turbulence;
}
