// The WGSL shaders of the WebGPU skinning page, the twins of `skinning-shaders.ts`. The vertex
// shaders that skin read each character's joint matrices from a float texture, one row of texels
// per character, and blend four of them per vertex, as the WebGL2 programs do. The compute shader
// skins the same way from the same texture, as the engine's skinning pass does, once per frame,
// into a buffer of skinned vertices that the plain vertex shaders draw. The page's matrices come in WebGL's clip space, so each vertex shader moves depth
// from -1 to 1 into WebGPU's 0 to 1. This module uses no browser API.
import { MAX_CASCADES, SKINNING } from './skinning';

/** Threads per workgroup of the compute pass. */
export const SKIN_WORKGROUP = 64;

/** 32-bit words per vertex of the rest mesh: position (3), normal (3), joints (4 × 8 bits), weights (4). */
export const REST_WORDS = 11;
/** 32-bit words per skinned vertex: position (3), normal (3). */
export const SKINNED_WORDS = 6;

/** Each pass's matrix from the world into clip space. */
const PASS = `
struct Pass { viewProj: mat4x4f }
@group(0) @binding(0) var<uniform> pass_: Pass;

fn clip(world: vec3f) -> vec4f {
	var c = pass_.viewProj * vec4f(world, 1.0);
	c.z = 0.5 * (c.z + c.w);
	return c;
}
`;

/** Linear blend skinning from the joint texture: one row of texels per character. */
const SKIN = `
@group(0) @binding(1) var joints: texture_2d<f32>;

struct SkinIn {
	@location(0) position: vec3f,
	@location(1) normal: vec3f,
	@location(2) jointIds: vec4u,
	@location(3) weights: vec4f,
	@location(4) character: u32,
}

struct Skinned { position: vec3f, normal: vec3f }

fn skin(v: SkinIn) -> Skinned {
	let y = i32(v.character);
	var row0 = vec4f(0.0);
	var row1 = vec4f(0.0);
	var row2 = vec4f(0.0);
	for (var i = 0; i < 4; i++) {
		let x = i32(v.jointIds[i]) * 3;
		let w = v.weights[i];
		row0 += w * textureLoad(joints, vec2i(x, y), 0);
		row1 += w * textureLoad(joints, vec2i(x + 1, y), 0);
		row2 += w * textureLoad(joints, vec2i(x + 2, y), 0);
	}
	let p = vec4f(v.position, 1.0);
	let n = v.normal;
	return Skinned(
		vec3f(dot(row0, p), dot(row1, p), dot(row2, p)),
		normalize(vec3f(dot(row0.xyz, n), dot(row1.xyz, n), dot(row2.xyz, n))),
	);
}
`;

const PLAIN = `
struct PlainIn {
	@location(0) position: vec3f,
	@location(1) normal: vec3f,
}
`;

const SHADED_OUT = `
struct Shaded {
	@builtin(position) position: vec4f,
	@location(0) world: vec3f,
	@location(1) normal: vec3f,
}
`;

/** The lit surface: one directional light, its cascades with four taps each, and a highlight. */
const LIT = `
struct Lit {
	cascadeViewProj: array<mat4x4f, ${MAX_CASCADES}>,
	cascadeEnd: vec4f,
	cascadeTexel: vec4f,
	eye: vec3f,
	cascades: i32,
	forward: vec3f,
	toLight: vec3f,
	albedo: vec3f,
}
@group(1) @binding(0) var<uniform> lit: Lit;
@group(1) @binding(1) var shadowMap: texture_depth_2d_array;
@group(1) @binding(2) var shadowSampler: sampler_comparison;

const TEXEL = 1.0 / ${SKINNING.shadowMapSize}.0;

fn shadow(world: vec3f, n: vec3f) -> f32 {
	let depth = dot(world - lit.eye, lit.forward);
	var k = lit.cascades;
	for (var i = ${MAX_CASCADES - 1}; i >= 0; i--) {
		if (i < lit.cascades && depth <= lit.cascadeEnd[i]) {
			k = i;
		}
	}
	if (k >= lit.cascades) {
		return 1.0;
	}
	let c = lit.cascadeViewProj[k] * vec4f(world + n * (1.5 * lit.cascadeTexel[k]), 1.0);
	let s = vec3f(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5, c.z * 0.5 + 0.5);
	var sum = 0.0;
	for (var t = 0; t < 4; t++) {
		let offset = vec2f(f32(t & 1) - 0.5, f32(t >> 1) - 0.5) * TEXEL;
		sum += textureSampleCompareLevel(shadowMap, shadowSampler, s.xy + offset, k, s.z);
	}
	return 0.25 * sum;
}

@fragment
fn litMain(in: Shaded) -> @location(0) vec4f {
	let n = normalize(in.normal);
	let shade = max(dot(n, lit.toLight), 0.0) * shadow(in.world, n);
	let halfway = normalize(lit.toLight + normalize(lit.eye - in.world));
	let shine = pow(max(dot(n, halfway), 0.0), 32.0) * shade;
	let c = lit.albedo * (0.25 + 0.75 * shade) + vec3f(0.2 * shine);
	return vec4f(pow(c, vec3f(1.0 / 2.2)), 1.0);
}
`;

