//! The skinning pass: a compute pass that morphs and skins each skinned or morphed mesh that some
//! view draws, once per frame, into the skinned vertex buffer. The shadow passes and the scene
//! passes then draw the skinned vertices as plain meshes, so their pipelines are those of meshes
//! without joints or morph targets, and every template, custom materials' too, draws skinned and
//! morphed meshes as it is.
//!
//! # Layout
//!
//! When the scene's structure changes, each skinned or morphed scene object (see
//! [`crate::skinning`] and [`crate::morph`]) gets a region of a skinned vertex buffer for each part
//! of its mesh, as large as the part's vertices in the mesh's skinned format. The regions stay
//! until the structure changes again, so the views' bundles draw from them without being recorded
//! again. A skinned object draws from a bucket of its own, as every object with bounds of its own
//! does, and its bucket's draws read its regions in place of its mesh page's vertices, with the
//! page's indices.
//!
//! The pass binds each skinned vertex buffer whole, so none grows past the device's largest
//! storage binding. The regions fill one buffer, then the next, up to [`MAX_SKINNED_BUFFERS`],
//! with the parts of one mesh page together. Each run of parts of one page in one buffer is a
//! segment of the pass's table, with a bind group of its own. A mesh page also fits one storage
//! binding (see the builder's mesh storage), so the pass reads any part of it. Past either cap, a
//! frame fails with an error that names it: no skinned or morphed object goes without its region.
//!
//! # Each frame
//!
//! The CPU tests each skinned object's world sphere against each view that draws in the frame: the
//! camera views, and for objects that cast shadows, the cascades and tiles that draw. An object that
//! no view draws is not skinned, and keeps the vertices of an earlier frame, which no view draws.
//! The pass's table lists, for each segment, the page's vertex format and the parts of the objects
//! that some view draws, with their regions and their first joints. Each segment that has parts to
//! skin gets one dispatch, with one thread per vertex. A dispatch reaches at most 65,535 workgroups
//! along each axis, so one with more spreads them over two axes.
//!
//! The joint texture uploads the frame's skinning matrices before the passes run (see
//! [`crate::skinning::JointTexture`]), and the morph texture the frame's morph weights (see
//! [`crate::morph::MorphTexture`]).
//!
//! # Skinning in the vertex shader
//!
//! With [`super::RendererConfig::vertex_skinning`], the builder skins in the vertex shader of each
//! pass instead, as WebGL2 does: skinned objects draw their mesh's vertices with the SKIN builds,
//! which read the joint texture through a bind group of their own. Each skinned object's bucket
//! names the first joint of its skin, which the culling pass copies into each instance it draws.
//! Custom materials and the debug views have no SKIN builds, so they draw skinned meshes at rest
//! in this mode. Morphed objects, skinned or not, still go through the skinning pass, as WebGPU
//! has no MORPH builds. The mode is there to measure against the skinning pass, as decision record
//! D-20 asks.

use null3d_core::animation::Animations;
use null3d_core::morph::MorphWeights;
use null3d_core::scene::{SceneStorage, flags};
use null3d_gpu::caps::MAX_WORKGROUPS_PER_DIMENSION;
use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, layout as bind_layout, permutation, resource_kind, sizes,
    template, vertex,
};

use super::ids;
use crate::frame::{
    CellOffsets, MeshBuffers, RecordError, UploadArena, grown_size, words_as_bytes,
};
use crate::meshes::MeshStorage;
use crate::morph::{MORPH_LOCATION, MorphTexture, morph_of};
use crate::pipelines::{DrawKey, PipelineCache, built_by};
use crate::skinning::{
    COLOR_LOCATION, JointTexture, SkinnedGate, skin_of, skinned_format, skinned_in_vertex_shader,
};
use crate::sorted::SkinnedPipeline;
use crate::view::ViewFrame;

/// The templates with SKIN builds, which skin in the vertex shader.
const SKIN_TEMPLATES: [u32; 6] = [
    template::INSTANCED_LIT,
    template::INSTANCED_STANDARD_MAPS,
    template::INSTANCED_UNLIT,
    template::INSTANCED_UNLIT_MAP,
    template::SHADOW_DEPTH,
    template::OUTLINE_MASK,
];
/// The most mesh pages that hold skinned meshes. Each page holds meshes of one vertex format up
/// to a storage binding, so it takes skinned meshes of more than this many vertex formats, or more
/// skinned meshes than this many bindings hold, to pass it.
pub(super) const MAX_PAGES: u32 = 32;
/// The most skinned vertex buffers, each as large as a storage binding at most: 1 GiB in all at
/// WebGPU's default binding size.
pub const MAX_SKINNED_BUFFERS: u32 = 8;
/// The most segments of the table. Each page's parts lie together, so the segments number at most
/// the pages plus the buffers that their runs cross into.
pub(super) const MAX_SEGMENTS: u32 = MAX_PAGES + MAX_SKINNED_BUFFERS;
/// Threads per workgroup of the skinning pass.
const WORKGROUP_SIZE: u32 = 64;
/// 32-bit words of one table entry.
const ENTRY_WORDS: u32 = 4;
/// Table entries before a segment's first part: the part count, then the format.
const HEADER_ENTRIES: u32 = 4;
/// Table entries per part.
const PART_ENTRIES: u32 = 2;
/// Table entries per storage binding alignment: segments start on 256-byte boundaries.
const SEGMENT_ALIGN: u32 = 256 / (ENTRY_WORDS * 4);
/// A format field that names no attribute.
const NONE: u32 = u32::MAX;
/// The vertex location of tangents.
const TANGENT: usize = 4;
/// The vertex locations of the attributes that the pass copies unchanged, in vertex order: the
/// texture coordinates, then the color of a mesh that no target morphs.
const COPIED: [usize; 3] = [2, 3, COLOR_LOCATION];

