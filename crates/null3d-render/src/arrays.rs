//! Meshes from arrays, as `geometry.fromArrays` passes them. The arrays are checked, normals and
//! tangents are computed where asked, as three.js's `computeVertexNormals` and `computeTangents`
//! compute them, and every attribute is interleaved into the mesh's vertex format.
//!
//! Each array keeps the type it came in: 32-bit floats, or 8-bit and 16-bit integers, normalized
//! or plain, as glTF's `KHR_mesh_quantization` allows for its attribute. The vertex format records
//! each attribute's type, and the vertices hold the arrays' own bytes, so integer arrays stay small
//! on the GPU. Computed normals and tangents are floats, from the values that shaders read.
//!
//! Normals and tangents are computed on the job workers in two parallel steps: one value per
//! triangle, then for each vertex the sum of the values of its triangles, in triangle order. Both
//! the order and the arithmetic are three.js's, so the results match three.js's bit for bit.
//!
//! Every buffer whose size follows the mesh is reserved fallibly, so a mesh too large for the
//! engine's memory fails with [`ArraysError::OutOfMemory`] instead of stopping the engine.

use std::borrow::Cow;

use null3d_core::jobs::JobSystem;
use null3d_core::shared::SharedMut;
use null3d_gpu::drawlist::vertex::{self, ATTRIBUTES, Type};

use crate::geometry::Geometry;

/// Triangles or vertices in one chunk of a parallel step.
const CHUNK: u32 = 4096;

/// The values of one array, in the type of number they came in.
#[derive(Clone, Copy, Debug)]
pub enum Data<'a> {
    F32(&'a [f32]),
    I8(&'a [i8]),
    U8(&'a [u8]),
    I16(&'a [i16]),
    U16(&'a [u16]),
}

/// One array of a mesh: its values, and for integers whether they are normalized, so that they
/// read as fractions, or plain, so that they read as whole numbers.
#[derive(Clone, Copy, Debug)]
pub struct Values<'a> {
    pub data: Data<'a>,
    pub normalized: bool,
}

impl Default for Values<'_> {
    fn default() -> Self {
        Values::f32(&[])
    }
}

impl<'a> From<&'a [f32]> for Values<'a> {
    fn from(values: &'a [f32]) -> Self {
        Values::f32(values)
    }
}

impl<'a, const N: usize> From<&'a [f32; N]> for Values<'a> {
    fn from(values: &'a [f32; N]) -> Self {
        Values::f32(values)
    }
}

impl<'a> Values<'a> {
    /// Floats.
    pub const fn f32(values: &'a [f32]) -> Self {
        Self {
            data: Data::F32(values),
            normalized: false,
        }
    }

    /// Integers, normalized or plain.
    pub const fn integers(data: Data<'a>, normalized: bool) -> Self {
        Self { data, normalized }
    }

    /// The vertex attribute type of the values.
    pub const fn ty(&self) -> Type {
        match (self.data, self.normalized) {
            (Data::F32(_), _) => Type::F32,
            (Data::I8(_), true) => Type::Snorm8,
            (Data::I8(_), false) => Type::Sint8,
            (Data::U8(_), true) => Type::Unorm8,
            (Data::U8(_), false) => Type::Uint8,
            (Data::I16(_), true) => Type::Snorm16,
            (Data::I16(_), false) => Type::Sint16,
            (Data::U16(_), true) => Type::Unorm16,
            (Data::U16(_), false) => Type::Uint16,
        }
    }

    pub const fn len(&self) -> usize {
        match self.data {
            Data::F32(values) => values.len(),
            Data::I8(values) => values.len(),
            Data::U8(values) => values.len(),
            Data::I16(values) => values.len(),
            Data::U16(values) => values.len(),
        }
    }

    pub const fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The place of the first value that is not a finite number. Only floats can hold one.
    fn first_not_finite(&self) -> Option<usize> {
        match self.data {
            Data::F32(values) => values.iter().position(|value| !value.is_finite()),
            _ => None,
        }
    }