/** The vertex and fragment shaders of each render pipeline, by name. */
export const SKINNING_WGSL = {
	skinnedDepth: `${PASS}${SKIN}
@vertex
fn main(v: SkinIn) -> @builtin(position) vec4f {
	return clip(skin(v).position);
}
`,
	skinnedShaded: `${PASS}${SKIN}${SHADED_OUT}${LIT}
@vertex
fn main(v: SkinIn) -> Shaded {
	let s = skin(v);
	return Shaded(clip(s.position), s.position, s.normal);
}
`,
	plainDepth: `${PASS}${PLAIN}
@vertex
fn main(v: PlainIn) -> @builtin(position) vec4f {
	return clip(v.position);
}
`,
	plainShaded: `${PASS}${PLAIN}${SHADED_OUT}${LIT}
@vertex
fn main(v: PlainIn) -> Shaded {
	return Shaded(clip(v.position), v.position, v.normal);
}
`,
	/**
	 * One thread per vertex of each character to skin. The characters' list gives each slot's
	 * character, and slot s holds its vertices from s times the vertex count, so one index buffer
	 * covers every slot, as with transform feedback.
	 */
	skinOnce: `
struct Params { vertexCount: u32, total: u32 }
@group(0) @binding(0) var<storage, read> rest: array<f32>;
@group(0) @binding(1) var joints: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> characters: array<u32>;
@group(0) @binding(3) var<storage, read_write> skinned: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

@compute @workgroup_size(${SKIN_WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
	let at = id.x;
	if (at >= params.total) {
		return;
	}
	let slot = at / params.vertexCount;
	let v = at - slot * params.vertexCount;
	let y = i32(characters[slot]);
	let r = v * ${REST_WORDS}u;
	let ids = bitcast<u32>(rest[r + 6u]);
	var row0 = vec4f(0.0);
	var row1 = vec4f(0.0);
	var row2 = vec4f(0.0);
	for (var i = 0u; i < 4u; i++) {
		let x = i32((ids >> (8u * i)) & 0xffu) * 3;
		let w = rest[r + 7u + i];
		row0 += w * textureLoad(joints, vec2i(x, y), 0);
		row1 += w * textureLoad(joints, vec2i(x + 1, y), 0);
		row2 += w * textureLoad(joints, vec2i(x + 2, y), 0);
	}
	let p = vec4f(rest[r], rest[r + 1u], rest[r + 2u], 1.0);
	let n = vec3f(rest[r + 3u], rest[r + 4u], rest[r + 5u]);
	let normal = normalize(vec3f(dot(row0.xyz, n), dot(row1.xyz, n), dot(row2.xyz, n)));
	let o = at * ${SKINNED_WORDS}u;
	skinned[o] = dot(row0, p);
	skinned[o + 1u] = dot(row1, p);
	skinned[o + 2u] = dot(row2, p);
	skinned[o + 3u] = normal.x;
	skinned[o + 4u] = normal.y;
	skinned[o + 5u] = normal.z;
}
`,
} as const;
