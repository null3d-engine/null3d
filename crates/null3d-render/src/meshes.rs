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
//! Wireframe materials and the wireframe debug view draw lines, and WebGL2 has no line fill mode,
//! so each part can also keep an edge list: two indices for each edge of each of its triangles, in
//! its page after the indices it had then. The storage makes the edge lists the first time a
//! wireframe asks for them, and from then on gives each new part its own. Each draw takes a part's
//! triangles or its edge list by its own pipeline, so lines and triangles of one mesh draw side by
//! side.
//!
//! Removing meshes packs the storage again: the parts, joint spheres, reaches and delta texels of
//! the meshes that stay move down over those of the removed ones, in each page and in each list,
//! so a scene that loads and drops models keeps the same memory. A removal reports where each
//! page and the delta texels first changed ([`MeshMoves`]), and the GPU copies upload again from
//! there. A removed mesh's id goes to the next mesh added.
//!
//! A mesh's vertices can change after it is added ([`MeshStorage::update_vertices`]): new values
//! of one attribute go into the vertices of its parts in place, and the storage lists the byte
//! range of each page that changed, which the GPU copies upload again. A part of a split mesh
//! holds its vertices in the order its triangles first use them, so the storage keeps, for each
//! split mesh, the mesh's vertex that each of its parts' vertices copies. A mesh in one part
//! keeps its vertices in their order and needs no such list.

use null3d_core::bvh::heap_sort_by;
use null3d_core::bvh::mesh::Triangles;
use null3d_gpu::drawlist::vertex;

use crate::geometry::Geometry;
use crate::morph::{MORPH_LOCATION, MorphError, MorphTargets, with_ranges};
use crate::piece_check::PieceCheck;
use crate::pieces::{Piece, PieceError, PieceTable};

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
    /// True for a part that draws another mesh's vertices from its own indices, as a level of a
    /// mesh does: its vertex range belongs to the other mesh, so taking the part out frees no
    /// vertices.
    pub shares_vertices: bool,
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
    /// The center of the box around the mesh's vertices, which its bounding spheres share. A mesh
    /// whose positions start at a corner, as quantized files store them, keeps its sphere on the
    /// shape rather than on that corner.
    pub center: [f32; 3],
    /// The distance from the center to the mesh's farthest vertex, for bounding spheres.
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
    /// For a split mesh, the mesh's vertex that each vertex of its parts copies, in part order:
    /// `sources` of the storage's list of them, from `first_source` on. 0 for a mesh in one part.
    first_source: u32,
    sources: u32,
    /// How many times [`MeshStorage::update_vertices`] changed the mesh's vertices, never 0 again
    /// once it did: 0 for a mesh whose vertices stay as they were added.
    pub updates: u32,
    /// The mesh whose vertices this mesh draws from its own indices, for a level, or `None`. A
    /// level goes when its base goes, and the base's vertices outlive it.
    base: Option<u32>,
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

    /// The first texture coordinates of vertex `v`, as shaders read them, or `None` for a format
    /// without them.
    #[inline(always)]
    pub fn uv(&self, v: u32) -> Option<[f32; 2]> {
        let ty = vertex::type_of(self.format, vertex::UV0_LOCATION)?;
        let at = v as usize * vertex::stride(self.format) as usize
            + vertex::offset(self.format, vertex::UV0_LOCATION)? as usize;
        let size = ty.bytes() as usize;
        Some([0, 1].map(|c| ty.decode(&self.vertices[at + c * size..])))
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
    /// A page has no room for a level's indices. A page past its limit would refuse every frame,
    /// so the level is refused instead and its caller gives the level a copy of its own.
    PageFull,
    /// The mesh's morph targets make no morphed mesh.
    Morph(MorphError),
    /// The engine's memory could not grow by `bytes` for the mesh. The storage holds no part of it.
    OutOfMemory { bytes: u64 },
    /// A mesh that a new mesh would take its vertices from is not live.
    UnknownMesh,
    /// A level cannot share the base mesh's vertices: the base is split into parts, or joints or
    /// morph targets pose its vertices, so the level copies them instead.
    SharedUnavailable,
    /// A level that must keep its triangles' order got triangles that do not come part by part,
    /// so the parts that draw them would hold them in another order.
    Unordered,
}

/// Room for `more` values in `v`, or the bytes they need when memory cannot grow.
///
/// A list grows by a quarter of its length at a time, where `Vec` would double it: a growth copies
/// the list into a new block while the old one still lives, so doubling a page's indices of a
/// hundred megabytes asks for two hundred more at once. Growing by a quarter asks for a little
/// over the list's own size, and where even that does not fit, for `more` values alone. So a scene
/// whose meshes fill most of the memory's maximum still takes its levels.
fn reserve<T>(v: &mut Vec<T>, more: usize) -> Result<(), MeshError> {
    if v.capacity() - v.len() >= more {
        return Ok(());
    }
    let step = more.max(v.len() / 4).max(MIN_GROWTH);
    v.try_reserve_exact(step)
        .or_else(|_| v.try_reserve_exact(more))
        .map_err(|_| MeshError::OutOfMemory {
            bytes: (more as u64).saturating_mul(size_of::<T>() as u64),
        })
}

/// The fewest values that a list grows by, so a small list does not grow one value at a time.
const MIN_GROWTH: usize = 64;

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
    /// True for each id whose mesh is live.
    live: Vec<bool>,
    /// The ids of removed meshes, which the next meshes take lowest first.
    free: Vec<u32>,
    /// The mesh vertex that each vertex of a split mesh's parts copies, mesh after mesh.
    sources: Vec<u32>,
    /// The byte ranges of the pages that the last vertex update changed: each page's index, and
    /// its first and its end byte. The list keeps its room from update to update.
    updated: Vec<(u32, usize, usize)>,
    /// Each mesh's pieces (see [`crate::pieces`]), which a new triangle list or new vertices drop.
    pieces: PieceTable,
    /// The check of what each mesh's pieces cull, which draws a mesh whole while they do not pay.
    piece_check: PieceCheck,
}

/// Why [`MeshStorage::update_vertices`] refused an update. It changes no vertex then.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpdateError {
    /// The id names no live mesh.
    UnknownMesh,
    /// The mesh has joints or morph targets, whose bounds and poses follow the vertices it was
    /// added with.
    Posed,
    /// The mesh's format has no attribute at the location, or the attribute takes no updates.
    NoAttribute,
    /// The values per vertex do not fit the attribute.
    Components,
    /// The vertices run past the mesh's last one, or the bytes are fewer than they need.
    Range,
    /// A float value at this place among the update's values is NaN or infinite.
    NotFinite { at: u32 },
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

    #[inline(always)]
    fn triangle_uv(&self, i: u32) -> Option<[[f32; 2]; 3]> {
        let mut local = i;
        for part in self.parts {
            let triangles = part.index_count / 3;
            if local < triangles {
                let page = &self.pages[part.page as usize];
                let at = (part.first_index + local * 3) as usize;
                let mut corners = [[0.0; 2]; 3];
                for (c, uv) in corners.iter_mut().enumerate() {
                    *uv = page.uv(u32::from(page.indices[at + c]) + part.base_vertex)?;
                }
                return Some(corners);
            }
            local -= triangles;
        }
        None
    }
}

/// The last vertex shader location whose attribute takes updates: the colors. Joints, weights and
/// the record follow it.
const LAST_UPDATABLE: usize = 5;

/// The vertex shader location of the tangents, which the level planner reads for their handedness.
const TANGENT_LOCATION: usize = 4;

