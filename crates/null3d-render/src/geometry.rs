//! Geometry generators with three.js's parameters, defaults and vertex order, so a scene built in
//! both engines draws the same triangles. Each generator follows its three.js class step by step:
//! it computes in 64-bit floats, as JavaScript does, and rounds each value to a 32-bit float at the
//! end, as three.js's `Float32BufferAttribute` does. So the vertices match three.js's bit for bit.
//! Every generator makes vertices of one format: a position, a normal and the first texture
//! coordinates.

use std::f64::consts::PI;

use null3d_gpu::drawlist::vertex;

/// Mesh data: vertices interleaved in the layout of their vertex format, and triangle indices.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Geometry {
    /// The vertex format: the optional attributes (`vertex::*` bits) each vertex has, and each
    /// attribute's type.
    pub format: u32,
    /// The vertices' bytes, little-endian, as the GPU reads them.
    pub vertices: Vec<u8>,
    pub indices: Vec<u32>,
}

impl Geometry {
    /// A geometry of a format whose attributes are all floats, from its vertices' floats.
    pub fn from_floats(format: u32, floats: &[f32], indices: Vec<u32>) -> Self {
        Self {
            format,
            vertices: floats
                .iter()
                .flat_map(|value| value.to_le_bytes())
                .collect(),
            indices,
        }
    }

    /// Bytes per vertex of the geometry's format.
    pub fn stride(&self) -> usize {
        vertex::stride(self.format) as usize
    }

    pub fn vertex_count(&self) -> usize {
        self.vertices.len() / self.stride()
    }

    /// The values of the attribute at `location` of vertex `v`, as shaders read them, or nothing
    /// when the format lacks it.
    pub fn values(&self, v: usize, location: usize) -> Vec<f32> {
        let (Some(ty), Some(offset)) = (
            vertex::type_of(self.format, location),
            vertex::offset(self.format, location),
        ) else {
            return Vec::new();
        };
        let size = ty.bytes() as usize;
        let start = v * self.stride() + offset as usize;
        (0..vertex::ATTRIBUTES[location].components as usize)
            .map(|c| ty.decode(&self.vertices[start + c * size..]))
            .collect()
    }

    /// The values of the attribute at `location` of every vertex in turn, as shaders read them.
    pub fn attribute(&self, location: usize) -> Vec<f32> {
        (0..self.vertex_count())
            .flat_map(|v| self.values(v, location))
            .collect()
    }

    /// The position of vertex `v`, as shaders read it.
    pub fn position(&self, v: usize) -> [f32; 3] {
        let offset = v * self.stride();
        let ty = vertex::type_of(self.format, vertex::POSITION).unwrap_or(vertex::Type::F32);
        let size = ty.bytes() as usize;
        [0, 1, 2].map(|c| ty.decode(&self.vertices[offset + c * size..]))
    }
}

/// The vertex format of every generator's meshes: a position, a normal and texture coordinates.
pub const SHAPE_FORMAT: u32 = vertex::UV0;
/// Bytes per vertex of [`SHAPE_FORMAT`].
const STRIDE: usize = vertex::stride(SHAPE_FORMAT) as usize;

/// The generators, by the codes that the engine's TypeScript passes. A cone is a cylinder whose top
/// radius is 0, as in three.js.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Shape {
    Box = 0,
    Sphere = 1,
    Plane = 2,
    Cylinder = 3,
    Torus = 4,
    Capsule = 5,
    Circle = 6,
    Ring = 7,
}

impl Shape {
    /// Every shape, in the order of its code.
    pub const ALL: [Shape; 8] = [
        Shape::Box,
        Shape::Sphere,
        Shape::Plane,
        Shape::Cylinder,
        Shape::Torus,
        Shape::Capsule,
        Shape::Circle,
        Shape::Ring,
    ];

    /// The shape with this code, or `None` for a code that names no shape.
    pub fn from_code(code: u32) -> Option<Shape> {
        Shape::ALL.get(code as usize).copied()
    }
}

/// A mesh too large for the memory the engine can get: its vertices and indices need `bytes`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OutOfMemory {
    pub bytes: u64,
}

