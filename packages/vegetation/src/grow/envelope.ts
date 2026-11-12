// The envelope: the outline a self-organizing plant fills, measured from its reference turntable or
// given as a solid. A grower reads it as a volume in metres: the radius to the outline at a height and
// an azimuth, and the room left to it from a point, which steers shoots toward the outline and stops
// them at it. The silhouette functions draw the envelope and a grown skeleton from the side on one
// grid, so a test can measure how well a plant fills its envelope from eight sides.
import type { ShootRows } from '../asset';
import type { MacroSkeleton } from '../core/graph';
import { atan2, cos, PI, sin } from '../core/math';
import type { Envelope, Sdf } from '../core/record';
import type { Vec3 } from '../core/types';

/** Azimuths a radial envelope is resampled to. */
const AZIMUTHS = 16;
const TAU = 2 * PI;

/**
 * An envelope in metres, for one plant of one height, turned by the variant's angle.
 */
export interface EnvelopeVolume {
	/** The lowest height inside it, in metres. */
	readonly base: number;
	/** The highest height inside it, in metres. */
	readonly top: number;
	/** The largest distance from the plant's axis to its outline, in metres. */
	readonly reach: number;
	/**
	 * Metres from the plant's axis to the outline at a height and an azimuth (radians from +X toward
	 * +Z), or 0 where the height is outside it.
	 */
	radius(y: number, azimuth: number): number;
	/** Metres of room from a point to the outline, across: positive inside, negative outside. */
	room(x: number, y: number, z: number): number;
}

/** A number squared. */
function square(x: number): number {
	return x * x;
}

/** The length of a horizontal offset. */
function across2(x: number, z: number): number {
	return Math.sqrt(x * x + z * z);
}

/** An angle wrapped into [0, 2π). */
function wrap(angle: number): number {
	const turns = Math.floor(angle / TAU);
	return angle - turns * TAU;
}

/** A radial envelope's radii at one height, resampled to the fixed azimuth count, in shares. */
function resampled(value: number | readonly number[]): Float64Array {
	const out = new Float64Array(AZIMUTHS);
	if (typeof value === 'number') return out.fill(value);
	const n = value.length;
	for (let a = 0; a < AZIMUTHS; a++) {
		const k = (a / AZIMUTHS) * n;
		const i = Math.floor(k);
		const w = k - i;
		out[a] = (value[i % n] as number) * (1 - w) + (value[(i + 1) % n] as number) * w;
	}
	return out;
}

/** A radial envelope as a volume. */
function radialVolume(
	heights: readonly number[],
	radii: readonly (number | readonly number[])[],
	height: number,
	turn: number,
): EnvelopeVolume {
	const rows = radii.map(resampled);
	let reach = 0;
	for (const row of rows) for (const r of row) reach = Math.max(reach, r * height);
	const base = (heights[0] as number) * height;
	const top = (heights[heights.length - 1] as number) * height;
	const radius = (y: number, azimuth: number): number => {
		const t = y / height;
		const last = heights.length - 1;
		if (t < (heights[0] as number) || t > (heights[last] as number)) return 0;
		let i = 0;
		while (i < last - 1 && t > (heights[i + 1] as number)) i++;
		const h0 = heights[i] as number;
		const h1 = heights[i + 1] as number;
		const w = h1 > h0 ? (t - h0) / (h1 - h0) : 0;
		const k = (wrap(azimuth - turn) / TAU) * AZIMUTHS;
		const a0 = Math.floor(k) % AZIMUTHS;
		const a1 = (a0 + 1) % AZIMUTHS;
		const u = k - Math.floor(k);
		const r0 = rows[i] as Float64Array;
		const r1 = rows[i + 1] as Float64Array;
		const low = (r0[a0] as number) * (1 - u) + (r0[a1] as number) * u;
		const high = (r1[a0] as number) * (1 - u) + (r1[a1] as number) * u;
		return (low * (1 - w) + high * w) * height;
	};
	return {
		base,
		top,
		reach,
		radius,
		room(x, y, z) {
			const across = Math.sqrt(x * x + z * z);
			const r = radius(y, atan2(z, x));
			// Above or below the envelope's heights, the room is the distance to its nearest height.
			if (y < base) return Math.min(r, -(base - y));
			if (y > top) return Math.min(r, -(y - top));
			return r - across;
		},
	};
}

