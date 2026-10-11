// Sprites and lines: a fountain of 2,000 sparks at night, each a sprite that faces the camera, in
// one batch that blends by adding light. Each spark rises, falls and fades from yellow to red, from
// a formula of the time, so the sketch writes the batch's arrays with no call per spark. The sparks'
// colors run above white, so bloom spreads them. A neon helix of wide lines in world units winds
// around the fountain, and dashes in screen pixels run around the pool's rim. The dark pool below
// reflects it all through a reflection pass, and its ripples bend the reflection. The sprites' soft
// dot is a texture made from data. The pointer moves the fountain, and each spark keeps the place
// it was born at.
import { color, defineSketch, math, timeOfDay, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

const SPARKS = 2000;
/** How long a spark flies, in seconds, and the pull of gravity. */
const LIFE = 1.5;
const GRAVITY = 6;
/** Points along the helix, its turns, and points around the dashed ring. */
const HELIX = 240;
const TURNS = 5;
const RING = 128;
/** The pool's radius, in meters. */
const POOL = 3.2;

// The pool's water: rings that spread from the middle and a slow swell tilt its normal, and the
// tilt bends the reflection that the water reads.
const ripples = /* wgsl */ `
#import null3d::reflection::{reflection_uv}

var mirror: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let p = input.worldPosition.xz;
    let r = max(length(p), 0.01);
    let swell = vec2f(cos(p.x * 2.3 + frame.time), cos(p.y * 3.1 - frame.time * 1.3)) * 0.03;
    let slope = swell + p / r * cos(r * 7.0 - frame.time * 3.0) * 0.04;
    s.normal = normalize(vec3f(-slope.x, 1.0, -slope.y));
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let uv = reflection_uv(clip, s.normal.xz * 0.03);
    s.reflection = vec4f(textureSampleLevel(mirror, mirrorSampler, uv, 0.0).rgb, 1.0);
    return s;
}
`;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, render, post, time } = ctx;
	// A clear night under the moon, which lights the stone. The sparks and the neon do the rest.
	const night = timeOfDay('blueHour', { heading: 2.5 });
	const sky = { intensity: night.skyIntensity };
	scene.setBackground({ sky: { ...night.sky, cloudCoverage: 0.3 } }, sky);
	scene.setEnvironment(await assets.skyEnvironment(), sky);
	scene.setFog({ color: night.fog.color, density: 0.03 });
	scene.createDirectionalLight({ ...night.light, castShadows: true, shadow: { distance: 30 } });
	post.set({ exposure: 2, bloom: { intensity: 0.35, threshold: 1 }, vignette: {} });
	const camera = scene.createPerspectiveCamera({ fov: 50, far: 500, position: [0, 3, 7.5] });
	camera.lookAt(0, 1.6, 0);
	scene.setActiveCamera(camera);
	const bounds = [-2.4, 0, -2.4, 2.4, 0, 2.4] as const;
	const view = interact(ctx, camera, { target: [0, 1.6, 0], groundY: 0, bounds });

	// The pool: dark water that reflects, inside a stone rim, in a paved square.
	const pool = render.addPass({ kind: 'reflection', writes: 'pool', plane: { point: [0, 0, 0] } });
	const flat = { rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const, receiveShadows: true };
	const mirror = { mirror: textures.fromPass(pool) };
	const water = { color: '#04070b', roughness: 0.05, textures: mirror };
	const pond = materials.shader({ wgsl: ripples, ...water });
	const disc = geometry.circle({ radius: POOL, segments: 64 });
	scene.createMesh({ mesh: disc, material: pond, ...flat });
	const stone = materials.standard({ color: '#4a4c52', roughness: 0.5, doubleSided: true });
	const rim = geometry.torus({ radius: POOL, tube: 0.2, radialSegments: 16, tubularSegments: 96 });
	scene.createMesh({ mesh: rim, material: stone, castShadows: true, ...flat });
	const square = geometry.ring({ innerRadius: POOL, outerRadius: 80, thetaSegments: 64 });
	scene.createMesh({ mesh: square, material: stone, position: [0, 0.12, 0], ...flat });

	// A soft dot: white, with an alpha that falls from the center to the edge.
	const SIZE = 32;
	const dot = new Uint8Array(SIZE * SIZE * 4).fill(255);
	for (let i = 0; i < SIZE * SIZE; i++) {
		const r = Math.hypot((i % SIZE) + 0.5 - SIZE / 2, Math.floor(i / SIZE) + 0.5 - SIZE / 2);
		dot[i * 4 + 3] = 255 * Math.max(0, 1 - r / (SIZE / 2)) ** 2;
	}
	const map = textures.fromData({ width: SIZE, height: SIZE, data: dot });
	const glow = { blending: 'additive', dynamic: true } as const;
	const sparks = await scene.createSprites({ count: SPARKS, map, ...glow });
	// Each spark's launch: its delay within a life, and its speed along x, y and z. Each spark keeps
	// the fountain's place at its birth, and the count of its births, which says when it is reborn.
	const launch = new Float32Array(SPARKS * 4);
	const origins = new Float32Array(SPARKS * 2);
	const births = new Int32Array(SPARKS);
	const fountain = vec3.create();
	for (let i = 0; i < SPARKS; i++) {
		const [angle, out] = [math.randFloat(0, Math.PI * 2), math.randFloat(0.4, 1.6)];
		const [delay, up] = [math.randFloat(0, LIFE), math.randFloat(4.5, 5.5)];
		launch.set([delay, Math.cos(angle) * out, up, Math.sin(angle) * out], i * 4);
	}

	// Neon: a helix of wide lines in world units, from teal at the bottom to violet at the top, and a
	// dashed loop on the rim, 3 CSS pixels wide. Colors above 1 glow through bloom.
	const helix = new Float32Array(HELIX * 3);
	const shades = new Float32Array(HELIX * 3);
	const [low, high] = [color.fromHex([0, 0, 0], '#2ec4b6'), color.fromHex([0, 0, 0], '#9b5de5')];
	for (let i = 0; i < HELIX; i++) {
		const t = i / (HELIX - 1);
		const angle = t * TURNS * Math.PI * 2;
		helix.set([Math.cos(angle) * 1.9, 0.3 + t * 3.2, Math.sin(angle) * 1.9], i * 3);
		for (let c = 0; c < 3; c++) shades[i * 3 + c] = 2 * math.lerp(low[c], high[c], t);
	}
	await scene.createLines({ positions: helix, colors: shades, width: 0.05, worldUnits: true });
	const ring = new Float32Array(RING * 3);
	for (let i = 0; i < RING; i++) {
		const angle = (i / RING) * Math.PI * 2;
		ring.set([Math.cos(angle) * POOL, 0.22, Math.sin(angle) * POOL], i * 3);
	}
	const gold = new Float32Array(RING * 3).map((_, i) => [2.4, 1.3, 0.3][i % 3]);
	const dash = { mode: 'loop', width: 3, dashed: true, dashSize: 0.3, gapSize: 0.2 } as const;
	const dashes = await scene.createLines({ positions: ring, colors: gold, ...dash });
	const dashValues = { dashOffset: 0 };

	const heat = [0, 0, 0];
	const yellow = color.fromHex([0, 0, 0], '#ffe08a');
	const red = color.fromHex([0, 0, 0], '#ff4b1f');
	return {
		onUpdate(dt) {
			view.update(dt);
			view.steer(vec3.set(fountain, 0, 0, 0));
			const { positions, sizes, colors } = sparks;
			for (let i = 0; i < SPARKS; i++) {
				const age = (time.now + launch[i * 4]) % LIFE;
				const birth = Math.floor((time.now + launch[i * 4]) / LIFE);
				if (birth !== births[i]) {
					births[i] = birth;
					origins[i * 2] = fountain[0];
					origins[i * 2 + 1] = fountain[2];
				}
				const fade = age / LIFE;
				positions[i * 3] = origins[i * 2] + launch[i * 4 + 1] * age;
				positions[i * 3 + 1] = 0.3 + launch[i * 4 + 2] * age - 0.5 * GRAVITY * age * age;
				positions[i * 3 + 2] = origins[i * 2 + 1] + launch[i * 4 + 3] * age;
				sizes[i * 2] = sizes[i * 2 + 1] = 0.2 * (1 - 0.6 * fade);
				for (let c = 0; c < 3; c++) heat[c] = 2 * math.lerp(yellow[c], red[c], fade);
				colors.set(heat, i * 4);
				colors[i * 4 + 3] = 1 - fade;
			}
			dashValues.dashOffset = -time.now * 0.6;
			dashes.material.set(dashValues);
		},
	};
});
