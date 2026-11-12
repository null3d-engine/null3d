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
	length3,
	pow,
	quatFromFrame,
	quatRotate,
	radians,
	sin,
	tan,
	type Vector3,
} from '../core/math';
import type { Phyllotaxis, SelfOrganizing, Species, StemSpec } from '../core/record';
import { curveAt, spreadAt, spreadMean } from '../core/types';
import { ShadowGrid } from '../crown/light-grid';
import type { GrowInput } from '../stages';
import { bendUnderLoad } from './bend';
import { type EnvelopeVolume, envelopeVolume, flooredVolume, insetVolume } from './envelope';
import {
	forkAngle,
	forkShare,
	narrowToward,
	RIGHT_FORK,
	RIGHT_SHARE,
	RIGHT_TIPS,
	RIGHT_TURN,
	SPLIT_ANGLE,
	SPLIT_SHARE,
} from './forks';
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
/** The share of a kinked shoot's wander that its heading keeps, so its line drifts slowly. */
const KINK_DRIFT = 0.5;
/** Nodes a bud's site looks back along its wood for a cell inside the envelope. */
const SITE_STEPS = 4;
/** A limb's girth beside another's, as a share of the clearance, by botanical order. */
const GIRTH = [1, 0.6, 0.35, 0.2, 0.1] as const;
/** Degrees between the headings a shoot tries when it turns aside from another axis's wood. */
const TURN_STEP = 10;
/**
 * The most of a plant's own reach that the room its shoots need may take, so a small plant's
 * envelope keeps room for its stems: a crown's shoots stand down from the outline by their reach,
 * and on a plant no taller than they are that margin would empty the envelope.
 */
const INSET_MOST = 0.25;
/** The most of the room left inside the outline that a stool's ring may stand out to. */
const STOOL_MOST = 0.8;

/**
 * The room a plant's shoots need taken off its outline: their reach, held to a share of the outline
 * itself, so a plant no taller than its own shoots keeps an envelope to grow in.
 *
 * @param record The species record.
 * @param reach The outline's widest radius, in metres.
 * @returns Metres to inset the envelope by.
 * @category api/vegetation
 */
export function plantInset(record: Species, reach: number): number {
	return Math.min(shootReach(record), INSET_MOST * reach);
}

/**
 * A stool's ring, held inside the room the envelope leaves its stems: a ring written in metres is
 * sized for the plant its record was measured on, and a form a fraction of that size would put its
 * stems outside a room their own reach has left them.
 *
 * @param spec The record's stems.
 * @param volume The inset envelope.
 * @returns The ring's radius in metres.
 * @category api/vegetation
 */
export function stoolReach(spec: StemSpec, volume: EnvelopeVolume): number {
	return Math.min(spec.stool, STOOL_MOST * Math.max(0, volume.radius(volume.base, 0)));
}

/** One axis's girth beside another's, as a share of the record's clearance. */
export function girthOf(order: number): number {
	return GIRTH[Math.min(GIRTH.length - 1, Math.max(0, order))] as number;
}

/** A child at least this share of its parent's radius makes a fork. */
const FORK_SHARE = 0.7;
/**
 * How far below and above the record's height a stool's stems fork, as a share of it: they fork in
 * an even stair. Stems that fork on one plane heap their limbs into one band of the shadow grid,
 * where each limb shades the next and the crown's start is shed.
 */
