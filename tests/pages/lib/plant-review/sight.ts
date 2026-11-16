// What stands between a close view's camera and its subject. The plant's wood and shoots are laid
// out as spheres, each tagged with the axis it belongs to, and a candidate camera is judged by how
// much of its frame the subject fills and how much the rest of the plant fills in front of the
// subject and behind it. A close view can then stand where its subject shows clear, as the reference
// photographs show theirs: one limb leaving the trunk, one fork, one twig against a plain ground. It
// reads only the skeleton, the shoot rows and the shoot prototypes, so it holds for every species.

import { cross, normalize, placeOnRow, type V3 } from './anatomy';
import type { MacroSkeleton, ShootPrototype, ShootRows } from './plant-types';

/**
 * Spheres in plant space: four numbers each for the centre and the radius, the axis each belongs
 * to, and the shoot row each comes from, or -1 for wood.
 */
export interface Spheres {
	readonly data: Float32Array;
	readonly axis: Int32Array;
	readonly row: Int32Array;
	readonly count: number;
	/**
	 * Four numbers for each run of `RUN` spheres in turn: the centre and radius of a sphere that
	 * holds the whole run, so a frame passes over a run that stands wholly outside it at once.
	 */
	readonly bounds?: Float64Array;
}

/** How many spheres in turn one bounding sphere holds. */
const RUN = 32;

/** The spheres that stand for one shoot prototype, in its own space at scale 1. */
type ShootSamples = Float32Array;

/** Each prototype's spheres, built once per kit. */
const SAMPLES = new WeakMap<readonly ShootPrototype[], readonly ShootSamples[]>();

/** The least spacing of the spheres along an internode, in metres, so a twig stays cheap. */
const LEAST_SPACING = 0.08;
/** The least spacing of the spheres along an internode beyond the reach read in detail. */
const FAR_SPACING = 0.5;
/** The share of a shoot's bounding radius that one sphere stands for, beyond the reach read in detail. */
const FAR_SHOOT = 0.5;
/** The most spheres one internode is laid out as. */
const MOST_ALONG = 12;

/**
 * The spheres of each prototype: one per triangle of its coarsest mesh, at the triangle's centre,
 * as wide as a disc of the triangle's area, so a shoot blocks a view where its leaves do.
 */
function samplesOf(prototypes: readonly ShootPrototype[]): readonly ShootSamples[] {
	const known = SAMPLES.get(prototypes);
	if (known) return known;
	const out = prototypes.map((prototype) => {
		const mesh = prototype.tiers[0];
		const p = mesh.positions;
		const index = mesh.indices;
		const triangles = Math.floor(index.length / 3);
		const data = new Float32Array(triangles * 4);
		for (let t = 0; t < triangles; t++) {
			const a = (index[t * 3] as number) * 3;
			const b = (index[t * 3 + 1] as number) * 3;
			const c = (index[t * 3 + 2] as number) * 3;
			const ux = (p[b] as number) - (p[a] as number);
			const uy = (p[b + 1] as number) - (p[a + 1] as number);
			const uz = (p[b + 2] as number) - (p[a + 2] as number);
			const vx = (p[c] as number) - (p[a] as number);
			const vy = (p[c + 1] as number) - (p[a + 1] as number);
			const vz = (p[c + 2] as number) - (p[a + 2] as number);
			const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
			for (let k = 0; k < 3; k++)
				data[t * 4 + k] = ((p[a + k] as number) + (p[b + k] as number) + (p[c + k] as number)) / 3;
			data[t * 4 + 3] = Math.sqrt(area / Math.PI);
		}
		return data;
	});
	SAMPLES.set(prototypes, out);
	return out;
}

/** The distance from a point to the segment from `a` to `b`. */
function segmentDistance(p: V3, a: V3, b: V3): number {
	const abx = b[0] - a[0];
	const aby = b[1] - a[1];
	const abz = b[2] - a[2];
	const apx = p[0] - a[0];
	const apy = p[1] - a[1];
	const apz = p[2] - a[2];
	const length = abx * abx + aby * aby + abz * abz;
	const t = length > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / length)) : 0;
	return Math.hypot(apx - abx * t, apy - aby * t, apz - abz * t);
}

/** The axis each wind record belongs to, built once per skeleton. */
const AXIS_OF_RECORD = new WeakMap<MacroSkeleton, Map<number, number>>();

/**
 * The axis each wind record belongs to, which names the axis a shoot row grows on. A record that
 * several axes share, as the wind records of a plant with very many axes are shared, names none of
 * them, so a shoot on it counts as no subject's own.
 */
