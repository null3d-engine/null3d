// The rosette grower: hosta. A crown at the soil has divided into shoots (eyes) on a small ring;
// each shoot raises a golden-angle spiral of leaves, the oldest outermost. A leaf is one axis: its
// stalk leaves the shoot at its tilt from vertical and bends out and down by its arch, then the
// blade turns down from the stalk's line by its pitch and curls toward its tip. Old leaves lean out
// and spread low, so the plant is a mound about twice as wide as tall; the youngest stand upright,
// small and still rolled round their midribs at each shoot's heart. Each leaf's stalk faces a little
// outward from the plant's centre. In the seasons the record's scapes name, bare stems rise well
// above the leaves and carry the record's flower extras on one side of their upper part. In autumn
// the leaves collapse toward the ground and brown; a plant that dies back keeps only its crown in
// winter.
//
// The plant draws as merged foliage (grow/ground.ts): each leaf's channelled stalk and ribbed blade
// (leaf/thick-leaf.ts) and each scape.
import type { MeshArrays } from '../asset';
import {
	AXIS_CULM,
	AXIS_LIMB,
	AXIS_ROOT,
	BUD_FLOWER,
	BUD_TERMINAL,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../core/graph';
import { unitAt } from '../core/hash';
import { cos, normalize3, PI, pow, quatFromFrame, radians, sin, type Vector3 } from '../core/math';
import type { Rosette, Species, ThickLeaf } from '../core/record';
import { curveAt, spreadAt } from '../core/types';
import {
	STALK_LEAST_SKY,
	stalkDetail,
	type ThickDetail,
	thickDetail,
	thickOutline,
	writeStalk,
	writeThickBlade,
} from '../leaf/thick-leaf';
import { MeshWriter } from '../leaf/writer';
import type { GrowInput, MeshInput, MeshLevel } from '../stages';
import {
	AXIS_LEAF,
	axisBytes,
	axisKey,
	leafStrip,
	nodePath,
	stalkRange,
	terminalBuds,
	wholePath,
	writeStem,
} from './ground';
import type { Grower } from './models';

/** The golden angle in radians, which spreads the shoots over the crown. */
const GOLDEN = radians(137.50776405);
/** Points along a leaf's stalk and along its blade. */
const STALK_NODES = 6;
const BLADE_NODES = 7;
/** Points along a scape. */
const SCAPE_NODES = 10;
/**
 * How far a leaf's stalk turns from its spiral's heading toward its shoot's own, 0 to 1. A large
 * turn gathers each shoot's leaves behind it and leaves the gaps between shoots bare; a small one
 * keeps the spiral even round the crown.
 */
const OUTWARD = 0.4;

/** Purposes of the grower's hash keys, so no two draws share one. */
const Purpose = {
	Shoots: 1,
	Shoot: 2,
	Leaf: 3,
	Scapes: 4,
	Scape: 5,
} as const;

/** A unit draw for one purpose of one variant. */
function draw(input: GrowInput, purpose: number, a = 0, b = 0, c = 0): number {
	return unitAt(input.seed, input.record.seedSalt, input.variant * 256 + purpose, a, b * 4096 + c);
}

/** The record's rosette and leaf, or an error for a record of another model. */
function rosetteOf(record: Species): { readonly growth: Rosette; readonly leaf: ThickLeaf } {
	if (record.growth.model !== 'rosette' || record.foliage.kind !== 'thick')
		throw new Error(`@null3d/vegetation: '${record.id}' is not a rosette of thick leaves`);
	return { growth: record.growth, leaf: record.foliage.leaf };
}

/** A direction in the vertical plane of a heading: `elevation` radians above the horizontal. */
function inPlane(heading: number, elevation: number): Vector3 {
	const c = cos(elevation);
	return [cos(heading) * c, sin(elevation), sin(heading) * c];
}

/** The side of a direction that faces the sky, square to it in its vertical plane. */
function faceOf(heading: number, elevation: number): Vector3 {
	const s = sin(elevation);
	return [-cos(heading) * s, cos(elevation), -sin(heading) * s];
}

/** The signed angle from one heading to another, from -π to π. */
function angleBetween(from: number, to: number): number {
	let d = (to - from) % (2 * PI);
	if (d > PI) d -= 2 * PI;
	if (d < -PI) d += 2 * PI;
	return d;
}

/** Turns a vector about an axis by an angle (Rodrigues). */
function turned(v: Readonly<Vector3>, axis: Readonly<Vector3>, angle: number): Vector3 {
	const c = cos(angle);
	const s = sin(angle);
	const d = v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
	return [
		v[0] * c + (axis[1] * v[2] - axis[2] * v[1]) * s + axis[0] * d * (1 - c),
		v[1] * c + (axis[2] * v[0] - axis[0] * v[2]) * s + axis[1] * d * (1 - c),
		v[2] * c + (axis[0] * v[1] - axis[1] * v[0]) * s + axis[2] * d * (1 - c),
	];
}

/**
 * Grows a rosette: the crown, its shoots and their leaves, and the scapes in season.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The skeleton.
 */
export function growRosette(input: GrowInput): MacroSkeleton {
	const { growth, leaf } = rosetteOf(input.record);
	const { record, season } = input;
	const builder = new SkeletonBuilder();
	const crown = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_ROOT });
	builder.addNode({
		x: 0,
		y: -0.06,
		z: 0,
		radius: growth.crown,
		parent: -1,
		axis: crown,
		light: 1,
	});
	const crownTop = builder.addNode({
		x: 0,
		y: -0.01,
		z: 0,
		radius: growth.crown,
		parent: 0,
		axis: crown,
		light: 1,
	});
	const bare = season === 'winter' && record.seasons.deciduous && record.seasons.winter === 'bare';
	const autumn = season === 'autumn';
	const shoots = Math.max(1, Math.round(spreadAt(growth.shoots, draw(input, Purpose.Shoots))));
	const turn = draw(input, Purpose.Shoots, 1) * 2 * PI;
	const eyes: { axis: number; top: number; at: Vector3; heading: number }[] = [];
	for (let i = 0; i < shoots; i++) {
		const unit = (k: number) => draw(input, Purpose.Shoot, i, k);
		const distance = growth.crown * Math.sqrt((i + 0.5) / shoots) * (0.8 + 0.4 * unit(0));
		const heading = turn + i * GOLDEN;
		const at: Vector3 = [cos(heading) * distance, 0, sin(heading) * distance];
		const eye = builder.addAxis({
			parent: crown,
			parentNode: crownTop,
			parentT: 1,
			order: 1,
			kind: AXIS_LIMB,
		});
		const radius = 0.012 * (1 + 0.02 * unit(1));
		builder.addNode({
			x: at[0],
			y: -0.04,
			z: at[2],
			radius,
			parent: crownTop,
			axis: eye,
			light: 1,
		});
		const top = builder.addNode({
			x: at[0],
			y: 0,
			z: at[2],
			radius: radius * 0.9,
			parent: builder.nodeCount - 1,
			axis: eye,
			light: 1,
		});
		eyes.push({ axis: eye, top, at, heading });
		if (bare) continue;
		const leaves = Math.max(1, Math.round(spreadAt(growth.leaves, unit(2))));
		const spiral = unit(3) * 2 * PI;
		for (let k = 0; k < leaves; k++) {
			const age = leaves > 1 ? 1 - k / (leaves - 1) : 0.5;
			const draws = (m: number) => draw(input, Purpose.Leaf, i, k, m);
			const rolled = age < growth.rolled;
			// The spiral's heading, turned toward the plant's outside where the shoot stands off centre.
			let heading = spiral + radians(growth.divergence) * k + (draws(0) - 0.5) * 0.3;
			if (distance > 1e-4) heading += OUTWARD * angleBetween(heading, eyes[i]?.heading ?? heading);
			const tilt = radians(
				curveAt(growth.tilt, age) * (0.85 + 0.3 * draws(1)) + (autumn ? growth.collapse * age : 0),
			);
			const arch = radians(curveAt(growth.arch, age) * (0.8 + 0.4 * draws(2)));
			const stalk = curveAt(growth.stalk, age) * (0.85 + 0.3 * draws(3));
			const length = spreadAt(leaf.length, draws(4)) * curveAt(growth.size, age);
			const pitch = rolled
				? 0
				: radians(curveAt(growth.pitch, age) * (0.8 + 0.4 * draws(5)) + (autumn ? 10 : 0));
			const curl = rolled ? 0 : leaf.curl * (0.7 + 0.6 * draws(6));
			const lean = (draws(7) - 0.5) * radians(24);
			const axis = builder.addAxis({
				parent: eye,
				parentNode: top,
				parentT: 1,
				order: 2,
				kind: AXIS_LEAF,
			});
			const radius = leaf.stalk.radius * (0.75 + 0.25 * age) * (1 + 0.02 * draws(8));
			// The stalk: up from the shoot at its tilt, bending out and down by its arch.
			const p: Vector3 = [at[0] + cos(heading) * 0.008, 0, at[2] + sin(heading) * 0.008];
			const elevation0 = PI / 2 - tilt;
			let previous = top;
			let elevation = elevation0;
			const step = stalk / (STALK_NODES - 1);
			for (let n = 0; n < STALK_NODES; n++) {
				if (n > 0) {
					const mid = elevation0 - arch * pow((n - 0.5) / (STALK_NODES - 1), 1.5);
					const d = inPlane(heading, mid);
					p[0] += d[0] * step;
					p[1] = Math.max(0.005, p[1] + d[1] * step);
					p[2] += d[2] * step;
				}
				elevation = elevation0 - arch * pow(n / (STALK_NODES - 1), 1.5);
				previous = builder.addNode({
					x: p[0],
					y: p[1],
					z: p[2],
					radius,
					parent: previous,
					axis,
					light: 1,
				});
			}
			const bladeBase = previous;
			// The blade: turned down by its pitch from the stalk's end, leaning a little to one side,
			// curling toward its lower face along its length.
			const bladeElevation = elevation - pitch;
			const along = inPlane(heading, bladeElevation);
			let face = turned(faceOf(heading, bladeElevation), along, lean);
			const bud = [0, 0, 0, 1];
			quatFromFrame(along, face, bud);
			builder.addBud({
				node: bladeBase,
				x: p[0],
				y: p[1],
				z: p[2],
				frame: bud,
				kind: BUD_TERMINAL,
				vigor: age,
				light: 1,
				axis,
				woodRadius: 0,
			});
			let direction = along;
			const bladeStep = length / (BLADE_NODES - 1);
			for (let n = 1; n < BLADE_NODES; n++) {
				const share = (n - 0.5) / (BLADE_NODES - 1);
				// The curl turns the midrib toward its lower face, about the blade's own across.
				const bend = (radians(curl) * (2 * share)) / (BLADE_NODES - 1);
				const axisOfBend = normalize3([
					direction[1] * face[2] - direction[2] * face[1],
					direction[2] * face[0] - direction[0] * face[2],
					direction[0] * face[1] - direction[1] * face[0],
				]);
				direction = normalize3(turned(direction, axisOfBend, -bend));
				face = normalize3(turned(face, axisOfBend, -bend));
				p[0] += direction[0] * bladeStep;
				p[1] = Math.max(0.004, p[1] + direction[1] * bladeStep);
				p[2] += direction[2] * bladeStep;
				previous = builder.addNode({
					x: p[0],
					y: p[1],
					z: p[2],
					radius: radius * 0.4,
					parent: previous,
					axis,
					light: 1,
				});
			}
		}
	}
	const scapes = growth.scapes;
	if (!bare && scapes?.seasons.includes(season)) {
		const count = Math.max(0, Math.round(spreadAt(scapes.count, draw(input, Purpose.Scapes))));
		for (let s = 0; s < count; s++) {
			const unit = (k: number) => draw(input, Purpose.Scape, s, k);
			const eye = eyes[Math.floor(unit(0) * eyes.length) % eyes.length];
			if (!eye) continue;
			const height = spreadAt(scapes.height, unit(1));
			const lean = radians(spreadAt(scapes.lean, unit(2)));
			const heading = unit(3) * 2 * PI;
			const axis = builder.addAxis({
				parent: eye.axis,
				parentNode: eye.top,
				parentT: 1,
				order: 2,
				kind: AXIS_CULM,
			});
			const radius = scapes.radius * (1 + 0.02 * unit(4));
			const p: Vector3 = [eye.at[0], 0, eye.at[2]];
			let previous = eye.top;
			const nodes: number[] = [];
			const step = height / (SCAPE_NODES - 1);
			for (let n = 0; n < SCAPE_NODES; n++) {
				if (n > 0) {
					// Straight from the crown, then leaning more toward the top.
					const d = inPlane(heading, PI / 2 - lean * pow((n - 0.5) / (SCAPE_NODES - 1), 1.5));
					p[0] += d[0] * step;
					p[1] += d[1] * step;
					p[2] += d[2] * step;
				}
				previous = builder.addNode({
					x: p[0],
					y: p[1],
					z: p[2],
					radius: radius * (1 - 0.5 * (n / (SCAPE_NODES - 1))),
					parent: previous,
					axis,
					light: 1,
				});
				nodes.push(previous);
			}
			// Flowers on one side of the scape's top, each nodding out and down.
			const flowers = Math.max(1, Math.round(spreadAt(scapes.flowers, unit(5))));
			const side = heading + PI * (unit(6) - 0.5) * 0.5;
			for (let f = 0; f < flowers; f++) {
				const share = 1 - scapes.raceme + scapes.raceme * ((f + 0.5) / flowers);
				const i = Math.min(SCAPE_NODES - 2, Math.floor(share * (SCAPE_NODES - 1)));
				const u = share * (SCAPE_NODES - 1) - i;
				const a = nodes[i] as number;
				const b = nodes[i + 1] as number;
				const at: Vector3 = [0, 0, 0];
				for (let k = 0; k < 3; k++)
					at[k] =
						(builder.position[a * 3 + k] as number) * (1 - u) +
						(builder.position[b * 3 + k] as number) * u;
				const out = side + (draw(input, Purpose.Scape, s, 16 + f) - 0.5) * 0.8;
				const direction = normalize3([cos(out), -0.35, sin(out)]);
				const frame = [0, 0, 0, 1];
				quatFromFrame(direction, [0, 1, 0], frame);
				builder.addBud({
					node: a,
					x: at[0] + cos(out) * radius,
					y: at[1],
					z: at[2] + sin(out) * radius,
					frame,
					kind: BUD_FLOWER,
					vigor: 0.5,
					light: 1,
					axis,
					woodRadius: 0,
				});
			}
		}
	}
	return builder.finish(0);
}

