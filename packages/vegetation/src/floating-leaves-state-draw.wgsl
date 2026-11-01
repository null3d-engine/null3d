// The floating and falling leaves in the state form: a compute pass carries each leaf's place and
// speed from one frame to the next, and this material reads that state to place the cards. It is the
// same leaf look as the offset form, moved by air that a leaf keeps, so a gust carries it along its
// path rather than pushing it only where it stands.
#import null3d::noise::{random}

var leaves: texture_2d_array<f32>;
var leafMap: texture_2d<f32>;

struct Uniforms {
    /// The state texture's texels across.
    columns: f32,
    /// The layer of the state texture that holds the newest state.
    layer: f32,
    /// The top of the fall and the ground under it, in meters.
    height: f32,
    low: f32,
    /// The seconds that a leaf takes to fall.
    fall: f32,
    /// The leaf's size in meters.
    size: f32,
    /// The scene's seed, which gives each leaf its own phase.
    seed: f32,
    /// The turns a second that a leaf makes as it falls.
    spin: f32,
    /// The linear colour that multiplies the leaf's own.
    tint: vec3f,
}

/// One turn, for the phases that the leaves carry.
const TURN: f32 = 6.283185307179586;

fn vertexOffset(input: VertexInput) -> vec3f {
    let index = input.instance;
    let columns = u32(max(material.columns, 1.0));
    let at = vec2i(i32(index % columns), i32(index / columns));
    let state = textureLoad(leaves, at, i32(material.layer), 0);
    let phase = random(index + u32(material.seed));
    let age = fract(frame.time / max(material.fall, 0.001) + phase);
    let y = mix(material.height, material.low, age);
    let turn = frame.time * material.spin + phase * TURN;
    let c = cos(turn);
    let s = sin(turn);
    let turned = vec3f(
        input.position.x * c - input.position.z * s,
        input.position.y,
        input.position.x * s + input.position.z * c,
    );
    let place = vec3f(state.x, y, state.y);
    return (place - object.position) + turned * material.size - input.position;
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let leaf = textureSample(leafMap, leafMapSampler, input.uv);
    s.baseColor = leaf.rgb * material.tint;
    s.alpha = leaf.a;
    s.roughness = 0.7;
    s.metalness = 0;
    return s;
}
