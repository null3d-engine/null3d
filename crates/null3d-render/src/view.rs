//! Views: the scene seen from one camera, culled on its own. A view has a frustum, which its
//! camera and lens give each frame, a layer mask, which selects the objects it draws, and a
//! target, which the pass that draws it declares in the render graph. Its lens is perspective or
//! orthographic. The first view is the camera's, and it draws the scene color and depth that reach
//! the canvas. Each further view draws into a color target of its own (see [`ViewTarget`]), which
//! the render graph keeps from frame to frame, and which materials can show. A mirror view draws
//! the camera's view mirrored across a plane (see [`crate::mirror`]), into a target of the render
//! size or a share of it. A view can draw in one frame of several, and keep its image between.
//! A further view runs only while some running pass reads its target: the camera's passes read
//! the target of each view that a texture shows, and a view reads the targets that it lists.
//!
//! A view can draw into a rectangle of the canvas instead, after the camera's view: it draws into
//! the camera's scene color and a depth target of its own, through the viewport and the scissor.
//! Such a view always runs, and its rectangle covers the camera's image there, as a split screen
//! or a picture in picture does.
//!
//! A view never draws an object whose material shows the target of a view that it does not read,
//! its own included, since a pass cannot sample a texture that it draws into.
//!
//! Each frame builder culls every view on its own. On WebGPU a view has its own culling dispatch,
//! compacted instances, indirect draws and bundle. On WebGL2 the job workers list each view's
//! visible objects in an index list of its own.
//!
//! Shaders work in positions relative to a view's camera. Each view has its own offsets from its
//! camera to the grid cells in use (see [`null3d_core::cells`]), and its frustum is relative to its
//! camera.

use null3d_core::cells::CellPosition;
use null3d_core::culling::Frustum;
use null3d_core::handle::Handle;
use null3d_core::scene::SceneStorage;

use null3d_core::layers::DEFAULT_LAYERS;

use crate::camera::{Affine, Lens, Mat4, ViewDepth};
use crate::effects::{EFFECT_FLOATS, EffectMaps};
use crate::frame_data::FrameUniform;
use crate::graph::{RenderScale, Size};
use crate::mirror::Mirror;
use crate::shadow_tiles::MAX_TILES;
use crate::shadows::MAX_CASCADES;

/// The most views a builder draws. Each view has a fixed range of GPU object ids.
pub const MAX_VIEWS: usize = 32;

/// The most views of every kind: the views of cameras, then the cascades of the directional
/// light's shadows, then the tiles of the point and spot lights' shadow atlas, which cull and draw
/// as views do, then the view of the outline effect's mask, then the view of the subsurface blur's
/// skin pass, the motion view, and the view of the tone mask.
pub const MAX_VIEW_IDS: usize = MAX_VIEWS + MAX_CASCADES + MAX_TILES + 4;

/// The first id of the shadow atlas's tiles.
const FIRST_TILE: usize = MAX_VIEWS + MAX_CASCADES;

/// A view, by its place in the scene settings' list of views.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ViewId(u16);

impl ViewId {
    /// The camera's view, which draws what the canvas shows.
    pub const CAMERA: ViewId = ViewId(0);

    /// The view of the outline effect's mask: the camera's view, which culls and draws only the
    /// outlined objects, after every other view.
    pub const OUTLINE: ViewId = ViewId((FIRST_TILE + MAX_TILES) as u16);

    /// The view of the subsurface blur's skin pass: the camera's view, which culls and draws only
    /// the objects whose material has a scatter radius, after the outline's view.
    pub const SUBSURFACE: ViewId = ViewId((FIRST_TILE + MAX_TILES + 1) as u16);

    /// The motion view: the camera's view, which culls and draws only the objects that move, into
    /// the motion target (see [`crate::motion`]).
    pub const MOTION: ViewId = ViewId((FIRST_TILE + MAX_TILES + 2) as u16);

    /// The view of the tone mask: the camera's view, which culls and draws only the objects whose
    /// material keeps its color as the display shows it, into the blue channel of the outline
    /// mask, after the motion view.
    pub const TONE: ViewId = ViewId((FIRST_TILE + MAX_TILES + 3) as u16);

