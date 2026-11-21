// The cliff's walls: grey-green volcanic rock that hangs from the rim of the land and runs down into
// the sea of cloud. The rock breaks into upright pillars and buttresses of uneven width, each split
// into flat vertical facets, and cut by deep black cracks and chimneys. Each pillar steps in and out
// down its height in blocks, each block's face its own way, which leaves ledges, overhangs and an
// angular, craggy face; under the turf a band of dark soil and roots hides the join. A fringe of
// mossy rocks along the rim juts out over the wall, so the land's edge reads as broken rock. The wall
// is one mesh in code: its top row is the land's own rim, vertex for vertex, so the two meet with no
// seam, and every noise along the rim reads round a circle, so the ring of columns closes on itself.
// Its rows spread out with depth, fine where the camera sees the rock and coarser down in the cloud.
import { type MeshArrays, math, type SketchContext } from '@null3d/engine';
import { Noise, random, rock, type TexelSample, textureSet } from '../../lib/procedural';
import { FALL, LIPS, streamHalf, streamZ, WALL_REACH } from './land';
import { mossy, TEXTURED_MOSS } from './stones';

/** How far the walls run down below the water's height, in meters: well into the cloud. */
export const WALL_FOOT = -44;
/** The rows of vertices from the rim down to the foot. */
const ROWS = 96;
/** How the rows spread: a power above 1 packs them toward the rim. */
const ROW_SPREAD = 1.25;
/** The narrowest and widest pillar, in meters along the rim. */
const PILLAR = [0.9, 3.6] as const;
/** How deep the cracks between the pillars cut into the rock, in meters. */
const CRACK = [0.7, 2.1] as const;
/** The share of the crack's side of a pillar that its cut spans: a narrow notch. */
const CRACK_SPAN = 0.2;
/** The share of pillars that stand out as buttresses, and how far, in meters. */
const BUTTRESS = { share: 0.26, out: [0.8, 1.7] as const } as const;
/** The shortest and tallest block that a pillar steps by, in meters. */
const BLOCK = [0.8, 2.8] as const;
/** How far a block stands out from or back into its pillar, and how far its face tilts across it. */
const STEP = 1.2;
const TILT = 0.55;
/**
 * How far the rock's face stands back under the rim's line, in meters, so the land's edge overhangs
 * the rock, as soil and roots do on the concept's rim.
 */
const UNDERCUT = 0.85;
/**
 * How deep and wide the black chimneys cut into the face, in meters and as a noise's threshold: a
 * chimney runs near upright down the wall, so it stays a slot at every height, as the concept's
 * cracks do.
 */
const CHIMNEY = { depth: 2.2, cut: 0.12 } as const;
/** How far the rock teeth under the rim jut out in places, in meters, and the depths they span. */
const RIM_TEETH = { out: 1.3, from: 0.25, to: [1.2, 4.2] as const } as const;
/** How far the soil and root band under the turf reaches down the rock, in meters. */
const SOIL = { depth: 0.75 } as const;
/**
 * The rock round each lip: how far past the fall's width on each side the rock still follows the
 * water down, in meters; the shares of the creek's half width where the water's sheet runs on under
 * the banks and the rock stands flush, and where no buttress may stand proud enough to hide the
 * fall; how far the rock stands proud there, in meters, and the share of any crag past that which
 * folds back into the wall as a hollow instead.
 */
const LIP_RECESS = {
	margin: 0.4,
	sheet: 1.45,
	clear: 3,
	proud: 0.15,
	fold: 0.6,
} as const;
/**
 * Under each fall the rock follows the water down, so the fall drops against the dark wall as the
 * concept's do. The water's back stands out from the lip's line about `reach` times the fall's
 * speed times the depth over 2 m to the `power`, as the water add-on's fall does (at 1.2 m/s, 0.6 m
 * out 2 m down and 1.3 m out 13 m down), and the rock stands `gap` meters behind it.
 */
