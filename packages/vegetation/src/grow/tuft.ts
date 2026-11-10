// The tuft grower: grasses and sedges. A crown under the soil carries shoots (tillers) spread over a
// small disc, the outer ones leaning out; each shoot is a column of nested sheaths with blades
// leaving it at rising collars, in two ranks (grasses) or three (sedges), the oldest lowest and
// widest spread, the youngest innermost and upright. Each blade leaves its collar at its spread
// angle and arches over toward the ground, more toward its tip. In the seasons the record's heads
// name, flowering stems rise from some shoots and bow over at the top: a grass's carries an open
// panicle, whorls of branches with spikelets on their outer parts; a sedge's hangs spikes on short
// stalks one below another, with one more spike at its tip. The spikelets and spikes are the
// record's extras on the flower sites and stem tips this grower places.
//
// The plant draws as merged foliage (grow/ground.ts): blades, sheaths, stems and branches, each on
// its own axis and wind record.
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
import {
	cos,
	cross3,
	normalize3,
	PI,
	pow,
	quatFromFrame,
	radians,
	sin,
	type Vector3,
} from '../core/math';
import type { GrassBlade, Species, Tuft } from '../core/record';
import { curveAt, type Detail, spreadAt, spreadMean } from '../core/types';
import {
	BLADE_ACROSS,
	BLADE_ROWS,
	type BladeDetail,
	bladeTexture,
	writeBlade,
} from '../leaf/grass-blade';
import { MeshWriter } from '../leaf/writer';
import type { GrowInput, MeshInput, MeshLevel } from '../stages';
import {
	AXIS_LEAF,
	axisBytes,
	axisKey,
	leafStrip,
	stalkRange,
	terminalBuds,
	wholePath,
	writeStem,
} from './ground';
import type { Grower } from './models';

/** The golden angle in radians, which spreads shoots over the crown's disc. */
const GOLDEN = radians(137.50776405);
/** Points along each blade's axis. */
const BLADE_NODES = 8;
/** Points along each flowering stem. */
const STEM_NODES = 12;
/** How far down a blade may arch, in degrees below the horizontal. */
const LOWEST = 80;
/** The lowest a blade's path runs above the ground, in metres. */
const GROUND = 0.004;

/** Purposes of the grower's hash keys, so no two draws share one. */
const Purpose = {
	Shoots: 1,
	Shoot: 2,
	Blades: 3,
	Blade: 4,
	Heads: 5,
	Head: 6,
	Branch: 7,
	Spike: 8,
	Rhizome: 9,
	Root: 10,
} as const;

/** A unit draw for one purpose of one variant. */
function draw(input: GrowInput, purpose: number, a = 0, b = 0, c = 0): number {
	return unitAt(input.seed, input.record.seedSalt, input.variant * 256 + purpose, a, b * 4096 + c);
}

/** The record's tuft and blade, or an error for a record of another model. */
function tuftOf(record: Species): { readonly growth: Tuft; readonly blade: GrassBlade } {
	if (record.growth.model !== 'tuft' || record.foliage.kind !== 'grass-blade')
		throw new Error(`@null3d/vegetation: '${record.id}' is not a tuft of grass blades`);
	return { growth: record.growth, blade: record.foliage.blade };
}

/** A direction in the vertical plane of a heading: `elevation` radians above the horizontal. */
function inPlane(heading: number, elevation: number): Vector3 {
	const c = cos(elevation);
	return [cos(heading) * c, sin(elevation), sin(heading) * c];
}

/** The upper face of a direction in its vertical plane: square to it, toward the sky. */
function faceOf(heading: number, elevation: number): Vector3 {
	const s = sin(elevation);
	return [-cos(heading) * s, cos(elevation), -sin(heading) * s];
}

/** A frame quaternion from a direction and its upper face. */
function frameOf(along: Readonly<Vector3>, face: Readonly<Vector3>): number[] {
	const q = [0, 0, 0, 1];
	quatFromFrame(along, face, q);
	return q;
}

