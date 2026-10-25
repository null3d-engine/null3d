// The wind's analytic field: the air's velocity at a place and a time, with no state between
// frames. The wind blows along a heading that is slower near the ground, a gust travels through it,
// and a noise-built swirl curls the air without making it pile up. The pushes that a page makes add
// short-lived vortices behind a moving body.
//
// The field is incompressible by construction: its swirl is the curl of a stream function, a push is
// a vortex, and a gust turns about its own center. Its divergence is therefore zero in the
// continuum, and the tests check that the discrete form keeps it near zero.
//
// The grid's compute shader and its WebGL2 form hold the same formula, and the noise functions
// mirror the engine's `null3d::noise`, so both forms give the same numbers. A test reads the two
// shader copies and fails when they drift apart or when a constant here changes without them.

/** The whole-number hash of `null3d::noise`'s `pcg`, which gives the same bits on every GPU. */
function pcg(v: number): number {
	const state = (Math.imul(v, 747796405) + 2891336453) >>> 0;
	const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0;
	return ((word >>> 22) ^ word) >>> 0;
}

/** The three-value hash of `null3d::noise`'s `pcg3d`. */
function pcg3d(x: number, y: number, z: number): [number, number, number] {
	let px = (Math.imul(x, 1664525) + 1013904223) >>> 0;
	let py = (Math.imul(y, 1664525) + 1013904223) >>> 0;
	let pz = (Math.imul(z, 1664525) + 1013904223) >>> 0;
	const mix = (): void => {
		px = (px + Math.imul(py, pz)) >>> 0;
		py = (py + Math.imul(pz, px)) >>> 0;
		pz = (pz + Math.imul(px, py)) >>> 0;
	};
	mix();
	px = (px ^ (px >>> 16)) >>> 0;
	py = (py ^ (py >>> 16)) >>> 0;
	pz = (pz ^ (pz >>> 16)) >>> 0;
	mix();
	return [px, py, pz];
}

/** A number from 0 up to 1 made from the top 24 bits of a hash. */
function toUnit(hash: number): number {
	return (hash >>> 8) / 16777216;
}

/** Perlin's fade curve, flat at both ends. */
function fade(t: number): number {
	return t * t * t * (t * (t * 6 - 15) + 10);
}

/** `null3d::noise`'s value noise in 3D, from 0 to 1. */
export function value3(px: number, py: number, pz: number): number {
	const fx = Math.floor(px);
	const fy = Math.floor(py);
	const fz = Math.floor(pz);
	const u = fade(px - fx);
	const v = fade(py - fy);
	const w = fade(pz - fz);
	const at = (dx: number, dy: number, dz: number): number =>
		toUnit(pcg3d(fx + dx, fy + dy, fz + dz)[0]);
	const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
	return mix(
		mix(mix(at(0, 0, 0), at(1, 0, 0), u), mix(at(0, 1, 0), at(1, 1, 0), u), v),
		mix(mix(at(0, 0, 1), at(1, 0, 1), u), mix(at(0, 1, 1), at(1, 1, 1), u), v),
		w,
	);
}

/** A push that a page made: a vortex at a place, which fades as it ages. */
export interface Push {
	readonly x: number;
	readonly z: number;
	/** How hard the body shoved the air: a positive number turns it one way, a negative the other. */
	readonly strength: number;
	/** The sketch time of the push, in seconds. */
	readonly born: number;
}

/** The field's settings, which a page sets once or changes at any time. */
export interface FieldState {
	/** The wind's speed in meters a second, at the top of the profile. */
	speed: number;
	/** The heading that the wind blows toward, in radians: 0 blows toward +x, pi/2 toward +z. */
	heading: number;
	/** How much slower the air is at the ground, from 0 to 1, over `GROUND_HEIGHT` meters. */
	ground: number;
	/** The strength of the gust's turn, in meters a second. */
	gustStrength: number;
	/** How wide the gust is, in meters. */
	gustRadius: number;
	/** How far apart the gust's turns sit, so the gust arrives as a wave rather than one eddy. */
	gustWave: number;
	/** How fast the gust travels, in meters a second. */
	gustSpeed: number;
	/** How wide a push turns the air, in meters. */
	pushRadius: number;
	/** The strength of the noise-built swirl, in meters a second. */
	swirl: number;
	/** The swirl's size: larger makes wider, slower eddies. */
	swirlScale: number;
	/** How fast the swirl's pattern drifts, in meters a second. */
	swirlDrift: number;
	/** The seed of the swirl's pattern, so two pages may look different. */
	seed: number;
}

