//! The engine's built-in room: the scene of three.js's `RoomEnvironment`, seen from its center.
//!
//! A large white room holds six white boxes and six glowing panels, lit by one point light. The
//! tool traces a ray from the center in each direction instead of drawing the scene. A surface
//! reflects the point light as three.js's `MeshStandardMaterial` does with its defaults (white,
//! roughness 1, metalness 0), and a panel glows with its emissive strength. Like three.js's
//! scene, nothing casts shadows.

use std::f32::consts::PI;

use super::vector::{Vec3, dot, normalize, scale, sub};

/// A box: its center, its half sizes along its own axes, and its turn about Y in radians.
struct Box3 {
    center: Vec3,
    half: Vec3,
    turn: f32,
}

/// The scene's offset: three.js moves the room down by 3.5 so the center sits near the floor.
const LIFT: f32 = -3.5;

const fn at(x: f32, y: f32, z: f32, sx: f32, sy: f32, sz: f32, turn: f32) -> Box3 {
    Box3 {
        center: [x, y + LIFT, z],
        half: [sx * 0.5, sy * 0.5, sz * 0.5],
        turn,
    }
}

const ROOM: Box3 = at(-0.757, 13.219, 0.717, 31.713, 28.305, 28.591, 0.0);

const BOXES: [Box3; 6] = [
    at(-10.906, 2.009, 1.846, 2.328, 7.905, 4.651, -0.195),
    at(-5.607, -0.754, -0.758, 1.970, 1.534, 3.955, 0.994),
    at(6.167, 0.857, 7.803, 3.927, 6.285, 3.687, 0.561),
    at(-2.017, 0.018, 6.124, 2.002, 4.566, 2.064, 0.333),
    at(2.291, -0.756, -2.621, 1.546, 1.552, 1.496, -0.286),
    at(-2.193, -0.369, -5.547, 3.875, 3.487, 2.986, 0.516),
];

/// The panels and their emissive strengths.
const PANELS: [(Box3, f32); 6] = [
    (at(-16.116, 14.37, 8.208, 0.1, 2.428, 2.739, 0.0), 50.0),
    (at(-16.109, 18.021, -8.207, 0.1, 2.425, 2.751, 0.0), 50.0),
    (at(14.904, 12.198, -1.832, 0.15, 4.265, 6.331, 0.0), 17.0),
    (at(-0.462, 8.89, 14.520, 4.38, 5.441, 0.088, 0.0), 43.0),
    (at(3.235, 11.486, -12.541, 2.5, 2.0, 0.1, 0.0), 20.0),
    (at(0.0, 20.0, 0.0, 1.0, 0.1, 1.0, 0.0), 100.0),
];

/// The point light: position, intensity in candela, range and decay.
const LIGHT: Vec3 = [0.418, 16.199 + LIFT, 0.300];
const LIGHT_INTENSITY: f32 = 900.0;
const LIGHT_RANGE: f32 = 28.0;

/// Turns a vector about Y by `angle`.
fn turn(v: Vec3, angle: f32) -> Vec3 {
    let (s, c) = angle.sin_cos();
    [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]]
}

impl Box3 {
    /// Where a ray from the origin along `d` crosses the box: the distances in and out, and the
    /// box's outward normals there, in world space.
    fn cross(&self, d: Vec3) -> Option<(f32, Vec3, f32, Vec3)> {
        let origin = turn(sub([0.0; 3], self.center), -self.turn);
        let dir = turn(d, -self.turn);
        let (mut near, mut far) = (f32::NEG_INFINITY, f32::INFINITY);
        let (mut near_axis, mut far_axis) = (0, 0);
        for axis in 0..3 {
            if dir[axis] == 0.0 {
                if origin[axis].abs() > self.half[axis] {
                    return None;
                }
                continue;
            }
            let a = (-self.half[axis] - origin[axis]) / dir[axis];
            let b = (self.half[axis] - origin[axis]) / dir[axis];
            let (a, b) = if a < b { (a, b) } else { (b, a) };
            if a > near {
                near = a;
                near_axis = axis;
            }
            if b < far {
                far = b;
                far_axis = axis;
            }
        }
        if near > far || far <= 0.0 {
            return None;
        }
        let normal = |axis: usize, sign: f32| {
            let mut n = [0.0; 3];
            n[axis] = sign;
            turn(n, self.turn)
        };
        let near_sign = -dir[near_axis].signum();
        let far_sign = dir[far_axis].signum();
        Some((
            near,
            normal(near_axis, near_sign),
            far,
            normal(far_axis, far_sign),
        ))
    }
}

