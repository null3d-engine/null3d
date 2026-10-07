//! The formats that the asset tool writes into model files and the engine reads, as a WebAssembly
//! module for the tool, which runs in Node and Bun. Each format has one source, the engine's own
//! Rust core, so the tool and the engine cannot disagree on a byte. The single-threaded build gives
//! the same bytes on every machine.
//!
//! The module imports nothing. It exports its memory and these functions:
//!
//! - `request(length)` makes room for a request of `length` bytes and returns where it starts.
//! - `mesh_bvh()` builds the stored tree of a mesh's triangles, as the engine's raycasts read it
//!   (`MeshBvh::to_bytes`). The request is the vertex count and the index count as two
//!   little-endian 32-bit integers, then three 32-bit floats per vertex, then three 32-bit
//!   indices per triangle. It returns 0 when the response holds the tree, and 1 when it holds a
//!   message that says why the tree could not be built.
//! - `environment()` builds an environment map's KTX2 file (see [`environment`]). The request is
//!   four little-endian 32-bit integers, then the source: the source's kind (0 for a Radiance or
//!   OpenEXR file, 1 for a built-in environment, whose name follows as UTF-8), the width of the
//!   largest faces, the texel format (0 for `rgb9e5ufloat`, 1 for `rgba16float`) and the filter's
//!   directions per texel (0 for the default). It returns 0 when the response holds the file, and 1
//!   when it holds a message that says why the file could not be built.
//! - `blocker()` makes a mesh's blocker for software occlusion culling and checks that it lies
//!   inside the mesh (see [`blocker`]). The request is five little-endian 32-bit integers: the
//!   vertex count, the index count, the flags (1 when the ground hides the model from below its
//!   lowest point), the cells along the longest side and the most boxes, each 0 for its default.
//!   Three 32-bit floats per
//!   vertex follow, then three 32-bit indices per triangle. It returns 0 when the
//!   response holds the blocker: its corner count, index count and box count as 32-bit
//!   integers, the share of the mesh's box it fills as a 32-bit float, then three 32-bit floats
//!   per corner and three 32-bit indices per triangle. It returns 1 when the request breaks its
//!   layout and 2 when the mesh gets no blocker, and the response then holds a message that says
//!   why.
//! - `clip()` puts an animation clip's tracks on the frames that the engine stores the clip at,
//!   in the form that the engine copies at load without resampling (see [`clip_bytes`]). The
//!   request is three little-endian 32-bit words: the track count, the joint count and the rate
//!   in keys per second as a float (0 for the default). The clip's staging words follow, as the
//!   engine's `createClip` reads them. It returns 0 when the response holds the baked clip, and 1
//!   when it holds a message that says why the clip could not be baked.
//! - `response()` and `response_length()` give the last call's response.

pub mod blocker;
pub mod environment;

use std::cell::RefCell;

use null3d_core::animation::{BakedKeys, bake, staged_tracks};
use null3d_core::bvh::mesh::{IndexedTriangles, MeshBvh};

thread_local! {
    static REQUEST: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static RESPONSE: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Makes the request buffer `length` bytes long and returns where it starts.
#[unsafe(no_mangle)]
pub extern "C" fn request(length: usize) -> *mut u8 {
    REQUEST.with_borrow_mut(|request| {
        request.clear();
        request.resize(length, 0);
        request.as_mut_ptr()
    })
}

/// Builds the stored tree of the mesh in the request.
#[unsafe(no_mangle)]
pub extern "C" fn mesh_bvh() -> u32 {
    let result = REQUEST.with_borrow(|request| mesh_bvh_bytes(request));
    let failed = u32::from(result.is_err());
    RESPONSE.set(result.unwrap_or_else(String::into_bytes));
    failed
}

/// Builds the environment map in the request.
#[unsafe(no_mangle)]
pub extern "C" fn environment() -> u32 {
    let result = REQUEST.with_borrow(|request| environment_bytes(request));
    let failed = u32::from(result.is_err());
    RESPONSE.set(result.unwrap_or_else(String::into_bytes));
    failed
}

/// Makes the blocker of the mesh in the request.
#[unsafe(no_mangle)]
pub extern "C" fn blocker() -> u32 {
    let result = REQUEST.with_borrow(|request| blocker_bytes(request));
    let (status, bytes) = match result {
        Ok(Ok(bytes)) => (0, bytes),
        Err(message) => (1, message.into_bytes()),
        Ok(Err(dropped)) => (2, dropped.to_string().into_bytes()),
    };
    RESPONSE.set(bytes);
    status
}

/// Bakes the clip in the request.
#[unsafe(no_mangle)]
pub extern "C" fn clip() -> u32 {
    let result = REQUEST.with_borrow(|request| clip_bytes(request));
    let failed = u32::from(result.is_err());
    RESPONSE.set(result.unwrap_or_else(String::into_bytes));
    failed
}

/// Where the last response starts.
#[unsafe(no_mangle)]
pub extern "C" fn response() -> *const u8 {
    RESPONSE.with_borrow(|response| response.as_ptr())
}

/// The length of the last response in bytes.
#[unsafe(no_mangle)]
pub extern "C" fn response_length() -> usize {
    RESPONSE.with_borrow(Vec::len)
}

/// The little-endian 32-bit words of `bytes`, which must be a whole number of them.
fn words(bytes: &[u8]) -> impl Iterator<Item = [u8; 4]> + '_ {
    bytes.as_chunks::<4>().0.iter().copied()
}