/// The pass's pipelines, by [`Segment::pipeline`]: their ids and the permutation bits of their
/// builds. A build holds the tangent's code only for formats with a tangent, and the color's only
/// for formats whose color it morphs (see `skin.wgsl`).
const PIPELINES: [(u32, u32); 4] = [
    (ids::SKIN, 0),
    (ids::SKIN_TANGENT, permutation::VERTEX_TANGENT),
    (ids::SKIN_COLOR, permutation::VERTEX_COLOR),
    (
        ids::SKIN_TANGENT_COLOR,
        permutation::VERTEX_TANGENT | permutation::VERTEX_COLOR,
    ),
];

/// The joint base of an object that no animated instance skins.
const NOT_SKINNED: u32 = NONE;

/// One skinned or morphed object of the layout.
#[derive(Clone, Copy, Debug)]
pub(super) struct SkinnedObject {
    slot: u32,
    /// Its animated instance's first joint in the joint texture, or [`NOT_SKINNED`].
    pub(super) joint_base: u32,
    /// True when the skinning pass skins and morphs it, false when the vertex shaders skin it.
    computed: bool,
    /// Its parts: `parts` of the pass's parts from `first_part` on.
    first_part: u32,
    parts: u32,
}

/// One part of a skinned object's mesh, and its region of a skinned vertex buffer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct SkinnedPart {
    /// The mesh page that holds the part, and the segment of the table that skins it.
    page: u32,
    segment: u32,
    /// The part's first vertex in its page, and its vertex count.
    first_vertex: u32,
    vertices: u32,
    /// The skinned vertex buffer that holds its region, and the byte where the region starts.
    buffer: u32,
    region: u32,
}

impl SkinnedPart {
    /// The GPU id of the buffer that holds the part's skinned vertices, and their first byte.
    pub(super) fn vertices(&self) -> (u32, u32) {
        (ids::skinned(self.buffer), self.region)
    }
}

/// A run of skinned parts of one mesh page whose regions lie in one skinned vertex buffer: the
/// format that the pass reads, its segment of the table, and this frame's parts in it.
#[derive(Clone, Copy, Debug)]
struct Segment {
    page: u32,
    buffer: u32,
    /// The table entries of its format (see `skin.wgsl`).
    format: [[u32; 4]; 3],
    /// Its first table entry, and the parts it has room for.
    first_entry: u32,
    capacity: u32,
    /// The parts that the frame skins in it, and their workgroups.
    parts: u32,
    groups: u32,
}

impl Segment {
    /// The place in [`PIPELINES`] of the pipeline that skins its format: plus 1 for a format with
    /// a tangent, and plus 2 for one whose color the pass morphs.
    fn pipeline(&self) -> usize {
        usize::from(self.format[1][0] != NONE) | usize::from(self.format[2][2] != NONE) << 1
    }
}

/// The skinning pass's layout and GPU objects.
#[derive(Debug)]
pub(super) struct Skinning {
    /// True to skin in the vertex shader of each pass, false to skin in the skinning pass.
    vertex_shader: bool,
    objects: Vec<SkinnedObject>,
    parts: Vec<SkinnedPart>,
    /// The mesh pages that hold skinned parts, in the order the objects first name them, with
    /// their vertex formats.
    pages: Vec<(u32, u32)>,
    segments: Vec<Segment>,
    /// Bytes of skinned vertices that the layout needs in each skinned vertex buffer, and that
    /// each of the GPU's holds.
    skinned_bytes: [u32; MAX_SKINNED_BUFFERS as usize],
    skinned_made: [u32; MAX_SKINNED_BUFFERS as usize],
    /// Table entries the layout needs, and that the GPU's buffer holds.
    table_entries: u32,
    table_made: u32,
    /// True when the bind groups must be made again before the next dispatch.
    groups_stale: bool,
    /// Which of [`PIPELINES`] the GPU has.
    pipelines_made: [bool; PIPELINES.len()],
    /// The frame whose list created the pass's newest pipeline.
    pipeline_frame: u32,
    /// Whether the passes draw the skinned objects yet.
    gate: SkinnedGate,
    joints: JointTexture,
    morph: MorphTexture,
    /// The objects that the skinning pass skins or morphs.
    computed: u32,
    /// Whether some view draws each object in the frame being recorded.
    seen: Vec<bool>,
    /// The frame's table, as it uploads.
    table: Vec<u32>,
}

