//! Mesh storage. Meshes of one vertex format share pages. On WebGPU a page is a large vertex
//! buffer and index buffer, and a draw selects its mesh with `first_index` and `base_vertex`.
//! WebGL2 has no base-vertex draw, so there a page holds at most 65,535 vertices, with each mesh's
//! indices rebased to its page, so one vertex array object serves a whole page.
//!
//! Indices are 16-bit on both paths. WebGL2 always treats the largest 16-bit index, 65,535, as a
//! primitive restart, which drops the triangle that uses it, so indices reach 65,535 vertices from
//! a draw's base vertex. A mesh with more vertices splits into parts: runs of whole triangles, in
//! their order, that each use at most that many vertices. Each part holds its own copy of the
//! vertices it uses, sits in one page, and draws with its own draw.
//!
//! The wireframe debug view draws lines, and WebGL2 has no line fill mode, so each part can also
//! keep an edge list: two indices for each edge of each of its triangles, in its page after the
//! indices it had then. The storage makes the edge lists the first time the view asks for them,
//! and from then on gives each new part its own.
//!
//! Removing meshes packs the storage again: the parts, joint spheres, reaches and delta texels of
//! the meshes that stay move down over those of the removed ones, in each page and in each list,
//! so a scene that loads and drops models keeps the same memory. A removal reports where each
//! page and the delta texels first changed ([`MeshMoves`]), and the GPU copies upload again from
//! there. A removed mesh's id goes to the next mesh added.

use null3d_core::bvh::mesh::Triangles;
use null3d_gpu::drawlist::vertex;

use crate::geometry::Geometry;
use crate::morph::{MORPH_LOCATION, MorphError, MorphTargets, with_ranges};

/// The most vertices one part of a mesh uses, and the most a WebGL2 page holds: what 16-bit
/// indices reach below 65,535, the index that WebGL2 always reads as a primitive restart.
pub const MAX_PAGE_VERTICES: u32 = u16::MAX as u32;
/// No page's vertex or index buffer grows past this, the portable limit on buffer size.
pub const MAX_BUFFER_BYTES: u64 = 256 * 1024 * 1024;

/// How meshes are packed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Packing {
    /// WebGPU: shared buffers, draws use `base_vertex`.
    SharedBuffers,
    /// WebGL2: pages of at most 65,535 vertices with rebased indices.
    Pages,
}

/// One part of a mesh: a range of one page's indices, which one draw draws.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MeshPart {
    /// Index of the page holding the part.
    pub page: u32,
    pub first_index: u32,
    pub index_count: u32,
    /// Added to every index when drawing; always 0 with `Packing::Pages`, whose indices are rebased.
    pub base_vertex: u32,
    /// The vertices that the part holds, from its first one in its page on.
    pub vertex_count: u32,
    /// The page's vertex where the part's vertices start.
    pub first_vertex: u32,
}

/// Where one mesh lives.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MeshSlot {
    /// The vertex format of the mesh and of every page that holds a part of it.
    pub format: u32,
    /// The mesh's parts: `part_count` entries of the storage's part list, from `first_part` on.
    first_part: u32,
    part_count: u32,
    pub vertex_count: u32,
    /// The distance from the mesh's origin to its farthest vertex, for bounding spheres.
    pub radius: f32,
    /// The joints that a skinned mesh's vertices name: its largest joint number plus one, or 0
    /// for a mesh without joints and weights.
    pub joints: u32,
    /// Where the mesh's joint spheres start in the storage's list of them.
    first_sphere: u32,
    /// The mesh's morph targets, 0 for none.
    pub targets: u32,
    /// Where each target's reach starts in the storage's list of them.
    first_reach: u32,
    /// The mesh's delta texels: `texels` of the storage's list of them, from `first_texel` on.
    first_texel: u32,
    texels: u32,
}

/// One shared buffer or page: interleaved vertices of one format, as the GPU reads their bytes,
/// and 16-bit indices.
#[derive(Debug, Default)]
pub struct Page {
    pub format: u32,
    pub vertices: Vec<u8>,
    pub indices: Vec<u16>,
}

impl Page {
    pub fn vertex_count(&self) -> u32 {
        (self.vertices.len() / vertex::stride(self.format) as usize) as u32
    }

    /// The position of vertex `v`, which every format stores first, as shaders read it.
    #[inline(always)]
    pub fn position(&self, v: u32) -> [f32; 3] {
        let at = v as usize * vertex::stride(self.format) as usize;
        let ty = vertex::type_of(self.format, vertex::POSITION).unwrap_or(vertex::Type::F32);
        let size = ty.bytes() as usize;
        [0, 1, 2].map(|c| ty.decode(&self.vertices[at + c * size..]))
    }

    /// Bytes of the page's vertex buffer and index buffer, whose writes are whole 4-byte words.
    /// Every vertex format takes whole words, so the vertices always do.
    pub fn buffer_bytes(&self) -> (u64, u64) {
        (
            self.vertices.len() as u64,
            (self.indices.len() * 2).next_multiple_of(4) as u64,
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MeshError {
    /// An index points past the mesh's vertices.
    IndexOutOfRange { index: u32, vertices: u32 },
    /// The index count is not a multiple of three.
    NotTriangles,
    /// A page cannot hold one triangle of the mesh's format: the page limit is too small.
    PageTooSmall,
    /// The mesh's morph targets make no morphed mesh.
    Morph(MorphError),
    /// The engine's memory could not grow by `bytes` for the mesh. The storage holds no part of it.
    OutOfMemory { bytes: u64 },
}

/// Room for `more` values in `v`, or the bytes they need when memory cannot grow.
fn reserve<T>(v: &mut Vec<T>, more: usize) -> Result<(), MeshError> {
    v.try_reserve(more).map_err(|_| MeshError::OutOfMemory {
        bytes: (more as u64).saturating_mul(size_of::<T>() as u64),
    })
}

#[derive(Debug)]
pub struct MeshStorage {
    packing: Packing,
    max_page_bytes: u64,
    pages: Vec<Page>,
    parts: Vec<MeshPart>,
    meshes: Vec<MeshSlot>,
    /// The joint spheres of every skinned mesh, mesh after mesh (see [`joint_spheres`]).
    spheres: Vec<[f32; 4]>,
    /// The delta texels of every morphed mesh's targets, mesh after mesh (see [`crate::morph`]).
    morph_texels: Vec<[u16; 4]>,
    /// How far each target of each morphed mesh moves a position at weight 1.
    reaches: Vec<f32>,
    /// Each part's edge list as a part of its page, in the order of `parts`, once made.
    edge_parts: Vec<MeshPart>,
    /// True once every part has an edge list, so each new part gets one too.
    edges: bool,
    /// True while draws take each part's edge list in place of its triangles.
    drawing_edges: bool,
    /// True for each id whose mesh is live.
    live: Vec<bool>,
    /// The ids of removed meshes, which the next meshes take lowest first.
    free: Vec<u32>,
}

/// Where a removal changed the storage's data, which the GPU copies then upload again.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MeshMoves {
    /// Each changed page: its index, its first changed vertex byte, and its first changed index.
    pub pages: Vec<(u32, usize, usize)>,
    /// The first delta texel that changed, if any did.
    pub morph_texels: Option<u32>,
}

/// A mesh's triangles in their order, as its parts' pages hold them: what queries test.
#[derive(Clone, Copy, Debug)]
pub struct MeshTriangles<'a> {
    pages: &'a [Page],
    parts: &'a [MeshPart],
    count: u32,
}

impl Triangles for MeshTriangles<'_> {
    #[inline(always)]
    fn count(&self) -> u32 {
        self.count
    }

