//! The WebGPU frame builder: the GPU culls every object and instance itself, and the CPU replays
//! one prerecorded render bundle. Each frame records a draw list that uploads what changed, runs
//! the culling compute pass and executes the bundle; the render worker replays the list.
//!
//! # Sources and buckets
//!
//! Every scene slot and every row of every instance batch is a source: one world matrix in the
//! matrix buffer, at `base + row`, where scene slots come first and each batch follows at its
//! base. A bucket is one pipeline, mesh and material. Each drawable source belongs to one bucket;
//! the rest are hidden. A bucket owns a slice of the compacted instance buffer, as large as the
//! number of sources it has, and one indexed indirect draw. The culling shader appends each
//! visible source to its bucket's slice and counts it in the bucket's draw, and the bundle draws
//! every bucket with its slice bound at vertex slot 1, so the draws' first instance stays 0.
//!
//! Buckets change only with the scene's structure: objects created or destroyed, meshes or
//! materials changed, batches created or destroyed. The caller says when that happened; the
//! builder then rebuilds the bucket tables and re-records the bundle, and uploads every matrix
//! once. A bucket holds every object with its mesh and material, shown or hidden, and every row of
//! a batch, active or not. So showing or hiding an object, or changing a batch's active count,
//! only rewrites those sources' entries in the bucket table, where `HIDDEN` makes the culling
//! shader skip them.
//!
//! # Cells
//!
//! World matrices are relative to their grid cells' centers (see [`null3d_core::cells`]). A
//! source's entry in the bucket table holds its cell index above its bucket, so a source that
//! changes cells rewrites its entry, as a hidden one does. Each frame uploads the offset from the
//! camera to each cell in use beside the culling planes, which are relative to the camera. The
//! culling shader adds a source's offset to its matrix as it copies the matrix into the compacted
//! instance buffer, so the vertex shader draws positions relative to the camera. When only the
//! camera moves, static matrices stay on the GPU and only the offsets upload.
//!
//! # Memory
//!
//! Frames record without the general-purpose allocator. At the start of each frame the arena gets
//! room for the most that any frame can copy for the scene as it stands, and the layout keeps its
//! tables and scratch space between rebuilds. Only the first frames after the scene grows, with a
//! new batch, mesh or mesh and material pair, allocate.

use std::collections::TryReserveError;

use null3d_core::cells::{CELL_SHIFT, MAX_CELLS};
use null3d_core::culling::Frustum;
use null3d_core::handle::Handle;
use null3d_core::instances::{BatchTable, InstanceBatch};
use null3d_core::scene::SceneStorage;
use null3d_core::snapshot::SCENE_TARGET;
use null3d_core::world::MATRIX_FLOATS;
use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, format, index_format, layout, resource_kind, sizes,
    template,
};

use crate::frame::{
    CELL_OFFSET_BYTES, CellOffsets, FrameBuilder, FrameInput, HIDDEN, PageUploads, ParityLists,
    RecordError, SceneSettings, SceneTargets, UploadArena, address, bucket_of, collect_bucket_keys,
    drawn_rows, floats_as_bytes, grown_size, words_as_bytes,
};
use crate::materials::{MATERIAL_FLOATS, Shading};
use crate::meshes::{MeshStorage, Packing};
/// Bytes of the culling planes: six planes, the source count and padding.
const CULL_PLANES_BYTES: u32 = 112;
/// Bytes of the culling parameters: the planes, then the offset from the camera to each cell.
const CULL_PARAMS_BYTES: u32 = CULL_PLANES_BYTES + MAX_CELLS * CELL_OFFSET_BYTES;
/// Bytes of one bucket record in the culling shader: base, material, radius, padding.
const BUCKET_BYTES: u32 = 16;
/// Bytes of one world matrix: three rows of four floats.
const MATRIX_BYTES: u32 = (MATRIX_FLOATS * 4) as u32;
/// Bytes of one indexed indirect draw.
const INDIRECT_BYTES: u32 = sizes::INDIRECT_WORDS * 4;