/** The signed distance from a point to a solid, negative inside, and the solid's extent. */
interface Solid {
	distance(x: number, y: number, z: number): number;
	readonly top: number;
	readonly base: number;
	readonly reach: number;
}

/**
 * A solid from its description. Each stands on the ground about the plant's axis: a box of the
 * given width, height and depth, rounded at its edges; an ellipsoid of the given half-axes resting
 * on the ground; a cone or a cylinder of the given radius and height; a spiral tube of the given
 * thickness winding up a cone; or a union of these, each moved by its `at`.
 */
function solidOf(shape: Sdf, at: Vec3 = [0, 0, 0]): Solid {
	const [ox, oy, oz] = at;
	if ('box' in shape) {
		const [w, h, d] = shape.box;
		const r = Math.min(shape.round, w / 2, h / 2, d / 2);
		const hx = w / 2 - r;
		const hy = h / 2 - r;
		const hz = d / 2 - r;
		return {
			base: oy,
			top: oy + h,
			reach: Math.sqrt(w * w + d * d) / 2 + Math.sqrt(ox * ox + oz * oz),
			distance(x, y, z) {
				const qx = Math.abs(x - ox) - hx;
				const qy = Math.abs(y - oy - h / 2) - hy;
				const qz = Math.abs(z - oz) - hz;
				const outside = Math.sqrt(
					square(Math.max(qx, 0)) + square(Math.max(qy, 0)) + square(Math.max(qz, 0)),
				);
				return outside + Math.min(Math.max(qx, qy, qz), 0) - r;
			},
		};
	}
	if ('ellipsoid' in shape) {
		const [a, b, c] = shape.ellipsoid;
		return {
			base: oy,
			top: oy + 2 * b,
			reach: Math.max(a, c) + Math.sqrt(ox * ox + oz * oz),
			distance(x, y, z) {
				const px = (x - ox) / a;
				const py = (y - oy - b) / b;
				const pz = (z - oz) / c;
				const k = Math.sqrt(px * px + py * py + pz * pz);
				// The distance in the shortest half-axis's metres, which never overstates it.
				return (k - 1) * Math.min(a, b, c);
			},
		};
	}
	if ('cone' in shape) {
		const { radius, height } = shape.cone;
		const slant = Math.sqrt(radius * radius + height * height);
		return {
			base: oy,
			top: oy + height,
			reach: radius + Math.sqrt(ox * ox + oz * oz),
			distance(x, y, z) {
				const across = across2(x - ox, z - oz);
				const h = y - oy;
				const side = ((across - radius * (1 - h / height)) * height) / slant;
				return Math.max(side, -h, h - height);
			},
		};
	}
	if ('cylinder' in shape) {
		const { radius, height } = shape.cylinder;
		return {
			base: oy,
			top: oy + height,
			reach: radius + Math.sqrt(ox * ox + oz * oz),
			distance(x, y, z) {
				const across = across2(x - ox, z - oz);
				const h = y - oy;
				return Math.max(across - radius, -h, h - height);
			},
		};
	}
	if ('spiral' in shape) {
		const { radius, height, turns, thickness } = shape.spiral;
		const samples = Math.max(16, Math.ceil(turns * 48));
		return {
			base: oy,
			top: oy + height + thickness,
			reach: radius + thickness + Math.sqrt(ox * ox + oz * oz),
			distance(x, y, z) {
				// The nearest of the helix's samples: a tube that narrows its circle toward the top.
				let best = Number.POSITIVE_INFINITY;
				for (let s = 0; s <= samples; s++) {
					const t = s / samples;
					const angle = t * turns * TAU;
					const r = radius * (1 - t);
					const dx = x - ox - r * cos(angle);
					const dy = y - oy - t * height;
					const dz = z - oz - r * sin(angle);
					best = Math.min(best, dx * dx + dy * dy + dz * dz);
				}
				return Math.sqrt(best) - thickness;
			},
		};
	}
	const parts = shape.union.map((part) => {
		const offset = part.at ?? [0, 0, 0];
		return solidOf(part, [ox + offset[0], oy + offset[1], oz + offset[2]]);
	});
	return {
		base: Math.min(...parts.map((p) => p.base)),
		top: Math.max(...parts.map((p) => p.top)),
		reach: Math.max(...parts.map((p) => p.reach)),
		distance(x, y, z) {
			let best = Number.POSITIVE_INFINITY;
			for (const part of parts) best = Math.min(best, part.distance(x, y, z));
			return best;
		},
	};
}

