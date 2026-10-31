// One generator for the plants that have no branch system: hostas, ferns, sedges, rushes and grass
// clumps. Every leaf starts at the base, stands at an angle of its own and arches over. A leaf is a
// broad folded blade, a narrow strip, or a frond whose rachis carries leaflets. Flowers stand on
// thin stems in the middle.
import { MeshBuilder, type PartArrays, type VertexWind } from './builder';
import { type CrownField, occlusionByte } from './crown';
import { hashAt, unitAt } from './hash';
import { spaceFillingKey } from './levels';
import type { Rosette, Species } from './species';

/** One leaf of a rosette, before a level thins it. */
export interface RosetteLeaf {
	/** The leaf's tip, which orders it for the level rule. */
	readonly tip: readonly [number, number, number];
	/** The yaw around the plant's axis, in radians. */
	readonly yaw: number;
	/** The angle above the ground where the leaf starts, in radians. */
	readonly pitch: number;
	/** The leaf's length, in meters. */
	readonly length: number;
	/** The leaf's half width at its widest, in meters. */
	readonly width: number;
	/** The flutter phase, from 0 to 255. */
	readonly flutter: number;
	/** How enclosed the leaf is in the rosette, from 0 to 1. */
	readonly occlusion: number;
}

/** The random stream keys of one leaf's choices. */
const KEY_YAW = 21;
const KEY_PITCH = 22;
const KEY_LENGTH = 23;
const KEY_WIDTH = 24;
const KEY_FLUTTER = 25;

/** A direction of unit length. */
function normalize(x: number, y: number, z: number): [number, number, number] {
	const length = Math.hypot(x, y, z);
	return length > 1e-9 ? [x / length, y / length, z / length] : [0, 1, 0];
}

/**
 * Places a rosette's leaves: each one starts at the base, turns to a yaw of its own and stands at
 * an angle that its arch pulls over. The tip is recorded, so a level orders the leaves by where
 * they end before it keeps a share of them.
 *
 * @param species The species record.
 * @param seed The scene's seed.
 * @param variant The variant's index.
 * @param crown The crown's volume, which sets the leaves' occlusion.
 * @returns The leaves at full detail.
 * @category api/vegetation
 */
export function rosetteLeaves(
	species: Species,
	seed: number,
	variant: number,
	crown: CrownField,
): RosetteLeaf[] {
	const rosette = species.rosette;
	if (!rosette) return [];
	const leaves: RosetteLeaf[] = [];
	for (let k = 0; k < rosette.blades; k++) {
		const yaw =
			(k / rosette.blades) * Math.PI * 2 +
			(unitAt(seed, species.seedSalt, variant, k, KEY_YAW) - 0.5) * 0.5;
		// Each blade leaves the base at its own angle, so a clump fans in many planes rather than one,
		// and the blades shade each other instead of reading as a flat fan.
		const pitch =
			(rosette.upright * 1.15 - 0.15) * (Math.PI / 2) +
			(unitAt(seed, species.seedSalt, variant, k, KEY_PITCH) - 0.5) * 1.1;
		const length =
			rosette.length * (0.85 + 0.3 * unitAt(seed, species.seedSalt, variant, k, KEY_LENGTH));
		const width =
			rosette.width * (0.8 + 0.4 * unitAt(seed, species.seedSalt, variant, k, KEY_WIDTH));
		const tip = leafPoint(yaw, pitch, length, rosette.arch, 1);
		leaves.push({
			tip,
			yaw,
			pitch,
			length,
			width,
			flutter: hashAt(seed, species.seedSalt, variant, k, KEY_FLUTTER) & 0xff,
			occlusion: occlusionByte(tip[0], tip[1], tip[2], crown) / 255,
		});
	}
	return leaves;
}

/** A point along a leaf whose pitch falls by `arch` over its length. */
function leafPoint(
	yaw: number,
	pitch: number,
	length: number,
	arch: number,
	t: number,
): [number, number, number] {
	const segments = 6;
	let x = 0;
	let y = 0;
	let z = 0;
	const step = length / segments;
	for (let i = 0; i < segments; i++) {
		const at = (i + 0.5) / segments;
		const angle = pitch - arch * at;
		x += Math.cos(angle) * Math.cos(yaw) * step;
		y += Math.sin(angle) * step;
		z += Math.cos(angle) * Math.sin(yaw) * step;
	}
	// Scale the whole path so that it ends at the leaf's true length.
	const reached = Math.hypot(x, y, z);
	const scale = reached > 1e-6 ? (length * t) / reached : 0;
	return [x * scale, y * scale, z * scale];
}

