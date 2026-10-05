//! The sources of the transparent pass, which both frame builders share: the scene objects and
//! the batch rows whose material blends. They leave the opaque buckets, and each frame the job
//! workers cull them and sort them back to front for each view (see
//! [`null3d_core::depth_sort`]).
//!
//! # Buckets
//!
//! A sorted bucket is one pipeline, map group, mesh, material and data texture, as an opaque
//! bucket is. It holds no slice of its own: a frame's sort decides where its rows go.
//!
//! # Each frame
//!
//! [`SortedLayout::gather`] copies the spheres, cells, layer masks and render orders of the
//! blended scene objects into arrays of their own, once per frame. Culling then reads as many
//! spheres as there are blended objects, not the whole scene. The rows of a batch whose material
//! blends are culled in place, and have render order 0. [`SortedLayout::sort`] culls and sorts the
//! rows for one view, then groups them into draws: runs of neighbors in the sorted order that share
//! a bucket. Each such run draws with one instanced draw per part of its bucket's mesh, so a batch
//! of blended rows alone in its view draws in one draw per part, whatever its order.
//!
//! # Memory
//!
//! The layout reserves every per-frame list when the scene's structure changes, and each view's
//! output when the view first sorts after that, so a frame's sort allocates nothing.

use std::collections::TryReserveError;

use null3d_core::cells::{CELL_SHIFT, ORIGIN_CELL};
use null3d_core::culling::{
    BY_ROW, CULL_CHUNK, CullRun, CullSet, CullView, ROW_CELLS, SetLayers, SetOrder,
};
use null3d_core::depth_sort::{DepthSorted, SortSet, cull_and_sort, split_item};
use null3d_core::handle::Handle;
use null3d_core::instances::{BatchTable, InstanceBatch};
use null3d_core::jobs::JobSystem;
use null3d_core::occlusion::OcclusionBuffer;
use null3d_core::scene::{SceneStorage, flags};
use null3d_core::world::SphereArrays;

use crate::frame::{
    CellOffsets, RunCells, SceneSettings, bucket_of, collect_bucket_keys, push_runs,
};
use crate::pipelines::{DrawKey, PassTargets, PipelineCache};
use crate::view::ViewFrame;

/// What makes a sorted bucket: what the mesh and material ask of their pipeline, the bind group of
/// the material's map, the vertex page of the mesh's first part, the engine mesh and material ids,
/// and the data texture of the rows, which only the WebGL2 builder tells apart.
type SortedKey = (DrawKey, u32, u32, u32, u32, u32);

/// A sentinel for a scene slot or batch that the transparent pass does not draw.
const NOT_SORTED: u32 = u32::MAX;
/// The bit of a sorted bucket's group that marks a skinned object's bucket of its own, whose slot
/// the bits below hold.
const SKINNED_GROUP: u32 = 1 << 31;

/// One sorted bucket.
#[derive(Clone, Copy, Debug)]
pub(crate) struct SortedBucket {
    /// The id of its render pipeline.
    pub(crate) pipeline: u32,
    /// The bind group of its material's map, or 0 for a pipeline that reads none.
    pub(crate) textures: u32,
    /// The engine mesh id, which gives the parts it draws.
    pub(crate) mesh: u32,
    /// The engine material id.
    pub(crate) material: u32,
    /// The data texture its rows come from, where the builder has several, or a skinned object's
    /// slot with [`SKINNED_GROUP`].
    pub(crate) group: u32,
}

impl SortedBucket {
    /// The scene slot of the skinned object whose bucket this is, or `None` for a bucket that
    /// draws no skinned object.
    pub(crate) fn skinned_slot(&self) -> Option<u32> {
        (self.group & SKINNED_GROUP != 0).then_some(self.group & !SKINNED_GROUP)
    }
}

/// How a scene object draws in the transparent pass by its skinning, as a builder's `skin`
/// function gives it for the pipeline of the object's pair.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SkinnedPipeline {
    /// The object is not skinned, and draws with its pair's pipeline.
    NotSkinned,
    /// The object is skinned, and draws from a bucket of its own with this pipeline.
    Drawn(DrawKey),
    /// The object is skinned, and draws nothing until this pipeline is built, with the others that
    /// skin and draw skinned objects (see [`crate::skinning::SkinnedGate`]).
    Waiting(DrawKey),
}

