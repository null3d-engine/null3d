// The self-organizing grower (Palubicki et al. 2009, with the bud fate of Stava et al. 2014): a plant
// grows one season at a time from buds that compete for light in a shadow grid. Each season every
// live bud reads its light, and side branches that hold too little light for their size, or that
// leave a stem below the clean bole, are shed. A bud flushes by its light and by the dominance of
// the flushing buds above it on its axis. The stems' resource, in proportion to the light of all
// their buds, is split up the plant among the flushing buds by the Borchert-Honda rule, whose
// control λ sets one leader (over 0.5) or a spreading crown (under 0.5), and each flushing bud grows
// as many internodes as its resource allows. Each internode leans toward the brighter room around
// it and toward or away from the sky by the species' tropisms. The envelope holds the only light: a
// shoot stops at its outline, so the crown fills the outline measured from the species' reference
// turntable. Then the radii follow the pipe model, fitted to the species' stem diameter, the wood
// bends under its load, and the live buds become the bud sites that the shoot prototypes attach to.
//
// Every choice comes from the integer hash and every angle from the core's own trigonometry, so a
// plant grows the same bytes on every script engine.
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
	exp,
	pow,
	quatFromFrame,
	quatRotate,
	radians,
	sin,
	tan,
	type Vector3,
} from '../core/math';
import type { Phyllotaxis, SelfOrganizing, Species } from '../core/record';
import { curveAt, spreadAt, spreadMean } from '../core/types';
import { ShadowGrid } from '../crown/light-grid';
import type { GrowInput } from '../stages';
import { bendUnderLoad } from './bend';
import { type EnvelopeVolume, envelopeVolume, insetVolume } from './envelope';
import type { Grower } from './models';
import { fitRadii, pipeRadii } from './radii';
import { stemStarts } from './stems';

/** Resource per unit of light at a stem's base (Palubicki's α). */
const ALPHA = 2;
/** The most internodes one bud grows in a season. */
const MOST_INTERNODES = 4;
/** Shares of a step tried, longest first, where the whole step would leave the envelope. */
const SHORT_STEPS = [0.75, 0.5, 0.3] as const;
/** Height in metres where the stem's diameter is measured. */
const BREAST_HEIGHT = 1.3;
/** A child at least this share of its parent's radius makes a fork. */
const FORK_SHARE = 0.7;

/** The hash purposes of the grower's choices, so no two draws share a key. */
const Purpose = {
	Height: 1,
	Turn: 2,
	Extinct: 3,
	Flush: 4,
	Angle: 5,
	Roll: 6,
	WanderZ: 7,
	WanderA: 8,
	Stub: 9,
} as const;

/** A branch is judged for shedding once it holds this many nodes. */
const SHED_AFTER = 3;

/** Bud states. */
const DEAD = 0;
const ALIVE = 1;

/** A copy of a typed array with room for `size` items, keeping its values. */
function widened<T extends Float64Array | Int32Array | Uint8Array>(array: T, size: number): T {
	const next = new (array.constructor as new (length: number) => T)(size);
	next.set(array);
	return next;
}

/** A number squared. */
function square(x: number): number {
	return x * x;
}

/**
 * The nodes, axes and buds of a growing plant, in typed arrays that double when they fill. Nodes,
 * axes and buds are only ever added; a shed node is marked, and a dead bud leaves the list of live
 * buds that the season's passes walk.
 */
class Plant {
	nodes = 0;
	private nodeRoom = 1024;
	x = new Float64Array(1024);
	y = new Float64Array(1024);
	z = new Float64Array(1024);
	/** The direction of the internode that ends at the node. */
	dx = new Float64Array(1024);
	dy = new Float64Array(1024);
	dz = new Float64Array(1024);
	parent = new Int32Array(1024);
	axisOf = new Int32Array(1024);
	/** The next node along the same axis, or -1 at its tip. */
	next = new Int32Array(1024);
	born = new Int32Array(1024);
	/** The first lateral bud at the node, -1 for none; buds of one node chain by `budNext`. */
	firstBud = new Int32Array(1024);
	/** 1 while the node stands, 0 once its branch is shed. */
	live = new Uint8Array(1024);
	/** Node flags of the skeleton: a stub, or a scar where a branch was shed. */
	flags = new Uint8Array(1024);
	/** Pipes of shed branches that the wood at the node still carries. */
	memory = new Float64Array(1024);
	/** The highest node's height. */
	top = 0;

	axes = 0;
	private axisRoom = 256;
	axisFirst = new Int32Array(256);
	axisTip = new Int32Array(256);
	axisParentNode = new Int32Array(256);
	axisOrder = new Int32Array(256);
	axisStem = new Int32Array(256);
	/** The axis's terminal bud, or -1. */
	axisBud = new Int32Array(256);
	/** The phyllotaxis turn of the axis's next node, in radians. */
	axisRoll = new Float64Array(256);
	/** 1 once the axis is shed or cut back to a stub. */
	axisShed = new Uint8Array(256);