    /// The view's place in the list, from 0.
    pub const fn index(self) -> usize {
        self.0 as usize
    }

    pub(crate) const fn from_index(index: usize) -> Self {
        Self(index as u16)
    }

    /// The view of a camera at `place` in the list of views, from 0 for the camera's view.
    pub const fn from_place(place: usize) -> Self {
        Self(if place < MAX_VIEWS { place } else { 0 } as u16)
    }

    /// The view of a shadow cascade, from 0 for the nearest, after every view of a camera.
    pub const fn cascade(cascade: usize) -> Self {
        Self((MAX_VIEWS + cascade) as u16)
    }

    /// The cascade of a shadow cascade's view, or `None` for another view.
    pub const fn cascade_index(self) -> Option<usize> {
        let index = self.0 as usize;
        if index >= MAX_VIEWS && index < FIRST_TILE {
            Some(index - MAX_VIEWS)
        } else {
            None
        }
    }

    /// The view of a tile of the shadow atlas, from 0, after every cascade.
    pub const fn tile(tile: usize) -> Self {
        Self((FIRST_TILE + tile) as u16)
    }

    /// The tile of a shadow atlas tile's view, or `None` for another view.
    pub const fn tile_index(self) -> Option<usize> {
        let index = self.0 as usize;
        if index >= FIRST_TILE && index < FIRST_TILE + MAX_TILES {
            Some(index - FIRST_TILE)
        } else {
            None
        }
    }

    /// True for the view of a camera, false for a view of a light's shadows.
    pub const fn is_camera(self) -> bool {
        (self.0 as usize) < MAX_VIEWS
    }
}

/// The target of a view other than the camera's, and how it draws.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ViewTarget {
    /// Its width and height in texels, or `None` for the render size halved `halvings` times.
    pub size: Option<(u32, u32)>,
    /// How many times a target without a size of its own halves the render size each way.
    pub halvings: u8,
    /// True when a target without a size of its own is made at the render size, halved, and made
    /// again when the render scale changes, so the view fills it whole and a material samples it
    /// from 0 to 1 across.
    pub whole: bool,
    /// The color it clears to before the view draws, as exposed linear color with alpha, or
    /// `None` for the color that the camera's target clears to.
    pub clear: Option<[f32; 4]>,
    /// False while the view is switched off: its target keeps the last image it drew.
    pub enabled: bool,
    /// The view draws in one frame of every `every`, from the first, and keeps its image between.
    pub every: u32,
    /// The frames left after this one before the view draws again.
    pub wait: u32,
    /// True when the view's turn comes in this frame.
    pub due: bool,
    /// The size of its texture when it last moved its turns on: a texture of a new size holds no
    /// image, so the view draws into it at once.
    pub made: (u32, u32),
    /// True while a texture shows the target, so the camera's passes read it.
    pub shown: bool,
    /// The views whose targets this view reads, as a mask of view places: the objects it draws
    /// may show them.
    pub reads: u32,
    /// The rectangle of the canvas that the view draws into, in place of a target of its own: it
    /// draws into the camera's scene color there, with a depth target of its own.
    pub rect: Option<CanvasRect>,
}

impl Default for ViewTarget {
    /// A target of the canvas's size that clears as the camera's does, switched on, that no
    /// texture shows yet.
    fn default() -> Self {
        Self {
            size: None,
            halvings: 0,
            whole: false,
            clear: None,
            enabled: true,
            every: 1,
            wait: 0,
            due: true,
            made: (0, 0),
            shown: false,
            reads: 0,
            rect: None,
        }
    }
}

/// The rectangle of the canvas that a view draws into, as fractions of the canvas's width and
/// height from its top-left corner: `x` and `y` place it, and `width` and `height` size it. A
/// rectangle covers part of the canvas, so `x + width` and `y + height` are at most 1, and each
/// of `width` and `height` is above 0.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CanvasRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl CanvasRect {
    /// The rectangle in texels of a canvas of `canvas` pixels: its place from the top-left
    /// corner, then its size. Each side is rounded to a whole texel, and the rectangle lies
    /// inside the canvas and covers at least one texel each way.
    pub fn area(self, canvas: (u32, u32), scale: RenderScale) -> (u32, u32, u32, u32) {
        let width = scale.of(canvas.0.max(1));
        let height = scale.of(canvas.1.max(1));
        let texels =
            |fraction: f32, side: u32| (fraction.clamp(0.0, 1.0) * side as f32).round() as u32;
        let x = texels(self.x, width).min(width - 1);
        let y = texels(self.y, height).min(height - 1);
        let x_end = texels(self.x + self.width, width).max(x + 1).min(width);
        let y_end = texels(self.y + self.height, height).max(y + 1).min(height);
        (x, y, x_end - x, y_end - y)
    }
}

