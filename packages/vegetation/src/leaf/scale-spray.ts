// The scale-spray foliage kind: a branchlet system of one to four orders, each cord a tapered axis
// clothed along its length by shingled scale leaves and the species' scale texture. The shoot
// prototypes set one spray on each node, so a cord-like shoot of the species reads as a brush of
// smaller cords, the way a cypress, a juniper or a sequoia sprays its foliage.
//
// Spray space as leaf space: the first segment's base at the origin, its direction up +Y, the
// texture's stalk end at the base and its tip at the segment's end. A cord's UVs run once around
// the tube across the texture's visible width, and along it from the frame's petiole to its tip.
import type { PrototypeArrays } from '../asset';
import { unitAt } from '../core/hash';
import { cos, cross3, normalize3, radians, sin, type Vector3 } from '../core/math';
import type { ScaleSpray, Species } from '../core/record';
import type { TextureManifest } from '../core/textures';
import type { Detail } from '../core/types';
import type { FoliageBuilder } from './kinds';
import { MeshWriter, SURFACE_LEAF, SURFACE_STEM } from './writer';

/** Faces round a cord, by tier. */
const SIDES: Readonly<Record<Detail, number>> = { low: 3, medium: 3, high: 4, ultra: 6 };

/** The scale pairs along a cord, by tier: a close view shows the shingled scales. */
const SCALE_STEPS: Readonly<Record<Detail, number>> = { low: 6, medium: 8, high: 12, ultra: 12 };

/** A scale's width in metres. */
const SCALE_WIDTH = 0.0013;

/** The share of the gap to the next scale that one scale covers, so neighbours overlap as shingles. */
const SCALE_REACH = 2.3;

/** The longest scale in metres: the species' scale is a couple of millimetres. */
const SCALE_LENGTH = 0.005;

/** Degrees a scale stands out from the cord. */
const SCALE_TILT = 30;

/** The cord's wood as a share of the record's radius, so the scales stand proud of it. */
const CORD_WOOD = 0.5;

/** Side cords a spray's own cord carries. */
const SPRAY_CHILDREN = 1;

/** Degrees a side cord leaves its parent at. */
const CHILD_ANGLE = 54;

/** A side cord's length over its parent's. */
const CHILD_LENGTH = 0.66;

/** A cord's tip radius over its base radius. */
const TIP_SHARE = 0.68;

/** The share of the texture canvas's width that the cord's own strip covers. */
const UV_WIDTH = 0.16;

/** The sprays a species builds, so its shoots draw a few different pieces. */
const MESHES = 3;

/** A cord under construction: where it starts, which way it runs, and how large it is. */
interface Cord {
	readonly base: Vector3;
	readonly direction: Vector3;
	readonly length: number;
	readonly radius: number;
	/** The order of the spray this cord belongs to, the first being 0. */
	readonly level: number;
	/** The turn of the bend and of the children round the cord. */
	readonly phase: number;
}

/** The texture span a cord samples: the stalk end, the tip, and the canvas's visible width. */
function textureSpan(manifest: TextureManifest): { base: number; tip: number } {
	const leaf = manifest.leaf;
	if (!leaf) return { base: 0, tip: 1 };
	return { base: leaf.frame.petiole[1], tip: leaf.frame.tip[1] };
}

/** One point of a cord's path: its centre, run, thickness and frame. */
interface CordNode {
	readonly at: Vector3;
	readonly direction: Vector3;
	readonly across: Vector3;
	readonly radius: number;
	readonly along: number;
}

/**
 * Writes one cord: a thin woody axis with its scales standing along it in two ranks on opposite
 * sides, each scale's face turned to the spray's upper side, so the cord reads as a flattened frond
 * with the rachis showing between the ranks. Returns where the cord ends and which way it runs.
 *
 * @param mesh The writer.
 * @param cordShape The cord.
 * @param span The texture's stalk and tip rows.
 * @param sides Faces round the tube.
 * @param dead Whether this cord draws as dead wood rather than as foliage.
 * @param detail The tier.
 * @returns The cord's last point and its direction there.
 */