/// A generator's mesh, from three.js's constructor arguments in their order, with booleans as 1 or
/// 0. The generator reads the arguments it has and ignores the rest. Segment counts round down, and
/// each generator raises a count below its least.
pub fn generate(shape: Shape, p: [f64; 8]) -> Result<Geometry, OutOfMemory> {
    // A conversion to an integer rounds toward zero, and gives 0 for a negative number.
    let count = |k: usize| p[k] as u32;
    match shape {
        Shape::Box => box_geometry(p[0], p[1], p[2], [count(3), count(4), count(5)]),
        Shape::Sphere => sphere_geometry(p[0], [count(1), count(2)], (p[3], p[4]), (p[5], p[6])),
        Shape::Plane => plane_geometry(p[0], p[1], [count(2), count(3)]),
        Shape::Cylinder => cylinder_geometry(
            p[0],
            p[1],
            p[2],
            [count(3), count(4)],
            p[5] != 0.0,
            (p[6], p[7]),
        ),
        Shape::Torus => torus_geometry(p[0], p[1], [count(2), count(3)], p[4], (p[5], p[6])),
        Shape::Capsule => capsule_geometry(p[0], p[1], [count(2), count(3), count(4)]),
        Shape::Circle => circle_geometry(p[0], count(1), (p[2], p[3])),
        Shape::Ring => ring_geometry(p[0], p[1], [count(2), count(3)], (p[4], p[5])),
    }
}

/// A box like three.js's `BoxGeometry(width, height, depth, widthSegments, heightSegments,
/// depthSegments)`: six grids built in the same order, with the same winding. Each segment count
/// is at least 1.
pub fn box_geometry(
    width: f64,
    height: f64,
    depth: f64,
    segments: [u32; 3],
) -> Result<Geometry, OutOfMemory> {
    let [ws, hs, ds] = segments.map(|s| count(s, 1));
    let sides = [
        grid_counts(ds, hs),
        grid_counts(ws, ds),
        grid_counts(ws, hs),
    ];
    let total = |pick: fn(&(u64, u64)) -> u64| 2 * sides.iter().map(pick).sum::<u64>();
    let mut b = Builder::new(total(|side| side.0), total(|side| side.1))?;
    // Axes are indices into [x, y, z]. A side's normal points to +1 or -1 on its third axis, as
    // the sign of its depth says.
    let side = |depth: f64| if depth > 0.0 { 1.0 } else { -1.0 };
    let grids = [
        ((2, 1, 0), (-1.0, -1.0), (depth, height, width), (ds, hs)), // +x
        ((2, 1, 0), (1.0, -1.0), (depth, height, -width), (ds, hs)), // -x
        ((0, 2, 1), (1.0, 1.0), (width, depth, height), (ws, ds)),   // +y
        ((0, 2, 1), (1.0, -1.0), (width, depth, -height), (ws, ds)), // -y
        ((0, 1, 2), (1.0, -1.0), (width, height, depth), (ws, hs)),  // +z
        ((0, 1, 2), (-1.0, -1.0), (width, height, -depth), (ws, hs)), // -z
    ];
    for (axes, directions, size, grid) in grids {
        b.grid(axes, directions, size, side(size.2), grid);
    }
    Ok(b.finish())
}

/// A plane like three.js's `PlaneGeometry(width, height, widthSegments, heightSegments)`: in the XY
/// plane, facing +z. Each segment count is at least 1.
pub fn plane_geometry(
    width: f64,
    height: f64,
    segments: [u32; 2],
) -> Result<Geometry, OutOfMemory> {
    let [ws, hs] = segments.map(|s| count(s, 1));
    let (vertices, indices) = grid_counts(ws, hs);
    let mut b = Builder::new(vertices, indices)?;
    b.grid((0, 1, 2), (1.0, -1.0), (width, height, 0.0), 1.0, (ws, hs));
    Ok(b.finish())
}

