// The grass-blade foliage kind: a keeled ribbon along an arching path. Each half rises from the keel
// by the record's fold, so the blade is a shallow V that lights as two faces; it twists along its
// length; its width follows the record's profile, then closes in its tip: a short blunt hood whose
// halves rise to meet like a boat's prow (meadow grass), or a long fine point (sedge). The dry tip
// browns. The tuft grower writes every blade of a plant along its own axis with `writeBlade`; the
// kit's one blade, for the 'leaf' cutting, arches from the leaf frame's origin up +Y with its upper
// face toward +Z, its colour bytes those a cutting copies (flutter phase first, full sky last) and its
// second coordinate the share along it and its browning, as the plant's own blades carry them.
import type { PrototypeArrays } from '../asset';
import { cos, radians, sin } from '../core/math';
import type { GrassBlade, Species } from '../core/record';
import type { TextureManifest } from '../core/textures';
import { curveAt, type Detail, spreadMean } from '../core/types';
import { type AxisBytes, leafStrip, skyByte, smoothNormals, smoothstep } from '../grow/ground';
import type { CrownLight } from '../stages';
import { type AxisPath, axisPath, emptyFrame, frameAt, type PathFrame } from '../wood/frames';
import type { FoliageBuilder } from './kinds';
import { MeshWriter } from './writer';

/** Degrees each half of a hooded tip rises at its very end, closing over the keel. */
const HOOD_FOLD = 72;

/** One blade as written: its length and the record's blade shape. */
export interface BladeForm {
	/** The blade's own length in metres, collar to tip. */
	readonly length: number;
	/** Width in metres at its widest. */
	readonly width: number;
	/** The record's blade. */
	readonly blade: GrassBlade;
	/** Degrees of twist from collar to tip, this blade's own. */
	readonly twist: number;
	/** How far the blade has browned overall, 0 to 1, and how much its dry tip browns. */
	readonly browning: number;
	readonly dry: number;
}

/** How finely a blade is written: rows along it, and points a side of the keel across it. */
export interface BladeDetail {
	readonly rows: number;
	/** 0 draws a flat strip of two points across; 1 a V of three; 2 a rounded V of five. */
	readonly across: number;
}

/**
 * The blade's half-width in metres at a share of its length: the profile, closed by the tip.
 *
 * @param form The blade.
 * @param t The share along it, 0 at the collar.
 * @returns The half-width.
 */
export function bladeHalf(form: BladeForm, t: number): number {
	const { blade } = form;
	const half = 0.5 * form.width * curveAt(blade.profile, t);
	const start = 1 - blade.tipLength;
	if (t <= start) return half;
	const u = Math.min(1, (t - start) / Math.max(1e-6, blade.tipLength));
	// A hood closes round, as a quarter ellipse; a point narrows nearly straight to nothing.
	const close = blade.tip === 'hooded' ? Math.sqrt(Math.max(0, 1 - u * u)) : (1 - u) ** 0.85;
	return half * close;
}

/** The fold in degrees at a share along the blade: the record's, rising into a hood at the tip. */
function foldAt(form: BladeForm, t: number): number {
	const { blade } = form;
	if (blade.tip !== 'hooded') return blade.fold;
	return blade.fold + (HOOD_FOLD - blade.fold) * smoothstep(1 - blade.tipLength * 1.5, 1, t);
}

/** Where a blade's texture lies: v at its collar and tip, and its half-width in u. */
export interface BladeTexture {
	readonly base: number;
	readonly tip: number;
	readonly half: number;
}

/**
 * The blade's place in the leaf texture: the manifest's frame and the outline's widest half, or the
 * whole texture without a leaf.
 *
 * @param manifest The texture manifest.
 * @returns Its frame.
 */
export function bladeTexture(manifest: TextureManifest): BladeTexture {
	const strip = leafStrip(manifest);
	let half = 0.45;
	const outline = manifest.leaf?.outline;
	if (outline && outline.length >= 6) {
		half = 0;
		for (let i = 0; i < outline.length; i += 2)
			half = Math.max(half, Math.abs((outline[i] as number) - 0.5));
	}
	return { base: strip.base, tip: strip.tip, half };
}

const frame: PathFrame = emptyFrame();

/**
 * Writes one blade along a path from its collar to its tip: rows of a keeled section, the halves
 * rising from the keel, twisted along the blade, normals from the written faces.
 *
 * @param mesh The writer.
 * @param path The blade's path; the first frame's normal is its upper face.
 * @param form The blade.
 * @param detail Rows and points across.
 * @param texture Where the blade lies in the texture.
 * @param bytes The axis's record and flutter bytes.
 * @param crown The crown's light, for each vertex's sky.
 */