impl Default for Skinning {
    fn default() -> Self {
        Self::new(false)
    }
}

impl Skinning {
    /// Skinning in the skinning pass, or with `vertex_shader`, in the vertex shader of each pass.
    pub(super) fn new(vertex_shader: bool) -> Self {
        Self {
            vertex_shader,
            objects: Vec::new(),
            parts: Vec::new(),
            pages: Vec::new(),
            segments: Vec::new(),
            skinned_bytes: [0; MAX_SKINNED_BUFFERS as usize],
            skinned_made: [0; MAX_SKINNED_BUFFERS as usize],
            table_entries: 0,
            table_made: 0,
            groups_stale: true,
            pipelines_made: [false; PIPELINES.len()],
            pipeline_frame: 0,
            gate: SkinnedGate::default(),
            joints: JointTexture::new(ids::JOINTS),
            morph: MorphTexture::new(ids::MORPHS, ids::MORPH_WEIGHTS),
            computed: 0,
            seen: Vec::new(),
            table: Vec::new(),
        }
    }
}

/// The group index of the first bind group after the frame's in the mesh pipelines.
const FIRST_GROUP: u32 = 1;
/// The bind groups after the frame's that a mesh pipeline reads at most: a material's maps, the
/// joint texture and the view's index group.
const MESH_GROUPS: usize = 3;

/// The bind groups after the frame's that a bundle or a pass has set while it records its draws.
/// A mesh pipeline reads, one after another from the group after the frame's: a material's maps
/// where it samples them, the joint texture where it skins in the vertex shader, and the view's
/// index group where it reads its instances by index.
#[derive(Debug, Default)]
pub(super) struct DrawGroups {
    /// The group set at each index after the frame's, or 0 for none yet.
    bound: [u32; MESH_GROUPS],
}

impl DrawGroups {
    /// Sets the groups that a draw's pipeline reads where they differ from those set: the maps'
    /// group `maps`, or 0 for a pipeline that samples none, with `skins`, the joint texture's, and
    /// the index group `index`, or 0 for a pipeline that reads copies.
    pub(super) fn set(
        &mut self,
        list: &mut DrawList,
        maps: u32,
        skins: bool,
        index: u32,
    ) -> Result<(), RecordError> {
        let joints = if skins { ids::JOINTS_GROUP } else { 0 };
        let wanted = [maps, joints, index]
            .into_iter()
            .filter(|&group| group != 0);
        for (slot, group) in wanted.enumerate() {
            if self.bound[slot] != group {
                list.push(Op::SetBindGroup, &[FIRST_GROUP + slot as u32, group, 0])?;
                self.bound[slot] = group;
            }
        }
        Ok(())
    }
}

/// A format field: the attribute's word offset in a vertex of `format` and its type code, or
/// [`NONE`] for an attribute that the format lacks.
fn field(format: u32, location: usize) -> u32 {
    match (
        vertex::offset(format, location),
        vertex::type_of(format, location),
    ) {
        (Some(offset), Some(ty)) => (offset / 4) | ((ty as u32) << 8),
        _ => NONE,
    }
}

/// A run of words that the pass copies unchanged: the attributes at `locations` that `format`
/// has, which sit together in both a source vertex and a skinned one. Its source offset, skinned
/// offset and length in words, a byte each, or 0 for none.
fn copied_run(format: u32, skinned: u32, locations: &[usize]) -> u32 {
    let mut present = locations
        .iter()
        .copied()
        .filter(|&location| vertex::offset(format, location).is_some());
    let Some(first) = present.next() else {
        return 0;
    };
    let last = present.next_back().unwrap_or(first);
    let start = |f: u32, location: usize| vertex::offset(f, location).unwrap_or(0);
    let end = start(format, last)
        + vertex::ATTRIBUTES[last].size(vertex::type_of(format, last).unwrap_or(vertex::Type::F32));
    let words = (end - start(format, first)) / 4;
    (start(format, first) / 4) | ((start(skinned, first) / 4) << 8) | (words << 16)
}

/// The table entries of a source vertex format: the strides, where each attribute sits, and the
/// runs that the pass copies (see `skin.wgsl`). A morphed mesh's color is no run: the pass morphs
/// it and writes it as floats, where its field says.
fn format_entries(format: u32) -> [[u32; 4]; 3] {
    let skinned = skinned_format(format);
    // A field of the source format with its offset in the skinned vertex in the third byte.
    let moved = |location: usize| match vertex::offset(skinned, location) {
        Some(out) => field(format, location) | ((out / 4) << 16),
        None => NONE,
    };
    let morphed = format & vertex::MORPH != 0;
    let color = if morphed { moved(COLOR_LOCATION) } else { NONE };
    let copied = if morphed { &COPIED[2..2] } else { &COPIED[2..] };
    [
        [
            vertex::stride(format) / 4,
            vertex::stride(skinned) / 4,
            field(format, vertex::POSITION),
            field(format, vertex::NORMAL),
        ],
        [
            moved(TANGENT),
            field(format, 6),
            field(format, 7),
            field(format, MORPH_LOCATION),
        ],
        [
            copied_run(format, skinned, &COPIED[..2]),
            copied_run(format, skinned, copied),
            color,
            0,
        ],
    ]
}