	buds = 0;
	private budRoom = 2048;
	budNode = new Int32Array(2048);
	budNext = new Int32Array(2048);
	budAxis = new Int32Array(2048);
	budTerminal = new Uint8Array(2048);
	budState = new Uint8Array(2048);
	budDx = new Float64Array(2048);
	budDy = new Float64Array(2048);
	budDz = new Float64Array(2048);
	budLight = new Float64Array(2048);
	budVigor = new Float64Array(2048);
	/** The buds that may still live, in the order they were added; `compact` drops the dead. */
	alive = new Int32Array(2048);
	aliveCount = 0;

	addAxis(parentNode: number, order: number, stem: number): number {
		const a = this.axes++;
		if (a === this.axisRoom) {
			this.axisRoom *= 2;
			const size = this.axisRoom;
			this.axisFirst = widened(this.axisFirst, size);
			this.axisTip = widened(this.axisTip, size);
			this.axisParentNode = widened(this.axisParentNode, size);
			this.axisOrder = widened(this.axisOrder, size);
			this.axisStem = widened(this.axisStem, size);
			this.axisBud = widened(this.axisBud, size);
			this.axisRoll = widened(this.axisRoll, size);
			this.axisShed = widened(this.axisShed, size);
		}
		this.axisShed[a] = 0;
		this.axisFirst[a] = -1;
		this.axisTip[a] = -1;
		this.axisParentNode[a] = parentNode;
		this.axisOrder[a] = order;
		this.axisStem[a] = stem;
		this.axisBud[a] = -1;
		this.axisRoll[a] = 0;
		return a;
	}

	addNode(
		x: number,
		y: number,
		z: number,
		d: Readonly<Vector3>,
		parent: number,
		axis: number,
		born: number,
	): number {
		const n = this.nodes++;
		if (n === this.nodeRoom) {
			this.nodeRoom *= 2;
			const size = this.nodeRoom;
			this.x = widened(this.x, size);
			this.y = widened(this.y, size);
			this.z = widened(this.z, size);
			this.dx = widened(this.dx, size);
			this.dy = widened(this.dy, size);
			this.dz = widened(this.dz, size);
			this.parent = widened(this.parent, size);
			this.axisOf = widened(this.axisOf, size);
			this.next = widened(this.next, size);
			this.born = widened(this.born, size);
			this.firstBud = widened(this.firstBud, size);
			this.live = widened(this.live, size);
			this.flags = widened(this.flags, size);
			this.memory = widened(this.memory, size);
		}
		this.live[n] = 1;
		this.flags[n] = 0;
		this.memory[n] = 0;
		if (y > this.top) this.top = y;
		this.x[n] = x;
		this.y[n] = y;
		this.z[n] = z;
		this.dx[n] = d[0];
		this.dy[n] = d[1];
		this.dz[n] = d[2];
		this.parent[n] = parent;
		this.axisOf[n] = axis;
		this.next[n] = -1;
		this.born[n] = born;
		this.firstBud[n] = -1;
		const tip = this.axisTip[axis] as number;
		if (tip >= 0) this.next[tip] = n;
		else this.axisFirst[axis] = n;
		this.axisTip[axis] = n;
		return n;
	}

	addBud(node: number, axis: number, d: Readonly<Vector3>, terminal: boolean): number {
		const b = this.buds++;
		if (b === this.budRoom) {
			this.budRoom *= 2;
			const size = this.budRoom;
			this.budNode = widened(this.budNode, size);
			this.budNext = widened(this.budNext, size);
			this.budAxis = widened(this.budAxis, size);
			this.budTerminal = widened(this.budTerminal, size);
			this.budState = widened(this.budState, size);
			this.budDx = widened(this.budDx, size);
			this.budDy = widened(this.budDy, size);
			this.budDz = widened(this.budDz, size);
			this.budLight = widened(this.budLight, size);
			this.budVigor = widened(this.budVigor, size);
		}
		if (this.aliveCount === this.alive.length)
			this.alive = widened(this.alive, this.alive.length * 2);
		this.alive[this.aliveCount++] = b;
		this.budNode[b] = node;
		this.budAxis[b] = axis;
		this.budTerminal[b] = terminal ? 1 : 0;
		this.budState[b] = ALIVE;
		this.budDx[b] = d[0];
		this.budDy[b] = d[1];
		this.budDz[b] = d[2];
		this.budLight[b] = 0;
		this.budVigor[b] = 0;
		this.budNext[b] = -1;
		if (terminal) this.axisBud[axis] = b;
		else {
			this.budNext[b] = this.firstBud[node] as number;
			this.firstBud[node] = b;
		}
		return b;
	}

	/** Drops the dead buds from the list of live buds, keeping its order. */
	compact(): void {
		const { alive, budState } = this;
		let kept = 0;
		for (let k = 0; k < this.aliveCount; k++) {
			const b = alive[k] as number;
			if (budState[b] === ALIVE) alive[kept++] = b;
		}
		this.aliveCount = kept;
	}
}