/// The most sources the builder can draw, scene slots and instance rows together, on a device whose
/// largest storage binding is `binding_bytes`. One culling dispatch covers at most 65,535
/// workgroups, and the compacted instance buffer, which the culling shader binds as storage, must
/// fit the largest storage binding.
pub const fn max_sources(binding_bytes: u32) -> u32 {
    let by_dispatch = u16::MAX as u32 * sizes::CULL_WORKGROUP_SIZE;
    let by_binding = binding_bytes / sizes::INSTANCE_STRIDE;
    if by_dispatch < by_binding {
        by_dispatch
    } else {
        by_binding
    }
}

// Buckets never outnumber sources, so every bucket fits below a cell index in a table entry, and
// the entry of a drawn source is never `HIDDEN`.
const _: () = assert!(u16::MAX as u32 * sizes::CULL_WORKGROUP_SIZE < (1 << CELL_SHIFT) - 1);

/// Engine memory the builder keeps for each source: its bucket table entry, and room for that
/// entry in both frames' upload arenas.
pub const BYTES_PER_SOURCE: u32 = 12;

/// The most sources on every device: [`max_sources`] at WebGPU's default storage binding limit.
pub const PORTABLE_MAX_SOURCES: u32 = max_sources(sizes::PORTABLE_STORAGE_BINDING_BYTES);

/// The largest storage binding the builder can use: the instance buffer of the most sources one
/// dispatch covers. A device that offers more gains nothing from a larger binding.
pub const MAX_USEFUL_BINDING_BYTES: u32 =
    u16::MAX as u32 * sizes::CULL_WORKGROUP_SIZE * sizes::INSTANCE_STRIDE;

/// A source's entry in the bucket table: its bucket with its cell index above it, or `HIDDEN` for
/// a source that draws nowhere.
fn entry(bucket: u32, cell: u32) -> u32 {
    if bucket == HIDDEN {
        HIDDEN
    } else {
        bucket | (cell << CELL_SHIFT)
    }
}

/// A scene object's entry in the bucket table: its bucket and cell, or `HIDDEN` while it is
/// hidden, which its world radius says.
fn scene_entry(home: u32, world_radius: f32, cell: u32) -> u32 {
    if world_radius == f32::NEG_INFINITY {
        HIDDEN
    } else {
        entry(home, cell)
    }
}

/// The entry of a batch's `row`: the batch's bucket and the row's cell while the row is active.
fn row_entry(bucket: u32, batch: &InstanceBatch, row: u32, active: u32) -> u32 {
    if row < active {
        entry(bucket, batch.cells()[row as usize])
    } else {
        HIDDEN
    }
}

/// Uploads the bucket table entries of sources `start..end`.
fn write_entries(
    list: &mut DrawList,
    arena: &mut UploadArena,
    table: &[u32],
    start: u32,
    end: u32,
) -> Result<(), RecordError> {
    let (at, bytes) = arena.push(words_as_bytes(&table[start as usize..end as usize]))?;
    list.push(
        Op::WriteBuffer,
        &[ids::INSTANCE_BUCKETS, start * 4, at, bytes],
    )?;
    Ok(())
}

/// Words of the culling pass's bind group entries: three for the group, five per buffer.
const CULL_GROUP_WORDS: usize = 3 + 6 * 5;

/// The builder's GPU objects. It owns every id it uses.
mod ids {
    pub const FRAME: u32 = 1;
    pub const CULL_PARAMS: u32 = 2;
    pub const MATERIALS: u32 = 3;
    pub const MATRICES: u32 = 4;
    pub const INSTANCE_BUCKETS: u32 = 5;
    pub const BUCKETS: u32 = 6;
    pub const VISIBLE: u32 = 7;
    pub const INDIRECT: u32 = 8;
    pub const VERTICES: u32 = 9;
    pub const INDICES: u32 = 10;

    pub const COLOR: u32 = 1;
    pub const DEPTH: u32 = 2;

    pub const LIT: u32 = 1;
    pub const UNLIT: u32 = 2;
    pub const CULL: u32 = 1;