/// A batch whose material blends: its handle, its bucket, and the place of its first row in the
/// builder's data, where it has one.
#[derive(Clone, Copy, Debug)]
struct SortedBatch {
    id: Handle,
    bucket: u32,
    base: u32,
}

/// Neighbors in a view's sorted order that share a bucket: `count` rows from row `first` of the
/// order on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SortedDraw {
    pub(crate) bucket: u32,
    pub(crate) first: u32,
    pub(crate) count: u32,
}

/// Where a sorted row's data lives.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SortedSource {
    /// A scene object, by its slot.
    Scene(u32),
    /// A row of a batch, by the batch's handle and the row.
    Batch(Handle, u32),
}

/// One row of a view's sorted order, as a builder draws it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SortedRow {
    pub(crate) bucket: u32,
    pub(crate) source: SortedSource,
    /// The row's grid cell.
    pub(crate) cell: u32,
    /// The row's place in the builder's data plus its cell above [`CELL_SHIFT`]: a scene
    /// object's slot, or a batch's base plus the row.
    pub(crate) entry: u32,
}

/// A view's sorted rows and their draws, which the frame that sorted them draws.
#[derive(Debug, Default)]
pub(crate) struct SortedView {
    sorted: DepthSorted,
    draws: Vec<SortedDraw>,
    /// The offset from the view's camera to each cell in use, for the frame that sorted.
    offsets: CellOffsets,
}

impl SortedView {
    /// The visible rows' items, sorted back to front. [`SortedLayout::row`] reads each one.
    pub(crate) fn items(&self) -> &[u32] {
        self.sorted.items()
    }

    /// The runs of sorted rows that share a bucket, in draw order.
    pub(crate) fn draws(&self) -> &[SortedDraw] {
        &self.draws
    }

    /// The offset from the view's camera to each cell in use, in the frame that sorted.
    pub(crate) fn offsets(&self) -> &CellOffsets {
        &self.offsets
    }

    /// Forgets the rows and their draws, for a frame whose view has no camera or no blended rows.
    fn clear(&mut self) {
        self.sorted.clear();
        self.draws.clear();
    }
}

/// The transparent pass's buckets and sources, and the per-frame arrays that culling reads.
#[derive(Debug, Default)]
pub(crate) struct SortedLayout {
    pub(crate) buckets: Vec<SortedBucket>,
    /// The blended scene objects' slots, in slot order, and each one's bucket.
    scene_slots: Vec<u32>,
    scene_buckets: Vec<u32>,
    batches: Vec<SortedBatch>,
    /// Scratch for rebuilds: every sorted key with its source count, sorted and merged.
    key_counts: Vec<(SortedKey, u32)>,
    /// The pipelines of the skinned objects that the layout leaves out until they are built.
    waiting: Vec<u32>,
    /// The rows that can draw: blended scene objects, and blended batches' capacities.
    rows: u32,
    /// The most runs of rows that a frame's sort takes.
    runs_room: u32,
    /// The most draws that a frame's sort can make: every row alone, apart from those of the
    /// largest bucket, which can at most sit between the others'.
    draws_room: u32,
    /// The most parts of any sorted bucket's mesh.
    most_parts: u32,
    /// The frame's culling runs, and the scene objects' arrays that they read.
    runs: Vec<CullRun>,
    xs: Vec<f32>,
    ys: Vec<f32>,
    zs: Vec<f32>,
    radii: Vec<f32>,
    cells: Vec<u32>,
    layers: Vec<u32>,
    orders: Vec<f32>,
    /// The mask of every blended scene object in this frame, when they all share one.
    common_layers: Option<u32>,
}

impl SortedLayout {
    /// The pipelines of the skinned objects that the layout leaves out, which must be built before
    /// they draw.
    pub(crate) fn waiting(&self) -> &[u32] {
        &self.waiting
    }

    /// True when some mesh and material pair blends, so the transparent pass has work.
    pub(crate) fn is_empty(&self) -> bool {
        self.buckets.is_empty()
    }

