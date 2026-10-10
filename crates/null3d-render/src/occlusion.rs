//! The camera's blockers for software occlusion culling on the WebGL2 path (see
//! [`null3d_core::occlusion`]).
//!
//! Each frame picks the scene objects that block the view: those with the occluder flag that are
//! shown, on the view's layers, inside its frustum and not too small to matter, whose mesh holds
//! few enough triangles, and whose material draws a solid surface. A material that blends, cuts
//! holes with an alpha mask, skips the depth buffer, or runs custom shader code may leave gaps or
//! move vertices, so its objects never block. Neither do skinned objects, whose drawn shape is not
//! their mesh's. The picked objects' parts draw nearest first, up to a budget of triangles, and
//! the camera's culling then hides each source whose bounding sphere lies behind them.
//!
//! A mesh's blocker, its welded corners and its edges, is built the first time an object with
//! that mesh blocks the view, and kept, as meshes never change. The blocker splits into its
//! connected parts, and from the next frame on each part takes its place by its own bounding
//! sphere, so a mesh that merges parts spread far apart blocks with its near parts first. A
//! blocker of one part takes the object's bounding sphere, as it costs nothing more. A mesh
//! from a model file can come with a simplified blocker of its own, which the asset tool made
//! and checked to lie inside the mesh; objects with that mesh draw it instead.

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
/// The part of a frame candidate whose mesh's blocker was not built yet.
const UNBUILT_PART: u32 = u32::MAX;

/// The material features whose surfaces leave gaps, let light through or skip the depth buffer.
const SEE_THROUGH: u32 = feature::BLEND
    | feature::ALPHA_MASK
    | feature::NO_DEPTH_WRITE
    | feature::NO_DEPTH_TEST
    | feature::TRANSMISSION;

/// The blockers of the camera's view, and the buffer they draw into.
#[derive(Debug, Default)]
pub struct Occluders {
    on: bool,
    /// Each built blocker part.
    meshes: Vec<BlockerMesh>,
    /// By mesh id: [`UNBUILT`], [`NOT_BLOCKER`], or the index of the mesh's parts plus one.
    by_mesh: Vec<u32>,
    /// Each mesh's parts: their places in `meshes`.
    parts: Vec<Vec<u32>>,
    /// The places of parts, and of lists of parts, that removed meshes gave back.
    free: Vec<u32>,
    free_parts: Vec<u32>,
    /// The frame's candidates: the nearest distance of each part as the bits of a float, which
    /// sort as whole numbers since none is negative, and its place in `picked`. Then scratch
    /// space for their sort.
    distances: Vec<u32>,
    candidates: Vec<u32>,
    scratch: [Vec<u32>; 2],
    /// Each candidate's slot and part.
    picked: Vec<[u32; 2]>,
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