    pub const FRAME_GROUP: u32 = 1;
    pub const CULL_GROUP: u32 = 2;

    pub const SCENE_BUNDLE: u32 = 1;
}

/// Sizes the builder allocates once.
#[derive(Clone, Copy, Debug)]
pub struct RendererConfig {
    /// MSAA samples of the color and depth targets.
    pub samples: u32,
    pub max_materials: u32,
    /// Bytes of the shared vertex buffer and of the shared index buffer.
    pub vertex_bytes: u32,
    pub index_bytes: u32,
    /// Words of each frame's draw list.
    pub draw_list_words: usize,
    /// The device's largest storage binding, at most [`MAX_USEFUL_BINDING_BYTES`]. It caps the
    /// builder's buffers and the sources it can draw.
    pub storage_binding_bytes: u32,
}

impl Default for RendererConfig {
    fn default() -> Self {
        Self {
            samples: 4,
            max_materials: sizes::MAX_MATERIALS,
            vertex_bytes: 16 * 1024 * 1024,
            index_bytes: 4 * 1024 * 1024,
            draw_list_words: 16 * 1024,
            storage_binding_bytes: sizes::PORTABLE_STORAGE_BINDING_BYTES,
        }
    }
}

/// What makes a bucket: its shading (the pipeline), its engine mesh id and its material id.
type BucketKey = (Shading, u32, u32);

/// One bucket: its draw, and its slice of the compacted instance buffer.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Bucket {
    shading: Shading,
    material: u32,
    base: u32,
    capacity: u32,
    index_count: u32,
    first_index: u32,
    base_vertex: u32,
    radius: f32,
}

/// The source layout and bucket tables, rebuilt when the structure changes.
#[derive(Default)]
struct Layout {
    sources: u32,
    /// Each batch's raw id and the first source of its rows.
    batch_bases: Vec<(u32, u32)>,
    buckets: Vec<Bucket>,
    /// The entry of every source: its bucket and cell, or `HIDDEN`.
    instance_buckets: Vec<u32>,
    /// The bucket of every scene slot whether it is shown or not, or `HIDDEN` for a slot with no
    /// mesh or material.
    home_buckets: Vec<u32>,
    /// Each batch's bucket and the active row count its table entries hold, in `batch_bases` order.
    batch_rows: Vec<(u32, u32)>,
    /// The per-frame reset of every bucket's indirect draw: instance counts at zero.
    indirect_template: Vec<u32>,
    /// Bucket records in the culling shader's layout.
    bucket_records: Vec<u32>,
    /// Scratch for rebuilds: every bucket key with its source count, sorted and merged into one
    /// entry per bucket.
    key_counts: Vec<(BucketKey, u32)>,
    built: bool,
}

impl Layout {
    fn base_of(&self, target: u32) -> Option<u32> {
        if target == SCENE_TARGET {
            return Some(0);
        }
        self.batch_bases
            .iter()
            .find(|(id, _)| *id == target)
            .map(|&(_, base)| base)
    }
}

/// Records one draw list per frame for the GPU-driven WebGPU path.
pub struct GpuDrivenRenderer {
    config: RendererConfig,
    settings: SceneSettings,
    /// How much of the one mesh page the shared buffers hold.
    uploaded: PageUploads,
    lists: ParityLists,
    layout: Layout,
    /// Sizes of the GPU buffers the layout decides, 0 before they exist, by buffer id.
    buffer_sizes: [u32; 11],
    created: bool,
    canvas: (u32, u32),
    /// The offset from the camera to each cell in use, for the frame being recorded.
    offsets: CellOffsets,
}

impl GpuDrivenRenderer {
    pub fn new(config: RendererConfig) -> Self {
        Self {
            config,
            settings: SceneSettings::new(
                MeshStorage::with_page_limit(
                    Packing::SharedBuffers,
                    u64::from(config.vertex_bytes.min(config.index_bytes)),
                ),
                config.max_materials,
            ),
            uploaded: PageUploads::default(),
            lists: ParityLists::new(config.draw_list_words),
            layout: Layout::default(),
            buffer_sizes: [0; 11],
            created: false,
            canvas: (0, 0),
            offsets: CellOffsets::new(),
        }
    }

