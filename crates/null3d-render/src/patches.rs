//! Trees of cluster patches: the patches that a large static mesh draws instead of its whole
//! triangle list, from the asset tool (`NULL3D_clusters`).
//!
//! A patch holds a run of the tree's indices, a sphere around the triangles it draws, and an
//! error: the largest distance between its surface and the surface of the patches below it, in
//! the units of the mesh's positions. The patch above it in the tree replaces its children, so
//! every patch's triangles lie inside the area that its children's triangles cover. A view draws
//! a patch while the patch's error passes its threshold and its parent's does not, which makes
//! the patches that draw cover the mesh once, whatever the distance: a patch whose error fails is
//! too coarse for that distance, and the walk goes on into its children.
//!
//! Every patch's indices name the mesh's own vertices, so a tree adds no vertex and every patch
//! draws with the mesh's pipelines as they are.

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
        let tree = Self {
            indices,
            bounds,
            records,
            root,
        };
        tree.check(vertices)?;
        Ok(tree)
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
            if parent as usize == k + 1 {
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

    /// The patch above `patch`, or `None` for the root.
    pub fn parent(&self, patch: u32) -> Option<u32> {
        match self.records.get(patch as usize)?[2] {
            0 => None,
            parent => Some(parent - 1),
        }
    }

    /// True when patch `patch` draws at `distance` from the view's camera, with a world scale of
    /// `scale` and the rule's factor of `factor`: its own error passes, and its parent's, which
    /// would otherwise draw in its place, does not.
    pub fn draws(&self, patch: u32, factor: f32, scale: f32, distance: f32) -> bool {
        let reach = scale * factor;
        let fits = self.error(patch) * reach < distance;
        let parent_fits = self
            .parent(patch)
            .is_some_and(|parent| self.error(parent) * reach < distance);
        fits && !parent_fits
    }

    /// The number of patches that draw at `distance`, which a test counts to check a cut.
    pub fn cut(&self, factor: f32, scale: f32, distance: f32) -> usize {
        (0..self.len() as u32)
            .filter(|&patch| self.draws(patch, factor, scale, distance))
            .count()
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
        let draws = |distance: f32| {
            (0..tree.len() as u32)
                .filter(|&patch| tree.draws(patch, 100.0, 1.0, distance))
                .collect::<Vec<_>>()
        };
        // Far out, the root draws alone.
        assert_eq!(draws(11.0), [0]);
        // Nearer, its children draw, and nearer still, patch 2 gives way to its own child.
        assert_eq!(draws(5.0), [1, 2]);
        assert_eq!(draws(0.5), [1, 3]);
        assert_eq!(tree.cut(100.0, 1.0, 11.0), 1);
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