impl Skinning {
    /// True while the scene draws skinned or morphed objects.
    pub(super) fn active(&self) -> bool {
        !self.objects.is_empty()
    }

    /// True while the skinning pass runs: the scene draws objects that the vertex shaders do not
    /// skin.
    pub(super) fn dispatches(&self) -> bool {
        self.computed > 0
    }

    /// True when the vertex shaders skin the object at scene slot `slot`.
    pub(super) fn skins_in_vertex_shader(&self, slot: u32) -> bool {
        self.object(slot).is_some_and(|object| !object.computed)
    }

    /// True when the layouts leave out the object at scene slot `slot`: a skinned or morphed
    /// object, while the pipelines that skin, morph and draw such objects are not built yet.
    pub(super) fn hides(&self, slot: u32) -> bool {
        !self.gate.drawn() && self.object(slot).is_some()
    }

    /// True when the GPU has each pipeline that the layout's segments skin with.
    fn has_pipelines(&self) -> bool {
        self.segments
            .iter()
            .all(|s| self.pipelines_made[s.pipeline()])
    }

    /// Lets the passes draw the skinned objects once the pass's pipelines are built, where the
    /// skinning pass runs, and every pipeline in `waiting` is built, by `pipelines_built` (see
    /// [`SkinnedGate`]). Returns true when they start to draw, so the layouts take them in.
    pub(super) fn open_when_built(
        &mut self,
        pipelines: &PipelineCache,
        waiting: impl Iterator<Item = u32>,
        pipelines_built: u32,
    ) -> bool {
        let skinned = self.active();
        let pass_built = !self.dispatches()
            || (self.has_pipelines() && built_by(self.pipeline_frame, pipelines_built));
        self.gate.open_when_built(skinned, pipelines_built, || {
            pass_built && pipelines.all_built(waiting, pipelines_built)
        })
    }

    /// Lets the passes draw the skinned objects at once while the thread that draws has drawn no
    /// frame yet, since the first frame waits for every pipeline.
    pub(super) fn open_before_first_frame(&mut self, pipelines_built: u32) {
        let skinned = self.active();
        self.gate
            .open_when_built(skinned, pipelines_built, || false);
    }

    /// Records that the layouts left the skinned objects out and asked for their pipelines.
    pub(super) fn asked(&mut self) {
        if self.active() {
            self.gate.asked();
        }
    }

    /// The key of the pipeline that draws skinned or morphed object `object`, whose pair's
    /// pipeline has `key`: the pair's for the plain vertices of the mesh's skinned format, which
    /// the skinning pass writes, or the SKIN build of the pair's where the vertex shader skins.
    pub(super) fn skinned_key(&self, object: &SkinnedObject, key: DrawKey) -> DrawKey {
        if object.computed {
            return DrawKey {
                vertex_format: skinned_format(key.vertex_format),
                ..key
            };
        }
        // Custom materials, the debug views and the test templates have no SKIN builds on WebGPU,
        // so they draw the mesh at rest in this mode.
        if SKIN_TEMPLATES.contains(&key.template) {
            skinned_in_vertex_shader(key)
        } else {
            key
        }
    }

    /// How the object at scene slot `slot`, whose pair's pipeline has `key`, draws in the
    /// transparent pass by its skinning and morph targets.
    pub(super) fn sorted_pipeline(&self, slot: u32, key: DrawKey) -> SkinnedPipeline {
        match self.object(slot) {
            None => SkinnedPipeline::NotSkinned,
            Some(object) if self.gate.drawn() => {
                SkinnedPipeline::Drawn(self.skinned_key(&object, key))
            }
            Some(object) => SkinnedPipeline::Waiting(self.skinned_key(&object, key)),
        }
    }

    /// The skinned or morphed object at scene slot `slot`, or `None` for an object that is
    /// neither.
    pub(super) fn object(&self, slot: u32) -> Option<SkinnedObject> {
        let k = self.objects.binary_search_by_key(&slot, |o| o.slot).ok()?;
        Some(self.objects[k])
    }

    /// The parts of the skinned or morphed object at scene slot `slot`, with their regions of the
    /// skinned vertex buffer, in the order of its mesh's parts, or `None` for an object that is
    /// neither or that the vertex shaders skin.
    pub(super) fn parts_of(&self, slot: u32) -> Option<&[SkinnedPart]> {
        let object = self.object(slot).filter(|object| object.computed)?;
        let first = object.first_part as usize;
        Some(&self.parts[first..first + object.parts as usize])
    }