export function writeBlade(
	mesh: MeshWriter,
	path: AxisPath,
	form: BladeForm,
	detail: BladeDetail,
	texture: BladeTexture,
	bytes: AxisBytes,
	crown: CrownLight | undefined,
): void {
	const firstVertex = mesh.vertices;
	const firstIndex = mesh.indices.length;
	const points =
		detail.across === 0 ? [-1, 1] : detail.across === 1 ? [-1, 0, 1] : [-1, -0.5, 0, 0.5, 1];
	const columns = points.length;
	const rows = Math.max(2, detail.rows);
	const colour = [bytes.high, bytes.low, bytes.phase, 255];
	const p = [0, 0, 0];
	const dryStart = 1 - form.blade.dryTip;
	for (let r = 0; r <= rows; r++) {
		// Rows crowd toward the tip, where the blade closes and arches most.
		const t = 1 - (1 - r / rows) ** 1.35;
		frameAt(path, t * path.length, frame);
		const half = bladeHalf(form, t);
		const fold = radians(foldAt(form, t));
		const twist = radians(form.twist * t);
		const ct = cos(twist);
		const st = sin(twist);
		const cf = cos(fold);
		const sf = sin(fold);
		const v = texture.base + (texture.tip - texture.base) * t;
		const brown = Math.max(
			form.browning,
			form.dry * smoothstep(dryStart - 0.04, dryStart + 0.04, t),
		);
		for (const c of points) {
			// Across along the binormal, up along the normal; the twist turns both about the path.
			const across = c * half * cf;
			const up = Math.abs(c) * half * sf;
			const x = across * ct - up * st;
			const z = across * st + up * ct;
			for (let k = 0; k < 3; k++)
				p[k] =
					(frame.position[k] as number) +
					(frame.binormal[k] as number) * x +
					(frame.normal[k] as number) * z;
			if (crown) colour[3] = skyByte(crown, p);
			mesh.vertex(
				p,
				[frame.normal[0] as number, frame.normal[1] as number, frame.normal[2] as number],
				[0.5 + c * texture.half * Math.min(1, half / Math.max(1e-6, 0.5 * form.width)), v],
				[t, brown],
				colour,
			);
		}
		if (r > 0) {
			const a = firstVertex + (r - 1) * columns;
			const b = firstVertex + r * columns;
			for (let j = 0; j < columns - 1; j++) mesh.quad(a + j, a + j + 1, b + j + 1, b + j);
		}
	}
	smoothNormals(mesh, firstVertex, firstIndex);
}

/**
 * The points of an arching blade's path in the leaf frame: up +Y from the origin, bending over
 * toward its lower face (-Z) by `arch` degrees, more toward the tip.
 *
 * @param length The blade's length in metres.
 * @param arch Degrees it bends over its length.
 * @param count Points.
 * @returns Its path.
 */
export function archedPath(length: number, arch: number, count: number): AxisPath {
	const points = new Float64Array(count * 3);
	const radii = new Float64Array(count);
	let y = 0;
	let z = 0;
	const step = length / (count - 1);
	for (let i = 1; i < count; i++) {
		const s = (i - 0.5) / (count - 1);
		const angle = radians(arch) * s * s;
		y += cos(angle) * step;
		z -= sin(angle) * step;
		points[i * 3 + 1] = y;
		points[i * 3 + 2] = z;
	}
	return axisPath(points, radii, count, [0, 0, 1]);
}

/** Rows along a blade by tier, for a blade of the record's mean length. */
export const BLADE_ROWS: Readonly<Record<Detail, number>> = {
	low: 4,
	medium: 7,
	high: 10,
	ultra: 14,
};

/** Points a side of the keel by tier. */
export const BLADE_ACROSS: Readonly<Record<Detail, number>> = {
	low: 1,
	medium: 1,
	high: 1,
	ultra: 2,
};

/** The grass-blade foliage kind's leaf builder: one blade of the record's mean length per tier. */
export const builder: FoliageBuilder = {
	leaves(record: Species, manifest: TextureManifest, detail: Detail): readonly PrototypeArrays[] {
		if (record.foliage.kind !== 'grass-blade') return [];
		const blade = record.foliage.blade;
		const length = spreadMean(blade.length);
		const mesh = new MeshWriter();
		writeBlade(
			mesh,
			archedPath(length, spreadMean(blade.arch), 12),
			{ length, width: blade.width, blade, twist: blade.twist, browning: 0, dry: 1 },
			{ rows: BLADE_ROWS[detail], across: BLADE_ACROSS[detail] },
			bladeTexture(manifest),
			{ high: 0, low: 0, phase: 0 },
			undefined,
		);
		return [mesh.finishPrototype()];
	},
};
