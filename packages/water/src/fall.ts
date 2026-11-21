// The waterfall's column: the path that falling water takes from a river's lip, and the mesh around
// it. Water leaves the lip level with the river, carried out at the current's speed, and falls under
// gravity while the air slows it toward a steady speed. So the column curves over at the lip and then
// drops almost straight; it draws in a little below the lip, its sides wander, and it widens as it
// falls. Its section is an ellipse: as wide as the water, thin at the lip and as deep as the creek is
// wide a few meters down, so it reads as a solid column from the side as well as from the front. A short apron lies on the river's surface upstream of the
// lip, so the fall starts on the water rather than at the river mesh's edge. The texture coordinates
// carry each point's place across the lip and how long its water has fallen, which the material
// reads to move its streaks with the water. The fall's particle emitters stand along the same path.
import type { MeshArrays } from '@null3d/engine';

/** Gravity, in meters a second squared. */
export const GRAVITY = 9.81;
/** The steady speed that the air slows falling water toward, in meters a second. */
export const FALL_SPEED = 15;
/** How long the air takes to slow the water's sideways motion, and to bring its fall near the steady speed. */
const DRAG_TIME = FALL_SPEED / GRAVITY;
/** How far upstream of the lip the fall's apron reaches when a fall gives none, in meters. */
export const APRON = 1;
/** How far above the river's surface the apron lies, so the river's ripples stay under it, in meters. */
export const APRON_LIFT = 0.02;
/** The rows of the apron, from its upstream end to the lip. */
const APRON_ROWS = 4;
/** The sections round the column, and its rows from the lip to the foot, when a fall gives none. */
const ACROSS = 24;
const DOWN = 40;
/**
 * How the rows bunch toward the lip: the time at a row is the fall's time times the row's share to
 * this power. Above 1 puts more rows where the sheet curves over.
 */
const ROW_BUNCHING = 1.5;

/**
 * How fine a waterfall's mesh is.
 *
 * @category api/water
 */
export interface WaterfallMesh {
	/** The sections round the column. It is 24 by default. */
	across?: number;
	/** The rows from the lip to the foot of the fall. It is 40 by default. */
	down?: number;
}

/** The shape of a fall's sheet, which `fallSheet` builds the mesh from. */
export interface FallSheet {
	/** The middle of the lip, as [x, z] in meters. */
	readonly lip: readonly [x: number, z: number];
	/** The way the water runs over the lip, as a unit vector [x, z]. */
	readonly direction: readonly [x: number, z: number];
	/** Half the river's width at the lip, in meters. */
	readonly halfWidth: number;
	/** The height of the water's surface at the lip, in meters. */
	readonly level: number;
	/** The current's speed at the middle of the lip, in meters a second. */
	readonly speed: number;
	/** How far the fall drops below the lip, in meters. */
	readonly drop: number;
	/** How far each side of the sheet widens for each meter that the water falls. */
	readonly spread: number;
	/** How far upstream of the lip the apron reaches over the river's surface, in meters. */
	readonly apron?: number;
	/** The mesh's detail. */
	readonly mesh?: WaterfallMesh;
}

/**
 * Where the water is `t` seconds after it leaves the lip at `speed`: how far it has moved out from
 * the lip, and how far it has fallen below the lip. Before the lip, at a negative time, it runs on
 * the river's surface at the current's speed. Both figures are in meters, written into `out`.
 */
export function fallPlace(t: number, speed: number, out: [forward: number, fallen: number]): void {
	if (t <= 0) {
		out[0] = speed * t;
		out[1] = 0;
		return;
	}
	const x = t / DRAG_TIME;
	// The air slows the sideways motion, so the water moves out no further than its speed times
	// the drag's time.
	out[0] = speed * DRAG_TIME * (1 - Math.exp(-x));
	// The fall's speed nears the steady speed as a hyperbolic tangent, and the distance fallen is
	// its integral, the log of a hyperbolic cosine, in a form that stays exact for long falls.
	out[1] = FALL_SPEED * DRAG_TIME * (x + Math.log1p(Math.exp(-2 * x)) - Math.LN2);
}

