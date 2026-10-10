// The creek's grass: tufts of curved blades in instance batches, which cast and receive the sun's
// shadows. A vertex offset bends each blade in the wind: gusts that roll across the banks, and a
// flutter of each tuft's own. The surface function tints each tuft. Each row's values carry its
// tuft's traits: its phase in the wind, its tint, and its turn about y, which the vertex offset
// undoes for the wind, so the wind blows one way over every tuft. The shadow passes run the same
// vertex offset, so the shadows sway with the grass. Only the tufts near the water cast shadows and
// show in its reflection.
import {
	type InstanceBatch,
	type MeshArrays,
	type QualityPreset,
	quat,
	type SketchContext,
} from '@null3d/engine';
import { random } from '../../lib/procedural';
import { fromStream, groundHeight, streamHalf, streamZ, WATER } from './land';

/** Tufts of grass at each preset, over the three tuft shapes. */
export const TUFTS: Record<QualityPreset, number> = {
	low: 3000,
	medium: 9000,
	high: 18000,
	ultra: 27000,
};
/** The shapes of tuft, each one batch. */
const SHAPES = 3;
/** Blades in each tuft, and the segments of each blade. */
const BLADES = 13;
const SEGMENTS = 3;

const wgsl = /* wgsl */ `
struct Uniforms { wind: vec2f, sway: f32 }

// A tuft's row values: x is its phase in the wind, from 0 to 2 pi, y a value from 0 to 1 that picks
// its tint, and z and w the cosine and sine of its turn about y.

fn vertexOffset(input: VertexInput) -> vec3f {
    let traits = object.values;
    let p = object.position.xz;
    // Gusts: broad waves of wind that roll across the banks, and a flutter of each tuft's own.
    let gust = 0.5 + 0.5 * sin(dot(p, material.wind) * 0.35 - frame.time * 1.6);
    let flutter = sin(frame.time * 2.7 + traits.x + input.position.x * 7.0);
    let bend = input.uv.y * input.uv.y * material.sway * (0.4 + 0.8 * gust + 0.25 * flutter);
    // The wind's direction in the tuft's own space, against its turn.
    let w = normalize(material.wind);
    let along = vec2f(w.x * traits.z - w.y * traits.w, w.x * traits.w + w.y * traits.z);
    return vec3f(along.x * bend, -0.4 * bend * bend, along.y * bend);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let traits = object.values;
    // A share of the tufts dry toward their tips, and each tuft's green differs a little.
    let dry = smoothstep(0.62, 1.0, traits.y) * input.uv.y;
    s.baseColor *= mix(vec3f(0.8 + 0.4 * traits.y), vec3f(1.7, 1.3, 0.45), dry);
    // Both faces light as the upper face, since the blades' normals lean up.
    s.normal = select(input.normal, -input.normal, input.normal.y < 0.0);
    return s;
}
`;

/**
 * One tuft: blades that lean out from its middle and curve over. Each blade is a strip that narrows
 * to a point. Its normals lean up, so a blade lights like the ground under it, and its colors run
 * from a dark root to a lighter tip.
 */
function tuft(seed: number): MeshArrays {
	const next = random(seed);
	const perBlade = SEGMENTS * 2 + 1;
	const positions = new Float32Array(BLADES * perBlade * 3);
	const normals = new Float32Array(BLADES * perBlade * 3);
	const colors = new Float32Array(BLADES * perBlade * 3);
	const uvs = new Float32Array(BLADES * perBlade * 2);
	const indices: number[] = [];
	for (let b = 0; b < BLADES; b++) {
		const angle = next() * Math.PI * 2;
		const [ox, oz] = [Math.cos(angle), Math.sin(angle)];
		const root = 0.015 + 0.11 * next();
		const height = 0.12 + 0.22 * next() ** 1.5;
		const lean = (0.1 + 0.25 * next()) * height;
		const width = 0.016 + 0.012 * next();
		const twist = angle + Math.PI / 2 + (next() - 0.5) * 0.8;
		const [sx, sz] = [Math.cos(twist), Math.sin(twist)];
		// The face's normal, across the strip, leaned up by two thirds.
		const [fx, fz] = [-sz, sx];
		const length = Math.hypot(fx * 0.35, 1, fz * 0.35);
		const first = b * perBlade;
		for (let j = 0; j <= SEGMENTS; j++) {
			const t = j / SEGMENTS;
			const cx = ox * (root + lean * t * t);
			const cz = oz * (root + lean * t * t);
			const cy = height * (t - 0.15 * t * t);
			const half = (width / 2) * (1 - t) ** 0.9;
			const sides = j === SEGMENTS ? [0] : [-1, 1];
			for (const side of sides) {
				const v = first + (j === SEGMENTS ? SEGMENTS * 2 : j * 2 + (side + 1) / 2);
				positions.set([cx + sx * half * side, cy, cz + sz * half * side], v * 3);
				normals.set([(fx * 0.35) / length, 1 / length, (fz * 0.35) / length], v * 3);
				const shade = 0.3 + 0.7 * t;
				colors.set([shade * (0.9 + 0.25 * t), shade, shade * (0.85 - 0.2 * t)], v * 3);
				uvs.set([(side + 1) / 2, t], v * 2);
			}
		}
		for (let j = 0; j < SEGMENTS - 1; j++) {
			const a = first + j * 2;
			indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
		}
		indices.push(first + SEGMENTS * 2 - 2, first + SEGMENTS * 2 - 1, first + SEGMENTS * 2);
	}
	return { positions, normals, colors, uvs, indices };
}