/// The stored tree of a mesh in the request's layout, or why it could not be built.
///
/// # Errors
/// When the request's counts do not match its length, an index lies past the vertices, or the
/// core cannot build the tree.
pub fn mesh_bvh_bytes(request: &[u8]) -> Result<Vec<u8>, String> {
    let mut head = words(request.get(..8).ok_or("the request has no counts")?);
    let mut count = || head.next().map_or(0, u32::from_le_bytes) as usize;
    let (vertices, indices) = (count(), count());
    let expected = vertices
        .checked_mul(12)
        .and_then(|v| indices.checked_mul(4).and_then(|i| v.checked_add(i)))
        .and_then(|body| body.checked_add(8));
    if expected != Some(request.len()) || indices % 3 != 0 {
        return Err(format!(
            "the request of {} bytes does not hold {vertices} vertices and {indices} indices in whole triangles",
            request.len()
        ));
    }
    let body = &request[8..];
    let positions: Vec<f32> = words(&body[..vertices * 12])
        .map(f32::from_le_bytes)
        .collect();
    let corners: Vec<u32> = words(&body[vertices * 12..])
        .map(u32::from_le_bytes)
        .collect();
    if let Some(&past) = corners.iter().find(|&&i| i as usize >= vertices) {
        return Err(format!(
            "the index {past} lies past the mesh's {vertices} vertices"
        ));
    }
    let mesh = IndexedTriangles {
        positions: &positions,
        indices: &corners,
    };
    let bvh = MeshBvh::build(&mesh).map_err(|e| format!("the tree could not be built: {e:?}"))?;
    Ok(bvh.to_bytes())
}

/// The blocker of a mesh in the request's layout, or why the mesh gets none, or why the request
/// could not be read.
///
/// # Errors
/// When the request's counts do not match its length, or an index lies past the vertices.
pub fn blocker_bytes(request: &[u8]) -> Result<Result<Vec<u8>, blocker::Dropped>, String> {
    let mut head =
        words(request.get(..20).ok_or("the request has no counts")?).map(u32::from_le_bytes);
    let mut next = || head.next().unwrap_or(0) as usize;
    let (vertices, indices, flags, resolution, max_boxes) =
        (next(), next(), next(), next(), next());
    let expected = vertices
        .checked_mul(12)
        .and_then(|v| v.checked_add(indices.checked_mul(4)?))
        .and_then(|b| b.checked_add(20));
    if expected != Some(request.len()) || indices % 3 != 0 {
        return Err(format!(
            "the request of {} bytes does not hold {vertices} vertices and {indices} indices in whole triangles",
            request.len()
        ));
    }
    let body = &request[20..];
    let positions: Vec<f32> = words(&body[..vertices * 12])
        .map(f32::from_le_bytes)
        .collect();
    let corners: Vec<u32> = words(&body[vertices * 12..])
        .map(u32::from_le_bytes)
        .collect();
    let shape = blocker::Shape {
        positions: &positions,
        indices: &corners,
    };
    let settings = blocker::Settings {
        resolution: match resolution {
            0 => blocker::DEFAULT_RESOLUTION,
            n => n as u32,
        },
        max_boxes: match max_boxes {
            0 => blocker::DEFAULT_MAX_BOXES,
            n => n as u32,
        },
        ground: flags & 1 != 0,
    };
    Ok(blocker::make(&shape, &settings).map(|b| {
        let mut out = Vec::with_capacity(16 + b.positions.len() * 4 + b.indices.len() * 4);
        out.extend(((b.positions.len() / 3) as u32).to_le_bytes());
        out.extend((b.indices.len() as u32).to_le_bytes());
        out.extend(b.boxes.to_le_bytes());
        out.extend((b.fill as f32).to_le_bytes());
        for v in &b.positions {
            out.extend(v.to_le_bytes());
        }
        for i in &b.indices {
            out.extend(i.to_le_bytes());
        }
        out
    }))
}