/// The vertex shader location of the colors, which the level planner keeps near the mesh's.
const COLOR_LOCATION: usize = 5;

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
            live: Vec::new(),
            free: Vec::new(),
            sources: Vec::new(),
            updated: Vec::new(),
            pieces: PieceTable::default(),
            piece_check: PieceCheck::default(),
        }
    }

    pub fn pages(&self) -> &[Page] {
        &self.pages
    }

    /// True when the live mesh `level` draws the vertices of the live mesh `base` from indices of
    /// its own: a level that [`MeshStorage::add_level`] added over that base.
    pub fn shares_vertices_with(&self, level: u32, base: u32) -> bool {
        self.mesh(level).is_some_and(|slot| slot.base == Some(base))
    }

    /// Gives the live mesh `id` pieces of its triangle list, in the list's order, from then on:
    /// the copies that draw it cull each piece on its own. `groups` split the pieces into groups of
    /// a few triangles each, in the list's order, or the pieces take none where they do not split
    /// them ([`crate::pieces::groups_split`]). A new triangle list or new vertices drop them. A
    /// mesh that joints or morph targets pose has no fixed bounds, so it takes none.
    pub fn set_pieces(
        &mut self,
        id: u32,
        pieces: &[Piece],
        groups: &[Piece],
    ) -> Result<(), PieceError> {
        let mesh = *self.mesh(id).ok_or(PieceError::UnknownMesh)?;
        if mesh.joints > 0 || mesh.targets > 0 {
            return Err(PieceError::Bounds);
        }
        let triangles = self
            .parts(&mesh, false)
            .iter()
            .map(|part| part.index_count / 3)
            .sum();
        self.pieces.set(id, triangles, pieces, groups)
    }

    /// Gives the live mesh `id` pieces over a triangle list of their own, `indices`, which holds the
    /// mesh's triangles in piece order and names its vertices: the way of a mesh made in code, whose
    /// own list keeps its order for raycasts and for the triangle numbers that a page reads. The list
    /// shares the mesh's vertices and costs its indices alone, as a level does, and it goes when the
    /// mesh goes. A mesh split into parts shares them part by part, as
    /// [`MeshStorage::add_split_level`] does, so its list must come part by part in that level's
    /// order. A mesh that holds a list takes another once [`MeshStorage::take_piece_list`] took the
    /// first away. `groups` split the pieces, as [`MeshStorage::set_pieces`] takes them.
    pub fn set_piece_list(
        &mut self,
        id: u32,
        indices: &[u32],
        pieces: &[Piece],
        groups: &[Piece],
    ) -> Result<(), PieceError> {
        let mesh = *self.mesh(id).ok_or(PieceError::UnknownMesh)?;
        let triangles: u32 = self
            .parts(&mesh, false)
            .iter()
            .map(|part| part.index_count / 3)
            .sum();
        if indices.len() != triangles as usize * 3 {
            return Err(PieceError::Triangles);
        }
        if self.pieces.list(id).is_some() {
            return Err(PieceError::Count);
        }
        if mesh.joints > 0 || mesh.targets > 0 {
            return Err(PieceError::Bounds);
        }
        // A list that the checks below refuse takes no room: they come before the list is made.
        crate::pieces::PieceTable::default().set(0, triangles, pieces, &[])?;
        let list = if mesh.part_count > 1 {
            self.add_split_level(id, indices, true)
        } else {
            self.add_level(id, indices)
        }
        .map_err(|_| PieceError::Triangles)?;
        self.pieces.set(id, triangles, pieces, groups)?;
        self.pieces.set_list(id, list);
        Ok(())
    }

    /// Takes away the triangle list of the pieces of mesh `id`, with the pieces, and returns the
    /// mesh that held it, which the caller removes as it removes any mesh.
    pub fn take_piece_list(&mut self, id: u32) -> Option<u32> {
        self.pieces.take_list(id)
    }

    /// The parts that the pieces of mesh `id` draw from, in piece order: the parts of their own
    /// list where the mesh has one, and the mesh's own parts otherwise.
    pub fn piece_parts(&self, id: u32) -> &[MeshPart] {
        let source = self.pieces.list(id).unwrap_or(id);
        self.mesh(source)
            .map_or(&[], |mesh| self.parts(mesh, false))
    }

    /// The pieces of mesh `id`'s triangle list, or none for a mesh that draws its list whole: one
    /// without pieces, or one whose pieces did not pay at the check's last verdict.
    pub fn pieces(&self, id: u32) -> &[Piece] {
        if self.mesh(id).is_some() && !self.piece_check.whole(id) {
            self.pieces.of(id)
        } else {
            &[]
        }
    }

    /// The groups of the pieces of mesh `id`, in the list's order, or none where
    /// [`MeshStorage::pieces`] gives none or the pieces have no groups.
    pub fn groups(&self, id: u32) -> &[Piece] {
        if self.pieces(id).is_empty() {
            &[]
        } else {
            self.pieces.groups(id)
        }
    }

    /// The check of what each mesh's pieces cull, which the frame builders count into.
    pub fn piece_check_mut(&mut self) -> &mut PieceCheck {
        &mut self.piece_check
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

    /// Writes new values of the attribute at vertex shader `location` into vertices `start` to
    /// `start + count` of mesh `id`, in every part that holds them. `bytes` holds `components`
    /// values per vertex in the attribute's own type, as little-endian bytes, vertex after vertex
    /// from vertex `start` on. Colors take 3 values, which keep each vertex's alpha, or 4. Joints,
    /// weights and the morph attribute take no updates, and neither does a mesh with joints or
    /// morph targets. Returns true for the mesh's first update. [`MeshStorage::updated`] then
    /// lists the bytes of each page that changed. Allocates nothing once the list has room for
    /// the mesh's parts. The mesh keeps its radius.
    ///
    /// # Errors
    /// [`UpdateError`] for an update that does not fit the mesh, which then keeps its vertices.
    pub fn update_vertices(
        &mut self,
        id: u32,
        location: usize,
        components: u32,
        start: u32,
        count: u32,
        bytes: &[u8],
    ) -> Result<bool, UpdateError> {
        let mesh = *self.mesh(id).ok_or(UpdateError::UnknownMesh)?;
        if mesh.joints > 0 || mesh.targets > 0 {
            return Err(UpdateError::Posed);
        }
        // Moved vertices leave the pieces' bounds behind.
        self.pieces.clear(id);
        let attribute = vertex::ATTRIBUTES
            .get(location)
            .filter(|_| location <= LAST_UPDATABLE || location == MORPH_LOCATION)
            .ok_or(UpdateError::NoAttribute)?;
        let ty = vertex::type_of(mesh.format, location).ok_or(UpdateError::NoAttribute)?;
        let offset = vertex::offset(mesh.format, location).ok_or(UpdateError::NoAttribute)?;
        let colors = attribute.bit == vertex::COLOR && components == 3;
        if components != attribute.components && !colors {
            return Err(UpdateError::Components);
        }
        let size = (components * ty.bytes()) as usize;
        let end = start.checked_add(count).ok_or(UpdateError::Range)?;
        if end > mesh.vertex_count || bytes.len() < count as usize * size {
            return Err(UpdateError::Range);
        }
        let bytes = &bytes[..count as usize * size];
        if ty == vertex::Type::F32 {
            let words = bytes.as_chunks::<4>().0;
            if let Some(at) = words
                .iter()
                .position(|&word| !f32::from_le_bytes(word).is_finite())
            {
                return Err(UpdateError::NotFinite { at: at as u32 });
            }
        }
        let stride = vertex::stride(mesh.format) as usize;
        let offset = offset as usize;
        let first = mesh.first_part as usize;
        let mut sources = &self.sources[mesh.first_source as usize..][..mesh.sources as usize];
        self.updated.clear();
        for part in &self.parts[first..first + mesh.part_count as usize] {
            let page = &mut self.pages[part.page as usize];
            let base = part.first_vertex as usize * stride + offset;
            let mut write = |local: usize, v: u32| {
                let from = (v - start) as usize * size;
                let at = base + local * stride;
                page.vertices[at..at + size].copy_from_slice(&bytes[from..from + size]);
            };
            // The part's vertices that changed: the first and one past the last.
            let (low, high) = if mesh.sources == 0 {
                (start..end).for_each(|v| write(v as usize, v));
                (start, end)
            } else {
                let (own, rest) = sources.split_at(part.vertex_count as usize);
                sources = rest;
                let mut changed = (u32::MAX, 0);
                for (local, &v) in own.iter().enumerate() {
                    if (start..end).contains(&v) {
                        write(local, v);
                        changed = (changed.0.min(local as u32), local as u32 + 1);
                    }
                }
                changed
            };
            if low < high {
                let first_byte = (part.first_vertex + low) as usize * stride;
                let end_byte = (part.first_vertex + high) as usize * stride;
                self.updated.push((part.page, first_byte, end_byte));
            }
        }
        // An update through a level writes its base mesh's vertices, so the base's count moves
        // too: a cached shadow of the base is stale as well.
        let mut id = id;
        loop {
            let slot = &mut self.meshes[id as usize];
            slot.updates = slot.updates.wrapping_add(1).max(1);
            match slot.base {
                Some(base) => id = base,
                None => break,
            }
        }
        Ok(mesh.updates == 0)
    }

    /// The byte ranges of the pages that the last [`MeshStorage::update_vertices`] changed: each
    /// page's index, its first byte and its end byte, whole vertices each.
    pub fn updated(&self) -> &[(u32, usize, usize)] {
        &self.updated
    }

    /// The parts of a mesh, in triangle order: their triangles, or their edge lists for a draw of
    /// `lines`. A mesh drawn as lines before [`MeshStorage::keep_edges`] made the lists draws
    /// nothing.
    pub fn parts(&self, mesh: &MeshSlot, lines: bool) -> &[MeshPart] {
        let first = mesh.first_part as usize;
        let parts = if !lines {
            &self.parts
        } else if self.edges {
            &self.edge_parts
        } else {
            return &[];
        };
        &parts[first..first + mesh.part_count as usize]
    }

    /// The first part of a mesh whose parts hold their vertices one after another in one page, in
    /// part order, or `None` for a mesh whose parts lie apart. Indices into the parts' vertices in
    /// that order ([`MeshStorage::to_part_order`]) then reach all of them from the first part's
    /// vertex: from its base vertex on shared buffers, and from its first vertex in a page. A mesh in
    /// one part always qualifies. A split mesh qualifies on shared buffers when one page held all
    /// its parts, and never in pages, whose 16-bit indices reach too few vertices.
    pub fn joined_parts(&self, mesh: &MeshSlot) -> Option<MeshPart> {
        let parts = self.parts(mesh, false);
        let first = *parts.first()?;
        let mut next = first.first_vertex;
        for part in parts {
            if part.page != first.page || part.first_vertex != next {
                return None;
            }
            next += part.vertex_count;
        }
        Some(first)
    }

    /// Rewrites `indices`, which name mesh `id`'s own vertices, to name the vertices that its parts
    /// hold, one part after another, and returns how many vertices the parts hold: the order that
    /// a tree of cluster patches draws in, from the mesh's [`MeshStorage::joined_parts`] or from a
    /// copy of [`MeshStorage::part_vertices`]. A mesh in one part keeps its own order. A vertex that
    /// several parts of a split mesh copy takes its first copy. An index that names no vertex a part
    /// holds becomes `u32::MAX`, past every count.
    /// Returns 0 for an id of no live mesh, or when memory cannot grow for the split mesh's table
    /// of first copies.
    pub fn to_part_order(&self, id: u32, indices: &mut [u32]) -> u32 {
        let Some(mesh) = self.mesh(id) else {
            return 0;
        };
        if mesh.sources == 0 {
            return mesh.vertex_count;
        }
        let first = mesh.first_source as usize;
        let sources = &self.sources[first..first + mesh.sources as usize];
        let mut first_copy = Vec::new();
        if reserve(&mut first_copy, mesh.vertex_count as usize).is_err() {
            return 0;
        }
        first_copy.resize(mesh.vertex_count as usize, u32::MAX);
        for (at, &source) in sources.iter().enumerate().rev() {
            first_copy[source as usize] = at as u32;
        }
        for index in indices {
            *index = first_copy.get(*index as usize).copied().unwrap_or(u32::MAX);
        }
        mesh.sources
    }

    /// The vertex bytes of each part of a mesh's triangles, in part order: the vertices that
    /// [`MeshStorage::to_part_order`]'s indices name, read from their pages.
    pub fn part_vertices<'a>(&'a self, mesh: &MeshSlot) -> impl Iterator<Item = &'a [u8]> + 'a {
        let stride = vertex::stride(mesh.format) as usize;
        self.parts(mesh, false).iter().map(move |part| {
            let at = part.first_vertex as usize * stride;
            &self.pages[part.page as usize].vertices[at..at + part.vertex_count as usize * stride]
        })
    }

    /// Makes every part's edge list, which the pages upload as new indices, and from now on each
    /// new part's, for draws of lines. Calls after the first change nothing.
    pub fn keep_edges(&mut self) {
        if !self.edges {
            self.edges = true;
            self.add_edge_parts();
        }
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
        let first_source = self.sources.len() as u32;
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
            self.sources.truncate(first_source as usize);
            return Err(error);
        }
        if self.edges {
            self.add_edge_parts();
        }

        let (center, radius) = bounding_sphere(geometry);
        let first_sphere = self.spheres.len() as u32;
        self.spheres.extend(joint_spheres(geometry));
        let slot = MeshSlot {
            format: geometry.format,
            first_part,
            part_count: self.parts.len() as u32 - first_part,
            vertex_count,
            center,
            radius,
            joints: self.spheres.len() as u32 - first_sphere,
            first_sphere,
            targets: 0,
            first_reach: 0,
            first_texel: 0,
            texels: 0,
            first_source,
            sources: self.sources.len() as u32 - first_source,
            updates: 0,
            base: None,
        };
        Ok(self.take_id(slot))
    }

    /// Gives `slot` the lowest id of a removed mesh, or a new one, and returns it. The caller
    /// reserved room in the mesh lists.
    fn take_id(&mut self, slot: MeshSlot) -> u32 {
        let lowest = (0..self.free.len()).min_by_key(|&k| self.free[k]);
        match lowest.map(|k| self.free.swap_remove(k)) {
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
        }
    }

    /// Gives the live mesh `mesh` another triangle list in place of the one it draws, for geometry
    /// that arrives after the mesh: a staged level replaces its base's triangles as each part of its
    /// file downloads. The indices name the mesh's own vertices. The mesh draws in one part, holds
    /// no morph targets and no level of its own, and has no edge list, since one belongs to the
    /// triangles that it was made from.
    ///
    /// The new list takes room after the old one in the part's page, which the next upload sends.
    /// The old list stays in the page until the mesh goes, so a mesh that takes a whole chain of
    /// staged lists holds about one more list than its finest. The mesh keeps its vertices, its
    /// bounds, its format and its joint spheres.
    pub fn replace_indices(&mut self, mesh: u32, indices: &[u32]) -> Result<(), MeshError> {
        if !indices.len().is_multiple_of(3) {
            return Err(MeshError::NotTriangles);
        }
        let slot = *self
            .meshes
            .get(mesh as usize)
            .filter(|_| self.live.get(mesh as usize) == Some(&true))
            .ok_or(MeshError::UnknownMesh)?;
        if slot.part_count != 1
            || slot.sources != 0
            || slot.targets != 0
            || slot.base.is_some()
            || self.edge_parts.get(slot.first_part as usize).is_some()
        {
            return Err(MeshError::SharedUnavailable);
        }
        let part = self.parts[slot.first_part as usize];
        if let Some(&index) = indices.iter().find(|&&index| index >= part.vertex_count) {
            return Err(MeshError::IndexOutOfRange {
                index,
                vertices: part.vertex_count,
            });
        }
        // Pages store page positions, so each index moves by where the part's vertices sit.
        // Shared buffers store the mesh's own indices and the draw adds the part's first vertex.
        let shift = match self.packing {
            Packing::Pages => part.first_vertex,
            Packing::SharedBuffers => 0,
        };
        let page_index = part.page as usize;
        if !self.has_room(&self.pages[page_index], 0, 0, indices.len()) {
            return Err(MeshError::PageFull);
        }
        let page = &mut self.pages[page_index];
        reserve(&mut page.indices, indices.len())?;
        let first_index = page.indices.len() as u32;
        page.indices
            .extend(indices.iter().map(|&index| (index + shift) as u16));
        let placed = &mut self.parts[slot.first_part as usize];
        placed.first_index = first_index;
        placed.index_count = indices.len() as u32;
        // The pieces named runs of the old list.
        self.pieces.clear(mesh);
        Ok(())
    }

    /// Adds a mesh that draws the vertices of the live mesh `base` with the triangles `indices`,
    /// which name the base mesh's vertices in its own order: the storage that the asset tool's
    /// levels need, whose vertex streams are the base's. A level names a subset of the base's
    /// vertices in the same order, because the planner simplifies by dropping vertices and
    /// rewriting indices, never by moving the vertices it keeps. The part's page takes the
    /// triangles' indices after the base's own, so the level costs the GPU indices alone. The level
    /// holds the base's radius and format, and goes when the base goes.
    ///
    /// A base in one part shares its vertices. A split base cannot, and neither can one whose morph
    /// targets pose its vertices: the level would draw parts of it with the wrong vertices or
    /// without its poses, so it is refused and the caller copies the vertices instead. A skinned
    /// base shares them, because the skin moves the same vertices whichever level names them.
    pub fn add_level(&mut self, base: u32, indices: &[u32]) -> Result<u32, MeshError> {
        if !indices.len().is_multiple_of(3) {
            return Err(MeshError::NotTriangles);
        }
        let slot = *self
            .meshes
            .get(base as usize)
            .filter(|_| self.live.get(base as usize) == Some(&true))
            .ok_or(MeshError::UnknownMesh)?;
        if slot.part_count != 1 || slot.sources != 0 || slot.targets != 0 {
            return Err(MeshError::SharedUnavailable);
        }
        let part = self.parts[slot.first_part as usize];
        if let Some(&index) = indices.iter().find(|&&index| index >= part.vertex_count) {
            return Err(MeshError::IndexOutOfRange {
                index,
                vertices: part.vertex_count,
            });
        }
        // Pages store page positions, so each index moves by where the part's vertices sit.
        // Shared buffers store the mesh's own indices and the draw adds the part's first vertex.
        let shift = match self.packing {
            Packing::Pages => part.first_vertex,
            Packing::SharedBuffers => 0,
        };
        let page_index = part.page as usize;
        if !self.has_room(&self.pages[page_index], 0, 0, indices.len()) {
            return Err(MeshError::PageFull);
        }
        let page = &mut self.pages[page_index];
        reserve(&mut page.indices, indices.len())?;
        let first_index = page.indices.len() as u32;
        page.indices
            .extend(indices.iter().map(|&index| (index + shift) as u16));
        let first_part = self.parts.len() as u32;
        reserve(&mut self.parts, 1)?;
        let made = MeshPart {
            page: part.page,
            first_index,
            index_count: indices.len() as u32,
            base_vertex: part.base_vertex,
            vertex_count: part.vertex_count,
            first_vertex: part.first_vertex,
            shares_vertices: true,
        };
        self.parts.push(made);
        if self.edges {
            let edges = self.edge_part(made);
            self.edge_parts.push(edges);
        }
        reserve(&mut self.meshes, 1)?;
        reserve(&mut self.live, 1)?;
        let level = MeshSlot {
            format: slot.format,
            first_part,
            part_count: 1,
            vertex_count: slot.vertex_count,
            center: slot.center,
            radius: slot.radius,
            // The level draws the base's vertices, so it reads the base's joint spheres too: a
            // skinned object's level follows the pose that the base's skin gives those vertices.
            joints: slot.joints,
            first_sphere: slot.first_sphere,
            targets: 0,
            first_reach: 0,
            first_texel: 0,
            texels: 0,
            first_source: 0,
            sources: 0,
            updates: 0,
            base: Some(base),
        };
        Ok(self.take_id(level))
    }

    /// Adds a level of the live mesh `base`, which the storage split into parts, that draws the
    /// base's own vertices from indices of its own, as [`MeshStorage::add_level`] does for a base
    /// in one part. The triangles `indices` name the base's vertices in its own numbering. Each
    /// triangle draws from a part of the base that holds all three of its vertices, from indices
    /// that the part's page takes after the base's own. A triangle whose vertices no one part
    /// holds, as one that spans two parts' seam may, draws from parts of the level's own, which
    /// copy those vertices alone. So the level costs indices, and a copy of a few vertices along
    /// the base's seams. The level holds the base's radius, format and vertex count, and goes when
    /// the base goes.
    ///
    /// The level draws its triangles part by part: those of the base's first part, in their order
    /// among `indices`, then those of the next, and the copied ones last. A triangle draws from
    /// the part where one of its corners first appears, trying its corners in turn, once that part
    /// holds all three. With `in_order`, the level keeps the order of `indices` whole, as pieces of the level need, so
    /// they must come part by part already.
    ///
    /// # Errors
    /// [`MeshError::UnknownMesh`] for a base that is not live, [`MeshError::SharedUnavailable`] for
    /// a base with morph targets or a level for its base, [`MeshError::NotTriangles`] and
    /// [`MeshError::IndexOutOfRange`] for indices that do not fit, [`MeshError::Unordered`] for
    /// triangles that do not come part by part with `in_order`, and [`MeshError::OutOfMemory`] when
    /// the lists cannot grow. The storage is as it was after an error.
    pub fn add_split_level(
        &mut self,
        base: u32,
        indices: &[u32],
        in_order: bool,
    ) -> Result<u32, MeshError> {
        if !indices.len().is_multiple_of(3) {
            return Err(MeshError::NotTriangles);
        }
        let slot = *self.mesh(base).ok_or(MeshError::UnknownMesh)?;
        if slot.targets != 0 || slot.base.is_some() {
            return Err(MeshError::SharedUnavailable);
        }
        if let Some(&index) = indices.iter().find(|&&index| index >= slot.vertex_count) {
            return Err(MeshError::IndexOutOfRange {
                index,
                vertices: slot.vertex_count,
            });
        }
        let first = slot.first_part as usize;
        let mut parts = Vec::new();
        reserve(&mut parts, slot.part_count as usize)?;
        parts.extend_from_slice(&self.parts[first..first + slot.part_count as usize]);
        // Each base vertex's first copy, as its part and its place there; a later copy, along a
        // seam, goes into a sorted list.
        let mut home: Vec<(u32, u32)> = Vec::new();
        reserve(&mut home, slot.vertex_count as usize)?;
        home.resize(slot.vertex_count as usize, (u32::MAX, 0));
        let mut seams: Vec<(u32, u32, u32)> = Vec::new();
        let own_of = |storage: &Self, at: usize| match slot.sources {
            0 => at as u32,
            _ => storage.sources[slot.first_source as usize + at],
        };
        let mut at = 0;
        for (k, part) in parts.iter().enumerate() {
            for local in 0..part.vertex_count {
                let own = own_of(self, at + local as usize);
                let first = &mut home[own as usize];
                if first.0 == u32::MAX {
                    *first = (k as u32, local);
                } else {
                    reserve(&mut seams, 1)?;
                    seams.push((own, k as u32, local));
                }
            }
            at += part.vertex_count as usize;
        }
        // Every seam copy is a distinct part and place, so the heap sort orders the list as fully
        // as a stable sort would.
        heap_sort_by(&mut seams, |a, b| a < b);
        let local_in = |v: u32, k: u32| {
            let first = home[v as usize];
            if first.0 == k {
                return Some(first.1);
            }
            seams
                .binary_search_by(|&(own, part, _)| (own, part).cmp(&(v, k)))
                .ok()
                .map(|found| seams[found].2)
        };
        // Each part's share of the triangles, in its own numbering, and the triangles that no
        // part holds whole.
        let mut lists: Vec<Vec<u32>> = Vec::new();
        reserve(&mut lists, parts.len())?;
        lists.resize_with(parts.len(), Vec::new);
        let mut apart: Vec<u32> = Vec::new();
        let mut last = 0;
        for triangle in indices.as_chunks::<3>().0 {
            let held = triangle.iter().find_map(|&v| {
                let k = home[v as usize].0;
                let corners = [
                    local_in(triangle[0], k)?,
                    local_in(triangle[1], k)?,
                    local_in(triangle[2], k)?,
                ];
                Some((k as usize, corners))
            });
            let group = held.map_or(parts.len(), |(k, _)| k);
            if in_order && group < last {
                return Err(MeshError::Unordered);
            }
            last = group;
            match held {
                Some((k, corners)) => {
                    reserve(&mut lists[k], 3)?;
                    lists[k].extend_from_slice(&corners);
                }
                None => {
                    reserve(&mut apart, 3)?;
                    apart.extend_from_slice(triangle);
                }
            }
        }
        // A page that cannot hold its share of the level would refuse every frame, so the whole
        // level is refused and the caller gives it a page of its own.
        for (k, part) in parts.iter().enumerate() {
            let list = &lists[k];
            if list.is_empty() {
                continue;
            }
            let placed = self.placed_indices(list.len());
            if !self.has_room(&self.pages[part.page as usize], 0, 0, placed) {
                return Err(MeshError::PageFull);
            }
        }
        // The vertices that the triangles apart name, each copied once, in the order they first
        // come.
        let stride = vertex::stride(slot.format) as usize;
        let mut renumber: Vec<u32> = Vec::new();
        let mut copies = Geometry {
            format: slot.format,
            vertices: Vec::new(),
            indices: Vec::new(),
        };
        let mut copied: Vec<u32> = Vec::new();
        if !apart.is_empty() {
            reserve(&mut renumber, slot.vertex_count as usize)?;
            renumber.resize(slot.vertex_count as usize, u32::MAX);
            reserve(&mut copies.indices, apart.len())?;
            for &v in &apart {
                if renumber[v as usize] == u32::MAX {
                    let (k, local) = home[v as usize];
                    let part = parts[k as usize];
                    let from = (part.first_vertex + local) as usize * stride;
                    let bytes = &self.pages[part.page as usize].vertices[from..from + stride];
                    reserve(&mut copies.vertices, stride)?;
                    copies.vertices.extend_from_slice(bytes);
                    reserve(&mut copied, 1)?;
                    copied.push(v);
                    renumber[v as usize] = copied.len() as u32 - 1;
                }
                copies.indices.push(renumber[v as usize]);
            }
        }
        reserve(&mut self.meshes, 1)?;
        reserve(&mut self.live, 1)?;
        reserve(&mut self.parts, parts.len())?;
        reserve(&mut self.sources, slot.vertex_count as usize + copied.len())?;
        let first_part = self.parts.len() as u32;
        let first_source = self.sources.len() as u32;
        // Pages store page positions; shared buffers store the part's own and the draw adds the
        // part's first vertex.
        let mut at = slot.first_source as usize;
        for (k, part) in parts.iter().enumerate() {
            let list = &lists[k];
            let base_sources = at..at + part.vertex_count as usize;
            at += part.vertex_count as usize;
            if list.is_empty() {
                continue;
            }
            let shift = match self.packing {
                Packing::Pages => part.first_vertex,
                Packing::SharedBuffers => 0,
            };
            let page = &mut self.pages[part.page as usize];
            reserve(&mut page.indices, list.len())?;
            let first_index = page.indices.len() as u32;
            page.indices
                .extend(list.iter().map(|&index| (index + shift) as u16));
            self.parts.push(MeshPart {
                first_index,
                index_count: list.len() as u32,
                shares_vertices: true,
                ..*part
            });
            match slot.sources {
                0 => self.sources.extend(0..part.vertex_count),
                _ => self.sources.extend_from_within(base_sources),
            }
        }
        if !copies.indices.is_empty() {
            let after = self.sources.len();
            let (max_vertices, max_indices) = self.part_limits(slot.format)?;
            if let Err(error) = self.split(&copies, max_vertices, max_indices) {
                let mut placed = Gaps::default();
                placed.add(first_part, self.parts.len() as u32 - first_part);
                self.take_out(placed, Gaps::default(), Gaps::default(), Gaps::default());
                self.sources.truncate(first_source as usize);
                return Err(error);
            }
            // The copies' parts name the copies by their place among them: the base's own
            // numbering names them by the vertex that each copies.
            for source in &mut self.sources[after..] {
                *source = copied[*source as usize];
            }
        }
        if self.edges {
            self.add_edge_parts();
        }
        let level = MeshSlot {
            format: slot.format,
            first_part,
            part_count: self.parts.len() as u32 - first_part,
            vertex_count: slot.vertex_count,
            center: slot.center,
            radius: slot.radius,
            joints: slot.joints,
            first_sphere: slot.first_sphere,
            targets: 0,
            first_reach: 0,
            first_texel: 0,
            texels: 0,
            first_source,
            sources: self.sources.len() as u32 - first_source,
            updates: 0,
            base: Some(base),
        };
        Ok(self.take_id(level))
    }

    /// The mesh vertex that each vertex of mesh `slot`'s parts holds, part after part: its own
    /// order for a mesh in one part, and the split mesh's table of sources otherwise.
    fn part_sources<'a>(&'a self, slot: &MeshSlot) -> Option<&'a [u32]> {
        (slot.sources != 0).then(|| {
            let first = slot.first_source as usize;
            &self.sources[first..first + slot.sources as usize]
        })
    }

    /// The page vertex and the mesh vertex of each corner of `part`'s triangles, in triangle order.
    fn part_corners<'a>(
        &'a self,
        part: &'a MeshPart,
        sources: Option<&'a [u32]>,
    ) -> impl Iterator<Item = (u32, u32)> + 'a {
        // Pages store page positions; shared buffers store the part's own and the draw adds the
        // part's first vertex.
        let shift = match self.packing {
            Packing::Pages => part.first_vertex,
            Packing::SharedBuffers => 0,
        };
        let page = &self.pages[part.page as usize];
        let first = part.first_index as usize;
        page.indices[first..first + part.index_count as usize]
            .iter()
            .map(move |&index| {
                let local = u32::from(index) - shift;
                let own = sources.map_or(local, |sources| sources[local as usize]);
                (part.first_vertex + local, own)
            })
    }

    /// The floats of each vertex attribute that the level planner reads, for a mesh of `format`:
    /// position and normal, then the first and second texture coordinates, the tangent and the
    /// color where the format has them, as `(location, components)`.
    pub fn planning_attributes(format: u32) -> impl Iterator<Item = (usize, usize)> {
        [
            (vertex::POSITION, 3),
            (vertex::NORMAL, 3),
            (vertex::UV0_LOCATION, 2),
            (vertex::UV0_LOCATION + 1, 2),
            (TANGENT_LOCATION, 4),
            (COLOR_LOCATION, 4),
        ]
        .into_iter()
        .filter(move |&(location, _)| vertex::has(format, location))
    }

    /// Writes part `k` of mesh `id`'s vertices and triangles, as the level planner reads them,
    /// after the first `out.len()` words of `out`: the mesh's part count, vertex count, index count
    /// and format, the part's vertex count and index count, then the mesh vertex that each of the
    /// part's vertices holds, the floats of each attribute of
    /// [`MeshStorage::planning_attributes`] for the part's vertices as a shader reads them,
    /// attribute after attribute, and the part's triangles in the mesh's own numbering. Floats go
    /// in as their bits. A caller that reads one part at a time reads a large mesh over several
    /// calls, and the parts together give each of the mesh's triangles once, in its order.
    ///
    /// # Errors
    /// [`MeshError::UnknownMesh`] for an id of no live mesh or a part it does not have, and
    /// [`MeshError::OutOfMemory`] when `out` cannot grow.
    pub fn planning_part(&self, id: u32, k: u32, out: &mut Vec<u32>) -> Result<(), MeshError> {
        let slot = *self.mesh(id).ok_or(MeshError::UnknownMesh)?;
        let parts = self.parts(&slot, false);
        let part = *parts.get(k as usize).ok_or(MeshError::UnknownMesh)?;
        let before: usize = parts[..k as usize]
            .iter()
            .map(|part| part.vertex_count as usize)
            .sum();
        let vertices = part.vertex_count as usize;
        let sources = self
            .part_sources(&slot)
            .map(|sources| &sources[before..before + vertices]);
        let index_count: usize = parts.iter().map(|part| part.index_count as usize).sum();
        let floats: usize = Self::planning_attributes(slot.format)
            .map(|(_, components)| components)
            .sum();
        reserve(out, 6 + vertices * (1 + floats) + part.index_count as usize)?;
        out.extend([
            parts.len() as u32,
            slot.vertex_count,
            index_count as u32,
            slot.format,
            part.vertex_count,
            part.index_count,
        ]);
        out.extend(
            (0..part.vertex_count)
                .map(|local| sources.map_or(local, |sources| sources[local as usize])),
        );
        let stride = vertex::stride(slot.format) as usize;
        let page = &self.pages[part.page as usize];
        for (location, components) in Self::planning_attributes(slot.format) {
            let ty = vertex::type_of(slot.format, location).unwrap_or(vertex::Type::F32);
            let offset = vertex::offset(slot.format, location).unwrap_or(0) as usize;
            let size = ty.bytes() as usize;
            for local in 0..vertices {
                let from = (part.first_vertex as usize + local) * stride + offset;
                for c in 0..components {
                    out.push(ty.decode(&page.vertices[from + c * size..]).to_bits());
                }
            }
        }
        out.extend(self.part_corners(&part, sources).map(|(_, own)| own));
        Ok(())
    }

    /// Adds a level of the live mesh `base` that holds its own copy of the vertices that the
    /// triangles `indices` name, in the base's own numbering: the level of a split base, which
    /// cannot share the base's vertices. The copy takes each vertex once, in the order that the
    /// triangles first name it, so the level holds only the vertices that it draws, in the base's
    /// format. It is a mesh of its own, which goes when the caller takes it out. Returns its id.
    ///
    /// # Errors
    /// [`MeshError::UnknownMesh`] for a base that is not live, [`MeshError::SharedUnavailable`] for
    /// a base with morph targets, whose level would draw without its poses,
    /// [`MeshError::NotTriangles`] and [`MeshError::IndexOutOfRange`] for indices that do not fit,
    /// and the errors of [`MeshStorage::add`].
    pub fn add_level_copy(&mut self, base: u32, indices: &[u32]) -> Result<u32, MeshError> {
        if !indices.len().is_multiple_of(3) {
            return Err(MeshError::NotTriangles);
        }
        let slot = *self.mesh(base).ok_or(MeshError::UnknownMesh)?;
        if slot.targets != 0 {
            return Err(MeshError::SharedUnavailable);
        }
        if let Some(&index) = indices.iter().find(|&&index| index >= slot.vertex_count) {
            return Err(MeshError::IndexOutOfRange {
                index,
                vertices: slot.vertex_count,
            });
        }
        // The page and byte of the first copy of each base vertex.
        let mut first_copy: Vec<(u32, u32)> = Vec::new();
        reserve(&mut first_copy, slot.vertex_count as usize)?;
        first_copy.resize(slot.vertex_count as usize, (u32::MAX, 0));
        let stride = vertex::stride(slot.format);
        let sources = self.part_sources(&slot);
        let mut copied = 0;
        for part in self.parts(&slot, false) {
            for local in 0..part.vertex_count {
                let own = sources.map_or(local, |sources| sources[copied + local as usize]);
                let copy = &mut first_copy[own as usize];
                if copy.0 == u32::MAX {
                    *copy = (part.page, (part.first_vertex + local) * stride);
                }
            }
            copied += part.vertex_count as usize;
        }
        let mut renumber: Vec<u32> = Vec::new();
        reserve(&mut renumber, slot.vertex_count as usize)?;
        renumber.resize(slot.vertex_count as usize, u32::MAX);
        let mut geometry = Geometry {
            format: slot.format,
            vertices: Vec::new(),
            indices: Vec::new(),
        };
        reserve(&mut geometry.indices, indices.len())?;
        for &index in indices {
            let new = &mut renumber[index as usize];
            if *new == u32::MAX {
                let (page, byte) = first_copy[index as usize];
                let bytes = &self.pages[page as usize].vertices[byte as usize..][..stride as usize];
                reserve(&mut geometry.vertices, bytes.len())?;
                geometry.vertices.extend_from_slice(bytes);
                *new = (geometry.vertices.len() / stride as usize) as u32 - 1;
            }
            geometry.indices.push(*new);
        }
        self.add(&geometry)
    }

    /// Removes the live meshes among `ids`, packs the storage over their data, and returns where
    /// the data changed. Other ids are skipped. The removed ids stay taken until
    /// [`MeshStorage::release`] gives them to later meshes.
    pub fn remove(&mut self, ids: &[u32]) -> MeshMoves {
        let (mut parts, mut spheres, mut reaches, mut texels) = Default::default();
        let mut sources = Gaps::default();
        // A level draws its base's vertices, so it goes with the base rather than outlive them.
        let mut ids = ids.to_vec();
        let mut at = 0;
        while at < ids.len() {
            let base = ids[at];
            at += 1;
            for (level, mesh) in self.meshes.iter().enumerate() {
                let level = level as u32;
                if mesh.base == Some(base) && self.live[level as usize] && !ids.contains(&level) {
                    ids.push(level);
                }
            }
        }
        for &id in &ids {
            if self.mesh(id).is_none() {
                continue;
            }
            let mesh = self.meshes[id as usize];
            Gaps::add(&mut parts, mesh.first_part, mesh.part_count);
            // A level's joint spheres are its base's, which stay while the base lives.
            if mesh.base.is_none() {
                Gaps::add(&mut spheres, mesh.first_sphere, mesh.joints);
            }
            Gaps::add(&mut reaches, mesh.first_reach, mesh.targets);
            Gaps::add(&mut texels, mesh.first_texel, mesh.texels);
            sources.add(mesh.first_source, mesh.sources);
            self.live[id as usize] = false;
            self.meshes[id as usize].part_count = 0;
            self.pieces.forget(id);
            self.piece_check.forget(id);
        }
        sources.close();
        sources.squeeze(&mut self.sources, 1);
        for id in 0..self.meshes.len() {
            if self.live[id] {
                let mesh = &mut self.meshes[id];
                mesh.first_source -= sources.before(mesh.first_source);
            }
        }
        self.take_out(parts, spheres, reaches, texels)
    }

    /// Gives the ids of removed meshes to the next meshes added, lowest first. Ids of live meshes
    /// are skipped.
    pub fn release(&mut self, ids: &[u32]) {
        let lists = self.pieces.take_released();
        for &id in ids.iter().chain(&lists) {
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
                // A level's vertices are its base's, which stay while any mesh draws them.
                if !part.shares_vertices {
                    vertices.add(part.first_vertex, part.vertex_count);
                }
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

    /// The indices that `indices` triangle indices take in a page: with edge lists, a part's edges
    /// follow its triangles, twice as many indices again.
    fn placed_indices(&self, indices: usize) -> usize {
        indices * if self.edges { 3 } else { 1 }
    }

    /// True when `page` has room for `vertex_bytes` more bytes of `count` vertices and for
    /// `indices` more indices.
    fn has_room(&self, page: &Page, vertex_bytes: usize, count: u32, indices: usize) -> bool {
        let limit = self.max_page_bytes;
        let (held_vertices, held_indices) = page.buffer_bytes();
        held_vertices + vertex_bytes as u64 <= limit
            && held_indices + (indices * 2).next_multiple_of(4) as u64 <= limit
            && (self.packing == Packing::SharedBuffers
                || page.vertex_count() + count <= MAX_PAGE_VERTICES)
    }

    /// The first page of `format` with room for `vertex_bytes` more bytes of `count` vertices and
    /// for `indices` more indices, which may be room that removed meshes left, or a new page when
    /// none has room. It reserves that room, so what fits it can be placed there without failing.
    fn page_with_room(
        &mut self,
        format: u32,
        vertex_bytes: usize,
        count: u32,
        indices: usize,
    ) -> Result<usize, MeshError> {
        let room = self.pages.iter().position(|page| {
            page.format == format && self.has_room(page, vertex_bytes, count, indices)
        });
        match room {
            Some(first) => {
                let page = &mut self.pages[first];
                reserve(&mut page.vertices, vertex_bytes)?;
                reserve(&mut page.indices, indices)?;
                Ok(first)
            }
            None => {
                let mut page = Page {
                    format,
                    ..Page::default()
                };
                reserve(&mut page.vertices, vertex_bytes)?;
                reserve(&mut page.indices, indices)?;
                reserve(&mut self.pages, 1)?;
                self.pages.push(page);
                Ok(self.pages.len() - 1)
            }
        }
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
        reserve(&mut self.parts, 1)?;
        let placed = self.placed_indices(indices.len());
        let page = self.page_with_room(format, vertices.len(), count, placed)?;
        self.place_in(page, format, vertices, indices)
    }

    /// Puts one part's vertices and part-local indices at the end of page `page_index`, whose room
    /// the caller reserved, and returns where the part landed.
    fn place_in(
        &mut self,
        page_index: usize,
        format: u32,
        vertices: &[u8],
        indices: &[u32],
    ) -> Result<MeshPart, MeshError> {
        let count = (vertices.len() / vertex::stride(format) as usize) as u32;
        reserve(&mut self.parts, 1)?;
        let placed = self.placed_indices(indices.len());
        let page = &mut self.pages[page_index];
        reserve(&mut page.vertices, vertices.len())?;
        reserve(&mut page.indices, placed)?;
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
            shares_vertices: false,
        })
    }

    /// Adds a mesh too large for one part as several: runs of whole triangles, in order, each
    /// with at most `max_vertices` vertices and `max_indices` indices. Each part copies the
    /// vertices it uses in the order its triangles first use them.
    ///
    /// On shared buffers, every part goes into one page when a page can hold them all. The mesh's
    /// vertices then lie one after another in part order, so 32-bit indices reach each of them from
    /// the first part's base vertex, as a tree of cluster patches draws them
    /// ([`MeshStorage::joined_parts`]). Pages of WebGL2 hold too few vertices for that.
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
        let page = match self.packing {
            Packing::SharedBuffers => {
                let (mut vertices, mut indices) = (0usize, 0usize);
                cut_parts(geometry, max_vertices, max_indices, &mut part, |part| {
                    vertices += part.used.len();
                    indices += part.indices.len();
                    part.clear();
                    Ok(())
                })?;
                let bytes = vertices * geometry.stride();
                let placed = self.placed_indices(indices);
                let empty = Page::default();
                if self.has_room(&empty, bytes, vertices as u32, placed) {
                    Some(self.page_with_room(geometry.format, bytes, vertices as u32, placed)?)
                } else {
                    None
                }
            }
            Packing::Pages => None,
        };
        cut_parts(geometry, max_vertices, max_indices, &mut part, |part| {
            part.finish(self, geometry, page)
        })
    }
}

