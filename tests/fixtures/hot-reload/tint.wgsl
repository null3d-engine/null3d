struct Uniforms { strength: f32 }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor = vec3f(0.0);
    s.emissive = vec3f(1.0, 0.0, 0.0) * material.strength;
    return s;
}
