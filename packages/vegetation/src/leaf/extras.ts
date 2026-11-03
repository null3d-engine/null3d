// The extras: cones and fruit as lathe shapes, flowers as petal cups, thorns and cactus spines as
// spine fans, and catkins, on the sites their record names, in the seasons it names. A share of the
// matching sites carries one, chosen by hash; each hangs from its site's direction toward the ground
// by the record's degrees. Shoot tips and nodes come from the shoot rows; old wood, areoles and the
// crown's top come from the skeleton's bud sites.
//
// An extra's colour bytes hold its axis's wind record (high and low byte, global in the species'
// table), its entry in the record's extras, which picks its colour from the plant material's header,
// and the crown's sky visibility at its site. Only the first four entries draw. The second texture
// coordinate runs along the extra.
import type { MeshArrays } from '../asset';
import { BUD_AREOLE, BUD_DORMANT, BUD_TERMINAL } from '../core/graph';
import { unitAt } from '../core/hash';
import {
	cos,
	cross3,
	length3,
	normalize3,
	quatAxisAngle,
	quatRotate,
	radians,
	sin,
	type Vector3,
} from '../core/math';
import type { ExtraSpec } from '../core/record';
import { crownSkyAt } from '../crown/visibility';
import type { MeshInput, MeshLevel } from '../stages';
import { VARIANT_RECORDS } from '../wind/records';
import { lathe, MeshWriter, sideAxes } from './writer';

/** Faces round an extra by level; the thinned level draws the fewest. */
const SIDES: Readonly<Record<MeshLevel, number>> = { 0: 8, 1: 5, 2: 4 };
/** Extras smaller than this, in metres, are left out of the thinned level, where they cover no pixel. */
const SMALLEST_FAR = 0.025;
/** The first hash purpose of the extras, past every purpose the instancer uses. */
const PURPOSE = 40;
/** Extras a record can draw: the first four, whose colours the plant material's header holds. */
const MOST = 4;

/** One place an extra may hang from: its point, its outward direction and its wind record. */
interface Site {
	readonly at: Vector3;
	readonly direction: Vector3;
	readonly record: number;
	/** Sky visibility at the site, 0 to 255. */
	sky: number;
}

/** The sites of one extra in a dressed variant. */
function sitesOf(input: MeshInput, extra: ExtraSpec): Site[] {
	const { rows, kit, skeleton } = input;
	const base = input.variant * VARIANT_RECORDS;
	const out: Site[] = [];
	const up: Vector3 = [0, 1, 0];
	if (extra.at === 'shoot-tip' || extra.at === 'node' || extra.at === 'spur') {
		for (let r = 0; r < rows.count; r++) {
			const prototype = kit.prototypes[rows.prototype[r] as number];
			if (!prototype) continue;
			if (extra.at === 'spur' && prototype.class !== 'spur') continue;
			const direction = quatRotate(rows.rotation, r * 4, up, [0, 0, 0]);
			const reach = extra.at === 'shoot-tip' ? prototype.length * (rows.scale[r] as number) : 0;
			out.push({
				at: [
					(rows.position[r * 3] as number) + direction[0] * reach,
					(rows.position[r * 3 + 1] as number) + direction[1] * reach,
					(rows.position[r * 3 + 2] as number) + direction[2] * reach,
				],
				direction,
				record: base + (rows.record[r] as number),
				sky: 0,
			});
		}
		return out;
	}
	const buds = skeleton.buds;
	for (let b = 0; b < buds.count; b++) {
		const kind = buds.kind[b] as number;
		const y = buds.position[b * 3 + 1] as number;
		const take =
			extra.at === 'areole'
				? kind === BUD_AREOLE
				: extra.at === 'old-wood'
					? kind === BUD_DORMANT || (kind !== BUD_TERMINAL && kind !== BUD_AREOLE)
					: kind === BUD_TERMINAL && y > skeleton.height * 0.85;
		if (!take) continue;
		out.push({
			at: [buds.position[b * 3] as number, y, buds.position[b * 3 + 2] as number],
			direction: quatRotate(buds.frame, b * 4, up, [0, 0, 0]),
			record: base + (skeleton.axes.record[buds.axis[b] as number] as number),
			sky: 0,
		});
	}
	return out;
}

/** A direction turned toward the ground by up to `degrees`, never past straight down. */
function hung(direction: Readonly<Vector3>, degrees: number): Vector3 {
	const out: Vector3 = [direction[0], direction[1], direction[2]];
	if (degrees <= 0) return out;
	const axis = cross3(direction, [0, -1, 0], [0, 0, 0]);
	const sine = length3(axis[0], axis[1], axis[2]);
	if (sine < 1e-6) return out;
	normalize3(axis);
	// The angle to straight down, so the hang stops there.
	const toDown = Math.atan2(sine, -direction[1]);
	const q = [0, 0, 0, 1];
	quatAxisAngle(axis, Math.min(radians(degrees), toDown), q);
	return normalize3(quatRotate(q, 0, out, out));
}

/** The largest size of an extra's shape, in metres. */
function sizeOf(extra: ExtraSpec): number {
	const shape = extra.shape;
	if ('lathe' in shape) {
		let size = 0;
		for (const [radius, height] of shape.lathe) size = Math.max(size, radius * 2, height);
		return size;
	}
	if ('petals' in shape) return shape.radius * 2;
	if ('spines' in shape) return shape.length;
	return shape.catkin.length;
}

