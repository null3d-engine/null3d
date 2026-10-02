//! Half precision. A library module may do its math in 16-bit floats: it starts with
//! `enable f16;` and uses `f16`, `vec3h` and values such as `0.5h`. Only builds that WebGPU
//! devices with the optional feature `shader-f16` load, the WGSL builds of the HALF permutation
//! bit, get the module as written. Every other build gets it widened: each 16-bit float type and
//! value becomes its 32-bit twin, and the directive goes. On WebGL2 the widened functions then run
//! at `mediump`, the precision that GLSL ES offers for such math, and the rest of the shader stays
//! at `highp`.

use crate::scan::{Kind, Token, tokenize};

/// True when a WGSL source enables the `f16` extension.
pub(crate) fn enables_f16(source: &str) -> bool {
    let tokens = tokenize(source);
    directives(&tokens).any(|(_, names)| names.iter().any(|name| name.text == "f16"))
}

/// The source with 32-bit floats in place of 16-bit ones, at the same byte offsets, so a place
/// in one is the same place in the other: `f16` becomes `f32`, `vec3h` becomes `vec3f`, `0.5h`
/// becomes `0.5f`, and the `f16` of an `enable` directive turns into spaces, with the whole
/// directive when it enables nothing else.
pub(crate) fn widened(source: &str) -> String {
    let tokens = tokenize(source);
    let mut text = source.as_bytes().to_vec();
    let blank = |text: &mut Vec<u8>, from: usize, to: usize| {
        for byte in &mut text[from..to] {
            if !byte.is_ascii_whitespace() {
                *byte = b' ';
            }
        }
    };
    let mut in_directive = vec![false; tokens.len()];
    for (range, names) in directives(&tokens) {
        in_directive[range.clone()].fill(true);
        let Some(f16) = names.iter().position(|name| name.text == "f16") else {
            continue;
        };
        if names.len() == 1 {
            let end = tokens[range.end - 1].start + tokens[range.end - 1].text.len();
            blank(&mut text, tokens[range.start].start, end);
            continue;
        }
        // The name and the comma that joins it to the next name, or to the one before.
        let name = names[f16];
        let index = range
            .clone()
            .find(|&i| tokens[i].start == name.start)
            .unwrap_or(range.start);
        let comma = if tokens[index + 1].text == "," {
            index + 1
        } else {
            index - 1
        };
        for i in [index, comma] {
            blank(
                &mut text,
                tokens[i].start,
                tokens[i].start + tokens[i].text.len(),
            );
        }
    }
    for (index, token) in tokens.iter().enumerate() {
        if in_directive[index] {
            continue;
        }
        let last = token.start + token.text.len() - 1;
        if token.kind == Kind::Ident && token.text == "f16" {
            text[token.start + 1..=last].copy_from_slice(b"32");
        } else if (token.kind == Kind::Ident && is_half_float_type(token.text))
            || (token.kind == Kind::Number && is_half_float_value(token.text))
        {
            text[last] = b'f';
        }
    }
    String::from_utf8(text).expect("only ASCII bytes change")
}