/** The seconds that the water takes to fall `drop` meters below the lip. */
export function fallTime(drop: number): number {
	if (drop <= 0) return 0;
	const a = drop / (FALL_SPEED * DRAG_TIME);
	// The inverse of the distance fallen: the inverse hyperbolic cosine of e to the power `a`.
	return DRAG_TIME * (a + Math.log1p(Math.sqrt(1 - Math.exp(-2 * a))));
}

/** An error of the water add-on's own. */
function error(message: string): Error {
	const error = new Error(`@null3d/water: ${message}`);
	error.name = 'WaterError';
	return error;
}

/** Checks a fall's numbers, and names the first one that a sheet cannot take. */
export function checkFallSheet(sheet: FallSheet): void {
	const finite = (value: number, what: string) => {
		if (typeof value !== 'number' || !Number.isFinite(value))
			throw error(`a waterfall's ${what} must be a finite number`);
	};
	finite(sheet.lip[0], 'lip x');
	finite(sheet.lip[1], 'lip z');
	finite(sheet.direction[0], 'direction x');
	finite(sheet.direction[1], 'direction z');
	if (Math.hypot(sheet.direction[0], sheet.direction[1]) < 1e-6)
		throw error("a waterfall's direction must not be zero");
	finite(sheet.halfWidth, 'half width');
	if (sheet.halfWidth <= 0) throw error("a waterfall's half width must be above 0");
	finite(sheet.level, 'level');
	finite(sheet.speed, 'speed');
	if (sheet.speed <= 0) throw error("a waterfall's speed must be above 0");
	finite(sheet.drop, 'drop');
	if (sheet.drop <= 0) throw error("a waterfall's drop must be above 0");
	finite(sheet.spread, 'spread');
	if (sheet.spread < 0) throw error("a waterfall's spread must be 0 or more");
	finite(sheet.apron ?? APRON, 'apron');
	if ((sheet.apron ?? APRON) <= 0) throw error("a waterfall's apron must be above 0");
	for (const [value, what] of [
		[sheet.mesh?.across ?? ACROSS, 'sections across'],
		[sheet.mesh?.down ?? DOWN, 'rows down'],
	] as const)
		if (!Number.isInteger(value) || value < 1)
			throw error(`a waterfall's ${what} must be a whole number from 1`);
}

/**
 * How deep the column grows below the lip, as a share of the lip's half width each side of its
 * middle: about as deep as the drawn-in water is wide, so the falling water is a round bundle.
 */
export const COLUMN_DEPTH = 0.35;
/** How thick the water is as it leaves the lip, each side of the column's middle, in meters. */
export const TONGUE = 0.12;
/** The most that the brink stands out past the lip's line at some places across, in meters. */
export const BRINK = 0.35;

/**
 * How far past the lip's line the water leaves the flat at a place across the lip, from -1 at one
 * end to 1 at the other: an uneven brink from 0 to `BRINK`, so the edge where the water turns down
 * is not a ruler line. It writes the distance and its rate across into `out`.
 */
export function brinkAt(across: number, out: [shift: number, slope: number]): void {
	out[0] = BRINK * (0.5 + 0.3 * Math.sin(5.1 * across + 0.7) + 0.2 * Math.sin(11.3 * across + 2.1));
	out[1] =
		BRINK * (0.3 * 5.1 * Math.cos(5.1 * across + 0.7) + 0.2 * 11.3 * Math.cos(11.3 * across + 2.1));
}

/** The share of the lip's width that the falling water draws in over its first meters. */
export const NARROW = 0.7;
/** The meters that the water falls before it has drawn in most of that share, as a scale. */
const NARROW_GROWTH = 1;
/** How far each side of the column wanders in and out as it falls, as a share of the lip's width. */
export const WOBBLE = 0.1;

/**
 * Half the falling water's width after it has fallen `fallen` meters, leaving out the sides' wander:
 * the lip's half width, drawn in over the first meters and widened by the spread.
 */
export function drawnHalf(halfWidth: number, spread: number, fallen: number): number {
	const f = Math.max(fallen, 0);
	return halfWidth * (1 - NARROW * (1 - Math.exp(-f / NARROW_GROWTH))) + spread * f;
}

/**
 * Half the column's width on one side, after the water has fallen `fallen` meters, and its rate
 * for each meter fallen: the lip's half width drawn in to under a third over the first meters,
 * each side wandering in and out on its own as it falls, then widened by the spread. `side` is 1
 * for the water's right and -1 for its left.
 */