/** Adds an axis with nodes along an arching curve and returns its index and node indices. */
function arching(
	builder: SkeletonBuilder,
	parent: number,
	parentNode: number,
	order: number,
	kind: number,
	start: Readonly<Vector3>,
	heading: number,
	elevation: number,
	bend: number,
	length: number,
	nodes: number,
	radius: (share: number) => number,
	power: number,
): { axis: number; nodes: number[]; directions: Vector3[] } {
	const axis = builder.addAxis({ parent, parentNode, parentT: 1, order, kind });
	const out: number[] = [];
	const directions: Vector3[] = [];
	const p: Vector3 = [start[0], start[1], start[2]];
	const step = length / (nodes - 1);
	for (let i = 0; i < nodes; i++) {
		const share = i / (nodes - 1);
		const e = Math.max(radians(-LOWEST), elevation - bend * pow(share, power));
		directions.push(inPlane(heading, e));
		if (i > 0) {
			const mid = Math.max(
				radians(-LOWEST),
				elevation - bend * pow((i - 0.5) / (nodes - 1), power),
			);
			const d = inPlane(heading, mid);
			p[0] += d[0] * step;
			p[1] = Math.max(GROUND, p[1] + d[1] * step);
			p[2] += d[2] * step;
		}
		out.push(
			builder.addNode({
				x: p[0],
				y: p[1],
				z: p[2],
				radius: radius(share),
				parent: i === 0 ? parentNode : (out[i - 1] as number),
				axis,
				light: 1,
			}),
		);
	}
	return { axis, nodes: out, directions };
}

