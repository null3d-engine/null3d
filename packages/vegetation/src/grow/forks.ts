// The fork rule: a child's angle to its parent shrinks as its share of the parent grows. A thin side
// shoot may leave at up to 80 degrees and one of a fifth of its parent's wood at 65; past nearly half,
// where a shoot comes to lead its fork, the widest angle closes fast, to 15 degrees by three fifths.
// The self-organizing grower rights a young shoot whose share of the wood grows past what its angle
// allows, as reaction wood turns a vigorous shoot toward its parent's line.
import { atan2, cos, pow, radians, sin, type Vector3 } from '../core/math';

/** The widest a fork may be, in degrees, for the thinnest child. */
const WIDEST = 80;
/** Degrees the widest fork narrows by per whole share of the parent, up to the knee. */
const NARROWING = 75;
/** The share past which a child leads its fork, and its widest angle closes fast. */
const KNEE = 0.45;
/** The share by which a leading child's widest angle has closed to the narrowest. */
const LEADS = 0.6;
/** The narrowest a fork's widest angle becomes, in degrees. */
const NARROWEST = 15;

/**
 * The widest a child may leave its parent's line, in radians, by its share of the parent: 80
 * degrees for the thinnest, narrowing by 75 degrees per whole share to 46 at a share of 0.45, then
 * closing to 15 at 0.6 and beyond. A child of a fifth leaves at 65 degrees at most.
 *
 * @param share The child's share of its parent, 0 to 1.
 * @returns The widest angle, in radians.
 */
export function forkAngle(share: number): number {
	const atKnee = WIDEST - NARROWING * KNEE;
	if (share <= KNEE) return radians(Math.min(WIDEST, WIDEST - NARROWING * Math.max(0, share)));
	const t = Math.min(1, (share - KNEE) / (LEADS - KNEE));
	return radians(atKnee + (NARROWEST - atKnee) * t);
}

/**
 * A child's share of its parent's wood where it leaves: its cross-section over the parent's, from
 * the pipes each carries, by the pipe model's exponent.
 *
 * @param child Pipes the child carries.
 * @param parent Pipes the parent carries at the node.
 * @param exponent The pipe model's exponent.
 * @returns The share, 0 to 1.
 */
export function forkShare(child: number, parent: number, exponent: number): number {
	if (!(parent > 0)) return 0;
	return Math.min(1, pow(child / parent, 2 / exponent));
}

/**
 * Turns a direction toward a line until it leaves the line at no more than an angle, keeping the
 * side it leaves on. A direction already within the angle, or along the line, stays as it is.
 *
 * @param line The line, a unit vector.
 * @param d The direction, a unit vector, changed in place.
 * @param widest The angle in radians.
 */
export function narrowToward(line: Readonly<Vector3>, d: Vector3, widest: number): void {
	const along = d[0] * line[0] + d[1] * line[1] + d[2] * line[2];
	let ux = d[0] - line[0] * along;
	let uy = d[1] - line[1] * along;
	let uz = d[2] - line[2] * along;
	const across = Math.sqrt(ux * ux + uy * uy + uz * uz);
	if (across <= 1e-9 || atan2(across, along) <= widest) return;
	ux /= across;
	uy /= across;
	uz /= across;
	const c = cos(widest);
	const s = sin(widest);
	d[0] = line[0] * c + ux * s;
	d[1] = line[1] * c + uy * s;
	d[2] = line[2] * c + uz * s;
}

/** A side shoot is righted once it holds at least this share of its fork's wood. */
export const RIGHT_SHARE = 0.2;
/**
 * A side shoot is righted only while its own branch carries at most this many growing tips. A fork
 * forms on a branch well under this, so the righting reaches the forks the references judge.
 */
export const RIGHT_TIPS = 2000;
/** Forks that carry fewer growing tips than this are twigs, whose shares the rule does not read. */
export const RIGHT_FORK = 10;
/** The most degrees a side shoot turns toward its parent's line in a year. */
export const RIGHT_TURN = 12;
/**
 * A side shoot divides its fork with its parent's own line where that line goes on with at least
 * this share of the fork's wood: the shoot is righted no closer to the line than the split's angle.
 */
export const SPLIT_SHARE = 0.3;
/** Degrees from its parent's line that a shoot dividing a fork with that line keeps at least. */
export const SPLIT_ANGLE = 30;