function axisOfRecord(skeleton: MacroSkeleton): Map<number, number> {
	const known = AXIS_OF_RECORD.get(skeleton);
	if (known) return known;
	const map = new Map<number, number>();
	for (let a = 0; a < skeleton.axes.count; a++) {
		const record = skeleton.axes.record[a] as number;
		map.set(record, map.has(record) ? -1 : a);
	}
	AXIS_OF_RECORD.set(skeleton, map);
	return map;
}

/** How many wind records several axes share, whose shoots the close views cannot give an axis. */
export function sharedRecords(skeleton: MacroSkeleton): number {
	let shared = 0;
	for (const axis of axisOfRecord(skeleton).values()) if (axis < 0) shared++;
	return shared;
}

/**
 * A list of spheres that grows as it is filled, with the bounding sphere of each run of spheres
 * it has filled and the box of the run it is filling.
 */
interface SphereList {
	data: Float32Array;
	axis: Int32Array;
	row: Int32Array;
	bounds: Float64Array;
	count: number;
	readonly box: Float64Array;
}

/** A list of spheres with room for some to start with. */
function sphereList(room: number): SphereList {
	return {
		data: new Float32Array(room * 4),
		axis: new Int32Array(room),
		row: new Int32Array(room),
		bounds: new Float64Array(Math.ceil(room / RUN) * 4),
		count: 0,
		box: new Float64Array(6),
	};
}

/**
 * Ends a run of spheres: its bounding sphere stands at the middle of the run's box, as wide as half
 * the box's diagonal, and a hair wider so rounding never leaves a sphere outside it.
 */
function endRun(list: SphereList, run: number): void {
	const box = list.box;
	const hx = ((box[3] as number) - (box[0] as number)) / 2;
	const hy = ((box[4] as number) - (box[1] as number)) / 2;
	const hz = ((box[5] as number) - (box[2] as number)) / 2;
	list.bounds[run * 4] = (box[0] as number) + hx;
	list.bounds[run * 4 + 1] = (box[1] as number) + hy;
	list.bounds[run * 4 + 2] = (box[2] as number) + hz;
	list.bounds[run * 4 + 3] = Math.sqrt(hx * hx + hy * hy + hz * hz) * (1 + 1e-9) + 1e-9;
}

/** Adds one sphere to a list, doubling the list's room when it is full. */
function addSphere(
	list: SphereList,
	x: number,
	y: number,
	z: number,
	radius: number,
	axis: number,
	row: number,
): void {
	if (list.count === list.axis.length) {
		const grown = sphereList(list.axis.length * 2);
		grown.data.set(list.data);
		grown.axis.set(list.axis);
		grown.row.set(list.row);
		grown.bounds.set(list.bounds);
		list.data = grown.data;
		list.axis = grown.axis;
		list.row = grown.row;
		list.bounds = grown.bounds;
	}
	const i = list.count++;
	const d = list.data;
	d[i * 4] = x;
	d[i * 4 + 1] = y;
	d[i * 4 + 2] = z;
	d[i * 4 + 3] = radius;
	list.axis[i] = axis;
	list.row[i] = row;
	// The run's box holds the sphere as the list keeps it, in single precision.
	const sx = d[i * 4] as number;
	const sy = d[i * 4 + 1] as number;
	const sz = d[i * 4 + 2] as number;
	const sr = d[i * 4 + 3] as number;
	const box = list.box;
	if (i % RUN === 0) {
		box[0] = sx - sr;
		box[1] = sy - sr;
		box[2] = sz - sr;
		box[3] = sx + sr;
		box[4] = sy + sr;
		box[5] = sz + sr;
	} else {
		if (sx - sr < (box[0] as number)) box[0] = sx - sr;
		if (sy - sr < (box[1] as number)) box[1] = sy - sr;
		if (sz - sr < (box[2] as number)) box[2] = sz - sr;
		if (sx + sr > (box[3] as number)) box[3] = sx + sr;
		if (sy + sr > (box[4] as number)) box[4] = sy + sr;
		if (sz + sr > (box[5] as number)) box[5] = sz + sr;
	}
	if (i % RUN === RUN - 1) endRun(list, (i - (RUN - 1)) / RUN);
}

/**
 * The plant's wood and shoots as spheres: each internode as a row of spheres of its radius, and
 * each shoot within `reach` metres of `centre` as the spheres of its prototype, turned, scaled and
 * moved as its row places it. Beyond `reach` the plant still stands behind or before a subject, so
 * it is read coarsely: its internodes in wider steps and each shoot as one sphere about its middle.
 */
