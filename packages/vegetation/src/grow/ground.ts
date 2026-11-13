// What the ground plants' growers share: the axis kinds they grow, the paths and keys they read back
// from a skeleton, the bytes every vertex of their merged foliage carries, the texture strips their
// stalks and stems sample, and smooth normals over a written piece.
//
// A ground plant has no wood. Its root is a parentless axis that is not a stem, so the wood mesher
// skips it and every axis on it, and the plant's whole body is its merged foliage. Each leaf or blade
// is one axis from where it leaves its shoot to its tip, with a terminal bud site where its blade
// starts: the bud's frame points +Y along the blade and +Z out of its upper face, and its vigor is
// the leaf's age, 0 the youngest and 1 the oldest. The foliage mesher reads only the skeleton, so a
// piece that the review cuts from it meshes as the whole plant does.
//
// Every vertex of merged foliage carries, as the plant material reads it: colour bytes of the axis's
// wind record (high, low, global in the species' table), a flutter phase and the crown's sky
// visibility; the leaf texture's u and v; and in its second coordinate the share along the leaf
// from its attach (the bend and flutter weight) and how far it has browned, both from 0 to 1.
import type { AxisTable, MacroSkeleton } from '../core/graph';
import { AXIS_RACHIS, BUD_TERMINAL } from '../core/graph';
import { hashAt } from '../core/hash';
import { cos, sin } from '../core/math';
import type { TextureManifest } from '../core/textures';
import { crownSkyAt } from '../crown/visibility';
import { type MeshWriter, SURFACE_SHEATH } from '../leaf/writer';
import type { CrownLight, MeshInput } from '../stages';
import { VARIANT_RECORDS } from '../wind/records';
import { type AxisPath, axisPath, emptyFrame, frameAt, type PathFrame } from '../wood/frames';

/** The axis kind of a leaf or blade: a lamina on its own stalk or sheath. */
export const AXIS_LEAF = AXIS_RACHIS;

/** The bits of a 32-bit float, for keys that a cut keeps. */
const FLOAT = new Float32Array(1);
const BITS = new Uint32Array(FLOAT.buffer);

function floatBits(value: number): number {
	FLOAT[0] = value;
	return BITS[0] as number;
}

/**
 * A key of one axis that a cut of the skeleton keeps: its first and last radius, its node count,
 * its order and its kind. The growers give each axis a radius of its own, so keys rarely meet.
 *
 * @param skeleton The skeleton.
 * @param axis The axis.
 * @returns The key.
 */
export function axisKey(skeleton: MacroSkeleton, axis: number): number {
	const { axes, radius } = skeleton;
	const first = axes.first[axis] as number;
	const last = axes.last[axis] as number;
	return hashAt(
		floatBits(radius[first] as number),
		floatBits(radius[last] as number),
		last - first,
		(axes.order[axis] as number) * 16 + (axes.kind[axis] as number),
	);
}

/**
 * The terminal bud site of each axis, or -1 for an axis with none.
 *
 * @param skeleton The skeleton.
 * @returns One bud index per axis.
 */
export function terminalBuds(skeleton: MacroSkeleton): Int32Array {
	const out = new Int32Array(skeleton.axes.count).fill(-1);
	const buds = skeleton.buds;
	for (let b = 0; b < buds.count; b++)
		if ((buds.kind[b] as number) === BUD_TERMINAL && (out[buds.axis[b] as number] as number) < 0)
			out[buds.axis[b] as number] = b;
	return out;
}

/**
 * The dense path through a run of an axis's nodes, from `from` to `to`, its first frame's normal
 * along `normal0`; undefined when the run holds fewer than two nodes.
 *
 * @param skeleton The skeleton.
 * @param from The first node.
 * @param to The last node.
 * @param normal0 A direction for the first frame's normal.
 * @returns The path.
 */
export function nodePath(
	skeleton: MacroSkeleton,
	from: number,
	to: number,
	normal0: readonly [number, number, number],
): AxisPath | undefined {
	const count = to - from + 1;
	if (count < 2) return undefined;
	const points = new Float64Array(count * 3);
	const radii = new Float64Array(count);
	for (let i = 0; i < count; i++) {
		for (let k = 0; k < 3; k++) points[i * 3 + k] = skeleton.position[(from + i) * 3 + k] as number;
		radii[i] = skeleton.radius[from + i] as number;
	}
	return axisPath(points, radii, count, normal0);
}

/** The whole path of one axis. */
export function wholePath(
	skeleton: MacroSkeleton,
	axis: number,
	normal0: readonly [number, number, number] = [0, 0, 1],
): AxisPath | undefined {
	const axes: AxisTable = skeleton.axes;
	return nodePath(skeleton, axes.first[axis] as number, axes.last[axis] as number, normal0);
}

/**
 * The bytes every vertex of one axis's foliage carries, but its sky: the wind record and the
 * flutter phase.
 */
