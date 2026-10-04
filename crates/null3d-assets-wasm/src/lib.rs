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
//! - `response()` and `response_length()` give the last call's response.

pub mod blocker;
pub mod environment;

use std::cell::RefCell;

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
}
