// The night town's props: the well at the square's middle, two market stalls, barrels and crates
// along the walls, benches, a hand cart, a pile of logs, sacks and snowmen. Everything is made in
// code from the engine's shape generators, in a few instance batches, and the snow lies on it all.
import { type MeshGeometry, quat, type SketchContext } from '@null3d/engine';
import { random } from '../../lib/procedural';
import { groundHeight } from './land';

/** A prop's place: its middle, its turn about y and its size. */
interface Spot {
	x: number;
	z: number;
	yaw: number;
	size: number;
}

/** Places props in a ring around the square's middle, kept clear of the roads and the houses. */
function around(
	next: () => number,
	count: number,
	inner: number,
	outer: number,
	clear: (x: number, z: number) => boolean,
): Spot[] {
	const spots: Spot[] = [];
	for (let k = 0; k < count * 12 && spots.length < count; k++) {
		const a = next() * Math.PI * 2;
		const r = inner + (outer - inner) * next();
		const x = Math.cos(a) * r;
		const z = Math.sin(a) * r;
		if (clear(x, z)) continue;
		spots.push({ x, z, yaw: next() * Math.PI * 2, size: 0.9 + 0.25 * next() });
	}
	return spots;
}

/** Adds an instance batch of `mesh` at each spot, standing on the ground. */
function place(
	{ scene }: Pick<SketchContext, 'scene'>,
	mesh: MeshGeometry,
	material: ReturnType<SketchContext['materials']['standard']>,
	spots: readonly Spot[],
	lift = 0,
): void {
	const batch = scene.createInstances(mesh, spots.length, {
		material,
		castShadows: true,
		receiveShadows: true,
	});
	spots.forEach((s, k) => {
		batch.positions.set([s.x, groundHeight(s.x, s.z) + lift * s.size, s.z], k * 3);
		batch.rotations.set(quat.fromEuler(quat.create(), 0, s.yaw, 0), k * 4);
		batch.scales.set([s.size, s.size, s.size], k * 3);
	});
	batch.markDirty();
}

