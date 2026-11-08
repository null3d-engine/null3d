// The crown-rosette grower: one stem crowned by a golden-angle spiral of fronds, for palms and tree
// ferns. The stem carries the growing point at its top. Each frond is a stipe that leaves that point
// at its age's tilt, and a rachis that runs on from the stipe's top, drooping by the record's curve
// and coiling toward its upper face while it is still rolled. Each pinna leaves the rachis at its
// angle as an axis of its own with a terminal bud, so a close review cuts one pinna as a piece and
// the frond keeps its foliage wherever it is cut.
//
// A frond's age runs from 0, a crozier just risen, through 0.5, mature, to 1, brown and dead. The
// living fronds stand by age from the youngest inside to the oldest at the rim, and the dead ones
// hang below them as the skirt that a tree fern keeps.
//
// The foliage draws each pinna as the species' leaf over its own axis: the flat blade from the
// leaf's texture and shape, carried into space on the pinna's frame. Its second coordinates are the
// share along the pinna and how brown it is, as the frond foliage's are, so the material browns a
// dead frond as it browns a dead frond of bracken.

import type { MeshArrays } from '../asset';
import {
	AXIS_LIMB,
	AXIS_RACHIS,
	AXIS_STEM,
	AXIS_STIPE,
	BUD_TERMINAL,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../core/graph';
import { unitAt } from '../core/hash';
import {
	cos,
	cross3,
	normalize3,
	PI,
	quatFromFrame,
	quatRotate,
	radians,
	sin,
	type Vector3,
} from '../core/math';
import type { CrownRosette, FrondShape, Species } from '../core/record';
import { curveAt, DETAILS, type Detail, spreadAt, spreadMean } from '../core/types';
import { frondAge, MATURE_AGE, pinnaPlaces, rachisCurve } from '../leaf/frond';
import { bladeMesh, outlineOf } from '../leaf/leaf-mesh';
import { MeshWriter } from '../leaf/writer';
import type { GrowInput, MeshInput, MeshLevel } from '../stages';
import { type AxisPath, axisPath, emptyFrame, frameAt, type PathFrame } from '../wood/frames';
import { axisBytes, skyByte } from './ground';
import type { Grower } from './models';

/** Draw purposes, so no two draws share a key. */
const DRAW = {
	stemHeight: 1,
	stemLean: 2,
	stemTurn: 3,
	stemCurve: 4,
	fronds: 5,
	dead: 6,
	croziers: 7,
	start: 8,
	tilt: 9,
	age: 10,
	length: 11,
} as const;

/** Metres between a stem's nodes. */
const STEM_NODE = 0.15;
/** Metres between a stipe's nodes. */
const STIPE_NODE = 0.06;
/** The thinnest wood gets, in metres of radius. */
const THINNEST = 0.0004;
/** The size a crozier rises at, as a share of its mature size. */
const YOUNG_SIZE = 0.32;
/** The rachis's radius at its top, as a share of its radius at its base. */
const RACHIS_TAPER = 0.25;
/** A pinna's radius at its tip, as a share of its radius at its base. */
const PINNA_TAPER = 0.2;
/** Nodes along one pinna's midrib. */
const PINNA_NODES = 3;

/** The record's crown-rosette growth, or a fault for another model. */
function rosetteOf(record: Species): CrownRosette {
	if (record.growth.model !== 'crown-rosette')
		throw new Error(
			`@null3d/vegetation: the crown-rosette grower got a '${record.growth.model}' record`,
		);
	return record.growth;
}

/** The frond with its droop turned the other way, for the fronds that hang below the crown. */
function hanging(shape: FrondShape): FrondShape {
	if (typeof shape.droop === 'number') return { ...shape, droop: -shape.droop };
	return { ...shape, droop: shape.droop.map(([t, v]) => [t, -v] as const) };
}

/** One frond's place in the crown before its axes are laid. */
interface FrondPlan {
	/** Radians round the stem. */
	readonly azimuth: number;
	/** Degrees from vertical. */
	readonly tilt: number;
	/** The age its buds carry: 0 a crozier, 0.5 mature, 1 dead. */
	readonly age: number;
	/** Whether the frond hangs below the crown as part of the skirt. */
	readonly dead: boolean;
	/** Its size over a mature frond's. */
	readonly size: number;
}

/**
 * The fronds of the crown: the living ones from the youngest inside to the oldest at the rim, the
 * croziers among the youngest, and the dead ones hanging below them.
 */
function frondPlans(input: GrowInput, growth: CrownRosette): FrondPlan[] {
	const { crown } = growth;
	const salt = input.record.seedSalt >>> 0;
	const draw = (purpose: number, index = 0) =>
		unitAt(input.seed, salt, input.variant, purpose, index);
	const live = Math.max(1, Math.round(spreadAt(crown.fronds, draw(DRAW.fronds))));
	const dead = Math.max(0, Math.round(spreadAt(crown.dead.count, draw(DRAW.dead))));
	const croziers = Math.max(0, Math.round(spreadAt(crown.croziers ?? 0, draw(DRAW.croziers))));
	let turn = draw(DRAW.start) * 2 * PI;
	const plans: FrondPlan[] = [];
	const put = (tilt: number, age: number, isDead: boolean) => {
		turn += radians(crown.divergence);
		const size = YOUNG_SIZE + (1 - YOUNG_SIZE) * frondAge(age).unrolled;
		plans.push({ azimuth: turn, tilt, age, dead: isDead, size });
	};
	for (let c = 0; c < croziers; c++)
		put(6 + 12 * draw(DRAW.tilt, c), 0.03 + 0.13 * draw(DRAW.age, c), false);
	for (let j = 0; j < live; j++) {
		const share = live === 1 ? 0.5 : j / (live - 1);
		put(curveAt(crown.tilt, share), MATURE_AGE * (0.62 + 0.38 * share), false);
	}
	for (let d = 0; d < dead; d++) {
		const share = 0.35 + 0.65 * draw(DRAW.age, d + 64);
		put(95 + Math.abs(crown.dead.hang) * share, 0.55 + 0.4 * draw(DRAW.age, d + 128), true);
	}
	return plans;
}

/** A node's point, from a builder still growing. */
function nodePoint(builder: SkeletonBuilder, node: number): Vector3 {
	return [
		builder.position[node * 3] as number,
		builder.position[node * 3 + 1] as number,
		builder.position[node * 3 + 2] as number,
	];
}

/** Where a frond's blade reaches: outward, made square to the rachis's first direction. */
function lowerFace(direction: Vector3, azimuth: number): Vector3 {
	const outward: Vector3 = [cos(azimuth), 0, sin(azimuth)];
	const dot = outward[0] * direction[0] + outward[1] * direction[1] + outward[2] * direction[2];
	const out: Vector3 = [
		outward[0] - dot * direction[0],
		outward[1] - dot * direction[1],
		outward[2] - dot * direction[2],
	];
	if (out[0] * out[0] + out[1] * out[1] + out[2] * out[2] < 1e-12)
		return [cos(azimuth), 0, sin(azimuth)];
	return normalize3(out);
}

/** Lays one frond's stipe, rachis and pinnae on the skeleton, from the crown point. */
function layFrond(
	builder: SkeletonBuilder,
	input: GrowInput,
	growth: CrownRosette,
	plan: FrondPlan,
	index: number,
	crownNode: number,
	stemAxis: number,
): void {
	const { seed, variant } = input;
	const salt = input.record.seedSalt >>> 0;
	const draw = (purpose: number, at: number) => unitAt(seed, salt, variant, purpose, at);
	const foliage = input.record.foliage;
	if (foliage.kind !== 'blade')
		throw new Error(
			`@null3d/vegetation: the crown-rosette grower's fronds need 'blade' foliage, not '${foliage.kind}'`,
		);
	const shape = plan.dead ? hanging(growth.frond) : growth.frond;
	const age = frondAge(plan.age);
	const tilt = radians(plan.tilt);
	const direction: Vector3 = [
		sin(tilt) * cos(plan.azimuth),
		cos(tilt),
		sin(tilt) * sin(plan.azimuth),
	];
	const lower = lowerFace(direction, plan.azimuth);
	const crown = nodePoint(builder, crownNode);
	const stipeLength = Math.max(0.02, shape.petiole.length * (0.5 + 0.5 * plan.size));
	const stipeRadius = Math.max(shape.petiole.width / 2, THINNEST);
	const stipeAxis = builder.addAxis({
		parent: stemAxis,
		parentNode: crownNode,
		order: 1,
		kind: AXIS_STIPE,
	});
	const stipeSteps = Math.max(1, Math.ceil(stipeLength / STIPE_NODE));
	let previous = crownNode;
	let sx = crown[0];
	let sy = crown[1];
	let sz = crown[2];
	for (let n = 1; n <= stipeSteps; n++) {
		sx += (direction[0] * stipeLength) / stipeSteps;
		sy += (direction[1] * stipeLength) / stipeSteps;
		sz += (direction[2] * stipeLength) / stipeSteps;
		previous = builder.addNode({
			x: sx,
			y: sy,
			z: sz,
			radius: stipeRadius * (1 - 0.15 * (n / stipeSteps)),
			parent: previous,
			axis: stipeAxis,
		});
	}
	const stipeTop = previous;
	const bladeLength = Math.max(0.05, spreadAt(shape.length, draw(DRAW.length, index)) * plan.size);
	const curve = rachisCurve(shape, age, bladeLength);
	const rachisAxis = builder.addAxis({
		parent: stipeAxis,
		parentNode: stipeTop,
		parentT: 0,
		order: 2,
		kind: AXIS_RACHIS,
	});
	const baseRadius = Math.max(stipeRadius * 0.75, THINNEST);
	const points = curve.length / 3;
	const rachisPoints: number[] = [];
	const rachisRadii: number[] = [];
	let rachisNode = stipeTop;
	let rachisFirst = -1;
	for (let i = 1; i < points; i++) {
		const share = i / (points - 1);
		const along = curve[i * 3] as number;
		const across = curve[i * 3 + 1] as number;
		const radius = Math.max(THINNEST, baseRadius * (1 - (1 - RACHIS_TAPER) * share));
		rachisNode = builder.addNode({
			x: sx + direction[0] * along + lower[0] * across,
			y: sy + direction[1] * along + lower[1] * across,
			z: sz + direction[2] * along + lower[2] * across,
			radius,
			parent: rachisNode,
			axis: rachisAxis,
		});
		if (rachisFirst < 0) rachisFirst = rachisNode;
		rachisPoints.push(
			builder.position[rachisNode * 3] as number,
			builder.position[rachisNode * 3 + 1] as number,
			builder.position[rachisNode * 3 + 2] as number,
		);
		rachisRadii.push(radius);
	}
	if (rachisFirst < 0 || rachisRadii.length < 2) return;
	const bend = curve[2] as number;
	const upper: Vector3 = normalize3([
		direction[0] * sin(bend) - lower[0] * cos(bend),
		direction[1] * sin(bend) - lower[1] * cos(bend),
		direction[2] * sin(bend) - lower[2] * cos(bend),
	]);
	const path = axisPath(
		new Float64Array(rachisPoints),
		new Float64Array(rachisRadii),
		rachisRadii.length,
		upper,
	);
	layPinnae(builder, input, growth, plan, path, rachisAxis, rachisFirst, rachisNode);
}

/** Lays one frond's pinnae along its rachis path, each as an axis with a terminal bud. */
function layPinnae(
	builder: SkeletonBuilder,
	input: GrowInput,
	growth: CrownRosette,
	plan: FrondPlan,
	path: AxisPath,
	rachisAxis: number,
	rachisFirst: number,
	rachisLast: number,
): void {
	const shape = growth.frond;
	const pinnae = shape.pinnae;
	const foliage = input.record.foliage;
	if (!pinnae || foliage.kind !== 'blade') return;
	const places = pinnaPlaces(pinnae);
	const nodeCount = rachisLast - rachisFirst + 1;
	const age = frondAge(plan.age);
	// A rolled frond carries pinnae only on the part it has unrolled.
	const reached = plan.dead ? 1 : Math.min(1, age.unrolled + 0.05);
	const frame: PathFrame = emptyFrame();
	const pinnaRadius = Math.max(foliage.leaf.petiole.radius * 0.8, THINNEST);
	const droop = radians(pinnae.droop);
	for (let p = 0; p < places.length; p++) {
		const share = places[p] as number;
		if (share > reached) continue;
		frameAt(path, share * path.length, frame);
		const tangent = normalize3([
			frame.tangent[0] as number,
			frame.tangent[1] as number,
			frame.tangent[2] as number,
		]);
		const upper = normalize3([
			frame.normal[0] as number,
			frame.normal[1] as number,
			frame.normal[2] as number,
		]);
		const side = normalize3(cross3(tangent, upper, [0, 0, 0]));
		const pinnaLength = Math.max(
			0.01,
			curveAt(pinnae.length, share) * spreadMean(shape.length) * plan.size,
		);
		const angle = radians(curveAt(pinnae.angle, share));
		const parentNode = rachisFirst + Math.min(nodeCount - 1, Math.round(share * (nodeCount - 1)));
		for (const sign of [-1, 1]) {
			const dir = normalize3([
				tangent[0] * cos(angle) + side[0] * sign * sin(angle),
				tangent[1] * cos(angle) + side[1] * sign * sin(angle),
				tangent[2] * cos(angle) + side[2] * sign * sin(angle),
			]);
			const pinnaAxis = builder.addAxis({
				parent: rachisAxis,
				parentNode,
				order: 3,
				kind: AXIS_LIMB,
			});
			let px = frame.position[0] as number;
			let py = frame.position[1] as number;
			let pz = frame.position[2] as number;
			let previous = parentNode;
			let firstPinna = -1;
			for (let s = 0; s <= PINNA_NODES; s++) {
				const along = s / PINNA_NODES;
				// The pinna bows toward its lower face over its length.
				const bow = droop * along * along;
				const dx = dir[0] * cos(bow) - upper[0] * sin(bow);
				const dy = dir[1] * cos(bow) - upper[1] * sin(bow);
				const dz = dir[2] * cos(bow) - upper[2] * sin(bow);
				if (s > 0) {
					px += (dx * pinnaLength) / PINNA_NODES;
					py += (dy * pinnaLength) / PINNA_NODES;
					pz += (dz * pinnaLength) / PINNA_NODES;
				}
				previous = builder.addNode({
					x: px,
					y: py,
					z: pz,
					radius: Math.max(THINNEST, pinnaRadius * (1 - (1 - PINNA_TAPER) * along)),
					parent: previous,
					axis: pinnaAxis,
					light: 1,
				});
				if (firstPinna < 0) firstPinna = previous;
			}
			const q = new Float32Array(4);
			quatFromFrame(dir, upper, q);
			builder.addBud({
				node: firstPinna,
				x: frame.position[0] as number,
				y: frame.position[1] as number,
				z: frame.position[2] as number,
				frame: q,
				kind: BUD_TERMINAL,
				vigor: plan.age,
				light: 1,
				axis: pinnaAxis,
				woodRadius: pinnaRadius,
			});
		}
	}
}

/**
 * Grows a crown rosette: its stem's nodes, and each frond's stipe, rachis and pinnae.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The skeleton.
 * @category api/vegetation
 */
export function growCrownRosette(input: GrowInput): MacroSkeleton {
	const growth = rosetteOf(input.record);
	const salt = input.record.seedSalt >>> 0;
	const draw = (purpose: number, index = 0) =>
		unitAt(input.seed, salt, input.variant, purpose, index);
	const height = Math.max(0.1, spreadAt(growth.stem.height, draw(DRAW.stemHeight)));
	const lean = radians(Math.abs(spreadAt(growth.stem.lean, draw(DRAW.stemLean))));
	const curve = radians(Math.abs(spreadAt(growth.stem.curve, draw(DRAW.stemCurve))));
	const turn = draw(DRAW.stemTurn) * 2 * PI;
	const builder = new SkeletonBuilder();
	const stemAxis = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
	const steps = Math.max(2, Math.ceil(height / STEM_NODE));
	let x = 0;
	let y = 0;
	let z = 0;
	let previous = -1;
	for (let n = 0; n <= steps; n++) {
		const t = n / steps;
		if (n > 0) {
			const angle = lean + curve * t * t;
			const step = height / steps;
			x += sin(angle) * cos(turn) * step;
			y += cos(angle) * step;
			z += sin(angle) * sin(turn) * step;
		}
		previous = builder.addNode({
			x,
			y,
			z,
			radius: Math.max(THINNEST, curveAt(growth.stem.radius, t)),
			parent: previous,
			axis: stemAxis,
			light: 1 - 0.25 * t,
		});
	}
	const crownNode = previous;
	const suckers = Math.max(
		0,
		Math.round(spreadAt(growth.stem.suckers ?? 0, draw(DRAW.stemHeight + 32))),
	);
	for (let s = 0; s < suckers; s++) {
		const side = (2 * PI * s) / Math.max(1, suckers) + draw(DRAW.stemTurn, s) * 0.6;
		const suckAxis = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		const suckLean = radians(8 + 10 * draw(DRAW.stemLean, s + 8));
		const suckHeight = height * (0.55 + 0.3 * draw(DRAW.stemHeight, s + 8));
		const suckSteps = Math.max(2, Math.ceil(suckHeight / STEM_NODE));
		let px = 0;
		let py = 0;
		let pz = 0;
		let parentNode = -1;
		for (let n = 0; n <= suckSteps; n++) {
			const t = n / suckSteps;
			if (n > 0) {
				const angle = suckLean * (0.4 + 0.6 * t);
				const step = suckHeight / suckSteps;
				px += sin(angle) * cos(side) * step;
				py += cos(angle) * step;
				pz += sin(angle) * sin(side) * step;
			}
			parentNode = builder.addNode({
				x: px,
				y: py,
				z: pz,
				radius: Math.max(THINNEST, curveAt(growth.stem.radius, t) * 0.7),
				parent: parentNode,
				axis: suckAxis,
				light: 1 - 0.25 * t,
			});
		}
	}
	const plans = frondPlans(input, growth);
	plans.forEach((plan, index) => {
		layFrond(builder, input, growth, plan, index, crownNode, stemAxis);
	});
	return builder.finish(Math.max(0, height * 0.9));
}

/**
 * The tier a pinna's leaf draws at: the kit's tier at the nearest level, held at Medium there, and
 * the Low card at each card level. A tree fern's crown carries about a thousand pinnae, and each
 * pinna's own texture draws its pinnules, so the finest grid the crown needs is Medium.
 */
function pinnaDetail(detail: Detail, level: MeshLevel): Detail {
	if (level > 0) return 'low';
	const at = Math.min(DETAILS.indexOf(detail), DETAILS.indexOf('medium'));
	return DETAILS[Math.max(0, at)] as Detail;
}

/** The arc length along a run of nodes. */
function axisLength(skeleton: MacroSkeleton, first: number, last: number): number {
	const p = skeleton.position;
	let length = 0;
	for (let n = first + 1; n <= last; n++) {
		const dx = (p[n * 3] as number) - (p[(n - 1) * 3] as number);
		const dy = (p[n * 3 + 1] as number) - (p[(n - 1) * 3 + 1] as number);
		const dz = (p[n * 3 + 2] as number) - (p[(n - 1) * 3 + 2] as number);
		length += Math.sqrt(dx * dx + dy * dy + dz * dz);
	}
	return length;
}

/**
 * Meshes a crown rosette's foliage: each pinna as the species' leaf over its own axis. Each vertex's
 * colour bytes hold its pinna's wind record, a flutter phase that drifts along the pinna and the
 * crown's sky visibility; its second coordinates hold its share along the pinna and how brown it is.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @returns The foliage mesh.
 * @category api/vegetation
 */
export function meshCrownRosette(input: MeshInput, level: MeshLevel): MeshArrays {
	const record = input.record;
	const foliage = record.foliage;
	if (foliage.kind !== 'blade')
		throw new Error(
			`@null3d/vegetation: the crown-rosette foliage needs 'blade' leaves, not '${foliage.kind}'`,
		);
	const { skeleton, crown, kit } = input;
	const axes = skeleton.axes;
	const buds = skeleton.buds;
	const detail = pinnaDetail(input.detail, level);
	const outline = outlineOf(foliage.leaf, kit.manifest);
	const leaf = bladeMesh(foliage.leaf, outline, detail);
	const leafLength = Math.max(1e-4, spreadMean(foliage.leaf.length) + foliage.leaf.petiole.length);
	const mesh = new MeshWriter();
	const bytes = [0, 0, 0, 0];
	const point: Vector3 = [0, 0, 0];
	const normal: Vector3 = [0, 0, 0];
	for (let b = 0; b < buds.count; b++) {
		const axis = buds.axis[b] as number;
		if ((axes.kind[axis] as number) !== AXIS_LIMB) continue;
		const first = axes.first[axis] as number;
		const last = axes.last[axis] as number;
		if (last <= first) continue;
		const wind = axisBytes(input, axis);
		const scale = Math.max(1e-4, axisLength(skeleton, first, last) / leafLength);
		const brown = frondAge(buds.vigor[b] as number).brown;
		const firstVertex = mesh.vertices;
		for (let i = 0; i < leaf.positions.length; i += 3) {
			point[0] = (leaf.positions[i] as number) * scale;
			point[1] = (leaf.positions[i + 1] as number) * scale;
			point[2] = (leaf.positions[i + 2] as number) * scale;
			quatRotate(buds.frame, b * 4, point, point);
			point[0] += buds.position[b * 3] as number;
			point[1] += buds.position[b * 3 + 1] as number;
			point[2] += buds.position[b * 3 + 2] as number;
			normal[0] = leaf.normals[i] as number;
			normal[1] = leaf.normals[i + 1] as number;
			normal[2] = leaf.normals[i + 2] as number;
			quatRotate(buds.frame, b * 4, normal, normal);
			const share = Math.min(1, Math.max(0, (leaf.positions[i + 1] as number) / leafLength));
			bytes[0] = wind.high;
			bytes[1] = wind.low;
			bytes[2] = (wind.phase + Math.round(share * 64)) & 255;
			bytes[3] = skyByte(crown, point);
			mesh.vertex(
				point,
				normal,
				[leaf.uvs[(i / 3) * 2] as number, leaf.uvs[(i / 3) * 2 + 1] as number],
				[share, brown],
				bytes,
			);
		}
		for (const index of leaf.indices) mesh.indices.push(firstVertex + index);
	}
	return mesh.finishMesh();
}

/** The crown-rosette grower: the stem and its crown's skeleton, and its fronds' pinnae as foliage. */
export const grower: Grower = {
	grow: growCrownRosette,
	foliage: meshCrownRosette,
};
