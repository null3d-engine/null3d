//! The precision rules of GLSL ES 3.00 under the strictest WebGL2 driver, which the tests check
//! every GLSL shader against.

/// The breaks of GLSL ES 3.00's precision rules in one shader, as messages, under the strictest
/// WebGL2 driver: Arm's Mali compiler. A fragment shader sets the default precision of `float`
/// and `int` before its first declaration, and each sampler uniform names its precision, since
/// most sampler types have no default. Mali finds no precision for an array whose type names its
/// size, in a sized constructor such as `vec3[9](...)` or a declaration such as `vec3[9] x`,
/// although the shader sets one for `float`. The default `highp` holds again after each run of
/// `mediump` functions.
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
