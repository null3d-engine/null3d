//! Morph targets that both frame builders share: each mesh's sparse deltas, the weights that a
//! frame draws with, and the texture that holds both on the GPU.
//!
//! # Sparse deltas
//!
//! A morph target moves some of a mesh's vertices: their positions, and maybe their normals and
//! tangents. A mesh stores, for each vertex, only the targets that move it, as entries one after
//! another in the storage's list of delta texels. An entry is one texel of the position's delta,
//! with the target's number in its fourth value, then one texel of the normal's delta and one of
//! the tangent's, where the mesh's targets move them. The vertex's morph attribute (location 8)
//! holds its first entry's texel and, as `count * 4 + attributes`, its entry count and whether the
//! entries hold normals (1) and tangents (2). Both are whole numbers in 32-bit floats, exact below
//! 2^24. A vertex that no target moves has no entry, so a face whose targets each move a part of it
//! stores a fraction of what three.js's morph texture holds, which has every vertex of every
//! target.
//!
//! # Weights
//!
//! Each morphed object has a block of the core's morph weight table ([`MorphWeights`]), one weight
//! per target. A frame draws the weights that [`posed_weights`] gives: the sketch's own, blended
//! with those of the clips that animate them. WebGL2 then keeps only a preset's count of the
//! largest weights of each object ([`cap_weights`]), since its vertex shaders morph in every pass
//! that draws the mesh.
//!
//! # The morph texture
//!
//! One RGBA32F texture of [`TEXTURE_WIDTH`] texels per row holds every mesh's delta texels from
//! its first texel on, then each morphed object's weights, four per texel, in the rows after the
//! deltas. A morphed vertex reads its entries, and each entry's weight from its object's texels.
//! The WebGPU skinning pass and the WebGL2 vertex shaders read it with `textureLoad`.

use null3d_core::animation::Animations;
use null3d_core::morph::{Block, MAX_WEIGHTS, MorphWeights, WEIGHTS_PER_JOINT, posed_weight};
use null3d_core::scene::SceneStorage;
use null3d_gpu::drawlist::{DrawList, Op, format, texture_usage, vertex, view};

use crate::frame::{RecordError, UploadArena, floats_as_bytes};
use crate::geometry::Geometry;
use crate::meshes::{MeshSlot, MeshStorage};

/// Texels per row of the morph texture: the widest that every WebGL2 device takes.
pub const TEXTURE_WIDTH: u32 = 2048;
/// Rows that the weights may take at most: every weight of the core's table in a block of its own.
const MAX_WEIGHT_ROWS: u32 = MAX_WEIGHTS.div_ceil(TEXTURE_WIDTH);
/// The most delta texels that every mesh's targets may take together: what fits a texture of
/// [`TEXTURE_WIDTH`] rows beside the weights.
pub const MAX_DELTA_TEXELS: u32 = TEXTURE_WIDTH * (TEXTURE_WIDTH - MAX_WEIGHT_ROWS);
/// The most entries of one vertex: what its attribute's count holds.
pub const MAX_VERTEX_ENTRIES: usize = 255;
/// The vertex location of the morph attribute.
pub const MORPH_LOCATION: usize = 8;
/// The attributes bit of an entry that holds a normal's delta.
pub const ENTRY_NORMALS: u32 = 1;
/// The attributes bit of an entry that holds a tangent's delta.
pub const ENTRY_TANGENTS: u32 = 2;
/// The weights base of an object that no block morphs.
pub const NOT_MORPHED: u32 = u32::MAX;

/// A mesh's morph targets as arrays give them: for each attribute they move, three numbers per
/// vertex of each target, target after target.
#[derive(Clone, Copy, Debug, Default)]
pub struct MorphTargets<'a> {
    pub targets: u32,
    pub positions: Option<&'a [f32]>,
    pub normals: Option<&'a [f32]>,
    pub tangents: Option<&'a [f32]>,
}

/// Why a mesh's morph targets make no morphed mesh.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MorphError {
    /// An array does not hold three numbers per vertex of each target, or a mesh has no target.
    Length,
    /// A delta is NaN or infinite: its array, 0 for positions, 1 for normals and 2 for tangents,
    /// and its place in the array.
    NotFinite { array: u32, at: u32 },
    /// The targets move one vertex more than [`MAX_VERTEX_ENTRIES`] times, or every mesh's deltas
    /// together would pass [`MAX_DELTA_TEXELS`].
    TooLarge,
}

