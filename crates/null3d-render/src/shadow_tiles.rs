//! Point and spot light shadows: the tiles of the shadow atlas, which lights get them, and when
//! each tile draws again.
//!
//! # The atlas
//!
//! The shadow atlas is one depth texture array, and each of its layers is a tile of the same size.
//! A spot light's shadows take one tile: a perspective view from the light along its direction,
//! wide enough to hold its cone. A point light's shadows take six tiles in a row, one for each
//! face of a cube around the light, from the first. Each tile's view keeps the shadow filter's
//! reach inside its edges, so the filter never reads past what the tile drew.
//!
//! The atlas has as many layers as the lights that cast shadows have needed since it was made, up
//! to the frame builder's tile budget. It grows when more lights cast, and it keeps its layers
//! when a light stops casting, so a light whose shadows turn off and on again does not make the
//! atlas again, nor the render graph's passes. It goes only when no light casts, or when the
//! settings change.
//!
//! # Which lights get tiles
//!
//! Each frame, the lights that cast shadows and that the camera sees compete for the tiles. The
//! light that looks largest from the camera, its range over its distance, comes first. A light
//! takes its tiles if they still fit within the budget, and keeps the tiles it held in the frame
//! before. Point lights take aligned blocks of six tiles from the first tile up, and spot lights
//! single tiles from the last tile down, so the two kinds rarely get in each other's way. When a
//! point light finds no free block all the same, every light takes its tiles again from scratch.
//!
//! # When a tile draws
//!
//! A tile keeps its depth from frame to frame. It draws again only when:
//!
//! - it goes to another light, or the atlas is made again;
//! - its light moves, turns, or changes its cone, its range or its layers;
//! - a shadow caster moves, turns, scales, shows, hides or changes its layers within the tile's
//!   view, or leaves it;
//! - a skinned or morphed caster within the tile's view changes its pose or its weights;
//! - the scene's structure changes, as casters may then come or go.
//!
//! The frame builder learns which casters moved from the frame's upload list. Moving objects are
//! listed in every frame, so the module keeps each caster's last world matrix, bounding sphere and
//! layers, and counts a caster as moved only when they differ. A caster marks only the tiles whose
//! views its sphere touches, before or after its move: one to three of a point light's six faces
//! for a caster near the light. A pose need not move the sphere, so the module also keeps a stamp
//! of each skinned or morphed caster's pose, and compares it in each frame while the caster lies
//! within a shadowed light's range.
//!
//! A tile whose view misses the camera's view waits: no receiver on screen reads it. It draws when
//! the camera turns toward it. A tile that holds no depth of its light yet draws at once. Other
//! tiles that must draw again share a cap of [`MAX_REDRAWS`] per frame, so a burst of moving
//! casters near many lights spreads over frames. Whole lights take the cap, those that waited
//! longest first, then the largest on screen; the others keep their last depth for a frame or
//! two (decision record D-61).
//!
//! A draw counts only once the GPU really drew it. Draws whose pipelines are still building draw
//! nothing (see `null3d_gpu::drawlist`), so a tile drawn in a frame whose pipelines may not all be
//! built draws again in the next frame. The thread that draws reports the newest frame drawn with
//! every pipeline built, and a frame is safe when that frame comes after the last frame that
//! created a pipeline.
//!
//! # Receivers
//!
//! Each light's record in the light grid (see [`crate::light_grid`]) holds its first tile, and the
//! tiles' uniform block holds each tile's matrix from positions relative to the camera into its
//! clip space, with the size of its texels and the light's biases. A receiver of a point light
//! picks the face that its direction from the light points through. Its matrices follow the
//! camera, so the block uploads whenever the camera or a tile's light moves, while the tiles'
//! depth stays.

use null3d_core::cells::{CellCoords, CellPosition};
use null3d_core::culling::Frustum;
use null3d_core::handle::Handle;
use null3d_core::lights::{LightShadow, NOT_VISIBLE, VisibleLight, kind};
use null3d_core::morph::NOT_LINKED;
use null3d_core::scene::{SceneStorage, flags};
use null3d_core::snapshot::SCENE_TARGET;
use null3d_core::world::{HIDDEN_RADIUS, MATRIX_FLOATS};
use null3d_gpu::drawlist::sizes::SHADOW_TILES_UNIFORM_BYTES;
use null3d_gpu::drawlist::{DrawList, Op, buffer_usage, format};

use crate::camera::{Affine, Mat4, ViewDepth, multiply, view_matrix};
use crate::frame::{FrameInput, NO_MESH, RecordError, UploadArena};
use crate::frame_data::FrameUniform;
use crate::pipelines::PassTargets;
use crate::view::ViewFrame;

/// The most tiles of the shadow atlas.
pub const MAX_TILES: usize = 24;

/// What the tiles' shadow passes draw into: the atlas's 32-bit float depth, with one sample and no
/// color. A tile's perspective view stores most of its depth's range near its light, so 16-bit
/// depth would leave steps of about 1.5% of the distance near the far end: 15 cm at 10 m.
pub const TARGETS: PassTargets = PassTargets {
    color_format: format::NONE,
    depth_format: format::DEPTH32_FLOAT,
    samples: 1,
    permutation: 0,
};

/// The tiles of a point light's shadows: one per face of a cube.
pub const POINT_FACES: usize = 6;

/// The steepest half angle of a spot light's tile, in radians. A wider cone casts shadows over
/// this part only.
const MAX_HALF_ANGLE: f32 = 85.0 * std::f32::consts::PI / 180.0;

/// The near plane of a tile's view, as a share of its light's range.
const NEAR_SHARE: f32 = 1e-3;

/// The texels that the widest shadow filter, the 5 x 5 square, reads past the point it filters. A
/// tile's view keeps this many texels inside each edge, so the filter never reads past what the
/// tile drew.
pub const FILTER_REACH: u32 = 3;

/// The most tiles that draw again in one frame because a caster or a light moved, apart from
/// tiles that hold no depth of their light yet (decision record D-61). Two point lights' cubes:
/// the High preset's sixteen tiles and the Ultra preset's twenty-four take two frames at most.
pub const MAX_REDRAWS: usize = 12;

/// The moved rows of a casting batch between two checks of whether every tile must draw already.
const MARKED_CHECK_ROWS: usize = 64;

/// How the shadow atlas is set up: the start values of the quality preset.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TileSettings {
    /// The most tiles, from 0, which turns spot and point light shadows off, to [`MAX_TILES`].
    pub tiles: u32,
    /// Texels on each side of each tile.
    pub size: u32,
    /// True when point lights cast shadows.
    pub point_shadows: bool,
}