export function plantSpheres(
	skeleton: MacroSkeleton,
	rows: ShootRows,
	prototypes: readonly ShootPrototype[],
	centre: V3,
	reach: number,
): Spheres {
	const list = sphereList(4096);
	const p = skeleton.position;
	for (let n = 0; n < skeleton.nodeCount; n++) {
		const parent = skeleton.parent[n] as number;
		if (parent < 0) continue;
		const a: V3 = [
			p[parent * 3] as number,
			p[parent * 3 + 1] as number,
			p[parent * 3 + 2] as number,
		];
		const b: V3 = [p[n * 3] as number, p[n * 3 + 1] as number, p[n * 3 + 2] as number];
		const ra = skeleton.radius[parent] as number;
		const rb = skeleton.radius[n] as number;
		const near = segmentDistance(centre, a, b) <= reach + Math.max(ra, rb);
		const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
		const spacing = near ? LEAST_SPACING : FAR_SPACING;
		const steps = Math.min(
			MOST_ALONG,
			Math.max(1, Math.ceil(length / Math.max(spacing, Math.min(ra, rb)))),
		);
		const axis = skeleton.axisOf[n] as number;
		for (let k = 0; k <= steps; k++) {
			const t = k / steps;
			addSphere(
				list,
				a[0] + (b[0] - a[0]) * t,
				a[1] + (b[1] - a[1]) * t,
				a[2] + (b[2] - a[2]) * t,
				ra + (rb - ra) * t,
				axis,
				-1,
			);
		}
	}
	const samples = samplesOf(prototypes);
	const owners = axisOfRecord(skeleton);
	const placed: V3 = [0, 0, 0];
	for (let r = 0; r < rows.count; r++) {
		const prototype = prototypes[rows.prototype[r] as number];
		const points = samples[rows.prototype[r] as number];
		if (!prototype || !points) continue;
		const s = rows.scale[r] as number;
		const x = rows.position[r * 3] as number;
		const y = rows.position[r * 3 + 1] as number;
		const z = rows.position[r * 3 + 2] as number;
		const axis = owners.get(rows.record[r] as number) ?? -1;
		const qx = rows.rotation[r * 4] as number;
		const qy = rows.rotation[r * 4 + 1] as number;
		const qz = rows.rotation[r * 4 + 2] as number;
		const qw = rows.rotation[r * 4 + 3] as number;
		if (Math.hypot(x - centre[0], y - centre[1], z - centre[2]) > reach + prototype.radius * s) {
			// The shoot's middle, half its length along its frame's +Y.
			const half = (prototype.length * s) / 2;
			addSphere(
				list,
				x + 2 * (qx * qy - qw * qz) * half,
				y + (1 - 2 * (qx * qx + qz * qz)) * half,
				z + 2 * (qy * qz + qw * qx) * half,
				prototype.radius * s * FAR_SHOOT,
				axis,
				r,
			);
			continue;
		}
		for (let i = 0; i < points.length; i += 4) {
			placeOnRow(
				rows,
				r,
				points[i] as number,
				points[i + 1] as number,
				points[i + 2] as number,
				placed,
				0,
			);
			addSphere(list, placed[0], placed[1], placed[2], (points[i + 3] as number) * s, axis, r);
		}
	}
	const count = list.count;
	if (count % RUN !== 0) endRun(list, Math.floor(count / RUN));
	return {
		data: list.data.subarray(0, count * 4),
		axis: list.axis.subarray(0, count),
		row: list.row.subarray(0, count),
		count,
		bounds: list.bounds.subarray(0, Math.ceil(count / RUN) * 4),
	};
}

/** A camera that a close view may stand at. */
export interface Shot {
	readonly position: V3;
	readonly target: V3;
}

/**
 * What a view counts as its subject: the wood and shoots of some axes or the leaves of one shoot
 * row, within some metres of the target's depth, or, for a surface such as the crown's outside, all
 * of the plant within those metres. A part of the subject that comes nearer the lens than that
 * stands in front of the rest of it as anything else would.
 */
export interface SubjectMark {
	/** The axes whose spheres are the subject, marked 1, indexed by axis. */
	readonly axes?: Uint8Array;
	/** Whether a marked axis counts by its shoots as well as by its wood. */
	readonly shoots?: boolean;
	/** A shoot row whose spheres are the subject. */
	readonly row?: number;
	/** Metres about the target's depth within which the subject counts as itself. */
	readonly band: number;
}

