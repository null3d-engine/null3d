//! Views: the scene seen from one camera, culled on its own. A view has a frustum, which its
//! camera and lens give each frame, a layer mask, which selects the objects it draws, and a
//! target, which the pass that draws it declares in the render graph. The first view is the
//! camera's, and it draws the scene color and depth that reach the canvas. Each further view
//! draws color and depth targets of its own.
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

use crate::camera::{Affine, Perspective};
use crate::frame_data::FrameUniform;

/// The most views a builder draws. Each view has a fixed range of GPU object ids.
pub const MAX_VIEWS: usize = 32;

/// A view, by its place in the scene settings' list of views.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ViewId(u16);

impl ViewId {
    /// The camera's view, which draws what the canvas shows.
    pub const CAMERA: ViewId = ViewId(0);

    /// The view's place in the list, from 0.
    pub const fn index(self) -> usize {
        self.0 as usize
    }

    pub(crate) const fn from_index(index: usize) -> Self {
        Self(index as u16)
    }
}

/// What a view draws from: a camera object with its lens, and the layers of the objects it
/// draws (see [`null3d_core::layers`]).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct View {
    camera: Option<(Handle, Perspective)>,
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
    pub fn new(camera: Handle, lens: Perspective, layers: u32) -> Self {
        Self {
            camera: Some((camera, lens)),
            layers,
        }
    }

    /// The camera object and its lens, or `None` before one is set.
    pub fn camera(&self) -> Option<(Handle, Perspective)> {
        self.camera
    }

    pub(crate) fn set_camera(&mut self, camera: Handle, lens: Perspective) {
        self.camera = Some((camera, lens));
    }

    /// The layer mask: the view draws an object whose mask shares a bit with it.
    pub fn layers(&self) -> u32 {
        self.layers
    }

    pub(crate) fn set_layers(&mut self, mask: u32) {
        self.layers = mask;
    }

    /// The view-projection matrix for positions relative to the camera, for a target of `aspect`,
    /// and the camera's cell and position in it, or `None` when the view has no camera, or its
    /// camera object is gone.
    pub(crate) fn transform(
        &self,
        scene: &SceneStorage,
        parity: usize,
        aspect: f32,
    ) -> Option<([f32; 16], CellPosition)> {
        let (camera, lens) = self.camera?;
        let slot = scene.resolve(camera).ok()?;
        let world: Affine = *scene.world(parity).matrix(slot as usize);
        Some((
            lens.relative_view_projection(&world, aspect),
            scene.cell_position(slot, parity),
        ))
    }
}

/// A view's values for one frame: the uniform block its passes read, the frustum its culling
/// tests against, both relative to its camera, where its camera is, and the layers it draws.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ViewFrame {
    pub uniform: FrameUniform,
    pub frustum: Frustum,
    /// The camera's cell, and its position relative to the cell's center.
    pub camera: CellPosition,
    /// The view's layer mask.
    pub layers: u32,
}

impl ViewFrame {
    pub(crate) fn new(uniform: FrameUniform, camera: CellPosition, layers: u32) -> Self {
        Self {
            frustum: Frustum::from_view_projection(&uniform.view_proj),
            uniform,
            camera,
            layers,
        }
    }
}