/// A mesh's targets as the storage keeps them.
#[derive(Debug, Default)]
pub struct SparseDeltas {
    /// The entries' texels, vertex after vertex.
    pub texels: Vec<[f32; 4]>,
    /// Each vertex's morph attribute: its first entry's texel and its count and attributes.
    pub ranges: Vec<[f32; 2]>,
    /// How far each target moves any position at weight 1, which bounds the morphed mesh.
    pub reach: Vec<f32>,
}

impl MorphTargets<'_> {
    /// Values per entry: the position's texel, then the normal's and the tangent's where the
    /// targets move them.
    fn attributes(&self) -> u32 {
        u32::from(self.normals.is_some()) * ENTRY_NORMALS
            + u32::from(self.tangents.is_some()) * ENTRY_TANGENTS
    }

    /// The sparse entries of a mesh of `vertices` vertices whose first entry lands at texel
    /// `first` of the storage's delta texels.
    pub fn sparse(&self, vertices: usize, first: u32) -> Result<SparseDeltas, MorphError> {
        let targets = self.targets as usize;
        let length = targets * vertices * 3;
        let arrays = [self.positions, self.normals, self.tangents];
        if targets == 0 || arrays.iter().flatten().any(|a| a.len() != length) {
            return Err(MorphError::Length);
        }
        for (k, array) in arrays.iter().enumerate() {
            if let Some(at) = array.and_then(|a| a.iter().position(|v| !v.is_finite())) {
                return Err(MorphError::NotFinite {
                    array: k as u32,
                    at: at as u32,
                });
            }
        }
        let attributes = self.attributes();
        let stride = 1 + attributes.count_ones() as usize;
        let delta = |array: Option<&[f32]>, t: usize, v: usize| -> [f32; 3] {
            array.map_or([0.0; 3], |a| {
                let at = (t * vertices + v) * 3;
                [a[at], a[at + 1], a[at + 2]]
            })
        };
        let moves = |t: usize, v: usize| arrays.iter().any(|a| delta(*a, t, v) != [0.0; 3]);
        let count = (0..vertices)
            .map(|v| (0..targets).filter(|&t| moves(t, v)).count())
            .try_fold(0usize, |sum, n| {
                (n <= MAX_VERTEX_ENTRIES).then_some(sum + n)
            })
            .ok_or(MorphError::TooLarge)?;
        let total = count * stride;
        if first as usize + total > MAX_DELTA_TEXELS as usize {
            return Err(MorphError::TooLarge);
        }
        let mut out = SparseDeltas {
            texels: Vec::with_capacity(total),
            ranges: Vec::with_capacity(vertices),
            reach: vec![0.0; targets],
        };
        for v in 0..vertices {
            let start = first + out.texels.len() as u32;
            let mut entries = 0u32;
            for t in (0..targets).filter(|&t| moves(t, v)) {
                let [x, y, z] = delta(self.positions, t, v);
                out.reach[t] = out.reach[t].max((x * x + y * y + z * z).sqrt());
                out.texels.push([x, y, z, t as f32]);
                for array in [self.normals, self.tangents].into_iter().flatten() {
                    let [x, y, z] = delta(Some(array), t, v);
                    out.texels.push([x, y, z, 0.0]);
                }
                entries += 1;
            }
            out.ranges
                .push([start as f32, (entries * 4 + attributes) as f32]);
        }
        Ok(out)
    }
}

/// `geometry` with each vertex's morph attribute added after its other attributes: the morph
/// attribute's location is the last.
pub fn with_ranges(geometry: &Geometry, ranges: &[[f32; 2]]) -> Geometry {
    let stride = geometry.stride();
    let format = geometry.format | vertex::MORPH;
    let mut vertices = Vec::with_capacity(geometry.vertices.len() + ranges.len() * 8);
    for (v, range) in ranges.iter().enumerate() {
        vertices.extend_from_slice(&geometry.vertices[v * stride..(v + 1) * stride]);
        vertices.extend_from_slice(floats_as_bytes(range));
    }
    Geometry {
        format,
        vertices,
        indices: geometry.indices.clone(),
    }
}

/// True for a mesh whose vertices name morph entries.
pub fn has_targets(format: u32) -> bool {
    format & vertex::MORPH != 0
}

