// The surface functions of the clear coat and sheen demo (sketch.ts): wet cobbles, whose puddles
// are a clear coat with rain rings in its normal, and velvet drapes, whose folds a vertex offset
// makes, whose normal follows the folds, and whose sheen ripples a little with them.

/** Wet setts: stones in offset rows, puddles where low noise dips, rain rings in the puddles' coat. */
export const cobbles = /* wgsl */ `
#import null3d::noise::{fbm2, random2}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let p = input.worldPosition.xz;
    // Stones of a third by a fifth of a meter, each row shifted by half a stone.
    let q = p * vec2f(3.0, 5.0);
    let row = floor(q.y);
    let qx = q.x + 0.5 * (row - 2.0 * floor(row * 0.5));
    let cell = vec2f(floor(qx), row);
    let f = vec2f(fract(qx), fract(q.y)) - 0.5;
    let edge = min((0.5 - abs(f.x)) / 3.0, (0.5 - abs(f.y)) / 5.0);
    let joint = smoothstep(0.004, 0.018, edge);
    let tone = 0.65 + 0.35 * random2(cell) + 0.1 * fbm2(p * 9.0, 3u);
    s.baseColor *= mix(0.18, tone, joint);
    let wet = smoothstep(0.0, 0.2, fbm2(p * 0.3, 4u) + 0.3 * (1.0 - joint));
    s.baseColor *= mix(1.0, 0.45, wet);
    s.roughness = mix(s.roughness, 0.3, wet);
    // Each stone domes a little, and puddles fill the hollows level.
    s.normal = normalize(vec3f(f.x * 0.5, 1.0, f.y * 0.3) * vec3f(1.0 - wet, 1.0, 1.0 - wet));
    s.clearcoat = wet;
    s.clearcoatRoughness = 0.03;
    // Rings that spread from a drop in each cell of a grid, each cell at its own time.
    let drop = floor(p * 1.5);
    let age = fract(frame.time * 0.8 + random2(drop));
    let center = (drop + vec2f(random2(drop + 3.1), random2(drop + 7.7))) / 1.5;
    let d = length(p - center);
    let ring = sin((d - age * 0.6) * 60.0) * exp(-abs(d - age * 0.6) * 30.0) * (1.0 - age);
    let toward = normalize(p - center + vec2f(1e-4));
    s.clearcoatNormal = normalize(vec3f(-toward.x * ring * 0.25, 1.0, -toward.y * ring * 0.25));
    return s;
}
`;

/** Velvet drapes: folds that a vertex offset makes and that bend the normal, and the sheen. */
export const drapes = /* wgsl */ `
// The fold's depth and slope along the drapes' width, at x across them and v up them.
fn fold(x: f32, v: f32) -> vec2f {
    let amp = 0.6 + 0.4 * v;
    let depth = (sin(x * 4.5) * 0.18 + sin(x * 1.4 + v * 2.0) * 0.1) * amp;
    let slope = (cos(x * 4.5) * 0.81 + cos(x * 1.4 + v * 2.0) * 0.14) * amp;
    return vec2f(depth, slope);
}

fn vertexOffset(input: VertexInput) -> vec3f {
    return vec3f(0.0, 0.0, fold(input.position.x, input.uv.y).x);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    // The engine keeps the flat plane's normal, so the folds' slope bends it here.
    let slope = fold(input.worldPosition.x, input.uv.y).y;
    s.normal = normalize(vec3f(-slope, 0.0, 1.0));
    s.sheenColor *= 0.8 + 0.2 * sin(input.uv.y * 9.0);
    return s;
}
`;
