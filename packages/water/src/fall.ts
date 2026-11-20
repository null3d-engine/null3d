// The waterfall's column: the path that falling water takes from a river's lip, and the mesh around
// it. Water leaves the lip level with the river, carried out at the current's speed, and falls under
// gravity while the air slows it toward a steady speed. So the column curves over at the lip and then
// drops almost straight, and it widens as it falls. Its section is an ellipse: as wide as the water,
// thin at the lip and as deep as the creek is wide a few meters down, so it reads as a solid column
// from the side as well as from the front. A short apron lies on the river's surface upstream of the
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
/** How far upstream of the lip the sheet's apron reaches, in meters. */
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
	for (const [value, what] of [
		[sheet.mesh?.across ?? ACROSS, 'sections across'],
		[sheet.mesh?.down ?? DOWN, 'rows down'],
	] as const)
		if (!Number.isInteger(value) || value < 1)
			throw error(`a waterfall's ${what} must be a whole number from 1`);
}

/** How deep the column grows below the lip, as a share of the lip's half width each side of its middle. */
export const COLUMN_DEPTH = 0.8;
/** How thick the water is as it leaves the lip, each side of the column's middle, in meters. */
export const TONGUE = 0.12;
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
 * stands out from it by the column's depth. The first texture coordinate holds each point's place
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
	let v = 0;
	for (let row = 0; row < rows; row++) {
		// The apron's rows run up to the lip at even steps of time, and the fall's rows after it.
		const t =
			row < APRON_ROWS
				? (-(APRON_ROWS - row) / APRON_ROWS) * (APRON / speed)
				: end * ((row - APRON_ROWS) / down) ** ROW_BUNCHING;
		const falling = t > 0;
		fallPlace(t, speed, place);
		const forward = place[0];
		const fallen = place[1];
		// The path's speeds out from the lip and down, which the tangent down the column reads.
		const out = falling ? speed * Math.exp(-t / DRAG_TIME) : speed;
		const fallSpeed = falling ? FALL_SPEED * Math.tanh(t / DRAG_TIME) : 0;
		const half = halfWidth + spread * fallen;
		const depth = columnDepth(halfWidth, fallen);
		const widen = spread * fallSpeed;
		const deepen = columnDepthSlope(halfWidth, fallen) * fallSpeed;
		for (let column = 0; column < columns; column++, v++) {
			const share = column / around;
			const angle = share * Math.PI * 2;
			const c = Math.cos(angle);
			const sn = Math.sin(angle);
			// The section's middle stands out from the path by its half depth, so the back follows the
			// path and the front stands a full depth out.
			const outward = forward + depth * (1 + c);
			positions[v * 3] = sheet.lip[0] + dx * outward + rx * half * sn;
			positions[v * 3 + 1] = level + APRON_LIFT - fallen;
			positions[v * 3 + 2] = sheet.lip[1] + dz * outward + rz * half * sn;
			// The tangent round the section and the tangent down the column; their cross product is
			// the normal that looks out from the column's middle.
			const ra = -depth * sn;
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
export type FallEmitterKind = 'froth' | 'body' | 'mist' | 'plume';

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

/** How far down the drop the mist that the fall bursts into gathers, as a share of the drop. */
export const MIST_DEPTH = 0.72;
/** How many times the fall's width the mist's cloud spreads over, gathered about the fall. */
export const MIST_WIDTH = 1.2;

/**
 * The fall's four particle emitters. The froth stands just past the brink, across the lip's width.
 * The body's spray falls inside the column, over the upper two thirds of the drop. The mist gathers
 * about the column nearly three quarters of the way down, a little wider than the fall there and
 * over the lower half of the drop. The
 * plume stands at the foot, past the end of the path. Each turns with the lip, and each makes puffs
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
	const halfAt = (fallen: number) => sheet.halfWidth + sheet.spread * fallen;
	const middle = sheet.drop * MIST_DEPTH;
	fallPlace(fallTime(middle), sheet.speed, place);
	const mistOut = place[0];
	const mistHalf = halfAt(middle);
	fallPlace(fallTime(sheet.drop), sheet.speed, place);
	const footOut = place[0];
	const footHalf = halfAt(sheet.drop);
	// The spray inside the column: across the water's width and through the column's depth, over
	// the upper two thirds of the drop.
	const upper = sheet.drop * 0.35;
	fallPlace(fallTime(upper), sheet.speed, place);
	const bodyOut = place[0];
	const bodyHalf = halfAt(upper);
	const bodyDepth = columnDepth(sheet.halfWidth, upper);
	const mistDepth = columnDepth(sheet.halfWidth, middle);
	return [
		{
			kind: 'froth',
			position: at(0.25, -0.1),
			turn,
			box: [sheet.halfWidth * 1.9, 0.25, 0.5],
			rate: 6 * sheet.halfWidth,
			halfWidth: sheet.halfWidth,
		},
		{
			kind: 'body',
			position: at(bodyOut + bodyDepth, -upper),
			turn,
			box: [bodyHalf * 1.6, sheet.drop * 0.6, 2 * bodyDepth + 0.6],
			rate: 5 * sheet.halfWidth * Math.max(1, sheet.drop / 6),
			halfWidth: sheet.halfWidth,
		},
		{
			kind: 'mist',
			// About the column's middle, a little deeper than it, gathered over the lower drop.
			position: at(mistOut + mistDepth, -middle),
			turn,
			box: [mistHalf * 2 * MIST_WIDTH, sheet.drop * 0.5, 2 * mistDepth + 3],
			rate: 2.2 * mistHalf * Math.max(1, sheet.drop / 6),
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
