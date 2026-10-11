// Custom shader inputs: a spiral of glowing crystals at dusk, and three standing stones. The
// crystals are one batch, and one custom material colors and times each one by its row in the
// batch, `input.instance`, so the batch needs no values of its own. A wave runs out along the
// spiral and lifts the crystals' tips in turn. The stones share one custom material too: bands run
// along each stone's own axis, from `object.worldMatrix`, and stay on it while the stone turns.
// The stone whose `shaderId` matches the material's uniform, as `object.id`, lights its bands.
// Hovering a stone, or tapping it, picks it.
import { defineSketch, math } from '@null3d/engine';
import { interact } from '../lib/interact';

/** Crystals in the spiral, and the golden angle that spaces them. */
const COUNT = 900;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

const crystals = /* wgsl */ `
// The wave's height at a crystal: it runs out from the middle of the spiral.
fn wave(instance: u32) -> f32 {
    return 0.5 + 0.5 * sin(frame.time * 2.4 - sqrt(f32(instance)) * 0.9);
}

fn vertexOffset(input: VertexInput) -> vec3f {
    return vec3f(0.0, input.uv.y * input.uv.y * wave(input.instance) * 0.35, 0.0);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    // Teal at the middle, through violet, to amber at the rim.
    let t = sqrt(f32(input.instance) / 900.0);
    let hue = mix(vec3f(0.1, 0.85, 0.8), vec3f(0.65, 0.3, 1.0), saturate(t * 1.6));
    let color = mix(hue, vec3f(1.0, 0.6, 0.15), saturate(t * 2.0 - 1.0));
    s.baseColor = color * 0.08;
    s.emissive = color * (0.2 + 2.5 * wave(input.instance) * input.uv.y * input.uv.y);
    return s;
}
`;

const stones = /* wgsl */ `
struct Uniforms { picked: u32 }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    // The height along the stone's own axis, from its origin.
    let axis = normalize(object.worldMatrix[1].xyz);
    let along = dot(input.relativePosition - object.worldMatrix[3].xyz, axis);
    let band = smoothstep(0.42, 0.5, abs(fract(along * 2.5 - frame.time * 0.3) - 0.5));
    let lit = select(0.15, 3.0, object.id == material.picked);
    s.emissive = vec3f(1.0, 0.55, 0.2) * band * lit;
    return s;
}
`;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, time } = ctx;
	const sun = [-0.7, 0.06, -0.7] as const;
	scene.setBackground({ sky: { sunPosition: sun, turbidity: 6, rayleigh: 3, time: 0 } });
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.35 });
	scene.setFog({ color: '#5a4a6a', density: 0.02, sunGlow: 0.8 });
	post.set({ bloom: { intensity: 0.35, threshold: 1 }, vignette: {} });
	const camera = scene.createPerspectiveCamera({ fov: 45, far: 500, position: [0, 5, 11.5] });
	camera.lookAt(0, 0.6, 0);
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 0.6, 0] });
	scene.createDirectionalLight({
		direction: [-sun[0], -sun[1], -sun[2]],
		color: '#ffb48a',
		intensity: 2,
		castShadows: true,
	});
	scene.createAmbientLight({ color: '#7d84c8', intensity: 0.6 });
	scene.createMesh({
		mesh: geometry.circle({ radius: 80, segments: 64 }),
		material: materials.standard({ color: '#2a2630', roughness: 0.12, doubleSided: true }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	// The spiral: each crystal a little further out than the one before, at the golden angle.
	math.seed(11);
	const shard = geometry.cone({ radius: 0.09, height: 0.8, radialSegments: 6, heightSegments: 4 });
	const glow = materials.shader({ wgsl: crystals, roughness: 0.4 });
	const spiral = scene.createInstances(shard, COUNT, { material: glow, castShadows: true });
	for (let k = 0; k < COUNT; k++) {
		const radius = 0.22 * Math.sqrt(k + 1);
		const angle = k * GOLDEN;
		const height = math.randFloat(0.6, 1.4);
		spiral.positions.set([Math.cos(angle) * radius, 0.4 * height, Math.sin(angle) * radius], k * 3);
		spiral.scales.set([1, height, 1], k * 3);
	}
	spiral.markDirty();

	// Three stones around the spiral share one material, which lights the picked one.
	const carved = materials.shader({ wgsl: stones, color: '#8a7f90', roughness: 0.45 });
	const slab = geometry.box({ width: 1, height: 4, depth: 0.6 });
	const ring = [-0.9, 0, 0.9].map((angle) => {
		const at = [Math.sin(angle) * 6.5, 1.9, -Math.cos(angle) * 6.5] as const;
		const stone = scene.createMesh({
			mesh: slab,
			material: carved,
			position: at,
			dynamic: true,
			castShadows: true,
		});
		const pick = () => carved.set({ picked: stone.shaderId });
		stone.on('pointerenter', pick);
		stone.on('click', pick);
		return stone;
	});
	carved.set({ picked: ring[1]?.shaderId ?? 0 });

	return {
		onUpdate(dt) {
			view.update(dt);
			for (const [k, stone] of ring.entries())
				stone.setRotationEuler(0.15 * Math.sin(time.now + k), time.now * 0.2 + k, 0);
		},
	};
});