function cord(
	mesh: MeshWriter,
	cordShape: Cord,
	span: { base: number; tip: number },
	sides: number,
	dead: boolean,
	detail: Detail,
): { at: Vector3; direction: Vector3 } {
	const steps = SCALE_STEPS[detail];
	const bend = radians(2 + (cordShape.phase % 3));
	const surface = dead ? SURFACE_STEM : SURFACE_LEAF;
	let at: Vector3 = [...cordShape.base];
	let direction: Vector3 = [...cordShape.direction];
	let across = cross3(direction, Math.abs(direction[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1], [0, 0, 0]);
	normalize3(across);
	const nodes: CordNode[] = [];
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		nodes.push({
			at: [...at],
			direction: [...direction],
			across: [...across],
			radius: cordShape.radius * (1 - (1 - TIP_SHARE) * t),
			along: t * cordShape.length,
		});
		if (i === steps) break;
		// Each node turns a little toward the cord's own side, so the branchlet reads as a growing
		// shoot rather than a rod.
		const turn = bend / steps;
		const side = cross3(across, direction, [0, 0, 0]);
		normalize3(side);
		direction = normalize3([
			direction[0] * cos(turn) + side[0] * sin(turn),
			direction[1] * cos(turn) + side[1] * sin(turn),
			direction[2] * cos(turn) + side[2] * sin(turn),
		]);
		across = cross3(direction, across, [0, 0, 0]);
		normalize3(across);
		at = [
			at[0] + direction[0] * (cordShape.length / steps),
			at[1] + direction[1] * (cordShape.length / steps),
			at[2] + direction[2] * (cordShape.length / steps),
		];
	}

	// The woody axis: a thin tube under the scales, closed at its tip so a close view of a
	// branchlet end shows a blunt point rather than a hole.
	const firsts: number[] = [];
	for (const node of nodes) {
		const second = cross3(node.direction, node.across, [0, 0, 0]);
		normalize3(second);
		firsts.push(mesh.vertices);
		const v = span.base + (node.along / Math.max(1e-6, cordShape.length)) * (span.tip - span.base);
		const radius = node.radius * CORD_WOOD;
		for (let j = 0; j <= sides; j++) {
			const angle = (2 * Math.PI * j) / sides;
			const c = cos(angle);
			const s = sin(angle);
			const normal: Vector3 = [
				node.across[0] * c + second[0] * s,
				node.across[1] * c + second[1] * s,
				node.across[2] * c + second[2] * s,
			];
			mesh.vertex(
				[
					node.at[0] + normal[0] * radius,
					node.at[1] + normal[1] * radius,
					node.at[2] + normal[2] * radius,
				],
				normal,
				[0.5 + (j / sides - 0.5) * UV_WIDTH, v],
				[node.along, 0],
				[0, 0, surface, 255],
			);
		}
	}
	for (let r = 0; r < steps; r++) {
		const a = firsts[r] as number;
		const b = firsts[r + 1] as number;
		for (let j = 0; j < sides; j++) mesh.quad(a + j, a + j + 1, b + j + 1, b + j);
	}
	const last = nodes[steps] as CordNode;
	const tip = mesh.vertex(
		[
			last.at[0] + last.direction[0] * last.radius * CORD_WOOD * TIP_SHARE,
			last.at[1] + last.direction[1] * last.radius * CORD_WOOD * TIP_SHARE,
			last.at[2] + last.direction[2] * last.radius * CORD_WOOD * TIP_SHARE,
		],
		last.direction,
		[0.5, span.tip],
		[cordShape.length, 0],
		[0, 0, surface, 255],
	);
	const lastRing = firsts[steps] as number;
	for (let j = 0; j < sides; j++) mesh.indices.push(lastRing + j, lastRing + j + 1, tip);

	// The scales: one plate at each node, the next node's on the opposite side, so the two ranks
	// together read as a flattened frond with the rachis showing between them. Every plate's face
	// looks along the spray's own upper side, so a viewer sees the scales rather than their edges.
	const half = SCALE_WIDTH / 2;
	const tilt = radians(SCALE_TILT);
	for (let i = 0; i < steps; i++) {
		const node = nodes[i] as CordNode;
		const next = nodes[i + 1] as CordNode;
		const step = next.along - node.along;
		// The last scale stops at the cord's tip rather than running past it, so a spray's height is
		// the length the record asks for.
		const remaining = cordShape.length - node.along;
		const length = Math.min(SCALE_LENGTH, step * SCALE_REACH, remaining + step * 0.25);
		const middle = length * 0.45;
		const axis = normalize3([
			next.at[0] - node.at[0],
			next.at[1] - node.at[1],
			next.at[2] - node.at[2],
		]);
		const second = cross3(node.direction, node.across, [0, 0, 0]);
		normalize3(second);
		// The frond's own face: the upper side of the spray, kept the same way up along the cord.
		const face: Vector3 = second[2] > 0 ? second : [-second[0], -second[1], -second[2]];
		const side = i % 2 === 0 ? 1 : -1;
		const radial = normalize3([
			node.across[0] * side,
			node.across[1] * side,
			node.across[2] * side,
		]);
		const long = normalize3([
			axis[0] * cos(tilt) + radial[0] * sin(tilt),
			axis[1] * cos(tilt) + radial[1] * sin(tilt),
			axis[2] * cos(tilt) + radial[2] * sin(tilt),
		]);
		const wide = normalize3(cross3(long, face, [0, 0, 0]));
		const base: Vector3 = [
			node.at[0] + radial[0] * node.radius * CORD_WOOD,
			node.at[1] + radial[1] * node.radius * CORD_WOOD,
			node.at[2] + radial[2] * node.radius * CORD_WOOD,
		];
		const point = (along: number, width: number, out = 0): Vector3 => [
			base[0] + long[0] * along + wide[0] * width + face[0] * out,
			base[1] + long[1] * along + wide[1] * width + face[1] * out,
			base[2] + long[2] * along + wide[2] * width + face[2] * out,
		];
		const uv = (width: number, row: number): readonly [number, number] => [
			0.5 + (width / SCALE_WIDTH) * UV_WIDTH,
			span.base + row * (span.tip - span.base),
		];
		// A scale is broad and nearly flat, raised a little over its middle, so each rank reads as a
		// bed of overlapping scales.
		const bulge = half * 0.12;
		const shoulder = length * 0.75;
		const proud: Vector3 = normalize3([
			face[0] + radial[0] * 0.5,
			face[1] + radial[1] * 0.5,
			face[2] + radial[2] * 0.5,
		]);
		const b0 = mesh.vertex(
			point(0, -half * 0.8),
			face,
			uv(-half * 0.8, 0),
			[0, 0],
			[0, 0, surface, 255],
		);
		const b1 = mesh.vertex(
			point(0, half * 0.8),
			face,
			uv(half * 0.8, 0),
			[0, 0],
			[0, 0, surface, 255],
		);
		const m1 = mesh.vertex(
			point(middle, half, bulge),
			proud,
			uv(half, 0.5),
			[middle, half],
			[0, 0, surface, 255],
		);
		const m0 = mesh.vertex(
			point(middle, -half, bulge),
			proud,
			uv(-half, 0.5),
			[middle, -half],
			[0, 0, surface, 255],
		);
		const s1 = mesh.vertex(
			point(shoulder, half * 0.8, bulge * 0.7),
			proud,
			uv(half * 0.8, 0.8),
			[shoulder, half * 0.8],
			[0, 0, surface, 255],
		);
		const s0 = mesh.vertex(
			point(shoulder, -half * 0.8, bulge * 0.7),
			proud,
			uv(-half * 0.8, 0.8),
			[shoulder, -half * 0.8],
			[0, 0, surface, 255],
		);
		const leafTip = mesh.vertex(
			point(length, 0, bulge * 0.3),
			face,
			uv(0, 1),
			[length, 0],
			[0, 0, surface, 255],
		);
		mesh.indices.push(b0, b1, m1, b0, m1, m0, m0, m1, s1, m0, s1, s0, s0, s1, leafTip);
	}
	return { at: last.at, direction: last.direction };
}

