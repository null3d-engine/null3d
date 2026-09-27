// WGSL sources of the first render path: instanced meshes lit by one directional light and ambient
// light, and the compute shader that culls instances on the GPU. The per-instance data reaches the
// vertex shader as instance-rate vertex attributes, never through storage buffers, so the same
// shaders run in WebGPU's compatibility mode.

/** Byte layout of the per-frame uniform block, which the core writes. */
export const FRAME_UNIFORM_BYTES = 128;
/** Bytes per instance in the compacted instance buffer: three matrix rows and a vec4 of ids. */
export const INSTANCE_STRIDE = 64;
/** Bytes per mesh vertex: position and normal. */
export const VERTEX_STRIDE = 24;
/** Threads per culling workgroup, within the portable budget. */
export const CULL_WORKGROUP_SIZE = 128;

const FRAME = /* wgsl */ `
struct Frame {
	view_proj: mat4x4f,
	camera_position: vec4f,
	sun_direction: vec4f,
	sun_color: vec4f,
	ambient: vec4f,
}

struct Material {
	color: vec4f,
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> materials: array<Material>;
`;

const INSTANCED = /* wgsl */ `
${FRAME}

const PI = 3.141592653589793;

struct VertexIn {
	@location(0) position: vec3f,
	@location(1) normal: vec3f,
	@location(2) row0: vec4f,
	@location(3) row1: vec4f,
	@location(4) row2: vec4f,
	@location(5) ids: vec4u,
}

struct VertexOut {
	@builtin(position) clip: vec4f,
	@location(0) normal: vec3f,
	@location(1) @interpolate(flat, either) material: u32,
}

@vertex
fn vs(v: VertexIn) -> VertexOut {
	let p = vec4f(v.position, 1.0);
	let n = vec4f(v.normal, 0.0);
	var out: VertexOut;
	out.clip = frame.view_proj * vec4f(dot(v.row0, p), dot(v.row1, p), dot(v.row2, p), 1.0);
	out.normal = vec3f(dot(v.row0, n), dot(v.row1, n), dot(v.row2, n));
	out.material = v.ids.x;
	return out;
}

fn linear_to_srgb(c: vec3f) -> vec3f {
	let low = c * 12.92;
	let high = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
	return select(high, low, c <= vec3f(0.0031308));
}

@fragment
fn fs_lit(in: VertexOut) -> @location(0) vec4f {
	let albedo = materials[in.material].color.rgb;
	let n_dot_l = max(dot(normalize(in.normal), -frame.sun_direction.xyz), 0.0);
	let color = albedo / PI * (n_dot_l * frame.sun_color.rgb + frame.ambient.rgb);
	return vec4f(linear_to_srgb(color), 1.0);
}

@fragment
fn fs_unlit(in: VertexOut) -> @location(0) vec4f {
	return vec4f(linear_to_srgb(materials[in.material].color.rgb), 1.0);
}
`;

const CULL = /* wgsl */ `
struct CullParams {
	planes: array<vec4f, 6>,
	instance_count: u32,
	pad0: u32,
	pad1: u32,
	pad2: u32,
}

struct Bucket {
	base: u32,
	material: u32,
	radius: f32,
	pad: u32,
}

@group(0) @binding(0) var<uniform> params: CullParams;
@group(0) @binding(1) var<storage, read> matrices: array<vec4f>;
@group(0) @binding(2) var<storage, read> instance_buckets: array<u32>;
@group(0) @binding(3) var<storage, read> buckets: array<Bucket>;
@group(0) @binding(4) var<storage, read_write> visible: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> indirect: array<atomic<u32>>;

const HIDDEN = 0xffffffffu;
const INDIRECT_WORDS = 5u;

@compute @workgroup_size(${CULL_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3u) {
	let i = id.x;
	if (i >= params.instance_count) {
		return;
	}
	let b = instance_buckets[i];
	if (b == HIDDEN) {
		return;
	}
	let r0 = matrices[i * 3u];
	let r1 = matrices[i * 3u + 1u];
	let r2 = matrices[i * 3u + 2u];
	let center = vec3f(r0.w, r1.w, r2.w);
	let scale = max(length(vec3f(r0.x, r1.x, r2.x)), max(length(vec3f(r0.y, r1.y, r2.y)), length(vec3f(r0.z, r1.z, r2.z))));
	let bucket = buckets[b];
	let radius = bucket.radius * scale;
	for (var p = 0u; p < 6u; p++) {
		let plane = params.planes[p];
		if (dot(plane.xyz, center) + plane.w < -radius) {
			return;
		}
	}
	let slot = atomicAdd(&indirect[b * INDIRECT_WORDS + 1u], 1u);
	let dst = (bucket.base + slot) * 4u;
	visible[dst] = r0;
	visible[dst + 1u] = r1;
	visible[dst + 2u] = r2;
	visible[dst + 3u] = bitcast<vec4f>(vec4u(bucket.material, 0u, 0u, 0u));
}
`;

export const WGSL = { instanced: INSTANCED, cull: CULL } as const;
