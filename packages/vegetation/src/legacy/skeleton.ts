// The skeleton: every branch of a plant as a curved path with a radius at each sample. Growth makes
// every random choice here, and the meshing step only reads the result, so each detail level keeps
// the same shape. Radii follow the pipe model: a branch's cross section carries the tips beyond it.

import { hashAt, unitAt } from '../core/hash';
import { crownScale } from './crown';
import {
	type BranchLevel,
	MAX_BRANCHES,
	MAX_PLANT_BRANCHES,
	type Species,
	type SpeciesKind,
} from './species';

/** One branch: its path, its radius at each sample, and its place in the plant's tree. */
export interface SkeletonBranch {
	/** The branch level, counted from the trunk's 0. */
	readonly level: number;
	/** The parent's index, or -1 for a trunk. */
	readonly parent: number;
	/** The path's samples, three numbers each. */
	readonly points: Float32Array;
	/** The radius at each sample, in meters. */
	readonly radii: Float32Array;
	/**
	 * A multiplier on the drawn radius at each sample where a branch swells at its base, or absent
	 * when it does not. It scales the mesh only: the pipe model keeps the radius that carries the
	 * wood beyond, so a limb's swell does not thicken the trunk it grows from.
	 */
	flares?: Float32Array;
	/** The radial sides of the branch at full detail. */
	readonly sides: number;
	/** The phase that the branch's leaves flutter with, from 0 to 255. */
	readonly flutter: number;
	/** The branch's length along its path, in meters. */
	readonly length: number;
	/** The child branches' indices, in the order they grow. */
	readonly children: number[];
	/** For each child, the sample of this branch where it starts. */
	readonly attach: number[];
	/**
	 * The wind table's record that this branch reads: its own index while the table has a row for it,
	 * and its parent's record beyond the table's width.
	 */
	wind: number;
}

/** The grown plant's branch system. */
export interface Skeleton {
	/** Every branch, the trunks first. */
	readonly branches: SkeletonBranch[];
	/** The plant's nominal height, in meters. */
	readonly height: number;
	/** The height where the crown starts, in meters. */
	readonly crownStart: number;
}

/** The golden angle, which spreads a parent's children around it without repeating. */
const GOLDEN_ANGLE = 2.399963229728653;

/** Degrees to radians. */
const RADIANS = Math.PI / 180;

/** The random stream keys of one branch's choices. */
const KEY_LENGTH = 1;
const KEY_ANGLE = 2;
const KEY_CURVE = 3;
const KEY_TWIST = 4;
const KEY_FLUTTER = 5;
const KEY_TILT = 6;

/** Three numbers of a point in a path. */
function pointAt(points: Float32Array, index: number): [number, number, number] {
	const at = index * 3;
	return [points[at] as number, points[at + 1] as number, points[at + 2] as number];
}

/** The direction of a path's sample, from the samples either side of it. */
function directionAt(points: Float32Array, index: number): [number, number, number] {
	const last = points.length / 3 - 1;
	const [ax, ay, az] = pointAt(points, Math.max(0, index - 1));
	const [bx, by, bz] = pointAt(points, Math.min(last, index + 1));
	return normalize(bx - ax, by - ay, bz - az);
}

/** A direction of unit length, or the closest it can make from a zero vector. */
function normalize(x: number, y: number, z: number): [number, number, number] {
	const length = Math.hypot(x, y, z);
	return length > 1e-9 ? [x / length, y / length, z / length] : [0, 1, 0];
}

/** Rotates a direction around an axis by an angle in radians, with Rodrigues' formula. */
function rotate(
	x: number,
	y: number,
	z: number,
	ax: number,
	ay: number,
	az: number,
	angle: number,
): [number, number, number] {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const dot = x * ax + y * ay + z * az;
	return normalize(
		x * cos + (ay * z - az * y) * sin + ax * dot * (1 - cos),
		y * cos + (az * x - ax * z) * sin + ay * dot * (1 - cos),
		z * cos + (ax * y - ay * x) * sin + az * dot * (1 - cos),
	);
}

