//! Cube maps in the GPU's face layout, and their filtered sampling.
//!
//! Faces come in the order +X, -X, +Y, -Y, +Z, -Z. A face's texel coordinates follow the cube map
//! table that OpenGL, Vulkan and WebGPU share, with row 0 at the top of each face. A texel then
//! holds the light that arrives from the world direction a shader samples it with, so the engine
//! needs no flip.

use super::vector::{Vec3, add, normalize, scale};

/// The number of faces of a cube map.
pub const FACES: usize = 6;

/// The direction through a face at the face coordinates `sc` and `tc`, each from -1 to 1 across
/// the face. The direction is not unit length.
pub fn face_direction(face: usize, sc: f32, tc: f32) -> Vec3 {
    match face {
        0 => [1.0, -tc, -sc],
        1 => [-1.0, -tc, sc],
        2 => [sc, 1.0, tc],
        3 => [sc, -1.0, -tc],
        4 => [sc, -tc, 1.0],
        _ => [-sc, -tc, -1.0],
    }
}

/// The face that a direction points into, and the place on it from 0 to 1 across and down.
pub fn face_coords(d: Vec3) -> (usize, f32, f32) {
    let [x, y, z] = d;
    let (ax, ay, az) = (x.abs(), y.abs(), z.abs());
    let (face, sc, tc, major) = if ax >= ay && ax >= az {
        if x > 0.0 {
            (0, -z, -y, ax)
        } else {
            (1, z, -y, ax)
        }
    } else if ay >= az {
        if y > 0.0 {
            (2, x, z, ay)
        } else {
            (3, x, -z, ay)
        }
    } else if z > 0.0 {
        (4, x, -y, az)
    } else {
        (5, -x, -y, az)
    };
    let inverse = 0.5 / major;
    (face, sc * inverse + 0.5, tc * inverse + 0.5)
}

/// The face coordinate from -1 to 1 of the center of texel `i` in a face `size` texels wide.
fn texel_center(i: usize, size: usize) -> f32 {
    (2 * i + 1) as f32 / size as f32 - 1.0
}

/// A cube map of linear RGB light, one level.
#[derive(Clone, Debug, PartialEq)]
pub struct Cube {
    /// The width and height of each face in texels.
    pub size: usize,
    /// The texels, face after face, row after row.
    pub texels: Vec<Vec3>,
}

impl Cube {
    /// The unit direction through the center of a texel.
    pub fn texel_direction(size: usize, face: usize, x: usize, y: usize) -> Vec3 {
        normalize(face_direction(
            face,
            texel_center(x, size),
            texel_center(y, size),
        ))
    }

    /// A cube map whose texels each average `light` over `sub` by `sub` directions spread evenly
    /// over the texel.
    pub fn from_fn(size: usize, sub: usize, light: impl Fn(Vec3) -> Vec3) -> Self {
        let mut texels = Vec::with_capacity(FACES * size * size);
        let step = 2.0 / (size * sub) as f32;
        let weight = 1.0 / (sub * sub) as f32;
        for face in 0..FACES {
            for y in 0..size {
                for x in 0..size {
                    let mut sum = [0.0; 3];
                    for j in 0..sub {
                        let tc = ((y * sub + j) as f32 + 0.5) * step - 1.0;
                        for i in 0..sub {
                            let sc = ((x * sub + i) as f32 + 0.5) * step - 1.0;
                            sum = add(sum, light(normalize(face_direction(face, sc, tc))));
                        }
                    }
                    texels.push(scale(sum, weight));
                }
            }
        }
        Self { size, texels }
    }

    /// The texel of a face at column `x` and row `y`.
    pub fn texel(&self, face: usize, x: usize, y: usize) -> Vec3 {
        self.texels[(face * self.size + y) * self.size + x]
    }

    /// The next smaller level: each texel averages a square of four.
    pub fn half(&self) -> Self {
        let size = (self.size / 2).max(1);
        if size == self.size {
            return self.clone();
        }
        let mut texels = Vec::with_capacity(FACES * size * size);
        for face in 0..FACES {
            for y in 0..size {
                for x in 0..size {
                    let sum = add(
                        add(
                            self.texel(face, 2 * x, 2 * y),
                            self.texel(face, 2 * x + 1, 2 * y),
                        ),
                        add(
                            self.texel(face, 2 * x, 2 * y + 1),
                            self.texel(face, 2 * x + 1, 2 * y + 1),
                        ),
                    );
                    texels.push(scale(sum, 0.25));
                }
            }
        }
        Self { size, texels }
    }

    /// The texel nearest to a direction.
    pub fn nearest(&self, d: Vec3) -> Vec3 {
        let (face, s, t) = face_coords(d);
        let at = |c: f32| ((c * self.size as f32) as usize).min(self.size - 1);
        self.texel(face, at(s), at(t))
    }
}

/// One level of a cube map with a border of one texel around each face, taken from the
/// neighboring faces, so bilinear filtering crosses the edges between faces as the GPU's does.
struct Bordered {
    size: usize,
    stride: usize,
    texels: Vec<Vec3>,
}

