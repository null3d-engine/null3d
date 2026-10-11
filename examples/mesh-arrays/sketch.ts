// Meshes from arrays: an island of 9,409 vertices and a crystal, each built with geometry.fromArrays
// from typed arrays. The engine computes the normals of both. The island's triangles share their
// vertices, so it shades smoothly, and each vertex has a color: sand at the shore, then grass, and
// rock where the ground is steep or high. Each face of the crystal has its own three vertices, so
// its edges stay hard. A reflection pass mirrors the island in the water. The crystal glows, and
// hovers over the point of the ground that the pointer points at, which a raycast finds.
import { defineSketch, type MeshArrays, math, timeOfDay, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** Quads along each side of the island, its width in meters, and the water's height. */
const QUADS = 96;
const WIDTH = 24;
const WATER = -0.3;
/** The box that keeps the point that the pointer leads the crystal to. */
const BOUNDS = [-11, -5, -11, 11, 5, 11] as const;
/** Linear colors of the ground, three numbers each: sand, grass and rock. */
const GROUND = [0.75, 0.6, 0.38, 0.15, 0.34, 0.06, 0.38, 0.34, 0.3];

/** The height of the ground at a point: rolling hills with ripples, which sink toward the edge. */
const heightAt = (x: number, z: number) =>
	1.4 * Math.sin(x * 0.35) * Math.cos(z * 0.3) +
	0.3 * Math.sin((x + z) * 0.9) +
	0.7 -
	2.5 * ((x * x + z * z) / 144) ** 2;

/** A grid of quads over the island, with one vertex at each corner that its quads share. */
function island(): MeshArrays {
	const row = QUADS + 1;
	const positions = new Float32Array(row * row * 3);
	const colors = new Float32Array(row * row * 3);
	for (let v = 0; v < row * row; v++) {
		const u = (v % row) / QUADS;
		const w = Math.floor(v / row) / QUADS;
		const [x, z] = [(u - 0.5) * WIDTH, (w - 0.5) * WIDTH];
		const y = heightAt(x, z);
		positions.set([x, y, z], v * 3);
		// Grass above the shore, rock on steep or high ground, and a little noise in each vertex.
		const steep = Math.hypot(heightAt(x + 0.1, z) - y, heightAt(x, z + 0.1) - y) * 10;
		const grass = math.smoothstep(y, WATER + 0.1, WATER + 0.3);
		const rock = Math.max(math.smoothstep(steep, 0.6, 0.9), math.smoothstep(y, 1.4, 1.9));
		const shade = math.randFloat(0.85, 1.15);
		for (let c = 0; c < 3; c++) {
			const soil = math.lerp(GROUND[c], GROUND[3 + c], grass);
			colors[v * 3 + c] = math.lerp(soil, GROUND[6 + c], rock) * shade;
		}
	}
	// Two triangles per quad, counter-clockwise seen from above.
	const indices = new Uint16Array(QUADS * QUADS * 6);
	for (let q = 0; q < QUADS * QUADS; q++) {
		const a = Math.floor(q / QUADS) * row + (q % QUADS);
		indices.set([a, a + row, a + 1, a + 1, a + row, a + row + 1], q * 6);
	}
	return { positions, colors, indices, computeNormals: true };
}

/** An octahedron stretched along y. Without indices, each three vertices make one triangle. */
function crystal(): MeshArrays {
	const ring = [1, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0, 1, 1, 0, 0];
	const positions: number[] = [];
	for (let k = 0; k < 12; k += 3) {
		const [a, b] = [ring.slice(k, k + 3), ring.slice(k + 3, k + 6)];
		positions.push(0, 2, 0, ...a, ...b, 0, -2, 0, ...b, ...a); // an upper face and the one below
	}
	return { positions, computeNormals: true };
}

/** Water: small waves bend its normal, and so the place where it reads the reflection. */
const water = /* wgsl */ `
#import null3d::reflection::{reflection_uv}

var mirror: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let p = input.worldPosition.xz + vec2f(0.3, 0.4) * frame.time;
    let slope = 0.04 * vec2f(cos(p.x * 2.1 + p.y * 0.7), cos(p.y * 2.7 - p.x * 0.5));
    s.normal = normalize(vec3f(-slope.x, 1.0, -slope.y));
    let uv = reflection_uv(camera.viewProjection * vec4f(input.relativePosition, 1.0), slope);
    s.reflection = vec4f(textureSampleLevel(mirror, mirrorSampler, uv, 0.0).rgb, 1.0);
    return s;
}
`;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, render, post, time } = ctx;
	const day = timeOfDay(16.2, { heading: -3 });
	scene.setBackground({ sky: { ...day.sky, cloudCoverage: 0.3 } }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity });
	scene.setFog({ color: day.fog.color, density: 0.008, sunGlow: day.fog.sunGlow });
	post.set({ exposure: day.exposure, bloom: { threshold: 1 }, ao: {}, vignette: {} });
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 50 } });
	const camera = scene.createPerspectiveCamera({ fov: 50, near: 0.1, far: 1000 });
	scene.setActiveCamera(camera);
	const steering = { groundY: 0, surfaces: true, bounds: BOUNDS };
	const view = interact(ctx, camera, { target: [0, 1, 0], ...steering });
	const over = vec3.create();
	const glow = { emissive: '#8a3dff', emissiveIntensity: 1.2 };

	// The seed gives the island's colors the same noise on every run.
	math.seed(5);
	scene.createMesh({
		mesh: geometry.fromArrays(island()),
		// Both faces draw, so the island stays in view when the camera orbits under it.
		material: materials.standard({ vertexColors: true, doubleSided: true }),
		castShadows: true,
		receiveShadows: true,
	});
	const plane = { point: [0, WATER, 0] } as const;
	const mirror = textures.fromPass(render.addPass({ kind: 'reflection', writes: 'water', plane }));
	scene.createMesh({
		mesh: geometry.plane({ width: 2000, height: 2000 }),
		material: materials.shader({
			wgsl: water,
			color: '#0b2a33',
			roughness: 0.05,
			textures: { mirror },
		}),
		position: [0, WATER, 0],
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});
	const gem = scene.createMesh({
		mesh: geometry.fromArrays(crystal()),
		// A glossy violet that gives off light above white, which bloom spreads into a glow.
		material: materials.standard({ color: '#7b4dff', roughness: 0.15, ...glow }),
		scale: [0.6, 0.6, 0.6],
		dynamic: true,
		castShadows: true,
	});

	return {
		onUpdate(dt) {
			const t = time.now;
			if (!view.userCamera) {
				camera.setPosition(Math.sin(t * 0.15) * 18, 7, Math.cos(t * 0.15) * 18);
				camera.lookAt(0, 1, 0);
			}
			view.update(dt);
			// The crystal hovers 3 m over the ground or the water: over the middle, or the pointed point.
			view.steer(vec3.set(over, 0, 0, 0));
			const ground = Math.max(heightAt(over[0], over[2]), WATER);
			gem.setRotationEuler(0, t * 0.8, 0);
			gem.setPosition(over[0], ground + 3 + 0.3 * Math.sin(t * 1.5), over[2]);
		},
	};
});