const HUG = { reach: 0.5, power: 0.41, gap: 0.35 } as const;
/** How deep the upright fissures cut into the face beside each lip, and how far its ledges step. */
const LIP_BREAK = { fissure: 0.7, ledge: 0.45 } as const;
/**
 * How far the rock spreads outward per meter of depth: the cliff widens toward its foot, so the
 * walls run on down into the cloud from the opening camera, as the concept's do, rather than ending
 * in an outline over it.
 */
const FLARE = 0.12;
/**
 * How far the lower wall steps out toward the cloud, in meters, and the depths it grows in over: the
 * island's base stands out below the crags, so the opening view's bottom rows see dark rock rather
 * than past the wall at the cloud.
 */
const LOWER = { out: 3.3, from: 3.5, to: 10 } as const;
/** The meters that one repeat of the rock's detail covers, about: a whole number go round the rim. */
const TILE = 2.2;

const noise = new Noise(53);
const { smoothstep } = math;

/**
 * The rock's texel: dark stone mottled in broad and middle patches, with fine grain and deep pits,
 * in a near-white tone that the colors tint. The pits are hollows in its height, which the light
 * shades, and darken the stone only a little; no line is drawn on it. No small marks repeat, so no
 * print shows on the face.
 */
function rockTexel(u: number, v: number, out: TexelSample): void {
	const broad = noise.fbm2(u * 4, v * 4, 5, 4);
	const middle = noise.fbm2(u * 10, v * 10, 4, 10);
	const grain = noise.fbm2(u * 48, v * 48, 2, 48);
	const pits = Math.max(0, noise.fbm2(u * 14, v * 14, 3, 14));
	out.height = broad * 12 + middle * 6 + grain * 3 - pits * 16;
	const tone = (0.7 + 0.24 * broad + 0.12 * middle + 0.05 * grain) * (1 - 0.3 * pits);
	// A grey-green cast, so the shaded faces under the cool sky still keep the concept's rock tone.
	out.r = tone;
	out.g = tone * 0.96;
	out.b = tone * 0.86;
	out.roughness = 0.84 + 0.12 * broad;
	out.occlusion = (0.9 + 0.1 * smoothstep(broad, -0.3, 0.3)) * (1 - 0.45 * pits);
}

/** The rock maps already made, by the scene's texture factory and their size. */
const madeMaps = new WeakMap<object, Map<number, ReturnType<typeof textureSet>>>();

/**
 * The cliff rock's texture maps: pitted, mottled, warm stone with no line drawn on it. The walls,
 * the steps and the statue's ledge share one set of each size, made once.
 */
export function rockMaps(
	textures: SketchContext['textures'],
	size: number,
): ReturnType<typeof textureSet> {
	let sizes = madeMaps.get(textures);
	if (!sizes) {
		sizes = new Map();
		madeMaps.set(textures, sizes);
	}
	let maps = sizes.get(size);
	if (!maps) {
		maps = textureSet(textures, size, rockTexel);
		sizes.set(size, maps);
	}
	return maps;
}

/** One block of a pillar: its foot below the rim, how far it stands out, and its face's tilt. */
interface Block {
	foot: number;
	step: number;
	tilt: number;
	/** How light its face reads, from 0 for charcoal to 1 for the lightest grey-brown. */
	tone: number;
}

/** One pillar: where it starts along the rim, its width, its crack's depth and its blocks. */
interface Pillar {
	start: number;
	width: number;
	crack: number;
	/** How far the whole pillar stands out, in meters: a buttress stands well out. */
	out: number;
	blocks: Block[];
}

/** Splits the rim's length into pillars of uneven width, each with its own run of blocks. */
export function pillars(length: number): Pillar[] {
	const next = random(57);
	const list: Pillar[] = [];
	let at = 0;
	while (at < length) {
		const buttress = next() < BUTTRESS.share;
		const width = (PILLAR[0] + (PILLAR[1] - PILLAR[0]) * next() ** 1.3) * (buttress ? 1.3 : 1);
		const blocks: Block[] = [];
		let foot = 0;
		while (foot < -WALL_FOOT + 10) {
			foot += BLOCK[0] + (BLOCK[1] - BLOCK[0]) * next();
			blocks.push({
				foot,
				step: (next() * 2 - 1) * STEP,
				tilt: (next() * 2 - 1) * TILT,
				tone: next(),
			});
		}
		const out = buttress ? BUTTRESS.out[0] + (BUTTRESS.out[1] - BUTTRESS.out[0]) * next() : 0;
		list.push({ start: at, width, crack: CRACK[0] + (CRACK[1] - CRACK[0]) * next(), out, blocks });
		at += width;
	}
	// The last pillar closes the ring: it stretches to meet the first.
	const last = list[list.length - 1] as Pillar;
	last.width = length - last.start;
	return list;
}

