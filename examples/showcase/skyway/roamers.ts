// The roaming cars of Skyway: a few dozen hover cars that the scene flies itself, beside the lane
// traffic that the GPU moves along straight lanes. A roamer cruises down the middle of a street,
// where no lane runs, and at each junction it flies on or takes a smooth quarter turn onto the cross
// street. Now and then it climbs or sinks to another height, and now and then it slows, sets down at
// the kerb, waits a few seconds and takes off again. At the city's edge it always turns back in.
//
// The flight is plain numbers (`stepRoamer`), which the unit test runs for minutes of sketch time.
// The scene draws the roamers as one instance batch of the flying car (`createRoamers`), whose rows
// it writes each frame, and paints their lights from each car's own space, since a roamer turns
// any way.
import {
	type InstanceBatch,
	math,
	type QualityPreset,
	quat,
	type SketchContext,
} from '@null3d/engine';
import {
	FLYING_CAR_BODY,
	FLYING_CAR_CANOPY,
	FLYING_CAR_POD,
	FLYING_CAR_POD_X,
	loftHull,
} from '../../addons/traffic-lanes/index';
import { EFFECT_LAYER } from '../../lib/layers';
import { BLOCKS, streetLine } from './layout';

/** How many roamers each preset flies. */
export const ROAMERS: Record<QualityPreset, number> = { low: 16, medium: 28, high: 40, ultra: 56 };

/** How a roamer flies: its speeds, its turns, its heights and its stops. */
export const ROAMING = {
	/** The cruising speed's range, in meters per second, and how fast a roamer gains it. */
	speed: [17, 27] as const,
	accelerate: 8,
	/** The radius of a turn at a junction, in meters. */
	radius: 12,
	/** How far before a junction a roamer decides what to do there, past the turn's radius. */
	lookahead: 40,
	/** The share of junctions where a roamer turns, picks a new height, or stops in the next block. */
	turns: 0.4,
	climbs: 0.25,
	stops: 0.12,
	/** The cruising heights' range, in meters. */
	height: [16, 125] as const,
	/** How fast a roamer climbs or sinks, and slides across the street, in meters per second. */
	climb: 6,
	slide: 4,
	/** Where a parked roamer sits: how far right of the street's middle, and how high it floats. */
	kerb: 12,
	ground: 1.4,
	/** How long a roamer waits at the kerb, in seconds. */
	wait: [3, 8] as const,
	/** How far past a junction a roamer that stops sets down, in meters: about mid-block. */
	stopAfter: 75,
} as const;

/** What a roamer does now. */
export type RoamerMode = 'cruise' | 'turn' | 'landing' | 'parked' | 'takeoff';

/** One roamer's flight. */
export interface Roamer {
	/** The street axis that it flies along, and which way. */
	alongX: boolean;
	sign: number;
	/** Its street's middle line, across the axis, and its place along the axis. */
	line: number;
	along: number;
	/** How far right of the middle it flies, its height, its speed and its cruising values. */
	side: number;
	y: number;
	speed: number;
	cruise: number;
	height: number;
	mode: RoamerMode;
	/** The junction that it last decided at, so it decides once at each. */
	decided: number;
	/** A turn it has chosen for the junction ahead: its new way across, 0 for none. */
	turnSign: number;
	/** A stop it has chosen for the block past the junction ahead. */
	stopping: boolean;
	/** Where a landing roamer stops, along the axis, and the time left at the kerb. */
	stopAt: number;
	timer: number;
	/** A turn's middle, its old way and new way as unit steps, and its angle so far. */
	cx: number;
	cz: number;
	fx: number;
	fz: number;
	nx: number;
	nz: number;
	angle: number;
	/** Its place, its heading as the yaw that turns its nose from +Z, and the bank of a turn. */
	x: number;
	z: number;
	yaw: number;
	roll: number;
}

/** The street lines, from the south-west edge. */
const LINES = Array.from({ length: BLOCKS + 1 }, (_, k) => streetLine(k));

/** A cruising height or speed from its range. */
const between = (range: readonly [number, number], random: () => number): number =>
	range[0] + random() * (range[1] - range[0]);

/** Moves `value` toward `goal` by at most `step`. */
const toward = (value: number, goal: number, step: number): number =>
	value < goal ? Math.min(goal, value + step) : Math.max(goal, value - step);