/// The morph weight block of the object in scene slot `slot`, or `None` for an object that no
/// block morphs, or whose block has another count of weights than its mesh has targets. Such an
/// object draws its mesh as it is.
pub fn morph_of<'a>(
    scene: &SceneStorage,
    morphs: &'a MorphWeights,
    meshes: &MeshStorage,
    slot: usize,
) -> Option<&'a Block> {
    let block = scene.morphs().get(slot)?.checked_sub(1)?;
    let mesh = meshes.mesh(scene.meshes()[slot].checked_sub(1)?)?;
    morphs.block(block).filter(|b| b.count == mesh.targets)
}

/// Writes the weights that a frame draws a block with into `out`, one per target: the sketch's,
/// where a clip of the block's animated instance animates them blended with the pose's (see
/// [`posed_weight`]). A link to an instance that is gone or too small counts as none.
pub fn posed_weights(
    block: &Block,
    morphs: &MorphWeights,
    animations: Option<&Animations>,
    out: &mut [f32],
) {
    let own = &morphs.values()[block.first as usize..][..block.count as usize];
    let joints = block.count.div_ceil(WEIGHTS_PER_JOINT);
    let pose = animations.and_then(|animations| {
        let (first, count) = animations.instance_joints(block.instance)?;
        (block.joint + joints <= count).then(|| {
            let at = (first + block.joint) as usize * 12;
            &animations.matrices()[at..at + joints as usize * 12]
        })
    });
    match pose {
        Some(pose) => {
            for (k, (out, &own)) in out.iter_mut().zip(own).enumerate() {
                *out = posed_weight(own, pose, k);
            }
        }
        None => out[..own.len()].copy_from_slice(own),
    }
}

/// Keeps the `cap` weights farthest from 0 and sets the others to 0. Of weights equally far, the
/// target that comes first stays. three.js's WebGL renderer of WebGL1 kept its 8 largest
/// influences in the same way.
pub fn cap_weights(weights: &mut [f32], cap: usize) {
    let mut kept = weights.iter().filter(|w| **w != 0.0).count();
    while kept > cap {
        let mut smallest = None;
        for (k, w) in weights.iter().enumerate() {
            if *w != 0.0 && smallest.is_none_or(|(_, s): (usize, f32)| w.abs() <= s) {
                smallest = Some((k, w.abs()));
            }
        }
        if let Some((k, _)) = smallest {
            weights[k] = 0.0;
        }
        kept -= 1;
    }
}

/// How far the weights `weights` move any vertex of `mesh` at most: each target's reach times its
/// weight, added up.
pub fn reach(meshes: &MeshStorage, mesh: &MeshSlot, weights: &[f32]) -> f32 {
    meshes
        .reach(mesh)
        .iter()
        .zip(weights)
        .map(|(r, w)| r * w.abs())
        .sum()
}

/// One morphed object of the morph texture's layout.
#[derive(Clone, Copy, Debug)]
pub(crate) struct MorphedObject {
    /// Its scene slot and morph weight block.
    pub(crate) slot: u32,
    block: u32,
    /// Its first weight texel after the deltas.
    offset: u32,
}

/// The morph texture (see the module documentation) and the morphed objects whose weights it
/// holds.
#[derive(Debug)]
pub(crate) struct MorphTexture {
    id: u32,
    /// Its rows, 0 before it exists, and the rows that the deltas take.
    rows: u32,
    delta_rows: u32,
    /// The delta texels uploaded so far.
    uploaded: u32,
    objects: Vec<MorphedObject>,
    /// The weight texels that the objects take.
    weight_texels: u32,
    /// The most weights that each object keeps, or `u32::MAX` for all.
    cap: u32,
}

impl MorphTexture {
    pub(crate) fn new(id: u32) -> Self {
        Self {
            id,
            rows: 0,
            delta_rows: 0,
            uploaded: 0,
            objects: Vec::new(),
            weight_texels: 0,
            cap: u32::MAX,
        }
    }

    /// The texture's id.
    pub(crate) fn id(&self) -> u32 {
        self.id
    }

    /// True once the texture exists.
    pub(crate) fn exists(&self) -> bool {
        self.rows > 0
    }

    /// True while the scene has morphed objects.
    pub(crate) fn active(&self) -> bool {
        !self.objects.is_empty()
    }

    /// Keeps at most `cap` weights of each object, the largest.
    pub(crate) fn set_cap(&mut self, cap: u32) {
        self.cap = cap;
    }

