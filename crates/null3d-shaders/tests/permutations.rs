//! A production build narrows its builds to the permutation words that a list names: each variant
//! builds the listed words it can make, and an entry built for one list is never reused for another.

mod common;

use std::collections::BTreeSet;

use null3d_shaders::build_names;

/// The vertex color bit, as `permutation::VERTEX_COLOR` gives it.
const VERTEX_COLOR: u32 = 4;

/// A fragment shader that draws a color, which takes the vertex color bit.
const SOURCE: &str = r"@fragment
fn fs_main() -> @location(0) vec4f {
    return vec4f(1.0);
}
";

#[test]
fn a_list_narrows_each_entry_to_the_words_it_names() {
    let variants = [(
        "v",
        "{ permutations = [\"VERTEX_COLOR\"], targets = [\"wgsl\"] }",
    )];
    let mut inputs = common::project(SOURCE, &variants, &[]);
    let whole = build_names(&inputs).expect("the whole manifest");
    assert_eq!(whole["shader"], vec!["v", "v_vertex_color"]);

    inputs.only = BTreeSet::from([VERTEX_COLOR]);
    let listed = build_names(&inputs).expect("the listed manifest");
    assert_eq!(listed["shader"], vec!["v_vertex_color"]);

    // A word that a template cannot make builds nothing there, so one list serves every template.
    inputs.only = BTreeSet::from([u32::MAX]);
    let nothing = build_names(&inputs).expect("the listed manifest");
    assert!(nothing["shader"].is_empty());
}

#[test]
fn a_list_word_builds_every_value_of_the_device_bit_it_leaves_out() {
    let variants = [(
        "v",
        "{ permutations = [\"TONE_MAP\", \"VERTEX_COLOR\"], targets = [\"wgsl\"] }",
    )];
    let mut inputs = common::project(SOURCE, &variants, &[]);
    // The recorded word leaves the tone mapping bit out, so the build makes the word for each
    // value of that bit: one list and one set serve the 8-bit path and the HDR path.
    inputs.only = BTreeSet::from([VERTEX_COLOR]);
    let listed = build_names(&inputs).expect("the listed manifest");
    assert_eq!(
        listed["shader"],
        vec!["v_vertex_color", "v_tone_map_vertex_color"]
    );
}

#[test]
fn the_word_without_any_bit_names_a_build() {
    let variants = [(
        "v",
        "{ permutations = [\"VERTEX_COLOR\"], targets = [\"wgsl\"] }",
    )];
    let mut inputs = common::project(SOURCE, &variants, &[]);
    // Compute passes and full-screen passes ask for the word without a bit, so a list needs it.
    inputs.only = BTreeSet::from([0]);
    let listed = build_names(&inputs).expect("the listed manifest");
    assert_eq!(listed["shader"], vec!["v"]);
}