impl Bordered {
    fn new(cube: &Cube) -> Self {
        let size = cube.size;
        let stride = size + 2;
        let mut texels = Vec::with_capacity(FACES * stride * stride);
        let center = |i: usize| (2 * i) as f32 / size as f32 - 1.0 - 1.0 / size as f32;
        for face in 0..FACES {
            for by in 0..stride {
                for bx in 0..stride {
                    let inside = (1..=size).contains(&bx) && (1..=size).contains(&by);
                    texels.push(if inside {
                        cube.texel(face, bx - 1, by - 1)
                    } else {
                        cube.nearest(face_direction(face, center(bx), center(by)))
                    });
                }
            }
        }
        Self {
            size,
            stride,
            texels,
        }
    }

    /// Bilinear filtering at a place on a face, from 0 to 1 across and down.
    fn bilinear(&self, face: usize, s: f32, t: f32) -> Vec3 {
        let last = self.size as f32 + 0.5;
        let fx = (s * self.size as f32 + 0.5).clamp(0.0, last);
        let fy = (t * self.size as f32 + 0.5).clamp(0.0, last);
        let (x0, y0) = (fx as usize, fy as usize);
        let (x1, y1) = ((x0 + 1).min(self.stride - 1), (y0 + 1).min(self.stride - 1));
        let (wx, wy) = (fx - x0 as f32, fy - y0 as f32);
        let base = face * self.stride * self.stride;
        let at = |x: usize, y: usize| self.texels[base + y * self.stride + x];
        let row = |y: usize| add(scale(at(x0, y), 1.0 - wx), scale(at(x1, y), wx));
        add(scale(row(y0), 1.0 - wy), scale(row(y1), wy))
    }
}

/// A cube map's chain of levels, each half the size of the one before, down to one texel, for
/// trilinear filtering.
pub struct Chain {
    levels: Vec<Bordered>,
}

impl Chain {
    /// The chain of `cube` and its smaller levels.
    pub fn new(cube: &Cube) -> Self {
        let mut levels = vec![Bordered::new(cube)];
        let mut level = cube.clone();
        while level.size > 1 {
            level = level.half();
            levels.push(Bordered::new(&level));
        }
        Self { levels }
    }

    /// The width of the largest level's faces.
    pub fn size(&self) -> usize {
        self.levels[0].size
    }

    /// Trilinear filtering in a direction, at a level of detail where 0 is the largest level.
    pub fn sample(&self, d: Vec3, lod: f32) -> Vec3 {
        let (face, s, t) = face_coords(d);
        let lod = lod.clamp(0.0, (self.levels.len() - 1) as f32);
        let low = lod as usize;
        let a = self.levels[low].bilinear(face, s, t);
        let blend = lod - low as f32;
        if blend == 0.0 {
            return a;
        }
        let b = self.levels[low + 1].bilinear(face, s, t);
        add(scale(a, 1.0 - blend), scale(b, blend))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::environment::vector::dot;

    #[test]
    fn texel_directions_find_their_texels_again() {
        let size = 8;
        for face in 0..FACES {
            for y in 0..size {
                for x in 0..size {
                    let (f, s, t) = face_coords(Cube::texel_direction(size, face, x, y));
                    assert_eq!(f, face);
                    assert_eq!(
                        ((s * size as f32) as usize, (t * size as f32) as usize),
                        (x, y)
                    );
                }
            }
        }
    }

    #[test]
    fn faces_follow_the_gpu_table() {
        // The first texel of +X lies toward +Y and +Z; of +Y toward -X and -Z; of +Z toward -X
        // and +Y.
        let d = Cube::texel_direction(4, 0, 0, 0);
        assert!(d[0] > 0.0 && d[1] > 0.0 && d[2] > 0.0);
        let d = Cube::texel_direction(4, 2, 0, 0);
        assert!(d[1] > 0.0 && d[0] < 0.0 && d[2] < 0.0);
        let d = Cube::texel_direction(4, 4, 0, 0);
        assert!(d[2] > 0.0 && d[0] < 0.0 && d[1] > 0.0);
    }

    #[test]
    fn filtering_across_a_face_edge_is_continuous() {
        // Light that follows x: sampling either side of the edge between +Z and +X gives nearly
        // the same value.
        let cube = Cube::from_fn(16, 2, |d| [d[0] + 1.0, 0.0, 0.0]);
        let chain = Chain::new(&cube);
        let edge = normalize([1.0, 0.2, 1.0]);
        let a = chain.sample(normalize([1.0, 0.2, 1.001]), 0.0);
        let b = chain.sample(normalize([1.001, 0.2, 1.0]), 0.0);
        assert!((a[0] - b[0]).abs() < 0.01, "{a:?} {b:?}");
        assert!((a[0] - (edge[0] + 1.0)).abs() < 0.02);
        assert!(dot(edge, edge) > 0.99);
    }

    #[test]
    fn halving_keeps_the_mean() {
        let cube = Cube::from_fn(8, 1, |d| [d[0] * d[0], d[1].abs(), 1.0]);
        let half = cube.half();
        let mean =
            |c: &Cube| c.texels.iter().map(|t| t[0] + t[1]).sum::<f32>() / c.texels.len() as f32;
        assert!((mean(&cube) - mean(&half)).abs() < 1e-4);
        assert_eq!(half.size, 4);
    }
}