/** A flowering stem's heads: a panicle's branches and spikelets, or a sedge's hanging spikes. */
function growHeads(
	input: GrowInput,
	builder: SkeletonBuilder,
	growth: Tuft,
	stem: { axis: number; nodes: number[] },
	height: number,
	heading: number,
	index: number,
): void {
	const heads = growth.heads;
	if (!heads) return;
	const position = (node: number): Vector3 => [
		builder.position[node * 3] as number,
		builder.position[node * 3 + 1] as number,
		builder.position[node * 3 + 2] as number,
	];
	const tangentAt = (k: number): Vector3 => {
		const a = position(stem.nodes[Math.max(0, k - 1)] as number);
		const b = position(stem.nodes[Math.min(stem.nodes.length - 1, k + 1)] as number);
		return normalize3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
	};
	const last = stem.nodes.length - 1;
	const tip = stem.nodes[last] as number;
	const tipAt = position(tip);
	const tipTangent = tangentAt(last);
	const flowerBud = (at: Readonly<Vector3>, node: number, axis: number, along: Readonly<Vector3>) =>
		builder.addBud({
			node,
			x: at[0],
			y: at[1],
			z: at[2],
			frame: frameOf(along, Math.abs(along[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]),
			kind: BUD_FLOWER,
			vigor: 0.5,
			light: 1,
			axis,
			woodRadius: 0,
		});
	if (heads.kind === 'spike' && heads.spikes) {
		// The spike at the tip carries on the stem's line.
		builder.addBud({
			node: tip,
			x: tipAt[0],
			y: tipAt[1],
			z: tipAt[2],
			frame: frameOf(tipTangent, Math.abs(tipTangent[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]),
			kind: BUD_TERMINAL,
			vigor: 0.5,
			light: 1,
			axis: stem.axis,
			woodRadius: 0,
		});
		const spikes = Math.max(
			1,
			Math.round(spreadAt(heads.spikes.count, draw(input, Purpose.Spike, index))),
		);
		const nodeLength = height / last;
		let arc = 0;
		for (let j = 0; j < spikes; j++) {
			arc += spreadAt(heads.spikes.spacing, draw(input, Purpose.Spike, index, j, 1));
			const k = Math.max(1, last - Math.round(arc / nodeLength));
			const node = stem.nodes[k] as number;
			const from = position(node);
			const t = tangentAt(k);
			// The stalk leaves the stem's outer side, then hangs.
			const side = heading + (draw(input, Purpose.Spike, index, j, 2) - 0.5) * 1.2;
			const out = normalize3([cos(side) - t[0] * 0.3, 0.2, sin(side) - t[2] * 0.3]);
			const length =
				spreadAt(heads.spikes.stalk, draw(input, Purpose.Spike, index, j, 3)) * (1 + 0.15 * j);
			const axis = builder.addAxis({
				parent: stem.axis,
				parentNode: node,
				parentT: 1,
				order: 3,
				kind: AXIS_LIMB,
			});
			const radius =
				heads.radius *
				(heads.stalkShare ?? 0.35) *
				(1 + 0.02 * draw(input, Purpose.Spike, index, j, 4));
			const points: Vector3[] = [
				from,
				[
					from[0] + out[0] * length * 0.35,
					from[1] + out[1] * length * 0.35,
					from[2] + out[2] * length * 0.35,
				],
				[
					from[0] + out[0] * length * 0.55,
					from[1] - length * 0.3,
					from[2] + out[2] * length * 0.55,
				],
				[from[0] + out[0] * length * 0.6, from[1] - length * 0.65, from[2] + out[2] * length * 0.6],
			];
			let previous = node;
			let end = node;
			points.forEach((point) => {
				end = builder.addNode({
					x: point[0],
					y: point[1],
					z: point[2],
					// The stalk holds its width to the spike's foot: a taper there thins the join under
					// the outline's half-cover cutoff, so the hanging spike draws as a piece of its own.
					radius,
					parent: previous,
					axis,
					light: 1,
				});
				previous = end;
			});
			const at = points[3] as Vector3;
			flowerBud(at, end, axis, [0, -1, 0]);
		}
		return;
	}
	const panicle = heads.panicle;
	if (!panicle) return;
	const length = Math.min(
		height * 0.6,
		spreadAt(panicle.length, draw(input, Purpose.Branch, index)),
	);
	const nodeLength = height / last;
	const whorls = Math.max(1, panicle.whorls);
	const twist = draw(input, Purpose.Branch, index, 0, 1) * 2 * PI;
	for (let w = 0; w < whorls; w++) {
		const share = whorls > 1 ? w / (whorls - 1) : 0;
		// The lowest whorl at the panicle's foot, the highest just under its tip; branches shorten up it.
		const arc = height - length * (1 - 0.9 * share);
		const k = Math.max(1, Math.min(last - 1, Math.round(arc / nodeLength)));
		const node = stem.nodes[k] as number;
		const from = position(node);
		const t = tangentAt(k);
		const branches = Math.max(
			1,
			Math.round(spreadAt(panicle.branches, draw(input, Purpose.Branch, index, w, 2))),
		);
		const reach = length * (0.1 + 0.38 * (1 - share));
		const angle = radians(curveAt(panicle.angle, share));
		for (let b = 0; b < branches; b++) {
			const around =
				twist +
				w * 2.4 +
				(2 * PI * b) / branches +
				(draw(input, Purpose.Branch, index, w * 16 + b, 3) - 0.5) * 0.6;
			const [x, y] = sideOf(t);
			const radial: Vector3 = [
				x[0] * cos(around) + y[0] * sin(around),
				x[1] * cos(around) + y[1] * sin(around),
				x[2] * cos(around) + y[2] * sin(around),
			];
			const branchLength = reach * (0.75 + 0.5 * draw(input, Purpose.Branch, index, w * 16 + b, 4));
			const axis = builder.addAxis({
				parent: stem.axis,
				parentNode: node,
				parentT: 1,
				order: 3,
				kind: AXIS_LIMB,
			});
			const radius =
				heads.radius * 0.18 * (1 + 0.02 * draw(input, Purpose.Branch, index, w * 16 + b, 5));
			let previous = node;
			const steps = 4;
			let direction = normalize3([
				t[0] * cos(angle) + radial[0] * sin(angle),
				t[1] * cos(angle) + radial[1] * sin(angle),
				t[2] * cos(angle) + radial[2] * sin(angle),
			]);
			const p: Vector3 = [from[0], from[1], from[2]];
			const nodes: number[] = [];
			const droop = radians(panicle.droop) / steps;
			for (let i = 0; i <= steps; i++) {
				if (i > 0) {
					p[0] += direction[0] * (branchLength / steps);
					p[1] += direction[1] * (branchLength / steps);
					p[2] += direction[2] * (branchLength / steps);
					direction = normalize3([direction[0], direction[1] - sin(droop), direction[2]]);
				}
				previous = builder.addNode({
					x: p[0],
					y: p[1],
					z: p[2],
					radius: radius * (1 - 0.5 * (i / steps)),
					parent: previous,
					axis,
					light: 1,
				});
				nodes.push(previous);
			}
			// Spikelets on the branch's outer part, pointing on along it and a little out.
			const flowers = Math.max(
				1,
				Math.round(spreadAt(panicle.flowers, draw(input, Purpose.Branch, index, w * 16 + b, 6))),
			);
			for (let f = 0; f < flowers; f++) {
				const along = 0.45 + 0.55 * ((f + 0.5) / flowers);
				const i = Math.min(steps - 1, Math.floor(along * steps));
				const u = along * steps - i;
				const a = nodes[i] as number;
				const c = nodes[i + 1] as number;
				const pa = position(a);
				const pc = position(c);
				const at: Vector3 = [
					pa[0] + (pc[0] - pa[0]) * u,
					pa[1] + (pc[1] - pa[1]) * u,
					pa[2] + (pc[2] - pa[2]) * u,
				];
				const spin = draw(input, Purpose.Branch, index, w * 1024 + b * 64 + f, 7) * 2 * PI;
				const [sx, sy] = sideOf(direction);
				const lean = 0.45;
				const flower = normalize3([
					direction[0] + (sx[0] * cos(spin) + sy[0] * sin(spin)) * lean,
					direction[1] + (sx[1] * cos(spin) + sy[1] * sin(spin)) * lean + 0.25,
					direction[2] + (sx[2] * cos(spin) + sy[2] * sin(spin)) * lean,
				]);
				flowerBud(at, a, axis, flower);
			}
		}
	}
	// A few spikelets crown the stem's own tip.
	for (let f = 0; f < 3; f++) {
		const spin = (2 * PI * f) / 3 + twist;
		const [sx, sy] = sideOf(tipTangent);
		const flower = normalize3([
			tipTangent[0] + (sx[0] * cos(spin) + sy[0] * sin(spin)) * 0.35,
			tipTangent[1] + (sx[1] * cos(spin) + sy[1] * sin(spin)) * 0.35,
			tipTangent[2] + (sx[2] * cos(spin) + sy[2] * sin(spin)) * 0.35,
		]);
		flowerBud(tipAt, tip, stem.axis, flower);
	}
}

/** Two unit vectors square to a direction and each other. */
function sideOf(direction: Readonly<Vector3>): [Vector3, Vector3] {
	const hint: Vector3 = Math.abs(direction[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
	const x = normalize3(cross3(hint, direction, [0, 0, 0]));
	const y = cross3(direction, x, [0, 0, 0]);
	return [x, y];
}

/**
 * Grows a tuft: the crown, its shoots and their blades, and the flowering stems in season.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The skeleton.
 */
export function growTuft(input: GrowInput): MacroSkeleton {
	const { growth, blade } = tuftOf(input.record);
	const builder = new SkeletonBuilder();
	const crown = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_ROOT });
	builder.addNode({ x: 0, y: -0.03, z: 0, radius: growth.base, parent: -1, axis: crown, light: 1 });
	const crownTop = builder.addNode({
		x: 0,
		y: 0,
		z: 0,
		radius: growth.base,
		parent: 0,
		axis: crown,
		light: 1,
	});
	growSoil(input, builder, crown, crownTop);
	const shoots = Math.max(1, Math.round(spreadAt(growth.shoots, draw(input, Purpose.Shoots))));
	const meanLength = spreadMean(blade.length);
	const turn = draw(input, Purpose.Shoots, 1) * 2 * PI;
	const tillers: { axis: number; top: number; heading: number; lean: number; at: Vector3 }[] = [];
	for (let i = 0; i < shoots; i++) {
		const unit = (k: number) => draw(input, Purpose.Shoot, i, k);
		const distance = growth.base * Math.sqrt((i + 0.5) / shoots) * (0.85 + 0.3 * unit(0));
		const heading = turn + i * GOLDEN + (unit(1) - 0.5) * 0.5;
		const lean = radians(
			curveAt(growth.lean, Math.min(1, distance / Math.max(1e-6, growth.base))) +
				(unit(2) - 0.5) * 8,
		);
		const blades = Math.max(1, Math.round(spreadAt(growth.blades, unit(3))));
		const sheath = spreadAt(growth.sheath, unit(4));
		const column = sheath * (1 + 0.25 * (blades - 1));
		const radius = growth.sheathRadius * (1 + 0.02 * unit(5));
		const base: Vector3 = [cos(heading) * distance, -0.01, sin(heading) * distance];
		const tiller = arching(
			builder,
			crown,
			crownTop,
			1,
			AXIS_LIMB,
			base,
			heading,
			PI / 2 - lean,
			0,
			column,
			3,
			(s) => radius * (1 - 0.25 * s),
			1,
		);
		const top = tiller.nodes[2] as number;
		tillers.push({ axis: tiller.axis, top, heading, lean, at: base });
		const rankTurn = unit(6) * 2 * PI;
		for (let k = 0; k < blades; k++) {
			const age = blades > 1 ? 1 - k / (blades - 1) : 0.5;
			const draws = (m: number) => draw(input, Purpose.Blade, i, k, m);
			const collar = column * (blades > 1 ? 0.45 + 0.55 * (k / (blades - 1)) : 1);
			const rank = k % Math.max(1, growth.ranks);
			const around =
				rankTurn + (2 * PI * rank) / Math.max(1, growth.ranks) + (draws(0) - 0.5) * 0.5;
			// A blade faces out from its tuft: its own heading leans toward the shoot's.
			const headingOut = around + 0.55 * angleBetween(heading, around);
			const spread = radians(curveAt(growth.spread, age) * (0.85 + 0.3 * draws(1)));
			const length = spreadAt(blade.length, draws(2)) * curveAt(growth.size, age);
			const arch = radians(
				spreadAt(blade.arch, draws(3)) *
					(0.6 + 0.8 * age) *
					Math.sqrt(length / Math.max(1e-6, meanLength)),
			);
			const shootDir = inPlane(heading, PI / 2 - lean);
			const from: Vector3 = [
				base[0] + shootDir[0] * collar,
				base[1] + shootDir[1] * collar,
				base[2] + shootDir[2] * collar,
			];
			const elevation = PI / 2 - Math.min(PI * 0.48, spread + lean * cos(headingOut - heading));
			const halfWidth = 0.25 * blade.width * (1 + 0.02 * draws(4));
			const leaf = arching(
				builder,
				tiller.axis,
				top,
				2,
				AXIS_LEAF,
				from,
				headingOut,
				elevation,
				arch,
				length,
				BLADE_NODES,
				(s) => halfWidth * (1 - 0.6 * s),
				1.6,
			);
			const first = leaf.nodes[0] as number;
			builder.addBud({
				node: first,
				x: from[0],
				y: from[1],
				z: from[2],
				frame: frameOf(inPlane(headingOut, elevation), faceOf(headingOut, elevation)),
				kind: BUD_TERMINAL,
				vigor: age,
				light: 1,
				axis: leaf.axis,
				woodRadius: 0,
			});
		}
	}
	const heads = growth.heads;
	if (heads?.seasons.includes(input.season)) {
		const count = Math.min(
			tillers.length,
			Math.max(0, Math.round(spreadAt(heads.count, draw(input, Purpose.Heads)))),
		);
		// Flowering stems rise from shoots spread over the crown, picked by a stride through them.
		const stride = Math.max(1, Math.floor(tillers.length / Math.max(1, count)));
		for (let h = 0; h < count; h++) {
			const tiller =
				tillers[(h * stride + Math.floor(draw(input, Purpose.Heads, 1) * stride)) % tillers.length];
			if (!tiller) continue;
			const unit = (k: number) => draw(input, Purpose.Head, h, k);
			const height = spreadAt(heads.height, unit(0));
			const heading = tiller.heading + (unit(1) - 0.5) * 0.6;
			const lean = tiller.lean * 1.2 + radians(3 + unit(2) * 12);
			const bow = radians(spreadAt(heads.bow, unit(3)));
			const at: Vector3 = [
				builder.position[tiller.top * 3] as number,
				builder.position[tiller.top * 3 + 1] as number,
				builder.position[tiller.top * 3 + 2] as number,
			];
			const radius = heads.radius * (1 + 0.02 * unit(4));
			const stem = arching(
				builder,
				tiller.axis,
				tiller.top,
				2,
				AXIS_CULM,
				at,
				heading,
				PI / 2 - lean,
				bow,
				height,
				STEM_NODES,
				(s) => radius * (1 - 0.45 * s),
				3,
			);
			growHeads(input, builder, growth, stem, height, heading, h);
		}
	}
	const finished = builder.finish(0);
	if (growth.soil === undefined) return finished;
	// What grows below the soil does not extend the plant's box: the ground hides it, and every
	// picture frames the plant above the ground. The crown's own nodes set the lowest point.
	let lowest = finished.bounds.max[1] as number;
	for (let n = finished.axes.first[0] as number; n <= (finished.axes.last[0] as number); n++)
		lowest = Math.min(lowest, finished.position[n * 3 + 1] as number);
	if ((finished.bounds.min[1] as number) >= lowest) return finished;
	return {
		...finished,
		bounds: {
			min: [finished.bounds.min[0], lowest, finished.bounds.min[2]],
			max: finished.bounds.max,
		},
	};
}

/**
 * The crown's hold in the soil: a rhizome along the ground and the roots that leave it and the
 * crown. A root runs below the soil, where the blades' own path never goes, so it takes its own
 * node run rather than the arching one.
 */
function growSoil(
	input: GrowInput,
	builder: SkeletonBuilder,
	crown: number,
	crownNode: number,
): void {
	const { growth } = tuftOf(input.record);
	const soil = growth.soil;
	if (!soil) return;
	const roots = Math.max(0, Math.round(spreadAt(soil.roots, draw(input, Purpose.Root))));
	const heading = draw(input, Purpose.Rhizome, 2) * 2 * PI;
	let host = crown;
	let hostNode = crownNode;
	if (soil.rhizome !== undefined) {
		const half = spreadAt(soil.rhizome, draw(input, Purpose.Rhizome));
		const radius = soil.rhizomeRadius ?? 0.01;
		const along: [number, number] = [cos(heading), sin(heading)];
		const axis = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_ROOT });
		const nodes = 5;
		let previous = -1;
		for (let i = 0; i < nodes; i++) {
			const share = i / (nodes - 1);
			const reach = -half + 2 * half * share;
			const end = Math.abs(2 * share - 1);
			const node = builder.addNode({
				x: along[0] * reach,
				y: -radius * (0.4 + 0.35 * end),
				z: along[1] * reach,
				radius: radius * (0.55 + 0.45 * (1 - end)),
				parent: previous < 0 ? -1 : previous,
				axis,
				light: 1,
			});
			previous = node;
		}
		host = axis;
		hostNode = previous;
	}
	for (let r = 0; r < roots; r++) {
		const unit = (k: number) => draw(input, Purpose.Root, r, k);
		const out = heading + (r / Math.max(1, roots)) * 2 * PI + (unit(0) - 0.5) * 0.8;
		const droop = radians(spreadAt(soil.droop, unit(1)));
		const length = spreadAt(soil.rootLength, unit(2));
		const start = host === crown ? -0.02 : -0.01;
		const margin = host === crown ? growth.base : 0.01;
		const from: Vector3 = [cos(out) * margin * unit(3), start, sin(out) * margin * unit(3)];
		rootPath(builder, host, hostNode, from, out, -droop, length, soil.rootRadius);
	}
}

