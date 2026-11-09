// A small hand-built tree for the wood mesher's tests: a flared stem that forks at its top, limbs
// that leave at steep, level and shallow angles, a limb as thick as its parent, twigs on a limb and
// a crooked limb. It is plain skeleton data, so the tests need no grower, and measures of the weld,
// the bark's density and the continuity of `v` from parent to child run on it.

import type { MacroSkeleton } from '../core/graph';
import { AXIS_LIMB, AXIS_STEM, NODE_FORK, SkeletonBuilder } from '../core/graph';
import { cos, radians, sin } from '../core/math';
import { emptyRows } from '../core/placeholder';
import type { Species } from '../core/record';
import { standInRecord } from '../core/stand-in';
import type { TextureManifest } from '../core/textures';
import type { Detail } from '../core/types';
import type { MeshInput } from '../stages';

/** The test record: the stand-in broadleaf with an oak's foot, collar and girth scale. */
export function testRecord(): Species {
	const record = standInRecord('wood-test', { height: 14, dbh: 0.9, aspect: 1.3 });
	return {
		...record,
		bark: {
			zones: [{ layer: 0, by: 'height', from: -10, to: 100, blend: 0 }],
			young: 0,
			youngRadius: 0.015,
			girthScale: [
				[0, 0.25],
				[0.2, 0.55],
				[1, 1],
			],
			displacement: 0.02,
			collar: { swell: 0.2, length: 1.5, ridge: 0.6 },
		},
		base: {
			flare: { amount: 0.6, height: 0.35 },
			buttress: { lobes: { mean: 5, spread: 1 }, amount: 0.35, sharpness: 2, height: 0.5 },
			roots: {
				count: { mean: 4, spread: 1 },
				length: { mean: 1.4, spread: 0.4 },
				radius: 0.09,
				dive: 0.25,
			},
		},
	};
}

/** A manifest with one bark layer of a half-metre tile and a young tile of 12 cm. */
export function testManifest(): TextureManifest {
	return {
		format: 1,
		species: 'wood-test',
		source: { repository: 'null3d-engine/plant-references', commit: '', files: [] },
		tool: { version: '', encoder: '' },
		bark: {
			size: 1024,
			layers: [
				{
					name: 'trunk',
					tile: [0.5, 0.5],
					mean: [0.2, 0.18, 0.15],
					height: { offset: 0.3, depth: 0.03 },
				},
			],
			young: { tile: [0.12, 0.12], mean: [0.3, 0.3, 0.27] },
		},
		outputs: [],
	};
}

/** Adds a straight or bending limb of `steps` nodes and returns its axis and nodes. */
function limb(
	builder: SkeletonBuilder,
	parentAxis: number,
	parentNode: number,
	order: number,
	from: readonly [number, number, number],
	direction: readonly [number, number, number],
	length: number,
	r0: number,
	r1: number,
	steps: number,
	bend = 0,
): { axis: number; nodes: number[] } {
	const axis = builder.addAxis({
		parent: parentAxis,
		parentNode,
		parentT: 0,
		order,
		kind: AXIS_LIMB,
	});
	const nodes: number[] = [];
	let previous = parentNode;
	for (let k = 1; k <= steps; k++) {
		const t = k / steps;
		const crook = bend * sin(t * 7.3) * length * 0.04;
		previous = builder.addNode({
			x: from[0] + direction[0] * length * t + crook,
			y: from[1] + direction[1] * length * t - bend * t * t * length * 0.1,
			z: from[2] + direction[2] * length * t - crook,
			radius: r0 + (r1 - r0) * t,
			parent: previous,
			axis,
		});
		nodes.push(previous);
	}
	return { axis, nodes };
}

/** The unit direction at an elevation above level and an azimuth. */
function heading(elevation: number, azimuth: number): [number, number, number] {
	const e = radians(elevation);
	const a = radians(azimuth);
	return [cos(e) * cos(a), sin(e), cos(e) * sin(a)];
}

/** The test tree's skeleton. */
export function testSkeleton(): MacroSkeleton {
	const builder = new SkeletonBuilder();
	const stem = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
	const stemNodes: number[] = [];
	const height = 5;
	for (let k = 0; k <= 10; k++) {
		const y = (k / 10) * height;
		stemNodes.push(
			builder.addNode({
				x: 0.05 * sin(k * 0.7),
				y,
				z: 0.04 * cos(k * 0.9),
				radius: 0.45 - 0.17 * (k / 10),
				parent: k === 0 ? -1 : (stemNodes[k - 1] as number),
				axis: stem,
				flags: k === 10 ? NODE_FORK : 0,
			}),
		);
	}
	const at = (n: number): [number, number, number] => [
		builder.position[n * 3] as number,
		builder.position[n * 3 + 1] as number,
		builder.position[n * 3 + 2] as number,
	];
	// Limbs at a steep, a level and a shallow angle.
	const level = limb(
		builder,
		stem,
		stemNodes[3] as number,
		1,
		at(stemNodes[3] as number),
		heading(5, 0),
		3,
		0.14,
		0.05,
		6,
		1,
	);
	limb(
		builder,
		stem,
		stemNodes[5] as number,
		1,
		at(stemNodes[5] as number),
		heading(55, 140),
		2.5,
		0.1,
		0.03,
		5,
	);
	limb(
		builder,
		stem,
		stemNodes[6] as number,
		1,
		at(stemNodes[6] as number),
		heading(75, 250),
		2,
		0.08,
		0.025,
		5,
	);
	// A limb as thick as the stem there.
	limb(
		builder,
		stem,
		stemNodes[8] as number,
		1,
		at(stemNodes[8] as number),
		heading(35, 320),
		3,
		0.3,
		0.1,
		6,
	);
	// Twigs on the level limb, one of them barely thicker than a pencil.
	for (let k = 1; k < 5; k++) {
		const node = level.nodes[k] as number;
		limb(
			builder,
			level.axis,
			node,
			2,
			at(node),
			heading(40 - k * 5, k * 70 + 30),
			0.8,
			0.035 - k * 0.006,
			0.006,
			4,
		);
	}
	// The fork: the stem ends and two leaders go on.
	const top = stemNodes[10] as number;
	limb(builder, stem, top, 1, at(top), heading(60, 30), 3, 0.2, 0.08, 6, 0.5);
	limb(builder, stem, top, 1, at(top), heading(65, 210), 3, 0.19, 0.07, 6, 0.5);
	return builder.finish(2);
}

