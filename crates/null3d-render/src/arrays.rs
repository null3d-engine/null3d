//! Meshes from arrays, as `geometry.fromArrays` passes them. The arrays are checked, normals and
//! tangents are computed where asked, as three.js's `computeVertexNormals` and `computeTangents`
//! compute them, and every attribute is interleaved into the mesh's vertex format.
//!
//! Normals and tangents are computed on the job workers in two parallel steps: one value per
//! triangle, then for each vertex the sum of the values of its triangles, in triangle order. Both
//! the order and the arithmetic are three.js's, so the results match three.js's bit for bit.

use null3d_core::jobs::JobSystem;
use null3d_core::shared::SharedMut;
use null3d_gpu::drawlist::vertex;

use crate::geometry::Geometry;

/// Triangles or vertices in one chunk of a parallel step.
const CHUNK: u32 = 4096;

/// The arrays of one mesh.
#[derive(Clone, Copy, Debug, Default)]
pub struct MeshArrays<'a> {
    /// Three floats per vertex.
    pub positions: &'a [f32],
    /// Three floats per vertex.
    pub normals: Option<&'a [f32]>,
    /// The first texture coordinates: two floats per vertex.
    pub uvs: Option<&'a [f32]>,
    /// The second texture coordinates: two floats per vertex.
    pub uvs1: Option<&'a [f32]>,
    /// Linear colors: `color_floats` floats per vertex, 3 without alpha or 4 with it.
    pub colors: Option<&'a [f32]>,
    pub color_floats: usize,
    /// Four floats per vertex: the tangent and its handedness.
    pub tangents: Option<&'a [f32]>,
    /// Three per triangle, or `None` when each three vertices in a row make a triangle.
    pub indices: Option<&'a [u32]>,
    /// Computes normals from the triangles, as three.js's `computeVertexNormals` does.
    pub compute_normals: bool,
    /// Computes tangents from the positions, normals and first texture coordinates, as three.js's
    /// `computeTangents` does.
    pub compute_tangents: bool,
}

/// The arrays, as errors name them. The numbers are the codes the engine's error details use.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArrayName {
    Positions = 0,
    Normals = 1,
    Uvs = 2,
    Uvs1 = 3,
    Colors = 4,
    Tangents = 5,
    Indices = 6,
}

/// Why arrays make no mesh.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArraysError {
    /// The positions hold no vertex.
    NoVertices,
    /// The array's length does not fit the vertex count.
    Length(ArrayName),
    /// The indices, or the vertices of a mesh without indices, do not make whole triangles.
    NotTriangles,
    /// The array is given and asked to be computed too.
    Twice(ArrayName),
    /// The array is missing: normals that are not computed, or the texture coordinates or normals
    /// that computed tangents need.
    Missing(ArrayName),
    /// `indices[at]` names no vertex.
    IndexOutOfRange { at: u32 },
    /// Element `at` of the array is not a finite number.
    NotFinite { array: ArrayName, at: u32 },
}