impl ViewTarget {
    /// True when the view draws in this frame: it is switched on, and its turn has come.
    pub fn draws(&self) -> bool {
        self.enabled && self.due
    }

    /// Moves the view's turns on to the next frame, in which its texture has the size `made`: a
    /// view that draws once in `every` frames draws in the first, then waits `every - 1` frames
    /// after each frame that it draws. A texture of a new size starts its turns again.
    pub(crate) fn pace(&mut self, made: (u32, u32)) {
        let remade = made != self.made;
        self.made = made;
        self.due = remade || self.wait == 0;
        self.wait = if self.due {
            self.every.max(1) - 1
        } else {
            self.wait - 1
        };
    }

    /// The size of the render graph's target: its own size, or the render size halved, which a
    /// target that the view fills whole takes as its texture's size. A view that draws into a
    /// rectangle of the canvas writes the camera's scene color and its own depth, which take the
    /// render size.
    pub fn graph_size(&self) -> Size {
        if self.rect.is_some() {
            return Size::Full;
        }
        match (self.size, self.halvings) {
            (Some((width, height)), _) => Size::Fixed { width, height },
            (None, halvings) if self.whole => Size::Scaled(halvings),
            (None, 0) => Size::Full,
            (None, halvings) => Size::Halved(halvings),
        }
    }
}

/// The names that a view other than the camera's gives the render graph: its pass, its target,
/// and the targets of other views that it reads. A view without names takes the engine's own,
/// which end in its place in the list of views.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ViewNames {
    pub pass: String,
    pub target: String,
    pub reads: Vec<String>,
}

/// What a view draws from: a camera object with its lens, the layers of the objects it draws
/// (see [`null3d_core::layers`]), and the target it draws into, for a view other than the
/// camera's.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct View {
    camera: Option<(Handle, Lens)>,
    layers: u32,
    target: ViewTarget,
    removed: bool,
    /// What a mirror view mirrors, or `None` for a view of its own camera.
    mirror: Option<Mirroring>,
    /// The face of a reflection probe's cube that a capture view draws, from 0, or `None` for
    /// another view.
    probe_face: Option<u8>,
    /// What a full-screen pass draws, or `None` for a view of a scene.
    fullscreen: Option<Fullscreen>,
    /// What a compute pass runs, or `None` for another view.
    compute: Option<Compute>,
}

/// What a compute pass runs in place of a scene: the sketch's WGSL, as a compute pipeline, which
/// fills its whole target as a storage texture. Materials, effects and other passes sample that
/// target in the same frame, and the render graph orders the pass before them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Compute {
    /// The compute pipeline template of the WGSL.
    pub template: u32,
    /// The invocations along each axis of a workgroup, as the shader declares them.
    pub workgroup: [u32; 3],
    /// The workgroup counts along each axis, or `None` to cover the target: its size divided by
    /// the workgroup size, rounding up.
    pub dispatch: Option<[u32; 3]>,
    /// The format of the storage texture that the pass writes, or 0 for a pass that writes the
    /// two buffers of an instance draw.
    pub format: u32,
    /// True when the pass records after the camera's passes: it reads the scene color, which
    /// orders it there.
    pub after_scene: bool,
    /// Its uniforms.
    pub values: [f32; EFFECT_FLOATS],
    /// The textures that it samples.
    pub maps: EffectMaps,
    /// The instance draw's two buffers that the pass writes, or `None` for a storage texture.
    pub buffers: Option<ComputeBuffers>,
}

/// The two buffers of an instance draw that a compute pass writes: the draw's count word and its
/// per-instance rows, which the draw reads in the same frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ComputeBuffers {
    /// The buffer of the draw's count word, one 32-bit word.
    pub counts: u32,
    /// The buffer of the draw's per-instance rows.
    pub instances: u32,
    /// The instance buffer's size in bytes.
    pub instances_bytes: u32,
}