impl Default for TileSettings {
    /// The Medium preset's values.
    fn default() -> Self {
        Self {
            tiles: 8,
            size: 512,
            point_shadows: false,
        }
    }
}

/// The shadow atlas's shape: its layers, and the texels on each side of each.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AtlasShape {
    pub layers: u32,
    pub size: u32,
}

/// What a tile shows, by which it knows whether it must draw again: its light, its face, where the
/// light stands and how it points, and what its view holds.
#[derive(Clone, Copy, Debug, PartialEq)]
struct TileKey {
    light: u32,
    kind: u32,
    face: u32,
    cell: CellCoords,
    local: [f32; 3],
    direction: [f32; 3],
    angle: f32,
    range: f32,
    layers: u32,
}

/// One tile's state between frames.
#[derive(Clone, Copy, Debug, Default)]
struct Slot {
    /// What the tile holds, or `None` for a free tile.
    key: Option<TileKey>,
    /// True when the tile's depth shows its key, so it need not draw.
    clean: bool,
    /// True when the tile holds depth that it drew for its key's light, if from an older place of
    /// the light or its casters. Receivers can read it while the tile waits to draw again.
    held: bool,
    /// The frames that the tile has waited to draw again under the redraw cap.
    waited: u32,
}

/// The shape of a tile's view from its light: its axes, x and y across the view and z against
/// it, and the tangent of half its field of view, with the filter's margin.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct TileShape {
    axes: [[f32; 3]; 3],
    half_tan: f32,
}

impl TileShape {
    /// The view of `face` of `light`, for tiles of `size` texels on each side.
    fn of(light: &LightShadow, face: u32, size: u32) -> Self {
        let (direction, half_tan) = if light.kind == kind::POINT {
            (FACE_DIRECTIONS[face as usize], 1.0)
        } else {
            (light.direction, light.angle.min(MAX_HALF_ANGLE).tan())
        };
        let margin = 1.0 - 2.0 * FILTER_REACH as f32 / size.max(4 * FILTER_REACH) as f32;
        Self {
            axes: view_axes(direction),
            half_tan: half_tan / margin,
        }
    }

    /// True when a sphere of `radius` whose center lies `center` from the light touches the inside
    /// of the view's four sides.
    fn touches(&self, center: [f32; 3], radius: f32) -> bool {
        let [x, y, z] = self.axes;
        let along = -dot(center, z);
        let reach = radius * (self.half_tan * self.half_tan + 1.0).sqrt();
        [x, y]
            .iter()
            .all(|&axis| self.half_tan * along - dot(center, axis).abs() >= -reach)
    }

    /// False when the view, out to `range` from its light at `position` relative to the camera,
    /// lies wholly outside `frustum`, a frustum relative to the camera: then no receiver in the
    /// frustum reads the tile.
    fn meets(&self, position: [f32; 3], range: f32, frustum: &Frustum) -> bool {
        let [x, y, z] = self.axes;
        let side = range * self.half_tan;
        let corner = |a: f32, b: f32| -> [f32; 3] {
            std::array::from_fn(|k| position[k] - z[k] * range + (x[k] * a + y[k] * b) * side)
        };
        let points = [
            position,
            corner(-1.0, -1.0),
            corner(-1.0, 1.0),
            corner(1.0, -1.0),
            corner(1.0, 1.0),
        ];
        !frustum.planes().iter().any(|plane| {
            points
                .iter()
                .all(|p| p[0] * plane[0] + p[1] * plane[1] + p[2] * plane[2] + plane[3] < 0.0)
        })
    }
}

/// The tiles as receivers read them, laid out as the shaders' `ShadowTiles` structure.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TileUniform {
    /// Each tile's matrix from positions relative to the camera into its clip space.
    pub view_proj: [Mat4; MAX_TILES],
    /// Each tile's texel size per meter of distance from its light, its light's bias and normal
    /// bias in meters, and the tiles of its light: 1 for a spot light, 6 for a point light.
    pub params: [[f32; 4]; MAX_TILES],
    /// The texels on each side of a tile, the size of one texel in texture coordinates, and the
    /// texels on each side of the shadow filter's square.
    pub kernel: [f32; 4],
}

impl Default for TileUniform {
    fn default() -> Self {
        Self {
            view_proj: [[0.0; 16]; MAX_TILES],
            params: [[0.0; 4]; MAX_TILES],
            kernel: [0.0; 4],
        }
    }
}

const _: () = assert!(size_of::<TileUniform>() == SHADOW_TILES_UNIFORM_BYTES as usize);

impl TileUniform {
    /// The uniform as bytes, for an upload.
    pub fn as_bytes(&self) -> &[u8] {
        // SAFETY: the struct is `repr(C)` and made only of `f32`s, so it has no padding, and any
        // bytes of it are initialized.
        unsafe {
            std::slice::from_raw_parts(
                (self as *const Self).cast::<u8>(),
                std::mem::size_of::<Self>(),
            )
        }
    }
}

/// A shadow caster as the module last saw it: its world matrix, bounding sphere, cell and layers,
/// and the stamp of its pose (see [`pose_of`]).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Caster {
    matrix: [f32; 12],
    sphere: [f32; 4],
    cell: CellCoords,
    layers: u32,
    pose: u64,
}

impl Caster {
    /// Where the caster's sphere center lies from `light`, when the caster shows, shares a layer
    /// with the light and its sphere reaches into the light's range. The caster then draws into
    /// each tile of the light whose view its sphere touches.
    fn center_from(&self, light: &LightShadow) -> Option<[f32; 3]> {
        let [x, y, z, radius] = self.sphere;
        if radius == HIDDEN_RADIUS || light.layers & self.layers == 0 {
            return None;
        }
        let offset = light.at.offset_to(self.cell);
        let center = [offset[0] + x, offset[1] + y, offset[2] + z];
        let reach = light.range + radius;
        (dot(center, center) <= reach * reach).then_some(center)
    }
}

/// An instance batch that casts shadows, with its layers and active rows as the module last saw
/// them.
#[derive(Clone, Copy, Debug)]
struct BatchCaster {
    id: Handle,
    layers: u32,
    active: u32,
}

/// A light that the frame gives tiles: its place in the shadow list, its first tile, its tiles,
/// and its position relative to the camera.
#[derive(Clone, Copy, Debug)]
struct Lit {
    shadow: u32,
    first: u32,
    faces: u32,
    position: [f32; 3],
}

