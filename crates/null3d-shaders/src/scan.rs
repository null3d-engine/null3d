//! A small WGSL tokenizer and the lookups the shader checks use. Each token keeps its byte offset,
//! so a problem found in the composed module can point back at a place in its source file.

use std::ops::Range;

/// The kind of a token.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Ident,
    Number,
    Punct,
}

/// One token and the byte offset where it starts in the text.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Token<'a> {
    pub kind: Kind,
    pub text: &'a str,
    pub start: usize,
}

/// Punctuation longer than one character, longest first, so `<<=` wins over `<<` and `<`.
const LONG_PUNCTUATION: [&str; 22] = [
    "<<=", ">>=", "->", "::", "==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=",
    "/=", "%=", "&=", "|=", "^=", "<<", ">>",
];

/// Splits WGSL text into identifiers, numbers and punctuation, and skips white space and
/// comments. Block comments nest, as WGSL defines them.
pub(crate) fn tokenize(text: &str) -> Vec<Token<'_>> {
    let bytes = text.as_bytes();
    let mut tokens = Vec::with_capacity(bytes.len() / 4);
    let mut i = 0;
    while i < bytes.len() {
        let byte = bytes[i];
        if byte.is_ascii_whitespace() {
            i += 1;
        } else if byte == b'/' && bytes.get(i + 1) == Some(&b'/') {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
        } else if byte == b'/' && bytes.get(i + 1) == Some(&b'*') {
            let mut depth = 0usize;
            while i < bytes.len() {
                if bytes[i] == b'/' && bytes.get(i + 1) == Some(&b'*') {
                    depth += 1;
                    i += 2;
                } else if bytes[i] == b'*' && bytes.get(i + 1) == Some(&b'/') {
                    depth -= 1;
                    i += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    i += 1;
                }
            }
        } else {
            let start = i;
            let kind = if byte.is_ascii_digit()
                || (byte == b'.' && bytes.get(i + 1).is_some_and(u8::is_ascii_digit))
            {
                i = number_end(bytes, i);
                Kind::Number
            } else if is_ident_byte(byte) {
                while i < bytes.len() && (is_ident_byte(bytes[i]) || bytes[i].is_ascii_digit()) {
                    i += 1;
                }
                Kind::Ident
            } else {
                let rest = &text[i..];
                i += LONG_PUNCTUATION
                    .iter()
                    .find(|p| rest.starts_with(**p))
                    .map_or(1, |p| p.len());
                Kind::Punct
            };
            tokens.push(Token {
                kind,
                text: &text[start..i],
                start,
            });
        }
    }
    tokens
}

/// Identifier bytes: ASCII letters, underscores, and every byte of a non-ASCII character, which
/// keeps multi-byte characters whole.
fn is_ident_byte(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphabetic() || byte >= 0x80
}

/// The end of a number literal: digits, letters for suffixes and hex digits, a decimal point,
/// and the sign of an exponent.
fn number_end(bytes: &[u8], mut i: usize) -> usize {
    let hex = bytes[i] == b'0' && matches!(bytes.get(i + 1), Some(b'x' | b'X'));
    while let Some(&byte) = bytes.get(i) {
        let exponent_sign = matches!(byte, b'+' | b'-')
            && if hex {
                matches!(bytes[i - 1], b'p' | b'P')
            } else {
                matches!(bytes[i - 1], b'e' | b'E')
            };
        if byte.is_ascii_alphanumeric() || byte == b'.' || exponent_sign {
            i += 1;
        } else {
            break;
        }
    }
    i
}