    /// Value `i` as shaders read it.
    fn get(&self, i: usize) -> f32 {
        self.ty().read(match self.data {
            Data::F32(values) => values[i],
            Data::I8(values) => f32::from(values[i]),
            Data::U8(values) => f32::from(values[i]),
            Data::I16(values) => f32::from(values[i]),
            Data::U16(values) => f32::from(values[i]),
        })
    }

    /// The values as shaders read them, as floats: the array itself when it holds floats.
    fn floats(&self) -> Result<Cow<'a, [f32]>, ArraysError> {
        Ok(match self.data {
            Data::F32(values) => Cow::Borrowed(values),
            _ => {
                let mut out = reserved(self.len())?;
                out.extend((0..self.len()).map(|i| self.get(i)));
                Cow::Owned(out)
            }
        })
    }

    /// Appends `count` values from value `first` on to `out`, as little-endian bytes.
    fn write(&self, first: usize, count: usize, out: &mut Vec<u8>) {
        let range = first..first + count;
        match self.data {
            Data::F32(values) => values[range]
                .iter()
                .for_each(|v| out.extend_from_slice(&v.to_le_bytes())),
            Data::I8(values) => out.extend(values[range].iter().map(|v| v.cast_unsigned())),
            Data::U8(values) => out.extend_from_slice(&values[range]),
            Data::I16(values) => values[range]
                .iter()
                .for_each(|v| out.extend_from_slice(&v.to_le_bytes())),
            Data::U16(values) => values[range]
                .iter()
                .for_each(|v| out.extend_from_slice(&v.to_le_bytes())),
        }
    }

    /// Appends the value that reads as 1 in the values' type: the alpha of colors that came
    /// without one.
    fn write_one(&self, out: &mut Vec<u8>) {
        match self.data {
            Data::F32(_) => out.extend_from_slice(&1f32.to_le_bytes()),
            Data::I8(_) => out.push(i8::MAX.cast_unsigned()),
            Data::U8(_) => out.push(u8::MAX),
            Data::I16(_) => out.extend_from_slice(&i16::MAX.to_le_bytes()),
            Data::U16(_) => out.extend_from_slice(&u16::MAX.to_le_bytes()),
        }
    }
}

/// The arrays of one mesh.
#[derive(Clone, Copy, Debug, Default)]
pub struct MeshArrays<'a> {
    /// Three values per vertex.
    pub positions: Values<'a>,
    /// Three values per vertex.
    pub normals: Option<Values<'a>>,
    /// The first texture coordinates: two values per vertex.
    pub uvs: Option<Values<'a>>,
    /// The second texture coordinates: two values per vertex.
    pub uvs1: Option<Values<'a>>,
    /// Linear colors: `color_components` values per vertex, 3 without alpha or 4 with it.
    pub colors: Option<Values<'a>>,
    pub color_components: usize,
    /// Four values per vertex: the tangent and its handedness.
    pub tangents: Option<Values<'a>>,
    /// Four joint indices per vertex, for skinned meshes.
    pub joints: Option<Values<'a>>,
    /// Four joint weights per vertex, for skinned meshes.
    pub weights: Option<Values<'a>>,
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
    Joints = 7,
    Weights = 8,
}

/// Why arrays make no mesh.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArraysError {
    /// The positions hold no vertex.
    NoVertices,
    /// The array's length does not fit the vertex count.
    Length(ArrayName),
    /// The array's type of number is not one that its attribute takes.
    Type(ArrayName),
    /// The indices, or the vertices of a mesh without indices, do not make whole triangles.
    NotTriangles,
    /// The array is given and asked to be computed too.
    Twice(ArrayName),
    /// The array is missing: normals that are not computed, the texture coordinates that
    /// computed tangents need, or the joints or weights that the other of the two needs.
    Missing(ArrayName),
    /// `indices[at]` names no vertex.
    IndexOutOfRange { at: u32 },
    /// Element `at` of the array is not a finite number.
    NotFinite { array: ArrayName, at: u32 },
    /// The engine's memory could not grow by `bytes` for the mesh's buffers.
    OutOfMemory { bytes: u64 },
}

