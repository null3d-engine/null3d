//! The WGSL shader library, import resolution, GLSL translation and reflection.
//!
//! The shader build reads the manifest, composes each variant of each entry shader with the
//! library modules it imports, checks and validates the result, and writes one TypeScript module
//! that holds WGSL for WebGPU and GLSL ES 3.00 with reflection for WebGL2. Browsers then need no
//! shader translator. Paths below are relative to the repository root:
//!
//! - [`MANIFEST_PATH`] lists the entry shaders, their render pipelines and their variants.
//! - [`SHADER_DIR`] holds the entry shaders, and its `lib` folder holds the library modules, which
//!   shaders import as `null3d::<file name>`.
//! - [`OUTPUT_PATH`] is the generated module.

mod features;
mod glsl;
mod library;
mod manifest;
mod names;
mod output;
mod problem;
mod scan;
mod typescript;

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::Path;

use naga::valid::{Capabilities, ModuleInfo, ValidationFlags, Validator};
use naga_oil::compose::preprocess::Preprocessor;
use naga_oil::compose::{NagaModuleDescriptor, ShaderDefValue};

pub use features::ALLOWED_LANGUAGE_FEATURES;
pub use manifest::{Pipeline, Target};
pub use output::{
    Binding, GlslProgram, GlslStage, GlslTexture, GlslUniformBlock, Output, VariantOutput,
    WgslOutput,
};
pub use problem::{BuildError, Problem};

use library::{Composers, Library, View};
use manifest::{Manifest, Shader, Variant};

/// The manifest.
pub const MANIFEST_PATH: &str = "crates/null3d-shaders/shaders.toml";
/// The folder of entry shaders, with the library modules in its `lib` folder.
pub const SHADER_DIR: &str = "crates/null3d-shaders/wgsl";
/// The generated TypeScript module.
pub const OUTPUT_PATH: &str = "packages/engine/src/generated/shaders.ts";
/// The command that regenerates the output, as error messages name it.
pub const COMMAND: &str = "bun run shaders";

/// What WebGPU allows every shader without optional features: multisampled shading, cube map
/// arrays, the half-float packing functions and external textures. Validation grants nothing
/// else, so a shader that needs an optional feature fails the build.
const WEBGPU_BASELINE: Capabilities = Capabilities::MULTISAMPLED_SHADING
    .union(Capabilities::CUBE_ARRAY_TEXTURES)
    .union(Capabilities::SHADER_FLOAT16_IN_FLOAT32)
    .union(Capabilities::TEXTURE_EXTERNAL);

/// The build's inputs: the manifest text and every WGSL file in the shader folder.
#[derive(Clone, Debug, Default)]
pub struct Inputs {
    /// The manifest text.
    pub manifest: String,
    /// WGSL sources by path relative to the shader folder, with `/` separators. Library modules
    /// are the files in `lib/`.
    pub files: BTreeMap<String, String>,
}

impl Inputs {
    /// Reads the manifest and every `.wgsl` file below the shader folder of the repository at
    /// `root`. Line endings become `\n`.
    pub fn read(root: &Path) -> Result<Self, BuildError> {
        let manifest = read_text(root, MANIFEST_PATH)?;
        let mut files = BTreeMap::new();
        collect_wgsl(root, SHADER_DIR, "", &mut files)?;
        Ok(Self { manifest, files })
    }
}

fn read_text(root: &Path, path: &str) -> Result<String, BuildError> {
    fs::read_to_string(root.join(path))
        .map(|text| text.replace("\r\n", "\n"))
        .map_err(|e| Problem::in_file(path, format!("cannot read the file: {e}")).into())
}

fn collect_wgsl(
    root: &Path,
    dir: &str,
    prefix: &str,
    files: &mut BTreeMap<String, String>,
) -> Result<(), BuildError> {
    let mut entries = fs::read_dir(root.join(dir))
        .and_then(|entries| entries.collect::<Result<Vec<_>, _>>())
        .map_err(|e| Problem::in_file(dir, format!("cannot list the folder: {e}")))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.path().is_dir() {
            let nested = format!("{dir}/{name}");
            collect_wgsl(root, &nested, &format!("{prefix}{name}/"), files)?;
        } else if name.ends_with(".wgsl") {
            let text = read_text(root, &format!("{dir}/{name}"))?;
            files.insert(format!("{prefix}{name}"), text);
        }
    }
    Ok(())
}

/// The display path of a file in the shader folder.
fn shader_path(relative: &str) -> String {
    format!("{SHADER_DIR}/{relative}")
}

