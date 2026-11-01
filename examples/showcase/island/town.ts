// What the plan's places hold: the roads with their stone walls and driveways, the houses with their
// gardens, the church on its small round piazza with a stepped fountain and cafe tables, the harbour
// with its quay wall, moles, pontoons, breakwater and moored boats, the beach with its parasols, the
// golf course, the park, the hilltop keeps, the rocks of the coast and the street lamps. Each repeated
// thing is one mesh in an instance batch.
import { type InstanceBatch, quat, type SketchContext, type Texture } from '@null3d/engine';
import { INTERIOR_LAYER } from '../../lib/layers';
import { Noise, random } from '../../lib/procedural';
import { WAY_HALF } from './ground';
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
import {
	bunkerSpots,
	CHURCH_AT,
	circleRadius,
	groundHeight,
	HOLES,
	KEEPS,
	LOTS,
	ROADS,
	roadEdge,
	SQUARE,
	STAIRS,
	slopeAt,
	stairTreads,
	TERRACES,
	WALL_EDGE,
	wayOf,
} from './plan';
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

/** A ribbon that lies on the ground across its width too, for turf, with a color along its length. */
function ribbon(
	b: Build,
	line: readonly { x: number; z: number }[],
	half: (k: number) => number,
	color: (k: number) => Color,
	lift: number,
): void {
	const across = 4;
	const first = b.positions.length / 3;
	line.forEach((p, k) => {
		const a = line[Math.max(0, k - 1)] ?? p;
		const c = line[Math.min(line.length - 1, k + 1)] ?? p;
		const length = hypot(c.x - a.x, c.z - a.z) || 1;
		const [nx, nz] = [-(c.z - a.z) / length, (c.x - a.x) / length];
		const tint = color(k);
		for (let w = 0; w <= across; w++) {
			const off = ((w / across) * 2 - 1) * half(k);
			const [x, z] = [p.x + nx * off, p.z + nz * off];
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

/** A filled disc over the ground, for a turning circle or a green, by its radius along each bearing. */
function patch(
	b: Build,
	cx: number,
	cz: number,
	radius: (bearing: number) => number,
	color: Color,
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
			b.positions.push(x, height(x, z) + lift, z);
			b.colors.push(color[0], color[1], color[2]);
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
		const tone = (k: number): Color => {
			const p = points[k] as RoadPoint;
			const t = tar * (1 + 0.16 * noise.value2(p.x * 0.05, p.z * 0.05));
			return [t * 1.08, t, t * 0.9];
		};
		strip(b, points, (k) => (half + 0.45) * flare(k), dust, ROAD_LIFT - 0.05, cross);
		// The road's raised edge slopes down to the ground on each side.
		const first = b.positions.length / 3;
		points.forEach((p, k) => {
			const a = points[Math.max(0, k - 1)] as RoadPoint;
			const c = points[Math.min(points.length - 1, k + 1)] as RoadPoint;
			const length = hypot(c.x - a.x, c.z - a.z) || 1;
			const [nx, nz] = [-(c.z - a.z) / length, (c.x - a.x) / length];
			const inner = (half + 0.45) * flare(k);
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
		strip(b, points, (k) => half * flare(k), tone, under, cross);
		if (end === 'circle') {
			const tail = points[last] as RoadPoint;
			const flat = () => tail.y;
			patch(b, tail.x, tail.z, () => circleRadius(half) + 0.45, dust, ROAD_LIFT - 0.04, flat);
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
/** How far from the sea the turf stays, where the shore's bare rock ends, and the reach of a green, in meters. */
const GOLF_SHORE = 36;
const GREEN_REACH = 17;
/** The fewest points of a fairway's line in a run of its turf. */
const SHORTEST_FAIRWAY = 12;
/** The points of a fairway's line over which its end rounds off. */
const FAIRWAY_ROUND = 5;
/** The half width of a stone stair, in meters. */
const STAIR_HALF = 0.8;
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
		treads.forEach((t, k) => {
			const [ux, uz] = [Math.cos(t.heading), Math.sin(t.heading)];
			const [nx, nz] = [-uz * STAIR_HALF, ux * STAIR_HALF];
			const half = t.run / 2 + 0.03;
			const [bx, bz, fx, fz] = [t.x - ux * half, t.z - uz * half, t.x + ux * half, t.z + uz * half];
			const top = treads[k + 1]?.y ?? t.y + 0.18;
			quad(
				b,
				[bx - nx, t.y, bz - nz],
				[bx + nx, t.y, bz + nz],
				[fx + nx, t.y, fz + nz],
				[fx - nx, t.y, fz - nz],
				stone,
			);
			// The riser stands at the tread's far edge, up to the next tread.
			quad(
				b,
				[fx - nx, t.y - 0.3, fz - nz],
				[fx + nx, t.y - 0.3, fz + nz],
				[fx + nx, top, fz + nz],
				[fx - nx, top, fz - nz],
				riser,
			);
		});
	}
	return b;
}

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

/** Stands the houses and their gardens: one batch of walls and one of roofs for each kind. */
function createHouses(ctx: SketchContext, surfaces: Surfaces): void {
	const { scene, geometry } = ctx;
	HOUSE_KINDS.forEach((kind, k) => {
		const lots = LOTS.filter((lot) => lot.kind === k);
		if (lots.length === 0) return;
		const mesh = geometry.fromArrays(finish(kind.walls));
		mesh.setLevels([{ mesh: geometry.fromArrays(finish(kind.farWalls)), error: FAR_HOUSE_ERROR }]);
		const w = scene.createInstances(mesh, lots.length, {
			material: kind.stone ? surfaces.rubble : surfaces.plaster,
			colors: true,
			castShadows: true,
			receiveShadows: true,
		});
		const roofMesh = geometry.fromArrays(finish(kind.roof));
		roofMesh.setLevels([
			{ mesh: geometry.fromArrays(finish(kind.farRoof)), error: FAR_HOUSE_ERROR },
		]);
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
}

/** The climbing flowers on some of the plots' walls. */
function createClimbers(ctx: SketchContext): void {
	const { scene, geometry, materials } = ctx;
	// Bougainvillea climbs in magenta sheets on the sunny fronts of some of the houses.
	const climbers = LOTS.filter((_, k) => k % 3 === 0);
	const mesh = build();
	for (let k = 0; k < 220; k++) {
		const a = k * 2.399963;
		const r = Math.sqrt((k + 0.5) / 220);
		const [x, y] = [Math.cos(a) * r * 1.5, 1.5 + Math.sin(a) * r * 1.4];
		const s = 0.045 + ((k * 13) % 7) * 0.008;
		const tint: Color =
			k % 4 === 0 ? [0.1, 0.2, 0.06] : k % 3 ? [0.5, 0.05, 0.26] : [0.62, 0.1, 0.32];
		quad(
			mesh,
			[x - s, y - s, 0.05],
			[x + s, y - s, 0.09],
			[x + s, y + s, 0.05],
			[x - s, y + s, 0.09],
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
function createSquare(ctx: SketchContext, surfaces: Surfaces): void {
	const { scene, geometry, materials } = ctx;
	const { x, z, hx, hz } = SQUARE;
	const y = groundHeight(x, z);
	const b = build();
	const top = y + DRAPE;
	// The fans of small stones cover the square's whole floor, out to the streets on its sides. They lie in
	// a map, whose finer levels fade with distance, so they never shimmer into rings.
	const [wide, deep] = [hx + 1, hz + 6];
	scene.createMesh({
		mesh: geometry.fromArrays({
			positions: [
				x - wide,
				top,
				z + deep,
				x + wide,
				top,
				z + deep,
				x + wide,
				top,
				z - deep,
				x - wide,
				top,
				z - deep,
			],
			uvs: [
				-wide / FAN_PERIOD,
				deep / FAN_PERIOD,
				wide / FAN_PERIOD,
				deep / FAN_PERIOD,
				wide / FAN_PERIOD,
				-deep / FAN_PERIOD,
				-wide / FAN_PERIOD,
				-deep / FAN_PERIOD,
			],
			indices: [0, 1, 2, 0, 2, 3],
			computeNormals: true,
		}),
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
	ring(b, x, z, 4.3, top + 1.05, 3.7, top + 1.05, 28, stone);
	ring(b, x, z, 3.7, top + 0.95, 0, top + 0.95, 28, water);
	ring(b, x, z, 0.5, top + 0.95, 0.34, top + 2.5, 12, stone);
	ring(b, x, z, 0.34, top + 2.5, 1.5, top + 2.75, 18, stone);
	ring(b, x, z, 1.5, top + 2.75, 1.5, top + 2.95, 18, stone);
	ring(b, x, z, 1.35, top + 2.9, 0, top + 2.9, 18, water);
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
	// The cafe tables stand along the square's fringes, under canvas in some places and open in others.
	const covered: [number, number][] = [];
	const open: [number, number][] = [];
	for (const side of [-1, 1])
		for (let i = 0; i < 6; i++) {
			const px = x + side * (hx - 1 + (i % 2) * 2.6);
			const pz = z - hz + 5 + i * 5.6;
			if (i % 3 === 0) covered.push([px + side * 0.5, pz]);
			else open.push([px, pz]);
		}
	for (let i = 0; i < 10; i++) {
		const px = x - hx + 3 + i * 4.6;
		if (Math.abs(px - x) < 5) continue;
		open.push([px, z + hz - 2 - (i % 2) * 2.4]);
		if (i % 4 === 1) covered.push([px, z + hz + 1.8]);
	}
	for (let i = 0; i < 6; i++) open.push([x - 10 + i * 4, z - hz + 1 + (i % 2) * 2.2]);
	const put = (arrays: Build, spots: readonly (readonly [number, number])[]) => {
		const batch = scene.createInstances(geometry.fromArrays(finish(arrays)), spots.length, {
			material: materials.standard({ vertexColors: true, roughness: 0.85, doubleSided: true }),
			castShadows: true,
			receiveShadows: true,
		});
		spots.forEach(([px, pz], k) => {
			row(batch, k, px, top, pz, k * 0.37);
		});
		batch.markDirty();
	};
	put(cafeTable(), covered);
	put(bareTable(), open);
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
	put(planter(), pots);
	// Canvas awnings hang from the fronts of the houses at the square's southern corners.
	const shades = scene.createInstances(geometry.fromArrays(finish(awning())), 4, {
		material: materials.standard({ vertexColors: true, roughness: 0.9, doubleSided: true }),
		castShadows: true,
		receiveShadows: true,
	});
	row(shades, 0, x - hx - 2, top, z + 4, Math.PI / 2);
	row(shades, 1, x + hx + 2, top, z + 4, -Math.PI / 2);
	row(shades, 2, x - hx - 2, top, z - 10, Math.PI / 2);
	row(shades, 3, x + hx + 2, top, z - 10, -Math.PI / 2);
	shades.markDirty();
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

/** The half beam and half length of the largest yacht's hull, in meters. */
const HULL_HALF = [2.3, 7] as const;
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
	return moorings.map(([x, z, yaw]) => {
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
})();

function createHarbour(ctx: SketchContext, surfaces: Surfaces): void {
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
	scene.createMesh({
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
}

/** The beach: tight rows of parasols from the back of the sand, in clubs with palms right behind. */
/** The parasols' places on the sand: in clubs, off the houses and the roads. */
export function parasolSpots(): { x: number; z: number; color: readonly number[]; yaw: number }[] {
	const next = random(419);
	const spots: { x: number; z: number; color: readonly number[]; yaw: number }[] = [];
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
			if (inland(x, z) < 8 || next() < 0.08) continue;
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

function createBeach(ctx: SketchContext): void {
	const next = random(421);
	const { scene, geometry, materials } = ctx;
	const spots = parasolSpots();
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
		if (inland(x, z) > 20) palms.push([x, z]);
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
		ribbon(
			b,
			line,
			(k) => onTop(k) + 3.2 * Math.min(1, onTop(k) / 4),
			() => [0.14, 0.27, 0.08],
			0.42,
		);
		ribbon(
			b,
			line,
			onTop,
			(k) => (Math.floor(k / 3) % 2 ? [0.19, 0.35, 0.11] : [0.21, 0.38, 0.12]),
			0.5,
		);
		patch(b, gx, gz, (a) => 15 + 2.4 * Math.sin(a * 3), [0.15, 0.3, 0.08], 0.54);
		patch(b, gx, gz, (a) => 12 + 2.2 * Math.sin(a * 3), [0.26, 0.45, 0.15], 0.58);
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

/** The outline of a park's lawn, as its radius at each bearing. */
function parkShape(x: number, z: number, r: number) {
	return (a: number) => r * (1 + 0.14 * Math.sin(a * 2 + x) + 0.09 * Math.sin(a * 5 + z));
}

/** A park's gravel walk, which winds around its lawn. */
function parkWalk(x: number, y: number, z: number, shape: (a: number) => number) {
	const walk: { x: number; y: number; z: number }[] = [];
	for (let t = 0; t <= 1.001; t += 0.018) {
		const a = t * Math.PI * 2 * 0.86 + 2.2;
		const rr = shape(a) * (0.72 + 0.1 * Math.sin(t * 19));
		walk.push({ x: x + Math.cos(a) * rr, y: y + 0.02, z: z + Math.sin(a) * rr });
	}
	return walk;
}

/** The branch of a park's walk that leads to its gazebo. */
function parkBranch(x: number, y: number, z: number, walk: readonly { x: number; z: number }[]) {
	const [gx, gz] = [x + 3, z + 2];
	const branch: { x: number; y: number; z: number }[] = [];
	const from = walk[Math.floor(walk.length * 0.72)] as { x: number; z: number };
	for (let t = 0; t <= 1.001; t += 0.1)
		branch.push({
			x: from.x + (gx - from.x) * t + Math.sin(t * 3.14) * 2,
			y: y + 0.02,
			z: from.z + (gz - from.z) * t,
		});
	return branch;
}

/** The lawns of the parks, for grass: each one's square, the lawn's height, and where its lawn lies. */
export function parkLawns() {
	return PARKS.map(([x, z, radius]) => {
		const y = groundHeight(x, z);
		const r = radius * 0.72;
		const shape = parkShape(x, z, r);
		const walk = parkWalk(x, y, z, shape);
		const paths = [...walk, ...parkBranch(x, y, z, walk)];
		return {
			x,
			z,
			size: r * 2.6,
			height: y + LAWN_LIFT,
			where: (px: number, pz: number) => {
				const [dx, dz] = [px - x, pz - z];
				if (hypot(dx, dz) >= shape(Math.atan2(dz, dx)) - 0.3) return false;
				if (hypot(px - (x + 3), pz - (z + 2)) < GAZEBO_CLEAR) return false;
				// The points along a walk stand about 2 m apart, so this also covers the walk between them.
				return !paths.some((p) => hypot(px - p.x, pz - p.z) < WALK_CLEAR);
			},
		};
	});
}

/** The parks: mottled lawns with a winding gravel walk, a gazebo, benches, hedges, lamps and a low wall. */
/** How high a lawn lies over the park's level, and how far grass keeps from a walk and a gazebo, in meters. */
const LAWN_LIFT = 0.1;
const WALK_CLEAR = 2;
const GAZEBO_CLEAR = 7;

function createParks(ctx: SketchContext, surfaces: Surfaces): void {
	const { scene, geometry, materials } = ctx;
	const b = build();
	const walls = build();
	const seats: { x: number; y: number; z: number; yaw: number }[] = [];
	const hedges: { x: number; y: number; z: number; scale: number }[] = [];
	const lamps: { x: number; y: number; z: number }[] = [];
	const lawn: Color = [0.15, 0.26, 0.07];
	const gravel: Color = [0.5, 0.45, 0.34];
	for (const [x, z, radius] of PARKS) {
		const y = groundHeight(x, z);
		const flat = () => y + 0.02;
		const r = radius * 0.72;
		// An uneven lawn, and a gravel walk that winds around it with a branch to the gazebo.
		const shape = parkShape(x, z, r);
		patch(b, x, z, (a) => shape(a) + 3, [0.1, 0.18, 0.05], 0.07, flat);
		patch(b, x, z, shape, lawn, LAWN_LIFT, flat);
		const walk = parkWalk(x, y, z, shape);
		strip(b, walk, 1.5, gravel, 0.13);
		const [gx, gz] = [x + 3, z + 2];
		const branch = parkBranch(x, y, z, walk);
		strip(b, branch, 1.2, gravel, 0.14);
		const hall = pavilion();
		const place = [gx, y + 0.12, gz] as [number, number, number];
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
		walk.forEach((p, k) => {
			if (k % 8 === 2) {
				const q = walk[Math.min(walk.length - 1, k + 1)] as { x: number; z: number };
				const along = Math.atan2(q.z - p.z, q.x - p.x);
				seats.push({
					x: p.x - Math.sin(along) * 2.2,
					y: y + 0.12,
					z: p.z + Math.cos(along) * 2.2,
					yaw: -along,
				});
			}
			if (k % 13 === 6)
				lamps.push({ x: p.x + Math.sin(k) * 2, y: y + 0.1, z: p.z + Math.cos(k) * 2 });
		});
		// Beds of leafy shrubs lie along the lawn's edge, thick around the gazebo.
		for (let k = 0; k < 54; k++) {
			const a = (k / 54) * Math.PI * 2;
			const rr = shape(a) + 1.5 + ((k * 7) % 5) * 0.5;
			hedges.push({
				x: x + Math.cos(a) * rr,
				y,
				z: z + Math.sin(a) * rr,
				scale: 0.8 + ((k * 3) % 4) * 0.25,
			});
		}
		for (let k = 0; k < 14; k++) {
			const a = (k / 14) * Math.PI * 2;
			hedges.push({
				x: gx + Math.cos(a) * 6.5,
				y: y + 0.1,
				z: gz + Math.sin(a) * 6.5,
				scale: 0.6 + (k % 3) * 0.25,
			});
		}
		// A low stone wall stands at the lookout, on the park's downhill side.
		for (let a = 1; a < 2.4; a += 0.08) {
			const [ra, rb] = [shape(a) + 5, shape(a + 0.08) + 5];
			wallStretch(
				walls,
				{ x: x + Math.cos(a) * ra, y, z: z + Math.sin(a) * ra },
				{ x: x + Math.cos(a + 0.08) * rb, y, z: z + Math.sin(a + 0.08) * rb },
				0.7,
				[0.9, 0.86, 0.78],
			);
		}
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
}

/** The keeps on the hilltops: each stands on the crest, at the middle of its village. */
function createKeeps(ctx: SketchContext, surfaces: Surfaces): void {
	const { scene, geometry } = ctx;
	const mesh = geometry.fromArrays(finish(keep()));
	scene.createMesh({
		mesh: geometry.fromArrays(finish(stairsMesh())),
		material: surfaces.rubble,
		receiveShadows: true,
	});
	for (const [x, z, y] of KEEPS)
		scene.createMesh({
			mesh,
			material: surfaces.rubble,
			position: [x, y, z],
			castShadows: true,
			receiveShadows: true,
		});
}

/** The rocks of the coast: angular boulders in several sizes, tumbled below the cliffs and offshore. */
function createRocks(ctx: SketchContext): void {
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
			places.push({ x, y: groundHeight(x, z), z });
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
	] as const)
		places.push({ x: x + dx * hx, y: groundHeight(x, z) + DRAPE, z: z + dz * hz });
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
export function createTown(ctx: SketchContext): void {
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
			map: grainMap(ctx, 53, 170),
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
	createHouses(ctx, surfaces);
	createClimbers(ctx);
	createSquare(ctx, surfaces);
	createHarbour(ctx, surfaces);
	createBeach(ctx);
	createGolf(ctx);
	createParks(ctx, surfaces);
	createKeeps(ctx, surfaces);
	createRocks(ctx);
	createLamps(ctx);
}