/** Writes the roamer's place and heading from its street, its place along it and its side. */
function place(r: Roamer): void {
	// The right of the way it flies is (-forward z, forward x).
	if (r.alongX) {
		r.x = r.along;
		r.z = r.line + r.side * r.sign;
	} else {
		r.x = r.line - r.side * r.sign;
		r.z = r.along;
	}
	r.yaw = Math.atan2(r.alongX ? r.sign : 0, r.alongX ? 0 : r.sign);
}

/** The next junction ahead: its distance and its line's index, or none past the city's edge. */
function nextJunction(r: Roamer): { distance: number; index: number } | undefined {
	let best: { distance: number; index: number } | undefined;
	for (let k = 0; k <= BLOCKS; k++) {
		const distance = ((LINES[k] as number) - r.along) * r.sign;
		if (distance > 0.01 && (!best || distance < best.distance)) best = { distance, index: k };
	}
	return best;
}

/** Makes a roamer on a random inner street, at a random place and height, flying a random way. */
export function makeRoamer(random: () => number): Roamer {
	const inner = LINES.slice(1, -1);
	const cruise = between(ROAMING.speed, random);
	const height = between(ROAMING.height, random);
	const r: Roamer = {
		alongX: random() < 0.5,
		sign: random() < 0.5 ? 1 : -1,
		line: inner[Math.floor(random() * inner.length)] as number,
		along: (LINES[1] as number) + random() * ((LINES[BLOCKS - 1] as number) - (LINES[1] as number)),
		side: 0,
		y: height,
		speed: cruise,
		cruise,
		height,
		mode: 'cruise',
		decided: -1,
		turnSign: 0,
		stopping: false,
		stopAt: 0,
		timer: 0,
		cx: 0,
		cz: 0,
		fx: 0,
		fz: 0,
		nx: 0,
		nz: 0,
		angle: 0,
		x: 0,
		z: 0,
		yaw: 0,
		roll: 0,
	};
	place(r);
	return r;
}

