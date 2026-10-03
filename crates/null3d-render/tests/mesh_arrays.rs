//! Meshes from arrays compute the normals and tangents that three.js computes, bit for bit, and
//! the same whether job workers help or not.
#![allow(clippy::disallowed_methods)] // Native job workers are threads.

#[path = "fixtures/three_mesh_arrays.rs"]
mod three;

use std::thread;

use null3d_core::jobs::JobSystem;
use null3d_gpu::drawlist::vertex;
use null3d_render::arrays::{MeshArrays, from_arrays};
use null3d_render::geometry::Geometry;

fn floats(bits: &[u32]) -> Vec<f32> {
    bits.iter().map(|&b| f32::from_bits(b)).collect()
}

/// Runs `f` with a job system whose workers are native threads.
fn with_workers<R>(workers: u32, f: impl FnOnce(&JobSystem) -> R) -> R {
    let jobs = JobSystem::new(workers);
    thread::scope(|scope| {
        for i in 0..workers {
            let jobs = &jobs;
            scope.spawn(move || jobs.worker_loop(i));
        }
        let result = f(&jobs);
        jobs.shutdown();
        result
    })
}

/// The bits of the attribute at `location` of every vertex.
fn attribute_bits(g: &Geometry, location: usize) -> Vec<u32> {
    g.attribute(location).iter().map(|f| f.to_bits()).collect()
}

#[test]
fn normals_and_tangents_match_three_js_bit_for_bit() {
    let positions = floats(&three::indexed::POSITIONS);
    let uvs = floats(&three::indexed::UVS);
    let g = from_arrays(
        &MeshArrays {
            positions: (&positions[..]).into(),
            uvs: Some((&uvs[..]).into()),
            indices: Some(&three::indexed::INDICES),
            compute_normals: true,
            compute_tangents: true,
            ..MeshArrays::default()
        },
        &JobSystem::new(0),
    )
    .unwrap();
    assert_eq!(g.format, vertex::UV0 | vertex::TANGENT);
    assert_eq!(attribute_bits(&g, 1), three::indexed::NORMALS);
    assert_eq!(attribute_bits(&g, 4), three::indexed::TANGENTS);

    // Without indices, each vertex takes its triangle's normal, as three.js's soup of triangles.
    let positions = floats(&three::soup::POSITIONS);
    let g = from_arrays(
        &MeshArrays {
            positions: (&positions[..]).into(),
            compute_normals: true,
            ..MeshArrays::default()
        },
        &JobSystem::new(0),
    )
    .unwrap();
    assert_eq!(attribute_bits(&g, 1), three::soup::NORMALS);
}

#[test]
fn the_job_workers_compute_the_same_bits_as_one_thread() {
    // An uneven grid of 90,601 vertices: many chunks for the workers to share.
    let (columns, rows) = (300u32, 300u32);
    let (mut positions, mut uvs, mut indices) = (Vec::new(), Vec::new(), Vec::new());
    for y in 0..=rows {
        for x in 0..=columns {
            let (fx, fy) = (x as f32, y as f32);
            positions.extend_from_slice(&[fx, fy, (fx * 0.37).sin() * (fy * 0.23).cos()]);
            uvs.extend_from_slice(&[fx / columns as f32, (fy * 0.7).sin()]);
        }
    }
    let row = columns + 1;
    for y in 0..rows {
        for x in 0..columns {
            let (a, b) = (y * row + x, (y + 1) * row + x);
            indices.extend_from_slice(&[a, a + 1, b, b, a + 1, b + 1]);
        }
    }
    let arrays = MeshArrays {
        positions: (&positions[..]).into(),
        uvs: Some((&uvs[..]).into()),
        indices: Some(&indices),
        compute_normals: true,
        compute_tangents: true,
        ..MeshArrays::default()
    };
    let alone = with_workers(0, |jobs| from_arrays(&arrays, jobs).unwrap());
    let helped = with_workers(3, |jobs| from_arrays(&arrays, jobs).unwrap());
    assert_eq!(alone.vertices, helped.vertices);
}