/**
 * Noise at a place along the rim, read round a circle whose length is the rim's, so the ring closes
 * on itself: `scale` sets the noise's cells per meter along the rim, and `y` the place down it.
 */
export function aroundNoise(
	along: number,
	length: number,
	scale: number,
	y: number,
	octaves: number,
): number {
	const angle = (along / length) * Math.PI * 2;
	const radius = (length * scale) / (Math.PI * 2);
	return noise.fbm3(Math.cos(angle) * radius, y, Math.sin(angle) * radius, octaves);
}

/**
 * How far the rock stands out from the rim's line at a place along the rim and a depth below it, in
 * meters; how deep in a crack the place lies, from 0 on a face to 1 in a crack's back; and how light
 * the block there reads.
 */
export function relief(
	list: readonly Pillar[],
	length: number,
	along: number,
	depth: number,
): { offset: number; crack: number; tone: number } {
	// The cracks wander a little down the wall, so no pillar is ruled straight.
	const wander = 0.9 * aroundNoise(along, length, 0.05, depth * 0.06 + 3, 3);
	const at = (((along + wander) % length) + length) % length;
	let low = 0;
	let high = list.length - 1;
	while (low < high) {
		const mid = (low + high + 1) >> 1;
		if ((list[mid] as Pillar).start <= at) low = mid;
		else high = mid - 1;
	}
	const pillar = list[low] as Pillar;
	const t = (at - pillar.start) / pillar.width;
	// A narrow notch at each side of the pillar: black cracks between angular faces.
	const crack = smoothstep(Math.abs(t * 2 - 1), 1 - CRACK_SPAN, 1);
	let index = 0;
	while (index < pillar.blocks.length - 1 && (pillar.blocks[index] as Block).foot < depth) index++;
	const block = pillar.blocks[index] as Block;
	const above = index === 0 ? undefined : (pillar.blocks[index - 1] as Block);
	// A block's foot steps sharply into the next one, which leaves a ledge or an overhang there.
	const into = smoothstep(depth - (above?.foot ?? 0), 0, 0.3);
	// Each pillar breaks into a few flat vertical facets, each of its own depth, so the face shows
	// sharp ridges instead of one rounded flute.
	const slice = Math.min(3, Math.floor(t * 4));
	const facetOf = (b: Block) =>
		noise.value3(slice * 3.1, b.foot * 0.7 + 11, pillar.start * 1.3) * 0.45;
	const face = (b: Block | undefined) =>
		b ? b.step + b.tilt * (t - 0.5) * pillar.width * 0.5 + facetOf(b) : 0;
	const step = face(above) + (face(block) - face(above)) * into;
	// Black chimneys: deep slots that run near upright down the face, so they stay black at every
	// height and split the wall into crags, as the concept's cracks do.
	const chimney =
		1 -
		smoothstep(Math.abs(aroundNoise(along, length, 0.55, depth * 0.05 + 61, 3)), 0, CHIMNEY.cut);
	// Rock teeth just under the rim, which jut past the land's edge in places, so the rim breaks
	// into rock rather than running as one clean bevel.
	const tooth =
		Math.max(0, aroundNoise(along, length, 0.9, depth * 0.6 + 71, 3)) *
		smoothstep(depth, 0, RIM_TEETH.from) *
		(1 - smoothstep(depth, RIM_TEETH.to[0], RIM_TEETH.to[1]));
	// Broad flat facets of the pillar's own, so no face rounds into a flute.
	const facet = Math.round(aroundNoise(along, length, 0.4, depth * 0.2 + 83, 2) * 2) / 2;
	const crags =
		0.7 * aroundNoise(along, length, 0.35, depth * 0.35, 4) +
		0.5 * Math.abs(aroundNoise(along, length, 1.2, depth * 1.2 + 7, 3)) +
		0.1 * aroundNoise(along, length, 4, depth * 4 + 2, 2) +
		0.55 * facet;
	const bulge = 1.5 * aroundNoise(along, length, 0.025, depth * 0.035 + 11, 3);
	// Sharp crests and thin black fissures across the faces, which make the rock craggy close up.
	const crest =
		0.22 *
		Math.max(0, 1 - 2.2 * Math.abs(aroundNoise(along, length, 2.4, depth * 2.4 + 17, 2))) ** 4;
	const fissure =
		1 - smoothstep(Math.abs(aroundNoise(along, length, 1.6, depth * 1.1 + 23, 2)), 0, 0.045);
	const tone =
		(above ? above.tone + (block.tone - above.tone) * into : block.tone) *
		(1 - crack) *
		(1 - 0.35 * chimney);
	// The lowest wall's fine relief fades, so its columns meet the cloud as broad blocks, not as a
	// fringe of narrow spikes. The pillars and their blocks still stand.
	const deep = 1 - 0.75 * smoothstep(depth, 8, 14);
	return {
		offset:
			pillar.out +
			step +
			deep * (crags + crest) +
			bulge +
			RIM_TEETH.out * tooth -
			pillar.crack * crack -
			CHIMNEY.depth * chimney -
			0.2 * fissure * deep -
			UNDERCUT,
		crack: Math.max(crack, 0.9 * chimney, 0.9 * fissure),
		tone,
	};
}

