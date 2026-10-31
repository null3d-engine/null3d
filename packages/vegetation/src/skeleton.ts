// The skeleton: every branch of a plant as a curved path with a radius at each sample. Growth makes
// every random choice here, and the meshing step only reads the result, so each detail level keeps
// the same shape. Radii follow the pipe model: a branch's cross section carries the tips beyond it.
import { crownScale } from './crown';
import { hashAt, unitAt } from './hash';
import { type BranchLevel, MAX_BRANCHES, type Species, type SpeciesKind } from './species';

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

/**
 * Grows one branch and its children. The path curves and bends with the crown's pull; the children
 * start along it, each with an angle, a turn and a length of its own. Radii follow once the tips
 * exist, so a branch's thickness carries everything beyond it.
 */
function grow(
	growth: Growth,
	level: number,
	parent: number,
	origin: [number, number, number],
	direction: [number, number, number],
	length: number,
	branchKey: number,
): number {
	const { species, seed, variant } = growth;
	const levelRecord: BranchLevel | undefined = species.branchLevels[level];
	if (!levelRecord || growth.branches.length >= MAX_BRANCHES) return -1;
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
	};
	growth.branches.push(branch);

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
		for (let k = 0; k < count; k++) {
			const key = branchKey * 0x9e37 + k + 1;
			if (unitAt(seed, species.seedSalt, variant, key, KEY_TILT) < levelRecord.prune) continue;
			const jitter = (unitAt(seed, species.seedSalt, variant, key, KEY_ANGLE) - 0.5) * 0.6;
			const along =
				whorls > 0
					? (Math.floor(k / perWhorl) + 0.5) / Math.min(whorls, count)
					: (k + 0.5 + jitter) / count;
			const share = childLevel.start + (childLevel.end - childLevel.start) * along;
			const sample = Math.round(share * (samples - 1));
			const [cx, cy, cz] = pointAt(points, sample);
			const [tx, ty, tz] = directionAt(points, sample);
			const heightShare = Math.min(
				1,
				Math.max(0, (cy - growth.crownStart) / Math.max(1e-6, growth.top - growth.crownStart)),
			);
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
			const angle =
				(childLevel.angle +
					(unitAt(seed, species.seedSalt, variant, key, KEY_TILT) * 2 - 1) *
						childLevel.angleVariance) *
				RADIANS;
			const [sx, sy, sz] = sideOf(tx, ty, tz);
			const [tiltedX, tiltedY, tiltedZ] = rotate(tx, ty, tz, sx, sy, sz, angle);
			const yaw =
				GOLDEN_ANGLE * k +
				levelRecord.twist * RADIANS * level +
				(unitAt(seed, species.seedSalt, variant, key, KEY_TWIST) * 2 - 1) * 0.4;
			const [cdx, cdy, cdz] = rotate(tiltedX, tiltedY, tiltedZ, tx, ty, tz, yaw);
			const child = grow(growth, level + 1, index, [cx, cy, cz], [cdx, cdy, cdz], childLength, key);
			if (child >= 0) {
				children.push(child);
				attach.push(sample);
			}
		}
	}

	// The pipe model: a branch's cross section carries its tip and every child's base.
	let area = levelRecord.taper * levelRecord.taper;
	for (let i = samples - 1; i >= 0; i--) {
		for (let c = 0; c < children.length; c++) {
			if (attach[c] === i) area += (growth.branches[children[c] as number]?.radii[0] ?? 0) ** 2;
		}
		radii[i] = Math.sqrt(area);
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
	return index;
}

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
	for (let t = 0; t < trunks; t++) {
		const angle = (t / Math.max(1, trunks)) * Math.PI * 2;
		const ring = trunks > 1 ? height * 0.035 : 0;
		const origin: [number, number, number] = [Math.cos(angle) * ring, 0, Math.sin(angle) * ring];
		const lean = trunks > 1 ? 0.18 : 0.045;
		const yaw = unitAt(seed, species.seedSalt, variant, t, KEY_TILT) * Math.PI * 2;
		const direction = normalize(Math.cos(yaw) * lean, 1, Math.sin(yaw) * lean);
		const trunkLength =
			height *
			(trunks > 1 ? 0.72 + 0.25 * unitAt(seed, species.seedSalt, variant, t, KEY_LENGTH) : 1) *
			(trunkLevel ? 1 : 0);
		grow(growth, 0, -1, origin, direction, trunkLength, t === 0 ? 0 : 0x10000 + t);
	}
	return { branches, height, crownStart };
}
