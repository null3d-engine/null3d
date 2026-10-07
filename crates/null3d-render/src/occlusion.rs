//! The camera's blockers for software occlusion culling on the WebGL2 path (see
//! [`null3d_core::occlusion`]).
//!
//! Each frame picks the scene objects that block the view: those with the occluder flag that are
//! shown, on the view's layers, inside its frustum and not too small to matter, whose mesh holds
//! few enough triangles, and whose material draws a solid surface. A material that blends, cuts
//! holes with an alpha mask, skips the depth buffer, or runs custom shader code may leave gaps or
//! move vertices, so its objects never block. Neither do skinned objects, whose drawn shape is not
//! their mesh's. The picked objects draw nearest first, up to a budget of triangles, and the
//! camera's culling then hides each source whose bounding sphere lies behind them.
//!
//! A mesh's blocker, its welded corners and its edges, is built the first time an object with
//! that mesh blocks the view, and kept, as meshes never change. A mesh from a model file can come
//! with a simplified blocker of its own, which the asset tool made and checked to lie inside the
//! mesh; objects with that mesh draw it instead.

use std::collections::TryReserveError;

use null3d_core::clusters::sort_pairs;
use null3d_core::occlusion::{Blocker, BlockerMesh, OcclusionBuffer, clip_matrix};
use null3d_core::scene::flags;

use crate::frame::FrameInput;
use crate::materials::{MaterialTable, Shading, feature};
use crate::meshes::MeshStorage;
use crate::view::ViewFrame;

/// The most blocker triangles that one frame draws. Blockers past it, the farthest, do not draw.
pub const MAX_FRAME_TRIANGLES: u32 = 16_384;
/// The smallest radius on the screen, in the buffer's pixels, of a blocker that draws.
const MIN_BLOCKER_PIXELS: f32 = 2.0;
/// A mesh whose blocker was not built yet.
const UNBUILT: u32 = 0;
/// A mesh that never blocks: it has no triangles or too many.
const NOT_BLOCKER: u32 = u32::MAX;

/// The material features whose surfaces leave gaps or skip the depth buffer.
const SEE_THROUGH: u32 =
    feature::BLEND | feature::ALPHA_MASK | feature::NO_DEPTH_WRITE | feature::NO_DEPTH_TEST;

/// The blockers of the camera's view, and the buffer they draw into.
#[derive(Debug, Default)]
pub struct Occluders {
    on: bool,
    /// Each built blocker mesh.
    meshes: Vec<BlockerMesh>,
    /// By mesh id: [`UNBUILT`], [`NOT_BLOCKER`], or the index of the mesh's blocker plus one.
    by_mesh: Vec<u32>,
    /// The places of blockers that removed meshes gave back.
    free: Vec<u32>,
    /// The frame's candidates: the nearest distance of each as the bits of a float, which sort as
    /// whole numbers since none is negative, and its slot. Then scratch space for their sort.
    distances: Vec<u32>,
    candidates: Vec<u32>,
    scratch: [Vec<u32>; 2],
    blockers: Vec<Blocker>,
    buffer: OcclusionBuffer,
}

impl Occluders {
    /// True while software occlusion culling runs.
    pub fn on(&self) -> bool {
        self.on
    }

    /// Turns software occlusion culling on or off from the next frame on.
    pub fn set_on(&mut self, on: bool) {
        self.on = on;
        if !on {
            self.buffer.clear();
        }
    }

    /// The buffer that the last frame's blockers drew into.
    pub fn buffer(&self) -> &OcclusionBuffer {
        &self.buffer
    }