/** Linear colors of the rock: near-black faces, a grey-green on the lighter ones. */
const CHARCOAL = [0.047, 0.048, 0.039];
const GREY_BROWN = [0.163, 0.163, 0.134];
/** Linear color of the soil and roots that hang under the turf at the rim: dark earth. */
const SOIL_TONE = [0.07, 0.052, 0.032];

/** Builds the wall's arrays from the rim's vertices, in order up the bearings. */
export function wallArrays(rim: Float32Array): MeshArrays {
	const count = rim.length / 3;
	// The length along the rim at each vertex, which places the pillars and the texture.
	const along = new Float32Array(count + 1);
	for (let k = 1; k <= count; k++) {
		const a = (k - 1) * 3;
		const b = (k % count) * 3;
		along[k] =
			(along[k - 1] as number) +
			Math.hypot(
				(rim[b] as number) - (rim[a] as number),
				(rim[b + 2] as number) - (rim[a + 2] as number),
			);
	}
	const length = along[count] as number;
	const tile = length / Math.max(1, Math.round(length / TILE));
	const list = pillars(length);
	// The last column repeats the first, with the texture's next repeat, so the ring closes.
	const columns = count + 1;
	const vertices = columns * (ROWS + 1);
	const positions = new Float32Array(vertices * 3);
	const colors = new Float32Array(vertices * 3);
	const uvs = new Float32Array(vertices * 2);
	for (let row = 0; row <= ROWS; row++) {
		const share = (row / ROWS) ** ROW_SPREAD;
		for (let column = 0; column < columns; column++) {
			const k = (column % count) * 3;
			const [x, top, z] = [rim[k] as number, rim[k + 1] as number, rim[k + 2] as number];
			const y = top + (WALL_FOOT - top) * share;
			const depth = top - y;
			const run = along[column % count] as number;
			const { offset, crack, tone } = relief(list, length, run, depth);
			// Under each lip the rock follows the falling water down. Beside it, under the banks, where
			// the water's sheet runs on under the ground, the rock stands flush, so the sheet stays
			// inside it; and on round, no buttress stands proud enough to hide the fall.
			const { sheet, clear, hug } = lipShares(x, z);
			const raw = offset + UNDERCUT;
			// A crag that would stand proud folds back into the wall as a hollow, so the face beside the
			// fall stays broken and still never stands out far enough to hide it.
			const pressed =
				raw > LIP_RECESS.proud
					? LIP_RECESS.proud - LIP_RECESS.fold * (raw - LIP_RECESS.proud)
					: raw;
			// Beside the lip the face breaks into blocks: deep upright fissures and stepped ledges,
			// all cut into the wall, so it reads as broken rock and still stands back from the fall.
			const fissure =
				1 - smoothstep(Math.abs(aroundNoise(run, length, 0.7, depth * 0.3 + 41, 2)), 0, 0.12);
			const ledge = Math.round(aroundNoise(run, length, 0.45, depth * 0.5 + 47, 2) * 4) / 4;
			const broken = pressed - LIP_BREAK.fissure * fissure - LIP_BREAK.ledge * (ledge + 0.5);
			const capped = offset + (Math.min(broken, pressed) - offset) * clear;
			const flush = capped + (Math.max(pressed, 0) - capped) * sheet;
			// Under each fall the rock follows the water down, a little behind it.
			const behind = FALL.speed * HUG.reach * (depth / 2) ** HUG.power - HUG.gap;
			const shaped = flush + (behind - flush) * hug;
			// The rock starts at the rim's own line, and its relief, its teeth and its cracks grow in
			// just below the land's edge.
			const grow = smoothstep(depth, 0, 0.55);
			const lower = LOWER.out * smoothstep(depth, LOWER.from, LOWER.to);
			const grown = (shaped + (FLARE * depth + lower) * (1 - clear)) * grow;
			// Where the camera may stand past the rim, the rock stays inside the reach it keeps clear.
			const limit = WALL_REACH - 0.2;
			const high = smoothstep(y, 0.2, 1);
			const out = grown > limit ? limit + (grown - limit) * (1 - high) : grown;
			const reach = Math.hypot(x, z);
			const v = (row * columns + column) * 3;
			positions[v] = x * (1 + out / reach);
			positions[v + 1] = y;
			positions[v + 2] = z * (1 + out / reach);
			const lighter = smoothstep(aroundNoise(run, length, 0.08, depth * 0.05 + 5, 3), -0.1, 0.3);
			const light = 0.55 * tone + 0.45 * lighter;
			const dark = Math.max(0, 1 - 1.5 * crack * grow);
			// Under the turf the rock's top reads as the soil and roots that the edge overhangs.
			const soil = (1 - smoothstep(depth, 0, SOIL.depth)) * 0.7;
			for (let c = 0; c < 3; c++) {
				const shade =
					(CHARCOAL[c] as number) + ((GREY_BROWN[c] as number) - (CHARCOAL[c] as number)) * light;
				const rock = shade * dark;
				colors[v + c] = rock + ((SOIL_TONE[c] as number) * dark - rock) * soil;
			}
			uvs.set([(along[column] as number) / tile, -y / tile], (row * columns + column) * 2);
		}
	}
	const normals = ringNormals(positions, columns, ROWS + 1);
	const indices = new Uint32Array(count * ROWS * 6);
	for (let row = 0; row < ROWS; row++)
		for (let column = 0; column < count; column++) {
			const a = row * columns + column;
			const b = a + columns;
			indices.set([a, a + 1, b, a + 1, b + 1, b], (row * count + column) * 6);
		}
	return { positions, normals, colors, uvs, indices };
}