/// A clip's tracks baked on its frames ([`bake`]), from a request in the layout of the module's
/// documentation. The response holds little-endian 32-bit words: the frame count, then each
/// frame's time as a float. Then, track by track in the request's order, the track's kind and its
/// value count: kind 0 for rotation keys as 16-bit integers, and kind 1 for
/// floats.
///
/// # Errors
/// When the request is shorter than its header, its tracks break the staging layout, or the
/// engine would refuse the clip.
pub fn clip_bytes(request: &[u8]) -> Result<Vec<u8>, String> {
    let head: Vec<u32> = words(request.get(..12).ok_or("the request has no header")?)
        .map(u32::from_le_bytes)
        .collect();
    let (tracks, joints, rate) = (head[0], head[1], f32::from_bits(head[2]));
    let body = &request[12..];
    if !body.len().is_multiple_of(4) {
        return Err(format!(
            "the clip's {} bytes are not whole words",
            body.len()
        ));
    }
    let staged: Vec<u32> = words(body).map(u32::from_le_bytes).collect();
    let sources = staged_tracks(&staged, tracks as usize).map_err(|e| format!("{e:?}"))?;
    let baked = bake(&sources, joints, rate).map_err(|e| format!("{e:?}"))?;
    let mut out = Vec::new();
    out.extend((baked.times.len() as u32).to_le_bytes());
    for time in &baked.times {
        out.extend(time.to_le_bytes());
    }
    for track in &baked.tracks {
        match track {
            BakedKeys::Rotations(keys) => {
                out.extend(0u32.to_le_bytes());
                out.extend((keys.len() as u32).to_le_bytes());
                // Four integers a key fill whole words.
                for key in keys {
                    out.extend(key.to_le_bytes());
                }
            }
            BakedKeys::Floats(values) => {
                out.extend(1u32.to_le_bytes());
                out.extend((values.len() as u32).to_le_bytes());
                for value in values {
                    out.extend(value.to_le_bytes());
                }
            }
        }
    }
    Ok(out)
}