/** The height over which the air slows to the ground, in meters. */
export const GROUND_HEIGHT = 2;
/** How long a push lasts before it has faded away, in seconds. */
export const PUSH_LIFE = 3;
/** The pushes that the field holds: the newest replaces the oldest. */
export const PUSH_SLOTS = 4;
/** The distance over which the noise's curl is measured, in noise cells. */
export const CURL_STEP = 0.02;

/** The settings that a page gets when it names none. */
export function defaultFieldState(): FieldState {
	return {
		speed: 4,
		heading: 0,
		ground: 0.65,
		gustStrength: 3.5,
		gustRadius: 14,
		gustWave: 2,
		gustSpeed: 6,
		pushRadius: 6,
		swirl: 1.6,
		swirlScale: 0.06,
		swirlDrift: 0.5,
		seed: 0,
	};
}

/**
 * The height's factor of the wind, from 1 at the top to `1 - ground` at the ground, so a plant's
 * crown moves more than its base.
 */
export function profile(state: FieldState, y: number): number {
	return 1 - state.ground * Math.exp(-Math.max(y, 0) / GROUND_HEIGHT);
}

/** The stream function of the swirl, in noise cells, at a place and a time. */
function stream(state: FieldState, x: number, y: number, z: number, t: number): number {
	const drift = state.swirlDrift * t;
	return value3(
		x * state.swirlScale + drift + state.seed,
		y * state.swirlScale,
		z * state.swirlScale + drift * 0.5,
	);
}

/**
 * The air's velocity at a world place and a sketch time, in meters a second, written into `out` as
 * `[x, y, z]`. It allocates nothing and reads no state that a frame changes.
 */
export function analyticVelocity(
	state: FieldState,
	pushes: readonly (Push | undefined)[],
	x: number,
	y: number,
	z: number,
	t: number,
	out: [number, number, number],
): [number, number, number] {
	const height = profile(state, y);
	const cos = Math.cos(state.heading);
	const sin = Math.sin(state.heading);
	let vx = cos * state.speed * height;
	let vz = sin * state.speed * height;

	// The gust: a wave of turns that travels along the heading, so the air curls as it passes. The
	// turns are rings about the gust's center and depend only on the distance to it, so a ring of
	// air turns without piling up.
	const travel = state.gustSpeed * t;
	const gx = x - cos * travel;
	const gz = z - sin * travel;
	const radius = state.gustRadius;
	const distance = Math.sqrt(gx * gx + gz * gz) / radius;
	const reach = distance * distance;
	if (reach < 9) {
		const envelope =
			Math.exp(-reach) * Math.cos(distance * state.gustWave) * state.gustStrength * height;
		vx += (gz / radius) * envelope;
		vz -= (gx / radius) * envelope;
	}

	// The swirl: the curl of one stream function in the ground plane, so the air turns without
	// piling up. `psi` varies slowly, so a short step measures the slope.
	const step = CURL_STEP / state.swirlScale;
	const front = stream(state, x, y, z + step, t);
	const back = stream(state, x, y, z - step, t);
	const right = stream(state, x + step, y, z, t);
	const left = stream(state, x - step, y, z, t);
	vx += ((front - back) / (2 * step)) * state.swirl * height;
	vz -= ((right - left) / (2 * step)) * state.swirl * height;

	// The pushes: a vortex around each, turning more slowly as it ages away.
	for (const push of pushes) {
		if (!push) continue;
		const age = t - push.born;
		if (age < 0 || age > PUSH_LIFE) continue;
		const fadeOut = 1 - age / PUSH_LIFE;
		const dx = x - push.x;
		const dz = z - push.z;
		const reach = state.pushRadius * state.pushRadius;
		const turn = Math.exp(-(dx * dx + dz * dz) / reach);
		const strength = push.strength * fadeOut * turn * height;
		vx += (dz / state.pushRadius) * strength;
		vz -= (dx / state.pushRadius) * strength;
	}

	out[0] = vx;
	out[1] = 0;
	out[2] = vz;
	return out;
}

/** The divergence of the field at a place and a time, in a second, measured over a short step. */
export function divergence(
	state: FieldState,
	pushes: readonly (Push | undefined)[],
	x: number,
	y: number,
	z: number,
	t: number,
	step = 0.25,
): number {
	const a: [number, number, number] = [0, 0, 0];
	const b: [number, number, number] = [0, 0, 0];
	analyticVelocity(state, pushes, x + step, y, z, t, a);
	analyticVelocity(state, pushes, x - step, y, z, t, b);
	let sum = (a[0] - b[0]) / (2 * step);
	analyticVelocity(state, pushes, x, y, z + step, t, a);
	analyticVelocity(state, pushes, x, y, z - step, t, b);
	sum += (a[2] - b[2]) / (2 * step);
	return sum;
}