/// Cuts `geometry`'s triangles, in order, into runs of at most `max_vertices` vertices and
/// `max_indices` indices, as [`MeshStorage::split`] places them. `part` gathers each run, and
/// `finish` takes each full run and must start the next one.
fn cut_parts(
    geometry: &Geometry,
    max_vertices: u32,
    max_indices: usize,
    part: &mut PartBuilder,
    mut finish: impl FnMut(&mut PartBuilder) -> Result<(), MeshError>,
) -> Result<(), MeshError> {
    for triangle in geometry.indices.as_chunks::<3>().0 {
        let new = triangle
            .iter()
            .enumerate()
            .filter(|&(k, &v)| part.local[v as usize] == UNUSED && !triangle[..k].contains(&v))
            .count();
        if part.used.len() + new > max_vertices as usize || part.indices.len() + 3 > max_indices {
            finish(part)?;
        }
        for &v in triangle {
            part.add(v);
        }
    }
    if !part.indices.is_empty() {
        finish(part)?;
    }
    Ok(())
}

/// A geometry's bounding sphere: the center of the box around its vertices, and the distance from
/// it to the farthest vertex. A geometry without vertices has a sphere of radius 0 at the origin.
pub fn bounding_sphere(geometry: &Geometry) -> ([f32; 3], f32) {
    let count = geometry.vertex_count();
    if count == 0 {
        return ([0.0; 3], 0.0);
    }
    let mut low = [f32::INFINITY; 3];
    let mut high = [f32::NEG_INFINITY; 3];
    for v in 0..count {
        let p = geometry.position(v);
        for k in 0..3 {
            low[k] = low[k].min(p[k]);
            high[k] = high[k].max(p[k]);
        }
    }
    let center: [f32; 3] = std::array::from_fn(|k| (low[k] + high[k]) * 0.5);
    let radius = (0..count)
        .map(|v| {
            let p = geometry.position(v);
            let d: [f32; 3] = std::array::from_fn(|k| p[k] - center[k]);
            (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt()
        })
        .fold(0.0f32, f32::max);
    (center, radius)
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

    /// Places the part in the storage, in `page` when the caller reserved room there for it, and
    /// starts the next one.
    fn finish(
        &mut self,
        storage: &mut MeshStorage,
        geometry: &Geometry,
        page: Option<usize>,
    ) -> Result<(), MeshError> {
        let stride = geometry.stride();
        self.vertices.clear();
        for &v in &self.used {
            let at = v as usize * stride;
            self.vertices
                .extend_from_slice(&geometry.vertices[at..at + stride]);
        }
        reserve(&mut storage.sources, self.used.len())?;
        let part = match page {
            Some(page) => storage.place_in(page, geometry.format, &self.vertices, &self.indices),
            None => storage.place(geometry.format, &self.vertices, &self.indices),
        }?;
        storage.parts.push(part);
        storage.sources.extend_from_slice(&self.used);
        self.clear();
        Ok(())
    }

    /// Starts the next part: the vertices that this one used are free again.
    fn clear(&mut self) {
        for &v in &self.used {
            self.local[v as usize] = UNUSED;
        }
        self.used.clear();
        self.indices.clear();
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
            .parts(slot, false)
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

    #[test]
    fn a_replaced_triangle_list_draws_its_own_vertices_after_the_old_one() {
        for packing in [Packing::Pages, Packing::SharedBuffers] {
            let mut storage = MeshStorage::new(packing);
            let geometry = box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap();
            let mesh = storage.add(&geometry).unwrap();
            let before = *storage.mesh(mesh).unwrap();
            let parts = storage.parts(&before, false).to_vec();
            // The last four triangles of the box take the place of its whole list.
            let indices = geometry.indices[geometry.indices.len() - 12..].to_vec();
            storage.replace_indices(mesh, &indices).unwrap();
            let after = *storage.mesh(mesh).unwrap();
            let replaced = storage.parts(&after, false).to_vec();
            // The mesh keeps one part, its vertices, its format and its bounds, and takes the new
            // list after the one it drew.
            assert_eq!(after.part_count, 1);
            assert_eq!(after.vertex_count, before.vertex_count);
            assert_eq!(after.format, before.format);
            assert_eq!(after.radius, before.radius);
            assert_eq!(replaced[0].index_count, 12);
            assert_eq!(
                replaced[0].first_index,
                parts[0].first_index + parts[0].index_count
            );
            assert_eq!(
                resolved_vertices(&storage, mesh),
                original_vertices(&geometry)[geometry.indices.len() - 12..].to_vec()
            );
        }
    }

    #[test]
    fn a_replacement_is_refused_for_a_mesh_that_cannot_take_one() {
        let mut storage = MeshStorage::new(Packing::Pages);
        let geometry = box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap();
        let mesh = storage.add(&geometry).unwrap();
        // A list that is not whole triangles names a vertex the mesh does not have.
        assert_eq!(
            storage.replace_indices(mesh, &[0, 1]),
            Err(MeshError::NotTriangles)
        );
        assert!(matches!(
            storage.replace_indices(mesh, &[0, 1, 999]),
            Err(MeshError::IndexOutOfRange { .. })
        ));
        // A level of another mesh takes no list of its own: it draws its base's triangles.
        let level = storage.add_level(mesh, &geometry.indices[..6]).unwrap();
        assert_eq!(
            storage.replace_indices(level, &geometry.indices[..6]),
            Err(MeshError::SharedUnavailable)
        );
        assert_eq!(
            storage.replace_indices(999, &geometry.indices[..3]),
            Err(MeshError::UnknownMesh)
        );
    }

    #[test]
    fn a_replaced_list_keeps_the_mesh_one_whose_pages_are_shared() {
        // A second mesh's data follows the first in its page, so the new list must not move it.
        let mut storage = MeshStorage::new(Packing::Pages);
        let first = box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap();
        let second = sphere_geometry(0.5, [8, 6], (0.0, TAU), (0.0, PI)).unwrap();
        let a = storage.add(&first).unwrap();
        let b = storage.add(&second).unwrap();
        let before = resolved_vertices(&storage, b);
        storage.replace_indices(a, &first.indices[..6]).unwrap();
        assert_eq!(resolved_vertices(&storage, b), before);
    }

    #[test]
    fn a_level_draws_the_same_vertices_from_its_own_indices() {
        for packing in [Packing::Pages, Packing::SharedBuffers] {
            let mut storage = MeshStorage::new(packing);
            let geometry = box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap();
            let base = storage.add(&geometry).unwrap();
            let slot = *storage.mesh(base).unwrap();
            let parts = storage.parts(&slot, false).to_vec();
            let count = parts.iter().map(|part| part.index_count).sum::<u32>();
            assert!(count >= 12);
            // The level keeps the first two triangles of the base.
            let indices = geometry.indices[..6].to_vec();
            let level = storage.add_level(base, &indices).unwrap();
            let level_slot = *storage.mesh(level).unwrap();
            let level_parts = storage.parts(&level_slot, false).to_vec();
            // The level shares the base's page and takes the indices after the base's.
            assert_eq!(level_parts.len(), 1);
            assert_eq!(level_parts[0].page, parts[0].page);
            assert_eq!(
                level_parts[0].first_index,
                parts[0].first_index + parts[0].index_count
            );
            assert_eq!(level_parts[0].index_count, 6);
            assert_eq!(level_parts[0].first_vertex, parts[0].first_vertex);
            assert_eq!(level_parts[0].base_vertex, parts[0].base_vertex);
            assert!(level_parts[0].shares_vertices);
            assert_eq!(level_slot.radius, slot.radius);
            assert_eq!(level_slot.format, slot.format);
            assert_eq!(level_slot.vertex_count, slot.vertex_count);
            // The two triangles draw the base's own vertices.
            assert_eq!(
                resolved_vertices(&storage, level),
                original_vertices(&geometry)[..6].to_vec()
            );
        }
    }

    #[test]
    fn a_level_copies_its_vertices_when_its_base_is_split() {
        // A page limit that one box fits and a grid does not: the grid's mesh takes several parts,
        // which no level can share.
        let mut storage = MeshStorage::with_page_limit(Packing::Pages, 2048);
        let grid = grid(64, 64, 0);
        let base = storage.add(&grid).unwrap();
        assert!(storage.mesh(base).unwrap().part_count > 1);
        assert_eq!(
            storage.add_level(base, &grid.indices[..6]),
            Err(MeshError::SharedUnavailable)
        );
    }

    /// The planner's arrays for `id`, put together from each of its parts as the engine reads them:
    /// the vertex count, the format, the floats of each attribute, attribute after attribute, in
    /// the mesh's numbering, and the indices.
    fn planning(storage: &MeshStorage, id: u32) -> (u32, u32, Vec<f32>, Vec<u32>) {
        let mut out = vec![7];
        storage.planning_part(id, 0, &mut out).unwrap();
        // The words go after the ones that the caller holds already.
        assert_eq!(out[0], 7);
        let (parts, vertices, format) = (out[1], out[2] as usize, out[4]);
        let floats: usize = MeshStorage::planning_attributes(format)
            .map(|(_, c)| c)
            .sum();
        let mut values = vec![0.0; floats * vertices];
        let mut indices = Vec::new();
        for k in 0..parts {
            let mut words = Vec::new();
            storage.planning_part(id, k, &mut words).unwrap();
            let (n, m) = (words[4] as usize, words[5] as usize);
            let sources = &words[6..6 + n];
            let mut at = 6 + n;
            let mut start = 0;
            for (_, components) in MeshStorage::planning_attributes(format) {
                for (local, &own) in sources.iter().enumerate() {
                    for c in 0..components {
                        values[start + own as usize * components + c] =
                            f32::from_bits(words[at + local * components + c]);
                    }
                }
                at += n * components;
                start += vertices * components;
            }
            indices.extend_from_slice(&words[at..at + m]);
        }
        (vertices as u32, format, values, indices)
    }

    #[test]
    fn the_planner_reads_a_split_mesh_as_it_was_made_in_both_packings() {
        let sphere = sphere(2.0, [48, 24]);
        for packing in [Packing::Pages, Packing::SharedBuffers] {
            let mut whole = MeshStorage::new(packing);
            let mut split = MeshStorage::with_page_limit(packing, 4096);
            let one = whole.add(&sphere).unwrap();
            let many = split.add(&sphere).unwrap();
            assert!(split.mesh(many).unwrap().part_count > 1);
            let (vertices, format, values, indices) = planning(&whole, one);
            assert_eq!(vertices as usize, sphere.vertex_count());
            assert_eq!(format, sphere.format);
            assert_eq!(indices, sphere.indices);
            // Positions first, then the normals and the texture coordinates of the generator.
            for v in 0..sphere.vertex_count() {
                assert_eq!(&values[v * 3..v * 3 + 3], &sphere.position(v));
            }
            assert_eq!(values.len(), sphere.vertex_count() * (3 + 3 + 2));
            let (v2, f2, values2, indices2) = planning(&split, many);
            assert_eq!((v2, f2), (vertices, format));
            assert_eq!(indices2, indices);
            // A split mesh's parts hold only the vertices that its triangles name, so the planner
            // reads those alike, and no triangle reads the others.
            let n = vertices as usize;
            for &v in &indices {
                let v = v as usize;
                for (start, size) in [(0, 3), (3 * n, 3), (6 * n, 2)] {
                    let range = start + v * size..start + (v + 1) * size;
                    assert_eq!(values2[range.clone()], values[range]);
                }
            }
        }
    }

    #[test]
    fn a_copied_level_draws_the_vertices_of_its_triangles_from_a_split_base() {
        for packing in [Packing::Pages, Packing::SharedBuffers] {
            let mut storage = MeshStorage::with_page_limit(packing, 2048);
            let grid = grid(64, 64, vertex::UV0);
            let base = storage.add(&grid).unwrap();
            assert!(storage.mesh(base).unwrap().part_count > 1);
            // Every other quad of the grid, across all its parts.
            let picked: Vec<u32> = grid
                .indices
                .chunks(12)
                .flat_map(|q| q[..6].to_vec())
                .collect();
            let level = storage.add_level_copy(base, &picked).unwrap();
            let slot = storage.mesh(level).unwrap();
            assert_eq!(slot.format, grid.format);
            let used: std::collections::BTreeSet<u32> = picked.iter().copied().collect();
            assert_eq!(slot.vertex_count as usize, used.len());
            let expected: Vec<Vec<u8>> = picked
                .iter()
                .map(|&i| {
                    let at = i as usize * grid.stride();
                    grid.vertices[at..at + grid.stride()].to_vec()
                })
                .collect();
            assert_eq!(resolved_vertices(&storage, level), expected);
            assert_eq!(
                storage.add_level_copy(base, &[0, 1]),
                Err(MeshError::NotTriangles)
            );
            let past = grid.vertex_count() as u32;
            assert_eq!(
                storage.add_level_copy(base, &[0, 1, past]),
                Err(MeshError::IndexOutOfRange {
                    index: past,
                    vertices: past
                })
            );
        }
    }

    #[test]
    fn a_level_of_a_split_base_draws_the_base_vertices_and_copies_only_its_seams() {
        for packing in [Packing::Pages, Packing::SharedBuffers] {
            let mut storage = MeshStorage::with_page_limit(packing, 4096);
            let grid = grid(64, 64, vertex::UV0);
            let base = storage.add(&grid).unwrap();
            assert!(storage.mesh(base).unwrap().part_count > 2);
            // Triangles that join vertices far apart, as a coarse level's do: each quad's first
            // corner with the corner of the quad four rows on, which crosses the parts' seams.
            let row = 65;
            let mut picked: Vec<u32> = grid
                .indices
                .chunks(12)
                .flat_map(|q| q[..6].to_vec())
                .collect();
            for x in 0..60 {
                picked.extend_from_slice(&[x, x + 1, x + row * 40]);
            }
            let before = storage
                .pages()
                .iter()
                .map(|p| p.vertices.len())
                .sum::<usize>();
            let level = storage.add_split_level(base, &picked, false).unwrap();
            let after = storage
                .pages()
                .iter()
                .map(|p| p.vertices.len())
                .sum::<usize>();
            let expected: Vec<Vec<u8>> = picked
                .iter()
                .map(|&i| {
                    let at = i as usize * grid.stride();
                    grid.vertices[at..at + grid.stride()].to_vec()
                })
                .collect();
            let mut drawn = resolved_vertices(&storage, level);
            let mut wanted = expected.clone();
            drawn.sort();
            wanted.sort();
            assert_eq!(drawn, wanted);
            // The level copies the vertices of the triangles that span the seams, and no others.
            let copied = (after - before) / grid.stride();
            assert!(copied > 0 && copied <= 3 * 60, "{copied} vertices copied");
            let slot = *storage.mesh(level).unwrap();
            assert_eq!(slot.format, grid.format);
            assert!(storage.shares_vertices_with(level, base));
            // The planner reads the level as the base's numbering names it.
            let (_, _, _, indices) = planning(&storage, level);
            let mut read: Vec<[u32; 3]> = indices.as_chunks::<3>().0.to_vec();
            let mut given: Vec<[u32; 3]> = picked.as_chunks::<3>().0.to_vec();
            read.sort();
            given.sort();
            assert_eq!(read, given);
            // The level goes with its base, and its indices with it.
            storage.remove(&[base]);
            assert!(storage.mesh(level).is_none());
        }
    }

    #[test]
    fn a_list_grows_by_a_quarter_at_a_time() {
        let mut v: Vec<u16> = vec![0; 1000];
        reserve(&mut v, 10).unwrap();
        assert_eq!(v.capacity(), 1250);
        // Room that the list has already takes no growth.
        reserve(&mut v, 250).unwrap();
        assert_eq!(v.capacity(), 1250);
        // A request larger than a quarter takes its own size.
        reserve(&mut v, 5000).unwrap();
        assert_eq!(v.capacity(), 6000);
        let mut small: Vec<u32> = Vec::new();
        reserve(&mut small, 1).unwrap();
        assert_eq!(small.capacity(), MIN_GROWTH);
    }

    #[test]
    fn a_split_mesh_takes_a_piece_list_that_comes_part_by_part() {
        for packing in [Packing::Pages, Packing::SharedBuffers] {
            let mut storage = MeshStorage::with_page_limit(packing, 4096);
            let grid = grid(64, 64, vertex::UV0);
            let base = storage.add(&grid).unwrap();
            assert!(storage.mesh(base).unwrap().part_count > 2);
            // A level of the base's own triangles draws them part by part, so its order is one
            // that a list in order may take.
            let (_, _, _, own) = planning(&storage, base);
            let level = storage.add_split_level(base, &own, false).unwrap();
            let (_, _, _, by_part) = planning(&storage, level);
            let triangles = by_part.len() as u32 / 3;
            let half = triangles / 2;
            let piece = |triangles| Piece {
                triangles,
                sphere: [0.0, 0.0, 0.0, 100.0],
                cone: [0.0, 1.0, 0.0, 2.0],
            };
            let pieces = [piece(half), piece(triangles - half)];
            // Triangles that do not come part by part would draw in another order than the
            // pieces name, so the list is refused and the storage stays as it was.
            let mut reversed: Vec<[u32; 3]> = by_part.as_chunks::<3>().0.to_vec();
            reversed.reverse();
            let reversed = reversed.concat();
            let parts_before = storage.parts.len();
            assert_eq!(
                storage.add_split_level(base, &reversed, true),
                Err(MeshError::Unordered)
            );
            assert_eq!(
                storage.set_piece_list(base, &reversed, &pieces, &[]),
                Err(PieceError::Triangles)
            );
            assert_eq!(storage.parts.len(), parts_before);
            assert!(storage.pieces(base).is_empty());
            storage
                .set_piece_list(base, &by_part, &pieces, &[])
                .unwrap();
            assert_eq!(storage.pieces(base), &pieces);
            // The pieces draw the list's parts, which hold the triangles in the list's order.
            let list = storage.pieces.list(base).unwrap();
            let (_, _, _, drawn) = planning(&storage, list);
            assert_eq!(drawn, by_part);
            let ranges: u32 = storage
                .piece_parts(base)
                .iter()
                .map(|part| part.index_count / 3)
                .sum();
            assert_eq!(ranges, triangles);
            // A mesh takes another list once the first is taken away, and removed with its parts.
            assert_eq!(
                storage.set_piece_list(base, &by_part, &pieces, &[]),
                Err(PieceError::Count)
            );
            assert_eq!(storage.take_piece_list(base), Some(list));
            assert!(storage.pieces(base).is_empty());
            storage.remove(&[list]);
            storage
                .set_piece_list(base, &by_part, &pieces, &[])
                .unwrap();
            assert_eq!(storage.pieces(base), &pieces);
        }
    }

    /// A skinned column of `rings` rings, its vertices naming the joint of their ring.
    fn skinned_column(rings: usize) -> Geometry {
        let format = vertex::JOINTS | vertex::WEIGHTS;
        let mut g = Geometry {
            format,
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
        g.indices = vec![0, 1, 2];
        g
    }

    #[test]
    fn a_level_of_a_skinned_base_keeps_its_joint_spheres_and_they_stay_while_it_lives() {
        let mut storage = MeshStorage::new(Packing::Pages);
        let geometry = skinned_column(3);
        let base = storage.add(&geometry).unwrap();
        let base_slot = *storage.mesh(base).unwrap();
        assert_eq!(base_slot.joints, 3);
        let level = storage.add_level(base, &geometry.indices).unwrap();
        let level_slot = *storage.mesh(level).unwrap();
        assert!(storage.shares_vertices_with(level, base));
        assert!(!storage.shares_vertices_with(base, level));
        // The level reads the base's spheres, so a skinned draw poses its vertices.
        assert_eq!(level_slot.joints, base_slot.joints);
        assert_eq!(level_slot.first_sphere, base_slot.first_sphere);
        assert_eq!(
            storage.joint_spheres(&level_slot).len(),
            storage.joint_spheres(&base_slot).len()
        );
        // Taking the level out frees no sphere of the base's.
        storage.remove(&[level]);
        let live_base = storage.mesh(base).unwrap();
        assert_eq!(storage.joint_spheres(live_base).len(), 3);
    }

    #[test]
    fn a_level_takes_its_indices_when_its_base_goes() {
        let mut storage = MeshStorage::new(Packing::Pages);
        let geometry = box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap();
        let base = storage.add(&geometry).unwrap();
        let level = storage.add_level(base, &geometry.indices[..6]).unwrap();
        let base_page = storage.parts(storage.mesh(base).unwrap(), false)[0].page;
        // Taking the level out frees its indices alone: the base's vertices and triangles stay.
        storage.remove(&[level]);
        storage.release(&[level]);
        assert!(storage.mesh(level).is_none());
        assert_eq!(
            resolved_vertices(&storage, base),
            original_vertices(&geometry)
        );
        assert_eq!(
            storage.pages()[base_page as usize].indices.len(),
            geometry.indices.len()
        );
        // The base takes the live level with it, rather than leave it over freed vertices.
        let level = storage.add_level(base, &geometry.indices[..6]).unwrap();
        storage.remove(&[base]);
        storage.release(&[base]);
        assert!(storage.mesh(base).is_none());
        assert!(storage.mesh(level).is_none());
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
                    .flat_map(|&id| storage.parts(storage.mesh(id).unwrap(), false));
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
                let parts = storage.parts(slot, false);
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
            let parts = storage.parts(&slot, false).to_vec();
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

    /// A split mesh's indices in part order reach the vertices that its own indices name: through
    /// its one page from the first part's base vertex on shared buffers, and through a copy of its
    /// parts' vertices in pages. Its parts stay one after another when a mesh before them goes.
    #[test]
    fn indices_in_part_order_reach_a_split_meshs_vertices_through_one_run() {
        let big = grid(300, 300, vertex::UV0);
        let stride = vertex::stride(big.format) as usize;
        let mut own: Vec<u32> = big.indices.iter().rev().step_by(7).copied().collect();
        own.extend([0, 301 * 301 - 1]);
        let want: Vec<&[u8]> = own
            .iter()
            .map(|&v| &big.vertices[v as usize * stride..(v as usize + 1) * stride])
            .collect();
        for packing in [Packing::SharedBuffers, Packing::Pages] {
            let mut storage = MeshStorage::new(packing);
            let small = storage.add(&grid(2, 2, vertex::UV0)).unwrap();
            let id = storage.add(&big).unwrap();
            let slot = *storage.mesh(id).unwrap();
            assert!(storage.parts(&slot, false).len() > 1);
            let mut indices = own.clone();
            let count = storage.to_part_order(id, &mut indices);
            let copy: Vec<u8> = storage.part_vertices(&slot).flatten().copied().collect();
            assert_eq!(copy.len(), count as usize * stride, "{packing:?}");
            for (k, &index) in indices.iter().enumerate() {
                let at = index as usize * stride;
                assert_eq!(&copy[at..at + stride], want[k], "{packing:?}, index {k}");
            }
            match packing {
                Packing::SharedBuffers => {
                    storage.remove(&[small]);
                    let slot = *storage.mesh(id).unwrap();
                    let first = storage.joined_parts(&slot).expect("one run of vertices");
                    assert_eq!(first.first_vertex, 0, "the removed mesh's room closed up");
                    let page = &storage.pages()[first.page as usize];
                    for (k, &index) in indices.iter().enumerate() {
                        let at = (index + first.base_vertex) as usize * stride;
                        assert_eq!(&page.vertices[at..at + stride], want[k], "index {k}");
                    }
                }
                Packing::Pages => assert_eq!(storage.joined_parts(&slot), None),
            }
        }
        // An index past the mesh names no vertex, and a mesh in one part keeps its order.
        let mut storage = MeshStorage::new(Packing::SharedBuffers);
        let id = storage.add(&big).unwrap();
        let mut past = [301 * 301];
        storage.to_part_order(id, &mut past);
        assert_eq!(past, [u32::MAX]);
        let one = storage.add(&grid(2, 2, 0)).unwrap();
        let mut same = [0, 4, 8];
        assert_eq!(storage.to_part_order(one, &mut same), 9);
        assert_eq!(same, [0, 4, 8]);
    }

    /// Shared buffers too small for a split mesh's every part still take it, a part at a time,
    /// and its parts then lie apart.
    #[test]
    fn a_split_mesh_too_large_for_one_shared_buffer_takes_several() {
        let mesh = grid(20, 20, 0);
        let mut storage = MeshStorage::with_page_limit(Packing::SharedBuffers, 4096);
        let id = storage.add(&mesh).unwrap();
        let slot = *storage.mesh(id).unwrap();
        assert!(storage.pages().len() > 1);
        assert_eq!(storage.joined_parts(&slot), None);
        assert_eq!(resolved_vertices(&storage, id), original_vertices(&mesh));
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
            assert_eq!(storage.parts(&slot, false).len(), 2, "{packing:?}");
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
            let parts = |id: u32| storage.parts(storage.mesh(id).unwrap(), false).len();
            assert_eq!((parts(fits), parts(splits)), (1, 2), "{packing:?}");
            for page in storage.pages() {
                assert!(page.indices.iter().all(|&i| i < u16::MAX), "{packing:?}");
            }
        }
    }

    #[test]
    fn a_level_past_its_pages_limit_is_refused() {
        // Pages of 4 KiB hold 2,048 indices at two bytes each. A level of 3,000 indices needs
        // 6,000 bytes, which would make every frame refuse the whole page.
        let mut storage = MeshStorage::with_page_limit(Packing::SharedBuffers, 4096);
        let base = storage.add(&grid(2, 2, 0)).unwrap();
        let many = vec![0u32; 3_000];
        assert_eq!(storage.add_level(base, &many), Err(MeshError::PageFull));
        assert_eq!(
            storage.add_split_level(base, &many, false),
            Err(MeshError::PageFull)
        );
        assert_eq!(
            storage.replace_indices(base, &many),
            Err(MeshError::PageFull)
        );
        // Nothing changed: every page stays within its limit and the base keeps its triangles.
        for page in storage.pages() {
            let (vertex_bytes, index_bytes) = page.buffer_bytes();
            assert!(vertex_bytes <= 4096 && index_bytes <= 4096);
        }
        let slot = *storage.mesh(base).unwrap();
        assert_eq!(storage.parts(&slot, false)[0].index_count, 24);
    }

    #[test]
    fn parts_also_split_where_a_page_limit_is_small() {
        // Pages of 4 KiB: 170 base-format vertices, or 2,048 indices.
        let mesh = grid(20, 20, 0);
        let mut storage = MeshStorage::with_page_limit(Packing::SharedBuffers, 4096);
        let id = storage.add(&mesh).unwrap();
        let slot = *storage.mesh(id).unwrap();
        assert!(storage.parts(&slot, false).len() > 1);
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
            storage.keep_edges();
            storage.add(&first).unwrap();
            let id = storage.add(&mesh).unwrap();
            assert!(storage.parts(storage.mesh(id).unwrap(), false).len() > 1);
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

    #[test]
    fn a_mesh_stored_from_a_corner_takes_its_sphere_at_its_box_center() {
        // A quantized file stores positions from a corner of the box, at 0 to 2 on each axis.
        let mut geometry = box_geometry(2.0, 2.0, 2.0, [1, 1, 1]).unwrap();
        let stride = geometry.stride();
        for v in 0..geometry.vertex_count() {
            for k in 0..3 {
                let at = v * stride + k * 4;
                let value = f32::from_le_bytes(geometry.vertices[at..at + 4].try_into().unwrap());
                geometry.vertices[at..at + 4].copy_from_slice(&(value + 1.0).to_le_bytes());
            }
        }
        let mut storage = MeshStorage::new(Packing::SharedBuffers);
        let id = storage.add(&geometry).unwrap();
        let slot = storage.mesh(id).unwrap();
        assert_eq!(slot.center, [1.0, 1.0, 1.0]);
        assert!((slot.radius - 3f32.sqrt()).abs() < 1e-6, "{}", slot.radius);
    }

    /// The pairs of vertices that a mesh's parts draw as lines, through each part's page.
    fn drawn_lines(storage: &MeshStorage, id: u32) -> Vec<[Vec<u8>; 2]> {
        let slot = storage.mesh(id).unwrap();
        let stride = vertex::stride(slot.format) as usize;
        storage
            .parts(slot, true)
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
            let triangles = storage.parts(storage.mesh(first).unwrap(), false).to_vec();
            storage.keep_edges();
            // A mesh added later gets its edge list too.
            let second = storage.add(&sphere(1.0, [8, 4])).unwrap();
            // Draws of triangles still take them from where they always were.
            assert_eq!(
                storage.parts(storage.mesh(first).unwrap(), false),
                triangles
            );
            let corners = [first, second].map(|id| resolved_vertices(&storage, id));
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
        storage.keep_edges();
        // With edge lists on, a new part goes to a page with room for its edges too.
        let small = storage.add(&triangles(1)).unwrap();
        let counts =
            [full, small].map(|id| storage.parts(storage.mesh(id).unwrap(), true)[0].index_count);
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
                if edges {
                    storage.keep_edges();
                }
                let ids: Vec<u32> = meshes.iter().map(|m| storage.add(m).unwrap()).collect();
                let moves = storage.remove(&[ids[1], ids[3]]);
                assert!(!moves.pages.is_empty(), "{packing:?}");
                assert_eq!(moves.morph_texels, None);
                assert!(storage.mesh(ids[1]).is_none() && storage.triangles(ids[3]).is_none());
                // The same pages as a storage that never held the removed meshes.
                let mut kept = MeshStorage::new(packing);
                if edges {
                    kept.keep_edges();
                }
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
                    assert_eq!(
                        resolved_vertices(&storage, id),
                        original_vertices(&meshes[k])
                    );
                    let slot = storage.mesh(id).unwrap();
                    assert_eq!(storage.joint_spheres(slot), joint_spheres(&meshes[k]));
                }
                // Once released, the removed ids go to the next meshes, lowest first.
                storage.release(&[ids[3], ids[1], ids[0]]);
                assert_eq!(storage.add(&meshes[3]).unwrap(), ids[1]);
                assert_eq!(storage.add(&meshes[1]).unwrap(), ids[3]);
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

    /// Little-endian bytes of floats, as an update passes them.
    fn float_bytes(values: &[f32]) -> Vec<u8> {
        values.iter().flat_map(|v| v.to_le_bytes()).collect()
    }

    /// `geometry` with the position of each vertex `v` that `moved` gives set to `[v, -v, 2]`.
    fn with_positions(geometry: &Geometry, moved: std::ops::Range<u32>) -> Geometry {
        let stride = geometry.stride();
        let mut out = geometry.clone();
        for v in moved {
            let at = v as usize * stride;
            out.vertices[at..at + 12].copy_from_slice(&float_bytes(&[v as f32, -(v as f32), 2.0]));
        }
        out
    }

    /// The new positions of vertices `moved`, as `with_positions` gives them.
    fn moved_positions(moved: std::ops::Range<u32>) -> Vec<u8> {
        float_bytes(
            &moved
                .flat_map(|v| [v as f32, -(v as f32), 2.0])
                .collect::<Vec<_>>(),
        )
    }

    /// A mesh keeps the groups that split its pieces, and new vertices drop them with the pieces.
    #[test]
    fn a_mesh_keeps_the_groups_of_its_pieces_until_its_vertices_move() {
        let mut storage = MeshStorage::new(Packing::SharedBuffers);
        let id = storage.add(&grid(4, 4, vertex::UV0)).unwrap();
        let run = |triangles| Piece {
            triangles,
            sphere: [0.0, 0.0, 0.0, 10.0],
            cone: [0.0, 1.0, 0.0, 2.0],
        };
        let pieces = [run(16), run(16)];
        let groups = [run(10), run(6), run(16)];
        storage.set_pieces(id, &pieces, &groups).unwrap();
        assert_eq!(storage.pieces(id), &pieces);
        assert_eq!(storage.groups(id), &groups);
        storage
            .set_pieces(id, &pieces, &[run(20), run(12)])
            .unwrap();
        assert!(storage.groups(id).is_empty());
        storage.set_pieces(id, &pieces, &groups).unwrap();
        storage
            .update_vertices(id, 0, 3, 3, 4, &moved_positions(3..7))
            .unwrap();
        assert!(storage.pieces(id).is_empty());
        assert!(storage.groups(id).is_empty());
    }

    #[test]
    fn an_update_writes_one_attribute_in_place_and_lists_the_bytes_it_changed() {
        let mesh = grid(4, 4, vertex::UV0);
        let stride = mesh.stride();
        for packing in [Packing::SharedBuffers, Packing::Pages] {
            let mut storage = MeshStorage::new(packing);
            storage
                .add(&box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap())
                .unwrap();
            let id = storage.add(&mesh).unwrap();
            let part = storage.parts(storage.mesh(id).unwrap(), false)[0];
            let bytes = moved_positions(3..7);
            assert_eq!(storage.update_vertices(id, 0, 3, 3, 4, &bytes), Ok(true));
            assert_eq!(storage.update_vertices(id, 0, 3, 3, 4, &bytes), Ok(false));
            assert_eq!(storage.mesh(id).unwrap().updates, 2);
            // Only the positions change: the normals and the texture coordinates stay.
            assert_eq!(
                resolved_vertices(&storage, id),
                original_vertices(&with_positions(&mesh, 3..7)),
                "{packing:?}"
            );
            let first = part.first_vertex as usize + 3;
            assert_eq!(
                storage.updated(),
                [(part.page, first * stride, (first + 4) * stride)]
            );
            // The mesh keeps the radius it was added with.
            assert_eq!(storage.mesh(id).unwrap().radius, mesh_radius(&mesh));
        }
    }

    /// The radius that the storage gives a geometry.
    fn mesh_radius(geometry: &Geometry) -> f32 {
        let mut storage = MeshStorage::new(Packing::SharedBuffers);
        let id = storage.add(geometry).unwrap();
        storage.mesh(id).unwrap().radius
    }

    #[test]
    fn an_update_reaches_each_copy_of_a_vertex_in_the_parts_of_a_split_mesh() {
        // 300 x 300 quads split into parts, which share the vertices along their seams.
        let big = grid(300, 300, 0);
        let vertices = big.vertex_count() as u32;
        let moved = 40_000..vertices;
        for packing in [Packing::SharedBuffers, Packing::Pages] {
            let mut storage = MeshStorage::new(packing);
            // A split mesh before it, which goes, moves the second one's list of copies down.
            let gone = storage.add(&big).unwrap();
            let id = storage.add(&big).unwrap();
            storage.remove(&[gone]);
            assert!(storage.parts(storage.mesh(id).unwrap(), false).len() > 1);
            let bytes = moved_positions(moved.clone());
            let count = moved.end - moved.start;
            assert_eq!(
                storage.update_vertices(id, 0, 3, moved.start, count, &bytes),
                Ok(true)
            );
            assert_eq!(
                resolved_vertices(&storage, id),
                original_vertices(&with_positions(&big, moved.clone())),
                "{packing:?}"
            );
            assert_eq!(
                storage.updated().len(),
                storage.parts(storage.mesh(id).unwrap(), false).len()
            );
        }
    }

    #[test]
    fn colors_of_three_values_keep_each_vertexs_alpha() {
        let mesh = grid(1, 1, vertex::COLOR);
        let mut storage = MeshStorage::new(Packing::SharedBuffers);
        let id = storage.add(&mesh).unwrap();
        let bytes = float_bytes(&[0.25, 0.5, 0.75]);
        assert_eq!(storage.update_vertices(id, 5, 3, 1, 1, &bytes), Ok(true));
        let stride = mesh.stride();
        let page = &storage.pages()[0];
        let at = stride + vertex::offset(mesh.format, 5).unwrap() as usize;
        assert_eq!(page.vertices[at..at + 12], bytes);
        assert_eq!(
            page.vertices[at + 12..at + 16],
            mesh.vertices[at + 12..at + 16]
        );
    }

    #[test]
    fn the_record_of_a_generated_mesh_takes_updates() {
        let mesh = grid(1, 1, vertex::MORPH);
        let mut storage = MeshStorage::new(Packing::SharedBuffers);
        let id = storage.add(&mesh).unwrap();
        let record: Vec<f32> = (0..16).map(|k| k as f32 * 0.125).collect();
        let bytes = float_bytes(&record);
        assert_eq!(storage.update_vertices(id, 8, 4, 0, 4, &bytes), Ok(true));
        // Every vertex keeps its four values, one whole word each.
        let stride = mesh.stride();
        let page = &storage.pages()[0];
        let at = vertex::offset(mesh.format, 8).unwrap() as usize;
        for v in 0..4 {
            let start = v * stride + at;
            assert_eq!(page.vertices[start..start + 16], bytes[v * 16..v * 16 + 16]);
        }
    }

    #[test]
    fn updates_that_do_not_fit_change_nothing() {
        use crate::morph::MorphTargets;

        let mesh = grid(2, 2, vertex::UV0);
        let mut storage = MeshStorage::new(Packing::SharedBuffers);
        let id = storage.add(&mesh).unwrap();
        let nine = moved_positions(0..9);
        let refused = [
            (
                storage.update_vertices(id + 1, 0, 3, 0, 9, &nine),
                UpdateError::UnknownMesh,
            ),
            (
                storage.update_vertices(id, 0, 3, 1, 9, &nine),
                UpdateError::Range,
            ),
            (
                storage.update_vertices(id, 0, 3, 0, 9, &nine[..8]),
                UpdateError::Range,
            ),
            (
                storage.update_vertices(id, 0, 2, 0, 9, &nine),
                UpdateError::Components,
            ),
            (
                storage.update_vertices(id, 3, 2, 0, 9, &nine),
                UpdateError::NoAttribute,
            ),
            (
                storage.update_vertices(id, 6, 4, 0, 9, &nine),
                UpdateError::NoAttribute,
            ),
            (
                storage.update_vertices(
                    id,
                    0,
                    3,
                    0,
                    2,
                    &float_bytes(&[0.0, 1.0, 2.0, 3.0, f32::NAN, 5.0]),
                ),
                UpdateError::NotFinite { at: 4 },
            ),
        ];
        for (result, error) in refused {
            assert_eq!(result, Err(error));
        }
        assert_eq!(storage.mesh(id).unwrap().updates, 0);
        assert_eq!(resolved_vertices(&storage, id), original_vertices(&mesh));

        let positions = vec![0.5; mesh.vertex_count() * 3];
        let targets = MorphTargets {
            targets: 1,
            positions: Some(&positions),
            normals: None,
            tangents: None,
            colors: None,
        };
        let morphed = storage.add_morphed(&mesh, &targets).unwrap();
        assert_eq!(
            storage.update_vertices(morphed, 0, 3, 0, 9, &nine),
            Err(UpdateError::Posed)
        );
    }
}