/** How a frame reads from one camera. */
export interface Clutter {
	/** The share of the frame, weighted toward its middle, that the rest of the plant fills in front of the subject. */
	readonly front: number;
	/** The share of the frame that the rest of the plant fills behind the subject, where a plain ground should be. */
	readonly behind: number;
	/** The share of the frame that the subject fills where nothing stands in front of it. */
	readonly subject: number;
	/** Whether the camera stands inside a part of the plant or under the ground. */
	readonly inside: boolean;
}

/** A camera's own axes: where it looks, and its right and up, with up toward the sky. */
export function lensAxes(shot: Shot): {
	readonly forward: V3;
	readonly right: V3;
	readonly up: V3;
} {
	const forward = normalize([
		shot.target[0] - shot.position[0],
		shot.target[1] - shot.position[1],
		shot.target[2] - shot.position[2],
	]);
	const right = normalize(cross(forward, Math.abs(forward[1]) > 0.999 ? [1, 0, 0] : [0, 1, 0]));
	return { forward, right, up: cross(right, forward) };
}

/** Rows of the coarse grid a frame is judged on; its columns follow the frame's shape. */
const GRID_ROWS = 18;

/** Whether sphere `i` belongs to the subject that `mark` names, at depth `z` against the target's. */
function ofSubject(
	spheres: Spheres,
	i: number,
	mark: SubjectMark,
	z: number,
	depth: number,
): boolean {
	if (Math.abs(z - depth) > mark.band) return false;
	if (!mark.axes && mark.row === undefined) return true;
	const row = spheres.row[i] as number;
	if (mark.row !== undefined && row === mark.row) return true;
	if (!mark.axes || (row >= 0 && !mark.shoots)) return false;
	const axis = spheres.axis[i] as number;
	return axis >= 0 && mark.axes[axis] === 1;
}

/**
 * How a camera's frame reads: how much the subject fills, and how much the rest of the plant fills
 * in front of the subject and behind it. The frame is judged on a coarse grid that counts its middle
 * twice as much as its corners, where a sphere smaller than a cell fills the share of the cell that
 * its disc covers.
 */
export function clutterOf(
	spheres: Spheres,
	shot: Shot,
	fov: number,
	aspect: number,
	mark: SubjectMark,
): Clutter {
	const { forward, right, up } = lensAxes(shot);
	const depth = Math.hypot(
		shot.target[0] - shot.position[0],
		shot.target[1] - shot.position[1],
		shot.target[2] - shot.position[2],
	);
	const tanV = Math.tan((fov * Math.PI) / 360);
	const tanH = tanV * aspect;
	const rows = GRID_ROWS;
	const columns = Math.max(4, Math.round(GRID_ROWS * aspect));
	const front = new Float32Array(columns * rows);
	const behind = new Float32Array(columns * rows);
	const own = new Float32Array(columns * rows);
	let inside = shot.position[1] < 0.05;
	const d = spheres.data;
	const bounds = spheres.bounds;
	// A run whose bounding sphere stands wholly behind the lens or wholly beyond one side of the
	// frame holds only spheres that the frame passes over, and none that holds the lens.
	const slantH = Math.hypot(1, tanH);
	const slantV = Math.hypot(1, tanV);
	const runs = bounds ? Math.ceil(spheres.count / RUN) : 1;
	for (let k = 0; k < runs; k++) {
		if (bounds) {
			const bx = (bounds[k * 4] as number) - shot.position[0];
			const by = (bounds[k * 4 + 1] as number) - shot.position[1];
			const bz = (bounds[k * 4 + 2] as number) - shot.position[2];
			const reach = bounds[k * 4 + 3] as number;
			const z = bx * forward[0] + by * forward[1] + bz * forward[2];
			if (z + reach <= 0) continue;
			const x = bx * right[0] + by * right[1] + bz * right[2];
			const y = bx * up[0] + by * up[1] + bz * up[2];
			if (Math.abs(x) - z * tanH > reach * slantH) continue;
			if (Math.abs(y) - z * tanV > reach * slantV) continue;
		}
		const from = bounds ? k * RUN : 0;
		const to = bounds ? Math.min(spheres.count, from + RUN) : spheres.count;
		for (let i = from; i < to; i++) {
			const vx = (d[i * 4] as number) - shot.position[0];
			const vy = (d[i * 4 + 1] as number) - shot.position[1];
			const vz = (d[i * 4 + 2] as number) - shot.position[2];
			const radius = d[i * 4 + 3] as number;
			if (vx * vx + vy * vy + vz * vz < radius * radius) inside = true;
			const z = vx * forward[0] + vy * forward[1] + vz * forward[2];
			if (z <= radius) continue;
			const into = ofSubject(spheres, i, mark, z, depth) ? own : z < depth ? front : behind;
			// The sphere's place and size on the grid, in cells.
			const cx = ((vx * right[0] + vy * right[1] + vz * right[2]) / (z * tanH) + 1) * 0.5 * columns;
			const cy = (1 - (vx * up[0] + vy * up[1] + vz * up[2]) / (z * tanV)) * 0.5 * rows;
			const rx = (radius / (z * tanH)) * 0.5 * columns;
			const ry = (radius / (z * tanV)) * 0.5 * rows;
			if (cx + rx < 0 || cy + ry < 0 || cx - rx > columns || cy - ry > rows) continue;
			if (rx < 0.5 && ry < 0.5) {
				const x = Math.floor(cx);
				const y = Math.floor(cy);
				if (x >= 0 && y >= 0 && x < columns && y < rows)
					into[y * columns + x] = Math.min(
						1,
						(into[y * columns + x] as number) + Math.PI * rx * ry,
					);
				continue;
			}
			const x0 = Math.max(0, Math.floor(cx - rx));
			const x1 = Math.min(columns - 1, Math.floor(cx + rx));
			const y0 = Math.max(0, Math.floor(cy - ry));
			const y1 = Math.min(rows - 1, Math.floor(cy + ry));
			for (let y = y0; y <= y1; y++)
				for (let x = x0; x <= x1; x++) {
					const dx = (x + 0.5 - cx) / rx;
					const dy = (y + 0.5 - cy) / ry;
					if (dx * dx + dy * dy <= 1) into[y * columns + x] = 1;
				}
		}
	}
	let weights = 0;
	let frontSum = 0;
	let behindSum = 0;
	let ownSum = 0;
	for (let y = 0; y < rows; y++)
		for (let x = 0; x < columns; x++) {
			const u = ((x + 0.5) / columns) * 2 - 1;
			const v = ((y + 0.5) / rows) * 2 - 1;
			const w = 2 - Math.min(1, Math.hypot(u, v) / Math.SQRT2);
			const at = y * columns + x;
			const ahead = front[at] as number;
			const mine = Math.min(1 - ahead, own[at] as number);
			weights += w;
			frontSum += w * ahead;
			ownSum += w * mine;
			// What the subject hides does not count as its background.
			behindSum += w * Math.min(1 - ahead - mine, behind[at] as number);
		}
	return {
		front: frontSum / weights,
		behind: behindSum / weights,
		subject: ownSum / weights,
		inside,
	};
}

