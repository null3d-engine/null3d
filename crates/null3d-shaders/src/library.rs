//! The WGSL library: the modules in the `lib` folder, the composers that import them, and the
//! source files each variant uses, prepared for the checks.

use std::collections::{BTreeMap, HashMap};

use naga::valid::Capabilities;
use naga_oil::compose::preprocess::Preprocessor;
use naga_oil::compose::{
    ComposableModuleDescriptor, Composer, ShaderDefValue, get_preprocessor_data,
};

use crate::position::{Position, locate};
use crate::scan::{Token, tokenize};
use crate::{Problem, composition, features, shader_path};

/// The folder of library modules, inside the shader folder.
const LIBRARY_FOLDER: &str = "lib/";

/// The prefix of every library module's import path.
const IMPORT_PREFIX: &str = "null3d::";

/// True when a file, relative to the shader folder, is a library module.
pub(crate) fn is_library_file(file: &str) -> bool {
    file.starts_with(LIBRARY_FOLDER)
}

/// One library module.
pub(crate) struct LibraryModule {
    /// The import path, such as `null3d::math`.
    pub name: String,
    /// The display path of the file.
    pub path: String,
    /// The source text.
    pub source: String,
    /// The suffix the composer adds to the names this module declares.
    pub decoration: String,
}

/// The library modules, each after the modules it imports.
pub(crate) struct Library {
    modules: Vec<LibraryModule>,
}

impl Library {
    /// Loads the modules in the `lib` folder, checks them, and orders them so each follows its
    /// imports, as the composer requires.
    pub fn load(files: &BTreeMap<String, String>) -> Result<Self, Vec<Problem>> {
        let mut problems = Vec::new();
        let mut pending: Vec<(LibraryModule, Vec<String>)> = Vec::new();
        let preprocessor = Preprocessor::default();
        for (file, source) in files {
            let Some(file_name) = file.strip_prefix(LIBRARY_FOLDER) else {
                continue;
            };
            let path = shader_path(file);
            let stem = file_name.trim_end_matches(".wgsl");
            if stem.contains('/') {
                problems.push(Problem::in_file(
                    &path,
                    "library modules live directly in the lib folder. Move the file there, and name it after its import path.",
                ));
                continue;
            }
            problems.extend(features::check_directive_placement(&path, source));
            let expected = format!("{IMPORT_PREFIX}{stem}");
            let declared = match preprocessor.get_preprocessor_metadata(source, false) {
                Ok(metadata) => metadata.name,
                Err(e) => {
                    problems.push(Problem::in_file(
                        &path,
                        format!("the shader composer cannot read this module: {e}"),
                    ));
                    continue;
                }
            };
            if declared.as_deref() != Some(expected.as_str()) {
                problems.push(Problem::in_file(
                    &path,
                    format!(
                        "a library module's import path must match its file name. Start the file with `#define_import_path {expected}`, below any `enable` or `requires` lines."
                    ),
                ));
                continue;
            }
            let imports = get_preprocessor_data(source)
                .1
                .into_iter()
                .map(|import| import.import)
                .collect();
            pending.push((
                LibraryModule {
                    decoration: Composer::decorated_name(Some(&expected), ""),
                    name: expected,
                    path,
                    source: source.clone(),
                },
                imports,
            ));
        }

        for (module, imports) in &pending {
            for import in imports {
                if !pending.iter().any(|(other, _)| other.name == *import) {
                    problems.push(Problem::in_file(
                        &module.path,
                        format!(
                            "the module imports `{import}`, which no file in the lib folder declares."
                        ),
                    ));
                }
            }
        }
        if !problems.is_empty() {
            return Err(problems);
        }

        let mut modules: Vec<LibraryModule> = Vec::with_capacity(pending.len());
        while !pending.is_empty() {
            let ready = pending.iter().position(|(_, imports)| {
                imports
                    .iter()
                    .all(|import| modules.iter().any(|m| m.name == *import))
            });
            match ready {
                Some(index) => modules.push(pending.remove(index).0),
                None => {
                    let names: Vec<_> = pending.iter().map(|(m, _)| m.name.as_str()).collect();
                    return Err(vec![Problem::general(format!(
                        "these library modules import each other in a cycle: {}. Move the shared code into a module that none of them imports.",
                        names.join(", ")
                    ))]);
                }
            }
        }
        Ok(Self { modules })
    }

    /// The modules, each after the modules it imports.
    pub fn modules(&self) -> &[LibraryModule] {
        &self.modules
    }

    /// The source text of the module at a display path.
    pub fn source(&self, path: &str) -> Option<&str> {
        self.modules
            .iter()
            .find(|m| m.path == path)
            .map(|m| m.source.as_str())
    }

    /// A composer that validates with the given capabilities and knows every library module.
    fn composer(&self, capabilities: Capabilities) -> Result<Composer, Problem> {
        let mut composer = Composer::default().with_capabilities(capabilities);
        for module in &self.modules {
            let added = composer
                .add_composable_module(ComposableModuleDescriptor {
                    source: &module.source,
                    file_path: &module.path,
                    ..Default::default()
                })
                .map(|_| ());
            if let Err(e) = added {
                let found = composition::describe(&e, &composer, &[], self);
                return Err(Problem::at(&found.path, found.position, found.message));
            }
        }
        Ok(composer)
    }