/// The shadow atlas's tiles: see the module documentation.
#[derive(Debug)]
pub struct ShadowTiles {
    settings: TileSettings,
    shape: AtlasShape,
    slots: [Slot; MAX_TILES],
    /// The shape of each tile's view in the frame planned last, for the tiles that lights hold.
    shapes: [TileShape; MAX_TILES],
    /// Each tile's view in the frame planned last, for the tiles that draw in it.
    frames: [Option<ViewFrame>; MAX_TILES],
    /// The tiles that the frame planned last left to wait under the redraw cap.
    waiting: usize,
    /// The lights that hold tiles in the frame planned last.
    lit: Vec<Lit>,
    /// The candidates of the frame being planned, ranked: how large each looks, and its place in
    /// the shadow list.
    ranked: Vec<(f32, u32)>,
    uniform: TileUniform,
    /// The uniform that the GPU holds, or `None` before the first upload.
    held: Option<TileUniform>,
    /// Each scene slot's caster as last seen, while `casters_known` holds.
    casters: Vec<Caster>,
    casters_known: bool,
    /// The scene slots of skinned and morphed objects, while `casters_known` holds.
    posed: Vec<u32>,
    /// The instance batches that cast shadows, while `casters_known` holds.
    batches: Vec<BatchCaster>,
    /// The last frame whose draw list created a pipeline.
    last_new_pipeline: u32,
}

impl Default for ShadowTiles {
    fn default() -> Self {
        Self::new()
    }
}

impl ShadowTiles {
    pub fn new() -> Self {
        Self {
            settings: TileSettings::default(),
            shape: AtlasShape { layers: 0, size: 0 },
            slots: [Slot::default(); MAX_TILES],
            shapes: [TileShape::default(); MAX_TILES],
            frames: [None; MAX_TILES],
            waiting: 0,
            lit: Vec::new(),
            ranked: Vec::new(),
            uniform: TileUniform::default(),
            held: None,
            casters: Vec::new(),
            casters_known: false,
            posed: Vec::new(),
            batches: Vec::new(),
            last_new_pipeline: 0,
        }
    }

    /// The atlas's shape in the frame planned last, or `None` while no light casts shadows into
    /// it.
    pub fn shape(&self) -> Option<AtlasShape> {
        (self.shape.layers > 0).then_some(self.shape)
    }

    /// A tile's view, when the frame planned last draws it.
    pub fn frame(&self, tile: usize) -> Option<&ViewFrame> {
        self.frames.get(tile)?.as_ref()
    }

    /// The tiles that the frame planned last draws.
    pub fn drawn(&self) -> usize {
        self.frames.iter().filter(|f| f.is_some()).count()
    }

    /// The tiles that the frame planned last left to draw in a later frame under the redraw cap
    /// ([`MAX_REDRAWS`]).
    pub fn waiting(&self) -> usize {
        self.waiting
    }

    /// The uniform block of the frame planned last.
    pub fn uniform(&self) -> &TileUniform {
        &self.uniform
    }

    /// Plans the tiles of the frame `input`, with `settings` and the shadow filter's square of
    /// `filter` texels, for the camera's view `camera`, or for no camera: then no tile draws.
    /// Allocates only when more lights cast shadows, or the scene holds more objects, than in any
    /// frame before.
    pub fn plan(
        &mut self,
        input: &FrameInput<'_>,
        settings: TileSettings,
        filter: u32,
        camera: Option<&ViewFrame>,
    ) {
        self.frames = [None; MAX_TILES];
        self.waiting = 0;
        self.lit.clear();
        let shadows = input.shadow_lights;
        let shape = self.shape_for(shadows, settings);
        if shape != self.shape || settings != self.settings {
            self.slots = [Slot::default(); MAX_TILES];
            self.shape = shape;
            self.settings = settings;
        }
        let Some(camera) = camera.filter(|_| shape.layers > 0) else {
            self.casters_known = false;
            return;
        };
        self.assign(input.lights, shadows);
        for lit in &self.lit {
            let light = &shadows[lit.shadow as usize];
            for face in 0..lit.faces {
                self.shapes[(lit.first + face) as usize] = TileShape::of(light, face, shape.size);
            }
        }
        self.mark_moved_casters(input, shadows);
        self.mark_posed_casters(input, shadows);
        self.mark_moved_batches(input, shadows);
        self.uniform = TileUniform::default();
        let size = shape.size as f32;
        self.uniform.kernel = [size, 1.0 / size, filter as f32, 0.0];
        let mut fresh = 0;
        for k in 0..self.lit.len() {
            let lit = self.lit[k];
            let light = &shadows[lit.shadow as usize];
            for face in 0..lit.faces {
                let tile = (lit.first + face) as usize;
                let tile_shape = &self.shapes[tile];
                let view = TileView::from_shape(tile_shape, light, lit.position, shape.size);
                let key = TileKey {
                    light: light.light,
                    kind: light.kind,
                    face,
                    cell: light.at.cell,
                    local: light.at.local,
                    direction: light.direction,
                    angle: light.angle,
                    range: light.range,
                    layers: light.layers,
                };
                self.uniform.view_proj[tile] = view.view_proj;
                self.uniform.params[tile] = [
                    view.texel_per_meter,
                    light.bias,
                    light.normal_bias,
                    lit.faces as f32,
                ];
                let slot = &mut self.slots[tile];
                if slot.key != Some(key) {
                    slot.key = Some(key);
                    slot.clean = false;
                }
                if slot.clean || !tile_shape.meets(lit.position, light.range, &camera.frustum) {
                    continue;
                }
                fresh += usize::from(!slot.held);
                self.frames[tile] = Some(view.frame(camera.camera, light.layers));
            }
        }
        self.cap_redraws(fresh);
        for (slot, frame) in self.slots.iter_mut().zip(&self.frames) {
            if frame.is_some() {
                slot.held = true;
                slot.waited = 0;
            }
        }
    }

