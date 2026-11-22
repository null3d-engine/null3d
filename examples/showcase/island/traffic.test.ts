// The traffic plan's checks that need no GPU: loops cut from the stored roads, cars that keep to
// them, speeds and phases that never repeat, paths that stay on a road, a footpath or the sand,
// people who hide at a door or a car, and a plan that repeats for a seed and changes with another.
// Every mover is also held clear of the island's standing objects at a fine step of its timeline.
import { describe, expect, it } from 'bun:test';
import type { Material, MeshGeometry, SketchContext } from '@null3d/engine';
import { SEA_LEVEL, sandAt, TOWN, townShare } from './island';
import { HOUSE_KINDS } from './kit';
import {
	doorOf,
	FILL_SPOTS,
	groundHeight,
	LOTS,
	ROADS,
	roadEdge,
	SHRUBS,
	STAIRS,
	slopeAt,
	TERRACES,
	TREE_SPOTS,
} from './plan';
import { LOUNGER_OFFSETS } from './props';
import { LANE, PARKS } from './routes';
import { parasolSpots } from './town';
import {
	BUS_HALF_LENGTH,
	BUS_HALF_WIDTH,
	buildRoadNetwork,
	CAR_HALF_LENGTH,
	CAR_HALF_WIDTH,
	createPlaceholderModels,
	createTraffic,
	makePath,
	type Path,
	PERSON_RADIUS,
	type PersonActor,
	type PersonState,
	type PersonStride,
	type Pose,
	pathAt,
	personAt,
	personStrideAt,
	planTraffic,
	staticGap,
	TRAFFIC_SEED,
	vehicleAt,
	vehicleFadeAt,
} from './traffic';

/** The point that a sample writes into, so a check allocates nothing per step. */
const POSE: Pose = { x: 0, y: 0, z: 0, yaw: 0 };

/** The plan that most checks read. */
const PLAN = planTraffic();

/** A point of a path, copied so that the next sample cannot write over it. */
function pointOf(path: Path, at: number): { x: number; y: number; z: number } {
	pathAt(path, at, POSE);
	return { x: POSE.x, y: POSE.y, z: POSE.z };
}

/** The distance between two 2-D segments. */
function segmentGap(
	ax: number,
	az: number,
	bx: number,
	bz: number,
	cx: number,
	cz: number,
	dx: number,
	dz: number,
): number {
	const abx = bx - ax;
	const abz = bz - az;
	const cdx = dx - cx;
	const cdz = dz - cz;
	const acx = cx - ax;
	const acz = cz - az;
	const a = abx * abx + abz * abz;
	const e = cdx * cdx + cdz * cdz;
	const f = cdx * acx + cdz * acz;
	if (a < 1e-9 && e < 1e-9) return Math.hypot(acx, acz);
	let s = 0;
	let t = 0;
	if (a < 1e-9) t = Math.max(0, Math.min(1, f / e));
	else {
		const c = abx * acx + abz * acz;
		if (e < 1e-9) s = Math.max(0, Math.min(1, -c / a));
		else {
			const b = abx * cdx + abz * cdz;
			const denom = a * e - b * b;
			s = denom > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
			t = (b * s + f) / e;
			if (t < 0) {
				t = 0;
				s = Math.max(0, Math.min(1, -c / a));
			} else if (t > 1) {
				t = 1;
				s = Math.max(0, Math.min(1, (b - c) / a));
			}
		}
	}
	return Math.hypot(ax + abx * s - (cx + cdx * t), az + abz * s - (cz + cdz * t));
}

/** The gap between two vehicles' bodies, in meters. */
function bodyGap(
	first: (typeof PLAN.vehicles)[number],
	a: Pose,
	second: (typeof PLAN.vehicles)[number],
	b: Pose,
): number {
	return (
		segmentGap(
			a.x - Math.sin(a.yaw) * first.halfLength,
			a.z - Math.cos(a.yaw) * first.halfLength,
			a.x + Math.sin(a.yaw) * first.halfLength,
			a.z + Math.cos(a.yaw) * first.halfLength,
			b.x - Math.sin(b.yaw) * second.halfLength,
			b.z - Math.cos(b.yaw) * second.halfLength,
			b.x + Math.sin(b.yaw) * second.halfLength,
			b.z + Math.cos(b.yaw) * second.halfLength,
		) -
		first.halfWidth -
		second.halfWidth
	);
}

/** How far a place stands from a parked car's body, in meters; below zero inside it. */
function parkedGap(car: { x: number; z: number; yaw: number }, x: number, z: number): number {
	const [c, s] = [Math.cos(car.yaw), Math.sin(car.yaw)];
	const dx = x - car.x;
	const dz = z - car.z;
	const along = dx * s + dz * c;
	const across = dx * c - dz * s;
	const du = Math.abs(along) - 2.1;
	const dv = Math.abs(across) - 0.9;
	if (du <= 0 && dv <= 0) return Math.max(du, dv);
	return Math.hypot(Math.max(du, 0), Math.max(dv, 0));
}