    #[inline(always)]
    fn triangle(&self, i: u32) -> [[f32; 3]; 3] {
        // Most meshes have one part; a mesh too large for one has a few.
        let mut local = i;
        for part in self.parts {
            let triangles = part.index_count / 3;
            if local < triangles {
                let page = &self.pages[part.page as usize];
                let at = (part.first_index + local * 3) as usize;
                return std::array::from_fn(|c| {
                    page.position(u32::from(page.indices[at + c]) + part.base_vertex)
                });
            }
            local -= triangles;
        }
        [[f32::NAN; 3]; 3]
    }
}

/// A vertex that the part being built does not use yet.
const UNUSED: u32 = u32::MAX;

impl MeshStorage {
    pub fn new(packing: Packing) -> Self {
        Self::with_page_limit(packing, MAX_BUFFER_BYTES)
    }

    /// Storage whose pages' vertex and index buffers each hold at most `max_page_bytes`.
    pub fn with_page_limit(packing: Packing, max_page_bytes: u64) -> Self {
        Self {
            packing,
            max_page_bytes,
            pages: Vec::new(),
            parts: Vec::new(),
            meshes: Vec::new(),
            spheres: Vec::new(),
            morph_texels: Vec::new(),
            reaches: Vec::new(),
            edge_parts: Vec::new(),
            edges: false,
            drawing_edges: false,
            live: Vec::new(),
            free: Vec::new(),
        }
    }

    pub fn pages(&self) -> &[Page] {
        &self.pages
    }

    /// The live mesh with id `id`.
    pub fn mesh(&self, id: u32) -> Option<&MeshSlot> {
        self.meshes
            .get(id as usize)
            .filter(|_| self.live[id as usize])
    }

    /// The joint spheres of a skinned mesh, one per joint it names (see [`joint_spheres`]), or
    /// none for a mesh without joints.
    pub fn joint_spheres(&self, mesh: &MeshSlot) -> &[[f32; 4]] {
        let first = mesh.first_sphere as usize;
        &self.spheres[first..first + mesh.joints as usize]
    }

    /// The delta texels of every morphed mesh's targets, in half floats, which the texture of
    /// deltas uploads.
    pub fn morph_texels(&self) -> &[[u16; 4]] {
        &self.morph_texels
    }

    /// How far each morph target of a mesh moves any position at weight 1, or none for a mesh
    /// without targets.
    pub fn reach(&self, mesh: &MeshSlot) -> &[f32] {
        let first = mesh.first_reach as usize;
        &self.reaches[first..first + mesh.targets as usize]
    }

    /// Adds a mesh whose vertices `targets` morph, and returns its id: each vertex gets the morph
    /// attribute that names its sparse entries (see [`crate::morph`]).
    pub fn add_morphed(
        &mut self,
        geometry: &Geometry,
        targets: &MorphTargets<'_>,
    ) -> Result<u32, MeshError> {
        let first = self.morph_texels.len() as u32;
        let sparse = targets
            .sparse(geometry.vertex_count(), first)
            .map_err(MeshError::Morph)?;
        let id = self.add(&with_ranges(geometry, &sparse.ranges))?;
        self.morph_texels.extend_from_slice(&sparse.texels);
        let mesh = &mut self.meshes[id as usize];
        mesh.targets = targets.targets;
        mesh.first_texel = first;
        mesh.texels = sparse.texels.len() as u32;
        mesh.first_reach = self.reaches.len() as u32;
        self.reaches.extend_from_slice(&sparse.reach);
        Ok(id)
    }

    /// The number of mesh ids handed out, removed ones included.
    pub fn count(&self) -> u32 {
        self.meshes.len() as u32
    }