    /// Picks the frame's blockers for a camera's view and draws them, nearest first, on the
    /// calling thread and the job workers. `offsets` gives the offset from the camera to each
    /// cell. Returns the buffer when it may hide sources. Fails only when memory cannot grow for
    /// more blockers than any frame drew before.
    pub fn draw(
        &mut self,
        input: &FrameInput<'_>,
        frame: &ViewFrame,
        offsets: &[[f32; 4]],
        meshes: &MeshStorage,
        materials: &MaterialTable,
    ) -> Result<Option<&OcclusionBuffer>, TryReserveError> {
        self.buffer.clear();
        if !self.on {
            return Ok(None);
        }
        let [width, height, ..] = frame.uniform.target_size;
        self.buffer.resize(width as u32, height as u32)?;
        self.pick(input, frame, offsets, materials)?;
        if self.candidates.is_empty() {
            return Ok(None);
        }
        // Nearest first: blockers near the camera hide the most, and fill subtiles first.
        let n = self.candidates.len();
        for scratch in &mut self.scratch {
            if scratch.len() < n {
                scratch.try_reserve(n - scratch.len())?;
                scratch.resize(n, 0);
            }
        }
        let [keys, slots] = &mut self.scratch;
        sort_pairs(
            &mut self.distances,
            &mut self.candidates,
            &mut keys[..n],
            &mut slots[..n],
        );
        self.blockers.clear();
        if self.blockers.capacity() < self.candidates.len() {
            self.blockers
                .try_reserve(self.candidates.len() - self.blockers.len())?;
        }
        let (scene, parity) = (input.scene, input.parity());
        let world = scene.world(parity);
        let view_proj = &frame.uniform.view_proj;
        let mut triangles = 0;
        for k in 0..self.candidates.len() {
            let s = self.candidates[k] as usize;
            let Some(index) = self.blocker_of(scene.meshes()[s], meshes)? else {
                continue;
            };
            let count = self.meshes[index as usize].triangle_count();
            if triangles + count > MAX_FRAME_TRIANGLES {
                break;
            }
            triangles += count;
            let [x, y, z, _] = offsets[scene.cells()[s] as usize];
            let material = scene.materials()[s];
            self.blockers.push(Blocker {
                mesh: index,
                clip: clip_matrix(view_proj, world.matrix(s), [x, y, z]),
                double_sided: materials.features(material - 1) & feature::DOUBLE_SIDED != 0,
            });
        }
        self.buffer
            .draw(input.jobs, view_proj, &self.meshes, &self.blockers)?;
        Ok(self.buffer.is_active().then_some(&self.buffer))
    }

    /// Lists the scene objects that may block the camera's view, each with the distance along
    /// the view to its bounding sphere's nearest point.
    fn pick(
        &mut self,
        input: &FrameInput<'_>,
        frame: &ViewFrame,
        offsets: &[[f32; 4]],
        materials: &MaterialTable,
    ) -> Result<(), TryReserveError> {
        let (scene, parity) = (input.scene, input.parity());
        self.candidates.clear();
        self.distances.clear();
        let slots = scene.slots().high_water() as usize;
        let object_flags = &scene.flags()[..slots];
        let world = scene.world(parity);
        let (xs, ys, zs, radii) = (world.xs(), world.ys(), world.zs(), world.radii());
        let depth = frame.depth.row;
        // The buffer's pixels per unit of height over w: a sphere's radius on the screen is its
        // radius times this, over its w.
        let m = &frame.uniform.view_proj;
        let scale =
            (m[1] * m[1] + m[5] * m[5] + m[9] * m[9]).sqrt() * 0.5 * self.buffer.size().1 as f32;
        for (s, &object) in object_flags.iter().enumerate() {
            if object & flags::OCCLUDER == 0 {
                continue;
            }
            let radius = radii[s];
            // Hidden objects have a negative radius, and unculled ones one wider than any scene.
            if !(0.0..1e20).contains(&radius) {
                continue;
            }
            if scene.meshes()[s] == 0
                || scene.skins()[s] != 0
                || scene.layers()[s] & frame.layers == 0
                || !solid(materials, scene.materials()[s])
            {
                continue;
            }
            let [x, y, z, _] = offsets[scene.cells()[s] as usize];
            let (cx, cy, cz) = (xs[s] + x, ys[s] + y, zs[s] + z);
            if !frame.frustum.contains_sphere(cx, cy, cz, radius) {
                continue;
            }
            let along = depth[0] * cx + depth[1] * cy + depth[2] * cz + depth[3];
            // A perspective view shrinks a blocker with distance; a blocker that reaches the
            // camera's plane is always large.
            let w = m[3] * cx + m[7] * cy + m[11] * cz + m[15];
            if w > radius && radius * scale / w < MIN_BLOCKER_PIXELS {
                continue;
            }
            if self.candidates.len() == self.candidates.capacity() {
                let more = self.candidates.len().max(16);
                self.candidates.try_reserve(more)?;
                self.distances.try_reserve(more)?;
            }
            self.distances.push((along - radius).max(0.0).to_bits());
            self.candidates.push(s as u32);
        }
        Ok(())
    }