/** A candidate camera, with what the view prefers in it beside how clear its frame is. */
export interface Candidate extends Shot {
	/** Taken off the candidate's score: what the view prefers in it, such as a wider fork. */
	readonly bonus?: number;
}

/** The candidate that frames its subject the clearest, with its clutter and its score. */
export interface Choice<T extends Candidate> {
	readonly candidate: T;
	readonly clutter: Clutter;
	readonly score: number;
}

/** How a view weighs a frame beside the plant that stands in front of its subject. */
export interface Weighing {
	/** The charge for each share of the frame that the rest of the plant fills behind the subject. */
	readonly behind: number;
	/** The share of the frame that the photograph's subject fills. */
	readonly fill: number;
	/** The charge for each share of the frame by which the subject falls short of `fill`. */
	readonly short: number;
	/**
	 * Whether the plant behind the subject counts toward its fill, for a subject that is a surface
	 * with depth, such as the crown's outside, where a frame that sees into the crown is no fault of
	 * the camera's.
	 */
	readonly behindFills?: boolean;
}

/**
 * The candidate whose frame is the clearest: the least of the rest of the plant in front of its
 * subject, then what the view charges for the plant behind it and for a subject that fills too
 * little of the frame, less the candidate's own bonus. A camera inside a part of the plant or under
 * the ground loses to any other.
 */
export function clearest<T extends Candidate>(
	candidates: readonly T[],
	spheres: Spheres,
	fov: number,
	aspect: number,
	mark: SubjectMark,
	weighing: Weighing,
): Choice<T> | undefined {
	let best: Choice<T> | undefined;
	for (const candidate of candidates) {
		const clutter = clutterOf(spheres, candidate, fov, aspect, mark);
		const filled = clutter.subject + (weighing.behindFills ? clutter.behind : 0);
		const score =
			clutter.front +
			weighing.behind * clutter.behind +
			weighing.short * Math.max(0, weighing.fill - filled) -
			(candidate.bonus ?? 0) +
			(clutter.inside ? 10 : 0);
		if (!best || score < best.score) best = { candidate, clutter, score };
	}
	return best;
}
