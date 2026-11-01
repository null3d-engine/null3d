//! The wind add-on's analytic field as a WebAssembly module for the engine's job workers.
//!
//! A page asks for the air at many places, and a task in a job worker works each of them out here.
//! The formula is the one that the add-on keeps in TypeScript for its tests and for a page's reads
//! outside a frame, and the one that the grid's shaders hold, so the three agree.
//!
//! The module imports nothing. It exports its memory and these functions:
//!
//! - `request(length)` makes room for a request of `length` bytes and returns where it starts.
//! - `probe()` works out the air at each place that the request names. The request is the place
//!   count as a 32-bit float, then thirteen 32-bit floats, then sixteen floats for the ring of
//!   pushes and the gust, then three 32-bit floats for each place. The thirteen are the base wind's
//!   speed, heading, ground share and seed, the gust's strength, radius, wave and speed, the
//!   swirl's strength, size and drift, how wide a push turns the air, and the time. It returns 0 on
//!   success, 1 when the request is too short, and 2 when the answer is larger than the module
//!   holds.
//! - `response()` and `response_length()` give the last answer: three 32-bit floats for each place,
//!   the air's velocity across the ground in the first and third and its rise, which is zero, in the
//!   second.
//!
//! The module keeps both buffers made once, so a call in every frame allocates nothing.

use std::cell::{Cell, RefCell};

/// The bytes of the request buffer, which holds about five thousand places.
const CAPACITY: usize = 1 << 16;

/// The floats before the places: the settings and the time, then the ring.
const HEADER_FLOATS: usize = 13 + 16;

/// The floats of the air's settings and the time.
pub const SETTINGS_FLOATS: usize = 13;

/// The floats of each ring slot: its place across the ground, its strength and its birth time.
pub const SLOT_FLOATS: usize = 4;

/// The slots of the ring: the pushes, then the newest gust.
pub const RING_SLOTS: usize = 4;

/// The slot that holds the newest gust, after the pushes.
pub const GUST_SLOT: usize = 3;

/// How long a push lasts before it has faded away, in seconds.
pub const PUSH_LIFE: f64 = 3.0;

/// The height over which the air slows to the ground, in meters.
pub const GROUND_HEIGHT: f64 = 2.0;

/// The distance over which the noise's curl is measured, in noise cells.
pub const CURL_STEP: f64 = 0.02;

/// The air's settings and the time, as a place's velocity reads them.
#[derive(Clone, Copy, Debug, Default)]
pub struct Settings {
    /// The wind's speed at the top of the profile, in meters a second.
    pub speed: f64,
    /// The heading that the wind blows toward, in radians.
    pub heading: f64,
    /// How much slower the air is at the ground, from 0 to 1.
    pub ground: f64,
    /// The strength of the gust's turn, in meters a second.
    pub gust_strength: f64,
    /// How wide the gust is, in meters.
    pub gust_radius: f64,
    /// How far apart the gust's turns sit.
    pub gust_wave: f64,
    /// How fast the gust travels, in meters a second.
    pub gust_speed: f64,
    /// How wide a push turns the air, in meters.
    pub push_radius: f64,
    /// The strength of the noise-built swirl, in meters a second.
    pub swirl: f64,
    /// The swirl's size: larger makes wider, slower eddies.
    pub swirl_scale: f64,
    /// How fast the swirl's pattern drifts, in meters a second.
    pub swirl_drift: f64,
    /// The seed of the swirl's pattern.
    pub seed: f64,
    /// The sketch time in seconds.
    pub time: f64,
}

/// One slot of the ring: a push or the gust, each of which turns the air about a center.
#[derive(Clone, Copy, Debug, Default)]
pub struct Slot {
    /// The place across the ground, in meters.
    pub x: f64,
    pub z: f64,
    /// How hard the body shoved the air.
    pub strength: f64,
    /// The sketch time when the page sent the push or the gust.
    pub born: f64,
}

/// The first value of the engine's `pcg3d` hash as a signed whole number, which value noise reads.
///
/// The hash mixes three values, and value noise reads only the first. The whole mix stays, so the
/// number is the one that the shader library and the add-on's TypeScript form give.
#[allow(unused_assignments)]
pub fn lattice(x: i32, y: i32, z: i32) -> i32 {
    let mut px = x.wrapping_mul(1664525).wrapping_add(1013904223);
    let mut py = y.wrapping_mul(1664525).wrapping_add(1013904223);
    let mut pz = z.wrapping_mul(1664525).wrapping_add(1013904223);
    px = px.wrapping_add(py.wrapping_mul(pz));
    py = py.wrapping_add(pz.wrapping_mul(px));
    pz = pz.wrapping_add(px.wrapping_mul(py));
    px ^= (px as u32 >> 16) as i32;
    py ^= (py as u32 >> 16) as i32;
    pz ^= (pz as u32 >> 16) as i32;
    px = px.wrapping_add(py.wrapping_mul(pz));
    py = py.wrapping_add(pz.wrapping_mul(px));
    pz = pz.wrapping_add(px.wrapping_mul(py));
    px
}