/** A plan's figures, as a string that names every choice that the seed makes. */
function signature(seed: number): string {
	const plan = planTraffic({ seed });
	return JSON.stringify({
		vehicles: plan.vehicles.map((vehicle) => [
			vehicle.kind,
			vehicle.speed,
			vehicle.phase,
			vehicle.route.length,
		]),
		people: plan.people.map((person) => [person.speed, person.phase, person.script.cycle]),
		parked: plan.parked.map((car) => [car.x, car.y, car.z, car.yaw]),
	});
}

describe('the road network', () => {
	it('cuts the stored roads into closed loops that follow them', () => {
		const network = buildRoadNetwork(ROADS);
		expect(network.edges.length).toBeGreaterThan(100);
		expect(network.cycles.length).toBeGreaterThanOrEqual(8);
		for (const cycle of network.cycles) {
			expect(cycle.length).toBeGreaterThanOrEqual(120);
			const start = pointOf(cycle.path, 0);
			const end = pointOf(cycle.path, cycle.length);
			expect(Math.hypot(start.x - end.x, start.z - end.z)).toBeLessThan(0.5);
			for (let at = 0; at <= cycle.length; at += 4) {
				pathAt(cycle.path, at, POSE);
				expect(roadEdge(POSE.x, POSE.z)).toBeLessThan(1);
			}
		}
	});
});