/**
 * How near a point of the rim lies to a lip: `sheet`, from 0 to 1 over the banks either side, where
 * the water's sheet runs on under the ground; `clear`, on round the rim either side, where the fall
 * must show past the rock; and `hug`, across the fall's width and its margin, where the rock follows
 * the water down.
 */
function lipShares(x: number, z: number): { sheet: number; clear: number; hug: number } {
	let sheet = 0;
	let clear = 0;
	let hug = 0;
	for (const lip of [LIPS.west, LIPS.east]) {
		const half = streamHalf(lip);
		const reach = Math.hypot(x - lip, z - streamZ(lip));
		const share = (from: number, over: number) => 1 - smoothstep(reach, from, from + over);
		hug = Math.max(hug, share(half * FALL.width + LIP_RECESS.margin, 0.15));
		sheet = Math.max(sheet, share(half * LIP_RECESS.sheet, 0.8));
		clear = Math.max(clear, share(half * LIP_RECESS.clear, 3));
	}
	return { sheet, clear, hug };
}

/**
 * The normals of a grid of rows round a ring, whose last column repeats its first: each from its
 * neighbours along the ring, which wrap round, and down it, so the joining columns shade alike.
 */
function ringNormals(positions: Float32Array, columns: number, rows: number): Float32Array {
	const normals = new Float32Array(positions.length);
	const ring = columns - 1;
	const at = (row: number, column: number, axis: number) =>
		positions[(row * columns + (((column % ring) + ring) % ring)) * 3 + axis] as number;
	for (let row = 0; row < rows; row++) {
		const up = Math.max(0, row - 1);
		const below = Math.min(rows - 1, row + 1);
		for (let column = 0; column < columns; column++) {
			const along = [0, 1, 2].map((a) => at(row, column + 1, a) - at(row, column - 1, a));
			const down = [0, 1, 2].map((a) => at(below, column, a) - at(up, column, a));
			const [ax, ay, az] = along as [number, number, number];
			const [dx, dy, dz] = down as [number, number, number];
			const nx = ay * dz - az * dy;
			const ny = az * dx - ax * dz;
			const nz = ax * dy - ay * dx;
			const size = Math.hypot(nx, ny, nz) || 1;
			normals.set([nx / size, ny / size, nz / size], (row * columns + column) * 3);
		}
	}
	return normals;
}