/** Writes one extra at a site. */
function writeExtra(
	mesh: MeshWriter,
	extra: ExtraSpec,
	index: number,
	site: Site,
	direction: Vector3,
	sides: number,
	turn: number,
): void {
	const colour = [(site.record >>> 8) & 255, site.record & 255, index, site.sky];
	const shape = extra.shape;
	if ('lathe' in shape || 'catkin' in shape) {
		let profile: [number, number][];
		if ('lathe' in shape) {
			profile = shape.lathe.map(([radius, height]) => [radius, height]);
			// Scales: rings of bumps up a cone, one ring per scale row.
			const rows = shape.scales ?? 0;
			if (rows > 0 && profile.length > 1) {
				const height = (profile[profile.length - 1] as [number, number])[1];
				const fine: [number, number][] = [];
				const steps = Math.max(profile.length, Math.min(24, rows * 2));
				for (let s = 0; s <= steps; s++) {
					const h = (height * s) / steps;
					let radius = 0;
					for (let k = 1; k < profile.length; k++) {
						const [r0, h0] = profile[k - 1] as [number, number];
						const [r1, h1] = profile[k] as [number, number];
						if (h <= h1 || k === profile.length - 1) {
							radius = h1 > h0 ? r0 + ((h - h0) / (h1 - h0)) * (r1 - r0) : r1;
							break;
						}
					}
					fine.push([
						radius * (1 + 0.12 * Math.abs(sin((Math.PI * rows * h) / Math.max(height, 1e-6)))),
						h,
					]);
				}
				profile = fine;
			}
		} else {
			const { length, radius } = shape.catkin;
			profile = [
				[radius * 0.4, 0],
				[radius, length * 0.15],
				[radius, length * 0.8],
				[0, length],
			];
		}
		const first = mesh.vertices;
		lathe(mesh, profile, site.at, direction, sides, colour);
		for (let i = first; i < mesh.vertices; i++) mesh.uvs[i * 2] = 0;
		return;
	}
	const [x, y] = sideAxes(direction, [0, 1, 0]);
	if ('petals' in shape) {
		// A cup of petals: each petal a pointed blade from the centre, opening by the cup.
		const open = radians(90 * (1 - Math.min(1, Math.max(0, shape.cup))));
		for (let k = 0; k < shape.petals; k++) {
			const a = turn + (2 * Math.PI * k) / shape.petals;
			const out: Vector3 = [
				x[0] * cos(a) + y[0] * sin(a),
				x[1] * cos(a) + y[1] * sin(a),
				x[2] * cos(a) + y[2] * sin(a),
			];
			const petal = normalize3([
				out[0] * sin(open) + direction[0] * cos(open),
				out[1] * sin(open) + direction[1] * cos(open),
				out[2] * sin(open) + direction[2] * cos(open),
			]);
			const across = normalize3(cross3(petal, out, [0, 0, 0]));
			const normal = normalize3(cross3(across, petal, [0, 0, 0]));
			const r = shape.radius;
			const w = (r * Math.PI) / shape.petals;
			const point = (along: number, side: number): number[] => [
				site.at[0] + petal[0] * along * r + across[0] * side * w,
				site.at[1] + petal[1] * along * r + across[1] * side * w,
				site.at[2] + petal[2] * along * r + across[2] * side * w,
			];
			const a0 = mesh.vertex(point(0, 0), normal, [0, 0], [0, 0], colour);
			const a1 = mesh.vertex(point(0.55, 0.5), normal, [0, 0.55], [0, 0], colour);
			const a2 = mesh.vertex(point(1, 0), normal, [0, 1], [0, 0], colour);
			const a3 = mesh.vertex(point(0.55, -0.5), normal, [0, 0.55], [0, 0], colour);
			mesh.quad(a0, a1, a2, a3);
		}
		return;
	}
	// A fan of spines: thin cones of three sides within the spread round the site's direction.
	const spread = radians(shape.spread);
	for (let k = 0; k < shape.spines; k++) {
		const a = turn + (2 * Math.PI * k) / shape.spines;
		const tilt = spread * (k === 0 ? 0 : 1);
		const spine = normalize3([
			direction[0] * cos(tilt) + (x[0] * cos(a) + y[0] * sin(a)) * sin(tilt),
			direction[1] * cos(tilt) + (x[1] * cos(a) + y[1] * sin(a)) * sin(tilt),
			direction[2] * cos(tilt) + (x[2] * cos(a) + y[2] * sin(a)) * sin(tilt),
		]);
		const first = mesh.vertices;
		lathe(
			mesh,
			[
				[shape.length * 0.05, 0],
				[0, shape.length],
			],
			site.at,
			spine,
			3,
			colour,
		);
		for (let i = first; i < mesh.vertices; i++) mesh.uvs[i * 2] = 0;
	}
}

/**
 * The extras of one variant at a level, or none when the record has none in this season.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @returns The extras' mesh, or undefined.
 */
export function extrasMesh(input: MeshInput, level: MeshLevel): MeshArrays | undefined {
	const extras = input.record.extras ?? [];
	const mesh = new MeshWriter();
	const salt = input.record.seedSalt;
	extras.forEach((extra, index) => {
		if (index >= MOST || !extra.seasons.includes(input.season)) return;
		if (level === 2 && sizeOf(extra) < SMALLEST_FAR) return;
		sitesOf(input, extra).forEach((site, s) => {
			const purpose = input.variant * 64 + PURPOSE + index;
			if (unitAt(input.seed, salt, purpose, s) >= extra.share) return;
			const turn = unitAt(input.seed, salt, purpose, s, 1) * 2 * Math.PI;
			site.sky = Math.round(
				255 * Math.min(1, Math.max(0, crownSkyAt(input.crown, site.at[0], site.at[1], site.at[2]))),
			);
			writeExtra(mesh, extra, index, site, hung(site.direction, extra.hang), SIDES[level], turn);
		});
	});
	return mesh.vertices > 0 ? mesh.finishMesh() : undefined;
}