    fn targets(&self) -> SceneTargets {
        SceneTargets {
            color: ids::COLOR,
            depth: ids::DEPTH,
            samples: self.config.samples,
        }
    }

    fn record_into(
        &mut self,
        input: &FrameInput<'_>,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<bool, RecordError> {
        let parity = input.parity();
        if !self.created {
            self.create_fixed(list)?;
        }
        if input.canvas != self.canvas {
            self.canvas = self.targets().record_resize(list, input.canvas)?;
        }
        let upload_everything = input.structure_changed || !self.layout.built;
        if upload_everything {
            self.rebuild_layout(input.scene, input.batches, parity)?;
        }
        arena.reset(self.upload_bound());
        self.upload_meshes(list, arena)?;
        if self.settings.materials_mut().take_changed() {
            let parameters = self.settings.materials().parameters();
            let (at, bytes) = arena.push(floats_as_bytes(parameters))?;
            list.push(Op::WriteBuffer, &[ids::MATERIALS, 0, at, bytes])?;
        }
        if upload_everything {
            self.apply_layout(list, arena)?;
        } else {
            self.update_membership(list, arena, input, parity)?;
        }
        self.upload_matrices(list, input, parity, upload_everything)?;

        let Some(view) = self.settings.frame_view(input.scene, parity, input.canvas) else {
            self.settings.record_clear_only(list, self.targets())?;
            return Ok(upload_everything);
        };
        let (at, bytes) = arena.push(view.uniform.as_bytes())?;
        list.push(Op::WriteBuffer, &[ids::FRAME, 0, at, bytes])?;

        // The planes are relative to the camera; the shader moves each source by its cell's
        // offset from the camera before it tests the source.
        let mut params = [0u32; (CULL_PLANES_BYTES / 4) as usize];
        for (plane, out) in Frustum::from_view_projection(&view.uniform.view_proj)
            .planes()
            .iter()
            .zip(params.chunks_mut(4))
        {
            for (value, word) in plane.iter().zip(out) {
                *word = value.to_bits();
            }
        }
        params[24] = self.layout.sources;
        let (at, bytes) = arena.push(words_as_bytes(&params))?;
        list.push(Op::WriteBuffer, &[ids::CULL_PARAMS, 0, at, bytes])?;
        self.offsets.update(input.scene, &view);
        let (at, bytes) = arena.push(self.offsets.as_bytes())?;
        list.push(
            Op::WriteBuffer,
            &[ids::CULL_PARAMS, CULL_PLANES_BYTES, at, bytes],
        )?;

        let buckets = self.layout.buckets.len() as u32;
        if buckets > 0 {
            let (at, bytes) = arena.push(words_as_bytes(&self.layout.indirect_template))?;
            list.push(Op::WriteBuffer, &[ids::INDIRECT, 0, at, bytes])?;
            list.push(Op::BeginComputePass, &[])?;
            list.push(Op::SetComputePipeline, &[ids::CULL])?;
            list.push(Op::SetBindGroup, &[0, ids::CULL_GROUP, 0])?;
            let groups = self.layout.sources.div_ceil(sizes::CULL_WORKGROUP_SIZE);
            list.push(Op::Dispatch, &[groups, 1, 1])?;
            list.push(Op::EndComputePass, &[])?;
        }
        self.settings.record_begin_pass(list, self.targets())?;
        list.push(Op::ExecuteBundles, &[1, ids::SCENE_BUNDLE])?;
        list.push(Op::EndRenderPass, &[])?;
        list.push(Op::Submit, &[])?;
        Ok(upload_everything)
    }

