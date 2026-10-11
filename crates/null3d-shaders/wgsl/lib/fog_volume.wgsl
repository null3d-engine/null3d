#define_import_path null3d::fog_volume

// The volumetric fog's grid: cells that follow the camera's view (froxels). Each cell holds the
// light of the sun and the point and spot lights that the fog scatters toward the camera, through
// their shadows. The grid lives in one 2D texture: its slices lie side by side, eight to a row of
// tiles, from the camera outward, and each tile holds one slice's columns and rows across the
// view. Its rows run in the order of the texture's rows on each GPU path, as a fragment's position
// does, so a place on the screen finds its cell the same way on every path.
//
// Slices grow with distance. The far edge of slice k lies at `reach × ((k + 1) / slices)²` along
// the view, so near slices are thin and far ones thick.
//
// The summed grid holds, for each cell, the light scattered toward the camera from the camera up
// to the cell's far edge, and the share of light that passes that far. `fog_volume_place` finds
// it at any point. The engine's apply step calls it for each pixel of the opaque scene. A shader
// that draws after that step, such as a particle's, binds the summed grid in a group of its own,
// with the grid's layout, and calls it at its own depth.

/// Slices in each row of tiles of the grid's texture.
const SLICES_PER_ROW: u32 = 8u;

/// The grid's layout, as the engine writes it into each block that reads the grid.
struct FogGrid {
    /// The columns and rows of each slice, the slices, and the distance along the view that the
    /// grid reaches.
    cells: vec4f,
    /// The size of one texel of the grid's texture in texture coordinates, in `xy`. `z` is 1 where
    /// texture rows count from the bottom of the view, as on WebGL2, and 0 where they count from its
    /// top. `w` is 1 for a perspective camera and 0 for an orthographic one.
    texel: vec4f,
}

/// The settings of the engine's own steps that light, sum and apply the grid, which the frame
/// builder writes once a frame while they change.
struct FogStep {
    grid: FogGrid,
    /// The first pixel of the scene's drawn corner in `xy`, and one over the corner's size in `zw`.
    corner: vec4f,
    /// The inverse projection's terms that turn a depth value into the view-space z: z is
    /// (x × depth + y) / (z × depth + w).
    depth: vec4f,
    /// The unit direction of the camera's view, relative to the camera.
    forward: vec4f,
    /// The camera's right and up axes, scaled to the view's edge: by the tangent of half the field
    /// of view each way for a perspective camera, and by half the view's width and height for an
    /// orthographic one.
    right: vec4f,
    up: vec4f,
    /// The direction that the sun's light travels in `xyz`, and the fog's anisotropy in `w`:
    /// Henyey-Greenstein's g, from -1 to 1.
    sun_direction: vec4f,
    /// The sun's exposed color times the fog's intensity in `rgb`, and the fog's intensity in `w`,
    /// which scales the point and spot lights.
    sun_color: vec4f,
    /// The fog's density at the camera's height, its height falloff, the weight of the last frame's
    /// grid (0 when there is none), and the shortest distance at which a lamp's light counts.
    medium: vec4f,
    /// The frame's offset of each cell's point from the cell's center, in cells, in `xyz`.
    jitter: vec4f,
    /// The matrix from positions relative to this frame's camera into the clip space of the last
    /// frame's camera.
    history_view_proj: mat4x4f,
    /// The row whose dot product with `(position, 1)`, relative to this frame's camera, gives its
    /// distance along the last frame's view.
    history_row: vec4f,
}

/// The direction of the view ray through `screen`, a place across the view from 0 to 1 each way
/// in the order of the grid's rows. For a perspective camera, its part along the view is 1, so a
/// point at distance d along the view lies at d times the ray. For an orthographic camera the ray
/// is the view's direction.
fn fog_ray(settings: FogStep, screen: vec2f) -> vec3f {
    let x = screen.x * 2.0 - 1.0;
    let y = mix(1.0 - screen.y * 2.0, screen.y * 2.0 - 1.0, settings.grid.texel.z);
    let across = settings.right.xyz * x + settings.up.xyz * y;
    return settings.forward.xyz + across * settings.grid.texel.w;
}

/// The position relative to the camera of the point at `distance` along the view ray through
/// `screen` (`fog_ray`).
fn fog_point(settings: FogStep, screen: vec2f, distance: f32) -> vec3f {
    let x = screen.x * 2.0 - 1.0;
    let y = mix(1.0 - screen.y * 2.0, screen.y * 2.0 - 1.0, settings.grid.texel.z);
    let across = settings.right.xyz * x + settings.up.xyz * y;
    return settings.forward.xyz * distance + across * mix(1.0, distance, settings.grid.texel.w);
}

