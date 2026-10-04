// Type tests of how TypeScript reads `struct Uniforms` from WGSL text: `bun run typecheck` checks
// this file. Each line asserts the uniforms that one piece of WGSL gives, as the shader build reads
// them, and the build stops at WGSL that it cannot read, so such WGSL takes any name.
import type { UniformType, WgslTextures, WgslUniforms } from '@null3d/engine';

/** True when two types are the same type. */
type Same<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Fails the type check unless its argument is true. */
function check<_ extends true>(): void {}

/** Uniforms that take any name. */
type Any = { readonly [name: string]: UniformType };

/** No uniforms. */
type None = Record<never, never>;

// Fields on one line, with and without a last comma, and spaces anywhere.
check<
	Same<
		WgslUniforms<'struct Uniforms { a: f32, b: vec2f }'>,
		{ readonly a: 'f32'; readonly b: 'vec2f' }
	>
>();
check<Same<WgslUniforms<'struct  Uniforms{a:i32,}'>, { readonly a: 'i32' }>>();
check<
	Same<WgslUniforms<'struct\n\tUniforms\n{\n\ta : vec3< f32 > ,\n}'>, { readonly a: 'vec3f' }>
>();

// Comments, before the struct and inside it, which can hold commas, braces and the struct's name.
check<
	Same<
		WgslUniforms<`// struct Uniforms { old: f32 }
/* struct Uniforms { older: f32 } */
const HALF = 1.0 / 2.0;
struct Uniforms {
    tint: vec3f, // a color, {r, g, b}
    /* a, b */ glow: vec4<f32>,
}
fn surface(input: SurfaceInput) -> Surface { return defaultSurface(input); }`>,
		{ readonly tint: 'vec3f'; readonly glow: 'vec4f' }
	>
>();

// A struct with a longer name, before the real one, does not count.
check<
	Same<
		WgslUniforms<'struct UniformsOld { a: f32 }\nstruct Uniforms { b: u32 }'>,
		{ readonly b: 'u32' }
	>
>();

// WGSL without the struct has no uniforms.
check<
	Same<
		WgslUniforms<'fn surface(input: SurfaceInput) -> Surface { return defaultSurface(input); }'>,
		None
	>
>();
check<Same<WgslUniforms<''>, None>>();

// WGSL that the build stops at, or text whose content TypeScript cannot see, takes any name.
check<Same<WgslUniforms<'struct Uniforms { a: array<f32, 4> }'>, Any>>();
check<Same<WgslUniforms<'struct Uniforms { a: mat4x4f }'>, Any>>();
check<Same<WgslUniforms<'struct Uniforms { a: f32'>, Any>>();
check<Same<WgslUniforms<string>, Any>>();

// Compiled WGSL lists its uniforms, or takes any name when its type does not list them.
check<
	Same<
		WgslUniforms<{ kind: 'material'; uniforms: readonly { name: 'a'; type: 'f32'; offset: 0 }[] }>,
		{ readonly a: 'f32' }
	>
>();
check<Same<WgslUniforms<{ kind: 'material'; uniforms: readonly never[] }>, None>>();
check<Same<WgslUniforms<{ kind: 'material' }>, Any>>();

// Textures: each `var name: texture_2d<f32>;`, with any spacing, and no other variable.
check<
	Same<
		WgslTextures<'var a: texture_2d<f32>;\nvar  b :texture_2d< f32 > ;\nfn f() { var c = 1.0; }'>,
		'a' | 'b'
	>
>();
check<Same<WgslTextures<'var a: texture_3d<f32>;\nvar<private> b: texture_2d<f32>;'>, never>>();
check<
	Same<WgslTextures<'fn f() { var x = g(); let y: f32 = 1.0; }\nvar t: texture_2d<f32>;'>, 't'>
>();
check<Same<WgslTextures<string>, string>>();
