// Custom materials with vertex offsets, for their image test. A plane of many faces waves along
// its first texture coordinates by a vertex offset, whose uniforms give the height and the number
// of waves; flat shading lights each face by its moved position. A sphere swells along its normals
// in bands, with a surface function that colors the bands, from one WGSL. A second wave plane shares
// the first one's WGSL with other uniforms, and a torus moves with a vertex offset alone.
import { defineSketch } from '@null3d/engine';

const wave = /* wgsl */ `
struct Uniforms { height: f32, waves: f32 }

fn vertexOffset(input: VertexInput) -> vec3f {
    let phase = input.uv.x * material.waves * 6.2831853;
    return vec3f(0.0, 0.0, sin(phase) * material.height);
}
`;

const bands = /* wgsl */ `
struct Uniforms { swell: f32, tint: vec3f }

fn band(uv: vec2f) -> f32 {
    return step(0.5, fract(uv.y * 5.0));
}

fn vertexOffset(input: VertexInput) -> vec3f {
    return input.normal * band(input.uv) * material.swell;
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor = mix(s.baseColor, material.tint, band(input.uv));
    return s;
}
`;

const twist = /* wgsl */ `
fn vertexOffset(input: VertexInput) -> vec3f {
    let turn = input.position.y * 0.8;
    let p = input.position;
    return vec3f(p.x * cos(turn) - p.z * sin(turn), p.y, p.x * sin(turn) + p.z * cos(turn)) - p;
}
`;

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#20242a');
	const camera = scene.createPerspectiveCamera({
		fov: 35,
		near: 0.1,
		far: 50,
		position: [0, 0, 12],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.5, -0.7, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });

	const plane = geometry.plane({ width: 3, height: 1.6, widthSegments: 48, heightSegments: 4 });
	const tall = materials.shader({
		wgsl: wave,
		color: '#4a8cff',
		roughness: 0.5,
		flatShading: true,
		uniforms: { height: 0.25, waves: 2 },
	});
	const low = materials.shader({
		wgsl: wave,
		color: '#e8554e',
		roughness: 0.5,
		flatShading: true,
		uniforms: { height: 0.1, waves: 4 },
	});
	for (const [material, y] of [
		[tall, 1.5],
		[low, -1.5],
	] as const) {
		const mesh = scene.createMesh({ mesh: plane, material, position: [-2.4, y, 0] });
		mesh.setRotationEuler(-0.6, 0, 0);
	}

	const sphere = geometry.sphere({ radius: 0.8, widthSegments: 48, heightSegments: 32 });
	const swelling = materials.shader({
		wgsl: bands,
		color: '#c0c4cc',
		roughness: 0.4,
		uniforms: { swell: 0.12, tint: '#ffb020' },
	});
	scene.createMesh({ mesh: sphere, material: swelling, position: [1.4, 1.2, 0] });

	const torus = geometry.torus({
		radius: 0.6,
		tube: 0.25,
		tubularSegments: 64,
		radialSegments: 16,
	});
	const twisted = materials.shader({ wgsl: twist, color: '#60c0a0', roughness: 0.3 });
	const ring = scene.createMesh({ mesh: torus, material: twisted, position: [3.4, -1.2, 0] });
	ring.setRotationEuler(1.2, 0, 0);
	scene
		.createMesh({
			mesh: torus,
			material: materials.standard({ color: '#60c0a0' }),
			position: [1.4, -1.2, 0],
		})
		.setRotationEuler(1.2, 0, 0);
});