/** The town's props, with a test of whether a point is kept clear of them. */
export function createProps(
	{ scene, geometry, materials }: SketchContext,
	clear: (x: number, z: number) => boolean,
): { clear(x: number, z: number): boolean } {
	const next = random(131);
	const wood = materials.standard({ color: '#4a3320', roughness: 0.85 });
	const timber = materials.standard({ color: '#6b4a28', roughness: 0.8 });
	const iron = materials.standard({ color: '#20222a', roughness: 0.5, metalness: 0.6 });
	const canvas = materials.standard({ color: '#7a2b24', roughness: 0.9, doubleSided: true });
	const snowCap = materials.standard({ color: '#eef2fb', roughness: 0.9 });

	// The well: a stone curb, a rim, two posts and a little roof, with a bucket on its rope.
	const well = [0, 0] as const;
	const wy = groundHeight(well[0], well[1]);
	scene.createMesh({
		mesh: geometry.cylinder({
			radiusTop: 0.95,
			radiusBottom: 1.1,
			height: 0.95,
			radialSegments: 14,
			openEnded: true,
		}),
		material: materials.standard({ color: '#5b5750', roughness: 0.95 }),
		position: [well[0], wy + 0.47, well[1]],
		castShadows: true,
		receiveShadows: true,
	});
	const rim = scene.createInstances(
		geometry.torus({ radius: 1.0, tube: 0.12, radialSegments: 8, tubularSegments: 16 }),
		1,
		{
			material: materials.standard({ color: '#6c6862', roughness: 0.95 }),
			castShadows: true,
			receiveShadows: true,
		},
	);
	rim.positions.set([well[0], wy + 0.97, well[1]], 0);
	rim.rotations.set(quat.fromEuler(quat.create(), Math.PI / 2, 0, 0), 0);
	rim.markDirty();
	// The posts and the roof over the well.
	for (const side of [-1, 1]) {
		scene.createMesh({
			mesh: geometry.box({ width: 0.16, height: 2.2, depth: 0.16 }),
			material: timber,
			position: [well[0] + side * 0.85, wy + 2.0, well[1]],
			castShadows: true,
		});
	}
	for (const side of [-1, 1]) {
		scene.createMesh({
			mesh: geometry.box({ width: 2.6, height: 0.1, depth: 1.5 }),
			material: wood,
			position: [well[0], wy + 3.0, well[1] + side * 0.45],
			rotation: quat.fromEuler(quat.create(), side * 0.6, 0, 0),
			castShadows: true,
			receiveShadows: true,
		});
		scene.createMesh({
			mesh: geometry.box({ width: 2.6, height: 0.12, depth: 1.5 }),
			material: snowCap,
			position: [well[0], wy + 3.16, well[1] + side * 0.45],
			rotation: quat.fromEuler(quat.create(), side * 0.6, 0, 0),
			castShadows: true,
			receiveShadows: true,
		});
	}
	const bucket = scene.createInstances(
		geometry.cylinder({
			radiusTop: 0.22,
			radiusBottom: 0.18,
			height: 0.34,
			radialSegments: 10,
			openEnded: true,
		}),
		1,
		{ material: wood, castShadows: true },
	);
	bucket.positions.set([well[0], wy + 1.5, well[1]], 0);
	bucket.markDirty();

	// Two market stalls beside the square, with a canvas awning on four posts.
	for (const [sx, sz, yaw] of [
		[-5.4, -2.6, 0.5],
		[5.4, 2.6, -0.5 + Math.PI],
	] as const) {
		const y = groundHeight(sx, sz);
		scene.createMesh({
			mesh: geometry.box({ width: 3.2, height: 1.0, depth: 1.4 }),
			material: timber,
			position: [sx, y + 0.5, sz],
			rotation: quat.fromEuler(quat.create(), 0, yaw, 0),
			castShadows: true,
			receiveShadows: true,
		});
		scene.createMesh({
			mesh: geometry.box({ width: 3.6, height: 0.12, depth: 1.8 }),
			material: canvas,
			position: [sx, y + 2.5, sz],
			rotation: quat.fromEuler(quat.create(), 0, yaw, 0),
			castShadows: true,
		});
		for (const side of [-1, 1])
			for (const end of [-1, 1]) {
				const cos = Math.cos(yaw);
				const sin = Math.sin(yaw);
				const lx = side * 1.7;
				const lz = end * 0.8;
				scene.createMesh({
					mesh: geometry.box({ width: 0.1, height: 2.6, depth: 0.1 }),
					material: wood,
					position: [sx + lx * cos + lz * sin, y + 1.3, sz - lx * sin + lz * cos],
					castShadows: true,
				});
			}
	}
	// Crates of wares on and beside the stalls.
	place(
		{ scene },
		geometry.box({ width: 0.5, height: 0.4, depth: 0.5 }),
		wood,
		[
			{ x: -5.4, z: -2.6, yaw: 0.5, size: 1 },
			{ x: -4.4, z: -3.1, yaw: 1.1, size: 1.1 },
			{ x: 5.4, z: 2.6, yaw: -0.5, size: 1 },
			{ x: 4.4, z: 3.1, yaw: 0.8, size: 0.9 },
		],
		1.0,
	);

	// Barrels, crates, benches, sacks and a log pile around the square.
	place(
		{ scene },
		geometry.cylinder({ radiusTop: 0.36, radiusBottom: 0.3, height: 0.9, radialSegments: 12 }),
		wood,
		around(next, 9, 4.5, 8.5, clear),
		0.45,
	);
	place(
		{ scene },
		geometry.box({ width: 0.7, height: 0.7, depth: 0.7 }),
		timber,
		around(next, 7, 5, 9, clear),
		0.35,
	);
	place(
		{ scene },
		geometry.sphere({ radius: 0.45, widthSegments: 10, heightSegments: 6 }),
		canvas,
		around(next, 5, 5.5, 8.5, clear),
		0.4,
	);

	// Benches: a plank on two legs, facing the square.
	const benchMesh = geometry.box({ width: 2.2, height: 0.12, depth: 0.55 });
	for (const [bx, bz, yaw] of [
		[-4.5, 6.5, 0.2],
		[4.5, -6.5, Math.PI - 0.2],
		[7.5, 3.4, -1.4],
	] as const) {
		const y = groundHeight(bx, bz);
		scene.createMesh({
			mesh: benchMesh,
			material: wood,
			position: [bx, y + 0.55, bz],
			rotation: quat.fromEuler(quat.create(), 0, yaw, 0),
			castShadows: true,
			receiveShadows: true,
		});
		for (const side of [-1, 1])
			scene.createMesh({
				mesh: geometry.box({ width: 0.14, height: 0.56, depth: 0.5 }),
				material: wood,
				position: [bx + side * 0.85 * Math.cos(yaw), y + 0.28, bz - side * 0.85 * Math.sin(yaw)],
				rotation: quat.fromEuler(quat.create(), 0, yaw, 0),
				castShadows: true,
			});
	}

	// Snowmen: three balls, a coal grin, a carrot and stick arms.
	for (const [mx, mz] of [
		[7.2, -7.2],
		[-7.4, 7.0],
	] as const) {
		const y = groundHeight(mx, mz);
		const balls = [
			{ r: 0.62, y: 0.62 },
			{ r: 0.46, y: 1.5 },
			{ r: 0.32, y: 2.2 },
		];
		for (const b of balls)
			scene.createMesh({
				mesh: geometry.sphere({ radius: b.r, widthSegments: 12, heightSegments: 8 }),
				material: snowCap,
				position: [mx, y + b.y, mz],
				castShadows: true,
				receiveShadows: true,
			});
		scene.createMesh({
			mesh: geometry.cone({ radius: 0.06, height: 0.28, radialSegments: 6 }),
			material: materials.standard({ color: '#b5561d', roughness: 0.7 }),
			position: [mx, y + 2.24, mz + 0.32],
			rotation: quat.fromEuler(quat.create(), Math.PI / 2, 0, 0),
			castShadows: true,
		});
		for (const side of [-1, 1]) {
			scene.createMesh({
				mesh: geometry.box({ width: 0.05, height: 0.6, depth: 0.05 }),
				material: timber,
				position: [mx + side * 0.5, y + 1.7, mz],
				rotation: quat.fromEuler(quat.create(), 0, 0, side * 1.1),
				castShadows: true,
			});
			for (const e of [-0.12, 0.12])
				scene.createMesh({
					mesh: geometry.sphere({ radius: 0.045, widthSegments: 6, heightSegments: 4 }),
					material: iron,
					position: [mx + e, y + 2.3, mz + 0.27],
					castShadows: false,
				});
		}
	}

	// A hand cart, tipped up by a wall.
	const cartAt = { x: -8.4, z: -5.5 };
	const cy = groundHeight(cartAt.x, cartAt.z);
	scene.createMesh({
		mesh: geometry.box({ width: 2.4, height: 0.5, depth: 1.2 }),
		material: wood,
		position: [cartAt.x, cy + 0.8, cartAt.z],
		rotation: quat.fromEuler(quat.create(), 0.1, -0.6, 0),
		castShadows: true,
		receiveShadows: true,
	});
	for (const side of [-1, 1]) {
		const wheel = scene.createInstances(
			geometry.cylinder({ radiusTop: 0.55, radiusBottom: 0.55, height: 0.14, radialSegments: 14 }),
			1,
			{ material: timber, castShadows: true },
		);
		wheel.positions.set(
			[cartAt.x + side * 0.5 * Math.cos(-0.6), cy + 0.55, cartAt.z - side * 0.5 * Math.sin(-0.6)],
			0,
		);
		wheel.rotations.set(quat.fromEuler(quat.create(), 0, -0.6, Math.PI / 2), 0);
		wheel.markDirty();
	}

	// Keep trees clear of the props' places.
	const kept: Spot[] = [
		{ x: well[0], z: well[1], yaw: 0, size: 1.6 },
		{ x: -5.4, z: -2.6, yaw: 0, size: 2.2 },
		{ x: 5.4, z: 2.6, yaw: 0, size: 2.2 },
		{ x: cartAt.x, z: cartAt.z, yaw: 0, size: 1.6 },
	];
	return {
		clear: (x, z) => kept.some((s) => (x - s.x) ** 2 + (z - s.z) ** 2 < s.size * s.size),
	};
}
