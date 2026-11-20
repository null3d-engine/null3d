// The waterfall's sheet: the path that falling water takes from a river's lip, and the mesh along
// it. Water leaves the lip level with the river, carried out at the current's speed, and falls under
// gravity while the air slows it toward a steady speed. So the sheet curves over at the lip and then
// drops almost straight, and it widens as it falls. A short apron lies on the river's surface
// upstream of the lip, so the fall starts on the water rather than at the river mesh's edge. The
// texture coordinates carry each point's place across the lip and how long its water has fallen,
// which the material reads to move its streaks with the water.
import type { MeshArrays } from '@null3d/engine';

/** Gravity, in meters a second squared. */
export const GRAVITY = 9.81;
/** The steady speed that the air slows falling water toward, in meters a second. */
export const FALL_SPEED = 15;
/** How long the air takes to slow the water's sideways motion, and to bring its fall near the steady speed. */
const DRAG_TIME = FALL_SPEED / GRAVITY;
/** The share of the lip's speed that the water loses at the lip's ends, against its middle. */
export const SIDE_SLOWING = 0.3;
/** How far upstream of the lip the sheet's apron reaches, in meters. */
export const APRON = 1;
/** How far above the river's surface the apron lies, so the river's ripples stay under it, in meters. */
export const APRON_LIFT = 0.02;
/** The rows of the apron, from its upstream end to the lip. */
const APRON_ROWS = 4;
/** The sections across the sheet, and its rows from the lip to the foot, when a fall gives none. */
const ACROSS = 16;
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
	/** The sections across the sheet. It is 16 by default. */
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

/** The current's speed across the lip, from the middle at `across` 0 to its ends at 1 and -1. */
function speedAcross(speed: number, across: number): number {
	return speed * (1 - SIDE_SLOWING * across * across);
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

/**
 * The veils that give the fall its depth, from the back one to the front one. Each takes a share of
 * the lip's speed, so it falls on its own path, and a share of the lip's width. The back veil starts
 * at the lip and lies behind the sheet. The sheet carries the apron over the lip. The spray veil is
 * thrown furthest and spreads widest: a soft halo of spray around the sheet, which the material
 * draws thin and feathered.
 */
export const VEILS = [
	{ speed: 0.7, width: 0.88, apron: false },
	{ speed: 1, width: 1, apron: true },
	{ speed: 1.3, width: 1.3, apron: false },
] as const;

/** The veil that carries the apron: the sheet itself. */
export const SHEET_VEIL = 1;

/**
 * The second texture coordinate's room for each veil: a veil's place across runs from twice its
 * index to that plus one, so the shader reads the veil and the place from one number, and no
 * triangle mixes two veils.
 */
export const VEIL_ROOM = 2;

/**
 * The mesh of a fall's sheet, in world space: one strip for each veil. A strip's rows run from the
 * apron's upstream end, over the lip, to the foot of the fall, bunched where the sheet curves over,
 * and its sections run across the lip. The first texture coordinate holds each point's place across
 * the lip in meters and the seconds since its water left the lip, negative on the apron. The second
 * holds the veil and the place across it, as `VEIL_ROOM` times the veil plus a share from 0 to 1, and
 * the meters that the water has fallen. The front faces look out, away from the cliff that the water
 * leaves, and the back veil comes first, so it draws first.
 */
export function fallSheet(sheet: FallSheet): MeshArrays {
	checkFallSheet(sheet);
	const across = sheet.mesh?.across ?? ACROSS;
	const down = sheet.mesh?.down ?? DOWN;
	const length = Math.hypot(sheet.direction[0], sheet.direction[1]);
	const dx = sheet.direction[0] / length;
	const dz = sheet.direction[1] / length;
	// Across the lip, to the water's left: with the flow and up, it makes front faces that look out.
	const rx = -dz;
	const rz = dx;
	const { halfWidth, spread, level } = sheet;
	const end = fallTime(sheet.drop);
	const columns = across + 1;
	const strips = VEILS.map((veil) => (veil.apron ? APRON_ROWS : 0) + down + 1);
	const count = strips.reduce((sum, rows) => sum + rows, 0) * columns;
	const positions = new Float32Array(count * 3);
	const normals = new Float32Array(count * 3);
	const uvs = new Float32Array(count * 2);
	const uvs1 = new Float32Array(count * 2);
	const indices = new Uint32Array(strips.reduce((sum, rows) => sum + (rows - 1), 0) * across * 6);
	const place: [number, number] = [0, 0];
	let v = 0;
	let k = 0;
	for (let index = 0; index < VEILS.length; index++) {
		const veil = VEILS[index] as (typeof VEILS)[number];
		const speed = sheet.speed * veil.speed;
		const apron = veil.apron ? APRON_ROWS : 0;
		const rows = strips[index] as number;
		const first = v;
		for (let row = 0; row < rows; row++) {
			// The apron's rows run up to the lip at even steps of time, and the fall's rows after it.
			const t =
				row < apron
					? (-(apron - row) / apron) * (APRON / sheet.speed)
					: end * ((row - apron) / down) ** ROW_BUNCHING;
			const falling = t > 0;
			const decay = falling ? Math.exp(-t / DRAG_TIME) : 1;
			const fallSpeed = falling ? FALL_SPEED * Math.tanh(t / DRAG_TIME) : 0;
			for (let column = 0; column < columns; column++, v++) {
				const u = (column / across) * 2 - 1;
				const own = speedAcross(speed, u);
				fallPlace(t, own, place);
				const forward = place[0];
				const fallen = place[1];
				const half = (halfWidth + spread * fallen) * veil.width;
				positions[v * 3] = sheet.lip[0] + dx * forward + rx * u * half;
				positions[v * 3 + 1] = level + APRON_LIFT - fallen;
				positions[v * 3 + 2] = sheet.lip[1] + dz * forward + rz * u * half;
				// The tangent down the sheet, along the water's motion, and the tangent across it.
				// Their cross product is the normal that looks out.
				const out = own * decay;
				const widen = spread * veil.width * fallSpeed;
				const ax = dx * out + rx * u * widen;
				const ay = -fallSpeed;
				const az = dz * out + rz * u * widen;
				// Across the lip the middle runs further out than the ends, which bows the sheet.
				const bow = own > 0 ? (forward / own) * (-2 * SIDE_SLOWING * speed * u) : 0;
				const bx = rx * half + dx * bow;
				const bz = rz * half + dz * bow;
				const nx = -bz * ay;
				const ny = bz * ax - bx * az;
				const nz = bx * ay;
				const norm = Math.hypot(nx, ny, nz) || 1;
				normals[v * 3] = nx / norm;
				normals[v * 3 + 1] = ny / norm;
				normals[v * 3 + 2] = nz / norm;
				uvs[v * 2] = u * halfWidth;
				uvs[v * 2 + 1] = t;
				uvs1[v * 2] = VEIL_ROOM * index + (u + 1) * 0.5;
				uvs1[v * 2 + 1] = fallen;
			}
		}
		for (let row = 0; row + 1 < rows; row++)
			for (let column = 0; column < across; column++) {
				const a = first + row * columns + column;
				const b = a + 1;
				const c = a + columns;
				const d = c + 1;
				// Across, then down: the cross product of the two edges looks out.
				indices[k++] = a;
				indices[k++] = b;
				indices[k++] = c;
				indices[k++] = b;
				indices[k++] = d;
				indices[k++] = c;
			}
	}
	return { positions, normals, uvs, uvs1, indices };
}