/** The leaves of one level, each grown about the base. */
export interface RosetteLevel {
	/** The leaves that the level draws. */
	readonly leaves: readonly RosetteLeaf[];
	/** How much each kept leaf grows, as a multiple of its size. */
	readonly grow: number;
	/** The largest leaf that the level drops, in meters: the distance that the level misses by. */
	readonly error: number;
}

/**
 * One level's rosette: every second leaf in a space-filling order, each grown about its base by the
 * square root of that step, so the clump keeps its size and thins evenly.
 *
 * @param leaves The rosette's leaves at full detail.
 * @param level The level, counted from 0.
 * @returns The level's leaves, their growth and their error.
 * @category api/vegetation
 */
export function rosetteLevel(leaves: readonly RosetteLeaf[], level: number): RosetteLevel {
	const every = 2 ** level;
	const grow = Math.sqrt(every);
	const min: [number, number, number] = [
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
	];
	const max: [number, number, number] = [
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	];
	for (const leaf of leaves)
		for (let axis = 0; axis < 3; axis++) {
			const value = leaf.tip[axis] as number;
			if (value < (min[axis] as number)) min[axis] = value;
			if (value > (max[axis] as number)) max[axis] = value;
		}
	const side = Math.max(0, max[0] - min[0], max[1] - min[1], max[2] - min[2]);
	const order = leaves
		.map((leaf, index) => ({ key: spaceFillingKey(leaf.tip, min, side), index }))
		.sort((a, b) => a.key - b.key || a.index - b.index)
		.map(({ index }) => index);
	const kept: RosetteLeaf[] = [];
	let error = 0;
	for (let at = 0; at < order.length; at++) {
		const leaf = leaves[order[at] as number] as RosetteLeaf;
		if (at % every !== 0) {
			error = Math.max(error, Math.hypot(leaf.length, leaf.width));
			continue;
		}
		kept.push(leaf);
	}
	return { leaves: kept, grow, error };
}

/** A leaf's flutter, stiffness and place in the wind table. A rosette is one branch. */
function windOf(leaf: RosetteLeaf, stiffness: number): VertexWind {
	return {
		branch: 0,
		flutter: leaf.flutter,
		stiffness: Math.round(Math.min(1, Math.max(0, stiffness)) * 255),
		occlusion: Math.round(leaf.occlusion * 255),
	};
}

/**
 * Builds one level's rosette leaves: a broad folded blade, a narrow strip, or a frond with leaflets.
 * The leaves' normals face the sky, so the crown lights from above.
 *
 * @param species The species record.
 * @param leaves The level's leaves.
 * @param grow How much each leaf grows about its base.
 * @param segments The curve samples along a leaf at this level.
 * @returns The leaves part's arrays.
 * @category api/vegetation
 */
