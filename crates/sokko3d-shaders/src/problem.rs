//! Problems the build finds, and the error that collects them.

use std::fmt;

/// One problem the build found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Problem {
    /// The file, relative to the repository root, when the problem belongs to one.
    pub file: Option<String>,
    /// The 1-based line in that file, when known.
    pub line: Option<u32>,
    /// The WGSL language feature the problem is about, if any.
    pub feature: Option<String>,
    /// What is wrong and how to fix it.
    pub message: String,
    /// The shader variants that have the problem, as `shader.variant`.
    pub variants: Vec<String>,
}

impl Problem {
    /// A problem with no file.
    pub(crate) fn general(message: impl Into<String>) -> Self {
        Self {
            file: None,
            line: None,
            feature: None,
            message: message.into(),
            variants: Vec::new(),
        }
    }

    /// A problem in a file, at a line when it is known.
    pub(crate) fn at(file: &str, line: Option<u32>, message: impl Into<String>) -> Self {
        Self {
            file: Some(file.to_owned()),
            line,
            ..Self::general(message)
        }
    }

    /// A problem in a file, with no line.
    pub(crate) fn in_file(file: &str, message: impl Into<String>) -> Self {
        Self::at(file, None, message)
    }
}

impl fmt::Display for Problem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (&self.file, self.line) {
            (Some(file), Some(line)) => write!(f, "{file}:{line}: ")?,
            (Some(file), None) => write!(f, "{file}: ")?,
            _ => {}
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
            let existing = self.problems.iter_mut().find(|p| {
                p.file == problem.file
                    && p.line == problem.line
                    && p.feature == problem.feature
                    && p.message == problem.message
            });
            match existing {
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