/** A solid as a volume: the radius at a height and azimuth found along the ray from the axis. */
function shapeVolume(shape: Sdf): EnvelopeVolume {
	const solid = solidOf(shape);
	return {
		base: Math.max(0, solid.base),
		top: solid.top,
		reach: solid.reach,
		radius(y, azimuth) {
			const dx = cos(azimuth);
			const dz = sin(azimuth);
			if (solid.distance(0, y, 0) > 0) return 0;
			let low = 0;
			let high = solid.reach;
			for (let k = 0; k < 24; k++) {
				const mid = (low + high) / 2;
				if (solid.distance(dx * mid, y, dz * mid) <= 0) low = mid;
				else high = mid;
			}
			return low;
		},
		room(x, y, z) {
			return -solid.distance(x, y, z);
		},
	};
}

/**
 * An envelope as a volume in metres for one plant.
 *
 * @param envelope The record's envelope.
 * @param height The plant's height in metres, which a radial envelope's shares scale by.
 * @param turn Radians the variant turns a radial envelope's azimuths by.
 * @returns The volume.
 */
export function envelopeVolume(envelope: Envelope, height: number, turn: number): EnvelopeVolume {
	return envelope.kind === 'radial'
		? radialVolume(envelope.heights, envelope.radii, height, turn)
		: shapeVolume(envelope.shape);
}

/**
 * A volume cut flat at a height: no room below it, and the volume's own room above it. A height at
 * or below the volume's base leaves the volume as it is.
 *
 * @param volume The volume.
 * @param floor The height in metres below which the volume holds no room.
 * @returns The cut volume.
 */
export function flooredVolume(volume: EnvelopeVolume, floor: number): EnvelopeVolume {
	if (!(floor > volume.base)) return volume;
	const base = Math.min(floor, volume.top);
	return {
		base,
		top: volume.top,
		reach: volume.reach,
		radius(y, azimuth) {
			return y < base ? 0 : volume.radius(y, azimuth);
		},
		room(x, y, z) {
			const room = volume.room(x, y, z);
			return y < base ? Math.min(room, -(base - y)) : room;
		},
	};
}

/**
 * A volume shrunk by a margin all round, so a skeleton grown in it leaves room for the shoots that
 * attach to it later.
 *
 * @param volume The volume.
 * @param margin Metres to keep clear of its outline.
 * @returns The shrunk volume.
 */
export function insetVolume(volume: EnvelopeVolume, margin: number): EnvelopeVolume {
	return {
		base: volume.base,
		top: Math.max(volume.base, volume.top - margin),
		reach: Math.max(0, volume.reach - margin),
		radius(y, azimuth) {
			return Math.max(0, volume.radius(y + margin, azimuth) - margin);
		},
		room(x, y, z) {
			return Math.min(volume.room(x, y, z) - margin, volume.room(x, y + margin, z) - margin);
		},
	};
}

/**
 * A volume whose radius at each height is drawn a share of the way toward the mean of its azimuths.
 * A measured hull is as irregular as the views it came from, so an architectural crown that fills
 * it exactly shows one view thin and another wide. Blending toward the mean rounds the narrow sides
 * without moving the widest, and stays within the reference's own all-round spread.
 *
 * @param volume The volume.
 * @param share How far toward the mean each azimuth's radius moves, from 0 (as it is) to 1.
 * @returns The rounded volume.
 */
