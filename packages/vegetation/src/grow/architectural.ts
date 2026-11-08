// The architectural grower: one leader carries the crown, and tiers of boughs leave it at the
// heights that the record's whorl spacing gives. Each bough runs out at the angle its height in the
// crown sets, sags under its own weight and turns its tip up, and divides into the orders below it
// by the same positional numbers. The boughs and their branches stop at the envelope, so the plant
// fills the outline its reference measured. Every axis draws its thickness from the pipe model,
// fitted to the species' diameter at breast height. Bud sites stand on the finest axes and at every
// axis's tip, where the shoot prototypes attach.
import {
	AXIS_LIMB,
	AXIS_STEM,
	BUD_LATERAL,
	BUD_TERMINAL,
	type MacroSkeleton,
	NODE_FORK,
	NODE_SHED,
	NODE_STUB,
	SkeletonBuilder,
} from '../core/graph';
import { unitAt } from '../core/hash';
import {
	atan2,
	cos,
	cross3,
	normalize3,
	PI,
	pow,
	quatAxisAngle,
	quatFromFrame,
	quatRotate,
	radians,
	sin,
	type Vector3,
} from '../core/math';
import type { Architectural, ArchitecturalOrder, Phyllotaxis, Species } from '../core/record';
import { curveAt, spreadAt, spreadMean } from '../core/types';
import type { GrowInput } from '../stages';
import { type EnvelopeVolume, envelopeVolume, insetVolume } from './envelope';
import type { Grower } from './models';

/** The golden angle in degrees, which spreads successive children round their parent. */
const GOLDEN = 137.50776405;
/** The height at which a plant's girth is fitted to the record's diameter. */
const BREAST_HEIGHT = 1.3;
/** The pipe model's exponent and twig radius where a record gives none. */
const DEFAULT_EXPONENT = 2.3;
const DEFAULT_TIP_RADIUS = 0.005;
/** The least share of its girth a stem keeps from one node to the next. */
const DEFAULT_LEADER_KEEP = 0.7;
/** The least share of its girth any other axis keeps from one node to the next. */
const BRANCH_KEEP = 0.5;
/** The most nodes one axis draws, so a long bough stays a straight run of few pieces. */
const MOST_NODES = 24;
/** The shortest step between two nodes of an axis, in metres. */
const LEAST_STEP = 0.03;
/** The share of a bough's length over which its own weight pulls it down. */
const SAG_SHARE = 0.6;
/** The share of a bough's length from which reaction wood turns its tip back up. */
const UPTURN_FROM = 0.55;
/** The share of the crown's height at which the uppermost whorl stands, so the top carries boughs. */
const TOP_WHORL = 0.97;
/** The most children one parent node puts out from a whorled arrangement. */
const MOST_WHORL = 8;

/** The choices an axis makes, each its own hash purpose. */
const Purpose = {
	Height: 1,
	Turn: 2,
	Whorl: 3,
	WhorlCount: 4,
	WhorlTurn: 5,
	Between: 6,
	BetweenAt: 7,
	BetweenTurn: 8,
	StubCount: 9,
	StubAt: 10,
	StubTurn: 11,
	ChildCount: 12,
	ChildAzimuth: 13,
	ChildSpread: 14,
	BudLight: 15,
	Lean: 16,
	Wander: 17,
} as const;

/** One node of one axis. */
interface GrownNode {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	/** The direction the axis runs in at this node, a unit vector. */
	readonly direction: Vector3;
	/** The node's radius in metres, which the pipe model sets after growth. */
	radius: number;
	/** Sky visibility at the node, 0 to 1. */
	readonly light: number;
	/** Years since the node formed. */
	readonly age: number;
	readonly flags: number;
}

/** One axis of the plant: a leader, a bough or a branch of a lower order. */
interface GrownAxis {
	/** The botanical order: 0 for the leader. */
	readonly order: number;
	/** The axis it leaves, or -1 for the leader. */
	readonly parent: number;
	/** The index in the parent's nodes where it leaves. */
	readonly parentNode: number;
	readonly kind: number;
	/** Metres of bark along the parent to the junction. */
	readonly barkV: number;
	/** Radians about the parent where the axis leaves. */
	readonly barkU: number;
	/** The nodes from the base to the tip. */
	readonly nodes: GrownNode[];
	/** The axes that leave this one. */
	readonly children: number[];
}

