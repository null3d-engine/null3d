// The leaves of a plant with a branch system: cluster cards that face up and out, or narrow needle
// cards along a conifer's twigs. Every card's place and angle is a choice of the skeleton, so a
// coarser level drops cards and grows the rest without moving the crown.
import { MeshBuilder, type PartArrays, type VertexWind } from './builder';
import { type CrownField, occlusionByte } from './crown';
import { hashAt, unitAt } from './hash';
import type { LeafCard } from './levels';
import type { Skeleton, SkeletonBranch } from './skeleton';
import type { Species } from './species';

/** The random stream keys of one card's choices. */
const KEY_AT = 11;
const KEY_SIDE = 12;
const KEY_ROLL = 13;
const KEY_SIZE = 14;
const KEY_LEAN = 15;

/** A direction of unit length. */
function normalize(x: number, y: number, z: number): [number, number, number] {
	const length = Math.hypot(x, y, z);
	return length > 1e-9 ? [x / length, y / length, z / length] : [0, 1, 0];
}

/** A point of a branch path and its tangent. */
function pointAndTangent(
	branch: SkeletonBranch,
	sample: number,
): {
	point: [number, number, number];
	tangent: [number, number, number];
} {
	const samples = branch.points.length / 3;
	const at = sample * 3;
	const point: [number, number, number] = [
		branch.points[at] as number,
		branch.points[at + 1] as number,
		branch.points[at + 2] as number,
	];
	const a = Math.max(0, sample - 1) * 3;
	const b = Math.min(samples - 1, sample + 1) * 3;
	return {
		point,
		tangent: normalize(
			(branch.points[b] as number) - (branch.points[a] as number),
			(branch.points[b + 1] as number) - (branch.points[a + 1] as number),
			(branch.points[b + 2] as number) - (branch.points[a + 2] as number),
		),
	};
}

/**
 * Places the plant's leaf cards on the branches that carry them: the tips of the branch system.
 * Each card faces up and away from the plant's axis, with a size and a roll of its own. The cards
 * come out in the same order on every device, so a level's share of them is the same as well.
 *
 * @param species The species record.
 * @param skeleton The plant's skeleton.
 * @param seed The scene's seed.
 * @param variant The variant's index.
 * @param crown The crown's volume, which sets the cards' occlusion.
 * @returns The plant's cards at full detail.
 * @category api/vegetation
 */
