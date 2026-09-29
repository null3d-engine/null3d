//! What a shader composer error says: the file and place it points to, and its message with names
//! written as shaders write them. The composer's own report counts columns in its preprocessed
//! copy of the file, where imported names are longer, so its columns and carets can be wrong.

use std::error::Error;
use std::ops::Range;

use naga_oil::compose::{Composer, ComposerError, ComposerErrorInner};

use crate::library::{Library, View};
use crate::position::{Position, locate};

/// The composer keeps a module's index in the high bits of the spans it makes, above this many
/// bits of byte offset.
const SPAN_SHIFT: usize = 21;

/// A composer error, described.
pub(crate) struct Described {
    /// The display path of the file the error is in.
    pub path: String,
    /// The place in that file, when the error points to one.
    pub position: Option<Position>,
    /// The message, one line for each part: naga's message, then its labels and notes.
    pub message: String,
}

/// Describes a composer error. `views` are the files of the variant, and `library` finds any
/// other library module the error is in.
pub(crate) fn describe(
    error: &ComposerError,
    composer: &Composer,
    views: &[View],
    library: &Library,
) -> Described {
    let path = error.source.path(composer).clone();
    // The composer's copy of the file, which its offsets count in.
    let text = error.source.source(composer);
    let original = views
        .iter()
        .find(|view| view.path == path)
        .map(|view| view.source)
        .or_else(|| library.source(&path))
        .unwrap_or(&text);
    let position = offset(error, &text).map(|offset| locate(original, &text, offset));
    Described {
        path,
        position,
        message: library.undecorate(&message(&error.inner)),
    }
}

/// The byte offset in the composer's copy of the file that the error points to.
fn offset(error: &ComposerError, text: &str) -> Option<usize> {
    let span = |range: Option<Range<usize>>| {
        range.map(|range| {
            (range.start & ((1 << SPAN_SHIFT) - 1)).saturating_sub(error.source.offset())
        })
    };
    match &error.inner {
        ComposerErrorInner::WgslParseError(parse) => {
            span(parse.labels().next().and_then(|(span, _)| span.to_range()))
        }
        // naga lists the spans of a validation error from the outermost item to the innermost.
        ComposerErrorInner::ShaderValidationError(validation)
        | ComposerErrorInner::HeaderValidationError(validation) => span(
            validation
                .spans()
                .last()
                .and_then(|(span, _)| span.to_range()),
        ),
        ComposerErrorInner::InvalidIdentifier { at, .. } => span(at.to_range()),
        ComposerErrorInner::DecorationInSource(range) => Some(range.start),
        ComposerErrorInner::ImportParseError(_, offset)
        | ComposerErrorInner::ImportNotFound(_, offset)
        | ComposerErrorInner::NotEnoughEndIfs(offset)
        | ComposerErrorInner::TooManyEndIfs(offset)
        | ComposerErrorInner::ElseWithoutCondition(offset)
        | ComposerErrorInner::UnknownShaderDef { pos: offset, .. }
        | ComposerErrorInner::UnknownShaderDefOperator { pos: offset, .. }
        | ComposerErrorInner::InvalidShaderDefComparisonValue { pos: offset, .. }
        | ComposerErrorInner::OverrideNotVirtual { pos: offset, .. }
        | ComposerErrorInner::GlslInvalidVersion(offset)
        | ComposerErrorInner::DefineInModule(offset)
        | ComposerErrorInner::InvalidShaderDefDefinitionValue { pos: offset, .. } => Some(*offset),
        // This error gives the directive's 0-based line.
        ComposerErrorInner::InvalidWgslDirective { position, .. } => Some(
            text.split_inclusive('\n')
                .take(*position)
                .map(str::len)
                .sum(),
        ),
        _ => None,
    }
}

/// The message of a composer error. A parse error adds the labels that say more than its message,
/// and its notes. A validation error lists the chain of errors inside it, from the item that
/// failed to the cause.
fn message(error: &ComposerErrorInner) -> String {
    match error {
        ComposerErrorInner::WgslParseError(parse) => {
            let headline = parse.message();
            let labels = parse.labels().map(|(_, label)| label);
            let details = labels
                .chain(parse.notes())
                .filter(|detail| !detail.is_empty() && !headline.contains(detail));
            std::iter::once(headline)
                .chain(details)
                .collect::<Vec<_>>()
                .join("\n")
        }
        ComposerErrorInner::ShaderValidationError(validation) => {
            let first: &(dyn Error + 'static) = validation.as_inner();
            std::iter::successors(Some(first), |&error| error.source())
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("\n")
        }
        other => other.to_string(),
    }
}