    fn create_fixed(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        let samples = self.config.samples;
        for (id, tmpl) in [
            (ids::LIT, template::INSTANCED_LIT),
            (ids::UNLIT, template::INSTANCED_UNLIT),
        ] {
            list.push(
                Op::CreateRenderPipeline,
                &[
                    id,
                    tmpl,
                    0,
                    format::CANVAS,
                    format::DEPTH32_FLOAT,
                    samples,
                    0,
                ],
            )?;
        }
        list.push(Op::CreateComputePipeline, &[ids::CULL, template::CULL, 0])?;
        let fixed = [
            (
                ids::FRAME,
                sizes::FRAME_UNIFORM_BYTES,
                usage::UNIFORM | usage::COPY_DST,
            ),
            (
                ids::CULL_PARAMS,
                CULL_PARAMS_BYTES,
                usage::UNIFORM | usage::COPY_DST,
            ),
            (
                ids::MATERIALS,
                self.config.max_materials.max(1) * 16,
                usage::STORAGE | usage::COPY_DST,
            ),
            (
                ids::VERTICES,
                self.config.vertex_bytes,
                usage::VERTEX | usage::COPY_DST,
            ),
            (
                ids::INDICES,
                self.config.index_bytes,
                usage::INDEX | usage::COPY_DST,
            ),
        ];
        for (id, size, flags) in fixed {
            list.push(Op::CreateBuffer, &[id, size, flags])?;
        }
        list.push(
            Op::CreateBindGroup,
            &[
                ids::FRAME_GROUP,
                layout::FRAME,
                2,
                0,
                resource_kind::BUFFER,
                ids::FRAME,
                0,
                0,
                1,
                resource_kind::BUFFER,
                ids::MATERIALS,
                0,
                0,
            ],
        )?;
        self.created = true;
        Ok(())
    }

    /// Uploads mesh data added since the last upload, from copies in the frame's arena.
    fn upload_meshes(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        let pages = self.settings.meshes().pages();
        let Some(page) = pages.first() else {
            return Ok(());
        };
        if pages.len() > 1 {
            return Err(RecordError::MeshBuffersFull);
        }
        self.uploaded.upload(
            list,
            arena,
            page,
            [ids::VERTICES, ids::INDICES],
            [self.config.vertex_bytes, self.config.index_bytes],
        )
    }

    /// Assigns every source to a bucket and lays the buckets out, from the frame's world state. It
    /// reuses the layout's tables and scratch space, which grow only with the scene.
    fn rebuild_layout(
        &mut self,
        scene: &SceneStorage,
        batches: &BatchTable,
        parity: usize,
    ) -> Result<(), RecordError> {
        let layout = &mut self.layout;
        let scene_rows = scene.capacity() + 1;
        layout.batch_bases.clear();
        let mut sources = scene_rows;
        for (id, batch) in batches.iter() {
            layout.batch_bases.push((id.raw(), sources));
            sources += batch.capacity();
        }
        let limit = max_sources(self.config.storage_binding_bytes);
        if sources > limit {
            return Err(RecordError::TooManySources { limit });
        }
        layout.sources = sources;

        let settings = &self.settings;
        let key_of = |mesh: u32, material: u32| -> Option<BucketKey> {
            Some((settings.shading_of(mesh, material)?, mesh, material))
        };
        let world = scene.world(parity);
        let scene_key = |slot: usize| key_of(scene.meshes()[slot], scene.materials()[slot]);

        collect_bucket_keys(
            &mut layout.key_counts,
            scene,
            batches,
            scene_key,
            |_, batch| key_of(batch.mesh(), batch.material()),
        );

        layout.buckets.clear();
        let mut base = 0;
        for &((shading, mesh, material), count) in &layout.key_counts {
            let slot = settings
                .meshes()
                .mesh(mesh - 1)
                .expect("keys name known meshes");
            layout.buckets.push(Bucket {
                shading,
                material,
                base,
                capacity: count,
                index_count: slot.index_count,
                first_index: slot.first_index,
                base_vertex: slot.base_vertex,
                radius: slot.radius,
            });
            base += count;
        }

        let counts = &layout.key_counts;
        let bucket_of = |key: Option<BucketKey>| bucket_of(counts, key).unwrap_or(HIDDEN);
        layout.instance_buckets.clear();
        layout.home_buckets.clear();
        let slots = world.radii().iter().zip(scene.cells());
        for (slot, (&radius, &cell)) in slots.take(scene_rows as usize).enumerate() {
            let home = bucket_of(scene_key(slot));
            layout.home_buckets.push(home);
            layout
                .instance_buckets
                .push(scene_entry(home, radius, cell));
        }
        layout.batch_rows.clear();
        for (_, batch) in batches.iter() {
            let bucket = bucket_of(key_of(batch.mesh(), batch.material()));
            let active = batch.frame_active_count(parity);
            layout.batch_rows.push((bucket, active));
            layout
                .instance_buckets
                .extend((0..batch.capacity()).map(|row| row_entry(bucket, batch, row, active)));
        }

        layout.indirect_template.clear();
        layout.bucket_records.clear();
        for bucket in &layout.buckets {
            layout.indirect_template.extend_from_slice(&[
                bucket.index_count,
                0,
                bucket.first_index,
                bucket.base_vertex,
                0,
            ]);
            layout.bucket_records.extend_from_slice(&[
                bucket.base,
                bucket.material - 1,
                bucket.radius.to_bits(),
                0,
            ]);
        }
        layout.built = true;
        Ok(())
    }

