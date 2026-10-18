// Hover traffic above the field: four lanes of cars that stream across the sky at different heights
// and headings. Each car is a row of two instance batches, a body and a tail light strip, and the
// sketch writes every row from the time alone, so a held frame draws the same cars on every run.
import { quat, type SketchContext } from '@null3d/engine';

/** Each lane: its heading in radians, its height, its cars, and its sideways offset in meters. */
const LANES = [
	[Math.PI / 2, 17, 180, -55],
	[-Math.PI / 2, 20, 180, -75],
	[0, 19, 180, -45],
	[Math.PI, 22, 180, 55],
] as const;
/** How far a lane runs before its cars wrap, in meters, and how fast they fly. */
const REACH = 120;
const SPEED = 22;
/** The files of cars across each lane, and the space between them. */
const FILES = 3;
const GAP = 2.4;

export function createTraffic(ctx: SketchContext) {
	const { scene, geometry, materials } = ctx;
	const count = LANES.reduce((rows, lane) => rows + lane[2], 0);
	const body = scene.createInstances(
		geometry.box({ width: 1.4, height: 0.38, depth: 2.4 }),
		count,
		{
			material: materials.standard({ color: '#2c3a52', metalness: 0.65, roughness: 0.32 }),
			dynamic: true,
		},
	);
	const lamp = materials.standard({
		color: '#000000',
		emissive: '#ff5a3c',
		emissiveIntensity: 9,
	});
	const tail = scene.createInstances(
		geometry.box({ width: 1.1, height: 0.09, depth: 0.08 }),
		count,
		{ material: lamp, dynamic: true },
	);
	const turn = quat.create();
	const up = [0, 1, 0] as const;
	return {
		/** Writes each car's place along its lane, and its tail lights behind it. */
		update(t: number) {
			const places = body.positions;
			const turns = body.rotations;
			const lights = tail.positions;
			const tails = tail.rotations;
			let row = 0;
			for (const [heading, height, cars, offset] of LANES) {
				const dx = Math.sin(heading);
				const dz = Math.cos(heading);
				quat.setAxisAngle(turn, up, heading);
				for (let i = 0; i < cars; i++) {
					const file = (i % FILES) - (FILES - 1) / 2;
					const side = file * GAP + offset;
					const run = (((i / cars) * 2 * REACH + SPEED * t) % (2 * REACH)) - REACH;
					const x = dx * run + dz * side;
					const z = dz * run - dx * side;
					places[row * 3] = x;
					places[row * 3 + 1] = height;
					places[row * 3 + 2] = z;
					turns.set(turn, row * 4);
					lights[row * 3] = x - dx * 1.26;
					lights[row * 3 + 1] = height;
					lights[row * 3 + 2] = z - dz * 1.26;
					tails.set(turn, row * 4);
					row++;
				}
			}
		},
	};
}