    /// Lists the morphed objects of the scene as it stands, in slot order, each with room for its
    /// weights.
    pub(crate) fn rebuild(
        &mut self,
        scene: &SceneStorage,
        morphs: &MorphWeights,
        meshes: &MeshStorage,
    ) {
        self.objects.clear();
        self.weight_texels = 0;
        for slot in 0..=scene.capacity() as usize {
            if !scene.created().get(slot as u32) {
                continue;
            }
            let Some(block) = morph_of(scene, morphs, meshes, slot) else {
                continue;
            };
            self.objects.push(MorphedObject {
                slot: slot as u32,
                block: scene.morphs()[slot] - 1,
                offset: self.weight_texels,
            });
            self.weight_texels += block.count.div_ceil(4);
        }
    }

    /// The first texel of the weights of the object in scene slot `slot`, or [`NOT_MORPHED`].
    pub(crate) fn base(&self, slot: u32) -> u32 {
        match self.objects.binary_search_by_key(&slot, |o| o.slot) {
            Ok(k) => self.delta_rows * TEXTURE_WIDTH + self.objects[k].offset,
            Err(_) => NOT_MORPHED,
        }
    }

    /// The morphed objects, in slot order.
    pub(crate) fn objects(&self) -> &[MorphedObject] {
        &self.objects
    }

    /// Records the texture's creation when it lacks room for every mesh's deltas or the objects'
    /// weights, with room for more deltas, while the scene has morphed objects or bind groups
    /// that bind it (`bound`). Returns true when it made the texture, after which the objects'
    /// weights sit at other texels, and bind groups that read it must see it.
    pub(crate) fn size(
        &mut self,
        list: &mut DrawList,
        meshes: &MeshStorage,
        bound: bool,
    ) -> Result<bool, RecordError> {
        if !self.active() && (!bound || self.exists()) {
            return Ok(false);
        }
        let deltas = meshes.morph_texels().len() as u32;
        let delta_rows = deltas.div_ceil(TEXTURE_WIDTH).max(1);
        let weight_rows = self.weight_texels.div_ceil(TEXTURE_WIDTH);
        if self.exists()
            && delta_rows <= self.delta_rows
            && weight_rows <= self.rows - self.delta_rows
        {
            return Ok(false);
        }
        let room = TEXTURE_WIDTH - MAX_WEIGHT_ROWS;
        self.delta_rows = (delta_rows + delta_rows / 2).min(room).max(delta_rows);
        self.rows = self.delta_rows + (weight_rows + weight_rows / 2).clamp(1, MAX_WEIGHT_ROWS);
        self.uploaded = 0;
        list.push(
            Op::CreateTexture,
            &[
                self.id,
                TEXTURE_WIDTH,
                self.rows,
                1,
                format::RGBA32_FLOAT,
                texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
                1,
                1,
                view::D2,
            ],
        )?;
        Ok(true)
    }

    /// The most that one frame copies into its arena: the deltas not uploaded yet, and the
    /// weights.
    pub(crate) fn upload_bound(&self, meshes: &MeshStorage) -> usize {
        if !self.active() {
            return 0;
        }
        let deltas = (meshes.morph_texels().len() as u32).saturating_sub(self.uploaded);
        (deltas + self.weight_texels) as usize * 16
    }

    /// Uploads the deltas that the texture lacks, and every object's weights for the frame, at
    /// most `cap` of each.
    pub(crate) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        morphs: &MorphWeights,
        animations: Option<&Animations>,
        meshes: &MeshStorage,
    ) -> Result<(), RecordError> {
        if !self.active() || !self.exists() {
            return Ok(());
        }
        let deltas = meshes.morph_texels();
        let fits = (self.delta_rows * TEXTURE_WIDTH) as usize;
        if (self.uploaded as usize) < deltas.len().min(fits) {
            let new = &deltas[self.uploaded as usize..deltas.len().min(fits)];
            let (at, _) = arena.push(floats_as_bytes(new.as_flattened()))?;
            write_texels(list, self.id, self.uploaded, new.len() as u32, at)?;
            self.uploaded += new.len() as u32;
        }
        if self.weight_texels == 0 {
            return Ok(());
        }
        let (at, bytes) = arena.push_zeroed(self.weight_texels as usize * 16)?;
        let mut weights = [0.0f32; 256];
        for object in &self.objects {
            let Some(block) = morphs.block(object.block) else {
                continue;
            };
            let count = block.count as usize;
            posed_weights(block, morphs, animations, &mut weights[..count]);
            cap_weights(&mut weights[..count], self.cap as usize);
            let out = &mut bytes[object.offset as usize * 16..][..count * 4];
            out.copy_from_slice(floats_as_bytes(&weights[..count]));
        }
        let first = self.delta_rows * TEXTURE_WIDTH;
        write_texels(list, self.id, first, self.weight_texels, at)
    }

    /// Forgets the texture, after the thread that draws replaced the GPU.
    pub(crate) fn forget_gpu(&mut self) {
        self.rows = 0;
        self.uploaded = 0;
    }
}

