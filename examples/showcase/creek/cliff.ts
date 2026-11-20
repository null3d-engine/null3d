// The cliff's walls: dark volcanic rock that hangs from the rim of the land and runs down into the
// sea of cloud. The rock breaks into upright pillars and buttresses of uneven width, split by deep
// cracks and chimneys, and each pillar steps in and out down its height in blocks, which leaves
// small ledges and overhangs. Pits and crags roughen every face. The wall is one mesh in code: its
// top row is the land's own rim, vertex for vertex, so the two meet with no seam, and its rows
// spread out with depth, fine where the camera sees the rock and coarse down in the cloud.
import { type MeshArrays, math, type SketchContext } from '@null3d/engine';
import { Noise, random, type TexelSample, textureSet } from '../../lib/procedural';

/** How far the walls run down below the water's height, in meters: well into the cloud. */
export const WALL_FOOT = -44;
/** The rows of vertices from the rim down to the foot. */
const ROWS = 64;
/** How the rows spread: a power above 1 packs them toward the rim. */
const ROW_SPREAD = 1.5;
/** The narrowest and widest pillar, in meters along the rim. */
const PILLAR = [2.2, 4.2] as const;
/** How deep the cracks between the pillars cut into the rock, in meters. */
const CRACK = [0.7, 1.5] as const;
/** The shortest and tallest block that a pillar steps by, in meters. */
const BLOCK = [2, 5.5] as const;
/** How far a block stands out from or back into its pillar, in meters. */
const STEP = 0.75;
/** How far the rock spreads outward per meter of depth: the cliff widens a little toward its foot. */
const FLARE = 0.05;
/** The meters that one repeat of the rock's detail covers. */
const TILE = 2.2;

const noise = new Noise(53);
const { smoothstep } = math;

/** The rock's texel: pitted dark stone with grains, in a near-white tone that the colors tint. */
function rockTexel(u: number, v: number, out: TexelSample): void {
	const broad = noise.fbm2(u * 6, v * 6, 5, 6);
	const pits = smoothstep(noise.fbm2(u * 28, v * 28, 3, 28), 0.22, 0.42);
	const grain = noise.value2(u * 96, v * 96, 96);
	out.height = broad * 7 - pits * 3 + grain;
	const tone = 0.82 + 0.18 * broad - 0.12 * pits + 0.06 * grain;
	out.r = tone;
	out.g = tone * 0.97;
	out.b = tone * 0.93;
	out.roughness = 0.82 + 0.15 * broad;
	out.occlusion = 1 - 0.55 * pits;
}

/** One pillar: where it starts along the rim, its width, how far it stands out, and its blocks. */
interface Pillar {
	start: number;
	width: number;
	crack: number;
	/** Where each block's foot lies below the rim, in meters, from the top down. */
	blocks: number[];
	/** How far each block stands out from the pillar's face, in meters. */
	steps: number[];
}

/** Splits the rim's length into pillars of uneven width, each with its own run of blocks. */
function pillars(length: number): Pillar[] {
	const next = random(57);
	const list: Pillar[] = [];
	let at = 0;
	while (at < length) {
		const width = PILLAR[0] + (PILLAR[1] - PILLAR[0]) * next();
		const blocks: number[] = [];
		const steps: number[] = [];
		let foot = 0;
		while (foot < -WALL_FOOT + 10) {
			foot += BLOCK[0] + (BLOCK[1] - BLOCK[0]) * next();
			blocks.push(foot);
			steps.push((next() * 2 - 1) * STEP);
		}
		list.push({
			start: at,
			width,
			crack: CRACK[0] + (CRACK[1] - CRACK[0]) * next(),
			blocks,
			steps,
		});
		at += width;
	}
	// The last pillar closes the ring: it stretches to meet the first.
	const last = list[list.length - 1] as Pillar;
	last.width = length - last.start;
	return list;
}

/**
 * How far the rock stands in from the rim's line at a place along the rim and a depth below it, in
 * meters, and how deep in a crack the place lies, from 0 on a face to 1 in a crack's back.
 */
