// Instance batches whose rows bring values of their own, for their image test: a patch of grass
// whose blades sway out of step in the wind and take a tint each, from one custom material. A
// blade's first value is its phase in the wind and its second its tint, which the vertex offset
// and the surface function read as `object.values`. The front patch is a static batch and the back
// patch a dynamic one, so both data paths of each GPU path draw values. The sun casts the blades'
// shadows onto the ground, where they sway with the blades, and a post of the same material with
// no values sways and casts beside them.
import { defineSketch, math } from '@null3d/engine';

/** Blades along each side of a patch, and the distance between their roots. */
const SIDE = 12;
const SPACING = 0.16;

const grass = /* wgsl */ `
struct Uniforms { strength: f32 }

fn bend(input: VertexInput) -> f32 {
    let h = input.uv.y;
    return sin(frame.time * 2.0 + object.values.x) * material.strength * h * h;
}

fn vertexOffset(input: VertexInput) -> vec3f {
    return vec3f(bend(input), 0.0, 0.3 * bend(input));
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let tint = mix(vec3f(0.18, 0.42, 0.08), vec3f(0.78, 0.68, 0.2), object.values.y);
    s.baseColor *= tint * mix(0.45, 1.0, input.uv.y);
    return s;
}
`;

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#9cb4cc');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 35,
			near: 0.1,
			far: 40,
			position: [0, 2.6, 5.2],
			target: [0, 0.35, 0],
		}),
	);
	scene.createDirectionalLight({
		direction: [-0.8, -1, -0.35],
		color: '#fff4e0',
		intensity: 3,
		castShadows: true,
		shadow: { cascades: 1, mapSize: 2048, distance: 12 },
	});
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.5 });
	scene.createMesh({
		mesh: geometry.box({ width: 8, height: 0.1, depth: 6 }),
		material: materials.standard({ color: '#b8a888' }),
		position: [0, -0.05, 0],
		receiveShadows: true,
	});

	const blade = geometry.plane({ width: 0.05, height: 0.7, heightSegments: 6 });
	const material = materials.shader({
		wgsl: grass,
		color: '#ffffff',
		roughness: 0.8,
		doubleSided: true,
		uniforms: { strength: 0.25 },
	});
	for (const [z, dynamic] of [
		[0.9, false],
		[-1.1, true],
	] as const) {
		const patch = scene.createInstances(blade, SIDE * SIDE, {
			material,
			dynamic,
			values: true,
			castShadows: true,
			receiveShadows: true,
		});
		const { positions, rotations, values } = patch;
		if (!values) throw new Error('a batch with values has values');
		for (let row = 0; row < SIDE * SIDE; row++) {
			const x = (row % SIDE) - (SIDE - 1) / 2 + math.random() * 0.6;
			const along = Math.floor(row / SIDE) - (SIDE - 1) / 2 + math.random() * 0.6;
			positions.set([x * SPACING * 2, 0.35, z + along * SPACING], row * 3);
			const turn = math.random() * Math.PI;
			rotations.set([0, Math.sin(turn / 2), 0, Math.cos(turn / 2)], row * 4);
			values.set([math.random() * Math.PI * 2, math.random(), 0, 0], row * 4);
		}
		patch.markDirty();
	}
	const post = scene.createMesh({
		mesh: geometry.plane({ width: 0.12, height: 1.2, heightSegments: 8 }),
		material,
		position: [2.4, 0.6, 0],
		castShadows: true,
	});
	post.setRotationEuler(0, 0.6, 0);
});