export interface AxisBytes {
	/** The wind record's high byte. */
	readonly high: number;
	/** The wind record's low byte. */
	readonly low: number;
	/** The flutter phase, 0 to 255. */
	readonly phase: number;
}

/**
 * The record and flutter bytes of an axis's foliage.
 *
 * @param input The dressed variant.
 * @param axis The axis.
 * @returns The bytes.
 */
export function axisBytes(input: MeshInput, axis: number): AxisBytes {
	const record = input.variant * VARIANT_RECORDS + (input.skeleton.axes.record[axis] as number);
	return {
		high: (record >>> 8) & 255,
		low: record & 255,
		phase: hashAt(input.seed, axisKey(input.skeleton, axis), 7) & 255,
	};
}

/**
 * The crown's sky visibility at a point as a byte.
 *
 * @param crown The crown's light.
 * @param p The point.
 * @returns 0 to 255.
 */
export function skyByte(crown: CrownLight, p: ArrayLike<number>): number {
	const sky = crownSkyAt(crown, p[0] as number, p[1] as number, p[2] as number);
	return Math.round(255 * Math.min(1, Math.max(0, sky)));
}

/**
 * Where a species' leaf texture keeps its stalk and its blade, in v, and how wide its blade is
 * about the midrib, in u. Without a texture leaf the frame is the parametric outline's.
 */
export interface LeafStrip {
	/** v at the stalk's end. */
	readonly petiole: number;
	/** v where the blade starts. */
	readonly base: number;
	/** v at the blade's tip. */
	readonly tip: number;
	/** Half the stalk's width in u, which a stalk's or stem's faces sample. */
	readonly stalkHalf: number;
}

/**
 * The leaf texture's strips, from its manifest.
 *
 * @param manifest The texture manifest.
 * @returns The strips.
 */
export function leafStrip(manifest: TextureManifest): LeafStrip {
	const leaf = manifest.leaf;
	if (!leaf) return { petiole: 0, base: 0.04, tip: 0.96, stalkHalf: 0.01 };
	return {
		petiole: leaf.frame.petiole[1],
		base: leaf.frame.base[1],
		tip: leaf.frame.tip[1],
		stalkHalf: 0.01,
	};
}

/** The v range a stalk or stem samples: the texture's drawn stalk, or the blade's lowest part. */
export function stalkRange(strip: LeafStrip): readonly [number, number] {
	if (strip.base - strip.petiole > 0.02) return [strip.petiole, strip.base];
	return [strip.base, Math.min(strip.tip, strip.base + 0.08)];
}

/**
 * Smooth normals over the triangles written from `firstIndex`: each vertex from `firstVertex` takes
 * the sum of its triangles' area-weighted normals, so a folded or pleated surface lights as its
 * geometry is.
 *
 * @param mesh The writer.
 * @param firstVertex The first vertex of the piece.
 * @param firstIndex The first index of the piece.
 */
export function smoothNormals(mesh: MeshWriter, firstVertex: number, firstIndex: number): void {
	const p = mesh.positions;
	const n = mesh.normals;
	const count = mesh.vertices - firstVertex;
	const sum = new Float64Array(count * 3);
	const idx = mesh.indices;
	for (let i = firstIndex; i < idx.length; i += 3) {
		const a = idx[i] as number;
		const b = idx[i + 1] as number;
		const c = idx[i + 2] as number;
		const ux = (p[b * 3] as number) - (p[a * 3] as number);
		const uy = (p[b * 3 + 1] as number) - (p[a * 3 + 1] as number);
		const uz = (p[b * 3 + 2] as number) - (p[a * 3 + 2] as number);
		const vx = (p[c * 3] as number) - (p[a * 3] as number);
		const vy = (p[c * 3 + 1] as number) - (p[a * 3 + 1] as number);
		const vz = (p[c * 3 + 2] as number) - (p[a * 3 + 2] as number);
		const fx = uy * vz - uz * vy;
		const fy = uz * vx - ux * vz;
		const fz = ux * vy - uy * vx;
		for (const v of [a, b, c]) {
			const at = (v - firstVertex) * 3;
			if (at < 0) continue;
			sum[at] = (sum[at] as number) + fx;
			sum[at + 1] = (sum[at + 1] as number) + fy;
			sum[at + 2] = (sum[at + 2] as number) + fz;
		}
	}
	for (let v = 0; v < count; v++) {
		const x = sum[v * 3] as number;
		const y = sum[v * 3 + 1] as number;
		const z = sum[v * 3 + 2] as number;
		const l = Math.sqrt(x * x + y * y + z * z);
		if (l < 1e-20) continue;
		const at = (firstVertex + v) * 3;
		n[at] = x / l;
		n[at + 1] = y / l;
		n[at + 2] = z / l;
	}
}

