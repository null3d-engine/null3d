//! The meshes and materials that the scene's raycasts and overlap queries test (see
//! [`null3d_core::bvh::query`]): each mesh's triangles as its pages hold them, and the faces that
//! each material draws.

use null3d_core::bvh::mesh::Side;
use null3d_core::bvh::query::QueryMeshes;

use crate::frame::{NO_MATERIAL, NO_MESH, SceneSettings};
use crate::materials::feature;
use crate::meshes::MeshTriangles;

impl QueryMeshes for SceneSettings {
    type Mesh<'a> = MeshTriangles<'a>;

    fn count(&self) -> u32 {
        self.meshes().count()
    }

    fn mesh(&self, id: u32) -> Option<MeshTriangles<'_>> {
        if id == NO_MESH {
            return None;
        }
        self.meshes().triangles(id - 1)
    }

    /// Both faces for a double-sided material, and front faces for any other, as three.js's
    /// `Raycaster` tests a material's `side`.
    fn side(&self, material: u32) -> Side {
        if material != NO_MATERIAL
            && self.materials().features(material - 1) & feature::DOUBLE_SIDED != 0
        {
            Side::Double
        } else {
            Side::Front
        }
    }
}