/// A sphere like three.js's `SphereGeometry(radius, widthSegments, heightSegments, phiStart,
/// phiLength, thetaStart, thetaLength)`, with its poles on the Y axis. `phi` and `theta` are each a
/// start angle and a length, in radians. At a pole, three.js shifts the texture coordinates by half
/// a segment and leaves out the band's degenerate triangles. At least 3 segments go around and 2
/// from pole to pole.
pub fn sphere_geometry(
    radius: f64,
    segments: [u32; 2],
    (phi_start, phi_length): (f64, f64),
    (theta_start, theta_length): (f64, f64),
) -> Result<Geometry, OutOfMemory> {
    let (ws, hs) = (count(segments[0], 3), count(segments[1], 2));
    let theta_end = (theta_start + theta_length).min(PI);
    let (vertices, indices) = grid_counts(ws, hs);
    let mut b = Builder::new(vertices, indices)?;
    for iy in 0..=hs {
        let v = f64::from(iy) / f64::from(hs);
        let theta = theta_start + v * theta_length;
        let y = radius * theta.cos();
        let ring_radius = (radius * radius - y * y).sqrt();
        let u_offset = if iy == 0 && theta_start == 0.0 {
            0.5 / f64::from(ws)
        } else if iy == hs && theta_end == PI {
            -0.5 / f64::from(ws)
        } else {
            0.0
        };
        for ix in 0..=ws {
            let u = f64::from(ix) / f64::from(ws);
            let phi = phi_start + u * phi_length;
            let position = [-ring_radius * phi.cos(), y, ring_radius * phi.sin()];
            b.vertex(position, normalize(position), [u + u_offset, 1.0 - v]);
        }
    }
    let row = ws + 1;
    for iy in 0..hs {
        for ix in 0..ws {
            let (a, bb) = (iy * row + ix + 1, iy * row + ix);
            let (c, d) = ((iy + 1) * row + ix, (iy + 1) * row + ix + 1);
            if iy != 0 || theta_start > 0.0 {
                b.triangle(a, bb, d);
            }
            if iy != hs - 1 || theta_end < PI {
                b.triangle(bb, c, d);
            }
        }
    }
    Ok(b.finish())
}

/// A cylinder like three.js's `CylinderGeometry(radiusTop, radiusBottom, height, radialSegments,
/// heightSegments, openEnded, thetaStart, thetaLength)`, standing on the Y axis: the sides, then
/// the top cap and the bottom cap, which a radius of 0 or `open_ended` leaves out. The sides start
/// at `theta.0` radians from +z. Each segment count is at least 1.
pub fn cylinder_geometry(
    radius_top: f64,
    radius_bottom: f64,
    height: f64,
    segments: [u32; 2],
    open_ended: bool,
    theta: (f64, f64),
) -> Result<Geometry, OutOfMemory> {
    let [radial, rows] = segments.map(|s| count(s, 1));
    let caps = [(true, radius_top), (false, radius_bottom)]
        .map(|(top, radius)| (!open_ended && radius > 0.0).then_some((top, radius)));
    let cap_count = caps.iter().flatten().count() as u64;
    let (sides, side_indices) = grid_counts(radial, rows);
    let mut b = Builder::new(
        sides + cap_count * (2 * u64::from(radial) + 1),
        side_indices + cap_count * 3 * u64::from(radial),
    )?;
    let half_height = height / 2.0;
    let (theta_start, theta_length) = theta;
    let slope = (radius_bottom - radius_top) / height;
    for y in 0..=rows {
        let v = f64::from(y) / f64::from(rows);
        let radius = v * (radius_bottom - radius_top) + radius_top;
        for x in 0..=radial {
            let u = f64::from(x) / f64::from(radial);
            let angle = u * theta_length + theta_start;
            let (sin, cos) = (angle.sin(), angle.cos());
            b.vertex(
                [radius * sin, -v * height + half_height, radius * cos],
                normalize([sin, slope, cos]),
                [u, 1.0 - v],
            );
        }
    }
    let row = radial + 1;
    for x in 0..radial {
        for y in 0..rows {
            let (a, bb) = (y * row + x, (y + 1) * row + x);
            let (c, d) = ((y + 1) * row + x + 1, y * row + x + 1);
            if radius_top > 0.0 || y != 0 {
                b.triangle(a, bb, d);
            }
            if radius_bottom > 0.0 || y != rows - 1 {
                b.triangle(bb, c, d);
            }
        }
    }
    for (top, radius) in caps.into_iter().flatten() {
        b.cap(
            radius,
            if top { 1.0 } else { -1.0 },
            half_height,
            radial,
            theta,
        );
    }
    Ok(b.finish())
}

/// A torus like three.js's `TorusGeometry(radius, tube, radialSegments, tubularSegments, arc,
/// thetaStart, thetaLength)`, around the Z axis. `arc` is how far the torus goes around its
/// center, and `theta` is where the tube starts around its own center and how far it goes, all in
/// radians. Each segment count is at least 1.
pub fn torus_geometry(
    radius: f64,
    tube: f64,
    segments: [u32; 2],
    arc: f64,
    (theta_start, theta_length): (f64, f64),
) -> Result<Geometry, OutOfMemory> {
    let [radial, tubular] = segments.map(|s| count(s, 1));
    let (vertices, indices) = grid_counts(tubular, radial);
    let mut b = Builder::new(vertices, indices)?;
    for j in 0..=radial {
        let v = theta_start + (f64::from(j) / f64::from(radial)) * theta_length;
        for i in 0..=tubular {
            let u = f64::from(i) / f64::from(tubular) * arc;
            let position = [
                (radius + tube * v.cos()) * u.cos(),
                (radius + tube * v.cos()) * u.sin(),
                tube * v.sin(),
            ];
            // The normal points away from the center of the tube's circle.
            let center = [radius * u.cos(), radius * u.sin()];
            let away = [
                position[0] - center[0],
                position[1] - center[1],
                position[2],
            ];
            let uv = [
                f64::from(i) / f64::from(tubular),
                f64::from(j) / f64::from(radial),
            ];
            b.vertex(position, normalize(away), uv);
        }
    }
    let row = tubular + 1;
    for j in 1..=radial {
        for i in 1..=tubular {
            let (a, bb) = (row * j + i - 1, row * (j - 1) + i - 1);
            let (c, d) = (row * (j - 1) + i, row * j + i);
            b.triangle(a, bb, d);
            b.triangle(bb, c, d);
        }
    }
    Ok(b.finish())
}

