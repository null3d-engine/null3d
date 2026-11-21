// The cliff's walls: warm near-black volcanic rock that hangs from the rim of the land and runs down
// into the sea of cloud. The rock breaks into upright pillars and buttresses of uneven width, cut by
// black cracks and chimneys. Each pillar steps in and out down its height in blocks, each block's
// face tilted its own way, which leaves ledges, overhangs and an angular, craggy face. The wall is
// one mesh in code: its top row is the land's own rim, vertex for vertex, so the two meet with no
// seam, and every noise along the rim reads round a circle, so the ring of columns closes on itself.
// Its rows spread out with depth, fine where the camera sees the rock and coarse down in the cloud.
import { type MeshArrays, math, type SketchContext } from '@null3d/engine';
import { Noise, random, type TexelSample, textureSet } from '../../lib/procedural';
import { LIPS, streamHalf, streamZ } from './land';

/** How far the walls run down below the water's height, in meters: well into the cloud. */
export const WALL_FOOT = -44;
/** The rows of vertices from the rim down to the foot. */
const ROWS = 64;
/** How the rows spread: a power above 1 packs them toward the rim. */
const ROW_SPREAD = 1.5;
/** The narrowest and widest pillar, in meters along the rim. */
const PILLAR = [1.3, 4.6] as const;
/** How deep the cracks between the pillars cut into the rock, in meters. */
const CRACK = [0.6, 1.8] as const;
/** The share of the crack's side of a pillar that its cut spans: a narrow notch. */
const CRACK_SPAN = 0.22;
/** The share of pillars that stand out as buttresses, and how far, in meters. */
const BUTTRESS = { share: 0.22, out: [0.7, 1.5] as const } as const;
/** The shortest and tallest block that a pillar steps by, in meters. */
const BLOCK = [1.1, 3.6] as const;
/** How far a block stands out from or back into its pillar, and how far its face tilts across it. */
const STEP = 1.05;
const TILT = 0.45;
/**
 * How far the rock's face stands back under the rim's line, in meters, so the land's edge overhangs
 * the rock a little, as soil and roots do on the concept's rim.
 */
const UNDERCUT = 0.55;
/**
 * The notch under each lip: how far the rock stands back under the fall, in meters at the least, so
 * the water drops clear of the wall; the share of the creek's half width that the fall takes, as
 * the sketch gives it; how far the notch reaches past the fall on each side, in meters, as agreed
 * with the water add-on's falls, and how far its ledge in that margin stands back; the shares of
 * the half width where the water's sheet runs on under the banks and the rock stands flush, and
 * where no buttress may stand proud enough to hide the fall; how far the rock stands proud there,
 * in meters, and the share of any crag past that which folds back into the wall as a hollow instead.
 */
const LIP_RECESS = {
	back: 0.9,
	fall: 0.9,
	margin: 0.4,
	ledge: 0.35,
	sheet: 1.45,
	clear: 3,
	proud: 0.15,
	fold: 0.6,
} as const;
/** How deep the upright fissures cut into the face beside each lip, and how far its ledges step. */
const LIP_BREAK = { fissure: 0.7, ledge: 0.45 } as const;
/** How far the rock spreads outward per meter of depth: the cliff widens a little toward its foot. */
const FLARE = 0.05;
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
	// A warm cast, so the shaded faces under the cool sky still read brown-black, as the concept's.
	out.r = tone;
	out.g = tone * 0.9;
	out.b = tone * 0.78;
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
	const face = (b: Block | undefined) => (b ? b.step + b.tilt * (t - 0.5) * pillar.width * 0.5 : 0);
	const step = face(above) + (face(block) - face(above)) * into;
	const crags =
		0.65 * aroundNoise(along, length, 0.35, depth * 0.35, 4) +
		0.4 * Math.abs(aroundNoise(along, length, 1.2, depth * 1.2 + 7, 3)) +
		0.18 * aroundNoise(along, length, 4, depth * 4 + 2, 2);
	const bulge = 1.4 * aroundNoise(along, length, 0.025, depth * 0.035 + 11, 3);
	// Sharp crests and thin black fissures across the faces, which make the rock craggy close up.
	const crest =
		0.22 *
		Math.max(0, 1 - 2.2 * Math.abs(aroundNoise(along, length, 2.4, depth * 2.4 + 17, 2))) ** 4;
	const fissure =
		1 - smoothstep(Math.abs(aroundNoise(along, length, 1.6, depth * 1.1 + 23, 2)), 0, 0.035);
	const tone = (above ? above.tone + (block.tone - above.tone) * into : block.tone) * (1 - crack);
	return {
		offset:
			pillar.out + step + crags + bulge + crest - pillar.crack * crack - 0.12 * fissure - UNDERCUT,
		crack: Math.max(crack, 0.85 * fissure),
		tone,
	};
}

