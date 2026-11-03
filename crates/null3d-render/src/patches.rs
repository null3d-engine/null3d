//! Trees of cluster patches: the patches that a large static mesh draws instead of its whole
//! triangle list, from the asset tool (`NULL3D_clusters`).
//!
//! A patch holds a run of the tree's indices, a sphere, and an error: the largest distance between
//! its surface and the surface of the patches below it, in the units of the mesh's positions. The
//! patch above it in the tree replaces its children, so every patch's triangles lie inside the
//! area that its children's triangles cover.
//!
//! A view draws a patch while the patch's error passes its threshold at the patch's own sphere,
//! and its parent's error does not pass at the parent's sphere. A patch's sphere holds its
//! children's spheres, and its error is at least theirs, so a camera never finds a parent passing
//! where its child fails. Along each chain from a leaf to the root, the patches that pass are one
//! run from the leaf up, and the top of that run is the one patch of the chain that draws. The
//! patches that draw therefore cover the mesh once, whatever the distance. The tree refuses
//! spheres or errors that break this order ([`PatchError::Nesting`]), which trees from older
//! asset tools do.
//!
//! Every patch's indices name the mesh's own vertices, so a tree adds no vertex and every patch
//! draws with the mesh's pipelines as they are.
//!
//! # Bands
//!
//! A tree that a model streams arrives in bands: the file holds the patches nearest the root and
//! each band appends the patches below them ([`PatchTree::append`]). Parents come before children
//! across the file and its bands, so the loaded patches always form an ancestor-closed tree. A
//! patch whose children have not arrived draws where the camera is close, which makes the first
//! picture coarse and still covers the whole surface. The band that a patch belongs to says how
//! deep it lies, and the loader holds a band until a view draws a patch of the band above it.

use null3d_core::culling::Frustum;
use null3d_core::levels::LevelRule;
use null3d_core::math::{Affine, max_axis_scale, world_sphere_at};
use null3d_core::scene::SceneStorage;
use null3d_core::world::MATRIX_FLOATS;

use crate::levels::StageWatches;
use crate::view::ViewFrame;

/// Why a tree was refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PatchError {
    /// The tree holds no patch.
    Empty,
    /// The root names no patch of the tree.
    Root,
    /// A patch's run of indices holds no whole triangles, or runs past the tree's indices.
    Record,
    /// A patch names itself as its parent.
    Parent,
    /// An index names no vertex of the mesh.
    Vertex,
    /// A patch's sphere is not a finite centre with a radius above 0.
    Bounds,
    /// A patch's sphere does not hold the sphere of a patch below it, or its error is smaller than
    /// that patch's. A view would then draw some parts of the mesh twice and leave holes.
    Nesting,
}

/// The share of a parent's radius by which a child's sphere may reach past it: the rounding of the
/// spheres to 32-bit floats, and no more.
const NEST_SLACK: f64 = 1.0e-6;

/// True when the sphere `parent` holds the sphere `child`, and the error `parent_error` is at least
/// `child_error`, which the order of the tree needs.
fn nests(parent: &[f32; 4], parent_error: f32, child: &[f32; 4], child_error: f32) -> bool {
    let gap = (0..3)
        .map(|c| (f64::from(parent[c]) - f64::from(child[c])).powi(2))
        .sum::<f64>()
        .sqrt();
    let radius = f64::from(parent[3]);
    gap + f64::from(child[3]) <= radius + radius * NEST_SLACK && child_error <= parent_error
}

/// One mesh's tree of cluster patches.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PatchTree {
    /// Every patch's indices, one patch after another.
    indices: Vec<u32>,
    /// Each patch's bounding sphere: its centre, then its radius.
    bounds: Vec<[f32; 4]>,
    /// Each patch's first index, its index count, its parent's place plus one (0 for the root),
    /// and its error's bits.
    records: Vec<[u32; 4]>,
    /// The patch that the walk starts at.
    root: u32,
    /// The first patch of each band, in the order the bands arrived. The first entry is the root's
    /// band, which the tree was made with.
    bands: Vec<u32>,
    /// The number of each patch's children that the tree holds. A patch with none draws wherever
    /// the camera is close, so a tree whose bands have not all arrived has no holes.
    children: Vec<u32>,
}