    /// Keeps the frame's redraws, the tiles that draw again for their own light, within
    /// [`MAX_REDRAWS`] less the `fresh` tiles that draw for the first time. Whole lights keep
    /// their redraws, those whose tiles waited longest first, then the largest on screen. The
    /// other lights' tiles wait for a later frame and keep the depth they hold.
    fn cap_redraws(&mut self, fresh: usize) {
        let redraws = |tiles: &Self, k: usize| {
            let lit = tiles.lit[k];
            (lit.first..lit.first + lit.faces)
                .map(|t| t as usize)
                .filter(|&t| tiles.frames[t].is_some() && tiles.slots[t].held)
                .fold((0, 0), |(count, waited), t| {
                    (count + 1, waited.max(tiles.slots[t].waited))
                })
        };
        let total: usize = (0..self.lit.len()).map(|k| redraws(self, k).0).sum();
        let mut left = MAX_REDRAWS.saturating_sub(fresh);
        if total <= left {
            return;
        }
        // Each light holds a tile at least, so a mask of the lights fits a word.
        let mut done = 0u32;
        while let Some((k, count)) = (0..self.lit.len())
            .filter(|&k| done & (1 << k) == 0)
            .map(|k| (k, redraws(self, k)))
            .filter(|(_, (count, _))| *count > 0)
            .max_by(|(a, (_, wa)), (b, (_, wb))| wa.cmp(wb).then(b.cmp(a)))
            .map(|(k, (count, _))| (k, count))
        {
            done |= 1 << k;
            if count <= left {
                left -= count;
                continue;
            }
            let lit = self.lit[k];
            for t in lit.first..lit.first + lit.faces {
                let t = t as usize;
                if self.frames[t].is_some() && self.slots[t].held {
                    self.frames[t] = None;
                    self.slots[t].waited = self.slots[t].waited.saturating_add(1);
                    self.waiting += 1;
                }
            }
        }
    }

    /// The first tile plus one, as the light grid's records hold it, of the light in row `light`,
    /// or 0 when it holds none in the frame planned last.
    pub fn tile_of(&self, light: u32, shadows: &[LightShadow]) -> f32 {
        self.lit
            .iter()
            .find(|lit| shadows[lit.shadow as usize].light == light)
            .map_or(0.0, |lit| (lit.first + 1) as f32)
    }

    /// Writes each light's first tile into its record of `lights`, the lights that the light grid
    /// lists in the frame planned last.
    pub fn mark_lights(&self, lights: &mut [VisibleLight], shadows: &[LightShadow]) {
        for light in lights {
            light.shadow = if self.lit.is_empty() {
                0.0
            } else {
                self.tile_of(light.light, shadows)
            };
        }
    }

    /// Counts the tiles that the frame planned last drew as drawn, unless a pipeline may still be
    /// building while the GPU draws them: the frame's list created pipelines when
    /// `created_pipelines`, and `pipelines_built` is the newest frame that the thread that draws
    /// drew with every pipeline built.
    pub fn finish(&mut self, frame: u32, created_pipelines: bool, pipelines_built: u32) {
        if created_pipelines {
            self.last_new_pipeline = frame;
        }
        if !crate::pipelines::built_by(self.last_new_pipeline, pipelines_built) {
            return;
        }
        for (slot, drawn) in self.slots.iter_mut().zip(&self.frames) {
            if drawn.is_some() {
                slot.clean = true;
            }
        }
    }

    /// Records the creation of the tiles' uniform block under `uniform`.
    pub(crate) fn create_objects(list: &mut DrawList, uniform: u32) -> Result<(), RecordError> {
        list.push(
            Op::CreateBuffer,
            &[
                uniform,
                SHADOW_TILES_UNIFORM_BYTES,
                buffer_usage::UNIFORM | buffer_usage::COPY_DST,
            ],
        )?;
        Ok(())
    }