/** A scratch quaternion for each tuft's turn. */
const spin = quat.create();

/** The layer of the grass far from the water, which the camera draws and the reflection does not. */
export const INLAND_LAYER = 2;
/** Tufts nearer the water than this many half widths of the stream show in its reflection. */
const EDGE = 1.7;
/** The width of the squares that group nearby rows, in meters. */
const CELL = 4;
const PRESETS: readonly QualityPreset[] = ['low', 'medium', 'high', 'ultra'];

/** A tuft's place and size: x, y, z, then its scales along x, y and z. */
type Tuft = [number, number, number, number, number, number];

/** The grass's batches, which `fit` sizes to a preset. */
export interface Grass {
	batches: InstanceBatch[];
	/** Draws the preset's share of the tufts. */
	fit(preset: QualityPreset): void;
}

/** The rows of a list of tufts that a preset draws: its share of them, from the first. */
const share = (count: number, preset: QualityPreset) =>
	Math.ceil((count * TUFTS[preset]) / TUFTS.ultra);

/**
 * Orders tufts so that each preset draws an even spread of them, and nearby rows sit together. The
 * tufts come in a random order, so the first rows of any count spread over the banks. Then each
 * preset's added rows are sorted by square, so the GPU path that culls rows in groups skips the
 * groups out of view.
 */
function ordered(tufts: Tuft[]): Tuft[] {
	const key = (t: Tuft) => Math.floor(t[0] / CELL) * 1000 + Math.floor(t[2] / CELL);
	let from = 0;
	return PRESETS.flatMap((preset) => {
		const to = share(tufts.length, preset);
		const band = tufts.slice(from, to).sort((a, b) => key(a) - key(b));
		from = to;
		return band;
	});
}

/**
 * Makes the tufts. They grow on the banks, densest near the water, in patches, and not on steep
 * ground or where `clear` keeps a place bare. The tufts near the water show in its reflection and
 * cast shadows. The others only receive shadows, which costs the shadow and reflection passes far
 * fewer triangles.
 */
export function createGrass(
	{ scene, geometry, materials }: SketchContext,
	clear: (x: number, z: number) => boolean,
): Grass {
	const material = materials.shader({
		wgsl,
		color: '#5f9a2a',
		vertexColors: true,
		roughness: 0.75,
		specularIntensity: 0.4,
		doubleSided: true,
		uniforms: { wind: [0.8, 0.6], sway: 0.12 },
	});
	const next = random(23);
	const batches: InstanceBatch[] = [];
	for (let shape = 0; shape < SHAPES; shape++) {
		const edge: Tuft[] = [];
		const inland: Tuft[] = [];
		while (edge.length + inland.length < TUFTS.ultra / SHAPES) {
			const x = (next() * 2 - 1) * 22;
			const side = next() < 0.5 ? -1 : 1;
			const z = streamZ(x) + side * (streamHalf(x) * 0.97 + 11 * next() ** 1.5);
			const y = groundHeight(x, z);
			const slope = Math.abs(groundHeight(x + 0.2, z) - y) + Math.abs(groundHeight(x, z + 0.2) - y);
			const patch = Math.sin(x * 0.7 + Math.sin(z * 0.9) * 2) + Math.sin(z * 0.5 - x * 0.3);
			if (y < WATER + 0.03 || slope > 0.16 || clear(x, z)) continue;
			if (patch < -0.9 && fromStream(x, z) > 1.6 && next() < 0.8) continue;
			const size = 0.75 + 0.6 * next();
			const place: Tuft = [
				x,
				y - 0.02,
				z,
				size * (0.85 + 0.3 * next()),
				size,
				size * (0.85 + 0.3 * next()),
			];
			(fromStream(x, z) < EDGE ? edge : inland).push(place);
		}
		const mesh = geometry.fromArrays(tuft(101 + shape));
		for (const [tufts, near] of [
			[edge, true],
			[inland, false],
		] as const) {
			const batch = scene.createInstances(mesh, tufts.length, {
				material,
				castShadows: near,
				receiveShadows: true,
				layers: near ? 1 : INLAND_LAYER,
				values: true,
			});
			// A batch made with values has its array.
			const values = batch.values as Float32Array;
			ordered(tufts).forEach((t, row) => {
				const turn = next() * Math.PI * 2;
				batch.positions.set([t[0], t[1], t[2]], row * 3);
				batch.rotations.set(quat.fromEuler(spin, 0, turn, 0), row * 4);
				batch.scales.set([t[3], t[4], t[5]], row * 3);
				values.set([next() * Math.PI * 2, next(), Math.cos(turn), Math.sin(turn)], row * 4);
			});
			batch.markDirty();
			batches.push(batch);
		}
	}
	return {
		batches,
		fit(preset) {
			for (const batch of batches) batch.setActiveCount(share(batch.count, preset));
		},
	};
}