/** One bud site before the skeleton is written. */
interface GrownBud {
	readonly axis: number;
	readonly node: number;
	/** The direction the shoot leaves in, a unit vector. */
	readonly direction: Vector3;
	/** The direction the shoot's sky side faces, a unit vector. */
	readonly sky: Vector3;
	/** How far from the node's centre the bud sits, in metres. */
	readonly offset: number;
	readonly kind: number;
	readonly vigor: number;
	readonly light: number;
}

/** The record's architectural growth, or an error for another model. */
function growthOf(record: Species): Architectural {
	if (record.growth.model !== 'architectural')
		throw new Error(`@null3d/vegetation: ${record.id} does not grow by the architectural model`);
	return record.growth;
}

/** Metres a species' shoots reach from their bud sites: the mean shoot length, by class share. */
function shootReach(record: Species): number {
	const shoots = record.shoots;
	if (!shoots) return 0;
	let reach = 0;
	let shares = 0;
	for (const shoot of shoots.classes) {
		reach += shoot.share * spreadMean(shoot.length);
		shares += shoot.share;
	}
	return shares > 0 ? reach / shares : 0;
}

/** A number kept within a range. */
function clamp(value: number, low: number, high: number): number {
	return Math.max(low, Math.min(high, value));
}

/** The share of the way along a parent where a child stands, 0 to 1. */
function share(axis: GrownAxis, node: number): number {
	return axis.nodes.length > 1 ? node / (axis.nodes.length - 1) : 0;
}

/** A unit vector tilted `tilt` radians from vertical, toward an azimuth. */
function directionFromVertical(tilt: number, azimuth: number): Vector3 {
	const across = sin(tilt);
	return [across * cos(azimuth), cos(tilt), across * sin(azimuth)];
}

/** Turns a direction up or down about the horizontal axis square to its own run. */
function turnUp(direction: Vector3, degrees: number): Vector3 {
	if (Math.abs(degrees) < 1e-6) return direction;
	let hx = direction[0];
	let hz = direction[2];
	const flat = Math.sqrt(hx * hx + hz * hz);
	if (flat < 1e-6) {
		hx = 1;
		hz = 0;
	} else {
		hx /= flat;
		hz /= flat;
	}
	// The horizontal axis square to the run: turning about it raises the run's tip.
	const side: Vector3 = [-hz, 0, hx];
	const q = [0, 0, 0, 1];
	quatAxisAngle(side, radians(degrees), q);
	const out: Vector3 = [0, 0, 0];
	quatRotate(q, 0, direction, out);
	return normalize3(out);
}