const DIVIDE_SPREAD = 0.2;

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
	// The record's floor cuts the envelope flat, so the crown's underside stands at that height.
	const outline = flooredVolume(
		envelopeVolume(record.envelope, height, turn),
		Math.max(0, g.floor ?? 0) * height,
	);
	const inset = plantInset(record, outline.reach);
	const volume: EnvelopeVolume = insetVolume(outline, inset);
	const radial = record.envelope.kind === 'radial';
	// A record that asks for it makes each bud's light follow the room the envelope leaves at its
	// azimuth, so the crown's mass gathers on the wide side. Absent, the shadow grid's light stands
	// exactly as it did before the field existed.
	const roomBias = g.light.roomBias ?? 0;
	const room = roomBias > 0 ? roomLightTable(volume, roomBias) : undefined;

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

	// A grid of the wood already grown, so a shoot can turn aside or stop rather than pass through
	// another. Its cell holds the clearance, so a node need only look at the cells round it.
	const clearance = Math.max(0, g.clearance ?? 0);
	// The most a shoot may turn aside in one internode to keep that clearance, and the angle between
	// the headings it tries.
	const mostTurn = radians(Math.max(0, Math.min(180, g.turning ?? 0)));
	const turnStep = radians(TURN_STEP);
	// Only wood this thick, as a share of the trunk's radius, keeps the clearance: below it, thin
	// wood keeps its own layout.
	const thick = Math.max(0, Math.min(1, g.clearanceThickness ?? 0));
	// The widest clearance two axes can demand, so the cells round a point hold every neighbour.
	const clearCell = Math.max(0.25, clearance * 2);
	const clearGrid = new Map<number, number[]>();
	const clearKey = (x: number, y: number, z: number): number =>
		((Math.floor(x / clearCell) + 512) * 1024 + (Math.floor(y / clearCell) + 512)) * 1024 +
		(Math.floor(z / clearCell) + 512);
	/** Adds a node to the grid the clearance reads. */
	const registerWood = (node: number): void => {
		if (clearance <= 0) return;
		const key = clearKey(plant.x[node] as number, plant.y[node] as number, plant.z[node] as number);
		const cell = clearGrid.get(key);
		if (cell) cell.push(node);
		else clearGrid.set(key, [node]);
	};
	/**
	 * Whether a point stands within the clearance of another axis's wood. Wood thinner than the
	 * record's clearance thickness does not keep the clearance, so thin twigs keep their layout.
	 *
	 * @param x The point's x.
	 * @param y The point's y.
	 * @param z The point's z.
	 * @param axis The axis that would grow there, whose own wood is not counted.
	 * @param parent The axis it leaves, whose wood it must touch at its joint.
	 * @param order The botanical order the axis has, or will have where it does not exist yet.
	 * @returns True where another axis's wood stands too near.
	 */
	const crowded = (
		x: number,
		y: number,
		z: number,
		axis: number,
		parent: number,
		order: number,
	): boolean => {
		if (clearance <= 0) return false;
		const cx = Math.floor(x / clearCell);
		const cy = Math.floor(y / clearCell);
		const cz = Math.floor(z / clearCell);
		// A limb's girth falls with its order, so a twig may pass near a twig but not through a limb.
		const mine = girthOf(order);
		for (let ux = -1; ux <= 1; ux++)
			for (let uy = -1; uy <= 1; uy++)
				for (let uz = -1; uz <= 1; uz++) {
					const cell = clearGrid.get(
						((cx + ux + 512) * 1024 + (cy + uy + 512)) * 1024 + (cz + uz + 512),
					);
					if (!cell) continue;
					for (const node of cell) {
						const other = plant.axisOf[node] as number;
						if (other === axis || other === parent) continue;
						const otherGirth = girthOf(plant.axisOrder[other] as number);
						if (otherGirth < thick) continue;
						const dx = (plant.x[node] as number) - x;
						const dy = (plant.y[node] as number) - y;
						const dz = (plant.z[node] as number) - z;
						const apart = clearance * (mine + otherGirth);
						if (dx * dx + dy * dy + dz * dz < apart * apart) return true;
					}
				}
		return false;
	};

	const plant = new Plant();
	const arrangement = arrangementOf(g.buds.arrangement);
	const deepest = Math.max(1, g.macroOrders - 1);
	const [dominanceBase, dominanceDistance, dominanceAge] = g.apical.dominance;
	const lightApical = g.light.apical;
	const lightLateral = g.light.lateral;
	const [extinctApical, extinctLateral] = g.buds.extinction;
	const branching = Math.max(0, g.branching ?? 1);
	const branchingByOrder = g.branchingByOrder;
	const macroOrders = Math.max(1, g.macroOrders);
	const sideOrders = g.buds.sideOrders ?? Number.POSITIVE_INFINITY;
	const wander = tan(radians(Math.min(80, Math.max(0, g.apical.wander))));
	// The height at which the leader divides into its great limbs, if the record gives one.
	const divideAt = g.divide === undefined ? Number.POSITIVE_INFINITY : height * g.divide.at;
	/** The nodes where the leader divided: their limbs keep the angle they leave at. */
	const divideNodes = new Set<number>();

	// The stems: each starts with a base node on the ground and a terminal bud.
	const starts = stemStarts(
		{
			...g.stems,
			stool: stoolReach(g.stems, volume),
		},
		seed,
		salt,
		variant,
	);
	// Each stem of a stool forks at its own height, in an even stair round the record's height; one
	// stem forks at the record's height.
	const divideHeights = starts.map((_, s) =>
		starts.length > 1 && g.divide !== undefined
			? divideAt * (1 + DIVIDE_SPREAD * ((s / (starts.length - 1)) * 2 - 1))
			: divideAt,
	);
	// A stool of several stems stands in the open below its fork: each stem is its own trunk there,
	// so the plant's lowest leaf does not mark where light reaches a stem's leader. One stem keeps
	// the crown's base as its open height.
	const openHeight = (stem: number): number =>
		starts.length > 1 && g.divide !== undefined
			? Math.max(volume.base, divideHeights[stem] as number)
			: volume.base;
	const fusedHeight: number[] = [];
	const stemDirection: Vector3[] = [];
	const leaned = new Uint8Array(starts.length);
	starts.forEach((start, s) => {
		const axis = plant.addAxis(-1, 0, s);
		const node = plant.addNode(start.x, 0, start.z, start.direction, -1, axis, 0);
		registerWood(node);
		plant.addBud(node, axis, start.direction, true);
		fusedHeight.push(start.fused);
		stemDirection.push([...start.direction]);
	});

	const scratchU: Vector3 = [0, 0, 0];
	const scratchW: Vector3 = [0, 0, 0];
	const toward: [number, number, number] = [0, 0, 0];
	const heading: Vector3 = [0, 0, 0];
	const internode: Vector3 = [0, 0, 0];
	const turnedDirection: Vector3 = [0, 0, 0];
	const kinks = g.kinks === true;
	const relay = g.relay !== false;
	let mainAcc = new Float64Array(0);
	let latAcc = new Float64Array(0);
	let vMain = new Float64Array(0);
	let vLateral = new Float64Array(0);
	const stemLight = new Float64Array(starts.length);

	/** Turns a unit direction about a unit axis through an angle, in place, and normalizes it. */
	const turnAbout = (d: Vector3, axis: Readonly<Vector3>, angle: number): void => {
		const x = d[0] as number;
		const y = d[1] as number;
		const z = d[2] as number;
		const ax = axis[0] as number;
		const ay = axis[1] as number;
		const az = axis[2] as number;
		const c = cos(angle);
		const s = sin(angle);
		const dot = ax * x + ay * y + az * z;
		const crossX = ay * z - az * y;
		const crossY = az * x - ax * z;
		const crossZ = ax * y - ay * x;
		d[0] = x * c + crossX * s + ax * dot * (1 - c);
		d[1] = y * c + crossY * s + ay * dot * (1 - c);
		d[2] = z * c + crossZ * s + az * dot * (1 - c);
		const l = length3(d[0] as number, d[1] as number, d[2] as number);
		if (l > 1e-9) {
			d[0] = (d[0] as number) / l;
			d[1] = (d[1] as number) / l;
			d[2] = (d[2] as number) / l;
		}
	};

	/**
	 * The heading a shoot takes where its chosen step would come within the clearance of another
	 * axis's wood: the smallest turn either side of the heading, up to the record's most, that keeps
	 * the step both clear and inside the envelope. The side it turned to before is tried first, so a
	 * shoot passing an obstacle curves round it instead of zigzagging. The choice reads no random
	 * draw, so a seed grows the same bytes.
	 *
	 * @param d The direction the shoot had chosen; it takes the turned one on success.
	 * @param heading The shoot's heading when its internodes kink about it, turned with it.
	 * @param kinked Whether the shoot's internodes kink about the heading.
	 * @param px The shoot tip's x.
	 * @param py The shoot tip's y.
	 * @param pz The shoot tip's z.
	 * @param step The internode's length, shortened where the envelope keeps only part of it.
	 * @param axis The axis that would grow there, whose own wood is not counted.
	 * @param parentAxis The axis it leaves, whose wood it must touch at its joint.
	 * @param order The botanical order the axis has, or will have where it does not exist yet.
	 * @param side The side it turned to last, tried first.
	 * @returns The side it turned to, or 0 where no tried heading is clear.
	 */
	const turnAside = (
		d: Vector3,
		heading: Vector3,
		kinked: boolean,
		px: number,
		py: number,
		pz: number,
		step: number,
		axis: number,
		parentAxis: number,
		order: number,
		side: number,
	): number => {
		if (!(mostTurn > 0) || !(turnStep > 0)) return 0;
		across(d, scratchU, scratchW);
		for (let k = 1; ; k++) {
			const angle = Math.min(mostTurn, k * turnStep);
			for (let m = 0; m < 2; m++) {
				const turn = m === 0 ? side : -side;
				turnedDirection[0] = d[0] as number;
				turnedDirection[1] = d[1] as number;
				turnedDirection[2] = d[2] as number;
				turnAbout(turnedDirection, scratchU, turn * angle);
				const x = px + (turnedDirection[0] as number) * step;
				const y = py + (turnedDirection[1] as number) * step;
				const z = pz + (turnedDirection[2] as number) * step;
				if (volume.room(x, y, z) < 0) continue;
				if (crowded(x, y, z, axis, parentAxis, order)) continue;
				d[0] = turnedDirection[0] as number;
				d[1] = turnedDirection[1] as number;
				d[2] = turnedDirection[2] as number;
				if (kinked) turnAbout(heading, scratchU, turn * angle);
				return turn;
			}
			if (angle >= mostTurn - 1e-9) return 0;
		}
	};

	/** A bud's light: the grid's, but full light for a stem's leader below its open height. */
	const budLight = (b: number): number => {
		const n = plant.budNode[b] as number;
		const x = plant.x[n] as number;
		const y = plant.y[n] as number;
		const z = plant.z[n] as number;
		if (
			plant.budTerminal[b] &&
			plant.axisOrder[plant.budAxis[b] as number] === 0 &&
			y < openHeight(plant.axisStem[plant.budAxis[b] as number] as number)
		)
			return 1;
		return grid.light(x, y, z);
	};

	/**
	 * A bud's light with the record's room bias, where it asks for one. The bias follows the room at
	 * the bud's own azimuth. It is left off the terminal buds, whose flush carries the leader and
	 * the branch tips.
	 */
	const biasLight = (light: number, b: number): number => {
		if (room === undefined || plant.budTerminal[b]) return light;
		const n = plant.budNode[b] as number;
		if (n < 0) return light;
		return (
			light * room.factor(plant.y[n] as number, atan2(plant.z[n] as number, plant.x[n] as number))
		);
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
			if (plant.budState[b] === ALIVE) plant.budLight[b] = biasLight(budLight(b), b);
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

	/** The direction of the internode that ends at a node. */
	const lineAt = (node: number, out: Vector3): Vector3 => {
		out[0] = plant.dx[node] as number;
		out[1] = plant.dy[node] as number;
		out[2] = plant.dz[node] as number;
		return out;
	};
	const line: Vector3 = [0, 0, 0];

	/**
	 * Hands a lost leader's role to the live lateral bud at its axis's tip, as an oak's subterminal
	 * bud replaces a lost terminal bud: the bud becomes the axis's terminal bud, turned in to the
	 * fork rule's narrowest angle from the axis's line, so the axis runs on. An axis whose tip holds
	 * no live lateral bud stops.
	 */
	const relayLeader = (a: number) => {
		const tip = plant.axisTip[a] as number;
		if (tip < 0) return;
		let before = -1;
		for (let b = plant.firstBud[tip] as number; b >= 0; b = plant.budNext[b] as number) {
			if (plant.budState[b] !== ALIVE) {
				before = b;
				continue;
			}
			if (before < 0) plant.firstBud[tip] = plant.budNext[b] as number;
			else plant.budNext[before] = plant.budNext[b] as number;
			plant.budNext[b] = -1;
			plant.budTerminal[b] = 1;
			plant.axisBud[a] = b;
			const d: Vector3 = [
				plant.budDx[b] as number,
				plant.budDy[b] as number,
				plant.budDz[b] as number,
			];
			narrowToward(lineAt(tip, line), d, forkAngle(1));
			plant.budDx[b] = d[0];
			plant.budDy[b] = d[1];
			plant.budDz[b] = d[2];
			return;
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
		const opening = !terminal && g.forkRule === true;
		let axis = terminal ? parentAxis : -1;
		let previous = fromNode;
		let added = 0;
		let divided = false;
		// The side the shoot last turned to, so it keeps curving the same way round an obstacle.
		let turnSide = 1;
		shade(b, -1);
		plant.budState[b] = DEAD;
		for (let k = 0; k < count; k++) {
			const px = plant.x[previous] as number;
			const py = plant.y[previous] as number;
			const pz = plant.z[previous] as number;
			// A stem that ran fused with its neighbours takes its lean back once it clears the fused
			// length: the fused run grows straight up, and the bud would otherwise keep that line.
			if (
				order === 0 &&
				(fusedHeight[stem] as number) > 0 &&
				py >= (fusedHeight[stem] as number) &&
				leaned[stem] === 0
			) {
				const dir = stemDirection[stem] as Vector3;
				d[0] = dir[0];
				d[1] = dir[1];
				d[2] = dir[2];
				leaned[stem] = 1;
			}
			const corridor = order === 0 && py < volume.base;
			// A stem's leader grows in the open to its fork, as the light rule already lets it. The
			// crown hull's lowest rows describe the canopy above the stool, not the stool itself, so
			// they do not stop a stem from leaving the stool at its own angle.
			const openGrowth = order === 0 && py < openHeight(stem);
			if (corridor) {
				toward[0] = 0;
				toward[1] = 1;
				toward[2] = 0;
			} else grid.toward(px, py, pz, d, toward);
			const key = b * MOST_INTERNODES + k;
			const wz = unit(Purpose.WanderZ, year, key) * 2 - 1;
			const wa = unit(Purpose.WanderA, year, key) * 2 * Math.PI;
			const wr = Math.sqrt(Math.max(0, 1 - wz * wz));
			// The bole below the crown grows on along its own line: the wander that crooks a crown's
			// shoots would bend it into an S. By the fork rule a side shoot's first internode leaves at
			// the angle the rule opened it at, and the wander crooks it from the next. A kinked stem
			// kinks by half the wander, so its joints stay within the wander.
			const crook =
				corridor || (opening && k === 0) ? 0 : kinks && order === 0 ? wander / 2 : wander;
			let nx = d[0] + photo * toward[0];
			let ny = d[1] + photo * toward[1] + gravi;
			let nz = d[2] + photo * toward[2];
			if (order === 0 && py < (fusedHeight[stem] as number)) {
				nx = 0;
				ny = 1;
				nz = 0;
			}
			if (kinks) {
				// The heading takes the tropisms and keeps a share of the wander; the internode takes
				// the whole wander, so it kinks about the heading.
				const h = Math.sqrt(nx * nx + ny * ny + nz * nz);
				heading[0] = nx / h;
				heading[1] = ny / h;
				heading[2] = nz / h;
				nx = heading[0];
				ny = heading[1];
				nz = heading[2];
			}
			if (!(order === 0 && py < (fusedHeight[stem] as number))) {
				nx += crook * wr * cos(wa);
				ny += crook * wz;
				nz += crook * wr * sin(wa);
				if (kinks) {
					heading[0] += KINK_DRIFT * crook * wr * cos(wa);
					heading[1] += KINK_DRIFT * crook * wz;
					heading[2] += KINK_DRIFT * crook * wr * sin(wa);
					const hl = length3(heading[0], heading[1], heading[2]);
					heading[0] /= hl;
					heading[1] /= hl;
					heading[2] /= hl;
				}
			}
			const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
			nx /= l;
			ny /= l;
			nz /= l;
			// The envelope holds the only light: a shoot stops at it, with a last short internode where
			// part of a step still fits, so the crown reaches its outline.
			let step = length;
			let last = false;
			if (!openGrowth && volume.room(px + nx * step, py + ny * step, pz + nz * step) < 0) {
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
			// The leader divides at the stem's fork height: its last internode reaches that height and
			// its tip carries the record's number of great limbs, spread around it, no leader among them.
			const toDivide = (divideHeights[stem] as number) - py;
			if (order === 0 && toDivide <= step) {
				if (toDivide <= 0) break;
				step = toDivide;
				last = true;
				divided = true;
			}
			let x = px + nx * step;
			let y = py + ny * step;
			let z = pz + nz * step;
			// A real tree's limbs do not pass through one another: a shoot that would come within the
			// clearance of another axis's wood turns aside, and stops only where no heading is clear.
			{
				// A new limb's axis does not exist yet, so it stands for the axis the builder will
				// give it, and leaves the wood at the node it is starting from.
				const grown = axis >= 0 ? axis : plant.axes;
				const joint = axis >= 0 ? (plant.axisParentNode[axis] as number) : fromNode;
				const fromAxis = joint >= 0 ? (plant.axisOf[joint] as number) : -1;
				const mineOrder = axis >= 0 ? (plant.axisOrder[axis] as number) : order;
				if (grown >= 0 && crowded(x, y, z, grown, fromAxis, mineOrder)) {
					internode[0] = nx;
					internode[1] = ny;
					internode[2] = nz;
					const turn =
						corridor || divided
							? 0
							: turnAside(
									internode,
									heading,
									kinks,
									px,
									py,
									pz,
									step,
									grown,
									fromAxis,
									mineOrder,
									turnSide,
								);
					if (turn === 0) break;
					turnSide = turn;
					nx = internode[0] as number;
					ny = internode[1] as number;
					nz = internode[2] as number;
					x = px + nx * step;
					y = py + ny * step;
					z = pz + nz * step;
				}
			}
			if (axis < 0) axis = plant.addAxis(fromNode, order, stem);
			internode[0] = nx;
			internode[1] = ny;
			internode[2] = nz;
			const node = plant.addNode(x, y, z, internode, previous, axis, year);
			registerWood(node);
			previous = node;
			added++;
			if (divided) {
				// The great limbs leave the tip together, at the record's angle from its line and
				// round it in equal steps, so the fork is a crown of its own.
				const count = Math.max(2, Math.round(g.divide?.count ?? 0));
				const angle = radians(g.divide?.angle ?? 60);
				const lean = radians(g.divide?.lean ?? 30);
				across(internode, scratchU, scratchW);
				for (let k = 0; k < count; k++) {
					// The first limb runs on up, the stem's old line among them; the rest spread wide
					// round it in equal steps, so the fork carries the crown as 3 to 5 great limbs.
					const a = k === 0 ? lean : angle;
					const r =
						k === 0
							? (plant.axisRoll[axis] as number)
							: (plant.axisRoll[axis] as number) + ((k - 1) * 2 * Math.PI) / Math.max(1, count - 1);
					const s2 = sin(a);
					const c2 = cos(a);
					const cr = cos(r);
					const sr = sin(r);
					const bud: Vector3 = [
						c2 * internode[0] + s2 * (cr * scratchU[0] + sr * scratchW[0]),
						c2 * internode[1] + s2 * (cr * scratchU[1] + sr * scratchW[1]),
						c2 * internode[2] + s2 * (cr * scratchU[2] + sr * scratchW[2]),
					];
					// The buds share one point, so none shades its siblings at the fork; each casts its
					// shadow once it grows away.
					plant.addBud(node, axis, bud, false);
				}
				// The great limbs keep the angle they leave at: this node divides, so no child here
				// is taking over a withered line.
				plant.flags[node] = (plant.flags[node] as number) | NODE_FORK;
				divideNodes.add(node);
				plant.axisRoll[axis] = (plant.axisRoll[axis] as number) + (Math.PI * 2) / count;
			} else if (volume.room(x, y, z) >= 0) addLaterals(node, axis, order, internode, year);
			const next = kinks ? heading : internode;
			d[0] = next[0];
			d[1] = next[1];
			d[2] = next[2];
			if (last) break;
		}
		if (added === 0) return;
		if (divided) return;
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
	/** Each live node's live children, as runs of one array, indexed for walking a branch. */
	let childStart = new Int32Array(0);
	let childList = new Int32Array(0);
	let stack = new Int32Array(0);
	const indexChildren = () => {
		const count = plant.nodes;
		if (childStart.length < count + 1) {
			const size = Math.max(count + 1, childStart.length * 2);
			childStart = new Int32Array(size);
			childList = new Int32Array(size);
			stack = new Int32Array(size);
		}
		childStart.fill(0, 0, count + 1);
		for (let n = 0; n < count; n++) {
			const p = plant.parent[n] as number;
			if (p >= 0 && plant.live[n]) childStart[p + 1] = (childStart[p + 1] as number) + 1;
		}
		for (let n = 0; n < count; n++)
			childStart[n + 1] = (childStart[n + 1] as number) + (childStart[n] as number);
		// The stack serves as each node's fill cursor here, before any branch is walked.
		stack.set(childStart.subarray(0, count));
		for (let n = 0; n < count; n++) {
			const p = plant.parent[n] as number;
			if (p < 0 || !plant.live[n]) continue;
			const at = stack[p] as number;
			childList[at] = n;
			stack[p] = at + 1;
		}
	};

	/**
	 * Whether turning a branch rigidly about a node would carry any of its wood below the ground,
	 * where no tree grows. The turn is checked before it is made, so a righting that would sink a
	 * branch waits for a year in which the branch has risen enough.
	 */
	const wouldSink = (
		first: number,
		from: number,
		axis: Readonly<Vector3>,
		angle: number,
	): boolean => {
		const [ax, ay, az] = axis;
		const c = cos(angle);
		const sn = sin(angle);
		const px = plant.x[from] as number;
		const py = plant.y[from] as number;
		const pz = plant.z[from] as number;
		let depth = 0;
		stack[depth++] = first;
		while (depth > 0) {
			const n = stack[--depth] as number;
			const x = (plant.x[n] as number) - px;
			const y = (plant.y[n] as number) - py;
			const z = (plant.z[n] as number) - pz;
			const d = ax * x + ay * y + az * z;
			const ry = y * c + (az * x - ax * z) * sn + ay * d * (1 - c);
			if (py + ry < 0) return true;
			for (let k = childStart[n] as number; k < (childStart[n + 1] as number); k++)
				stack[depth++] = childList[k] as number;
		}
		return false;
	};

	/**
	 * Turns a branch rigidly about the node it leaves: every node from its first, the directions of
	 * their internodes and the directions of their buds, about a unit axis through the angle. Each live
	 * bud's shadow leaves the light grid before its node moves and falls again after.
	 */
	const turnBranch = (first: number, from: number, axis: Readonly<Vector3>, angle: number) => {
		const [ax, ay, az] = axis;
		const c = cos(angle);
		const sn = sin(angle);
		const out: Vector3 = [0, 0, 0];
		// Rodrigues' rotation of a vector about the unit axis.
		const turn = (x: number, y: number, z: number) => {
			const d = ax * x + ay * y + az * z;
			out[0] = x * c + (ay * z - az * y) * sn + ax * d * (1 - c);
			out[1] = y * c + (az * x - ax * z) * sn + ay * d * (1 - c);
			out[2] = z * c + (ax * y - ay * x) * sn + az * d * (1 - c);
		};
		// A bud's shadow leaves the grid at its node's old place, and its direction turns.
		const liftAndTurn = (b: number) => {
			if (plant.budState[b] === ALIVE) shade(b, -1);
			turn(plant.budDx[b] as number, plant.budDy[b] as number, plant.budDz[b] as number);
			plant.budDx[b] = out[0];
			plant.budDy[b] = out[1];
			plant.budDz[b] = out[2];
		};
		const px = plant.x[from] as number;
		const py = plant.y[from] as number;
		const pz = plant.z[from] as number;
		let depth = 0;
		stack[depth++] = first;
		while (depth > 0) {
			const n = stack[--depth] as number;
			const own = plant.axisOf[n] as number;
			const tipBud = plant.axisBud[own] as number;
			const terminal =
				plant.axisTip[own] === n && tipBud >= 0 && plant.budNode[tipBud] === n ? tipBud : -1;
			for (let b = plant.firstBud[n] as number; b >= 0; b = plant.budNext[b] as number)
				liftAndTurn(b);
			if (terminal >= 0) liftAndTurn(terminal);
			turn((plant.x[n] as number) - px, (plant.y[n] as number) - py, (plant.z[n] as number) - pz);
			plant.x[n] = px + out[0];
			plant.y[n] = py + out[1];
			plant.z[n] = pz + out[2];
			if ((plant.y[n] as number) > plant.top) plant.top = plant.y[n] as number;
			turn(plant.dx[n] as number, plant.dy[n] as number, plant.dz[n] as number);
			plant.dx[n] = out[0];
			plant.dy[n] = out[1];
			plant.dz[n] = out[2];
			for (let b = plant.firstBud[n] as number; b >= 0; b = plant.budNext[b] as number)
				if (plant.budState[b] === ALIVE) shade(b, 1);
			if (terminal >= 0 && plant.budState[terminal] === ALIVE) shade(terminal, 1);
			for (let k = childStart[n] as number; k < (childStart[n + 1] as number); k++)
				stack[depth++] = childList[k] as number;
		}
	};

	/**
	 * Lays a stem's nodes below its top on a line from its foot, each at its share of the stem's
	 * length there, and moves the wood each one carries with it. The line runs to the top where that
	 * leans no more than the most degrees given; otherwise it leans that far, and the top with
	 * everything it carries moves to the line's end. Each live bud's shadow leaves the light grid
	 * before its node moves and falls again after.
	 */
	const straightenBole = (division: number, most: number) => {
		const chain: number[] = [];
		for (let n = division; n >= 0; n = plant.parent[n] as number) {
			chain.push(n);
			if (plant.axisOf[n] !== plant.axisOf[division]) break;
		}
		chain.reverse();
		const foot = chain[0] as number;
		if (plant.axisOf[foot] !== plant.axisOf[division] || chain.length < 3) return;
		const along = new Float64Array(chain.length);
		for (let k = 1; k < chain.length; k++) {
			const a = chain[k - 1] as number;
			const b = chain[k] as number;
			along[k] =
				(along[k - 1] as number) +
				Math.sqrt(
					square((plant.x[b] as number) - (plant.x[a] as number)) +
						square((plant.y[b] as number) - (plant.y[a] as number)) +
						square((plant.z[b] as number) - (plant.z[a] as number)),
				);
		}
		const total = along[chain.length - 1] as number;
		if (!(total > 0)) return;
		const count = plant.nodes;
		const shift = new Float64Array(count * 3);
		const moved = new Uint8Array(count);
		const fx = plant.x[foot] as number;
		const fy = plant.y[foot] as number;
		const fz = plant.z[foot] as number;
		let lx = (plant.x[division] as number) - fx;
		let ly = (plant.y[division] as number) - fy;
		let lz = (plant.z[division] as number) - fz;
		// A line that leans past the most turns upright to it about the foot, keeping its length, and
		// the division with the crown it carries moves to the line's end.
		const chord = Math.sqrt(lx * lx + ly * ly + lz * lz);
		const level = Math.sqrt(lx * lx + lz * lz);
		const limit = radians(Math.max(0, Math.min(90, most)));
		if (chord > 0 && atan2(level, ly) > limit) {
			const out = level > 1e-9 ? sin(limit) / level : 0;
			const nx = lx * out * chord;
			const nz = lz * out * chord;
			const ny = cos(limit) * chord;
			shift[division * 3] = fx + nx - (plant.x[division] as number);
			shift[division * 3 + 1] = fy + ny - (plant.y[division] as number);
			shift[division * 3 + 2] = fz + nz - (plant.z[division] as number);
			moved[division] = 1;
			lx = nx;
			ly = ny;
			lz = nz;
		}
		for (let k = 1; k < chain.length - 1; k++) {
			const n = chain[k] as number;
			const t = (along[k] as number) / total;
			shift[n * 3] = fx + lx * t - (plant.x[n] as number);
			shift[n * 3 + 1] = fy + ly * t - (plant.y[n] as number);
			shift[n * 3 + 2] = fz + lz * t - (plant.z[n] as number);
			moved[n] = 1;
		}
		// A node off the bole moves as the node it hangs from, and the crown as the division, which
		// keeps its own place unless the line moved it; parents come before children.
		for (let n = 0; n < count; n++) {
			const p = plant.parent[n] as number;
			if (moved[n] || p < 0 || !moved[p] || n === division) continue;
			shift[n * 3] = shift[p * 3] as number;
			shift[n * 3 + 1] = shift[p * 3 + 1] as number;
			shift[n * 3 + 2] = shift[p * 3 + 2] as number;
			moved[n] = 1;
		}
		for (let b = 0; b < plant.buds; b++)
			if (plant.budState[b] === ALIVE && moved[plant.budNode[b] as number]) shade(b, -1);
		for (let n = 0; n < count; n++) {
			if (!moved[n]) continue;
			plant.x[n] = (plant.x[n] as number) + (shift[n * 3] as number);
			plant.y[n] = (plant.y[n] as number) + (shift[n * 3 + 1] as number);
			plant.z[n] = (plant.z[n] as number) + (shift[n * 3 + 2] as number);
		}
		for (let b = 0; b < plant.buds; b++)
			if (plant.budState[b] === ALIVE && moved[plant.budNode[b] as number]) shade(b, 1);
		// The bole's internodes, and the division's, run along the line.
		const length = Math.sqrt(lx * lx + ly * ly + lz * lz);
		for (let k = 1; k < chain.length; k++) {
			const n = chain[k] as number;
			plant.dx[n] = lx / length;
			plant.dy[n] = ly / length;
			plant.dz[n] = lz / length;
		}
	};

	/**
	 * Rights the side shoots whose share of the wood has grown past what their angle allows, as
	 * reaction wood turns a vigorous shoot toward its parent's line. Each year a side shoot that holds
	 * at least a fifth of its fork's wood, on a fork past a twig's size, while its own branch is still
	 * small, turns its branch toward its parent's line by a few degrees, until it leaves at the fork
	 * rule's angle for its share. A shoot that took over from a withered leader becomes the leader's
	 * line in a few years; a grown limb keeps the angle it grew at. Shares come from this season's
	 * pipes, which the shedding pass counts.
	 */
	const rightShoots = () => {
		const pipes = subPipes;
		const count = plant.nodes;
		const most = radians(RIGHT_TURN);
		const axis: Vector3 = [0, 0, 0];
		indexChildren();
		for (let a = 0; a < plant.axes; a++) {
			if (plant.axisShed[a] || plant.axisOrder[a] === 0) continue;
			const first = plant.axisFirst[a] as number;
			const from = plant.axisParentNode[a] as number;
			if (first < 0 || from < 0 || first >= count || !plant.live[first]) continue;
			if (divideNodes.has(from)) continue;
			const fork = pipes[from] as number;
			const own = pipes[first] as number;
			if (fork < RIGHT_FORK || own > RIGHT_TIPS) continue;
			const share = forkShare(own, fork, g.pipe.exponent);
			if (share < RIGHT_SHARE) continue;
			const lx = plant.dx[from] as number;
			const ly = plant.dy[from] as number;
			const lz = plant.dz[from] as number;
			const cx = plant.dx[first] as number;
			const cy = plant.dy[first] as number;
			const cz = plant.dz[first] as number;
			// The axis across the child and the line, about which the child turns toward the line.
			axis[0] = cy * lz - cz * ly;
			axis[1] = cz * lx - cx * lz;
			axis[2] = cx * ly - cy * lx;
			const across = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]);
			if (across <= 1e-9) continue;
			// Where the parent's own line goes on beside the shoot, the two divide as a fork, and the
			// shoot keeps the fork's angle; where the line withered, the shoot takes it over. The line
			// goes on as the parent's next node, or as the thickest child that carries it on, as
			// leadOnThickest reads it.
			const next = plant.next[from] as number;
			let carries = next >= 0 && plant.live[next] ? (pipes[next] as number) : 0;
			for (let k = childStart[from] as number; k < (childStart[from + 1] as number); k++) {
				const other = childList[k] as number;
				if (other === a) continue;
				const firstOther = plant.axisFirst[other] as number;
				if (firstOther >= 0 && plant.live[firstOther])
					carries = Math.max(carries, pipes[firstOther] as number);
			}
			const goesOn = forkShare(carries, fork, g.pipe.exponent);
			const widest = Math.max(forkAngle(share), goesOn >= SPLIT_SHARE ? radians(SPLIT_ANGLE) : 0);
			const step = Math.min(most, atan2(across, cx * lx + cy * ly + cz * lz) - widest);
			// No turn where the counts give none, such as for wood the last season grew past the
			// counts the last shedding made: a turn that is not a number would spoil the branch.
			if (!(step > 0)) continue;
			axis[0] /= across;
			axis[1] /= across;
			axis[2] /= across;
			if (wouldSink(first, from, axis, step)) continue;
			turnBranch(first, from, axis, step);
		}
	};

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
			// One stem clears the branches that leave it below its bole. A stool clears every branch
			// that starts or hangs below the bole, so no twig chain dangles under the crown.
			const low =
				starts.length > 1
					? (plant.y[from] as number) < bole ||
						(plant.y[plant.axisTip[a] as number] as number) < bole
					: plant.axisOrder[plant.axisOf[from] as number] === 0 && (plant.y[from] as number) < bole;
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
		// Everything above a shed node or a new stub goes with it; the stub itself stays, bare, unless
		// the branch it stands on goes too. Parents come before their children, so one pass carries
		// every loss to the tips.
		for (let n = 0; n < count; n++) {
			const p = parent[n] as number;
			if (p >= 0 && gone[p] !== 0) gone[n] = 1;
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
		if (g.forkRule) rightShoots();
		if (takes.length < plant.buds) takes = new Uint8Array(plant.buds * 2);
		takes.fill(0);
		// The buds' fates, axis by axis from the tip down, so a flushing bud suppresses those below it.
		const flushing: number[] = [];
		const ageDominance = dominanceBase * pow(dominanceAge, year);
		const axisCount = plant.axes;
		for (let a = 0; a < axisCount; a++) {
			let suppression = 0;
			const order = plant.axisOrder[a] as number;
			// An axis past the record's side orders keeps its lateral buds as buds for its shoots.
			const sides = order < sideOrders;
			// The record's branching curve thins the side axes of an order, so a crown can carry fewer
			// branches and subbranches without thinning every order alike.
			const share =
				branchingByOrder === undefined
					? branching
					: branching * curveAt(branchingByOrder, order / macroOrders);
			const tb = plant.axisBud[a] as number;
			if (tb >= 0 && plant.budState[tb] === ALIVE) {
				// With the relay, a stem's leader below the open height is spared the chance loss that
				// would leave no shoot in the light to take over.
				const sheltered =
					relay &&
					plant.axisOrder[a] === 0 &&
					(plant.y[plant.budNode[tb] as number] as number) <
						openHeight(plant.axisStem[a] as number);
				if (!sheltered && unit(Purpose.Extinct, year, tb) < extinctApical) {
					shade(tb, -1);
					plant.budState[tb] = DEAD;
					if (relay) relayLeader(a);
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
					// The record's branching sets how readily a lateral puts out a branch: this is the
					// wood's density, which the crown's foliage thins or fills.
					const chance = Math.min(
						1,
						pow(q, lightLateral) * exp(-ageDominance * suppression) * share,
					);
					if (sides && unit(Purpose.Flush, year, b) < chance) {
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
	if (g.forkRule) {
		// The righting of the shoots whose share the last season's growth raised. The plant stands
		// at the season's end, in leaf, so the branches that light no longer feeds are shed only
		// with next year's growth.
		rightShoots();
		readLight();
	}
	// Each stem's bole runs from its foot to its own top: the division, or where its leader stopped
	// short of it.
	const plumb = g.divide?.plumb;
	if (plumb !== undefined) {
		for (let a = 0; a < plant.axes; a++)
			if (plant.axisParentNode[a] === -1) straightenBole(plant.axisTip[a] as number, plumb);
		readLight();
	}
	const dark =
		g.shedding.underCrown === undefined
			? Number.NEGATIVE_INFINITY
			: Math.max(0, Math.min(1, g.shedding.underCrown)) * volume.base;
	// A bud the envelope stopped stands at the crown's surface, in the sky: it takes its share of
	// the last resource by its site's light rather than by its closed cell's dark.
	if (g.light.surface === true)
		for (let k = 0; k < plant.aliveCount; k++) {
			const b = plant.alive[k] as number;
			if (plant.budState[b] === ALIVE)
				plant.budLight[b] = siteLight(plant, grid, b, dark, biasLight);
		}
	if (takes.length < plant.buds) takes = new Uint8Array(plant.buds);
	takes.fill(1);
	allocate(curveAt(g.apical.control, 1), takes);
	trimBare(plant, grid, dark);
	return skeletonOf(plant, record, g, grid, years, volume.base, dark);
}

/**
 * A bud's light for its site. A bud at the envelope's surface stands in a cell outside it, which
 * holds no light: its site takes the light of the nearest node below it that stands inside, or full
 * light where none does, since the outermost shoots of a crown see the most sky. A bud whose node
 * stands under the crown, below the dark height given, sees none.
 */
function siteLight(
	plant: Plant,
	grid: ShadowGrid,
	b: number,
	dark: number,
	bias?: (light: number, b: number) => number,
): number {
	if ((plant.y[plant.budNode[b] as number] as number) < dark) return 0;
	for (let n = plant.budNode[b] as number, k = 0; n >= 0 && k < SITE_STEPS; k++) {
		const x = plant.x[n] as number;
		const y = plant.y[n] as number;
		const z = plant.z[n] as number;
		if (grid.inside(x, y, z))
			return k === 0
				? (plant.budLight[b] as number)
				: bias
					? bias(grid.light(x, y, z), b)
					: grid.light(x, y, z);
		n = plant.parent[n] as number;
	}
	return bias ? bias(1, b) : 1;
}

/**
 * The room's share of the mean room at each height, as a multiplier on a bud's light: 1 at a
 * height's mean azimuth, above 1 on the envelope's wide side and below 1 on its narrow side. The
 * record's light reads the shadow grid alone unless it asks for this bias.
 */
function roomLightTable(
	volume: EnvelopeVolume,
	power: number,
): { factor(y: number, azimuth: number): number } {
	const taps = 16;
	const base = volume.base;
	const top = volume.top;
	const rows: Float64Array[] = [];
	const means: number[] = [];
	for (let i = 0; i < taps; i++) {
		const y = base + ((top - base) * i) / (taps - 1);
		const row = new Float64Array(taps);
		let sum = 0;
		for (let k = 0; k < taps; k++) {
			const r = volume.radius(y, (k * 2 * Math.PI) / taps);
			row[k] = r;
			sum += r;
		}
		rows.push(row);
		means.push(sum / taps);
	}
	return {
		factor(y, azimuth) {
			const t = top > base ? Math.min(1, Math.max(0, (y - base) / (top - base))) : 0;
			const at = t * (taps - 1);
			const i0 = Math.floor(at);
			const i1 = Math.min(taps - 1, i0 + 1);
			const w = at - i0;
			const turn = ((azimuth % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
			const ak = (turn / (2 * Math.PI)) * taps;
			const a0 = Math.floor(ak) % taps;
			const a1 = (a0 + 1) % taps;
			const u = ak - Math.floor(ak);
			const at0 = (rows[i0] as Float64Array)[a0] as number;
			const at1 = (rows[i0] as Float64Array)[a1] as number;
			const bt0 = (rows[i1] as Float64Array)[a0] as number;
			const bt1 = (rows[i1] as Float64Array)[a1] as number;
			const r0 = at0 * (1 - u) + at1 * u;
			const r1 = bt0 * (1 - u) + bt1 * u;
			const r = r0 * (1 - w) + r1 * w;
			const mean = (means[i0] as number) * (1 - w) + (means[i1] as number) * w;
			return mean > 0 ? pow(r / mean, power) : 1;
		},
	};
}

/**
 * Lets the bare ends of the wood die back: a bud in full shade at its site dies, as does one whose
 * node stands under the crown below the dark height given, and each axis's end dies back to its
 * last node that carries a live bud, the wood of a shed branch, or a child that does. A dead limb that shed its branches keeps its wood, and a stem keeps its whole length, a
 * dead leader standing as a snag. Fine twigs keep neither shed-branch wood nor a dead stub, so a
 * twig whose buds all died does not stand bare past the leaves; a thick stub stays with its wood.
 */
function trimBare(plant: Plant, grid: ShadowGrid, dark: number): void {
	const count = plant.nodes;
	const keep = new Uint8Array(count);
	for (let b = 0; b < plant.buds; b++) {
		if (plant.budState[b] !== ALIVE) continue;
		if (siteLight(plant, grid, b, dark) > 0) keep[plant.budNode[b] as number] = 1;
		else plant.budState[b] = DEAD;
	}
	for (let n = 0; n < count; n++) {
		if (!plant.live[n]) continue;
		const order = plant.axisOrder[plant.axisOf[n] as number] as number;
		// A stem keeps its whole length, and a great limb that shed its branches keeps its wood. A
		// fine twig whose buds all died dies back to its last live bud or kept child, so no dead
		// spray stands past the leaves.
		if (order === 0 || (plant.memory[n] as number) > 0) keep[n] = 1;
	}
	// Children come after their parents, so one pass from the end carries a kept node to the root.
	for (let n = count - 1; n >= 0; n--) {
		const p = plant.parent[n] as number;
		if (keep[n] && p >= 0) keep[p] = 1;
	}
	// A stub stays while the wood it stands on stays, unless it is a fine twig's end: a dead stub on
	// the crown's edge stands bare past the leaves.
	for (let n = 0; n < count; n++) {
		const p = plant.parent[n] as number;
		if (p < 0 || !keep[p] || ((plant.flags[n] as number) & NODE_STUB) === 0) continue;
		if ((plant.axisOrder[plant.axisOf[n] as number] as number) <= 1) keep[n] = 1;
	}
	for (let a = 0; a < plant.axes; a++) {
		const first = plant.axisFirst[a] as number;
		if (first < 0 || !plant.live[first]) continue;
		let last = -1;
		for (let n = first; n >= 0; n = plant.next[n] as number) if (keep[n]) last = n;
		if (last < 0) {
			for (let n = first; n >= 0; n = plant.next[n] as number) plant.live[n] = 0;
			continue;
		}
		for (let n = plant.next[last] as number; n >= 0; n = plant.next[n] as number) plant.live[n] = 0;
		plant.next[last] = -1;
		plant.axisTip[a] = last;
	}
	plant.compact();
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
	floor: number,
	dark: number,
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
	const grown = new Float64Array(count);
	const tip = g.pipe.tipRadius;
	pipeRadii(count, plant.parent, plant.live, pipes, g.pipe.exponent, tip, grown);
	let thickest = 0;
	for (let a = 0; a < plant.axes; a++)
		if (plant.axisParentNode[a] === -1)
			thickest = Math.max(thickest, stemRadiusAt(plant, grown, a, BREAST_HEIGHT));
	const stemKeeps = Math.min(1, Math.max(0.5, g.pipe.leader ?? 0.5));
	/** The wood's radii with the stem fitted to a diameter at breast height, or as grown. */
	const girthOf = (diameter: number | undefined): Float64Array => {
		const out = Float64Array.from(grown);
		if (diameter !== undefined) fitRadii(out, count, tip, thickest, diameter / 2);
		// A continuation that halves its girth at one internode draws as a cone. The wood keeps at
		// least half the girth it had below, so a fork's grown taper stays smooth; a stem keeps the
		// record's own share, so a leader that carries its crown to the top is not outgrown by a limb.
		// A parent node comes before its children, so one pass carries the floor up each axis.
		for (let n = 0; n < count; n++) {
			const p = plant.parent[n] as number;
			if (p < 0 || !plant.live[n] || plant.axisOf[p] !== plant.axisOf[n]) continue;
			const keeps = plant.axisOrder[plant.axisOf[n] as number] === 0 ? stemKeeps : 0.5;
			out[n] = Math.max(out[n] as number, keeps * (out[p] as number));
		}
		return out;
	};
	const radius = girthOf(record.size.dbh);
	// The bend weighs the wood at the girth the record fits its strength to, when it gives one, so
	// the drawn diameter can change without moving the crown.
	const girth = g.bending.girth;
	const stiff = girth === undefined || girth === record.size.dbh ? radius : girthOf(girth);

	// The wood bends under its load; the directions that hang on each node turn with it. The crown
	// sags no lower than the envelope's base: wood bent below it rests there.
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
			radius: stiff,
			shoots,
		},
		g.bending.strength,
		g.bending.upturn,
		floor,
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
			light: siteLight(plant, grid, b, dark),
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
