//! The patches that a view draws from a tree of cluster patches cover the mesh once: no part of the
//! surface is missing, and none draws twice. The trees are the asset tool's own, for a lumpy pebble
//! and a heightfield (`packages/cli/src/assets/cluster-fixture.ts` writes them, and its unit test
//! keeps them in step with the tool). Each view stands a camera somewhere around or inside the mesh,
//! at one of several thresholds, scales and turns, and the test walks the tree as the job workers
//! do. Every leaf must find exactly one drawn patch on its chain up to the root.
//!
//! The compute pass applies the same rule on the GPU (`cluster_cull.wgsl`). This test reads the
//! pass's table as the layout writes it, for two trees one after the other, and applies the
//! shader's rule to it line by line. The patches it picks must be the walk's. The shader's own
//! lines are pinned below, so a change to the shader that the copy here misses fails the test.

use null3d_core::levels::{LEAST_DISTANCE, LevelRule, LightLens};
use null3d_core::math::Affine;
use null3d_render::patches::PatchTree;

/// The views that each tree is walked from.
const VIEWS: u32 = 2_000;

/// The trees, as the asset tool writes them for this test.
const PEBBLE: &[u8] = include_bytes!("fixtures/cluster-trees/pebble.bin");
const HEIGHTFIELD: &[u8] = include_bytes!("fixtures/cluster-trees/heightfield.bin");

/// The compute pass's shader.
const SHADER: &str = include_str!("../../null3d-shaders/wgsl/cluster_cull.wgsl");

/// A tree from its file: the count of patches and the root's place, then for each patch its
/// sphere's four floats and its record's four integers, all little-endian. The file holds no
/// triangle, so the tree names vertex 0 throughout its runs.
fn load(bytes: &[u8]) -> PatchTree {
    let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    let patches = word(0) as usize;
    let root = word(4);
    assert_eq!(bytes.len(), 8 + patches * 32, "the file holds every patch");
    let bounds: Vec<[f32; 4]> = (0..patches)
        .map(|k| [0, 1, 2, 3].map(|c| f32::from_bits(word(8 + k * 32 + c * 4))))
        .collect();
    let records: Vec<[u32; 4]> = (0..patches)
        .map(|k| [0, 1, 2, 3].map(|c| word(8 + k * 32 + 16 + c * 4)))
        .collect();
    let indices = records.iter().map(|r| r[0] + r[1]).max().unwrap_or(0);
    PatchTree::new(vec![0; indices as usize], bounds, records, root, 1).expect("the tree nests")
}

/// A number from 0 to 1 from an integer hash of `seed`.
fn unit(seed: u32) -> f32 {
    let mut h = seed.wrapping_mul(0x9e37_79b1) ^ 0x2545_f491;
    h ^= h >> 15;
    h = h.wrapping_mul(0x85eb_ca6b);
    h ^= h >> 13;
    h = h.wrapping_mul(0xc2b2_ae35);
    h ^= h >> 16;
    h as f32 / u32::MAX as f32
}

/// One view of a tree: the copy's matrix relative to the camera, and the view's rule.
struct View {
    matrix: Affine,
    rule: LevelRule,
}