/// A capsule like three.js's `CapsuleGeometry(radius, height, capSegments, radialSegments,
/// heightSegments)`, standing on the Y axis: a middle part `height` tall, which is never negative,
/// with a half sphere on each end. The texture coordinates run up the capsule's profile. At least 1
/// segment goes along each cap, 3 around the capsule and 1 along the middle part.
pub fn capsule_geometry(
    radius: f64,
    height: f64,
    segments: [u32; 3],
) -> Result<Geometry, OutOfMemory> {
    // JavaScript's `Math.max(0, height)`, which keeps NaN and makes -0 into 0.
    let height = if height > 0.0 || height.is_nan() {
        height
    } else {
        0.0
    };
    let [caps, radial, middle] = [(segments[0], 1), (segments[1], 3), (segments[2], 1)]
        .map(|(segments, least)| count(segments, least));
    let rows = 2 * u64::from(caps) + u64::from(middle);
    let (vertices, indices) = (
        (rows + 1) * (u64::from(radial) + 1),
        rows * u64::from(radial) * 6,
    );
    let mut b = Builder::new(vertices, indices)?;
    // The builder holds every vertex, so the row count fits 32 bits.
    let rows = rows as u32;
    let half_height = height / 2.0;
    let cap_arc = (PI / 2.0) * radius;
    let total_arc = 2.0 * cap_arc + height;
    let row = radial + 1;
    for iy in 0..=rows {
        // The profile's height, radius and normal height, and its length up to this row.
        let (profile_y, profile_radius, normal_y, arc) = if iy <= caps {
            let progress = f64::from(iy) / f64::from(caps);
            let angle = (progress * PI) / 2.0;
            (
                -half_height - radius * angle.cos(),
                radius * angle.sin(),
                -radius * angle.cos(),
                progress * cap_arc,
            )
        } else if iy <= caps + middle {
            let progress = f64::from(iy - caps) / f64::from(middle);
            (
                -half_height + progress * height,
                radius,
                0.0,
                cap_arc + progress * height,
            )
        } else {
            let progress = f64::from(iy - caps - middle) / f64::from(caps);
            let angle = (progress * PI) / 2.0;
            (
                half_height + radius * angle.sin(),
                radius * angle.cos(),
                radius * angle.sin(),
                cap_arc + height + progress * cap_arc,
            )
        };
        let v = clamp_unit(arc / total_arc);
        let u_offset = if iy == 0 {
            0.5 / f64::from(radial)
        } else if iy == rows {
            -0.5 / f64::from(radial)
        } else {
            0.0
        };
        for ix in 0..=radial {
            let u = f64::from(ix) / f64::from(radial);
            let angle = u * PI * 2.0;
            let (x, z) = (-profile_radius * angle.cos(), profile_radius * angle.sin());
            b.vertex(
                [x, profile_y, z],
                normalize([x, normal_y, z]),
                [u + u_offset, v],
            );
        }
        if iy > 0 {
            let previous = (iy - 1) * row;
            for ix in 0..radial {
                let (i1, i2) = (previous + ix, previous + ix + 1);
                let (i3, i4) = (iy * row + ix, iy * row + ix + 1);
                b.triangle(i1, i2, i3);
                b.triangle(i2, i4, i3);
            }
        }
    }
    Ok(b.finish())
}