    /// The rows that can draw in the transparent pass.
    pub(crate) fn rows(&self) -> u32 {
        self.rows
    }

    /// The most draws, runs of rows in one bucket, that one view's frame can make.
    pub(crate) fn draws_room(&self) -> u32 {
        self.draws_room
    }

    /// The scene slots whose objects draw in the transparent pass, in slot order.
    pub(crate) fn scene_slots(&self) -> &[u32] {
        &self.scene_slots
    }

    /// The most parts of any sorted bucket's mesh, each of which a draw draws apart.
    pub(crate) fn most_parts(&self) -> u32 {
        self.most_parts
    }

    /// Finds every scene object and batch whose mesh and material pair blends, and gives each
    /// key a bucket, with its pipeline id from `pipelines` for a pass that draws into `targets`.
    /// `place` gives a batch's first row in the builder's data and its data texture. While
    /// `shadows` is true, scene objects that receive shadows draw with pipelines that read the
    /// shadow map. `skin` says how each scene object draws by its skinning: a skinned object that
    /// waits gets no bucket, and the layout asks only for its pipeline (see [`Self::waiting`]). The
    /// layout then reserves every list that a frame's sort takes.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn rebuild(
        &mut self,
        settings: &SceneSettings,
        pipelines: &mut PipelineCache,
        targets: PassTargets,
        scene: &SceneStorage,
        batches: &BatchTable,
        place: impl Fn(usize, &InstanceBatch) -> (u32, u32),
        resident: u32,
        shadows: bool,
        skin: impl Fn(usize, DrawKey) -> SkinnedPipeline,
    ) -> Result<(), TryReserveError> {
        let meshes = settings.meshes();
        let key_of = |mesh: u32, material: u32, group: u32, object: u32| -> Option<SortedKey> {
            let pipeline = settings.pipeline_of(mesh, material)?;
            if !pipeline.blends() {
                return None;
            }
            let pipeline = if shadows && object & flags::RECEIVE_SHADOWS != 0 {
                settings.receiving(pipeline)
            } else {
                pipeline
            };
            let textures = settings.texture_group(material, pipeline);
            let page = meshes.parts(meshes.mesh(mesh - 1)?).first()?.page;
            Some((pipeline, textures, page, mesh, material, group))
        };
        // A skinned object draws from a bucket of its own, with the pipeline that `skin` gives.
        let pair_key = |slot: usize| {
            let (mesh, material) = (scene.meshes()[slot], scene.materials()[slot]);
            key_of(mesh, material, resident, scene.flags()[slot])
        };
        let scene_key = |slot: usize| {
            let key = pair_key(slot)?;
            match skin(slot, key.0) {
                SkinnedPipeline::NotSkinned => Some(key),
                SkinnedPipeline::Drawn(skinned) => Some((
                    skinned,
                    key.1,
                    key.2,
                    key.3,
                    key.4,
                    SKINNED_GROUP | slot as u32,
                )),
                SkinnedPipeline::Waiting(_) => None,
            }
        };
        // Instance batches receive no shadows yet.
        let batch_key = |index: usize, batch: &InstanceBatch| {
            key_of(batch.mesh(), batch.material(), place(index, batch).1, 0)
        };
        collect_bucket_keys(&mut self.key_counts, scene, batches, scene_key, batch_key);

        self.waiting.clear();
        for slot in 0..scene.capacity() as usize + 1 {
            if let Some(key) = pair_key(slot)
                && let SkinnedPipeline::Waiting(skinned) = skin(slot, key.0)
            {
                self.waiting.try_reserve(1)?;
                self.waiting.push(pipelines.id(skinned.in_pass(targets)));
            }
        }

        self.buckets.clear();
        let (mut total, mut largest, mut most_parts) = (0u32, 0u32, 1u32);
        for &((pipeline, textures, _, mesh, material, group), count) in &self.key_counts {
            let slot = meshes.mesh(mesh - 1).expect("keys name known meshes");
            most_parts = most_parts.max(meshes.parts(slot).len() as u32);
            self.buckets.push(SortedBucket {
                pipeline: pipelines.id(pipeline.in_pass(targets)),
                textures,
                mesh,
                material,
                group,
            });
            total = total.saturating_add(count);
            largest = largest.max(count);
        }

        let counts = &self.key_counts;
        let bucket_of = |key: Option<SortedKey>| bucket_of(counts, key).unwrap_or(NOT_SORTED);
        let scene_rows = scene.capacity() as usize + 1;
        self.scene_slots.clear();
        self.scene_buckets.clear();
        for slot in 0..scene_rows {
            let bucket = bucket_of(scene_key(slot));
            if bucket != NOT_SORTED {
                self.scene_slots.try_reserve(1)?;
                self.scene_buckets.try_reserve(1)?;
                self.scene_slots.push(slot as u32);
                self.scene_buckets.push(bucket);
            }
        }
        self.batches.clear();
        let mut runs = (self.scene_slots.len() as u32).div_ceil(CULL_CHUNK);
        for (index, (id, batch)) in batches.iter().enumerate() {
            let bucket = bucket_of(batch_key(index, batch));
            if bucket != NOT_SORTED {
                self.batches.try_reserve(1)?;
                self.batches.push(SortedBatch {
                    id,
                    bucket,
                    base: place(index, batch).0,
                });
                runs += batch.capacity().div_ceil(CULL_CHUNK);
            }
        }
        self.rows = total;
        self.runs_room = runs;
        self.draws_room = if total == 0 {
            0
        } else {
            total.min(2 * (total - largest) + 1)
        };
        self.most_parts = most_parts;

        let objects = self.scene_slots.len();
        self.runs.clear();
        self.runs.try_reserve(runs as usize)?;
        for list in [
            &mut self.xs,
            &mut self.ys,
            &mut self.zs,
            &mut self.radii,
            &mut self.orders,
        ] {
            list.clear();
            list.try_reserve(objects)?;
            list.resize(objects, 0.0);
        }
        for list in [&mut self.cells, &mut self.layers] {
            list.clear();
            list.try_reserve(objects)?;
            list.resize(objects, 0);
        }
        Ok(())
    }

    /// Makes a view's output hold the layout's rows and draws.
    pub(crate) fn reserve_view(&self, view: &mut SortedView) -> Result<(), TryReserveError> {
        view.sorted.try_reserve(self.rows, self.runs_room)?;
        let draws = self.draws_room as usize;
        view.draws
            .try_reserve(draws.saturating_sub(view.draws.len()))
    }

    /// Copies the blended scene objects' spheres, cells, layer masks and render orders into the
    /// layout's arrays, and lists the frame's culling runs: the scene objects', then each blended
    /// batch's active rows. Every view's sort reads them. The runs fit the room that
    /// [`SortedLayout::rebuild`] reserved, so the list fails to grow only after a rebuild failed.
    pub(crate) fn gather(
        &mut self,
        scene: &SceneStorage,
        batches: &BatchTable,
        parity: usize,
    ) -> Result<(), TryReserveError> {
        self.runs.clear();
        if self.is_empty() {
            return Ok(());
        }
        let spheres = scene.world(parity).spheres();
        let (cells, layers, orders) = (scene.cells(), scene.layers(), scene.render_orders());
        for (k, &slot) in self.scene_slots.iter().enumerate() {
            let slot = slot as usize;
            self.xs[k] = spheres.xs[slot];
            self.ys[k] = spheres.ys[slot];
            self.zs[k] = spheres.zs[slot];
            self.radii[k] = spheres.radii[slot];
            self.cells[k] = cells[slot];
            self.layers[k] = layers[slot];
            self.orders[k] = orders[slot];
        }
        self.common_layers = scene.common_layers();
        let objects = self.scene_slots.len() as u32;
        let scene_cells = if scene.cell_table().origin_only() {
            RunCells::One(ORIGIN_CELL)
        } else {
            RunCells::Rows(&self.cells)
        };
        push_runs(&mut self.runs, 0, 0..objects, BY_ROW, 0, scene_cells)?;
        for (k, sorted) in self.batches.iter().enumerate() {
            let batch = batches
                .get(sorted.id)
                .expect("the layout names live batches");
            let active = batch.frame_active_count(parity);
            let cells = batch
                .common_cell()
                .map_or(RunCells::Rows(batch.cells()), RunCells::One);
            let set = k as u32 + 1;
            push_runs(
                &mut self.runs,
                set,
                0..active,
                sorted.bucket,
                sorted.base,
                cells,
            )?;
        }
        Ok(())
    }

    /// Culls and sorts the frame's rows for a view on the calling thread and the job workers, and
    /// groups the sorted rows into draws. A view with no camera draws none. Rows that `occlusion`
    /// hides behind the view's blockers draw neither.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn sort(
        &self,
        jobs: &JobSystem,
        frame: Option<&ViewFrame>,
        occlusion: Option<&OcclusionBuffer>,
        scene: &SceneStorage,
        batches: &BatchTable,
        parity: usize,
        out: &mut SortedView,
    ) {
        out.clear();
        let Some(frame) = frame else {
            return;
        };
        if self.runs.is_empty() {
            return;
        }
        out.offsets.update(scene, &frame.camera);
        let scene_layers = self
            .common_layers
            .map_or(SetLayers::Rows(&self.layers), SetLayers::All);
        let batch_sets: &[SortedBatch] = &self.batches;
        let sets = |set: u32| -> SortSet<'_> {
            if set == 0 {
                return SortSet {
                    rows: CullSet {
                        spheres: SphereArrays {
                            xs: &self.xs,
                            ys: &self.ys,
                            zs: &self.zs,
                            radii: &self.radii,
                        },
                        cells: &self.cells,
                        order: SetOrder::Rows,
                        layers: scene_layers,
                    },
                    orders: Some(&self.orders),
                };
            }
            let batch = batches
                .get(batch_sets[set as usize - 1].id)
                .expect("the layout names live batches");
            SortSet {
                rows: CullSet {
                    spheres: batch.world(parity).spheres(),
                    cells: batch.cells(),
                    order: SetOrder::Rows,
                    layers: SetLayers::All(batch.layers()),
                },
                orders: None,
            }
        };
        let view = CullView {
            frustum: &frame.frustum,
            offsets: out.offsets.as_slice(),
            layers: frame.layers,
            occlusion,
        };
        // Reversed depth swaps the frustum's near and far planes, so the near plane comes last.
        // Its normal points into the view, and it never degenerates, as an infinite far plane
        // does.
        let near = frame.frustum.planes()[5];
        cull_and_sort(jobs, view, near, &sets, &self.runs, &mut out.sorted);

        let draws = &mut out.draws;
        for (k, &item) in out.sorted.items().iter().enumerate() {
            let bucket = self.bucket_of_item(item);
            match draws.last_mut() {
                Some(last) if last.bucket == bucket => last.count += 1,
                _ => draws.push(SortedDraw {
                    bucket,
                    first: k as u32,
                    count: 1,
                }),
            }
        }
    }

    /// The bucket of a sorted item.
    fn bucket_of_item(&self, item: u32) -> u32 {
        let (run, offset) = split_item(item);
        let run = &self.runs[run];
        if run.bucket == BY_ROW {
            self.scene_buckets[(run.start + offset) as usize]
        } else {
            run.bucket
        }
    }

    /// A sorted item of this frame's order: its bucket, where its data lives, its cell, and its
    /// entry in the builder's data.
    pub(crate) fn row(&self, item: u32, batches: &BatchTable) -> SortedRow {
        let (run, offset) = split_item(item);
        let run = self.runs[run];
        let row = run.start + offset;
        if run.set == 0 {
            let (slot, cell) = (self.scene_slots[row as usize], self.cells[row as usize]);
            return SortedRow {
                bucket: self.scene_buckets[row as usize],
                source: SortedSource::Scene(slot),
                cell,
                entry: slot | (cell << CELL_SHIFT),
            };
        }
        let batch = self.batches[run.set as usize - 1];
        let cell = if run.cell == ROW_CELLS {
            batches
                .get(batch.id)
                .expect("the layout names live batches")
                .cells()[row as usize]
        } else {
            run.cell
        };
        SortedRow {
            bucket: batch.bucket,
            source: SortedSource::Batch(batch.id, row),
            cell,
            entry: (batch.base + row) | (cell << CELL_SHIFT),
        }
    }
}
