// The leaves of a plant with a branch system: cluster cards that face up and out, or narrow needle
// cards along a conifer's twigs. Every card's place and angle is a choice of the skeleton, so a
// coarser level drops cards and grows the rest without moving the crown.

import { hashAt, unitAt } from '../core/hash';
import { MeshBuilder, type PartArrays, type VertexWind } from './builder';
import { type CrownField, crownEnvelope, occlusionByte } from './crown';
import type { LeafCard } from './levels';
import type { Skeleton, SkeletonBranch } from './skeleton';
import type { Leaf, Species } from './species';

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
 * A point of a branch at a share of its length, with the tangent that the segment runs along. The
 * branch's points are its joints, so a card placed at a joint and one placed between joints sit as
 * far apart as the branch is long: a twig of four joints carries a spray along its whole length
 * rather than a clump at each joint.
 */
function pointAlong(
	branch: SkeletonBranch,
	t: number,
): {
	point: [number, number, number];
	tangent: [number, number, number];
} {
	const samples = branch.points.length / 3;
	if (samples < 2) return pointAndTangent(branch, 0);
	const f = Math.min(1, Math.max(0, t)) * (samples - 1);
	const i = Math.min(samples - 2, Math.floor(f));
	const u = f - i;
	const a = i * 3;
	const b = (i + 1) * 3;
	const ax = branch.points[a] as number;
	const ay = branch.points[a + 1] as number;
	const az = branch.points[a + 2] as number;
	const bx = branch.points[b] as number;
	const by = branch.points[b + 1] as number;
	const bz = branch.points[b + 2] as number;
	return {
		point: [ax + (bx - ax) * u, ay + (by - ay) * u, az + (bz - az) * u],
		tangent: normalize(bx - ax, by - ay, bz - az),
	};
}

/** The stiffness byte of a branch level, which the material reads as a fraction. */
function stiffnessByte(species: Species, level: number): number {
	return Math.round(
		Math.min(
			1,
			Math.max(0, species.wind.stiffness[Math.min(level, species.wind.stiffness.length - 1)] ?? 0),
		) * 255,
	);
}

/**
 * One card at a point, facing up and out from the plant's axis. The card leans and rolls by its own
 * choice of the random stream, so a crown reads as many leaves rather than one panel.
 */