    /// The triangles of mesh `id`, for queries, or `None` for an id that names no mesh.
    pub fn triangles(&self, id: u32) -> Option<MeshTriangles<'_>> {
        let mesh = self.mesh(id)?;
        let first = mesh.first_part as usize;
        let parts = &self.parts[first..first + mesh.part_count as usize];
        Some(MeshTriangles {
            pages: &self.pages,
            parts,
            count: parts.iter().map(|part| part.index_count / 3).sum(),
        })
    }

    /// The parts of a mesh, in triangle order: their triangles, or their edge lists while draws
    /// take those.
    pub fn parts(&self, mesh: &MeshSlot) -> &[MeshPart] {
        let first = mesh.first_part as usize;
        let parts = if self.drawing_edges {
            &self.edge_parts
        } else {
            &self.parts
        };
        &parts[first..first + mesh.part_count as usize]
    }

    /// Makes draws take each part's edge list in place of its triangles, or its triangles again.
    /// The first call that turns them on makes every part's edge list, which the pages upload as
    /// new indices.
    pub fn draw_edges(&mut self, on: bool) {
        if on && !self.edges {
            self.edges = true;
            self.add_edge_parts();
        }
        self.drawing_edges = on;
    }

    /// Makes the edge list of each part that has none yet.
    fn add_edge_parts(&mut self) {
        for k in self.edge_parts.len()..self.parts.len() {
            let edges = self.edge_part(self.parts[k]);
            self.edge_parts.push(edges);
        }
    }

    /// Appends a part's edge list to its page and returns where it landed: the two ends of each
    /// edge of each triangle. Edges that two triangles share draw twice. A page without room for
    /// them gives the part an empty list, which draws nothing.
    fn edge_part(&mut self, part: MeshPart) -> MeshPart {
        let page = &mut self.pages[part.page as usize];
        let first_index = page.indices.len() as u32;
        let count = part.index_count as usize * 2;
        let (_, index_bytes) = page.buffer_bytes();
        if index_bytes + (count * 2) as u64 > self.max_page_bytes {
            return MeshPart {
                first_index,
                index_count: 0,
                ..part
            };
        }
        let start = part.first_index as usize;
        for t in (start..start + part.index_count as usize).step_by(3) {
            let (a, b, c) = (page.indices[t], page.indices[t + 1], page.indices[t + 2]);
            page.indices.extend_from_slice(&[a, b, b, c, c, a]);
        }
        MeshPart {
            first_index,
            index_count: count as u32,
            ..part
        }
    }

    /// Adds a mesh and returns its id: the lowest id of a removed mesh, or a new one.
    pub fn add(&mut self, geometry: &Geometry) -> Result<u32, MeshError> {
        let vertex_count = geometry.vertex_count() as u32;
        let indices = &geometry.indices;
        if !indices.len().is_multiple_of(3) {
            return Err(MeshError::NotTriangles);
        }
        if let Some(&index) = indices.iter().find(|&&i| i >= vertex_count) {
            return Err(MeshError::IndexOutOfRange {
                index,
                vertices: vertex_count,
            });
        }
        let (max_vertices, max_indices) = self.part_limits(geometry.format)?;
        let first_part = self.parts.len() as u32;
        reserve(&mut self.meshes, 1)?;
        reserve(&mut self.live, 1)?;
        let placed = if vertex_count <= max_vertices && indices.len() <= max_indices {
            self.place(geometry.format, &geometry.vertices, indices)
                .map(|part| self.parts.push(part))
        } else {
            self.split(geometry, max_vertices, max_indices)
        };
        if let Err(error) = placed {
            // The parts placed so far sit at the ends of their pages, which no upload has reached,
            // so taking them out moves nothing that the GPU holds.
            let mut parts = Gaps::default();
            parts.add(first_part, self.parts.len() as u32 - first_part);
            self.take_out(parts, Gaps::default(), Gaps::default(), Gaps::default());
            return Err(error);
        }
        if self.edges {
            self.add_edge_parts();
        }

        let radius = (0..geometry.vertex_count())
            .map(|v| {
                let [x, y, z] = geometry.position(v);
                (x * x + y * y + z * z).sqrt()
            })
            .fold(0.0f32, f32::max);
        let first_sphere = self.spheres.len() as u32;
        self.spheres.extend(joint_spheres(geometry));
        let slot = MeshSlot {
            format: geometry.format,
            first_part,
            part_count: self.parts.len() as u32 - first_part,
            vertex_count,
            radius,
            joints: self.spheres.len() as u32 - first_sphere,
            first_sphere,
            targets: 0,
            first_reach: 0,
            first_texel: 0,
            texels: 0,
        };
        let lowest = (0..self.free.len()).min_by_key(|&k| self.free[k]);
        Ok(match lowest.map(|k| self.free.swap_remove(k)) {
            Some(id) => {
                self.meshes[id as usize] = slot;
                self.live[id as usize] = true;
                id
            }
            None => {
                self.meshes.push(slot);
                self.live.push(true);
                self.meshes.len() as u32 - 1
            }
        })
    }

    /// Removes the live meshes among `ids`, packs the storage over their data, and returns where
    /// the data changed. Other ids are skipped. The removed ids stay taken until
    /// [`MeshStorage::release`] gives them to later meshes.
    pub fn remove(&mut self, ids: &[u32]) -> MeshMoves {
        let (mut parts, mut spheres, mut reaches, mut texels) = Default::default();
        for &id in ids {
            if self.mesh(id).is_none() {
                continue;
            }
            let mesh = self.meshes[id as usize];
            Gaps::add(&mut parts, mesh.first_part, mesh.part_count);
            Gaps::add(&mut spheres, mesh.first_sphere, mesh.joints);
            Gaps::add(&mut reaches, mesh.first_reach, mesh.targets);
            Gaps::add(&mut texels, mesh.first_texel, mesh.texels);
            self.live[id as usize] = false;
            self.meshes[id as usize].part_count = 0;
        }
        self.take_out(parts, spheres, reaches, texels)
    }

    /// Gives the ids of removed meshes to the next meshes added, lowest first. Ids of live meshes
    /// are skipped.
    pub fn release(&mut self, ids: &[u32]) {
        for &id in ids {
            let removed = self.live.get(id as usize) == Some(&false);
            if removed && !self.free.contains(&id) {
                self.free.push(id);
            }
        }
    }

    /// Takes runs of the lists out, packs the pages over the parts in `parts`, and moves the
    /// live meshes' data down to match. Returns where the data changed.
    fn take_out(
        &mut self,
        mut parts: Gaps,
        mut spheres: Gaps,
        mut reaches: Gaps,
        mut texels: Gaps,
    ) -> MeshMoves {
        for gaps in [&mut parts, &mut spheres, &mut reaches, &mut texels] {
            gaps.close();
        }
        let mut moves = MeshMoves::default();
        if parts.is_empty() && texels.is_empty() {
            return moves;
        }
        // Each page's runs of removed vertices and indices: the parts' triangles and edge lists.
        let mut pages: Vec<(Gaps, Gaps)> = Vec::new();
        pages.resize_with(self.pages.len(), Default::default);
        for &(start, len) in &parts.runs {
            for k in start as usize..(start + len) as usize {
                let part = self.parts[k];
                let (vertices, indices) = &mut pages[part.page as usize];
                vertices.add(part.first_vertex, part.vertex_count);
                indices.add(part.first_index, part.index_count);
                if let Some(edges) = self.edge_parts.get(k) {
                    indices.add(edges.first_index, edges.index_count);
                }
            }
        }
        // The first changed vertex byte and index of each page, or `usize::MAX` for none.
        let mut changed = vec![(usize::MAX, usize::MAX); self.pages.len()];
        for (p, (vertices, indices)) in pages.iter_mut().enumerate() {
            vertices.close();
            indices.close();
            if vertices.is_empty() && indices.is_empty() {
                continue;
            }
            let page = &mut self.pages[p];
            let stride = vertex::stride(page.format) as usize;
            vertices.squeeze(&mut page.vertices, stride);
            indices.squeeze(&mut page.indices, 1);
            let mut first_index = indices.first().map_or(usize::MAX, |i| i as usize);
            if self.packing == Packing::Pages && !vertices.is_empty() {
                // Indices name vertices of the page, so those past a removed run move down.
                for (k, index) in page.indices.iter_mut().enumerate() {
                    let moved = vertices.before(u32::from(*index));
                    if moved > 0 {
                        *index -= moved as u16;
                        first_index = first_index.min(k);
                    }
                }
            }
            let first_vertex = vertices.first().map_or(usize::MAX, |v| v as usize * stride);
            changed[p] = (first_vertex, first_index);
        }
        let packing = self.packing;
        let moved = |part: &mut MeshPart, index_gaps: &Gaps, vertex_gaps: &Gaps| {
            part.first_index -= index_gaps.before(part.first_index);
            part.first_vertex -= vertex_gaps.before(part.first_vertex);
            part.base_vertex = match packing {
                Packing::SharedBuffers => part.first_vertex,
                Packing::Pages => 0,
            };
        };
        // Only the live parts move: the runs hold the removed ones, which go next.
        for (k, part) in self.parts.iter_mut().enumerate() {
            if !parts.holds(k as u32) {
                let (vertices, indices) = &pages[part.page as usize];
                moved(part, indices, vertices);
            }
        }
        for (k, part) in self.edge_parts.iter_mut().enumerate() {
            if !parts.holds(k as u32) {
                let (vertices, indices) = &pages[part.page as usize];
                moved(part, indices, vertices);
            }
        }
        let edge_parts = parts
            .runs
            .iter()
            .filter(|(start, _)| (*start as usize) < self.edge_parts.len());
        let edge_parts = Gaps::from_runs(
            edge_parts.map(|&(start, len)| (start, len.min(self.edge_parts.len() as u32 - start))),
        );
        parts.squeeze(&mut self.parts, 1);
        edge_parts.squeeze(&mut self.edge_parts, 1);
        spheres.squeeze(&mut self.spheres, 1);
        reaches.squeeze(&mut self.reaches, 1);
        texels.squeeze(&mut self.morph_texels, 1);
        for id in 0..self.meshes.len() {
            if !self.live[id] {
                continue;
            }
            let mesh = &mut self.meshes[id];
            mesh.first_part -= parts.before(mesh.first_part);
            mesh.first_sphere -= spheres.before(mesh.first_sphere);
            mesh.first_reach -= reaches.before(mesh.first_reach);
            let shift = texels.before(mesh.first_texel);
            if shift == 0 || mesh.texels == 0 {
                continue;
            }
            mesh.first_texel -= shift;
            let mesh = *mesh;
            self.shift_morph_entries(&mesh, shift, &mut changed);
        }
        moves.pages = changed
            .iter()
            .enumerate()
            .filter(|(_, first)| **first != (usize::MAX, usize::MAX))
            .map(|(p, &(vertices, indices))| {
                let page = &self.pages[p];
                (
                    p as u32,
                    vertices.min(page.vertices.len()),
                    indices.min(page.indices.len()),
                )
            })
            .collect();
        moves.morph_texels = texels.first();
        moves
    }

    /// Moves the first entry that each vertex of a morphed mesh names down by `shift` texels,
    /// after the texels before its own moved, and lowers each page's first changed vertex byte.
    fn shift_morph_entries(&mut self, mesh: &MeshSlot, shift: u32, changed: &mut [(usize, usize)]) {
        let Some(offset) = vertex::offset(mesh.format, MORPH_LOCATION) else {
            return;
        };
        let stride = vertex::stride(mesh.format) as usize;
        let first = mesh.first_part as usize;
        for part in &self.parts[first..first + mesh.part_count as usize] {
            let page = &mut self.pages[part.page as usize];
            let start = part.first_vertex as usize * stride;
            for v in 0..part.vertex_count as usize {
                let at = start + v * stride + offset as usize;
                let bytes: [u8; 4] = page.vertices[at..at + 4].try_into().expect("four bytes");
                let entry = f32::from_le_bytes(bytes) - shift as f32;
                page.vertices[at..at + 4].copy_from_slice(&entry.to_le_bytes());
            }
            let first_changed = &mut changed[part.page as usize].0;
            *first_changed = (*first_changed).min(start);
        }
    }

    /// The most vertices and indices one part of a format can have: what 16-bit indices reach,
    /// and what fits the buffers of an empty page.
    fn part_limits(&self, format: u32) -> Result<(u32, usize), MeshError> {
        let by_bytes = self.max_page_bytes / u64::from(vertex::stride(format));
        let vertices = by_bytes.min(u64::from(MAX_PAGE_VERTICES)) as u32;
        let indices = ((self.max_page_bytes & !3) / 2) as usize / 3 * 3;
        if vertices < 3 || indices < 3 {
            return Err(MeshError::PageTooSmall);
        }
        Ok((vertices, indices))
    }

    /// Puts one part's vertices and part-local indices into the first page of their format with
    /// room for them, which may be room that removed meshes left, or into a new page when none
    /// has room, and returns where the part landed. It reserves
    /// every byte first, with room for the part's edge list, so it fails before it changes a page.
    fn place(
        &mut self,
        format: u32,
        vertices: &[u8],
        indices: &[u32],
    ) -> Result<MeshPart, MeshError> {
        let count = (vertices.len() / vertex::stride(format) as usize) as u32;
        let (limit, packing) = (self.max_page_bytes, self.packing);
        // With edge lists, the part's edges follow its triangles: twice as many indices.
        let indices_placed = indices.len() * if self.edges { 3 } else { 1 };
        let fits = |page: &Page| {
            let (vertex_bytes, index_bytes) = page.buffer_bytes();
            vertex_bytes + vertices.len() as u64 <= limit
                && index_bytes + (indices_placed * 2).next_multiple_of(4) as u64 <= limit
                && (packing == Packing::SharedBuffers
                    || page.vertex_count() + count <= MAX_PAGE_VERTICES)
        };
        reserve(&mut self.parts, 1)?;
        let room = self
            .pages
            .iter()
            .position(|page| page.format == format && fits(page));
        let page_index = match room {
            Some(first) => {
                let page = &mut self.pages[first];
                reserve(&mut page.vertices, vertices.len())?;
                reserve(&mut page.indices, indices_placed)?;
                first
            }
            None => {
                let mut page = Page {
                    format,
                    ..Page::default()
                };
                reserve(&mut page.vertices, vertices.len())?;
                reserve(&mut page.indices, indices_placed)?;
                reserve(&mut self.pages, 1)?;
                self.pages.push(page);
                self.pages.len() - 1
            }
        };
        let page = &mut self.pages[page_index];
        let first_vertex = page.vertex_count();
        let first_index = page.indices.len() as u32;
        let (rebase, base_vertex) = match self.packing {
            Packing::Pages => (first_vertex, 0),
            Packing::SharedBuffers => (0, first_vertex),
        };
        page.vertices.extend_from_slice(vertices);
        page.indices
            .extend(indices.iter().map(|&i| (i + rebase) as u16));
        Ok(MeshPart {
            page: page_index as u32,
            first_index,
            index_count: indices.len() as u32,
            base_vertex,
            vertex_count: count,
            first_vertex,
        })
    }

    /// Adds a mesh too large for one part as several: runs of whole triangles, in order, each
    /// with at most `max_vertices` vertices and `max_indices` indices. Each part copies the
    /// vertices it uses in the order its triangles first use them.
    fn split(
        &mut self,
        geometry: &Geometry,
        max_vertices: u32,
        max_indices: usize,
    ) -> Result<(), MeshError> {
        let mut local = Vec::new();
        reserve(&mut local, geometry.vertex_count())?;
        local.resize(geometry.vertex_count(), UNUSED);
        let mut part = PartBuilder {
            local,
            ..PartBuilder::default()
        };
        for triangle in geometry.indices.as_chunks::<3>().0 {
            let new = triangle
                .iter()
                .enumerate()
                .filter(|&(k, &v)| part.local[v as usize] == UNUSED && !triangle[..k].contains(&v))
                .count();
            if part.used.len() + new > max_vertices as usize || part.indices.len() + 3 > max_indices
            {
                part.finish(self, geometry)?;
            }
            for &v in triangle {
                part.add(v);
            }
        }
        if !part.indices.is_empty() {
            part.finish(self, geometry)?;
        }
        Ok(())
    }
}