/// Each `enable` directive at the top level: the range of its tokens, from `enable` to its `;`,
/// and the names it lists.
fn directives<'a, 't>(
    tokens: &'t [Token<'a>],
) -> impl Iterator<Item = (std::ops::Range<usize>, Vec<Token<'a>>)> + 't {
    let mut depth = 0usize;
    tokens.iter().enumerate().filter_map(move |(index, token)| {
        match token.text {
            "{" => depth += 1,
            "}" => depth = depth.saturating_sub(1),
            _ => {}
        }
        let previous = index.checked_sub(1).map_or("", |p| tokens[p].text);
        if token.text != "enable" || depth != 0 || !matches!(previous, "" | ";" | "}") {
            return None;
        }
        let end = (index + 1..tokens.len()).find(|&i| tokens[i].text == ";")?;
        let names = tokens[index + 1..end]
            .iter()
            .filter(|t| t.kind == Kind::Ident)
            .copied()
            .collect();
        Some((index..end + 1, names))
    })
}

/// True for a 16-bit float type: `f16`, and the vector and matrix aliases that end in `h`.
pub(crate) fn is_half_float_type(name: &str) -> bool {
    if name == "f16" {
        return true;
    }
    let Some(shape) = name.strip_suffix('h') else {
        return false;
    };
    let size = |digit: u8| (b'2'..=b'4').contains(&digit);
    match shape.as_bytes() {
        [b'v', b'e', b'c', n] => size(*n),
        [b'm', b'a', b't', c, b'x', r] => size(*c) && size(*r),
        _ => false,
    }
}

/// True for a 16-bit float value, such as `1.0h`, `2h` or `0x1p-2h`. A hexadecimal value ends in
/// `h` only when it has an exponent, because `h` is not a hexadecimal digit.
pub(crate) fn is_half_float_value(number: &str) -> bool {
    let Some(value) = number.strip_suffix('h') else {
        return false;
    };
    match value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
    {
        Some(hex) => hex.contains(['p', 'P']),
        None => !value.is_empty(),
    }
}

/// GLSL ES that runs the named functions and constants at `mediump`: each of their definitions
/// sits between a default precision statement for `mediump` floats and one that sets `highp` again,
/// so a function's parameters, result and locals, and a constant's value, take the lower
/// precision. naga writes each function and constant at the start of a line, with a function's
/// closing brace alone on a line. Its namer can add an underscore and a number to a name, so a
/// definition matches a name with such a suffix too.
pub(crate) fn mediump_items(source: &str, names: &[String]) -> String {
    if names.is_empty() {
        return source.to_owned();
    }
    let mut out = String::with_capacity(source.len() + names.len() * 64);
    let mut inside = false;
    for line in source.split_inclusive('\n') {
        let constant = !inside && defines_constant(line, names);
        if constant || (!inside && defines_function(line, names)) {
            out.push_str("precision mediump float;\n");
            inside = true;
        }
        out.push_str(line);
        if inside && (constant || line.trim_end() == "}") {
            out.push_str("precision highp float;\n");
            inside = false;
        }
    }
    out
}

/// True when a line of naga's GLSL starts the definition of a function that `names` lists.
fn defines_function(line: &str, names: &[String]) -> bool {
    if line.starts_with(char::is_whitespace) || !line.trim_end().ends_with('{') {
        return false;
    }
    let Some((head, _)) = line.split_once('(') else {
        return false;
    };
    head.split_whitespace()
        .last()
        .is_some_and(|name| is_one_of(name, names))
}

/// True when a line of naga's GLSL declares a constant that `names` lists, on that line alone.
fn defines_constant(line: &str, names: &[String]) -> bool {
    let mut words = line.split_whitespace();
    words.next() == Some("const")
        && line.trim_end().ends_with(';')
        && words.nth(1).is_some_and(|name| is_one_of(name, names))
}

/// True when naga's name for an item is one of `names`, or one of them with the suffix that naga's
/// namer adds.
fn is_one_of(name: &str, names: &[String]) -> bool {
    names.iter().any(|wanted| {
        name.strip_prefix(wanted.as_str()).is_some_and(|rest| {
            rest.is_empty()
                || rest
                    .strip_prefix('_')
                    .is_some_and(|n| n.bytes().all(|b| b.is_ascii_digit()))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widening_keeps_every_offset_and_writes_32_bit_floats() {
        let source = "enable f16;\n#define_import_path null3d::x\nfn f(c: vec3h, m: mat3x3h) -> f16 {\n    // vec3h in a comment stays\n    return f16(c.x) * 0.5h + 2h + m[0].y;\n}\n";
        let wide = widened(source);
        assert_eq!(wide.len(), source.len());
        assert_eq!(wide.lines().next(), Some("           "));
        assert!(
            wide.contains("fn f(c: vec3f, m: mat3x3f) -> f32 {"),
            "{wide}"
        );
        assert!(
            wide.contains("return f32(c.x) * 0.5f + 2f + m[0].y;"),
            "{wide}"
        );
        assert!(wide.contains("// vec3h in a comment stays"), "{wide}");
        assert!(enables_f16(source));
        assert!(!enables_f16(&wide));
    }

    #[test]
    fn widening_keeps_the_other_extensions_of_a_directive() {
        let wide = widened("enable draw_index, f16;\nfn f() -> f16 { return 1h; }\n");
        assert!(wide.starts_with("enable draw_index     ;"), "{wide}");
        assert!(wide.contains("fn f() -> f32 { return 1f; }"), "{wide}");
        let first = widened("enable f16, draw_index;\n");
        assert_eq!(first.trim(), "enable      draw_index;");
    }

    #[test]
    fn named_items_run_at_mediump_and_the_rest_at_highp() {
        let source = "precision highp float;\n\nstruct S {\n    vec3 a;\n};\nconst float LIMIT = 4.0;\nconst float LIMITS = 5.0;\nvec3 shade(vec3 c) {\n    return c;\n}\n\nS shade_1(vec3 c) {\n    return S(c);\n}\n\nvec3 shadow(vec3 c) {\n    return c;\n}\n\nvoid main() {\n    return;\n}\n";
        let names = ["shade".to_owned(), "LIMIT".to_owned()];
        let wrapped = mediump_items(source, &names);
        let expected = "precision highp float;\n\nstruct S {\n    vec3 a;\n};\nprecision mediump float;\nconst float LIMIT = 4.0;\nprecision highp float;\nconst float LIMITS = 5.0;\nprecision mediump float;\nvec3 shade(vec3 c) {\n    return c;\n}\nprecision highp float;\n\nprecision mediump float;\nS shade_1(vec3 c) {\n    return S(c);\n}\nprecision highp float;\n\nvec3 shadow(vec3 c) {\n    return c;\n}\n\nvoid main() {\n    return;\n}\n";
        assert_eq!(wrapped, expected);
        assert_eq!(mediump_items(source, &[]), source);
    }
}