/** A perpendicular unit axis of a direction, which the curve turns around. */
function sideOf(x: number, y: number, z: number): [number, number, number] {
	// The cross product with the world's up; a vertical direction falls back to the x axis.
	const cx = y * 0 - z * 1;
	const cy = z * 0 - x * 0;
	const cz = x * 1 - y * 0;
	if (Math.hypot(cx, cy, cz) < 1e-6) return [1, 0, 0];
	return normalize(cx, cy, cz);
}

/** What one plant's growth carries from a branch to its children. */
interface Growth {
	readonly species: Species;
	readonly seed: number;
	readonly variant: number;
	readonly branches: SkeletonBranch[];
	/** The height of the crown's top, which scales a branch by where it sits. */
	readonly top: number;
	readonly crownStart: number;
}

/** A branch whose place in the plant is known but whose children are still to come. */
interface BranchSpec {
	readonly level: number;
	/** The branch that this one leaves from, or -1 at the plant's base. */
	readonly parent: number;
	readonly origin: [number, number, number];
	readonly direction: [number, number, number];
	readonly length: number;
	readonly key: number;
	/** The parent's sample that this branch leaves from, which its parent records. */
	readonly attach: number;
}

/**
 * Places one branch and queues its children. The path curves and bends with the crown's pull; the
 * children start along it, each with an angle, a turn and a length of its own. The children wait in
 * the queue, so a plant's branches grow a level at a time rather than one branch's whole subtree at
 * a time, and a shared branch budget is shared across the plant instead of spent in walk order.
 */
