// The vehicle of a traffic lane: its place along the lane, and the lights it shows from its own
// coordinates. The row's values hold its start offset, its speed, the lane's length and a tint. A
// row's heading turns the movement and the light areas together, so the same mesh drives every way.

struct Uniforms {
    // The row's heading, in radians about +y, which turns local +Z onto the lane.
    heading: f32,
    // How brightly the skirt under the belly glows.
    glow: f32,
    // The hull's half width, its height and its half length, in meters.
    size: vec3f,
    body: vec3f,
    tail: vec3f,
    nose: vec3f,
    skirt: vec3f,
    // The tint of the canopy's glass, and how much of the canopy is glass: 0 paints it as the body.
    windows: vec3f,
    glass: f32,
}

// The row's place along its lane, from its start offset and the clock, wrapped at the lane's end.
fn vertexOffset(input: VertexInput) -> vec3f {
    let span = max(object.values.z, 1.0);
    let travelled = object.values.x + frame.time * object.values.y;
    return vec3f(0.0, 0.0, travelled - span * floor(travelled / span));
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    // The vehicle's own axes, from its heading: its length runs along local +Z.
    let c = cos(material.heading);
    let sn = sin(material.heading);
    let d = input.worldPosition - object.position;
    let lx = c * d.x - sn * d.z;
    let ly = d.y;
    let lz = sn * d.x + c * d.z;
    let half = max(material.size, vec3f(0.001));
    let tint = object.values.w;

    // The paint takes a little of the row's tint, so a lane is not one flat color.
    s.baseColor = mix(material.body, material.body * 2.4, 0.25 * tint);
    s.metalness = 0.7;
    s.roughness = 0.34;
    s.emissive = vec3f(0.0);

    // Tinted windows: the canopy over the middle of the roof is dark, smooth glass, with a faint
    // glow from the cabin behind it.
    let canopy = step(half.y * 0.76, ly) * step(abs(lz), half.z * 0.5) * material.glass;
    s.baseColor = mix(s.baseColor, material.windows * 0.25, canopy);
    s.metalness = mix(s.metalness, 0.0, canopy);
    s.roughness = mix(s.roughness, 0.04, canopy);
    s.emissive += material.windows * canopy * 0.18;

    // Tail lights: two bars, and a thin strip above them.
    let rear = 1.0 - step(-half.z * 0.86, lz);
    let bars = rear * step(half.y * 0.18, ly) * step(ly, half.y * 0.4)
        * step(half.x * 0.17, abs(lx)) * step(abs(lx), half.x * 0.62);
    s.emissive += material.tail * bars * 2.2;
    let strip = rear * step(half.y * 0.42, ly) * step(ly, half.y * 0.5)
        * step(abs(lx), half.x * 0.75);
    s.emissive += material.tail * strip * 1.4;
    // Nose lamps.
    let front = step(half.z * 0.84, lz) * step(half.y * 0.16, ly) * step(ly, half.y * 0.34)
        * step(half.x * 0.1, abs(lx)) * step(abs(lx), half.x * 0.52);
    s.emissive += material.nose * front * 4.5;
    // A neon band runs round the lower edge of the body, in the vehicle's own tint: the edge of the
    // field that holds it up. It lights the faces that look outward, not the belly.
    let band = step(half.y * 0.12, ly) * step(ly, half.y * 0.21) * step(abs(input.normal.y), 0.8);
    s.emissive += mix(material.skirt, material.tail, tint * 0.5) * band * material.glow;
    return s;
}
