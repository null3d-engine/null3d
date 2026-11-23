// What the plan's places hold: the roads with their stone walls and driveways, the houses with their
// gardens, the church on its small round piazza with a stepped fountain and cafe tables, the harbour
// with its quay wall, moles, pontoons, breakwater and moored boats, the beach with its parasols, the
// golf course, the park, the hilltop keeps, the rocks of the coast and the street lamps. Each repeated
// thing is one mesh in an instance batch.
import {
	type InstanceBatch,
	type Object3D,
	quat,
	type SketchContext,
	type Texture,
} from '@null3d/engine';
import { type Part, standPart } from '../../lib/blender-models';
import { INTERIOR_LAYER } from '../../lib/layers';
import { Noise, random } from '../../lib/procedural';
import { FOUNTAIN_WATER, STAIR_HALF, WAY_HALF } from './ground';
import { type HouseLot, loadHouses, standHouse, standsByKind } from './houses';
import {
	BAY,
	formHeight,
	GOLF,
	HARBOUR,
	hypot,
	inland,
	QUAY_FROM,
	QUAY_TO,
	quayWallZ,
	sandWidth,
	TOWN,
	townShare,
} from './island';
import {
	awning,
	type Build,
	bareTable,
	bench,
	boulder,
	box,
	build,
	type Color,
	cafeTable,
	church,
	finish,
	fishingBoat,
	GARDEN_KINDS,
	HOUSE_KINDS,
	keep,
	lighthouse,
	palm,
	parasol,
	pavilion,
	planter,
	quad,
	ring,
	sailboat,
	shrub,
	streetLamp,
} from './kit';
import { loadLandmarks } from './landmarks';
import {
	bunkerSpots,
	CHURCH_AT,
	circleRadius,
	groundHeight,
	HOLES,
	inWater,
	KEEPS,
	LOTS,
	type Lot,
	ROADS,
	roadEdge,
	SQUARE,
	STAIR_APRONS,
	STAIR_WALKS,
	STAIRS,
	slopeAt,
	stairTreads,
	TERRACES,
	WALL_EDGE,
	wayOf,
} from './plan';
import {
	loadProps,
	loungerStands,
	type ModelStanding,
	type PropForm,
	replaceBatch,
	replaceWithForms,
	standsOf,
} from './props';
import { CLIMB, LANE, MAIN, PARKS, type Road, type RoadPoint, SIDE_LANE, STREET } from './routes';

/** How far a road's surface lies above the ground it cuts, in meters. */
/** How far past a road's edge a retaining wall stands, how far behind it the cut is read, and its limits. */
const WALL_BEHIND = 1.5;
/** The depth below the land's form at which a road's wall runs on past a road's mouth, in meters. */
const DEEP_ROAD = 5;
/** The most that a retaining wall's top may change from one stretch to the next, in meters. */
const WALL_STEP = 0.3;
const RETAINING_LEAST = 1.2;
const SHORTEST_RETAINING = 18;
/** The depth below the land's form at which a road's cut must have its wall, in meters. */
export const MOST_RETAINING = 4;
const ROAD_LIFT = 0.3;
/**
 * How far a road's flat shoulder reaches past its asphalt, in meters. It holds a car parked at the
 * kerb, whose wheels sit inside the body's edge, rather than leaving them over the falling verge.
 */
const ROAD_VERGE = 1.35;
/** How far along a road its flared mouth runs, and how far of that lies inside the road it meets, in meters. */
const MOUTH_RUN = 10;
const MOUTH_INSIDE = 4;
/** How far the golf course's turf and the square's paving lie above the ground. */
const DRAPE = 0.14;
/** The colors of the plastered walls: warm cream and ochre, pale rose, and a little white. */
const WALLS = [
	[0.92, 0.84, 0.68, 1],
	[0.9, 0.78, 0.58, 1],
	[0.93, 0.82, 0.7, 1],
	[0.88, 0.72, 0.58, 1],
	[0.94, 0.87, 0.76, 1],
	[0.9, 0.74, 0.64, 1],
	[0.97, 0.95, 0.9, 1],
] as const;
/** The tints of bare stone walls, on the stone's own map. */
const STONES = [
	[1, 1, 1, 1],
	[1, 0.96, 0.88, 1],
	[0.94, 0.9, 0.84, 1],
] as const;
/** The tints of the terracotta roofs, from brown through red to a pinkish fade, on the tiles' map. */
const ROOFS = [
	[1, 0.92, 0.86, 1],
	[0.9, 0.76, 0.68, 1],
	[0.8, 0.68, 0.62, 1],
	[1, 0.82, 0.72, 1],
	[0.86, 0.84, 0.82, 1],
	[0.72, 0.6, 0.54, 1],
	[0.98, 0.86, 0.84, 1],
] as const;

const noise = new Noise(29);

/** A square map from a function of a texel, which tiles, with a plain corner at its origin. */
function surfaceMap(
	{ textures }: SketchContext,
	size: number,
	texel: (u: number, v: number) => readonly [number, number, number],
	plain: readonly [number, number, number],
): Texture {
	const data = new Uint8Array(size * size * 4);
	for (let v = 0; v < size; v++)
		for (let u = 0; u < size; u++) {
			const at = (v * size + u) * 4;
			// The corners keep a plain texel, which the parts without a map of their own read.
			const corner = (u < 2 || u >= size - 2) && (v < 2 || v >= size - 2);
			const [r, g, b] = corner ? plain : texel(u / size, v / size);
			data[at] = r;
			data[at + 1] = g;
			data[at + 2] = b;
			data[at + 3] = 255;
		}
	return textures.fromData({
		width: size,
		height: size,
		data,
		colorSpace: 'srgb',
		wrap: 'repeat',
		mipmaps: true,
	});
}

/** The meters that one repeat of the square's fan paving covers, across and along. */
const FAN_PERIOD = 6.4;

/** Fan paving: rows of small stones in scallops that overlap like fish scales, with dark joints. */
function fanMap({ textures }: SketchContext): Texture {
	const size = 1024;
	const data = new Uint8Array(size * size * 4);
	const rows = 7;
	const fans = 2;
	for (let v = 0; v < size; v++)
		for (let u = 0; u < size; u++) {
			const [px, py] = [(u / size) * fans, (v / size) * fans * 2];
			// The fan that covers a place is the one nearest above it whose half disc reaches it.
			let [ring, turn, seed] = [0.5, 0, 0];
			for (let row = Math.floor(py) + 1; row >= Math.floor(py) - 2; row--) {
				const shift = row & 1 ? 0.5 : 0;
				const cx = Math.round(px - shift) + shift;
				const [dx, dy] = [(px - cx) * 2, py - row];
				const r = hypot(dx, dy);
				if (dy > 0 && r < 1.42) continue;
				if (r >= 1.42) continue;
				ring = (r / 1.42) * rows;
				turn = (Math.atan2(-dy, dx) / Math.PI) * (2 + Math.floor(ring) * 2.6);
				seed =
					(((Math.round(cx * 2) % (fans * 2)) + fans * 2) % (fans * 2)) * 53 +
					((row + 64) % 4) * 97;
				break;
			}
			const [fr, ft] = [ring % 1, ((turn % 1) + 1) % 1];
			const joint = Math.min(fr, 1 - fr) < 0.08 || Math.min(ft, 1 - ft) < 0.06 / (0.6 + ring * 0.4);
			const h = Math.imul(
				seed + Math.floor(ring) * 131 + Math.floor(turn + 64) * 17 + 1,
				2654435761,
			);
			const tone = 0.86 + ((((h ^ (h >>> 13)) >>> 0) % 1000) / 1000) * 0.28;
			const shade = joint ? 0.62 : tone;
			const at = (v * size + u) * 4;
			data[at] = Math.min(255, 182 * shade);
			data[at + 1] = Math.min(255, 164 * shade);
			data[at + 2] = Math.min(255, 136 * shade);
			data[at + 3] = 255;
		}
	return textures.fromData({
		width: size,
		height: size,
		data,
		colorSpace: 'srgb',
		wrap: 'repeat',
		mipmaps: true,
		anisotropy: 16,
	});
}

/** Plaster: a pale wall, stained in soft patches and finely grained. */
function plasterMap(ctx: SketchContext): Texture {
	return surfaceMap(
		ctx,
		256,
		(u, v) => {
			const stain = noise.fbm2(u * 6, v * 6, 4, 6) * 22;
			const grain = noise.value2(u * 96, v * 96, 96) * 6;
			const tone = Math.min(255, 238 + stain + grain);
			return [tone, tone * 0.99, tone * 0.97];
		},
		[255, 255, 255],
	);
}

/**
 * Rubble stone: rounded stones of many sizes and colors from cream to ochre, with wide dark joints.
 * Each texel finds the nearest two of a jittered set of stones, in a pattern that tiles.
 */
function rubbleMap(ctx: SketchContext): Texture {
	const next = random(71);
	const cells = 12;
	const stones = Array.from({ length: cells * cells }, () => ({
		x: next(),
		y: next(),
		tone: 0.84 + next() * 0.2,
		warm: next(),
		stretch: 0.75 + next() * 0.6,
	}));
	return surfaceMap(
		ctx,
		512,
		(u, v) => {
			let [first, second] = [9, 9];
			let found = stones[0] as (typeof stones)[number];
			const [cu, cv] = [Math.floor(u * cells), Math.floor(v * cells)];
			for (let i = -1; i <= 1; i++)
				for (let j = -1; j <= 1; j++) {
					const [ci, cj] = [(cu + i + cells) % cells, (cv + j + cells) % cells];
					const stone = stones[cj * cells + ci] as (typeof stones)[number];
					const dx = (cu + i + stone.x - u * cells) * stone.stretch;
					const dy = cv + j + stone.y - v * cells;
					const d = hypot(dx, dy);
					if (d < first) {
						second = first;
						first = d;
						found = stone;
					} else if (d < second) second = d;
				}
			const joint = 1 - Math.min(1, Math.max(0, (second - first - 0.05) / 0.16));
			const mottle = 1 + noise.fbm2(u * 28, v * 28, 3, 28) * 0.3;
			const tone = found.tone * mottle * (1 - joint * 0.22);
			const [r, g, b] = [214 + found.warm * 8, 198 + found.warm * 2, 172 - found.warm * 12];
			return [Math.min(255, r * tone), Math.min(255, g * tone), Math.min(255, b * tone)];
		},
		[255, 255, 255],
	);
}

/** Ashlar: coursed blocks of pale limestone, a little varied, with thin joints. */
function ashlarMap(ctx: SketchContext): Texture {
	const next = random(19);
	const [rows, cols] = [6, 3];
	const tones = Array.from({ length: rows * cols }, () => 0.9 + next() * 0.16);
	return surfaceMap(
		ctx,
		256,
		(u, v) => {
			const row = Math.floor(v * rows);
			const shifted = (u + ((row % 2) * 0.5) / cols + 1) % 1;
			const col = Math.floor(shifted * cols);
			const [fu, fv] = [shifted * cols - col, v * rows - row];
			const joint = Math.min(fu, 1 - fu) < 0.022 || Math.min(fv, 1 - fv) < 0.05;
			const mottle = 1 + noise.fbm2(u * 16, v * 16, 3, 16) * 0.14;
			const tone = (tones[row * cols + col] as number) * mottle * (joint ? 0.7 : 1);
			return [Math.min(255, 232 * tone), Math.min(255, 214 * tone), Math.min(255, 178 * tone)];
		},
		[255, 255, 255],
	);
}

/** Roof tiles: rows of round tiles in many fired tones, dark at the joints, with lichen's patches. */
function tileMap(ctx: SketchContext): Texture {
	const next = random(113);
	const [rows, cols] = [8, 8];
	const tones = Array.from({ length: rows * cols }, () => 0.72 + next() * 0.4);
	return surfaceMap(
		ctx,
		256,
		(u, v) => {
			const row = Math.floor(v * rows);
			const col = Math.floor(u * cols);
			const [fu, fv] = [u * cols - col, v * rows - row];
			const round = Math.sin(fu * Math.PI);
			const lap = 0.7 + 0.3 * Math.min(1, fv * 3.5);
			const tone = (tones[row * cols + col] as number) * (0.42 + 0.58 * round) * lap;
			const lichen = Math.max(0, noise.fbm2(u * 9, v * 9, 3, 9) + 0.06) * 1.3;
			const [r, g, b] = [204 - lichen * 90, 116 - lichen * 24, 78 - lichen * 4];
			return [Math.min(255, r * tone), Math.min(255, g * tone), Math.min(255, b * tone)];
		},
		[208, 124, 86],
	);
}

/** Adds a flat strip over the ground, from a line of points, with a color at each side. */
function strip(
	b: Build,
	line: readonly { x: number; y: number; z: number }[],
	half: number | ((k: number) => number),
	color: Color | ((k: number) => Color),
	lift: number | ((k: number) => number) = ROAD_LIFT,
	cross: (k: number) => number = () => 0,
): void {
	const first = b.positions.length / 3;
	line.forEach((p, k) => {
		const a = line[Math.max(0, k - 1)] ?? p;
		const c = line[Math.min(line.length - 1, k + 1)] ?? p;
		const length = hypot(c.x - a.x, c.z - a.z) || 1;
		const nx = -(c.z - a.z) / length;
		const nz = (c.x - a.x) / length;
		const width = typeof half === 'number' ? half : half(k);
		const tint = typeof color === 'function' ? color(k) : color;
		const raise = typeof lift === 'number' ? lift : lift(k);
		for (const side of [-1, 1]) {
			b.positions.push(
				p.x + nx * side * width,
				p.y + raise + cross(k) * side * width,
				p.z + nz * side * width,
			);
			b.colors.push(tint[0], tint[1], tint[2]);
			b.uvs.push(0, 0);
		}
		if (k + 1 < line.length) {
			const at = first + k * 2;
			b.indices.push(at, at + 1, at + 2, at + 1, at + 3, at + 2);
		}
	});
}

/**
 * A ribbon that lies on the ground across its width too, for turf, with a color along its length
 * and across it. `across` is the number of bands from one edge to the other, so mown stripes show.
 * The color takes a station's place along the line and the point's offset across it, from -1 to 1.
 */
function ribbon(
	b: Build,
	line: readonly { x: number; z: number }[],
	half: (k: number) => number,
	color: (k: number, t: number) => Color,
	lift: number,
	across = 4,
): void {
	const first = b.positions.length / 3;
	line.forEach((p, k) => {
		const a = line[Math.max(0, k - 1)] ?? p;
		const c = line[Math.min(line.length - 1, k + 1)] ?? p;
		const length = hypot(c.x - a.x, c.z - a.z) || 1;
		const [nx, nz] = [-(c.z - a.z) / length, (c.x - a.x) / length];
		for (let w = 0; w <= across; w++) {
			const t = (w / across) * 2 - 1;
			const off = t * half(k);
			const [x, z] = [p.x + nx * off, p.z + nz * off];
			const tint = color(k, t);
			b.positions.push(x, groundHeight(x, z) + lift, z);
			b.colors.push(tint[0], tint[1], tint[2]);
			b.uvs.push(0, 0);
		}
		if (k + 1 < line.length)
			for (let w = 0; w < across; w++) {
				const at = first + k * (across + 1) + w;
				b.indices.push(at, at + 1, at + across + 1, at + 1, at + across + 2, at + across + 1);
			}
	});
}

/** How far a road's middle stands over its edges, in meters, so its surface catches the light. */
const ROAD_CROWN = 0.06;

/**
 * Adds a road's asphalt as a row of three points at each station, with a shallow crown across it.
 * The color may vary across the width too, so the worn edges show, and a camera at its closest
 * range does not read the surface as one flat strip. The crown flattens where a road runs inside
 * the road that it meets, so no lip stands over the other road's surface.
 */
function crownStrip(
	b: Build,
	line: readonly { x: number; y: number; z: number }[],
	half: (k: number) => number,
	color: (k: number, t: number) => Color,
	lift: (k: number) => number,
	cross: (k: number) => number,
): void {
	const crown = (k: number) => (lift(k) === ROAD_LIFT ? ROAD_CROWN : 0);
	const first = b.positions.length / 3;
	line.forEach((p, k) => {
		const a = line[Math.max(0, k - 1)] ?? p;
		const c = line[Math.min(line.length - 1, k + 1)] ?? p;
		const length = hypot(c.x - a.x, c.z - a.z) || 1;
		const [nx, nz] = [-(c.z - a.z) / length, (c.x - a.x) / length];
		const width = half(k);
		const raise = lift(k);
		for (const t of [-1, 0, 1]) {
			const off = t * width;
			const tint = color(k, t);
			b.positions.push(
				p.x + nx * off,
				p.y + raise + cross(k) * off + crown(k) * (1 - t * t),
				p.z + nz * off,
			);
			b.colors.push(tint[0], tint[1], tint[2]);
			b.uvs.push(0, 0);
		}
		if (k + 1 < line.length) {
			const at = first + k * 3;
			b.indices.push(at, at + 1, at + 3, at + 1, at + 4, at + 3);
			b.indices.push(at + 1, at + 2, at + 4, at + 2, at + 5, at + 4);
		}
	});
}

/**
 * A filled disc over the ground, for a turning circle or a green, by its radius along each bearing.
 * Its color may vary by place, so a green takes its mown stripes.
 */
function patch(
	b: Build,
	cx: number,
	cz: number,
	radius: (bearing: number) => number,
	color: Color | ((x: number, z: number) => Color),
	lift: number,
	height: (x: number, z: number) => number = groundHeight,
	sides = 40,
	rings = 4,
): void {
	const first = b.positions.length / 3;
	for (let ring = 0; ring <= rings; ring++)
		for (let k = 0; k < sides; k++) {
			const a = (k / sides) * Math.PI * 2;
			const r = (radius(a) * ring) / rings;
			const x = cx + Math.cos(a) * r;
			const z = cz + Math.sin(a) * r;
			const tint = typeof color === 'function' ? color(x, z) : color;
			b.positions.push(x, height(x, z) + lift, z);
			b.colors.push(tint[0], tint[1], tint[2]);
			b.uvs.push(0, 0);
		}
	for (let ring = 0; ring < rings; ring++)
		for (let k = 0; k < sides; k++) {
			const n = (k + 1) % sides;
			const [a, c] = [first + ring * sides + k, first + ring * sides + n];
			const [d, e] = [a + sides, c + sides];
			b.indices.push(a, c, d, c, e, d);
		}
}