    /// Lays out the skinned and morphed objects of the scene as it stands: a region of a skinned
    /// vertex buffer of at most `buffer_bytes` for each part of each such object's mesh that the
    /// pass skins or morphs, page by page, and a segment of the table for each run of one page's
    /// parts in one buffer. Fails, with no object laid out, when the parts need more mesh pages or
    /// skinned vertex buffers than the pass has.
    pub(super) fn rebuild(
        &mut self,
        scene: &SceneStorage,
        animations: Option<&Animations>,
        morphs: &MorphWeights,
        meshes: &MeshStorage,
        buffer_bytes: u32,
    ) -> Result<(), RecordError> {
        self.morph.rebuild(scene, morphs, meshes);
        let laid_out = self
            .gather(scene, animations, morphs, meshes)
            .and_then(|()| self.place(buffer_bytes));
        if laid_out.is_err() {
            self.objects.clear();
            self.parts.clear();
            self.segments.clear();
            self.computed = 0;
        }
        let mut entries = 0;
        for segment in &mut self.segments {
            segment.first_entry = entries;
            let used = HEADER_ENTRIES + PART_ENTRIES * segment.capacity;
            entries += used.next_multiple_of(SEGMENT_ALIGN);
        }
        self.table_entries = entries;
        self.seen.clear();
        self.seen.resize(self.objects.len(), false);
        // A segment's bind group binds its part of the table and its buffer, which a new layout
        // can move.
        self.groups_stale = true;
        laid_out
    }

    /// Lists the skinned and morphed objects in slot order and the parts of their meshes that the
    /// pass skins or morphs, with the mesh pages that hold those parts and the pages' vertex
    /// formats.
    fn gather(
        &mut self,
        scene: &SceneStorage,
        animations: Option<&Animations>,
        morphs: &MorphWeights,
        meshes: &MeshStorage,
    ) -> Result<(), RecordError> {
        self.objects.clear();
        self.parts.clear();
        self.pages.clear();
        self.computed = 0;
        let rows = scene.capacity() as usize + 1;
        for slot in 0..rows {
            if !scene.created().get(slot as u32) {
                continue;
            }
            let skin = skin_of(scene, animations, meshes, slot).map(|(joint_base, _)| joint_base);
            let morphed = morph_of(scene, morphs, meshes, slot).is_some();
            if skin.is_none() && !morphed {
                continue;
            }
            let Some(mesh) = meshes.mesh(scene.meshes()[slot] - 1) else {
                continue;
            };
            let computed = morphed || !self.vertex_shader;
            self.computed += u32::from(computed);
            let first_part = self.parts.len() as u32;
            let parts = if computed { meshes.parts(mesh) } else { &[] };
            for part in parts {
                if !self.pages.iter().any(|&(page, _)| page == part.page) {
                    if self.pages.len() == MAX_PAGES as usize {
                        return Err(RecordError::SkinnedPagesFull { limit: MAX_PAGES });
                    }
                    self.pages.push((part.page, mesh.format));
                }
                self.parts.push(SkinnedPart {
                    page: part.page,
                    segment: 0,
                    first_vertex: part.base_vertex,
                    vertices: part.vertex_count,
                    buffer: 0,
                    region: 0,
                });
            }
            self.objects.push(SkinnedObject {
                slot: slot as u32,
                joint_base: skin.unwrap_or(NOT_SKINNED),
                computed,
                first_part,
                parts: self.parts.len() as u32 - first_part,
            });
        }
        Ok(())
    }

    /// Gives each part its region, page by page so that each page's parts lie together: in the
    /// skinned vertex buffer being filled while the region fits `buffer_bytes`, and in the next
    /// buffer otherwise. Starts a segment wherever the page or the buffer changes.
    fn place(&mut self, buffer_bytes: u32) -> Result<(), RecordError> {
        self.segments.clear();
        self.skinned_bytes = [0; MAX_SKINNED_BUFFERS as usize];
        let full = RecordError::SkinnedVerticesFull {
            megabytes: ((u64::from(MAX_SKINNED_BUFFERS) * u64::from(buffer_bytes)) >> 20) as u32,
        };
        let mut buffer = 0;
        for &(page, format) in &self.pages {
            let stride = vertex::stride(skinned_format(format));
            for part in self.parts.iter_mut().filter(|part| part.page == page) {
                let bytes = part.vertices * stride;
                let used = self.skinned_bytes[buffer];
                if u64::from(used) + u64::from(bytes) > u64::from(buffer_bytes) {
                    buffer += 1;
                    if used == 0 || buffer == MAX_SKINNED_BUFFERS as usize {
                        return Err(full);
                    }
                }
                let continues = self
                    .segments
                    .last()
                    .is_some_and(|s| s.page == page && s.buffer == buffer as u32);
                if !continues {
                    self.segments.push(Segment {
                        page,
                        buffer: buffer as u32,
                        format: format_entries(format),
                        first_entry: 0,
                        capacity: 0,
                        parts: 0,
                        groups: 0,
                    });
                }
                let segment = self.segments.len() - 1;
                self.segments[segment].capacity += 1;
                part.segment = segment as u32;
                part.buffer = buffer as u32;
                part.region = self.skinned_bytes[buffer];
                self.skinned_bytes[buffer] += bytes;
            }
        }
        Ok(())
    }

