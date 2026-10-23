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