function place(growth: Growth, spec: BranchSpec, queue: BranchSpec[]): number {
	const { level, parent, origin, direction, length, key: branchKey } = spec;
	const { species, seed, variant } = growth;
	const levelRecord: BranchLevel | undefined = species.branchLevels[level];
	if (!levelRecord || growth.branches.length >= MAX_PLANT_BRANCHES) return -1;
	const index = growth.branches.length;
	const sides = levelRecord.sides;
	const samples = levelRecord.segments + 1;
	const points = new Float32Array(samples * 3);
	const radii = new Float32Array(samples);
	const children: number[] = [];
	const attach: number[] = [];
	const branch: SkeletonBranch = {
		level,
		parent,
		points,
		radii,
		sides,
		flutter: hashAt(seed, species.seedSalt, variant, branchKey, KEY_FLUTTER) & 0xff,
		length,
		children,
		attach,
		wind: index,
	};
	growth.branches.push(branch);
	if (parent >= 0) {
		const from = growth.branches[parent];
		from?.children.push(index);
		from?.attach.push(spec.attach);
	}

	const step = length / Math.max(1, samples - 1);
	let [dx, dy, dz] = direction;
	let [px, py, pz] = origin;
	points[0] = px;
	points[1] = py;
	points[2] = pz;
	const curve =
		levelRecord.curve +
		(unitAt(seed, species.seedSalt, variant, branchKey, KEY_CURVE) * 2 - 1) *
			levelRecord.curveVariance;
	const curveStep = (curve * RADIANS) / Math.max(1, samples - 1);
	const pull = level === 0 ? 0 : species.crown.pull;
	const pullStep = Math.abs(pull) * 0.35;
	for (let i = 1; i < samples; i++) {
		const [sx, sy, sz] = sideOf(dx, dy, dz);
		[dx, dy, dz] = rotate(dx, dy, dz, sx, sy, sz, curveStep);
		if (pullStep > 0) {
			// Each step blends the direction a little toward the crown's pull, down or up.
			const k = Math.min(0.5, pullStep / Math.max(1, samples - 1));
			[dx, dy, dz] = normalize(dx * (1 - k), dy * (1 - k) + (pull > 0 ? -k : k), dz * (1 - k));
		}
		px += dx * step;
		py += dy * step;
		pz += dz * step;
		points[i * 3] = px;
		points[i * 3 + 1] = py;
		points[i * 3 + 2] = pz;
	}

	// Children start from the parent's path, between the shares its level names.
	const childLevel: BranchLevel | undefined = species.branchLevels[level + 1];
	if (childLevel && levelRecord.children > 0) {
		const count = Math.max(0, Math.round(levelRecord.children));
		// A whorled level groups its children into rings at the same height, as a conifer's boughs
		// grow. Each ring carries a plate of branches that spread level, so a crown of rings reads as
		// layered shelves with air between them rather than one even mass.
		const whorls = Math.max(0, Math.floor(childLevel.whorls ?? 0));
		const perWhorl = whorls > 0 ? Math.max(1, Math.ceil(count / whorls)) : count;
		const rings = Math.min(whorls, count);
		for (let k = 0; k < count; k++) {
			const key = branchKey * 0x9e37 + k + 1;
			const jitter = (unitAt(seed, species.seedSalt, variant, key, KEY_ANGLE) - 0.5) * 0.6;
			const ring = Math.floor(k / perWhorl);
			// A record may hold its last ring at the parent's tip, so a conifer's crown closes over
			// its trunk and the tree ends in boughs rather than a bare stick.
			const along =
				whorls > 0
					? childLevel.whorlTip === true && ring >= rings - 1
						? 1
						: (ring + 0.5) / rings
					: (k + 0.5 + jitter) / count;
			const share = childLevel.start + (childLevel.end - childLevel.start) * along;
			const sample = Math.round(share * (samples - 1));
			const [cx, cy, cz] = pointAt(points, sample);
			const [tx, ty, tz] = directionAt(points, sample);
			const heightShare = Math.min(
				1,
				Math.max(0, (cy - growth.crownStart) / Math.max(1e-6, growth.top - growth.crownStart)),
			);
			// The crown thins as it rises: a hash that a high child must beat drops it, so an upper
			// limb forks less than a lower one.
			const thin = childLevel.thin ?? 0;
			if (
				unitAt(seed, species.seedSalt, variant, key, KEY_TILT) <
				levelRecord.prune + thin * heightShare
			)
				continue;
			const scale = crownScale(
				species.crown.shape,
				species.crown.spread,
				heightShare,
				species.crown.floor,
			);
			const variance =
				1 +
				(unitAt(seed, species.seedSalt, variant, key, KEY_LENGTH) * 2 - 1) *
					childLevel.lengthVariance;
			const childLength = Math.max(0.01, childLevel.length * scale * variance);
			const spread =
				childLevel.angle +
				(unitAt(seed, species.seedSalt, variant, key, KEY_TILT) * 2 - 1) * childLevel.angleVariance;
			// A species turns its limbs toward the trunk as they approach the crown's top, so the
			// crown closes over its own axis instead of keeping the lower limbs' spread angle.
			const upright = childLevel.upright ?? 0;
			const angle = (upright > 0 ? Math.max(0, spread - upright * heightShare) : spread) * RADIANS;
			const [sx, sy, sz] = sideOf(tx, ty, tz);
			const [tiltedX, tiltedY, tiltedZ] = rotate(tx, ty, tz, sx, sy, sz, angle);
			// A whorled level spaces each ring's boughs evenly around it, and turns each ring by the
			// golden angle, so no direction between two boughs goes thin all the way up the tree. An
			// even spread by the child's own number would not: a ring of three boughs at a golden
			// angle from each other leaves three gaps that line up with each other on some views.
			// A level's children spread evenly around their parent: the golden angle leaves a gap of
			// eighty-five degrees between two of six limbs, and a view across that gap sees a crown
			// with nothing at its edge. A whorl keeps the same spacing within each ring, and its rings
			// turn by the golden angle against each other.
			const yaw =
				(whorls > 0
					? ((k % perWhorl) / perWhorl) * Math.PI * 2 + ring * GOLDEN_ANGLE
					: (k / count) * Math.PI * 2) +
				levelRecord.twist * RADIANS * level +
				(unitAt(seed, species.seedSalt, variant, key, KEY_TWIST) * 2 - 1) *
					(whorls > 0 ? WHORL_YAW_JITTER : 0.4);
			const [cdx, cdy, cdz] = rotate(tiltedX, tiltedY, tiltedZ, tx, ty, tz, yaw);
			queue.push({
				level: level + 1,
				parent: index,
				origin: [cx, cy, cz],
				direction: [cdx, cdy, cdz],
				length: childLength,
				key,
				attach: sample,
			});
		}
	}

	return index;
}