/** Adds one length of dry stone wall, with its top and its two faces from the ground up. */
function wallStretch(
	b: Build,
	a: { x: number; y: number; z: number },
	c: { x: number; y: number; z: number },
	high: number,
	color: Color,
	cHigh = high,
): void {
	const length = hypot(c.x - a.x, c.z - a.z) || 1;
	const [nx, nz] = [(-(c.z - a.z) / length) * 0.26, ((c.x - a.x) / length) * 0.26];
	const [a0, a1] = [a.y - 0.6, a.y + high];
	const [c0, c1] = [c.y - 0.6, c.y + cHigh];
	b.mapped = true;
	quad(
		b,
		[a.x + nx, a0, a.z + nz],
		[c.x + nx, c0, c.z + nz],
		[c.x + nx, c1, c.z + nz],
		[a.x + nx, a1, a.z + nz],
		color,
	);
	quad(
		b,
		[c.x - nx, c0, c.z - nz],
		[a.x - nx, a0, a.z - nz],
		[a.x - nx, a1, a.z - nz],
		[c.x - nx, c1, c.z - nz],
		color,
	);
	b.mapped = false;
	const cap: Color = [color[0] * 1.15, color[1] * 1.12, color[2] * 1.06];
	const [wx, wz] = [nx * 1.25, nz * 1.25];
	quad(
		b,
		[a.x + wx, a1 + 0.08, a.z + wz],
		[c.x + wx, c1 + 0.08, c.z + wz],
		[c.x - wx, c1 + 0.08, c.z - wz],
		[a.x - wx, a1 + 0.08, a.z - wz],
		cap,
	);
	quad(
		b,
		[a.x + wx, a1 - 0.02, a.z + wz],
		[c.x + wx, c1 - 0.02, c.z + wz],
		[c.x + wx, c1 + 0.08, c.z + wz],
		[a.x + wx, a1 + 0.08, a.z + wz],
		cap,
	);
	quad(
		b,
		[c.x - wx, c1 - 0.02, c.z - wz],
		[a.x - wx, a1 - 0.02, a.z - wz],
		[a.x - wx, a1 + 0.08, a.z - wz],
		[c.x - wx, c1 + 0.08, c.z - wz],
		cap,
	);
}

/** How far a retaining wall's foot runs under its road, so it meets ground that falls away. */
const RETAINING_FOOT = 3.5;

/** One unbroken run of retaining wall through its stations, with its face, its back and a stone cap. */
function retainingRun(
	b: Build,
	stations: readonly { x: number; y: number; z: number; high: number }[],
	color: Color,
): void {
	const cap: Color = [color[0] * 1.12, color[1] * 1.1, color[2] * 1.04];
	const across = stations.map((p, k) => {
		const a = stations[Math.max(0, k - 1)] ?? p;
		const c = stations[Math.min(stations.length - 1, k + 1)] ?? p;
		const length = hypot(c.x - a.x, c.z - a.z) || 1;
		return [(-(c.z - a.z) / length) * 0.3, ((c.x - a.x) / length) * 0.3] as const;
	});
	// The run's ends slope down into the ground, so it starts and stops with no cut face.
	const last = stations.length - 1;
	const buried = (p: (typeof stations)[0], k: number) =>
		k === 0 || k === last ? { ...p, high: -0.1 } : p;
	for (let k = 0; k + 1 < stations.length; k++) {
		const [p, q] = [
			buried(stations[k] as (typeof stations)[0], k),
			buried(stations[k + 1] as (typeof stations)[0], k + 1),
		];
		const [[ax, az], [cx, cz]] = [across[k], across[k + 1]] as [
			readonly [number, number],
			readonly [number, number],
		];
		const [p1, q1] = [p.y + p.high, q.y + q.high];
		b.mapped = true;
		for (const s of [1, -1]) {
			const [from, to] = s > 0 ? [p, q] : [q, p];
			const [fx, fz, tx, tz] = s > 0 ? [ax, az, cx, cz] : [cx, cz, ax, az];
			quad(
				b,
				[from.x + fx * s, from.y - RETAINING_FOOT, from.z + fz * s],
				[to.x + tx * s, to.y - RETAINING_FOOT, to.z + tz * s],
				[to.x + tx * s, to.y + to.high, to.z + tz * s],
				[from.x + fx * s, from.y + from.high, from.z + fz * s],
				color,
			);
		}
		b.mapped = false;
		quad(
			b,
			[p.x + ax * 1.2, p1 + 0.07, p.z + az * 1.2],
			[q.x + cx * 1.2, q1 + 0.07, q.z + cz * 1.2],
			[q.x - cx * 1.2, q1 + 0.07, q.z - cz * 1.2],
			[p.x - ax * 1.2, p1 + 0.07, p.z - az * 1.2],
			cap,
		);
	}
}

/** The roads as one mesh, worn and warm with a pale edge, and each house's graded drive. */
function roadMesh(): Build {
	const b = build();
	/** How a road's mouth tilts across its width to lie on the slope of the road it meets there. */
	const mouthSlope = (road: Road, end: RoadPoint, next: RoadPoint): number => {
		let [parent, at, least] = [undefined as Road | undefined, 0, 2];
		for (const other of ROADS) {
			if (other === road) continue;
			other.points.forEach((p, k) => {
				const d = hypot(p.x - end.x, p.z - end.z);
				if (d < least) [parent, at, least] = [other, k, d];
			});
		}
		if (!parent) return 0;
		const u = parent.points[Math.max(0, at - 1)] as RoadPoint;
		const v = parent.points[Math.min(parent.points.length - 1, at + 1)] as RoadPoint;
		const run = hypot(v.x - u.x, v.z - u.z) || 1;
		const [tx, tz] = [(v.x - u.x) / run, (v.z - u.z) / run];
		const length = hypot(next.x - end.x, next.z - end.z) || 1;
		const [nx, nz] = [-(next.z - end.z) / length, (next.x - end.x) / length];
		return ((v.y - u.y) / run) * (tx * nx + tz * nz);
	};
	for (const road of ROADS) {
		const { points, half, end } = road;
		const last = points.length - 1;
		// A hill road's edge is worn earth, and only the town's streets have a pale kerb.
		const dust: Color = half >= MAIN && half < 2.8 ? [0.42, 0.36, 0.27] : [0.27, 0.235, 0.18];
		const startSlope =
			end === 'loop' ? 0 : mouthSlope(road, points[0] as RoadPoint, points[1] as RoadPoint);
		// A far end's stretch runs the other way along the road, so its normal is the other way round.
		const endSlope =
			end === 'junction'
				? -mouthSlope(road, points[last] as RoadPoint, points[last - 1] as RoadPoint)
				: 0;
		const cross = (k: number) => {
			const [fromStart, fromEnd] = [k * 3, (last - k) * 3];
			return (
				startSlope * (1 - Math.min(1, fromStart / MOUTH_RUN)) ** 2 +
				endSlope * (1 - Math.min(1, fromEnd / MOUTH_RUN)) ** 2
			);
		};
		// A road widens into a short flared mouth where it meets another, as junctions are built.
		const flare = (k: number) => {
			const fromStart = k * 3;
			const fromEnd = (points.length - 1 - k) * 3;
			const reach = Math.min(fromStart, end === 'junction' ? fromEnd : 99);
			return 1 + 0.8 * (1 - Math.min(1, reach / MOUTH_RUN)) ** 2;
		};
		// Inside the road that it meets, a road's surface lies under that road's, so one surface shows.
		const under = (k: number) => {
			const fromEnd = (last - k) * 3;
			const inside = k * 3 < MOUTH_INSIDE || (end === 'junction' && fromEnd < MOUTH_INSIDE);
			return inside ? ROAD_LIFT - 0.04 : ROAD_LIFT;
		};
		// The surface goes a little lighter and darker along the way, as patched roads do. The main
		// road is the one strong line, and the lanes are paler and narrower.
		const tar = half >= CLIMB ? 0.1 : half >= LANE + 0.1 ? 0.12 : 0.13;
		// The asphalt carries a fine mottle of its own along the way, and its worn edges read paler
		// than its middle, so a road at eye level is not one flat colored strip.
		const tone = (k: number, t = 1): Color => {
			const p = points[k] as RoadPoint;
			const fine =
				1 +
				0.16 * noise.value2(p.x * 0.05, p.z * 0.05) +
				0.09 * noise.value2(p.x * 0.75 + 17, p.z * 0.75) +
				0.05 * noise.value2(p.x * 2.6 + 31, p.z * 2.6);
			const value = tar * Math.max(0.7, fine) * (Math.abs(t) < 0.5 ? 0.94 : 1.06);
			return [value * 1.08, value, value * 0.9];
		};
		strip(b, points, (k) => (half + ROAD_VERGE) * flare(k), dust, ROAD_LIFT - 0.05, cross);
		// The road's raised edge slopes down to the ground on each side.
		const first = b.positions.length / 3;
		points.forEach((p, k) => {
			const a = points[Math.max(0, k - 1)] as RoadPoint;
			const c = points[Math.min(points.length - 1, k + 1)] as RoadPoint;
			const length = hypot(c.x - a.x, c.z - a.z) || 1;
			const [nx, nz] = [-(c.z - a.z) / length, (c.x - a.x) / length];
			const inner = (half + ROAD_VERGE) * flare(k);
			for (const [off, lift] of [
				[-inner - 0.9, -0.15],
				[-inner, ROAD_LIFT - 0.05],
				[inner, ROAD_LIFT - 0.05],
				[inner + 0.9, -0.15],
			] as const) {
				b.positions.push(p.x + nx * off, p.y + lift + cross(k) * off, p.z + nz * off);
				b.colors.push(dust[0], dust[1], dust[2]);
				b.uvs.push(0, 0);
			}
			if (k + 1 < points.length) {
				const at = first + k * 4;
				b.indices.push(at, at + 1, at + 4, at + 1, at + 5, at + 4);
				b.indices.push(at + 2, at + 3, at + 6, at + 3, at + 7, at + 6);
			}
		});
		crownStrip(b, points, (k) => half * flare(k), tone, under, cross);
		if (end === 'circle') {
			const tail = points[last] as RoadPoint;
			const flat = () => tail.y;
			patch(b, tail.x, tail.z, () => circleRadius(half) + ROAD_VERGE, dust, ROAD_LIFT - 0.04, flat);
			patch(b, tail.x, tail.z, () => circleRadius(half), tone(last), ROAD_LIFT + 0.01, flat);
		}
	}
	// A house set back from its road has its own graded strip, from the road's edge to its front door.
	for (const lot of LOTS) {
		const way = wayOf(lot);
		if (way) strip(b, way, WAY_HALF, [0.34, 0.3, 0.24], ROAD_LIFT - 0.02);
	}
	return b;
}

/** One straight piece of a house's way, widened a little on each side where a wall must leave a gap. */
interface WayPiece {
	ax: number;
	az: number;
	bx: number;
	bz: number;
}

/** The pieces of the houses' drawn ways, listed under each cell of a coarse grid that they touch. */
function waysByCell(): Map<number, WayPiece[]> {
	const cells = new Map<number, WayPiece[]>();
	const key = (x: number, z: number) => Math.round(x / 6) * 4096 + Math.round(z / 6);
	for (const lot of LOTS) {
		const way = wayOf(lot);
		if (!way) continue;
		const [from, to] = [way[0] as RoadPoint, way[way.length - 1] as RoadPoint];
		const piece = { ax: from.x, az: from.z, bx: to.x, bz: to.z };
		const length = hypot(to.x - from.x, to.z - from.z);
		const steps = Math.ceil(length / 3);
		for (let k = 0; k <= steps; k++) {
			const [x, z] = [
				from.x + ((to.x - from.x) * k) / steps,
				from.z + ((to.z - from.z) * k) / steps,
			];
			for (let i = -1; i <= 1; i++)
				for (let j = -1; j <= 1; j++) {
					const cell = key(x + i * 6, z + j * 6);
					const list = cells.get(cell);
					if (!list) cells.set(cell, [piece]);
					else if (!list.includes(piece)) list.push(piece);
				}
		}
	}
	return cells;
}

/** Whether a piece of wall comes within the strip's half width and a little of a way's piece. */
function segmentsMeet(ax: number, az: number, cx: number, cz: number, w: WayPiece): boolean {
	const steps = Math.max(1, Math.ceil(hypot(cx - ax, cz - az) / 0.5));
	for (let k = 0; k <= steps; k++) {
		const [x, z] = [ax + ((cx - ax) * k) / steps, az + ((cz - az) * k) / steps];
		const [dx, dz] = [w.bx - w.ax, w.bz - w.az];
		const t = Math.max(
			0,
			Math.min(1, ((x - w.ax) * dx + (z - w.az) * dz) / (dx * dx + dz * dz || 1)),
		);
		if (hypot(x - (w.ax + dx * t), z - (w.az + dz * t)) < WAY_CLEAR) return true;
	}
	return false;
}

/** The dry stone walls: one side of a whole run along each lane, and each terrace of the worked slopes. */
export function stoneWalls(): {
	mesh: Build;
	stretches: { x: number; z: number }[][];
	retaining: { x: number; z: number; high: number; top: number; run: number }[];
} {
	const b = build();
	const stretches: { x: number; z: number }[][] = [];
	const stone: Color = [0.6, 0.54, 0.44];
	const key = (x: number, z: number) => Math.round(x / 6) * 4096 + Math.round(z / 6);
	const gaps = new Set<number>();
	const ways = waysByCell();
	const crossesWay = (ax: number, az: number, cx: number, cz: number) =>
		[key(ax, az), key(cx, cz)].some((cell) =>
			ways.get(cell)?.some((w) => segmentsMeet(ax, az, cx, cz, w)),
		);
	const clear = (x: number, z: number, reach: number) => {
		for (let i = -reach; i <= reach; i++)
			for (let j = -reach; j <= reach; j++) gaps.add(key(x + i * 3, z + j * 3));
	};
	for (const lot of LOTS) clear(lot.gate.x, lot.gate.z, 1);
	// A wall stops short of every road end, so it never crosses a road's mouth.
	for (const { points, end } of ROADS) {
		if (end === 'loop') continue;
		const first = points[0] as RoadPoint;
		const last = points[points.length - 1] as RoadPoint;
		clear(first.x, first.z, 4);
		if (end === 'junction') clear(last.x, last.z, 4);
	}
	for (const { points, half } of ROADS) {
		if ((half < LANE && half !== MAIN) || half === STREET + 0.5) continue;
		// The wall stands on the road's downhill side, chosen once for each run of road.
		let run: { a: { x: number; y: number; z: number }; c: { x: number; y: number; z: number } }[] =
			[];
		const flush = () => {
			if (run.length * 6 >= 18) {
				// The wall's ends slope down into the ground.
				for (const [k, { a, c }] of run.entries())
					wallStretch(b, a, c, k === 0 ? -0.1 : 0.62, stone, k === run.length - 1 ? -0.1 : 0.62);
				stretches.push(run.flatMap(({ a, c }) => [a, c]));
			}
			run = [];
		};
		let side = 0;
		for (let k = 4; k + 6 < points.length; k += 2) {
			const p = points[k] as RoadPoint;
			const q = points[k + 2] as RoadPoint;
			const length = hypot(q.x - p.x, q.z - p.z) || 1;
			const [nx, nz] = [-(q.z - p.z) / length, (q.x - p.x) / length];
			if (run.length === 0) side = groundHeight(p.x + nx * 8, p.z + nz * 8) < p.y ? 1 : -1;
			const off = half + 1.05;
			const [ax, az] = [p.x + nx * off * side, p.z + nz * off * side];
			const [cx, cz] = [q.x + nx * off * side, q.z + nz * off * side];
			if (
				gaps.has(key(p.x, p.z)) ||
				inland(ax, az) < 2 ||
				townShare(p.x, p.z) > 0.4 ||
				roadEdge(ax, az) < 0.2 ||
				roadEdge(cx, cz) < 0.2 ||
				crossesWay(ax, az, cx, cz)
			) {
				flush();
				continue;
			}
			run.push({
				a: { x: ax, y: p.y + ROAD_LIFT, z: az },
				c: { x: cx, y: q.y + ROAD_LIFT, z: cz },
			});
		}
		flush();
	}
	// A stone retaining wall stands where a road lies in a cut and the ground behind it stands higher than
	// a low step. Its top follows that ground, and it runs on without a break. A short run stands for nothing.
	const retaining: { x: number; z: number; high: number; top: number; run: number }[] = [];
	const rubble: Color = [0.72, 0.66, 0.56];
	let run = 0;
	for (const { points, half } of ROADS) {
		if (half < SIDE_LANE || half === STREET + 0.5) continue;
		for (const side of [1, -1]) {
			let stations: { x: number; y: number; z: number; high: number }[] = [];
			const flushWall = () => {
				if ((stations.length - 1) * 6 >= SHORTEST_RETAINING) {
					run++;
					// The top changes by little from one stretch to the next.
					for (let pass = 0; pass < 2; pass++) {
						const order = pass === 0 ? stations : [...stations].reverse();
						for (let k = 1; k < order.length; k++) {
							const [p, q] = [order[k] as (typeof order)[0], order[k - 1] as (typeof order)[0]];
							p.high = Math.min(p.high, q.high + WALL_STEP);
						}
					}
					retainingRun(b, stations, rubble);
					for (const w of stations)
						retaining.push({ x: w.x, z: w.z, high: w.high, top: w.y + w.high, run });
				}
				stations = [];
			};
			for (let k = 2; k + 2 < points.length; k += 2) {
				const p = points[k] as RoadPoint;
				const a = points[k - 1] as RoadPoint;
				const c = points[k + 1] as RoadPoint;
				const length = hypot(c.x - a.x, c.z - a.z) || 1;
				const [nx, nz] = [(-(c.z - a.z) / length) * side, ((c.x - a.x) / length) * side];
				const off = half + WALL_EDGE + 0.2;
				const [x, z] = [p.x + nx * off, p.z + nz * off];
				const high = groundHeight(x + nx * WALL_BEHIND, z + nz * WALL_BEHIND) - p.y;
				if (
					high < RETAINING_LEAST ||
					(gaps.has(key(p.x, p.z)) && formHeight(p.x, p.z) - p.y <= DEEP_ROAD) ||
					roadEdge(x, z) < 0.2 ||
					(stations.length > 0 &&
						crossesWay(
							(stations[stations.length - 1] as { x: number }).x,
							(stations[stations.length - 1] as { z: number }).z,
							x,
							z,
						))
				) {
					flushWall();
					continue;
				}
				stations.push({ x, y: p.y, z, high: Math.min(MOST_RETAINING, high) });
			}
			flushWall();
		}
	}
	// A terrace's chain of walls slopes down into the ground at each end, with no cut face.
	const continues = (x: number, z: number, self: (typeof TERRACES)[0]) =>
		TERRACES.some(
			(t) => t !== self && (hypot(t.ax - x, t.az - z) < 0.5 || hypot(t.bx - x, t.bz - z) < 0.5),
		);
	for (const terrace of TERRACES) {
		const { ax, ay, az, bx, by, bz } = terrace;
		if (crossesWay(ax, az, bx, bz)) continue;
		wallStretch(
			b,
			{ x: ax, y: ay, z: az },
			{ x: bx, y: by, z: bz },
			continues(ax, az, terrace) ? 0.5 : -0.1,
			stone,
			continues(bx, bz, terrace) ? 0.5 : -0.1,
		);
	}
	return { mesh: b, stretches, retaining };
}

