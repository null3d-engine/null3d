// Traffic lanes: instanced vehicles that move along straight lanes in the vertex shader, so a lane
// of a hundred thousand cars costs a frame no CPU work at all. Every row carries its lane's start
// offset, its speed and the lane's length, and the vertex offset wraps it at the far end.
//
// The surface paints a vehicle from its own coordinates: tail bars, a nose lamp and a glowing skirt
// under the belly. It reads the hull's size, so any vehicle mesh with its nose along local +Z takes
// the same lights. The rows are batched by heading, because a row's heading turns the lights and
// the movement together.
//
// The add-on also has an option for real lights: it keeps a pool of point lights and moves them to
// the nearest vehicles, a few times a second, so the road near the camera catches their glow.
import {
	type ColorInput,
	type MeshGeometry,
	math,
	type QualityPreset,
	quat,
	type SketchContext,
	type Vec3Like,
	vec3,
} from '@null3d/engine';
import vehicleShader from './vehicle.wgsl';

/** The plan of the lanes: where they run, at which heights, and how many a street carries. */
export interface LanePlan {
	/** The centre lines of the streets that carry lanes, across each direction of travel. */
	lines: readonly number[];
	/**
	 * Where each lane starts and ends, in meters along its street. A lane longer than the scene lets
	 * traffic stream in from the haze.
	 */
	from: number;
	to: number;
	/** The lowest and highest lane heights, in meters. */
	low: number;
	high: number;
	/** How many lanes each street carries, stacked between `low` and `high`. */
	levels: number;
	/** How far either side of its street's centre line a lane flies, in meters. */
	offset: number;
}

/** The colours and the strength of a vehicle's own lights. */
export interface VehicleLook {
	/** The hull's paint. */
	body?: ColorInput;
	/** The colour of the tail bars, and of the real lights. */
	tail?: ColorInput;
	/** The colour of the nose lamps. */
	nose?: ColorInput;
	/** The colour of the glow under the belly, which a row's tint shifts toward the tail's colour. */
	skirt?: ColorInput;
	/** How brightly the skirt glows. */
	glow?: number;
	/** The hull's half width, its height and its half length, in meters, for the light areas. */
	size?: readonly [number, number, number];
}

/** How the add-on is called. */
export interface TrafficLaneOptions {
	/** The vehicle mesh. Its nose points along local +Z and its belly sits just above y = 0. */
	mesh: MeshGeometry;
	/** The lanes' plan. */
	plan: LanePlan;
	/** The vehicles that draw at each quality preset. */
	counts: Record<QualityPreset, number>;
	/** The colours of the vehicles' own lights. */
	look?: VehicleLook;
	/** The layer mask of every row. Give the effect layer to keep a route guard off the traffic. */
	layers?: number;
	/**
	 * How many of the nearest vehicles get a real point light, a few times a second. The default is
	 * 0. Each one costs a surface as a point light does, so keep the count small.
	 */
	realLights?: number;
}

/** The traffic of a set of lanes. */
export interface TrafficLanes {
	/** Draws the vehicles of a quality preset. */
	fit(preset: QualityPreset): void;
	/** Draws `count` vehicles, thinned evenly across every lane. */
	setCount(count: number): void;
	/** The vehicles that draw now. */
	readonly count: number;
	/**
	 * Moves the real lights to the nearest vehicles, and turns them off when none is near. Call it
	 * once per frame with the camera's position and the sketch time; it searches a few times a
	 * second.
	 */
	update(eye: Vec3Like, time: number): void;
}

/** The four headings, as the yaw that turns a vehicle's nose from +Z onto its lane. */
const HEADINGS = [
	{ yaw: Math.PI / 2, alongX: true, sign: 1 },
	{ yaw: -Math.PI / 2, alongX: true, sign: -1 },
	{ yaw: 0, alongX: false, sign: 1 },
	{ yaw: Math.PI, alongX: false, sign: -1 },
] as const;

/** How far from the camera a real light may sit, in meters, and how often the pool searches. */
const LIGHT_RANGE = 150;
const LIGHT_SECONDS = 0.25;
/** The rows the real-light search looks at at most, so its cost does not follow the count. */
const LIGHT_CANDIDATES = 4096;