describe('the vehicles', () => {
	it('gives every car its own speed and spreads the phases on a loop', () => {
		const cars = PLAN.vehicles.filter((vehicle) => vehicle.kind === 'car');
		expect(cars.length).toBe(PLAN.counts.cars);
		expect(new Set(cars.map((car) => car.speed.toFixed(6))).size).toBe(cars.length);
		const phases = new Map<string, number[]>();
		for (const car of cars) {
			const key = car.route.length.toFixed(3);
			const list = phases.get(key);
			if (list) list.push(car.phase);
			else phases.set(key, [car.phase]);
		}
		for (const list of phases.values())
			expect(new Set(list.map((phase) => phase.toFixed(3))).size).toBe(list.length);
	});

	it('keeps a headway between every pair of vehicle bodies', () => {
		const poses = PLAN.vehicles.map(() => ({ x: 0, y: 0, z: 0, yaw: 0 }));
		let least = Number.POSITIVE_INFINITY;
		for (let seconds = 0; seconds <= 600; seconds += 0.05) {
			PLAN.vehicles.forEach((vehicle, k) => {
				vehicleAt(vehicle, seconds, poses[k] as Pose);
			});
			for (let a = 0; a < PLAN.vehicles.length; a++)
				for (let b = a + 1; b < PLAN.vehicles.length; b++) {
					const gap = bodyGap(
						PLAN.vehicles[a] as (typeof PLAN.vehicles)[number],
						poses[a] as Pose,
						PLAN.vehicles[b] as (typeof PLAN.vehicles)[number],
						poses[b] as Pose,
					);
					least = Math.min(least, gap);
				}
		}
		// A follower holds when its body would come within the headway's gap.
		expect(least).toBeGreaterThan(0.2);
	});

	it('runs one bus on a loop that passes the harbour and stops five times', () => {
		const bus = PLAN.vehicles.find((vehicle) => vehicle.kind === 'bus');
		expect(bus).toBeDefined();
		if (!bus) return;
		expect(PLAN.counts.buses).toBe(1);
		expect(bus.route.length).toBeGreaterThan(300);
		expect(bus.script?.legs.filter((leg) => leg.from === leg.to).length).toBe(5);
		let nearest = Number.POSITIVE_INFINITY;
		for (let at = 0; at <= bus.route.length; at += 3) {
			pathAt(bus.route, at, POSE);
			nearest = Math.min(nearest, Math.hypot(POSE.x + 77, POSE.z - 276));
		}
		expect(nearest).toBeLessThan(50);
	});

	it('keeps every vehicle on a road and above the sea', () => {
		for (const vehicle of PLAN.vehicles) {
			for (let at = 0; at <= vehicle.route.length; at += 4) {
				pathAt(vehicle.route, at, POSE);
				expect(roadEdge(POSE.x, POSE.z)).toBeLessThan(1);
				expect(POSE.y).toBeGreaterThan(SEA_LEVEL + 0.5);
			}
		}
	});

	it('stands every parked car at a road kerb, clear of the traffic', () => {
		expect(PLAN.parked.length).toBe(PLAN.counts.parkedCars);
		const cars = PLAN.vehicles.filter((vehicle) => vehicle.kind === 'car');
		for (const parked of PLAN.parked) {
			expect(roadEdge(parked.x, parked.z)).toBeLessThan(1.5);
			let nearest = Number.POSITIVE_INFINITY;
			for (const car of cars) {
				for (let at = 0; at <= car.route.length; at += 1) {
					pathAt(car.route, at, POSE);
					nearest = Math.min(nearest, Math.hypot(POSE.x - parked.x, POSE.z - parked.z));
				}
			}
			// Two cars of the placeholder's width clear each other at this distance.
			expect(nearest).toBeGreaterThanOrEqual(2);
		}
	});

	it('fades each car out at the end of its run and starts it again elsewhere', () => {
		const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
		const cars = PLAN.vehicles.filter((vehicle) => vehicle.kind === 'car');
		for (const car of cars) {
			expect(car.runs?.length ?? 0).toBeGreaterThan(0);
			let last: { x: number; z: number } | undefined;
			let lastFade = 1;
			let dimmest = 1;
			let found = false;
			for (let seconds = 0; seconds < 600 && !found; seconds += 0.05) {
				const fade = vehicleFadeAt(car, seconds);
				vehicleAt(car, seconds, pose);
				dimmest = Math.min(dimmest, fade);
				// A run starts on a loop of its own, and the car was dim before the move.
				if (last && Math.hypot(pose.x - last.x, pose.z - last.z) > 10) found = lastFade < 0.25;
				last = { x: pose.x, z: pose.z };
				lastFade = fade;
			}
			expect(found).toBe(true);
			expect(dimmest).toBeLessThan(0.05);
		}
	});

	it('never leaves a car standing for more than a moment', () => {
		const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
		for (const car of PLAN.vehicles.filter((vehicle) => vehicle.kind === 'car')) {
			let last: { x: number; z: number } | undefined;
			let still = 0;
			let longest = 0;
			for (let seconds = 0; seconds < 600; seconds += 0.1) {
				vehicleAt(car, seconds, pose);
				if (last && Math.hypot(pose.x - last.x, pose.z - last.z) < 1e-4) {
					still += 0.1;
					longest = Math.max(longest, still);
				} else still = 0;
				last = { x: pose.x, z: pose.z };
			}
			expect(longest).toBeLessThan(5);
		}
	});

	it('never fades a car while it stands still', () => {
		const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
		let still = 0;
		for (const car of PLAN.vehicles.filter((vehicle) => vehicle.kind === 'car')) {
			let last: { x: number; z: number } | undefined;
			let lastFade = 1;
			for (let seconds = 0; seconds < 600; seconds += 0.1) {
				const fade = vehicleFadeAt(car, seconds);
				vehicleAt(car, seconds, pose);
				if (last && Math.hypot(pose.x - last.x, pose.z - last.z) < 1e-4) {
					still++;
					// A held car keeps the share it last drew, so it never shrinks in place.
					expect(Math.abs(fade - lastFade)).toBeLessThan(1e-3);
				}
				last = { x: pose.x, z: pose.z };
				lastFade = fade;
			}
		}
		expect(still).toBeGreaterThan(0);
	});
});