/**
 * Gives one placed branch its radii: the pipe model's least thickness that carries its tip and every
 * child's base, the record's taper, and the swells at its base and, for a trunk, at the ground. It
 * runs after every branch exists, from the tips back, so a branch reads its children's radii.
 */
function finish(growth: Growth, branch: SkeletonBranch): void {
	const { species } = growth;
	const levelRecord = species.branchLevels[branch.level] as BranchLevel;
	const { points, radii, children, attach, level } = branch;
	const samples = radii.length;
	const origin: [number, number, number] = [
		points[0] as number,
		points[1] as number,
		points[2] as number,
	];

	// The pipe model: a branch's cross section carries its tip and every child's base.
	let area = levelRecord.taper * levelRecord.taper;
	for (let i = samples - 1; i >= 0; i--) {
		for (let c = 0; c < children.length; c++) {
			if (attach[c] === i) area += (growth.branches[children[c] as number]?.radii[0] ?? 0) ** 2;
		}
		radii[i] = Math.sqrt(area);
	}

	// The pipe model holds a branch's radius constant between the limbs that leave it, which reads as
	// a stack of cylinders. A record that asks for a taper pulls each point toward one cone from the
	// branch's base to its tip, never wider than the pipe model asks, so the wood narrows as it rises.
	const taperCurve = levelRecord.taperCurve ?? 0;
	if (taperCurve > 0 && samples > 2) {
		const baseRadius = radii[0] as number;
		const tipRadius = radii[samples - 1] as number;
		for (let i = 1; i < samples - 1; i++) {
			const cone = baseRadius + (tipRadius - baseRadius) * (i / (samples - 1));
			// The taper never widens the wood: the pipe model's radius is the least that carries the
			// limbs beyond, and a cone that would exceed it leaves that point alone.
			const line = Math.min(radii[i] as number, cone);
			radii[i] = (radii[i] as number) + (line - (radii[i] as number)) * taperCurve;
		}
	}

	// A branch widens where it leaves its parent, so a limb swells into the wood it grows from. The
	// swell is drawn, not piped: it scales the branch's radius where it is meshed, so the parent does
	// not thicken to carry a child that is fatter only at its joint.
	const baseFlare = levelRecord.baseFlare ?? 0;
	if (baseFlare > 0 && level > 0) {
		const swell = Math.max(2, Math.round(samples * 0.2));
		const scale = new Float32Array(samples).fill(1);
		for (let i = 0; i < swell && i < samples; i++) {
			const t = 1 - i / swell;
			scale[i] = 1 + baseFlare * t * t;
		}
		branch.flares = scale;
	}

	// The pipe model sizes a bole by the wood it carries, so a plant on few limbs comes out thinner
	// than its own reference. A record may hold a floor under the trunk's base radius, and the whole
	// trunk thickens with it rather than swelling at one point.
	const boleRadius = (species.boleRadius ?? 0) * growth.top;
	if (level === 0 && boleRadius > 0 && (radii[0] as number) < boleRadius) {
		const thicken = boleRadius / ((radii[0] as number) || 1);
		for (let i = 0; i < samples; i++) radii[i] = (radii[i] as number) * thicken;
	}

	// A trunk widens where it meets the ground, so it reads as seated rather than pushed in.
	if (level === 0) {
		const flareHeight = Math.max(0.05, species.height * 0.08);
		for (let i = 0; i < samples; i++) {
			const above = (points[i * 3 + 1] as number) - origin[1];
			if (above >= flareHeight) break;
			const t = 1 - Math.max(0, above) / flareHeight;
			radii[i] = (radii[i] as number) * (1 + species.flare * t * t);
		}
	}
}

