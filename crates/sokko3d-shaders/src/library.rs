//! The WGSL library: the modules in the `lib` folder, the composers that import them, and the
//! source files each variant uses, prepared for the checks.

use std::collections::{BTreeMap, HashMap};

use naga::valid::Capabilities;
use naga_oil::compose::preprocess::Preprocessor;
use naga_oil::compose::{
    ComposableModuleDescriptor, Composer, ShaderDefValue, get_preprocessor_data,
};

use crate::scan::{Token, tokenize};
use crate::{Problem, shader_path};

/// The folder of library modules, inside the shader folder.
const LIBRARY_FOLDER: &str = "lib/";

/// The prefix of every library module's import path.
const IMPORT_PREFIX: &str = "sokko3d::";

/// True when a file, relative to the shader folder, is a library module.
pub(crate) fn is_library_file(file: &str) -> bool {
    file.starts_with(LIBRARY_FOLDER)
}

/// One library module.
pub(crate) struct LibraryModule {
    /// The import path, such as `sokko3d::math`.
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
    /// Loads the modules in the `lib` folder and orders them so each follows its imports, as the
    /// composer requires.
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
                return Err(Problem::in_file(&module.path, e.emit_to_string(&composer)));
            }
        }
        Ok(composer)
    }

    /// The files one variant uses, as the variant sees them: the entry shader first, then each
    /// library module that the variant's code refers to. The composer's preprocessor applies the
    /// shader defs and keeps every line in place, so lines found here are lines in the files.
    /// A file that the preprocessor rejects has no text here: composition then fails on it with a
    /// message that shows the line.
    pub fn prepare(
        &self,
        preprocessor: &Preprocessor,
        path: &str,
        source: &str,
        defs: &HashMap<String, ShaderDefValue>,
    ) -> Vec<Prepared> {
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
                path: path.to_owned(),
                decoration: decoration.to_owned(),
                text,
            });
        }
        prepared
    }
}

/// One file as a variant sees it.
pub(crate) struct Prepared {
    /// The display path.
    pub path: String,
    /// The composer's suffix for names the file declares; empty for the entry shader.
    pub decoration: String,
    /// The preprocessed text, with imported names replaced by decorated names.
    pub text: String,
}

/// A prepared file and its tokens.
pub(crate) struct View<'a> {
    pub path: &'a str,
    pub decoration: &'a str,
    pub tokens: Vec<Token<'a>>,
}

impl<'a> View<'a> {
    pub fn new(prepared: &'a Prepared) -> Self {
        Self {
            path: &prepared.path,
            decoration: &prepared.decoration,
            tokens: tokenize(&prepared.text),
        }
    }
}

/// The file that declares an item of the composed module, and the item's name there. `views` are
/// the files of one variant, from [`Library::prepare`], so the entry shader comes first and each
/// library module after it. Names from a library module end with that module's decoration; other
/// names belong to the entry shader.
pub(crate) fn locate<'v, 'a>(views: &'v [View<'a>], name: &'v str) -> (&'v View<'a>, &'v str) {
    views
        .iter()
        .skip(1)
        .find_map(|view| name.strip_suffix(view.decoration).map(|item| (view, item)))
        .unwrap_or((&views[0], name))
}

/// Composers by capability set, made on first use. Each keeps the library modules it built for
/// earlier variants.
pub(crate) struct Composers<'a> {
    library: &'a Library,
    made: Vec<(Capabilities, Composer)>,
}

impl<'a> Composers<'a> {
    pub fn new(library: &'a Library) -> Self {
        Self {
            library,
            made: Vec::new(),
        }
    }

    pub fn get(&mut self, capabilities: Capabilities) -> Result<&mut Composer, Problem> {
        let index = match self.made.iter().position(|(c, _)| *c == capabilities) {
            Some(index) => index,
            None => {
                let composer = self.library.composer(capabilities)?;
                self.made.push((capabilities, composer));
                self.made.len() - 1
            }
        };
        Ok(&mut self.made[index].1)
    }
}