    /// The files one variant uses, as the variant sees them: the entry shader first, then each
    /// library module that the variant's code refers to. The composer's preprocessor applies the
    /// shader defs and keeps every line in place, so places found here map back to the files.
    /// A file that the preprocessor rejects has no text here: composition then fails on it with a
    /// message that shows the place.
    pub fn prepare<'a>(
        &'a self,
        preprocessor: &Preprocessor,
        path: &'a str,
        source: &'a str,
        defs: &HashMap<String, ShaderDefValue>,
    ) -> Vec<Prepared<'a>> {
        let mut defs = defs.clone();
        defs.extend(get_preprocessor_data(source).2);
        let mut queue: Vec<(&str, &str, &str)> = vec![(path, "", source)];
        let mut queued = vec![false; self.modules.len()];
        let mut prepared = Vec::new();
        let mut next = 0;
        while let Some(&(path, decoration, source)) = queue.get(next) {
            next += 1;
            let text = preprocessor
                .preprocess(source, &defs)
                .map(|output| output.preprocessed_source)
                .unwrap_or_default();
            for (index, module) in self.modules.iter().enumerate() {
                if !queued[index] && text.contains(&module.decoration) {
                    queued[index] = true;
                    queue.push((&module.path, &module.decoration, &module.source));
                }
            }
            prepared.push(Prepared {
                path,
                decoration,
                source,
                text,
            });
        }
        prepared
    }

    /// Writes each decorated name in `text` as shaders write it, such as `null3d::math::square`.
    pub fn undecorate(&self, text: &str) -> String {
        let mut text = text.to_owned();
        for module in &self.modules {
            let mut out = String::with_capacity(text.len());
            let mut rest = text.as_str();
            while let Some(at) = rest.find(&module.decoration) {
                let item = rest[..at]
                    .trim_end_matches(|c: char| c == '_' || c.is_alphanumeric())
                    .len();
                out.push_str(&rest[..item]);
                out.push_str(&module.name);
                out.push_str("::");
                out.push_str(&rest[item..at]);
                rest = &rest[at + module.decoration.len()..];
            }
            out.push_str(rest);
            text = out;
        }
        text
    }
}

/// One file as a variant sees it.
pub(crate) struct Prepared<'a> {
    /// The display path.
    pub path: &'a str,
    /// The composer's suffix for names the file declares; empty for the entry shader.
    pub decoration: &'a str,
    /// The file's text.
    pub source: &'a str,
    /// The preprocessed text, with imported names replaced by decorated names.
    pub text: String,
}

/// A prepared file and its tokens.
pub(crate) struct View<'a> {
    pub path: &'a str,
    pub decoration: &'a str,
    pub source: &'a str,
    text: &'a str,
    pub tokens: Vec<Token<'a>>,
}

impl<'a> View<'a> {
    pub fn new(prepared: &'a Prepared<'a>) -> Self {
        Self {
            path: prepared.path,
            decoration: prepared.decoration,
            source: prepared.source,
            text: &prepared.text,
            tokens: tokenize(&prepared.text),
        }
    }

    /// The place in the file of the token at `index`.
    pub fn position(&self, index: usize) -> Position {
        locate(self.source, self.text, self.tokens[index].start)
    }
}

/// The file that declares an item of the composed module, and the item's name there. `views` are
/// the files of one variant, from [`Library::prepare`], so the entry shader comes first and each
/// library module after it. Names from a library module end with that module's decoration; other
/// names belong to the entry shader.
pub(crate) fn owner<'v, 'a>(views: &'v [View<'a>], name: &'v str) -> (&'v View<'a>, &'v str) {
    views
        .iter()
        .skip(1)
        .find_map(|view| name.strip_suffix(view.decoration).map(|item| (view, item)))
        .unwrap_or((&views[0], name))
}

/// Composers by capability set, made on first use. Each keeps the library modules it built for
/// earlier variants.
#[derive(Default)]
pub(crate) struct Composers {
    made: Vec<(Capabilities, Composer)>,
}

impl Composers {
    pub fn get(
        &mut self,
        library: &Library,
        capabilities: Capabilities,
    ) -> Result<&mut Composer, Problem> {
        let index = match self.made.iter().position(|(c, _)| *c == capabilities) {
            Some(index) => index,
            None => {
                let composer = library.composer(capabilities)?;
                self.made.push((capabilities, composer));
                self.made.len() - 1
            }
        };
        Ok(&mut self.made[index].1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decorated_names_become_module_paths() {
        let files = BTreeMap::from([(
            "lib/math.wgsl".to_owned(),
            "#define_import_path null3d::math\nfn square(x: f32) -> f32 { return x * x; }\n"
                .to_owned(),
        )]);
        let library = Library::load(&files).unwrap();
        let decoration = &library.modules()[0].decoration;
        let text = format!("Function [0] 'square{decoration}' is invalid; see square{decoration}.");
        assert_eq!(
            library.undecorate(&text),
            "Function [0] 'null3d::math::square' is invalid; see null3d::math::square."
        );
    }
}
