// Detail levels, made from the skeleton. A coarser level keeps fewer rings on every branch and a
// share of the leaf cards, each kept card grown about its middle, so the crown keeps its coverage.
// The card rule is the one that the asset tool applies to trees from files: the cards are ordered by
// a space-filling curve, every second or fourth one is kept, and it grows by the square root of that
// step. One test holds both implementations to the same rule.
import type { LeafKind } from './species';

/**
 * One leaf card, before any level drops or grows it.
 * @category api/vegetation
 */
export interface LeafCard {
	/** The card's middle. */
	readonly center: readonly [number, number, number];
	/** The direction the card faces. */
	readonly normal: readonly [number, number, number];
	/** The card's right axis, in its plane. */
	readonly right: readonly [number, number, number];
	/** The card's up axis, in its plane. */
	readonly up: readonly [number, number, number];
	/** Half the card's width. */
	readonly width: number;
	/** Half the card's height. */
	readonly height: number;
	/** The branch that the card's wind data names. */
	readonly branch: number;
	/** The card's flutter phase, from 0 to 255. */
	readonly flutter: number;
	/** How freely the card's branch follows the wind, from 0 to 255. */
	readonly stiffness: number;
	/** How enclosed the card is in the crown, from 0 to 1. */
	readonly occlusion: number;
	/** The card's outline. */
	readonly kind: LeafKind;
}

/**
 * A level's share of the cards, each grown to keep the crown's coverage.
 * @category api/vegetation
 */
export interface CardLevel {
	/** The cards that this level draws. */
	readonly cards: readonly LeafCard[];
	/** How much each kept card grows, as a multiple of its base half-size. */
	readonly grow: number;
	/** The largest card that the level drops, in meters: the distance that the level misses by. */
	readonly error: number;
}

/** The bits of one axis in a card's curve key. */
const CARD_KEY_BITS = 10;
/** The largest value of one axis in the key. */
const CARD_KEY_MAX = 2 ** CARD_KEY_BITS - 1;

/**
 * The number that orders a point along a space-filling curve, so that every second card in that
 * order spreads over the crown rather than over one side of it.
 *
 * @param point The point.
 * @param min The smallest corner of the space that holds the points.
 * @param side The longest side of that space.
 * @returns A key that sorts the points evenly over the space.
 * @category api/vegetation
 */
export function spaceFillingKey(
	point: readonly [number, number, number],
	min: readonly number[],
	side: number,
): number {
	const scale = side > 0 ? CARD_KEY_MAX / side : 0;
	const at = point.map((value, axis) =>
		Math.min(CARD_KEY_MAX, Math.max(0, Math.round((value - (min[axis] as number)) * scale))),
	);
	let key = 0;
	for (let bit = CARD_KEY_BITS - 1; bit >= 0; bit--)
		for (const axis of at) key = key * 2 + ((axis >> bit) & 1);
	return key;
}

/**
 * The cards in the order that a level thins them: by the space-filling curve through their middles.
 *
 * @param cards The plant's cards.
 * @returns The cards' indices, from the first that a level keeps to the last.
 * @category api/vegetation
 */
export function cardOrder(cards: readonly LeafCard[]): number[] {
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
	for (const card of cards)
		for (let axis = 0; axis < 3; axis++) {
			const value = card.center[axis] as number;
			if (value < (min[axis] as number)) min[axis] = value;
			if (value > (max[axis] as number)) max[axis] = value;
		}
	const side = Math.max(0, max[0] - min[0], max[1] - min[1], max[2] - min[2]);
	const keys = cards.map((card) => spaceFillingKey(card.center, min, side));
	return keys
		.map((key, index) => ({ key, index }))
		.sort((a, b) => a.key - b.key || a.index - b.index)
		.map(({ index }) => index);
}

/**
 * One level's cards: every `2 ** level`-th card in the space-filling order, each grown about its
 * middle by the square root of that step. The error is the largest card that the level drops.
 *
 * @param cards The plant's cards, at full detail.
 * @param level The level, counted from 0.
 * @param order The cards' order, from {@link cardOrder}. The caller passes it so that every level
 *   reads one order.
 * @returns The level's cards, their growth and their error.
 * @category api/vegetation
 */
export function cardLevel(
	cards: readonly LeafCard[],
	level: number,
	order: readonly number[],
): CardLevel {
	const every = 2 ** level;
	const grow = Math.sqrt(every);
	const kept: LeafCard[] = [];
	let error = 0;
	for (let at = 0; at < order.length; at++) {
		const index = order[at] as number;
		const card = cards[index] as LeafCard;
		if (at % every !== 0) {
			error = Math.max(error, card.width, card.height);
			continue;
		}
		kept.push(card);
	}
	return { cards: kept, grow, error };
}

/**
 * How many rings and sides one branch keeps at a level.
 * @category api/vegetation
 */
export interface WoodDetail {
	/** The radial sides of the thinnest branch at this level. */
	readonly sideScale: number;
	/** Every how many path samples the level keeps a ring. */
	readonly ringStep: number;
}

/**
 * One level's wood detail. A coarser level keeps fewer sides and fewer rings, so a far branch costs
 * a fraction of the triangles that a near one does.
 *
 * @param level The level, counted from 0.
 * @returns The level's detail.
 * @category api/vegetation
 */
export function woodDetail(level: number): WoodDetail {
	return {
		sideScale: level === 0 ? 1 : level === 1 ? 0.75 : 0.55,
		ringStep: level === 0 ? 1 : level === 1 ? 2 : 3,
	};
}

/**
 * How far a branch's level surface lies from the base branch, in meters: the chord of its sides and
 * the sag of its path.
 *
 * @param radius The branch's widest radius.
 * @param length The branch's length.
 * @param sides The sides that the level keeps.
 * @param rings The rings that the level keeps.
 * @returns A distance in meters.
 * @category api/vegetation
 */
export function woodError(radius: number, length: number, sides: number, rings: number): number {
	const sideChord = radius * (1 - Math.cos(Math.PI / Math.max(3, sides)));
	const pathSag = length * (1 - Math.cos(Math.PI / Math.max(2, rings * 2)));
	return Math.min(sideChord + pathSag, radius * 2);
}
