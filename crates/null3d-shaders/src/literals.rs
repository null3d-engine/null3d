//! Number literals in written WGSL that every browser's WGSL parser reads.
//!
//! naga writes a 32-bit float in plain decimal notation, so 1e30 becomes a whole number of 31
//! digits. The WGSL grammar allows that, but Safari's parser before WebKit 313133@main (Safari 26
//! and older) reads a literal with no decimal point and no exponent as a signed 64-bit integer
//! first, suffix or not, and refuses one that does not fit. The build writes each float in its
//! exponent form when that form is shorter, which every whole number of 19 or more digits is: the
//! exponent form of a 32-bit float has at most 9 significant digits and a 2-digit exponent.

use crate::scan::{self, Kind};

/// The WGSL with each float literal written in the shorter of its plain and exponent forms.
pub(crate) fn compact_floats(wgsl: &str) -> String {
    let mut text = String::with_capacity(wgsl.len());
    let mut copied = 0;
    for token in scan::tokenize(wgsl) {
        if token.kind != Kind::Number {
            continue;
        }
        if let Some(short) = exponent_form(token.text) {
            text.push_str(&wgsl[copied..token.start]);
            text.push_str(&short);
            copied = token.start + token.text.len();
        }
    }
    text.push_str(&wgsl[copied..]);
    text
}

/// The exponent form of a decimal float literal with an `f` or `h` suffix, when it is shorter.
/// Rust's exponent form is the shortest that reads back as the same 32-bit float, and a half
/// float's value is a 32-bit float too, so the value does not change.
fn exponent_form(literal: &str) -> Option<String> {
    if is_hex(literal) {
        return None;
    }
    let digits = literal
        .strip_suffix('f')
        .or_else(|| literal.strip_suffix('h'))?;
    let suffix = &literal[digits.len()..];
    let value: f32 = digits.parse().ok()?;
    let short = format!("{value:e}{suffix}");
    (short.len() < literal.len()).then_some(short)
}

fn is_hex(literal: &str) -> bool {
    literal.starts_with("0x") || literal.starts_with("0X")
}

/// The number literals in WGSL that Safari's parser before WebKit 313133@main refuses: those with
/// no decimal point and no exponent whose digits do not fit a signed 64-bit integer, whatever
/// their suffix. Newer WebKit, Chrome, Firefox and naga read them all.
pub fn literals_safari_refuses(wgsl: &str) -> Vec<&str> {
    scan::tokenize(wgsl)
        .into_iter()
        .filter(|token| token.kind == Kind::Number && !fits_safari_integer(token.text))
        .map(|token| token.text)
        .collect()
}

/// False for a literal without a fraction or an exponent whose value does not fit an `i64`.
fn fits_safari_integer(literal: &str) -> bool {
    let hex = is_hex(literal);
    let unsuffixed = literal.trim_end_matches(if hex {
        &['i', 'u'][..]
    } else {
        &['i', 'u', 'f', 'h'][..]
    });
    if hex {
        let digits = &unsuffixed[2..];
        digits.contains(['.', 'p', 'P']) || i64::from_str_radix(digits, 16).is_ok()
    } else {
        unsuffixed.contains(['.', 'e', 'E']) || unsuffixed.parse::<i64>().is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn large_and_tiny_floats_take_the_exponent_form_and_others_keep_theirs() {
        let wgsl = "let a = -1000000000000000000000000000000f;\nlet b = 0.000000000001f;\n\
                    let c = vec2f(0.25f, 1f);\nlet d = 1000h;\nlet e = 16777216f;\n\
                    let f = 0x1fu + 4294967295u;\nlet vec2f_1e30 = 1e30f;\n";
        assert_eq!(
            compact_floats(wgsl),
            "let a = -1e30f;\nlet b = 1e-12f;\nlet c = vec2f(0.25f, 1f);\nlet d = 1e3h;\n\
             let e = 16777216f;\nlet f = 0x1fu + 4294967295u;\nlet vec2f_1e30 = 1e30f;\n"
        );
    }

    #[test]
    fn every_float_keeps_its_value() {
        for value in [
            1e30f32,
            -3.402_823_5e38,
            1.175_494_4e-38,
            1e-45,
            0.1,
            123_456_790.0,
        ] {
            let literal = format!("{value}f");
            let written = exponent_form(&literal).unwrap_or(literal);
            let read: f32 = written.trim_end_matches('f').parse().unwrap();
            assert_eq!(read.to_bits(), value.to_bits(), "{written}");
        }
    }

    #[test]
    fn safari_refuses_whole_numbers_past_a_signed_64_bit_integer() {
        let wgsl = "1000000000000000000000000000000f 9223372036854775807 9223372036854775808f \
                    1e30f 1000000000000000000000000000000.0f 0x7fffffffffffffffu \
                    0x10000000000000000u 0x1.8p100f vec2f_99999999999999999999";
        assert_eq!(
            literals_safari_refuses(wgsl),
            [
                "1000000000000000000000000000000f",
                "9223372036854775808f",
                "0x10000000000000000u"
            ]
        );
        assert!(literals_safari_refuses(&compact_floats(wgsl)).contains(&"0x10000000000000000u"));
        assert_eq!(literals_safari_refuses(&compact_floats(wgsl)).len(), 1);
    }
}
