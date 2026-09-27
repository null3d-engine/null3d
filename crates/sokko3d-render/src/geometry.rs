//! Geometry generators with three.js's parameters and vertex order, so a scene built in both
//! engines draws the same triangles. Vertices are interleaved position and normal (6 floats).

/// Floats per vertex: position (3) and normal (3).
pub const VERTEX_FLOATS: usize = 6;

/// Generated mesh data: interleaved vertices and triangle indices.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Geometry {
    pub vertices: Vec<f32>,
    pub indices: Vec<u32>,
}

impl Geometry {
    pub fn vertex_count(&self) -> usize {
        self.vertices.len() / VERTEX_FLOATS
    }
}

/// A box like three.js's `BoxGeometry(width, height, depth, widthSegments, heightSegments,
/// depthSegments)`: six planes built in the same order, with the same winding.
pub fn box_geometry(width: f32, height: f32, depth: f32, segments: [u32; 3]) -> Geometry {
    let [ws, hs, ds] = segments.map(|s| s.max(1));
    let mut g = Geometry::default();
    // Axes are indices into [x, y, z].
    build_plane(
        &mut g,
        (2, 1, 0),
        (-1.0, -1.0),
        (depth, height, width),
        (ds, hs),
    ); // +x
    build_plane(
        &mut g,
        (2, 1, 0),
        (1.0, -1.0),
        (depth, height, -width),
        (ds, hs),
    ); // -x
    build_plane(
        &mut g,
        (0, 2, 1),
        (1.0, 1.0),
        (width, depth, height),
        (ws, ds),
    ); // +y
    build_plane(
        &mut g,
        (0, 2, 1),
        (1.0, -1.0),
        (width, depth, -height),
        (ws, ds),
    ); // -y
    build_plane(
        &mut g,
        (0, 1, 2),
        (1.0, -1.0),
        (width, height, depth),
        (ws, hs),
    ); // +z
    build_plane(
        &mut g,
        (0, 1, 2),
        (-1.0, -1.0),
        (width, height, -depth),
        (ws, hs),
    ); // -z
    g
}

fn build_plane(
    g: &mut Geometry,
    (u, v, w): (usize, usize, usize),
    (u_dir, v_dir): (f32, f32),
    (width, height, depth): (f32, f32, f32),
    (grid_x, grid_y): (u32, u32),
) {
    let first = g.vertex_count() as u32;
    let segment_width = width / grid_x as f32;
    let segment_height = height / grid_y as f32;
    for iy in 0..=grid_y {
        let y = iy as f32 * segment_height - height / 2.0;
        for ix in 0..=grid_x {
            let x = ix as f32 * segment_width - width / 2.0;
            let mut position = [0.0f32; 3];
            position[u] = x * u_dir;
            position[v] = y * v_dir;
            position[w] = depth / 2.0;
            let mut normal = [0.0f32; 3];
            normal[w] = if depth > 0.0 { 1.0 } else { -1.0 };
            g.vertices.extend_from_slice(&position);
            g.vertices.extend_from_slice(&normal);
        }
    }
    let row = grid_x + 1;
    for iy in 0..grid_y {
        for ix in 0..grid_x {
            let a = first + ix + row * iy;
            let b = first + ix + row * (iy + 1);
            let c = first + ix + 1 + row * (iy + 1);
            let d = first + ix + 1 + row * iy;
            g.indices.extend_from_slice(&[a, b, d, b, c, d]);
        }
    }
}