export function sideAt(
	halfWidth: number,
	spread: number,
	fallen: number,
	side: number,
	out: [half: number, rate: number],
): void {
	const f = Math.max(fallen, 0);
	const drawn = Math.exp(-f / NARROW_GROWTH);
	const phase = side > 0 ? 2.1 : 0;
	const wander = Math.sin(0.9 * f + phase) + 0.5 * Math.sin(2.3 * f + 2 * phase);
	const dWander = 0.9 * Math.cos(0.9 * f + phase) + 1.15 * Math.cos(2.3 * f + 2 * phase);
	const grown = 1 - Math.exp(-f / 2);
	out[0] = drawnHalf(halfWidth, spread, f) + halfWidth * WOBBLE * wander * grown;
	out[1] =
		halfWidth *
			((-NARROW * drawn) / NARROW_GROWTH +
				WOBBLE * (dWander * grown + (wander * Math.exp(-f / 2)) / 2)) +
		spread;
}

/** The meters that the water falls before the column reaches most of its depth, as a scale. */
const DEPTH_GROWTH = 1.5;

/**
 * Half the column's depth, out from the wall, after the water has fallen `fallen` meters: the
 * tongue's thickness at the lip, growing to `COLUMN_DEPTH` times the lip's half width a few meters
 * down, and nothing upstream of the lip.
 */
export function columnDepth(halfWidth: number, fallen: number): number {
	if (fallen <= 0) return 0;
	const grown = 1 - Math.exp(-fallen / DEPTH_GROWTH);
	return TONGUE + (COLUMN_DEPTH * halfWidth - TONGUE) * grown;
}

/** The rate at which the column's half depth grows for each meter that the water falls. */
function columnDepthSlope(halfWidth: number, fallen: number): number {
	if (fallen <= 0) return 0;
	return ((COLUMN_DEPTH * halfWidth - TONGUE) * Math.exp(-fallen / DEPTH_GROWTH)) / DEPTH_GROWTH;
}

/**
 * The mesh of a fall's column, in world space. Its rows run from the apron's upstream end, over the
 * lip, to the foot of the fall, bunched where the column curves over, and its sections run round the
 * column's section: an ellipse whose back follows the path of the falling water and whose front
 * stands out from it by the column's depth, each place across shifted out by the uneven brink. The first texture coordinate holds each point's place
 * across the lip in meters and the seconds since its water left the lip, negative on the apron. The
 * second holds the place round the section, from 0 at the front to 1 back at the front, and the
 * meters that the water has fallen. The front faces look out from the column's middle.
 */
