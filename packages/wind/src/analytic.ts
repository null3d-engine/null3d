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

/**
 * The first value of `null3d::noise`'s `pcg3d` hash. The library returns three, but value noise
 * reads only the first, and this form makes no tuple and no closure, so a field sample allocates
 * nothing.
 */
function lattice(x: number, y: number, z: number): number {
	let px = (Math.imul(x, 1664525) + 1013904223) >>> 0;
	let py = (Math.imul(y, 1664525) + 1013904223) >>> 0;
	let pz = (Math.imul(z, 1664525) + 1013904223) >>> 0;
	px = (px + Math.imul(py, pz)) >>> 0;
	py = (py + Math.imul(pz, px)) >>> 0;
	pz = (pz + Math.imul(px, py)) >>> 0;
	px = (px ^ (px >>> 16)) >>> 0;
	py = (py ^ (py >>> 16)) >>> 0;
	pz = (pz ^ (pz >>> 16)) >>> 0;
	px = (px + Math.imul(py, pz)) >>> 0;
	py = (py + Math.imul(pz, px)) >>> 0;
	pz = (pz + Math.imul(px, py)) >>> 0;
	return px;
}

/** A number from 0 up to 1 made from the top 24 bits of a hash. */
function toUnit(hash: number): number {
	return (hash >>> 8) / 16777216;
}

/** Perlin's fade curve, flat at both ends. */
function fade(t: number): number {
	return t * t * t * (t * (t * 6 - 15) + 10);
}

