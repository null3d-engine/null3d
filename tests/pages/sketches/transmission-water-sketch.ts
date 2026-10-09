// Clear water over a bed of stones, under the sky. The water is a custom material whose surface
// function ripples its normal with a few sine waves and lets the light from below through, from
// the copy of the opaque objects' color. Its volume is as deep as the water, so the ripples bend
// the stones that show through it, and the volume tints them blue-green with depth. ?flat leaves
// the water without ripples, so the transmission spec can check that the ripples bend the bed.
import { defineSketch } from '@null3d/engine';
import { mulberry32 } from '../../../bench/scenes/spec';

const params = new URL(import.meta.url).searchParams;

/** The depth of the water over the bed. */
const DEPTH = 0.6;

const waterWgsl = /* wgsl */ `
struct Uniforms { ripple: f32 }

/// The water's normal at a point of its surface: the slopes of a few sine waves that cross it.
fn ripples(p: vec2f, time: f32) -> vec3f {
    let waves = array<vec4f, 3>(
        vec4f(0.8, 0.6, 3.1, 1.3),
        vec4f(-0.5, 0.9, 4.7, 1.9),
        vec4f(0.95, -0.3, 7.3, 2.6),
    );
    var slope = vec2f(0.0);
    for (var k = 0u; k < 3u; k++) {
        let w = waves[k];
        let along = normalize(w.xy);
        slope += along * cos(dot(along, p) * w.z + time * w.w) * (material.ripple / w.z);
    }
    return normalize(vec3f(-slope.x, 1.0, -slope.y));
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.normal = ripples(input.worldPosition.xz, frame.time);
    s.transmission = 1.0;
    return s;
}
`;

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground({ sky: { sunPosition: [0.4, 0.5, -0.75], cloudCoverage: 0 } });
	scene.createDirectionalLight({ direction: [-0.4, -1, 0.75], intensity: 2.5 });
	scene.createAmbientLight({ intensity: 0.6 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 50, position: [0, 2.4, 4.2], target: [0, -0.3, 0] }),
	);

	// The bed: sand, and stones of a few grays and browns, half sunk into it.
	const sand = scene.createMesh({
		mesh: geometry.plane({ width: 30, height: 30 }),
		material: materials.standard({ color: '#b8a582', roughness: 0.95 }),
		position: [0, -DEPTH, 0],
	});
	sand.setRotationEuler(-Math.PI / 2, 0, 0);
	const stone = geometry.sphere({ radius: 0.5, widthSegments: 16, heightSegments: 10 });
	const colors = ['#6d6a66', '#8c8478', '#4f4b47', '#a39a8c', '#7a6552'];
	const stoneMaterials = colors.map((color) => materials.standard({ color, roughness: 0.8 }));
	const random = mulberry32(7);
	for (let k = 0; k < 90; k++) {
		const size = 0.18 + 0.32 * random();
		const mesh = scene.createMesh({
			mesh: stone,
			material: stoneMaterials[k % stoneMaterials.length] as (typeof stoneMaterials)[number],
			position: [(random() - 0.5) * 7, -DEPTH, (random() - 0.5) * 6 - 0.5],
		});
		mesh.setScale(size * (1 + random()), size * 0.6, size * (1 + random()));
		mesh.setRotationEuler(0, random() * Math.PI, 0);
	}

	// Banks on either side, which stand out of the water.
	const bank = materials.standard({ color: '#5f7a3c', roughness: 0.9 });
	for (const x of [-4.2, 4.2])
		scene.createMesh({
			mesh: geometry.box({ width: 3, height: 1.2, depth: 12 }),
			material: bank,
			position: [x, -0.2, 0],
		});

	const water = scene.createMesh({
		mesh: geometry.plane({ width: 30, height: 30 }),
		material: materials.shader({
			wgsl: waterWgsl,
			color: '#ffffff',
			roughness: 0.05,
			metalness: 0,
			ior: 1.33,
			transmission: 1,
			thickness: DEPTH,
			attenuationColor: '#6fc4b8',
			attenuationDistance: 1.2,
			uniforms: { ripple: params.has('flat') ? 0 : 0.3 },
		}),
	});
	water.setRotationEuler(-Math.PI / 2, 0, 0);
	return {};
});
