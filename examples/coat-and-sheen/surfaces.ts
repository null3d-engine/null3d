// The surface functions of the clear coat and sheen demo (sketch.ts): wet cobbles, whose puddles
// are a clear coat with rain rings in its normal, and velvet drapes, whose folds a vertex offset
// makes and whose sheen ripples a little with them.

/** Wet cobbles: stones from cells, puddles where low noise dips, rain rings in the puddles' coat. */
export const cobbles = /* wgsl */ `
#import null3d::noise::{fbm2, random2, worley2}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let p = input.worldPosition.xz;
    let stone = worley2(p * 2.2);
    let joint = smoothstep(0.08, 0.22, stone);
    s.baseColor *= mix(0.25, 0.75 + 0.25 * random2(floor(p * 2.2)), joint);
    let wet = smoothstep(0.02, 0.18, fbm2(p * 0.35, 4u) + 0.25 * (1.0 - joint));
    s.baseColor *= mix(1.0, 0.4, wet);
    s.roughness = mix(s.roughness, 0.35, wet);
    s.clearcoat = wet;
    s.clearcoatRoughness = 0.03;
    // Rings that spread from a drop in each cell of a grid, each cell at its own time.
    let cell = floor(p * 1.5);
    let age = fract(frame.time * 0.8 + random2(cell));
    let center = (cell + vec2f(random2(cell + 3.1), random2(cell + 7.7))) / 1.5;
    let d = length(p - center);
    let ring = sin((d - age * 0.6) * 60.0) * exp(-abs(d - age * 0.6) * 30.0) * (1.0 - age);
    let toward = normalize(p - center + vec2f(1e-4));
    s.clearcoatNormal = normalize(vec3f(-toward.x * ring * 0.25, 1.0, -toward.y * ring * 0.25));
    return s;
}
`;

/** Velvet drapes: folds that a vertex offset makes, and the sheen of the material's options. */
export const drapes = /* wgsl */ `
fn vertexOffset(input: VertexInput) -> vec3f {
    let fold = sin(input.uv.x * 40.0) * 0.18 + sin(input.uv.x * 13.0 + input.uv.y * 2.0) * 0.1;
    return vec3f(0.0, 0.0, fold * (0.6 + 0.4 * input.uv.y));
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.sheenColor *= 0.8 + 0.2 * sin(input.uv.y * 9.0);
    return s;
}
`;