export function smoothedVolume(volume: EnvelopeVolume, share: number): EnvelopeVolume {
	const blend = Math.min(1, Math.max(0, share));
	if (blend === 0) return volume;
	const steps = 16;
	const meanAt = (y: number): number => {
		let total = 0;
		let count = 0;
		for (let k = 0; k < steps; k++) {
			const r = volume.radius(y, (k / steps) * TAU);
			if (r > 0) {
				total += r;
				count++;
			}
		}
		return count > 0 ? total / count : 0;
	};
	const radius = (y: number, azimuth: number): number => {
		const own = volume.radius(y, azimuth);
		const mean = meanAt(y);
		return own + (mean - own) * blend;
	};
	return {
		base: volume.base,
		top: volume.top,
		reach: volume.reach,
		radius,
		room(x, y, z) {
			const across = Math.sqrt(x * x + z * z);
			const r = radius(y, atan2(z, x));
			if (y < volume.base) return Math.min(r, -(volume.base - y));
			if (y > volume.top) return Math.min(r, -(y - volume.top));
			return r - across;
		},
	};
}

/**
 * A grid of cells for side views of one plant, in metres: x across the view, y up.
 */
export interface SilhouetteFrame {
	/** The left edge in metres along the view's right. */
	readonly left: number;
	/** A cell's edge in metres. */
	readonly cell: number;
	/** Cells across. */
	readonly cols: number;
	/** Cells up, from the ground. */
	readonly rows: number;
}

/**
 * A frame wide and tall enough for a volume and a plant of a height, with a margin round both.
 *
 * @param volume The envelope's volume.
 * @param height The plant's height in metres.
 * @param cellsPerHeight Cells over the plant's height.
 * @returns The frame.
 */
export function silhouetteFrame(
	volume: EnvelopeVolume,
	height: number,
	cellsPerHeight = 96,
): SilhouetteFrame {
	const cell = height / cellsPerHeight;
	const half = Math.max(volume.reach, height * 0.1) * 1.25;
	return {
		left: -half,
		cell,
		cols: Math.ceil((2 * half) / cell),
		rows: Math.ceil((Math.max(volume.top, height) * 1.1) / cell),
	};
}

/** The view's right vector for a turn: turn 0 looks from +Z, so its right is +X. */
function rightOf(turn: number): readonly [number, number] {
	return [cos(turn), -sin(turn)];
}

/**
 * The envelope seen from the side at a turn: at each row, the cells between its farthest reach to
 * the left and to the right. Below the envelope's base, a stem of the given half-width stands on the
 * axis, so the silhouette compares with a whole plant's.
 *
 * @param volume The envelope's volume.
 * @param turn Radians about the vertical axis; 0 looks from +Z.
 * @param frame The grid.
 * @param stem Half-width in metres of the stem drawn below the envelope.
 * @returns One byte per cell, 1 inside, rows from the ground up.
 */
export function envelopeSilhouette(
	volume: EnvelopeVolume,
	turn: number,
	frame: SilhouetteFrame,
	stem = 0,
): Uint8Array {
	const mask = new Uint8Array(frame.cols * frame.rows);
	const [ex, ez] = rightOf(turn);
	const steps = 96;
	for (let row = 0; row < frame.rows; row++) {
		const y = (row + 0.5) * frame.cell;
		let right = 0;
		let left = 0;
		let inside = false;
		for (let s = 0; s < steps; s++) {
			const azimuth = (s / steps) * TAU;
			const r = volume.radius(y, azimuth);
			if (r <= 0) continue;
			inside = true;
			const along = r * (cos(azimuth) * ex + sin(azimuth) * ez);
			right = Math.max(right, along);
			left = Math.max(left, -along);
		}
		if (!inside && y < volume.base) {
			right = stem;
			left = stem;
		} else if (!inside) continue;
		for (let col = 0; col < frame.cols; col++) {
			const x = frame.left + (col + 0.5) * frame.cell;
			if (x <= right && x >= -left) mask[row * frame.cols + col] = 1;
		}
	}
	return mask;
}