impl Compute {
    /// The workgroup counts that fill a target of `size` texels: the explicit counts, or the size
    /// divided by the workgroup size, rounding up, once along z.
    pub fn workgroups(&self, size: (u32, u32)) -> [u32; 3] {
        match self.dispatch {
            Some(counts) => counts,
            None => [
                size.0.div_ceil(self.workgroup[0].max(1)),
                size.1.div_ceil(self.workgroup[1].max(1)),
                1,
            ],
        }
    }
}

/// What a full-screen pass draws in place of a scene: the sketch's WGSL, built as a custom
/// effect's, over its whole target. It reads an image of the camera's view as its input, the
/// scene's depth, and textures of its own.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Fullscreen {
    /// The render pipeline template of the WGSL.
    pub template: u32,
    /// The image of the camera's view that it reads as its input.
    pub source: PassSource,
    /// True when the WGSL reads the scene's depth.
    pub depth: bool,
    /// Its uniforms, where the shader build placed each, and its textures' layers in the last
    /// floats.
    pub values: [f32; EFFECT_FLOATS],
    /// The textures that it samples.
    pub maps: EffectMaps,
}

impl Fullscreen {
    /// True when it reads what the camera's view draws: then it runs after the camera's passes,
    /// which do not read its target in the same frame.
    pub fn reads_scene(&self) -> bool {
        self.source != PassSource::None || self.depth
    }
}

/// The image of the camera's view that a full-screen pass reads as its input.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum PassSource {
    /// None: the input reads a blank texel.
    #[default]
    None,
    /// The scene color as the camera's passes leave it, before the custom effects and bloom.
    SceneColor,
    /// The outline mask, or a blank texel while no outline draws.
    OutlineMask,
}

/// A mirror view's plane, and where its size and layers come from.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Mirroring {
    plane: Mirror,
    /// Its own halvings of the render size, or `None` to take the quality preset's.
    halvings: Option<u8>,
    /// True when it draws the camera's layers rather than its own.
    follows_layers: bool,
}

impl Default for View {
    /// A view with no camera yet, of the objects on the default layer, as a new camera draws.
    fn default() -> Self {
        Self {
            camera: None,
            layers: DEFAULT_LAYERS,
            target: ViewTarget::default(),
            removed: false,
            mirror: None,
            probe_face: None,
            fullscreen: None,
            compute: None,
        }
    }
}

impl View {
    /// A view from `camera` through `lens`, of the objects on `layers`.
    pub fn new(camera: Handle, lens: impl Into<Lens>, layers: u32) -> Self {
        Self {
            camera: Some((camera, lens.into())),
            layers,
            ..Self::default()
        }
    }

    /// The same view, drawing into `target`.
    pub fn with_target(self, target: ViewTarget) -> Self {
        Self { target, ..self }
    }

    /// A view that draws the camera's view mirrored across `mirror`'s plane, into a target of the
    /// render size halved `halvings` times, or as many times as the quality preset says with
    /// `None`. It draws the objects on `layers`, or on the camera's layers with `None`.
    pub fn mirror(mirror: Mirror, halvings: Option<u8>, layers: Option<u32>) -> Self {
        Self {
            layers: layers.unwrap_or(DEFAULT_LAYERS),
            mirror: Some(Mirroring {
                plane: mirror,
                halvings,
                follows_layers: layers.is_none(),
            }),
            ..Self::default()
        }
    }

    /// A capture view of reflection probes (see [`crate::probes`]): it draws face `face` of the
    /// cube around the capturing probe's capture point into a square target of `size` texels,
    /// background included. It stays switched off while no probe captures, and the render graph
    /// keeps it, so switching it on makes no new plan.
    pub fn probe_face(face: u8, size: u32) -> Self {
        Self {
            probe_face: Some(face),
            target: ViewTarget {
                size: Some((size, size)),
                enabled: false,
                shown: true,
                ..ViewTarget::default()
            },
            ..Self::default()
        }
    }

