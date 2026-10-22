// The sky lanes of Skyway: a river of hover cars streaming along every street, in four directions.
// The cars never move on the CPU. Each row carries its lane's start offset, its speed and the lane's
// length, and a vertex offset carries it along the lane from the clock, wrapping at the far end. One
// row's work per frame is the clock's, so the count follows the preset with no frame cost at all.
//
// The material paints the hull dark and adds the lights from the car's own coordinates: a pair of
// red bars and a strip at the tail, white lamps at the nose, and a glowing skirt under the belly in
// the car's own tint. Those lights are what the scene reads as traffic, so they bloom.
import { math, type QualityPreset, quat, type SketchContext } from '@null3d/engine';
import { EFFECT_LAYER } from '../../lib/layers';
import { carHull } from './hull';
import {
	BLOCKS,
	LANE_HIGH,
	LANE_LOW,
	LANE_OFFSET,
	LANE_SPAN,
	LANES_PER_STREET,
	streetLine,
} from './layout';

/** How many cars each preset draws. */
export const CARS: Record<QualityPreset, number> = {
	low: 30_000,
	medium: 50_000,
	high: 75_000,
	ultra: 100_000,
};

/** The four headings, as the yaw that turns a car's nose from +Z onto its lane. */
const HEADINGS = [
	{ yaw: Math.PI / 2, alongX: true, sign: 1 },
	{ yaw: -Math.PI / 2, alongX: true, sign: -1 },
	{ yaw: 0, alongX: false, sign: 1 },
	{ yaw: Math.PI, alongX: false, sign: -1 },
] as const;

/** How many cars one lane holds at the fullest count; a preset draws a share of every lane. */
const PER_LANE = 157;

const wgsl = /* wgsl */ `
struct Uniforms { heading: f32 }

// The row's place along its lane, from its start offset and the clock, wrapped at the lane's end.
fn vertexOffset(input: VertexInput) -> vec3f {
    let span = max(object.values.z, 1.0);
    let travelled = object.values.x + frame.time * object.values.y;
    return vec3f(0.0, 0.0, travelled - span * floor(travelled / span));
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    // The car's own axes, from the row's heading: its length runs along local +Z.
    let c = cos(material.heading);
    let sn = sin(material.heading);
    let d = input.worldPosition - object.position;
    let lx = c * d.x - sn * d.z;
    let ly = d.y;
    let lz = sn * d.x + c * d.z;
    let tint = object.values.w;

    s.baseColor = mix(vec3f(0.017, 0.02, 0.027), vec3f(0.09, 0.1, 0.12) * (0.4 + tint), 0.45);
    s.metalness = 0.7;
    s.roughness = 0.34;
    s.emissive = vec3f(0.0);

    // Tail lights: two bars, and a thin strip above them.
    let rear = step(lz, -1.72);
    let bars = rear * step(0.2, ly) * step(ly, 0.42) * step(0.16, abs(lx)) * step(abs(lx), 0.6);
    s.emissive += vec3f(1.0, 0.1, 0.035) * bars * 6.0;
    let strip = rear * step(0.46, ly) * step(ly, 0.54) * step(abs(lx), 0.72);
    s.emissive += vec3f(0.85, 0.05, 0.02) * strip * 4.0;
    // Nose lamps.
    let nose = step(1.68, lz) * step(0.18, ly) * step(ly, 0.36) * step(0.1, abs(lx)) * step(abs(lx), 0.5);
    s.emissive += vec3f(0.8, 0.9, 1.0) * nose * 4.5;
    // The hover skirt glows under the belly, in the car's own colour.
    let skirt = step(ly, 0.16) * step(0.02, ly);
    s.emissive += mix(vec3f(0.1, 0.55, 1.0), vec3f(1.0, 0.18, 0.65), tint) * skirt * 2.2;
    return s;
}
`;

/** The traffic of the sky lanes. */
export interface Traffic {
	/** Draws the cars of a preset. */
	fit(preset: QualityPreset): void;
	/** Draws `count` cars, as the HUD's Traffic buttons ask. */
	setCount(count: number): void;
	/** The cars that draw now. */
	readonly count: number;
}