/// View `v` of a tree whose root sphere is `root`. Half the cameras stand outside the root's
/// sphere, from just past it to forty times its radius away; the rest stand anywhere in a box a
/// little wider than the sphere, inside the mesh or over its surface. Thresholds run from half a
/// pixel to 16 pixels of a 1080-pixel view, and one view in three scales and turns the copy.
fn view(root: [f32; 4], v: u32) -> View {
    let seed = v * 8;
    let [cx, cy, cz, radius] = root;
    let local = if v.is_multiple_of(2) {
        let z = 2.0 * unit(seed) - 1.0;
        let turn = std::f32::consts::TAU * unit(seed + 1);
        let ring = (1.0 - z * z).max(0.0).sqrt();
        let reach = radius * (1.01f32.ln() + unit(seed + 2) * (40.0f32.ln() - 1.01f32.ln())).exp();
        [
            cx + ring * turn.cos() * reach,
            cy + z * reach,
            cz + ring * turn.sin() * reach,
        ]
    } else {
        let at = |k: u32| (2.0 * unit(seed + k) - 1.0) * radius * 1.2;
        [cx + at(0), cy + at(1), cz + at(2)]
    };
    let (scale, angle) = if v.is_multiple_of(3) {
        (
            0.5 + 2.5 * unit(seed + 3),
            std::f32::consts::TAU * unit(seed + 4),
        )
    } else {
        (1.0, 0.0)
    };
    let (sin, cos) = angle.sin_cos();
    // The copy turns about the vertical axis and scales evenly; the camera sees it from where the
    // local camera would stand.
    let rows = [[cos, 0.0, sin], [0.0, 1.0, 0.0], [-sin, 0.0, cos]];
    let mut matrix = [0.0; 12];
    for (r, row) in rows.iter().enumerate() {
        let camera = scale * (row[0] * local[0] + row[1] * local[1] + row[2] * local[2]);
        for c in 0..3 {
            matrix[r * 4 + c] = scale * row[c];
        }
        matrix[r * 4 + 3] = -camera;
    }
    let threshold = [0.5, 1.0, 2.0, 4.0, 16.0][(v % 5) as usize];
    let p11 = 1.0 / (30.0f32.to_radians()).tan();
    let camera = LevelRule::new(1080.0, p11, false, threshold, 0.0);
    // One view in seven is a light's orthographic view, whose texels run from a ten-thousandth of
    // the root's radius to a tenth, and one in seven a light's perspective view from a point near
    // the copy, as a shadow cascade and a spot light's tile pick.
    let rule = match v % 7 {
        1 => {
            let texel = radius * scale * (1.0e-4f32.ln() * (1.0 - unit(seed + 5))).exp() * 0.1;
            LevelRule::for_light(&camera, LightLens::Parallel { texel }, threshold)
        }
        4 => {
            let at = |k: u32| (2.0 * unit(seed + 5 + k) - 1.0) * radius * scale * 3.0;
            let eye = [at(0), at(1), at(2)];
            let texel = (1.0e-4f32.ln() * (1.0 - unit(seed + 6))).exp() * 0.01;
            LevelRule::for_light(&camera, LightLens::Point { eye, texel }, threshold)
        }
        _ => camera,
    };
    View { matrix, rule }
}

/// The patches with no children.
fn leaves(tree: &PatchTree) -> Vec<u32> {
    let mut children = vec![0u32; tree.len()];
    for patch in 0..tree.len() as u32 {
        if let Some(parent) = tree.parent(patch) {
            children[parent as usize] += 1;
        }
    }
    (0..tree.len() as u32)
        .filter(|&patch| children[patch as usize] == 0)
        .collect()
}

/// The patches that the walk picks in a view, with no frustum, as a flag for each patch.
fn walk(tree: &PatchTree, view: &View) -> Vec<bool> {
    let mut picked = vec![false; tree.len()];
    tree.walk(&view.matrix, [0.0; 3], &view.rule, None, |patch| {
        picked[patch as usize] = true;
    });
    picked
}

/// The leaves that no drawn patch covers, and those that two or more cover, in a view's picks.
fn holes_and_doubles(tree: &PatchTree, leaves: &[u32], picked: &[bool]) -> (usize, usize) {
    let (mut holes, mut doubles) = (0, 0);
    for &leaf in leaves {
        let mut drawn = 0;
        let mut at = Some(leaf);
        while let Some(patch) = at {
            drawn += usize::from(picked[patch as usize]);
            at = tree.parent(patch);
        }
        holes += usize::from(drawn == 0);
        doubles += usize::from(drawn > 1);
    }
    (holes, doubles)
}