    /// A view that draws the scene into `rect`, a rectangle of the canvas, on top of the
    /// camera's image, into the camera's scene color and a depth target of its own.
    pub fn canvas(rect: CanvasRect) -> Self {
        Self {
            target: ViewTarget {
                rect: Some(rect),
                ..ViewTarget::default()
            },
            ..Self::default()
        }
    }

    /// The rectangle of the canvas that the view draws into, or `None` for a view that draws
    /// into a target of its own.
    pub fn canvas_rect(&self) -> Option<CanvasRect> {
        self.target.rect
    }

    /// Sets the rectangle of the canvas that the view draws into, from the next frame on.
    pub fn set_canvas_rect(&mut self, rect: CanvasRect) {
        self.target.rect = Some(rect);
    }

    /// A full-screen pass, which draws `fullscreen` over the whole of `target`: of its own size, or
    /// of the render size halved as many times as it says.
    pub fn fullscreen(fullscreen: Fullscreen, target: ViewTarget) -> Self {
        Self {
            fullscreen: Some(fullscreen),
            target: ViewTarget {
                whole: true,
                ..target
            },
            ..Self::default()
        }
    }

    /// A compute pass, which fills the whole of `target` as a storage texture: of its own size, or
    /// of the render size halved as many times as it says.
    pub fn compute(compute: Compute, target: ViewTarget) -> Self {
        Self {
            compute: Some(compute),
            target: ViewTarget {
                whole: true,
                ..target
            },
            ..Self::default()
        }
    }

    /// The face that a capture view of reflection probes draws, or `None` for another view.
    pub fn captured_face(&self) -> Option<u8> {
        self.probe_face
    }

    /// What a full-screen pass draws, or `None` for a view of a scene.
    pub fn fullscreen_pass(&self) -> Option<&Fullscreen> {
        self.fullscreen.as_ref()
    }

    pub(crate) fn fullscreen_pass_mut(&mut self) -> Option<&mut Fullscreen> {
        self.fullscreen.as_mut()
    }

    /// What a compute pass runs, or `None` for another view.
    pub fn compute_pass(&self) -> Option<&Compute> {
        self.compute.as_ref()
    }

    pub(crate) fn compute_pass_mut(&mut self) -> Option<&mut Compute> {
        self.compute.as_mut()
    }

    /// The plane that a mirror view mirrors the camera's view across, or `None` for another view.
    pub fn mirrored(&self) -> Option<&Mirror> {
        self.mirror.as_ref().map(|mirroring| &mirroring.plane)
    }

    /// Takes a mirror view's size and layers for the frame: the preset's halvings `halvings`
    /// unless it has its own, and the camera's layers `camera_layers` unless it has its own. It
    /// fills its target whole at any render scale, so a material reads it at the place where its
    /// surface shows on the screen.
    pub(crate) fn follow_camera(&mut self, halvings: u8, camera_layers: u32) {
        let Some(mirroring) = self.mirror else {
            return;
        };
        self.target.whole = true;
        self.target.halvings = mirroring.halvings.unwrap_or(halvings);
        if mirroring.follows_layers {
            self.layers = camera_layers;
        }
    }

    /// The view's target, which only views other than the camera's draw into.
    pub fn target(&self) -> &ViewTarget {
        &self.target
    }

    pub(crate) fn target_mut(&mut self) -> &mut ViewTarget {
        &mut self.target
    }

    /// True for the place of a view that was removed, which the next view added takes. It draws
    /// nothing.
    pub fn is_removed(&self) -> bool {
        self.removed
    }

    /// The size the view draws at in texels, for a canvas of `canvas` pixels at render scale
    /// `scale`: the rectangle of the canvas that it draws into at that scale, its target's own
    /// size, or the render size or a share of it.
    pub fn draw_size(&self, canvas: (u32, u32), scale: RenderScale) -> (u32, u32) {
        if let Some(rect) = self.target.rect {
            let (_, _, width, height) = rect.area(canvas, scale);
            return (width, height);
        }
        match self.target.size {
            Some(size) => size,
            None => self.target.graph_size().viewport(canvas, scale),
        }
    }

    /// The camera object and its lens, or `None` before one is set.
    pub fn camera(&self) -> Option<(Handle, Lens)> {
        self.camera
    }

