//! A production build narrows its builds to the permutation words that a list names: each variant
//! builds the listed words it can make, and an entry built for one list is never reused for another.

mod common;

use std::collections::BTreeSet;
use std::path::Path;

use null3d_shaders::{Inputs, build_names};

/// The list that the showcases' production build reads, recorded from their pages.
const SHOWCASES: &str = "examples/shader-permutations.txt";

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

#[test]
fn the_showcases_list_builds_fewer_words_than_the_whole_manifest() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut inputs = Inputs::read(&root).expect("the repository's shaders");
    let count = |names: &std::collections::BTreeMap<String, Vec<String>>| -> usize {
        names.values().map(Vec::len).sum()
    };
    let full = count(&build_names(&inputs).expect("the whole manifest"));
    let text = std::fs::read_to_string(root.join(SHOWCASES)).expect("the showcases' recorded list");
    for (number, line) in text.lines().enumerate() {
        let word = line.split('#').next().unwrap_or("").trim();
        if word.is_empty() {
            continue;
        }
        let hex = word.strip_prefix("0x").unwrap_or(word);
        let value = u32::from_str_radix(hex, 16)
            .unwrap_or_else(|_| panic!("{SHOWCASES} line {}: `{word}` is not a word", number + 1));
        inputs.only.insert(value);
    }
    assert!(
        inputs.only.contains(&0),
        "the list holds no word without a bit, which the compute and full-screen passes ask for"
    );
    let listed = count(&build_names(&inputs).expect("the listed manifest"));
    println!("the whole manifest builds {full}, and the showcases' list builds {listed}");
    assert!(
        listed < full,
        "the showcases' list builds {listed} of {full}, so it narrows nothing"
    );
    assert!(
        listed < full / 2,
        "the showcases' list builds {listed} of {full}, which is no meaningful narrowing"
    );
}
