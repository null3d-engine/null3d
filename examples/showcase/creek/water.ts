// The creek's water. A grid at the water's height moves its vertices with waves that the current
// carries downstream. Its surface function adds finer ripples to the normal, which catch the sun as
// glints. A reflection pass mirrors the banks and the sky, and the light from the stony bed comes
// through the water, bent by the ripples and tinted by its depth. The water is clear at its edges,
// where it is shallow, with a little foam.
import type { MeshArrays, SketchContext } from '@null3d/engine';
import { STREAM_REACH, WATER } from './land';

const wgsl = /* wgsl */ `
#import null3d::reflection::{reflection_uv}

struct Uniforms { flow: f32, ripple: f32 }

var mirror: texture_2d<f32>;

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
    let foam = (1.0 - smoothstep(0.0, 0.05, depth)) * smoothstep(0.0, 0.03, w.x + 0.012);
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

/** Makes the water and the reflection pass that mirrors the creek's banks in it. */
export function createWater(
	{ scene, geometry, materials, textures, render }: SketchContext,
	quadsX: number,
): void {
	const plane = { point: [0, WATER, 0] } as const;
	const mirror = textures.fromPass(render.addPass({ kind: 'reflection', writes: 'creek', plane }));
	scene.createMesh({
		mesh: geometry.fromArrays(waterGrid(140, 2 * STREAM_REACH + 2, quadsX, 48)),
		material: materials.shader({
			wgsl,
			color: '#ffffff',
			roughness: 0.03,
			metalness: 0,
			ior: 1.33,
			transmission: 1,
			thickness: 0.5,
			attenuationColor: '#93b59a',
			attenuationDistance: 0.9,
			textures: { mirror },
			uniforms: { flow: 0.35, ripple: 1 },
		}),
		position: [0, WATER, 0],
		receiveShadows: true,
	});
}