    pub(crate) fn set_camera(&mut self, camera: Handle, lens: Lens) {
        self.camera = Some((camera, lens));
    }

    /// The layer mask: the view draws an object whose mask shares a bit with it.
    pub fn layers(&self) -> u32 {
        self.layers
    }

    pub(crate) fn set_layers(&mut self, mask: u32) {
        self.layers = mask;
    }

    /// The place of a removed view, which draws nothing until a new view takes it.
    pub(crate) fn removed() -> Self {
        Self {
            camera: None,
            removed: true,
            ..Self::default()
        }
    }

    /// Where the view's camera stands and how it sees, for a target of `aspect`. `None` when the
    /// view has no camera, or its camera object is gone.
    pub(crate) fn transform(
        &self,
        scene: &SceneStorage,
        parity: usize,
        aspect: f32,
    ) -> Option<CameraTransform> {
        let (camera, lens) = self.camera?;
        let slot = scene.resolve(camera).ok()?;
        let world: Affine = *scene.world(parity).matrix(slot as usize);
        Some(CameraTransform {
            view_proj: lens.relative_view_projection(&world, aspect),
            view: lens.relative_view(&world),
            projection: lens.projection(aspect),
            eye: lens.eye(&world),
            cell: scene.cell_position(slot, parity),
            depth: lens.depth(&world),
        })
    }
}

/// A view's camera in one frame, as [`View::transform`] gives it.
pub(crate) struct CameraTransform {
    /// The view-projection matrix for positions relative to the camera.
    pub view_proj: Mat4,
    /// The view matrix for those positions, and the projection: `view_proj` is their product.
    pub view: Mat4,
    pub projection: Mat4,
    /// The camera's place for those positions, as [`Lens::eye`] gives it.
    pub eye: [f32; 4],
    /// The camera's cell, and its position in the cell.
    pub cell: CellPosition,
    /// How far positions relative to the camera lie along the view.
    pub depth: ViewDepth,
}

/// A view's values for one frame: the uniform block its passes read, the frustum its culling
/// tests against, both relative to its camera, where its camera is, how far positions lie along
/// its view, and the layers it draws.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ViewFrame {
    pub uniform: FrameUniform,
    pub frustum: Frustum,
    /// The camera's cell, and its position relative to the cell's center.
    pub camera: CellPosition,
    /// How far positions relative to the camera lie along the view.
    pub depth: ViewDepth,
    /// The view's layer mask.
    pub layers: u32,
}

impl ViewFrame {
    pub(crate) fn new(
        uniform: FrameUniform,
        camera: CellPosition,
        depth: ViewDepth,
        layers: u32,
    ) -> Self {
        Self {
            frustum: Frustum::from_view_projection(&uniform.view_proj),
            uniform,
            camera,
            depth,
            layers,
        }
    }