    /// Records the creation of the pass's pipelines that the layout's segments need and the GPU
    /// lacks, in the list of `frame`. Returns true when it recorded one. Pipelines come first in a
    /// frame's list.
    pub(super) fn create_pipeline(
        &mut self,
        list: &mut DrawList,
        frame: u32,
    ) -> Result<bool, RecordError> {
        if !self.dispatches() {
            return Ok(false);
        }
        let mut created = false;
        for (k, &(id, bits)) in PIPELINES.iter().enumerate() {
            if self.pipelines_made[k] || !self.segments.iter().any(|s| s.pipeline() == k) {
                continue;
            }
            list.push(Op::CreateComputePipeline, &[id, template::SKIN, bits])?;
            self.pipelines_made[k] = true;
            created = true;
        }
        if created {
            self.pipeline_frame = frame;
        }
        Ok(created)
    }

    /// Records the GPU objects the layout needs that the GPU lacks: the joint texture, the morph
    /// texture, the skinned vertex buffers and the table, and the bind groups when the layout or a
    /// buffer they bind is new, mesh pages' buffers included (`pages_remade`). Returns true when it
    /// made a skinned vertex buffer again, or the bind group of the joint texture that the vertex
    /// shaders read, which the bundles that draw from them must see.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn apply(
        &mut self,
        list: &mut DrawList,
        animations: Option<&Animations>,
        storage: &MeshStorage,
        meshes: &MeshBuffers,
        pages_remade: bool,
        binding_bytes: u32,
    ) -> Result<bool, RecordError> {
        if !self.active() {
            return Ok(false);
        }
        let made_joints = self.joints.create(list, animations)?;
        let made_morph = self.morph.size(list, storage, self.dispatches())?;
        self.groups_stale |= made_joints || made_morph || pages_remade;
        let mut remade = false;
        if made_joints && self.vertex_shader {
            // The SKIN builds read the joint texture through a bind group of its own.
            let id = self.joints.id();
            let entry = [0, resource_kind::TEXTURE, id, 0, 0];
            let mut words = [0u32; 3 + 5];
            words[..3].copy_from_slice(&[ids::JOINTS_GROUP, bind_layout::JOINTS, 1]);
            words[3..].copy_from_slice(&entry);
            list.push(Op::CreateBindGroup, &words)?;
            remade = true;
        }
        for (buffer, (&needed, made)) in self
            .skinned_bytes
            .iter()
            .zip(&mut self.skinned_made)
            .enumerate()
        {
            if *made < needed {
                *made = grown_size(needed, binding_bytes);
                let flags = usage::STORAGE | usage::VERTEX;
                let id = ids::skinned(buffer as u32);
                list.push(Op::CreateBuffer, &[id, *made, flags])?;
                remade = true;
            }
        }
        let table_bytes = self.table_entries * ENTRY_WORDS * 4;
        if self.table_made < table_bytes {
            self.table_made = grown_size(table_bytes, binding_bytes);
            let flags = usage::STORAGE | usage::COPY_DST;
            list.push(Op::CreateBuffer, &[ids::SKIN_TABLE, self.table_made, flags])?;
            self.groups_stale = true;
        }
        if remade || self.groups_stale {
            let [deltas, weights] = self.morph.ids();
            for (k, segment) in self.segments.iter().enumerate() {
                let (vertices, _) = meshes.ids(segment.page);
                let source = meshes.vertex_bytes(segment.page).min(binding_bytes);
                let first = segment.first_entry * ENTRY_WORDS * 4;
                let size = (HEADER_ENTRIES + PART_ENTRIES * segment.capacity) * ENTRY_WORDS * 4;
                let entry = |binding: u32, kind: u32, id: u32, offset: u32, size: u32| {
                    [binding, kind, id, offset, size]
                };
                let entries = [
                    entry(0, resource_kind::BUFFER, ids::SKIN_TABLE, first, size),
                    entry(1, resource_kind::BUFFER, vertices, 0, source),
                    entry(2, resource_kind::BUFFER, ids::skinned(segment.buffer), 0, 0),
                    entry(3, resource_kind::TEXTURE, self.joints.id(), 0, 0),
                    entry(4, resource_kind::TEXTURE, deltas, 0, 0),
                    entry(5, resource_kind::TEXTURE, weights, 0, 0),
                ];
                let mut words = [0u32; 3 + 6 * 5];
                words[..3].copy_from_slice(&[ids::SKIN_GROUPS + k as u32, bind_layout::SKIN, 6]);
                words[3..].copy_from_slice(entries.as_flattened());
                list.push(Op::CreateBindGroup, &words)?;
            }
            self.groups_stale = false;
        }
        Ok(remade)
    }

    /// Starts a frame: no view draws any skinned or morphed object yet.
    pub(super) fn begin_frame(&mut self) {
        self.seen.fill(false);
    }

    /// Marks the skinned objects that a view draws: those whose world sphere, moved by its cell's
    /// offset from the view's camera in `offsets`, lies in the view's frustum, with a layer the
    /// view draws. A shadow view (`casters`) draws only objects that cast shadows.
    pub(super) fn see(
        &mut self,
        frame: &ViewFrame,
        offsets: &CellOffsets,
        scene: &SceneStorage,
        parity: usize,
        casters: bool,
    ) {
        let world = scene.world(parity);
        let offsets = offsets.as_slice();
        for (object, seen) in self.objects.iter().zip(&mut self.seen) {
            if *seen {
                continue;
            }
            let s = object.slot as usize;
            if casters && scene.flags()[s] & flags::CAST_SHADOWS == 0
                || scene.layers()[s] & frame.layers == 0
            {
                continue;
            }
            let Some(offset) = offsets.get(scene.cells()[s] as usize) else {
                continue;
            };
            let (x, y, z) = (world.xs()[s], world.ys()[s], world.zs()[s]);
            let radius = world.radii()[s];
            *seen =
                frame
                    .frustum
                    .contains_sphere(x + offset[0], y + offset[1], z + offset[2], radius);
        }
    }

    /// The most that one frame copies into its arena: the whole table, and the morph texture's
    /// deltas and weights.
    pub(super) fn upload_bound(&self, storage: &MeshStorage) -> usize {
        (self.table_entries * ENTRY_WORDS * 4) as usize + self.morph.upload_bound(storage)
    }

    /// Uploads the frame's joint matrices, its morph weights, and the parts to skin and morph of
    /// each segment: those of the objects that some view draws, with their workgroups.
    pub(super) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        animations: Option<&Animations>,
        morphs: &MorphWeights,
        storage: &MeshStorage,
    ) -> Result<(), RecordError> {
        if !self.active() {
            return Ok(());
        }
        if let Some(animations) = animations {
            self.joints.upload(list, animations)?;
        }
        self.morph
            .upload(list, arena, morphs, animations, storage)?;
        self.table.clear();
        self.table
            .resize((self.table_entries * ENTRY_WORDS) as usize, 0);
        for segment in &mut self.segments {
            segment.parts = 0;
            segment.groups = 0;
        }
        for (object, &seen) in self.objects.iter().zip(&self.seen) {
            if !seen {
                continue;
            }
            let first = object.first_part as usize;
            for part in &self.parts[first..first + object.parts as usize] {
                let Some(segment) = self.segments.get_mut(part.segment as usize) else {
                    continue;
                };
                let groups = part.vertices.div_ceil(WORKGROUP_SIZE);
                let entry = segment.first_entry + HEADER_ENTRIES + PART_ENTRIES * segment.parts;
                let at = (entry * ENTRY_WORDS) as usize;
                self.table[at..at + 8].copy_from_slice(&[
                    segment.groups,
                    part.vertices,
                    part.first_vertex,
                    part.region / 4,
                    object.joint_base,
                    self.morph.base(object.slot),
                    0,
                    0,
                ]);
                segment.parts += 1;
                segment.groups += groups;
            }
        }
        for segment in &self.segments {
            if segment.parts == 0 {
                continue;
            }
            let at = (segment.first_entry * ENTRY_WORDS) as usize;
            self.table[at] = segment.parts;
            self.table[at + 4..at + 16].copy_from_slice(segment.format.as_flattened());
            let end = at + ((HEADER_ENTRIES + PART_ENTRIES * segment.parts) * ENTRY_WORDS) as usize;
            let (from, bytes) = arena.push(words_as_bytes(&self.table[at..end]))?;
            list.push(
                Op::WriteBuffer,
                &[
                    ids::SKIN_TABLE,
                    segment.first_entry * ENTRY_WORDS * 4,
                    from,
                    bytes,
                ],
            )?;
        }
        Ok(())
    }

    /// Records the frame's dispatches, one per segment with parts to skin, inside the compute
    /// pass that the render graph began.
    pub(super) fn record(&self, list: &mut DrawList) -> Result<(), RecordError> {
        let mut pipeline = None;
        for (k, segment) in self.segments.iter().enumerate() {
            if segment.groups == 0 {
                continue;
            }
            let id = PIPELINES[segment.pipeline()].0;
            if pipeline != Some(id) {
                list.push(Op::SetComputePipeline, &[id])?;
                pipeline = Some(id);
            }
            list.push(Op::SetBindGroup, &[0, ids::SKIN_GROUPS + k as u32, 0])?;
            list.push(Op::Dispatch, &dispatch_size(segment.groups))?;
        }
        Ok(())
    }

    /// Forgets the GPU objects, after the thread that draws replaced the GPU.
    pub(super) fn forget_gpu(&mut self) {
        self.skinned_made = [0; MAX_SKINNED_BUFFERS as usize];
        self.table_made = 0;
        self.groups_stale = true;
        self.pipelines_made = [false; PIPELINES.len()];
        self.gate.forget_gpu();
        self.joints.forget_gpu();
        self.morph.forget_gpu();
    }
}