    /// Sets the pixels that the buffer holds about from the next frame on, or 0 for the core's
    /// default.
    pub fn set_buffer_pixels(&mut self, pixels: u32) {
        self.buffer.set_pixels(pixels);
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
        let (scene, parity) = (input.scene, input.parity());
        let world = scene.world(parity);
        let view_proj = &frame.uniform.view_proj;
        let mut triangles = 0;
        'frame: for k in 0..n {
            let [slot, part] = self.picked[self.candidates[k] as usize];
            let s = slot as usize;
            // A mesh whose blocker builds now draws all its parts in this frame.
            let group;
            let parts = if part == UNBUILT_PART {
                let Some(built) = self.parts_of(scene.meshes()[s], meshes)? else {
                    continue;
                };
                group = built;
                &self.parts[group][..]
            } else {
                std::slice::from_ref(&part)
            };
            self.blockers.try_reserve(parts.len())?;
            let [x, y, z, _] = offsets[scene.cells()[s] as usize];
            let clip = clip_matrix(view_proj, world.matrix(s), [x, y, z]);
            let material = scene.materials()[s];
            let double_sided = materials.features(material - 1) & feature::DOUBLE_SIDED != 0;
            for &part in parts {
                let count = self.meshes[part as usize].triangle_count();
                if triangles + count > MAX_FRAME_TRIANGLES {
                    break 'frame;
                }
                triangles += count;
                self.blockers.push(Blocker {
                    mesh: part,
                    clip,
                    double_sided,
                });
            }
        }
        self.buffer
            .draw(input.jobs, view_proj, &self.meshes, &self.blockers)?;
        Ok(self.buffer.is_active().then_some(&self.buffer))
    }

    /// Lists the parts of the scene objects that may block the camera's view, each with the
    /// distance along the view to its bounding sphere's nearest point. An object that merges
    /// parts spread over a large space, such as a city's buildings of one material, would
    /// otherwise count as near by its farthest part, and fill the budget before the objects
    /// that stand nearer. An object whose mesh's blocker was not built yet counts whole, by its
    /// own sphere, which lies no farther than any of its parts.
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
        self.picked.clear();
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
        // The distance along the view to a sphere's nearest point, or `None` for a sphere outside
        // the frustum or too small to matter.
        let nearest = |cx: f32, cy: f32, cz: f32, radius: f32| {
            if !frame.frustum.contains_sphere(cx, cy, cz, radius) {
                return None;
            }
            // A perspective view shrinks a blocker with distance; a blocker that reaches the
            // camera's plane is always large.
            let w = m[3] * cx + m[7] * cy + m[11] * cz + m[15];
            if w > radius && radius * scale / w < MIN_BLOCKER_PIXELS {
                return None;
            }
            let along = depth[0] * cx + depth[1] * cy + depth[2] * cz + depth[3];
            Some((along - radius).max(0.0))
        };
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
            let Some(distance) = nearest(cx, cy, cz, radius) else {
                continue;
            };
            let group = match self.by_mesh.get(scene.meshes()[s] as usize) {
                None | Some(&UNBUILT) => {
                    self.push_candidate(distance, s as u32, UNBUILT_PART)?;
                    continue;
                }
                Some(&NOT_BLOCKER) => continue,
                Some(&index) => index as usize - 1,
            };
            // A blocker of one part takes the object's own sphere.
            if let [part] = self.parts[group][..] {
                self.push_candidate(distance, s as u32, part)?;
                continue;
            }
            // Each part's sphere in the view's space: the object's matrix moves its centre, and
            // its largest scale grows its radius.
            let a = world.matrix(s);
            let grow = [0, 1, 2]
                .map(|c| (a[c] * a[c] + a[4 + c] * a[4 + c] + a[8 + c] * a[8 + c]).sqrt())
                .into_iter()
                .fold(0.0f32, f32::max);
            for p in 0..self.parts[group].len() {
                let part = self.parts[group][p];
                let [px, py, pz, pr] = self.meshes[part as usize].sphere();
                if let Some(distance) = nearest(
                    a[0] * px + a[1] * py + a[2] * pz + a[3] + x,
                    a[4] * px + a[5] * py + a[6] * pz + a[7] + y,
                    a[8] * px + a[9] * py + a[10] * pz + a[11] + z,
                    pr * grow,
                ) {
                    self.push_candidate(distance, s as u32, part)?;
                }
            }
        }
        Ok(())
    }

    /// Adds a frame candidate: a part of the object in `slot`, at `distance` along the view.
    fn push_candidate(
        &mut self,
        distance: f32,
        slot: u32,
        part: u32,
    ) -> Result<(), TryReserveError> {
        if self.candidates.len() == self.candidates.capacity() {
            let more = self.candidates.len().max(16);
            self.candidates.try_reserve(more)?;
            self.distances.try_reserve(more)?;
            self.picked.try_reserve(more)?;
        }
        self.distances.push(distance.to_bits());
        self.candidates.push(self.picked.len() as u32);
        self.picked.push([slot, part]);
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
        self.release(id);
        self.by_mesh[id] = self.store(blocker)?;
        Ok(())
    }

    /// Forgets the blocker of each mesh of `ids`, which a removal took out, so a later mesh with
    /// the id builds its own. `ids` count from 0. The blockers' places go to later blockers.
    pub fn forget(&mut self, ids: &[u32]) {
        for &id in ids {
            if (id as usize + 1) < self.by_mesh.len() {
                self.release(id as usize + 1);
                self.by_mesh[id as usize + 1] = UNBUILT;
            }
        }
    }

    /// Gives back the places of a mesh's parts, by its id that counts from 1.
    fn release(&mut self, id: usize) {
        let entry = self.by_mesh[id];
        if entry == UNBUILT || entry == NOT_BLOCKER {
            return;
        }
        let group = entry as usize - 1;
        for &part in &self.parts[group] {
            self.meshes[part as usize] = BlockerMesh::default();
            self.free.push(part);
        }
        self.parts[group].clear();
        self.free_parts.push(group as u32);
    }

    /// Stores a blocker's parts in free places or new ones, and returns the index of their list
    /// plus one.
    fn store(&mut self, blocker: BlockerMesh) -> Result<u32, TryReserveError> {
        let parts = blocker.into_parts();
        let group = match self.free_parts.pop() {
            Some(group) => group as usize,
            None => {
                self.parts.try_reserve(1)?;
                self.parts.push(Vec::new());
                self.parts.len() - 1
            }
        };
        self.parts[group].try_reserve(parts.len())?;
        for part in parts {
            let index = match self.free.pop() {
                Some(index) => {
                    self.meshes[index as usize] = part;
                    index
                }
                None => {
                    self.meshes.try_reserve(1)?;
                    self.meshes.push(part);
                    self.meshes.len() as u32 - 1
                }
            };
            self.parts[group].push(index);
        }
        Ok(group as u32 + 1)
    }

    /// The index of the list of a mesh's parts, built the first time, or `None` for a mesh that
    /// never blocks. `mesh` is an object's mesh id, which counts from 1.
    fn parts_of(
        &mut self,
        mesh: u32,
        meshes: &MeshStorage,
    ) -> Result<Option<usize>, TryReserveError> {
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
            index => Some(index as usize - 1),
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

#[cfg(test)]
mod tests {
    use null3d_core::bvh::mesh::TriangleSoup;

    use super::*;

    /// A blocker of `parts` triangles that share no corners, a metre apart along x.
    fn apart(parts: usize) -> BlockerMesh {
        let soup: Vec<f32> = (0..parts)
            .flat_map(|p| {
                let x = p as f32 * 2.0;
                [x, 0.0, 0.0, x + 1.0, 0.0, 0.0, x, 1.0, 0.0]
            })
            .collect();
        BlockerMesh::build(&TriangleSoup { positions: &soup }).unwrap()
    }

    #[test]
    fn a_mesh_keeps_one_place_per_part_and_gives_them_back() {
        let mut occluders = Occluders::default();
        occluders.set_blocker(1, apart(3)).unwrap();
        occluders.set_blocker(2, apart(1)).unwrap();
        assert_eq!(occluders.meshes.len(), 4);
        assert_eq!(occluders.parts[0].len(), 3);
        assert_eq!(occluders.parts[1].len(), 1);
        // A new blocker for a mesh replaces its parts in the places they held.
        occluders.set_blocker(1, apart(2)).unwrap();
        assert_eq!(occluders.meshes.len(), 4);
        assert_eq!(occluders.free.len(), 1);
        // A removed mesh gives its places to later blockers.
        occluders.forget(&[0]);
        assert_eq!((occluders.by_mesh[1], occluders.free.len()), (UNBUILT, 3));
        occluders.set_blocker(3, apart(3)).unwrap();
        assert_eq!((occluders.meshes.len(), occluders.parts.len()), (4, 2));
        assert!(occluders.free.is_empty());
        let sphere = occluders.meshes[occluders.parts[0][2] as usize].sphere();
        assert_eq!(sphere[..3], [4.5, 0.5, 0.0]);
    }
}