/** Linear colors of the rock: warm near-black faces, a dark grey-brown on the lighter ones. */
const CHARCOAL = [0.026, 0.017, 0.009];
const GREY_BROWN = [0.06, 0.04, 0.022];

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
			// Under each lip the rock stands back below the water, so the fall leaves it clear. Beside
			// it, under the banks, where the water's sheet runs on under the ground, the rock stands
			// flush, so the sheet stays inside it; and on round, no buttress stands proud enough to
			// hide the fall.
			const { fall, notch, sheet, clear } = lipShares(x, z);
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
			// The notch: a ledge stepped back a little across the margin beside the fall, and the rock
			// stood well back under the fall itself, so it drops clear with rock showing at both sides.
			const ledged = flush + (Math.min(flush, -LIP_RECESS.ledge) - flush) * notch;
			const shaped = ledged + (Math.min(ledged, -LIP_RECESS.back) - ledged) * fall;
			// The rock starts at the rim's own line, and its relief grows in over the first meter.
			const grow = smoothstep(depth, 0, 1.2);
			const out = (shaped + FLARE * depth * (1 - clear)) * grow;
			const reach = Math.hypot(x, z);
			const v = (row * columns + column) * 3;
			positions[v] = x * (1 + out / reach);
			positions[v + 1] = y;
			positions[v + 2] = z * (1 + out / reach);
			const lighter = smoothstep(aroundNoise(run, length, 0.08, depth * 0.05 + 5, 3), -0.1, 0.3);
			const light = 0.55 * tone + 0.45 * lighter;
			const dark = 1 - 0.95 * crack * grow;
			for (let c = 0; c < 3; c++) {
				const shade =
					(CHARCOAL[c] as number) + ((GREY_BROWN[c] as number) - (CHARCOAL[c] as number)) * light;
				colors[v + c] = shade * dark;
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
 * How near a point of the rim lies to a lip: `water`, from 0 to 1 across the width where the water
 * shows at the lip; `sheet`, over the banks either side, where the water's sheet runs on under the
 * ground; and `clear`, on round the rim either side, where the fall must show past the rock.
 */
function lipShares(
	x: number,
	z: number,
): { fall: number; notch: number; sheet: number; clear: number } {
	let fall = 0;
	let notch = 0;
	let sheet = 0;
	let clear = 0;
	for (const lip of [LIPS.west, LIPS.east]) {
		const half = streamHalf(lip);
		const reach = Math.hypot(x - lip, z - streamZ(lip));
		const share = (from: number, over: number) => 1 - smoothstep(reach, from, from + over);
		fall = Math.max(fall, share(half * LIP_RECESS.fall, 0.15));
		notch = Math.max(notch, share(half * LIP_RECESS.fall + LIP_RECESS.margin, 0.15));
		sheet = Math.max(sheet, share(half * LIP_RECESS.sheet, 0.8));
		clear = Math.max(clear, share(half * LIP_RECESS.clear, 3));
	}
	return { fall, notch, sheet, clear };
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
    color = mix(color, material.lichen * tint, streaks * 0.22 * (1.0 - mossy));
    s.baseColor = mix(color, material.moss * tint, mossy);
    s.roughness = mix(orm.g, 0.95, mossy);
    s.occlusion = orm.r;
    return s;
}
`;

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
}