/// The workgroups of a dispatch of `groups` workgroups along its axes: along one while they fit,
/// and otherwise over the fewest rows that fit, with at most one workgroup per row more than
/// `groups`. The shader numbers a workgroup by its row and its place in the row.
fn dispatch_size(groups: u32) -> [u32; 3] {
    let rows = groups.div_ceil(MAX_WORKGROUPS_PER_DIMENSION);
    [groups.div_ceil(rows.max(1)), rows.max(1), 1]
}

// The workgroups of the skinning pass and the culling pass are within WebGPU's default limits.
const _: () = assert!(WORKGROUP_SIZE <= sizes::CULL_WORKGROUP_SIZE);

#[cfg(test)]
mod tests {
    use null3d_gpu::drawlist::vertex::{self, Type};

    use super::*;

    #[test]
    fn a_dispatch_spreads_past_an_axis_over_rows_that_cover_every_workgroup() {
        assert_eq!(dispatch_size(141), [141, 1, 1]);
        assert_eq!(
            dispatch_size(MAX_WORKGROUPS_PER_DIMENSION),
            [MAX_WORKGROUPS_PER_DIMENSION, 1, 1]
        );
        for groups in [
            MAX_WORKGROUPS_PER_DIMENSION + 1,
            66_270,
            1_000_000,
            MAX_WORKGROUPS_PER_DIMENSION * 300 + 7,
        ] {
            let [x, y, z] = dispatch_size(groups);
            assert!(
                x <= MAX_WORKGROUPS_PER_DIMENSION && y <= MAX_WORKGROUPS_PER_DIMENSION && z == 1
            );
            assert!(x * y >= groups && x * y - groups < y, "{groups}: {x} x {y}");
        }
    }

