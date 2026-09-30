//! Each geometry generator builds the arrays that its three.js class builds from the same
//! arguments, bit for bit: the positions, the normals, the texture coordinates and the indices.

#[path = "fixtures/three_geometry.rs"]
mod three;

use null3d_render::geometry::{Geometry, SHAPE_FORMAT, Shape, generate};

/// FNV-1a over the little-endian bytes of 32-bit words, as the fixture script computes it.
fn digest(words: impl IntoIterator<Item = u32>) -> u64 {
    words
        .into_iter()
        .flat_map(u32::to_le_bytes)
        .fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
        })
}

/// The digest of one attribute of every vertex: `count` floats from float `first` of each.
fn attribute(g: &Geometry, first: usize, count: usize) -> u64 {
    let values = g.vertices.chunks(g.vertex_floats());
    digest(values.flat_map(|v| v[first..first + count].iter().map(|f| f.to_bits())))
}

fn shape(name: &str) -> Shape {
    match name {
        "box" => Shape::Box,
        "sphere" => Shape::Sphere,
        "plane" => Shape::Plane,
        "cylinder" => Shape::Cylinder,
        "torus" => Shape::Torus,
        "capsule" => Shape::Capsule,
        "circle" => Shape::Circle,
        "ring" => Shape::Ring,
        _ => panic!("the fixture names no generator {name}"),
    }
}

#[test]
fn every_generator_builds_three_js_arrays_bit_for_bit() {
    let mut differences = Vec::new();
    for case in &three::CASES {
        let g = generate(shape(case.shape), case.args.map(f64::from_bits)).unwrap();
        assert_eq!(g.format, SHAPE_FORMAT);
        let counts = (g.vertex_count(), g.indices.len());
        if counts != (case.vertices, case.indices) {
            differences.push(format!(
                "{}: {counts:?} vertices and indices, not {:?}",
                case.name,
                (case.vertices, case.indices)
            ));
            continue;
        }
        let arrays = [
            ("positions", attribute(&g, 0, 3), case.positions),
            ("normals", attribute(&g, 3, 3), case.normals),
            ("texture coordinates", attribute(&g, 6, 2), case.uvs),
            ("indices", digest(g.indices.iter().copied()), case.triangles),
        ];
        for (array, found, expected) in arrays {
            if found != expected {
                differences.push(format!("{}: the {array} differ", case.name));
            }
        }
    }
    assert!(
        differences.is_empty(),
        "arrays that differ from three.js's:\n{}",
        differences.join("\n")
    );
}

#[test]
fn the_fixture_covers_every_generator() {
    for shape_kind in Shape::ALL {
        assert!(
            three::CASES
                .iter()
                .any(|case| shape(case.shape) == shape_kind),
            "no fixture for {shape_kind:?}"
        );
    }
}
