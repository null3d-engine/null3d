//! SIMD culling against the scalar reference: random spheres under several frusta, spheres on
//! plane boundaries, and the parallel version with 0 to 8 job workers.

mod common;

use common::{Rng, Workers};
use sokko3d_core::culling::{
    CullOutput, Frustum, cull_parallel, cull_spheres, cull_spheres_reference,
};
use sokko3d_core::world::SphereArrays;

type Mat4 = [f32; 16];

/// Column-major product `a × b`.
fn mul4(a: &Mat4, b: &Mat4) -> Mat4 {
    std::array::from_fn(|i| {
        let (col, row) = (i / 4, i % 4);
        (0..4).map(|k| a[k * 4 + row] * b[col * 4 + k]).sum()
    })
}

/// A perspective projection in WebGPU's clip space (depth from 0 at near to 1 at far).
fn perspective(fov_y: f32, aspect: f32, near: f32, far: f32) -> Mat4 {
    let f = 1.0 / (fov_y / 2.0).tan();
    let mut m = [0.0; 16];
    m[0] = f / aspect;
    m[5] = f;
    m[10] = far / (near - far);
    m[11] = -1.0;
    m[14] = near * far / (near - far);
    m
}

/// A perspective projection with reversed depth (1 at near, 0 at far), or an infinite far plane
/// when `far` is `None`.
fn reversed_perspective(fov_y: f32, aspect: f32, near: f32, far: Option<f32>) -> Mat4 {
    let f = 1.0 / (fov_y / 2.0).tan();
    let mut m = [0.0; 16];
    m[0] = f / aspect;
    m[5] = f;
    m[11] = -1.0;
    match far {
        Some(far) => {
            m[10] = near / (far - near);
            m[14] = far * near / (far - near);
        }
        None => m[14] = near,
    }
    m
}

/// An orthographic projection in WebGPU's clip space.
fn orthographic(left: f32, right: f32, bottom: f32, top: f32, near: f32, far: f32) -> Mat4 {
    let mut m = [0.0; 16];
    m[0] = 2.0 / (right - left);
    m[5] = 2.0 / (top - bottom);
    m[10] = 1.0 / (near - far);
    m[12] = -(right + left) / (right - left);
    m[13] = -(top + bottom) / (top - bottom);
    m[14] = near / (near - far);
    m[15] = 1.0;
    m
}

/// A view matrix for a camera at `eye` turned by `yaw` about Y and `pitch` about X.
fn view(eye: [f32; 3], yaw: f32, pitch: f32) -> Mat4 {
    let (sy, cy) = yaw.sin_cos();
    let (sp, cp) = pitch.sin_cos();
    // Rows of the inverse rotation are the camera axes.
    let right = [cy, 0.0, -sy];
    let up = [sy * sp, cp, cy * sp];
    let back = [sy * cp, -sp, cy * cp];
    let dot = |a: [f32; 3]| a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2];
    [
        right[0],
        up[0],
        back[0],
        0.0, //
        right[1],
        up[1],
        back[1],
        0.0, //
        right[2],
        up[2],
        back[2],
        0.0, //
        -dot(right),
        -dot(up),
        -dot(back),
        1.0,
    ]
}

fn frusta() -> Vec<Frustum> {
    let matrices = [
        perspective(1.0, 16.0 / 9.0, 0.1, 500.0),
        mul4(
            &perspective(0.6, 1.0, 1.0, 80.0),
            &view([3.0, 10.0, 40.0], 0.7, -0.3),
        ),
        mul4(
            &reversed_perspective(1.2, 1.5, 0.5, Some(200.0)),
            &view([-20.0, 0.0, 5.0], -1.9, 0.2),
        ),
        mul4(
            &reversed_perspective(1.4, 2.0, 0.25, None),
            &view([0.0, 50.0, 0.0], 3.0, -1.2),
        ),
        mul4(
            &orthographic(-60.0, 60.0, -30.0, 30.0, 1.0, 300.0),
            &view([0.0, 0.0, 100.0], 0.2, 0.1),
        ),
    ];
    matrices.iter().map(Frustum::from_view_projection).collect()
}

/// `count` random spheres in a 400-unit cube, some hidden, some huge, and a few degenerate.
fn random_spheres(count: usize, seed: u64) -> [Vec<f32>; 4] {
    let mut rng = Rng::new(seed);
    let mut arrays: [Vec<f32>; 4] = Default::default();
    for _ in 0..count {
        arrays[0].push(rng.range(-200.0, 200.0));
        arrays[1].push(rng.range(-200.0, 200.0));
        arrays[2].push(rng.range(-200.0, 200.0));
        arrays[3].push(match rng.below(100) {
            0 => f32::NEG_INFINITY,
            1 => f32::NAN,
            2 => rng.range(50.0, 400.0),
            3 => 0.0,
            _ => rng.range(0.0, 8.0),
        });
    }
    arrays
}