export function buildRosette(
	species: Species,
	leaves: readonly RosetteLeaf[],
	grow: number,
	segments: number,
): PartArrays {
	const rosette = species.rosette as Rosette;
	const builder = new MeshBuilder();
	const stiffness = species.wind.stiffness[0] ?? 0;
	for (const leaf of leaves) {
		// A kept leaf widens by the level's factor, so the clump keeps its coverage where its
		// neighbours went. It does not lengthen, so the crown's bounds still hold every level.
		const length = leaf.length;
		const width = leaf.width * grow;
		const wind = windOf(leaf, stiffness);
		const pitch = leaf.pitch;
		const yaw = leaf.yaw;
		const steps = Math.max(2, segments);
		// Walk the leaf's path once, so that every column and every leaflet reads the same curve.
		const points: [number, number, number][] = [];
		const frames: { right: [number, number, number]; normal: [number, number, number] }[] = [];
		let x = 0;
		let y = 0;
		let z = 0;
		const step = length / steps;
		for (let i = 0; i <= steps; i++) {
			const at = i / steps;
			points.push([x, y, z]);
			const angle = pitch - rosette.arch * at;
			const tangent = normalize(
				Math.cos(angle) * Math.cos(yaw),
				Math.sin(angle),
				Math.cos(angle) * Math.sin(yaw),
			);
			// The leaf's right axis, from the world's up and the leaf's direction, so that the
			// normal that cross(dir, right) makes faces the sky.
			const right = normalize(Math.sin(yaw), 0, -Math.cos(yaw));
			const normal = normalize(
				tangent[1] * right[2] - tangent[2] * right[1],
				tangent[2] * right[0] - tangent[0] * right[2],
				tangent[0] * right[1] - tangent[1] * right[0],
			);
			frames.push({ right, normal });
			if (i < steps) {
				x += Math.cos(angle) * Math.cos(yaw) * step;
				y += Math.sin(angle) * step;
				z += Math.cos(angle) * Math.sin(yaw) * step;
			}
		}
		if (rosette.shape === 'frond') {
			buildFrond(builder, points, frames, width, rosette.pinnae, wind);
		} else {
			const broad = rosette.shape === 'broad';
			const columns = broad ? 3 : 2;
			// The leaf's first vertex, which its triangles count from.
			const first = builder.vertexCount;
			for (let i = 0; i <= steps; i++) {
				const at = i / steps;
				const point = points[i] as [number, number, number];
				const frame = frames[i] as {
					right: [number, number, number];
					normal: [number, number, number];
				};
				const shape = Math.sin(Math.PI * Math.min(1, Math.max(0, at))) ** (broad ? 0.6 : 0.5);
				const half = width * shape * (broad ? 1 : 1 - 0.5 * at);
				const lift = broad ? half * 0.35 : 0;
				const offsets: [number, number][] =
					columns === 3
						? [
								[-half, 0],
								[0, lift],
								[half, 0],
							]
						: [
								[-half, 0],
								[half, 0],
							];
				for (const [across, up] of offsets) {
					builder.vertex(
						point[0] + frame.right[0] * across + frame.normal[0] * up,
						point[1] + frame.right[1] * across + frame.normal[1] * up,
						point[2] + frame.right[2] * across + frame.normal[2] * up,
						frame.normal[0],
						frame.normal[1],
						frame.normal[2],
						(across / Math.max(1e-6, width) + 1) / 2,
						at,
						wind,
					);
				}
			}
			const per = columns;
			for (let i = 0; i < steps; i++) {
				for (let c = 0; c + 1 < columns; c++) {
					const a = first + i * per + c;
					const b = a + 1;
					const d = first + (i + 1) * per + c;
					const e = d + 1;
					builder.triangle(a, e, b);
					builder.triangle(a, d, e);
				}
			}
		}
	}
	return builder.finish();
}

/** A frond: a narrow rachis with a pair of leaflets at each step, each a small flat card. */
function buildFrond(
	builder: MeshBuilder,
	points: readonly [number, number, number][],
	frames: readonly { right: [number, number, number]; normal: [number, number, number] }[],
	width: number,
	pinnae: number,
	wind: VertexWind,
): void {
	const steps = points.length - 1;
	const rachis = Math.max(0.002, width * 0.08);
	// The rachis's first vertex, which its triangles count from.
	const first = builder.vertexCount;
	for (let i = 0; i <= steps; i++) {
		const point = points[i] as [number, number, number];
		const frame = frames[i] as {
			right: [number, number, number];
			normal: [number, number, number];
		};
		const at = i / steps;
		for (const side of [-1, 1]) {
			builder.vertex(
				point[0] + frame.right[0] * rachis * side,
				point[1] + frame.right[1] * rachis * side,
				point[2] + frame.right[2] * rachis * side,
				frame.normal[0],
				frame.normal[1],
				frame.normal[2],
				(side + 1) / 2,
				at,
				wind,
			);
		}
	}
	for (let i = 0; i < steps; i++) {
		const a = first + i * 2;
		const b = a + 1;
		const d = a + 2;
		const e = a + 3;
		builder.triangle(a, e, b);
		builder.triangle(a, d, e);
	}
	if (pinnae === 0) return;
	for (let p = 0; p < pinnae; p++) {
		const at = 0.15 + (0.75 * (p + 0.5)) / pinnae;
		const index = Math.min(steps, Math.max(0, Math.round(at * steps)));
		const point = points[index] as [number, number, number];
		const frame = frames[index] as {
			right: [number, number, number];
			normal: [number, number, number];
		};
		const leafletLength = Math.max(0.002, width * 0.9 * (1 - at));
		const leafletWidth = leafletLength * 0.22;
		for (const side of [-1, 1]) {
			// A leaflet runs out from the rachis, and its width runs along the rachis.
			const out: [number, number, number] = normalize(
				frame.right[0] * side,
				frame.right[1] * side,
				frame.right[2] * side,
			);
			const along: [number, number, number] = normalize(
				frame.normal[1] * out[2] - frame.normal[2] * out[1],
				frame.normal[2] * out[0] - frame.normal[0] * out[2],
				frame.normal[0] * out[1] - frame.normal[1] * out[0],
			);
			const start = builder.vertexCount;
			const corners: readonly [number, number][] = [
				[0, -leafletWidth],
				[leafletLength, -leafletWidth],
				[leafletLength, leafletWidth],
				[0, leafletWidth],
			];
			for (const [alongT, across] of corners) {
				builder.vertex(
					point[0] + out[0] * alongT + frame.normal[0] * 0.001 + along[0] * across,
					point[1] + out[1] * alongT + frame.normal[1] * 0.001 + along[1] * across,
					point[2] + out[2] * alongT + frame.normal[2] * 0.001 + along[2] * across,
					frame.normal[0],
					frame.normal[1],
					frame.normal[2],
					alongT / Math.max(1e-6, leafletLength),
					(across / leafletWidth + 1) / 2,
					wind,
				);
			}
			builder.triangle(start, start + 1, start + 2);
			builder.triangle(start, start + 2, start + 3);
		}
	}
}