/// The light a white standard material reflects toward the room's center from a point with the
/// normal `n`, lit by the point light.
fn shade(p: Vec3, n: Vec3) -> f32 {
    let to_light = sub(LIGHT, p);
    let distance = dot(to_light, to_light).sqrt();
    let l = scale(to_light, 1.0 / distance);
    let n_dot_l = dot(n, l);
    if n_dot_l <= 0.0 {
        return 0.0;
    }
    // three.js's distance falloff with a range.
    let ratio = distance / LIGHT_RANGE;
    let cutoff = (1.0 - ratio * ratio * ratio * ratio).clamp(0.0, 1.0);
    let falloff = cutoff * cutoff / (distance * distance).max(0.01);
    let irradiance = LIGHT_INTENSITY * falloff * n_dot_l;
    // The view points from the surface back to the center.
    let v = normalize(scale(p, -1.0));
    let n_dot_v = dot(n, v).max(1e-4);
    let h = normalize([l[0] + v[0], l[1] + v[1], l[2] + v[2]]);
    let v_dot_h = dot(v, h).max(0.0);
    // Roughness 1 makes alpha 1: the distribution is 1 / pi, and the correlated Smith term is
    // 0.5 / (n.l + n.v).
    let fresnel = 0.04 + 0.96 * (1.0 - v_dot_h).powi(5);
    let specular = fresnel * 0.5 / (n_dot_l + n_dot_v) / PI;
    irradiance * (1.0 / PI + specular)
}

/// The light that reaches the room's center from a unit direction.
pub fn light(d: Vec3) -> Vec3 {
    let mut nearest = f32::INFINITY;
    let mut out = 0.0;
    if let Some((_, _, far, normal)) = ROOM.cross(d) {
        nearest = far;
        out = shade(scale(d, far), scale(normal, -1.0));
    }
    for b in &BOXES {
        if let Some((near, normal, _, _)) = b.cross(d)
            && near > 0.0
            && near < nearest
        {
            nearest = near;
            out = shade(scale(d, near), normal);
        }
    }
    for (panel, strength) in &PANELS {
        if let Some((near, _, _, _)) = panel.cross(d)
            && near > 0.0
            && near < nearest
        {
            nearest = near;
            out = *strength;
        }
    }
    [out; 3]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_ceiling_panel_glows_overhead() {
        assert_eq!(light([0.0, 1.0, 0.0]), [100.0; 3]);
    }

    #[test]
    fn walls_and_boxes_are_lit_but_dimmer_than_the_panels() {
        for d in [
            [0.0, 0.0, -1.0],
            [0.0, -1.0, 0.0],
            normalize([-1.0, -0.1, 0.2]),
        ] {
            let l = light(d)[0];
            assert!(l > 0.0 && l < 17.0, "{d:?}: {l}");
        }
    }

    #[test]
    fn a_box_hides_the_wall_behind_it() {
        // Box 4 stands at (-2.017, -3.482, 6.124), toward +Z and down.
        let d = normalize([-2.017, -3.0, 6.124]);
        let (near, _, _, _) = BOXES[3].cross(d).expect("a hit");
        let (_, _, wall, _) = ROOM.cross(d).expect("a hit");
        assert!(near < wall);
    }
}