#[test]
fn simd_matches_the_scalar_reference_on_100k_random_spheres() {
    let [xs, ys, zs, rs] = random_spheres(100_000, 3);
    let mut simd = vec![0; xs.len()];
    let mut scalar = vec![0; xs.len()];
    let mut total_visible = 0;
    for (f, frustum) in frusta().iter().enumerate() {
        for range in [0..100_000, 1..99_999, 17..40_018, 99_990..100_000, 5..5] {
            let a = cull_spheres(frustum, &xs, &ys, &zs, &rs, range.clone(), &mut simd);
            let b = cull_spheres_reference(frustum, &xs, &ys, &zs, &rs, range.clone(), &mut scalar);
            assert_eq!(a, b, "frustum {f}, range {range:?}");
            assert_eq!(simd[..a], scalar[..b], "frustum {f}, range {range:?}");
            assert!(simd[..a].windows(2).all(|w| w[0] < w[1]));
            assert!(simd[..a].iter().all(|i| range.contains(i)));
            if range == (0..100_000) {
                total_visible += a;
                // Every frustum sees some spheres and misses some.
                assert!(a > 0 && a < 100_000, "frustum {f} sees {a} spheres");
            }
        }
    }
    assert!(total_visible > 0);
}

#[test]
fn spheres_on_plane_boundaries() {
    // Every plane of this box is exact in binary: x in [-8, 8], y in [-4, 4], z in [-33, -1].
    let frustum = Frustum::from_view_projection(&orthographic(-8.0, 8.0, -4.0, 4.0, 1.0, 33.0));
    let planes = frustum.planes();
    assert_eq!(planes[0], [1.0, 0.0, 0.0, 8.0]);
    assert_eq!(planes[5], [0.0, 0.0, 1.0, 33.0]);
    // The next float away from zero. Each step-out case below is exact in f32: the sum lands
    // a whole unit of the last place past the plane, so rounding cannot bring it back.
    let above = |v: f32| f32::from_bits(v.to_bits() + 1);
    // (x, y, z, r, visible)
    let cases = [
        (8.5, 0.0, -10.0, 0.5, true), // touches the right plane from outside
        (above(8.5), 0.0, -10.0, 0.5, false), // one step further out
        (-8.0, 0.0, -10.0, 0.0, true), // a point on the left plane
        (-above(8.0), 0.0, -10.0, 0.0, false),
        (0.0, 4.25, -10.0, 0.25, true), // touches the top plane
        (0.0, -above(4.25), -10.0, 0.25, false),
        (0.0, 0.0, -0.5, 0.5, true), // touches the near plane
        (0.0, 0.0, -(0.5 - f32::EPSILON / 2.0), 0.5, false),
        (0.0, 0.0, -34.0, 1.0, true), // touches the far plane
        (0.0, 0.0, -above(34.0), 1.0, false),
        (0.0, 0.0, -10.0, -0.0, true), // negative zero radius
        (0.0, 0.0, -10.0, f32::NEG_INFINITY, false), // hidden
        (0.0, 0.0, -10.0, f32::INFINITY, true),
        (f32::NAN, 0.0, -10.0, 1.0, false),
        (1000.0, 0.0, -10.0, f32::INFINITY, true),
    ];
    // Pad to an odd count so both the SIMD loop and the scalar tail see boundary cases.
    let n = cases.len();
    let xs: Vec<f32> = cases.iter().map(|c| c.0).collect();
    let ys: Vec<f32> = cases.iter().map(|c| c.1).collect();
    let zs: Vec<f32> = cases.iter().map(|c| c.2).collect();
    let rs: Vec<f32> = cases.iter().map(|c| c.3).collect();
    let expected: Vec<u32> = (0..n as u32).filter(|&i| cases[i as usize].4).collect();
    for start in 0..4 {
        let mut simd = vec![0; n];
        let mut scalar = vec![0; n];
        let range = start..n as u32;
        let a = cull_spheres(&frustum, &xs, &ys, &zs, &rs, range.clone(), &mut simd);
        let b = cull_spheres_reference(&frustum, &xs, &ys, &zs, &rs, range, &mut scalar);
        let want: Vec<u32> = expected.iter().copied().filter(|&i| i >= start).collect();
        assert_eq!(simd[..a], want[..], "start {start}");
        assert_eq!(scalar[..b], want[..], "start {start}");
    }
}

#[test]
fn parallel_culling_matches_the_reference_for_0_to_8_workers() {
    let [xs, ys, zs, rs] = random_spheres(100_003, 11);
    let frusta = frusta();
    let mut expected = vec![0; xs.len()];
    for workers in [0, 1, 2, 3, 4, 8] {
        let pool = Workers::start(workers);
        let mut out = CullOutput::with_capacity(xs.len() as u32);
        for count in [0usize, 1, 5, 4096, 4097, 100_003] {
            let spheres = SphereArrays::new(&xs[..count], &ys[..count], &zs[..count], &rs[..count]);
            for (f, frustum) in frusta.iter().enumerate() {
                let n = cull_parallel(pool.jobs(), frustum, spheres, &mut out);
                let m = cull_spheres_reference(
                    frustum,
                    &xs,
                    &ys,
                    &zs,
                    &rs,
                    0..count as u32,
                    &mut expected,
                );
                assert_eq!(n, out.len());
                assert_eq!(
                    out.visible(),
                    &expected[..m],
                    "{workers} workers, {count} spheres, frustum {f}"
                );
            }
        }
    }
}

#[test]
#[should_panic(expected = "fewer than")]
fn a_short_output_panics() {
    let v = vec![0.0; 10];
    let frustum = Frustum::from_view_projection(&perspective(1.0, 1.0, 0.1, 10.0));
    let mut out = CullOutput::with_capacity(5);
    cull_parallel(
        &sokko3d_core::jobs::JobSystem::new(0),
        &frustum,
        SphereArrays::new(&v, &v, &v, &v),
        &mut out,
    );
}