    /// The most that one frame can copy into its arena for the scene as it stands: mesh data not
    /// uploaded yet, the whole material table, the layout's tables, the frame's constants and the
    /// indirect draws.
    fn upload_bound(&self) -> usize {
        let meshes = self
            .settings
            .meshes()
            .pages()
            .first()
            .map_or(0, |page| self.uploaded.pending_bytes(page));
        let materials = self.settings.materials().capacity() as usize * MATERIAL_FLOATS * 4;
        let buckets = self.layout.buckets.len() * (BUCKET_BYTES + INDIRECT_BYTES) as usize;
        let frame = (sizes::FRAME_UNIFORM_BYTES + CULL_PARAMS_BYTES) as usize;
        meshes + materials + self.layout.sources as usize * 4 + buckets + frame
    }

    /// Rewrites the bucket table entries of the sources whose membership or cell changed since the
    /// layout was built, without a rebuild: scene objects shown, hidden or moved to another cell
    /// this frame, which the frame's uploads name, the batch rows that a new active count added or
    /// removed, and the batch rows that changed cells.
    fn update_membership(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        input: &FrameInput<'_>,
        parity: usize,
    ) -> Result<(), RecordError> {
        let layout = &mut self.layout;
        let radii = input.scene.world(parity).radii();
        let cells = input.scene.cells();
        let scene_rows = layout.home_buckets.len() as u32;
        let mut check = |start: u32, count: u32| -> Result<(), RecordError> {
            let mut changed: Option<(u32, u32)> = None;
            for slot in start..(start + count).min(scene_rows) {
                let s = slot as usize;
                let wanted = scene_entry(layout.home_buckets[s], radii[s], cells[s]);
                if layout.instance_buckets[s] != wanted {
                    layout.instance_buckets[s] = wanted;
                    changed =
                        Some(changed.map_or((slot, slot + 1), |(first, _)| (first, slot + 1)));
                }
            }
            match changed {
                Some((first, end)) => {
                    write_entries(list, arena, &layout.instance_buckets, first, end)
                }
                None => Ok(()),
            }
        };
        if input.snapshot.overflowed() {
            check(0, scene_rows)?;
        } else {
            for range in input.snapshot.uploads() {
                if range.target == SCENE_TARGET {
                    check(range.start, range.count)?;
                }
            }
        }
        for (index, (_, batch)) in input.batches.iter().enumerate() {
            let (bucket, was) = layout.batch_rows[index];
            let now = batch.frame_active_count(parity);
            let moved = batch.cell_changes();
            let mut rows = (now != was).then(|| (was.min(now), was.max(now)));
            if moved.count > 0 {
                let (start, end) = (moved.start, moved.start + moved.count);
                rows =
                    Some(rows.map_or((start, end), |(low, high)| (low.min(start), high.max(end))));
            }
            let Some((low, high)) = rows else {
                continue;
            };
            let base = layout.batch_bases[index].1;
            for row in low..high {
                layout.instance_buckets[(base + row) as usize] = row_entry(bucket, batch, row, now);
            }
            layout.batch_rows[index].1 = now;
            write_entries(
                list,
                arena,
                &layout.instance_buckets,
                base + low,
                base + high,
            )?;
        }
        Ok(())
    }