impl PatchTree {
    /// The tree that `records` and `bounds` describe over `indices`, with `root` as its first
    /// patch, or why the tree cannot be drawn. `vertices` is the mesh's vertex count, which no
    /// index may reach.
    pub fn new(
        indices: Vec<u32>,
        bounds: Vec<[f32; 4]>,
        records: Vec<[u32; 4]>,
        root: u32,
        vertices: u32,
    ) -> Result<Self, PatchError> {
        let mut tree = Self {
            children: vec![0; records.len()],
            indices,
            bounds,
            records,
            root,
            bands: vec![0],
        };
        tree.check(vertices)?;
        for k in 0..tree.records.len() {
            if let Some(parent) = tree.records[k][2].checked_sub(1) {
                tree.children[parent as usize] += 1;
            }
        }
        Ok(tree)
    }

    /// Appends the patches of one band: its spheres, its records and its indices, whose runs start
    /// at the band's own first index. A record's parent names a patch that the tree or an earlier
    /// band holds, so the patches that landed keep an ancestor-closed tree. The vertices count is
    /// the mesh's, which no index may reach. Returns why the band cannot be appended, and leaves
    /// the tree as it was.
    pub fn append(
        &mut self,
        bounds: &[[f32; 4]],
        records: &[[u32; 4]],
        indices: &[u32],
        vertices: u32,
    ) -> Result<(), PatchError> {
        if records.is_empty() || records.len() != bounds.len() {
            return Err(PatchError::Empty);
        }
        let base = self.indices.len() as u32;
        let total = self.records.len() as u32;
        if total + records.len() as u32 > u32::MAX / 2 {
            return Err(PatchError::Record);
        }
        for (k, record) in records.iter().enumerate() {
            let [first, count, parent, _] = *record;
            if count == 0
                || !count.is_multiple_of(3)
                || first.saturating_add(count) as usize > indices.len()
            {
                return Err(PatchError::Record);
            }
            // A parent names a patch that landed before this one, as the file and its bands promise.
            if parent != 0 && parent as usize > total as usize + k {
                return Err(PatchError::Parent);
            }
        }
        if indices.iter().any(|&index| index >= vertices) {
            return Err(PatchError::Vertex);
        }
        for sphere in bounds {
            if sphere[..3].iter().any(|value| !value.is_finite())
                || !sphere[3].is_finite()
                || sphere[3] < 0.0
            {
                return Err(PatchError::Bounds);
            }
        }
        // A parent lies in the tree or earlier in the band, as the check above made sure.
        let held = |place: u32| match place.checked_sub(total) {
            None => (self.bounds[place as usize], self.error(place)),
            Some(k) => (bounds[k as usize], f32::from_bits(records[k as usize][3])),
        };
        for (k, record) in records.iter().enumerate() {
            if let Some(parent) = record[2].checked_sub(1) {
                let (sphere, error) = held(parent);
                if !nests(&sphere, error, &bounds[k], f32::from_bits(record[3])) {
                    return Err(PatchError::Nesting);
                }
            }
        }
        self.bands.push(total);
        self.bounds.extend_from_slice(bounds);
        self.records.extend(
            records
                .iter()
                .map(|&[first, count, parent, error]| [first + base, count, parent, error]),
        );
        self.indices.extend_from_slice(indices);
        self.children.resize(self.records.len(), 0);
        for record in &self.records[total as usize..] {
            if let Some(parent) = record[2].checked_sub(1) {
                self.children[parent as usize] += 1;
            }
        }
        Ok(())
    }