/**
 * Grows one spray: a cord, then the side cords its end carries, each shorter and thinner than the
 * last, so the spray divides as it grows.
 *
 * @param mesh The writer.
 * @param spray The record's spray.
 * @param cordShape The cord to grow.
 * @param span The texture's stalk and tip rows.
 * @param sides Faces round each tube.
 * @param detail The tier.
 * @param meshIndex The spray prototype's index.
 * @param dead The generator's dead-cord draw.
 */
function grow(
	mesh: MeshWriter,
	spray: ScaleSpray,
	cordShape: Cord,
	span: { base: number; tip: number },
	sides: number,
	detail: Detail,
	meshIndex: number,
	dead: number,
): void {
	const cordIndex = mesh.vertices;
	const isDead =
		dead > 0 &&
		cordShape.level >= Math.max(1, Math.round(spray.orders) - 1) &&
		unitAt(0x5ca1e, meshIndex, cordIndex) < dead;
	const end = cord(mesh, cordShape, span, sides, isDead, detail);
	if (cordShape.level + 1 >= Math.max(1, Math.round(spray.orders))) return;
	// The children stand round the parent. A flat spray keeps them in the plane the parent bends
	// in, square to the bend's own side; the Italian cypress's sprays divide in every direction, so
	// their pair turns anywhere round the parent.
	const children = cordShape.level === 0 ? SPRAY_CHILDREN : 1;
	const flatten = Math.min(1, Math.max(0, spray.flatten));
	const base =
		Math.PI / 2 + (1 - flatten) * 2 * Math.PI * unitAt(0x5ca1f, meshIndex, cordShape.level);
	for (let k = 0; k < children; k++) {
		const azimuth = base + (k * 2 * Math.PI) / children;
		const across = cross3(
			end.direction,
			Math.abs(end.direction[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1],
			[0, 0, 0],
		);
		normalize3(across);
		const side = cross3(end.direction, across, [0, 0, 0]);
		normalize3(side);
		const outward: Vector3 = [
			across[0] * cos(azimuth) + side[0] * sin(azimuth),
			across[1] * cos(azimuth) + side[1] * sin(azimuth),
			across[2] * cos(azimuth) + side[2] * sin(azimuth),
		];
		normalize3(outward);
		const angle = radians(CHILD_ANGLE * (0.85 + 0.3 * unitAt(0x5ca1f, meshIndex, cordIndex, k)));
		const direction = normalize3([
			end.direction[0] * cos(angle) + outward[0] * sin(angle),
			end.direction[1] * cos(angle) + outward[1] * sin(angle),
			end.direction[2] * cos(angle) + outward[2] * sin(angle),
		]);
		const length = cordShape.length * CHILD_LENGTH * (0.85 + 0.3 * unitAt(0x5ca20, meshIndex, k));
		grow(
			mesh,
			spray,
			{
				base: end.at,
				direction,
				length,
				radius: cordShape.radius * 0.8,
				level: cordShape.level + 1,
				phase: azimuth,
			},
			span,
			sides,
			detail,
			meshIndex,
			dead,
		);
	}
}

/**
 * One spray mesh at one tier.
 *
 * @param spray The record's spray.
 * @param manifest The species' texture manifest.
 * @param detail The tier.
 * @param meshIndex The spray prototype's index.
 * @returns The mesh.
 * @category api/vegetation
 */
export function sprayMesh(
	spray: ScaleSpray,
	manifest: TextureManifest,
	detail: Detail,
	meshIndex = 0,
): PrototypeArrays {
	const mesh = new MeshWriter();
	mesh.mark();
	const sides = SIDES[detail];
	const segment = Math.max(0.002, spray.segment);
	const radius = Math.max(1e-4, spray.radius);
	grow(
		mesh,
		spray,
		{
			base: [0, 0, 0],
			direction: [0, 1, 0],
			length: segment,
			radius,
			level: 0,
			phase: meshIndex * 0.9,
		},
		textureSpan(manifest),
		sides,
		detail,
		meshIndex,
		spray.dead,
	);
	return mesh.finishPrototype();
}

/**
 * The scale-spray foliage kind's leaf builder: a spray is the leaf a shoot carries, so every mesh is
 * a whole spray, its cords dividing in the record's own order. The close-ups frame the first, and
 * the others carry turns of their own, so a shoot's sprays do not repeat.
 */
export const builder: FoliageBuilder = {
	leaves(record: Species, manifest: TextureManifest, detail: Detail): readonly PrototypeArrays[] {
		const foliage = record.foliage;
		if (foliage.kind !== 'scale-spray')
			throw new Error(`@null3d/vegetation: the scale-spray builder got '${foliage.kind}' foliage`);
		const spray = foliage.spray;
		return [
			sprayMesh(spray, manifest, detail, 0),
			...Array.from({ length: MESHES - 1 }, (_, index) =>
				sprayMesh(spray, manifest, detail, index + 1),
			),
		];
	},
};