/**
 * Adds a root's axis: nodes running out from the crown and down below the soil, its radius closing
 * to a point at the end.
 */
function rootPath(
	builder: SkeletonBuilder,
	parent: number,
	parentNode: number,
	start: Readonly<Vector3>,
	heading: number,
	elevation: number,
	length: number,
	radius: number,
): void {
	const axis = builder.addAxis({ parent, parentNode, parentT: 1, order: 1, kind: AXIS_ROOT });
	const nodes = 4;
	const p: Vector3 = [start[0], start[1], start[2]];
	const step = length / (nodes - 1);
	let previous = parentNode;
	for (let i = 0; i < nodes; i++) {
		const share = i / (nodes - 1);
		if (i > 0) {
			const d = inPlane(heading, elevation - radians(25) * share);
			p[0] += d[0] * step;
			p[1] += d[1] * step;
			p[2] += d[2] * step;
		}
		previous = builder.addNode({
			x: p[0],
			y: p[1],
			z: p[2],
			radius: radius * (1 - 0.85 * share),
			parent: i === 0 ? parentNode : previous,
			axis,
			light: 1,
		});
	}
}

/** The signed angle from one heading to another, from -π to π. */
function angleBetween(from: number, to: number): number {
	let d = (from - to) % (2 * PI);
	if (d > PI) d -= 2 * PI;
	if (d < -PI) d += 2 * PI;
	return d;
}