/// Builds every variant in the manifest.
pub fn build(inputs: &Inputs) -> Result<Output, BuildError> {
    let manifest = Manifest::parse(&inputs.manifest).map_err(|messages| {
        messages
            .into_iter()
            .map(|message| Problem::in_file(MANIFEST_PATH, message))
            .collect::<BuildError>()
    })?;
    let library = Library::load(&inputs.files).map_err(BuildError::from_iter)?;
    check_files(inputs, &manifest).or(())?;

    let mut builder = Builder::new(&library);
    let mut errors = BuildError::default();
    let mut output = Output::default();
    for (shader_name, shader) in &manifest.shaders {
        let path = shader_path(&shader.file);
        let source = &inputs.files[&shader.file];
        let mut variants = BTreeMap::new();
        for (variant_name, variant) in &shader.variants {
            match builder.variant(shader, &path, source, variant) {
                Ok(built) => {
                    variants.insert(variant_name.clone(), built);
                }
                Err(problems) => {
                    let name = format!("{shader_name}.{variant_name}");
                    errors.add(problems, Some(&name));
                }
            }
        }
        output.shaders.insert(shader_name.clone(), variants);
        let pipelines = shader.pipelines.keys().cloned().collect();
        output.pipelines.insert(shader_name.clone(), pipelines);
    }
    errors.or(output)
}

/// Checks that every entry shader the manifest names exists, that every entry shader is in the
/// manifest, and that WGSL directives sit where the composer keeps them.
fn check_files(inputs: &Inputs, manifest: &Manifest) -> BuildError {
    let mut errors = BuildError::default();
    for (name, shader) in &manifest.shaders {
        if !inputs.files.contains_key(&shader.file) {
            let message = format!(
                "shaders.{name}.file names \"{}\", which does not exist in {SHADER_DIR}.",
                shader.file
            );
            errors.add([Problem::in_file(MANIFEST_PATH, message)], None);
        }
    }
    for (file, source) in &inputs.files {
        let path = shader_path(file);
        let listed = manifest.shaders.values().any(|shader| shader.file == *file);
        if listed || library::is_library_file(file) {
            errors.add(features::check_directive_placement(&path, source), None);
        } else {
            let message = format!(
                "this entry shader is not in {MANIFEST_PATH}, so nothing builds it. Add a [shaders.<name>] table for it, or move a library module into lib/."
            );
            errors.add([Problem::in_file(&path, message)], None);
        }
    }
    errors
}

/// The state that the variants of one build share: the library, the composer's preprocessor, and
/// the composers, which keep the library modules they built for earlier variants.
struct Builder<'a> {
    library: &'a Library,
    preprocessor: Preprocessor,
    composers: Composers<'a>,
}

impl<'a> Builder<'a> {
    fn new(library: &'a Library) -> Self {
        Self {
            library,
            preprocessor: Preprocessor::default(),
            composers: Composers::new(library),
        }
    }

    /// Builds one variant of an entry shader: checks its source, composes and validates it, and
    /// writes each target.
    fn variant(
        &mut self,
        shader: &Shader,
        path: &str,
        source: &str,
        variant: &Variant,
    ) -> Result<VariantOutput, Vec<Problem>> {
        let defs: HashMap<String, ShaderDefValue> = variant
            .defs
            .iter()
            .map(|def| (def.clone(), ShaderDefValue::Bool(true)))
            .collect();
        // WebGPU has no draw index, so only variants for WebGL2 alone may read `gl_DrawID`.
        let capabilities = if variant.targets == [Target::Glsl] {
            WEBGPU_BASELINE.union(Capabilities::DRAW_INDEX)
        } else {
            WEBGPU_BASELINE
        };

        let prepared = self
            .library
            .prepare(&self.preprocessor, path, source, &defs);
        let views: Vec<View> = prepared.iter().map(View::new).collect();
        fail_on(features::scan(&views))?;

        let composer = self.composers.get(capabilities).map_err(|p| vec![p])?;
        let mut module = composer
            .make_naga_module(NagaModuleDescriptor {
                source,
                file_path: path,
                shader_defs: defs,
                ..Default::default()
            })
            .map_err(|e| vec![features::composition_problem(&e, composer, &views)])?;
        let info = validate(&module, capabilities)?;
        let mut problems = features::check_module(&module, &info, &views);
        problems.extend(missing_entry_points(shader, path, &module));
        fail_on(problems)?;

        naga::compact::compact(&mut module, naga::compact::KeepUnused::No);
        names::undecorate(&mut module, self.library);
        let info = validate(&module, capabilities)?;
        let wgsl = if variant.has(Target::Wgsl) {
            let flags = naga::back::wgsl::WriterFlags::empty();
            let written = naga::back::wgsl::write_string(&module, &info, flags).map_err(|e| {
                vec![Problem::in_file(
                    path,
                    format!("naga cannot write WGSL: {e}"),
                )]
            })?;
            Some(WgslOutput {
                source: finish_source(&written),
                pipelines: shader.pipelines.clone(),
            })
        } else {
            None
        };
        let glsl = if variant.has(Target::Glsl) {
            let programs = shader.pipelines.iter().map(|(name, pipeline)| {
                glsl::write_program(&module, &info, name, pipeline)
                    .map(|program| (name.clone(), program))
                    .map_err(|message| vec![Problem::in_file(path, message)])
            });
            Some(programs.collect::<Result<BTreeMap<_, _>, _>>()?)
        } else {
            None
        };
        Ok(VariantOutput { wgsl, glsl })
    }
}