/// A circle like three.js's `CircleGeometry(radius, segments, thetaStart, thetaLength)`: a fan of
/// triangles in the XY plane around a center vertex, facing +z. `theta` is where the circle starts,
/// from +x, and how far it goes, in radians. At least 3 segments make the circle.
pub fn circle_geometry(
    radius: f64,
    segments: u32,
    (theta_start, theta_length): (f64, f64),
) -> Result<Geometry, OutOfMemory> {
    let segments = count(segments, 3);
    let mut b = Builder::new(u64::from(segments) + 2, 3 * u64::from(segments))?;
    b.vertex([0.0; 3], [0.0, 0.0, 1.0], [0.5, 0.5]);
    for s in 0..=segments {
        let angle = theta_start + f64::from(s) / f64::from(segments) * theta_length;
        b.flat(radius, angle, radius);
    }
    for i in 1..=segments {
        b.triangle(i, i + 1, 0);
    }
    Ok(b.finish())
}

/// A ring like three.js's `RingGeometry(innerRadius, outerRadius, thetaSegments, phiSegments,
/// thetaStart, thetaLength)`: in the XY plane, facing +z, built from the inner edge out. `theta` is
/// where the ring starts, from +x, and how far it goes, in radians. At least 3 segments go around
/// the ring and 1 from its inner edge to its outer edge.
pub fn ring_geometry(
    inner_radius: f64,
    outer_radius: f64,
    segments: [u32; 2],
    (theta_start, theta_length): (f64, f64),
) -> Result<Geometry, OutOfMemory> {
    let (around, across) = (count(segments[0], 3), count(segments[1], 1));
    let (vertices, indices) = grid_counts(around, across);
    let mut b = Builder::new(vertices, indices)?;
    let step = (outer_radius - inner_radius) / f64::from(across);
    // three.js adds the step once per circle, so the radius gathers the same rounding.
    let mut radius = inner_radius;
    for _ in 0..=across {
        for i in 0..=around {
            let angle = theta_start + f64::from(i) / f64::from(around) * theta_length;
            b.flat(radius, angle, outer_radius);
        }
        radius += step;
    }
    b.quads(0, around, across);
    Ok(b.finish())
}

/// The most segments of one count. A mesh with more has over 2^29 vertices, more than engine
/// memory holds, and with fewer every vertex and index count fits 64 bits.
const MOST_SEGMENTS: u32 = 1 << 29;

/// A segment count raised to `least` and lowered to [`MOST_SEGMENTS`].
fn count(segments: u32, least: u32) -> u32 {
    segments.clamp(least, MOST_SEGMENTS)
}

/// The vertices and indices of a grid of `columns` by `rows` quads.
fn grid_counts(columns: u32, rows: u32) -> (u64, u64) {
    let (columns, rows) = (u64::from(columns), u64::from(rows));
    ((columns + 1) * (rows + 1), columns * rows * 6)
}

/// Scales a vector to length 1 as three.js's `Vector3.normalize` does: it multiplies by the inverse
/// of the length, and leaves a vector of length 0 as it is.
fn normalize([x, y, z]: [f64; 3]) -> [f64; 3] {
    let length = (x * x + y * y + z * z).sqrt();
    // JavaScript's `length || 1`, which also takes 1 for NaN.
    let inverse = 1.0
        / if length == 0.0 || length.is_nan() {
            1.0
        } else {
            length
        };
    [x * inverse, y * inverse, z * inverse]
}

/// JavaScript's `Math.max(0, Math.min(1, x))`, which keeps NaN and makes -0 into 0.
fn clamp_unit(x: f64) -> f64 {
    if x.is_nan() || (x > 0.0 && x <= 1.0) {
        x
    } else if x > 1.0 {
        1.0
    } else {
        0.0
    }
}

/// A generator's mesh as it grows: vertices in [`SHAPE_FORMAT`], and indices.
struct Builder(Geometry);

impl Builder {
    /// Room for `vertices` vertices and `indices` indices, or the bytes they need when the memory
    /// for them cannot be had. Indices are 32-bit, so they reach at most `u32::MAX` vertices.
    #[inline(never)]
    fn new(vertices: u64, indices: u64) -> Result<Self, OutOfMemory> {
        // Below 2^61 vertices and 2^63 indices, as the segment counts' limit keeps them.
        let bytes = vertices * STRIDE as u64;
        let out_of_memory = OutOfMemory {
            bytes: bytes.saturating_add(indices.saturating_mul(4)),
        };
        let mut g = Geometry {
            format: SHAPE_FORMAT,
            ..Geometry::default()
        };
        let reserved = vertices <= u64::from(u32::MAX)
            && usize::try_from(bytes).is_ok_and(|n| g.vertices.try_reserve_exact(n).is_ok())
            && usize::try_from(indices).is_ok_and(|n| g.indices.try_reserve_exact(n).is_ok());
        if reserved {
            Ok(Self(g))
        } else {
            Err(out_of_memory)
        }
    }