export function fallSheet(sheet: FallSheet): MeshArrays {
	checkFallSheet(sheet);
	const around = sheet.mesh?.across ?? ACROSS;
	const down = sheet.mesh?.down ?? DOWN;
	const length = Math.hypot(sheet.direction[0], sheet.direction[1]);
	const dx = sheet.direction[0] / length;
	const dz = sheet.direction[1] / length;
	// Across the lip, to the water's right: with the flow and up, it makes front faces that look out.
	const rx = -dz;
	const rz = dx;
	const { halfWidth, spread, level, speed } = sheet;
	const apron = sheet.apron ?? APRON;
	const end = fallTime(sheet.drop);
	const rows = APRON_ROWS + down + 1;
	const columns = around + 1;
	const count = rows * columns;
	const positions = new Float32Array(count * 3);
	const normals = new Float32Array(count * 3);
	const uvs = new Float32Array(count * 2);
	const uvs1 = new Float32Array(count * 2);
	const indices = new Uint32Array((rows - 1) * around * 6);
	const place: [number, number] = [0, 0];
	const brink: [number, number] = [0, 0];
	const right: [number, number] = [0, 0];
	const left: [number, number] = [0, 0];
	let v = 0;
	for (let row = 0; row < rows; row++) {
		// The apron's rows run up to the lip at even steps of time, and the fall's rows after it.
		const t =
			row < APRON_ROWS
				? (-(APRON_ROWS - row) / APRON_ROWS) * (apron / speed)
				: end * ((row - APRON_ROWS) / down) ** ROW_BUNCHING;
		const falling = t > 0;
		fallPlace(t, speed, place);
		const forward = place[0];
		const fallen = place[1];
		// The path's speeds out from the lip and down, which the tangent down the column reads.
		const out = falling ? speed * Math.exp(-t / DRAG_TIME) : speed;
		const fallSpeed = falling ? FALL_SPEED * Math.tanh(t / DRAG_TIME) : 0;
		sideAt(halfWidth, spread, fallen, 1, right);
		sideAt(halfWidth, spread, fallen, -1, left);
		const depth = columnDepth(halfWidth, fallen);
		const deepen = columnDepthSlope(halfWidth, fallen) * fallSpeed;
		for (let column = 0; column < columns; column++, v++) {
			const share = column / around;
			const angle = share * Math.PI * 2;
			const c = Math.cos(angle);
			const sn = Math.sin(angle);
			// The section's middle stands out from the path by its half depth, so the back follows the
			// path and the front stands a full depth out. Each place across shifts by the brink's
			// unevenness there, front and back alike, so the column keeps its depth.
			brinkAt(sn, brink);
			// Each side of the column has its own width as it falls.
			const half = sn >= 0 ? right[0] : left[0];
			const widen = (sn >= 0 ? right[1] : left[1]) * fallSpeed;
			const outward = forward + depth * (1 + c) + brink[0];
			positions[v * 3] = sheet.lip[0] + dx * outward + rx * half * sn;
			positions[v * 3 + 1] = level + APRON_LIFT - fallen;
			positions[v * 3 + 2] = sheet.lip[1] + dz * outward + rz * half * sn;
			// The tangent round the section and the tangent down the column; their cross product is
			// the normal that looks out from the column's middle.
			const ra = -depth * sn + brink[1] * c;
			const ax = dx * ra + rx * half * c;
			const az = dz * ra + rz * half * c;
			const along = out + deepen * (1 + c);
			const bx = dx * along + rx * widen * sn;
			const by = -fallSpeed;
			const bz = dz * along + rz * widen * sn;
			let nx = -az * by;
			let ny = az * bx - ax * bz;
			let nz = ax * by;
			// On the apron the section is flat, so the normal looks up.
			if (!falling) {
				nx = 0;
				ny = 1;
				nz = 0;
			}
			const norm = Math.hypot(nx, ny, nz) || 1;
			normals[v * 3] = nx / norm;
			normals[v * 3 + 1] = ny / norm;
			normals[v * 3 + 2] = nz / norm;
			uvs[v * 2] = sn * halfWidth;
			uvs[v * 2 + 1] = t;
			uvs1[v * 2] = share;
			uvs1[v * 2 + 1] = fallen;
		}
	}
	let k = 0;
	for (let row = 0; row + 1 < rows; row++)
		for (let column = 0; column < around; column++) {
			const a = row * columns + column;
			const b = a + 1;
			const c = a + columns;
			const d = c + 1;
			// Round, then down: the cross product of the two edges looks out.
			indices[k++] = a;
			indices[k++] = b;
			indices[k++] = c;
			indices[k++] = b;
			indices[k++] = d;
			indices[k++] = c;
		}
	return { positions, normals, uvs, uvs1, indices };
}

/**
 * The kinds of a fall's particle emitters: the froth over the brink, the spray that falls inside the
 * column with the water, the mist that the fall bursts into, and the plume at its foot.
 */
export type FallEmitterKind = 'froth' | 'drops' | 'mist' | 'plume';

/**
 * One of a fall's particle emitters: where it stands, how it turns, the box that it emits in, and
 * the puffs that it makes each second at a spray of 1.
 */
export interface FallEmitter {
	readonly kind: FallEmitterKind;
	/** The emitter's place in the world, in meters. */
	readonly position: readonly [x: number, y: number, z: number];
	/**
	 * The emitter's turn about the vertical axis, in radians. It takes the emitter's +z to the way
	 * the water runs and its x across the lip, so its box lies across the fall.
	 */
	readonly turn: number;
	/** The box that the emitter fills, across the lip, up, and out from the cliff, in meters. */
	readonly box: readonly [x: number, y: number, z: number];
	/** The puffs that the emitter makes each second at a spray of 1. */
	readonly rate: number;
	/** Half the water's width where the emitter stands, in meters, which sizes its puffs. */
	readonly halfWidth: number;
}