    /// Uploads the frame's uniform block into `uniform` when it differs from what the GPU holds.
    pub(crate) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        uniform: u32,
    ) -> Result<(), RecordError> {
        if self.lit.is_empty() || self.held.as_ref() == Some(&self.uniform) {
            return Ok(());
        }
        let (at, bytes) = arena.push(self.uniform.as_bytes())?;
        list.push(Op::WriteBuffer, &[uniform, 0, at, bytes])?;
        self.held = Some(self.uniform);
        Ok(())
    }

    /// Makes room to remember `slots` scene slots' casters, so a frame that plans with that many
    /// allocates nothing.
    pub fn reserve(&mut self, slots: usize) -> Result<(), std::collections::TryReserveError> {
        self.casters
            .try_reserve(slots.saturating_sub(self.casters.len()))?;
        self.posed
            .try_reserve(slots.saturating_sub(self.posed.len()))
    }

    /// Forgets what the GPU holds, after the thread that draws replaced the GPU: every tile draws
    /// again as a tile that holds no depth, and the uniform block uploads again.
    pub fn forget_gpu(&mut self) {
        self.slots.iter_mut().for_each(|slot| {
            slot.clean = false;
            slot.held = false;
        });
        self.held = None;
        self.last_new_pipeline = 0;
    }

    /// The atlas's shape for the lights that cast shadows: a layer for each tile that they could
    /// fill, within the budget, and no fewer than it has while some light casts and the settings
    /// stay.
    fn shape_for(&self, shadows: &[LightShadow], settings: TileSettings) -> AtlasShape {
        let tiles: u32 = shadows
            .iter()
            .map(|light| match light.kind {
                kind::SPOT => 1,
                kind::POINT if settings.point_shadows => POINT_FACES as u32,
                _ => 0,
            })
            .sum();
        let mut layers = tiles.min(settings.tiles).min(MAX_TILES as u32);
        if layers > 0 && settings == self.settings {
            layers = layers.max(self.shape.layers);
        }
        AtlasShape {
            layers,
            size: if layers > 0 { settings.size.max(1) } else { 0 },
        }
    }

    /// Gives the tiles to the visible lights that look largest from the camera, keeping the tiles
    /// that each held before where it still gets some, and frees the tiles of the others.
    fn assign(&mut self, lights: &[VisibleLight], shadows: &[LightShadow]) {
        let point_shadows = self.settings.point_shadows;
        self.ranked.clear();
        let wanted = shadows
            .iter()
            .filter(|s| s.visible != NOT_VISIBLE && (s.kind == kind::SPOT || point_shadows))
            .count();
        if self.ranked.try_reserve(wanted).is_err() {
            return;
        }
        for (index, light) in shadows.iter().enumerate() {
            let Some(visible) = lights.get(light.visible as usize) else {
                continue;
            };
            if light.kind == kind::POINT && !point_shadows {
                continue;
            }
            let [x, y, z] = visible.position;
            let distance = (x * x + y * y + z * z).sqrt();
            self.ranked
                .push((light.range / distance.max(1e-6), index as u32));
        }
        // Largest first. The lights are few, so an insertion sort keeps the download small.
        for k in 1..self.ranked.len() {
            let mut at = k;
            while at > 0 && self.ranked[at - 1].0 < self.ranked[at].0 {
                self.ranked.swap(at - 1, at);
                at -= 1;
            }
        }

        // The lights that win tiles, in rank order, within the atlas's layers.
        let mut left = self.shape.layers;
        let mut winners = 0;
        for k in 0..self.ranked.len() {
            let light = &shadows[self.ranked[k].1 as usize];
            let need = faces_of(light);
            if need <= left {
                left -= need;
                self.ranked.swap(winners, k);
                winners += 1;
            }
        }
        self.ranked.truncate(winners);

        // Free the tiles of the lights that won none, then give the winners their tiles.
        let won = |slot: &Slot, ranked: &[(f32, u32)]| {
            slot.key.is_some_and(|key| {
                ranked.iter().any(|&(_, s)| {
                    let light = &shadows[s as usize];
                    light.light == key.light && light.kind == key.kind
                })
            })
        };
        for k in 0..MAX_TILES {
            if !won(&self.slots[k], &self.ranked) {
                self.slots[k] = Slot::default();
            }
        }
        if !self.place(lights, shadows) {
            self.slots = [Slot::default(); MAX_TILES];
            self.lit.clear();
            let placed = self.place(lights, shadows);
            debug_assert!(placed, "the winners fit an empty atlas");
        }
    }

    /// Gives each winner its tiles: the ones it held, or new ones. Returns false when a point light
    /// finds no free block of six tiles.
    fn place(&mut self, lights: &[VisibleLight], shadows: &[LightShadow]) -> bool {
        self.lit.clear();
        // Lights that hold tiles keep them first, so a new light cannot take them.
        for pass in [true, false] {
            for k in 0..self.ranked.len() {
                let index = self.ranked[k].1;
                let light = &shadows[index as usize];
                let held = (0..self.shape.layers as usize).find(|&t| {
                    self.slots[t].key.is_some_and(|key| {
                        key.light == light.light && key.kind == light.kind && key.face == 0
                    })
                });
                let first = match (pass, held) {
                    (true, Some(first)) => first as u32,
                    (false, None) => match self.free_tiles(faces_of(light)) {
                        Some(first) => first,
                        None => return false,
                    },
                    _ => continue,
                };
                // A new light's tiles are taken, so the next light cannot take them too.
                for face in 0..faces_of(light) {
                    let slot = &mut self.slots[(first + face) as usize];
                    if slot.key.is_none() {
                        slot.key = Some(TileKey {
                            light: light.light,
                            kind: light.kind,
                            face,
                            cell: [i32::MIN; 3],
                            local: [0.0; 3],
                            direction: [0.0; 3],
                            angle: 0.0,
                            range: 0.0,
                            layers: 0,
                        });
                        slot.clean = false;
                    }
                }
                let position = lights[light.visible as usize].position;
                self.lit.push(Lit {
                    shadow: index,
                    first,
                    faces: faces_of(light),
                    position,
                });
            }
        }
        true
    }

    /// The first of `count` free tiles: a single tile from the last one down, or a block of six
    /// aligned to six from the first tile up. `None` when none is free.
    fn free_tiles(&self, count: u32) -> Option<u32> {
        let layers = self.shape.layers;
        let free = |t: u32| self.slots[t as usize].key.is_none();
        if count == 1 {
            return (0..layers).rev().find(|&t| free(t));
        }
        (0..layers / count)
            .map(|block| block * count)
            .find(|&first| (first..first + count).all(free))
    }

    /// Marks the tiles whose views a caster that moved since the module last saw it touches,
    /// before or after the move, as tiles that must draw. Remembers every caster from scratch, and
    /// marks every tile, when it knows none yet, the upload list overflowed or the structure
    /// changed.
    fn mark_moved_casters(&mut self, input: &FrameInput<'_>, shadows: &[LightShadow]) {
        let scene = input.scene;
        let slots = scene.slots().high_water() as usize + 1;
        if self.casters.len() < slots {
            if self.reserve(slots).is_err() {
                self.slots.iter_mut().for_each(|slot| slot.clean = false);
                self.casters_known = false;
                return;
            }
            self.casters.resize(slots, Caster::default());
        }
        if !self.casters_known || input.snapshot.overflowed() || input.structure_changed {
            self.posed.clear();
            for (slot, caster) in self.casters[..slots].iter_mut().enumerate().skip(1) {
                *caster = caster_of(input, slot);
                if caster.pose != 0 {
                    // Room for every slot is reserved above, so this never allocates.
                    self.posed.push(slot as u32);
                }
            }
            self.batches.clear();
            let casting = || {
                input
                    .batches
                    .iter()
                    .filter(|(_, batch)| batch.shadows() & flags::CAST_SHADOWS != 0)
            };
            if self.batches.try_reserve(casting().count()).is_err() {
                self.slots.iter_mut().for_each(|slot| slot.clean = false);
                return;
            }
            let parity = input.parity();
            self.batches
                .extend(casting().map(|(id, batch)| BatchCaster {
                    id,
                    layers: batch.layers(),
                    active: batch.frame_active_count(parity),
                }));
            self.casters_known = true;
            self.slots.iter_mut().for_each(|slot| slot.clean = false);
            return;
        }
        for range in input.snapshot.uploads() {
            if range.target != SCENE_TARGET {
                continue;
            }
            for slot in range.start as usize..(range.start + range.count) as usize {
                if slot >= slots || !casts(scene, slot) {
                    continue;
                }
                let now = caster_of(input, slot);
                let before = std::mem::replace(&mut self.casters[slot], now);
                if before != now {
                    self.mark(shadows, &before, &now);
                }
            }
        }
    }

    /// Marks the tiles whose views a row of a casting batch touches, before or after its move, as
    /// tiles that must draw, for each row that the batch's update changed in this frame. A batch
    /// whose active count or layers changed marks every tile. The row scan stops once every tile of
    /// the frame's lights must draw, so a large batch that moves costs little more than one that
    /// stands still; later batches still record their active count and layers.
    fn mark_moved_batches(&mut self, input: &FrameInput<'_>, shadows: &[LightShadow]) {
        if !self.casters_known {
            return;
        }
        let parity = input.parity();
        let table = input.scene.cell_table();
        let (mut all, mut full) = (false, false);
        for k in 0..self.batches.len() {
            let known = self.batches[k];
            let Ok(batch) = input.batches.get(known.id) else {
                all = true;
                continue;
            };
            let (layers, active) = (batch.layers(), batch.frame_active_count(parity));
            if layers != known.layers || active != known.active {
                self.batches[k] = BatchCaster {
                    layers,
                    active,
                    ..known
                };
                all = true;
                continue;
            }
            if all || full || batch.frame() != input.frame {
                continue;
            }
            let (now, before) = (batch.world(parity), batch.world(parity ^ 1));
            let cells = batch.cells();
            'rows: for range in batch.changed_ranges() {
                let (start, end) = (
                    range.start as usize,
                    (range.start + range.count).min(active),
                );
                for (row, &cell) in cells.iter().enumerate().take(end as usize).skip(start) {
                    if (row - start) % MARKED_CHECK_ROWS == 0 && self.all_marked() {
                        full = true;
                        break 'rows;
                    }
                    let (before, now) = (before.sphere(row), now.sphere(row));
                    if before == now {
                        continue;
                    }
                    let caster = |sphere| Caster {
                        sphere,
                        cell: table.coords(cell),
                        layers,
                        ..Caster::default()
                    };
                    self.mark(shadows, &caster(before), &caster(now));
                }
            }
        }
        if all {
            self.slots.iter_mut().for_each(|slot| slot.clean = false);
        }
    }

    /// Marks the tiles whose views a skinned or morphed caster touches as tiles that must draw,
    /// when its pose changed since the module last saw it. A pose can change while the caster's
    /// sphere stays, as when an animated character moves its hands in front of its body. Only
    /// casters within reach of a light that holds tiles stamp their pose.
    fn mark_posed_casters(&mut self, input: &FrameInput<'_>, shadows: &[LightShadow]) {
        if !self.casters_known {
            return;
        }
        for k in 0..self.posed.len() {
            let slot = self.posed[k] as usize;
            let Some(&before) = self.casters.get(slot) else {
                continue;
            };
            let reached = self
                .lit
                .iter()
                .any(|lit| before.center_from(&shadows[lit.shadow as usize]).is_some());
            if !reached || !casts(input.scene, slot) {
                continue;
            }
            let pose = pose_of(input, slot);
            if pose != before.pose {
                let now = Caster { pose, ..before };
                self.casters[slot] = now;
                self.mark(shadows, &before, &now);
            }
        }
    }

    /// Marks the tiles of the frame's lights into which `before` or `now`, a caster before and
    /// after a change, draws as tiles that must draw.
    fn mark(&mut self, shadows: &[LightShadow], before: &Caster, now: &Caster) {
        for lit in &self.lit {
            let light = &shadows[lit.shadow as usize];
            let (from_before, from_now) = (before.center_from(light), now.center_from(light));
            if from_before.is_none() && from_now.is_none() {
                continue;
            }
            for tile in lit.first as usize..(lit.first + lit.faces) as usize {
                let shape = &self.shapes[tile];
                let touches = |center: Option<[f32; 3]>, caster: &Caster| {
                    center.is_some_and(|center| shape.touches(center, caster.sphere[3]))
                };
                if touches(from_before, before) || touches(from_now, now) {
                    self.slots[tile].clean = false;
                }
            }
        }
    }

    /// True when every tile of the frame's lights must draw already, so no caster can mark more.
    fn all_marked(&self) -> bool {
        self.lit.iter().all(|lit| {
            self.slots[lit.first as usize..(lit.first + lit.faces) as usize]
                .iter()
                .all(|slot| !slot.clean)
        })
    }
}