    /// Checks the tree against a mesh of `vertices` vertices.
    fn check(&self, vertices: u32) -> Result<(), PatchError> {
        if self.records.is_empty() {
            return Err(PatchError::Empty);
        }
        if self.root as usize >= self.records.len() {
            return Err(PatchError::Root);
        }
        if self.bounds.len() != self.records.len() {
            return Err(PatchError::Record);
        }
        for (k, record) in self.records.iter().enumerate() {
            let [first, count, parent, _] = *record;
            if count == 0
                || !count.is_multiple_of(3)
                || first.saturating_add(count) as usize > self.indices.len()
            {
                return Err(PatchError::Record);
            }
            if parent as usize == k + 1 || parent as usize > self.records.len() {
                return Err(PatchError::Parent);
            }
        }
        if self.indices.iter().any(|&index| index >= vertices) {
            return Err(PatchError::Vertex);
        }
        for sphere in &self.bounds {
            if sphere[..3].iter().any(|value| !value.is_finite())
                || !sphere[3].is_finite()
                || sphere[3] < 0.0
            {
                return Err(PatchError::Bounds);
            }
        }
        for (k, record) in self.records.iter().enumerate() {
            if let Some(parent) = record[2].checked_sub(1)
                && !nests(
                    &self.bounds[parent as usize],
                    self.error(parent),
                    &self.bounds[k],
                    f32::from_bits(record[3]),
                )
            {
                return Err(PatchError::Nesting);
            }
        }
        Ok(())
    }

    /// The number of patches, the root included.
    pub fn len(&self) -> usize {
        self.records.len()
    }

    /// True for a tree without patches, which no valid tree is.
    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    /// The patch that the walk starts at.
    pub fn root(&self) -> u32 {
        self.root
    }

    /// The number of bands that the tree holds, the root's band counted.
    pub fn band_count(&self) -> u32 {
        self.bands.len() as u32
    }

    /// The band that patch `patch` belongs to, from 0 for the root's band. The bands arrive in
    /// depth order, so a deeper patch lies in a later band.
    pub fn band(&self, patch: u32) -> u32 {
        self.bands
            .partition_point(|&first| first <= patch)
            .saturating_sub(1) as u32
    }

    /// Every patch's indices, one patch after another.
    pub fn indices(&self) -> &[u32] {
        &self.indices
    }

    /// Each patch's bounding sphere: its centre, then its radius.
    pub fn bounds(&self) -> &[[f32; 4]] {
        &self.bounds
    }

    /// Each patch's first index, index count, parent's place plus one, and error's bits.
    pub fn records(&self) -> &[[u32; 4]] {
        &self.records
    }

    /// Patch `patch`'s run of the tree's indices: its first index, and its index count.
    pub fn run(&self, patch: u32) -> Option<(u32, u32)> {
        let [first, count, _, _] = *self.records.get(patch as usize)?;
        Some((first, count))
    }

    /// Patch `patch`'s error, in the units of the mesh's positions.
    pub fn error(&self, patch: u32) -> f32 {
        self.records
            .get(patch as usize)
            .map_or(0.0, |record| f32::from_bits(record[3]))
    }

    /// The error that the view's rule compares for patch `patch`: a value below 0 for a patch whose
    /// children the tree does not hold, which therefore draws wherever the camera is close, so a
    /// tree whose bands have not all arrived has no holes. Every other patch gives its own error.
    pub fn rule_error(&self, patch: u32) -> f32 {
        if self.children.get(patch as usize).copied().unwrap_or(0) == 0 {
            -1.0
        } else {
            self.error(patch)
        }
    }

    /// The patch above `patch`, or `None` for the root.
    pub fn parent(&self, patch: u32) -> Option<u32> {
        match self.records.get(patch as usize)?[2] {
            0 => None,
            parent => Some(parent - 1),
        }
    }

