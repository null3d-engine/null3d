//! Mesh storage. On WebGPU, meshes with the same vertex format share large vertex and index buffers,
//! and a draw selects its mesh with `first_index` and `base_vertex`. WebGL2 has no base-vertex draw,
//! so there meshes are packed into pages of at most 65,536 vertices, with each mesh's indices rebased
//! to its page, so indices stay 16-bit and one vertex array object serves a whole page.

use crate::geometry::{Geometry, VERTEX_FLOATS};

/// The largest page: 16-bit indices address this many vertices.
pub const MAX_PAGE_VERTICES: u32 = 1 << 16;
/// No shared buffer grows past this, the portable limit on buffer size.
pub const MAX_BUFFER_BYTES: u64 = 256 * 1024 * 1024;

/// How meshes are packed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Packing {
    /// WebGPU: shared buffers, draws use `base_vertex`.
    SharedBuffers,
    /// WebGL2: pages of at most 65,536 vertices with rebased indices.
    Pages,
}

/// Where one mesh lives.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MeshSlot {
    /// Index of the shared buffer or page holding the mesh.
    pub page: u32,
    pub first_index: u32,
    pub index_count: u32,
    /// Added to every index when drawing; always 0 with `Packing::Pages`, whose indices are rebased.
    pub base_vertex: u32,
    pub vertex_count: u32,
    /// The distance from the mesh's origin to its farthest vertex, for bounding spheres.
    pub radius: f32,
}

/// One shared buffer or page: interleaved vertices and 16-bit indices.
#[derive(Debug, Default)]
pub struct Page {
    pub vertices: Vec<f32>,
    pub indices: Vec<u16>,
}

impl Page {
    fn vertex_count(&self) -> u32 {
        (self.vertices.len() / VERTEX_FLOATS) as u32
    }