    #[test]
    fn a_format_tells_the_pass_where_each_attribute_sits_and_what_to_copy() {
        let bits = vertex::UV0 | vertex::TANGENT | vertex::COLOR | vertex::JOINTS | vertex::WEIGHTS;
        let format = [
            (vertex::POSITION, Type::Sint16),
            (5, Type::Unorm8),
            (6, Type::Uint16),
            (7, Type::Unorm8),
        ]
        .into_iter()
        .try_fold(bits, |f, (location, ty)| vertex::with(f, location, ty))
        .unwrap();
        // Source: position 0 (8 bytes), normal 8, uv 20, tangent 28, color 44, joints 48,
        // weights 56, 60 bytes in all. Skinned: position 0, normal 12, uv 24, tangent 32, color
        // 48, 52 bytes in all.
        let [strides, more, runs] = format_entries(format);
        assert_eq!(strides, [15, 13, (Type::Sint16 as u32) << 8, 2]);
        let tangent = 7 | (8 << 16);
        let joints = 12 | (Type::Uint16 as u32) << 8;
        let weights = 14 | (Type::Unorm8 as u32) << 8;
        assert_eq!(more, [tangent, joints, weights, NONE]);
        assert_eq!(
            runs,
            [
                5 | (6 << 8) | (2 << 16),
                11 | (12 << 8) | (1 << 16),
                NONE,
                0
            ]
        );
        // A morphed mesh's color is morphed into four floats, not copied. Source: the morph
        // attribute after the weights, at 60 bytes. Skinned: the color at 48, 64 bytes in all.
        let morphed = format | vertex::MORPH;
        let [strides, more, runs] = format_entries(morphed);
        assert_eq!(strides[..2], [17, 16]);
        assert_eq!(more[3], 15);
        let color = 11 | (Type::Unorm8 as u32) << 8 | (12 << 16);
        assert_eq!(runs, [5 | (6 << 8) | (2 << 16), 0, color, 0]);
        // Floats with no tangent, coordinates or color: nothing to copy.
        let plain = format_entries(vertex::JOINTS | vertex::WEIGHTS);
        assert_eq!(plain[1][0], NONE);
        assert_eq!(plain[2], [0, 0, NONE, 0]);
    }

    #[test]
    fn a_format_picks_the_build_that_holds_only_the_code_it_needs() {
        let build = |format: u32| {
            let segment = Segment {
                page: 0,
                buffer: 0,
                format: format_entries(format),
                first_entry: 0,
                capacity: 0,
                parts: 0,
                groups: 0,
            };
            PIPELINES[segment.pipeline()].1
        };
        let skinned = vertex::JOINTS | vertex::WEIGHTS;
        assert_eq!(build(skinned), 0);
        assert_eq!(
            build(skinned | vertex::TANGENT),
            permutation::VERTEX_TANGENT
        );
        // A color that the pass copies needs no color code, and a morphed one does.
        assert_eq!(build(skinned | vertex::COLOR), 0);
        assert_eq!(
            build(vertex::COLOR | vertex::MORPH),
            permutation::VERTEX_COLOR
        );
        assert_eq!(
            build(vertex::TANGENT | vertex::COLOR | vertex::MORPH),
            permutation::VERTEX_TANGENT | permutation::VERTEX_COLOR
        );
    }
}