/** The blade's grid at each level: the tier's at the nearest, plain and coarse beyond. */
function bladeLevel(leaf: ThickLeaf, input: MeshInput, level: MeshLevel): ThickDetail {
	if (level === 0) return thickDetail(leaf, input.detail);
	return level === 1 ? { rows: 8, columns: 4, ribs: false } : { rows: 4, columns: 2, ribs: false };
}

/**
 * How far a leaf of an age is meshed rolled round its midrib, from 0 open to 1 closed. Only a leaf
 * the grower stands rolled, upright and unbent, below the record's rolled share of its age, is
 * rolled, unrolling as it ages: an open leaf is pitched and curled, and a roll on top of that turns
 * its faces in.
 *
 * @param age The leaf's age, 0 youngest to 1 oldest.
 * @param rolled The record's rolled share of a shoot's leaves.
 * @returns The roll.
 */
export function leafRoll(age: number, rolled: number): number {
	return age < rolled ? Math.max(0, 1 - age / Math.max(1e-6, 1.4 * rolled)) : 0;
}

/** The +Z axis of a frame quaternion: the upper face. */
function faceOfBud(q: ArrayLike<number>): [number, number, number] {
	const x = q[0] as number;
	const y = q[1] as number;
	const z = q[2] as number;
	const w = q[3] as number;
	return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
}