/**
 * Builds the flower stems in the middle of a rosette: a thin strip rising from the base, with a head
 * of small cards at its top.
 *
 * @param species The species record.
 * @param seed The scene's seed.
 * @param variant The variant's index.
 * @returns The flowers part's arrays, or undefined when the record has no flowers.
 * @category api/vegetation
 */
export function buildFlowers(
	species: Species,
	seed: number,
	variant: number,
): PartArrays | undefined {
	const rosette = species.rosette;
	if (!rosette || rosette.flowers <= 0) return undefined;
	const builder = new MeshBuilder();
	const wind: VertexWind = {
		branch: 0,
		flutter: hashAt(seed, species.seedSalt, variant, 0, KEY_FLUTTER) & 0xff,
		stiffness: Math.round(Math.min(1, Math.max(0, species.wind.stiffness[0] ?? 0)) * 255),
		occlusion: 0,
	};
	for (let k = 0; k < rosette.flowers; k++) {
		const yaw = (k / rosette.flowers) * Math.PI * 2 + 0.4;
		const height =
			rosette.length * (0.75 + 0.3 * unitAt(seed, species.seedSalt, variant, k, KEY_PITCH));
		const lean = (unitAt(seed, species.seedSalt, variant, k, KEY_YAW) - 0.5) * 0.35;
		const steps = 4;
		const stem = Math.max(0.002, rosette.width * 0.06);
		// The stem is a thin ribbon, and its two faces look across it.
		const stemNormal: [number, number, number] = [-Math.sin(yaw), 0, Math.cos(yaw)];
		const start = builder.vertexCount;
		for (let i = 0; i <= steps; i++) {
			const at = i / steps;
			const x = Math.cos(yaw) * lean * at * height;
			const z = Math.sin(yaw) * lean * at * height;
			const y = height * at;
			for (const side of [-1, 1]) {
				builder.vertex(
					x + Math.cos(yaw) * stem * side,
					y,
					z + Math.sin(yaw) * stem * side,
					stemNormal[0],
					stemNormal[1],
					stemNormal[2],
					(side + 1) / 2,
					at,
					wind,
				);
			}
		}
		for (let i = 0; i < steps; i++) {
			const a = start + i * 2;
			builder.triangle(a, a + 1, a + 3);
			builder.triangle(a, a + 3, a + 2);
		}
		const top: [number, number, number] = [
			Math.cos(yaw) * lean * height,
			height,
			Math.sin(yaw) * lean * height,
		];
		const head = rosette.width * 1.4;
		for (let face = 0; face < 4; face++) {
			const turn = (face / 4) * Math.PI * 2;
			const right: [number, number, number] = [Math.cos(turn), 0, Math.sin(turn)];
			const forward: [number, number, number] = [-Math.sin(turn), 0, Math.cos(turn)];
			const at = builder.vertexCount;
			const corners: readonly [number, number][] = [
				[-head, -head * 0.6],
				[head, -head * 0.6],
				[head, head * 0.6],
				[-head, head * 0.6],
			];
			for (const [across, up] of corners) {
				builder.vertex(
					top[0] + right[0] * across,
					top[1] + up,
					top[2] + right[2] * across,
					forward[0],
					0,
					forward[2],
					(across / head + 1) / 2,
					(up / (head * 0.6) + 1) / 2,
					wind,
				);
			}
			builder.triangle(at, at + 1, at + 2);
			builder.triangle(at, at + 2, at + 3);
		}
	}
	return builder.finish();
}