/** Flies one roamer one step of `dt` seconds. `random` makes its choices. */
export function stepRoamer(r: Roamer, dt: number, random: () => number): void {
	r.y = toward(
		r.y,
		r.mode === 'landing' || r.mode === 'parked' ? ROAMING.ground : r.height,
		ROAMING.climb * dt,
	);
	if (r.mode === 'turn') {
		// A quarter circle round the turn's middle, from the old way onto the new one.
		const { radius } = ROAMING;
		r.angle = Math.min(Math.PI / 2, r.angle + (r.speed * dt) / radius);
		const c = Math.cos(r.angle);
		const s = Math.sin(r.angle);
		r.x = r.cx + radius * (-r.nx * c + r.fx * s);
		r.z = r.cz + radius * (-r.nz * c + r.fz * s);
		r.yaw = Math.atan2(r.nx * s + r.fx * c, r.nz * s + r.fz * c);
		// A turn to the right banks the car right, and the bank eases back after.
		const right = r.fz * r.nx - r.fx * r.nz;
		r.roll = toward(r.roll, -right * 0.3, dt * 1.5);
		if (r.angle >= Math.PI / 2) {
			r.alongX = r.nx !== 0;
			r.sign = r.alongX ? r.nx : r.nz;
			r.line = r.alongX ? r.z : r.x;
			r.along = r.alongX ? r.x : r.z;
			// The junctions of the new street have numbers of their own, which the old street's
			// last decision must not stand for.
			r.decided = -1;
			r.mode = 'cruise';
		}
		return;
	}
	r.roll = toward(r.roll, 0, dt * 1.5);
	if (r.mode === 'parked') {
		r.timer -= dt;
		if (r.timer <= 0) {
			r.mode = 'takeoff';
			r.height = between(ROAMING.height, random);
		}
		return;
	}
	if (r.mode === 'landing') {
		// It slides to the kerb, sinks to the street and slows to a stop at its place.
		const left = (r.stopAt - r.along) * r.sign;
		r.speed = Math.max(0, Math.min(r.cruise, left * 0.5));
		r.side = toward(r.side, ROAMING.kerb, ROAMING.slide * dt);
		if (left <= 0.3 && Math.abs(r.y - ROAMING.ground) < 0.2 && r.side >= ROAMING.kerb) {
			r.speed = 0;
			r.y = ROAMING.ground;
			r.mode = 'parked';
			r.timer = between(ROAMING.wait, random);
		}
	} else {
		r.speed = toward(r.speed, r.cruise, ROAMING.accelerate * dt);
		r.side = toward(r.side, 0, ROAMING.slide * dt);
		if (r.mode === 'takeoff' && r.side === 0 && Math.abs(r.y - r.height) < 1) r.mode = 'cruise';
	}
	r.along += r.sign * r.speed * dt;
	place(r);
	if (r.mode === 'landing' || r.mode === 'parked') return;

	const ahead = nextJunction(r);
	if (!ahead) return;
	// It decides once at each junction: on or a turn, a new height, and a stop in the next block.
	if (ahead.index !== r.decided && ahead.distance < ROAMING.radius + ROAMING.lookahead) {
		r.decided = ahead.index;
		r.turnSign = 0;
		r.stopping = false;
		const atEdge = ahead.index === 0 || ahead.index === BLOCKS;
		if (atEdge || random() < ROAMING.turns) {
			// The cross street's way, left or right, but never out of the city.
			r.turnSign = random() < 0.5 ? 1 : -1;
			if (r.line <= (LINES[0] as number) + 1) r.turnSign = 1;
			if (r.line >= (LINES[BLOCKS] as number) - 1) r.turnSign = -1;
		} else if (random() < ROAMING.stops) {
			// A stop takes the block past this junction, unless that block ends at the city's edge,
			// where the roamer must be back in the street's middle to turn.
			const beyond = ahead.index + r.sign;
			r.stopping = beyond > 0 && beyond < BLOCKS;
		}
		if (random() < ROAMING.climbs) r.height = between(ROAMING.height, random);
	}
	const ready = r.mode === 'cruise' || (r.mode === 'takeoff' && r.side === 0);
	if (r.turnSign !== 0 && ready && ahead.distance <= ROAMING.radius) {
		// The turn's middle is a radius back along the old way and a radius along the new way
		// from the junction's middle.
		r.fx = r.alongX ? r.sign : 0;
		r.fz = r.alongX ? 0 : r.sign;
		r.nx = r.alongX ? 0 : r.turnSign;
		r.nz = r.alongX ? r.turnSign : 0;
		const jx = r.alongX ? (LINES[ahead.index] as number) : r.line;
		const jz = r.alongX ? r.line : (LINES[ahead.index] as number);
		r.cx = jx - r.fx * ROAMING.radius + r.nx * ROAMING.radius;
		r.cz = jz - r.fz * ROAMING.radius + r.nz * ROAMING.radius;
		r.angle = Math.asin(
			Math.min(1, Math.max(0, (ROAMING.radius - ahead.distance) / ROAMING.radius)),
		);
		r.turnSign = 0;
		r.mode = 'turn';
	} else if (r.stopping && ahead.distance > ROAMING.radius + ROAMING.lookahead) {
		// It has passed the junction it decided at: it sets down in this block.
		r.stopping = false;
		r.mode = 'landing';
		r.stopAt = r.along + r.sign * ROAMING.stopAfter;
	}
}

/** The roamers of the scene, drawn as one batch. */
export interface Roamers {
	/** Flies every roamer one step and writes the batch's rows. Call once per frame. */
	update(dt: number): void;
	/** Flies the preset's count of roamers. */
	fit(preset: QualityPreset): void;
}

/**
 * The roamers' surface: the lane traffic's paint and lights, found from each car's own place,
 * which the hull's texture coordinates carry, since a roamer turns any way.
 */
