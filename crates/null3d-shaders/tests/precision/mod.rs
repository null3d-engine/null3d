//! The rules of WebGL2's GLSL ES 3.00 that the tests check every GLSL shader against: its
//! precision rules under the strictest WebGL2 driver, and the built-in functions it lacks.

/// The breaks of GLSL ES 3.00's precision rules in one shader, as messages, under the strictest
/// WebGL2 driver: Arm's Mali compiler. A fragment shader sets the default precision of `float`
/// and `int` before its first declaration, and each sampler uniform names its precision, since
/// most sampler types have no default. Mali finds no precision for an array whose type names its
/// size, in a sized constructor such as `vec3[9](...)` or a declaration such as `vec3[9] x`,
/// although the shader sets one for `float`. The default `highp` holds again after each run of
/// `mediump` functions. Each declaration of a whole number names its precision, as some Adreno
/// drivers keep only 16 bits of one that does not, despite the default.
pub fn precision_breaks(source: &str, fragment: bool) -> Vec<String> {
    let mut breaks = Vec::new();
    let lines: Vec<&str> = source.lines().collect();
    let first_code = lines
        .iter()
        .position(|line| {
            let line = line.trim();
            !line.is_empty() && !line.starts_with('#') && !line.starts_with("precision ")
        })
        .unwrap_or(lines.len());
    let head = if fragment {
        &lines[..first_code]
    } else {
        &lines[..]
    };
    for default in ["precision highp float;", "precision highp int;"] {
        if !head.iter().any(|line| line.trim() == default) {
            breaks.push(format!(
                "`{default}` is missing before the first declaration"
            ));
        }
    }
    let mut mediump = false;
    for (index, line) in lines.iter().enumerate() {
        let at = index + 1;
        let text = line.trim();
        match text {
            "precision mediump float;" => mediump = true,
            "precision highp float;" => mediump = false,
            _ => {}
        }
        if text.starts_with("uniform ")
            && text.contains("sampler")
            && !["highp ", "mediump ", "lowp "]
                .iter()
                .any(|p| text.contains(p))
        {
            breaks.push(format!(
                "line {at}: a sampler uniform without a precision: {text}"
            ));
        }
        if sized_array_type(text) {
            breaks.push(format!("line {at}: an array type with its size: {text}"));
        }
        if integer_without_precision(text) {
            breaks.push(format!(
                "line {at}: a whole number declared without a precision: {text}"
            ));
        }
    }
    if mediump {
        breaks.push("the shader ends at `mediump`, without `precision highp float;`".to_owned());
    }
    breaks
}

/// True when a line of GLSL names an array type with its size, as `T[N](` or `T[N] name`.
fn sized_array_type(text: &str) -> bool {
    let bytes = text.as_bytes();
    text.match_indices('[').any(|(open, _)| {
        let Some(close) = text[open..].find(']').map(|c| open + c) else {
            return false;
        };
        let size = &text[open + 1..close];
        let after_name = open > 0 && (bytes[open - 1].is_ascii_alphanumeric());
        if size.is_empty() || !size.bytes().all(|b| b.is_ascii_digit()) || !after_name {
            return false;
        }
        let after = &text[close + 1..];
        let declares = after
            .strip_prefix(' ')
            .and_then(|rest| rest.bytes().next())
            .is_some_and(|b| b.is_ascii_alphabetic() || b == b'_');
        after.starts_with('(') || declares
    })
}

/// True when a line of GLSL declares a whole number, as a type followed by a name, with no
/// precision before the type.
fn integer_without_precision(text: &str) -> bool {
    const TYPES: [&str; 8] = [
        "int", "uint", "ivec2", "ivec3", "ivec4", "uvec2", "uvec3", "uvec4",
    ];
    let mut previous = "";
    let bytes = text.as_bytes();
    let mut at = 0;
    while at < bytes.len() {
        if !(bytes[at].is_ascii_alphanumeric() || bytes[at] == b'_') {
            at += 1;
            continue;
        }
        let start = at;
        while at < bytes.len() && (bytes[at].is_ascii_alphanumeric() || bytes[at] == b'_') {
            at += 1;
        }
        let word = &text[start..at];
        let named = text[at..]
            .trim_start()
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_alphabetic() || b == b'_');
        if TYPES.contains(&word) && named && !["highp", "mediump", "lowp"].contains(&previous) {
            return true;
        }
        previous = word;
    }
    false
}

/// The built-in functions that GLSL ES 3.10 added, which WebGL2's GLSL ES 3.00 lacks. naga writes
/// some of them for WGSL built-ins: `bitCount` for `countOneBits`, `findMSB` for
/// `firstLeadingBit`, `bitfieldExtract` for `extractBits`.
const GLSL_ES_310_BUILT_INS: [&str; 16] = [
    "bitCount",
    "findLSB",
    "findMSB",
    "bitfieldExtract",
    "bitfieldInsert",
    "bitfieldReverse",
    "uaddCarry",
    "usubBorrow",
    "umulExtended",
    "imulExtended",
    "frexp",
    "ldexp",
    "packUnorm4x8",
    "packSnorm4x8",
    "unpackUnorm4x8",
    "unpackSnorm4x8",
];

/// The calls of a GLSL shader to built-in functions that WebGL2 lacks, as messages. A program
/// that calls one does not compile in any WebGL2 browser.
pub fn newer_built_in_calls(source: &str) -> Vec<String> {
    let mut calls = Vec::new();
    for (index, line) in source.lines().enumerate() {
        for name in GLSL_ES_310_BUILT_INS {
            let called = line.match_indices(name).any(|(at, _)| {
                let before = line[..at].bytes().next_back();
                let named_alone = !before.is_some_and(|b| b.is_ascii_alphanumeric() || b == b'_');
                named_alone && line[at + name.len()..].starts_with('(')
            });
            if called {
                calls.push(format!(
                    "line {}: `{name}` is GLSL ES 3.10, which WebGL2 lacks: {}",
                    index + 1,
                    line.trim()
                ));
            }
        }
    }
    calls
}
