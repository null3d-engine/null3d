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
import { type LightPool, laneGroups, moveLights } from './lights';
import vehicleShader from './vehicle.wgsl';

/** The size of a vehicle that `createVehicleHull` builds. */
export interface VehicleSize {
	/** Half the hull's width, in meters. */
	halfWidth: number;
	/** The hull's height, from its belly to its canopy, in meters. */
	height: number;
	/** Half the hull's length, in meters. */
	halfLength: number;
}

/** The hull that a lane's vehicles draw, in the size it was built at. */
export const DEFAULT_VEHICLE: VehicleSize = { halfWidth: 0.96, height: 1.1, halfLength: 2.0 };

/**
 * The detail of a vehicle's hull. `full` gives every face its own vertices, so the hull reads as
 * faceted panels. `light` shares each vertex between the faces that meet at it, so the same
 * silhouette takes a third of the vertex work and lights as one smooth body.
 */
export type HullDetail = 'full' | 'light';

/**
 * Builds a low hover vehicle: a hull lofted through four sections with a low canopy. Its nose
 * points along local +Z, its belly sits just above y = 0, and its canopy rises to `height`. The
 * add-on's surface paints its lights from that space, and `VehicleLook.size` takes the same three
 * numbers.
 */
export function createVehicleHull(
	ctx: SketchContext,
	size: VehicleSize = DEFAULT_VEHICLE,
	detail: HullDetail = 'full',
): MeshGeometry {
	const { geometry } = ctx;
	const sx = size.halfWidth / DEFAULT_VEHICLE.halfWidth;
	const sy = size.height / DEFAULT_VEHICLE.height;
	const sz = size.halfLength / DEFAULT_VEHICLE.halfLength;
	const positions: number[] = [];
	const indices: number[] = [];
	/** Adds a quad as two triangles from four corners, wound from the outside. */
	const quad = (
		a: readonly number[],
		b: readonly number[],
		c: readonly number[],
		d: readonly number[],
	) => {
		const first = positions.length / 3;
		positions.push(...a, ...b, ...c, ...d);
		indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
	};
	/** Adds a quad as two triangles from four places already in the vertices. */
	const quadAt = (a: number, b: number, c: number, d: number) => {
		indices.push(a, b, c, a, c, d);
	};
	// The hull is a loft through four sections: a narrow tail, a wide middle, a wide front and a
	// narrow nose. Each section is a rectangle from the belly to its own roofline.
	const sections = [
		{ z: -2.0, half: 0.74, top: 0.54 },
		{ z: -1.2, half: 0.96, top: 0.84 },
		{ z: 1.2, half: 0.9, top: 0.74 },
		{ z: 2.0, half: 0.52, top: 0.38 },
	];
	const belly = 0.12;
	const corners = (s: (typeof sections)[number]): number[][] => [
		[-s.half, belly, s.z],
		[s.half, belly, s.z],
		[s.half, s.top, s.z],
		[-s.half, s.top, s.z],
	];
	// The canopy: a low ridge from the windshield back to the rear deck, in its eight places.
	const canopy = [
		[-0.42, 0.84, 1.0],
		[0.42, 0.84, 1.0],
		[-0.34, 1.1, 0.1],
		[0.34, 1.1, 0.1],
		[-0.36, 1.05, -0.9],
		[0.36, 1.05, -0.9],
		[-0.44, 0.8, -1.0],
		[0.44, 0.8, -1.0],
	] as const;
	if (detail === 'full') {
		for (let k = 0; k < sections.length - 1; k++) {
			const a = corners(sections[k] as (typeof sections)[number]);
			const b = corners(sections[k + 1] as (typeof sections)[number]);
			quad(a[0] as number[], a[1] as number[], b[1] as number[], b[0] as number[]);
			quad(a[3] as number[], b[3] as number[], b[2] as number[], a[2] as number[]);
			quad(a[0] as number[], b[0] as number[], b[3] as number[], a[3] as number[]);
			quad(a[1] as number[], a[2] as number[], b[2] as number[], b[1] as number[]);
		}
		const tail = corners(sections[0] as (typeof sections)[number]);
		const nose = corners(sections[sections.length - 1] as (typeof sections)[number]);
		quad(tail[0] as number[], tail[3] as number[], tail[2] as number[], tail[1] as number[]);
		quad(nose[0] as number[], nose[1] as number[], nose[2] as number[], nose[3] as number[]);
		quad(canopy[0], canopy[1], canopy[3], canopy[2]);
		quad(canopy[2], canopy[3], canopy[5], canopy[4]);
		quad(canopy[0], canopy[2], canopy[4], canopy[6]);
		quad(canopy[1], canopy[7], canopy[5], canopy[3]);
	} else {
		// The sections hold one ring of four vertices each, which the faces between them share.
		for (const section of sections) {
			for (const corner of corners(section)) positions.push(...corner);
		}
		for (let k = 0; k < sections.length - 1; k++) {
			const a = k * 4;
			const b = (k + 1) * 4;
			quadAt(a, a + 1, b + 1, b);
			quadAt(a + 3, b + 3, b + 2, a + 2);
			quadAt(a, b, b + 3, a + 3);
			quadAt(a + 1, a + 2, b + 2, b + 1);
		}
		const last = (sections.length - 1) * 4;
		quadAt(0, 3, 2, 1);
		quadAt(last, last + 1, last + 2, last + 3);
		const base = positions.length / 3;
		for (const place of canopy) positions.push(...place);
		quadAt(base, base + 1, base + 3, base + 2);
		quadAt(base + 2, base + 3, base + 5, base + 4);
		quadAt(base, base + 2, base + 4, base + 6);
		quadAt(base + 1, base + 7, base + 5, base + 3);
	}
	// A material with a surface function draws only a mesh that has texture coordinates, whatever
	// the function reads, so the hull carries a simple pair along its side and its height.
	const uvs = new Float32Array((positions.length / 3) * 2);
	for (let k = 0; k < positions.length; k += 3) {
		positions[k] = (positions[k] as number) * sx;
		positions[k + 1] = (positions[k + 1] as number) * sy;
		positions[k + 2] = (positions[k + 2] as number) * sz;
		uvs[(k / 3) * 2] = ((positions[k] as number) + 1) * 0.5;
		uvs[(k / 3) * 2 + 1] = positions[k + 1] as number;
	}
	return geometry.fromArrays({
		positions: new Float32Array(positions),
		uvs,
		indices: new Uint32Array(indices),
		computeNormals: true,
	});
}

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
	/**
	 * Removes the batches, their materials and the real lights, so a scene can build the lanes
	 * again around another hull. Destroy the hull the scene gave after this call.
	 */
	dispose(): void;
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
		// The rows of one lane share their line across the way. The real-light search skips a lane
		// whose line is out of range before it reads a row, so its cost follows the lanes near the
		// camera, not the count.
		const groups = laneGroups(positions, rows.length, lane.alongX);
		return {
			yaw: lane.yaw,
			alongX: lane.alongX,
			batch,
			material,
			active: rows.length,
			total: rows.length,
			groups,
		};
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
	const pool: LightPool = { distance: bestDistance, place: bestPlace };
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
		dispose() {
			for (const entry of batches) {
				entry.batch.destroy();
				entry.material.destroy();
			}
			for (const light of lights) light.destroy();
		},
		update(eye, time) {
			if (realLights === 0 || time - searchedAt < LIGHT_SECONDS) return;
			searchedAt = time;
			vec3.set(eyeAt, eye[0] as number, eye[1] as number, eye[2] as number);
			moveLights(batches, eyeAt, time, LIGHT_RANGE, pool);
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