/// Checks a mesh's arrays and builds its geometry: every attribute interleaved in the mesh's
/// vertex format, and the triangles' indices. Normals and tangents that are asked for are
/// computed on the job workers.
pub fn from_arrays(arrays: &MeshArrays<'_>, jobs: &JobSystem) -> Result<Geometry, ArraysError> {
    let vertices = check(arrays)?;
    let sequence: Vec<u32>;
    let indices = match arrays.indices {
        Some(indices) => indices,
        None => {
            sequence = (0..vertices as u32).collect();
            &sequence
        }
    };
    let adjacency = (arrays.compute_normals || arrays.compute_tangents)
        .then(|| Adjacency::new(indices, vertices));
    let computed_normals;
    let normals = match (arrays.normals, &adjacency) {
        (Some(normals), _) => normals,
        (None, Some(adjacency)) => {
            let indexed = arrays.indices.is_some();
            computed_normals = vertex_normals(arrays.positions, indices, adjacency, indexed, jobs);
            &computed_normals
        }
        (None, None) => return Err(ArraysError::Missing(ArrayName::Normals)),
    };
    let computed_tangents;
    let tangents = match (arrays.tangents, arrays.uvs, &adjacency) {
        (Some(tangents), _, _) => Some(tangents),
        (None, Some(uvs), Some(adjacency)) if arrays.compute_tangents => {
            computed_tangents =
                vertex_tangents(arrays.positions, normals, uvs, indices, adjacency, jobs);
            Some(&computed_tangents[..])
        }
        _ => None,
    };

    let format = [
        (arrays.uvs.is_some(), vertex::UV0),
        (arrays.uvs1.is_some(), vertex::UV1),
        (tangents.is_some(), vertex::TANGENT),
        (arrays.colors.is_some(), vertex::COLOR),
    ]
    .iter()
    .filter(|(present, _)| *present)
    .fold(0, |format, (_, bit)| format | bit);
    let floats = vertex::floats(format) as usize;
    let mut interleaved = Vec::with_capacity(vertices * floats);
    for v in 0..vertices {
        interleaved.extend_from_slice(&arrays.positions[v * 3..v * 3 + 3]);
        interleaved.extend_from_slice(&normals[v * 3..v * 3 + 3]);
        for uvs in [arrays.uvs, arrays.uvs1].into_iter().flatten() {
            interleaved.extend_from_slice(&uvs[v * 2..v * 2 + 2]);
        }
        if let Some(tangents) = tangents {
            interleaved.extend_from_slice(&tangents[v * 4..v * 4 + 4]);
        }
        if let Some(colors) = arrays.colors {
            let n = arrays.color_floats;
            interleaved.extend_from_slice(&colors[v * n..v * n + n]);
            if n == 3 {
                interleaved.push(1.0);
            }
        }
    }
    Ok(Geometry {
        format,
        vertices: interleaved,
        indices: indices.to_vec(),
    })
}

/// Checks the arrays' shapes and values, and returns the vertex count.
fn check(arrays: &MeshArrays<'_>) -> Result<usize, ArraysError> {
    use ArrayName::*;
    let positions = arrays.positions;
    if positions.is_empty() {
        return Err(ArraysError::NoVertices);
    }
    if !positions.len().is_multiple_of(3) {
        return Err(ArraysError::Length(Positions));
    }
    let vertices = positions.len() / 3;
    if !matches!(arrays.color_floats, 3 | 4) && arrays.colors.is_some() {
        return Err(ArraysError::Length(Colors));
    }
    let floats: [(ArrayName, Option<&[f32]>, usize); 6] = [
        (Positions, Some(positions), 3),
        (Normals, arrays.normals, 3),
        (Uvs, arrays.uvs, 2),
        (Uvs1, arrays.uvs1, 2),
        (Colors, arrays.colors, arrays.color_floats),
        (Tangents, arrays.tangents, 4),
    ];
    for (name, array, per_vertex) in floats {
        let Some(array) = array else { continue };
        if array.len() != vertices * per_vertex {
            return Err(ArraysError::Length(name));
        }
        if let Some(at) = array.iter().position(|value| !value.is_finite()) {
            return Err(ArraysError::NotFinite {
                array: name,
                at: at as u32,
            });
        }
    }
    match (arrays.normals.is_some(), arrays.compute_normals) {
        (true, true) => return Err(ArraysError::Twice(Normals)),
        (false, false) => return Err(ArraysError::Missing(Normals)),
        _ => {}
    }
    if arrays.compute_tangents {
        if arrays.tangents.is_some() {
            return Err(ArraysError::Twice(Tangents));
        }
        if arrays.uvs.is_none() {
            return Err(ArraysError::Missing(Uvs));
        }
    }
    match arrays.indices {
        Some(indices) => {
            if !indices.len().is_multiple_of(3) {
                return Err(ArraysError::NotTriangles);
            }
            if let Some(at) = indices.iter().position(|&i| i as usize >= vertices) {
                return Err(ArraysError::IndexOutOfRange { at: at as u32 });
            }
        }
        None if !vertices.is_multiple_of(3) => return Err(ArraysError::NotTriangles),
        None => {}
    }
    Ok(vertices)
}

/// Each vertex's triangles, in triangle order: `triangles[starts[v]..starts[v + 1]]`. A triangle
/// appears once for each of its corners at the vertex, as three.js visits it.
struct Adjacency {
    starts: Vec<u32>,
    triangles: Vec<u32>,
}