    fn byte_size(&self) -> u64 {
        (self.vertices.len() * 4 + self.indices.len() * 2) as u64
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MeshError {
    /// A mesh has more vertices than 16-bit indices can address.
    TooManyVertices { vertices: u32 },
    /// An index points past the mesh's vertices.
    IndexOutOfRange { index: u32, vertices: u32 },
    /// The index count is not a multiple of three.
    NotTriangles,
}

#[derive(Debug)]
pub struct MeshStorage {
    packing: Packing,
    max_page_bytes: u64,
    pages: Vec<Page>,
    meshes: Vec<MeshSlot>,
}

impl MeshStorage {
    pub fn new(packing: Packing) -> Self {
        Self::with_page_limit(packing, MAX_BUFFER_BYTES)
    }

    /// Storage whose pages never exceed `max_page_bytes`.
    pub fn with_page_limit(packing: Packing, max_page_bytes: u64) -> Self {
        Self {
            packing,
            max_page_bytes,
            pages: Vec::new(),
            meshes: Vec::new(),
        }
    }

    pub fn pages(&self) -> &[Page] {
        &self.pages
    }

    pub fn mesh(&self, id: u32) -> Option<&MeshSlot> {
        self.meshes.get(id as usize)
    }

    /// Adds a mesh and returns its id.
    pub fn add(&mut self, geometry: &Geometry) -> Result<u32, MeshError> {
        let vertex_count = geometry.vertex_count() as u32;
        if vertex_count > MAX_PAGE_VERTICES {
            return Err(MeshError::TooManyVertices {
                vertices: vertex_count,
            });
        }
        if !geometry.indices.len().is_multiple_of(3) {
            return Err(MeshError::NotTriangles);
        }
        if let Some(&index) = geometry.indices.iter().find(|&&i| i >= vertex_count) {
            return Err(MeshError::IndexOutOfRange {
                index,
                vertices: vertex_count,
            });
        }

        let bytes = (geometry.vertices.len() * 4 + geometry.indices.len() * 2) as u64;
        let fits = self.pages.last().is_some_and(|page| {
            page.byte_size() + bytes <= self.max_page_bytes
                && (self.packing == Packing::SharedBuffers
                    || page.vertex_count() + vertex_count <= MAX_PAGE_VERTICES)
        });
        if !fits {
            self.pages.push(Page::default());
        }
        let page_index = self.pages.len() as u32 - 1;
        let page = self
            .pages
            .last_mut()
            .expect("a page exists after the push above");

        let first_vertex = page.vertex_count();
        let first_index = page.indices.len() as u32;
        let rebase = if self.packing == Packing::Pages {
            first_vertex
        } else {
            0
        };
        page.vertices.extend_from_slice(&geometry.vertices);
        page.indices
            .extend(geometry.indices.iter().map(|&i| (i + rebase) as u16));

        let radius = geometry
            .vertices
            .chunks(VERTEX_FLOATS)
            .map(|v| (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt())
            .fold(0.0f32, f32::max);
        self.meshes.push(MeshSlot {
            page: page_index,
            first_index,
            index_count: geometry.indices.len() as u32,
            base_vertex: if self.packing == Packing::SharedBuffers {
                first_vertex
            } else {
                0
            },
            vertex_count,
            radius,
        });
        Ok(self.meshes.len() as u32 - 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::{box_geometry, sphere_geometry};

    fn resolved_positions(storage: &MeshStorage, id: u32) -> Vec<[f32; 3]> {
        let slot = storage.mesh(id).unwrap();
        let page = &storage.pages()[slot.page as usize];
        page.indices[slot.first_index as usize..(slot.first_index + slot.index_count) as usize]
            .iter()
            .map(|&i| {
                let v = (i as u32 + slot.base_vertex) as usize * VERTEX_FLOATS;
                [page.vertices[v], page.vertices[v + 1], page.vertices[v + 2]]
            })
            .collect()
    }

    fn original_positions(g: &Geometry) -> Vec<[f32; 3]> {
        g.indices
            .iter()
            .map(|&i| {
                let v = i as usize * VERTEX_FLOATS;
                [g.vertices[v], g.vertices[v + 1], g.vertices[v + 2]]
            })
            .collect()
    }

    #[test]
    fn rebased_indices_reach_the_same_vertices_in_both_packings() {
        let meshes = [
            box_geometry(1.0, 1.0, 1.0, [1, 1, 1]),
            sphere_geometry(0.5, 16, 8),
            box_geometry(2.0, 1.0, 0.5, [2, 2, 2]),
        ];
        for packing in [Packing::SharedBuffers, Packing::Pages] {
            let mut storage = MeshStorage::new(packing);
            let ids: Vec<u32> = meshes.iter().map(|m| storage.add(m).unwrap()).collect();
            for (id, mesh) in ids.iter().zip(&meshes) {
                assert_eq!(
                    resolved_positions(&storage, *id),
                    original_positions(mesh),
                    "{packing:?}"
                );
            }
            if packing == Packing::Pages {
                assert!(
                    ids.iter()
                        .all(|&id| storage.mesh(id).unwrap().base_vertex == 0)
                );
            }
        }
    }

    #[test]
    fn pages_hold_at_most_65536_vertices() {
        // 20 spheres of 33 x 17 = 561 vertices each fit 116 to a page.
        let sphere = sphere_geometry(1.0, 32, 16);
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
    fn no_shared_buffer_exceeds_its_byte_limit() {
        let mesh = box_geometry(1.0, 1.0, 1.0, [1, 1, 1]);
        let limit = 4096;
        let mut storage = MeshStorage::with_page_limit(Packing::SharedBuffers, limit);
        for _ in 0..100 {
            storage.add(&mesh).unwrap();
        }
        assert!(storage.pages().len() > 1);
        assert!(storage.pages().iter().all(|p| p.byte_size() <= limit));
    }

    #[test]
    fn bad_meshes_are_rejected() {
        let mut storage = MeshStorage::new(Packing::Pages);
        let broken = Geometry {
            vertices: vec![0.0; VERTEX_FLOATS * 3],
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
            vertices: vec![0.0; VERTEX_FLOATS * 3],
            indices: vec![0, 1],
        };
        assert_eq!(storage.add(&not_triangles), Err(MeshError::NotTriangles));
        let huge = Geometry {
            vertices: vec![0.0; VERTEX_FLOATS * (MAX_PAGE_VERTICES as usize + 1)],
            indices: vec![],
        };
        assert!(matches!(
            storage.add(&huge),
            Err(MeshError::TooManyVertices { .. })
        ));
    }

    #[test]
    fn a_box_radius_reaches_its_corners() {
        let mut storage = MeshStorage::new(Packing::SharedBuffers);
        let id = storage
            .add(&box_geometry(0.6, 0.6, 0.6, [1, 1, 1]))
            .unwrap();
        assert!((storage.mesh(id).unwrap().radius - 0.3 * 3f32.sqrt()).abs() < 1e-6);
    }
}