/** Whether a place stands within a tree trunk's width of a retaining wall. */
export function onRetainingWall(): (x: number, z: number) => boolean {
	const cells = new Set<number>();
	const key = (x: number, z: number) =>
		Math.round(x / WALL_CELL) * 8192 + Math.round(z / WALL_CELL);
	const along = (ax: number, az: number, bx: number, bz: number) => {
		const steps = Math.ceil(hypot(bx - ax, bz - az) / (WALL_CELL / 2));
		for (let t = 0; t <= steps; t++)
			cells.add(key(ax + ((bx - ax) * t) / steps, az + ((bz - az) * t) / steps));
	};
	const { retaining } = stoneWalls();
	retaining.forEach((wall, k) => {
		const next = retaining[k + 1];
		if (next && next.run === wall.run) along(wall.x, wall.z, next.x, next.z);
	});
	return (x, z) => cells.has(key(x, z));
}

/** The length of each run of retaining wall, in meters, from the walls' list. */
export function retainingRuns(retaining: readonly { run: number }[]): number[] {
	const runs = new Map<number, number>();
	for (const { run } of retaining) runs.set(run, (runs.get(run) ?? 0) + 6);
	return [...runs.values()];
}

/** The steepest ground that holds the golf course's turf, as a rise over a run. */
const GOLF_BANK = 0.3;
/** The width of a mown stripe on the golf turf, in meters, and the bands across a fairway's width. */
const MOW_STRIPE = 4.4;
const MOW_BANDS = 10;
/** How far from the sea the turf stays, where the shore's bare rock ends, and the reach of a green, in meters. */
const GOLF_SHORE = 36;
const GREEN_REACH = 17;
/** The fewest points of a fairway's line in a run of its turf. */
const SHORTEST_FAIRWAY = 12;
/** The points of a fairway's line over which its end rounds off. */
const FAIRWAY_ROUND = 5;
/** How far a wall keeps from the middle of a house's way, in meters. */
const WAY_CLEAR = 1.6;
/** The side in meters of the grid that says whether a tree stands on a wall. */
const WALL_CELL = 1;
/** How far a parasol stands from a road's edge, in meters. */
const PARASOL_FROM_ROAD = 2;

/** The stone stairs from the villages up to their towers: a tread and a riser for each step. */
function stairsMesh(): Build {
	const b = build();
	const stone: Color = [0.68, 0.63, 0.54];
	const riser: Color = [0.56, 0.52, 0.45];
	for (const stair of STAIRS) {
		const treads = stairTreads(stair);
		const last = stair[stair.length - 1] as { x: number; y: number; z: number };
		treads.forEach((t, k) => {
			const next = treads[k + 1];
			const end = next ?? last;
			const [ux, uz] = [Math.cos(t.heading), Math.sin(t.heading)];
			const [nx, nz] = [-uz * STAIR_HALF, ux * STAIR_HALF];
			const half = t.run / 2 + 0.03;
			// A tread reaches from its own point to the next one, so the flight tiles its whole line.
			const [cx, cz] = [t.x + ux * (t.run / 2), t.z + uz * (t.run / 2)];
			quad(
				b,
				[cx - ux * half - nx, t.y, cz - uz * half - nz],
				[cx - ux * half + nx, t.y, cz - uz * half + nz],
				[cx + ux * half + nx, t.y, cz + uz * half + nz],
				[cx + ux * half - nx, t.y, cz + uz * half - nz],
				stone,
			);
			// The riser stands at the tread's far edge, up to the next tread or the door's threshold.
			quad(
				b,
				[end.x - nx, t.y - 0.3, end.z - nz],
				[end.x + nx, t.y - 0.3, end.z + nz],
				[end.x + nx, end.y, end.z + nz],
				[end.x - nx, end.y, end.z - nz],
				riser,
			);
		});
	}
	// The apron from each flight's foot to its street.
	for (const apron of STAIR_APRONS)
		if (apron.length > 1) strip(b, apron, COURT_WALK_HALF, stone, 0);
	return b;
}

/**
 * The court walks that carry each flight round its court to the door: the mapped stone tops, the
 * face that holds them above the bank, and the coping where the two meet.
 */
function courtWalkMesh(): Build {
	const b = build();
	b.mapped = true;
	const top: Color = [0.86, 0.81, 0.71];
	const face: Color = [0.78, 0.73, 0.63];
	const coping: Color = [0.93, 0.9, 0.82];
	STAIR_WALKS.forEach((walk, k) => {
		const [kx, kz] = KEEPS[k] as readonly [number, number, number];
		/** A station's normal across the walk, its outer edge, and the ground below that edge. */
		const station = (m: number) => {
			const p = walk[m] as { x: number; y: number; z: number };
			const a = walk[Math.max(0, m - 1)] as { x: number; z: number };
			const c = walk[Math.min(walk.length - 1, m + 1)] as { x: number; z: number };
			const length = hypot(c.x - a.x, c.z - a.z) || 1;
			const [nx, nz] = [-(c.z - a.z) / length, (c.x - a.x) / length];
			const side = (p.x - kx) * nx + (p.z - kz) * nz >= 0 ? 1 : -1;
			const [ox, oz] = [p.x + nx * side * COURT_WALK_HALF, p.z + nz * side * COURT_WALK_HALF];
			return {
				x: p.x,
				y: p.y,
				z: p.z,
				nx,
				nz,
				side,
				ox,
				oz,
				ground: Math.min(p.y - 0.05, groundHeight(ox, oz) - 0.1),
			};
		};
		for (let n = 0; n + 1 < walk.length; n++) {
			const [p, q] = [station(n), station(n + 1)];
			// The stone top, in quads that take the map.
			quad(
				b,
				[p.x - p.nx * COURT_WALK_HALF, p.y, p.z - p.nz * COURT_WALK_HALF],
				[p.x + p.nx * COURT_WALK_HALF, p.y, p.z + p.nz * COURT_WALK_HALF],
				[q.x - q.nx * COURT_WALK_HALF, q.y, q.z - q.nz * COURT_WALK_HALF],
				[q.x + q.nx * COURT_WALK_HALF, q.y, q.z + q.nz * COURT_WALK_HALF],
				top,
			);
			if (p.y - Math.min(p.ground, q.ground) < 0.05) continue;
			// The face that holds the walk above the bank.
			if (p.side > 0)
				quad(
					b,
					[q.ox, q.y, q.oz],
					[p.ox, p.y, p.oz],
					[p.ox, p.ground, p.oz],
					[q.ox, q.ground, q.oz],
					face,
				);
			else
				quad(
					b,
					[p.ox, p.y, p.oz],
					[q.ox, q.y, q.oz],
					[q.ox, q.ground, q.oz],
					[p.ox, p.ground, p.oz],
					face,
				);
			// And the coping along the walk's outer edge.
			const [ipx, ipz] = [p.ox - p.nx * p.side * 0.35, p.oz - p.nz * p.side * 0.35];
			const [iqx, iqz] = [q.ox - q.nx * q.side * 0.35, q.oz - q.nz * q.side * 0.35];
			if (p.side > 0)
				quad(
					b,
					[ipx, p.y + 0.09, ipz],
					[p.ox, p.y + 0.09, p.oz],
					[q.ox, q.y + 0.09, q.oz],
					[iqx, q.y + 0.09, iqz],
					coping,
				);
			else
				quad(
					b,
					[ipx, p.y + 0.09, ipz],
					[iqx, q.y + 0.09, iqz],
					[q.ox, q.y + 0.09, q.oz],
					[p.ox, p.y + 0.09, p.oz],
					coping,
				);
			if (p.side > 0)
				quad(
					b,
					[p.ox, p.y - 0.02, p.oz],
					[q.ox, q.y - 0.02, q.oz],
					[q.ox, q.y + 0.09, q.oz],
					[p.ox, p.y + 0.09, p.oz],
					coping,
				);
			else
				quad(
					b,
					[q.ox, q.y - 0.02, q.oz],
					[p.ox, p.y - 0.02, p.oz],
					[p.ox, p.y + 0.09, p.oz],
					[q.ox, q.y + 0.09, q.oz],
					coping,
				);
		}
	});
	return b;
}

/** The half width of a court walk, in meters: its inner edge meets the court wall's face. */
const COURT_WALK_HALF = 1.3;

/** Writes one row of a batch: its place, its turn, and optionally its color and its size. */
function row(
	batch: InstanceBatch,
	k: number,
	x: number,
	y: number,
	z: number,
	yaw: number,
	color?: readonly number[],
	scale = 1,
): void {
	const turn = quat.create();
	quat.fromEuler(turn, 0, yaw, 0);
	batch.positions.set([x, y, z], k * 3);
	batch.rotations.set(turn, k * 4);
	batch.scales.set([scale, scale, scale], k * 3);
	if (color) batch.colors?.set(color, k * 4);
}

/** The meters that one copy of the road's grain and of the turf's grain covers. */
const ROAD_GRAIN_TILE = 5;
const TURF_GRAIN_TILE = 9;

/** Gives a mesh texture coordinates from its place on the ground, so a grain map lies level across it. */
function onGroundUvs(b: Build, tile: number): Build {
	b.uvs.length = 0;
	for (let at = 0; at < b.positions.length; at += 3)
		b.uvs.push((b.positions[at] as number) / tile, (b.positions[at + 2] as number) / tile);
	return b;
}

/** A grain of soft mottle over fine speckle, white at its brightest and `darkest` at its darkest. */
function grainMap({ textures }: SketchContext, seed: number, darkest: number) {
	const size = 512;
	const noise = new Noise(seed);
	const data = new Uint8Array(size * size * 4);
	for (let j = 0; j < size; j++)
		for (let i = 0; i < size; i++) {
			const [u, v] = [i / size, j / size];
			const mix =
				0.5 + 0.35 * noise.fbm2(u * 6, v * 6, 3, 6) + 0.4 * noise.fbm2(u * 48, v * 48, 2, 48);
			const tone = darkest + (255 - darkest) * Math.min(1, Math.max(0, mix));
			const at = (j * size + i) * 4;
			data[at] = tone;
			data[at + 1] = tone;
			data[at + 2] = tone;
			data[at + 3] = 255;
		}
	return textures.fromData({
		width: size,
		height: size,
		data,
		colorSpace: 'srgb',
		wrap: 'repeat',
		mipmaps: true,
	});
}

/**
 * Asphalt's grain: tar patches at a road's scale, and a fine aggregate that reads when a camera
 * stands at its closest range, over a tile of a few meters.
 */
function roadGrainMap({ textures }: SketchContext) {
	const size = 512;
	const noise = new Noise(53);
	const data = new Uint8Array(size * size * 4);
	for (let j = 0; j < size; j++)
		for (let i = 0; i < size; i++) {
			const [u, v] = [i / size, j / size];
			const mix =
				0.8 +
				0.2 * noise.fbm2(u * 4, v * 4, 3, 4) +
				0.16 * noise.fbm2(u * 36, v * 36, 2, 36) +
				0.12 * noise.fbm2(u * 170, v * 170, 1, 170);
			const tone = Math.min(255, Math.max(60, 255 * mix));
			const at = (j * size + i) * 4;
			data[at] = tone;
			data[at + 1] = tone;
			data[at + 2] = tone;
			data[at + 3] = 255;
		}
	return textures.fromData({
		width: size,
		height: size,
		data,
		colorSpace: 'srgb',
		wrap: 'repeat',
		mipmaps: true,
	});
}

/** The surfaces that the kit's meshes read: their maps, each as a material. */
interface Surfaces {
	plaster: ReturnType<SketchContext['materials']['standard']>;
	rubble: ReturnType<SketchContext['materials']['standard']>;
	ashlar: ReturnType<SketchContext['materials']['standard']>;
	tile: ReturnType<SketchContext['materials']['standard']>;
}

/**
 * The error at which a house switches to its plain far mesh, which has no shutters or trim: past about
 * 460 meters on a 1080p screen, and half that in the shadow maps. Closer, the plain walls show.
 */
const FAR_HOUSE_ERROR = 0.35;

/** The three places along the harbour's head that stand a waterfront house, by x. */
const WATERFRONT_AT = [-205, -100, -25] as const;

/**
 * The three front-row lots along the harbour's head that carry the waterfront houses: the lot
 * nearest each place, between four and eighteen meters inland of the quay street. The other houses
 * of those rows keep their kit meshes.
 */
export function waterfrontLots(): Lot[] {
	const chosen: Lot[] = [];
	for (const x of WATERFRONT_AT) {
		let best: Lot | undefined;
		let nearest = Number.POSITIVE_INFINITY;
		for (const lot of LOTS) {
			if (chosen.includes(lot)) continue;
			const inlandOf = lot.z - (quayWallZ(lot.x) - 8);
			if (inlandOf < -18 || inlandOf > -4) continue;
			const distance = Math.abs(lot.x - x);
			if (distance < nearest) [best, nearest] = [lot, distance];
		}
		if (best) chosen.push(best);
	}
	return chosen;
}

/** The lots that the waterfront houses stand on. */
const WATERFRONT_LOTS = waterfrontLots();

/** Stands one kind's walls and roofs over the lots given, and returns their two batches. */
function standKitHouses(
	ctx: SketchContext,
	surfaces: Surfaces,
	kind: (typeof HOUSE_KINDS)[number],
	lots: readonly Lot[],
): InstanceBatch[] {
	if (lots.length === 0) return [];
	const { scene, geometry } = ctx;
	const mesh = geometry.fromArrays(finish(kind.walls));
	mesh.setLevels([{ mesh: geometry.fromArrays(finish(kind.farWalls)), error: FAR_HOUSE_ERROR }]);
	const w = scene.createInstances(mesh, lots.length, {
		material: kind.stone ? surfaces.rubble : surfaces.plaster,
		colors: true,
		castShadows: true,
		receiveShadows: true,
	});
	const roofMesh = geometry.fromArrays(finish(kind.roof));
	roofMesh.setLevels([{ mesh: geometry.fromArrays(finish(kind.farRoof)), error: FAR_HOUSE_ERROR }]);
	const r = scene.createInstances(roofMesh, lots.length, {
		material: surfaces.tile,
		colors: true,
		castShadows: true,
		receiveShadows: true,
	});
	lots.forEach((lot, i) => {
		const tone = lot.tone * 420;
		const walls = kind.stone ? STONES : WALLS;
		row(w, i, lot.x, lot.y, lot.z, lot.yaw, walls[Math.floor(tone) % walls.length]);
		row(r, i, lot.x, lot.y, lot.z, lot.yaw, ROOFS[Math.floor(tone * 3) % ROOFS.length]);
	});
	w.markDirty();
	r.markDirty();
	return [w, r];
}

/** The code-built houses: each kind's batches, and the three harbour-front lots' batches apart. */
interface KitHouses {
	readonly byKind: readonly (readonly InstanceBatch[])[];
	readonly waterfront: readonly InstanceBatch[];
}

function createHouses(ctx: SketchContext, surfaces: Surfaces): KitHouses {
	const { scene, geometry } = ctx;
	const byKind: InstanceBatch[][] = [];
	const waterfront: InstanceBatch[] = [];
	HOUSE_KINDS.forEach((kind, k) => {
		const lots = LOTS.filter((lot) => lot.kind === k);
		if (lots.length === 0) {
			byKind.push([]);
			return;
		}
		byKind.push(
			standKitHouses(
				ctx,
				surfaces,
				kind,
				lots.filter((lot) => !WATERFRONT_LOTS.includes(lot)),
			),
		);
		waterfront.push(
			...standKitHouses(
				ctx,
				surfaces,
				kind,
				lots.filter((lot) => WATERFRONT_LOTS.includes(lot)),
			),
		);
	});
	GARDEN_KINDS.forEach((kind, k) => {
		const lots = LOTS.filter((lot) => lot.garden === k);
		if (lots.length === 0) return;
		const batch = scene.createInstances(geometry.fromArrays(finish(kind.mesh)), lots.length, {
			material: surfaces.rubble,
			castShadows: true,
			receiveShadows: true,
		});
		lots.forEach((lot, i) => {
			row(batch, i, lot.x, lot.y, lot.z, lot.yaw);
		});
		batch.markDirty();
	});
	return { byKind, waterfront };
}