/// An empty vector with room for `len` values, or the bytes it needed when memory cannot grow.
fn reserved<T>(len: usize) -> Result<Vec<T>, ArraysError> {
    let mut v = Vec::new();
    v.try_reserve_exact(len)
        .map_err(|_| ArraysError::OutOfMemory {
            bytes: (len as u64).saturating_mul(size_of::<T>() as u64),
        })?;
    Ok(v)
}

/// A vector of `len` copies of `value`, or the bytes it needed when memory cannot grow.
fn filled<T: Clone>(len: usize, value: T) -> Result<Vec<T>, ArraysError> {
    let mut v = reserved(len)?;
    v.resize(len, value);
    Ok(v)
}

/// Each array of a mesh with the vertex shader location of its attribute and its values per
/// vertex, in the order of the attributes in a vertex.
fn attributes<'a>(
    arrays: &MeshArrays<'a>,
    normals: Option<Values<'a>>,
    tangents: Option<Values<'a>>,
) -> [(ArrayName, Option<Values<'a>>, usize); 8] {
    use ArrayName::*;
    [
        (Positions, Some(arrays.positions), 3),
        (Normals, normals, 3),
        (Uvs, arrays.uvs, 2),
        (Uvs1, arrays.uvs1, 2),
        (Tangents, tangents, 4),
        (Colors, arrays.colors, arrays.color_components),
        (Joints, arrays.joints, 4),
        (Weights, arrays.weights, 4),
    ]
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
            let mut all = reserved(vertices)?;
            all.extend(0..vertices as u32);
            sequence = all;
            &sequence
        }
    };
    let adjacency = if arrays.compute_normals || arrays.compute_tangents {
        Some(Adjacency::new(indices, vertices)?)
    } else {
        None
    };
    let computed_normals;
    let normals = match (arrays.normals, &adjacency) {
        (Some(normals), _) => normals,
        (None, Some(adjacency)) => {
            let indexed = arrays.indices.is_some();
            let positions = arrays.positions.floats()?;
            computed_normals = vertex_normals(&positions, indices, adjacency, indexed, jobs)?;
            Values::f32(&computed_normals)
        }
        (None, None) => return Err(ArraysError::Missing(ArrayName::Normals)),
    };
    let computed_tangents;
    let tangents = match (arrays.tangents, arrays.uvs, &adjacency) {
        (Some(tangents), _, _) => Some(tangents),
        (None, Some(uvs), Some(adjacency)) if arrays.compute_tangents => {
            let (positions, normals, uvs) =
                (arrays.positions.floats()?, normals.floats()?, uvs.floats()?);
            computed_tangents =
                vertex_tangents(&positions, &normals, &uvs, indices, adjacency, jobs)?;
            Some(Values::f32(&computed_tangents))
        }
        _ => None,
    };

    let attributes = attributes(arrays, Some(normals), tangents);
    let mut format = 0;
    for (location, (name, values, _)) in attributes.iter().enumerate() {
        if let Some(values) = values {
            format = vertex::with(format, location, values.ty()).ok_or(ArraysError::Type(*name))?;
        }
    }
    let stride = vertex::stride(format) as usize;
    // The vertices take exactly this room, so the writes below never grow it.
    let mut interleaved = reserved(vertices * stride)?;
    for v in 0..vertices {
        for (location, (_, values, given)) in attributes.iter().enumerate() {
            let Some(values) = values else { continue };
            let start = interleaved.len();
            values.write(v * given, *given, &mut interleaved);
            if *given < ATTRIBUTES[location].components as usize {
                values.write_one(&mut interleaved);
            }
            interleaved.resize(start + ATTRIBUTES[location].size(values.ty()) as usize, 0);
        }
    }
    let mut copy = reserved(indices.len())?;
    copy.extend_from_slice(indices);
    Ok(Geometry {
        format,
        vertices: interleaved,
        indices: copy,
    })
}