/// Writes `count` texels from texel `first` of a texture [`TEXTURE_WIDTH`] texels wide, from the
/// arena's `source`: the end of the first row, the whole rows after it and the start of the last.
fn write_texels(
    list: &mut DrawList,
    texture: u32,
    first: u32,
    count: u32,
    source: u32,
) -> Result<(), RecordError> {
    let (end, mut texel, mut at) = (first + count, first, source);
    while texel < end {
        let column = texel % TEXTURE_WIDTH;
        let (width, height) = if column == 0 && end - texel >= TEXTURE_WIDTH {
            (TEXTURE_WIDTH, (end - texel) / TEXTURE_WIDTH)
        } else {
            ((TEXTURE_WIDTH - column).min(end - texel), 1)
        };
        list.push(
            Op::WriteTexture,
            &[
                texture,
                0,
                column,
                texel / TEXTURE_WIDTH,
                0,
                width,
                height,
                1,
                at,
                width * 16,
            ],
        )?;
        texel += width * height;
        at += width * height * 16;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_vertex_lists_only_the_targets_that_move_it() {
        // Three vertices and two targets: the first moves vertex 0, the second vertices 0 and 2.
        let positions = [
            [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            [0.0, 2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 3.0],
        ]
        .concat();
        let normals = [[0.0; 9], [0.0, 0.0, 0.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0]].concat();
        let targets = MorphTargets {
            targets: 2,
            positions: Some(&positions),
            normals: Some(&normals),
            tangents: None,
        };
        let sparse = targets.sparse(3, 10).unwrap();
        // Vertex 0: two entries of two texels; vertex 1: the normal of target 1; vertex 2: one.
        assert_eq!(sparse.ranges, vec![[10.0, 9.0], [14.0, 5.0], [16.0, 5.0]]);
        assert_eq!(sparse.texels[0], [1.0, 0.0, 0.0, 0.0]);
        assert_eq!(sparse.texels[2], [0.0, 2.0, 0.0, 1.0]);
        assert_eq!(sparse.texels[5], [0.5, 0.0, 0.0, 0.0]);
        assert_eq!(sparse.texels[6], [0.0, 0.0, 3.0, 1.0]);
        assert_eq!(sparse.texels.len(), 8);
        assert_eq!(sparse.reach, vec![1.0, 3.0]);

        let short = MorphTargets {
            positions: Some(&positions[..17]),
            ..targets
        };
        assert_eq!(short.sparse(3, 0).unwrap_err(), MorphError::Length);
        let mut bad = positions.clone();
        bad[4] = f32::NAN;
        let bad = MorphTargets {
            positions: Some(&bad),
            ..targets
        };
        assert_eq!(
            bad.sparse(3, 0).unwrap_err(),
            MorphError::NotFinite { array: 0, at: 4 }
        );
        assert_eq!(
            targets.sparse(3, MAX_DELTA_TEXELS - 4).unwrap_err(),
            MorphError::TooLarge
        );
    }

    #[test]
    fn the_cap_drops_the_smallest_weights_first() {
        let mut weights = [0.5, -0.9, 0.1, 0.0, 0.3, 0.1];
        cap_weights(&mut weights, 3);
        assert_eq!(weights, [0.5, -0.9, 0.0, 0.0, 0.3, 0.0]);
        cap_weights(&mut weights, 3);
        assert_eq!(weights, [0.5, -0.9, 0.0, 0.0, 0.3, 0.0]);
        // Of equal weights, the first target stays.
        let mut equal = [0.2, 0.2, 0.2];
        cap_weights(&mut equal, 2);
        assert_eq!(equal, [0.2, 0.2, 0.0]);
        cap_weights(&mut equal, 0);
        assert_eq!(equal, [0.0; 3]);
    }

    #[test]
    fn the_morph_attribute_follows_each_vertex() {
        let g = Geometry::from_floats(0, &[1.0; 12], vec![0, 1, 0]);
        let morphed = with_ranges(&g, &[[0.0, 4.0], [1.0, 4.0]]);
        assert!(has_targets(morphed.format));
        assert_eq!(morphed.stride(), 32);
        assert_eq!(morphed.values(1, MORPH_LOCATION), vec![1.0, 4.0]);
        assert_eq!(morphed.position(1), [1.0; 3]);
    }
}
