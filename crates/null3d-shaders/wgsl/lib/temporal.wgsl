#define_import_path null3d::temporal

// The temporal resolve's rejection math (task M3-A11, decision record D-206): the box that a pixel's
// history is clamped to, and the share of the history that its reactive mask leaves. A resolve step
// imports these, and the shader library's check page compares each result with its own reference on
// every GPU path.

/// A box in YCoCg that a history color is clamped to.
struct TemporalBox {
    low: vec3f,
    high: vec3f,
}

/// The color in YCoCg: the brightness in x, and the two chroma terms in y and z. Statistics and
/// clamping in this space keep a change of brightness from moving a color's chroma.
fn temporal_ycocg(c: vec3f) -> vec3f {
    return vec3f(
        0.25 * c.r + 0.5 * c.g + 0.25 * c.b,
        0.5 * c.r - 0.5 * c.b,
        -0.25 * c.r + 0.5 * c.g - 0.25 * c.b,
    );
}

/// The color of YCoCg's three values.
fn temporal_rgb(c: vec3f) -> vec3f {
    let tmp = c.x - c.z;
    return vec3f(tmp + c.y, c.x + c.z, tmp - c.y);
}

/// `box` widened to hold `centre`, both in YCoCg: its lower edge falls to the centre and its upper
/// edge rises to it, and every other edge stays. A box that leaves the centre outside pushes the
/// history away from this frame's color each frame, which shows as banding on a lit gradient.
fn temporal_widen(box: TemporalBox, centre: vec3f) -> TemporalBox {
    var out: TemporalBox;
    out.low = min(box.low, centre);
    out.high = max(box.high, centre);
    return out;
}

/// The share of a pixel's new color that comes from its history, from 0 to 1. `reactive` is the
/// pixel's transparency mask, which drops the history where a blended surface moved, and `change`
/// is the brightness's relative change, which drops it where a light moved over the surface.
fn temporal_weight(base: f32, reactive: f32, change: f32) -> f32 {
    return clamp(base, 0.0, 1.0)
        * (1.0 - clamp(reactive, 0.0, 1.0))
        * (1.0 - smoothstep(0.5, 2.0, change));
}