/** How a stem's section is drawn round its centre line. */
export interface StemSection {
	/** Faces round. */
	readonly sides: number;
	/**
	 * The section's radius at an angle, over the stem's radius: 1 for a round stem. Angle 0 points
	 * along the path's normal, which the grower turns to the stem's upper side.
	 */
	readonly shape?: (angle: number) => number;
}

/** A stalk or stem to write: a run of a path, its radius, its texture strip and its bytes. */
export interface StemRun {
	readonly path: AxisPath;
	/** Arc lengths where it starts and ends. */
	readonly from: number;
	readonly to: number;
	/** Rings along it, two at least. */
	readonly rings: number;
	/** The radius in metres at a share along the run. */
	readonly radius: (share: number) => number;
	readonly section: StemSection;
	/** The v range the stem samples, base to top, and its u about the midrib. */
	readonly v: readonly [number, number];
	readonly uHalf: number;
	readonly bytes: AxisBytes;
	readonly crown: CrownLight;
	/** The share along the leaf or stem at the run's start and end, for the bend and flutter weight. */
	readonly along: readonly [number, number];
	readonly browning: number;
	/** Whether to close the top to a point. */
	readonly closeTip?: boolean;
	/**
	 * The least sky visibility a vertex takes, from 0 to 1: a stalk under its own leaves keeps this
	 * much light, so it does not read as black wood among them.
	 */
	readonly leastSky?: number;
	/**
	 * Whether this run is a tuft's basal sheath column, which the plant material draws in the
	 * record's sheath colour. Absent, the run draws as the leaf does.
	 */
	readonly sheath?: boolean;
}

const frame: PathFrame = emptyFrame();

/**
 * Writes a stalk, stem or sheath along a run of a path: rings of the section, normals from the
 * written surface, the texture's stalk strip wrapped once round.
 *
 * @param mesh The writer.
 * @param run The run.
 */
export function writeStem(mesh: MeshWriter, run: StemRun): void {
	const { path, rings, section } = run;
	const sides = Math.max(3, section.sides);
	const firstVertex = mesh.vertices;
	const firstIndex = mesh.indices.length;
	// A sheath column's flutter byte is its marker, so the column stands still and the material
	// reads the record's colour for it; every other run keeps its sway phase.
	const colour = [
		run.bytes.high,
		run.bytes.low,
		run.sheath === true ? SURFACE_SHEATH : run.bytes.phase,
		0,
	];
	const p = [0, 0, 0];
	for (let r = 0; r < rings; r++) {
		const share = r / (rings - 1);
		frameAt(path, run.from + (run.to - run.from) * share, frame);
		const radius = run.radius(share);
		const tip = run.closeTip === true && r === rings - 1;
		const v = run.v[0] + (run.v[1] - run.v[0]) * share;
		for (let j = 0; j <= sides; j++) {
			const angle = (2 * Math.PI * j) / sides;
			const c = cos(angle);
			const s = sin(angle);
			const scale = tip ? 0 : radius * (section.shape ? section.shape(angle) : 1);
			for (let k = 0; k < 3; k++)
				p[k] =
					(frame.position[k] as number) +
					((frame.normal[k] as number) * c + (frame.binormal[k] as number) * s) * scale;
			colour[3] = Math.max(Math.round(255 * (run.leastSky ?? 0)), skyByte(run.crown, p));
			mesh.vertex(
				p,
				[
					(frame.normal[0] as number) * c + (frame.binormal[0] as number) * s,
					(frame.normal[1] as number) * c + (frame.binormal[1] as number) * s,
					(frame.normal[2] as number) * c + (frame.binormal[2] as number) * s,
				],
				[0.5 + run.uHalf * (2 * (j / sides) - 1), v],
				[run.along[0] + (run.along[1] - run.along[0]) * share, run.browning],
				colour,
			);
		}
		if (r > 0) {
			const a = firstVertex + (r - 1) * (sides + 1);
			const b = firstVertex + r * (sides + 1);
			for (let j = 0; j < sides; j++) mesh.quad(a + j, a + j + 1, b + j + 1, b + j);
		}
	}
	if (!section.shape) return;
	// A shaped section lights by its written faces; the ring's seam takes both sides' normal.
	smoothNormals(mesh, firstVertex, firstIndex);
	const n = mesh.normals;
	for (let r = 0; r < rings; r++) {
		const a = (firstVertex + r * (sides + 1)) * 3;
		const b = a + sides * 3;
		const x = (n[a] as number) + (n[b] as number);
		const y = (n[a + 1] as number) + (n[b + 1] as number);
		const z = (n[a + 2] as number) + (n[b + 2] as number);
		const l = Math.sqrt(x * x + y * y + z * z) || 1;
		n[a] = n[b] = x / l;
		n[a + 1] = n[b + 1] = y / l;
		n[a + 2] = n[b + 2] = z / l;
	}
}

/** A smooth step from 0 at `low` to 1 at `high`. */
export function smoothstep(low: number, high: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - low) / (high - low)));
	return t * t * (3 - 2 * t);
}