/** A blend of two numbers, written out so that a sample makes no closure. */
function blend(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/** A value noise corner's number: the hash's first value, from 0 up to 1. */
function corner(x: number, y: number, z: number): number {
	return toUnit(lattice(x, y, z));
}

/** `null3d::noise`'s value noise in 3D, from 0 to 1. */
export function value3(px: number, py: number, pz: number): number {
	const fx = Math.floor(px);
	const fy = Math.floor(py);
	const fz = Math.floor(pz);
	const u = fade(px - fx);
	const v = fade(py - fy);
	const w = fade(pz - fz);
	const near = blend(
		blend(
			blend(corner(fx, fy, fz), corner(fx + 1, fy, fz), u),
			blend(corner(fx, fy + 1, fz), corner(fx + 1, fy + 1, fz), u),
			v,
		),
		blend(
			blend(corner(fx, fy, fz + 1), corner(fx + 1, fy, fz + 1), u),
			blend(corner(fx, fy + 1, fz + 1), corner(fx + 1, fy + 1, fz + 1), u),
			v,
		),
		w,
	);
	return near;
}

/**
 * One slot of the ring: a push or a gust, each of which turns the air about a center. A push turns
 * about the place it names and fades over its life. A gust turns as a wave about a center that
 * travels along the heading from that place, for as long as the wave's reach holds it. A gust's
 * birth time is stored negative and a second late, so the sign of `born` tells the two apart and a
 * gust sent at time zero cannot read as a push.
 */
export interface Push {
	readonly x: number;
	readonly z: number;
	/** How hard the body shoved the air: a positive number turns it one way, a negative the other. */
	readonly strength: number;
	/** A push's sketch time in seconds, or a gust's as `-(time + 1)`. */
	readonly born: number;
}

/** One slot of the ring, which the add-on writes in place so that a push allocates nothing. */
interface PushSlot {
	x: number;
	z: number;
	strength: number;
	born: number;
}

/** The pushes that a page made, which the field reads in place. */
export interface PushRing {
	/** The slots, which the field reads. A slot whose strength is 0 turns nothing. */
	readonly slots: readonly Push[];
	/**
	 * Writes a push or a gust sent at the time `born`. A push takes the oldest push slot, so the
	 * newest three pushes turn the air. A gust takes the gust's own slot, so a page's pushes never
	 * push its gust out. A call replaces the slot's numbers, so a page may call it in every frame
	 * and the call allocates nothing.
	 */
	add(x: number, z: number, strength: number, born: number, gust: boolean): void;
}

/** Makes the empty ring that a page's pushes go into. The slots are made once, here. */
export function createPushRing(): PushRing {
	const slots: PushSlot[] = Array.from({ length: RING_SLOTS }, () => ({
		x: 0,
		z: 0,
		strength: 0,
		born: 0,
	}));
	let next = 0;
	return {
		slots,
		add(x, z, strength, born, gust) {
			const slot = slots[gust ? GUST_SLOT : next] as PushSlot;
			slot.x = x;
			slot.z = z;
			slot.strength = strength;
			slot.born = born;
			if (!gust) next = (next + 1) % PUSH_SLOTS;
		},
	};
}

/**
 * The steady settings that a reader works out beyond the box, as the three vectors that its shader
 * takes: the base wind, the gust and the swirl. A page gives them to a material once, and again
 * when `setBase` or one of the air's settings changes; a frame changes nothing here.
 *
 * @category api/wind
 */
export interface WindReading {
	/** The speed, the heading in radians, how much slower the air is at the ground, and the seed. */
	readonly base: [number, number, number, number];
	/** The gust's strength, its radius in meters, its wave number and how fast it travels. */
	readonly gust: [number, number, number, number];
	/** The swirl's strength, its size, how fast its pattern drifts, and a number it does not use. */
	readonly swirl: [number, number, number, number];
}

/** Makes the three vectors of a reading from the field's settings. */
export function createReading(state: FieldState): WindReading {
	return {
		base: [state.speed, state.heading, state.ground, state.seed],
		gust: [state.gustStrength, state.gustRadius, state.gustWave, state.gustSpeed],
		swirl: [state.swirl, state.swirlScale, state.swirlDrift, 0],
	};
}

/** Writes the field's settings into a reading's vectors, in place, so a reader re-reads them. */
export function writeReading(state: FieldState, reading: WindReading): void {
	reading.base[0] = state.speed;
	reading.base[1] = state.heading;
	reading.base[2] = state.ground;
	reading.base[3] = state.seed;
	reading.gust[0] = state.gustStrength;
	reading.gust[1] = state.gustRadius;
	reading.gust[2] = state.gustWave;
	reading.gust[3] = state.gustSpeed;
	reading.swirl[0] = state.swirl;
	reading.swirl[1] = state.swirlScale;
	reading.swirl[2] = state.swirlDrift;
}

/**
 * The field's settings, which a page sets once or changes at any time.
 *
 * @category api/wind
 */
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
export const PUSH_SLOTS = 3;
/** The slot that holds the newest gust, after the pushes, so a page's pushes never push it out. */
export const GUST_SLOT = PUSH_SLOTS;
/** The slots of the ring: the pushes, then the gust. */
export const RING_SLOTS = PUSH_SLOTS + 1;
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

	// The pushes and the gust: a vortex around each push, which fades as it ages, or a wave about a
	// center that travels along the heading for the gust. An index walks the ring, as every
	// per-frame loop over a small array does here: a `for … of` makes an iterator per call.
	for (let i = 0; i < pushes.length; i++) {
		const slot = pushes[i];
		if (!slot || slot.strength === 0) continue;
		let dx = x - slot.x;
		let dz = z - slot.z;
		let radius = state.pushRadius;
		let turn = 0;
		if (i === GUST_SLOT) {
			// A gust: its wave's center has traveled along the heading since it was sent.
			const age = t - slot.born;
			const travel = state.gustSpeed * age;
			dx -= cos * travel;
			dz -= sin * travel;
			radius = state.gustRadius;
			const distance = Math.sqrt(dx * dx + dz * dz) / radius;
			const reach = distance * distance;
			if (reach < 9) turn = Math.exp(-reach) * Math.cos(distance * state.gustWave);
		} else {
			const age = t - slot.born;
			if (age >= 0 && age <= PUSH_LIFE) {
				const fadeOut = 1 - age / PUSH_LIFE;
				const reach = radius * radius;
				turn = Math.exp(-(dx * dx + dz * dz) / reach) * fadeOut;
			}
		}
		if (turn === 0) continue;
		const strength = slot.strength * turn * height;
		vx += (dz / radius) * strength;
		vz -= (dx / radius) * strength;
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