/// A sphere like three.js's `SphereGeometry(radius, widthSegments, heightSegments)` over the full
/// sphere, with the same vertex order and the poles' degenerate triangles left out.
pub fn sphere_geometry(radius: f32, width_segments: u32, height_segments: u32) -> Geometry {
    let ws = width_segments.max(3);
    let hs = height_segments.max(2);
    let mut g = Geometry::default();
    let mut grid = Vec::with_capacity(hs as usize + 1);
    let mut index = 0u32;
    for iy in 0..=hs {
        let v = iy as f32 / hs as f32;
        let mut row = Vec::with_capacity(ws as usize + 1);
        for ix in 0..=ws {
            let u = ix as f32 / ws as f32;
            let phi = u * std::f32::consts::TAU;
            let theta = v * std::f32::consts::PI;
            let position = [
                -radius * phi.cos() * theta.sin(),
                radius * theta.cos(),
                radius * phi.sin() * theta.sin(),
            ];
            let length =
                (position[0] * position[0] + position[1] * position[1] + position[2] * position[2])
                    .sqrt();
            let normal = if length > 0.0 {
                position.map(|c| c / length)
            } else {
                [0.0, 1.0, 0.0]
            };
            g.vertices.extend_from_slice(&position);
            g.vertices.extend_from_slice(&normal);
            row.push(index);
            index += 1;
        }
        grid.push(row);
    }
    for iy in 0..hs as usize {
        for ix in 0..ws as usize {
            let a = grid[iy][ix + 1];
            let b = grid[iy][ix];
            let c = grid[iy + 1][ix];
            let d = grid[iy + 1][ix + 1];
            if iy != 0 {
                g.indices.extend_from_slice(&[a, b, d]);
            }
            if iy != hs as usize - 1 {
                g.indices.extend_from_slice(&[b, c, d]);
            }
        }
    }
    g
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_box_matches_three_js_counts_and_faces() {
        let g = box_geometry(0.6, 0.6, 0.6, [1, 1, 1]);
        assert_eq!((g.vertex_count(), g.indices.len()), (24, 36));
        // The first face is +x: every vertex sits at x = half the width, with normal +x.
        for vertex in g.vertices.chunks(VERTEX_FLOATS).take(4) {
            assert!((vertex[0] - 0.3).abs() < 1e-6);
            assert_eq!(&vertex[3..6], &[1.0, 0.0, 0.0]);
        }
        // three.js's first vertex of the +x face is (0.3, 0.3, 0.3).
        assert_eq!(&g.vertices[0..3], &[0.3, 0.3, 0.3]);
        assert_eq!(&g.indices[0..6], &[0, 2, 1, 2, 3, 1]);
    }

    #[test]
    fn box_triangles_face_outward() {
        let g = box_geometry(1.0, 2.0, 3.0, [2, 3, 4]);
        for tri in g.indices.chunks(3) {
            let p = |i: u32| {
                let v = &g.vertices[i as usize * VERTEX_FLOATS..];
                [v[0], v[1], v[2]]
            };
            let (a, b, c) = (p(tri[0]), p(tri[1]), p(tri[2]));
            let e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            let e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            let n = [
                e1[1] * e2[2] - e1[2] * e2[1],
                e1[2] * e2[0] - e1[0] * e2[2],
                e1[0] * e2[1] - e1[1] * e2[0],
            ];
            let center = [
                (a[0] + b[0] + c[0]) / 3.0,
                (a[1] + b[1] + c[1]) / 3.0,
                (a[2] + b[2] + c[2]) / 3.0,
            ];
            assert!(
                n[0] * center[0] + n[1] * center[1] + n[2] * center[2] > 0.0,
                "a triangle faces inward"
            );
        }
    }

    #[test]
    fn a_sphere_matches_three_js_counts() {
        let g = sphere_geometry(1.0, 32, 16);
        assert_eq!(g.vertex_count(), 33 * 17);
        // Each band has two triangles per segment, except one at each pole.
        assert_eq!(g.indices.len(), (32 * 16 * 2 - 32 * 2) * 3);
        for vertex in g.vertices.chunks(VERTEX_FLOATS) {
            let r = (vertex[0] * vertex[0] + vertex[1] * vertex[1] + vertex[2] * vertex[2]).sqrt();
            assert!((r - 1.0).abs() < 1e-5);
        }
    }
}