export function leafCards(
	species: Species,
	skeleton: Skeleton,
	seed: number,
	variant: number,
	crown: CrownField,
): LeafCard[] {
	const leaf = species.leaf;
	if (!leaf) return [];
	const cards: LeafCard[] = [];
	// The last two branch levels carry leaves: the twigs at full count and the branches above
	// them at half, so a crown fills from its inside rather than only at its tips.
	const lastLevel = Math.max(0, species.branchLevels.length - 1);
	for (const [branchIndex, branch] of skeleton.branches.entries()) {
		const terminal = branch.children.length === 0;
		if (!terminal && branch.level !== lastLevel - 1) continue;
		const perBranch = terminal ? leaf.cards : Math.max(1, Math.round(leaf.cards * 0.5));
		const stiffness = Math.round(
			Math.min(
				1,
				Math.max(
					0,
					species.wind.stiffness[Math.min(branch.level, species.wind.stiffness.length - 1)] ?? 0,
				),
			) * 255,
		);
		const samples = branch.points.length / 3;
		for (let k = 0; k < perBranch; k++) {
			const key = branchIndex * 0x1f + k + 1;
			const share =
				leaf.start +
				(leaf.end - leaf.start) *
					((k + 0.5 + (unitAt(seed, 1, variant, key, KEY_AT) - 0.5) * 0.5) / perBranch);
			const sample = Math.min(samples - 1, Math.max(0, Math.round(share * (samples - 1))));
			const { point, tangent } = pointAndTangent(branch, sample);
			// The outward direction is horizontal, away from the plant's axis.
			const outward = normalize(point[0], 0, point[2]);
			const facing = normalize(outward[0] * leaf.out, leaf.up, outward[2] * leaf.out);
			// Each card leans its own way, so a crown's leaves point in many directions rather than
			// one, which is what makes a real crown read as leaves and not as a shell. The lean keeps
			// the card's up-and-out bias: a leaf that faced inward would not catch the sun.
			const normal = normalize(
				facing[0] + (unitAt(seed, 6, variant, key, KEY_LEAN) - 0.5) * 1.5,
				facing[1] + (unitAt(seed, 7, variant, key, KEY_LEAN) - 0.5) * 1.1,
				facing[2] + (unitAt(seed, 8, variant, key, KEY_LEAN) - 0.5) * 1.5,
			);
			// The card's up axis leans along the branch, so a leaf reads as growing from its twig.
			const sideX = tangent[1] * normal[2] - tangent[2] * normal[1];
			const sideY = tangent[2] * normal[0] - tangent[0] * normal[2];
			const sideZ = tangent[0] * normal[1] - tangent[1] * normal[0];
			const sideLength = Math.hypot(sideX, sideY, sideZ);
			const right: [number, number, number] =
				sideLength > 1e-6
					? [sideX / sideLength, sideY / sideLength, sideZ / sideLength]
					: normalize(normal[1], -normal[0], 0);
			const up = normalize(
				normal[1] * right[2] - normal[2] * right[1],
				normal[2] * right[0] - normal[0] * right[2],
				normal[0] * right[1] - normal[1] * right[0],
			);
			const roll =
				(unitAt(seed, 2, variant, key, KEY_ROLL) - 0.5) * 1.2 +
				(unitAt(seed, 3, variant, key, KEY_SIDE) - 0.5) * 0.4;
			const cos = Math.cos(roll);
			const sin = Math.sin(roll);
			const rolledRight: [number, number, number] = [
				right[0] * cos + up[0] * sin,
				right[1] * cos + up[1] * sin,
				right[2] * cos + up[2] * sin,
			];
			const rolledUp: [number, number, number] = [
				up[0] * cos - right[0] * sin,
				up[1] * cos - right[1] * sin,
				up[2] * cos - right[2] * sin,
			];
			const size = 0.85 + 0.3 * unitAt(seed, 4, variant, key, KEY_SIZE);
			cards.push({
				center: point,
				normal,
				right: rolledRight,
				up: rolledUp,
				width: leaf.width * size,
				height: leaf.height * size,
				branch: branchIndex,
				flutter: hashAt(seed, 5, variant, key, KEY_SIZE) & 0xff,
				stiffness,
				occlusion: occlusionByte(point[0], point[1], point[2], crown) / 255,
				kind: leaf.kind,
			});
		}
	}
	return cards;
}

/**
 * The next coarser level that a leaf part morphs toward: the cards that it keeps, how much each one
 * grows, and the distance that its surface misses the base by.
 * @category api/vegetation
 */
export interface LeafTargets {
	/** The cards that the next level keeps. A card that it drops shrinks to its middle. */
	readonly keep: ReadonlySet<LeafCard>;
	/** How much each kept card grows, as a multiple of its base half-size. */
	readonly grow: number;
	/** The next level's error, in meters: the distance at which the engine switches to it. */
	readonly error: number;
}

/**
 * Builds one level's leaves: the cards as folded cluster cards or flat needle cards, each grown by
 * the level's factor. Each vertex also takes its place at the next coarser level, which a leaf
 * material morphs toward before the engine switches: a kept card's corner grows with the card, and
 * a dropped card's corners fall to its middle. Without a next level the record names the level's own
 * place with no error, which binds a morph that moves nothing.
 *
 * @param cards The level's cards.
 * @param grow How much each card grows about its middle.
 * @param next The next coarser level, or undefined for the coarsest one that the engine draws.
 * @returns The leaves part's arrays.
 * @category api/vegetation
 */