/** Marks the cells within a distance of a segment from (ax, ay) to (bx, by). */
function capsule(
	mask: Uint8Array,
	frame: SilhouetteFrame,
	ax: number,
	ay: number,
	bx: number,
	by: number,
	radius: number,
): void {
	const r = Math.max(radius, frame.cell * 0.5);
	const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - frame.left) / frame.cell));
	const c1 = Math.min(frame.cols - 1, Math.floor((Math.max(ax, bx) + r - frame.left) / frame.cell));
	const r0 = Math.max(0, Math.floor((Math.min(ay, by) - r) / frame.cell));
	const r1 = Math.min(frame.rows - 1, Math.floor((Math.max(ay, by) + r) / frame.cell));
	const dx = bx - ax;
	const dy = by - ay;
	const span = dx * dx + dy * dy;
	for (let row = r0; row <= r1; row++) {
		const y = (row + 0.5) * frame.cell;
		for (let col = c0; col <= c1; col++) {
			const x = frame.left + (col + 0.5) * frame.cell;
			let t = span > 0 ? ((x - ax) * dx + (y - ay) * dy) / span : 0;
			t = Math.min(1, Math.max(0, t));
			const qx = ax + t * dx - x;
			const qy = ay + t * dy - y;
			if (qx * qx + qy * qy <= r * r) mask[row * frame.cols + col] = 1;
		}
	}
}

/**
 * A grown skeleton seen from the side at a turn: its wood as capsules of its radii, and discs that
 * stand for the shoots the instancer attaches: one at each bud site, and along the finest axes at
 * the species' shoots per metre.
 *
 * @param skeleton The skeleton.
 * @param turn Radians about the vertical axis; 0 looks from +Z.
 * @param frame The grid.
 * @param shoot Metres a shoot reaches from its bud site; 0 draws the wood alone.
 * @param perMetre Shoots per metre along the finest axes; 0 places them at the bud sites only.
 * @returns One byte per cell, 1 covered, rows from the ground up.
 */
export function skeletonSilhouette(
	skeleton: MacroSkeleton,
	turn: number,
	frame: SilhouetteFrame,
	shoot: number,
	perMetre = 0,
): Uint8Array {
	const mask = woodSilhouette(skeleton, turn, frame);
	const [ex, ez] = rightOf(turn);
	const p = skeleton.position;
	if (shoot > 0) {
		const buds = skeleton.buds;
		for (let b = 0; b < buds.count; b++) {
			const q = buds.frame;
			// The shoot's direction is the bud frame's +Y.
			const qx = q[b * 4] as number;
			const qy = q[b * 4 + 1] as number;
			const qz = q[b * 4 + 2] as number;
			const qw = q[b * 4 + 3] as number;
			const dx = 2 * (qx * qy - qz * qw);
			const dy = 1 - 2 * (qx * qx + qz * qz);
			const dz = 2 * (qy * qz + qx * qw);
			const x = (buds.position[b * 3] as number) + dx * shoot * 0.5;
			const y = (buds.position[b * 3 + 1] as number) + dy * shoot * 0.5;
			const z = (buds.position[b * 3 + 2] as number) + dz * shoot * 0.5;
			const across = x * ex + z * ez;
			capsule(mask, frame, across, y, across, y, shoot * 0.8);
		}
	}
	if (shoot > 0 && perMetre > 0) {
		const { axes } = skeleton;
		let finest = 0;
		for (let a = 0; a < axes.count; a++) finest = Math.max(finest, axes.order[a] as number);
		const spacing = 1 / perMetre;
		for (let n = 0; n < skeleton.nodeCount; n++) {
			const from = skeleton.parent[n] as number;
			if (from < 0 || axes.order[skeleton.axisOf[n] as number] !== finest) continue;
			const ax = p[from * 3] as number;
			const ay = p[from * 3 + 1] as number;
			const az = p[from * 3 + 2] as number;
			const dx = (p[n * 3] as number) - ax;
			const dy = (p[n * 3 + 1] as number) - ay;
			const dz = (p[n * 3 + 2] as number) - az;
			const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
			for (let t = spacing / 2; t < length; t += spacing) {
				const k = t / length;
				const across = (ax + dx * k) * ex + (az + dz * k) * ez;
				capsule(mask, frame, across, ay + dy * k, across, ay + dy * k, shoot * 0.8);
			}
		}
	}
	return mask;
}