/**
 * How far a whorled bough's angle may wander from its ring's place, in radians. A ring spreads its
 * boughs evenly, and a wide wander breaks that spread, so the cone's width moves with the view.
 */
const WHORL_YAW_JITTER = 0.15;

/** The kinds that grow a branch system rather than a rosette. */
const BRANCHED: ReadonlySet<SpeciesKind> = new Set(['tree', 'conifer', 'shrub']);

/**
 * Grows a plant's skeleton: one trunk or several, each with its children's branches, down to the
 * level that carries the leaves. The same seed and species give the same branches on every device.
 *
 * @param species The species record.
 * @param seed The scene's seed.
 * @param variant The variant's index.
 * @returns The grown branch system.
 * @category api/vegetation
 */
export function growSkeleton(species: Species, seed: number, variant: number): Skeleton {
	const heightVariance =
		1 + (unitAt(seed, species.seedSalt, variant, 0, KEY_LENGTH) * 2 - 1) * species.heightVariance;
	const height = species.height * heightVariance;
	const trunks = BRANCHED.has(species.kind) ? Math.max(1, Math.round(species.trunks)) : 0;
	const branches: SkeletonBranch[] = [];
	const crownStart = height * species.crown.start;
	if (trunks === 0 || species.branchLevels.length === 0) return { branches, height, crownStart };

	const growth: Growth = { species, seed, variant, branches, top: height, crownStart };
	const trunkLevel = species.branchLevels[0];
	const leader = species.leader ?? 1;
	const lean = species.stemLean ?? 0.18;
	// The plant grows a level at a time: a branch placed now queues its children at the end, so every
	// branch of one level exists before any branch of the next begins.
	const queue: BranchSpec[] = [];
	for (let t = 0; t < trunks; t++) {
		const angle = (t / Math.max(1, trunks)) * Math.PI * 2;
		const ring = trunks > 1 ? height * 0.035 : 0;
		const origin: [number, number, number] = [Math.cos(angle) * ring, 0, Math.sin(angle) * ring];
		// A record that states a lean sets the trunk's first direction, whether the plant has one stem
		// or many; a record that states none stands nearly upright. A lean that only tilted the base
		// would fight the trunk's curve, and a trunk that should arc out of the ground came out
		// straighter the more curve it was given.
		const leanAt = trunks > 1 ? lean : (species.stemLean ?? 0.045);
		const yaw = unitAt(seed, species.seedSalt, variant, t, KEY_TILT) * Math.PI * 2;
		const direction = normalize(Math.cos(yaw) * leanAt, 1, Math.sin(yaw) * leanAt);
		const trunkLength =
			height *
			leader *
			(trunks > 1 ? 0.72 + 0.25 * unitAt(seed, species.seedSalt, variant, t, KEY_LENGTH) : 1) *
			(trunkLevel ? 1 : 0);
		queue.push({
			level: 0,
			parent: -1,
			origin,
			direction,
			length: trunkLength,
			key: t === 0 ? 0 : 0x10000 + t,
			attach: 0,
		});
	}
	for (let at = 0; at < queue.length; at++) place(growth, queue[at] as BranchSpec, queue);
	// The wind table has one record for each of the first MAX_BRANCHES branches, because a vertex
	// colour names its record in a byte. A branch beyond them reads its parent's record, so the
	// table stays 255 wide while the plant subdivides as its record asks.
	for (let at = MAX_BRANCHES; at < branches.length; at++) {
		const branch = branches[at] as SkeletonBranch;
		branch.wind = branches[branch.parent]?.wind ?? 0;
	}
	// The radii run from the tips back, so every branch reads the thickness it must carry.
	for (let at = branches.length - 1; at >= 0; at--) finish(growth, branches[at] as SkeletonBranch);
	return { branches, height, crownStart };
}