/** The lateral buds one node carries, and the turn between successive nodes, for an arrangement. */
function arrangementOf(arrangement: Phyllotaxis): { count: number; step: number; flat: number } {
	switch (arrangement.kind) {
		case 'spiral':
			return { count: 1, step: radians(arrangement.divergence), flat: 0 };
		case 'distichous':
			return { count: 1, step: Math.PI, flat: arrangement.flatten };
		case 'opposite':
			return { count: 2, step: arrangement.decussate ? Math.PI / 2 : 0, flat: 0 };
		case 'whorled':
			return {
				count: Math.max(1, Math.round(arrangement.count)),
				step: Math.PI / Math.max(1, arrangement.count),
				flat: 0,
			};
		default:
			return { count: 1, step: radians(137.5), flat: 0 };
	}
}

/**
 * Two unit vectors across a direction: the first level (across the direction and the vertical), the
 * second completing the frame. A vertical direction takes +X as its first.
 */
function across(d: Readonly<Vector3>, u: Vector3, w: Vector3): void {
	let ux = d[2];
	let uz = -d[0];
	let length = Math.sqrt(ux * ux + uz * uz);
	if (length < 1e-6) {
		ux = 1;
		uz = 0;
		length = 1;
	}
	u[0] = ux / length;
	u[1] = 0;
	u[2] = uz / length;
	w[0] = d[1] * u[2] - d[2] * u[1];
	w[1] = d[2] * u[0] - d[0] * u[2];
	w[2] = d[0] * u[1] - d[1] * u[0];
}

/** Metres a species' shoots reach from their bud sites: the mean shoot length, by class share. */
export function shootReach(record: Species): number {
	const shoots = record.shoots;
	if (!shoots) return 0;
	let reach = 0;
	let shares = 0;
	for (const c of shoots.classes) {
		reach += c.share * spreadMean(c.length);
		shares += c.share;
	}
	return shares > 0 ? reach / shares : 0;
}

/** The record's self-organizing growth, or an error for another model. */
function growthOf(record: Species): SelfOrganizing {
	if (record.growth.model !== 'self-organizing')
		throw new Error(`@null3d/vegetation: ${record.id} does not grow by the self-organizing model`);
	return record.growth;
}

/**
 * Grows one plant's skeleton and bud sites.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The skeleton.
 */