/// The KTX2 file of the environment map in the request's layout, or why it could not be built.
///
/// # Errors
/// When the request is shorter than its settings, names an unknown kind or format, or the
/// environment cannot be built.
pub fn environment_bytes(request: &[u8]) -> Result<Vec<u8>, String> {
    use environment::{DEFAULT_SAMPLES, Settings, Source, TexelFormat, build};
    let mut head =
        words(request.get(..16).ok_or("the request has no settings")?).map(u32::from_le_bytes);
    let mut next = || head.next().unwrap_or(0);
    let (kind, size, format, samples) = (next(), next(), next(), next());
    let body = &request[16..];
    let name;
    let source = match kind {
        0 => Source::File(body),
        1 => {
            name = std::str::from_utf8(body).map_err(|_| "the built-in name is not text")?;
            Source::Builtin(name)
        }
        _ => return Err(format!("the request names the unknown source kind {kind}")),
    };
    let format = match format {
        0 => TexelFormat::Rgb9e5,
        1 => TexelFormat::Rgba16Float,
        _ => {
            return Err(format!(
                "the request names the unknown texel format {format}"
            ));
        }
    };
    let samples = if samples == 0 {
        DEFAULT_SAMPLES
    } else {
        samples
    };
    build(
        &source,
        &Settings {
            size: size as usize,
            format,
            samples,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request_of(positions: &[f32], indices: &[u32]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend(((positions.len() / 3) as u32).to_le_bytes());
        out.extend((indices.len() as u32).to_le_bytes());
        for p in positions {
            out.extend(p.to_le_bytes());
        }
        for i in indices {
            out.extend(i.to_le_bytes());
        }
        out
    }

    #[test]
    fn the_module_writes_the_cores_stored_tree() {
        let positions: Vec<f32> = (0..30)
            .flat_map(|i| {
                let x = (i % 6) as f32;
                let z = (i / 6) as f32;
                [x, (x * 0.7).sin() * z, z]
            })
            .collect();
        let indices: Vec<u32> = (0..4u32)
            .flat_map(|z| (0..5u32).map(move |x| (z, x)))
            .flat_map(|(z, x)| {
                let a = z * 6 + x;
                [a, a + 6, a + 1, a + 1, a + 6, a + 7]
            })
            .collect();
        let bytes = mesh_bvh_bytes(&request_of(&positions, &indices)).expect("a tree");
        let mesh = IndexedTriangles {
            positions: &positions,
            indices: &indices,
        };
        assert_eq!(bytes, MeshBvh::build(&mesh).expect("a tree").to_bytes());
        assert!(MeshBvh::from_bytes(&bytes, &mesh).is_ok());
    }

    #[test]
    fn a_request_that_breaks_its_layout_gives_a_message() {
        let good = request_of(&[0.0; 9], &[0, 1, 2]);
        assert!(mesh_bvh_bytes(&good[..good.len() - 1]).is_err());
        assert!(mesh_bvh_bytes(&request_of(&[0.0; 9], &[0, 1, 3])).is_err());
        assert!(mesh_bvh_bytes(&request_of(&[0.0; 9], &[0, 1])).is_err());
        assert!(mesh_bvh_bytes(&[1, 2]).is_err());
    }

    /// A track of a clip request: joint, channel, interpolation, times and values.
    type RequestTrack<'a> = (u32, u32, u32, &'a [f32], &'a [f32]);

    /// A clip request of `tracks`.
    fn clip_request(joints: u32, tracks: &[RequestTrack<'_>]) -> Vec<u8> {
        let mut out = Vec::new();
        for word in [tracks.len() as u32, joints, 0] {
            out.extend(word.to_le_bytes());
        }
        for &(joint, channel, interpolation, times, _) in tracks {
            for word in [joint, channel, interpolation, times.len() as u32] {
                out.extend(word.to_le_bytes());
            }
        }
        for &(.., times, values) in tracks {
            for v in times.iter().chain(values) {
                out.extend(v.to_le_bytes());
            }
        }
        out
    }

    #[test]
    fn the_module_bakes_clips_on_the_cores_frames() {
        // A rotation at uneven times, and a translation that never changes.
        let times = [0.0, 0.1, 0.45];
        let turn = [
            0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.38268343, 0.9238795, 0.0, 0.0, 0.70710677, 0.70710677,
        ];
        let still = [1.0, 2.0, 3.0, 1.0, 2.0, 3.0, 1.0, 2.0, 3.0];
        let request = clip_request(2, &[(0, 1, 0, &times, &turn), (1, 0, 0, &times, &still)]);
        let bytes = clip_bytes(&request).expect("a clip");
        let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
        // 30 keys a second, adjusted to end on the last key: 14 intervals.
        let frames = word(0) as usize;
        assert_eq!(frames, 15);
        let last = f32::from_le_bytes(bytes[4 * frames..4 * frames + 4].try_into().unwrap());
        assert_eq!(last, 0.45);
        let at = 4 + 4 * frames;
        assert_eq!((word(at), word(at + 4)), (0, 4 * frames as u32));
        let first: Vec<i16> = (0..4)
            .map(|c| i16::from_le_bytes(bytes[at + 8 + 2 * c..at + 10 + 2 * c].try_into().unwrap()))
            .collect();
        assert_eq!(first, [0, 0, 0, 32767]);
        let at = at + 8 + 8 * frames;
        assert_eq!((word(at), word(at + 4)), (1, 3));
        assert_eq!(bytes.len(), at + 8 + 12);
        assert!(clip_bytes(&request[..request.len() - 4]).is_err());
        assert!(clip_bytes(&clip_request(1, &[(1, 0, 0, &[0.0], &[0.0; 3])])).is_err());
    }
}