const roamerWgsl = /* wgsl */ `
struct Uniforms { body: vec3f, tail: vec3f, nose: vec3f, neon: vec3f, windows: vec3f }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let d = vec3f(input.uv.x, input.uv.y, input.uv1.x);
    let tint = fract(f32(input.instance) * 0.618034);
    s.baseColor = mix(material.body, material.body * 2.4, 0.25 * tint);
    s.metalness = 0.7;
    s.roughness = 0.34;
    s.emissive = vec3f(0.0);
    // Tinted glass over the canopy, with a faint glow from the cabin.
    let canopy = step(0.84, d.y) * step(abs(d.z), 1.0);
    s.baseColor = mix(s.baseColor, material.windows * 0.25, canopy);
    s.metalness = mix(s.metalness, 0.0, canopy);
    s.roughness = mix(s.roughness, 0.04, canopy);
    s.emissive += material.windows * canopy * 0.18;
    // Tail bars and nose lamps, gentle, and the neon band round the lower edge.
    let rear = 1.0 - step(-1.72, d.z);
    let bars = rear * step(0.2, d.y) * step(d.y, 0.44) * step(0.16, abs(d.x)) * step(abs(d.x), 0.6);
    s.emissive += material.tail * bars * 2.2;
    let front = step(1.68, d.z) * step(0.18, d.y) * step(d.y, 0.37) * step(0.1, abs(d.x));
    s.emissive += material.nose * front * 4.5;
    let band = step(0.13, d.y) * step(d.y, 0.23) * step(abs(input.normal.y), 0.8);
    s.emissive += mix(material.neon, material.tail, tint * 0.5) * band * 2.2;
    return s;
}
`;

/** The roamers' look: the lane traffic's colours. */
export interface RoamerLook {
	body: string;
	tail: string;
	nose: string;
	neon: string;
	windows: string;
}

/** Builds the roamers: the flying car with its own-space coordinates, and the batch of their rows. */
export function createRoamers(ctx: SketchContext, look: RoamerLook): Roamers {
	const { scene, materials, geometry, quality } = ctx;
	const { positions, indices } = loftHull([
		{ sections: FLYING_CAR_BODY, ring: 12, squareness: 2.6, flatTail: true },
		{ sections: FLYING_CAR_CANOPY, ring: 10, squareness: 2.2, flatTail: false },
		...[-1, 1].map((side) => ({
			sections: FLYING_CAR_POD,
			x: side * FLYING_CAR_POD_X,
			ring: 8,
			squareness: 2,
			flatTail: false,
		})),
	]);
	const count = positions.length / 3;
	const uvs = new Float32Array(count * 2);
	const uvs1 = new Float32Array(count * 2);
	for (let k = 0; k < count; k++) {
		uvs[k * 2] = positions[k * 3] as number;
		uvs[k * 2 + 1] = positions[k * 3 + 1] as number;
		uvs1[k * 2] = positions[k * 3 + 2] as number;
	}
	const hull = geometry.fromArrays({
		positions: new Float32Array(positions),
		uvs,
		uvs1,
		indices: new Uint32Array(indices),
		computeNormals: true,
	});
	const material = materials.shader({
		wgsl: roamerWgsl,
		uniforms: look,
		color: look.body,
		roughness: 0.34,
		metalness: 0.7,
		contactShadows: false,
	});
	const most = Math.max(...Object.values(ROAMERS));
	const batch: InstanceBatch = scene.createInstances(hull, most, {
		material,
		layers: EFFECT_LAYER,
	});
	math.seed(91);
	const random = () => math.random();
	const roamers = Array.from({ length: most }, () => makeRoamer(random));
	let active = ROAMERS[quality.preset];
	batch.setActiveCount(active);
	const turn = quat.create();
	/** Writes the active roamers' rows: their places and their turns. */
	const write = (): void => {
		const { positions: rows, rotations, scales } = batch;
		for (let k = 0; k < active; k++) {
			const r = roamers[k] as Roamer;
			rows[k * 3] = r.x;
			rows[k * 3 + 1] = r.y;
			rows[k * 3 + 2] = r.z;
			quat.fromEuler(turn, 0, r.yaw, r.roll, 'YXZ');
			rotations[k * 4] = turn[0] as number;
			rotations[k * 4 + 1] = turn[1] as number;
			rotations[k * 4 + 2] = turn[2] as number;
			rotations[k * 4 + 3] = turn[3] as number;
			scales[k * 3] = 1;
			scales[k * 3 + 1] = 1;
			scales[k * 3 + 2] = 1;
		}
		batch.markDirty(0, active);
	};
	write();
	return {
		update(dt) {
			for (let k = 0; k < active; k++) stepRoamer(roamers[k] as Roamer, dt, random);
			write();
		},
		fit(preset) {
			active = ROAMERS[preset];
			batch.setActiveCount(active);
			write();
		},
	};
}
