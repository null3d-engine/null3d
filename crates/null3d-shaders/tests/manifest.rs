//! The engine's manifest against the figure that the repository records for its build count.
//!
//! The count is a build's cost twice over: the shader build compiles every build, and a page
//! downloads the builds of its path. Nothing else holds it, and each new permutation bit on a lit
//! template multiplies it, so it grows quietly through ordinary feature work. This check makes the
//! count a thing a commit states rather than a thing a reader has to work out.

use std::path::Path;

use null3d_shaders::{BUILD_BUDGET, BuildCounts, Inputs, Manifest};

/// The engine's manifest, as the shader build reads it.
fn repository() -> Manifest {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let inputs = Inputs::read(&root).expect("the repository's shaders");
    Manifest::parse(&inputs.manifest).expect("the repository's manifest")
}

#[test]
fn the_manifests_builds_stay_within_the_recorded_figure() {
    let manifest = repository();
    let problems = manifest.build_budget_problems(BUILD_BUDGET);
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

#[test]
fn a_count_past_the_figure_is_a_problem_that_names_the_figure_and_the_guide() {
    let manifest = repository();
    let counts = manifest.build_counts();
    assert!(counts.glsl > 0 && counts.wgsl > 0, "{counts:?}");
    // One build below each count is a figure that the manifest already passes, so the check has to
    // report both targets and say where the figure and its reason live.
    let problems = manifest.build_budget_problems(BuildCounts {
        glsl: counts.glsl - 1,
        wgsl: counts.wgsl - 1,
    });
    assert_eq!(problems.len(), 2, "{problems:?}");
    assert!(
        problems[0].contains("GLSL") && problems[0].contains("BUILD_BUDGET"),
        "{problems:?}"
    );
    assert!(
        problems[1].contains("WGSL") && problems[1].contains("BUILD_BUDGET"),
        "{problems:?}"
    );
}

/// A CI shard builds a few of the manifest's entries, from a manifest narrowed to those entries.
/// The narrowed manifest must parse: a first-use bit's list of shaders names entries that this
/// shard does not hold, and the narrowing takes those names out rather than leaving a check to
/// refuse the shard.
#[test]
fn a_shards_narrowed_manifest_parses() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let inputs = Inputs::read(&root).expect("the repository's shaders");
    for names in [&["cull"][..], &["moment_lit"][..], &["lit", "sprite"][..]] {
        let narrowed = null3d_shaders::narrowed(&inputs, names);
        Manifest::parse(&narrowed.manifest)
            .unwrap_or_else(|problems| panic!("a shard of {names:?}: {problems:#?}"));
    }
}