/// Henyey-Greenstein's phase function: the share of scattered light that leaves at an angle of
/// cosine `cosine` to the light's own direction, per unit of solid angle. `g` above 0 scatters
/// more light forward.
fn fog_phase(g: f32, cosine: f32) -> f32 {
    const QUARTER_OVER_PI = 0.07957747154594767;
    let squared = g * g;
    let base = max(1.0 + squared - 2.0 * g * cosine, 1e-4);
    return QUARTER_OVER_PI * (1.0 - squared) / (base * sqrt(base));
}

/// The place across the view of a fragment of a texture that holds the view, from 0 to 1 each
/// way, in the order of the texture's rows. `corner` holds the first pixel of the view's drawn
/// corner in `xy`, and one over the corner's size in `zw`.
fn fog_screen_place(position: vec2f, corner: vec4f) -> vec2f {
    return (position - corner.xy) * corner.zw;
}

/// The slice coordinate of the far edges of the slices at `distance` along the view: k + 1 at the
/// far edge of slice k, so 0 at the camera and the slice count at the grid's reach.
fn fog_slice_edge(grid: FogGrid, distance: f32) -> f32 {
    return sqrt(clamp(distance / grid.cells.w, 0.0, 1.0)) * grid.cells.z;
}

/// The distance along the view of slice coordinate `edge`, as `fog_slice_edge` gives it.
fn fog_edge_distance(grid: FogGrid, edge: f32) -> f32 {
    let share = edge / grid.cells.z;
    return grid.cells.w * share * share;
}

/// The texture coordinates of `cell` within slice `slice` of the grid's texture: `cell` counts
/// columns and rows, with a cell's center at its index plus one half. The place keeps half a texel
/// inside the slice's tile, so a filtered read never takes a neighboring slice's texels.
fn fog_cell_uv(grid: FogGrid, cell: vec2f, slice: u32) -> vec2f {
    let size = grid.cells.xy;
    let tile = vec2f(f32(slice % SLICES_PER_ROW), f32(slice / SLICES_PER_ROW));
    let inside = clamp(cell, vec2f(0.5), size - 0.5);
    return (tile * size + inside) * grid.texel.xy;
}

/// Where to read the grid for one value: the texture coordinates of the two nearest slices, how
/// far the value lies from the first toward the second, and how much of it counts, from 0 at the
/// camera to 1 from the first slice's far edge on. A shader reads its grid texture at both places
/// with a linear sampler and blends them with `fog_volume_blend`. WGSL builds take no texture as a
/// function's argument in every browser, so the shader reads the texture itself.
struct FogVolumePlace {
    near: vec2f,
    far: vec2f,
    blend: f32,
    fade: f32,
}

/// The place of `cell` across the view and at slice coordinate `cell.z`, with a cell's center at
/// its index plus one half each way: filtered across the view by the sampler, and blended between
/// the two nearest slices.
fn fog_grid_place(grid: FogGrid, cell: vec3f) -> FogVolumePlace {
    let last = grid.cells.z - 1.0;
    let at = clamp(cell.z - 0.5, 0.0, last);
    let near = floor(at);
    let far = min(near + 1.0, last);
    let near_uv = fog_cell_uv(grid, cell.xy, u32(near));
    let far_uv = fog_cell_uv(grid, cell.xy, u32(far));
    return FogVolumePlace(near_uv, far_uv, at - near, 1.0);
}

/// The place in the summed grid of a point at `screen`, its place across the view from 0 to 1 each
/// way in the order of the grid's rows (`fog_screen_place`), and `distance` along the view. Past
/// the grid's reach it gives the place at the reach.
fn fog_volume_place(grid: FogGrid, screen: vec2f, distance: f32) -> FogVolumePlace {
    let edge = fog_slice_edge(grid, distance);
    // The summed slice k holds the sum up to edge k + 1. In front of the first edge, the sum grows
    // from nothing at the camera.
    var place = fog_grid_place(grid, vec3f(screen * grid.cells.xy, edge - 0.5));
    place.fade = saturate(edge);
    return place;
}

/// The value at `place` from the grid's values `near` and `far`, read at its two texture
/// coordinates. In the summed grid, it is the light that the fog scatters toward the camera up to
/// the point, in `rgb`, and the share of light that passes from the point to the camera, in `a`.
/// A shader that draws after the apply step reads the summed grid the same way.
fn fog_volume_blend(near: vec4f, far: vec4f, place: FogVolumePlace) -> vec4f {
    return mix(vec4f(0.0, 0.0, 0.0, 1.0), mix(near, far, place.blend), place.fade);
}