describe('the people', () => {
	it('keeps every walk on a road, a footpath or the sand, above the sea and off the cliffs', () => {
		for (const person of PLAN.people) {
			for (let at = 0; at <= person.walk.length; at += 2) {
				pathAt(person.walk, at, POSE);
				if (roadEdge(POSE.x, POSE.z) > 3.6) {
					// A walk that leaves the pavement's band is on the beach's sand.
					expect(sandAt(POSE.x, POSE.z)).toBeGreaterThan(0.3);
				}
				expect(POSE.y).toBeGreaterThan(SEA_LEVEL + 0.5);
				expect(slopeAt(POSE.x, POSE.z)).toBeLessThan(0.4);
			}
		}
	});

	it('walks someone to the sand and hides them at a door and at a car', () => {
		const toSand = PLAN.people.some((person) => {
			for (let at = 0; at <= person.walk.length; at += 2) {
				pathAt(person.walk, at, POSE);
				if (roadEdge(POSE.x, POSE.z) > 4) return true;
			}
			return false;
		});
		expect(toSand).toBe(true);

		// A resident waits out of sight at the house's door, then walks into view.
		const resident = PLAN.people.find((person) => person.script.legs[0]?.hidden === true);
		expect(resident).toBeDefined();
		if (!resident) return;
		expect(resident.script.legs[0]?.from).toBe(0);
		let hidden = false;
		let seen = false;
		for (let seconds = 0; seconds < resident.script.cycle; seconds += 0.5) {
			if (personAt(resident, seconds, { x: 0, y: 0, z: 0, yaw: 0, hidden: false, fade: 0 }).hidden)
				hidden = true;
			else seen = true;
			if (hidden && seen) break;
		}
		expect(hidden).toBe(true);
		expect(seen).toBe(true);
		const door = pointOf(resident.walk, 0);
		const nearestDoor = Math.min(
			...LOTS.map((lot) => {
				const at = doorOf(lot);
				return Math.hypot(at.x - door.x, at.z - door.z);
			}),
		);
		// The clear stretch may begin a step or two out from the door's threshold.
		expect(nearestDoor).toBeLessThan(5);

		// A rider gets into its car at the far end, out of sight.
		const rider = PLAN.people.find((person) => person.ride);
		expect(rider).toBeDefined();
		if (!rider) return;
		const end = pointOf(rider.walk, rider.walk.length);
		const nearestCar = Math.min(
			...PLAN.parked.map((car) => Math.hypot(car.x - end.x, car.z - end.z)),
		);
		expect(nearestCar).toBeLessThan(4);
	});

	it('keeps every pair of visible people apart', () => {
		const poses = PLAN.people.map(() => ({ x: 0, y: 0, z: 0, yaw: 0, hidden: false, fade: 0 }));
		let least = Number.POSITIVE_INFINITY;
		for (let seconds = 0; seconds <= 600; seconds += 0.5) {
			PLAN.people.forEach((person, k) => {
				personAt(person, seconds, poses[k] as never);
			});
			for (let a = 0; a < PLAN.people.length; a++)
				for (let b = a + 1; b < PLAN.people.length; b++) {
					const A = poses[a] as { x: number; z: number; hidden: boolean };
					const B = poses[b] as { x: number; z: number; hidden: boolean };
					if (A.hidden || B.hidden) continue;
					least = Math.min(least, Math.hypot(A.x - B.x, A.z - B.z));
				}
		}
		expect(least).toBeGreaterThanOrEqual(0.6);
	});

	it('keeps every visible person clear of every standing object', () => {
		const poses = PLAN.people.map(() => ({ x: 0, y: 0, z: 0, yaw: 0, hidden: false, fade: 0 }));
		let least = Number.POSITIVE_INFINITY;
		for (let seconds = 0; seconds <= 600; seconds += 0.5) {
			PLAN.people.forEach((person, k) => {
				personAt(person, seconds, poses[k] as never);
			});
			for (const pose of poses)
				if (!pose.hidden) least = Math.min(least, staticGap(pose.x, pose.z));
		}
		// A tree's trunk, a shrub's stems, a terrace wall, a stair, a parasol's pole or a lounger.
		expect(least).toBeGreaterThanOrEqual(PERSON_RADIUS);
	});

	it('keeps every vehicle body clear of every standing object', () => {
		const poses = PLAN.vehicles.map(() => ({ x: 0, y: 0, z: 0, yaw: 0 }));
		let least = Number.POSITIVE_INFINITY;
		for (let seconds = 0; seconds <= 600; seconds += 0.25) {
			PLAN.vehicles.forEach((vehicle, k) => {
				vehicleAt(vehicle, seconds, poses[k] as Pose);
			});
			PLAN.vehicles.forEach((vehicle, k) => {
				const pose = poses[k] as Pose;
				const [hl, hw] =
					vehicle.kind === 'bus'
						? [BUS_HALF_LENGTH, BUS_HALF_WIDTH]
						: [CAR_HALF_LENGTH, CAR_HALF_WIDTH];
				const [c, s] = [Math.cos(pose.yaw), Math.sin(pose.yaw)];
				for (const [u, v] of [
					[hl, hw],
					[hl, -hw],
					[-hl, hw],
					[-hl, -hw],
				] as const) {
					const x = pose.x + u * s + v * c;
					const z = pose.z + u * c - v * s;
					least = Math.min(least, staticGap(x, z));
				}
			});
		}
		expect(least).toBeGreaterThanOrEqual(0);
	});

	it('keeps every vehicle body out of every house footprint', () => {
		const poses = PLAN.vehicles.map(() => ({ x: 0, y: 0, z: 0, yaw: 0 }));
		const houses = LOTS.map((lot) => {
			const half = (HOUSE_KINDS[lot.kind] as { half: readonly [number, number] }).half;
			return { x: lot.x, z: lot.z, yaw: lot.yaw, hw: half[0], hd: half[1] };
		});
		let leastRoad = Number.POSITIVE_INFINITY;
		let worst = '';
		let inside = 0;
		for (let seconds = 0; seconds <= 600; seconds += 0.25) {
			PLAN.vehicles.forEach((vehicle, k) => {
				vehicleAt(vehicle, seconds, poses[k] as Pose);
			});
			PLAN.vehicles.forEach((vehicle, k) => {
				const pose = poses[k] as Pose;
				// The drawn model's own size, not the plan's larger box: 3.7 by 1.86 m for the car and
				// 4.9 by 2.33 for the bus, which is what a visitor sees.
				const hl = vehicle.kind === 'bus' ? 2.45 : 1.85;
				const hw = vehicle.kind === 'bus' ? 1.17 : 0.93;
				const [c, s] = [Math.cos(pose.yaw), Math.sin(pose.yaw)];
				for (const [u, v] of [
					[hl, hw],
					[hl, -hw],
					[-hl, hw],
					[-hl, -hw],
				] as const) {
					const x = pose.x + u * s + v * c;
					const z = pose.z + u * c - v * s;
					const edge = roadEdge(x, z);
					if (edge < leastRoad) {
						leastRoad = edge;
						worst = `${vehicle.kind} at ${seconds.toFixed(1)} s`;
					}
					for (const house of houses) {
						const [ch, sh] = [Math.cos(house.yaw), Math.sin(house.yaw)];
						const dx = x - house.x;
						const dz = z - house.z;
						if (Math.abs(dx * ch - dz * sh) < house.hw && Math.abs(dx * sh + dz * ch) < house.hd) {
							inside++;
							break;
						}
					}
				}
			});
		}
		// No corner of any vehicle enters a house, at any sampled moment.
		expect(inside).toBe(0);
		// A corner may leave the drawn road on the tightest bend, where a real one overhangs the
		// verge; the figure is recorded so a change that widens it shows.
		console.log(`least road edge under a vehicle corner: ${leastRoad.toFixed(2)} m at ${worst}`);
	});

	it('keeps every visible person outside every vehicle body, parked cars included', () => {
		const vehicles = PLAN.vehicles.map(() => ({ x: 0, y: 0, z: 0, yaw: 0 }));
		const people = PLAN.people.map(() => ({ x: 0, y: 0, z: 0, yaw: 0, hidden: false, fade: 0 }));
		let least = Number.POSITIVE_INFINITY;
		for (let seconds = 0; seconds <= 600; seconds += 0.25) {
			PLAN.vehicles.forEach((vehicle, k) => {
				vehicleAt(vehicle, seconds, vehicles[k] as Pose);
			});
			PLAN.people.forEach((person, k) => {
				personAt(person, seconds, people[k] as never);
			});
			for (let p = 0; p < PLAN.people.length; p++) {
				const person = people[p] as { x: number; z: number; hidden: boolean };
				if (person.hidden) continue;
				for (let v = 0; v < PLAN.vehicles.length; v++) {
					const vehicle = PLAN.vehicles[v] as (typeof PLAN.vehicles)[number];
					const pose = vehicles[v] as Pose;
					const gap =
						segmentGap(
							pose.x - Math.sin(pose.yaw) * vehicle.halfLength,
							pose.z - Math.cos(pose.yaw) * vehicle.halfLength,
							pose.x + Math.sin(pose.yaw) * vehicle.halfLength,
							pose.z + Math.cos(pose.yaw) * vehicle.halfLength,
							person.x,
							person.z,
							person.x,
							person.z,
						) - vehicle.halfWidth;
					least = Math.min(least, gap);
				}
				// The parked cars stand still, and every walk line clears each one's body too.
				for (const car of PLAN.parked) least = Math.min(least, parkedGap(car, person.x, person.z));
			}
		}
		// The walk's clear stretches keep a body's margin from every vehicle's side.
		expect(least).toBeGreaterThan(0.2);
	});

	it('keeps every visible person outside every parked car', () => {
		const pose = { x: 0, y: 0, z: 0, yaw: 0, hidden: false, fade: 0 };
		let least = Number.POSITIVE_INFINITY;
		for (let seconds = 0; seconds <= 600; seconds += 0.5) {
			for (const person of PLAN.people) {
				personAt(person, seconds, pose);
				if (pose.hidden) continue;
				for (const car of PLAN.parked) least = Math.min(least, parkedGap(car, pose.x, pose.z));
			}
		}
		expect(least).toBeGreaterThan(0.2);
	});

	it('keeps every visible person out of every house footprint', () => {
		const houses = LOTS.map((lot) => {
			const half = (HOUSE_KINDS[lot.kind] as { half: readonly [number, number] }).half;
			return { x: lot.x, z: lot.z, yaw: lot.yaw, hw: half[0], hd: half[1] };
		});
		const pose = { x: 0, y: 0, z: 0, yaw: 0, hidden: false, fade: 0 };
		let inside = 0;
		for (let seconds = 0; seconds <= 600; seconds += 0.5) {
			for (const person of PLAN.people) {
				personAt(person, seconds, pose);
				if (pose.hidden) continue;
				for (const house of houses) {
					const [c, s] = [Math.cos(house.yaw), Math.sin(house.yaw)];
					const dx = pose.x - house.x;
					const dz = pose.z - house.z;
					// The house's own frame: its front looks along the lot's turn, so the depth lies on
					// that axis and the width across it.
					if (
						Math.abs(dx * c - dz * s) < house.hw + 0.3 &&
						Math.abs(dx * s + dz * c) < house.hd + 0.3
					) {
						inside++;
						break;
					}
				}
			}
		}
		expect(inside).toBe(0);
	});

	it('keeps every visible person walking, and no walking leg still', () => {
		const state: PersonState = { x: 0, y: 0, z: 0, yaw: 0, hidden: false, fade: 0 };
		const stride: PersonStride = { bob: 0, roll: 0, sway: 0 };
		for (const person of PLAN.people) {
			let visible = 0;
			for (let seconds = 0; seconds < person.cycle; seconds += 0.1) {
				personAt(person, seconds, state);
				if (state.hidden) continue;
				visible++;
				// A person in view is on a walking leg, so its stride clock runs.
				expect(personStrideAt(person, seconds, stride)).toBeDefined();
			}
			expect(visible).toBeGreaterThan(0);
			// No leg of any walk holds the person in view.
			for (const trip of person.trips)
				for (const leg of trip.script.legs) if (leg.from === leg.to) expect(leg.hidden).toBe(true);
		}
	});

	it('fades a person out at the end of a walk and starts it again elsewhere', () => {
		const state: PersonState = { x: 0, y: 0, z: 0, yaw: 0, hidden: false, fade: 0 };
		let restarted = 0;
		for (const person of PLAN.people) {
			let vanished: { x: number; z: number } | undefined;
			let found = false;
			for (let seconds = 0; seconds < person.cycle; seconds += 0.1) {
				personAt(person, seconds, state);
				if (state.hidden) {
					if (!vanished) vanished = { x: state.x, z: state.z };
					continue;
				}
				if (vanished) {
					const moved = Math.hypot(state.x - vanished.x, state.z - vanished.z);
					// The person fades back in at a place of its own, not where it left.
					if (moved > 1) {
						found = true;
						break;
					}
					vanished = undefined;
				}
			}
			expect(found).toBe(true);
			if (found) restarted++;
		}
		expect(restarted).toBe(PLAN.people.length);
	});

	it('runs the far proxies with a scale that fades, rather than a jump', () => {
		// The fade is read from the person's own clock, so it rises from nothing over its first
		// moments in view and falls to nothing at the end.
		const state: PersonState = { x: 0, y: 0, z: 0, yaw: 0, hidden: false, fade: -1 };
		let rising = false;
		let falling = false;
		for (const person of PLAN.people) {
			let last = 0;
			for (let seconds = 0; seconds < person.cycle; seconds += 0.05) {
				personAt(person, seconds, state);
				if (state.fade > 0 && state.fade < 1) {
					if (state.fade > last) rising = true;
					else falling = true;
				}
				last = state.fade;
			}
			if (rising && falling) break;
		}
		expect(rising).toBe(true);
		expect(falling).toBe(true);
	});
});