    /// Gives a mesh a blocker of its own, such as the simplified blocker that the asset tool
    /// stores in a model file, which objects with that mesh then draw in place of the mesh.
    /// `mesh` is a mesh id, which counts from 1. Fails only when memory cannot grow.
    pub fn set_blocker(&mut self, mesh: u32, blocker: BlockerMesh) -> Result<(), TryReserveError> {
        let id = mesh as usize;
        if self.by_mesh.len() <= id {
            self.by_mesh.try_reserve(id + 1 - self.by_mesh.len())?;
            self.by_mesh.resize(id + 1, UNBUILT);
        }
        match self.by_mesh[id] {
            UNBUILT | NOT_BLOCKER => self.by_mesh[id] = self.store(blocker)?,
            index => self.meshes[index as usize - 1] = blocker,
        }
        Ok(())
    }

    /// Forgets the blocker of each mesh of `ids`, which a removal took out, so a later mesh with
    /// the id builds its own. `ids` count from 0. The blockers' places go to later blockers.
    pub fn forget(&mut self, ids: &[u32]) {
        for &id in ids {
            let Some(entry) = self.by_mesh.get_mut(id as usize + 1) else {
                continue;
            };
            if *entry != UNBUILT && *entry != NOT_BLOCKER {
                let index = *entry as usize - 1;
                self.meshes[index] = BlockerMesh::default();
                self.free.push(index as u32);
            }
            *entry = UNBUILT;
        }
    }

    /// Stores a blocker in a free place or a new one, and returns its index plus one.
    fn store(&mut self, blocker: BlockerMesh) -> Result<u32, TryReserveError> {
        if let Some(index) = self.free.pop() {
            self.meshes[index as usize] = blocker;
            return Ok(index + 1);
        }
        self.meshes.try_reserve(1)?;
        self.meshes.push(blocker);
        Ok(self.meshes.len() as u32)
    }

    /// The index of a mesh's blocker, built the first time, or `None` for a mesh that never
    /// blocks. `mesh` is an object's mesh id, which counts from 1.
    fn blocker_of(
        &mut self,
        mesh: u32,
        meshes: &MeshStorage,
    ) -> Result<Option<u32>, TryReserveError> {
        let id = mesh as usize;
        if self.by_mesh.len() <= id {
            self.by_mesh.try_reserve(id + 1 - self.by_mesh.len())?;
            self.by_mesh.resize(id + 1, UNBUILT);
        }
        if self.by_mesh[id] == UNBUILT {
            let built = meshes
                .triangles(mesh - 1)
                .and_then(|t| BlockerMesh::build(&t));
            self.by_mesh[id] = match built {
                Some(blocker) => self.store(blocker)?,
                None => NOT_BLOCKER,
            };
        }
        Ok(match self.by_mesh[id] {
            NOT_BLOCKER => None,
            index => Some(index - 1),
        })
    }
}

/// True when an object's material, by its id that counts from 1, draws a solid surface into the
/// depth buffer with the engine's own shaders.
fn solid(materials: &MaterialTable, material: u32) -> bool {
    let Some(id) = material.checked_sub(1) else {
        return false;
    };
    let built_in = matches!(
        materials.shading(id),
        Ok(Shading::Lit | Shading::Unlit | Shading::UnlitMap | Shading::StandardMaps)
    );
    built_in && materials.features(id) & SEE_THROUGH == 0
}