    fn finish(self) -> Geometry {
        self.0
    }

    /// The index of the next vertex.
    fn next(&self) -> u32 {
        (self.0.vertices.len() / STRIDE) as u32
    }

    /// Adds a vertex, with each value rounded to a 32-bit float. Generators call it from many
    /// places, so one copy of it serves them all.
    #[inline(never)]
    fn vertex(&mut self, [x, y, z]: [f64; 3], [nx, ny, nz]: [f64; 3], [u, v]: [f64; 2]) {
        for value in [x, y, z, nx, ny, nz, u, v] {
            self.0
                .vertices
                .extend_from_slice(&(value as f32).to_le_bytes());
        }
    }

    #[inline(never)]
    fn triangle(&mut self, a: u32, b: u32, c: u32) {
        self.0.indices.extend_from_slice(&[a, b, c]);
    }

    /// A grid of `grid_x` by `grid_y` quads, as three.js's `BoxGeometry` builds each side: the
    /// vertices row by row, then two triangles per quad. `u`, `v` and `w` are the axes (0 for x, 1
    /// for y, 2 for z) of the grid's width, its height and its normal, and `u_dir` and `v_dir` flip
    /// the first two. The grid sits at half of `depth` on its normal's axis.
    fn grid(
        &mut self,
        (u, v, w): (usize, usize, usize),
        (u_dir, v_dir): (f64, f64),
        (width, height, depth): (f64, f64, f64),
        normal: f64,
        (grid_x, grid_y): (u32, u32),
    ) {
        let first = self.next();
        let (segment_width, segment_height) =
            (width / f64::from(grid_x), height / f64::from(grid_y));
        for iy in 0..=grid_y {
            let y = f64::from(iy) * segment_height - height / 2.0;
            for ix in 0..=grid_x {
                let x = f64::from(ix) * segment_width - width / 2.0;
                let mut position = [0.0; 3];
                position[u] = x * u_dir;
                position[v] = y * v_dir;
                position[w] = depth / 2.0;
                let mut n = [0.0; 3];
                n[w] = normal;
                let uv = [
                    f64::from(ix) / f64::from(grid_x),
                    1.0 - f64::from(iy) / f64::from(grid_y),
                ];
                self.vertex(position, n, uv);
            }
        }
        self.quads(first, grid_x, grid_y);
    }

    /// Two triangles for each quad of a grid of `columns` by `rows` quads whose vertices start at
    /// `first`, row by row, in the order and winding of three.js's `BoxGeometry` and
    /// `RingGeometry`.
    fn quads(&mut self, first: u32, columns: u32, rows: u32) {
        let row = columns + 1;
        for iy in 0..rows {
            for ix in 0..columns {
                let a = first + row * iy + ix;
                self.triangle(a, a + row, a + 1);
                self.triangle(a + row, a + row + 1, a + 1);
            }
        }
    }

    /// A vertex of a circle or a ring in the XY plane, facing +z: at `radius` from the center and
    /// at `angle` radians from +x. Its texture coordinates map a disc of radius `span` onto 0 to 1.
    fn flat(&mut self, radius: f64, angle: f64, span: f64) {
        let (x, y) = (radius * angle.cos(), radius * angle.sin());
        let uv = [(x / span + 1.0) / 2.0, (y / span + 1.0) / 2.0];
        self.vertex([x, y, 0.0], [0.0, 0.0, 1.0], uv);
    }