    /// Sizes the layout's buffers, uploads its tables and re-records the bundle.
    fn apply_layout(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        let layout = &self.layout;
        let buckets = layout.buckets.len() as u32;
        let drawable = layout.buckets.iter().map(|b| b.capacity).sum::<u32>();
        let needed = [
            (
                ids::MATRICES,
                layout.sources * MATRIX_BYTES,
                usage::STORAGE | usage::COPY_DST,
            ),
            (
                ids::INSTANCE_BUCKETS,
                layout.sources * 4,
                usage::STORAGE | usage::COPY_DST,
            ),
            (
                ids::BUCKETS,
                buckets.max(1) * BUCKET_BYTES,
                usage::STORAGE | usage::COPY_DST,
            ),
            (
                ids::VISIBLE,
                drawable.max(1) * sizes::INSTANCE_STRIDE,
                usage::VERTEX | usage::STORAGE,
            ),
            (
                ids::INDIRECT,
                buckets.max(1) * INDIRECT_BYTES,
                usage::INDIRECT | usage::STORAGE | usage::COPY_DST,
            ),
        ];
        let mut recreated = false;
        for (id, size, flags) in needed {
            if self.buffer_sizes[id as usize] < size {
                let size = grown_size(size, self.config.storage_binding_bytes);
                list.push(Op::CreateBuffer, &[id, size, flags])?;
                self.buffer_sizes[id as usize] = size;
                recreated = true;
            }
        }
        if recreated {
            let mut entries = [0u32; CULL_GROUP_WORDS];
            entries[..3].copy_from_slice(&[ids::CULL_GROUP, layout::CULL, 6]);
            for (binding, buffer) in [
                ids::CULL_PARAMS,
                ids::MATRICES,
                ids::INSTANCE_BUCKETS,
                ids::BUCKETS,
                ids::VISIBLE,
                ids::INDIRECT,
            ]
            .into_iter()
            .enumerate()
            {
                let at = 3 + binding * 5;
                entries[at..at + 5].copy_from_slice(&[
                    binding as u32,
                    resource_kind::BUFFER,
                    buffer,
                    0,
                    0,
                ]);
            }
            list.push(Op::CreateBindGroup, &entries)?;
        }

        let (at, bytes) = arena.push(words_as_bytes(&layout.instance_buckets))?;
        list.push(Op::WriteBuffer, &[ids::INSTANCE_BUCKETS, 0, at, bytes])?;
        if buckets > 0 {
            let (at, bytes) = arena.push(words_as_bytes(&layout.bucket_records))?;
            list.push(Op::WriteBuffer, &[ids::BUCKETS, 0, at, bytes])?;
        }

        list.push(
            Op::BeginBundle,
            &[
                ids::SCENE_BUNDLE,
                format::CANVAS,
                format::DEPTH32_FLOAT,
                self.config.samples,
            ],
        )?;
        list.push(Op::SetBindGroup, &[0, ids::FRAME_GROUP, 0])?;
        list.push(Op::SetVertexBuffer, &[0, ids::VERTICES, 0, 0])?;
        list.push(
            Op::SetIndexBuffer,
            &[ids::INDICES, index_format::UINT16, 0, 0],
        )?;
        let mut pipeline = None;
        for (index, bucket) in layout.buckets.iter().enumerate() {
            let wanted = match bucket.shading {
                Shading::Lit => ids::LIT,
                Shading::Unlit => ids::UNLIT,
            };
            if pipeline != Some(wanted) {
                list.push(Op::SetPipeline, &[wanted])?;
                pipeline = Some(wanted);
            }
            list.push(
                Op::SetVertexBuffer,
                &[
                    1,
                    ids::VISIBLE,
                    bucket.base * sizes::INSTANCE_STRIDE,
                    bucket.capacity.max(1) * sizes::INSTANCE_STRIDE,
                ],
            )?;
            list.push(
                Op::DrawIndexedIndirect,
                &[ids::INDIRECT, index as u32 * INDIRECT_BYTES],
            )?;
        }
        list.push(Op::EndBundle, &[])?;
        Ok(())
    }

