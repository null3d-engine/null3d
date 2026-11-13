// The needle foliage kind: one needle as a tapered prism of the record's section (rhombic, flat,
// half-round or awl), drawn to a point, with a two-triangle ribbon on the low tier. The shoot
// prototypes set needles on their nodes by the density and angle the record gives, and turn flat
// needles into two ranks.
//
// Needle space as leaf space: the needle's base at the origin, its length up +Y, its upper face
// toward +Z. Texture coordinates run up the midrib of the needle that the textures tool cuts from
// the shoot picture, or up the middle of the texture where the manifest holds no leaf.
import type { PrototypeArrays } from '../asset';
import { cos, sin } from '../core/math';
import type { NeedleShape, Species } from '../core/record';
import type { TextureManifest } from '../core/textures';
import { type Detail, spreadMean } from '../core/types';
import type { FoliageBuilder } from './kinds';
import { MeshWriter, SURFACE_LEAF } from './writer';

/** Rings between a needle's base and its point, by tier; the low tier draws a ribbon. */
const RINGS: Readonly<Record<Detail, number>> = { low: 0, medium: 1, high: 1, ultra: 2 };

/** A flat blade's width at its point over its width at its base. */
const BLADE_TIP = 0.35;

/** Colour bytes of a needle vertex before a shoot places it. */
const NEEDLE_COLOUR = [0, 0, SURFACE_LEAF, 255] as const;

/**
 * The points of a needle's section at unit width, x across and z up, counter-clockwise seen from
 * the tip, each with its outward normal.
 */
function section(
	kind: NeedleShape['section'],
): readonly (readonly [number, number, number, number])[] {
	switch (kind) {
		case 'rhombic':
			return [
				[0.5, 0, 1, 0],
				[0, 0.32, 0, 1],
				[-0.5, 0, -1, 0],
				[0, -0.32, 0, -1],
			];
		case 'flat':
			return [
				[0.5, 0, 1, 0],
				[0, 0.12, 0, 1],
				[-0.5, 0, -1, 0],
				[0, -0.12, 0, -1],
			];
		case 'half-round': {
			// A rounded back over a flat face; the flat face lies toward -Z.
			const out: [number, number, number, number][] = [];
			for (let k = 0; k <= 4; k++) {
				const a = (Math.PI * k) / 4;
				out.push([0.5 * cos(a), 0.45 * sin(a), cos(a), sin(a)]);
			}
			out.push([0, -0.02, 0, -1]);
			return out;
		}
		case 'awl':
			return [
				[0.5, -0.25, 0.87, -0.5],
				[0, 0.5, 0, 1],
				[-0.5, -0.25, -0.87, -0.5],
			];
	}
}

/** The texture span a needle samples: the stalk end, the tip, and metres per unit of texture. */
function textureSpan(
	manifest: TextureManifest,
	length: number,
): { base: number; tip: number; scale: number } {
	const leaf = manifest.leaf;
	if (!leaf) return { base: 0, tip: 1, scale: length };
	const base = leaf.frame.petiole[1];
	const tip = leaf.frame.tip[1];
	return { base, tip, scale: length / Math.max(1e-6, tip - base) };
}

/**
 * One needle as a flat blade of two triangles in needle space: its base at the origin, its length
 * up +Y, its face toward +Z, narrowing toward its point. It stands for a needle thinner than a
 * pixel at a whole view.
 *
 * @param shape The record's needle.
 * @param manifest The species' texture manifest.
 * @param length The needle's length in metres; the record's mean by default.
 * @returns The mesh.
 * @category api/vegetation
 */
export function bladeMesh(
	shape: NeedleShape,
	manifest: TextureManifest,
	length = spreadMean(shape.length),
): PrototypeArrays {
	const mesh = new MeshWriter();
	const { base, scale } = textureSpan(manifest, length);
	// A round needle shows its whole width from every side and a flat blade its width times the
	// cosine of its turn, 2 over pi of it on average. The blade is wider by the inverse, so a brush
	// of blades covers what a brush of round needles covers.
	const half = (shape.width / 2) * (Math.PI / 2);
	const tip = half * BLADE_TIP;
	const corner = (x: number, y: number): number =>
		mesh.vertex([x, y, 0], [0, 0, 1], [0.5 + x / scale, base + y / scale], [y, x], NEEDLE_COLOUR);
	mesh.quad(corner(-half, 0), corner(half, 0), corner(tip, length), corner(-tip, length));
	return mesh.finishPrototype();
}

