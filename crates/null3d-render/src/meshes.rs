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

use null3d_gpu::drawlist::vertex;

use crate::geometry::Geometry;

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
}

/// One shared buffer or page: interleaved vertices of one format, and 16-bit indices.
#[derive(Debug, Default)]
pub struct Page {
    pub format: u32,
    pub vertices: Vec<f32>,
    pub indices: Vec<u16>,
}

impl Page {
    pub fn vertex_count(&self) -> u32 {
        (self.vertices.len() / vertex::floats(self.format) as usize) as u32
    }

    /// Bytes of the page's vertex buffer and index buffer, whose writes are whole 4-byte words.
    pub fn buffer_bytes(&self) -> (u64, u64) {
        (
            (self.vertices.len() * 4) as u64,
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
}

#[derive(Debug)]
pub struct MeshStorage {
    packing: Packing,
    max_page_bytes: u64,
    pages: Vec<Page>,
    parts: Vec<MeshPart>,
    meshes: Vec<MeshSlot>,
    /// Each part's edge list as a part of its page, in the order of `parts`, once made.
    edge_parts: Vec<MeshPart>,
    /// True once every part has an edge list, so each new part gets one too.
    edges: bool,
    /// True while draws take each part's edge list in place of its triangles.
    drawing_edges: bool,
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
            edge_parts: Vec::new(),
            edges: false,
            drawing_edges: false,
        }
    }

    pub fn pages(&self) -> &[Page] {
        &self.pages
    }

