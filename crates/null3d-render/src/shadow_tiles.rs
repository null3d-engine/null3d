//! Point and spot light shadows: the tiles of the shadow atlas, which lights get them, and when
//! each tile draws again.
//!
//! # The atlas
//!
//! The shadow atlas is one depth texture array, and each of its layers is a tile of the same size.
//! A spot light's shadows take one tile: a perspective view from the light along its direction,
//! wide enough to hold its cone. A point light's shadows take six tiles in a row, one for each
//! face of a cube around the light, from the first. The atlas has as many layers as the lights
//! that cast shadows could fill, up to the frame builder's tile budget, so it changes size only
//! when such a light is added, removed, shown or hidden.
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
//! - a shadow caster moves, turns, scales, shows or hides within its light's range, or leaves it;
//! - the scene's structure changes, as casters may then come or go.
//!
//! The frame builder learns which casters moved from the frame's upload list. Moving objects are
//! listed in every frame, so the module keeps each caster's last world matrix and bounding sphere,
//! and counts a caster as moved only when they differ.
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
use null3d_core::lights::{LightShadow, NOT_VISIBLE, VisibleLight, kind};
use null3d_core::scene::{SceneStorage, flags};
use null3d_core::snapshot::SCENE_TARGET;
use null3d_core::world::HIDDEN_RADIUS;
use null3d_gpu::drawlist::sizes::SHADOW_TILES_UNIFORM_BYTES;
use null3d_gpu::drawlist::{DrawList, Op, buffer_usage};

use crate::camera::{Affine, Mat4, ViewDepth, multiply, view_matrix};
use crate::frame::{FrameInput, RecordError, UploadArena};
use crate::frame_data::FrameUniform;
use crate::view::ViewFrame;

/// The most tiles of the shadow atlas.
pub const MAX_TILES: usize = 24;

/// The tiles of a point light's shadows: one per face of a cube.
pub const POINT_FACES: usize = 6;

/// The steepest half angle of a spot light's tile, in radians. A wider cone casts shadows over
/// this part only.
const MAX_HALF_ANGLE: f32 = 85.0 * std::f32::consts::PI / 180.0;

/// The near plane of a tile's view, as a share of its light's range.
const NEAR_SHARE: f32 = 1e-3;

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
}

/// The tiles as receivers read them, laid out as the shaders' `ShadowTiles` structure.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TileUniform {
    /// Each tile's matrix from positions relative to the camera into its clip space.
    pub view_proj: [Mat4; MAX_TILES],
    /// Each tile's texel size per meter of distance from its light, its light's bias and normal
    /// bias in texels, and the tiles of its light: 1 for a spot light, 6 for a point light.
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

/// A shadow caster's world matrix and bounding sphere when the module last saw it, and its cell.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Caster {
    matrix: [f32; 12],
    sphere: [f32; 4],
    cell: CellCoords,
}

/// A light that the frame gives tiles: its place in the shadow list, its first tile, and its
/// position relative to the camera.
#[derive(Clone, Copy, Debug)]
struct Lit {
    shadow: u32,
    first: u32,
    position: [f32; 3],
}

/// The shadow atlas's tiles: see the module documentation.
#[derive(Debug)]
pub struct ShadowTiles {
    settings: TileSettings,
    shape: AtlasShape,
    slots: [Slot; MAX_TILES],
    /// Each tile's view in the frame planned last, for the tiles that draw in it.
    frames: [Option<ViewFrame>; MAX_TILES],
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
            frames: [None; MAX_TILES],
            lit: Vec::new(),
            ranked: Vec::new(),
            uniform: TileUniform::default(),
            held: None,
            casters: Vec::new(),
            casters_known: false,
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

    /// The uniform block of the frame planned last.
    pub fn uniform(&self) -> &TileUniform {
        &self.uniform
    }