/**
 * One needle mesh in needle space at one tier.
 *
 * @param shape The record's needle.
 * @param manifest The species' texture manifest.
 * @param detail The tier.
 * @param length The needle's length in metres; the record's mean by default.
 * @returns The mesh.
 * @category api/vegetation
 */
export function needleMesh(
	shape: NeedleShape,
	manifest: TextureManifest,
	detail: Detail,
	length = spreadMean(shape.length),
): PrototypeArrays {
	const mesh = new MeshWriter();
	const { base, scale } = textureSpan(manifest, length);
	const width = shape.width;
	const uv = (x: number, y: number) => [0.5 + x / scale, base + y / scale];
	const rings = RINGS[detail];
	if (rings === 0) {
		// A flat ribbon that narrows to the point.
		const a = mesh.vertex(
			[-width / 2, 0, 0],
			[0, 0, 1],
			uv(-width / 2, 0),
			[0, -width / 2],
			NEEDLE_COLOUR,
		);
		const b = mesh.vertex(
			[width / 2, 0, 0],
			[0, 0, 1],
			uv(width / 2, 0),
			[0, width / 2],
			NEEDLE_COLOUR,
		);
		const c = mesh.vertex(
			[width * 0.3, length * 0.85, 0],
			[0, 0, 1],
			uv(width * 0.3, length * 0.85),
			[length * 0.85, width * 0.3],
			NEEDLE_COLOUR,
		);
		const d = mesh.vertex(
			[-width * 0.3, length * 0.85, 0],
			[0, 0, 1],
			uv(-width * 0.3, length * 0.85),
			[length * 0.85, -width * 0.3],
			NEEDLE_COLOUR,
		);
		const tip = mesh.vertex([0, length, 0], [0, 0, 1], uv(0, length), [length, 0], NEEDLE_COLOUR);
		mesh.quad(a, b, c, d);
		mesh.indices.push(d, c, tip);
		return mesh.finishPrototype();
	}
	const points = section(shape.section);
	const n = points.length;
	const firsts: number[] = [];
	for (let r = 0; r <= rings; r++) {
		// The needle keeps its width to about two thirds of its length, then narrows to the point.
		const t = (r / (rings + 1)) * 0.85;
		const w = width * (1 - 0.35 * (t / 0.85) * (t / 0.85));
		const y = t * length;
		firsts.push(mesh.vertices);
		for (const [x, z, nx, nz] of points)
			mesh.vertex([x * w, y, z * w], [nx, 0, nz], uv(x * w, y), [y, x * w], NEEDLE_COLOUR);
	}
	for (let r = 0; r < rings; r++) {
		const a = firsts[r] as number;
		const b = firsts[r + 1] as number;
		for (let k = 0; k < n; k++) {
			const k1 = (k + 1) % n;
			mesh.quad(a + k, a + k1, b + k1, b + k);
		}
	}
	const last = firsts[rings] as number;
	const tip = mesh.vertex([0, length, 0], [0, 1, 0], uv(0, length), [length, 0], NEEDLE_COLOUR);
	for (let k = 0; k < n; k++) mesh.indices.push(last + k, last + ((k + 1) % n), tip);
	return mesh.finishPrototype();
}

/** The needle foliage kind's leaf builder: one needle per tier. */
export const builder: FoliageBuilder = {
	leaves(record: Species, manifest: TextureManifest, detail: Detail): readonly PrototypeArrays[] {
		const foliage = record.foliage;
		if (foliage.kind !== 'needle')
			throw new Error(`@null3d/vegetation: the needle builder got '${foliage.kind}' foliage`);
		return [needleMesh(foliage.needle, manifest, detail)];
	},
};
