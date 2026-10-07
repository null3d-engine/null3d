//! Views: the scene seen from one camera, culled on its own. A view has a frustum, which its
//! camera and lens give each frame, a layer mask, which selects the objects it draws, and a
//! target, which the pass that draws it declares in the render graph. Its lens is perspective or
//! orthographic. The first view is the camera's, and it draws the scene color and depth that reach
//! the canvas. Each further view draws color and depth targets of its own.
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

/// What a view draws from: a camera object with its lens, and the layers of the objects it
/// draws (see [`null3d_core::layers`]).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct View {
    camera: Option<(Handle, Lens)>,
    layers: u32,
}

impl Default for View {
    /// A view with no camera yet, of the objects on the default layer, as a new camera draws.
    fn default() -> Self {
        Self {
            camera: None,
            layers: DEFAULT_LAYERS,
        }
    }
}

impl View {
    /// A view from `camera` through `lens`, of the objects on `layers`.
    pub fn new(camera: Handle, lens: impl Into<Lens>, layers: u32) -> Self {
        Self {
            camera: Some((camera, lens.into())),
            layers,
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
}