    /// True when patch `patch`'s error passes the view's threshold at `distance` from the camera,
    /// where `reach` is the copy's largest axis scale times the rule's factor. A patch whose
    /// children the tree does not hold passes at every distance.
    fn fits(&self, patch: u32, reach: f32, distance: f32) -> bool {
        self.rule_error(patch) * reach < distance
    }

    /// True when patch `patch` draws: its error passes at `distance`, the rule's distance to its
    /// own sphere, and its parent's error does not pass at the distance that `parent_distance`
    /// gives for the parent's sphere. `reach` is the copy's largest axis scale times the rule's
    /// factor. A patch whose children the tree does not hold passes at every distance, so it draws
    /// in place of the patches below it.
    pub fn draws(
        &self,
        patch: u32,
        reach: f32,
        distance: f32,
        parent_distance: impl FnOnce(u32) -> f32,
    ) -> bool {
        self.fits(patch, reach, distance)
            && !self
                .parent(patch)
                .is_some_and(|parent| self.fits(parent, reach, parent_distance(parent)))
    }

    /// Patch `patch`'s record in the compute pass's table, where this tree's patches start at
    /// `first_patch` and its indices at `first_index` (`cluster_cull.wgsl`): its sphere's four
    /// floats, then its first index and index count in the scene's indices, its parent's place in
    /// the scene's patches plus one (0 for the root), and the error that the rule compares. A
    /// patch whose children have not arrived carries a rule error below 0, so the pass draws it
    /// wherever the camera is close instead of leaving a hole.
    pub fn table_record(&self, patch: u32, first_patch: u32, first_index: u32) -> [u32; 8] {
        let sphere = self.bounds[patch as usize];
        let [first, count, parent, _] = self.records[patch as usize];
        let parent = if parent == 0 { 0 } else { parent + first_patch };
        [
            sphere[0].to_bits(),
            sphere[1].to_bits(),
            sphere[2].to_bits(),
            sphere[3].to_bits(),
            first + first_index,
            count,
            parent,
            self.rule_error(patch).to_bits(),
        ]
    }

    /// Calls `pick` with each patch that a view draws, for a copy that `matrix` places and whose
    /// cell lies `offset` from the view's camera: the patch's sphere lies in `frustum`, when one is
    /// given, and `rule` draws the patch ([`PatchTree::draws`]). The job workers' walk and the
    /// count of a band's picks both read the tree through this walk, and the compute pass applies
    /// the same rule (`cluster_cull.wgsl`).
    pub fn walk(
        &self,
        matrix: &Affine,
        offset: [f32; 3],
        rule: &LevelRule,
        frustum: Option<&Frustum>,
        mut pick: impl FnMut(u32),
    ) {
        let reach = max_axis_scale(matrix) * rule.factor;
        let place = |patch: u32| {
            let sphere = self.bounds[patch as usize];
            let [x, y, z, radius] =
                world_sphere_at(matrix, [sphere[0], sphere[1], sphere[2]], sphere[3]);
            ([x + offset[0], y + offset[1], z + offset[2]], radius)
        };
        for patch in 0..self.len() as u32 {
            let (centre, radius) = place(patch);
            if frustum.is_some_and(|frustum| {
                !frustum.contains_sphere(centre[0], centre[1], centre[2], radius)
            }) {
                continue;
            }
            let distance = rule.distance(centre, radius);
            if self.draws(patch, reach, distance, |parent| {
                let (centre, radius) = place(parent);
                rule.distance(centre, radius)
            }) {
                pick(patch);
            }
        }
    }

    /// The tree's triangles, every patch's added up, against the mesh's own.
    pub fn triangles(&self) -> u32 {
        self.indices.len() as u32 / 3
    }
}

/// The trees of the meshes, by the mesh's engine id minus one.
#[derive(Clone, Debug, Default)]
pub struct PatchStorage {
    trees: Vec<Option<PatchTree>>,
}

