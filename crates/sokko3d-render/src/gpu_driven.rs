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
//! materials changed, visibility, batch sizes. The caller says when that happened; the builder
//! then rebuilds the bucket tables and re-records the bundle, and uploads every matrix once.
//!
//! # Frames in flight
//!
//! The game worker records frame `f + 1` while the render worker replays frame `f`. Everything a
//! frame's list reads from engine memory is therefore kept per frame parity: the list itself, and
//! an upload arena that holds copies of the small tables and new mesh data. World matrices come
//! straight from the core's world buffer of the frame's parity, which the core keeps the same way.

use std::collections::BTreeMap;

use sokko3d_core::culling::Frustum;
use sokko3d_core::handle::Handle;
use sokko3d_core::instances::BatchTable;
use sokko3d_core::scene::SceneStorage;
use sokko3d_core::snapshot::{FrameSnapshot, SCENE_TARGET};
use sokko3d_core::world::MATRIX_FLOATS;
use sokko3d_gpu::drawlist::{
    DrawList, DrawListError, Op, buffer_usage as usage, format, index_format, layout, pass_flags,
    resource_kind, sizes, template, texture_usage,
};

use crate::camera::{Affine, Perspective};
use crate::frame_data::{FrameUniform, normalized_direction};
use crate::materials::{MaterialTable, Shading};
use crate::meshes::{MeshStorage, Packing};

/// Engine mesh ids count from 1; 0 marks an object with no mesh, such as a group or a camera.
pub const NO_MESH: u32 = 0;
/// Engine material ids count from 1 too: material table index plus one.
pub const NO_MATERIAL: u32 = 0;

/// The bucket of a source that draws nowhere, as the culling shader reads it.
const HIDDEN: u32 = u32::MAX;
/// Bytes of the culling parameters: six planes, the source count and padding.
const CULL_PARAMS_BYTES: u32 = 112;
/// Bytes of one bucket record in the culling shader: base, material, radius, padding.
const BUCKET_BYTES: u32 = 16;
/// Bytes of one world matrix: three rows of four floats.
const MATRIX_BYTES: u32 = (MATRIX_FLOATS * 4) as u32;
/// Bytes of one indexed indirect draw.
const INDIRECT_BYTES: u32 = sizes::INDIRECT_WORDS * 4;
/// Bytes per chunk of an upload arena.
const ARENA_CHUNK_BYTES: usize = 64 * 1024;

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
}

impl Default for RendererConfig {
    fn default() -> Self {
        Self {
            samples: 4,
            max_materials: 1024,
            vertex_bytes: 16 * 1024 * 1024,
            index_bytes: 4 * 1024 * 1024,
            draw_list_words: 16 * 1024,
        }
    }
}

/// Why a frame could not be recorded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecordError {
    /// The frame's commands do not fit the draw list.
    DrawListFull,
    /// The meshes need more room than the shared vertex or index buffer has.
    MeshBuffersFull,
    /// More sources than one culling dispatch covers.
    TooManySources,
}

impl From<DrawListError> for RecordError {
    fn from(_: DrawListError) -> Self {
        RecordError::DrawListFull
    }
}

/// What one frame of the scene looks like to the builder.
pub struct FrameInput<'a> {
    /// The frame number, counting from 1.
    pub frame: u32,
    pub scene: &'a SceneStorage,
    pub batches: &'a BatchTable,
    /// The frame's upload list.
    pub snapshot: &'a FrameSnapshot,
    /// The canvas size in device pixels.
    pub canvas: (u32, u32),
    /// True when the scene's structure changed this frame (see the module documentation).
    pub structure_changed: bool,
}

/// The engine memory address of bytes, as the replay loop reads it: an offset into WebAssembly
/// memory. Native builds keep the low bits, which is enough for tests that compare addresses.
pub fn address(bytes: &[u8]) -> u32 {
    bytes.as_ptr() as usize as u32
}

fn floats_as_bytes(floats: &[f32]) -> &[u8] {
    // SAFETY: any `f32` is four initialized bytes, and `u8` has no alignment requirement.
    unsafe {
        std::slice::from_raw_parts(floats.as_ptr().cast::<u8>(), std::mem::size_of_val(floats))
    }
}