    /// Gives the view's uniform block the offset that its shadow lookups add: from `main`, the
    /// camera of the camera's view, whose positions the shadow maps' matrices take, to this view's
    /// camera. The offset to the camera's cell is computed in 64-bit floats.
    pub(crate) fn set_shadow_origin(&mut self, main: &CellPosition) {
        let to_cell = main.offset_to(self.camera.cell);
        let [x, y, z] = std::array::from_fn(|k| to_cell[k] + self.camera.local[k]);
        self.uniform.shadow_origin = [x, y, z, 0.0];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_view_that_draws_once_in_three_frames_draws_first_then_waits_two_frames() {
        let mut target = ViewTarget {
            every: 3,
            ..ViewTarget::default()
        };
        let mut drawn = Vec::new();
        for _ in 0..7 {
            target.pace((64, 32));
            drawn.push(target.draws());
        }
        assert_eq!(drawn, [true, false, false, true, false, false, true]);
        // A texture of a new size, such as at a new render scale, holds no image.
        target.pace((32, 16));
        assert!(
            target.draws(),
            "a view draws into a texture of a new size at once"
        );
        target.pace((32, 16));
        assert!(!target.draws(), "then it waits its turn again");
        let mut every_frame = ViewTarget::default();
        for _ in 0..3 {
            every_frame.pace((64, 32));
            assert!(
                every_frame.draws(),
                "a view draws in every frame by default"
            );
        }
        every_frame.enabled = false;
        assert!(
            !every_frame.draws(),
            "a view switched off draws in no frame"
        );
    }

    #[test]
    fn a_target_takes_its_own_size_or_the_render_size_halved() {
        let fixed = ViewTarget {
            size: Some((64, 32)),
            halvings: 2,
            ..ViewTarget::default()
        };
        assert_eq!(
            fixed.graph_size(),
            Size::Fixed {
                width: 64,
                height: 32
            }
        );
        let full = ViewTarget::default();
        assert_eq!(full.graph_size(), Size::Full);
        let half = ViewTarget {
            halvings: 1,
            ..ViewTarget::default()
        };
        assert_eq!(half.graph_size(), Size::HALF);
        let view = View::default().with_target(half);
        let canvas = (1001, 600);
        assert_eq!(view.draw_size(canvas, RenderScale::FULL), (501, 300));
    }

    #[test]
    fn a_canvas_view_draws_at_a_rectangle_of_the_canvas_at_the_render_size() {
        let rect = CanvasRect {
            x: 0.5,
            y: 0.0,
            width: 0.5,
            height: 1.0,
        };
        let view = View::canvas(rect);
        assert_eq!(view.canvas_rect(), Some(rect));
        assert_eq!(
            view.target().graph_size(),
            Size::Full,
            "the view writes the camera's scene color and a depth at the render size"
        );
        assert_eq!(view.draw_size((1001, 600), RenderScale::FULL), (500, 600));
        let canvas = (1001, 600);
        assert_eq!(
            rect.area(canvas, RenderScale::FULL),
            (501, 0, 500, 600),
            "the rectangle reaches the canvas's right edge"
        );
        assert_eq!(
            rect.area(canvas, RenderScale::from_thousandths(500)),
            (251, 0, 250, 300),
            "the area follows the render scale"
        );
        assert_eq!(
            view.draw_size(canvas, RenderScale::from_thousandths(500)),
            (250, 300),
            "the view draws at the rectangle's size at the render scale"
        );
        // A rectangle at the far edge still covers a texel and stays inside the canvas.
        let edge = CanvasRect {
            x: 1.0,
            y: 1.0,
            width: 0.0,
            height: 0.0,
        };
        assert_eq!(edge.area(canvas, RenderScale::FULL), (1000, 599, 1, 1));
    }

    #[test]
    fn a_mirror_view_takes_the_presets_size_and_the_cameras_layers_unless_it_has_its_own() {
        let mirror = Mirror::new([0.0, 1.0, 0.0], [0.0; 3]).unwrap();
        let mut follows = View::mirror(mirror, None, None);
        follows.follow_camera(2, 0b101);
        assert_eq!(follows.target().halvings, 2);
        assert_eq!(follows.target().graph_size(), Size::Scaled(2));
        assert_eq!(follows.layers(), 0b101);
        assert_eq!(follows.mirrored(), Some(&mirror));
        let mut own = View::mirror(mirror, Some(0), Some(0b10));
        own.follow_camera(2, 0b101);
        assert_eq!(own.target().halvings, 0);
        assert_eq!(own.layers(), 0b10);
        let mut plain = View::default();
        plain.follow_camera(2, 0b101);
        assert_eq!(
            plain.target().halvings,
            0,
            "a view that mirrors nothing keeps its size"
        );
        assert_eq!(plain.layers(), DEFAULT_LAYERS);
    }

    #[test]
    fn a_compute_pass_covers_its_target_or_dispatches_the_counts_it_gives() {
        let mut pass = Compute {
            template: 0,
            workgroup: [8, 4, 1],
            dispatch: None,
            format: 0,
            after_scene: false,
            values: [0.0; EFFECT_FLOATS],
            maps: EffectMaps::NONE,
            buffers: None,
        };
        // The counts round up, so the last workgroup of a row or column writes past the target's
        // edge, which the shader tests against its own size.
        assert_eq!(pass.workgroups((64, 48)), [8, 12, 1]);
        assert_eq!(pass.workgroups((65, 1)), [9, 1, 1]);
        pass.dispatch = Some([2, 3, 1]);
        assert_eq!(pass.workgroups((64, 48)), [2, 3, 1]);
    }
}
