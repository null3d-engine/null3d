// The crystal spiral's scenery: a dusk sky, a low mist, and a floor of polished dark slate with
// thin water in its hollows. A reflection pass draws the scene mirrored across the floor, and the
// floor's custom material shows that picture: sharp where the water lies, and drawn out into soft
// streaks on the dry stone. Rings run out across the water in step with the crystals' wave.
import type { SketchContext } from '@null3d/engine';

/** A point toward the sun, low behind the stones. */
const SUN = [-0.7, 0.035, -0.7] as const;

const slate = /* wgsl */ `
#import null3d::noise::{fbm2}
#import null3d::reflection::{reflection_uv}

var mirror: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let p = input.worldPosition.xz;
    // Dark slate with soft clouding and thin pale veins.
    let cloud = 0.5 + 0.5 * fbm2(p * 0.35, 4u);
    let vein = 1.0 - smoothstep(0.0, 0.035, abs(fbm2(p * 0.15 + 7.0, 5u)));
    s.baseColor = mix(vec3f(0.02, 0.018, 0.026), vec3f(0.06, 0.052, 0.07), cloud)
        + vein * vec3f(0.07, 0.06, 0.08);
    // Water lies in the hollows: a mirror there, satin on the dry stone.
    let wet = smoothstep(-0.15, 0.1, fbm2(p * 0.09 + 3.0, 3u));
    s.roughness = mix(0.3, 0.02, wet);
    // Rings in the water, which leave the middle with the crystals' wave and fade far out.
    let r = max(length(p), 0.001);
    let ring = 0.025 * wet * cos(frame.time * 2.4 - r * 4.5) / (1.0 + 0.04 * r * r);
    let slope = ring * p / r;
    s.normal = normalize(vec3f(-slope.x, 1.0, -slope.y));
    // The dry stone draws the reflection out into short streaks down the screen.
    let uv = reflection_uv(camera.viewProjection * vec4f(input.relativePosition, 1.0), slope * 0.5);
    let step = vec2f(0.0, 0.004 * (1.0 - wet));
    var color = textureSampleLevel(mirror, mirrorSampler, uv, 0.0).rgb;
    for (var k = 1; k <= 2; k++) {
        let o = step * f32(k);
        color += textureSampleLevel(mirror, mirrorSampler, uv + o, 0.0).rgb;
        color += textureSampleLevel(mirror, mirrorSampler, uv - o, 0.0).rgb;
    }
    s.reflection = vec4f(color / 5.0, 1.0);
    return s;
}
`;

/** Makes the scenery. The clouds stand still, so the sky's light needs no refresh. */
export async function pool(ctx: SketchContext): Promise<void> {
	const { scene, assets, geometry, materials, textures, render, post } = ctx;
	scene.setBackground({
		sky: { sunPosition: SUN, turbidity: 8, rayleigh: 2.5, cloudCoverage: 0.35 },
	});
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: 0.9 });
	scene.setFog({
		color: '#4c3434',
		density: 0.05,
		heightFalloff: 0.9,
		sunGlow: 0.8,
	});
	post.set({ bloom: { intensity: 0.5, threshold: 1 }, vignette: {} });
	scene.createDirectionalLight({
		direction: [-SUN[0], -SUN[1], -SUN[2]],
		color: '#ffb48a',
		intensity: 3,
		castShadows: true,
	});
	scene.createHemisphereLight({ skyColor: '#9fa8e6', groundColor: '#3a2a34', intensity: 1.2 });

	const plane = { point: [0, 0, 0] } as const;
	const mirror = textures.fromPass(render.addPass({ kind: 'reflection', writes: 'pool', plane }));
	scene.createMesh({
		mesh: geometry.circle({ radius: 1500, segments: 96 }),
		material: materials.shader({ wgsl: slate, textures: { mirror }, doubleSided: true }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});
}