    /// Uploads changed world matrices straight from the core's world buffers of this parity, or
    /// every matrix after the layout changed.
    fn upload_matrices(
        &self,
        list: &mut DrawList,
        input: &FrameInput<'_>,
        parity: usize,
        everything: bool,
    ) -> Result<(), RecordError> {
        let mut upload = |base: u32, matrices: &[f32], start: u32, count: u32| {
            let floats =
                &matrices[start as usize * MATRIX_FLOATS..(start + count) as usize * MATRIX_FLOATS];
            list.push(
                Op::WriteBuffer,
                &[
                    ids::MATRICES,
                    (base + start) * MATRIX_BYTES,
                    address(floats_as_bytes(floats)),
                    count * MATRIX_BYTES,
                ],
            )
        };
        if everything || input.snapshot.overflowed() {
            // Slots past the highest one ever used, and rows past a batch's active count, draw
            // nothing; they upload when they change.
            let scene = input.scene.world(parity).matrices();
            upload(0, scene, 0, input.scene.slots().high_water())?;
            for ((_, batch), &(_, base)) in input.batches.iter().zip(&self.layout.batch_bases) {
                let active = batch.frame_active_count(parity);
                upload(base, batch.world(parity).matrices(), 0, active)?;
            }
            return Ok(());
        }
        for range in input.snapshot.uploads() {
            let Some(base) = self.layout.base_of(range.target) else {
                continue;
            };
            if range.target == SCENE_TARGET {
                let scene = input.scene.world(parity).matrices();
                if let Some((start, count)) =
                    drawn_rows(&self.layout.home_buckets, range.start, range.count)
                {
                    upload(base, scene, start, count)?;
                }
                continue;
            }
            let Ok(batch) = input.batches.get(Handle::from_raw(range.target)) else {
                continue;
            };
            upload(
                base,
                batch.world(parity).matrices(),
                range.start,
                range.count,
            )?;
        }
        Ok(())
    }
}

impl FrameBuilder for GpuDrivenRenderer {
    fn settings(&self) -> &SceneSettings {
        &self.settings
    }

    fn settings_mut(&mut self) -> &mut SceneSettings {
        &mut self.settings
    }

    fn max_sources(&self) -> u32 {
        max_sources(self.config.storage_binding_bytes)
    }

    fn reserve_sources(&mut self, sources: u32) -> Result<(), TryReserveError> {
        let buckets = &mut self.layout.instance_buckets;
        buckets.try_reserve((sources as usize).saturating_sub(buckets.len()))?;
        let bound = self.upload_bound() + sources.saturating_sub(self.layout.sources) as usize * 4;
        for arena in self.lists.arenas_mut() {
            arena.try_reserve(bound)?;
        }
        Ok(())
    }

    fn record(&mut self, input: &FrameInput<'_>) -> Result<bool, RecordError> {
        let (mut list, mut arena) = self.lists.take(input.frame);
        let result = self.record_into(input, &mut list, &mut arena);
        self.lists.restore(input.frame, list, arena);
        result
    }

    fn reset_gpu(&mut self) {
        self.created = false;
        self.canvas = (0, 0);
        self.buffer_sizes = [0; 11];
        self.layout.built = false;
        self.uploaded = PageUploads::default();
        self.settings.materials_mut().mark_changed();
    }

    fn list(&self, frame: u32) -> &DrawList {
        self.lists.list(frame)
    }
}
