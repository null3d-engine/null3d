// Custom shader inputs: a spiral of glowing crystals at dusk, and three standing stones. The
// crystals are one batch, and one custom material colors and times each one by its row in the
// batch, `input.instance`, so the batch needs no values of its own. A wave runs out along the
// spiral and lifts the crystals' tips in turn. The stones share one custom material too: bands run
// along each stone's own axis, from `object.worldMatrix`, and stay on it while the stone turns.
// The stone whose `shaderId` matches the material's uniform, as `object.id`, lights its bands.
// Hovering a stone, or tapping it, picks it. The scenery around them is in pool.ts.
import { defineSketch, math } from '@null3d/engine';
import { interact } from '../lib/interact';
import { pool } from './pool';

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
    s.emissive = color * (0.15 + 4.0 * wave(input.instance) * input.uv.y * input.uv.y);
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
    let band = smoothstep(0.32, 0.44, abs(fract(along * 2.0 - frame.time * 0.3) - 0.5));
    // The picked stone's bands burn amber; the others keep a cool, faint glow.
    let picked = object.id == material.picked;
    s.emissive = select(vec3f(0.15, 0.25, 0.6), vec3f(6.0, 2.6, 0.7), picked) * band;
    return s;
}
`;

export default defineSketch(async (ctx) => {
	const { scene, geometry, materials, time } = ctx;
	await pool(ctx);
	const camera = scene.createPerspectiveCamera({ fov: 45, far: 3000, position: [0, 4.5, 13] });
	camera.lookAt(0, 0.9, 0);
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 0.9, 0] });

	// The spiral: each crystal a little further out than the one before, at the golden angle.
	math.seed(11);
	const shard = geometry.cone({ radius: 0.06, height: 0.7, radialSegments: 6, heightSegments: 4 });
	const glow = materials.shader({ wgsl: crystals, roughness: 0.4 });
	const spiral = scene.createInstances(shard, COUNT, { material: glow, castShadows: true });
	for (let k = 0; k < COUNT; k++) {
		const radius = 0.2 * Math.sqrt(k + 1);
		const angle = k * GOLDEN;
		const height = math.randFloat(0.6, 1.4);
		spiral.positions.set(
			[Math.cos(angle) * radius, 0.35 * height, Math.sin(angle) * radius],
			k * 3,
		);
		spiral.scales.set([1, height, 1], k * 3);
	}
	spiral.markDirty();

	// Three stones around the spiral share one material, which lights the picked one.
	const carved = materials.shader({ wgsl: stones, color: '#b4a8bc', roughness: 0.5 });
	const slab = geometry.box({ width: 1.4, height: 4.4, depth: 0.7 });
	const ring = [-0.9, 0, 0.9].map((angle) => {
		const at = [Math.sin(angle) * 6.5, 2.1, -Math.cos(angle) * 6.5] as const;
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