#[test]
fn every_view_draws_each_part_of_a_real_tree_once() {
    for (name, bytes) in [("pebble", PEBBLE), ("heightfield", HEIGHTFIELD)] {
        let tree = load(bytes);
        let leaves = leaves(&tree);
        let root = tree.bounds()[tree.root() as usize];
        let (mut fewest, mut most) = (usize::MAX, 0);
        let mut wrong = Vec::new();
        for v in 0..VIEWS {
            let picked = walk(&tree, &view(root, v));
            let drawn = picked.iter().filter(|&&p| p).count();
            fewest = fewest.min(drawn);
            most = most.max(drawn);
            let (holes, doubles) = holes_and_doubles(&tree, &leaves, &picked);
            if holes > 0 || doubles > 0 {
                wrong.push((v, holes, doubles));
            }
        }
        assert!(
            wrong.is_empty(),
            "{name}: {} of {VIEWS} views leave holes or draw twice, as (view, holes, doubles): {:?}",
            wrong.len(),
            &wrong[..wrong.len().min(8)]
        );
        // The views reach from the coarse top of the tree to its leaves, so the test covers cuts
        // through every depth.
        assert!(
            fewest < leaves.len() / 8,
            "{name}: the coarsest view drew {fewest} patches"
        );
        assert!(
            most >= leaves.len() / 2,
            "{name}: the finest view drew {most} patches"
        );
    }
}

/// The shader's level rule, line for line as `run_of` in `cluster_cull.wgsl` applies it to the
/// pass's table, with every frustum plane passing: the patch's index count where it draws, else 0.
/// `rows` is the copy's matrix relative to the camera, as the view's compacted instances hold it.
fn shader_run(table: &[[u32; 8]], at: usize, rows: &Affine, rule: &LevelRule) -> u32 {
    let float = |word: u32| f32::from_bits(word);
    let m0 = [rows[0], rows[1], rows[2], rows[3]];
    let m1 = [rows[4], rows[5], rows[6], rows[7]];
    let m2 = [rows[8], rows[9], rows[10], rows[11]];
    let length = |v: [f32; 3]| (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    let dot = |m: [f32; 4], v: [f32; 4]| m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3] * v[3];
    let scale = length([m0[0], m1[0], m2[0]])
        .max(length([m0[1], m1[1], m2[1]]).max(length([m0[2], m1[2], m2[2]])));
    let placed = |record: &[u32; 8]| {
        let local = [float(record[0]), float(record[1]), float(record[2]), 1.0];
        [
            dot(m0, local),
            dot(m1, local),
            dot(m2, local),
            float(record[3]) * scale,
        ]
    };
    let [eye_x, eye_y, eye_z, mode] = rule.measure_uniform();
    let rule_distance = |sphere: [f32; 4]| {
        if mode > 1.5 {
            let from = [sphere[0] - eye_x, sphere[1] - eye_y, sphere[2] - eye_z];
            return (length(from) - sphere[3]).max(LEAST_DISTANCE);
        }
        let nearest = (length([sphere[0], sphere[1], sphere[2]]) - sphere[3]).max(LEAST_DISTANCE);
        if rule.orthographic || mode > 0.5 {
            1.0
        } else {
            nearest
        }
    };
    let record = &table[at];
    let factor = rule.factor;
    let reach = if factor > 0.0 { scale * factor } else { 3.0e38 };
    if float(record[7]) * reach >= rule_distance(placed(record)) {
        return 0;
    }
    if record[6] != 0 {
        let parent = &table[record[6] as usize - 1];
        if float(parent[7]) * reach < rule_distance(placed(parent)) {
            return 0;
        }
    }
    record[5]
}

