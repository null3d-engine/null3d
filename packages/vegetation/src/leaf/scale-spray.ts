// The scale-spray foliage kind: a cord that divides, clothed along its length in shingled scale
// leaves, one leaf mesh per spray. A leaf stands in leaf space, its base at the origin, its length
// up +Y and its upper face toward +Z; the shoot prototypes set one at each node.
//
// This is the guarded prototype of the route. The central cord runs one segment; the child cords
// leave its top in the spray's own plane, turned out of it by the record's flatten, and carry the
// spray above. Every cord segment carries small flat scales in two ranks; the scale's size follows
// the record's radius and segment, its count the detail tier, and a dead share colours the cords as
// stem so an inner spray reads as wood.
import type { PrototypeArrays } from '../asset';
import type { ScaleSpray, Species } from '../core/record';
import type { TextureManifest } from '../core/textures';
import type { Detail } from '../core/types';
import type { FoliageBuilder } from './kinds';
import { MeshWriter, SURFACE_LEAF, SURFACE_STEM } from './writer';

/** Scales along one segment of a cord, by tier: fewer at a distance. */
const SCALE_STEPS: Readonly<Record<Detail, number>> = { low: 2, medium: 2, high: 3, ultra: 4 };

/** Radians a child cord leaves the central one, by spray variant. */
const CHILD_ANGLE = [(34 * Math.PI) / 180, (42 * Math.PI) / 180, (50 * Math.PI) / 180] as const;

/** How far a spray variant's scales spread, as a share of the segment. */
const SCALE_WIDTH = [0.55, 0.7, 0.85] as const;

/** A spray's leaf colour: foliage throughout, or stem where the record marks it dead. */
function colour(stem: boolean): readonly number[] {
	return [0, 0, stem ? SURFACE_STEM : SURFACE_LEAF, 255];
}

/** One scale: a flat diamond in the cord's plane, its base on the cord and its tip turned out. */
function writeScale(
	mesh: MeshWriter,
	base: readonly [number, number, number],
	across: readonly [number, number, number],
	length: number,
	width: number,
	side: number,
	v: number,
	stem: boolean,
): void {
	const tip: [number, number, number] = [
		base[0] + across[0] * side * width * 0.4,
		base[1] + length,
		base[2] + across[2] * side * width * 0.4,
	];
	const outer: [number, number, number] = [
		base[0] + across[0] * side * width,
		base[1] + length * 0.45,
		base[2] + across[2] * side * width,
	];
	const inner: [number, number, number] = [
		base[0] + across[0] * side * width * 0.2,
		base[1] + length * 0.5,
		base[2] + across[2] * side * width * 0.2,
	];
	const normal: [number, number, number] = [0, 0, 1];
	const tint = colour(stem);
	const a = mesh.vertex(base, normal, [0.5, v], [base[1], base[0]], tint);
	const b = mesh.vertex(outer, normal, [0, v], [outer[1], outer[0]], tint);
	const c = mesh.vertex(tip, normal, [1, Math.min(1, v + 0.08)], [tip[1], tip[0]], tint);
	const d = mesh.vertex(inner, normal, [0.5, Math.min(1, v + 0.16)], [inner[1], inner[0]], tint);
	mesh.quad(a, b, c, d);
}