    /// Plans the tiles of the frame `input`, with `settings` and the shadow filter's square of
    /// `filter` texels, for a camera at `camera`, or for no camera: then no tile draws. Allocates
    /// only when more lights cast shadows, or the scene holds more objects, than in any frame
    /// before.
    pub fn plan(
        &mut self,
        input: &FrameInput<'_>,
        settings: TileSettings,
        filter: u32,
        camera: Option<&CellPosition>,
    ) {
        self.frames = [None; MAX_TILES];
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
        self.mark_moved_casters(input, shadows);
        self.uniform = TileUniform::default();
        let size = shape.size as f32;
        self.uniform.kernel = [size, 1.0 / size, filter as f32, 0.0];
        for k in 0..self.lit.len() {
            let lit = self.lit[k];
            let light = &shadows[lit.shadow as usize];
            let faces = faces_of(light);
            for face in 0..faces {
                let tile = (lit.first + face) as usize;
                let view = TileView::of(light, face, lit.position, shape.size);
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
                    faces as f32,
                ];
                let slot = &mut self.slots[tile];
                if slot.key != Some(key) || !slot.clean {
                    slot.key = Some(key);
                    slot.clean = false;
                    self.frames[tile] = Some(view.frame(*camera, light.layers));
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
        if pipelines_built < self.last_new_pipeline {
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
            .try_reserve(slots.saturating_sub(self.casters.len()))
    }

    /// Forgets what the GPU holds, after the thread that draws replaced the GPU: every tile draws
    /// again, and the uniform block uploads again.
    pub fn forget_gpu(&mut self) {
        self.slots.iter_mut().for_each(|slot| slot.clean = false);
        self.held = None;
        self.last_new_pipeline = 0;
    }

    /// The atlas's shape for the lights that cast shadows: a layer for each tile that they could
    /// fill, within the budget.
    fn shape_for(&self, shadows: &[LightShadow], settings: TileSettings) -> AtlasShape {
        let tiles: u32 = shadows
            .iter()
            .map(|light| match light.kind {
                kind::SPOT => 1,
                kind::POINT if settings.point_shadows => POINT_FACES as u32,
                _ => 0,
            })
            .sum();
        let layers = tiles.min(settings.tiles).min(MAX_TILES as u32);
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

    /// Marks the tiles of every light within reach of a caster that moved since the module last
    /// saw it, before or after the move, as tiles that must draw. Remembers every caster from
    /// scratch, and marks every tile, when it knows none yet or the upload list overflowed.
    fn mark_moved_casters(&mut self, input: &FrameInput<'_>, shadows: &[LightShadow]) {
        let scene = input.scene;
        let parity = input.parity();
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
            for (slot, caster) in self.casters[..slots].iter_mut().enumerate().skip(1) {
                *caster = caster_of(scene, parity, slot);
            }
            self.casters_known = true;
            self.slots.iter_mut().for_each(|slot| slot.clean = false);
            return;
        }
        for range in input.snapshot.uploads() {
            if range.target != SCENE_TARGET {
                continue;
            }
            for slot in range.start as usize..(range.start + range.count) as usize {
                if slot >= slots || scene.flags()[slot] & flags::CAST_SHADOWS == 0 {
                    continue;
                }
                let now = caster_of(scene, parity, slot);
                let before = std::mem::replace(&mut self.casters[slot], now);
                if before == now {
                    continue;
                }
                let layers = scene.layers()[slot];
                for lit in &self.lit {
                    let light = &shadows[lit.shadow as usize];
                    if light.layers & layers == 0 {
                        continue;
                    }
                    let reaches = |caster: &Caster| {
                        let offset = light.at.offset_to(caster.cell);
                        let [x, y, z, radius] = caster.sphere;
                        let gap = [offset[0] + x, offset[1] + y, offset[2] + z];
                        let reach = light.range + radius;
                        radius != HIDDEN_RADIUS
                            && gap[0] * gap[0] + gap[1] * gap[1] + gap[2] * gap[2] <= reach * reach
                    };
                    if reaches(&before) || reaches(&now) {
                        for face in 0..faces_of(light) {
                            self.slots[(lit.first + face) as usize].clean = false;
                        }
                    }
                }
            }
        }
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

/// A scene slot's world matrix, bounding sphere and cell in the frame of `parity`.
fn caster_of(scene: &SceneStorage, parity: usize, slot: usize) -> Caster {
    let world = scene.world(parity);
    Caster {
        matrix: *world.matrix(slot),
        sphere: world.sphere(slot),
        cell: scene.cell_position(slot as u32, parity).cell,
    }
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
}

impl TileView {
    /// The view of `face` of a light whose position relative to the camera is `position`, for
    /// tiles of `size` texels on each side. A spot light's one tile holds its cone with a texel to
    /// spare on each side, so the hardware filter never reads past the tile. A point light's tiles
    /// each hold a quarter turn with the same margin.
    pub fn of(light: &LightShadow, face: u32, position: [f32; 3], size: u32) -> Self {
        let (direction, half_tan) = if light.kind == kind::POINT {
            (FACE_DIRECTIONS[face as usize], 1.0)
        } else {
            (light.direction, light.angle.min(MAX_HALF_ANGLE).tan())
        };
        let margin = 1.0 - 2.0 / size.max(4) as f32;
        let half_tan = half_tan / margin;
        let [x, y, z] = view_axes(direction);
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
        }
    }

    /// The tile's view values for a camera at `camera`, culling the casters on `layers`.
    pub fn frame(&self, camera: CellPosition, layers: u32) -> ViewFrame {
        let [x, y, z] = self.position;
        ViewFrame::new(
            FrameUniform {
                view_proj: self.view_proj,
                camera_position: [x, y, z, 1.0],
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

    /// A position relative to the camera through a column-major matrix, after the divide by w.
    fn project(m: &Mat4, p: [f32; 3]) -> [f32; 3] {
        let w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
        std::array::from_fn(|row| {
            (m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row]) / w
        })
    }

    #[test]
    fn a_spot_tile_holds_the_cone_with_a_texel_to_spare() {
        let light = spot([0.0, -1.0, 0.0], 0.5);
        let at = [2.0, 5.0, -1.0];
        let view = TileView::of(&light, 0, at, 256);
        // A point on the cone's edge, 6 m along it, lands one texel inside the tile.
        let (sin, cos) = 0.5f32.sin_cos();
        let edge = [at[0] + 6.0 * sin, at[1] - 6.0 * cos, at[2]];
        let [x, y, depth] = project(&view.view_proj, edge);
        let largest = x.abs().max(y.abs());
        assert!((largest - (1.0 - 2.0 / 256.0)).abs() < 1e-4, "{x} {y}");
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
        let half_tan = 0.5f32.tan() / (1.0 - 2.0 / 256.0);
        assert!((view.texel_per_meter - 2.0 * half_tan / 256.0).abs() < 1e-7);
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
            let inside = 1.0 - 2.0 / 512.0;
            assert!((x.abs() - inside).abs() < 1e-4 && (y.abs() - inside).abs() < 1e-4);
        }
    }

    #[test]
    fn wide_cones_stop_at_the_steepest_tile_and_vertical_lights_have_axes() {
        let view = TileView::of(&spot([0.0, 1.0, 0.0], 1.5), 0, [0.0; 3], 1024);
        assert!(view.view_proj.iter().all(|v| v.is_finite()));
        let half_tan = MAX_HALF_ANGLE.tan() / (1.0 - 2.0 / 1024.0);
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
    fn the_uniform_is_the_size_the_shaders_read() {
        assert_eq!(
            TileUniform::default().as_bytes().len(),
            SHADOW_TILES_UNIFORM_BYTES as usize
        );
    }
}