export function buildLeaves(
	cards: readonly LeafCard[],
	grow: number,
	next?: LeafTargets,
): PartArrays {
	const builder = new MeshBuilder();
	// Every cluster card is six vertices and four triangles; every other card is four and two.
	let vertices = 0;
	let triangles = 0;
	for (const card of cards) {
		vertices += card.kind === 'cluster' ? 6 : 4;
		triangles += card.kind === 'cluster' ? 4 : 2;
	}
	builder.reserve(vertices, triangles);
	// The target record runs beside the vertices, in the order that they arrive.
	const targets = new Float32Array(vertices * 4);
	const ratio = next && grow > 0 ? next.grow / grow : 1;
	const error = next?.error ?? 0;
	const target = (card: LeafCard, x: number, y: number, z: number, at: number) => {
		const kept = next?.keep.has(card) ?? false;
		targets[at * 4] = kept ? card.center[0] + (x - card.center[0]) * ratio : card.center[0];
		targets[at * 4 + 1] = kept ? card.center[1] + (y - card.center[1]) * ratio : card.center[1];
		targets[at * 4 + 2] = kept ? card.center[2] + (z - card.center[2]) * ratio : card.center[2];
		targets[at * 4 + 3] = error;
	};
	for (const card of cards) {
		const wind: VertexWind = {
			branch: card.branch,
			flutter: card.flutter,
			stiffness: card.stiffness,
			occlusion: Math.round(card.occlusion * 255),
		};
		const w = card.width;
		const h = card.height;
		if (card.kind === 'cluster') {
			// A card folded along its middle: six vertices and four triangles, as a leaf cluster. The
			// fold turns a card that the camera sees edge-on into a lit panel rather than a dark line,
			// so a crown's edges break into leaves instead of a black comb.
			const lift = Math.min(w, h) * 0.45;
			const leftX = normalize(
				card.normal[0] - card.right[0] * 0.5,
				card.normal[1] - card.right[1] * 0.5,
				card.normal[2] - card.right[2] * 0.5,
			);
			const rightX = normalize(
				card.normal[0] + card.right[0] * 0.5,
				card.normal[1] + card.right[1] * 0.5,
				card.normal[2] + card.right[2] * 0.5,
			);
			const corners: readonly [number, number, number, readonly [number, number, number]][] = [
				[-w, -h, 0, leftX],
				[0, -h, lift, card.normal],
				[w, -h, 0, rightX],
				[-w, h, 0, leftX],
				[0, h, lift, card.normal],
				[w, h, 0, rightX],
			];
			const start = builder.vertexCount;
			for (const [right, up, normal, direction] of corners) {
				const x =
					card.center[0] +
					card.right[0] * right * grow +
					card.up[0] * up * grow +
					card.normal[0] * normal * grow;
				const y =
					card.center[1] +
					card.right[1] * right * grow +
					card.up[1] * up * grow +
					card.normal[1] * normal * grow;
				const z =
					card.center[2] +
					card.right[2] * right * grow +
					card.up[2] * up * grow +
					card.normal[2] * normal * grow;
				const at = builder.vertex(
					x,
					y,
					z,
					direction[0],
					direction[1],
					direction[2],
					(right / w + 1) / 2,
					(up / h + 1) / 2,
					wind,
				);
				target(card, x, y, z, at);
			}
			builder.triangle(start, start + 1, start + 4);
			builder.triangle(start, start + 4, start + 3);
			builder.triangle(start + 1, start + 2, start + 5);
			builder.triangle(start + 1, start + 5, start + 4);
		} else {
			// A flat card: four vertices and two triangles.
			const start = builder.vertexCount;
			const corners: readonly [number, number][] = [
				[-w, -h],
				[w, -h],
				[w, h],
				[-w, h],
			];
			for (const [right, up] of corners) {
				const x = card.center[0] + card.right[0] * right * grow + card.up[0] * up * grow;
				const y = card.center[1] + card.right[1] * right * grow + card.up[1] * up * grow;
				const z = card.center[2] + card.right[2] * right * grow + card.up[2] * up * grow;
				const at = builder.vertex(
					x,
					y,
					z,
					card.normal[0],
					card.normal[1],
					card.normal[2],
					(right / w + 1) / 2,
					(up / h + 1) / 2,
					wind,
				);
				target(card, x, y, z, at);
			}
			builder.triangle(start, start + 1, start + 2);
			builder.triangle(start, start + 2, start + 3);
		}
	}
	return { ...builder.finish(), targets };
}