/** A lateral direction round a tangent, `azimuth` radians from the tangent's first across. */
function lateralAt(tangent: Readonly<Vector3>, azimuth: number): Vector3 {
	const reference: Vector3 = Math.abs(tangent[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
	const across = normalize3(cross3(tangent, reference, [0, 0, 0]));
	const up = normalize3(cross3(tangent, across, [0, 0, 0]));
	const c = cos(azimuth);
	const s = sin(azimuth);
	return normalize3([
		across[0] * c + up[0] * s,
		across[1] * c + up[1] * s,
		across[2] * c + up[2] * s,
	]);
}

/** The horizontal direction across a tangent's run, which a flattened spray lies along. */
function horizontalAt(tangent: Readonly<Vector3>): Vector3 {
	const flat = Math.sqrt(tangent[0] * tangent[0] + tangent[2] * tangent[2]);
	if (flat < 1e-6) return [1, 0, 0];
	return [-tangent[2] / flat, 0, tangent[0] / flat];
}

/** The azimuths a node puts out around its parent, by the order's arrangement. */
function azimuthsOf(arrangement: Phyllotaxis, node: number, start: number): number[] {
	switch (arrangement.kind) {
		case 'spiral':
			return [start + node * arrangement.divergence];
		case 'fascicle':
			return [start + node * GOLDEN];
		case 'distichous':
			return [start + node * 180];
		case 'opposite': {
			const a = start + (arrangement.decussate ? node * 90 : 0);
			return [a, a + 180];
		}
		case 'whorled': {
			const count = clamp(Math.round(arrangement.count), 2, MOST_WHORL);
			const a = start + (node * 180) / count;
			const out: number[] = [];
			for (let k = 0; k < count; k++) out.push(a + (k * 360) / count);
			return out;
		}
		case 'rosette-spur':
			return [start];
	}
}

/** The record's pipe numbers, with their defaults. */
function pipeOf(g: Architectural): { exponent: number; tip: number; leader: number } {
	return {
		exponent: Math.max(0.1, g.pipe?.exponent ?? DEFAULT_EXPONENT),
		tip: Math.max(1e-5, g.pipe?.tipRadius ?? DEFAULT_TIP_RADIUS),
		leader: clamp(g.pipe?.leader ?? DEFAULT_LEADER_KEEP, 0.5, 1),
	};
}

/**
 * Grows one architectural plant: its leader, the tiers of boughs the leader carries, the orders
 * below them, and the bud sites that the shoot prototypes stand on.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The skeleton.
 */
export function growArchitectural(input: GrowInput): MacroSkeleton {
	const { record, variant } = input;
	const seed = input.seed >>> 0;
	const salt = record.seedSalt >>> 0;
	const g = growthOf(record);
	const draw = (purpose: number, a = 0, b = 0): number =>
		unitAt(seed, salt, variant, purpose, a * 4096 + b);
	const height = spreadAt(record.size.height, draw(Purpose.Height));
	const turn = draw(Purpose.Turn) * 2 * PI;
	const crownBase = clamp(g.tiers.start, 0, 0.95) * height;
	const crownSpan = Math.max(0.001, height - crownBase);

	// The outline caps the wood, with room left for the shoots that attach beyond it.
	const volume: EnvelopeVolume | undefined = record.envelope
		? insetVolume(
				envelopeVolume(record.envelope, height, turn),
				Math.max(0, shootReach(record) * 0.6),
			)
		: undefined;

	const axes: GrownAxis[] = [];
	const buds: GrownBud[] = [];
	const pipe = pipeOf(g);
	const maxOrder = Math.max(1, g.orders.length);

	/** Sky visibility at a point, from how deep it stands inside the outline and its height. */
	const lightAt = (x: number, y: number, z: number): number => {
		if (!volume) return clamp(0.35 + 0.65 * (y / Math.max(1e-6, height)), 0, 1);
		const across = Math.sqrt(x * x + z * z);
		const radius = volume.radius(y, atan2(z, x));
		if (!(radius > 0)) return 1;
		const depth = clamp(1 - across / radius, 0, 1);
		return clamp(0.12 + 0.88 * (1 - depth) * (1 - depth), 0, 1);
	};

	/** The age a node of this height carries, oldest at the ground. */
	const ageAt = (y: number): number =>
		Math.round(clamp((height - y) / Math.max(1, height), 0, 1) * 12);

	/** Adds one axis and returns its index. */
	const addAxis = (
		order: number,
		parent: number,
		parentNode: number,
		kind: number,
		barkV: number,
		barkU: number,
	): number => {
		const index = axes.length;
		axes.push({ order, parent, parentNode, kind, barkV, barkU, nodes: [], children: [] });
		if (parent >= 0) (axes[parent] as GrownAxis).children.push(index);
		return index;
	};

	/** Adds a node to an axis. */
	const pushNode = (
		axis: number,
		x: number,
		y: number,
		z: number,
		direction: Vector3,
		flags: number,
	): number => {
		const nodes = (axes[axis] as GrownAxis).nodes;
		nodes.push({
			x,
			y,
			z,
			direction,
			radius: pipe.tip,
			light: lightAt(x, y, z),
			age: ageAt(y),
			flags,
		});
		return nodes.length - 1;
	};

	// The leader: a straight stem, bent by the record's curve and wandered a little, from the ground
	// to the crown's top. Its nodes follow one another up the stem, one step apart.
	const leaderSteps = Math.max(12, Math.round(height / 0.35));
	const lean = radians(clamp(g.leader.curve, 0, 45));
	const leanAzimuth = draw(Purpose.Lean) * 2 * PI;
	const wander = radians(clamp(g.leader.wander, 0, 30));
	const wanderPhase = draw(Purpose.Wander) * 2 * PI;
	const stepLength = height / (leaderSteps * Math.max(0.2, cos(lean * 0.5)));
	const leader = addAxis(0, -1, -1, AXIS_STEM, 0, 0);
	let lx = 0;
	let ly = 0;
	let lz = 0;
	const leaderNodes: number[] = [];
	for (let i = 0; i <= leaderSteps; i++) {
		if (i > 0) {
			const t = i / leaderSteps;
			const tilt = lean * t;
			const az = leanAzimuth + wander * 0.5 * sin(i * 0.8 + wanderPhase);
			const direction = directionFromVertical(tilt, az);
			lx += direction[0] * stepLength;
			ly += direction[1] * stepLength;
			lz += direction[2] * stepLength;
		}
		const t = i / leaderSteps;
		const az = leanAzimuth + wander * 0.5 * sin(i * 0.8 + wanderPhase);
		leaderNodes.push(pushNode(leader, lx, ly, lz, directionFromVertical(lean * t, az), 0));
	}

	/** The leader node nearest a height. */
	const leaderNodeAt = (y: number): number => {
		let best = 0;
		let gap = Number.POSITIVE_INFINITY;
		for (let i = 0; i < leaderNodes.length; i++) {
			const node = i;
			const distance = Math.abs(((axes[leader] as GrownAxis).nodes[node] as GrownNode).y - y);
			if (distance < gap) {
				gap = distance;
				best = node;
			}
		}
		return best;
	};

	/** The step an axis of this length draws: enough nodes to bend and to carry its shoots. */
	const stepFor = (length: number): { step: number; count: number } => {
		const count = clamp(Math.round(length / Math.max(0.06, length / 18)), 2, MOST_NODES);
		return { step: Math.max(LEAST_STEP, length / count), count };
	};

	/**
	 * Grows one axis out from its parent, capping its run at the envelope. Children and bud sites
	 * follow from the axis's order.
	 */
	const growAxis = (
		order: number,
		parent: number,
		parentNode: number,
		from: Vector3,
		direction: Vector3,
		budget: number,
		shape: ArchitecturalOrder,
		barkV: number,
		barkU: number,
		flags: number,
	): number => {
		const axis = addAxis(order, parent, parentNode, AXIS_LIMB, barkV, barkU);
		const { step, count } = stepFor(budget);
		const sag = clamp(shape.sag, 0, 90);
		const upturn = clamp(shape.upturn, 0, 90);
		const curve = clamp(shape.curve, -90, 90);
		let x = from[0];
		let y = from[1];
		let z = from[2];
		let heading = direction;
		for (let i = 0; i < count; i++) {
			const t = (i + 1) / count;
			// The run's own weight pulls it down over the first part, reaction wood turns the tip
			// back up over the last, and the record's curve bends it throughout.
			let up = curve / count;
			if (t <= SAG_SHARE) up -= sag / (count * SAG_SHARE);
			if (t >= UPTURN_FROM) up += upturn / (count * (1 - UPTURN_FROM));
			heading = turnUp(heading, up) as Vector3;
			let nx = x + heading[0] * step;
			let ny = y + heading[1] * step;
			let nz = z + heading[2] * step;
			if (volume) {
				// The bough stops at the outline: a step that leaves it is shortened to the boundary.
				if (volume.room(nx, ny, nz) < 0) {
					let low = 0;
					let high = 1;
					for (let k = 0; k < 12; k++) {
						const mid = (low + high) / 2;
						const px = x + (nx - x) * mid;
						const py = y + (ny - y) * mid;
						const pz = z + (nz - z) * mid;
						if (volume.room(px, py, pz) >= 0) low = mid;
						else high = mid;
					}
					nx = x + (nx - x) * low;
					ny = y + (ny - y) * low;
					nz = z + (nz - z) * low;
					pushNode(axis, nx, ny, nz, heading, i === 0 ? flags : 0);
					break;
				}
			}
			pushNode(axis, nx, ny, nz, heading, i === 0 ? flags : 0);
			x = nx;
			y = ny;
			z = nz;
		}
		const grown = axes[axis] as GrownAxis;
		if (grown.nodes.length < 2) {
			// An axis the outline leaves no room for draws one short piece, so its join still shows.
			pushNode(
				axis,
				from[0] + direction[0] * step * 0.5,
				from[1] + direction[1] * step * 0.5,
				from[2] + direction[2] * step * 0.5,
				direction,
				0,
			);
		}
		const nodes = (axes[axis] as GrownAxis).nodes;

		// The orders below this one: their length and angle curves run over the parent's position.
		if (order < maxOrder) {
			const childShape = g.orders[order] as ArchitecturalOrder;
			const density = curveAt(childShape.density, 0.5);
			const parentLength = Math.max(0, step * (nodes.length - 1));
			const wanted = Math.max(0, Math.round(density * parentLength));
			// Successive axes start their children at their own turn round the parent, so the
			// branches of two neighbouring boughs do not line up.
			const start = (axis * GOLDEN) % 360;
			for (let m = 0; m < wanted; m++) {
				// A bough's inner length stands bare near the trunk; its branches begin on the
				// outer part, as the reference's long limbs do.
				const from = order === 1 ? 0.3 : 0.15;
				const at = clamp((m + 0.5) / Math.max(1, wanted), from, 0.98);
				const node = Math.round(at * (nodes.length - 1));
				const parentNodeData = nodes[node] as GrownNode;
				const tangent = parentNodeData.direction;
				const az = azimuthsOf(childShape.arrangement, m, start);
				const flat = clamp(childShape.flatten, 0, 1);
				for (const azimuth of az) {
					const round = lateralAt(tangent, radians(azimuth));
					// A flattened spray stands its children level across the parent; the flat
					// direction is the horizontal one, kept square to the parent's run.
					const flatTo = horizontalAt(tangent);
					const along = dot(flatTo, tangent);
					let side = normalize3([
						flatTo[0] - tangent[0] * along,
						flatTo[1] - tangent[1] * along,
						flatTo[2] - tangent[2] * along,
					]);
					if (side[0] * side[0] + side[1] * side[1] + side[2] * side[2] < 1e-6) side = round;
					// A sign keeps the flattened children on the side their arrangement chose.
					if (dot(round, side) < 0) side = [-side[0], -side[1], -side[2]];
					const lateral = normalize3([
						round[0] * (1 - flat) + side[0] * flat,
						round[1] * (1 - flat) + side[1] * flat,
						round[2] * (1 - flat) + side[2] * flat,
					]);
					const angle = radians(curveAt(childShape.angle, at));
					const childDirection = normalize3([
						tangent[0] * cos(angle) + lateral[0] * sin(angle),
						tangent[1] * cos(angle) + lateral[1] * sin(angle),
						tangent[2] * cos(angle) + lateral[2] * sin(angle),
					]);
					const childLength = Math.max(0.01, curveAt(childShape.length, at));
					growAxis(
						order + 1,
						axis,
						node,
						[parentNodeData.x, parentNodeData.y, parentNodeData.z],
						childDirection,
						childLength,
						childShape,
						barkV + at * parentLength,
						azimuth,
						0,
					);
				}
			}
		}

		// Bud sites: along the finest axes and at every axis's tip, where a shoot carries the leaves.
		if (order === maxOrder) {
			for (let i = 0; i < nodes.length; i++) {
				const node = nodes[i] as GrownNode;
				const at = share(grown, i);
				// The crown's lower and inner tips carry fewer shoots: the mass of the foliage stands
				// in the lit upper plates, as the reference's umbrella does.
				const crownT = clamp((node.y - crownBase) / Math.max(1e-6, height - crownBase), 0, 1);
				if (i === nodes.length - 1) {
					addBud(
						axis,
						i,
						node.direction,
						skyOf(node.direction, [1, 0, 0]),
						BUD_TERMINAL,
						(0.55 + 0.45 * crownT) * (0.7 + 0.3 * at),
						0,
					);
					continue;
				}
				const lateral = lateralAt(node.direction, radians(i * GOLDEN));
				const outward = normalize3([
					lateral[0] - node.direction[0] * dot(lateral, node.direction),
					lateral[1] - node.direction[1] * dot(lateral, node.direction),
					lateral[2] - node.direction[2] * dot(lateral, node.direction),
				]);
				const shootDirection = normalize3([
					node.direction[0] * 0.6 + outward[0] * 0.8,
					node.direction[1] * 0.6 + outward[1] * 0.8,
					node.direction[2] * 0.6 + outward[2] * 0.8,
				]);
				addBud(
					axis,
					i,
					shootDirection,
					skyOf(shootDirection, outward),
					BUD_LATERAL,
					(0.2 + 0.55 * at) * (0.5 + 0.5 * crownT),
					node.radius,
				);
			}
		} else {
			const tip = nodes[nodes.length - 1] as GrownNode;
			addBud(
				axis,
				nodes.length - 1,
				tip.direction,
				skyOf(tip.direction, [1, 0, 0]),
				BUD_TERMINAL,
				0.85,
				0,
			);
		}
		return axis;
	};

	/** Adds a bud site to the list, with its sky side kept square to the shoot. */
	const addBud = (
		axis: number,
		node: number,
		direction: Vector3,
		sky: Vector3,
		kind: number,
		vigor: number,
		offset: number,
	): void => {
		const data = (axes[axis] as GrownAxis).nodes[node] as GrownNode;
		buds.push({
			axis,
			node,
			direction,
			sky,
			offset,
			kind,
			vigor: clamp(vigor, 0, 1),
			light: data.light,
		});
	};

	// The whorls of boughs: one whorl every spacing metres of the crown, each a ring of boughs.
	const boughShape = g.orders[0] as ArchitecturalOrder;
	let whorl = 0;
	for (let y = crownBase; y < height * TOP_WHORL; ) {
		const t = clamp((y - crownBase) / crownSpan, 0, 1);
		const spacing = Math.max(0.15, curveAt(g.tiers.spacing, t));
		const node = leaderNodeAt(y);
		const leaderNode = (axes[leader] as GrownAxis).nodes[node] as GrownNode;
		const base = whorl * GOLDEN + (draw(Purpose.WhorlTurn, whorl) - 0.5) * 30;
		const count = clamp(
			Math.round(
				spreadAt(g.tiers.perWhorl, draw(Purpose.WhorlCount, whorl)) *
					curveAt(boughShape.density, t),
			),
			1,
			MOST_WHORL,
		);
		for (let k = 0; k < count; k++) {
			const azimuth = base + (k * 360) / count + (draw(Purpose.Whorl, whorl, k) - 0.5) * 16;
			growAxis(
				1,
				leader,
				node,
				[leaderNode.x, leaderNode.y, leaderNode.z],
				boughDirection(leaderNode.direction, boughShape, t, radians(azimuth)),
				Math.max(0.05, curveAt(boughShape.length, t)),
				boughShape,
				y,
				radians(azimuth),
				0,
			);
		}
		// The small boughs between whorls break the candelabra's regularity, as the reference's do.
		const between = Math.max(0, g.tiers.between);
		if (between > 0) {
			const want = Math.floor(between * spacing + draw(Purpose.Between, whorl));
			for (let m = 0; m < want; m++) {
				const at = (m + 0.5 + draw(Purpose.BetweenAt, whorl, m) * 0.6) / Math.max(1, want);
				const heightAt = Math.min(height * TOP_WHORL, y + at * spacing);
				const near = leaderNodeAt(heightAt);
				const nearNode = (axes[leader] as GrownAxis).nodes[near] as GrownNode;
				const azimuth =
					base + 180 / Math.max(1, want) + m * GOLDEN + draw(Purpose.BetweenTurn, whorl, m) * 60;
				growAxis(
					1,
					leader,
					near,
					[nearNode.x, nearNode.y, nearNode.z],
					boughDirection(
						nearNode.direction,
						boughShape,
						clamp((heightAt - crownBase) / crownSpan, 0, 1),
						radians(azimuth),
					),
					Math.max(0.05, curveAt(boughShape.length, t) * 0.6),
					boughShape,
					heightAt,
					radians(azimuth),
					0,
				);
			}
		}
		y += spacing;
		whorl++;
	}

	// Dead stubs on the clear bole, below the lowest live bough.
	const dead = g.tiers.deadBelow;
	if (dead.height > 0 && dead.stubs > 0) {
		const from = Math.min(dead.height * height, crownBase);
		for (let y = 0.04 * height; y < from; y += 1 / dead.stubs) {
			const node = leaderNodeAt(y);
			const leaderNode = (axes[leader] as GrownAxis).nodes[node] as GrownNode;
			const azimuth = draw(Purpose.StubTurn, whorl, Math.round(y * 10)) * 2 * PI;
			const direction = turnUp(
				normalize3([cos(azimuth), 0, sin(azimuth)]),
				-12 - draw(Purpose.StubAt, whorl, Math.round(y * 10)) * 12,
			);
			const length = 0.12 + draw(Purpose.StubCount, whorl, Math.round(y * 10)) * 0.22;
			const stub = addAxis(1, leader, node, AXIS_LIMB, y, azimuth);
			const count = 2;
			for (let i = 0; i < count; i++) {
				const t = (i + 1) / count;
				pushNode(
					stub,
					leaderNode.x + direction[0] * length * t,
					leaderNode.y + direction[1] * length * t,
					leaderNode.z + direction[2] * length * t,
					direction,
					i === 0 ? NODE_STUB | NODE_SHED : 0,
				);
			}
		}
	}

	// The leader's own tip carries a tuft, so the crown's top is not a bare spike; the upper whorls
	// build the flat plate around it.
	const topFrom = height * 0.95;
	for (let i = 0; i < leaderNodes.length; i++) {
		const node = (axes[leader] as GrownAxis).nodes[leaderNodes[i] as number] as GrownNode;
		if (node.y < topFrom) continue;
		if (leaderNodes[i] === leaderNodes[leaderNodes.length - 1]) {
			addBud(leader, i, node.direction, skyOf(node.direction, [1, 0, 0]), BUD_TERMINAL, 1, 0);
			continue;
		}
		const lateral = lateralAt(node.direction, radians(i * GOLDEN));
		const shootDirection = normalize3([
			node.direction[0] * 0.5 + lateral[0] * 0.5,
			node.direction[1] * 0.5 + lateral[1] * 0.5,
			node.direction[2] * 0.5 + lateral[2] * 0.5,
		]);
		addBud(
			leader,
			i,
			shootDirection,
			skyOf(shootDirection, lateral),
			BUD_LATERAL,
			0.8,
			node.radius,
		);
	}

	// The pipe model gives every node its thickness, and the wood is fitted to the species' girth.
	const loads = pipeLoads(axes);
	const stemRadiusAt = radiusAt(axes, leader, loads, pipe, BREAST_HEIGHT);
	const target = (record.size.dbh ?? 0) / 2;
	const scale =
		stemRadiusAt > pipe.tip && target > pipe.tip
			? (target - pipe.tip) / (stemRadiusAt - pipe.tip)
			: 1;
	axes.forEach((axis, a) => {
		let previous = pipe.tip;
		const carry = loads.load[a] as number[];
		axis.nodes.forEach((node, i) => {
			const raw = pipe.tip * pow(Math.max(1, carry[i] as number), 1 / pipe.exponent);
			let radius = pipe.tip + (raw - pipe.tip) * scale;
			// A continuation that halves its girth at one node draws as a cone: keep a share.
			const keep = axis.order === 0 ? pipe.leader : BRANCH_KEEP;
			if (i > 0) radius = Math.max(radius, keep * previous);
			node.radius = radius;
			previous = radius;
		});
	});

	return emitSkeleton(axes, buds, crownBase);
}

/** The direction a bough leaves the stem: its height in the crown sets the angle from the stem. */
function boughDirection(
	stemDirection: Vector3,
	shape: ArchitecturalOrder,
	t: number,
	azimuth: number,
): Vector3 {
	const angle = radians(curveAt(shape.angle, t));
	const side = lateralAt(stemDirection, azimuth);
	return normalize3([
		stemDirection[0] * cos(angle) + side[0] * sin(angle),
		stemDirection[1] * cos(angle) + side[1] * sin(angle),
		stemDirection[2] * cos(angle) + side[2] * sin(angle),
	]);
}

/** A dot product. */
function dot(a: Readonly<Vector3>, b: Readonly<Vector3>): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** The sky side of a shoot: the world's up, square to the shoot's direction. */
function skyOf(direction: Vector3, fallback: Vector3): Vector3 {
	const up: Vector3 = [0, 1, 0];
	const along = dot(up, direction);
	let x = up[0] - direction[0] * along;
	let y = up[1] - direction[1] * along;
	let z = up[2] - direction[2] * along;
	const length = Math.sqrt(x * x + y * y + z * z);
	if (length < 1e-6) return fallback;
	x /= length;
	y /= length;
	z /= length;
	return [x, y, z];
}

/** The pipe load at each node of each axis, from the tips down. */
function pipeLoads(axes: readonly GrownAxis[]): { load: number[][] } {
	const load = axes.map((axis) => new Array<number>(axis.nodes.length).fill(0));
	// Children are created after their parents, so walking backwards carries each child's load in.
	for (let a = axes.length - 1; a >= 0; a--) {
		const axis = axes[a] as GrownAxis;
		const carry = load[a] as number[];
		for (const child of axis.children) {
			const childAxis = axes[child] as GrownAxis;
			const childCarry = load[child] as number[];
			carry[childAxis.parentNode] =
				(carry[childAxis.parentNode] as number) + (childCarry[0] as number);
		}
		const last = carry.length - 1;
		// A dead stub carries no shoot and adds no pipe to the wood.
		const stub = ((axis.nodes[0] as GrownNode).flags & NODE_STUB) !== 0;
		if (!stub) carry[last] = (carry[last] as number) + 1;
		for (let i = last; i > 0; i--) carry[i - 1] = (carry[i - 1] as number) + (carry[i] as number);
	}
	return { load };
}

/** The radius of an axis at a height, interpolated along its nodes. */
function radiusAt(
	axes: readonly GrownAxis[],
	axis: number,
	loads: { load: number[][] },
	pipe: { exponent: number; tip: number },
	height: number,
): number {
	const nodes = (axes[axis] as GrownAxis).nodes;
	const carry = loads.load[axis] as number[];
	const radiusAtNode = (i: number): number =>
		pipe.tip * pow(Math.max(1, carry[i] as number), 1 / pipe.exponent);
	let previous = -1;
	for (let i = 0; i < nodes.length; i++) {
		const y = (nodes[i] as GrownNode).y;
		if (y >= height) {
			if (previous < 0) return radiusAtNode(i);
			const y0 = (nodes[previous] as GrownNode).y;
			const w = y > y0 ? (height - y0) / (y - y0) : 0;
			return radiusAtNode(previous) * (1 - w) + radiusAtNode(i) * w;
		}
		previous = i;
	}
	return previous >= 0 ? radiusAtNode(previous) : pipe.tip;
}

/** Writes the grown axes and buds into the skeleton's typed arrays, one axis's nodes after another. */
function emitSkeleton(
	axes: readonly GrownAxis[],
	buds: readonly GrownBud[],
	crownBase: number,
): MacroSkeleton {
	const builder = new SkeletonBuilder();
	const outAxis = new Array<number>(axes.length).fill(-1);
	const outFirst = new Array<number>(axes.length).fill(-1);
	const emit = (a: number): void => {
		const axis = axes[a] as GrownAxis;
		const parentAxis = axis.parent >= 0 ? (outAxis[axis.parent] as number) : -1;
		const parentNode = axis.parent >= 0 ? (outFirst[axis.parent] as number) + axis.parentNode : -1;
		const out = builder.addAxis({
			parent: parentAxis,
			parentNode,
			parentT: 0,
			order: axis.order,
			kind: axis.kind,
			barkV: axis.barkV,
			barkU: axis.barkU,
		});
		outAxis[a] = out;
		outFirst[a] = builder.nodeCount;
		let previous = parentNode;
		axis.nodes.forEach((node, i) => {
			previous = builder.addNode({
				x: node.x,
				y: node.y,
				z: node.z,
				radius: node.radius,
				parent: i === 0 ? parentNode : previous,
				axis: out,
				light: node.light,
				age: node.age,
				flags: node.flags,
			});
		});
		for (const child of axis.children) emit(child);
	};
	for (let a = 0; a < axes.length; a++) {
		if ((axes[a] as GrownAxis).parent < 0) emit(a);
	}

	// A child as thick as the axis it leaves marks a fork, which the mesher draws with a shared joint.
	axes.forEach((axis, a) => {
		for (const child of axis.children) {
			const childAxis = axes[child] as GrownAxis;
			if (childAxis.nodes.length === 0) continue;
			const parentIndex = (outFirst[a] as number) + childAxis.parentNode;
			const parentRadius = builder.radius[parentIndex] as number;
			const childRadius = builder.radius[outFirst[child] as number] as number;
			if (childRadius >= 0.7 * parentRadius)
				builder.flags[parentIndex] = (builder.flags[parentIndex] as number) | NODE_FORK;
		}
	});

	const frame = [0, 0, 0, 1];
	for (const bud of buds) {
		const node = (outFirst[bud.axis] as number) + bud.node;
		const axis = outAxis[bud.axis] as number;
		const direction = bud.direction;
		const data = (axes[bud.axis] as GrownAxis).nodes[bud.node] as GrownNode;
		quatFromFrame(direction, bud.sky, frame);
		const radius = data.radius;
		builder.addBud({
			node,
			x: data.x + direction[0] * bud.offset,
			y: data.y + direction[1] * bud.offset,
			z: data.z + direction[2] * bud.offset,
			frame,
			kind: bud.kind,
			vigor: bud.vigor,
			light: bud.light,
			axis,
			woodRadius: radius,
		});
	}
	return builder.finish(crownBase);
}

/** The architectural grower. */
export const grower: Grower = {
	grow: growArchitectural,
};