/// The tiles of a light's shadows.
fn faces_of(light: &LightShadow) -> u32 {
    if light.kind == kind::POINT {
        POINT_FACES as u32
    } else {
        1
    }
}

/// True when the object at scene slot `slot` casts shadows. Objects without a mesh, such as the
/// lights themselves, draw nothing.
fn casts(scene: &SceneStorage, slot: usize) -> bool {
    scene.flags()[slot] & flags::CAST_SHADOWS != 0 && scene.meshes()[slot] != NO_MESH
}

/// A scene slot's caster in the frame `input`: its world matrix, bounding sphere, cell and
/// layers, and its pose.
fn caster_of(input: &FrameInput<'_>, slot: usize) -> Caster {
    let (scene, parity) = (input.scene, input.parity());
    let world = scene.world(parity);
    Caster {
        matrix: *world.matrix(slot),
        sphere: world.sphere(slot),
        cell: scene.cell_position(slot as u32, parity).cell,
        layers: scene.layers()[slot],
        pose: pose_of(input, slot),
    }
}

/// A stamp of the pose that the object at scene slot `slot` draws with in the frame `input`: a
/// hash of its animated instance's skinning matrices and of its morph weights, with the matrices
/// of the instance that animates the weights. 0 for an object that is neither skinned nor
/// morphed. Two poses that differ get different stamps, but for a chance of one in 2^64.
fn pose_of(input: &FrameInput<'_>, slot: usize) -> u64 {
    let scene = input.scene;
    let skin = scene.skins().get(slot).copied().unwrap_or(0);
    let morph = scene.morphs().get(slot).copied().unwrap_or(0);
    if skin == 0 && morph == 0 {
        return 0;
    }
    // 64-bit FNV-1a over the bits of each float.
    let mut stamp = 0xcbf2_9ce4_8422_2325u64;
    let mut add = |values: &[f32]| {
        for value in values {
            stamp = (stamp ^ u64::from(value.to_bits())).wrapping_mul(0x0100_0000_01b3);
        }
    };
    let matrices = |instance: u32| {
        let animations = input.animations?;
        let (first, joints) = animations.instance_joints(instance)?;
        let first = first as usize * MATRIX_FLOATS;
        animations
            .matrices()
            .get(first..first + joints as usize * MATRIX_FLOATS)
    };
    if let Some(pose) = skin.checked_sub(1).and_then(matrices) {
        add(pose);
    }
    if let Some(id) = morph.checked_sub(1) {
        add(input.morphs.weights(id));
        let linked = input.morphs.block(id).map_or(NOT_LINKED, |b| b.instance);
        if let Some(pose) = (linked != NOT_LINKED).then(|| matrices(linked)).flatten() {
            add(pose);
        }
    }
    stamp
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// The axes of a view along `direction`, which has length 1: x and y across it, and z against
/// it, as a camera looks down its -z axis.
fn view_axes(direction: [f32; 3]) -> [[f32; 3]; 3] {
    let z = direction.map(|v| -v);
    // Any axis across the view works; the world's up keeps it steady while the light turns, and
    // the world's x stands in when the light points straight up or down.
    let up = if z[1].abs() < 0.99 {
        [0.0, 1.0, 0.0]
    } else {
        [1.0, 0.0, 0.0]
    };
    let x = normalize(cross(up, z));
    let y = cross(z, x);
    [x, y, z]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn normalize(v: [f32; 3]) -> [f32; 3] {
    let length = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    v.map(|x| x / length)
}

/// The direction of each face of a point light's cube: +x, -x, +y, -y, +z, -z.
pub const FACE_DIRECTIONS: [[f32; 3]; POINT_FACES] = [
    [1.0, 0.0, 0.0],
    [-1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, -1.0, 0.0],
    [0.0, 0.0, 1.0],
    [0.0, 0.0, -1.0],
];

/// A square perspective projection with reversed depth, as [`crate::camera::perspective_reversed`]
/// gives it, from the tangent of half its field of view.
fn perspective_of(half_tan: f32, near: f32, far: f32) -> Mat4 {
    let f = 1.0 / half_tan;
    let mut m = [0.0; 16];
    m[0] = f;
    m[5] = f;
    m[10] = near / (far - near);
    m[11] = -1.0;
    m[14] = near * far / (far - near);
    m
}

/// The face of a point light's cube that a direction from the light points through, as the
/// shaders choose it (`null3d::shadows::cube_face`): the axis along which the direction is
/// longest, with ties going to x, then y.
pub fn cube_face(direction: [f32; 3]) -> u32 {
    let [x, y, z] = direction.map(f32::abs);
    if x >= y && x >= z {
        u32::from(direction[0] <= 0.0)
    } else if y >= z {
        2 + u32::from(direction[1] <= 0.0)
    } else {
        4 + u32::from(direction[2] <= 0.0)
    }
}

/// One tile's view in one frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TileView {
    /// The matrix from positions relative to the camera into the tile's clip space.
    pub view_proj: Mat4,
    /// The size of one texel per meter of distance from the light.
    pub texel_per_meter: f32,
    /// How far positions relative to the camera lie along the tile's view.
    pub depth: ViewDepth,
    /// The light's position relative to the camera.
    pub position: [f32; 3],
    /// The texels on each side of the tile.
    pub size: u32,
}

impl TileView {
    /// The view of `face` of a light whose position relative to the camera is `position`, for
    /// tiles of `size` texels on each side. A spot light's one tile holds its cone with
    /// [`FILTER_REACH`] texels to spare on each side, so the shadow filter never reads past what
    /// the tile drew. A point light's tiles each hold a quarter turn with the same margin.
    pub fn of(light: &LightShadow, face: u32, position: [f32; 3], size: u32) -> Self {
        Self::from_shape(&TileShape::of(light, face, size), light, position, size)
    }

    fn from_shape(shape: &TileShape, light: &LightShadow, position: [f32; 3], size: u32) -> Self {
        let half_tan = shape.half_tan;
        let [x, y, z] = shape.axes;
        let world: Affine = [
            x[0],
            y[0],
            z[0],
            position[0],
            x[1],
            y[1],
            z[1],
            position[1],
            x[2],
            y[2],
            z[2],
            position[2],
        ];
        let near = (light.range * NEAR_SHARE).max(1e-4);
        let projection = perspective_of(half_tan, near, light.range);
        let view = view_matrix(&world);
        Self {
            view_proj: multiply(&projection, &view),
            texel_per_meter: 2.0 * half_tan / size.max(1) as f32,
            depth: ViewDepth {
                row: [-view[2], -view[6], -view[10], -view[14]],
                near,
                far: light.range,
                perspective: true,
            },
            position,
            size,
        }
    }

    /// The tile's view values for a camera at `camera`, culling the casters on `layers`. Its camera
    /// is the light, and its target is the tile, whose texels the casters' offset counts.
    pub fn frame(&self, camera: CellPosition, layers: u32) -> ViewFrame {
        let [x, y, z] = self.position;
        let size = self.size.max(1) as f32;
        ViewFrame::new(
            FrameUniform {
                view_proj: self.view_proj,
                camera_position: [x, y, z, 1.0],
                target_size: [size, size, 1.0 / size, 1.0 / size],
                ..FrameUniform::default()
            },
            camera,
            self.depth,
            layers,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spot(direction: [f32; 3], angle: f32) -> LightShadow {
        LightShadow {
            light: 1,
            kind: kind::SPOT,
            visible: 0,
            at: CellPosition::default(),
            direction,
            angle,
            range: 10.0,
            bias: 0.5,
            normal_bias: 1.0,
            layers: 1,
        }
    }

    /// Where the edge of the view's cone or quarter turn lands in clip space, on a tile of `size`
    /// texels: the filter's reach inside the tile's edge.
    fn inside(size: u32) -> f32 {
        1.0 - 2.0 * FILTER_REACH as f32 / size as f32
    }

    /// A position relative to the camera through a column-major matrix, after the divide by w.
    fn project(m: &Mat4, p: [f32; 3]) -> [f32; 3] {
        let w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
        std::array::from_fn(|row| {
            (m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row]) / w
        })
    }

    #[test]
    fn a_spot_tile_holds_the_cone_with_the_filter_s_reach_to_spare() {
        let light = spot([0.0, -1.0, 0.0], 0.5);
        let at = [2.0, 5.0, -1.0];
        let view = TileView::of(&light, 0, at, 256);
        // A point on the cone's edge, 6 m along it, lands the filter's reach inside the tile.
        let (sin, cos) = 0.5f32.sin_cos();
        let edge = [at[0] + 6.0 * sin, at[1] - 6.0 * cos, at[2]];
        let [x, y, depth] = project(&view.view_proj, edge);
        let largest = x.abs().max(y.abs());
        assert!((largest - inside(256)).abs() < 1e-4, "{x} {y}");
        assert!((0.0..1.0).contains(&depth));
        // Depth is reversed: nearer the light is larger.
        let near = project(&view.view_proj, [at[0], at[1] - 1.0, at[2]])[2];
        let far = project(&view.view_proj, [at[0], at[1] - 9.0, at[2]])[2];
        assert!(near > far);
        // The view's depth row gives the distance along the light's direction.
        let p = [at[0], at[1] - 4.0, at[2]];
        let r = view.depth.row;
        assert!((r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + r[3] - 4.0).abs() < 1e-5);
        // A texel at 4 m is 4 m times the texel per meter.
        let half_tan = 0.5f32.tan() / inside(256);
        assert!((view.texel_per_meter - 2.0 * half_tan / 256.0).abs() < 1e-7);
    }

    #[test]
    fn a_tile_s_pass_sees_the_light_as_its_camera_and_the_tile_as_its_target() {
        let light = spot([0.0, -1.0, 0.0], 0.5);
        let at = [2.0, 5.0, -1.0];
        let view = TileView::of(&light, 0, at, 256);
        let uniform = view.frame(CellPosition::default(), 1).uniform;
        assert_eq!(uniform.camera_position, [2.0, 5.0, -1.0, 1.0]);
        assert_eq!(
            uniform.target_size,
            [256.0, 256.0, 1.0 / 256.0, 1.0 / 256.0]
        );
        // The shadow depth shader's texel at a point 4 m along the light: two clip units over the
        // texels across, times the point's w, in meters.
        let m = &view.view_proj;
        let p = [at[0], at[1] - 4.0, at[2]];
        let w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
        let row = (m[0] * m[0] + m[4] * m[4] + m[8] * m[8]).sqrt();
        let texel = 2.0 * w * uniform.target_size[2] / row;
        assert!((texel - 4.0 * view.texel_per_meter).abs() < 1e-6, "{texel}");
    }

    #[test]
    fn a_point_light_s_six_faces_cover_every_direction() {
        let mut light = spot([0.0; 3], 0.0);
        light.kind = kind::POINT;
        let at = [1.0, 2.0, 3.0];
        for (face, direction) in FACE_DIRECTIONS.iter().enumerate() {
            let view = TileView::of(&light, face as u32, at, 512);
            // Straight along the face lands in the middle, and the edge of a quarter turn inside.
            let ahead: [f32; 3] = std::array::from_fn(|k| at[k] + direction[k] * 3.0);
            let [x, y, _] = project(&view.view_proj, ahead);
            assert!(x.abs() < 1e-5 && y.abs() < 1e-5, "face {face}");
            let [a, b, _] = view_axes(*direction);
            let corner: [f32; 3] =
                std::array::from_fn(|k| at[k] + (direction[k] + a[k] + b[k]) * 3.0);
            let [x, y, _] = project(&view.view_proj, corner);
            let inside = inside(512);
            assert!((x.abs() - inside).abs() < 1e-4 && (y.abs() - inside).abs() < 1e-4);
        }
    }

    #[test]
    fn every_direction_lands_inside_the_tile_of_its_face() {
        let mut light = spot([0.0; 3], 0.0);
        light.kind = kind::POINT;
        let at = [3.0, -1.0, 2.0];
        let views: Vec<TileView> = (0..POINT_FACES as u32)
            .map(|face| TileView::of(&light, face, at, 256))
            .collect();
        // Directions over a sphere, the cube's edges and corners among them.
        let steps = [-1.0, -0.99, -0.5, -0.1, 0.0, 0.1, 0.5, 0.99, 1.0];
        for x in steps {
            for y in steps {
                for z in steps {
                    let d = [x, y, z];
                    if d == [0.0; 3] {
                        continue;
                    }
                    let face = cube_face(d);
                    let along: f32 = FACE_DIRECTIONS[face as usize]
                        .iter()
                        .zip(d)
                        .map(|(a, b)| a * b)
                        .sum();
                    assert!(along > 0.0, "{d:?}");
                    let p: [f32; 3] = std::array::from_fn(|k| at[k] + d[k] * 4.0);
                    let [px, py, depth] = project(&views[face as usize].view_proj, p);
                    let inside = inside(256) + 1e-5;
                    assert!(
                        px.abs() <= inside && py.abs() <= inside,
                        "{d:?} face {face}"
                    );
                    assert!((0.0..=1.0).contains(&depth), "{d:?}");
                }
            }
        }
    }

    #[test]
    fn wide_cones_stop_at_the_steepest_tile_and_vertical_lights_have_axes() {
        let view = TileView::of(&spot([0.0, 1.0, 0.0], 1.5), 0, [0.0; 3], 1024);
        assert!(view.view_proj.iter().all(|v| v.is_finite()));
        let half_tan = MAX_HALF_ANGLE.tan() / inside(1024);
        assert!((view.texel_per_meter - 2.0 * half_tan / 1024.0).abs() < 1e-6);
    }

    #[test]
    fn the_projection_is_the_camera_s_for_the_same_field_of_view() {
        let half_tan = 0.7f32;
        let ours = perspective_of(half_tan, 0.1, 30.0);
        let camera = crate::camera::perspective_reversed(2.0 * half_tan.atan(), 1.0, 0.1, 30.0);
        for (a, b) in ours.iter().zip(&camera) {
            assert!((a - b).abs() < 1e-5, "{ours:?} {camera:?}");
        }
    }

    #[test]
    fn a_sphere_touches_the_faces_it_reaches_into_and_no_other() {
        let mut light = spot([0.0; 3], 0.0);
        light.kind = kind::POINT;
        let faces: Vec<TileShape> = (0..POINT_FACES as u32)
            .map(|face| TileShape::of(&light, face, 512))
            .collect();
        let touched = |center: [f32; 3], radius: f32| -> Vec<usize> {
            (0..POINT_FACES)
                .filter(|&f| faces[f].touches(center, radius))
                .collect()
        };
        // Well inside one face, across the edge of two, at a corner of three, around the light.
        assert_eq!(touched([0.0, -3.0, 0.0], 0.5), [3]);
        assert_eq!(touched([3.0, -3.0, 0.0], 0.5), [0, 3]);
        assert_eq!(touched([3.0, -3.0, 3.0], 0.5), [0, 3, 4]);
        assert_eq!(touched([0.2, 0.0, 0.0], 0.5), [0, 1, 2, 3, 4, 5]);
        // A point on a face's edge lies in both faces.
        assert_eq!(touched([2.0, 2.0, 0.0], 0.0), [0, 2]);
    }

    #[test]
    fn a_tile_meets_the_camera_s_view_unless_its_view_lies_wholly_outside_one_plane() {
        // A view straight down -z from the camera, 90 degrees wide, from 0.1 m to 100 m.
        let projection =
            crate::camera::perspective_reversed(std::f32::consts::FRAC_PI_2, 1.0, 0.1, 100.0);
        let frustum = Frustum::from_view_projection(&projection);
        let mut light = spot([0.0; 3], 0.0);
        light.kind = kind::POINT;
        // 5 m behind the camera, the light reaches 5 m into the view through its -z face alone.
        let behind = [0.0, 0.0, 5.0];
        let met: Vec<u32> = (0..POINT_FACES as u32)
            .filter(|&f| TileShape::of(&light, f, 512).meets(behind, 10.0, &frustum))
            .collect();
        assert_eq!(met, [5]);
        // In front of the camera, every face meets the view.
        let ahead = [0.0, 0.0, -20.0];
        assert!(
            (0..POINT_FACES as u32)
                .all(|f| TileShape::of(&light, f, 512).meets(ahead, 10.0, &frustum))
        );
    }

    #[test]
    fn the_uniform_is_the_size_the_shaders_read() {
        assert_eq!(
            TileUniform::default().as_bytes().len(),
            SHADOW_TILES_UNIFORM_BYTES as usize
        );
    }
}