    pub fn mesh(&self, id: u32) -> Option<&MeshSlot> {
        self.meshes.get(id as usize)
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

    /// Adds a mesh and returns its id.
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
        if vertex_count <= max_vertices && indices.len() <= max_indices {
            let part = self.place(geometry.format, &geometry.vertices, indices);
            self.parts.push(part);
        } else {
            self.split(geometry, max_vertices, max_indices);
        }
        if self.edges {
            self.add_edge_parts();
        }

        let radius = geometry
            .vertices
            .chunks_exact(geometry.vertex_floats())
            .map(|v| (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt())
            .fold(0.0f32, f32::max);
        self.meshes.push(MeshSlot {
            format: geometry.format,
            first_part,
            part_count: self.parts.len() as u32 - first_part,
            vertex_count,
            radius,
        });
        Ok(self.meshes.len() as u32 - 1)
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

    /// Puts one part's vertices and part-local indices into the last page of their format, or
    /// into a new page when they do not fit it, and returns where the part landed.
    fn place(&mut self, format: u32, vertices: &[f32], indices: &[u32]) -> MeshPart {
        let count = (vertices.len() / vertex::floats(format) as usize) as u32;
        let (limit, packing) = (self.max_page_bytes, self.packing);
        // With edge lists, the part's edges follow its triangles: twice as many indices.
        let indices_placed = indices.len() * if self.edges { 3 } else { 1 };
        let fits = |page: &Page| {
            let (vertex_bytes, index_bytes) = page.buffer_bytes();
            vertex_bytes + (vertices.len() * 4) as u64 <= limit
                && index_bytes + (indices_placed * 2).next_multiple_of(4) as u64 <= limit
                && (packing == Packing::SharedBuffers
                    || page.vertex_count() + count <= MAX_PAGE_VERTICES)
        };
        let page_index = match self.pages.iter().rposition(|page| page.format == format) {
            Some(last) if fits(&self.pages[last]) => last,
            _ => {
                self.pages.push(Page {
                    format,
                    ..Page::default()
                });
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
        MeshPart {
            page: page_index as u32,
            first_index,
            index_count: indices.len() as u32,
            base_vertex,
        }
    }

    /// Adds a mesh too large for one part as several: runs of whole triangles, in order, each
    /// with at most `max_vertices` vertices and `max_indices` indices. Each part copies the
    /// vertices it uses in the order its triangles first use them.
    fn split(&mut self, geometry: &Geometry, max_vertices: u32, max_indices: usize) {
        let mut part = PartBuilder {
            local: vec![UNUSED; geometry.vertex_count()],
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
                part.finish(self, geometry);
            }
            for &v in triangle {
                part.add(v);
            }
        }
        if !part.indices.is_empty() {
            part.finish(self, geometry);
        }
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
    /// The used vertices' floats, as the part's page receives them.
    vertices: Vec<f32>,
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
    fn finish(&mut self, storage: &mut MeshStorage, geometry: &Geometry) {
        let floats = geometry.vertex_floats();
        self.vertices.clear();
        for &v in &self.used {
            let at = v as usize * floats;
            self.vertices
                .extend_from_slice(&geometry.vertices[at..at + floats]);
            self.local[v as usize] = UNUSED;
        }
        let part = storage.place(geometry.format, &self.vertices, &self.indices);
        storage.parts.push(part);
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
    fn resolved_vertices(storage: &MeshStorage, id: u32) -> Vec<Vec<f32>> {
        let slot = storage.mesh(id).unwrap();
        let floats = vertex::floats(slot.format) as usize;
        storage
            .parts(slot)
            .iter()
            .flat_map(|part| {
                let page = &storage.pages()[part.page as usize];
                assert_eq!(page.format, slot.format);
                let range =
                    part.first_index as usize..(part.first_index + part.index_count) as usize;
                page.indices[range].iter().map(move |&i| {
                    let v = (i as u32 + part.base_vertex) as usize * floats;
                    page.vertices[v..v + floats].to_vec()
                })
            })
            .collect()
    }

    fn original_vertices(g: &Geometry) -> Vec<Vec<f32>> {
        let floats = g.vertex_floats();
        g.indices
            .iter()
            .map(|&i| g.vertices[i as usize * floats..(i as usize + 1) * floats].to_vec())
            .collect()
    }

    /// A grid of `columns` x `rows` quads in the XY plane, in `format`, each vertex's floats after
    /// the position and the normal counting up from its index, so every vertex is unique.
    fn grid(columns: u32, rows: u32, format: u32) -> Geometry {
        let floats = vertex::floats(format) as usize;
        let mut g = Geometry {
            format,
            ..Geometry::default()
        };
        for y in 0..=rows {
            for x in 0..=columns {
                let index = g.vertices.len() / floats;
                g.vertices
                    .extend_from_slice(&[x as f32, y as f32, 0.0, 0.0, 0.0, 1.0]);
                g.vertices
                    .extend((6..floats).map(|k| (index * 10 + k) as f32 / 1e3));
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
            for round in 0..2 {
                for format in 0..=vertex::ALL {
                    let mesh = grid(2 + round, 3, format);
                    ids.push((storage.add(&mesh).unwrap(), mesh));
                }
            }
            // One page per format, each holding only its own format's vertices.
            assert_eq!(storage.pages().len(), (vertex::ALL + 1) as usize);
            for (id, mesh) in &ids {
                let slot = storage.mesh(*id).unwrap();
                assert_eq!(slot.format, mesh.format);
                let parts = storage.parts(slot);
                assert_eq!(parts.len(), 1);
                assert_eq!(storage.pages()[parts[0].page as usize].format, mesh.format);
                assert_eq!(resolved_vertices(&storage, *id), original_vertices(mesh));
            }
            for page in storage.pages() {
                let stride = vertex::floats(page.format) as usize;
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
    fn no_index_reaches_the_webgl2_restart_index() {
        // A strip of triangles over `vertices` vertices, the last of which uses the last vertex.
        let strip = |vertices: u32| Geometry {
            format: 0,
            vertices: vec![0.0; vertices as usize * 6],
            indices: (0..vertices - 2).flat_map(|v| [v, v + 1, v + 2]).collect(),
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
        let floats = vertex::floats(0) as usize;
        let broken = Geometry {
            format: 0,
            vertices: vec![0.0; floats * 3],
            indices: vec![0, 1, 3],
        };
        assert_eq!(
            storage.add(&broken),
            Err(MeshError::IndexOutOfRange {
                index: 3,
                vertices: 3
            })
        );
        let not_triangles = Geometry {
            format: 0,
            vertices: vec![0.0; floats * 3],
            indices: vec![0, 1],
        };
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
    fn drawn_lines(storage: &MeshStorage, id: u32) -> Vec<[Vec<f32>; 2]> {
        let slot = storage.mesh(id).unwrap();
        let floats = vertex::floats(slot.format) as usize;
        storage
            .parts(slot)
            .iter()
            .flat_map(|part| {
                let page = &storage.pages()[part.page as usize];
                let range =
                    part.first_index as usize..(part.first_index + part.index_count) as usize;
                let vertex = move |i: u16| {
                    let v = (i as u32 + part.base_vertex) as usize * floats;
                    page.vertices[v..v + floats].to_vec()
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
                let expected: Vec<[Vec<f32>; 2]> = corners
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
        let floats = vertex::floats(0) as usize;
        let triangles = |count: usize| Geometry {
            format: 0,
            vertices: vec![0.0; floats * 3],
            indices: (0..count).flat_map(|_| [0, 1, 2]).collect(),
        };
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
}