/// Fails with the problems, when there are any.
fn fail_on(problems: Vec<Problem>) -> Result<(), Vec<Problem>> {
    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems)
    }
}

/// Problems with pipelines whose entry points the composed module does not define.
fn missing_entry_points(shader: &Shader, path: &str, module: &naga::Module) -> Vec<Problem> {
    let mut problems = Vec::new();
    for (name, pipeline) in &shader.pipelines {
        for (stage, stage_name, entry) in pipeline.stages() {
            if !module
                .entry_points
                .iter()
                .any(|ep| ep.stage == stage && ep.name == entry)
            {
                problems.push(Problem::in_file(
                    path,
                    format!(
                        "pipeline `{name}` names the {stage_name} entry point `{entry}`, which this variant of the shader does not define. Check the name in {MANIFEST_PATH}, and the shader defs that hide code."
                    ),
                ));
            }
        }
    }
    problems
}

/// Validates a composed module with the given capabilities.
fn validate(module: &naga::Module, capabilities: Capabilities) -> Result<ModuleInfo, Vec<Problem>> {
    Validator::new(ValidationFlags::all(), capabilities)
        .validate(module)
        .map_err(|e| {
            vec![Problem::general(format!(
                "the composed module failed validation after the build rewrote it, which is a bug in the shader build: {e}"
            ))]
        })
}

/// Trims white space at the end of each line and blank lines at the end, and ends the text with one
/// newline.
fn finish_source(source: &str) -> String {
    let mut text = String::with_capacity(source.len());
    for line in source.trim_end().lines() {
        text.push_str(line.trim_end());
        text.push('\n');
    }
    text
}

/// Renders built output as the TypeScript module.
pub fn typescript(output: &Output) -> String {
    typescript::module(output)
}

/// Builds the manifest in `root` and returns the TypeScript module.
pub fn generate(root: &Path) -> Result<String, BuildError> {
    Ok(typescript(&build(&Inputs::read(root)?)?))
}

/// Whether [`write`] changed the file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Written {
    /// The file was missing or different, and now holds the new output.
    Updated,
    /// The file already held the output.
    Unchanged,
}

/// Builds and writes the TypeScript module, when it changed.
pub fn write(root: &Path) -> Result<Written, BuildError> {
    let module = generate(root)?;
    let path = root.join(OUTPUT_PATH);
    if fs::read_to_string(&path).is_ok_and(|current| current == module) {
        return Ok(Written::Unchanged);
    }
    path.parent()
        .map_or(Ok(()), fs::create_dir_all)
        .and_then(|()| fs::write(&path, module))
        .map_err(|e| Problem::in_file(OUTPUT_PATH, format!("cannot write the file: {e}")))?;
    Ok(Written::Updated)
}

/// Builds the TypeScript module in memory and fails when the file on disk differs from it.
pub fn check(root: &Path) -> Result<(), BuildError> {
    let module = generate(root)?;
    let message = match fs::read_to_string(root.join(OUTPUT_PATH)) {
        Ok(current) if current == module => return Ok(()),
        Ok(current) => {
            let line = current
                .lines()
                .zip(module.lines())
                .position(|(a, b)| a != b)
                .unwrap_or_else(|| current.lines().count().min(module.lines().count()))
                + 1;
            format!(
                "the file differs from a fresh build, first at line {line}. Run `{COMMAND}` and commit the result; never edit the file by hand."
            )
        }
        Err(e) => format!("cannot read the file ({e}). Run `{COMMAND}` to create it."),
    };
    Err(Problem::in_file(OUTPUT_PATH, message).into())
}
