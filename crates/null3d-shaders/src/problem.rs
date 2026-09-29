//! Problems the build finds, and the error that collects them.

use std::fmt;

use serde::Serialize;

use crate::Position;

/// One problem the build found.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Problem {
    /// The file, relative to the repository root, when the problem belongs to one.
    pub file: Option<String>,
    /// The 1-based line in that file, when known.
    pub line: Option<u32>,
    /// The 1-based column in that line, counted in characters, when the line is known.
    pub column: Option<u32>,
    /// The WGSL language feature the problem is about, if any.
    pub feature: Option<String>,
    /// What is wrong and how to fix it.
    pub message: String,
    /// The shader variants that have the problem.
    pub variants: Vec<String>,
}

impl Problem {
    /// A problem with no file.
    pub fn general(message: impl Into<String>) -> Self {
        Self {
            file: None,
            line: None,
            column: None,
            feature: None,
            message: message.into(),
            variants: Vec::new(),
        }
    }

    /// A problem in a file, at a place when it is known.
    pub(crate) fn at(file: &str, position: Option<Position>, message: impl Into<String>) -> Self {
        Self {
            file: Some(file.to_owned()),
            line: position.map(|p| p.line),
            column: position.map(|p| p.column),
            ..Self::general(message)
        }
    }

    /// A problem in a file, at no particular place.
    pub(crate) fn in_file(file: &str, message: impl Into<String>) -> Self {
        Self::at(file, None, message)
    }

    /// True when both describe the same problem, whichever variants have it.
    fn same_as(&self, other: &Self) -> bool {
        self.file == other.file
            && self.line == other.line
            && self.column == other.column
            && self.feature == other.feature
            && self.message == other.message
    }
}

impl fmt::Display for Problem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(file) = &self.file {
            f.write_str(file)?;
            for number in [self.line, self.column].into_iter().flatten() {
                write!(f, ":{number}")?;
            }
            f.write_str(": ")?;
        }
        f.write_str(&self.message)?;
        match self.variants.as_slice() {
            [] => Ok(()),
            [one] => write!(f, "\n  (shader variant {one})"),
            many => write!(f, "\n  (shader variants {})", many.join(", ")),
        }
    }
}

/// Everything that stopped a build.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BuildError {
    /// The problems, in the order the build found them.
    pub problems: Vec<Problem>,
}

impl BuildError {
    /// Adds problems, found in a variant when one is named. The same problem in several variants
    /// is listed once, with each variant.
    pub(crate) fn add(
        &mut self,
        problems: impl IntoIterator<Item = Problem>,
        variant: Option<&str>,
    ) {
        for mut problem in problems {
            match self.problems.iter_mut().find(|p| p.same_as(&problem)) {
                Some(existing) => existing.variants.extend(variant.map(str::to_owned)),
                None => {
                    problem.variants.extend(variant.map(str::to_owned));
                    self.problems.push(problem);
                }
            }
        }
    }

    /// `Ok(value)` when there are no problems, and the error otherwise.
    pub(crate) fn or<T>(self, value: T) -> Result<T, Self> {
        if self.problems.is_empty() {
            Ok(value)
        } else {
            Err(self)
        }
    }
}

impl From<Problem> for BuildError {
    fn from(problem: Problem) -> Self {
        Self {
            problems: vec![problem],
        }
    }
}

impl FromIterator<Problem> for BuildError {
    fn from_iter<I: IntoIterator<Item = Problem>>(problems: I) -> Self {
        let mut error = Self::default();
        error.add(problems, None);
        error
    }
}

impl fmt::Display for BuildError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (index, problem) in self.problems.iter().enumerate() {
            if index > 0 {
                f.write_str("\n\n")?;
            }
            write!(f, "{problem}")?;
        }
        Ok(())
    }
}

impl std::error::Error for BuildError {}
