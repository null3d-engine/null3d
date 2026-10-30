struct Uniforms {
    wind: vec2f,
    sway: f32,
}

// A tuft's row values: x is its phase in the wind, y a value from 0 to 1 that picks its tint, and
// z and w the cosine and sine of its turn about y. The blades sway as one, so the whole hill reads
// as one field of air.

fn vertexOffset(input: VertexInput) -> vec3f {
    let traits = object.values;
    let p = object.position.xz;
    // Gusts: broad waves that roll across the hill, and a flutter of each tuft's own.
    let gust = 0.5 + 0.5 * sin(dot(p, material.wind) * 0.35 - frame.time * 1.6);
    let flutter = sin(frame.time * 2.7 + traits.x + input.position.x * 7.0);
    let bend = input.uv.y * input.uv.y * material.sway * (0.4 + 0.8 * gust + 0.25 * flutter);
    // The wind's direction in the tuft's own space, against its turn.
    let w = normalize(material.wind);
    let along = vec2f(w.x * traits.z - w.y * traits.w, w.x * traits.w + w.y * traits.z);
    return vec3f(along.x * bend, -0.4 * bend * bend, along.y * bend);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let traits = object.values;
    // A share of the tufts dry toward their tips, and each tuft's green differs a little.
    let dry = smoothstep(0.62, 1.0, traits.y) * input.uv.y;
    s.baseColor *= mix(vec3f(0.8 + 0.4 * traits.y), vec3f(1.7, 1.3, 0.45), dry);
    // Both faces light as the upper face, since the blades' normals lean up.
    s.normal = select(input.normal, -input.normal, input.normal.y < 0.0);
    return s;
}
