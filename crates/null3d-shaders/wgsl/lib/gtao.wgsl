#define_import_path null3d::gtao
#import null3d::mesh::{frame}

// The screen texture of ambient occlusion's steps in the camera's opaque pass. The steps (ao.wgsl)
// leave a texture at a fraction of the render size. Each texel of its first layer holds four values
// of the surface it shows: how much ambient light reaches it, its depth, the length of its
// reflected ray (0 for none), and how much of the sun's light its contact shadows let through.
// Each pixel of the opaque pass reads the four texels around its place and weights them by how
// close their depths lie to its own, so the values of a wall do not bleed onto an object in front
// of it, and the reverse.
//
// Its second layer holds screen-space bounce light: the light that one bounce brings from what the
// frame before showed, in rgb, and the share of the ambient light that it takes, in alpha. The
// same four texels carry it, so the light reaches each pixel at its own surface with no second
// gather. The frame draws no bounce light on the 8-bit path, whose color holds the display's
// already.
//
// The frame's `occlusion` values: x is ambient occlusion's strength, 0 when the view draws none,
// y the scene target's height in pixels, which WebGL2 needs as it counts rows from the bottom, and
// zw the texels of the texture per pixel of the scene, across and down: 0 when the steps draw
// nothing for the view. The frame's `bounce` values: x is the bounce light's strength, and w a
// spare.

/// The screen texture's first layer: the occlusion, the depth, the reflected ray's length and the
/// sun's light past contact shadows; its second: the bounce light's color and share. A blank texel
/// of 1, 0, 0 and 1, and of 0, when the frame draws none.
@group(0) @binding(11) var gtao_map: texture_2d_array<f32>;

/// The share of a texel's weight that its depth keeps, from 1 for the pixel's own depth down to 0
/// at this far, as a fraction of the pixel's depth.
const DEPTH_TOLERANCE: f32 = 0.03;

/// The values of a pixel with nothing in the screen texture: no occlusion, no reflected ray, and
/// all of the sun's light.
const NO_SCREEN_VALUES: vec4f = vec4f(1.0, 0.0, 0.0, 1.0);

/// True where the texel nearest in depth speaks for a pixel that no texel shares its depth with.
/// The depth prepass leaves out the builds that discard by their alpha or a fading level's dither.
/// Such a surface may stand in front of every texel, as a petal stands in front of the grass: the
/// texels then hold what lies behind it, so it takes none of them. A constant, not a branch, keeps
/// the reading function's text the same in every build.
#ifdef ALPHA_MASK
const NEAREST_SPEAKS: bool = false;
#else ifdef LOD_FADE
const NEAREST_SPEAKS: bool = false;
#else
const NEAREST_SPEAKS: bool = true;
#endif

/// The screen texture's values at a pixel, and what the reflected rays of the texels around it
/// found.
struct ScreenRead {
    /// The occlusion, the depth, the reflected ray's length and the sun's light past contact
    /// shadows, from the four texels around the pixel, each weighted by how close its depth lies to
    /// the pixel's. The length counts a texel whose ray missed as 0, so reflections read `hit`.
    values: vec4f,
    /// x: the mean length of the reflected rays of the texels that hit, over those texels alone.
    /// y: the share of the texels' weight that hit. Both 0 where none hit.
    hit: vec2f,
    /// Screen-space bounce light at the pixel, from the screen texture's second layer: the light
    /// that one bounce brings, in rgb, and the share of the ambient light that it takes, in alpha,
    /// which is 0 where the frame draws no bounce light or no texel lies at the pixel's surface.
    bounce: vec4f,
}

/// The screen texture's values at the pixel at `pixel`, a fragment position, whose depth value is
/// `pixel.z`, from the four texels around it, each weighted by how close its depth lies to the
/// pixel's: `NO_SCREEN_VALUES` and no hit when the frame has none for the view. Blended materials
/// draw over the surfaces that the steps saw, so they take none.
fn screen_read(pixel: vec3f, blended: bool) -> ScreenRead {
    let values = frame.occlusion;
    if values.z <= 0.0 || blended {
        return ScreenRead(NO_SCREEN_VALUES, vec2f(0.0), vec4f(0.0));
    }
    let size = vec2i(textureDimensions(gtao_map));
    var from_top = pixel.xy;
#ifdef WEBGL2
    from_top.y = values.y - pixel.y;
#endif
    // The drawn corner, within the texture: the blank texture that stands in before the steps'
    // pipelines are built has one texel.
    let corner = clamp(vec2i(round(frame.target_size.xy * values.zw)), vec2i(1), size);
    let at = from_top * values.zw - 0.5;
    let base = vec2i(floor(at));
    let blend = at - floor(at);
    // The bounce light reads the same texels with the same weights, and no texel at all while the
    // view draws none, so its cost while off is a branch on a value that the frame holds.
    let bounce_strength = frame.bounce.x;
    var sum = vec4f(0.0);
    var bounce = vec4f(0.0);
    var total = 0.0;
    var hits = 0.0;
    var reach = 0.0;
    var nearest = NO_SCREEN_VALUES;
    var nearest_bounce = vec4f(0.0);
    var nearest_gap = 1e30;
    for (var k = 0; k < 4; k++) {
        let offset = vec2i(k & 1, k >> 1u);
        var texel = clamp(base + offset, vec2i(0), corner - 1);
#ifdef WEBGL2
        texel.y = size.y - 1 - texel.y;
#endif
        let held = textureLoad(gtao_map, texel, 0, 0);
        let along = mix(1.0 - blend, blend, vec2f(offset));
        let gap = abs(held.y - pixel.z);
        let weight = along.x * along.y * max(0.0, 1.0 - gap / (DEPTH_TOLERANCE * pixel.z));
        sum += held * weight;
        total += weight;
        let hit = select(0.0, weight, held.z > 0.0);
        hits += hit;
        reach += hit * held.z;
        // The layer is read only while the view draws the light, so the branch keeps the cost of
        // a frame without it at nothing.
        var lit = vec4f(0.0);
        if bounce_strength > 0.0 {
            lit = textureLoad(gtao_map, texel, 1, 0);
        }
        if gap < nearest_gap {
            nearest_gap = gap;
            nearest = held;
            nearest_bounce = lit;
        }
        bounce += lit * weight;
    }
    // Where no texel lies at the pixel's depth, as on a thin edge, the nearest one in depth speaks
    // for it, in the builds where it may (`NEAREST_SPEAKS`).
    let held = select(select(NO_SCREEN_VALUES, nearest, NEAREST_SPEAKS), sum / total, total > 1e-4);
    let found = vec2f(reach / max(hits, 1e-4), hits / max(total, 1e-4));
    // The bounce light's own fallback: where no texel lies at the pixel's depth, as on a floor
    // seen at a grazing angle, the nearest one in depth stands in, so the light does not drop out
    // in patches.
    let lit = select(nearest_bounce, bounce / total, total > 1e-4);
    return ScreenRead(held, select(vec2f(0.0), found, hits > 1e-4), vec4f(lit.rgb, lit.a * bounce_strength));
}

/// How much ambient light reaches a pixel whose screen values are `screen` (`screen_read`): 1 for
/// all of it, the occlusion's strength blending toward the occlusion that the texture holds.
fn screen_occlusion(screen: vec4f) -> f32 {
    return mix(1.0, screen.x, frame.occlusion.x);
}