/** The climbing flowers on some of the plots' walls. */
function createClimbers(ctx: SketchContext): void {
	const { scene, geometry, materials } = ctx;
	// Bougainvillea climbs in magenta sheets on the sunny fronts of some of the houses.
	const climbers = LOTS.filter((lot, k) => k % 3 === 0 && !WATERFRONT_LOTS.includes(lot));
	// A fixed value from 0 to 1 for each leaf and each of its choices, so every house's climber is
	// the same on every run.
	const hash = (k: number, salt: number): number => {
		let h = Math.imul(k + 1, 0x27d4eb2d) ^ Math.imul(salt + 7, 0x165667b1);
		h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
		h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
		h ^= h >>> 16;
		return (h >>> 0) / 4294967296;
	};
	// The vine grows in a few thick clumps rather than a disc: each is a centre on the wall, a
	// spread, and its own share of flowers, so the blossoms gather instead of checking the leaves.
	const CLUMPS: readonly { x: number; y: number; r: number; tall: number; flower: number }[] = [
		{ x: -1.1, y: 1.1, r: 0.58, tall: 1.35, flower: 0.42 },
		{ x: -0.35, y: 2.1, r: 0.62, tall: 1.2, flower: 0.3 },
		{ x: 0.55, y: 2.8, r: 0.52, tall: 1.1, flower: 0.16 },
		{ x: 1.12, y: 1.6, r: 0.5, tall: 1.25, flower: 0.38 },
		{ x: 0.2, y: 0.95, r: 0.62, tall: 1.2, flower: 0.24 },
		{ x: -0.95, y: 2.95, r: 0.44, tall: 1.0, flower: 0.1 },
	];
	const LEAF_TINTS: readonly Color[] = [
		[0.09, 0.19, 0.055],
		[0.12, 0.23, 0.07],
		[0.075, 0.16, 0.05],
	];
	const BLOOM_TINTS: readonly Color[] = [
		[0.55, 0.065, 0.3],
		[0.63, 0.1, 0.35],
		[0.48, 0.05, 0.24],
	];
	const mesh = build();
	const LEAVES = 520;
	for (let k = 0; k < LEAVES; k++) {
		const clump = CLUMPS[k % CLUMPS.length] as (typeof CLUMPS)[number];
		const a = hash(k, 1) * Math.PI * 2;
		const r = Math.sqrt(hash(k, 2));
		const x = clump.x + Math.cos(a) * r * clump.r;
		const y = clump.y + Math.sin(a) * r * clump.r * clump.tall;
		if (Math.abs(x) > 1.55 || y < 0.12 || y > 3.95) continue;
		// A leaf is a small quad turned any way on the wall, smaller toward its clump's edge where
		// the growth thins.
		const s = (0.05 + hash(k, 3) * 0.045) * (1.05 - 0.35 * r);
		const t = hash(k, 4) * Math.PI * 2;
		const [ca, sa] = [Math.cos(t) * s, Math.sin(t) * s];
		const [cb, sb] = [-Math.sin(t) * s, Math.cos(t) * s];
		const z = 0.04 + hash(k, 5) * 0.06;
		const bloom = hash(k, 6) < clump.flower;
		const tint = bloom
			? (BLOOM_TINTS[Math.floor(hash(k, 7) * BLOOM_TINTS.length)] as Color)
			: (LEAF_TINTS[Math.floor(hash(k, 8) * LEAF_TINTS.length)] as Color);
		quad(
			mesh,
			[x - ca - cb, y - sa - sb, z],
			[x + ca - cb, y + sa - sb, z],
			[x + ca + cb, y + sa + sb, z],
			[x - ca + cb, y - sa + sb, z],
			tint,
		);
	}
	const flowers = scene.createInstances(geometry.fromArrays(finish(mesh)), climbers.length, {
		material: materials.standard({ vertexColors: true, roughness: 0.9 }),
		castShadows: false,
		receiveShadows: true,
	});
	climbers.forEach((lot, k) => {
		const [hw, hd] = (HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number]).half;
		const u = (k % 2 ? 1 : -1) * (hw - 1.2);
		const [c, s] = [Math.cos(lot.yaw), Math.sin(lot.yaw)];
		row(flowers, k, lot.x + u * c + hd * s, lot.y, lot.z - u * s + hd * c, lot.yaw, undefined, 1.5);
	});
	flowers.markDirty();
}

/** The square: stone laid in fans around a stepped fountain, plane trees' beds, cafes and flowers. */
/**
 * The ground's variation under a square prop's footprint at a place, in meters. A place whose
 * footprint spans more than a few centimeters of ground stands on a bank rather than a floor.
 */
function groundSpread(px: number, pz: number, reach: number): number {
	let [low, high] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
	for (const u of [-reach, 0, reach])
		for (const v of [-reach, 0, reach]) {
			const ground = groundHeight(px + u, pz + v);
			low = Math.min(low, ground);
			high = Math.max(high, ground);
		}
	return high - low;
}

/**
 * A cafe place moved inward until the ground under its own footprint is level, so its table or pot
 * stands flat on the piazza rather than across the bank at a building's front.
 */
function settleOnPiazza(px: number, pz: number, reach: number): [number, number] {
	let [atX, atZ] = [px, pz];
	for (let step = 0; step < 12 && groundSpread(atX, atZ, reach) > 0.05; step++) {
		const [dx, dz] = [SQUARE.x - atX, SQUARE.z - atZ];
		const d = hypot(dx, dz) || 1;
		atX += (dx / d) * 0.5;
		atZ += (dz / d) * 0.5;
	}
	return [Math.round(atX * 100) / 100, Math.round(atZ * 100) / 100];
}

/** The table and pot footprints' reach, and the half sizes of a level place on the piazza, in meters. */
const TABLE_REACH = 1.17;
const POT_REACH = 0.95;

/**
 * The places of the square's cafe tables, its pots and its awnings, as the square draws them. Each
 * is given in the world's x and z, and the awnings carry their turn.
 */
export function squarePropPlaces(): {
	covered: [number, number][];
	open: [number, number][];
	pots: [number, number][];
	awnings: { x: number; z: number; yaw: number }[];
} {
	const { x, z, hx, hz } = SQUARE;
	// The cafe tables stand along the square's fringes, under canvas in some places and open in others.
	const covered: [number, number][] = [];
	const open: [number, number][] = [];
	for (const side of [-1, 1])
		for (let i = 0; i < 5; i++) {
			const px = x + side * (hx - 1 + (i % 2) * 2.6);
			const pz = z - hz + 5 + i * 5.6;
			// A covered table keeps its chairs on the paving, under the awning that shelters it.
			if (i % 3 === 0) covered.push([px, pz]);
			else open.push([px, pz]);
		}
	for (let i = 0; i < 10; i++) {
		const px = x - hx + 3 + i * 4.6;
		if (Math.abs(px - x) < 5) continue;
		open.push([px, z + hz - 2 - (i % 2) * 2.4]);
		if (i % 4 === 1) covered.push([px, z + hz + 1.8]);
	}
	for (let i = 0; i < 6; i++) open.push([x - 10 + i * 4, z - hz + 1 + (i % 2) * 2.2]);
	// Flowering pots gather by the fountain, the trees and the church's steps.
	const pots: [number, number][] = [];
	for (let k = 0; k < 8; k++) {
		const a = (k / 8) * Math.PI * 2 + 0.3;
		pots.push([x + Math.cos(a) * 7.4, z + Math.sin(a) * 7.4]);
	}
	for (const px of [-12, -8, 8, 12]) pots.push([x + px, z - hz - 3.5]);
	for (const [ox, oz] of [
		[-16.5, -3],
		[10, -8.5],
		[-11, 14],
		[17, 9],
	] as const)
		pots.push([x + ox, z + oz]);
	// Every table and pot comes to rest on the piazza's own level floor, and clear of the fountain's water.
	const settled = (places: [number, number][], reach: number): [number, number][] =>
		places.map(([px, pz]) => settleOnPiazza(px, pz, reach)).filter(([px, pz]) => !inWater(px, pz));
	const awnings = [
		{ x: x - hx - 2, z: z + 4, yaw: Math.PI / 2 },
		{ x: x + hx + 2, z: z + 4, yaw: -Math.PI / 2 },
		{ x: x - hx - 2, z: z - 10, yaw: Math.PI / 2 },
		{ x: x + hx + 2, z: z - 10, yaw: -Math.PI / 2 },
	];
	return {
		covered: settled(covered, TABLE_REACH),
		open: settled(open, TABLE_REACH),
		pots: settled(pots, POT_REACH),
		awnings,
	};
}

/** The height of the square's paved floor at a place, which follows the ground that it meets. */
export function squarePavingHeight(x: number, z: number): number {
	return groundHeight(x, z) + DRAPE;
}

/** The height of the square's level piazza and the half sizes of the ground that it covers. */
export function squareFloor(): { x: number; z: number; halfX: number; halfZ: number; top: number } {
	const { x, z, hx, hz } = SQUARE;
	return { x, z, halfX: hx + 3, halfZ: hz + 6, top: squarePavingHeight(x, z) };
}

function createSquare(
	ctx: SketchContext,
	surfaces: Surfaces,
): { church: Object3D[]; churchY: number } {
	const { scene, geometry, materials } = ctx;
	const { x, z, hx, hz } = SQUARE;
	const y = groundHeight(x, z);
	const b = build();
	const top = y + DRAPE;
	// The fans of small stones cover the square's whole floor, out to the streets on its sides. They lie in
	// a map, whose finer levels fade with distance, so they never shimmer into rings.
	// The paved floor runs past the cafe tables at the square's fringes, and follows the ground that
	// it meets, so its flags never hang over a bank and every table stands on its surface.
	const [wide, deep] = [hx + 3, hz + 6];
	const FLOOR_CELL = 2;
	const cols = Math.ceil((wide * 2) / FLOOR_CELL);
	const rows = Math.ceil((deep * 2) / FLOOR_CELL);
	const floor = { positions: [] as number[], uvs: [] as number[], indices: [] as number[] };
	for (let j = 0; j <= rows; j++)
		for (let i = 0; i <= cols; i++) {
			const px = x - wide + (i / cols) * wide * 2;
			const pz = z - deep + (j / rows) * deep * 2;
			floor.positions.push(px, squarePavingHeight(px, pz), pz);
			floor.uvs.push((px - x) / FAN_PERIOD, (pz - z) / FAN_PERIOD);
		}
	for (let j = 0; j < rows; j++)
		for (let i = 0; i < cols; i++) {
			const at = j * (cols + 1) + i;
			floor.indices.push(at, at + cols + 1, at + 1, at + 1, at + cols + 1, at + cols + 2);
		}
	scene.createMesh({
		mesh: geometry.fromArrays({ ...floor, computeNormals: true }),
		material: materials.standard({ map: fanMap(ctx), roughness: 0.82, metalness: 0 }),
		castShadows: false,
		receiveShadows: true,
	});
	// The fountain: round steps with flowers, a basin, water, and a column with a smaller bowl.
	const stone: Color = [0.76, 0.71, 0.62];
	const water: Color = [0.1, 0.42, 0.5];
	ring(b, x, z, 6.4, top, 6.4, top + 0.22, 28, [0.62, 0.56, 0.47]);
	ring(b, x, z, 6.4, top + 0.22, 5.4, top + 0.22, 28, [0.66, 0.6, 0.5]);
	ring(b, x, z, 5.4, top + 0.22, 5.4, top + 0.44, 28, [0.66, 0.6, 0.5]);
	ring(b, x, z, 5.4, top + 0.44, 4.2, top + 0.44, 28, stone);
	ring(b, x, z, 4.2, top + 0.44, 4.2, top + 1.05, 28, stone);
	ring(b, x, z, 4.3, top + 1.05, FOUNTAIN_WATER.basin, top + 1.05, 28, stone);
	const basinTop = top + FOUNTAIN_WATER.basinAbove;
	ring(b, x, z, FOUNTAIN_WATER.basin, basinTop, 0, basinTop, 28, water);
	ring(b, x, z, 0.5, top + 0.95, 0.34, top + 2.5, 12, stone);
	ring(b, x, z, 0.34, top + 2.5, 1.5, top + 2.75, 18, stone);
	ring(b, x, z, 1.5, top + 2.75, 1.5, top + 2.95, 18, stone);
	const bowlTop = top + FOUNTAIN_WATER.bowlAbove;
	ring(b, x, z, FOUNTAIN_WATER.bowl, bowlTop, 0, bowlTop, 18, water);
	ring(b, x, z, 0.22, top + 2.9, 0.12, top + 3.9, 8, stone);
	ring(b, x, z, 0.3, top + 3.9, 0, top + 4.2, 8, stone);
	// The beds of stone around the shade trees.
	for (const [ox, oz] of [
		[-13, -5],
		[13, -6],
		[-14, 11],
		[14, 11],
	] as const) {
		ring(b, x + ox, z + oz, 2.6, top, 2.6, top + 0.5, 16, stone);
		ring(b, x + ox, z + oz, 2.6, top + 0.5, 0, top + 0.5, 16, [0.15, 0.22, 0.07]);
	}
	scene.createMesh({
		mesh: geometry.fromArrays(finish(b)),
		material: materials.standard({ vertexColors: true, roughness: 0.85 }),
		receiveShadows: true,
		castShadows: true,
	});
	const hall = church();
	const place = [CHURCH_AT.x, y - 0.1, CHURCH_AT.z] as [number, number, number];
	const hallStone = scene.createMesh({
		mesh: geometry.fromArrays(finish(hall.stone)),
		material: surfaces.ashlar,
		position: place,
		castShadows: true,
		receiveShadows: true,
	});
	const hallRoof = scene.createMesh({
		mesh: geometry.fromArrays(finish(hall.roof)),
		material: surfaces.tile,
		position: place,
		castShadows: true,
		receiveShadows: true,
	});
	// The cafe tables stand along the square's fringes, under canvas in some places and open in others.
	const places = squarePropPlaces();
	const put = (arrays: Build, spots: readonly (readonly [number, number])[]) => {
		const batch = scene.createInstances(geometry.fromArrays(finish(arrays)), spots.length, {
			material: materials.standard({ vertexColors: true, roughness: 0.85, doubleSided: true }),
			castShadows: true,
			receiveShadows: true,
		});
		spots.forEach(([px, pz], k) => {
			// Each table or pot stands on the paved floor at its own place.
			row(batch, k, px, squarePavingHeight(px, pz), pz, k * 0.37);
		});
		batch.markDirty();
	};
	put(cafeTable(), places.covered);
	put(bareTable(), places.open);
	put(planter(), places.pots);
	// Canvas awnings hang from the fronts of the houses at the square's southern corners.
	const shades = scene.createInstances(geometry.fromArrays(finish(awning())), 4, {
		material: materials.standard({ vertexColors: true, roughness: 0.9, doubleSided: true }),
		castShadows: true,
		receiveShadows: true,
	});
	places.awnings.forEach((awning, k) => {
		row(shades, k, awning.x, top, awning.z, awning.yaw);
	});
	shades.markDirty();
	return { church: [hallStone, hallRoof], churchY: place[1] };
}