/** One cord: its own wood, then its scales in two ranks along each segment. */
function writeCord(
	mesh: MeshWriter,
	segment: number,
	from: readonly [number, number, number],
	along: readonly [number, number, number],
	across: readonly [number, number, number],
	segments: number,
	steps: number,
	widthScale: number,
	dead: boolean,
	scaleSpan = 1,
	scaleLengthShare = 0.9,
): void {
	const radius = Math.max(segment * 0.03, 0.0004);
	const end: [number, number, number] = [
		from[0] + along[0] * segment * segments,
		from[1] + along[1] * segment * segments,
		from[2] + along[2] * segment * segments,
	];
	// The cord's wood: a narrow ribbon under the scales, so a dead spray still draws its stem.
	const woodNormal: [number, number, number] = [0, 0, 1];
	const wood = colour(dead);
	const w0 = mesh.vertex(
		[from[0] - across[0] * radius, from[1] - across[1] * radius, from[2] - across[2] * radius],
		woodNormal,
		[0, 0],
		[0, 0],
		wood,
	);
	const w1 = mesh.vertex(
		[from[0] + across[0] * radius, from[1] + across[1] * radius, from[2] + across[2] * radius],
		woodNormal,
		[1, 0],
		[0, 0],
		wood,
	);
	const w2 = mesh.vertex(
		[end[0] + across[0] * radius, end[1] + across[1] * radius, end[2] + across[2] * radius],
		woodNormal,
		[1, 1],
		[end[1], end[0]],
		wood,
	);
	const w3 = mesh.vertex(
		[end[0] - across[0] * radius, end[1] - across[1] * radius, end[2] - across[2] * radius],
		woodNormal,
		[0, 1],
		[end[1], end[0]],
		wood,
	);
	mesh.quad(w0, w1, w2, w3);
	const scaleLength = segment * scaleLengthShare;
	const scaleWidth = segment * widthScale;
	for (let k = 0; k < segments; k++)
		for (let i = 0; i < steps; i++) {
			const t = (k + (i + 0.5) / steps) * segment * scaleSpan;
			const base: [number, number, number] = [
				from[0] + along[0] * t,
				from[1] + along[1] * t,
				from[2] + along[2] * t,
			];
			const v = Math.min(1, Math.max(0, (k + (i + 0.5) / steps) / segments));
			writeScale(mesh, base, across, scaleLength, scaleWidth, 1, v, false);
			writeScale(mesh, base, across, scaleLength, scaleWidth, -1, v, false);
		}
}

/**
 * One spray: the central cord, its child cords above it, and their scales.
 *
 * @param spray The record's spray fields.
 * @param manifest The species' texture manifest.
 * @param detail The mesh tier.
 * @param variant Which of the sprays a shoot may carry, 0 to 2.
 * @returns The spray's mesh arrays.
 */
export function sprayMesh(
	spray: ScaleSpray,
	manifest: TextureManifest,
	detail: Detail,
	variant = 0,
): PrototypeArrays {
	void manifest;
	const mesh = new MeshWriter();
	const steps = SCALE_STEPS[detail];
	const segment = spray.segment;
	const orders = Math.max(1, Math.min(4, Math.round(spray.orders)));
	const widthScale = SCALE_WIDTH[variant % SCALE_WIDTH.length] as number;
	const angle = CHILD_ANGLE[variant % CHILD_ANGLE.length] as number;
	const dead = spray.dead > 0;
	writeCord(mesh, segment, [0, 0, 0], [0, 1, 0], [1, 0, 0], 1, steps, widthScale, dead);
	// The child cords leave the central cord's top, in the spray's own flat plane as flatten asks,
	// and carry the spray above it: the top stands over one segment and under two.
	const outOfPlane = (1 - Math.max(0, Math.min(1, spray.flatten))) * angle;
	for (const side of [-1, 1] as const) {
		const base: [number, number, number] = [0, segment, 0];
		const along: [number, number, number] = [
			Math.cos(angle) * side,
			Math.sin(angle),
			Math.sin(outOfPlane) * side,
		];
		const across: [number, number, number] = [-Math.sin(angle) * side, Math.cos(angle), 0];
		for (let order = 1; order < orders; order++)
			writeCord(mesh, segment, base, along, across, 1, steps, widthScale, dead, 0.7, 0.4);
	}
	return mesh.finishPrototype();
}

/** The scale-spray kind's leaf builder: three sprays, so a shoot does not repeat one mesh. */
export const builder: FoliageBuilder = {
	leaves(record: Species, manifest: TextureManifest, detail: Detail): readonly PrototypeArrays[] {
		const foliage = record.foliage;
		if (foliage.kind !== 'scale-spray') return [];
		return [0, 1, 2].map((variant) => sprayMesh(foliage.spray, manifest, detail, variant));
	},
};