/** Builds every lane and its cars. */
export function createTraffic(ctx: SketchContext): Traffic {
	const { scene, materials } = ctx;
	const mesh = carHull(ctx, { reach: LANE_SPAN });
	const half = LANE_SPAN / 2;
	math.seed(77);
	// One batch for each heading, because a row's own heading sets how its lights face.
	const batches = HEADINGS.map((lane) => {
		const heading = quat.create();
		quat.setAxisAngle(heading, [0, 1, 0], lane.yaw);
		const material = materials.shader({
			wgsl,
			uniforms: { heading: lane.yaw },
			color: '#20242c',
			roughness: 0.34,
			metalness: 0.7,
			contactShadows: false,
		});
		const rows: {
			x: number;
			y: number;
			z: number;
			speed: number;
			offset: number;
			tint: number;
		}[] = [];
		for (let street = 0; street <= BLOCKS; street++) {
			for (let level = 0; level < LANES_PER_STREET; level++) {
				const altitude = LANE_LOW + (level * (LANE_HIGH - LANE_LOW)) / (LANES_PER_STREET - 1);
				for (const side of [-1, 1]) {
					const across = streetLine(street) + side * LANE_OFFSET;
					for (let slot = 0; slot < PER_LANE; slot++) {
						rows.push({
							x: lane.alongX ? -lane.sign * half : across,
							y: altitude + math.randFloat(-0.5, 0.5),
							z: lane.alongX ? across : -lane.sign * half,
							speed: math.randFloat(19, 43),
							offset: ((slot + math.randFloatSpread(0.6)) / PER_LANE) * LANE_SPAN,
							tint: math.random(),
						});
					}
				}
			}
		}
		// Shuffle the rows, so a preset that draws a share of them thins every lane alike.
		for (let k = rows.length - 1; k > 0; k--) {
			const pick = math.randInt(0, k);
			const swap = rows[k] as (typeof rows)[number];
			rows[k] = rows[pick] as (typeof rows)[number];
			rows[pick] = swap;
		}
		return {
			heading,
			batch: scene.createInstances(mesh, rows.length, {
				material,
				values: true,
				layers: EFFECT_LAYER,
			}),
			rows,
		};
	});
	for (const entry of batches) {
		const { batch, rows } = entry;
		// The arrays are read once: a hundred thousand rows written one by one would otherwise
		// make a small array for every value of every row.
		const positions = batch.positions;
		const rotations = batch.rotations;
		const scales = batch.scales;
		const values = batch.values as Float32Array;
		for (let k = 0; k < rows.length; k++) {
			const car = rows[k] as (typeof rows)[number];
			positions[k * 3] = car.x;
			positions[k * 3 + 1] = car.y;
			positions[k * 3 + 2] = car.z;
			const heading = entry.heading;
			rotations[k * 4] = heading[0] as number;
			rotations[k * 4 + 1] = heading[1] as number;
			rotations[k * 4 + 2] = heading[2] as number;
			rotations[k * 4 + 3] = heading[3] as number;
			scales[k * 3] = 1;
			scales[k * 3 + 1] = 1;
			scales[k * 3 + 2] = 1;
			values[k * 4] = car.offset;
			values[k * 4 + 1] = car.speed;
			values[k * 4 + 2] = LANE_SPAN;
			values[k * 4 + 3] = car.tint;
		}
		batch.markDirty(0, rows.length);
		entry.rows = [];
	}
	const total = batches.reduce((sum, entry) => sum + entry.batch.count, 0);
	let drawn = 0;

	/** Draws `count` cars, each heading taking its share from the front of its shuffled rows. */
	const setCount = (count: number): void => {
		drawn = Math.min(count, total);
		const share = Math.round(drawn / batches.length);
		for (const entry of batches) entry.batch.setActiveCount(Math.min(entry.batch.count, share));
	};

	return {
		fit(preset) {
			setCount(CARS[preset]);
		},
		setCount,
		get count() {
			return drawn;
		},
	};
}