/** A rock that darkens where the sea wets it, so the pale stone under the water reads as one with the deep. */
function wetRock({ materials }: SketchContext) {
	return materials.shader({
		wgsl: /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    // The sea's level is 0, in the island's plan.
    let wet = 1.0 - smoothstep(-0.6, 0.25, input.worldPosition.y);
    s.baseColor *= mix(1.0, 0.16, wet);
    // No stone stands under the surface, where its underside would show through thin water as a bright ring.
    s.alpha = step(-0.3, input.worldPosition.y);
    return s;
}
`,
		vertexColors: true,
		roughness: 1,
		alphaMode: 'mask',
		alphaCutoff: 0.5,
	});
}

/**
 * Stone that draws the painted stone, cracks and grain of the model file's own stone material,
 * and darkens where the sea wets it. Its vertex colors carry the tone that the file's material
 * multiplies into the map.
 */
const WET_STONE = /* wgsl */ `
var colorMap: texture_2d<f32>;
var normalMap: texture_2d<f32>;
var ormMap: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let texel = textureSample(colorMap, colorMapSampler, input.uv);
    s.baseColor *= texel.rgb;
    let bent = textureSample(normalMap, normalMapSampler, input.uv).xyz * 2.0 - 1.0;
    let orm = textureSample(ormMap, ormMapSampler, input.uv).rgb;
    s.occlusion *= orm.r;
    s.roughness *= orm.g;
    s.metalness *= orm.b;
    // The mesh carries no tangents, so the frame across the stone comes from how its position and
    // its texture coordinates change over the screen.
    let dp1 = dpdx(input.relativePosition);
    let dp2 = dpdy(input.relativePosition);
    let duv1 = dpdx(input.uv);
    let duv2 = dpdy(input.uv);
    let n = s.normal;
    let across1 = cross(n, dp1);
    let across2 = cross(dp2, n);
    let t = across2 * duv1.x + across1 * duv2.x;
    let b = across2 * duv1.y + across1 * duv2.y;
    let scale = inverseSqrt(max(max(dot(t, t), dot(b, b)), 1e-20));
    let mapped = normalize(t * (bent.x * scale) + b * (bent.y * scale) + n * bent.z);
    s.normal = mapped;
    s.diffuseNormal = mapped;
    s.ambientNormal = mapped;
    // The sea's level is 0, in the island's plan.
    let wet = 1.0 - smoothstep(-0.6, 0.25, input.worldPosition.y);
    s.baseColor *= mix(1.0, 0.16, wet);
    // No stone stands under the surface, where its underside would show through thin water as a bright ring.
    s.alpha = step(-0.3, input.worldPosition.y);
    return s;
}
`;

/** A stone material of the model's own maps, with the sea's wet darkening and underwater cut. */
function wetStone({ materials, textures }: SketchContext, part: Part) {
	const white = () => textures.fromData({ width: 1, height: 1, data: new Uint8Array(4).fill(255) });
	return materials.shader({
		wgsl: WET_STONE,
		vertexColors: true,
		roughness: 1,
		alphaMode: 'mask',
		alphaCutoff: 0.5,
		textures: {
			colorMap: part.maps.map ?? white(),
			normalMap:
				part.maps.normalMap ??
				textures.fromData({
					width: 1,
					height: 1,
					colorSpace: 'linear',
					data: new Uint8Array([128, 128, 255, 255]),
				}),
			// The file packs the occlusion with the metalness and the roughness, in one texture.
			ormMap: part.maps.metalnessRoughnessMap ?? white(),
		},
	});
}

/** The harbour: a vertical stone quay, stone moles, pontoons, a paved breakwater and moored boats. */
/** The quay's wall along the harbour's head, west to east, with each point's way out over the water. */
function quayLine(): { x: number; y: number; z: number; nx: number; nz: number; wide: number }[] {
	const line: { x: number; y: number; z: number; nx: number; nz: number; wide: number }[] = [];
	for (let x = QUAY_FROM; x <= QUAY_TO; x += 3) {
		const z = quayWallZ(x);
		const slope = (quayWallZ(x + 1.5) - quayWallZ(x - 1.5)) / 3;
		const length = hypot(1, slope);
		line.push({ x, y: 2.1, z, nx: -slope / length, nz: 1 / length, wide: 8 });
	}
	return line;
}

/** Where the long street's middle line runs at a place along the harbour's head, by z. */
function quayStreetZ(x: number, road: Road): number {
	let [best, z] = [Number.POSITIVE_INFINITY, 0];
	for (const p of road.points) {
		const d = Math.abs(p.x - x);
		if (d < best && p.z > 200) [best, z] = [d, p.z];
	}
	return z;
}

/** The nearest point of a road's middle line to a place. */
function nearestRoadPoint(road: Road, x: number, z: number): RoadPoint {
	let best = road.points[0] as RoadPoint;
	let least = Number.POSITIVE_INFINITY;
	for (const p of road.points) {
		const d = hypot(p.x - x, p.z - z);
		if (d < least) [least, best] = [d, p];
	}
	return best;
}

/** The paved way from the square's north edge down the bank to the harbour street. */
export const SQUARE_HARBOUR_PATH: readonly { x: number; y: number; z: number }[] = (() => {
	const quay = ROADS.find((road) => road.half === STREET + 0.5) as Road;
	const x = -94.2;
	const from = SQUARE.z + SQUARE.hz;
	const to = nearestRoadPoint(quay, x, from + 30);
	const end = to.z - quay.half;
	const steps = Math.max(2, Math.ceil((end - from) / 2));
	const path: { x: number; y: number; z: number }[] = [];
	for (let k = 0; k <= steps; k++) {
		const t = k / steps;
		const z = from + (end - from) * t;
		// It leaves the flagstones and lies on the bank, then rises to the street's shoulder.
		const y = k === 0 ? squarePavingHeight(x, from) : groundHeight(x, z) + 0.12;
		path.push({ x, y, z });
	}
	(path[path.length - 1] as { y: number }).y = to.y + ROAD_LIFT;
	return path;
})();

/** The stone flight from the harbour street's shoulder down to the quay apron, west of the harbour's head. */
export const HARBOUR_STAIR: readonly { x: number; y: number; z: number }[] = (() => {
	const quay = ROADS.find((road) => road.half === STREET + 0.5) as Road;
	const top = nearestRoadPoint(quay, -216, 306);
	const foot = { x: -203, y: 2.1, z: quayWallZ(-203) - 1.5 };
	return [{ x: -216, y: top.y + ROAD_LIFT, z: top.z + quay.half }, foot];
})();

/** The stone causeway from the quay's west end to the breakwater's root. */
export const BREAKWATER_CAUSEWAY = {
	a: { x: -212, y: 2.1, z: 310.7 },
	b: { x: -250, y: 1.9, z: 392 },
} as const;

/** The half beam and half length of the largest yacht's hull, in meters. */
export const HULL_HALF = [2.3, 7] as const;
/** The water that a hull keeps under it, in meters, and the steps of 2 m that a boat may stand off. */
export const HULL_WATER = 2;
const HULL_STEPS = 12;

/** The least water under a yacht's hull at a place and a heading, from its corners and its sides. */
export function hullDepth(x: number, z: number, yaw: number): number {
	const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
	let least = Number.POSITIVE_INFINITY;
	for (const u of [-1, 0, 1])
		for (const v of [-1, -0.5, 0, 0.5, 1]) {
			const [across, along] = [u * HULL_HALF[0], v * HULL_HALF[1]];
			least = Math.min(
				least,
				-groundHeight(x + across * c + along * s, z - across * s + along * c),
			);
		}
	return least;
}

/** Whether two hulls' footprints meet, as two boxes turned about their own middles, in meters. */
function hullsMeet(
	a: readonly [number, number, number],
	b: readonly [number, number, number],
	gap = 0.2,
): boolean {
	const corners = (m: readonly [number, number, number]): [number, number][] => {
		const [c, s] = [Math.cos(m[2]), Math.sin(m[2])];
		const out: [number, number][] = [];
		for (const across of [-HULL_HALF[0], HULL_HALF[0]])
			for (const along of [-HULL_HALF[1], HULL_HALF[1]])
				out.push([m[0] + across * c + along * s, m[1] - across * s + along * c]);
		return out;
	};
	const [pa, pb] = [corners(a), corners(b)];
	// Two boxes stand apart when a face axis of either finds a gap between them.
	for (const m of [a, b]) {
		const [c, s] = [Math.cos(m[2]), Math.sin(m[2])];
		for (const [ax, az] of [
			[c, -s],
			[s, c],
		] as const) {
			const [amin, amax] = [
				Math.min(...pa.map(([x, z]) => x * ax + z * az)),
				Math.max(...pa.map(([x, z]) => x * ax + z * az)),
			];
			const [bmin, bmax] = [
				Math.min(...pb.map(([x, z]) => x * ax + z * az)),
				Math.max(...pb.map(([x, z]) => x * ax + z * az)),
			];
			if (amax + gap <= bmin || bmax + gap <= amin) return false;
		}
	}
	return true;
}

/** Where the boats lie: stern-to along the quay and both sides of the moles, with a few out at anchor. */
export const MOORINGS: readonly (readonly [number, number, number])[] = (() => {
	const next = random(907);
	const moorings: [number, number, number][] = [];
	const clearOfMole = (x: number) => Math.abs(x + 92) > 12 && Math.abs(x - 10) > 22;
	quayLine().forEach((p, k) => {
		if (k % 4 === 2 && clearOfMole(p.x))
			moorings.push([
				p.x + p.nx * 7,
				p.z + p.nz * 7,
				Math.atan2(p.nx, p.nz) + (next() - 0.5) * 0.12,
			]);
	});
	for (const side of [-1, 1])
		for (let d = 0; d < 5; d++)
			moorings.push([
				-92 + side * 7.5,
				292 + d * 6.6,
				(side * Math.PI) / 2 + (next() - 0.5) * 0.12,
			]);
	for (let k = 0; k < 6; k++) {
		const [ax, az] = [52 + (8 - 52) * ((k + 0.5) / 6), 334 + (372 - 334) * ((k + 0.5) / 6)];
		moorings.push([ax - 6, az - 6.5, Math.atan2(-0.66, -0.75) + (next() - 0.5) * 0.14]);
	}
	for (const [x, z] of [
		[-150, 352],
		[-44, 345],
		[150, 490],
	] as const)
		moorings.push([x, z, next() * 6.3]);
	// A boat with land under its hull stands off toward deeper water.
	const adjusted = moorings.map(([x, z, yaw]) => {
		let [at, depth] = [[x, z] as const, hullDepth(x, z, yaw)];
		for (let step = 0; depth < HULL_WATER && step < HULL_STEPS; step++) {
			for (let k = 0; k < 8; k++) {
				const a = (k * Math.PI) / 4;
				const moved = [at[0] + Math.cos(a) * 2, at[1] + Math.sin(a) * 2] as const;
				const deeper = hullDepth(moved[0], moved[1], yaw);
				if (deeper > depth) [at, depth] = [moved, deeper];
			}
		}
		return [at[0], at[1], yaw] as [number, number, number];
	});
	// A boat that would meet a hull already placed stays out of the harbour, so no two cross.
	const placed: [number, number, number][] = [];
	for (const mooring of adjusted)
		if (!placed.some((other) => hullsMeet(mooring, other))) placed.push(mooring);
	return placed;
})();

function createHarbour(
	ctx: SketchContext,
	surfaces: Surfaces,
): {
	lighthouse: Object3D[];
	at: [number, number, number];
	sailboats: InstanceBatch;
	skiffs: InstanceBatch;
	stones: InstanceBatch;
} {
	const { scene, geometry, materials } = ctx;
	const b = build();
	const wallStone = build();
	const paving: Color = [0.62, 0.57, 0.47];
	const edge: Color = [0.86, 0.82, 0.74];
	// The quay's stone wall runs along the harbour's head, where the bed drops away, and paving runs from
	// its top to the kerb of the long street.
	const quayRoad = ROADS.find((road) => road.half === STREET + 0.5) as Road;
	const line = quayLine();
	const landward = (k: number) => {
		const p = line[k] as (typeof line)[0];
		return [-p.nx, -p.nz] as const;
	};
	const paved = line.map((p, k) => {
		const [nx, nz] = landward(k);
		return { x: p.x + nx * 3, y: p.y, z: p.z + nz * 3 };
	});
	for (let k = 0; k + 1 < line.length; k++) {
		const [p, q] = [line[k], line[k + 1]] as [(typeof line)[0], (typeof line)[0]];
		const reach = (t: (typeof line)[0]) =>
			[t.x, t.y, quayStreetZ(t.x, quayRoad) + quayRoad.half + 0.2] as const;
		quad(b, reach(p), reach(q), [q.x, q.y, q.z], [p.x, p.y, p.z], paving);
		quad(b, [p.x, p.y, p.z], [q.x, q.y, q.z], reach(q), reach(p), paving);
		wallStone.mapped = true;
		quad(wallStone, [q.x, -3, q.z], [p.x, -3, p.z], [p.x, p.y, p.z], [q.x, q.y, q.z], edge);
		quad(wallStone, [p.x, -3, p.z], [q.x, -3, q.z], [q.x, q.y, q.z], [p.x, p.y, p.z], edge);
		wallStone.mapped = false;
		if (k % 7 === 3)
			box(b, p.x - 0.18, p.y, p.z - 0.18, p.x + 0.18, p.y + 0.55, p.z + 0.18, [0.1, 0.1, 0.1]);
	}
	// The stone moles stand out from the shore: one to the east, and one from the quay's head.
	const pierTop = 1.9;
	const mole = (ax: number, az: number, bx: number, bz: number, half: number) => {
		const length = hypot(bx - ax, bz - az);
		const [nx, nz] = [(-(bz - az) / length) * half, ((bx - ax) / length) * half];
		quad(
			b,
			[ax + nx, pierTop, az + nz],
			[bx + nx, pierTop, bz + nz],
			[bx - nx, pierTop, bz - nz],
			[ax - nx, pierTop, az - nz],
			paving,
		);
		quad(
			b,
			[ax - nx, pierTop, az - nz],
			[bx - nx, pierTop, bz - nz],
			[bx + nx, pierTop, bz + nz],
			[ax + nx, pierTop, az + nz],
			paving,
		);
		wallStone.mapped = true;
		for (const side of [1, -1]) {
			const [ox, oz] = [nx * side, nz * side];
			quad(
				wallStone,
				[bx + ox, pierTop, bz + oz],
				[ax + ox, pierTop, az + oz],
				[ax + ox, -3, az + oz],
				[bx + ox, -3, bz + oz],
				edge,
			);
			quad(
				wallStone,
				[ax + ox, pierTop, az + oz],
				[bx + ox, pierTop, bz + oz],
				[bx + ox, -3, bz + oz],
				[ax + ox, -3, az + oz],
				edge,
			);
		}
		quad(
			wallStone,
			[bx - nx, pierTop, bz - nz],
			[bx + nx, pierTop, bz + nz],
			[bx + nx, -3, bz + nz],
			[bx - nx, -3, bz - nz],
			edge,
		);
		quad(
			wallStone,
			[bx + nx, pierTop, bz + nz],
			[bx - nx, pierTop, bz - nz],
			[bx - nx, -3, bz - nz],
			[bx + nx, -3, bz + nz],
			edge,
		);
		wallStone.mapped = false;
	};
	mole(52, 334, 8, 372, 3.4);
	mole(-92, 281, -92, 322, 2.6);
	// The causeway out to the breakwater's root, and the stone flight down from the street to the
	// apron at the quay's west end.
	mole(
		BREAKWATER_CAUSEWAY.a.x,
		BREAKWATER_CAUSEWAY.a.z,
		BREAKWATER_CAUSEWAY.b.x,
		BREAKWATER_CAUSEWAY.b.z,
		2.5,
	);
	const stair = HARBOUR_STAIR;
	const [top, foot] = [
		stair[0] as { x: number; y: number; z: number },
		stair[1] as { x: number; y: number; z: number },
	];
	const run = hypot(foot.x - top.x, foot.z - top.z) || 1;
	const [sx, sz] = [(foot.x - top.x) / run, (foot.z - top.z) / run];
	const [nx, nz] = [-sz, sx];
	const steps = Math.max(2, Math.ceil((top.y - foot.y) / 0.18));
	for (let k = 0; k < steps; k++) {
		const t = (k + 0.5) / steps;
		const [x, z] = [top.x + (foot.x - top.x) * t, top.z + (foot.z - top.z) * t];
		const y = top.y - (top.y - foot.y) * (k / steps);
		const half = run / steps / 2 + 0.03;
		quad(
			b,
			[x - sx * half - nx * 0.9, y, z - sz * half - nz * 0.9],
			[x - sx * half + nx * 0.9, y, z - sz * half + nz * 0.9],
			[x + sx * half + nx * 0.9, y, z + sz * half + nz * 0.9],
			[x + sx * half - nx * 0.9, y, z + sz * half - nz * 0.9],
			paving,
		);
		const below = top.y - (top.y - foot.y) * ((k + 1) / steps);
		quad(
			b,
			[x + sx * half - nx * 0.9, below - 0.3, z + sz * half - nz * 0.9],
			[x + sx * half + nx * 0.9, below - 0.3, z + sz * half + nz * 0.9],
			[x + sx * half + nx * 0.9, below, z + sz * half + nz * 0.9],
			[x + sx * half - nx * 0.9, below, z + sz * half - nz * 0.9],
			edge,
		);
	}
	strip(b, SQUARE_HARBOUR_PATH, 0.8, paving, 0);
	const [tipX, tipZ] = [-82, 424];
	const [startX, startZ] = [-250, 392];
	// The breakwater's paved top, with a low wall along its sea side.
	const curve = (t: number) => {
		const bend = Math.sin(t * Math.PI) * 20;
		return { x: startX + (tipX - startX) * t, y: 1.9, z: startZ + (tipZ - startZ) * t + bend };
	};
	const crest: { x: number; y: number; z: number }[] = [];
	for (let t = 0; t <= 1.0001; t += 0.04) crest.push(curve(t));
	strip(b, crest, 3, paving, 0);
	for (let k = 0; k + 1 < crest.length; k++) {
		const p = crest[k] as { x: number; z: number };
		const q = crest[k + 1] as { x: number; z: number };
		box(
			b,
			Math.min(p.x, q.x),
			1.9,
			Math.min(p.z, q.z) + 2.4,
			Math.max(p.x, q.x),
			3,
			Math.max(p.z, q.z) + 3,
			edge,
		);
	}
	scene.createMesh({
		mesh: geometry.fromArrays(finish(b)),
		material: materials.standard({ vertexColors: true, roughness: 0.9 }),
		receiveShadows: true,
		castShadows: true,
	});
	scene.createMesh({
		mesh: geometry.fromArrays(finish(wallStone)),
		material: surfaces.rubble,
		receiveShadows: true,
		castShadows: true,
	});

	// The breakwater's rocks: angular, in mixed sizes, heaped on both sides of its top.
	const next = random(907);
	const rockMesh = geometry.fromArrays(finish(boulder()));
	const material = wetRock(ctx);
	const rocks = 360;
	// The rocks cast no shadow: through the clear water theirs read as dark scraps on the harbour's floor.
	const breakwater = scene.createInstances(rockMesh, rocks, {
		material,
		layers: INTERIOR_LAYER,
		castShadows: false,
		receiveShadows: true,
	});
	for (let k = 0; k < rocks; k++) {
		const t = next();
		const p = curve(t);
		const side = k % 3 === 0 ? -1 : 1;
		const off = (3.6 + next() * 5) * side;
		const size = 0.9 + next() ** 2 * 2.6;
		row(
			breakwater,
			k,
			p.x + (next() - 0.5) * 2,
			-0.3 - next() * 0.8,
			p.z + off,
			next() * 6.3,
			undefined,
			size,
		);
	}
	breakwater.markDirty();
	const end = curve(1);
	const light = scene.createMesh({
		mesh: geometry.fromArrays(finish(lighthouse())),
		material: materials.standard({ vertexColors: true, roughness: 0.7 }),
		position: [end.x, 1.9, end.z],
		castShadows: true,
		receiveShadows: true,
	});

	const moorings = MOORINGS;
	// The boats cast no shadow: through the clear water theirs read as hard dark blobs on the harbour's floor.
	const yachts = scene.createInstances(geometry.fromArrays(finish(sailboat())), moorings.length, {
		material: materials.standard({ vertexColors: true, roughness: 0.55, doubleSided: true }),
		castShadows: false,
		receiveShadows: true,
	});
	moorings.forEach(([x, z, yaw], k) => {
		row(yachts, k, x, 0.05, z, yaw, undefined, 0.85 + next() * 0.45);
	});
	yachts.markDirty();
	const COLORS = [
		[0.6, 0.08, 0.06, 1],
		[0.06, 0.2, 0.42, 1],
		[0.85, 0.82, 0.74, 1],
		[0.08, 0.34, 0.26, 1],
	] as const;
	const small = scene.createInstances(geometry.fromArrays(finish(fishingBoat())), 18, {
		material: materials.standard({ vertexColors: true, roughness: 0.7 }),
		colors: true,
		castShadows: false,
		receiveShadows: true,
	});
	for (let k = 0; k < 18; k++) {
		const at = Math.floor(((k + 0.5) / 18) * (line.length - 1));
		const p = line[at] as { x: number; z: number };
		const [nx, nz] = landward(at);
		// A small boat lies off the sterns of the yachts, its bow along the quay.
		row(
			small,
			k,
			p.x - nx * 15,
			0.05,
			p.z - nz * 15,
			Math.atan2(-nz, nx),
			COLORS[k % COLORS.length],
		);
	}
	small.markDirty();
	// Palms line the promenade.
	const palms = paved.filter((_, k) => k % 11 === 5 && (line[k] as (typeof line)[0]).wide > 8);
	const trees = scene.createInstances(geometry.fromArrays(finish(palm())), palms.length, {
		material: materials.standard({ vertexColors: true, roughness: 0.9, doubleSided: true }),
		castShadows: true,
		receiveShadows: true,
	});
	palms.forEach((p, k) => {
		row(trees, k, p.x, p.y, p.z, next() * 6.3, undefined, 0.8 + next() * 0.35);
	});
	trees.markDirty();
	return {
		lighthouse: [light],
		at: [end.x, 1.9, end.z],
		// The model boats and stones replace these once their file lands.
		sailboats: yachts,
		skiffs: small,
		stones: breakwater,
	};
}

/** One parasol's place on the sand, its canvas's tint and its turn. */
export interface ParasolSpot {
	readonly x: number;
	readonly z: number;
	readonly color: readonly number[];
	readonly yaw: number;
}

/** The beach: tight rows of parasols from the back of the sand, in clubs with palms right behind. */
/** The parasols' places on the sand: in clubs, off the houses and the roads. */
export function parasolSpots(): ParasolSpot[] {
	const next = random(419);
	const spots: ParasolSpot[] = [];
	const COLORS = [
		[0.86, 0.78, 0.6, 1],
		[0.72, 0.6, 0.4, 1],
		[0.88, 0.84, 0.74, 1],
		[0.86, 0.78, 0.6, 1],
		[0.2, 0.36, 0.56, 1],
	] as const;
	const steps = 120;
	for (let k = 2; k < steps - 2; k++) {
		const t = k / steps;
		// Parasols gather in clubs along the sand, with open stretches between them.
		const club = Math.floor(t * 8);
		if (t * 8 - club > 0.72) continue;
		const a = BAY.from + BAY.sweep * t;
		const edge = BAY.radius;
		const width = sandWidth(BAY.x + Math.cos(a) * (edge + 20), BAY.z + Math.sin(a) * (edge + 20));
		for (let line = 0; line * 5.4 < width - 12; line++) {
			// Parasols stand loosely, some close and some with a gap, not in ruled rows.
			const r = edge + width - 3 - line * 5.4 + (next() - 0.5) * 2.2;
			const turn = a + ((next() - 0.5) * 2.6) / r;
			const x = BAY.x + Math.cos(turn) * r;
			const z = BAY.z + Math.sin(turn) * r;
			if (inland(x, z) < 8 || next() < 0.08 || inWater(x, z)) continue;
			if (LOTS.some((lot) => hypot(lot.x - x, lot.z - z) < lot.reach + 4)) continue;
			if (roadEdge(x, z) < PARASOL_FROM_ROAD) continue;
			spots.push({
				x,
				z,
				color: COLORS[club % COLORS.length] as readonly number[],
				yaw: a + Math.PI / 2,
			});
		}
	}
	return spots;
}

/** The diameter of a parasol's canvas, with a little clearance, in meters. */
const PARASOL_SPAN = 3.05;

/** The parasol places, with no two canvases overlapping. */
export function parasolClubs(): ParasolSpot[] {
	const kept: ParasolSpot[] = [];
	for (const spot of parasolSpots())
		if (kept.every((other) => hypot(other.x - spot.x, other.z - spot.z) >= PARASOL_SPAN))
			kept.push(spot);
	return kept;
}

function createBeach(ctx: SketchContext): InstanceBatch {
	const next = random(421);
	const { scene, geometry, materials } = ctx;
	const spots = parasolClubs();
	const set = scene.createInstances(geometry.fromArrays(finish(parasol())), spots.length, {
		material: materials.standard({ vertexColors: true, roughness: 0.8, doubleSided: true }),
		colors: true,
		castShadows: true,
		receiveShadows: true,
	});
	spots.forEach((spot, k) => {
		row(set, k, spot.x, groundHeight(spot.x, spot.z), spot.z, spot.yaw, spot.color);
	});
	set.markDirty();
	// Palms stand along the back of the sand.
	const palms: [number, number][] = [];
	for (let k = 0; k < 60; k++) {
		const a = BAY.from + BAY.sweep * (k / 59);
		const [ex, ez] = [
			BAY.x + Math.cos(a) * (BAY.radius + 20),
			BAY.z + Math.sin(a) * (BAY.radius + 20),
		];
		const r = BAY.radius + sandWidth(ex, ez) + 4 + next() * 10;
		const [x, z] = [BAY.x + Math.cos(a) * r, BAY.z + Math.sin(a) * r];
		if (inland(x, z) > 20 && !inWater(x, z)) palms.push([x, z]);
	}
	const trees = scene.createInstances(geometry.fromArrays(finish(palm())), palms.length, {
		material: materials.standard({ vertexColors: true, roughness: 0.9, doubleSided: true }),
		castShadows: true,
		receiveShadows: true,
	});
	palms.forEach(([x, z], k) => {
		row(trees, k, x, groundHeight(x, z), z, next() * 6.3, undefined, 0.8 + next() * 0.45);
	});
	trees.markDirty();
	return set;
}

/** Whether a point lies off the golf course's top: on its steep bank, or down in the shore's bare rock. */
function offTop(x: number, z: number): boolean {
	return slopeAt(x, z) > GOLF_BANK || inland(x, z) < GOLF_SHORE;
}

/** Whether a hole's green lies whole on the course's top. */
export function holeOnTop(stations: readonly (readonly [number, number, number])[]): boolean {
	const end = stations[stations.length - 1] as readonly [number, number, number];
	const [gx, gz] = [GOLF.x + end[0], GOLF.z + end[1]];
	for (let a = 0; a < 6.28; a += 0.5)
		if (offTop(gx + Math.cos(a) * GREEN_REACH, gz + Math.sin(a) * GREEN_REACH)) return false;
	return !offTop(gx, gz);
}

/**
 * The golf course. Dark rough lies on the ground, with the land's own trees in belts on it, and over it
 * each fairway winds as a ribbon with crisp edges and mown bands, ending at a round green with its
 * flag. Kidney bunkers with raised grass lips lie along the fairways and around the greens.
 */
function createGolf(ctx: SketchContext): void {
	const { scene, geometry, materials } = ctx;
	const b = build();
	const flags = build();
	const rough: Color = [0.1, 0.22, 0.05];
	patch(
		b,
		GOLF.x,
		GOLF.z,
		(a) => {
			const [rx, rz] = [GOLF.radius * 1.2, GOLF.radius * 0.8];
			let r = 1 / hypot(Math.cos(a) / rx, Math.sin(a) / rz);
			for (let t = r; t > 20; t -= 4) {
				const [px, pz] = [GOLF.x + Math.cos(a) * t, GOLF.z + Math.sin(a) * t];
				if (inland(px, pz) > 14 && slopeAt(px, pz) < GOLF_BANK) break;
				r = t;
			}
			return r;
		},
		rough,
		0.3,
		groundHeight,
		// Fine enough to lie over the ground's own rolls, which would show through as dark spots.
		160,
		24,
	);
	const kidney = (r: number, turn: number) => (a: number) =>
		r * (1 + 0.32 * Math.cos((a - turn) * 2) + 0.14 * Math.sin((a - turn) * 3));
	for (const stations of HOLES) {
		// A hole whose green would sit on the coast's bank does not stand: its turf belongs on the top.
		if (!holeOnTop(stations)) continue;
		const line: { x: number; z: number; half: number }[] = [];
		for (let k = 0; k + 1 < stations.length; k++) {
			const a = stations[Math.max(0, k - 1)] as readonly [number, number, number];
			const p = stations[k] as readonly [number, number, number];
			const q = stations[k + 1] as readonly [number, number, number];
			const d = stations[Math.min(stations.length - 1, k + 2)] as readonly [number, number, number];
			for (let s = 0; s < 10; s++) {
				const t = s / 10;
				const [t2, t3] = [t * t, t * t * t];
				const cr = (i: 0 | 1 | 2) =>
					0.5 *
					(2 * p[i] +
						(q[i] - a[i]) * t +
						(2 * a[i] - 5 * p[i] + 4 * q[i] - d[i]) * t2 +
						(3 * p[i] - a[i] - 3 * q[i] + d[i]) * t3);
				line.push({ x: GOLF.x + cr(0), z: GOLF.z + cr(1), half: cr(2) });
			}
		}
		const end = stations[stations.length - 1] as readonly [number, number, number];
		const first = stations[0] as readonly [number, number, number];
		const [gx, gz] = [GOLF.x + end[0], GOLF.z + end[1]];
		line.push({ x: gx, z: gz, half: end[2] * 0.6 });
		// A fairway narrows where its edge would run onto the steep bank, so its turf stays on the top.
		const narrowTo = (k: number) => {
			const p = line[k] as { x: number; z: number; half: number };
			let half = p.half;
			const a = line[Math.max(0, k - 1)] as { x: number; z: number };
			const c = line[Math.min(line.length - 1, k + 1)] as { x: number; z: number };
			const length = hypot(c.x - a.x, c.z - a.z) || 1;
			const [ox, oz] = [-(c.z - a.z) / length, (c.x - a.x) / length];
			while (
				half > 0.2 &&
				(slopeAt(p.x + ox * half, p.z + oz * half) > GOLF_BANK ||
					slopeAt(p.x - ox * half, p.z - oz * half) > GOLF_BANK)
			)
				half -= 1;
			// A sliver of turf reads as a stray patch, so a fairway too narrow to stand ends there.
			return half < 4 ? 0 : half;
		};
		// A short piece of fairway reads as a stray patch on the bank, so only the long runs stand.
		const widths = line.map((_, k) => narrowTo(k));
		for (let k = 0; k < widths.length; ) {
			let end = k;
			while (end < widths.length && (widths[end] as number) > 0) end++;
			if (end - k < SHORTEST_FAIRWAY) widths.fill(0, k, end);
			k = Math.max(end, k + 1);
		}
		// A run's ends round off over some meters, as a fairway's do, in place of a wedge in one step.
		const rounded = widths.map((width, k) => {
			let toEnd = 0;
			while (
				toEnd < FAIRWAY_ROUND &&
				(widths[k - toEnd - 1] ?? 0) > 0 &&
				(widths[k + toEnd + 1] ?? 0) > 0
			)
				toEnd++;
			return width * Math.sqrt(Math.min(1, (toEnd + 0.3) / FAIRWAY_ROUND));
		});
		const onTop = (k: number) => rounded[k] as number;
		// A mower runs a stripe the length of the hole, so its light alternates across the turf, a
		// band's edge following the hole's own line. The collar's stripes are the same, softer.
		const mown = (base: Color, off: number, swing: number): Color => {
			const band = Math.floor(off / MOW_STRIPE) % 2 === 0 ? 1 + swing : 1 - swing;
			return [base[0] * band, base[1] * band, base[2] * band];
		};
		const turf: Color = [0.2, 0.365, 0.115];
		const collar: Color = [0.145, 0.28, 0.085];
		ribbon(
			b,
			line,
			(k) => onTop(k) + 3.2 * Math.min(1, onTop(k) / 4),
			(k, t) => mown(collar, t * (onTop(k) + 3.2 * Math.min(1, onTop(k) / 4)), 0.08),
			0.42,
			MOW_BANDS,
		);
		ribbon(b, line, onTop, (k, t) => mown(turf, t * onTop(k), 0.13), 0.5, MOW_BANDS);
		// The green's mowing runs along the fairway's last stretch, so its stripes cross the green
		// the way the hole plays.
		const [tail, before] = [
			line[line.length - 1] as { x: number; z: number },
			line[line.length - 2] as { x: number; z: number },
		];
		const run = hypot(tail.x - before.x, tail.z - before.z) || 1;
		const [ux, uz] = [(tail.x - before.x) / run, (tail.z - before.z) / run];
		const greenBand = (x: number, z: number, base: Color, swing: number): Color =>
			mown(base, ((x - gx) * ux + (z - gz) * uz) * 0.5, swing);
		patch(
			b,
			gx,
			gz,
			(a) => 15 + 2.4 * Math.sin(a * 3),
			(x, z) => greenBand(x, z, [0.15, 0.3, 0.08], 0.06),
			0.54,
			groundHeight,
			48,
			12,
		);
		patch(
			b,
			gx,
			gz,
			(a) => 12 + 2.2 * Math.sin(a * 3),
			(x, z) => greenBand(x, z, [0.26, 0.45, 0.15], 0.13),
			0.58,
			groundHeight,
			48,
			12,
		);
		const spots = bunkerSpots(stations);
		for (const [sx, sz, r, turn] of spots) {
			// No bunker lies on the bank, or runs off the course's top.
			if ([0, 1.57, 3.14, 4.71].some((a) => offTop(sx + Math.cos(a) * r, sz + Math.sin(a) * r)))
				continue;
			const shape = kidney(r, turn);
			patch(b, sx, sz, (a) => shape(a) + 1.8, [0.12, 0.25, 0.07], 0.6);
			patch(b, sx, sz, shape, [0.82, 0.74, 0.56], 0.64);
		}
		const [tx, tz] = [GOLF.x + first[0], GOLF.z + first[1]];
		patch(b, tx, tz, () => 3.6, [0.23, 0.42, 0.13], 0.6);
		const y = groundHeight(gx, gz) + 0.24;
		box(flags, gx - 0.03, y, gz - 0.03, gx + 0.03, y + 2.6, gz + 0.03, [0.9, 0.9, 0.88]);
		quad(
			flags,
			[gx, y + 2.1, gz],
			[gx + 0.8, y + 2.1, gz],
			[gx + 0.8, y + 2.6, gz],
			[gx, y + 2.6, gz],
			[0.75, 0.08, 0.05],
		);
		quad(
			flags,
			[gx + 0.8, y + 2.1, gz],
			[gx, y + 2.1, gz],
			[gx, y + 2.6, gz],
			[gx + 0.8, y + 2.6, gz],
			[0.75, 0.08, 0.05],
		);
	}
	const material = materials.standard({ vertexColors: true, roughness: 0.95 });
	scene.createMesh({
		mesh: geometry.fromArrays(finish(onGroundUvs(b, TURF_GRAIN_TILE))),
		material: materials.standard({
			map: grainMap(ctx, 61, 190),
			vertexColors: true,
			roughness: 0.95,
		}),
		receiveShadows: true,
	});
	scene.createMesh({ mesh: geometry.fromArrays(finish(flags)), material, castShadows: true });
}

/** A point of a park's drawn ground: its place and the height that it lies at. */
export interface ParkPoint {
	x: number;
	y: number;
	z: number;
}

/** A bench of a park, with its turn about +y. */
export interface ParkSeat extends ParkPoint {
	yaw: number;
}

/** A shrub of a park's beds, with its size. */
export interface ParkHedge extends ParkPoint {
	scale: number;
}

/** One stretch of a park's lookout wall. */
export interface ParkWall {
	a: ParkPoint;
	b: ParkPoint;
}

/** Everything that a park places, as the code draws it. */
export interface ParkPlan {
	x: number;
	z: number;
	radius: number;
	/** The park's own level, at its middle. */
	y: number;
	/** The lawn's radius before its variation at each bearing. */
	r: number;
	shape: (a: number) => number;
	walk: ParkPoint[];
	branch: ParkPoint[];
	spur: ParkPoint[];
	gazebo: ParkPoint;
	seats: ParkSeat[];
	lamps: ParkPoint[];
	hedges: ParkHedge[];
	wall: ParkWall[];
}

/** The outline of a park's lawn, as its radius at each bearing. */
function parkShape(x: number, z: number, r: number) {
	return (a: number) => r * (1 + 0.14 * Math.sin(a * 2 + x) + 0.09 * Math.sin(a * 5 + z));
}

/** A park's gravel walk, which winds around its lawn and follows the ground that it crosses. */
function parkWalk(x: number, z: number, shape: (a: number) => number) {
	const walk: ParkPoint[] = [];
	for (let t = 0; t <= 1.001; t += 0.018) {
		const a = t * Math.PI * 2 * 0.86 + 2.2;
		const rr = shape(a) * (0.72 + 0.1 * Math.sin(t * 19));
		const px = x + Math.cos(a) * rr;
		const pz = z + Math.sin(a) * rr;
		walk.push({ x: px, y: groundHeight(px, pz), z: pz });
	}
	return walk;
}

/** The gravel spur from a park's walk to the nearest street, over the ground that it crosses. */
function parkSpur(walk: readonly ParkPoint[]): ParkPoint[] {
	// The walk point nearest a street.
	let best: ParkPoint | undefined;
	let edge = Number.POSITIVE_INFINITY;
	for (let k = 2; k < walk.length - 2; k += 2) {
		const p = walk[k] as ParkPoint;
		const at = roadEdge(p.x, p.z);
		if (at < edge) [edge, best] = [at, p];
	}
	if (!best || edge <= 0) return [];
	// The nearest street point, and the spur's end at that street's edge.
	let [target, gap, half] = [best, Number.POSITIVE_INFINITY, 0];
	for (const road of ROADS)
		for (const p of road.points) {
			const d = hypot(p.x - best.x, p.z - best.z) - road.half;
			if (d < gap) [target, gap, half] = [p, d, road.half];
		}
	if (!Number.isFinite(gap) || gap <= 0) return [];
	const length = hypot(target.x - best.x, target.z - best.z) || 1;
	const reach = Math.max(0, length - half);
	const [ux, uz] = [(target.x - best.x) / length, (target.z - best.z) / length];
	const spur: ParkPoint[] = [];
	const steps = Math.max(2, Math.ceil(reach / 1.5));
	for (let k = 0; k <= steps; k++) {
		const t = k / steps;
		const px = best.x + ux * reach * t;
		const pz = best.z + uz * reach * t;
		spur.push({ x: px, y: groundHeight(px, pz), z: pz });
	}
	return spur;
}

/** The branch of a park's walk that leads to its gazebo, over the ground that it crosses. */
function parkBranch(x: number, z: number, walk: readonly { x: number; z: number }[]) {
	const [gx, gz] = [x + 3, z + 2];
	const branch: ParkPoint[] = [];
	const from = walk[Math.floor(walk.length * 0.72)] as { x: number; z: number };
	for (let t = 0; t <= 1.001; t += 0.1) {
		const px = from.x + (gx - from.x) * t + Math.sin(t * 3.14) * 2;
		const pz = from.z + (gz - from.z) * t;
		branch.push({ x: px, y: groundHeight(px, pz), z: pz });
	}
	return branch;
}

/**
 * The base that every drawn park surface lies over the ground, and the lift of each. The lifts
 * exceed the ground's own sampling error on a bank, so the terrain never rises through turf that
 * follows it.
 */
const PARK_BASE = 0.02;
const LAWN_LIFT = 0.3;
const APRON_LIFT = 0.26;
const WALK_LIFT = 0.33;
const BRANCH_LIFT = 0.34;
/** How far the apron reaches past the lawn, and the half width of the walk and the branch, in meters. */
const APRON_REACH = 3;
const WALK_STRIP = 1.5;
const BRANCH_STRIP = 1.2;
const SPUR_STRIP = 1.2;
/** The radius of a gazebo's lowest step, and how far a bench reaches around its own middle, in meters. */
const GAZEBO_STEP = 4.7;
const BENCH_REACH = 1;
/** How far a lamp's foot reaches around its own post, in meters. */
const LAMP_REACH = 0.3;
/** The half length and half depth of a bench's footprint, in meters. */
const BENCH_HALF = { along: 0.9, across: 0.27 } as const;

/** How far a point stands from a line of points on the ground, in meters. */
function gapToLine(line: readonly { x: number; z: number }[], x: number, z: number): number {
	let least = Number.POSITIVE_INFINITY;
	for (let k = 0; k + 1 < line.length; k++) {
		const a = line[k] as { x: number; z: number };
		const b = line[k + 1] as { x: number; z: number };
		const dx = b.x - a.x;
		const dz = b.z - a.z;
		const length2 = dx * dx + dz * dz || 1;
		const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length2));
		least = Math.min(least, hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
	}
	return least;
}

/**
 * The height of the surface that a park draws at a place: its gravel walk or branch, its lawn, the
 * apron past the lawn, or the open ground off the park. Every surface follows the ground that it
 * crosses, lifted only by its own layer.
 */
export function parkSurface(plan: ParkPlan, x: number, z: number): number {
	const [dx, dz] = [x - plan.x, z - plan.z];
	const d = hypot(dx, dz);
	const edge = plan.shape(Math.atan2(dz, dx));
	const ground = groundHeight(x, z);
	let height = Number.NEGATIVE_INFINITY;
	if (gapToLine(plan.walk, x, z) <= WALK_STRIP) height = ground + PARK_BASE + WALK_LIFT;
	if (gapToLine(plan.branch, x, z) <= BRANCH_STRIP)
		height = Math.max(height, ground + PARK_BASE + BRANCH_LIFT);
	if (gapToLine(plan.spur, x, z) <= SPUR_STRIP)
		height = Math.max(height, ground + PARK_BASE + WALK_LIFT);
	if (d <= edge) height = Math.max(height, ground + PARK_BASE + LAWN_LIFT);
	else if (d <= edge + APRON_REACH) height = Math.max(height, ground + PARK_BASE + APRON_LIFT);
	return height > Number.NEGATIVE_INFINITY ? height : ground;
}

/** The highest surface under a bench's footprint, so that the bench rests on it. */
function seatHeight(plan: ParkPlan, x: number, z: number, yaw: number): number {
	const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
	const us = [-BENCH_HALF.along, 0, BENCH_HALF.along];
	const vs = [-BENCH_HALF.across, 0, BENCH_HALF.across];
	let highest = Number.NEGATIVE_INFINITY;
	for (const u of us)
		for (const v of vs)
			highest = Math.max(highest, parkSurface(plan, x + u * c + v * s, z - u * s + v * c));
	return highest;
}

/**
 * Every park's drawn ground and the objects on it. A bench stands clear of the gazebo's stepped
 * base and on the surface under its footprint, and a lamp stands on the surface under its base.
 */
export function parkPlans(): ParkPlan[] {
	return PARKS.map(([x, z, radius]) => {
		const y = groundHeight(x, z);
		const r = radius * 0.72;
		const shape = parkShape(x, z, r);
		const walk = parkWalk(x, z, shape);
		const branch = parkBranch(x, z, walk);
		const spur = parkSpur(walk);
		const gate =
			spur.length > 1
				? Math.atan2(
						(spur[spur.length - 1] as ParkPoint).z - z,
						(spur[spur.length - 1] as ParkPoint).x - x,
					)
				: NaN;
		const [gx, gz] = [x + 3, z + 2];
		const plan: ParkPlan = {
			x,
			z,
			radius,
			y,
			r,
			shape,
			walk,
			branch,
			spur,
			gazebo: { x: gx, y: groundHeight(gx, gz) + PARK_BASE + LAWN_LIFT, z: gz },
			seats: [],
			lamps: [],
			hedges: [],
			wall: [],
		};
		walk.forEach((p, k) => {
			if (k % 8 !== 2) return;
			const q = walk[Math.min(walk.length - 1, k + 1)] as ParkPoint;
			const along = Math.atan2(q.z - p.z, q.x - p.x);
			// A bench stands on the walk's near side, or on the far side where the near side would
			// stand in the gazebo's steps or block the branch to the gazebo.
			for (const side of [1, -1]) {
				const at = {
					x: p.x - side * Math.sin(along) * 2.2,
					z: p.z + side * Math.cos(along) * 2.2,
				};
				if (hypot(at.x - gx, at.z - gz) < GAZEBO_STEP + BENCH_REACH) continue;
				if (gapToLine(branch, at.x, at.z) < BRANCH_STRIP + BENCH_HALF.across) continue;
				const yaw = side > 0 ? -along : Math.PI - along;
				plan.seats.push({ ...at, y: seatHeight(plan, at.x, at.z, yaw), yaw });
				break;
			}
		});
		// A lamp stands clear of every bench, on either side of the walk, and on the surface below it.
		walk.forEach((p, k) => {
			if (k % 13 !== 6) return;
			for (const side of [1, -1]) {
				const x = p.x + side * Math.sin(k) * 2;
				const z = p.z + side * Math.cos(k) * 2;
				if (plan.seats.some((seat) => hypot(seat.x - x, seat.z - z) < BENCH_REACH + LAMP_REACH))
					continue;
				plan.lamps.push({ x, y: parkSurface(plan, x, z), z });
				break;
			}
		});
		// Beds of leafy shrubs lie along the lawn's edge, thick around the gazebo. Each bed sits on the
		// ground that it grows on.
		for (let k = 0; k < 54; k++) {
			const a = (k / 54) * Math.PI * 2;
			const rr = shape(a) + 1.5 + ((k * 7) % 5) * 0.5;
			if (Math.abs(Math.atan2(Math.sin(a - gate), Math.cos(a - gate))) < 0.22) continue;
			const [hx, hz] = [x + Math.cos(a) * rr, z + Math.sin(a) * rr];
			plan.hedges.push({
				x: hx,
				y: groundHeight(hx, hz) + PARK_BASE + APRON_LIFT,
				z: hz,
				scale: 0.8 + ((k * 3) % 4) * 0.25,
			});
		}
		for (let k = 0; k < 14; k++) {
			const a = (k / 14) * Math.PI * 2;
			const [hx, hz] = [gx + Math.cos(a) * 6.5, gz + Math.sin(a) * 6.5];
			plan.hedges.push({
				x: hx,
				y: groundHeight(hx, hz) + PARK_BASE + LAWN_LIFT,
				z: hz,
				scale: 0.6 + (k % 3) * 0.25,
			});
		}
		// A low stone wall stands at the lookout, on the park's downhill side, and follows the ground.
		for (let a = 1; a < 2.4; a += 0.08) {
			const [ra, rb] = [shape(a) + 5, shape(a + 0.08) + 5];
			const [ax, az] = [x + Math.cos(a) * ra, z + Math.sin(a) * ra];
			const [bx, bz] = [x + Math.cos(a + 0.08) * rb, z + Math.sin(a + 0.08) * rb];
			// No wall crosses a street that passes the park.
			if (Math.min(roadEdge(ax, az), roadEdge(bx, bz)) < 1) continue;
			plan.wall.push({
				a: { x: ax, y: groundHeight(ax, az), z: az },
				b: { x: bx, y: groundHeight(bx, bz), z: bz },
			});
		}
		return plan;
	});
}

/** The lawns of the parks, for grass: each one's square, the ground that it follows, and where it lies. */
export function parkLawns() {
	return parkPlans().map((plan) => {
		const { x, z, r, shape, walk } = plan;
		const paths = [...walk, ...plan.branch, ...plan.spur];
		return {
			x,
			z,
			size: r * 2.6,
			height: (px: number, pz: number) => groundHeight(px, pz) + PARK_BASE + LAWN_LIFT,
			where: (px: number, pz: number) => {
				const [dx, dz] = [px - x, pz - z];
				const inside = shape(Math.atan2(dz, dx)) - 0.3 - hypot(dx, dz);
				if (inside <= 0) return false;
				// The grass thins to nothing over the lawn's last half metre, so its outline reads as
				// a fading cover rather than a line.
				if (inside < LAWN_EDGE_FADE && edgeHash(px, pz) > inside / LAWN_EDGE_FADE) return false;
				if (hypot(px - (x + 3), pz - (z + 2)) < GAZEBO_CLEAR) return false;
				// The points along a walk stand about 2 m apart, so this also covers the walk between them.
				return !paths.some((p) => hypot(px - p.x, pz - p.z) < WALK_CLEAR);
			},
		};
	});
}

/** A fixed value from 0 to 1 at each place, so a thinned cover breaks up the same way on every run. */
function edgeHash(x: number, z: number): number {
	// The place in sixteenths of a meter as integers, then a 32-bit mix, so every engine gives the
	// same fringe.
	let h = Math.imul(Math.round(x * 16), 0x27d4eb2d) ^ Math.imul(Math.round(z * 16), 0x165667b1);
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

/** The parks: mottled lawns with a winding gravel walk, a gazebo, benches, hedges, lamps and a low wall. */
/** How far grass keeps from a walk and a gazebo, in meters. */
const WALK_CLEAR = 2;
const GAZEBO_CLEAR = 7;
/** The last stretch of a lawn, in meters, over which its cover and its colour fade into the ground. */
const LAWN_EDGE_FADE = 0.5;

function createParks(ctx: SketchContext, surfaces: Surfaces): InstanceBatch {
	const { scene, geometry, materials } = ctx;
	const b = build();
	const walls = build();
	const seats: ParkSeat[] = [];
	const hedges: ParkHedge[] = [];
	const lamps: ParkPoint[] = [];
	const lawn: Color = [0.15, 0.26, 0.07];
	const gravel: Color = [0.5, 0.45, 0.34];
	for (const plan of parkPlans()) {
		const { x, z, shape, walk, branch, spur, gazebo } = plan;
		// An uneven lawn, and a gravel walk that winds around it with a branch to the gazebo. Every
		// layer follows the ground that it crosses, so the park meets the hillside at its rim. The lawn
		// fades into its darker apron over its last half metre, so its outline does not read as a line.
		const apron: Color = [0.1, 0.18, 0.05];
		patch(
			b,
			x,
			z,
			(a) => shape(a) + APRON_REACH,
			apron,
			PARK_BASE + APRON_LIFT,
			groundHeight,
			64,
			12,
		);
		patch(
			b,
			x,
			z,
			shape,
			(px, pz) => {
				const [dx, dz] = [px - x, pz - z];
				const edge = shape(Math.atan2(dz, dx));
				const t = Math.min(1, Math.max(0, (edge - hypot(dx, dz)) / LAWN_EDGE_FADE));
				const k = t * t * (3 - 2 * t);
				return [
					(apron[0] as number) + ((lawn[0] as number) - (apron[0] as number)) * k,
					(apron[1] as number) + ((lawn[1] as number) - (apron[1] as number)) * k,
					(apron[2] as number) + ((lawn[2] as number) - (apron[2] as number)) * k,
				];
			},
			PARK_BASE + LAWN_LIFT,
			groundHeight,
			64,
			12,
		);
		ribbon(
			b,
			walk,
			() => WALK_STRIP,
			() => gravel,
			PARK_BASE + WALK_LIFT,
		);
		ribbon(
			b,
			branch,
			() => BRANCH_STRIP,
			() => gravel,
			PARK_BASE + BRANCH_LIFT,
		);
		ribbon(
			b,
			spur,
			() => SPUR_STRIP,
			() => gravel,
			PARK_BASE + WALK_LIFT,
		);
		const hall = pavilion();
		const place = [gazebo.x, gazebo.y, gazebo.z] as [number, number, number];
		scene.createMesh({
			mesh: geometry.fromArrays(finish(hall.stone)),
			material: surfaces.ashlar,
			position: place,
			castShadows: true,
			receiveShadows: true,
		});
		scene.createMesh({
			mesh: geometry.fromArrays(finish(hall.roof)),
			material: surfaces.tile,
			position: place,
			castShadows: true,
			receiveShadows: true,
		});
		seats.push(...plan.seats);
		lamps.push(...plan.lamps);
		hedges.push(...plan.hedges);
		for (const { a, b: c } of plan.wall) wallStretch(walls, a, c, 0.7, [0.9, 0.86, 0.78]);
	}
	const material = materials.standard({ vertexColors: true, roughness: 0.92 });
	scene.createMesh({ mesh: geometry.fromArrays(finish(b)), material, receiveShadows: true });
	scene.createMesh({
		mesh: geometry.fromArrays(finish(walls)),
		material: surfaces.rubble,
		castShadows: true,
		receiveShadows: true,
	});
	const benches = scene.createInstances(geometry.fromArrays(finish(bench())), seats.length, {
		material,
		castShadows: true,
		receiveShadows: true,
	});
	seats.forEach((p, k) => {
		row(benches, k, p.x, p.y, p.z, p.yaw);
	});
	benches.markDirty();
	const posts = scene.createInstances(geometry.fromArrays(finish(streetLamp())), lamps.length, {
		material: materials.standard({ vertexColors: true, roughness: 0.6 }),
		castShadows: true,
	});
	lamps.forEach((p, k) => {
		row(posts, k, p.x, p.y, p.z, 0);
	});
	posts.markDirty();
	const green = scene.createInstances(geometry.fromArrays(finish(shrub())), hedges.length, {
		material: materials.standard({ vertexColors: true, roughness: 0.95, doubleSided: true }),
		colors: true,
		castShadows: true,
		receiveShadows: true,
	});
	hedges.forEach((p, k) => {
		const tint =
			k % 11 === 0 ? [0.5, 0.06, 0.26, 1] : k % 3 ? [0.11, 0.22, 0.07, 1] : [0.17, 0.27, 0.09, 1];
		row(green, k, p.x, p.y, p.z, k * 1.7, tint, p.scale);
	});
	green.markDirty();
	return benches;
}

/** The keeps on the hilltops: each stands on the crest, at the middle of its village. */
function createKeeps(ctx: SketchContext, surfaces: Surfaces): Object3D[] {
	const { scene, geometry } = ctx;
	const mesh = geometry.fromArrays(finish(keep()));
	scene.createMesh({
		mesh: geometry.fromArrays(finish(stairsMesh())),
		material: surfaces.rubble,
		receiveShadows: true,
	});
	scene.createMesh({
		mesh: geometry.fromArrays(finish(courtWalkMesh())),
		material: surfaces.rubble,
		castShadows: true,
		receiveShadows: true,
	});
	return KEEPS.map(([x, z, y]) =>
		scene.createMesh({
			mesh,
			material: surfaces.rubble,
			position: [x, y, z],
			castShadows: true,
			receiveShadows: true,
		}),
	);
}

/**
 * The kit boulder's size, in meters, which its rows were set for: the mean of its two spans across
 * the ground, from 1.78 m and 2.53 m, and its height.
 */
const KIT_ROCK = { across: 2.15, tall: 1.94 } as const;
/**
 * How far each rock form grows to stand at the kit boulder's size. Each form measures 2.74 x 1.09
 * x 1.97 m, 4.09 x 0.81 x 1.89 m and 1.83 x 1.60 x 1.65 m in its file: one factor across the
 * ground, from the mean of its two spans, keeps its own footprint, and one in height squares its
 * flatness with the kit boulder's.
 */
const ROCK_FITS: Readonly<Partial<Record<PropForm, readonly [number, number, number]>>> = {
	'rock-a': [KIT_ROCK.across / 2.355, KIT_ROCK.tall / 1.09, KIT_ROCK.across / 2.355],
	'rock-b': [KIT_ROCK.across / 2.99, KIT_ROCK.tall / 0.81, KIT_ROCK.across / 2.99],
	'rock-c': [KIT_ROCK.across / 1.74, KIT_ROCK.tall / 1.6, KIT_ROCK.across / 1.74],
};

/** The rocks of the coast: angular boulders in several sizes, tumbled below the cliffs and offshore. */
function createRocks(ctx: SketchContext): InstanceBatch {
	const { scene, geometry } = ctx;
	const next = random(1009);
	const rocks: { x: number; y: number; z: number; scale: number }[] = [];
	for (let k = 0; k < 260000 && rocks.length < 6000; k++) {
		const x = (next() * 2 - 1) * 800;
		const z = (next() * 2 - 1) * 560;
		const d = inland(x, z);
		if (d > 8 || d < -16) continue;
		if (hypot(x - BAY.x, z - BAY.z) < BAY.radius + 30) {
			const a = Math.atan2(z - BAY.z, x - BAY.x);
			const t = ((BAY.from - a + Math.PI * 4) % (Math.PI * 2)) / -BAY.sweep;
			if (t < 1.03) continue;
		}
		if (hypot((x - HARBOUR.x) / (HARBOUR.rx + 30), (z - HARBOUR.z) / (HARBOUR.rz + 22)) < 1)
			continue;
		// Rocks lie in heaps along the coast, with stretches of smaller stones between them.
		const heap = noise.fbm2(x * 0.03 + 8, z * 0.03, 2) > -0.04;
		if (!heap && next() > 0.3) continue;
		const size = next();
		rocks.push({
			x,
			y: groundHeight(x, z),
			z,
			scale: heap
				? size < 0.5
					? 0.8 + size * 2
					: size < 0.85
						? 1.8 + size * 2
						: 3.5 + size * 3
				: 0.4 + size * 0.7,
		});
	}
	const batch = scene.createInstances(geometry.fromArrays(finish(boulder())), rocks.length, {
		material: wetRock(ctx),
		layers: INTERIOR_LAYER,
		castShadows: true,
		receiveShadows: true,
	});
	rocks.forEach((rock, k) => {
		row(
			batch,
			k,
			rock.x,
			Math.max(rock.y, -1.4) + rock.scale * 0.1,
			rock.z,
			next() * 6.3,
			undefined,
			rock.scale,
		);
		// Each rock is flattened and stretched its own way, so the coast shows ledges and not beads.
		batch.scales.set(
			[
				rock.scale * (0.9 + next() * 0.9),
				rock.scale * (0.45 + next() * 0.5),
				rock.scale * (0.8 + next() * 0.7),
			],
			k * 3,
		);
	});
	batch.markDirty();
	return batch;
}

/** The bare knob under the highest keep: the band of its cone that scrub and rock fill, in meters. */
const KNOB_NEAR = 12;
const KNOB_FAR = 30;
/** The clearance that a knob plant keeps from a stair's treads, in meters. */
const KNOB_STAIR_CLEAR = 3;
/** The least steepness of the cone that a knob plant takes, as rise over run. */
const KNOB_SLOPE = 0.35;
/** The tints of the knob's scrub: olive and lentisk greens, with a share of grey-green. */
const SCRUB_TINTS = [
	[0.2, 0.3, 0.14, 1],
	[0.25, 0.36, 0.17, 1],
	[0.3, 0.4, 0.2, 1],
	[0.23, 0.3, 0.17, 1],
	[0.36, 0.42, 0.26, 1],
] as const;
/** The tints that take the knob's loose stone from the earth's brown toward a cool limestone. */
const KNOB_ROCK_TINTS = [
	[1.2, 1.26, 1.32, 1],
	[1.04, 1.08, 1.12, 1],
	[1.32, 1.3, 1.28, 1],
	[0.9, 0.92, 0.96, 1],
] as const;

/** A place on the knob that takes a plant, with its own turn, size and tint. */
interface KnobSpot {
	x: number;
	y: number;
	z: number;
	turn: number;
	scale: number;
	tint: readonly number[];
}

/**
 * Plants the bare knob under the highest keep, and buries the court wall's corners and foot in stone.
 * The scrub and the rocks keep off the court, the stair through the knob, and the ground too flat to
 * be the cone, so they read as grown on its slope.
 */
function createKnob(ctx: SketchContext): void {
	const { scene, geometry, materials } = ctx;
	const [kx, kz] = KEEPS[0] as readonly [number, number, number];
	// The climb through the knob keeps clear of plants.
	const climb: { x: number; z: number }[] = [];
	for (const stair of STAIRS)
		for (const p of stairTreads(stair))
			if (hypot(p.x - kx, p.z - kz) < KNOB_FAR) climb.push({ x: p.x, z: p.z });
	const onClimb = (x: number, z: number) =>
		climb.some((p) => hypot(p.x - x, p.z - z) < KNOB_STAIR_CLEAR);
	const fits = (x: number, z: number) => {
		const r = hypot(x - kx, z - kz);
		return (
			r >= KNOB_NEAR &&
			r < KNOB_FAR &&
			!(Math.abs(x - kx) < 12.4 && Math.abs(z - kz) < 12.4) &&
			roadEdge(x, z) > 1 &&
			!onClimb(x, z) &&
			slopeAt(x, z) > KNOB_SLOPE
		);
	};
	// Stones break in patches across the cone, so the scatter reads as outcrops and not as gravel.
	const patchy = (x: number, z: number, least: number) =>
		noise.fbm2(x * 0.09 + 11, z * 0.09 - 4, 2) > least;
	const rock = random(731);
	const scrubNext = random(947);
	const rocks: (KnobSpot & { shape: readonly [number, number, number] })[] = [];
	const scrub: KnobSpot[] = [];
	const addRock = (x: number, z: number, y: number, scale: number) => {
		rocks.push({
			x,
			y: y - scale * 0.22,
			z,
			turn: rock() * 6.3,
			scale,
			// Each stone is flattened and stretched its own way, so a heap shows ledges and not beads.
			shape: [0.8 + rock() * 0.35, 0.68 + rock() * 0.32, 0.78 + rock() * 0.35],
			tint: KNOB_ROCK_TINTS[Math.floor(rock() * KNOB_ROCK_TINTS.length)] as readonly number[],
		});
	};
	const addScrub = (x: number, z: number, y: number, scale: number) => {
		scrub.push({
			x,
			y: y - scale * 0.08,
			z,
			turn: scrubNext() * 6.3,
			scale,
			tint: SCRUB_TINTS[Math.floor(scrubNext() * SCRUB_TINTS.length)] as readonly number[],
		});
	};
	/**
	 * Heaps stone and bushes over a point of the wall's foot. The wall's base meets the bank in a
	 * sharp line, so the heaps take that line into the slope, largest at the wall and smaller down
	 * the bank.
	 */
	const bury = (x: number, z: number, reach: number, stones: number, bushes: number) => {
		const foot = groundHeight(x, z);
		for (let k = 0; k < stones; k++) {
			const a = rock() * 6.3;
			const r = Math.sqrt(rock()) * reach;
			const at = [x + Math.cos(a) * r, z + Math.sin(a) * r] as const;
			const scale = 1.05 + rock() * 1.5 - (r / reach) * 0.6;
			addRock(at[0], at[1], Math.max(groundHeight(at[0], at[1]), foot - r), scale);
		}
		for (let k = 0; k < bushes; k++) {
			const a = scrubNext() * 6.3;
			const r = 0.4 + scrubNext() * reach * 1.2;
			const at = [x + Math.cos(a) * r, z + Math.sin(a) * r] as const;
			addScrub(at[0], at[1], groundHeight(at[0], at[1]), 1 + scrubNext() * 1.2);
		}
	};
	// The court's outer corners, where its walls meet the falling bank.
	for (const [cx, cz] of [
		[-11, -11],
		[11, -11],
		[-11, 11],
		[11, 11],
	] as const)
		bury(kx + cx, kz + cz, 3, 8, 6);
	// Along each wall's outer foot, a low line of loose stone ties the wall into the bank. The
	// court's front is open, so no run crosses the tower's gate.
	const feet: readonly {
		from: readonly [number, number];
		to: readonly [number, number];
		out: readonly [number, number];
	}[] = [
		{ from: [-10.5, -11], to: [10.5, -11], out: [0, -1] },
		{ from: [-11, -10.5], to: [-11, 10.5], out: [-1, 0] },
		{ from: [11, -10.5], to: [11, 10.5], out: [1, 0] },
	];
	for (const { from, to, out } of feet) {
		const length = hypot(to[0] - from[0], to[1] - from[1]);
		for (let s = 0; s <= length; s += 2.4) {
			const t = s / length;
			const off = 0.4 + rock() * 0.8;
			const x = kx + from[0] + (to[0] - from[0]) * t + out[0] * off;
			const z = kz + from[1] + (to[1] - from[1]) * t + out[1] * off;
			addRock(x, z, groundHeight(x, z), 0.5 + rock() * 0.8);
			if (rock() > 0.45) {
				const bx = kx + from[0] + (to[0] - from[0]) * t + out[0] * (off + 0.8);
				const bz = kz + from[1] + (to[1] - from[1]) * t + out[1] * (off + 0.8);
				addScrub(bx, bz, groundHeight(bx, bz), 0.5 + scrubNext() * 0.5);
			}
		}
	}
	// Loose stone and scrub across the cone, in clumps, so the slope reads as patches of growth
	// with bare ground between them.
	for (let attempt = 0; attempt < 600 && rocks.length < 190; attempt++) {
		const a = rock() * Math.PI * 2;
		const r = KNOB_NEAR + Math.sqrt(rock()) * (KNOB_FAR - KNOB_NEAR);
		const cx = kx + Math.cos(a) * r;
		const cz = kz + Math.sin(a) * r;
		if (!fits(cx, cz) || !patchy(cx, cz, -0.1)) continue;
		for (let k = 0, n = 4 + Math.floor(rock() * 6); k < n; k++) {
			const b = rock() * 6.3;
			const d = Math.sqrt(rock()) * 3;
			const x = cx + Math.cos(b) * d;
			const z = cz + Math.sin(b) * d;
			if (!fits(x, z)) continue;
			addRock(x, z, groundHeight(x, z), 0.4 + rock() * 1);
		}
	}
	for (let attempt = 0; attempt < 600 && scrub.length < 620; attempt++) {
		const a = scrubNext() * Math.PI * 2;
		const r = KNOB_NEAR + Math.sqrt(scrubNext()) * (KNOB_FAR - KNOB_NEAR);
		const cx = kx + Math.cos(a) * r;
		const cz = kz + Math.sin(a) * r;
		if (!fits(cx, cz) || !patchy(cx, cz, -0.18)) continue;
		// A clump spreads down the slope, its bushes larger in the middle than at the edge.
		for (let k = 0, n = 7 + Math.floor(scrubNext() * 9); k < n; k++) {
			const b = scrubNext() * 6.3;
			const d = Math.sqrt(scrubNext()) * 3.6;
			const x = cx + Math.cos(b) * d;
			const z = cz + Math.sin(b) * d;
			if (!fits(x, z)) continue;
			addScrub(x, z, groundHeight(x, z), 1.3 + scrubNext() * 1.7 - (d / 3.6) * 0.5);
		}
	}
	const stone = scene.createInstances(geometry.fromArrays(finish(boulder())), rocks.length, {
		material: materials.standard({ vertexColors: true, roughness: 1 }),
		colors: true,
		layers: INTERIOR_LAYER,
		castShadows: true,
		receiveShadows: true,
	});
	rocks.forEach((r, k) => {
		row(stone, k, r.x, r.y, r.z, r.turn, r.tint, r.scale);
		stone.scales.set([r.scale * r.shape[0], r.scale * r.shape[1], r.scale * r.shape[2]], k * 3);
	});
	stone.markDirty();
	const bushes = scene.createInstances(geometry.fromArrays(finish(shrub(140))), scrub.length, {
		material: materials.standard({ vertexColors: true, roughness: 0.95, doubleSided: true }),
		colors: true,
		castShadows: true,
		receiveShadows: true,
	});
	scrub.forEach((s, k) => {
		row(bushes, k, s.x, s.y, s.z, s.turn, s.tint, s.scale);
		// A bush spreads wider than it rises, as scrub does on open ground.
		bushes.scales.set([s.scale * 1.35, s.scale * 0.85, s.scale * 1.35], k * 3);
	});
	bushes.markDirty();
}

/** Street lamps along the town's streets and around the square. */
function createLamps(ctx: SketchContext): void {
	const { scene, geometry, materials } = ctx;
	const places: { x: number; y: number; z: number }[] = [];
	for (const { points, half } of ROADS) {
		if (half < LANE) continue;
		for (let k = 14; k < points.length; k += 14) {
			const p = points[k];
			const q = points[k - 1];
			if (!p || !q || townShare(p.x, p.z) < 0.5 || hypot(p.x - TOWN.x, p.z - TOWN.z) > 260)
				continue;
			const length = hypot(p.x - q.x, p.z - q.z) || 1;
			const x = p.x - ((p.z - q.z) / length) * (half + 0.5);
			const z = p.z + ((p.x - q.x) / length) * (half + 0.5);
			// A lamp stands on the drawn shoulder, whose surface sits below the road's own line over
			// the cut ground, rather than on that cut ground.
			places.push({ x, y: p.y + ROAD_LIFT - 0.05, z });
		}
	}
	const { x, z, hx, hz } = SQUARE;
	for (const [dx, dz] of [
		[-0.7, -0.4],
		[0.7, -0.4],
		[-0.7, 0.5],
		[0.7, 0.5],
		[-0.3, 0.95],
		[0.3, 0.95],
	] as const) {
		const [lx, lz] = [x + dx * hx, z + dz * hz];
		places.push({ x: lx, y: squarePavingHeight(lx, lz), z: lz });
	}
	const lamps = scene.createInstances(geometry.fromArrays(finish(streetLamp())), places.length, {
		material: materials.standard({ vertexColors: true, roughness: 0.6 }),
		castShadows: true,
	});
	places.forEach((p, k) => {
		row(lamps, k, p.x, p.y, p.z, 0);
	});
	lamps.markDirty();
}

/** Draws everything that the town plan places, apart from its trees. */
export function createTown(ctx: SketchContext): Promise<void> {
	const { scene, geometry, materials } = ctx;
	const surfaces: Surfaces = {
		plaster: materials.standard({
			map: plasterMap(ctx),
			vertexColors: true,
			roughness: 1,
			specularIntensity: 0.2,
		}),
		rubble: materials.standard({
			map: rubbleMap(ctx),
			vertexColors: true,
			roughness: 1,
			specularIntensity: 0.15,
			uvTransform: { repeat: [0.6, 0.6] },
		}),
		ashlar: materials.standard({
			map: ashlarMap(ctx),
			vertexColors: true,
			roughness: 0.9,
			uvTransform: { repeat: [0.42, 0.42] },
		}),
		tile: materials.standard({
			map: tileMap(ctx),
			vertexColors: true,
			roughness: 0.8,
			uvTransform: { repeat: [0.5, 0.5] },
		}),
	};
	scene.createMesh({
		mesh: geometry.fromArrays(finish(onGroundUvs(roadMesh(), ROAD_GRAIN_TILE))),
		material: materials.standard({
			map: roadGrainMap(ctx),
			vertexColors: true,
			roughness: 1,
			specularIntensity: 0.12,
		}),
		receiveShadows: true,
		castShadows: false,
	});
	scene.createMesh({
		mesh: geometry.fromArrays(finish(stoneWalls().mesh)),
		material: surfaces.rubble,
		receiveShadows: true,
		castShadows: true,
	});
	const houses = createHouses(ctx, surfaces);
	createClimbers(ctx);
	const square = createSquare(ctx, surfaces);
	const harbour = createHarbour(ctx, surfaces);
	const parasols = createBeach(ctx);
	createGolf(ctx);
	const benches = createParks(ctx, surfaces);
	const keeps = createKeeps(ctx, surfaces);
	const coast = createRocks(ctx);
	createKnob(ctx);
	createLamps(ctx);
	return settleLandmarks(ctx, {
		church: square.church,
		churchY: square.churchY,
		lighthouse: harbour.lighthouse,
		lighthouseAt: harbour.at,
		keeps,
		houses,
		props: {
			sailboats: harbour.sailboats,
			skiffs: harbour.skiffs,
			stones: harbour.stones,
			parasols,
			benches,
			coast,
		},
	});
}

/** What the code-built kit stands for each landmark until the models arrive. */
interface KitLandmarks {
	readonly church: readonly Object3D[];
	readonly churchY: number;
	readonly lighthouse: readonly Object3D[];
	readonly lighthouseAt: readonly [number, number, number];
	readonly keeps: readonly Object3D[];
	readonly houses: KitHouses;
	readonly props: {
		readonly sailboats: InstanceBatch;
		readonly skiffs: InstanceBatch;
		readonly stones: InstanceBatch;
		readonly parasols: InstanceBatch;
		readonly benches: InstanceBatch;
		readonly coast: InstanceBatch;
	};
}

/**
 * Replaces the code-built landmarks with the model file's parts once it lands. A page without the
 * sample file keeps the kit, so the demo runs before the asset is published. The load starts after
 * the town is built, so it never holds up the first frame.
 */
async function settleLandmarks(ctx: SketchContext, kit: KitLandmarks): Promise<void> {
	// The two model files load together. Either may fail without losing the other's models.
	const [models, houseModels, props] = await Promise.all([
		loadLandmarks(ctx).catch((error) => {
			console.warn(
				'island: the landmark models are unavailable, so the code-built landmarks stand',
				error,
			);
			return undefined;
		}),
		loadHouses(ctx).catch((error) => {
			console.warn(
				'island: the house models are unavailable, so the code-built houses stand',
				error,
			);
			return undefined;
		}),
		loadProps(ctx).catch((error) => {
			console.warn('island: the prop models are unavailable, so the code-built props stand', error);
			return undefined;
		}),
	]);
	const placed: InstanceBatch[] = [];
	const stand = (part: Part, x: number, y: number, z: number, yaw = 0): void => {
		placed.push(standPart(ctx, part, [{ x, y, z, yaw, size: 1 }], part.material));
	};
	/**
	 * Stands one landmark's parts. If any part cannot stand, it takes back the ones it did and
	 * leaves the code-built form in place, so one missing part never costs the other landmarks.
	 */
	const place = (
		what: string,
		parts: readonly (Part | undefined)[],
		at: (part: Part) => void,
	): boolean => {
		const before = placed.length;
		try {
			for (const part of parts) if (part) at(part);
			return true;
		} catch (error) {
			for (const batch of placed.splice(before)) batch.destroy();
			console.warn(
				`island: the ${what} model could not stand, so its code-built form stays`,
				error,
			);
			return false;
		}
	};
	if (models) {
		if (
			place('church', Object.values(models.church), (part) =>
				stand(part, CHURCH_AT.x, kit.churchY, CHURCH_AT.z),
			)
		)
			for (const object of kit.church) object.destroy();
		if (
			place('keep', Object.values(models.keep), (part) => {
				for (const [x, z, y] of KEEPS) stand(part, x, y, z);
			})
		)
			for (const object of kit.keeps) object.destroy();
		const [lx, ly, lz] = kit.lighthouseAt;
		if (place('lighthouse', Object.values(models.lighthouse), (part) => stand(part, lx, ly, lz)))
			for (const object of kit.lighthouse) object.destroy();
		// The three waterfront houses go in together: a part that fails takes back all three, so the
		// kit is never doubled on one lot.
		const waterfrontFrom = placed.length;
		let waterfront = true;
		WATERFRONT_LOTS.forEach((lot, i) => {
			const house = models.waterfront[i];
			if (!house) {
				waterfront = false;
				return;
			}
			if (
				!place(`waterfront ${i + 1}`, Object.values(house), (part) =>
					stand(part, lot.x, lot.y, lot.z, lot.yaw),
				)
			)
				waterfront = false;
		});
		if (waterfront) for (const batch of kit.houses.waterfront) batch.destroy();
		else for (const batch of placed.splice(waterfrontFrom)) batch.destroy();
	}
	// The houses stand over every lot but the harbour front, which the landmark file owns.
	if (houseModels) {
		const lots: HouseLot[] = LOTS.filter((lot) => !WATERFRONT_LOTS.includes(lot)).map((lot) => ({
			x: lot.x,
			y: lot.y,
			z: lot.z,
			yaw: lot.yaw,
			kind: lot.kind,
		}));
		const stands = standsByKind(lots, HOUSE_KINDS.length);
		houseModels.forEach((model, kind) => {
			if (!model) return;
			const where = stands[kind] ?? [];
			if (where.length === 0) return;
			try {
				standHouse(ctx, model, where);
				for (const batch of kit.houses.byKind[kind] ?? []) batch.destroy();
			} catch (error) {
				console.warn(
					`island: the ${model.form} house model could not stand, so its code-built form stays`,
					error,
				);
			}
		});
	}
	// Every prop model takes its code-built batch's own rows; a failed form keeps its kit.
	if (props) {
		const swap = (kitBatch: InstanceBatch, standings: readonly ModelStanding[]): void => {
			if (standings.length === 0) return;
			try {
				replaceBatch(ctx, kitBatch, standings);
			} catch (error) {
				console.warn('island: a prop model could not stand, so its code-built form stays', error);
			}
		};
		// A stone's origin is its base; the code-built boulder's origin lay 0.9 m above it.
		const stone = {
			material: (part: Part) => wetStone(ctx, part),
			drop: 0.9,
			layers: INTERIOR_LAYER,
			fits: ROCK_FITS,
		};
		try {
			replaceWithForms(ctx, props.rocks, kit.props.stones, { ...stone, castShadows: false });
			replaceWithForms(ctx, props.rocks, kit.props.coast, { ...stone, castShadows: true });
		} catch (error) {
			console.warn('island: a stone model could not stand, so its code-built stones stay', error);
		}
		const yachts: ModelStanding[] = props.yacht
			? [{ model: props.yacht, options: { castShadows: false } }]
			: [];
		swap(kit.props.sailboats, yachts);
		const skiffs: ModelStanding[] = props.skiff
			? [{ model: props.skiff, options: { castShadows: false, tint: ['hull'] } }]
			: [];
		swap(kit.props.skiffs, skiffs);
		// The parasol and its two loungers go in together, so a missing part keeps the kit whole.
		const spots = standsOf(kit.props.parasols);
		if (props.parasol && props.lounger)
			swap(kit.props.parasols, [
				{ model: props.parasol, options: { castShadows: true, tint: ['canvas'] } },
				{
					model: props.lounger,
					stands: loungerStands(spots, groundHeight),
					options: { castShadows: true },
				},
			]);
		const benches: ModelStanding[] = props.bench
			? [{ model: props.bench, options: { castShadows: true } }]
			: [];
		swap(kit.props.benches, benches);
	}
}
