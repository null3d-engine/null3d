//! Views: the scene seen from one camera, culled on its own. A view has a frustum, which its
//! camera and lens give each frame, a layer mask, which selects the objects it draws, and a
//! target, which the pass that draws it declares in the render graph. The first view is the
//! camera's, and it draws the scene color and depth that reach the canvas. Each further view
//! draws color and depth targets of its own.
//!
//! Each frame builder culls every view on its own. On WebGPU a view has its own culling dispatch,
//! compacted instances, indirect draws and bundle. On WebGL2 the job workers list each view's
//! visible objects in an index list of its own.

use null3d_core::culling::Frustum;
use null3d_core::handle::Handle;
use null3d_core::scene::SceneStorage;

use crate::camera::{Affine, Perspective};
use crate::frame_data::FrameUniform;
use crate::graph::ALL_LAYERS;

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
/// draws.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct View {
    camera: Option<(Handle, Perspective)>,
    layers: u32,
}

impl Default for View {
    fn default() -> Self {
        Self {
            camera: None,
            layers: ALL_LAYERS,
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

    /// The view-projection matrix and the camera's world position for a target of `aspect`, or
    /// `None` when the view has no camera, or its camera object is gone.
    pub(crate) fn transform(
        &self,
        scene: &SceneStorage,
        parity: usize,
        aspect: f32,
    ) -> Option<([f32; 16], [f32; 4])> {
        let (camera, lens) = self.camera?;
        let slot = scene.resolve(camera).ok()?;
        let world: Affine = *scene.world(parity).matrix(slot as usize);
        Some((
            lens.view_projection(&world, aspect),
            [world[3], world[7], world[11], 1.0],
        ))
    }
}

/// A view's values for one frame: the uniform block its passes read, and the frustum its
/// culling tests against.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ViewFrame {
    pub uniform: FrameUniform,
    pub frustum: Frustum,
}

impl ViewFrame {
    pub(crate) fn new(uniform: FrameUniform) -> Self {
        Self {
            frustum: Frustum::from_view_projection(&uniform.view_proj),
            uniform,
        }
    }
}