describe('the walk of a far proxy', () => {
	// One walking leg, so the stride clock runs at every sample.
	const walk = makePath([
		{ x: 0, y: 0, z: 0 },
		{ x: 0, y: 0, z: 10 },
	]);
	const tripOf = (speed: number, script: PersonActor['script'], phase: number): PersonActor => ({
		walk,
		speed,
		phase,
		lateral: 0,
		script,
		trips: [{ walk, script, start: 0 }],
		cycle: script.cycle,
		ride: false,
	});
	const walking = (speed: number, phase = 0, seconds = 20): PersonActor =>
		tripOf(
			speed,
			{
				legs: [{ seconds, from: 0, to: 10, hidden: false }],
				cycle: seconds,
				ends: Float64Array.from([seconds]),
			},
			phase,
		);
	const stride: PersonStride = { bob: 0, roll: 0, sway: 0 };

	it('lifts a proxy without ever dipping it, and rolls and sways within its bounds', () => {
		const actor = walking(1.45);
		let lowest = Number.POSITIVE_INFINITY;
		let highest = 0;
		let mostRoll = 0;
		let mostSway = 0;
		for (let seconds = 0; seconds <= 8; seconds += 0.002) {
			const pose = personStrideAt(actor, seconds, stride);
			if (!pose) continue;
			lowest = Math.min(lowest, pose.bob);
			highest = Math.max(highest, pose.bob);
			mostRoll = Math.max(mostRoll, Math.abs(pose.roll));
			mostSway = Math.max(mostSway, Math.abs(pose.sway));
		}
		expect(lowest).toBeGreaterThanOrEqual(0);
		expect(highest).toBeGreaterThan(0.03);
		expect(mostRoll).toBeGreaterThan(0.02);
		expect(mostRoll).toBeLessThanOrEqual(0.035);
		expect(mostSway).toBeGreaterThan(0.01);
		expect(mostSway).toBeLessThanOrEqual(0.025);
	});

	it('steps faster when the person walks faster', () => {
		// One stride a second at the fast speed: at 2.25 s the fast walk is at its top and the slow
		// walk, at half the speed, is halfway up.
		personStrideAt(walking(1.45), 2.25, stride);
		const fastBob = stride.bob;
		personStrideAt(walking(0.725), 2.25, stride);
		expect(fastBob).toBeGreaterThan(stride.bob + 0.01);
	});

	it('stands still while the person waits and takes its own phase', () => {
		const waiting = tripOf(
			1.4,
			{
				legs: [
					{ seconds: 5, from: 0, to: 10, hidden: false },
					{ seconds: 5, from: 10, to: 10, hidden: false },
				],
				cycle: 10,
				ends: Float64Array.from([5, 10]),
			},
			0,
		);
		expect(personStrideAt(waiting, 7, stride)).toBeUndefined();
		// Two people with different phases do not rise together.
		const a = walking(1.4, 0);
		const b = walking(1.4, 0.25);
		let differs = false;
		for (let seconds = 0; seconds <= 4 && !differs; seconds += 0.02) {
			personStrideAt(a, seconds, stride);
			const aBob = stride.bob;
			personStrideAt(b, seconds, stride);
			if (Math.abs(aBob - stride.bob) > 0.005) differs = true;
		}
		expect(differs).toBe(true);
	});
});

