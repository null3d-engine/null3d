// The creek's water. A grid at the water's height moves its vertices with waves that the current
// carries downstream. Its surface function adds finer ripples to the normal, which catch the sun as
// glints. A reflection pass mirrors the banks and the sky, and the light from the stony bed comes
// through the water, bent by the ripples and tinted by its depth. Caustics, the sunlight that the
// ripples focus, play over the bed. The water is clear at its edges, where it is shallow, and foams
// where it meets the banks and the stones, with a trail of foam downstream of each stone.
import type { MeshArrays, QualityPreset, SketchContext, Texture } from '@null3d/engine';
import { STREAM_REACH, WATER } from './land';

/** A stone where it breaks the water: its middle and its radius at the water's height. */
export interface Obstacle {
	x: number;
	z: number;
	r: number;
}

/** The area of the map of foam around the stones, in meters, and its texels on each side. */
const FOAM = { x: 30, z: 6.5, width: 1024, height: 224 } as const;
/**
 * The frames between two draws of the reflection at each preset. The camera drifts slowly, so a
 * reflection drawn every other frame looks the same, at half the cost of the scene's costliest pass.
 */
const REFLECT_EVERY: Record<QualityPreset, number> = { low: 2, medium: 2, high: 1, ultra: 1 };

const wgsl = /* wgsl */ `
#import null3d::noise::{value2}
#import null3d::reflection::{reflection_uv}

struct Uniforms { flow: f32, ripple: f32, caustics: vec3f }

var mirror: texture_2d<f32>;
var foamMap: texture_2d<f32>;

/// Caustics: bright, thin ridges where the ripples focus the light, which drift with the current.
fn caustics(p: vec2f, t: f32) -> f32 {
    let q = p * 4.6 + vec2f(material.flow * t * 4.0, 0.0);
    let a = sin(q.x * 3.1 + t * 1.3 + sin(q.y * 2.3 - t));
    let b = sin(q.y * 3.7 - t * 1.1 + sin(q.x * 1.9 + t * 0.7));
    let c = sin((q.x + q.y) * 2.6 + t * 0.9 + sin(q.x * 1.3 - q.y * 0.7));
    let v = (a + b + c) / 3.0;
    // Patches of brighter and fainter light keep the net from looking even.
    return pow(1.0 - abs(v), 14.0) * (0.35 + 0.65 * value2(p * 0.8 + vec2f(t * 0.1, 0.0)));
}

/// The water's height at a point, and its slopes along x and z: long waves that the current carries
/// downstream, and with fine set, shorter ripples across them.
fn waves(p: vec2f, t: f32, fine: bool) -> vec3f {
    // Each wave: its direction, its wave number, and how fast it runs against the current.
    let list = array<vec4f, 6>(
        vec4f(1.0, 0.15, 2.3, 0.9),
        vec4f(0.8, -0.6, 3.7, 0.7),
        vec4f(0.6, 0.8, 5.9, 0.5),
        vec4f(1.0, -0.25, 11.0, 1.2),
        vec4f(-0.3, 1.0, 17.0, 0.6),
        vec4f(0.9, 0.45, 29.0, 1.6),
    );
    var h = 0.0;
    var slope = vec2f(0.0);
    let count = select(3u, 6u, fine);
    for (var k = 0u; k < count; k++) {
        let w = list[k];
        let dir = normalize(w.xy);
        let amplitude = material.ripple * 0.05 / w.z;
        let phase = w.z * (dot(dir, p) - material.flow * t * dir.x) - w.w * t;
        h += amplitude * sin(phase);
        slope += dir * (amplitude * w.z * cos(phase));
    }
    return vec3f(h, slope);
}

/// The water's depth under a point, from the same bends and widths of the stream as the land's.
fn depthAt(p: vec2f) -> f32 {
    let middle = 1.4 * sin(p.x * 0.11 + 0.6) + 0.5 * sin(p.x * 0.27);
    let halfWidth = 1.9 + 0.45 * sin(p.x * 0.19 + 1.3);
    let across = abs(p.y - middle) / halfWidth;
    return 0.62 * (1.0 - smoothstep(0.72, 1.32, across));
}

fn vertexOffset(input: VertexInput) -> vec3f {
    return vec3f(0.0, waves(input.position.xz, frame.time, false).x, 0.0);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let p = input.worldPosition.xz;
    let w = waves(p, frame.time, true);
    s.normal = normalize(vec3f(-w.y, 1.0, -w.z));
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let uv = reflection_uv(clip, w.yz * 0.08);
    s.reflection = vec4f(textureSampleLevel(mirror, mirrorSampler, uv, 0.0).rgb, 1.0);
    // Shallow water at the edges bends and tints the bed less, and carries a little foam.
    let depth = depthAt(p);
    s.thickness = max(depth, 0.02);
    let edgeFoam = (1.0 - smoothstep(0.0, 0.05, depth)) * smoothstep(0.0, 0.03, w.x + 0.012);
    // Foam around the stones: the map holds how near each point lies to a stone, stretched
    // downstream, and moving noise breaks it into flecks that the current carries away.
    // The map covers x from -30 to 30 m and z from -6.5 to 6.5 m.
    let near = textureSampleLevel(foamMap, foamMapSampler, vec2f((p.x + 30.0) / 60.0, (p.y + 6.5) / 13.0), 0.0).r;
    let drift = p * vec2f(5.0, 9.0) - vec2f(material.flow * frame.time * 6.0, 0.0);
    let flecks = 0.6 * value2(drift) + 0.4 * value2(drift * 2.3 + 7.0);
    let stoneFoam = 0.85 * smoothstep(0.45, 0.95, near * (0.3 + 1.0 * flecks));
    let foam = max(edgeFoam, stoneFoam);
    // The caustics show on the bed, under clear water that is not too deep, and not under foam.
    let bed = p + w.yz * depth * 0.6;
    let reach = smoothstep(0.02, 0.15, depth) * exp(-depth * 1.4) * (1.0 - foam);
    s.emissive += material.caustics * caustics(bed, frame.time) * reach;
    s.transmission = 1.0 - 0.7 * foam;
    s.baseColor = mix(s.baseColor, vec3f(0.8), foam);
    s.roughness = mix(s.roughness, 0.6, foam);
    return s;
}
`;

