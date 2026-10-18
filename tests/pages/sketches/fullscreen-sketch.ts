// Full-screen passes. By default: a scene pass draws four colored boxes from above into a quarter of
// the render size, and a full-screen pass reads that texture and draws it posterized, with dark
// grid lines, into a texture of its own, which a screen at the right shows. A second full-screen
// pass reads nothing and paints a texture of its own: red across its top half, green at its bottom
// left and blue at its bottom right, which a screen at the left shows upright. The minimap shows
// red at its top left, green at its top right, blue at its bottom left and yellow at its bottom
// right, as the minimap test's screen does.
//
// ?glow outlines the sphere and the box with a width of 0, so the outline mask draws and no line
// does. A full-screen pass at half the render size reads the mask and blurs it into a soft glow,
// and a custom effect adds the glow's texture to the scene's color, as three.js's OutlinePass
// draws its glow.
//
// ?echo gives a full-screen pass the scene color as its input, at a quarter of the render size,
// in a cool tint, and a custom effect shows that texture as an inset at the top left of the frame.
// The pass runs after the camera's passes and before the effect, so the inset shows the same
// frame.
//
// ?half draws the frame at a render scale of 0.5, where each pass with a scale takes its share of
// the smaller render size and fills its texture whole, so the glow and the inset land where they
// do at full scale.
import { defineSketch, type Texture } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;

/** Each box's place on the ground and its color, as the minimap test places them. */
const BOXES = [
	{ position: [-3, 0.5, -3], color: '#e04040' },
	{ position: [3, 0.5, -3], color: '#40c040' },
	{ position: [-3, 0.5, 3], color: '#4060e0' },
	{ position: [3, 0.5, 3], color: '#e0c030' },
] as const;

/** Red across the top half of the image, green at its bottom left and blue at its bottom right. */
const paint = /* wgsl */ `
fn effect(input: EffectInput) -> vec4f {
    if input.uv.y < 0.5 {
        return vec4f(0.9, 0.1, 0.1, 1.0);
    }
    if input.uv.x < 0.5 {
        return vec4f(0.1, 0.8, 0.2, 1.0);
    }
    return vec4f(0.1, 0.2, 0.9, 1.0);
}
`;

/** The minimap in four levels of each channel, with dark lines across it every eighth. */
const posterize = /* wgsl */ `
struct Uniforms { levels: f32, lines: f32 }

var map: texture_2d<f32>;

fn effect(input: EffectInput) -> vec4f {
    let color = textureSampleLevel(map, mapSampler, effectPassUv(input.uv), 0.0).rgb;
    let stepped = floor(color * uniforms.levels + 0.5) / uniforms.levels;
    let cell = fract(input.uv * uniforms.lines);
    let line = select(1.0, 0.35, min(cell.x, cell.y) < 0.06);
    return vec4f(stepped * line, 1.0);
}
`;

/** The outline mask's coverage, blurred over a few of its pixels, as a warm glow. */
const glow = /* wgsl */ `
fn effect(input: EffectInput) -> vec4f {
    let texel = 1.0 / effectInputSize();
    var sum = 0.0;
    for (var y = -3; y <= 3; y++) {
        for (var x = -3; x <= 3; x++) {
            let offset = vec2f(f32(x), f32(y)) * 3.0 * texel;
            sum += effectColor(input.uv + offset).r;
        }
    }
    let blurred = sum / 49.0;
    return vec4f(vec3f(2.0, 1.1, 0.3) * blurred, 1.0);
}
`;

/** The scene color with the glow's texture added, where it shows on the screen. */
const addGlow = /* wgsl */ `
var halo: texture_2d<f32>;

fn effect(input: EffectInput) -> vec4f {
    let light = textureSampleLevel(halo, haloSampler, effectPassUv(input.uv), 0.0).rgb;
    return vec4f(input.color.rgb + light * input.color.a, input.color.a);
}
`;

/** The scene's image in a cool tint. */
const echo = /* wgsl */ `
fn effect(input: EffectInput) -> vec4f {
    return vec4f(input.color.rgb * vec3f(0.55, 0.85, 1.1), 1.0);
}
`;

/** The frame with the echo's texture as an inset across the top left third. */
const inset = /* wgsl */ `
var echo: texture_2d<f32>;

fn effect(input: EffectInput) -> vec4f {
    let place = input.uv / 0.35;
    if place.x > 1.0 || place.y > 1.0 {
        return input.color;
    }
    return textureSampleLevel(echo, echoSampler, effectPassUv(place), 0.0);
}
`;

export default defineSketch(({ scene, materials, geometry, textures, render, post, quality }) => {
	if (params.has('half'))
		quality.set({ minRenderScale: 0.5, maxRenderScale: 0.5, governor: false });
	scene.setBackground('#20242c');
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		position: [0, 7, 13],
		target: [0, 1.5, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.4, -1, -0.6], intensity: 2.5 });
	scene.createAmbientLight({ intensity: 0.6 });
	const ground = scene.createMesh({
		mesh: geometry.plane({ width: 10, height: 10 }),
		material: materials.standard({ color: '#9aa0a8', roughness: 0.9 }),
	});
	ground.setRotationEuler(-Math.PI / 2, 0, 0);
	const box = geometry.box({ width: 1.4, height: 1, depth: 1.4 });
	const boxes = BOXES.map(({ position, color }) =>
		scene.createMesh({
			mesh: box,
			material: materials.standard({ color, roughness: 0.6 }),
			position: [...position],
		}),
	);
	const screen = (texture: Texture, x: number) =>
		scene.createMesh({
			mesh: geometry.plane({ width: 5, height: 5 }),
			material: materials.unlit({ map: texture }),
			position: [x, 4.2, -6],
		});

	if (params.has('glow')) {
		post.set({ outline: { color: '#ffffff', width: 0 } });
		const sphere = scene.createMesh({
			mesh: geometry.sphere({ radius: 1.2 }),
			material: materials.standard({ color: '#d0d4dc', roughness: 0.4 }),
			position: [0, 1.2, 0],
		});
		sphere.setOutlined(true);
		boxes[1]?.setOutlined(true);
		const mask = render.addPass({
			kind: 'fullscreen',
			wgsl: glow,
			writes: 'glow',
			scale: 0.5,
			input: 'outlineMask',
		});
		post.addEffect({ wgsl: addGlow, textures: { halo: textures.fromPass(mask) } });
		return {};
	}

	if (params.has('echo')) {
		const monitor = render.addPass({
			kind: 'fullscreen',
			wgsl: echo,
			writes: 'echo',
			scale: 0.25,
			input: 'sceneColor',
		});
		post.addEffect({ wgsl: inset, textures: { echo: textures.fromPass(monitor) } });
		return {};
	}

	// The map camera looks straight down, with the far side of the ground at the top of its image.
	const mapCamera = scene.createOrthographicCamera({
		height: 12,
		near: 1,
		far: 40,
		position: [0, 20, 0],
	});
	mapCamera.setRotationEuler(-Math.PI / 2, 0, 0);
	const map = render.addPass({ kind: 'scene', camera: mapCamera, writes: 'minimap', scale: 0.25 });
	const posterized = render.addPass({
		kind: 'fullscreen',
		wgsl: posterize,
		writes: 'posterized',
		size: [128, 128],
		uniforms: { levels: 3, lines: 8 },
		textures: { map: textures.fromPass(map) },
	});
	const painted = render.addPass({
		kind: 'fullscreen',
		wgsl: paint,
		writes: 'painted',
		size: [64, 64],
	});
	screen(textures.fromPass(painted), -3);
	screen(textures.fromPass(posterized), 3);
	return {};
});
