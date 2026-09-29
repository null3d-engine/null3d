//! Places in source files. The checks and the shader composer both read a copy of each file that
//! the composer's preprocessor wrote, so every place they find is first mapped back to the file.

/// A place in a source file: a 1-based line and a 1-based column, counted in characters.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Position {
    /// The line.
    pub line: u32,
    /// The column.
    pub column: u32,
}

/// The place in `original` of the byte at `offset` in `preprocessed`, a copy of `original` that
/// the composer's preprocessor wrote. The preprocessor keeps every line in place and blanks the
/// lines that shader defs hide, but it replaces names: an imported name becomes a longer
/// decorated one, and `#NAME` becomes a shader def's value. So the line is the same in both
/// texts, and a walk along the two copies of the line pairs names one for one, and every other
/// character one for one.
pub(crate) fn locate(original: &str, preprocessed: &str, offset: usize) -> Position {
    let mut offset = offset.min(preprocessed.len());
    while !preprocessed.is_char_boundary(offset) {
        offset -= 1;
    }
    let before = &preprocessed[..offset];
    let line_start = before.rfind('\n').map_or(0, |index| index + 1);
    let line = before.bytes().filter(|&byte| byte == b'\n').count();
    let preprocessed_line = preprocessed[line_start..]
        .split('\n')
        .next()
        .unwrap_or_default();
    let original_line = original.split('\n').nth(line).unwrap_or_default();
    Position {
        line: to_u32(line + 1),
        column: column(
            original_line.trim_end_matches('\r'),
            preprocessed_line,
            offset - line_start,
        ),
    }
}

/// The column in `original` of the byte at `offset` in `preprocessed`, the same line after the
/// preprocessor. A place inside a name that the preprocessor replaced maps to the name's start.
/// Where the lines differ in any other way, the rest of the walk counts along `preprocessed`.
fn column(original: &str, preprocessed: &str, offset: usize) -> u32 {
    let (mut in_original, mut in_preprocessed) = (0, 0);
    let mut column = 1;
    while in_preprocessed < offset {
        let rest = &preprocessed[in_preprocessed..];
        match (original[in_original..].chars().next(), rest.chars().next()) {
            (Some(a), Some(b)) if is_name_start(a) && is_name_start(b) => {
                let original_end = name_end(original, in_original);
                let preprocessed_end = name_end(preprocessed, in_preprocessed);
                let name = &original[in_original..original_end];
                if offset < preprocessed_end {
                    return if name == &preprocessed[in_preprocessed..preprocessed_end] {
                        column + chars(&preprocessed[in_preprocessed..offset])
                    } else {
                        column
                    };
                }
                column += chars(name);
                (in_original, in_preprocessed) = (original_end, preprocessed_end);
            }
            (Some(a), Some(b)) if a == b => {
                column += 1;
                in_original += a.len_utf8();
                in_preprocessed += b.len_utf8();
            }
            _ => return column + chars(&preprocessed[in_preprocessed..offset]),
        }
    }
    column
}

fn is_name_start(c: char) -> bool {
    c == '_' || c.is_alphabetic()
}

/// The end of the name that starts at `start`, with any `::` path in it, as the composer reads
/// `null3d::math::square` as one name.
fn name_end(text: &str, start: usize) -> usize {
    let mut end = start;
    loop {
        let rest = &text[end..];
        if let Some(c) = rest
            .chars()
            .next()
            .filter(|&c| c == '_' || c.is_alphanumeric())
        {
            end += c.len_utf8();
        } else if rest.starts_with("::") && rest[2..].chars().next().is_some_and(is_name_start) {
            end += 2;
        } else {
            return end;
        }
    }
}

fn chars(text: &str) -> u32 {
    to_u32(text.chars().count())
}

/// Converts a line or a column count. Shader sources are far smaller than 4 GB.
pub(crate) fn to_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(line: u32, column: u32) -> Position {
        Position { line, column }
    }

    #[test]
    fn an_unchanged_text_maps_to_itself() {
        let text = "fn a() {\n    let é = 1;\n}\n";
        assert_eq!(locate(text, text, 0), at(1, 1));
        assert_eq!(locate(text, text, text.find("let").unwrap()), at(2, 5));
        assert_eq!(locate(text, text, text.find('=').unwrap()), at(2, 11));
        assert_eq!(locate(text, text, text.len()), at(4, 1));
    }

    #[test]
    fn places_after_a_decorated_name_map_back_to_the_original_line() {
        let original = "#import null3d::math\n    let y = null3d::math::square(2.0) 3.0;\n";
        let preprocessed =
            "                    \n    let y = squareX_naga_oil_mod_XNZXW2ZDEX(2.0) 3.0;\n";
        let offset = preprocessed.find("3.0").unwrap();
        assert_eq!(locate(original, preprocessed, offset), at(2, 39));
        let inside = preprocessed.find("naga_oil").unwrap();
        assert_eq!(locate(original, preprocessed, inside), at(2, 13));
        let unchanged = preprocessed.find("2.0").unwrap();
        assert_eq!(locate(original, preprocessed, unchanged + 1), at(2, 35));
    }

    #[test]
    fn a_short_imported_name_that_grew_maps_back_too() {
        let original = "a = square(x) + b;";
        let preprocessed = "a = squareX_naga_oil_mod_XNZXW2ZDEX(x) + b;";
        let offset = preprocessed.find('b').unwrap();
        assert_eq!(locate(original, preprocessed, offset), at(1, 17));
    }

    #[test]
    fn crlf_line_ends_and_offsets_inside_a_character_are_handled() {
        let original = "a\r\nbé c\r\n";
        let preprocessed = "a\nbé c\n";
        assert_eq!(
            locate(original, preprocessed, preprocessed.find('c').unwrap()),
            at(2, 4)
        );
        assert_eq!(locate(original, preprocessed, 4), at(2, 2));
    }
}