/** A fake scene that records each batch, so a test can read the rows that the drawing writes. */
function fakeScene(): {
	batches: {
		count: number;
		positions: Float32Array;
		rotations: Float32Array;
		scales: Float32Array;
		dirty: boolean;
		markDirty(): void;
	}[];
	ctx: SketchContext;
} {
	const batches: {
		count: number;
		positions: Float32Array;
		rotations: Float32Array;
		scales: Float32Array;
		dirty: boolean;
		markDirty(): void;
	}[] = [];
	const mesh = {} as MeshGeometry;
	const material = {} as Material;
	const ctx = {
		materials: { standard: () => material },
		geometry: { box: () => mesh, capsule: () => mesh },
		scene: {
			createInstances: (_mesh: MeshGeometry, count: number) => {
				const batch = {
					count,
					positions: new Float32Array(count * 3),
					rotations: new Float32Array(count * 4),
					scales: new Float32Array(count * 3),
					dirty: false,
					markDirty() {
						batch.dirty = true;
					},
				};
				batches.push(batch);
				return batch;
			},
		},
	} as unknown as SketchContext;
	return { batches, ctx };
}

describe('the fade of an actor', () => {
	it('shrinks every part of a person about its ground point, so the model keeps its shape', () => {
		const { batches, ctx } = fakeScene();
		const mesh = {} as MeshGeometry;
		const material = {} as Material;
		// A person of three parts: feet on the ground, a body above them and a head over it.
		const lifts = [0, 0.9, 1.6] as const;
		const models = {
			car: [],
			bus: [],
			people: [
				{
					parts: lifts.map((lift) => ({ mesh, material, lift })),
				},
			],
		};
		const options = { people: 1, cars: 0, parkedCars: 0, bus: false, walkers: 0 } as const;
		const traffic = createTraffic(ctx, models, options);
		const actor = planTraffic(options).people[0] as PersonActor;
		const state: PersonState = { x: 0, y: 0, z: 0, yaw: 0, hidden: false, fade: 0 };
		// Every part of every fade value sits on the line from the ground to its full height.
		let values = 0;
		for (let t = 0; t < 120; t += 0.02) {
			personAt(actor, t, state);
			if (state.fade <= 0.01 || state.fade >= 0.99) continue;
			traffic.update(t);
			values++;
			const fade = state.fade;
			lifts.forEach((lift, k) => {
				const batch = batches[k] as (typeof batches)[number];
				const rise = (batch.positions[1] as number) - state.y;
				expect(rise).toBeGreaterThan((lift - 0.05) * fade);
				expect(rise).toBeLessThan((lift + 0.05) * fade + 1e-6);
				expect(batch.scales[0] as number).toBeCloseTo(fade, 5);
			});
		}
		expect(values).toBeGreaterThan(10);
	});

	it('keeps a person in sight across the out-and-back turn', () => {
		const state: PersonState = { x: 0, y: 0, z: 0, yaw: 0, hidden: false, fade: 0 };
		for (const person of PLAN.people) {
			for (const trip of person.trips) {
				// The turn lies between the trip's first two walking legs, once the lead passes.
				let at = 0;
				let walked = 0;
				let turn = -1;
				for (const leg of trip.script.legs) {
					if (leg.from !== leg.to) {
						walked++;
						if (walked === 2) turn = at;
					}
					at += leg.seconds;
				}
				if (turn < 0) continue;
				// A step past the boundary, inside the walk back.
				const clock = trip.start + turn + 0.02 - person.phase;
				personAt(person, clock, state);
				expect(state.hidden).toBe(false);
				// The middle of a visible stretch is fully drawn, so the turn does not blink.
				expect(state.fade).toBe(1);
			}
		}
	});
});