    /// A cylinder's cap, as three.js builds it: one center vertex per segment, so each triangle has
    /// its own texture coordinates at the center, then the edge. `sign` is 1 for the top cap and -1
    /// for the bottom one, which winds the other way.
    fn cap(
        &mut self,
        radius: f64,
        sign: f64,
        half_height: f64,
        radial: u32,
        (theta_start, theta_length): (f64, f64),
    ) {
        let center = self.next();
        for _ in 0..radial {
            self.vertex([0.0, half_height * sign, 0.0], [0.0, sign, 0.0], [0.5, 0.5]);
        }
        let edge = self.next();
        for x in 0..=radial {
            let u = f64::from(x) / f64::from(radial);
            let angle = u * theta_length + theta_start;
            let (cos, sin) = (angle.cos(), angle.sin());
            self.vertex(
                [radius * sin, half_height * sign, radius * cos],
                [0.0, sign, 0.0],
                [cos * 0.5 + 0.5, sin * 0.5 * sign + 0.5],
            );
        }
        for x in 0..radial {
            let (c, i) = (center + x, edge + x);
            if sign > 0.0 {
                self.triangle(i, i + 1, c);
            } else {
                self.triangle(i + 1, i, c);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::f64::consts::TAU;

    use super::*;

    /// Each generator with arguments that reach its special cases: partial arcs, open ends, a
    /// cone's point, and zero heights.
    fn every_shape() -> Vec<(&'static str, Geometry)> {
        let whole = (0.0, TAU);
        [
            ("box", box_geometry(1.0, 2.0, 3.0, [2, 3, 4])),
            ("plane", plane_geometry(2.0, 1.0, [3, 2])),
            ("sphere", sphere_geometry(1.0, [8, 6], whole, (0.0, PI))),
            (
                "sphere part",
                sphere_geometry(0.8, [7, 5], (0.3, 4.0), (0.4, 1.9)),
            ),
            (
                "cylinder",
                cylinder_geometry(0.7, 1.2, 2.0, [9, 3], false, whole),
            ),
            (
                "cone",
                cylinder_geometry(0.0, 1.0, 1.5, [8, 2], false, whole),
            ),
            (
                "open cylinder",
                cylinder_geometry(1.0, 1.0, 1.0, [6, 1], true, (0.2, 3.0)),
            ),
            ("torus", torus_geometry(1.0, 0.4, [6, 12], TAU, whole)),
            ("capsule", capsule_geometry(0.5, 1.5, [3, 7, 2])),
            ("flat capsule", capsule_geometry(0.5, -1.0, [2, 5, 1])),
            ("circle", circle_geometry(1.5, 12, whole)),
            ("ring", ring_geometry(0.4, 1.3, [10, 3], (0.5, 4.0))),
        ]
        .into_iter()
        .map(|(name, g)| (name, g.unwrap()))
        .collect()
    }

    /// `count` floats of vertex `i`, from its float `first` on.
    fn attribute(g: &Geometry, i: u32, first: usize, count: usize) -> Vec<f32> {
        let at = i as usize * STRIDE + first * 4;
        g.vertices[at..at + count * 4]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|&bytes| f32::from_le_bytes(bytes))
            .collect()
    }

    #[test]
    fn every_front_face_winds_counter_clockwise_around_its_normals() {
        for (name, g) in every_shape() {
            assert_eq!(g.format, SHAPE_FORMAT);
            assert_eq!(g.vertices.len() % STRIDE, 0);
            assert!(g.indices.iter().all(|&i| (i as usize) < g.vertex_count()));
            for tri in g.indices.chunks(3) {
                let p = |k: usize| {
                    let v = attribute(&g, tri[k], 0, 3);
                    [v[0], v[1], v[2]].map(f64::from)
                };
                let (a, b, c) = (p(0), p(1), p(2));
                let e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
                let e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
                let face = [
                    e1[1] * e2[2] - e1[2] * e2[1],
                    e1[2] * e2[0] - e1[0] * e2[2],
                    e1[0] * e2[1] - e1[1] * e2[0],
                ];
                let area = face.iter().map(|f| f * f).sum::<f64>().sqrt();
                if area < 1e-9 {
                    continue;
                }
                let normals: f64 = tri
                    .iter()
                    .map(|&i| {
                        let n = attribute(&g, i, 3, 3);
                        (0..3).map(|k| f64::from(n[k]) * face[k]).sum::<f64>()
                    })
                    .sum();
                assert!(
                    normals > 0.0,
                    "{name}: a triangle faces away from its normals"
                );
            }
        }
    }

    #[test]
    fn normals_have_length_1_and_texture_coordinates_stay_in_0_to_1() {
        // At a pole, three.js moves u by half a segment, and a sphere has at least 3 segments.
        let (u_range, v_range) = (-1.0 / 6.0..=1.0 + 1.0 / 6.0, -1e-6..=1.0 + 1e-6);
        for (name, g) in every_shape() {
            for i in 0..g.vertex_count() as u32 {
                let n = attribute(&g, i, 3, 3);
                let length = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
                assert!(
                    (length - 1.0).abs() < 1e-6,
                    "{name}: normal of length {length}"
                );
                let uv = attribute(&g, i, 6, 2);
                assert!(
                    u_range.contains(&uv[0]) && v_range.contains(&uv[1]),
                    "{name}: texture coordinates {uv:?}"
                );
            }
        }
    }

    #[test]
    fn counts_match_three_js() {
        let whole = (0.0, TAU);
        let counts = |g: Result<Geometry, OutOfMemory>| {
            let g = g.unwrap();
            (g.vertex_count(), g.indices.len())
        };
        assert_eq!(counts(box_geometry(1.0, 1.0, 1.0, [1, 1, 1])), (24, 36));
        assert_eq!(counts(plane_geometry(1.0, 1.0, [1, 1])), (4, 6));
        // Each band has two triangles per segment, except one at each pole.
        assert_eq!(
            counts(sphere_geometry(1.0, [32, 16], whole, (0.0, PI))),
            (33 * 17, (32 * 16 * 2 - 32 * 2) * 3)
        );
        // The sides, then a center vertex per segment and the edge for each cap.
        let cylinder = cylinder_geometry(1.0, 1.0, 1.0, [32, 1], false, whole);
        assert_eq!(
            counts(cylinder),
            (33 * 2 + 2 * (32 + 33), (32 * 2 + 2 * 32) * 3)
        );
        let cone = cylinder_geometry(0.0, 1.0, 1.0, [32, 1], false, whole);
        assert_eq!(counts(cone), (33 * 2 + 32 + 33, (32 + 32) * 3));
        assert_eq!(
            counts(torus_geometry(1.0, 0.4, [12, 48], TAU, whole)),
            (13 * 49, 12 * 48 * 6)
        );
        assert_eq!(
            counts(capsule_geometry(1.0, 1.0, [4, 8, 1])),
            (10 * 9, 9 * 8 * 6)
        );
        assert_eq!(counts(circle_geometry(1.0, 32, whole)), (34, 32 * 3));
        assert_eq!(
            counts(ring_geometry(0.5, 1.0, [32, 1], whole)),
            (66, 32 * 6)
        );
    }

    #[test]
    fn segment_counts_below_the_least_rise_to_it() {
        let whole = (0.0, TAU);
        assert_eq!(
            box_geometry(1.0, 1.0, 1.0, [0, 0, 0]),
            box_geometry(1.0, 1.0, 1.0, [1, 1, 1])
        );
        assert_eq!(
            sphere_geometry(1.0, [1, 0], whole, (0.0, PI)),
            sphere_geometry(1.0, [3, 2], whole, (0.0, PI))
        );
        assert_eq!(
            circle_geometry(1.0, 0, whole),
            circle_geometry(1.0, 3, whole)
        );
        assert_eq!(
            capsule_geometry(1.0, 1.0, [0, 0, 0]),
            capsule_geometry(1.0, 1.0, [1, 3, 1])
        );
        // The engine's TypeScript passes numbers: they round toward zero, and negative ones give 0.
        let args = [1.0, 2.9, 1.2, 0.0, TAU, 0.0, PI, 0.0];
        assert_eq!(
            generate(Shape::Sphere, args),
            sphere_geometry(1.0, [3, 2], whole, (0.0, PI))
        );
        let args = [1.0, 1.0, 1.0, -4.0, 1e12, 7.5, 0.0, 0.0];
        assert!(matches!(
            generate(Shape::Box, args),
            Err(OutOfMemory { .. })
        ));
    }

    #[test]
    fn a_mesh_too_large_for_memory_is_refused_with_its_size() {
        let OutOfMemory { bytes } = plane_geometry(1.0, 1.0, [u32::MAX, u32::MAX]).unwrap_err();
        let side = u64::from(MOST_SEGMENTS);
        assert_eq!(bytes, ((side + 1) * (side + 1) * 8 + side * side * 6) * 4);
        let too_many = torus_geometry(1.0, 0.4, [70_000, 70_000], TAU, (0.0, TAU));
        assert!(too_many.is_err());
    }

    #[test]
    fn shape_codes_name_each_shape_in_order() {
        for (code, shape) in Shape::ALL.iter().enumerate() {
            assert_eq!(*shape as u32, code as u32);
            assert_eq!(Shape::from_code(code as u32), Some(*shape));
        }
        assert_eq!(Shape::from_code(Shape::ALL.len() as u32), None);
    }

    #[test]
    fn javascript_rounding_rules_hold() {
        assert_eq!(normalize([0.0, 0.0, 0.0]), [0.0, 0.0, 0.0]);
        assert_eq!(
            normalize([3.0, 0.0, 4.0]),
            [3.0 * (1.0 / 5.0), 0.0, 4.0 * (1.0 / 5.0)]
        );
        assert_eq!(clamp_unit(-0.0).to_bits(), 0.0f64.to_bits());
        assert_eq!(clamp_unit(1.5), 1.0);
        assert_eq!(clamp_unit(-2.0), 0.0);
        assert!(clamp_unit(f64::NAN).is_nan());
    }
}