/// The index of the token that closes the bracket at `open`.
pub(crate) fn matching(tokens: &[Token], open: usize) -> Option<usize> {
    let (opening, closing) = match tokens.get(open)?.text {
        "(" => ("(", ")"),
        "{" => ("{", "}"),
        "[" => ("[", "]"),
        _ => return None,
    };
    let mut depth = 0usize;
    for (index, token) in tokens.iter().enumerate().skip(open) {
        if token.text == opening {
            depth += 1;
        } else if token.text == closing {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
    }
    None
}

/// The tokens of a function declaration.
pub(crate) struct Function {
    /// The function's name.
    pub name: usize,
    /// The tokens between the parameter list's parentheses.
    pub params: Range<usize>,
    /// The tokens between the body's braces.
    pub body: Range<usize>,
}

/// Finds the module-scope declaration `fn name(...) { ... }`.
pub(crate) fn find_function(tokens: &[Token], name: &str) -> Option<Function> {
    let mut depth = 0usize;
    for (index, token) in tokens.iter().enumerate() {
        match token.text {
            "{" => depth += 1,
            "}" => depth = depth.saturating_sub(1),
            "fn" if depth == 0 => {
                let (Some(found), Some(open)) = (tokens.get(index + 1), tokens.get(index + 2))
                else {
                    continue;
                };
                if found.text != name || open.text != "(" {
                    continue;
                }
                let close = matching(tokens, index + 2)?;
                let body_open = (close + 1..tokens.len()).find(|&i| tokens[i].text == "{")?;
                let body_close = matching(tokens, body_open)?;
                return Some(Function {
                    name: index + 1,
                    params: index + 3..close,
                    body: body_open + 1..body_close,
                });
            }
            _ => {}
        }
    }
    None
}

/// The index of the first token in `range` that starts the token texts in `pattern`.
fn find_in(tokens: &[Token], range: Range<usize>, pattern: [&str; 2]) -> Option<usize> {
    range
        .clone()
        .zip(tokens[range].windows(2))
        .find(|(_, pair)| pair[0].text == pattern[0] && pair[1].text == pattern[1])
        .map(|(index, _)| index)
}

/// The name of parameter `name` of a function.
pub(crate) fn param(tokens: &[Token], function: &Function, name: &str) -> Option<usize> {
    find_in(tokens, function.params.clone(), [name, ":"])
}

/// The name of the first `let name` in a function's body.
pub(crate) fn let_binding(tokens: &[Token], function: &Function, name: &str) -> Option<usize> {
    find_in(tokens, function.body.clone(), ["let", name]).map(|index| index + 1)
}

/// A call in a function's body.
pub(crate) struct Call {
    /// The called name.
    pub name: usize,
    /// True when an argument takes the address of part of a variable, as in `&v.x` or `&a[i]`.
    pub passes_part: bool,
}

/// The calls in a function's body to any of `names`, in source order.
pub(crate) fn calls(tokens: &[Token], function: &Function, names: &[&str]) -> Vec<Call> {
    let mut calls = Vec::new();
    for index in function.body.clone() {
        let (Some(name), Some(open)) = (tokens.get(index), tokens.get(index + 1)) else {
            break;
        };
        if !names.contains(&name.text) || open.text != "(" {
            continue;
        }
        let close = matching(tokens, index + 1).unwrap_or(function.body.end);
        let passes_part = tokens[index + 2..close].windows(3).any(|w| {
            w[0].text == "&" && w[1].kind == Kind::Ident && matches!(w[2].text, "." | "[")
        });
        calls.push(Call {
            name: index,
            passes_part,
        });
    }
    calls
}

/// The name of the module-scope `var` declaration named `name`, with or without an address space.
pub(crate) fn global(tokens: &[Token], name: &str) -> Option<usize> {
    let mut depth = 0usize;
    let mut index = 0;
    while index < tokens.len() {
        match tokens[index].text {
            "{" => depth += 1,
            "}" => depth = depth.saturating_sub(1),
            "var" if depth == 0 => {
                let mut next = index + 1;
                if tokens.get(next).is_some_and(|t| t.text == "<") {
                    while tokens.get(next).is_some_and(|t| t.text != ">") {
                        next += 1;
                    }
                    next += 1;
                }
                if tokens.get(next).is_some_and(|t| t.text == name) {
                    return Some(next);
                }
            }
            _ => {}
        }
        index += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::position::locate;

    fn texts(source: &str) -> Vec<&str> {
        tokenize(source).iter().map(|t| t.text).collect()
    }

    /// The line and column of a token.
    fn place(source: &str, tokens: &[Token], index: usize) -> (u32, u32) {
        let position = locate(source, source, tokens[index].start);
        (position.line, position.column)
    }

    #[test]
    fn comments_and_white_space_are_skipped_and_places_kept() {
        let source = "a /* one\n /* nested */ two\n */ b // three\nc";
        let tokens = tokenize(source);
        let found: Vec<_> = (0..tokens.len())
            .map(|i| (tokens[i].text, place(source, &tokens, i)))
            .collect();
        assert_eq!(found, [("a", (1, 1)), ("b", (3, 5)), ("c", (4, 1))]);
    }

    #[test]
    fn operators_take_the_longest_match() {
        assert_eq!(
            texts("v.xy <<= 1; a <= b; c = d == e; f->g"),
            [
                "v", ".", "xy", "<<=", "1", ";", "a", "<=", "b", ";", "c", "=", "d", "==", "e",
                ";", "f", "->", "g"
            ]
        );
    }

    #[test]
    fn numbers_keep_suffixes_and_exponents() {
        assert_eq!(
            texts("1.5e-3f + 0x1p+4 - 3u * .5"),
            ["1.5e-3f", "+", "0x1p+4", "-", "3u", "*", ".5"]
        );
        let tokens = tokenize("x.y");
        assert_eq!(tokens[1].kind, Kind::Punct);
    }

    #[test]
    fn functions_parameters_lets_calls_and_globals_are_found() {
        let source = "var<uniform> u: U;\nvar plain: f32;\nfn helper(p: f32) -> f32 {\n  return p;\n}\nfn main(\n  a: f32,\n) {\n  let x = helper(a);\n}\n";
        let tokens = tokenize(source);
        let at = |index: Option<usize>| index.map(|i| place(source, &tokens, i));
        let main = find_function(&tokens, "main").unwrap();
        assert_eq!(at(Some(main.name)), Some((6, 4)));
        assert_eq!(at(param(&tokens, &main, "a")), Some((7, 3)));
        assert_eq!(at(let_binding(&tokens, &main, "x")), Some((9, 7)));
        let found = calls(&tokens, &main, &["helper"]);
        assert_eq!(found.len(), 1);
        assert_eq!(at(Some(found[0].name)), Some((9, 11)));
        assert!(!found[0].passes_part);
        assert_eq!(at(global(&tokens, "u")), Some((1, 14)));
        assert_eq!(at(global(&tokens, "plain")), Some((2, 5)));
        assert!(find_function(&tokens, "missing").is_none());
    }

    #[test]
    fn calls_that_pass_part_of_a_variable_are_marked() {
        let source =
            "fn main() {\n  f(&whole);\n  f(&pair.b, 1);\n  f(&items[2]);\n  g(a && b.c);\n}\n";
        let tokens = tokenize(source);
        let main = find_function(&tokens, "main").unwrap();
        let found: Vec<_> = calls(&tokens, &main, &["f", "g"])
            .iter()
            .map(|c| (place(source, &tokens, c.name).0, c.passes_part))
            .collect();
        assert_eq!(found, [(2, false), (3, true), (4, true), (5, false)]);
    }
}