impl Adjacency {
    fn new(indices: &[u32], vertices: usize) -> Self {
        let mut starts = vec![0u32; vertices + 1];
        for &i in indices {
            starts[i as usize + 1] += 1;
        }
        for v in 0..vertices {
            starts[v + 1] += starts[v];
        }
        let mut next = starts.clone();
        let mut triangles = vec![0u32; indices.len()];
        for (t, triangle) in indices.as_chunks::<3>().0.iter().enumerate() {
            for &i in triangle {
                let at = &mut next[i as usize];
                triangles[*at as usize] = t as u32;
                *at += 1;
            }
        }
        Self { starts, triangles }
    }

    fn of(&self, v: usize) -> &[u32] {
        &self.triangles[self.starts[v] as usize..self.starts[v + 1] as usize]
    }
}

fn read3(values: &[f32], i: u32) -> [f64; 3] {
    let at = i as usize * 3;
    [
        f64::from(values[at]),
        f64::from(values[at + 1]),
        f64::from(values[at + 2]),
    ]
}

fn read2(values: &[f32], i: u32) -> [f64; 2] {
    let at = i as usize * 2;
    [f64::from(values[at]), f64::from(values[at + 1])]
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

/// The cross product, in three.js's order of operations (`Vector3.crossVectors`).
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// `Vector3.normalize`: the vector times one over its length, or times one when the length is
/// zero or not a number.
fn normalize(v: [f64; 3]) -> [f64; 3] {
    let length = dot(v, v).sqrt();
    let scale = 1.0
        / if length == 0.0 || length.is_nan() {
            1.0
        } else {
            length
        };
    [v[0] * scale, v[1] * scale, v[2] * scale]
}

/// Runs `per_item` over `0..count` on the job workers, each item writing its own `width` values
/// of `out`.
fn for_each_item<T: Copy + Send>(
    jobs: &JobSystem,
    count: usize,
    width: usize,
    out: &mut [T],
    per_item: impl Fn(usize, &mut [T]) + Sync,
) {
    let shared = SharedMut::new(out);
    jobs.parallel_for(count as u32, CHUNK, &|range, _| {
        for item in range {
            let item = item as usize;
            // SAFETY: each item writes only its own `width` values, and every item runs once.
            let values = unsafe { shared.slice(item * width, width) };
            per_item(item, values);
        }
    });
}

/// Vertex normals as three.js's `computeVertexNormals` makes them: each triangle's normal, as
/// large as the triangle, added into each of its vertices' normals, which are then normalized.
/// three.js stores each sum as a 32-bit float after each addition, and so does this. Without
/// indices, each vertex takes its one triangle's normal as it is.
fn vertex_normals(
    positions: &[f32],
    indices: &[u32],
    adjacency: &Adjacency,
    indexed: bool,
    jobs: &JobSystem,
) -> Vec<f32> {
    let triangles = indices.len() / 3;
    let mut faces = vec![[0f64; 3]; triangles];
    for_each_item(jobs, triangles, 1, &mut faces, |t, face| {
        let [a, b, c] = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
        let (pa, pb, pc) = (
            read3(positions, a),
            read3(positions, b),
            read3(positions, c),
        );
        face[0] = cross(sub(pc, pb), sub(pa, pb));
    });
    let vertices = positions.len() / 3;
    let mut normals = vec![0f32; vertices * 3];
    for_each_item(jobs, vertices, 3, &mut normals, |v, normal| {
        let mut sum = [0f32; 3];
        for &t in adjacency.of(v) {
            let face = faces[t as usize];
            for k in 0..3 {
                sum[k] = if indexed {
                    (f64::from(sum[k]) + face[k]) as f32
                } else {
                    face[k] as f32
                };
            }
        }
        let unit = normalize(sum.map(f64::from));
        for k in 0..3 {
            normal[k] = unit[k] as f32;
        }
    });
    normals
}

/// Vertex tangents as three.js's `computeTangents` makes them, after Lengyel: each triangle's
/// directions of increasing u and v, added into its vertices' sums, then each vertex's u direction
/// made perpendicular to its normal, with the handedness in the fourth value. Triangles whose
/// texture coordinates enclose no area add nothing, and vertices that no triangle uses keep a
/// tangent of zeros.
fn vertex_tangents(
    positions: &[f32],
    normals: &[f32],
    uvs: &[f32],
    indices: &[u32],
    adjacency: &Adjacency,
    jobs: &JobSystem,
) -> Vec<f32> {
    let triangles = indices.len() / 3;
    let mut faces: Vec<Option<[f64; 6]>> = vec![None; triangles];
    for_each_item(jobs, triangles, 1, &mut faces, |t, face| {
        let [a, b, c] = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
        let va = read3(positions, a);
        let (vb, vc) = (sub(read3(positions, b), va), sub(read3(positions, c), va));
        let ua = read2(uvs, a);
        let (ub, uc) = (read2(uvs, b), read2(uvs, c));
        let (ub, uc) = (
            [ub[0] - ua[0], ub[1] - ua[1]],
            [uc[0] - ua[0], uc[1] - ua[1]],
        );
        let r = 1.0 / (ub[0] * uc[1] - uc[0] * ub[1]);
        face[0] = r.is_finite().then(|| {
            let mut directions = [0f64; 6];
            for k in 0..3 {
                directions[k] = (vb[k] * uc[1] + vc[k] * -ub[1]) * r;
                directions[k + 3] = (vc[k] * ub[0] + vb[k] * -uc[0]) * r;
            }
            directions
        });
    });
    let vertices = positions.len() / 3;
    let mut tangents = vec![0f32; vertices * 4];
    for_each_item(jobs, vertices, 4, &mut tangents, |v, tangent| {
        let used = adjacency.of(v);
        if used.is_empty() {
            return;
        }
        let (mut u_sum, mut v_sum) = ([0f64; 3], [0f64; 3]);
        for face in used.iter().filter_map(|&t| faces[t as usize]) {
            for k in 0..3 {
                u_sum[k] += face[k];
                v_sum[k] += face[k + 3];
            }
        }
        let n = read3(normals, v as u32);
        let along = dot(n, u_sum);
        let t = normalize(sub(u_sum, n.map(|c| c * along)));
        let w = if dot(cross(n, u_sum), v_sum) < 0.0 {
            -1.0
        } else {
            1.0
        };
        tangent.copy_from_slice(&[t[0] as f32, t[1] as f32, t[2] as f32, w]);
    });
    tangents
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A unit quad in the XY plane facing +z, with texture coordinates from 0 to 1.
    const QUAD_POSITIONS: [f32; 12] = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0];
    const QUAD_NORMALS: [f32; 12] = [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0];
    const QUAD_UVS: [f32; 8] = [0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0];
    const QUAD_INDICES: [u32; 6] = [0, 1, 2, 0, 2, 3];

    fn quad<'a>() -> MeshArrays<'a> {
        MeshArrays {
            positions: &QUAD_POSITIONS,
            normals: Some(&QUAD_NORMALS),
            indices: Some(&QUAD_INDICES),
            ..MeshArrays::default()
        }
    }

    fn jobs() -> JobSystem {
        JobSystem::new(0)
    }

    #[test]
    fn attributes_interleave_in_the_order_of_the_vertex_format() {
        let colors = [0.5f32; 12];
        let uvs1 = [0.25f32; 8];
        let g = from_arrays(
            &MeshArrays {
                uvs: Some(&QUAD_UVS),
                uvs1: Some(&uvs1),
                colors: Some(&colors),
                color_floats: 3,
                ..quad()
            },
            &jobs(),
        )
        .unwrap();
        assert_eq!(g.format, vertex::UV0 | vertex::UV1 | vertex::COLOR);
        assert_eq!(g.vertex_floats(), 3 + 3 + 2 + 2 + 4);
        assert_eq!(g.indices, QUAD_INDICES);
        // The third vertex: position, normal, both texture coordinates, and a color whose alpha
        // is 1 because the colors came without alpha.
        assert_eq!(
            &g.vertices[2 * 14..3 * 14],
            &[
                1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.25, 0.25, 0.5, 0.5, 0.5, 1.0
            ]
        );
        let base = from_arrays(&quad(), &jobs()).unwrap();
        assert_eq!(base.format, 0);
        assert_eq!(base.vertices.len(), 4 * 6);
    }

    #[test]
    fn a_mesh_without_indices_takes_its_vertices_three_by_three() {
        let positions = [0.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let g = from_arrays(
            &MeshArrays {
                positions: &positions,
                compute_normals: true,
                ..MeshArrays::default()
            },
            &jobs(),
        )
        .unwrap();
        assert_eq!(g.indices, [0, 1, 2]);
        // The triangle winds counter-clockwise seen from +z, so its normal points along +z.
        for v in g.vertices.chunks(6) {
            assert_eq!(&v[3..6], &[0.0, 0.0, 1.0]);
        }
    }

    #[test]
    fn bad_arrays_are_rejected_with_the_array_at_fault() {
        let j = jobs();
        let check = |arrays: MeshArrays<'_>| from_arrays(&arrays, &j).map(|_| ());
        assert_eq!(
            check(MeshArrays {
                positions: &[],
                ..quad()
            }),
            Err(ArraysError::NoVertices)
        );
        assert_eq!(
            check(MeshArrays {
                positions: &QUAD_POSITIONS[..11],
                ..quad()
            }),
            Err(ArraysError::Length(ArrayName::Positions))
        );
        assert_eq!(
            check(MeshArrays {
                uvs: Some(&QUAD_UVS[..6]),
                ..quad()
            }),
            Err(ArraysError::Length(ArrayName::Uvs))
        );
        assert_eq!(
            check(MeshArrays {
                colors: Some(&[1.0; 8]),
                color_floats: 2,
                ..quad()
            }),
            Err(ArraysError::Length(ArrayName::Colors))
        );
        assert_eq!(
            check(MeshArrays {
                indices: Some(&QUAD_INDICES[..5]),
                ..quad()
            }),
            Err(ArraysError::NotTriangles)
        );
        assert_eq!(
            check(MeshArrays {
                indices: None,
                ..quad()
            }),
            Err(ArraysError::NotTriangles)
        );
        assert_eq!(
            check(MeshArrays {
                indices: Some(&[0, 1, 2, 0, 2, 4]),
                ..quad()
            }),
            Err(ArraysError::IndexOutOfRange { at: 5 })
        );
        assert_eq!(
            check(MeshArrays {
                normals: None,
                ..quad()
            }),
            Err(ArraysError::Missing(ArrayName::Normals))
        );
        assert_eq!(
            check(MeshArrays {
                compute_normals: true,
                ..quad()
            }),
            Err(ArraysError::Twice(ArrayName::Normals))
        );
        assert_eq!(
            check(MeshArrays {
                compute_tangents: true,
                ..quad()
            }),
            Err(ArraysError::Missing(ArrayName::Uvs))
        );
        let tangents = [1.0f32; 16];
        assert_eq!(
            check(MeshArrays {
                tangents: Some(&tangents),
                uvs: Some(&QUAD_UVS),
                compute_tangents: true,
                ..quad()
            }),
            Err(ArraysError::Twice(ArrayName::Tangents))
        );
        let mut bad_uvs = QUAD_UVS;
        bad_uvs[5] = f32::NAN;
        assert_eq!(
            check(MeshArrays {
                uvs: Some(&bad_uvs),
                ..quad()
            }),
            Err(ArraysError::NotFinite {
                array: ArrayName::Uvs,
                at: 5
            })
        );
        let mut far = QUAD_POSITIONS;
        far[7] = f32::INFINITY;
        assert_eq!(
            check(MeshArrays {
                positions: &far,
                ..quad()
            }),
            Err(ArraysError::NotFinite {
                array: ArrayName::Positions,
                at: 7
            })
        );
    }

    #[test]
    fn a_quads_tangent_follows_increasing_u_with_positive_handedness() {
        let g = from_arrays(
            &MeshArrays {
                uvs: Some(&QUAD_UVS),
                compute_tangents: true,
                ..quad()
            },
            &jobs(),
        )
        .unwrap();
        assert_eq!(g.format, vertex::UV0 | vertex::TANGENT);
        for v in g.vertices.chunks(12) {
            assert_eq!(&v[8..12], &[1.0, 0.0, 0.0, 1.0]);
        }
        // Mirrored texture coordinates flip the handedness.
        let mirrored = [1.0f32, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let g = from_arrays(
            &MeshArrays {
                uvs: Some(&mirrored),
                compute_tangents: true,
                ..quad()
            },
            &jobs(),
        )
        .unwrap();
        for v in g.vertices.chunks(12) {
            assert_eq!(&v[8..12], &[-1.0, 0.0, 0.0, -1.0]);
        }
    }
}
