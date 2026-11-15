// What the tests of the directed growers of whole pieces share: where a socket points, how evenly a
// set of bearings fills a circle, and the highest point a plant draws.
import type { SpeciesKitData } from '../asset';
import type { MacroSkeleton } from '../core/graph';
import { asin, quatRotate, type Vector3 } from '../core/math';
import { DETAILS } from '../core/types';
import type { growPlantNow } from '../generate';

/** The way a bud site points: its frame's +Y. */
function headingOf(skeleton: MacroSkeleton, bud: number): Vector3 {
	const heading: Vector3 = [0, 0, 0];
	quatRotate(skeleton.buds.frame, bud * 4, [0, 1, 0], heading);
	return heading;
}

/** The bearing of a bud site's heading round the vertical, in degrees. */
export function azimuthOf(skeleton: MacroSkeleton, bud: number): number {
	const heading = headingOf(skeleton, bud);
	return (Math.atan2(heading[2], heading[0]) * 180) / Math.PI;
}

/** The elevation of a bud site's heading above level, in degrees. */
export function elevationOf(skeleton: MacroSkeleton, bud: number): number {
	const heading = headingOf(skeleton, bud);
	return (asin(Math.min(1, Math.max(-1, heading[1]))) * 180) / Math.PI;
}

/** The largest gap in degrees between neighbouring bearings round a circle. */
export function largestGap(azimuths: readonly number[]): number {
	const sorted = azimuths.map((a) => ((a % 360) + 360) % 360).sort((a, b) => a - b);
	let gap = 0;
	for (let i = 0; i < sorted.length; i++) {
		const next = i + 1 < sorted.length ? (sorted[i + 1] as number) : (sorted[0] as number) + 360;
		gap = Math.max(gap, next - (sorted[i] as number));
	}
	return gap;
}

/** The highest drawn point of a plant's near level: its wood and every row's prototype. */
export function drawnTop(kit: SpeciesKitData, asset: ReturnType<typeof growPlantNow>): number {
	let top = asset.skeleton.height;
	const rows = asset.shoots;
	const local: Vector3 = [0, 0, 0];
	const world: Vector3 = [0, 0, 0];
	for (let r = 0; r < rows.count; r++) {
		const mesh = kit.prototypes[rows.prototype[r] as number]?.tiers[DETAILS.indexOf('high')];
		if (!mesh) continue;
		const scale = rows.scale[r] as number;
		for (let i = 0; i < mesh.positions.length; i += 3) {
			local[0] = (mesh.positions[i] as number) * scale;
			local[1] = (mesh.positions[i + 1] as number) * scale;
			local[2] = (mesh.positions[i + 2] as number) * scale;
			quatRotate(rows.rotation, r * 4, local, world);
			top = Math.max(top, (rows.position[r * 3 + 1] as number) + world[1]);
		}
	}
	return top;
}