/** How far down the drop the mist that the fall dissolves into gathers, as a share of the drop. */
export const MIST_DEPTH = 0.85;
/** How many times the fall's width the mist's cloud spreads over, gathered about the fall. */
export const MIST_WIDTH = 4;
/**
 * The mist's billows born each second for each square of a billow's width in the face of the mist's
 * box: enough that many billows overlap at any place, so the mist reads as one even cloud.
 */
export const MIST_DENSITY = 15;

/**
 * The mean width of the billows of a fall's mist, in meters: twice the lip's width, and no more
 * than about a third of the drop, so a short fall's mist never reaches up to its lip.
 */
export function mistBillow(sheet: FallSheet): number {
	return Math.min(4 * sheet.halfWidth, 0.3 * sheet.drop);
}

/**
 * The fall's four particle emitters. The froth stands just past the brink, across the lip's width.
 * The drops leave the column's surface over the upper two thirds of the drop, from a box a little
 * wider and deeper than the column. The mist gathers about the column's foot, over the drop's
 * lowest third and four times as wide as the water there. The plume
 * stands at the foot, past the end of the path. Each turns with the lip, and each makes puffs
 * in step with the water's width and its drop.
 */
export function fallEmitters(sheet: FallSheet): FallEmitter[] {
	checkFallSheet(sheet);
	const length = Math.hypot(sheet.direction[0], sheet.direction[1]);
	const dx = sheet.direction[0] / length;
	const dz = sheet.direction[1] / length;
	const turn = Math.atan2(dx, dz);
	const place: [number, number] = [0, 0];
	const at = (forward: number, height: number): [number, number, number] => [
		sheet.lip[0] + dx * forward,
		sheet.level + height,
		sheet.lip[1] + dz * forward,
	];
	const halfAt = (fallen: number) => drawnHalf(sheet.halfWidth, sheet.spread, fallen);
	const middle = sheet.drop * MIST_DEPTH;
	fallPlace(fallTime(middle), sheet.speed, place);
	const mistOut = place[0];
	const mistHalf = halfAt(middle);
	fallPlace(fallTime(sheet.drop), sheet.speed, place);
	const footOut = place[0];
	const footHalf = halfAt(sheet.drop);
	// The drops thrown off the column: across the water's width and through the column's depth and
	// a little past them, over the upper two thirds of the drop.
	const upper = sheet.drop * 0.35;
	fallPlace(fallTime(upper), sheet.speed, place);
	const bodyOut = place[0];
	const bodyHalf = halfAt(upper);
	const bodyDepth = columnDepth(sheet.halfWidth, upper);
	const mistDepth = columnDepth(sheet.halfWidth, middle);
	const mistBox: [number, number, number] = [
		mistHalf * 2 * MIST_WIDTH,
		sheet.drop * 0.4,
		2 * mistDepth + 3,
	];
	const billow = mistBillow(sheet);
	return [
		{
			kind: 'froth',
			position: at(0.25, -0.1),
			turn,
			box: [sheet.halfWidth * 1.9, 0.25, 0.5],
			rate: 15 * sheet.halfWidth,
			halfWidth: sheet.halfWidth,
		},
		{
			kind: 'drops',
			position: at(bodyOut + bodyDepth, -upper),
			turn,
			box: [bodyHalf * 2.2, sheet.drop * 0.6, 2 * bodyDepth + 1.2],
			rate: 90 * sheet.halfWidth * Math.max(1, sheet.drop / 10),
			halfWidth: sheet.halfWidth,
		},
		{
			kind: 'mist',
			// About the column's middle, a little deeper than it, gathered over the lower drop.
			position: at(mistOut + mistDepth, -middle),
			turn,
			box: mistBox,
			rate: (MIST_DENSITY * mistBox[0] * mistBox[1]) / (billow * billow),
			halfWidth: mistHalf,
		},
		{
			kind: 'plume',
			position: at(footOut + 0.5, -sheet.drop * 0.92),
			turn,
			box: [footHalf * 2.8, sheet.drop * 0.2, 3],
			rate: 1.1 * footHalf,
			halfWidth: footHalf,
		},
	];
}
