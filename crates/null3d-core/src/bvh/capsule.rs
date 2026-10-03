//! Capsules: the shapes that queries test skinned characters with, one per bone.
//!
//! A skinned mesh's triangles move every frame, so a triangle tree would need a refit before
//! each query. A capsule per bone follows the bone's two ends instead, costs one test per bone,
//! and is close enough for picking and line of sight. A character has tens of bones, so a query
//! tests them all once the character's box is hit.

use super::{Aabb, Ray};

/// The points within `radius` of the segment from `a` to `b`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Capsule {
    /// One end of the segment.
    pub a: [f32; 3],
    /// The other end.
    pub b: [f32; 3],
    /// The distance from the segment to the surface.
    pub radius: f32,
}

impl Capsule {
    /// The box around the capsule.
    pub fn bounds(&self) -> Aabb {
        let mut b = Aabb::of_sphere(self.a, self.radius);
        b.grow(&Aabb::of_sphere(self.b, self.radius));
        b
    }
}

#[inline(always)]
fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[inline(always)]
fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

/// The smaller root of `a t² + 2 b t + c = 0`, or `None` when there is none.
#[inline(always)]
fn entry_root(a: f32, b: f32, c: f32) -> Option<f32> {
    let h = b * b - a * c;
    (a > 0.0 && h >= 0.0).then(|| (-b - h.sqrt()) / a)
}

/// The distance at which the ray enters the capsule, between `ray.t_min` and `ray.t_max`. A
/// ray that starts inside the capsule does not hit it, as a ray that starts behind a front face
/// does not.
///
/// A capsule is convex, so the ray enters it at one point: on the side of the cylinder between
/// the ends, or on the sphere around an end beyond that end. The test takes the entry into the
/// cylinder and into each end's sphere, keeps those that lie on the capsule's surface, and
/// returns the nearest.
pub fn ray_capsule(ray: &Ray, capsule: &Capsule) -> Option<f32> {
    let rd = ray.direction;
    let ba = sub(capsule.b, capsule.a);
    let oa = sub(ray.origin, capsule.a);
    let r2 = capsule.radius * capsule.radius;
    let (baba, bard, baoa) = (dot(ba, ba), dot(ba, rd), dot(ba, oa));
    let (rdrd, rdoa, oaoa) = (dot(rd, rd), dot(rd, oa), dot(oa, oa));
    // Where along the axis a point at distance t lies: 0 at `a`, `baba` at `b`.
    let along = |t: f32| baoa + t * bard;
    let ob = sub(ray.origin, capsule.b);
    // The side: points at the radius from the axis line, between the ends.
    let side = entry_root(
        baba * rdrd - bard * bard,
        baba * rdoa - baoa * bard,
        baba * oaoa - baoa * baoa - r2 * baba,
    )
    .filter(|&t| along(t) > 0.0 && along(t) < baba);
    // The end spheres, each only beyond its end.
    let end_a = entry_root(rdrd, rdoa, oaoa - r2).filter(|&t| along(t) <= 0.0);
    let end_b = entry_root(rdrd, dot(rd, ob), dot(ob, ob) - r2).filter(|&t| along(t) >= baba);
    [side, end_a, end_b]
        .into_iter()
        .flatten()
        .min_by(f32::total_cmp)
        .filter(|&t| t >= ray.t_min && t <= ray.t_max)
}

/// The nearest capsule the ray enters, and the distance, by testing each in turn.
pub fn raycast_capsules(ray: &Ray, capsules: &[Capsule]) -> Option<(u32, f32)> {
    let mut ray = *ray;
    let mut best = None;
    for (i, c) in capsules.iter().enumerate() {
        if let Some(t) = ray_capsule(&ray, c) {
            ray.t_max = t;
            best = Some((i as u32, t));
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    const CAPSULE: Capsule = Capsule {
        a: [0.0, 0.0, 0.0],
        b: [0.0, 2.0, 0.0],
        radius: 0.5,
    };

    #[test]
    fn rays_enter_the_side_and_the_ends() {
        // Side, at mid height.
        let t = ray_capsule(&Ray::new([-3.0, 1.0, 0.0], [1.0, 0.0, 0.0]), &CAPSULE).unwrap();
        assert!((t - 2.5).abs() < 1e-6);
        // From below, along the axis: the lower end's sphere.
        let t = ray_capsule(&Ray::new([0.0, -3.0, 0.0], [0.0, 2.0, 0.0]), &CAPSULE).unwrap();
        assert!((t - 1.25).abs() < 1e-6, "{t}");
        // From above: the upper end's sphere.
        let t = ray_capsule(&Ray::new([0.0, 5.0, 0.0], [0.0, -1.0, 0.0]), &CAPSULE).unwrap();
        assert!((t - 2.5).abs() < 1e-6);
        // Past the side.
        assert!(ray_capsule(&Ray::new([-3.0, 1.0, 0.6], [1.0, 0.0, 0.0]), &CAPSULE).is_none());
        // From inside.
        assert!(ray_capsule(&Ray::new([0.0, 1.0, 0.0], [1.0, 0.0, 0.0]), &CAPSULE).is_none());
        // Before the far limit only.
        assert!(
            ray_capsule(
                &Ray::new([-3.0, 1.0, 0.0], [1.0, 0.0, 0.0]).with_max(2.0),
                &CAPSULE
            )
            .is_none()
        );
    }

    #[test]
    fn a_capsule_with_equal_ends_is_a_sphere() {
        let ball = Capsule {
            a: [1.0, 1.0, 1.0],
            b: [1.0, 1.0, 1.0],
            radius: 1.0,
        };
        let t = ray_capsule(&Ray::new([1.0, 1.0, -4.0], [0.0, 0.0, 1.0]), &ball).unwrap();
        assert!((t - 4.0).abs() < 1e-6);
    }

    #[test]
    fn the_nearest_capsule_wins() {
        let far = Capsule {
            a: [0.0, 0.0, 5.0],
            b: [0.0, 2.0, 5.0],
            radius: 0.5,
        };
        let ray = Ray::new([0.0, 1.0, -5.0], [0.0, 0.0, 1.0]);
        assert_eq!(raycast_capsules(&ray, &[far, CAPSULE]).unwrap().0, 1);
    }
}