function relief(
	list: readonly Pillar[],
	length: number,
	along: number,
	depth: number,
): { offset: number; crack: number } {
	// The cracks wander a little down the wall, so no pillar is ruled straight.
	const wander = 0.9 * noise.fbm2(along * 0.05, depth * 0.06 + 3, 3);
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
	// A rough face with steep sides: the crack is a narrow cut between two faces, and a lesser crack
	// splits some pillars down the middle.
	const side = Math.abs(t * 2 - 1);
	const split = pillar.width > 3.2 ? 0.55 * (1 - Math.abs(t * 2 - 1 + 0.15)) ** 14 : 0;
	const crack = Math.max(side ** 5, split);
	let block = 0;
	while (block < pillar.blocks.length - 1 && (pillar.blocks[block] as number) < depth) block++;
	// A block's foot steps sharply into the next one, which leaves a ledge or an overhang there.
	const top = block === 0 ? 0 : (pillar.blocks[block - 1] as number);
	const into = smoothstep(depth - top, 0, 0.35);
	const before = block === 0 ? 0 : (pillar.steps[block - 1] as number);
	const step = before + ((pillar.steps[block] as number) - before) * into;
	const crags =
		0.45 * noise.fbm2(along * 0.45, depth * 0.3, 4) +
		0.18 * noise.fbm2(along * 2.2, depth * 1.4 + 7, 3);
	const bulge = 1.4 * noise.fbm2(along * 0.025 + 11, depth * 0.035, 3);
	return { offset: step + crags + bulge - pillar.crack * crack, crack };
}

/** Linear colors of the rock: charcoal faces, grey-brown lighter faces, and black in the cracks. */
const CHARCOAL = [0.034, 0.032, 0.03];
const GREY_BROWN = [0.085, 0.077, 0.068];

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
	const list = pillars(length);
	const columns = count + 1;
	const positions = new Float32Array(columns * (ROWS + 1) * 3);
	const colors = new Float32Array(columns * (ROWS + 1) * 3);
	const uvs = new Float32Array(columns * (ROWS + 1) * 2);
	for (let row = 0; row <= ROWS; row++) {
		const share = (row / ROWS) ** ROW_SPREAD;
		for (let column = 0; column < columns; column++) {
			const k = (column % count) * 3;
			const [x, top, z] = [rim[k] as number, rim[k + 1] as number, rim[k + 2] as number];
			const y = top + (WALL_FOOT - top) * share;
			const depth = top - y;
			const run = along[column] as number;
			const { offset, crack } = relief(list, length, run, depth);
			// The rock starts at the rim's own line, and its relief grows in over the first meter.
			const grow = smoothstep(depth, 0, 1.2);
			const out = (offset + FLARE * depth) * grow;
			const reach = Math.hypot(x, z);
			const v = (row * columns + column) * 3;
			positions[v] = x * (1 + out / reach);
			positions[v + 1] = y;
			positions[v + 2] = z * (1 + out / reach);
			const lighter = smoothstep(noise.fbm2(run * 0.08, depth * 0.05 + 5, 3), -0.05, 0.3);
			const dark = 1 - 0.9 * crack * grow;
			for (let c = 0; c < 3; c++) {
				const tone =
					(CHARCOAL[c] as number) + ((GREY_BROWN[c] as number) - (CHARCOAL[c] as number)) * lighter;
				colors[v + c] = tone * dark;
			}
			uvs.set([run / TILE, -y / TILE], (row * columns + column) * 2);
		}
	}
	const indices = new Uint32Array(count * ROWS * 6);
	for (let row = 0; row < ROWS; row++)
		for (let column = 0; column < count; column++) {
			const a = row * columns + column;
			const b = a + columns;
			indices.set([a, a + 1, b, a + 1, b + 1, b], (row * count + column) * 6);
		}
	return { positions, colors, uvs, indices, computeNormals: true };
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
    var color = s.baseColor * tint;
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
	const maps = textureSet(textures, textureSize, rockTexel);
	scene.createMesh({
		mesh: geometry.fromArrays(wallArrays(rim)),
		material: materials.shader({
			wgsl: wallWgsl,
			vertexColors: true,
			roughness: 0.9,
			uniforms: { moss: [0.09, 0.075, 0.025], lichen: [0.13, 0.13, 0.115] },
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