export function growSelfOrganizing(input: GrowInput): MacroSkeleton {
	const { record, variant } = input;
	const seed = input.seed >>> 0;
	const salt = record.seedSalt >>> 0;
	const g = growthOf(record);
	if (!record.envelope)
		throw new Error(`@null3d/vegetation: ${record.id} needs an envelope to grow`);
	const unit = (purpose: number, year: number, index: number) =>
		unitAt(seed, salt, variant, purpose * 4096 + year, index);

	const height = spreadAt(record.size.height, unitAt(seed, salt, variant, Purpose.Height));
	const turn = unitAt(seed, salt, variant, Purpose.Turn) * 2 * Math.PI;
	const outline = envelopeVolume(record.envelope, height, turn);
	const volume: EnvelopeVolume = insetVolume(outline, shootReach(record));
	const radial = record.envelope.kind === 'radial';

	// The shadow grid: its cell is the first year's internode, or larger where the plant needs more
	// than the record's cells across its widest side.
	const margin = g.internode.length * 2;
	const half = outline.reach + margin;
	const tall = outline.top + margin;
	const widest = Math.max(2 * half, tall);
	const cells = Math.min(96, Math.max(8, Math.round(g.light.cells)));
	const cell = Math.max(g.internode.length, widest / cells);
	const nxz = Math.max(1, Math.ceil((2 * half) / cell));
	const ny = Math.max(1, Math.ceil(tall / cell));
	const grid = new ShadowGrid([-half, 0, -half], [nxz, ny, nxz], cell, g.light.shadow);
	openGrid(grid, volume, radial);

	const plant = new Plant();
	const arrangement = arrangementOf(g.buds.arrangement);
	const deepest = Math.max(1, g.macroOrders - 1);
	const [dominanceBase, dominanceDistance, dominanceAge] = g.apical.dominance;
	const lightApical = g.light.apical;
	const lightLateral = g.light.lateral;
	const [extinctApical, extinctLateral] = g.buds.extinction;
	const wander = tan(radians(Math.min(80, Math.max(0, g.apical.wander))));

	// The stems: each starts with a base node on the ground and a terminal bud.
	const starts = stemStarts(g.stems, seed, salt, variant);
	const fusedHeight: number[] = [];
	starts.forEach((start, s) => {
		const axis = plant.addAxis(-1, 0, s);
		const node = plant.addNode(start.x, 0, start.z, start.direction, -1, axis, 0);
		plant.addBud(node, axis, start.direction, true);
		fusedHeight.push(start.fused);
	});

	const scratchU: Vector3 = [0, 0, 0];
	const scratchW: Vector3 = [0, 0, 0];
	const toward: [number, number, number] = [0, 0, 0];
	let mainAcc = new Float64Array(0);
	let latAcc = new Float64Array(0);
	let vMain = new Float64Array(0);
	let vLateral = new Float64Array(0);
	const stemLight = new Float64Array(starts.length);

	/** A bud's light: the grid's, but full light for a stem's leader below the envelope. */
	const budLight = (b: number): number => {
		const n = plant.budNode[b] as number;
		const x = plant.x[n] as number;
		const y = plant.y[n] as number;
		const z = plant.z[n] as number;
		if (
			plant.budTerminal[b] &&
			plant.axisOrder[plant.budAxis[b] as number] === 0 &&
			y < volume.base
		)
			return 1;
		return grid.light(x, y, z);
	};

	/** Shadow of a bud at its node, cast or lifted. */
	const shade = (b: number, sign: 1 | -1) => {
		const n = plant.budNode[b] as number;
		grid.cast(plant.x[n] as number, plant.y[n] as number, plant.z[n] as number, sign);
	};

	/** Reads every live bud's light. */
	const readLight = () => {
		for (let k = 0; k < plant.aliveCount; k++) {
			const b = plant.alive[k] as number;
			if (plant.budState[b] === ALIVE) plant.budLight[b] = budLight(b);
		}
	};

	/**
	 * Splits each stem's resource, α times the light of all its buds, among the buds that `takes`
	 * marks, by the Borchert-Honda rule: at each node, λ weighs the axis going on against its side
	 * branches, by the light of the marked buds each side carries.
	 */
	const allocate = (lambda: number, takes: Uint8Array) => {
		const count = plant.nodes;
		if (mainAcc.length < count) {
			const size = Math.max(count, mainAcc.length * 2);
			mainAcc = new Float64Array(size);
			latAcc = new Float64Array(size);
			vMain = new Float64Array(size);
			vLateral = new Float64Array(size);
		}
		mainAcc.fill(0, 0, count);
		latAcc.fill(0, 0, count);
		stemLight.fill(0);
		for (let k = 0; k < plant.aliveCount; k++) {
			const b = plant.alive[k] as number;
			if (plant.budState[b] !== ALIVE) continue;
			const q = plant.budLight[b] as number;
			const s = plant.axisStem[plant.budAxis[b] as number] as number;
			stemLight[s] = (stemLight[s] as number) + q;
			if (!takes[b]) continue;
			const n = plant.budNode[b] as number;
			if (plant.budTerminal[b]) mainAcc[n] = (mainAcc[n] as number) + q;
			else latAcc[n] = (latAcc[n] as number) + q;
		}
		for (let n = count - 1; n >= 0; n--) {
			const p = plant.parent[n] as number;
			if (p < 0) continue;
			const total = (mainAcc[n] as number) + (latAcc[n] as number);
			if (plant.axisOf[n] === plant.axisOf[p]) mainAcc[p] = (mainAcc[p] as number) + total;
			else latAcc[p] = (latAcc[p] as number) + total;
		}
		for (let n = 0; n < count; n++) {
			const p = plant.parent[n] as number;
			const qm = mainAcc[n] as number;
			const ql = latAcc[n] as number;
			let v: number;
			if (p < 0)
				v = ALPHA * (stemLight[plant.axisStem[plant.axisOf[n] as number] as number] as number);
			else if (plant.axisOf[n] === plant.axisOf[p]) v = vMain[p] as number;
			else v = (vLateral[p] as number) * (qm + ql);
			const denominator = lambda * qm + (1 - lambda) * ql;
			if (denominator <= 0) {
				vMain[n] = 0;
				vLateral[n] = 0;
				continue;
			}
			vMain[n] = (v * lambda * qm) / denominator;
			// Resource per unit of light on the node's side branches.
			vLateral[n] = (v * (1 - lambda)) / denominator;
		}
		for (let k = 0; k < plant.aliveCount; k++) {
			const b = plant.alive[k] as number;
			if (plant.budState[b] !== ALIVE) continue;
			const n = plant.budNode[b] as number;
			plant.budVigor[b] = !takes[b]
				? 0
				: plant.budTerminal[b]
					? (vMain[n] as number)
					: (vLateral[n] as number) * (plant.budLight[b] as number);
		}
	};

	/** Grows `count` internodes from a bud, as its axis's next nodes or as a new side axis. */
	const flush = (b: number, count: number, length: number, year: number) => {
		const terminal = plant.budTerminal[b] === 1;
		const fromNode = plant.budNode[b] as number;
		const parentAxis = plant.budAxis[b] as number;
		// Side axes past the deepest macro order keep that order: they are the finest axes.
		const order = terminal
			? (plant.axisOrder[parentAxis] as number)
			: Math.min(deepest, (plant.axisOrder[parentAxis] as number) + 1);
		const stem = plant.axisStem[parentAxis] as number;
		const t = order / g.macroOrders;
		const photo = curveAt(g.tropism.photo, t);
		const gravi = curveAt(g.tropism.gravi, t);
		const d: Vector3 = [
			plant.budDx[b] as number,
			plant.budDy[b] as number,
			plant.budDz[b] as number,
		];
		let axis = terminal ? parentAxis : -1;
		let previous = fromNode;
		let added = 0;
		shade(b, -1);
		plant.budState[b] = DEAD;
		for (let k = 0; k < count; k++) {
			const px = plant.x[previous] as number;
			const py = plant.y[previous] as number;
			const pz = plant.z[previous] as number;
			const corridor = order === 0 && py < volume.base;
			if (corridor) {
				toward[0] = 0;
				toward[1] = 1;
				toward[2] = 0;
			} else grid.toward(px, py, pz, d, toward);
			const key = b * MOST_INTERNODES + k;
			const wz = unit(Purpose.WanderZ, year, key) * 2 - 1;
			const wa = unit(Purpose.WanderA, year, key) * 2 * Math.PI;
			const wr = Math.sqrt(Math.max(0, 1 - wz * wz));
			let nx = d[0] + photo * toward[0] + wander * wr * cos(wa);
			let ny = d[1] + photo * toward[1] + gravi + wander * wz;
			let nz = d[2] + photo * toward[2] + wander * wr * sin(wa);
			if (order === 0 && py < (fusedHeight[stem] as number)) {
				nx = 0;
				ny = 1;
				nz = 0;
			}
			const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
			nx /= l;
			ny /= l;
			nz /= l;
			// The envelope holds the only light: a shoot stops at it, with a last short internode where
			// part of a step still fits, so the crown reaches its outline.
			let step = length;
			let last = false;
			if (!corridor && volume.room(px + nx * step, py + ny * step, pz + nz * step) < 0) {
				last = true;
				step = 0;
				for (const share of SHORT_STEPS)
					if (
						volume.room(
							px + nx * length * share,
							py + ny * length * share,
							pz + nz * length * share,
						) >= 0
					) {
						step = length * share;
						break;
					}
				if (step === 0) break;
			}
			const x = px + nx * step;
			const y = py + ny * step;
			const z = pz + nz * step;
			if (axis < 0) axis = plant.addAxis(fromNode, order, stem);
			d[0] = nx;
			d[1] = ny;
			d[2] = nz;
			const node = plant.addNode(x, y, z, d, previous, axis, year);
			previous = node;
			added++;
			if (volume.room(x, y, z) >= 0) addLaterals(node, axis, order, d, year);
			if (last) break;
		}
		if (added === 0) return;
		const tip = plant.addBud(previous, axis, d, true);
		shade(tip, 1);
	};

	/** The lateral buds of a new node, by the arrangement, each casting its shadow. */
	const addLaterals = (
		node: number,
		axis: number,
		order: number,
		d: Readonly<Vector3>,
		year: number,
	) => {
		across(d, scratchU, scratchW);
		const roll = plant.axisRoll[axis] as number;
		plant.axisRoll[axis] = roll + arrangement.step;
		const meanAngle = curveAt(g.buds.angle, (order + 1) / g.macroOrders);
		for (let k = 0; k < arrangement.count; k++) {
			const key = node * 8 + k;
			const spread = (unit(Purpose.Angle, year, key) * 2 - 1) * g.buds.angleSpread;
			const angle = radians(Math.min(175, Math.max(0, meanAngle + spread)));
			const jitter = (unit(Purpose.Roll, year, key) - 0.5) * (1 - arrangement.flat) * radians(30);
			const r = roll + (k * 2 * Math.PI) / arrangement.count + jitter;
			const s = sin(angle);
			const c = cos(angle);
			const cr = cos(r);
			const sr = sin(r);
			const bud: Vector3 = [
				c * d[0] + s * (cr * scratchU[0] + sr * scratchW[0]),
				c * d[1] + s * (cr * scratchU[1] + sr * scratchW[1]),
				c * d[2] + s * (cr * scratchU[2] + sr * scratchW[2]),
			];
			const b = plant.addBud(node, axis, bud, false);
			shade(b, 1);
		}
	};

	for (let b = 0; b < plant.buds; b++) shade(b, 1);

	let subLight = new Float64Array(0);
	let subNodes = new Float64Array(0);
	let subPipes = new Float64Array(0);
	let doomed = new Uint8Array(0);
	/**
	 * Sheds the side branches whose light per node falls under the record's threshold, and those that
	 * leave a stem below the clean bole, after Takenaka (1994) as Palubicki et al. use it. A share of
	 * them stay as dead stubs. The pipes of a shed branch stay in the wood it left.
	 */
	const shedBranches = (year: number) => {
		const count = plant.nodes;
		if (subLight.length < count) {
			const size = Math.max(count, subLight.length * 2);
			subLight = new Float64Array(size);
			subNodes = new Float64Array(size);
			subPipes = new Float64Array(size);
			doomed = new Uint8Array(size);
		}
		const light = subLight;
		const nodes = subNodes;
		const pipes = subPipes;
		const gone = doomed;
		const { live, parent, memory, flags, budState, budNode, budLight: lightOfBud } = plant;
		light.fill(0, 0, count);
		nodes.fill(0, 0, count);
		pipes.fill(0, 0, count);
		gone.fill(0, 0, count);
		const budCount = plant.aliveCount;
		for (let k = 0; k < budCount; k++) {
			const b = plant.alive[k] as number;
			if (budState[b] !== ALIVE) continue;
			const n = budNode[b] as number;
			light[n] = (light[n] as number) + (lightOfBud[b] as number);
			pipes[n] = (pipes[n] as number) + 1;
		}
		for (let n = count - 1; n >= 0; n--) {
			if (!live[n]) continue;
			nodes[n] = (nodes[n] as number) + 1;
			pipes[n] = Math.max(1, (pipes[n] as number) + (memory[n] as number));
			const p = parent[n] as number;
			if (p < 0) continue;
			light[p] = (light[p] as number) + (light[n] as number);
			nodes[p] = (nodes[p] as number) + (nodes[n] as number);
			pipes[p] = (pipes[p] as number) + (pipes[n] as number);
		}
		const bole = g.shedding.cleanBole * plant.top;
		const threshold = g.shedding.threshold;
		let any = false;
		for (let a = 0; a < plant.axes; a++) {
			const first = plant.axisFirst[a] as number;
			const from = plant.axisParentNode[a] as number;
			if (first < 0 || from < 0 || plant.axisShed[a] || !live[first]) continue;
			const onStem = plant.axisOrder[plant.axisOf[from] as number] === 0;
			const low = onStem && (plant.y[from] as number) < bole;
			const held = nodes[first] as number;
			const dim = held >= SHED_AFTER && (light[first] as number) / held < threshold;
			if (!low && !dim) continue;
			any = true;
			plant.axisShed[a] = 1;
			if (unit(Purpose.Stub, year, a) < g.shedding.stubs) {
				flags[first] = (flags[first] as number) | NODE_STUB;
				memory[first] = pipes[first] as number;
				plant.next[first] = -1;
				plant.axisTip[a] = first;
				gone[first] = 2;
			} else {
				memory[from] = (memory[from] as number) + (pipes[first] as number);
				flags[from] = (flags[from] as number) | NODE_SHED;
				gone[first] = 1;
			}
		}
		if (!any) return;
		// Everything above a shed node or a new stub goes with it; the stub itself stays, bare.
		for (let n = 0; n < count; n++) {
			const p = parent[n] as number;
			if (gone[n] === 0 && p >= 0 && gone[p] !== 0) gone[n] = 1;
			if (gone[n] === 1) live[n] = 0;
		}
		for (let k = 0; k < budCount; k++) {
			const b = plant.alive[k] as number;
			if (budState[b] !== ALIVE) continue;
			const n = budNode[b] as number;
			if (gone[n] === 0) continue;
			shade(b, -1);
			budState[b] = DEAD;
		}
	};

	const years = Math.max(1, Math.round(g.years));
	let takes = new Uint8Array(0);
	for (let year = 0; year < years; year++) {
		const lambda = curveAt(g.apical.control, year / years);
		const length = g.internode.length * pow(g.internode.ageFactor, year);
		plant.compact();
		readLight();
		shedBranches(year);
		if (takes.length < plant.buds) takes = new Uint8Array(plant.buds * 2);
		takes.fill(0);
		// The buds' fates, axis by axis from the tip down, so a flushing bud suppresses those below it.
		const flushing: number[] = [];
		const ageDominance = dominanceBase * pow(dominanceAge, year);
		const axisCount = plant.axes;
		for (let a = 0; a < axisCount; a++) {
			let suppression = 0;
			const tb = plant.axisBud[a] as number;
			if (tb >= 0 && plant.budState[tb] === ALIVE) {
				if (unit(Purpose.Extinct, year, tb) < extinctApical) {
					shade(tb, -1);
					plant.budState[tb] = DEAD;
				} else if (unit(Purpose.Flush, year, tb) < pow(plant.budLight[tb] as number, lightApical)) {
					flushing.push(tb);
					takes[tb] = 1;
					suppression += 1;
				}
			}
			for (
				let n = plant.axisTip[a] as number;
				n >= 0 && plant.axisOf[n] === a;
				n = plant.parent[n] as number
			) {
				let flushed = 0;
				for (let b = plant.firstBud[n] as number; b >= 0; b = plant.budNext[b] as number) {
					if (plant.budState[b] !== ALIVE) continue;
					if (unit(Purpose.Extinct, year, b) < extinctLateral) {
						shade(b, -1);
						plant.budState[b] = DEAD;
						continue;
					}
					const q = plant.budLight[b] as number;
					const chance = pow(q, lightLateral) * exp(-ageDominance * suppression);
					if (unit(Purpose.Flush, year, b) < chance) {
						flushing.push(b);
						takes[b] = 1;
						flushed++;
					}
				}
				suppression = suppression * dominanceDistance + flushed;
			}
		}
		allocate(lambda, takes);
		for (const b of flushing) {
			const v = plant.budVigor[b] as number;
			const n = Math.min(MOST_INTERNODES, Math.floor(v));
			if (n >= 1) flush(b, n, length * Math.min(2, v / n), year);
		}
	}
	// The light and resource of every bud at the end of growth, which the bud sites carry.
	plant.compact();
	readLight();
	if (takes.length < plant.buds) takes = new Uint8Array(plant.buds);
	takes.fill(1);
	allocate(curveAt(g.apical.control, 1), takes);
	return skeletonOf(plant, record, g, grid, years);
}