/** Builds the traffic of a plan of lanes. */
export function createTrafficLanes(ctx: SketchContext, options: TrafficLaneOptions): TrafficLanes {
	const { scene, materials } = ctx;
	const { mesh, plan, counts, look = {}, layers, realLights = 0 } = options;
	const span = plan.to - plan.from;
	if (!(span > 0))
		throw new Error('createTrafficLanes() needs a plan whose `to` is past its `from`.');
	if (!(plan.levels >= 1))
		throw new Error('createTrafficLanes() needs at least one level of lanes.');
	const size = look.size ?? [0.96, 1.1, 2.0];
	// Every lane of every street and heading, and the rows that fill one lane at the largest count.
	const laneCount = plan.lines.length * plan.levels * 2 * HEADINGS.length;
	const largest = Math.max(...Object.values(counts));
	const perLane = Math.max(1, Math.ceil(largest / laneCount));
	const turn = quat.create();
	math.seed(77);

	const batches = HEADINGS.map((lane) => {
		quat.setAxisAngle(turn, [0, 1, 0], lane.yaw);
		const material = materials.shader({
			wgsl: vehicleShader,
			uniforms: {
				heading: lane.yaw,
				glow: look.glow ?? 2.2,
				size: [size[0] as number, size[1] as number, size[2] as number],
				body: look.body ?? '#20242c',
				tail: look.tail ?? '#ff3a12',
				nose: look.nose ?? '#cfe6ff',
				skirt: look.skirt ?? '#22c8ff',
			},
			color: '#20242c',
			roughness: 0.34,
			metalness: 0.7,
			contactShadows: false,
		});
		const rows: { x: number; y: number; z: number; speed: number; offset: number; tint: number }[] =
			[];
		// A lane's rows start where its heading says: at `from` for +X and +Z, and at `to` for -X
		// and -Z, so every row travels into the scene rather than out of it.
		const start = lane.sign > 0 ? plan.from : plan.to;
		for (const line of plan.lines) {
			for (let level = 0; level < plan.levels; level++) {
				const altitude = plan.low + (level * (plan.high - plan.low)) / Math.max(1, plan.levels - 1);
				for (const side of [-1, 1]) {
					const across = line + side * plan.offset;
					for (let slot = 0; slot < perLane; slot++) {
						rows.push({
							x: lane.alongX ? start : across,
							y: altitude + math.randFloat(-0.5, 0.5),
							z: lane.alongX ? across : start,
							speed: math.randFloat(19, 43),
							offset: ((slot + math.randFloatSpread(0.6)) / perLane) * span,
							tint: math.random(),
						});
					}
				}
			}
		}
		// Shuffle the rows, so a preset that draws a share of them thins every lane alike.
		for (let k = rows.length - 1; k > 0; k--) {
			const pick = math.randInt(0, k);
			const swap = rows[k] as (typeof rows)[number];
			rows[k] = rows[pick] as (typeof rows)[number];
			rows[pick] = swap;
		}
		const batch = scene.createInstances(mesh, rows.length, {
			material,
			values: true,
			...(layers === undefined ? {} : { layers }),
		});
		// The arrays are read once: a lane of a hundred thousand rows would otherwise make a small
		// array for every value of every row.
		const positions = batch.positions;
		const rotations = batch.rotations;
		const scales = batch.scales;
		const values = batch.values as Float32Array;
		for (let k = 0; k < rows.length; k++) {
			const car = rows[k] as (typeof rows)[number];
			positions[k * 3] = car.x;
			positions[k * 3 + 1] = car.y;
			positions[k * 3 + 2] = car.z;
			rotations[k * 4] = turn[0] as number;
			rotations[k * 4 + 1] = turn[1] as number;
			rotations[k * 4 + 2] = turn[2] as number;
			rotations[k * 4 + 3] = turn[3] as number;
			scales[k * 3] = 1;
			scales[k * 3 + 1] = 1;
			scales[k * 3 + 2] = 1;
			values[k * 4] = car.offset;
			values[k * 4 + 1] = car.speed;
			values[k * 4 + 2] = span;
			values[k * 4 + 3] = car.tint;
		}
		batch.markDirty(0, rows.length);
		// A row travels the whole lane from its origin, so its own sphere must cover the lane, or
		// the engine culls it while it is still on the screen.
		batch.setBoundingRadius(span);
		return { yaw: lane.yaw, batch, active: rows.length, total: rows.length };
	});

	// The real lights: a pool that each search moves to the nearest vehicles.
	const lights = Array.from({ length: realLights }, () =>
		scene.createPointLight({
			position: [0, 0, 0],
			color: look.tail ?? '#ff3a12',
			intensity: 0,
			range: 26,
			...(layers === undefined ? {} : { layers }),
		}),
	);
	const bestDistance = new Float32Array(realLights).fill(Number.POSITIVE_INFINITY);
	const bestPlace = new Float32Array(realLights * 3);
	const place = [0, 0, 0];
	const eyeAt = vec3.create();
	let searchedAt = Number.NEGATIVE_INFINITY;
	let drawn = 0;

	/** Draws `count` vehicles, each heading taking its share from the front of its shuffled rows. */
	const setCount = (count: number): void => {
		drawn = Math.min(
			count,
			batches.reduce((sum, entry) => sum + entry.total, 0),
		);
		const share = Math.round(drawn / batches.length);
		for (const entry of batches) {
			entry.active = Math.min(entry.total, share);
			entry.batch.setActiveCount(entry.active);
		}
	};
	setCount(largest);

	return {
		fit(preset) {
			setCount(counts[preset]);
		},
		setCount,
		get count() {
			return drawn;
		},
		update(eye, time) {
			if (realLights === 0 || time - searchedAt < LIGHT_SECONDS) return;
			searchedAt = time;
			bestDistance.fill(Number.POSITIVE_INFINITY);
			vec3.set(eyeAt, eye[0] as number, eye[1] as number, eye[2] as number);
			const total = batches.reduce((sum, entry) => sum + entry.active, 0);
			// Look at a share of the rows, so the search costs the same at every count.
			const stride = Math.max(1, Math.floor(total / LIGHT_CANDIDATES));
			let seen = 0;
			for (const entry of batches) {
				const along = [Math.sin(entry.yaw), Math.cos(entry.yaw)] as const;
				// The views are read here, not kept: the engine's memory may have grown since the
				// setup, which makes every earlier view stale.
				const positions = entry.batch.positions;
				const values = entry.batch.values as Float32Array;
				for (let k = 0; k < entry.active; k++, seen++) {
					if (seen % stride !== 0) continue;
					const lane = values[k * 4 + 2] as number;
					const travelled = (values[k * 4] as number) + time * (values[k * 4 + 1] as number);
					const at = travelled - lane * Math.floor(travelled / lane);
					place[0] = (positions[k * 3] as number) + along[0] * at;
					place[1] = positions[k * 3 + 1] as number;
					place[2] = (positions[k * 3 + 2] as number) + along[1] * at;
					const distance = Math.hypot(
						(place[0] as number) - (eyeAt[0] as number),
						(place[1] as number) - (eyeAt[1] as number),
						(place[2] as number) - (eyeAt[2] as number),
					);
					if (distance > LIGHT_RANGE) continue;
					// The farthest light that this one beats takes its place.
					let worst = -1;
					let worstDistance = distance;
					for (let slot = 0; slot < realLights; slot++) {
						const held = bestDistance[slot] as number;
						if (held > worstDistance) {
							worst = slot;
							worstDistance = held;
						}
					}
					if (worst < 0) continue;
					bestDistance[worst] = distance;
					bestPlace[worst * 3] = place[0] as number;
					bestPlace[worst * 3 + 1] = place[1] as number;
					bestPlace[worst * 3 + 2] = place[2] as number;
				}
			}
			for (let slot = 0; slot < realLights; slot++) {
				const light = lights[slot] as (typeof lights)[number];
				if ((bestDistance[slot] as number) === Number.POSITIVE_INFINITY) {
					light.setIntensity(0);
					continue;
				}
				light.setPosition(
					bestPlace[slot * 3] as number,
					bestPlace[slot * 3 + 1] as number,
					bestPlace[slot * 3 + 2] as number,
				);
				light.setIntensity(70);
			}
		},
	};
}