/// The bounding sphere of each joint's vertices in a skinned mesh, in the mesh's space, by joint
/// number up to the largest that a vertex names: a centre and a radius, or a radius of -1 for a
/// joint that moves no vertex. Each sphere holds every vertex that its joint moves with a weight
/// above 0. A skinned vertex is a weighted average of its joints' matrices applied to it, and each
/// matrix keeps the vertex inside its joint's moved sphere, so the spheres of a pose's joints hold
/// every skinned vertex. A geometry without both joints and weights has none.
pub fn joint_spheres(geometry: &Geometry) -> Vec<[f32; 4]> {
    let format = geometry.format;
    let attribute = |location: usize| {
        let ty = vertex::type_of(format, location)?;
        Some((ty, vertex::offset(format, location)? as usize))
    };
    let (Some((joint_type, joint_at)), Some((weight_type, weight_at))) = (
        attribute(vertex::ATTRIBUTES[6].location as usize),
        attribute(vertex::ATTRIBUTES[7].location as usize),
    ) else {
        return Vec::new();
    };
    let stride = geometry.stride();
    let (joint_size, weight_size) = (joint_type.bytes() as usize, weight_type.bytes() as usize);
    // Each influence of each vertex: its joint and its position, for those with a weight.
    let influences = |v: usize| {
        let at = v * stride;
        let bytes = &geometry.vertices;
        (0..4).filter_map(move |k| {
            let weight = weight_type.decode(&bytes[at + weight_at + k * weight_size..]);
            let joint = joint_type.decode(&bytes[at + joint_at + k * joint_size..]);
            (weight > 0.0).then_some(joint as usize)
        })
    };
    let count = (0..geometry.vertex_count())
        .flat_map(influences)
        .max()
        .map_or(0, |joint| joint + 1);
    let mut lows = vec![[f32::INFINITY; 3]; count];
    let mut highs = vec![[f32::NEG_INFINITY; 3]; count];
    for v in 0..geometry.vertex_count() {
        let p = geometry.position(v);
        for joint in influences(v) {
            for c in 0..3 {
                lows[joint][c] = lows[joint][c].min(p[c]);
                highs[joint][c] = highs[joint][c].max(p[c]);
            }
        }
    }
    let mut spheres: Vec<[f32; 4]> = lows
        .iter()
        .zip(&highs)
        .map(|(low, high)| {
            if low[0] > high[0] {
                return [0.0, 0.0, 0.0, -1.0];
            }
            let centre = [0, 1, 2].map(|c| 0.5 * (low[c] + high[c]));
            [centre[0], centre[1], centre[2], 0.0]
        })
        .collect();
    for v in 0..geometry.vertex_count() {
        let p = geometry.position(v);
        for joint in influences(v) {
            let sphere = &mut spheres[joint];
            let d = [0, 1, 2].map(|c| p[c] - sphere[c]);
            sphere[3] = sphere[3].max((d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt());
        }
    }
    spheres
}

/// Runs of entries that a removal takes out of a list: each run's start and length, in order,
/// and the entries taken out up to the end of each run.
#[derive(Debug, Default)]
struct Gaps {
    runs: Vec<(u32, u32)>,
    ends: Vec<u32>,
}

impl Gaps {
    /// Gaps of runs that are in order already and do not overlap.
    fn from_runs(runs: impl Iterator<Item = (u32, u32)>) -> Self {
        let mut gaps = Gaps::default();
        for (start, len) in runs {
            gaps.add(start, len);
        }
        gaps.close();
        gaps
    }

    /// Adds a run of `len` entries from `start` on, in its place among the others: a removal
    /// takes out a few runs, so finding the place costs less than a sort's code. An empty run
    /// adds nothing.
    fn add(&mut self, start: u32, len: u32) {
        if len > 0 {
            let at = self.runs.partition_point(|&(s, _)| s < start);
            self.runs.insert(at, (start, len));
        }
    }

    /// Joins runs that touch, and counts the entries before each end. Call it once every run is
    /// in.
    fn close(&mut self) {
        let mut joined: Vec<(u32, u32)> = Vec::with_capacity(self.runs.len());
        for &(start, len) in &self.runs {
            match joined.last_mut() {
                Some((first, length)) if *first + *length >= start => {
                    *length = (*length).max(start + len - *first);
                }
                _ => joined.push((start, len)),
            }
        }
        self.runs = joined;
        let mut taken = 0;
        self.ends = self
            .runs
            .iter()
            .map(|&(_, len)| {
                taken += len;
                taken
            })
            .collect();
    }

    fn is_empty(&self) -> bool {
        self.runs.is_empty()
    }

    /// The first entry taken out, if any is.
    fn first(&self) -> Option<u32> {
        self.runs.first().map(|&(start, _)| start)
    }

    /// True when a run holds entry `at`.
    fn holds(&self, at: u32) -> bool {
        match self.runs.partition_point(|&(start, _)| start <= at) {
            0 => false,
            k => at < self.runs[k - 1].0 + self.runs[k - 1].1,
        }
    }

    /// The entries taken out before entry `at`, which no run holds.
    fn before(&self, at: u32) -> u32 {
        match self.runs.partition_point(|&(start, _)| start < at) {
            0 => 0,
            k => self.ends[k - 1],
        }
    }

    /// Takes the runs out of `list`, whose entries each hold `unit` values, and keeps the other
    /// entries in their order.
    fn squeeze<T: Copy>(&self, list: &mut Vec<T>, unit: usize) {
        let Some(&(first, _)) = self.runs.first() else {
            return;
        };
        let mut to = first as usize * unit;
        for (k, &(start, len)) in self.runs.iter().enumerate() {
            let from = ((start + len) as usize * unit).min(list.len());
            let end = self
                .runs
                .get(k + 1)
                .map_or(list.len(), |&(next, _)| next as usize * unit);
            list.copy_within(from..end, to);
            to += end - from;
        }
        list.truncate(to);
    }
}

/// The part of a mesh that [`MeshStorage::split`] builds.
#[derive(Default)]
struct PartBuilder {
    /// Each vertex of the mesh's index in the part, or `UNUSED`.
    local: Vec<u32>,
    /// The mesh's vertices that the part uses, in the order its triangles first use them.
    used: Vec<u32>,
    /// The part's indices, into `used`.
    indices: Vec<u32>,
    /// The used vertices' bytes, as the part's page receives them.
    vertices: Vec<u8>,
}

impl PartBuilder {
    fn add(&mut self, v: u32) {
        let local = &mut self.local[v as usize];
        if *local == UNUSED {
            *local = self.used.len() as u32;
            self.used.push(v);
        }
        self.indices.push(*local);
    }

    /// Places the part in the storage, and starts the next one.
    fn finish(&mut self, storage: &mut MeshStorage, geometry: &Geometry) -> Result<(), MeshError> {
        let stride = geometry.stride();
        self.vertices.clear();
        for &v in &self.used {
            let at = v as usize * stride;
            self.vertices
                .extend_from_slice(&geometry.vertices[at..at + stride]);
            self.local[v as usize] = UNUSED;
        }
        let part = storage.place(geometry.format, &self.vertices, &self.indices)?;
        storage.parts.push(part);
        self.used.clear();
        self.indices.clear();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::f64::consts::{PI, TAU};

    use super::*;
    use crate::geometry::{box_geometry, sphere_geometry};

    /// A whole sphere from the engine's generator.
    fn sphere(radius: f64, segments: [u32; 2]) -> Geometry {
        sphere_geometry(radius, segments, (0.0, TAU), (0.0, PI)).unwrap()
    }

    /// The vertices that a mesh's triangles reach, in index order, through every part.
    fn resolved_vertices(storage: &MeshStorage, id: u32) -> Vec<Vec<u8>> {
        let slot = storage.mesh(id).unwrap();
        let stride = vertex::stride(slot.format) as usize;
        storage
            .parts(slot)
            .iter()
            .flat_map(|part| {
                let page = &storage.pages()[part.page as usize];
                assert_eq!(page.format, slot.format);
                let range =
                    part.first_index as usize..(part.first_index + part.index_count) as usize;
                page.indices[range].iter().map(move |&i| {
                    let v = (i as u32 + part.base_vertex) as usize * stride;
                    page.vertices[v..v + stride].to_vec()
                })
            })
            .collect()
    }

    fn original_vertices(g: &Geometry) -> Vec<Vec<u8>> {
        let stride = g.stride();
        g.indices
            .iter()
            .map(|&i| g.vertices[i as usize * stride..(i as usize + 1) * stride].to_vec())
            .collect()
    }

    /// A geometry of `vertices` vertices of the base format, all at the origin.
    fn zeros(vertices: usize, indices: Vec<u32>) -> Geometry {
        Geometry {
            format: 0,
            vertices: vec![0; vertices * vertex::stride(0) as usize],
            indices,
        }
    }

    /// A grid of `columns` x `rows` quads in the XY plane, in `format`, with float positions and
    /// normals. Each vertex's bytes after them count up from its index, so every vertex is
    /// unique.
    fn grid(columns: u32, rows: u32, format: u32) -> Geometry {
        let stride = vertex::stride(format) as usize;
        let mut g = Geometry {
            format,
            ..Geometry::default()
        };
        for y in 0..=rows {
            for x in 0..=columns {
                let index = g.vertices.len() / stride;
                for value in [x as f32, y as f32, 0.0, 0.0, 0.0, 1.0] {
                    g.vertices.extend_from_slice(&value.to_le_bytes());
                }
                g.vertices
                    .extend((24..stride).map(|k| (index * 10 + k) as u8));
            }
        }
        let row = columns + 1;
        for y in 0..rows {
            for x in 0..columns {
                let (a, b) = (y * row + x, (y + 1) * row + x);
                g.indices.extend_from_slice(&[a, a + 1, b, b, a + 1, b + 1]);
            }
        }
        g
    }

    #[test]
    fn rebased_indices_reach_the_same_vertices_in_both_packings() {
        let meshes = [
            box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap(),
            sphere(0.5, [16, 8]),
            box_geometry(2.0, 1.0, 0.5, [2, 2, 2]).unwrap(),
        ];
        for packing in [Packing::SharedBuffers, Packing::Pages] {
            let mut storage = MeshStorage::new(packing);
            let ids: Vec<u32> = meshes.iter().map(|m| storage.add(m).unwrap()).collect();
            for (id, mesh) in ids.iter().zip(&meshes) {
                assert_eq!(
                    resolved_vertices(&storage, *id),
                    original_vertices(mesh),
                    "{packing:?}"
                );
            }
            if packing == Packing::Pages {
                let parts = ids
                    .iter()
                    .flat_map(|&id| storage.parts(storage.mesh(id).unwrap()));
                assert!(parts.into_iter().all(|part| part.base_vertex == 0));
            }
        }
    }

    #[test]
    fn meshes_of_each_format_share_the_pages_of_their_format() {
        for packing in [Packing::SharedBuffers, Packing::Pages] {
            let mut storage = MeshStorage::new(packing);
            let mut ids = Vec::new();
            // Every format twice, in format order, so each format's second mesh follows another
            // format's mesh.
            // The morph attribute's bit sits above the others, which a morphed mesh's own test
            // covers.
            let all = vertex::ALL & !vertex::MORPH;
            for round in 0..2 {
                for format in 0..=all {
                    let mesh = grid(2 + round, 3, format);
                    ids.push((storage.add(&mesh).unwrap(), mesh));
                }
            }
            // One page per format, each holding only its own format's vertices.
            assert_eq!(storage.pages().len(), (all + 1) as usize);
            for (id, mesh) in &ids {
                let slot = storage.mesh(*id).unwrap();
                assert_eq!(slot.format, mesh.format);
                let parts = storage.parts(slot);
                assert_eq!(parts.len(), 1);
                assert_eq!(storage.pages()[parts[0].page as usize].format, mesh.format);
                assert_eq!(resolved_vertices(&storage, *id), original_vertices(mesh));
            }
            for page in storage.pages() {
                let stride = vertex::stride(page.format) as usize;
                assert_eq!(page.vertices.len() % stride, 0);
            }
        }
    }

    #[test]
    fn pages_hold_at_most_65535_vertices() {
        // Spheres of 33 x 17 = 561 vertices fit 116 to a page.
        let sphere = sphere(1.0, [32, 16]);
        let mut storage = MeshStorage::new(Packing::Pages);
        for _ in 0..300 {
            storage.add(&sphere).unwrap();
        }
        assert_eq!(storage.pages().len(), 3);
        assert!(
            storage
                .pages()
                .iter()
                .all(|p| p.vertex_count() <= MAX_PAGE_VERTICES)
        );
    }

    #[test]
    fn a_mesh_past_65535_vertices_splits_into_parts_that_never_use_the_restart_index() {
        // 300 x 300 quads: 90,601 vertices, 540,000 indices.
        let big = grid(300, 300, vertex::UV0);
        for packing in [Packing::SharedBuffers, Packing::Pages] {
            let mut storage = MeshStorage::new(packing);
            let small = storage.add(&grid(2, 2, vertex::UV0)).unwrap();
            let id = storage.add(&big).unwrap();
            let slot = *storage.mesh(id).unwrap();
            let parts = storage.parts(&slot).to_vec();
            assert_eq!(parts.len(), 2, "{packing:?}");
            assert_eq!(slot.vertex_count, 301 * 301);
            // Every triangle lands in exactly one part, in order, and reaches the same vertices.
            assert_eq!(
                parts.iter().map(|p| p.index_count).sum::<u32>() as usize,
                big.indices.len()
            );
            assert_eq!(resolved_vertices(&storage, id), original_vertices(&big));
            assert_eq!(
                resolved_vertices(&storage, small),
                original_vertices(&grid(2, 2, 1))
            );
            for part in &parts {
                let page = &storage.pages()[part.page as usize];
                let range =
                    part.first_index as usize..(part.first_index + part.index_count) as usize;
                let highest = page.indices[range].iter().copied().max().unwrap();
                assert!(
                    highest < u16::MAX,
                    "a part uses the primitive restart index"
                );
                let base = if packing == Packing::Pages {
                    0
                } else {
                    part.base_vertex
                };
                assert!(u32::from(highest) + base < page.vertex_count());
            }
            if packing == Packing::Pages {
                assert!(
                    storage
                        .pages()
                        .iter()
                        .all(|p| p.vertex_count() <= MAX_PAGE_VERTICES)
                );
            }
        }
    }

    #[test]
    fn a_morphed_mesh_past_65535_vertices_keeps_each_vertexs_entries_in_every_part() {
        use crate::morph::{MorphTargets, has_targets, with_ranges};

        // 300 x 300 quads, whose one target lifts the first and the last vertex.
        let big = grid(300, 300, 0);
        let vertices = big.vertex_count();
        let mut positions = vec![0.0; vertices * 3];
        positions[1] = 1.0;
        positions[vertices * 3 - 2] = 2.0;
        let targets = MorphTargets {
            targets: 1,
            positions: Some(&positions),
            normals: None,
            tangents: None,
            colors: None,
        };
        let sparse = targets.sparse(vertices, 0).unwrap();
        for packing in [Packing::SharedBuffers, Packing::Pages] {
            let mut storage = MeshStorage::new(packing);
            let id = storage.add_morphed(&big, &targets).unwrap();
            let slot = *storage.mesh(id).unwrap();
            assert!(has_targets(slot.format));
            assert_eq!(storage.parts(&slot).len(), 2, "{packing:?}");
            // Each vertex keeps the attribute that names its own entries, in whichever part.
            assert_eq!(
                resolved_vertices(&storage, id),
                original_vertices(&with_ranges(&big, &sparse.ranges))
            );
            assert_eq!(storage.morph_texels().len(), 2);
            assert_eq!(storage.reach(&slot), [2.0]);
            // A second mesh's entries follow the first's.
            let second = storage.add_morphed(&big, &targets).unwrap();
            let second = *storage.mesh(second).unwrap();
            assert_eq!(storage.morph_texels().len(), 4);
            assert_eq!(second.targets, 1);
        }
    }

    #[test]
    fn no_index_reaches_the_webgl2_restart_index() {
        // A strip of triangles over `vertices` vertices, the last of which uses the last vertex.
        let strip = |vertices: u32| {
            zeros(
                vertices as usize,
                (0..vertices - 2).flat_map(|v| [v, v + 1, v + 2]).collect(),
            )
        };
        for packing in [Packing::SharedBuffers, Packing::Pages] {
            let mut storage = MeshStorage::new(packing);
            let fits = storage.add(&strip(65_535)).unwrap();
            let splits = storage.add(&strip(65_536)).unwrap();
            let parts = |id: u32| storage.parts(storage.mesh(id).unwrap()).len();
            assert_eq!((parts(fits), parts(splits)), (1, 2), "{packing:?}");
            for page in storage.pages() {
                assert!(page.indices.iter().all(|&i| i < u16::MAX), "{packing:?}");
            }
        }
    }

    #[test]
    fn parts_also_split_where_a_page_limit_is_small() {
        // Pages of 4 KiB: 170 base-format vertices, or 2,048 indices.
        let mesh = grid(20, 20, 0);
        let mut storage = MeshStorage::with_page_limit(Packing::SharedBuffers, 4096);
        let id = storage.add(&mesh).unwrap();
        let slot = *storage.mesh(id).unwrap();
        assert!(storage.parts(&slot).len() > 1);
        assert_eq!(resolved_vertices(&storage, id), original_vertices(&mesh));
        for page in storage.pages() {
            let (vertex_bytes, index_bytes) = page.buffer_bytes();
            assert!(vertex_bytes <= 4096 && index_bytes <= 4096);
        }
        let mut tiny = MeshStorage::with_page_limit(Packing::Pages, 64);
        assert_eq!(tiny.add(&mesh), Err(MeshError::PageTooSmall));
    }

    #[test]
    fn queries_read_each_triangle_of_a_split_mesh_in_its_order() {
        // Pages of 4 KiB split the grid into parts; a box before it shares the first page. Drawing
        // edges adds edge lists to the pages, which the triangles never read.
        let first = box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap();
        let mesh = grid(20, 20, 0);
        for packing in [Packing::SharedBuffers, Packing::Pages] {
            let mut storage = MeshStorage::with_page_limit(packing, 4096);
            storage.draw_edges(true);
            storage.add(&first).unwrap();
            let id = storage.add(&mesh).unwrap();
            assert!(storage.parts(storage.mesh(id).unwrap()).len() > 1);
            let triangles = storage.triangles(id).unwrap();
            assert_eq!(triangles.count() as usize, mesh.indices.len() / 3);
            for t in 0..triangles.count() {
                let want: [[f32; 3]; 3] = std::array::from_fn(|c| {
                    mesh.position(mesh.indices[t as usize * 3 + c] as usize)
                });
                assert_eq!(triangles.triangle(t), want, "{packing:?}, triangle {t}");
            }
            assert!(triangles.triangle(triangles.count())[0][0].is_nan());
            assert_eq!(storage.count(), 2);
            assert!(storage.triangles(2).is_none());
        }
    }

    #[test]
    fn queries_read_packed_positions_as_shaders_do() {
        // One triangle with normalized 16-bit positions: 32767 reads as 1, and -32768 as -1.
        let format = vertex::with(0, vertex::POSITION, vertex::Type::Snorm16).unwrap();
        let stride = vertex::stride(format) as usize;
        let mut vertices = vec![0u8; 3 * stride];
        for (v, p) in [[0i16, 0, 0], [32767, 0, 0], [0, -32768, 0]]
            .iter()
            .enumerate()
        {
            for (c, value) in p.iter().enumerate() {
                vertices[v * stride + c * 2..v * stride + c * 2 + 2]
                    .copy_from_slice(&value.to_le_bytes());
            }
        }
        let mesh = Geometry {
            format,
            vertices,
            indices: vec![0, 1, 2],
        };
        let mut storage = MeshStorage::new(Packing::Pages);
        let id = storage.add(&mesh).unwrap();
        let triangle = storage.triangles(id).unwrap().triangle(0);
        assert_eq!(
            triangle,
            [mesh.position(0), mesh.position(1), mesh.position(2)]
        );
        assert_eq!(triangle[1][0], 1.0);
        assert_eq!(triangle[2][1], -1.0);
    }

    #[test]
    fn no_shared_buffer_exceeds_its_byte_limit() {
        let mesh = box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap();
        let limit = 4096;
        let mut storage = MeshStorage::with_page_limit(Packing::SharedBuffers, limit);
        for _ in 0..100 {
            storage.add(&mesh).unwrap();
        }
        assert!(storage.pages().len() > 1);
        for page in storage.pages() {
            let (vertex_bytes, index_bytes) = page.buffer_bytes();
            assert!(vertex_bytes <= limit && index_bytes <= limit);
        }
    }

    #[test]
    fn bad_meshes_are_rejected() {
        let mut storage = MeshStorage::new(Packing::Pages);
        let broken = zeros(3, vec![0, 1, 3]);
        assert_eq!(
            storage.add(&broken),
            Err(MeshError::IndexOutOfRange {
                index: 3,
                vertices: 3
            })
        );
        let not_triangles = zeros(3, vec![0, 1]);
        assert_eq!(storage.add(&not_triangles), Err(MeshError::NotTriangles));
    }

    #[test]
    fn a_box_radius_reaches_its_corners() {
        let mut storage = MeshStorage::new(Packing::SharedBuffers);
        let id = storage
            .add(&box_geometry(0.6, 0.6, 0.6, [1, 1, 1]).unwrap())
            .unwrap();
        assert!((storage.mesh(id).unwrap().radius - 0.3 * 3f32.sqrt()).abs() < 1e-6);
    }

    /// The pairs of vertices that a mesh's parts draw as lines, through each part's page.
    fn drawn_lines(storage: &MeshStorage, id: u32) -> Vec<[Vec<u8>; 2]> {
        let slot = storage.mesh(id).unwrap();
        let stride = vertex::stride(slot.format) as usize;
        storage
            .parts(slot)
            .iter()
            .flat_map(|part| {
                let page = &storage.pages()[part.page as usize];
                let range =
                    part.first_index as usize..(part.first_index + part.index_count) as usize;
                let vertex = move |i: u16| {
                    let v = (i as u32 + part.base_vertex) as usize * stride;
                    page.vertices[v..v + stride].to_vec()
                };
                page.indices[range]
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(move |&[a, b]| [vertex(a), vertex(b)])
            })
            .collect()
    }

    #[test]
    fn edge_lists_draw_each_edge_of_each_triangle_in_both_packings() {
        for packing in [Packing::SharedBuffers, Packing::Pages] {
            let mut storage = MeshStorage::new(packing);
            let first = storage
                .add(&box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap())
                .unwrap();
            let triangles = storage.parts(storage.mesh(first).unwrap()).to_vec();
            storage.draw_edges(true);
            // A mesh added later gets its edge list too.
            let second = storage.add(&sphere(1.0, [8, 4])).unwrap();
            storage.draw_edges(false);
            // Turned off, the parts draw their triangles from where they always were.
            assert_eq!(storage.parts(storage.mesh(first).unwrap()), triangles);
            let corners = [first, second].map(|id| resolved_vertices(&storage, id));
            storage.draw_edges(true);
            for (id, corners) in [first, second].into_iter().zip(corners) {
                let expected: Vec<[Vec<u8>; 2]> = corners
                    .as_chunks::<3>()
                    .0
                    .iter()
                    .flat_map(|[a, b, c]| {
                        [[a, b], [b, c], [c, a]].map(|[p, q]| [p.clone(), q.clone()])
                    })
                    .collect();
                assert_eq!(drawn_lines(&storage, id), expected, "{packing:?}");
            }
        }
    }

    #[test]
    fn a_part_without_room_for_its_edges_draws_none() {
        // Pages of 256 bytes: 40 triangles take 240 bytes of indices, and their edges 480 more.
        let triangles = |count: usize| zeros(3, (0..count).flat_map(|_| [0, 1, 2]).collect());
        let mut storage = MeshStorage::with_page_limit(Packing::SharedBuffers, 256);
        let full = storage.add(&triangles(40)).unwrap();
        storage.draw_edges(true);
        // With edge lists on, a new part goes to a page with room for its edges too.
        let small = storage.add(&triangles(1)).unwrap();
        let counts =
            [full, small].map(|id| storage.parts(storage.mesh(id).unwrap())[0].index_count);
        assert_eq!(counts, [0, 6]);
        assert_eq!(storage.pages().len(), 2);
        for page in storage.pages() {
            assert!(page.buffer_bytes().1 <= 256);
        }
    }

    /// A skinned column of `rings` rings of four vertices, each ring moved by its own joint.
    fn column(rings: u32) -> Geometry {
        let mut g = Geometry {
            format: vertex::JOINTS | vertex::WEIGHTS,
            ..Geometry::default()
        };
        for ring in 0..rings {
            for [x, z] in [[0.5, 0.0], [-0.5, 0.0], [0.0, 0.5], [0.0, -0.5]] {
                for v in [x, ring as f32, z, 0.0, 1.0, 0.0] {
                    g.vertices.extend_from_slice(&f32::to_le_bytes(v));
                }
                g.vertices.extend_from_slice(&[ring as u8, 0, 0, 0]);
                for w in [1.0f32, 0.0, 0.0, 0.0] {
                    g.vertices.extend_from_slice(&w.to_le_bytes());
                }
            }
        }
        g.indices = (0..rings * 4 - 2).flat_map(|v| [v, v + 1, v + 2]).collect();
        g
    }

    /// The bytes of each page's vertices and indices.
    fn page_sizes(storage: &MeshStorage) -> Vec<(usize, usize)> {
        let pages = storage.pages();
        pages
            .iter()
            .map(|p| (p.vertices.len(), p.indices.len()))
            .collect()
    }

    #[test]
    fn removed_meshes_leave_the_others_drawing_the_same_vertices_from_packed_pages() {
        let meshes = [
            box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap(),
            sphere(0.5, [16, 8]),
            column(4),
            box_geometry(2.0, 1.0, 0.5, [2, 2, 2]).unwrap(),
            sphere(1.0, [8, 4]),
        ];
        for packing in [Packing::SharedBuffers, Packing::Pages] {
            for edges in [false, true] {
                let mut storage = MeshStorage::new(packing);
                storage.draw_edges(edges);
                let ids: Vec<u32> = meshes.iter().map(|m| storage.add(m).unwrap()).collect();
                let moves = storage.remove(&[ids[1], ids[3]]);
                assert!(!moves.pages.is_empty(), "{packing:?}");
                assert_eq!(moves.morph_texels, None);
                assert!(storage.mesh(ids[1]).is_none() && storage.triangles(ids[3]).is_none());
                // The same pages as a storage that never held the removed meshes.
                let mut kept = MeshStorage::new(packing);
                kept.draw_edges(edges);
                for k in [0, 2, 4] {
                    kept.add(&meshes[k]).unwrap();
                }
                assert_eq!(
                    page_sizes(&storage),
                    page_sizes(&kept),
                    "{packing:?}, {edges}"
                );
                for k in [0, 2, 4] {
                    let id = ids[k];
                    if edges {
                        let lines = drawn_lines(&storage, id).len();
                        assert_eq!(lines, meshes[k].indices.len());
                    }
                    storage.draw_edges(false);
                    assert_eq!(
                        resolved_vertices(&storage, id),
                        original_vertices(&meshes[k])
                    );
                    storage.draw_edges(edges);
                    let slot = storage.mesh(id).unwrap();
                    assert_eq!(storage.joint_spheres(slot), joint_spheres(&meshes[k]));
                }
                // Once released, the removed ids go to the next meshes, lowest first.
                storage.release(&[ids[3], ids[1], ids[0]]);
                assert_eq!(storage.add(&meshes[3]).unwrap(), ids[1]);
                assert_eq!(storage.add(&meshes[1]).unwrap(), ids[3]);
                storage.draw_edges(false);
                assert_eq!(
                    resolved_vertices(&storage, ids[3]),
                    original_vertices(&meshes[1])
                );
                assert_eq!(storage.count(), 5);
            }
        }
    }

    #[test]
    fn a_page_reports_where_a_removal_changed_it() {
        let a = box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap();
        let b = sphere(0.5, [16, 8]);
        for packing in [Packing::SharedBuffers, Packing::Pages] {
            let mut storage = MeshStorage::new(packing);
            let ids = [&a, &b, &a].map(|m| storage.add(m).unwrap());
            let stride = vertex::stride(a.format) as usize;
            let moves = storage.remove(&[ids[1]]);
            // Until its release, a removed id stays taken.
            let next = storage.add(&a).unwrap();
            assert_eq!(next, 3);
            storage.remove(&[next]);
            assert_eq!(
                moves.pages,
                [(0, a.vertex_count() * stride, a.indices.len())],
                "{packing:?}"
            );
            // Removing the last mesh moves nothing, so the page changed only past its end.
            let moves = storage.remove(&[ids[2]]);
            let page = &storage.pages()[0];
            assert_eq!(moves.pages, [(0, page.vertices.len(), page.indices.len())]);
            // An id that names no live mesh changes nothing.
            assert_eq!(storage.remove(&[ids[2], 9]), MeshMoves::default());
        }
    }

    #[test]
    fn adding_and_removing_a_mesh_again_and_again_keeps_the_same_memory() {
        let kept = box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap();
        let big = grid(300, 300, vertex::UV0);
        for packing in [Packing::SharedBuffers, Packing::Pages] {
            let mut storage = MeshStorage::new(packing);
            storage.add(&kept).unwrap();
            let mut first = None;
            for round in 0..20 {
                let id = storage.add(&big).unwrap();
                let small = storage.add(&kept).unwrap();
                storage.remove(&[id, small]);
                storage.release(&[id, small]);
                let sizes = (page_sizes(&storage), storage.parts.len(), storage.count());
                match &first {
                    None => first = Some(sizes),
                    Some(first) => assert_eq!(&sizes, first, "{packing:?}, round {round}"),
                }
            }
        }
    }

    #[test]
    fn a_split_mesh_comes_out_of_every_page_it_took() {
        let big = grid(300, 300, vertex::UV0);
        let small = grid(2, 2, vertex::UV0);
        for packing in [Packing::SharedBuffers, Packing::Pages] {
            let mut storage = MeshStorage::new(packing);
            let before = storage.add(&small).unwrap();
            let id = storage.add(&big).unwrap();
            let after = storage.add(&small).unwrap();
            storage.remove(&[id]);
            assert_eq!(
                resolved_vertices(&storage, before),
                original_vertices(&small)
            );
            assert_eq!(
                resolved_vertices(&storage, after),
                original_vertices(&small)
            );
            let vertices: usize = storage
                .pages()
                .iter()
                .map(|p| p.vertex_count() as usize)
                .sum();
            assert_eq!(vertices, small.vertex_count() * 2, "{packing:?}");
        }
    }

    #[test]
    fn a_removed_morphed_mesh_gives_back_its_deltas_and_later_meshes_name_theirs_again() {
        use crate::morph::{MorphTargets, with_ranges};

        let mesh = grid(4, 4, 0);
        let vertices = mesh.vertex_count();
        let lift = |dy: f32| {
            let mut positions = vec![0.0; vertices * 3];
            for v in (0..vertices).step_by(3) {
                positions[v * 3 + 1] = dy;
            }
            positions
        };
        let (first, second) = (lift(1.0), lift(2.0));
        let targets = |positions| MorphTargets {
            targets: 1,
            positions: Some(positions),
            normals: None,
            tangents: None,
            colors: None,
        };
        for packing in [Packing::SharedBuffers, Packing::Pages] {
            let mut storage = MeshStorage::new(packing);
            let a = storage.add_morphed(&mesh, &targets(&first)).unwrap();
            let b = storage.add_morphed(&mesh, &targets(&second)).unwrap();
            let texels = storage.morph_texels().len() / 2;
            let moves = storage.remove(&[a]);
            assert_eq!(moves.morph_texels, Some(0));
            assert_eq!(storage.morph_texels().len(), texels, "{packing:?}");
            // The second mesh's vertices name its entries from the first texel now, as a storage
            // that held it alone gives.
            let alone = targets(&second).sparse(vertices, 0).unwrap();
            assert_eq!(storage.morph_texels(), alone.texels);
            let expected = original_vertices(&with_ranges(&mesh, &alone.ranges));
            assert_eq!(resolved_vertices(&storage, b), expected, "{packing:?}");
            assert_eq!(storage.reach(storage.mesh(b).unwrap()), alone.reach);
        }
    }

    /// The time that removals take in a large storage: `cargo test --release -p null3d-render
    /// removal_timings -- --ignored --nocapture`. D-75 records the figures.
    #[test]
    #[ignore = "a timing run, for the decision record"]
    #[allow(clippy::disallowed_methods)] // A native test times itself with the system clock.
    fn removal_timings() {
        use std::time::Instant;
        // 2,000 meshes of 1,089 vertices and 6,144 indices each: 70 MB of vertices.
        let mesh = grid(32, 32, vertex::UV0);
        for packing in [Packing::SharedBuffers, Packing::Pages] {
            for (label, count) in [("first mesh", 1), ("first 50 meshes", 50)] {
                let mut storage = MeshStorage::new(packing);
                let ids: Vec<u32> = (0..2000).map(|_| storage.add(&mesh).unwrap()).collect();
                let bytes: usize = storage.pages().iter().map(|p| p.vertices.len()).sum();
                let start = Instant::now();
                let moves = storage.remove(&ids[..count]);
                let took = start.elapsed();
                let moved: usize = moves
                    .pages
                    .iter()
                    .map(|&(p, v, _)| storage.pages()[p as usize].vertices.len() - v)
                    .sum();
                println!(
                    "{packing:?}, {label}: {:.2} ms, {} of {} vertex bytes to upload again",
                    took.as_secs_f64() * 1000.0,
                    moved,
                    bytes
                );
            }
        }
    }
}