fn words_as_bytes(words: &[u32]) -> &[u8] {
    // SAFETY: any `u32` is four initialized bytes, and `u8` has no alignment requirement.
    unsafe { std::slice::from_raw_parts(words.as_ptr().cast::<u8>(), std::mem::size_of_val(words)) }
}

/// Copies of data a frame's list uploads. Chunks never move once allocated, so addresses stay
/// valid until the arena is reset for the next frame of the same parity.
#[derive(Default)]
struct UploadArena {
    chunks: Vec<Vec<u8>>,
    current: usize,
}

impl UploadArena {
    fn reset(&mut self) {
        for chunk in &mut self.chunks {
            chunk.clear();
        }
        self.current = 0;
    }

    /// Copies bytes into the arena, padded to four bytes, and returns their address and padded
    /// length.
    fn push(&mut self, bytes: &[u8]) -> (u32, u32) {
        let padded = bytes.len().next_multiple_of(4);
        while self.current < self.chunks.len() {
            let chunk = &self.chunks[self.current];
            if chunk.capacity() - chunk.len() >= padded {
                break;
            }
            self.current += 1;
        }
        if self.current == self.chunks.len() {
            self.chunks
                .push(Vec::with_capacity(padded.max(ARENA_CHUNK_BYTES)));
        }
        let chunk = &mut self.chunks[self.current];
        let start = chunk.len();
        chunk.extend_from_slice(bytes);
        chunk.resize(start + padded, 0);
        (address(&chunk[start..]), padded as u32)
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
    /// The bucket of every source, or `HIDDEN`.
    instance_buckets: Vec<u32>,
    /// The per-frame reset of every bucket's indirect draw: instance counts at zero.
    indirect_template: Vec<u32>,
    /// Bucket records in the culling shader's layout.
    bucket_records: Vec<u32>,
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

/// Settings the game changes rarely: the camera and the lights.
#[derive(Clone, Copy, Debug)]
struct Lighting {
    sun_direction: [f32; 4],
    sun_color: [f32; 4],
    ambient: [f32; 4],
    /// Linear background color.
    background: [f32; 3],
}

/// Records one draw list per frame for the GPU-driven WebGPU path.
pub struct GpuDrivenRenderer {
    config: RendererConfig,
    meshes: MeshStorage,
    uploaded_vertex_floats: usize,
    uploaded_indices: usize,
    materials: MaterialTable,
    camera: Option<(Handle, Perspective)>,
    lighting: Lighting,
    lists: [DrawList; 2],
    arenas: [UploadArena; 2],
    layout: Layout,
    /// Sizes of the GPU buffers the layout decides, 0 before they exist, by buffer id.
    buffer_sizes: [u32; 11],
    created: bool,
    canvas: (u32, u32),
}

impl GpuDrivenRenderer {
    pub fn new(config: RendererConfig) -> Self {
        Self {
            config,
            meshes: MeshStorage::with_page_limit(
                Packing::SharedBuffers,
                u64::from(config.vertex_bytes.min(config.index_bytes)),
            ),
            uploaded_vertex_floats: 0,
            uploaded_indices: 0,
            materials: MaterialTable::with_capacity(config.max_materials),
            camera: None,
            lighting: Lighting {
                sun_direction: [0.0, -1.0, 0.0, 0.0],
                sun_color: [0.0; 4],
                ambient: [0.0; 4],
                background: [0.0; 3],
            },
            lists: [
                DrawList::with_capacity(config.draw_list_words),
                DrawList::with_capacity(config.draw_list_words),
            ],
            arenas: [UploadArena::default(), UploadArena::default()],
            layout: Layout::default(),
            buffer_sizes: [0; 11],
            created: false,
            canvas: (0, 0),
        }
    }

    pub fn meshes(&self) -> &MeshStorage {
        &self.meshes
    }

    /// Mesh storage; a new mesh's engine id is its storage id plus one.
    pub fn meshes_mut(&mut self) -> &mut MeshStorage {
        &mut self.meshes
    }

    /// The material table; a material's engine id is its table id plus one.
    pub fn materials_mut(&mut self) -> &mut MaterialTable {
        &mut self.materials
    }

    /// The camera the frame is drawn from: a scene object, and its lens.
    pub fn set_camera(&mut self, camera: Handle, lens: Perspective) {
        self.camera = Some((camera, lens));
    }

    /// The directional light: the direction its light travels, and its linear color times its
    /// intensity.
    pub fn set_sun(&mut self, direction: [f32; 3], color: [f32; 3]) {
        self.lighting.sun_direction = normalized_direction(direction);
        self.lighting.sun_color = [color[0], color[1], color[2], 0.0];
    }

    /// The ambient light's linear color times its intensity.
    pub fn set_ambient(&mut self, color: [f32; 3]) {
        self.lighting.ambient = [color[0], color[1], color[2], 0.0];
    }

    /// The linear color behind every object.
    pub fn set_background(&mut self, color: [f32; 3]) {
        self.lighting.background = color;
    }

    /// The list recorded for a frame's parity, as the render worker replays it.
    pub fn list(&self, frame: u32) -> &DrawList {
        &self.lists[(frame & 1) as usize]
    }

    /// Records the frame's draw list into the list of its parity.
    pub fn record(&mut self, input: &FrameInput<'_>) -> Result<(), RecordError> {
        let parity = (input.frame & 1) as usize;
        let mut list = std::mem::replace(&mut self.lists[parity], DrawList::with_capacity(0));
        let mut arena = std::mem::take(&mut self.arenas[parity]);
        list.clear();
        arena.reset();
        let result = self.record_into(input, parity, &mut list, &mut arena);
        self.lists[parity] = list;
        self.arenas[parity] = arena;
        result
    }

    fn record_into(
        &mut self,
        input: &FrameInput<'_>,
        parity: usize,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        if !self.created {
            self.create_fixed(list)?;
        }
        if input.canvas != self.canvas {
            self.resize(list, input.canvas)?;
        }
        self.upload_meshes(list, arena)?;
        if self.materials.take_changed() {
            let (at, bytes) = arena.push(floats_as_bytes(self.materials.parameters()));
            list.push(Op::WriteBuffer, &[ids::MATERIALS, 0, at, bytes])?;
        }
        let upload_everything = input.structure_changed || !self.layout.built;
        if upload_everything {
            self.rebuild_layout(input.scene, input.batches, parity)?;
            self.apply_layout(list, arena)?;
        }
        self.upload_matrices(list, input, parity, upload_everything)?;

        let Some((camera, lens)) = self.camera else {
            return self.clear_only(list);
        };
        let Ok(slot) = input.scene.resolve(camera) else {
            return self.clear_only(list);
        };
        let world: Affine = *input.scene.world(parity).matrix(slot as usize);
        let aspect = input.canvas.0 as f32 / input.canvas.1.max(1) as f32;
        let view_proj = lens.view_projection(&world, aspect);
        let uniform = FrameUniform {
            view_proj,
            camera_position: [world[3], world[7], world[11], 1.0],
            sun_direction: self.lighting.sun_direction,
            sun_color: self.lighting.sun_color,
            ambient: self.lighting.ambient,
        };
        let (at, bytes) = arena.push(uniform.as_bytes());
        list.push(Op::WriteBuffer, &[ids::FRAME, 0, at, bytes])?;

        let mut params = [0u32; (CULL_PARAMS_BYTES / 4) as usize];
        for (plane, out) in Frustum::from_view_projection(&view_proj)
            .planes()
            .iter()
            .zip(params.chunks_mut(4))
        {
            for (value, word) in plane.iter().zip(out) {
                *word = value.to_bits();
            }
        }
        params[24] = self.layout.sources;
        let (at, bytes) = arena.push(words_as_bytes(&params));
        list.push(Op::WriteBuffer, &[ids::CULL_PARAMS, 0, at, bytes])?;

        let buckets = self.layout.buckets.len() as u32;
        if buckets > 0 {
            let (at, bytes) = arena.push(words_as_bytes(&self.layout.indirect_template));
            list.push(Op::WriteBuffer, &[ids::INDIRECT, 0, at, bytes])?;
            list.push(Op::BeginComputePass, &[])?;
            list.push(Op::SetComputePipeline, &[ids::CULL])?;
            list.push(Op::SetBindGroup, &[0, ids::CULL_GROUP, 0])?;
            let groups = self.layout.sources.div_ceil(sizes::CULL_WORKGROUP_SIZE);
            list.push(Op::Dispatch, &[groups, 1, 1])?;
            list.push(Op::EndComputePass, &[])?;
        }
        self.begin_pass(list)?;
        list.push(Op::ExecuteBundles, &[1, ids::SCENE_BUNDLE])?;
        list.push(Op::EndRenderPass, &[])?;
        list.push(Op::Submit, &[])?;
        Ok(())
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

    fn resize(
        &mut self,
        list: &mut DrawList,
        (width, height): (u32, u32),
    ) -> Result<(), RecordError> {
        let (width, height) = (width.max(1), height.max(1));
        list.push(Op::ResizeCanvas, &[width, height])?;
        for (id, tex_format) in [
            (ids::COLOR, format::CANVAS),
            (ids::DEPTH, format::DEPTH32_FLOAT),
        ] {
            list.push(
                Op::CreateTexture,
                &[
                    id,
                    width,
                    height,
                    1,
                    tex_format,
                    texture_usage::RENDER_ATTACHMENT,
                    self.config.samples,
                    1,
                ],
            )?;
        }
        self.canvas = (width, height);
        Ok(())
    }

    /// Uploads mesh data added since the last upload, from copies in the frame's arena.
    fn upload_meshes(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        let Some(page) = self.meshes.pages().first() else {
            return Ok(());
        };
        if self.meshes.pages().len() > 1 {
            return Err(RecordError::MeshBuffersFull);
        }
        let new_vertices = &page.vertices[self.uploaded_vertex_floats..];
        if !new_vertices.is_empty() {
            let offset = (self.uploaded_vertex_floats * 4) as u32;
            let (at, bytes) = arena.push(floats_as_bytes(new_vertices));
            if offset + bytes > self.config.vertex_bytes {
                return Err(RecordError::MeshBuffersFull);
            }
            list.push(Op::WriteBuffer, &[ids::VERTICES, offset, at, bytes])?;
            self.uploaded_vertex_floats = page.vertices.len();
        }
        // Writes land on four-byte boundaries, so index uploads start at an even index; the index
        // before the new ones is uploaded again when the previous upload ended on an odd one.
        let first = self.uploaded_indices & !1;
        let new_indices = &page.indices[first..];
        if self.uploaded_indices < page.indices.len() {
            // SAFETY: any `u16` is two initialized bytes.
            let raw = unsafe {
                std::slice::from_raw_parts(new_indices.as_ptr().cast::<u8>(), new_indices.len() * 2)
            };
            let offset = (first * 2) as u32;
            let (at, bytes) = arena.push(raw);
            if offset + bytes > self.config.index_bytes {
                return Err(RecordError::MeshBuffersFull);
            }
            list.push(Op::WriteBuffer, &[ids::INDICES, offset, at, bytes])?;
            self.uploaded_indices = page.indices.len();
        }
        Ok(())
    }

    /// Assigns every source to a bucket and lays the buckets out, from the frame's world state.
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
        if sources.div_ceil(sizes::CULL_WORKGROUP_SIZE) > u32::from(u16::MAX) {
            return Err(RecordError::TooManySources);
        }
        layout.sources = sources;

        // Count the sources of every bucket key, then give buckets ids in key order.
        let key_of = |mesh: u32, material: u32| -> Option<BucketKey> {
            if mesh == NO_MESH || material == NO_MATERIAL {
                return None;
            }
            self.meshes.mesh(mesh - 1)?;
            let shading = self.materials.shading(material - 1).ok()?;
            Some((shading, mesh, material))
        };
        let world = scene.world(parity);
        let mut counts: BTreeMap<BucketKey, u32> = BTreeMap::new();
        let scene_keys: Vec<Option<BucketKey>> = (0..scene_rows as usize)
            .map(|slot| {
                let drawable = world.radii()[slot] != f32::NEG_INFINITY;
                let key = drawable
                    .then(|| key_of(scene.meshes()[slot], scene.materials()[slot]))
                    .flatten();
                if let Some(key) = key {
                    *counts.entry(key).or_default() += 1;
                }
                key
            })
            .collect();
        let batch_keys: Vec<(Option<BucketKey>, u32)> = batches
            .iter()
            .map(|(_, batch)| {
                let key = key_of(batch.mesh(), batch.material());
                let active = batch.frame_active_count(parity);
                if let Some(key) = key {
                    *counts.entry(key).or_default() += active;
                }
                (key, active)
            })
            .collect();

        layout.buckets.clear();
        let mut ids_by_key = BTreeMap::new();
        let mut base = 0;
        for (&(shading, mesh, material), &count) in &counts {
            let slot = self.meshes.mesh(mesh - 1).expect("keys name known meshes");
            ids_by_key.insert((shading, mesh, material), layout.buckets.len() as u32);
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

        layout.instance_buckets.clear();
        layout.instance_buckets.extend(
            scene_keys
                .iter()
                .map(|key| key.map_or(HIDDEN, |key| ids_by_key[&key])),
        );
        for ((_, batch), (key, active)) in batches.iter().zip(&batch_keys) {
            let bucket = key.map_or(HIDDEN, |key| ids_by_key[&key]);
            let rows = batch.capacity();
            layout
                .instance_buckets
                .extend((0..rows).map(|row| if row < *active { bucket } else { HIDDEN }));
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
                // Grown buffers keep room for growth, so a slowly growing scene rarely recreates them.
                let size = size.saturating_add(size / 2).next_multiple_of(256);
                list.push(Op::CreateBuffer, &[id, size, flags])?;
                self.buffer_sizes[id as usize] = size;
                recreated = true;
            }
        }
        if recreated {
            let mut entries = vec![ids::CULL_GROUP, layout::CULL, 6];
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
                entries.extend_from_slice(&[binding as u32, resource_kind::BUFFER, buffer, 0, 0]);
            }
            list.push(Op::CreateBindGroup, &entries)?;
        }

        let (at, bytes) = arena.push(words_as_bytes(&layout.instance_buckets));
        list.push(Op::WriteBuffer, &[ids::INSTANCE_BUCKETS, 0, at, bytes])?;
        if buckets > 0 {
            let (at, bytes) = arena.push(words_as_bytes(&layout.bucket_records));
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
            let scene = input.scene.world(parity).matrices();
            upload(0, scene, 0, input.scene.capacity() + 1)?;
            for ((_, batch), &(_, base)) in input.batches.iter().zip(&self.layout.batch_bases) {
                upload(base, batch.world(parity).matrices(), 0, batch.capacity())?;
            }
            return Ok(());
        }
        for range in input.snapshot.uploads() {
            let Some(base) = self.layout.base_of(range.target) else {
                continue;
            };
            let matrices = if range.target == SCENE_TARGET {
                input.scene.world(parity).matrices()
            } else {
                let Ok(batch) = input.batches.get(Handle::from_raw(range.target)) else {
                    continue;
                };
                batch.world(parity).matrices()
            };
            upload(base, matrices, range.start, range.count)?;
        }
        Ok(())
    }

    fn begin_pass(&self, list: &mut DrawList) -> Result<(), RecordError> {
        // The targets hold sRGB-encoded values, as the shaders write them.
        let [r, g, b] = self.lighting.background.map(linear_to_srgb);
        list.push(
            Op::BeginRenderPass,
            &[
                ids::COLOR,
                0,
                ids::DEPTH,
                r.to_bits(),
                g.to_bits(),
                b.to_bits(),
                1f32.to_bits(),
                0f32.to_bits(),
                pass_flags::CLEAR_COLOR | pass_flags::CLEAR_DEPTH,
            ],
        )?;
        Ok(())
    }

    /// A frame with no camera: the background only.
    fn clear_only(&self, list: &mut DrawList) -> Result<(), RecordError> {
        self.begin_pass(list)?;
        list.push(Op::EndRenderPass, &[])?;
        list.push(Op::Submit, &[])?;
        Ok(())
    }
}

/// Encodes a linear color channel as sRGB.
pub fn linear_to_srgb(c: f32) -> f32 {
    if c <= 0.003_130_8 {
        12.92 * c
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}