impl PatchStorage {
    /// Gives mesh `mesh` the tree `tree`, or takes its tree away with `None`.
    pub fn set(&mut self, mesh: u32, tree: Option<PatchTree>) {
        let Some(index) = mesh.checked_sub(1).map(|mesh| mesh as usize) else {
            return;
        };
        if self.trees.len() <= index {
            if tree.is_none() {
                return;
            }
            self.trees.resize(index + 1, None);
        }
        self.trees[index] = tree;
    }

    /// The tree of mesh `mesh`, or `None` for a mesh without one.
    pub fn of(&self, mesh: u32) -> Option<&PatchTree> {
        self.trees.get(mesh.checked_sub(1)? as usize)?.as_ref()
    }

    /// Appends one band to the tree of mesh `mesh`, which a model streams after the file drew its
    /// root patches. `None` when the mesh has no tree: a band refines the tree that the file holds,
    /// so a mesh without one keeps nothing.
    pub fn append(
        &mut self,
        mesh: u32,
        bounds: &[[f32; 4]],
        records: &[[u32; 4]],
        indices: &[u32],
        vertices: u32,
    ) -> Option<Result<(), PatchError>> {
        let index = mesh.checked_sub(1)? as usize;
        let tree = self.trees.get_mut(index)?.as_mut()?;
        Some(tree.append(bounds, records, indices, vertices))
    }

    /// True while some mesh has a tree.
    pub fn any(&self) -> bool {
        self.trees.iter().any(Option::is_some)
    }

    /// The meshes with a tree and their trees.
    pub fn iter(&self) -> impl Iterator<Item = (u32, &PatchTree)> + '_ {
        self.trees
            .iter()
            .enumerate()
            .filter_map(|(k, tree)| Some((k as u32 + 1, tree.as_ref()?)))
    }

    /// Takes the trees of the removed meshes away, where `live` says whether an engine mesh id
    /// names a live mesh.
    pub fn forget_removed(&mut self, live: impl Fn(u32) -> bool) {
        for (k, tree) in self.trees.iter_mut().enumerate() {
            if tree.is_some() && !live(k as u32 + 1) {
                *tree = None;
            }
        }
    }
}

/// What the pick count of a band needs of a view: the view's frame, the rule that picks its levels
/// and patches, the offsets of the scene's cells from the view's camera, and the frame's number.
pub(crate) struct BandView<'a> {
    pub view: &'a ViewFrame,
    pub rule: LevelRule,
    pub offsets: &'a [[f32; 4]],
    pub frame: u64,
}