/// A number from 0 up to 1 made from the top 24 bits of a hash.
fn to_unit(hash: i32) -> f64 {
    ((hash as u32 >> 8) as f64) / 16_777_216.0
}

/// Perlin's fade curve, flat at both ends.
fn fade(t: f64) -> f64 {
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

/// A blend of two numbers.
fn blend(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// A value noise corner's number: the hash's first value, from 0 up to 1.
fn corner(x: i32, y: i32, z: i32) -> f64 {
    to_unit(lattice(x, y, z))
}

/// The engine library's value noise in 3D, from 0 to 1.
pub fn value3(px: f64, py: f64, pz: f64) -> f64 {
    let fx = px.floor();
    let fy = py.floor();
    let fz = pz.floor();
    let u = fade(px - fx);
    let v = fade(py - fy);
    let w = fade(pz - fz);
    let (ix, iy, iz) = (fx as i32, fy as i32, fz as i32);
    blend(
        blend(
            blend(corner(ix, iy, iz), corner(ix + 1, iy, iz), u),
            blend(corner(ix, iy + 1, iz), corner(ix + 1, iy + 1, iz), u),
            v,
        ),
        blend(
            blend(corner(ix, iy, iz + 1), corner(ix + 1, iy, iz + 1), u),
            blend(
                corner(ix, iy + 1, iz + 1),
                corner(ix + 1, iy + 1, iz + 1),
                u,
            ),
            v,
        ),
        w,
    )
}

/// The height's factor of the wind, from 1 at the top to `1 - ground` at the ground.
pub fn profile(settings: &Settings, y: f64) -> f64 {
    1.0 - settings.ground * (-(y.max(0.0)) / GROUND_HEIGHT).exp()
}

/// The stream function of the swirl, in noise cells, at a place and a time.
fn stream(settings: &Settings, x: f64, y: f64, z: f64) -> f64 {
    let drift = settings.swirl_drift * settings.time;
    value3(
        x * settings.swirl_scale + drift + settings.seed,
        y * settings.swirl_scale,
        z * settings.swirl_scale + drift * 0.5,
    )
}

/// The air's velocity at a world place, in meters a second, written into `out` as `[x, y, z]`.
pub fn velocity(settings: &Settings, ring: &[Slot; RING_SLOTS], p: [f64; 3], out: &mut [f64; 3]) {
    let [x, y, z] = p;
    let height = profile(settings, y);
    let cos = settings.heading.cos();
    let sin = settings.heading.sin();
    let mut vx = cos * settings.speed * height;
    let mut vz = sin * settings.speed * height;

    // The gust: a wave of turns that travels along the heading. The turns are rings about the
    // gust's center and depend only on the distance to it, so a ring of air turns without piling up.
    let travel = settings.gust_speed * settings.time;
    let gx = x - cos * travel;
    let gz = z - sin * travel;
    let radius = settings.gust_radius;
    let distance = (gx * gx + gz * gz).sqrt() / radius;
    let reach = distance * distance;
    if reach < 9.0 {
        let envelope = (-reach).exp()
            * (distance * settings.gust_wave).cos()
            * settings.gust_strength
            * height;
        vx += (gz / radius) * envelope;
        vz -= (gx / radius) * envelope;
    }

    // The swirl: the curl of one stream function in the ground plane. The function varies slowly,
    // so a short step measures the slope.
    let step = CURL_STEP / settings.swirl_scale;
    let front = stream(settings, x, y, z + step);
    let back = stream(settings, x, y, z - step);
    let right = stream(settings, x + step, y, z);
    let left = stream(settings, x - step, y, z);
    vx += ((front - back) / (2.0 * step)) * settings.swirl * height;
    vz -= ((right - left) / (2.0 * step)) * settings.swirl * height;

    // The pushes and the gust: a vortex about each push, which fades as it ages, and a wave about a
    // center that travels along the heading for the gust.
    for (i, slot) in ring.iter().enumerate() {
        if slot.strength == 0.0 {
            continue;
        }
        let mut dx = x - slot.x;
        let mut dz = z - slot.z;
        let mut radius = settings.push_radius;
        let mut turn = 0.0;
        if i == GUST_SLOT {
            let age = settings.time - slot.born;
            let travel = settings.gust_speed * age;
            dx -= cos * travel;
            dz -= sin * travel;
            radius = settings.gust_radius;
            let distance = (dx * dx + dz * dz).sqrt() / radius;
            let reach = distance * distance;
            if reach < 9.0 {
                turn = (-reach).exp() * (distance * settings.gust_wave).cos();
            }
        } else {
            let age = settings.time - slot.born;
            if (0.0..=PUSH_LIFE).contains(&age) {
                let fade_out = 1.0 - age / PUSH_LIFE;
                let reach = radius * radius;
                turn = (-(dx * dx + dz * dz) / reach).exp() * fade_out;
            }
        }
        if turn == 0.0 {
            continue;
        }
        let strength = slot.strength * turn * height;
        vx += (dz / radius) * strength;
        vz -= (dx / radius) * strength;
    }

    out[0] = vx;
    out[1] = 0.0;
    out[2] = vz;
}

/// A buffer of bytes, aligned so that a caller may write whole numbers into it.
#[repr(C, align(16))]
struct Aligned([u8; CAPACITY]);

thread_local! {
    static REQUEST: RefCell<Aligned> = const { RefCell::new(Aligned([0; CAPACITY])) };
    static RESPONSE: RefCell<Aligned> = const { RefCell::new(Aligned([0; CAPACITY])) };
    static ANSWER_LENGTH: Cell<usize> = const { Cell::new(0) };
}

/// Makes room for a request of `length` bytes and returns where it starts, or zero when the request
/// is larger than the buffer.
#[unsafe(no_mangle)]
pub extern "C" fn request(length: usize) -> *mut u8 {
    if length > CAPACITY {
        return std::ptr::null_mut();
    }
    REQUEST.with_borrow_mut(|buffer| buffer.0.as_mut_ptr())
}

/// Gives the last answer's first byte.
#[unsafe(no_mangle)]
pub extern "C" fn response() -> *const u8 {
    RESPONSE.with_borrow(|buffer| buffer.0.as_ptr())
}

/// Gives the last answer's length in bytes.
#[unsafe(no_mangle)]
pub extern "C" fn response_length() -> usize {
    ANSWER_LENGTH.with(Cell::get)
}

/// Reads a 32-bit float from a byte slice at `at`.
fn read_f32(bytes: &[u8], at: usize) -> f64 {
    f32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]) as f64
}