function makeCard(
	leaf: Leaf,
	crown: CrownField,
	seed: number,
	variant: number,
	key: number,
	point: [number, number, number],
	tangent: [number, number, number],
	outward: [number, number, number],
	branch: number,
	stiffness: number,
): LeafCard {
	const facing = normalize(outward[0] * leaf.out, leaf.up, outward[2] * leaf.out);
	// Each card leans its own way, so a crown's leaves point in many directions rather than one,
	// which is what makes a real crown read as leaves and not as a shell. The lean keeps the card's
	// up-and-out bias: a leaf that faced inward would not catch the sun.
	// A conifer's spray lies in the plane of its bough, so its card leans less than a broadleaf's
	// cluster: a card that turns away from the bough reads as a stick stuck into it.
	const leanScale = leaf.kind === 'needle' ? 0.35 : 1;
	const normal = normalize(
		facing[0] + (unitAt(seed, 6, variant, key, KEY_LEAN) - 0.5) * 1.5 * leanScale,
		facing[1] + (unitAt(seed, 7, variant, key, KEY_LEAN) - 0.5) * 1.1 * leanScale,
		facing[2] + (unitAt(seed, 8, variant, key, KEY_LEAN) - 0.5) * 1.5 * leanScale,
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
	// A conifer's spray runs along its shoot, so its card rolls less than a broadleaf's cluster. A
	// rolled shoot points across its twig, and a crown of them reads as loose sticks.
	const rollScale = leaf.kind === 'needle' ? 0.3 : 1;
	const roll =
		rollScale *
		((unitAt(seed, 2, variant, key, KEY_ROLL) - 0.5) * 1.2 +
			(unitAt(seed, 3, variant, key, KEY_SIDE) - 0.5) * 0.4);
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
	return {
		center: point,
		normal,
		right: rolledRight,
		up: rolledUp,
		width: leaf.width * size,
		height: leaf.height * size,
		branch,
		flutter: hashAt(seed, 5, variant, key, KEY_SIZE) & 0xff,
		stiffness,
		occlusion: occlusionByte(point[0], point[1], point[2], crown) / 255,
		kind: leaf.kind,
		cross: leaf.cross === true,
	};
}

/**
 * Places the plant's leaf cards on the branches that carry them, and in the crown's volume when
 * the record asks for fill. Each card faces up and away from the plant's axis, with a size and a
 * roll of its own. The cards come out in the same order on every device, so a level's share of
 * them is the same as well.
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
	// A bare plant keeps its branches and the record's card settings, and draws no leaves.
	if (!leaf || leaf.bare === true) return [];
	const cards: LeafCard[] = [];
	// The twigs carry the leaves, and each level above them carries half the cards of the level
	// below, out to the record's depth. The share thins the foliage toward the trunk, so a crown
	// fills from its inside rather than only at its tips.
	const lastLevel = Math.max(0, species.branchLevels.length - 1);
	const depth = Math.max(1, Math.round(leaf.depth ?? 2));
	// A record that asks for interior foliage spreads cards along the inner branches at the twigs'
	// own density, so a long limb carries a spray over its length rather than a clump at its tip.
	const fills = depth > 2;
	const twigLength = species.branchLevels[lastLevel]?.length ?? 1;
	const density = leaf.cards / Math.max(0.1, twigLength);
	const fill = Math.max(0, leaf.fill ?? 0);
	// A branch carries no foliage below the plant's floor. A crown's own start is the floor unless
	// the record states another, which a plant whose foliage hangs to the ground sets to zero. A
	// zero floor is the ground itself: everything above it is the species' own foliage, and a
	// drooping tip under the ground is out of sight rather than below a crown.
	const floor = crown.leafFloor ?? crown.start;
	// A filled crown fills to the branches' own top rather than the record's nominal height, so no
	// card is left in the air above the tree. Its cards also finish smaller near that top, so a
	// spire closes to a point.
	let crownTop = crown.height;
	if (fill > 0) {
		// A filled crown stops at the branches' real top. A rounded crown stops at the height that
		// most branches reach, so a lone upper limb does not carry cards into the air above the dome.
		const tops: number[] = [];
		for (const branch of skeleton.branches)
			for (let i = 0; i + 2 < branch.points.length; i += 3) {
				const y = branch.points[i + 1] as number;
				if (y >= crown.start) tops.push(y);
			}
		tops.sort((a, b) => a - b);
		const share = crown.fillTop ?? (crown.shape === 'conical' ? 1 : 0.92);
		const at = Math.floor((tops.length - 1) * share);
		crownTop = Math.max(crown.start + 0.1, tops[at] ?? crown.height);
	}
	for (const [branchIndex, branch] of skeleton.branches.entries()) {
		const terminal = branch.children.length === 0;
		const distance = lastLevel - branch.level;
		// A trunk carries no foliage of its own, and a branch beyond the depth carries none.
		if (!terminal && (branch.level === 0 || distance >= depth)) continue;
		const weight = 0.5 ** distance;
		let perBranch = terminal ? leaf.cards : Math.max(1, Math.round(leaf.cards * weight));
		if (fills && !terminal)
			perBranch = Math.max(perBranch, Math.min(64, Math.round(branch.length * density * weight)));
		const stiffness = stiffnessByte(species, branch.level);
		const samples = branch.points.length / 3;
		// The bare reach at a branch's base follows its height in the crown where the record names a
		// second one: a conifer's whorls stand apart low, so their wood shows, and crowd at the top,
		// where they should wrap the leader.
		let firstCard = leaf.start;
		if (leaf.startTop !== undefined) {
			const branchY = branch.points[1] as number;
			const heightT = Math.min(
				1,
				Math.max(0, (branchY - crown.start) / Math.max(1e-6, crownTop - crown.start)),
			);
			firstCard = leaf.start + (leaf.startTop - leaf.start) * heightT;
		}
		for (let k = 0; k < perBranch; k++) {
			const key = branchIndex * 0x1f + k + 1;
			const share =
				firstCard +
				(leaf.end - firstCard) *
					((k + 0.5 + (unitAt(seed, 1, variant, key, KEY_AT) - 0.5) * 0.5) / perBranch);
			const { point, tangent } = pointAlong(branch, share);
			// A limb that leaves the trunk below the floor carries no leaves there.
			if (floor > 0 && point[1] < floor) continue;
			// The outward direction is horizontal, away from the plant's axis.
			const outward = normalize(point[0], 0, point[2]);
			const card = makeCard(
				leaf,
				crown,
				seed,
				variant,
				key,
				point,
				tangent,
				outward,
				branchIndex,
				stiffness,
			);
			if (fill > 0) {
				// A card near the crown's top is finer than one at its foot, so a spire ends in a point.
				const t = Math.min(
					1,
					Math.max(0, (point[1] - crown.start) / Math.max(1e-6, crownTop - crown.start)),
				);
				const shrink = 0.3 + 0.7 * crownEnvelope(crown.shape, t);
				cards.push({ ...card, width: card.width * shrink, height: card.height * shrink });
			} else cards.push(card);
		}
		// The last distributed card stops short of the branch's end, so one card sits on the tip
		// itself and the wood shows no bare point. Only a filled crown pays for the extra card.
		if (fill > 0 && perBranch > 0 && samples > 1) {
			const key = branchIndex * 0x1f + perBranch + 1;
			const { point, tangent } = pointAlong(branch, 1);
			if (floor > 0 && point[1] < floor) continue;
			const outward = normalize(point[0], 0, point[2]);
			cards.push(
				makeCard(leaf, crown, seed, variant, key, point, tangent, outward, branchIndex, stiffness),
			);
		}
	}

	// A filled crown holds cards through its volume as well as on its branches. Each filled card
	// takes its place from the crown's own outline, then lies on the line between the two twigs
	// nearest that place, so foliage closes the space between the wood instead of gathering on it.
	if (fill > 0 && cards.length > 0) {
		// The branches' samples that lie inside the crown give the twigs that a filled card may
		// stand between, and the branch and level that hold it for its wind and its shade.
		interface Hold {
			readonly point: [number, number, number];
			readonly tangent: [number, number, number];
			readonly branch: number;
			readonly level: number;
		}
		const holds: Hold[] = [];
		for (const branch of skeleton.branches) {
			const samples = branch.points.length / 3;
			for (let i = 0; i < samples; i++) {
				const point: [number, number, number] = [
					branch.points[i * 3] as number,
					branch.points[i * 3 + 1] as number,
					branch.points[i * 3 + 2] as number,
				];
				if (point[1] < crown.start || point[1] > crownTop) continue;
				holds.push({
					point,
					tangent: pointAndTangent(branch, i).tangent,
					branch: branch.wind,
					level: branch.level,
				});
			}
		}
		// A coarse grid of the holds finds the twigs around a crown point without walking every
		// branch of the plant.
		const CELL = 1.5;
		const cellKey = (x: number, y: number, z: number) =>
			Math.floor(x / CELL) +
			512 +
			1024 * (Math.floor(y / CELL) + 512 + 1024 * (Math.floor(z / CELL) + 512));
		const buckets = new Map<number, number[]>();
		for (const [index, hold] of holds.entries()) {
			const key = cellKey(hold.point[0], hold.point[1], hold.point[2]);
			const list = buckets.get(key);
			if (list) list.push(index);
			else buckets.set(key, [index]);
		}
		/** The holds that stand in the cells around a point, which a filled card may bridge. */
		const neighbours = (point: readonly [number, number, number]): number[] => {
			const found: number[] = [];
			const cx = Math.floor(point[0] / CELL) + 512;
			const cy = Math.floor(point[1] / CELL) + 512;
			const cz = Math.floor(point[2] / CELL) + 512;
			for (let dx = -1; dx <= 1; dx++)
				for (let dy = -1; dy <= 1; dy++)
					for (let dz = -1; dz <= 1; dz++) {
						const list = buckets.get(cx + dx + 1024 * (cy + dy + 1024 * (cz + dz)));
						if (list) found.push(...list);
					}
			return found;
		};
		const stiffnesses = new Map<number, number>();
		const count = Math.round(cards.length * fill);
		const span = Math.max(1e-6, crownTop - crown.start);
		for (let k = 0; k < count && holds.length > 0; k++) {
			const key = 0x400000 + k;
			// More cards stand low in the crown, where a cone's surface is widest, and the top keeps
			// enough to close the spire rather than spread its cards only over the lower volume.
			const t = 1 - Math.sqrt(1 - unitAt(seed, 21, variant, key, KEY_AT));
			const at = crown.radius * crownEnvelope(crown.shape, t);
			const angle = unitAt(seed, 22, variant, key, KEY_SIDE) * Math.PI * 2;
			const aim: [number, number, number] = [
				Math.cos(angle) * at * Math.sqrt(unitAt(seed, 23, variant, key, KEY_ROLL)),
				crown.start + span * t,
				Math.sin(angle) * at * Math.sqrt(unitAt(seed, 23, variant, key, KEY_ROLL)),
			];
			const near = neighbours(aim);
			// The nearest twig holds the card, and the second twig that makes the line closest to
			// the crown point carries the other end, so a card that closes a gap between whorls or
			// between limbs still reads as foliage growing from wood.
			let pick: Hold | undefined;
			let point: [number, number, number] | undefined;
			if (near.length > 0) {
				let bestFirst = Number.POSITIVE_INFINITY;
				for (const index of near) {
					const hold = holds[index] as Hold;
					const dx = hold.point[0] - aim[0];
					const dy = hold.point[1] - aim[1];
					const dz = hold.point[2] - aim[2];
					const distance = dx * dx + dy * dy + dz * dz;
					if (distance < bestFirst) {
						bestFirst = distance;
						pick = hold;
					}
				}
				// A cone's outline is its surface: a card that stands on the crown point, within reach
				// of a twig, keeps the spire smooth instead of lumpy. Another crown pulls its cards
				// onto the line between two twigs, so an open canopy shows air rather than loose cards.
				// A record may ask for a share of its crown's cards to stand where the outline puts them,
				// whatever the wood is doing. A crown with few long limbs fills between them that way; a
				// crown that bridges only its neighbouring twigs reads as one lobe per limb.
				const loose = unitAt(seed, 24, variant, key, KEY_SIZE) < (leaf.volume ?? 0);
				if (pick && loose) point = aim;
				else if (pick && crown.shape === 'conical' && bestFirst <= 1.6 * 1.6) point = aim;
				if (pick && !point) {
					let bestPair = Number.POSITIVE_INFINITY;
					for (const index of near) {
						const other = holds[index] as Hold;
						if (other === pick) continue;
						const dx = other.point[0] - pick.point[0];
						const dy = other.point[1] - pick.point[1];
						const dz = other.point[2] - pick.point[2];
						const length = dx * dx + dy * dy + dz * dz;
						// A cone closes between twigs that can stand a little apart; a broken crown does
						// not bridge a long gap, so its cards stay near the wood and the air shows.
						const pairSpan = crown.shape === 'conical' ? 3 : 1.6;
						if (length < 1e-6 || length > pairSpan * pairSpan) continue;
						const share = Math.min(
							1,
							Math.max(
								0,
								((aim[0] - pick.point[0]) * dx +
									(aim[1] - pick.point[1]) * dy +
									(aim[2] - pick.point[2]) * dz) /
									length,
							),
						);
						const px = pick.point[0] + dx * share;
						const py = pick.point[1] + dy * share;
						const pz = pick.point[2] + dz * share;
						const miss = (px - aim[0]) ** 2 + (py - aim[1]) ** 2 + (pz - aim[2]) ** 2;
						if (miss < bestPair) {
							bestPair = miss;
							point = [px, py, pz];
						}
					}
					const reach = crown.shape === 'conical' ? 1.6 : 0.7;
					if (bestPair > reach * reach) {
						point = undefined;
						pick = undefined;
					}
				}
			}
			if (!pick || !point) {
				// With no twig near the crown point, the nearest branch still holds the card close,
				// so a lone tip carries foliage rather than leaving the place empty.
				const fallback = holds[
					Math.min(
						holds.length - 1,
						Math.floor(unitAt(seed, 24, variant, key, KEY_SIZE) * holds.length),
					)
				] as Hold;
				const reach = 0.1 + 0.3 * unitAt(seed, 25, variant, key, KEY_LEAN);
				const offset = normalize(
					unitAt(seed, 26, variant, key, KEY_AT) * 2 - 1,
					unitAt(seed, 27, variant, key, KEY_SIDE) * 2 - 1,
					unitAt(seed, 28, variant, key, KEY_ROLL) * 2 - 1,
				);
				pick = fallback;
				point = [
					fallback.point[0] + offset[0] * reach,
					fallback.point[1] + offset[1] * reach,
					fallback.point[2] + offset[2] * reach,
				];
			}
			const placed: [number, number, number] = [
				point[0],
				Math.min(crownTop, Math.max(crown.start, point[1])),
				point[2],
			];
			const outward = normalize(placed[0], 0, placed[2]);
			const tangent = leaf.hang ? normalize(outward[0] * 0.2, -1, outward[2] * 0.2) : pick.tangent;
			let stiffness = stiffnesses.get(pick.level);
			if (stiffness === undefined) {
				stiffness = stiffnessByte(species, pick.level);
				stiffnesses.set(pick.level, stiffness);
			}
			const card = makeCard(
				leaf,
				crown,
				seed,
				variant,
				key,
				placed,
				tangent,
				outward,
				pick.branch,
				stiffness,
			);
			// The crown's rim carries fewer, larger cards: a spray of thin cards at the edge shows sky
			// between them, where a rim of overlapping ones reads as a mass broken by tufts.
			const rim = leaf.rim ?? 1;
			if (rim !== 1) {
				const fromAxis = Math.hypot(placed[0], placed[2]);
				const atRim = fromAxis > crown.radius * 0.66;
				if (atRim) {
					if (k % 2 === 1) continue;
					cards.push({ ...card, width: card.width * rim, height: card.height * rim });
					continue;
				}
			}
			// The crown's top keeps finer cards, so a spire closes to a point rather than a ball.
			const shrink = 0.45 + 0.55 * crownEnvelope(crown.shape, t);
			cards.push({ ...card, width: card.width * shrink, height: card.height * shrink });
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
	// A cluster card is six vertices and four triangles. A flat card is four and two, or eight and
	// four when it is crossed.
	let vertices = 0;
	let triangles = 0;
	for (const card of cards) {
		const crossed = card.kind !== 'cluster' && card.cross === true;
		vertices += card.kind === 'cluster' ? 6 : crossed ? 8 : 4;
		triangles += card.kind === 'cluster' ? 4 : crossed ? 4 : 2;
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
			// A flat card: four vertices and two triangles. A crossed card adds a second panel across
			// the first, so a spray keeps its coverage when the camera looks along the first panel.
			const start = builder.vertexCount;
			const crossed = card.cross === true;
			const planes: readonly (readonly [
				number,
				number,
				readonly [number, number, number],
				readonly [number, number, number],
				readonly [number, number, number],
			])[] = crossed
				? [
						[-w, -h, card.right, card.up, card.normal],
						[w, -h, card.right, card.up, card.normal],
						[w, h, card.right, card.up, card.normal],
						[-w, h, card.right, card.up, card.normal],
						[-w, -h, card.normal, card.up, card.right],
						[w, -h, card.normal, card.up, card.right],
						[w, h, card.normal, card.up, card.right],
						[-w, h, card.normal, card.up, card.right],
					]
				: [
						[-w, -h, card.right, card.up, card.normal],
						[w, -h, card.right, card.up, card.normal],
						[w, h, card.right, card.up, card.normal],
						[-w, h, card.right, card.up, card.normal],
					];
			for (const [right, up, across, along, direction] of planes) {
				const x = card.center[0] + across[0] * right * grow + along[0] * up * grow;
				const y = card.center[1] + across[1] * right * grow + along[1] * up * grow;
				const z = card.center[2] + across[2] * right * grow + along[2] * up * grow;
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
			builder.triangle(start, start + 1, start + 2);
			builder.triangle(start, start + 2, start + 3);
			if (crossed) {
				builder.triangle(start + 4, start + 5, start + 6);
				builder.triangle(start + 4, start + 6, start + 7);
			}
		}
	}
	return { ...builder.finish(), targets };
}