/** Opens the grid's cells that lie inside the envelope. */
function openGrid(grid: ShadowGrid, volume: EnvelopeVolume, radial: boolean): void {
	if (!radial) {
		grid.openWhere((x, y, z) => volume.room(x, y, z) >= 0);
		return;
	}
	const { nx, ny, nz, cell, min } = grid;
	for (let l = 0; l < nz; l++)
		for (let i = 0; i < nx; i++) {
			const x = min[0] + (i + 0.5) * cell;
			const z = min[2] + (l + 0.5) * cell;
			const azimuth = atan2(z, x);
			const distance = Math.sqrt(x * x + z * z);
			for (let j = 0; j < ny; j++) {
				const y = min[1] + (j + 0.5) * cell;
				if (volume.radius(y, azimuth) >= distance) grid.open[(j * nz + l) * nx + i] = 1;
			}
		}
}

/** The pipe radius of a stem at a height, from its nodes' radii. */
function stemRadiusAt(plant: Plant, radius: Float64Array, axis: number, height: number): number {
	let previous = -1;
	for (let n = plant.axisFirst[axis] as number; n >= 0; n = plant.next[n] as number) {
		const y = plant.y[n] as number;
		if (y >= height) {
			if (previous < 0) return radius[n] as number;
			const y0 = plant.y[previous] as number;
			const w = y > y0 ? (height - y0) / (y - y0) : 0;
			return (radius[previous] as number) * (1 - w) + (radius[n] as number) * w;
		}
		previous = n;
	}
	return previous >= 0 ? (radius[previous] as number) : 0;
}

