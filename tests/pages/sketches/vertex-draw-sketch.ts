// A draw that makes its own vertices: a field of small cards in front of the camera, one for each
// copy, from the vertex and instance indices and no mesh data. The page changes the copy count and
// reads the frame's uploads, so a test can show that 50,000 copies upload no more than 1,000.
import { defineSketch } from '@null3d/engine';

const cards = /* wgsl */ `
#import null3d::builtins::{camera, fill_builtins}
#import null3d::mesh::finish
#import null3d::noise::{random}

struct Varyings {
    @builtin(position) clip: vec4f,
    @location(0) edge: vec2f,
}

/// A seed of the copy's index, spread across the hash's inputs so neighbors land far apart.
fn seed(n: u32) -> u32 {
    var x = n * 747796405u + 2891336453u;
    x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
    return (x >> 22u) ^ x;
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Varyings {
    fill_builtins(vec3f(0.0));
    // The copy's place in a plane in front of the camera, from two random numbers of its index.
    let seat = seed(instance);
    let x = (random(seat) - 0.5) * 8.0;
    let y = (random(seat + 1u) - 0.5) * 8.0;
    // The card's six vertices, two triangles of a square, counterclockwise, in the camera's plane.
    let corner = vec2f(f32(vertex & 1u), f32((vertex >> 1u) & 1u)) * 2.0 - 1.0;
    let p = vec3f(x, y, -8.0) + vec3f(corner * 0.05, 0.0);
    var out: Varyings;
    out.clip = camera.viewProjection * vec4f(p, 1.0);
    out.edge = corner;
    return out;
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
    fill_builtins(vec3f(0.0));
    let cover = 1.0 - abs(in.edge.x);
    return finish(vec3f(0.35, 0.65, 0.95) * cover, in.clip.xy);
}
`;

export default defineSketch(({ scene, page }) => {
	scene.setBackground('#0d1117');
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		position: [0, 0, 0],
		target: [0, 0, -1],
	});
	scene.setActiveCamera(camera);
	const draw = scene.createVertexDraw({
		shader: cards,
		vertices: 6,
		instances: 1_000,
		bounds: { center: [0, 0, -8], radius: 16 },
		blending: 'additive',
		depthWrite: false,
	});
	page.onMessage((name, data) => {
		if (name !== 'counts') return;
		const { vertices, instances } = data as { vertices: number; instances: number };
		draw.setCounts(vertices, instances);
		page.post('counts-set', { vertices: draw.vertices, instances: draw.instances });
	});
});