/// Writes a 32-bit float into a byte slice at `at`.
fn write_f32(bytes: &mut [u8], at: usize, value: f64) {
    bytes[at..at + 4].copy_from_slice(&(value as f32).to_le_bytes());
}

/// Works out the air at each place that the request names, and writes the answer.
///
/// The request is the place count as a 32-bit float, then thirteen 32-bit floats: the settings, the
/// time, then the ring's four slots, then three 32-bit floats for each place. The answer is three
/// 32-bit floats for each place.
#[unsafe(no_mangle)]
pub extern "C" fn probe() -> i32 {
    REQUEST.with_borrow(|request| {
        let bytes = &request.0;
        let count = read_f32(bytes, 0) as usize;
        let header = 4 + HEADER_FLOATS * 4;
        let needed = header + count * 12;
        if needed > CAPACITY {
            return 2;
        }
        let mut settings = Settings::default();
        let at = |i: usize| read_f32(bytes, 4 + i * 4);
        settings.speed = at(0);
        settings.heading = at(1);
        settings.ground = at(2);
        settings.seed = at(3);
        settings.gust_strength = at(4);
        settings.gust_radius = at(5);
        settings.gust_wave = at(6);
        settings.gust_speed = at(7);
        settings.swirl = at(8);
        settings.swirl_scale = at(9);
        settings.swirl_drift = at(10);
        settings.push_radius = at(11);
        settings.time = at(12);
        let mut ring = [Slot::default(); RING_SLOTS];
        for (i, slot) in ring.iter_mut().enumerate() {
            let base = SETTINGS_FLOATS + i * SLOT_FLOATS;
            slot.x = at(base);
            slot.z = at(base + 1);
            slot.strength = at(base + 2);
            slot.born = at(base + 3);
        }
        RESPONSE.with_borrow_mut(|response| {
            let answer = &mut response.0;
            let mut p = [0.0f64; 3];
            let mut v = [0.0f64; 3];
            for i in 0..count {
                let base = header + i * 12;
                p[0] = read_f32(bytes, base);
                p[1] = read_f32(bytes, base + 4);
                p[2] = read_f32(bytes, base + 8);
                velocity(&settings, &ring, p, &mut v);
                write_f32(answer, i * 12, v[0]);
                write_f32(answer, i * 12 + 4, v[1]);
                write_f32(answer, i * 12 + 8, v[2]);
            }
        });
        ANSWER_LENGTH.with(|length| length.set(count * 12));
        0
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> Settings {
        Settings {
            speed: 4.0,
            heading: 0.0,
            ground: 0.65,
            gust_strength: 3.5,
            gust_radius: 14.0,
            gust_wave: 2.0,
            gust_speed: 6.0,
            push_radius: 6.0,
            swirl: 1.6,
            swirl_scale: 0.06,
            swirl_drift: 0.5,
            seed: 0.0,
            time: 0.0,
        }
    }

    #[test]
    fn the_noise_is_the_engine_librarys_value_noise() {
        // The value that the WGSL library and the add-on's TypeScript form give at the origin.
        assert!((value3(0.0, 0.0, 0.0) - 0.608_151_853_1).abs() < 1e-9);
    }

    #[test]
    fn the_air_follows_the_heading_and_slows_at_the_ground() {
        let ring = [Slot::default(); RING_SLOTS];
        let mut out = [0.0; 3];
        let mut s = settings();
        s.gust_strength = 0.0;
        s.swirl = 0.0;
        velocity(&s, &ring, [1.0, 100.0, 0.0], &mut out);
        assert!((out[0] - 4.0).abs() < 1e-12);
        assert_eq!(out[1], 0.0);
        assert!(out[2].abs() < 1e-12);
        velocity(&s, &ring, [1.0, 0.0, 0.0], &mut out);
        assert!((out[0] - 4.0 * 0.35).abs() < 1e-12);
    }

    #[test]
    fn a_push_turns_the_air_and_fades_over_its_life() {
        let mut ring = [Slot::default(); RING_SLOTS];
        ring[0] = Slot {
            x: 0.0,
            z: 0.0,
            strength: 2.5,
            born: 1.0,
        };
        let mut s = settings();
        s.gust_strength = 0.0;
        s.swirl = 0.0;
        s.time = 1.5;
        let mut near = [0.0; 3];
        velocity(&s, &ring, [1.0, 100.0, 0.0], &mut near);
        assert!(near[2].abs() > 0.1);
        s.time = 5.0;
        let mut gone = [0.0; 3];
        velocity(&s, &ring, [1.0, 100.0, 0.0], &mut gone);
        assert!(gone[2].abs() < 1e-9);
    }

    #[test]
    fn the_answer_holds_three_floats_for_each_place() {
        // Two places at the origin's height, through the buffer interface.
        let mut bytes = [0u8; 4 + HEADER_FLOATS * 4 + 24];
        write_f32(&mut bytes, 0, 2.0);
        let s = settings();
        let values = [
            s.speed,
            s.heading,
            s.ground,
            s.seed,
            s.gust_strength,
            s.gust_radius,
            s.gust_wave,
            s.gust_speed,
            s.swirl,
            s.swirl_scale,
            s.swirl_drift,
            s.push_radius,
            s.time,
        ];
        for (i, v) in values.iter().enumerate() {
            write_f32(&mut bytes, 4 + i * 4, *v);
        }
        // The ring stays zero, so only the steady field moves the air.
        for (i, place) in [[1.0f32, 10.0, 2.0], [-3.0, 4.0, 9.0]].iter().enumerate() {
            let base = 4 + HEADER_FLOATS * 4 + i * 12;
            write_f32(&mut bytes, base, place[0] as f64);
            write_f32(&mut bytes, base + 4, place[1] as f64);
            write_f32(&mut bytes, base + 8, place[2] as f64);
        }
        REQUEST.with_borrow_mut(|request| request.0[..bytes.len()].copy_from_slice(&bytes));
        assert_eq!(probe(), 0);
        let mut first = [0.0f64; 3];
        let mut second = [0.0f64; 3];
        let ring = [Slot::default(); RING_SLOTS];
        velocity(&s, &ring, [1.0, 10.0, 2.0], &mut first);
        velocity(&s, &ring, [-3.0, 4.0, 9.0], &mut second);
        RESPONSE.with_borrow(|response| {
            for (i, want) in [first[0], 0.0, first[2], second[0], 0.0, second[2]]
                .iter()
                .enumerate()
            {
                let got = read_f32(&response.0, i * 4);
                assert!((got - want).abs() < 1e-4, "float {i}: {got} against {want}");
            }
        });
    }

    #[test]
    fn a_request_larger_than_the_buffer_answers_two() {
        let mut bytes = [0u8; 4];
        // A count far past the buffer's capacity.
        write_f32(&mut bytes, 0, CAPACITY as f64);
        REQUEST.with_borrow_mut(|request| request.0[..4].copy_from_slice(&bytes));
        assert_eq!(probe(), 2);
    }
}