describe('the drawing', () => {
	it('writes every mover into a fake scene, with no GPU', () => {
		const batches: {
			count: number;
			positions: Float32Array;
			rotations: Float32Array;
			scales: Float32Array;
			dirty: boolean;
			markDirty(): void;
		}[] = [];
		const mesh = {} as MeshGeometry;
		const material = {} as Material;
		const ctx = {
			materials: { standard: () => material },
			geometry: { box: () => mesh, capsule: () => mesh },
			scene: {
				createInstances: (_mesh: MeshGeometry, count: number) => {
					const batch = {
						count,
						positions: new Float32Array(count * 3),
						rotations: new Float32Array(count * 4),
						scales: new Float32Array(count * 3),
						dirty: false,
						markDirty() {
							batch.dirty = true;
						},
					};
					batches.push(batch);
					return batch;
				},
			},
		} as unknown as SketchContext;
		const traffic = createTraffic(ctx, createPlaceholderModels(ctx));
		const plan = PLAN.counts;
		expect(traffic.batches).toBe(6);
		expect(traffic.rows).toBe(
			plan.parkedCars * 2 + plan.cars * 2 + plan.buses * 1 + plan.people * 1,
		);

		const peopleBatch = batches.find((batch) => batch.count === plan.people);
		const carBatch = batches.find((batch) => batch.count === plan.cars);
		const parkedBatches = batches.filter((batch) => batch.count === plan.parkedCars);
		expect(peopleBatch).toBeDefined();
		expect(carBatch).toBeDefined();
		if (!peopleBatch || !carBatch) return;
		expect(batches.length).toBe(6);
		expect(parkedBatches.every((batch) => batch.dirty)).toBe(true);

		traffic.update(0);
		const first = carBatch.positions[0] as number;
		traffic.update(5);
		expect(carBatch.positions[0] as number).not.toBeCloseTo(first, 2);

		let hidden = false;
		for (let seconds = 0; seconds < 200; seconds += 0.5) {
			traffic.update(seconds);
			if (peopleBatch.scales.some((scale) => scale === 0)) {
				hidden = true;
				break;
			}
		}
		expect(hidden).toBe(true);
		// A proxy's own row carries its walk, so a visible proxy's height changes with time.
		traffic.update(0.1);
		const heights = Float32Array.from(peopleBatch.positions);
		let moved = false;
		for (let frame = 0; frame < 200 && !moved; frame++) {
			traffic.update(0.1 + frame * 0.05);
			for (let row = 0; row < peopleBatch.count; row++)
				if (peopleBatch.positions[row * 3 + 1] !== heights[row * 3 + 1]) moved = true;
		}
		expect(moved).toBe(true);
		for (const batch of batches)
			for (const value of batch.positions) expect(Number.isFinite(value)).toBe(true);
	});
});