/// Notes, for each mesh that a loader watches, the bands whose patches a view draws this frame, so
/// that the loader holds a band until the band above it drew. A mesh that the scene holds no
/// source of restarts its warm-up, as a level does, so a page that loads a model before it
/// instantiates it keeps its bands.
///
/// A patch that the tree's walk picks for the view is a pick, as it is for the walk that fills the
/// view's patch runs ([`PatchTree::walk`]). The count reads the tree of each watched mesh alone, and a frame with no loader waiting
/// pays nothing. A mesh whose tree the path does not draw picks no band, so its bands wait.
pub(crate) fn note_stage_bands(
    scene: &SceneStorage,
    parity: usize,
    view: &BandView<'_>,
    patches: &PatchStorage,
    watches: &mut StageWatches,
    draws_tree: impl Fn(u32) -> bool,
) {
    if watches.is_empty() {
        return;
    }
    let mut slots = scene.slots().high_water() as usize;
    slots = slots.min(scene.meshes().len());
    let meshes = &scene.meshes()[..slots];
    watches.hold(view.frame, |mesh| meshes.contains(&mesh));
    let placed = view.offsets;
    let world = scene.world(parity);
    let matrices = world.matrices();
    let cells = scene.cells();
    for index in 0..watches.len() {
        let mesh = watches.mesh_at(index);
        let Some(tree) = patches.of(mesh) else {
            continue;
        };
        // A path that draws the mesh whole draws no patch, so a band it could not draw waits.
        if !draws_tree(mesh) {
            watches.note_bands(index, 0);
            continue;
        }
        let mut picked = 0u32;
        for (slot, &slot_mesh) in meshes.iter().enumerate() {
            if slot_mesh != mesh {
                continue;
            }
            let cell = cells.get(slot).copied().unwrap_or(0);
            let offset = placed.get(cell as usize).copied().unwrap_or([0.0; 4]);
            let Some(matrix) = matrices
                .get(slot * MATRIX_FLOATS..(slot + 1) * MATRIX_FLOATS)
                .and_then(|values| values.try_into().ok())
            else {
                continue;
            };
            tree.walk(
                matrix,
                [offset[0], offset[1], offset[2]],
                &view.rule,
                Some(&view.view.frustum),
                |patch| picked |= 1 << tree.band(patch).min(31),
            );
        }
        watches.note_bands(index, picked);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tree of four patches: the root 0 above the leaves 1 and 3, and 2 between 0 and 3.
    fn tree() -> PatchTree {
        let bits = |value: f32| value.to_bits();
        PatchTree::new(
            vec![0, 1, 2, 3, 4, 5, 0, 1, 2, 6, 7, 8, 2, 3, 4, 6, 7, 8],
            vec![[0.0; 4]; 4],
            vec![
                [0, 3, 0, bits(0.1)],
                [3, 3, 1, bits(0.0)],
                [9, 3, 1, bits(0.01)],
                [12, 6, 3, bits(0.0)],
            ],
            0,
            9,
        )
        .expect("tree")
    }

    /// The patches that draw when every patch lies `distance` from the camera, at a reach of
    /// `reach`.
    fn cut(tree: &PatchTree, reach: f32, distance: f32) -> Vec<u32> {
        (0..tree.len() as u32)
            .filter(|&patch| tree.draws(patch, reach, distance, |_| distance))
            .collect()
    }

    #[test]
    fn a_tree_refuses_records_and_indices_that_name_nothing() {
        let bits = 0.0f32.to_bits();
        let bounds = vec![[0.0; 4]; 1];
        assert_eq!(
            PatchTree::new(vec![], bounds.clone(), vec![], 0, 3),
            Err(PatchError::Empty)
        );
        assert_eq!(
            PatchTree::new(vec![0, 1, 2], bounds.clone(), vec![[0, 3, 0, bits]], 1, 3),
            Err(PatchError::Root)
        );
        assert_eq!(
            PatchTree::new(vec![0, 1, 2], bounds.clone(), vec![[0, 4, 0, bits]], 0, 3),
            Err(PatchError::Record)
        );
        assert_eq!(
            PatchTree::new(vec![0, 1, 2], bounds.clone(), vec![[0, 3, 1, bits]], 0, 3),
            Err(PatchError::Parent)
        );
        assert_eq!(
            PatchTree::new(vec![0, 1, 9], bounds, vec![[0, 3, 0, bits]], 0, 3),
            Err(PatchError::Vertex)
        );
    }

    #[test]
    fn the_root_draws_far_and_the_walk_descends_near() {
        let tree = tree();
        assert_eq!(tree.root(), 0);
        assert_eq!(tree.parent(0), None);
        assert_eq!(tree.parent(1), Some(0));
        assert_eq!(tree.parent(3), Some(2));
        // At a factor of 100, the root's 0.1 m error covers a pixel past 10 m, and patch 2's
        // 0.01 m error past 1 m. The leaves are exact at every distance.
        let draws = |distance: f32| cut(&tree, 100.0, distance);
        // Far out, the root draws alone.
        assert_eq!(draws(11.0), [0]);
        // Nearer, its children draw, and nearer still, patch 2 gives way to its own child.
        assert_eq!(draws(5.0), [1, 2]);
        assert_eq!(draws(0.5), [1, 3]);
        // Every patch of a cut draws in place of its parent, so a cut never leaves a gap.
        for distance in [0.05, 0.2, 1.0, 2.5, 9.0, 12.0, 100.0] {
            let drawn = draws(distance);
            assert!(!drawn.is_empty(), "{distance}");
            for patch in 1..tree.len() as u32 {
                if drawn.contains(&patch) {
                    let parent = tree.parent(patch).expect("a non-root patch");
                    assert!(!drawn.contains(&parent), "{distance} {patch}");
                }
            }
        }
    }

    #[test]
    fn a_band_appends_below_the_tree_and_names_the_parents_it_finds() {
        let mut tree = tree();
        assert_eq!(tree.band_count(), 1);
        // Two patches whose parents are patches 1 and 3, at the tree's own indices' end.
        let bounds = vec![[0.0; 4]; 2];
        let records = vec![[0, 3, 2, 0], [3, 3, 4, 0]];
        tree.append(&bounds, &records, &[0, 1, 2, 3, 4, 5], 9)
            .expect("the band fits");
        assert_eq!(tree.len(), 6);
        assert_eq!(tree.band_count(), 2);
        assert_eq!((tree.band(0), tree.band(3), tree.band(4)), (0, 0, 1));
        // A run's first index counts from the band's own indices, so the tree's indices just grew.
        assert_eq!(tree.run(4), Some((18, 3)));
        assert_eq!(tree.parent(4), Some(1));
        assert_eq!(tree.parent(5), Some(3));
    }

    #[test]
    fn a_tree_refuses_a_parent_that_does_not_hold_its_child_or_errs_less() {
        let bits = |value: f32| value.to_bits();
        let records = vec![[0, 3, 0, bits(1.0)], [0, 3, 1, bits(0.0)]];
        let build = |bounds: Vec<[f32; 4]>, records: Vec<[u32; 4]>| {
            PatchTree::new(vec![0, 1, 2], bounds, records, 0, 3)
        };
        // The child's sphere reaches past its parent's, as a sphere around the patch's own
        // triangles may.
        assert_eq!(
            build(
                vec![[0.0, 0.0, 0.0, 1.0], [0.5, 0.0, 0.0, 0.6]],
                records.clone()
            ),
            Err(PatchError::Nesting)
        );
        // The child errs more than its parent.
        let inside = vec![[0.0, 0.0, 0.0, 1.0], [0.5, 0.0, 0.0, 0.5]];
        assert_eq!(
            build(
                inside.clone(),
                vec![[0, 3, 0, bits(0.1)], [0, 3, 1, bits(0.2)]]
            ),
            Err(PatchError::Nesting)
        );
        let mut tree = build(inside, records).expect("a nested tree");
        // A band whose patch reaches past its parent leaves the tree as it was.
        let before = tree.clone();
        assert_eq!(
            tree.append(&[[2.0, 0.0, 0.0, 0.1]], &[[0, 3, 2, 0]], &[0, 1, 2], 3),
            Err(PatchError::Nesting)
        );
        assert_eq!(tree, before);
    }

    #[test]
    fn a_parent_passes_at_its_own_sphere_and_not_at_its_childs() {
        let bits = |value: f32| value.to_bits();
        // A wide parent and a small child at its far edge: the camera stands 10 m from the child
        // and 1 m from the parent's sphere.
        let tree = PatchTree::new(
            vec![0, 1, 2],
            vec![[0.0, 0.0, 0.0, 10.0], [9.0, 0.0, 0.0, 1.0]],
            vec![[0, 3, 0, bits(0.05)], [0, 3, 1, bits(0.0)]],
            0,
            3,
        )
        .expect("a nested tree");
        let distance = |patch: u32| if patch == 0 { 1.0 } else { 10.0 };
        // At a reach of 100, the parent's 5 m of error do not pass at its own 1 m, so the child
        // draws. Tested at the child's 10 m, the parent would pass, and nothing would draw there.
        assert!(tree.draws(1, 100.0, distance(1), distance));
        assert!(!tree.draws(0, 100.0, distance(0), distance));
    }

    /// A tree whose root is above two children, with no band below them yet.
    fn partial() -> PatchTree {
        let bits = |value: f32| value.to_bits();
        PatchTree::new(
            vec![0, 1, 2, 3, 4, 5, 0, 1, 2, 6, 7, 8],
            vec![[0.0; 4]; 3],
            vec![
                [0, 3, 0, bits(10.0)],
                [3, 3, 1, bits(5.0)],
                [6, 6, 1, bits(5.0)],
            ],
            0,
            9,
        )
        .expect("tree")
    }

    #[test]
    fn a_patch_whose_children_have_not_arrived_draws_where_the_camera_is_close() {
        let mut tree = partial();
        // Close in, both the root and its children err past the threshold, so only the frontier
        // rule covers the surface: the children draw instead of leaving a hole.
        assert_eq!(cut(&tree, 100.0, 1.0).len(), 2);
        assert_eq!(tree.rule_error(1), -1.0);
        assert_eq!(tree.rule_error(0), 10.0);
        // A band below them arrives, so the children keep their own errors and the new patches
        // become the frontier.
        tree.append(
            &[[0.0; 4]; 4],
            &[[0, 3, 2, 0], [3, 3, 2, 0], [6, 3, 3, 0], [9, 3, 3, 0]],
            &[0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2],
            9,
        )
        .expect("the band fits");
        assert_eq!(tree.rule_error(1), 5.0);
        assert_eq!(tree.rule_error(3), -1.0);
        // Close in, the four patches below the root draw, and the root does not.
        assert_eq!(cut(&tree, 100.0, 1.0).len(), 4);
    }

    #[test]
    fn a_band_that_names_a_later_patch_or_another_mesh_leaves_the_tree_as_it_was() {
        let mut tree = tree();
        let before = tree.clone();
        let bounds = vec![[0.0; 4]; 2];
        // The second patch names its own place as its parent, which the tree does not hold yet.
        let later = vec![[0, 3, 0, 0], [3, 3, 6, 0]];
        assert_eq!(
            tree.append(&bounds, &later, &[0, 1, 2, 3, 4, 5], 9),
            Err(PatchError::Parent)
        );
        // A patch names itself.
        assert_eq!(
            tree.append(
                &bounds,
                &[[0, 3, 6, 0], [3, 3, 0, 0]],
                &[0, 1, 2, 3, 4, 5],
                9
            ),
            Err(PatchError::Parent)
        );
        // A run past the band's own indices, and an index past the mesh's vertices.
        assert_eq!(
            tree.append(
                &bounds,
                &[[0, 9, 2, 0], [3, 3, 4, 0]],
                &[0, 1, 2, 3, 4, 5],
                9
            ),
            Err(PatchError::Record)
        );
        assert_eq!(
            tree.append(
                &bounds,
                &[[0, 3, 2, 0], [3, 3, 4, 0]],
                &[0, 1, 10, 3, 4, 5],
                9
            ),
            Err(PatchError::Vertex)
        );
        assert_eq!(
            tree.append(
                &bounds,
                &[[0, 3, 2, 0], [3, 3, 4, 0]],
                &[0, 1, 2, 3, 4, 5],
                5
            ),
            Err(PatchError::Vertex)
        );
        assert_eq!(tree.append(&[], &[], &[], 9), Err(PatchError::Empty));
        assert_eq!(tree, before);
    }

    #[test]
    fn the_storage_keeps_a_tree_by_mesh_and_forgets_removed_meshes() {
        let mut storage = PatchStorage::default();
        assert!(!storage.any());
        storage.set(2, Some(tree()));
        assert!(storage.any());
        assert!(storage.of(2).is_some() && storage.of(1).is_none());
        assert_eq!(
            storage.iter().map(|(mesh, _)| mesh).collect::<Vec<_>>(),
            [2]
        );
        storage.forget_removed(|mesh| mesh != 2);
        assert!(storage.of(2).is_none());
        assert!(!storage.any());
    }
}