/// Checks the arrays' shapes, types and values, and returns the vertex count.
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
    if !matches!(arrays.color_components, 3 | 4) && arrays.colors.is_some() {
        return Err(ArraysError::Length(Colors));
    }
    for (location, (name, array, per_vertex)) in attributes(arrays, arrays.normals, arrays.tangents)
        .into_iter()
        .enumerate()
    {
        let Some(array) = array else { continue };
        if array.len() != vertices * per_vertex {
            return Err(ArraysError::Length(name));
        }
        if ATTRIBUTES[location].field(array.ty()).is_none() {
            return Err(ArraysError::Type(name));
        }
        if let Some(at) = array.first_not_finite() {
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
    match (arrays.joints.is_some(), arrays.weights.is_some()) {
        (true, false) => return Err(ArraysError::Missing(Weights)),
        (false, true) => return Err(ArraysError::Missing(Joints)),
        _ => {}
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
    fn new(indices: &[u32], vertices: usize) -> Result<Self, ArraysError> {
        let mut starts = filled(vertices + 1, 0u32)?;
        for &i in indices {
            starts[i as usize + 1] += 1;
        }
        for v in 0..vertices {
            starts[v + 1] += starts[v];
        }
        let mut next = reserved(starts.len())?;
        next.extend_from_slice(&starts);
        let mut triangles = filled(indices.len(), 0u32)?;
        for (t, triangle) in indices.as_chunks::<3>().0.iter().enumerate() {
            for &i in triangle {
                let at = &mut next[i as usize];
                triangles[*at as usize] = t as u32;
                *at += 1;
            }
        }
        Ok(Self { starts, triangles })
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
) -> Result<Vec<f32>, ArraysError> {
    let triangles = indices.len() / 3;
    let mut faces = filled(triangles, [0f64; 3])?;
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
    let mut normals = filled(vertices * 3, 0f32)?;
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
    Ok(normals)
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
) -> Result<Vec<f32>, ArraysError> {
    let triangles = indices.len() / 3;
    let mut faces: Vec<Option<[f64; 6]>> = filled(triangles, None)?;
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
    let mut tangents = filled(vertices * 4, 0f32)?;
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
    Ok(tangents)
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
            positions: (&QUAD_POSITIONS).into(),
            normals: Some((&QUAD_NORMALS).into()),
            indices: Some(&QUAD_INDICES),
            ..MeshArrays::default()
        }
    }

    fn jobs() -> JobSystem {
        JobSystem::new(0)
    }

    /// The floats of vertex `v` of a geometry whose attributes are all floats.
    fn floats(g: &Geometry, v: usize) -> Vec<f32> {
        g.vertices[v * g.stride()..(v + 1) * g.stride()]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|&b| f32::from_le_bytes(b))
            .collect()
    }

    #[test]
    fn attributes_interleave_in_the_order_of_the_vertex_format() {
        let colors = [0.5f32; 12];
        let uvs1 = [0.25f32; 8];
        let g = from_arrays(
            &MeshArrays {
                uvs: Some((&QUAD_UVS).into()),
                uvs1: Some((&uvs1).into()),
                colors: Some((&colors).into()),
                color_components: 3,
                ..quad()
            },
            &jobs(),
        )
        .unwrap();
        assert_eq!(g.format, vertex::UV0 | vertex::UV1 | vertex::COLOR);
        assert_eq!(g.stride(), (3 + 3 + 2 + 2 + 4) * 4);
        assert_eq!(g.indices, QUAD_INDICES);
        // The third vertex: position, normal, both texture coordinates, and a color whose alpha
        // is 1 because the colors came without alpha.
        assert_eq!(
            floats(&g, 2),
            [
                1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.25, 0.25, 0.5, 0.5, 0.5, 1.0
            ]
        );
        let base = from_arrays(&quad(), &jobs()).unwrap();
        assert_eq!(base.format, 0);
        assert_eq!(base.vertices.len(), 4 * 6 * 4);
    }

    #[test]
    fn integer_arrays_keep_their_bytes_padded_to_whole_words() {
        // Plain 16-bit positions, 8-bit normals, normalized 16-bit texture coordinates, 8-bit
        // tangents, 8-bit colors without alpha, and 8-bit joints with 8-bit weights.
        let positions: [u16; 12] = [0, 0, 0, 1000, 0, 0, 1000, 1000, 0, 0, 1000, 0];
        let normals: [i8; 12] = [0, 0, 127, 0, 0, 127, 0, 0, 127, 0, 0, -127];
        let uvs: [u16; 8] = [0, 0, 65535, 0, 65535, 65535, 0, 65535];
        let tangents: [i8; 16] = [
            127, 0, 0, 127, 127, 0, 0, 127, 127, 0, 0, 127, 127, 0, 0, -127,
        ];
        let colors: [u8; 12] = [255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 8, 7];
        let joints: [u8; 16] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        let weights: [u8; 16] = [255, 0, 0, 0, 128, 127, 0, 0, 85, 85, 85, 0, 64, 64, 64, 63];
        let g = from_arrays(
            &MeshArrays {
                positions: Values::integers(Data::U16(&positions), false),
                normals: Some(Values::integers(Data::I8(&normals), true)),
                uvs: Some(Values::integers(Data::U16(&uvs), true)),
                tangents: Some(Values::integers(Data::I8(&tangents), true)),
                colors: Some(Values::integers(Data::U8(&colors), true)),
                color_components: 3,
                joints: Some(Values::integers(Data::U8(&joints), false)),
                weights: Some(Values::integers(Data::U8(&weights), true)),
                ..quad()
            },
            &jobs(),
        )
        .unwrap();
        let types = [
            Type::Uint16,
            Type::Snorm8,
            Type::Unorm16,
            Type::F32,
            Type::Snorm8,
            Type::Unorm8,
            Type::Uint8,
            Type::Unorm8,
        ];
        for (location, ty) in types.into_iter().enumerate() {
            if location == 3 {
                assert!(!vertex::has(g.format, location));
                continue;
            }
            assert_eq!(vertex::type_of(g.format, location), Some(ty), "{location}");
        }
        // Positions take 8 bytes, the rest 4 each.
        assert_eq!(g.stride(), 8 + 4 * 6);
        let last: &[u8] = &g.vertices[3 * g.stride()..];
        assert_eq!(
            last,
            [
                0, 0, 232, 3, 0, 0, 0, 0, // the position, padded
                0, 0, 129, 0, // the normal, padded
                0, 0, 255, 255, // the texture coordinates
                127, 0, 0, 129, // the tangent
                9, 8, 7, 255, // the color and its alpha
                12, 13, 14, 15, // the joints
                64, 64, 64, 63, // the weights
            ]
        );
        // Positions read as their whole values, and integers that a shader reads as fractions
        // read so here too.
        assert_eq!(g.position(3), [0.0, 1000.0, 0.0]);
        assert_eq!(g.values(3, 1), [0.0, 0.0, -1.0]);
        assert_eq!(g.values(1, 2), [1.0, 0.0]);
        assert_eq!(g.values(3, 7)[3], 63.0 / 255.0);
        assert_eq!(g.values(3, 6), [12.0, 13.0, 14.0, 15.0]);
    }

    #[test]
    fn normals_and_tangents_computed_from_integers_are_floats() {
        let positions: [i16; 12] = [0, 0, 0, 32767, 0, 0, 32767, 32767, 0, 0, 32767, 0];
        let uvs: [u8; 8] = [0, 0, 255, 0, 255, 255, 0, 255];
        let g = from_arrays(
            &MeshArrays {
                positions: Values::integers(Data::I16(&positions), true),
                normals: None,
                uvs: Some(Values::integers(Data::U8(&uvs), true)),
                compute_normals: true,
                compute_tangents: true,
                ..quad()
            },
            &jobs(),
        )
        .unwrap();
        assert_eq!(vertex::type_of(g.format, 0), Some(Type::Snorm16));
        assert_eq!(vertex::type_of(g.format, 1), Some(Type::F32));
        assert_eq!(vertex::type_of(g.format, 4), Some(Type::F32));
        for v in 0..4 {
            assert_eq!(g.values(v, 1), [0.0, 0.0, 1.0]);
            assert_eq!(g.values(v, 4), [1.0, 0.0, 0.0, 1.0]);
        }
        assert_eq!(g.position(2), [1.0, 1.0, 0.0]);
    }

    #[test]
    fn a_mesh_without_indices_takes_its_vertices_three_by_three() {
        let positions = [0.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let g = from_arrays(
            &MeshArrays {
                positions: (&positions).into(),
                compute_normals: true,
                ..MeshArrays::default()
            },
            &jobs(),
        )
        .unwrap();
        assert_eq!(g.indices, [0, 1, 2]);
        // The triangle winds counter-clockwise seen from +z, so its normal points along +z.
        for v in 0..3 {
            assert_eq!(g.values(v, 1), [0.0, 0.0, 1.0]);
        }
    }

    #[test]
    fn bad_arrays_are_rejected_with_the_array_at_fault() {
        let j = jobs();
        let check = |arrays: MeshArrays<'_>| from_arrays(&arrays, &j).map(|_| ());
        assert_eq!(
            check(MeshArrays {
                positions: Values::f32(&[]),
                ..quad()
            }),
            Err(ArraysError::NoVertices)
        );
        assert_eq!(
            check(MeshArrays {
                positions: Values::f32(&QUAD_POSITIONS[..11]),
                ..quad()
            }),
            Err(ArraysError::Length(ArrayName::Positions))
        );
        assert_eq!(
            check(MeshArrays {
                uvs: Some(Values::f32(&QUAD_UVS[..6])),
                ..quad()
            }),
            Err(ArraysError::Length(ArrayName::Uvs))
        );
        assert_eq!(
            check(MeshArrays {
                colors: Some((&[1.0; 8]).into()),
                color_components: 2,
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
                tangents: Some((&tangents).into()),
                uvs: Some((&QUAD_UVS).into()),
                compute_tangents: true,
                ..quad()
            }),
            Err(ArraysError::Twice(ArrayName::Tangents))
        );
        let mut bad_uvs = QUAD_UVS;
        bad_uvs[5] = f32::NAN;
        assert_eq!(
            check(MeshArrays {
                uvs: Some((&bad_uvs).into()),
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
                positions: (&far).into(),
                ..quad()
            }),
            Err(ArraysError::NotFinite {
                array: ArrayName::Positions,
                at: 7
            })
        );
        // Each attribute takes only glTF's types for it, and joints come with weights.
        let bytes = [0u8; 16];
        let plain_normals = [0u8; 12];
        assert_eq!(
            check(MeshArrays {
                normals: Some(Values::integers(Data::U8(&plain_normals), false)),
                ..quad()
            }),
            Err(ArraysError::Type(ArrayName::Normals))
        );
        assert_eq!(
            check(MeshArrays {
                joints: Some((&[0.0f32; 16]).into()),
                weights: Some((&[0.25f32; 16]).into()),
                ..quad()
            }),
            Err(ArraysError::Type(ArrayName::Joints))
        );
        assert_eq!(
            check(MeshArrays {
                joints: Some(Values::integers(Data::U8(&bytes), false)),
                ..quad()
            }),
            Err(ArraysError::Missing(ArrayName::Weights))
        );
        assert_eq!(
            check(MeshArrays {
                weights: Some(Values::integers(Data::U8(&bytes), true)),
                ..quad()
            }),
            Err(ArraysError::Missing(ArrayName::Joints))
        );
    }

    #[test]
    fn a_quads_tangent_follows_increasing_u_with_positive_handedness() {
        let g = from_arrays(
            &MeshArrays {
                uvs: Some((&QUAD_UVS).into()),
                compute_tangents: true,
                ..quad()
            },
            &jobs(),
        )
        .unwrap();
        assert_eq!(g.format, vertex::UV0 | vertex::TANGENT);
        for v in 0..4 {
            assert_eq!(g.values(v, 4), [1.0, 0.0, 0.0, 1.0]);
        }
        // Mirrored texture coordinates flip the handedness.
        let mirrored = [1.0f32, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let g = from_arrays(
            &MeshArrays {
                uvs: Some((&mirrored).into()),
                compute_tangents: true,
                ..quad()
            },
            &jobs(),
        )
        .unwrap();
        for v in 0..4 {
            assert_eq!(g.values(v, 4), [-1.0, 0.0, 0.0, -1.0]);
        }
    }
}