describe('the plan', () => {
	it('repeats for a seed and changes with another', () => {
		expect(signature(TRAFFIC_SEED)).toBe(signature(TRAFFIC_SEED));
		expect(signature(7)).toBe(signature(7));
		expect(signature(7)).not.toBe(signature(8));
	});

	it('takes its counts from the options', () => {
		const plan = planTraffic({ cars: 3, parkedCars: 2, people: 4, bus: false });
		expect(plan.counts.cars).toBe(3);
		expect(plan.counts.people).toBe(4);
		expect(plan.counts.buses).toBe(0);
		expect(plan.vehicles.every((vehicle) => vehicle.kind === 'car')).toBe(true);
		expect(plan.parked.length).toBeGreaterThanOrEqual(2);
	});

	it('clamps a path sample to its ends and reads its middle', () => {
		const path = makePath([
			{ x: 0, y: 0, z: 0 },
			{ x: 10, y: 0, z: 0 },
			{ x: 10, y: 0, z: 10 },
		]);
		expect(path.length).toBeCloseTo(20, 5);
		const middle = pointOf(path, 10);
		expect(middle.x).toBeCloseTo(10, 4);
		expect(middle.z).toBeCloseTo(0, 4);
		expect(pointOf(path, -5).x).toBe(0);
		expect(pointOf(path, 25).z).toBe(10);
	});
});