/** How finely each level draws: blade detail, stem faces, and whether the finest parts draw. */
interface TuftLevel {
	readonly blade: BladeDetail;
	readonly stemSides: (sides: number) => number;
	readonly fine: boolean;
	readonly shortest: number;
}

function levelOf(detail: Detail, level: MeshLevel): TuftLevel {
	if (level === 0)
		return {
			blade: { rows: BLADE_ROWS[detail], across: BLADE_ACROSS[detail] },
			stemSides: (sides) =>
				detail === 'low' ? 3 : sides <= 3 ? 3 : detail === 'medium' ? 4 : sides,
			fine: true,
			shortest: 0,
		};
	if (level === 1)
		return { blade: { rows: 4, across: 1 }, stemSides: () => 3, fine: true, shortest: 0.25 };
	return { blade: { rows: 2, across: 0 }, stemSides: () => 3, fine: false, shortest: 0.5 };
}

/**
 * Meshes a tuft's merged foliage at a level: every blade along its axis, the sheath columns, the
 * flowering stems, and a panicle's branches or a sedge's spike stalks.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @returns The foliage's mesh.
 */
export function meshTuft(input: MeshInput, level: MeshLevel): MeshArrays {
	const { blade, growth } = tuftOf(input.record);
	// A species that gives its sheath columns a colour reserves the flutter byte's top bit for the
	// sheath mark, so every other foliage axis keeps its phase in the low seven bits. A species
	// without the colour leaves every byte as it was.
	const sheathed = growth.sheathColour !== undefined;
	const { skeleton, crown, kit } = input;
	const axes = skeleton.axes;
	const tiers = levelOf(input.detail, level);
	const texture = bladeTexture(kit.manifest);
	const strip = leafStrip(kit.manifest);
	const stems = stalkRange(strip);
	const buds = terminalBuds(skeleton);
	const meanLength = spreadMean(blade.length);
	// A ligule stands at the blade's collar only at the nearest and finest detail, where a close
	// view can read it; the farther levels and the kit's pressed leaf draw none.
	const ligule =
		blade.ligule && (input.detail === 'high' || input.detail === 'ultra')
			? { length: spreadMean(blade.ligule.length), width: blade.ligule.width }
			: undefined;
	const liguleShare = blade.ligule?.share ?? 1;
	const mesh = new MeshWriter();
	const season = input.season;
	const browning =
		season === 'autumn'
			? 0.2
			: season === 'winter' && input.record.seasons.winter !== 'evergreen'
				? 0.6
				: 0;
	for (let a = 0; a < axes.count; a++) {
		const kind = axes.kind[a] as number;
		const raw = axisBytes(input, a);
		const bytes = sheathed ? { ...raw, phase: raw.phase >> 1 } : raw;
		if (kind === AXIS_ROOT) {
			// The crown's own axis holds the shoots and draws nothing itself; a rhizome and the
			// roots lie along its soil and draw as tubes, the roots closing to a point. They stand
			// only at the nearest level: a farther view sees them under the crown, not beside it.
			if (a === 0 || level > 0) continue;
			const path = wholePath(skeleton, a, [0, 1, 0]);
			if (!path || path.length < 1e-4) continue;
			const first = axes.first[a] as number;
			const last = axes.last[a] as number;
			const r0 = skeleton.radius[first] as number;
			const r1 = skeleton.radius[last] as number;
			writeStem(mesh, {
				path,
				from: 0,
				to: path.length,
				rings: Math.max(2, last - first + 1),
				radius: (share) => r0 + (r1 - r0) * share,
				section: { sides: level === 0 ? 4 : 3 },
				v: stems,
				uHalf: strip.stalkHalf,
				bytes,
				crown,
				along: [0, 0.05],
				browning: 0.3,
				closeTip: true,
			});
			continue;
		}
		if (kind === AXIS_LEAF) {
			const bud = buds[a] as number;
			const face: [number, number, number] = [0, 1, 0];
			if (bud >= 0) {
				const q = skeleton.buds.frame.subarray(bud * 4, bud * 4 + 4);
				const z = rotateZ(q);
				face[0] = z[0];
				face[1] = z[1];
				face[2] = z[2];
			}
			const path = wholePath(skeleton, a, face);
			if (!path || path.length < tiers.shortest * meanLength) continue;
			const age = bud >= 0 ? (skeleton.buds.vigor[bud] as number) : 0.5;
			const key = axisKey(skeleton, a);
			const scale = Math.min(1.6, path.length / Math.max(1e-6, meanLength));
			const rows = Math.max(2, Math.round(tiers.blade.rows * Math.min(2.5, Math.max(0.6, scale))));
			writeBlade(
				mesh,
				path,
				{
					length: path.length,
					width: blade.width * (0.7 + 0.3 * Math.min(1, scale)),
					blade,
					twist:
						blade.twist *
						(0.4 + 1.2 * unitAt(input.seed, key, 1)) *
						(unitAt(input.seed, key, 2) < 0.5 ? -1 : 1),
					browning,
					dry: 0.35 + 0.65 * age * age,
					...(ligule && unitAt(input.seed, key, 7) < liguleShare ? { ligule } : {}),
				},
				{ rows, across: tiers.blade.across },
				texture,
				bytes,
				crown,
			);
			continue;
		}
		const fine = (axes.order[a] as number) >= 3;
		if (fine && !tiers.fine) continue;
		const isStem = kind === AXIS_CULM;
		if (!isStem && !fine && level === 2) continue;
		const path = wholePath(skeleton, a, [0, 1, 0]);
		if (!path) continue;
		const sides = isStem ? (growth.heads?.sides ?? 5) : fine ? 3 : 6;
		const first = axes.first[a] as number;
		const last = axes.last[a] as number;
		const r0 = skeleton.radius[first] as number;
		const r1 = skeleton.radius[last] as number;
		writeStem(mesh, {
			path,
			from: 0,
			to: path.length,
			rings: Math.max(2, Math.min(last - first + 1, isStem ? (level === 0 ? 12 : 5) : 4)),
			radius: (share) => r0 + (r1 - r0) * share,
			section: {
				sides: tiers.stemSides(sides),
				...(isStem && sides === 3 ? { shape: triangle } : {}),
			},
			v: stems,
			uHalf: strip.stalkHalf,
			bytes,
			crown,
			along: isStem ? [0, 1] : fine ? [0.85, 1] : [0, 0.05],
			// A sheath column carries a sentinel browning value, which the plant material reads as
			// the record's sheath colour; every other stalk browns as the season gives.
			browning: isStem ? Math.max(browning, 0.15) : Math.max(browning, 0.3),
			closeTip: isStem || fine,
			// The shoot's sheath column is the one merged-foliage run a sheath colour draws.
			sheath: !isStem && !fine && sheathed,
		});
	}
	return mesh.finishMesh();
}

/** A three-angled stem's section: rounded corners, flat faces. */
function triangle(angle: number): number {
	return 0.8 + 0.2 * cos(3 * angle);
}

/** The +Z axis of a frame quaternion. */
function rotateZ(q: ArrayLike<number>): [number, number, number] {
	const x = q[0] as number;
	const y = q[1] as number;
	const z = q[2] as number;
	const w = q[3] as number;
	return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
}

/** The tuft grower. */
export const grower: Grower = {
	grow: growTuft,
	foliage: meshTuft,
};