/** The water's grid: finer near the middle of the land, where the camera looks. */
function waterGrid(length: number, width: number, quadsX: number, quadsZ: number): MeshArrays {
	const row = quadsX + 1;
	const count = row * (quadsZ + 1);
	const positions = new Float32Array(count * 3);
	const uvs = new Float32Array(count * 2);
	for (let v = 0; v < count; v++) {
		const s = ((v % row) / quadsX) * 2 - 1;
		const x = (length / 2) * (0.25 * s + 0.75 * s * s * s);
		const z = (Math.floor(v / row) / quadsZ - 0.5) * width;
		positions.set([x, 0, z], v * 3);
		uvs.set([x / 4, z / 4], v * 2);
	}
	const indices = new Uint32Array(quadsX * quadsZ * 6);
	for (let q = 0; q < quadsX * quadsZ; q++) {
		const a = Math.floor(q / quadsX) * row + (q % quadsX);
		indices.set([a, a + row, a + 1, a + 1, a + row, a + row + 1], q * 6);
	}
	const normals = new Float32Array(count * 3);
	for (let v = 0; v < count; v++) normals[v * 3 + 1] = 1;
	return { positions, normals, uvs, indices };
}

/**
 * The map of foam around the stones: each texel holds how near it lies to a stone's edge, from 1 at
 * the edge to 0 a little way off. Downstream, toward +x, the reach stretches into a trail.
 */
function foamMap({ textures }: SketchContext, obstacles: readonly Obstacle[]): Texture {
	const { width, height } = FOAM;
	const texel = (2 * FOAM.x) / width;
	const near = new Float32Array(width * height);
	const reach = 0.35;
	const trail = 1.6;
	for (const { x, z, r } of obstacles) {
		const [i0, i1] = [(x - r - reach + FOAM.x) / texel, (x + r + trail + FOAM.x) / texel];
		const [j0, j1] = [(z - r - reach + FOAM.z) / texel, (z + r + reach + FOAM.z) / texel];
		for (let j = Math.max(0, Math.floor(j0)); j <= Math.min(height - 1, Math.ceil(j1)); j++) {
			for (let i = Math.max(0, Math.floor(i0)); i <= Math.min(width - 1, Math.ceil(i1)); i++) {
				const dx = i * texel - FOAM.x - x;
				const dz = j * texel - FOAM.z - z;
				// Downstream, the distance counts less, so the foam trails behind the stone.
				const along = dx > 0 ? dx * (reach / trail) : dx;
				const edge = Math.hypot(along, dz) - r;
				const value = 1 - Math.min(Math.max(edge / reach, 0), 1);
				const k = j * width + i;
				if (edge > -r && value > (near[k] as number)) near[k] = value;
			}
		}
	}
	const data = new Uint8Array(width * height * 4);
	for (let k = 0; k < near.length; k++) data[k * 4] = Math.round((near[k] as number) * 255);
	return textures.fromData({ width, height, data, colorSpace: 'linear' });
}

/** The caustics' light: its color and strength in each mood. */
export interface Water {
	/** Sets the caustics' light, a linear color whose brightness is their strength. */
	setCaustics(light: readonly [number, number, number]): void;
	/** Draws the reflection as often as the preset affords. */
	fit(preset: QualityPreset): void;
	/** Switches the reflection on in the frames that draw it. */
	update(): void;
}

/**
 * Makes the water and the reflection pass that mirrors the creek's banks in it. The pass draws layer
 * 0 alone, which leaves out the grass far from the water and what lies on or under the water. The
 * stones that break the water give it its foam.
 */
export function createWater(
	ctx: SketchContext,
	quadsX: number,
	obstacles: readonly Obstacle[],
): Water {
	const { scene, geometry, materials, textures, render } = ctx;
	const plane = { point: [0, WATER, 0] } as const;
	const pass = render.addPass({
		kind: 'reflection',
		writes: 'creek',
		plane,
		layers: 1,
	});
	const mirror = textures.fromPass(pass);
	const material = materials.shader({
		wgsl,
		color: '#ffffff',
		roughness: 0.03,
		metalness: 0,
		ior: 1.33,
		transmission: 1,
		thickness: 0.5,
		attenuationColor: '#93b59a',
		attenuationDistance: 0.9,
		textures: { mirror, foamMap: foamMap(ctx, obstacles) },
		uniforms: { flow: 0.35, ripple: 1, caustics: [0, 0, 0] },
	});
	scene.createMesh({
		mesh: geometry.fromArrays(waterGrid(140, 2 * STREAM_REACH + 2, quadsX, 48)),
		material,
		position: [0, WATER, 0],
		receiveShadows: true,
	});
	const light: [number, number, number] = [0, 0, 0];
	let every = 1;
	let frame = 0;
	return {
		fit(preset) {
			every = REFLECT_EVERY[preset];
		},
		update() {
			frame = (frame + 1) % every;
			render.setPassEnabled(pass, frame === 0);
		},
		setCaustics(next) {
			light[0] = next[0];
			light[1] = next[1];
			light[2] = next[2];
			material.set({ caustics: light });
		},
	};
}
