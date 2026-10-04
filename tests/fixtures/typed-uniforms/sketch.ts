// Type tests of custom materials' uniforms and textures: `bun run typecheck` checks this project. Each line under
// `@ts-expect-error` must fail the type check, and every other line must pass it. The WGSL comes in
// each form that TypeScript sees: a `.wgsl` file with the declaration that the null3D Vite plugin
// writes beside it, a tagged template literal in a constant, one inline in the call, and WGSL whose
// uniforms TypeScript cannot see, which takes any name.
import { defineSketch, type Texture } from '@null3d/engine';
import waves from './waves.wgsl';

const rings = /* wgsl */ `
// struct Uniforms { old: f32 } is a comment, so old is not a uniform.
struct Uniforms {
    tint: vec3f, // the rings' color, which takes a hex color too
    /* how wide each ring is */ width: f32,
    count: i32,
    glow: vec4<f32>,
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let ring = step(1.0 - material.width, fract(input.uv.y * f32(material.count) / 2.0));
    s.baseColor = mix(s.baseColor, material.tint, ring);
    s.emissive += material.glow.rgb * material.glow.a * ring;
    return s;
}
`;

const sampled = /* wgsl */ `
var detail: texture_2d<f32>;
var noise : texture_2d<f32> ;
var<private> scratch: f32;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor *= textureSample(detail, detailSampler, input.uv).rgb;
    return s;
}
`;

const plain = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    return defaultSurface(input);
}
`;

/** WGSL in a variable of type string: TypeScript cannot see its uniforms. */
const unseen: string = rings;

/** A texture, which the type checks need only as a type. */
declare const image: Texture;

export default defineSketch(({ materials }) => {
	// A `.wgsl` file, typed by the declaration beside it.
	const wavy = materials.shader({
		wgsl: waves,
		roughness: 0.5,
		uniforms: { tint: '#ff6a00', height: 0.2, count: 3, shift: [0.5, 0] },
	});
	wavy.set({ height: 0.4, shift: [0, 0.25], roughness: 0.3 });
	// @ts-expect-error: hight is not a uniform of waves.wgsl.
	wavy.set({ hight: 0.4 });
	// @ts-expect-error: shift is a vec2f, which takes two numbers.
	wavy.set({ shift: [0, 0.25, 1] });
	// @ts-expect-error: height is an f32, which takes a number.
	materials.shader({ wgsl: waves, uniforms: { height: '0.2' } });
	// @ts-expect-error: uvTransform is not a value of a custom material.
	wavy.set({ uvTransform: { offset: [0, 0] } });

	// A tagged template literal in a constant.
	const ringed = materials.shader({ wgsl: rings, uniforms: { tint: [1, 0.5, 0], count: 4 } });
	ringed.set({ tint: '#4080ff', width: 0.3, glow: [1, 0.6, 0.1, 1.5], color: '#808080' });
	ringed.set({ tint: 0x4080ff });
	// @ts-expect-error: old is in a comment, not a uniform.
	ringed.set({ old: 1 });
	// @ts-expect-error: widht is not a uniform; width is.
	materials.shader({ wgsl: rings, uniforms: { widht: 0.5 } });
	// @ts-expect-error: glow is a vec4f, which takes four numbers.
	ringed.set({ glow: [1, 0.6, 0.1] });
	// @ts-expect-error: count is an i32, which takes a number.
	ringed.set({ count: [4] });

	// A tagged template literal inside the call.
	const inline = materials.shader({
		wgsl: /* wgsl */ `
struct Uniforms { speed: f32, offset: vec2f }
fn surface(input: SurfaceInput) -> Surface { return defaultSurface(input); }
`,
		uniforms: { speed: 2 },
	});
	inline.set({ offset: [1, 2] });
	// @ts-expect-error: speeed is not a uniform; speed is.
	inline.set({ speeed: 3 });

	// WGSL without uniforms takes no uniform at all.
	const bare = materials.shader({ wgsl: plain, color: '#e04040' });
	bare.set({ roughness: 0.2 });
	// @ts-expect-error: the WGSL declares no struct Uniforms.
	bare.set({ speed: 1 });
	// @ts-expect-error: the WGSL declares no struct Uniforms.
	materials.shader({ wgsl: plain, uniforms: { speed: 1 } });

	// Textures by the names that the WGSL declares.
	materials.shader({ wgsl: sampled, textures: { detail: image, noise: image } });
	materials.shader({ wgsl: sampled, textures: { noise: image } });
	// @ts-expect-error: detial is not a texture of the WGSL; detail is.
	materials.shader({ wgsl: sampled, textures: { detial: image } });
	// @ts-expect-error: scratch is a private variable, not a texture.
	materials.shader({ wgsl: sampled, textures: { scratch: image } });
	// @ts-expect-error: a texture takes a Texture.
	materials.shader({ wgsl: sampled, textures: { detail: 'detail.png' } });
	// @ts-expect-error: the WGSL declares no texture.
	materials.shader({ wgsl: plain, textures: { detail: image } });
	// @ts-expect-error: waves.wgsl declares no texture.
	materials.shader({ wgsl: waves, textures: { detail: image } });

	// WGSL whose uniforms TypeScript cannot see takes any name, as JavaScript does. The engine
	// checks each name when the call runs.
	materials.shader({ wgsl: unseen, textures: { anything: image } });
	const loose = materials.shader({ wgsl: unseen, uniforms: { anything: [1, 2, 3, 4, 5] } });
	loose.set({ whatever: 1, roughness: 0.5 });
});
