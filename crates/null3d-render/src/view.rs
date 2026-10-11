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
use crate::frame_data::FrameUniform;
use crate::graph::{RenderScale, Size};
use crate::mirror::Mirror;
use crate::shadow_tiles::MAX_TILES;
use crate::shadows::MAX_CASCADES;

/// The most views a builder draws. Each view has a fixed range of GPU object ids.
pub const MAX_VIEWS: usize = 32;

/// The most views of every kind: the views of cameras, then the cascades of the directional
/// light's shadows, then the tiles of the point and spot lights' shadow atlas, which cull and draw
/// as views do, then the view of the outline effect's mask.
pub const MAX_VIEW_IDS: usize = MAX_VIEWS + MAX_CASCADES + MAX_TILES + 1;

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
    /// True while a texture shows the target, so the camera's passes read it.
    pub shown: bool,
    /// The views whose targets this view reads, as a mask of view places: the objects it draws
    /// may show them.
    pub reads: u32,
}

impl Default for ViewTarget {
    /// A target of the canvas's size that clears as the camera's does, switched on, that no
    /// texture shows yet.
    fn default() -> Self {
        Self {
            size: None,
            halvings: 0,
            clear: None,
            enabled: true,
            every: 1,
            wait: 0,
            due: true,
            shown: false,
            reads: 0,
        }
    }
}

impl ViewTarget {
    /// True when the view draws in this frame: it is switched on, and its turn has come.
    pub fn draws(&self) -> bool {
        self.enabled && self.due
    }

    /// Moves the view's turns on to the next frame: a view that draws once in `every` frames
    /// draws in the first, then waits `every - 1` frames after each frame that it draws.
    pub(crate) fn pace(&mut self) {
        self.due = self.wait == 0;
        self.wait = if self.due {
            self.every.max(1) - 1
        } else {
            self.wait - 1
        };
    }

    /// The size of the render graph's target: its own size, or the render size halved.
    pub fn graph_size(&self) -> Size {
        match (self.size, self.halvings) {
            (Some((width, height)), _) => Size::Fixed { width, height },
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

    /// The plane that a mirror view mirrors the camera's view across, or `None` for another view.
    pub fn mirrored(&self) -> Option<&Mirror> {
        self.mirror.as_ref().map(|mirroring| &mirroring.plane)
    }

    /// Takes a mirror view's size and layers for the frame: the preset's halvings `halvings`
    /// unless it has its own, and the camera's layers `camera_layers` unless it has its own.
    pub(crate) fn follow_camera(&mut self, halvings: u8, camera_layers: u32) {
        let Some(mirroring) = self.mirror else {
            return;
        };
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
    /// `scale`: its target's own size, or the render size or a share of it.
    pub fn draw_size(&self, canvas: (u32, u32), scale: RenderScale) -> (u32, u32) {
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
            target.pace();
            drawn.push(target.draws());
        }
        assert_eq!(drawn, [true, false, false, true, false, false, true]);
        let mut every_frame = ViewTarget::default();
        for _ in 0..3 {
            every_frame.pace();
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
    fn a_mirror_view_takes_the_presets_size_and_the_cameras_layers_unless_it_has_its_own() {
        let mirror = Mirror::new([0.0, 1.0, 0.0], [0.0; 3]).unwrap();
        let mut follows = View::mirror(mirror, None, None);
        follows.follow_camera(2, 0b101);
        assert_eq!(follows.target().halvings, 2);
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
}