/** The grown plant as a macro skeleton: radii, axes in node order, flags and bud sites. */
function skeletonOf(
	plant: Plant,
	record: Species,
	g: SelfOrganizing,
	grid: ShadowGrid,
	years: number,
): MacroSkeleton {
	const count = plant.nodes;
	// Pipes: one per live bud, so every shoot that attaches feeds the wood below it.
	const pipes = new Float64Array(count);
	for (let n = 0; n < count; n++) pipes[n] = plant.memory[n] as number;
	for (let b = 0; b < plant.buds; b++)
		if (plant.budState[b] === ALIVE) {
			const n = plant.budNode[b] as number;
			pipes[n] = (pipes[n] as number) + 1;
		}
	const radius = new Float64Array(count);
	const tip = g.pipe.tipRadius;
	pipeRadii(count, plant.parent, plant.live, pipes, g.pipe.exponent, tip, radius);
	const dbh = record.size.dbh;
	if (dbh !== undefined) {
		let thickest = 0;
		for (let a = 0; a < plant.axes; a++)
			if (plant.axisParentNode[a] === -1)
				thickest = Math.max(thickest, stemRadiusAt(plant, radius, a, BREAST_HEIGHT));
		fitRadii(radius, count, tip, thickest, dbh / 2);
	}

	// The wood bends under its load; the directions that hang on each node turn with it.
	const shoots = new Float64Array(count);
	for (let b = 0; b < plant.buds; b++)
		if (plant.budState[b] === ALIVE) {
			const n = plant.budNode[b] as number;
			shoots[n] = (shoots[n] as number) + 1;
		}
	const turned = bendUnderLoad(
		{
			count,
			parent: plant.parent,
			live: plant.live,
			axisOf: plant.axisOf,
			x: plant.x,
			y: plant.y,
			z: plant.z,
			radius,
			shoots,
		},
		g.bending.strength,
		g.bending.upturn,
	);
	const v: [number, number, number] = [0, 0, 0];
	for (let n = 0; n < count; n++) {
		const p = plant.parent[n] as number;
		if (p < 0) continue;
		v[0] = plant.dx[n] as number;
		v[1] = plant.dy[n] as number;
		v[2] = plant.dz[n] as number;
		quatRotate(turned, p * 4, v, v);
		plant.dx[n] = v[0];
		plant.dy[n] = v[1];
		plant.dz[n] = v[2];
	}
	for (let b = 0; b < plant.buds; b++) {
		if (plant.budState[b] !== ALIVE) continue;
		v[0] = plant.budDx[b] as number;
		v[1] = plant.budDy[b] as number;
		v[2] = plant.budDz[b] as number;
		quatRotate(turned, (plant.budNode[b] as number) * 4, v, v);
		plant.budDx[b] = v[0];
		plant.budDy[b] = v[1];
		plant.budDz[b] = v[2];
	}

	// Metres of bark along each axis from its base to each node.
	const along = new Float64Array(count);
	for (let n = 0; n < count; n++) {
		const p = plant.parent[n] as number;
		if (p < 0 || plant.axisOf[p] !== plant.axisOf[n]) continue;
		along[n] =
			(along[p] as number) +
			Math.sqrt(
				square((plant.x[n] as number) - (plant.x[p] as number)) +
					square((plant.y[n] as number) - (plant.y[p] as number)) +
					square((plant.z[n] as number) - (plant.z[p] as number)),
			);
	}

	const builder = new SkeletonBuilder();
	const nodeOut = new Int32Array(count).fill(-1);
	const axisOut = new Int32Array(plant.axes).fill(-1);
	const axisBarkV = new Float64Array(plant.axes);
	const u: Vector3 = [0, 0, 0];
	const w: Vector3 = [0, 0, 0];
	for (let a = 0; a < plant.axes; a++) {
		const first = plant.axisFirst[a] as number;
		if (first < 0 || !plant.live[first]) continue;
		const parentNode = plant.axisParentNode[a] as number;
		let barkV = 0;
		let barkU = 0;
		let parentAxis = -1;
		if (parentNode >= 0) {
			parentAxis = axisOut[plant.axisOf[parentNode] as number] as number;
			barkV =
				(axisBarkV[plant.axisOf[parentNode] as number] as number) + (along[parentNode] as number);
			const t: Vector3 = [
				plant.dx[parentNode] as number,
				plant.dy[parentNode] as number,
				plant.dz[parentNode] as number,
			];
			across(t, u, w);
			const cx = (plant.x[first] as number) - (plant.x[parentNode] as number);
			const cy = (plant.y[first] as number) - (plant.y[parentNode] as number);
			const cz = (plant.z[first] as number) - (plant.z[parentNode] as number);
			barkU = atan2(cx * w[0] + cy * w[1] + cz * w[2], cx * u[0] + cy * u[1] + cz * u[2]);
		}
		axisBarkV[a] = barkV;
		const out = builder.addAxis({
			parent: parentAxis,
			parentNode: parentNode >= 0 ? (nodeOut[parentNode] as number) : -1,
			parentT: 0,
			order: plant.axisOrder[a] as number,
			kind: parentNode >= 0 ? AXIS_LIMB : AXIS_STEM,
			barkV,
			barkU,
		});
		axisOut[a] = out;
		for (let n = first; n >= 0; n = plant.next[n] as number) {
			const p = plant.parent[n] as number;
			nodeOut[n] = builder.addNode({
				x: plant.x[n] as number,
				y: plant.y[n] as number,
				z: plant.z[n] as number,
				radius: radius[n] as number,
				parent: p >= 0 ? (nodeOut[p] as number) : -1,
				axis: out,
				light: grid.light(plant.x[n] as number, plant.y[n] as number, plant.z[n] as number),
				age: years - (plant.born[n] as number),
				flags: plant.flags[n] as number,
			});
		}
	}
	// Forks: a child as thick as the axis it leaves, or children where their axis ends.
	for (let a = 0; a < plant.axes; a++) {
		const first = plant.axisFirst[a] as number;
		const parentNode = plant.axisParentNode[a] as number;
		if (first < 0 || parentNode < 0 || !plant.live[first]) continue;
		const going = plant.next[parentNode] as number;
		const parentRadius = going >= 0 ? (radius[going] as number) : (radius[parentNode] as number);
		if ((radius[first] as number) >= FORK_SHARE * parentRadius) {
			const o = nodeOut[parentNode] as number;
			builder.flags[o] = (builder.flags[o] as number) | NODE_FORK;
		}
	}

	// Bud sites: every live bud, on the bark of its node, with its frame, resource and light.
	const frame = [0, 0, 0, 1];
	const sky: Vector3 = [0, 1, 0];
	for (let b = 0; b < plant.buds; b++) {
		if (plant.budState[b] !== ALIVE) continue;
		const n = plant.budNode[b] as number;
		const d: Vector3 = [
			plant.budDx[b] as number,
			plant.budDy[b] as number,
			plant.budDz[b] as number,
		];
		const r = radius[n] as number;
		let ox = 0;
		let oy = 0;
		let oz = 0;
		if (!plant.budTerminal[b]) {
			// Across the node's own direction, so a lateral bud sits on the bark beside the wood.
			const t0 = plant.dx[n] as number;
			const t1 = plant.dy[n] as number;
			const t2 = plant.dz[n] as number;
			const dot = d[0] * t0 + d[1] * t1 + d[2] * t2;
			ox = d[0] - dot * t0;
			oy = d[1] - dot * t1;
			oz = d[2] - dot * t2;
			const l = Math.sqrt(ox * ox + oy * oy + oz * oz);
			if (l > 1e-9) {
				ox = (ox / l) * r;
				oy = (oy / l) * r;
				oz = (oz / l) * r;
			}
		}
		quatFromFrame(d, sky, frame);
		builder.addBud({
			node: nodeOut[n] as number,
			x: (plant.x[n] as number) + ox,
			y: (plant.y[n] as number) + oy,
			z: (plant.z[n] as number) + oz,
			frame,
			kind: plant.budTerminal[b] ? BUD_TERMINAL : BUD_LATERAL,
			vigor: Math.min(1, Math.max(0, (plant.budVigor[b] as number) / ALPHA)),
			light: plant.budLight[b] as number,
			axis: axisOut[plant.budAxis[b] as number] as number,
			woodRadius: r,
		});
	}
	return builder.finish();
}

/** The self-organizing grower. */
export const grower: Grower = {
	grow: growSelfOrganizing,
};