/**
 * Meshes a rosette's merged foliage at a level: every leaf's stalk and blade, and the scapes.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @returns The foliage's mesh.
 */
export function meshRosette(input: MeshInput, level: MeshLevel): MeshArrays {
	const { growth, leaf } = rosetteOf(input.record);
	const { skeleton, crown, kit } = input;
	const axes = skeleton.axes;
	const outline = thickOutline(leaf, kit.manifest);
	const blades = bladeLevel(leaf, input, level);
	const stalks = level === 0 ? stalkDetail(input.detail) : { sides: 3, rings: level === 1 ? 4 : 2 };
	const buds = terminalBuds(skeleton);
	const browning = input.season === 'autumn' ? 1 : 0;
	const strip = leafStrip(kit.manifest);
	const mesh = new MeshWriter();
	for (let a = 0; a < axes.count; a++) {
		const kind = axes.kind[a] as number;
		const bytes = axisBytes(input, a);
		if (kind === AXIS_CULM) {
			const path = wholePath(skeleton, a, [0, 1, 0]);
			if (!path) continue;
			const first = axes.first[a] as number;
			const last = axes.last[a] as number;
			const r0 = skeleton.radius[first] as number;
			const r1 = skeleton.radius[last] as number;
			writeStem(mesh, {
				path,
				from: 0,
				to: path.length,
				rings: level === 0 ? 10 : 3,
				radius: (share) => r0 + (r1 - r0) * share,
				section: { sides: level === 0 ? 6 : 3 },
				v: stalkRange(strip),
				uHalf: strip.stalkHalf,
				bytes,
				crown,
				along: [0, 1],
				browning,
				closeTip: true,
				leastSky: STALK_LEAST_SKY,
			});
			continue;
		}
		if (kind !== AXIS_LEAF) continue;
		const bud = buds[a] as number;
		if (bud < 0) continue;
		const face = faceOfBud(skeleton.buds.frame.subarray(bud * 4, bud * 4 + 4));
		const baseNode = skeleton.buds.node[bud] as number;
		const stalk = nodePath(skeleton, axes.first[a] as number, baseNode, face);
		const midrib = nodePath(skeleton, baseNode, axes.last[a] as number, face);
		if (!midrib) continue;
		const age = skeleton.buds.vigor[bud] as number;
		const stalkLength = stalk?.length ?? 0;
		const bladeStart = stalkLength / (stalkLength + midrib.length);
		if (stalk)
			writeStalk(
				mesh,
				{
					path: stalk,
					from: 0,
					to: stalk.length,
					radius: skeleton.radius[baseNode] as number,
					channel: leaf.stalk.channel,
					bladeStart,
					browning,
				},
				stalks,
				kit.manifest,
				bytes,
				crown,
			);
		const key = axisKey(skeleton, a);
		writeThickBlade(
			mesh,
			midrib,
			{
				length: midrib.length,
				leaf,
				outline,
				roll: leafRoll(age, growth.rolled),
				browning,
				along: [bladeStart, 1],
				wavePhase: unitAt(input.seed, key, 3),
			},
			blades,
			bytes,
			crown,
		);
	}
	return mesh.finishMesh();
}

/** The rosette grower. */
export const grower: Grower = {
	grow: growRosette,
	foliage: meshRosette,
};