/**
 * The wall's surface: the rock's detail maps tinted by its colors, with olive moss and pale lichen
 * on the ledges and the tops of the blocks, where the rock faces up.
 */
const wallWgsl = /* wgsl */ `
#import null3d::noise::{value3}

struct Uniforms { moss: vec3f, lichen: vec3f }

var detail: texture_2d<f32>;
var detailNormal: texture_2d<f32>;
var detailOrm: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let tint = textureSample(detail, detailSampler, input.uv).rgb;
    let orm = textureSample(detailOrm, detailOrmSampler, input.uv);
    let bump = textureSample(detailNormal, detailNormalSampler, input.uv).xyz * 2.0 - 1.0;
    let n = normalize(input.normal);
    // The texture runs round the wall and down it: its u along the rim and its v down.
    let around = normalize(vec3f(-n.z, 0.0, n.x) + vec3f(1e-4, 0.0, 0.0));
    let down = normalize(cross(n, around));
    s.normal = normalize(around * bump.x + down * bump.y + n * bump.z);
    let p = input.worldPosition;
    let patches = value3(p * 0.7) * 0.5 + value3(p * 2.3) * 0.25;
    let mossy = smoothstep(0.6, 0.9, n.y + patches * 0.4);
    let streaks = smoothstep(0.25, 0.6, value3(vec3f(p.x * 1.5, p.y * 0.12, p.z * 1.5)) + patches * 0.3);
    // Mottling in the world's own space, which the texture's repeats cannot line up with.
    let mottle = 0.8 + 0.3 * (value3(p * 1.1) * 0.6 + value3(p * 3.7) * 0.4);
    var color = s.baseColor * tint * mottle;
    // The cracks and chimneys stay black: no lichen or moss grows on their shaded faces.
    let lit = dot(s.baseColor, vec3f(0.2126, 0.7152, 0.0722));
    let face = smoothstep(0.0015, 0.014, lit);
    // Fine cracks run down the face in thin shaded lines, which break its broad planes as the
    // concept's rock is broken.
    let seam = 1.0 - smoothstep(abs(value3(vec3f(p.x * 1.9, p.y * 0.16, p.z * 1.9)) - 0.5), 0.0, 0.065);
    color *= 1.0 - 0.6 * seam * face;
    color = mix(color, material.lichen * tint, streaks * 0.22 * (1.0 - mossy) * face);
    s.baseColor = mix(color, material.moss * tint, mossy * face);
    s.roughness = mix(orm.g, 0.95, mossy);
    s.occlusion = orm.r;
    return s;
}
`;

/**
 * The rocks of the rim's fringe: how far apart they stand, their size, and how far inside the rim
 * their feet stand, so each one's outer side juts out over the wall and breaks the land's clean edge.
 */
