// Waves that move along the first texture coordinates, in the uniforms' tint, height and count.
struct Uniforms {
    tint: vec3f,
    height: f32,
    count: u32,
    shift: vec2<f32>,
}

fn vertexOffset(input: VertexInput) -> vec3f {
    let wave = sin((input.uv.x + material.shift.x) * f32(material.count) * 6.2832 + frame.time);
    return input.normal * wave * material.height;
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor = s.baseColor * material.tint;
    return s;
}
