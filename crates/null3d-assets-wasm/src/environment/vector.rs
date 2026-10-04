//! Three-component vectors for directions and colors.

pub type Vec3 = [f32; 3];

pub fn add(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

pub fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

pub fn scale(a: Vec3, s: f32) -> Vec3 {
    [a[0] * s, a[1] * s, a[2] * s]
}

pub fn dot(a: Vec3, b: Vec3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[cfg(test)]
pub fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

pub fn normalize(a: Vec3) -> Vec3 {
    scale(a, 1.0 / dot(a, a).sqrt())
}

/// Two unit vectors that make a right-handed frame with the unit vector `n` (Duff et al., 2017).
pub fn frame(n: Vec3) -> (Vec3, Vec3) {
    let sign = if n[2] >= 0.0 { 1.0 } else { -1.0 };
    let a = -1.0 / (sign + n[2]);
    let b = n[0] * n[1] * a;
    (
        [1.0 + sign * n[0] * n[0] * a, sign * b, -sign * n[0]],
        [b, sign + n[1] * n[1] * a, -n[1]],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_frame_is_orthonormal_on_both_hemispheres() {
        for n in [
            normalize([0.3, -0.5, 0.8]),
            normalize([0.3, -0.5, -0.8]),
            [0.0, 0.0, -1.0],
        ] {
            let (t, b) = frame(n);
            assert!((dot(t, t) - 1.0).abs() < 1e-5);
            assert!((dot(b, b) - 1.0).abs() < 1e-5);
            assert!(dot(t, n).abs() < 1e-5 && dot(b, n).abs() < 1e-5 && dot(t, b).abs() < 1e-5);
            let c = cross(t, b);
            assert!((dot(c, n) - 1.0).abs() < 1e-5);
        }
    }
}