/**
 * A tree of an old oak's size and branching for the mesher's budget and bark tests: a short bole
 * of 1.1 m across that forks into three leaders, then three macro orders of crooked limbs, about a
 * thousand axes, with the pipe model's radii.
 */
export function testOak(): MacroSkeleton {
	const builder = new SkeletonBuilder();
	const stem = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
	const stemNodes: number[] = [];
	for (let k = 0; k <= 6; k++)
		stemNodes.push(
			builder.addNode({
				x: 0.06 * sin(k * 1.3),
				y: k * 0.6,
				z: 0.05 * cos(k * 1.1),
				radius: 0.55 - 0.08 * (k / 6),
				parent: k === 0 ? -1 : (stemNodes[k - 1] as number),
				axis: stem,
				flags: k === 6 ? NODE_FORK : 0,
			}),
		);
	let key = 1;
	const unit = () => {
		key++;
		return (Math.imul(key, 0x9e3779b1) >>> 0) / 0x100000000;
	};
	const grow = (
		parentAxis: number,
		parentNode: number,
		order: number,
		direction: [number, number, number],
		length: number,
		radius: number,
	): void => {
		const steps = order === 1 ? 7 : order === 2 ? 5 : 4;
		const axis = builder.addAxis({
			parent: parentAxis,
			parentNode,
			parentT: 0,
			order,
			kind: AXIS_LIMB,
		});
		let previous = parentNode;
		let x = builder.position[parentNode * 3] as number;
		let y = builder.position[parentNode * 3 + 1] as number;
		let z = builder.position[parentNode * 3 + 2] as number;
		const d = [...direction];
		const nodes: number[] = [];
		for (let k = 1; k <= steps; k++) {
			// Crooked growth: each internode turns a little and droops with its order.
			d[0] = (d[0] as number) + (unit() - 0.5) * 0.5;
			d[1] = (d[1] as number) + (unit() - 0.5) * 0.4 - 0.04 * order;
			d[2] = (d[2] as number) + (unit() - 0.5) * 0.5;
			const l = Math.hypot(d[0] as number, d[1] as number, d[2] as number);
			const step = length / steps;
			x += ((d[0] as number) / l) * step;
			y += ((d[1] as number) / l) * step;
			z += ((d[2] as number) / l) * step;
			previous = builder.addNode({
				x,
				y,
				z,
				radius: Math.max(0.004, radius * (1 - 0.6 * (k / steps))),
				parent: previous,
				axis,
			});
			nodes.push(previous);
		}
		if (order >= 3) return;
		for (let k = 0; k < nodes.length - 1; k++) {
			const node = nodes[k] as number;
			const azimuth = unit() * 360;
			const child = heading(order === 1 ? 15 + unit() * 30 : unit() * 50 - 10, azimuth);
			const r = (builder.radius[node] as number) * (0.35 + unit() * 0.25);
			grow(axis, node, order + 1, child, length * (0.45 + unit() * 0.2), r);
		}
	};
	const top = stemNodes[6] as number;
	for (let k = 0; k < 3; k++) grow(stem, top, 1, heading(40 + k * 8, k * 120 + 20), 9, 0.3);
	return builder.finish(3);
}

/** The test tree dressed for the mesher, with no shoots and an open crown. */
export function testMeshInput(detail: Detail = 'high', skeleton = testSkeleton()): MeshInput {
	const record = testRecord();
	const manifest = testManifest();
	const { min, max } = skeleton.bounds;
	return {
		record,
		seed: 7,
		variant: 0,
		season: 'summer',
		kit: {
			record,
			manifest,
			key: 'wood-test',
			detail,
			prototypes: [],
			leaves: [],
			cards: { size: 0, color: new Uint8Array(0), surface: new Uint8Array(0) },
			header: new Float32Array(0),
			box: { min: [-10, -2, -10], max: [10, 18, 10] },
			placeholders: false,
		},
		skeleton,
		rows: emptyRows(),
		crown: {
			cells: [1, 1, 1],
			min,
			cell: Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]),
			sky: new Float32Array([1]),
		},
		detail,
	};
}