/** A skeleton's wood seen from the side at a turn, as capsules of its radii. */
function woodSilhouette(skeleton: MacroSkeleton, turn: number, frame: SilhouetteFrame): Uint8Array {
	const mask = new Uint8Array(frame.cols * frame.rows);
	const [ex, ez] = rightOf(turn);
	const p = skeleton.position;
	for (let n = 0; n < skeleton.nodeCount; n++) {
		const parent = skeleton.parent[n] as number;
		const from = parent >= 0 ? parent : n;
		capsule(
			mask,
			frame,
			(p[from * 3] as number) * ex + (p[from * 3 + 2] as number) * ez,
			p[from * 3 + 1] as number,
			(p[n * 3] as number) * ex + (p[n * 3 + 2] as number) * ez,
			p[n * 3 + 1] as number,
			skeleton.radius[n] as number,
		);
	}
	return mask;
}

/**
 * A dressed plant seen from the side at a turn: its wood as capsules of its radii, and a disc for
 * each shoot row, as wide as the row's shoot is long at its scale and centred halfway along it, as
 * `skeletonSilhouette` draws the shoots it expects.
 *
 * @param skeleton The skeleton.
 * @param rows The shoot rows.
 * @param lengths Metres from the attach point to the farthest tip of each prototype, at scale 1.
 * @param turn Radians about the vertical axis; 0 looks from +Z.
 * @param frame The grid.
 * @returns One byte per cell, 1 covered, rows from the ground up.
 */
export function plantSilhouette(
	skeleton: MacroSkeleton,
	rows: ShootRows,
	lengths: readonly number[],
	turn: number,
	frame: SilhouetteFrame,
): Uint8Array {
	const mask = woodSilhouette(skeleton, turn, frame);
	addShoots(mask, rows, lengths, turn, frame);
	return mask;
}

/**
 * A dressed plant's shoots seen from the side at a turn: a disc for each shoot row, as wide as the
 * row's shoot is long at its scale and centred halfway along it, without the wood.
 *
 * @param rows The shoot rows.
 * @param lengths Metres from the attach point to the farthest tip of each prototype, at scale 1.
 * @param turn Radians about the vertical axis; 0 looks from +Z.
 * @param frame The grid.
 * @returns One byte per cell, 1 covered, rows from the ground up.
 */
export function shootSilhouette(
	rows: ShootRows,
	lengths: readonly number[],
	turn: number,
	frame: SilhouetteFrame,
): Uint8Array {
	const mask = new Uint8Array(frame.cols * frame.rows);
	addShoots(mask, rows, lengths, turn, frame);
	return mask;
}

/** Draws each shoot row as a disc on a mask. */
function addShoots(
	mask: Uint8Array,
	rows: ShootRows,
	lengths: readonly number[],
	turn: number,
	frame: SilhouetteFrame,
): void {
	const [ex, ez] = rightOf(turn);
	const q = rows.rotation;
	for (let r = 0; r < rows.count; r++) {
		const shoot = (lengths[rows.prototype[r] as number] ?? 0) * (rows.scale[r] as number);
		const qx = q[r * 4] as number;
		const qy = q[r * 4 + 1] as number;
		const qz = q[r * 4 + 2] as number;
		const qw = q[r * 4 + 3] as number;
		const dx = 2 * (qx * qy - qz * qw);
		const dy = 1 - 2 * (qx * qx + qz * qz);
		const dz = 2 * (qy * qz + qx * qw);
		const x = (rows.position[r * 3] as number) + dx * shoot * 0.5;
		const y = (rows.position[r * 3 + 1] as number) + dy * shoot * 0.5;
		const z = (rows.position[r * 3 + 2] as number) + dz * shoot * 0.5;
		const across = x * ex + z * ez;
		capsule(mask, frame, across, y, across, y, shoot * 0.8);
	}
}

/**
 * The intersection over the union of two masks on one frame.
 *
 * @param a The first mask.
 * @param b The second mask.
 * @returns A share from 0 to 1; 1 when both are empty.
 */
export function silhouetteIoU(a: Uint8Array, b: Uint8Array): number {
	let both = 0;
	let either = 0;
	for (let k = 0; k < a.length; k++) {
		const x = a[k] as number;
		const y = b[k] as number;
		both += x & y;
		either += x | y;
	}
	return either === 0 ? 1 : both / either;
}
