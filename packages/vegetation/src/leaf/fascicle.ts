// The fascicle foliage kind: a bundle of two to five half-round needles in a papery sheath, as pines
// carry them. The needles stand round the bundle's axis with their flat faces inward, so a pair
// closes into one round rod at the sheath, part a little toward their tips, and twist about their
// own length by the record's turn. The shoot prototypes set one fascicle on each node of their
// newest years.
//
// Fascicle space as leaf space: the sheath's base at the origin, the bundle up +Y.
import type { PrototypeArrays } from '../asset';
import { cos, quatAxisAngle, quatRotate, radians, sin, type Vector3 } from '../core/math';
import type { Species } from '../core/record';
import type { TextureManifest } from '../core/textures';
import { type Detail, spreadMean } from '../core/types';
import type { FoliageBuilder } from './kinds';
import { needleMesh } from './needle';
import { lathe, MeshWriter, SURFACE_STEM } from './writer';

/** Degrees each needle parts from the bundle's axis. */
const PARTING = 7;
/** Sides of the sheath by tier. */
const SHEATH_SIDES: Readonly<Record<Detail, number>> = { low: 3, medium: 4, high: 5, ultra: 6 };

/**
 * One fascicle mesh at one tier.
 *
 * @param record The species record, whose foliage is a fascicle.
 * @param manifest The species' texture manifest.
 * @param detail The tier.
 * @returns The mesh.
 * @category api/vegetation
 */
export function fascicleMesh(
	record: Species,
	manifest: TextureManifest,
	detail: Detail,
): PrototypeArrays {
	const foliage = record.foliage;
	if (foliage.kind !== 'fascicle')
		throw new Error(`@null3d/vegetation: the fascicle builder got '${foliage.kind}' foliage`);
	const phyllotaxis = record.shoots?.phyllotaxis;
	const count = Math.max(
		2,
		Math.min(5, phyllotaxis?.kind === 'fascicle' ? Math.round(phyllotaxis.needles) : 2),
	);
	const needle = needleMesh({ ...foliage.needle, section: 'half-round' }, manifest, detail);
	const length = spreadMean(foliage.needle.length);
	const sheath = Math.max(0, foliage.sheath);
	const mesh = new MeshWriter();
	const twist = radians(foliage.twist);
	const spin = [0, 0, 0, 1];
	const tilt = [0, 0, 0, 1];
	const turn = [0, 0, 0, 1];
	for (let k = 0; k < count; k++) {
		const azimuth = (2 * Math.PI * k) / count;
		// Outward from the bundle's axis at this needle's azimuth, and the axis it parts about.
		const outward: Vector3 = [cos(azimuth), 0, sin(azimuth)];
		const across: Vector3 = [-sin(azimuth), 0, cos(azimuth)];
		quatAxisAngle(across, -radians(PARTING), tilt);
		// The needle's flat face, which lies toward -Z in needle space, turns toward the axis.
		quatAxisAngle([0, 1, 0], Math.PI / 2 - azimuth, turn);
		const offset = foliage.needle.width * 0.25;
		mesh.append(needle, (p, n) => {
			// The twist grows along the needle.
			quatAxisAngle([0, 1, 0], twist * (p[1] / length), spin);
			quatRotate(spin, 0, p, p);
			quatRotate(spin, 0, n, n);
			quatRotate(turn, 0, p, p);
			quatRotate(turn, 0, n, n);
			p[0] += outward[0] * offset;
			p[2] += outward[2] * offset;
			quatRotate(tilt, 0, p, p);
			quatRotate(tilt, 0, n, n);
		});
	}
	if (sheath > 0) {
		const r = foliage.needle.width * 0.75;
		lathe(
			mesh,
			[
				[r * 1.1, 0],
				[r, sheath * 0.7],
				[r * 0.85, sheath],
			],
			[0, 0, 0],
			[0, 1, 0],
			SHEATH_SIDES[detail],
			[0, 0, SURFACE_STEM, 255],
		);
	}
	return mesh.finishPrototype();
}

/** The fascicle foliage kind's leaf builder: one fascicle per tier. */
export const builder: FoliageBuilder = {
	leaves(record: Species, manifest: TextureManifest, detail: Detail): readonly PrototypeArrays[] {
		return [fascicleMesh(record, manifest, detail)];
	},
};