#[test]
fn the_compute_pass_picks_the_patches_that_the_walk_picks() {
    // The lines of the shader that the copy above follows. A change to any of them must change
    // the copy, and the walk with it.
    for line in [
        "const LEAST_DISTANCE: f32 = 1.0e-3;",
        "    let local = vec4f(record.centre, 1.0);\n    return vec4f(dot(m0, local), dot(m1, local), dot(m2, local), record.radius * scale);",
        "    if params.measure.w > 1.5 {\n        return max(length(sphere.xyz - params.measure.xyz) - sphere.w, LEAST_DISTANCE);\n    }\n    let nearest = max(length(sphere.xyz) - sphere.w, LEAST_DISTANCE);\n    return select(nearest, 1.0, params.levels.y > 0.5 || params.measure.w > 0.5);",
        "const OFF_REACH: f32 = 3.0e38;",
        "    let sphere = placed(record, m0, m1, m2, scale);",
        "    let factor = params.levels.x;\n    let reach = select(OFF_REACH, scale * factor, factor > 0.0);\n    if record.error * reach >= rule_distance(sphere) {\n        return 0u;\n    }",
        "    if record.parent != 0u {\n        let parent = patch_of(record.parent - 1u);\n        if parent.error * reach < rule_distance(placed(parent, m0, m1, m2, scale)) {\n            return 0u;\n        }\n    }\n    return record.count;",
    ] {
        assert!(SHADER.contains(line), "the shader's rule moved:\n{line}");
    }
    assert_eq!(LEAST_DISTANCE, 1.0e-3);

    // The scene's table holds the heightfield's patches, then the pebble's, as the layout writes
    // two cluster meshes, so the pebble's parents name places past the heightfield's patches.
    let trees = [load(HEIGHTFIELD), load(PEBBLE)];
    let mut table = Vec::new();
    let mut firsts = Vec::new();
    let mut indices = 0;
    for tree in &trees {
        let first = table.len() as u32;
        firsts.push(first as usize);
        table.extend((0..tree.len() as u32).map(|patch| tree.table_record(patch, first, indices)));
        indices += tree.indices().len() as u32;
    }
    let mut mismatches = Vec::new();
    for (t, tree) in trees.iter().enumerate() {
        let root = tree.bounds()[tree.root() as usize];
        for v in 0..VIEWS / 4 {
            let view = view(root, v);
            let picked = walk(tree, &view);
            for (patch, &walked) in picked.iter().enumerate() {
                let shader = shader_run(&table, firsts[t] + patch, &view.matrix, &view.rule) != 0;
                if shader != walked {
                    mismatches.push((t, v, patch));
                }
            }
        }
    }
    assert!(
        mismatches.is_empty(),
        "{} patches differ between the shader's rule and the walk, as (tree, view, patch): {:?}",
        mismatches.len(),
        &mismatches[..mismatches.len().min(8)]
    );
}

#[test]
fn the_rule_compares_open_bounds_and_draws_the_frontier() {
    // The walk draws while the error is under the distance, and not when the two are equal, as
    // the shader's `>=` refuses. A patch that has a child compares its own error; the child below
    // it has no child of its own, so it draws at every distance in place of the patches that have
    // not arrived.
    let tree = PatchTree::new(
        vec![0, 1, 2, 0, 1, 2],
        vec![[0.0, 0.0, 0.0, 1.0]; 2],
        vec![[0, 3, 0, 0.1f32.to_bits()], [3, 3, 1, 0.0f32.to_bits()]],
        0,
        3,
    )
    .unwrap();
    assert!(
        !tree.draws(0, 100.0, 10.0, |_| 10.0),
        "the boundary is open"
    );
    assert!(tree.draws(0, 100.0, 10.001, |_| 10.001));
    assert!(tree.draws(1, 100.0, 10.0, |_| 10.0), "the frontier draws");
}

#[test]
fn the_count_stage_skips_a_tree_that_this_frame_did_not_place() {
    // After the camera jumps from one tree to another, the tree that left the view still holds the
    // last frame's copy and its matrix. The culling pass writes the tree's instance count for this
    // frame, so a count of zero must stop the tree before it counts its stale patches: otherwise
    // those counts move every later tree's offset and the tree in view draws with holes.
    let guard = "let drawn = indirect[(params.counts.w + mesh.first_draw) * INDIRECT_WORDS + 1u];\n    if drawn == 0u {\n        return 0u;\n    }";
    let run_of = SHADER
        .split("fn run_of(")
        .nth(1)
        .and_then(|rest| rest.split("fn count_patch(").next())
        .expect("the shader counts a patch's run");
    assert!(
        run_of.contains(guard),
        "a tree that the frame did not place counts its stale patches"
    );
}