const RIM_FRINGE = { spacing: 1.4, size: [0.2, 0.6], inset: 0.35 } as const;
/** How far past the creek's half width the rim's fringe stays, as the planting's bank keep does. */
export const STREAM_KEEP = 1.3;

/** One rock of the rim's fringe: its place, its turn about y and its size. */
export interface RimRock {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly turn: number;
	readonly size: number;
}

/**
 * The rim's fringe's places: irregular mossy rocks that break the land's edge over the wall, spaced
 * unevenly and set in and out, with now and then a gap, so no row forms. None stands in the creek's
 * channel where it crosses the rim at a lip.
 */
export function rimFringePlaces(rim: Float32Array): RimRock[] {
	const next = random(83);
	const count = rim.length / 3;
	const places: RimRock[] = [];
	let run = 0;
	for (let k = 0; k < count; k++) {
		const a = k * 3;
		const b = ((k + 1) % count) * 3;
		run += Math.hypot(
			(rim[b] as number) - (rim[a] as number),
			(rim[b + 2] as number) - (rim[a + 2] as number),
		);
		if (run < RIM_FRINGE.spacing * (0.35 + 1.3 * next())) continue;
		run = 0;
		// Now and then a stretch of rim keeps no rock, so the row never reads as one line.
		if (next() < 0.18) continue;
		const [x, y, z] = [rim[a] as number, rim[a + 1] as number, rim[a + 2] as number];
		if (Math.abs(z - streamZ(x)) < streamHalf(x) * STREAM_KEEP) continue;
		const reach = Math.hypot(x, z) || 1;
		const inset = RIM_FRINGE.inset * next();
		const size = RIM_FRINGE.size[0] + (RIM_FRINGE.size[1] - RIM_FRINGE.size[0]) * next();
		places.push({
			x: x * (1 - inset / reach),
			y: y + 0.05,
			z: z * (1 - inset / reach),
			turn: next() * Math.PI * 2,
			size,
		});
	}
	return places;
}

/** Places the rim's fringe: irregular mossy rocks that break the land's edge over the wall. */
function rimFringe(
	{
		scene,
		geometry,
		materials,
		textures,
	}: Pick<SketchContext, 'scene' | 'geometry' | 'materials' | 'textures'>,
	rim: Float32Array,
	textureSize: number,
): void {
	const places = rimFringePlaces(rim);
	if (places.length === 0) return;
	const stone = geometry.fromArrays(
		mossy(rock(89, 1, [1, 0.5, 0.85], 0.22), 90, 0.6, {
			stone: [0.075, 0.08, 0.07],
			moss: TEXTURED_MOSS,
		}),
	);
	const batch = scene.createInstances(stone, places.length, {
		material: materials.standard({
			vertexColors: true,
			...rockMaps(textures, textureSize),
			roughness: 0.95,
		}),
		castShadows: true,
		receiveShadows: true,
	});
	places.forEach(({ x, y, z, turn, size }, row) => {
		batch.positions.set([x, y, z], row * 3);
		batch.rotations.set([0, Math.sin(turn / 2), 0, Math.cos(turn / 2)], row * 4);
		batch.scales.set([size * 1.1, size, size * 1.1], row * 3);
	});
	batch.markDirty();
}

/** Makes the cliff's walls under the land's rim. */
export function createCliff(
	{ scene, geometry, materials, textures }: SketchContext,
	rim: Float32Array,
	textureSize: number,
): void {
	const maps = rockMaps(textures, textureSize);
	scene.createMesh({
		mesh: geometry.fromArrays(wallArrays(rim)),
		material: materials.shader({
			wgsl: wallWgsl,
			vertexColors: true,
			roughness: 0.9,
			uniforms: { moss: [0.055, 0.046, 0.016], lichen: [0.05, 0.048, 0.043] },
			textures: {
				detail: maps.map,
				detailNormal: maps.normalMap,
				detailOrm: maps.metalnessRoughnessMap,
			},
		}),
		receiveShadows: true,
		castShadows: true,
	});
	rimFringe({ scene, geometry, materials, textures }, rim, textureSize);
}
