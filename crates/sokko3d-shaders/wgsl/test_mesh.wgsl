enable draw_index;

// A small mesh shader that tests the shader build: a library import, shader defs, a uniform
// block, a data texture read with textureLoad, a sampled texture, flat interpolation and, in the
// DRAW_INDEX variant, the draw index of WEBGL_multi_draw. The engine's real shaders replace it.
#import sokko3d::math

struct Camera {
    view_projection: mat4x4f,
    draw_offsets: array<vec4f, 4>,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var instance_data: texture_2d<f32>;
@group(1) @binding(1) var base_color: texture_2d<f32>;
@group(1) @binding(2) var base_sampler: sampler;

struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) @interpolate(flat, either) material: u32,
}

@vertex
fn vs_main(
    @location(0) position: vec3f,
    @location(1) uv: vec2f,
    @builtin(instance_index) instance: u32,
#ifdef DRAW_INDEX
    @builtin(draw_index) draw: u32,
#endif
) -> VertexOut {
    var world = position;
#ifdef INSTANCED
    let row = textureLoad(instance_data, vec2u(0u, instance), 0);
    world = world * sokko3d::math::square(row.w) + row.xyz;
#endif
#ifdef DRAW_INDEX
    world += camera.draw_offsets[draw].xyz;
#endif
    var out: VertexOut;
    out.position = camera.view_projection * vec4f(world, 1.0);
    out.uv = uv;
    out.material = instance;
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
    let color = textureSample(base_color, base_sampler, in.uv);
    let shade = sokko3d::math::square(f32(in.material % 4u) * 0.25 + 0.5);
    return vec4f(color.rgb * shade, color.a);
}
