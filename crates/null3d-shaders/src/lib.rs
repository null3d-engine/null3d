//! The WGSL shader library, import resolution, GLSL translation and reflection.
//!
//! The shader build reads the manifest, composes each variant of each entry shader with the
//! library modules it imports, checks and validates the result, and writes TypeScript modules
//! that hold WGSL for WebGPU and GLSL ES 3.00 with reflection for WebGL2. Browsers then need no
//! shader translator. Build tools compile other shaders the same way with a [`Compiler`]. Paths
//! below are relative to the repository root:
//!
//! - [`MANIFEST_PATH`] lists the entry shaders, their render pipelines and their variants.
//! - [`SHADER_DIR`] holds the entry shaders, and its `lib` folder holds the library modules, which
//!   shaders import as `null3d::<file name>`.
//! - [`OUTPUT_PATH`] is the main generated module. The device modules sit beside it in
//!   [`OUTPUT_DIR`], one for each target and each value of the permutation bits that a device
//!   fixes, with the builds of the shaders that load by device.

mod composition;
mod features;
mod glsl;
mod library;
mod manifest;
mod material;
mod names;
mod output;
mod position;
mod problem;
mod scan;
mod typescript;
mod uniforms;

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::Path;

use naga::valid::{Capabilities, ModuleInfo, ValidationFlags, Validator};
use naga_oil::compose::preprocess::Preprocessor;
use naga_oil::compose::{NagaModuleDescriptor, ShaderDefValue};
use serde::{Deserialize, Serialize};

pub use features::ALLOWED_LANGUAGE_FEATURES;
pub use manifest::{Pipeline, Target, Variant};
pub use material::{MaterialOutput, MaterialSource, MaterialTemplate};
pub use output::{
    Binding, GlslProgram, GlslStage, GlslTexture, GlslUniformBlock, Output, Response,
    VariantOutput, WgslOutput,
};
pub use position::Position;
pub use problem::{BuildError, Problem};
pub use uniforms::Uniform;

use library::{Composers, Library, View};
use manifest::{Build, Manifest};

/// The manifest.
pub const MANIFEST_PATH: &str = "crates/null3d-shaders/shaders.toml";
/// The folder of entry shaders, with the library modules in its `lib` folder.
pub const SHADER_DIR: &str = "crates/null3d-shaders/wgsl";
/// The folder of the generated TypeScript modules.
pub const OUTPUT_DIR: &str = "packages/engine/src/generated";
/// The main generated TypeScript module.
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
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
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
    let mut compiler = Compiler::new(&inputs.files)?;
    check_files(inputs, &manifest).or(())?;

    let mut errors = BuildError::default();
    let mut output = Output::default();
    for (shader_name, shader) in &manifest.shaders {
        let label = |variant: &str| format!("{shader_name}.{variant}");
        let variants = compiler.variants(
            &shader_path(&shader.file),
            &inputs.files[&shader.file],
            &shader.pipelines,
            &shader.variants,
            &label,
            &mut errors,
        );
        output.shaders.insert(shader_name.clone(), variants);
        let pipelines = shader.pipelines.keys().cloned().collect();
        output.pipelines.insert(shader_name.clone(), pipelines);
        if shader.by_device {
            output.by_device.insert(shader_name.clone());
        }
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
        if manifest.shaders.values().any(|shader| shader.file == *file) {
            errors.add(features::check_directive_placement(&path, source), None);
        } else if !library::is_library_file(file) {
            let message = format!(
                "this entry shader is not in {MANIFEST_PATH}, so nothing builds it. Add a [shaders.<name>] table for it, or move a library module into lib/."
            );
            errors.add([Problem::in_file(&path, message)], None);
        }
    }
    errors
}

/// One shader for a [`Compiler`]: its WGSL, the path that messages name, its render pipelines and
/// its variants.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShaderSource {
    /// The file the shader comes from, as messages name it.
    pub path: String,
    /// The WGSL source.
    pub source: String,
    /// Render pipelines by name. WebGL2 gets one GLSL program for each, so a variant that targets
    /// GLSL needs at least one.
    #[serde(default)]
    pub pipelines: BTreeMap<String, Pipeline>,
    /// Builds of the shader by name.
    pub variants: BTreeMap<String, Variant>,
}

/// Compiles shaders that import the library modules. Each variant is composed with the modules
/// it imports, checked against the portable language features, validated, and written as WGSL,
/// GLSL ES 3.00 or both. The compiler keeps the library modules it composed for later variants.
pub struct Compiler {
    library: Library,
    preprocessor: Preprocessor,
    composers: Composers,
}

impl Compiler {
    /// A compiler for shaders that import the library modules among `files`: the files in `lib/`,
    /// by path relative to the shader folder. It ignores the other files.
    pub fn new(files: &BTreeMap<String, String>) -> Result<Self, BuildError> {
        Ok(Self {
            library: Library::load(files).map_err(BuildError::from_iter)?,
            preprocessor: Preprocessor::default(),
            composers: Composers::default(),
        })
    }

    /// Compiles every variant of a shader. The same problem in several variants is listed once,
    /// with the name of each variant.
    pub fn compile(
        &mut self,
        shader: &ShaderSource,
    ) -> Result<BTreeMap<String, VariantOutput>, BuildError> {
        manifest::check_builds("", &shader.pipelines, &shader.variants)
            .into_iter()
            .map(Problem::general)
            .collect::<BuildError>()
            .or(())?;
        features::check_directive_placement(&shader.path, &shader.source)
            .into_iter()
            .collect::<BuildError>()
            .or(())?;
        let mut errors = BuildError::default();
        let built = self.variants(
            &shader.path,
            &shader.source,
            &shader.pipelines,
            &shader.variants,
            &str::to_owned,
            &mut errors,
        );
        errors.or(built)
    }

    /// Builds the variants of one entry shader, each once for every combination of its
    /// permutation bits, by build name. Problems go to `errors`, each named with the `label` of its
    /// build.
    fn variants(
        &mut self,
        path: &str,
        source: &str,
        pipelines: &BTreeMap<String, Pipeline>,
        variants: &BTreeMap<String, Variant>,
        label: &dyn Fn(&str) -> String,
        errors: &mut BuildError,
    ) -> BTreeMap<String, VariantOutput> {
        let mut built = BTreeMap::new();
        for (name, variant) in variants {
            for build in variant.builds(name) {
                match self.variant(path, source, pipelines, variant, &build) {
                    Ok(output) => {
                        built.insert(build.name, output);
                    }
                    Err(problems) => errors.add(problems, Some(&label(&build.name))),
                }
            }
        }
        built
    }

    /// Builds one build of a variant of an entry shader: checks its source, composes and
    /// validates it, and writes each target.
    fn variant(
        &mut self,
        path: &str,
        source: &str,
        pipelines: &BTreeMap<String, Pipeline>,
        variant: &Variant,
        build: &Build,
    ) -> Result<VariantOutput, Vec<Problem>> {
        let defs: HashMap<String, ShaderDefValue> = build
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

        let composer = self
            .composers
            .get(&self.library, capabilities)
            .map_err(|p| vec![p])?;
        let mut module = composer
            .make_naga_module(NagaModuleDescriptor {
                source,
                file_path: path,
                shader_defs: defs,
                ..Default::default()
            })
            .map_err(|e| {
                vec![features::composition_problem(
                    &e,
                    composer,
                    &views,
                    &self.library,
                )]
            })?;
        let info = validate(&module, capabilities)?;
        let mut problems = features::check_module(&module, &info, &views);
        problems.extend(missing_entry_points(pipelines, path, &module));
        fail_on(problems)?;

        naga::compact::compact(&mut module, naga::compact::KeepUnused::No);
        names::undecorate(&mut module, &self.library);
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
                pipelines: pipelines.clone(),
            })
        } else {
            None
        };
        let glsl = if variant.has(Target::Glsl) {
            let programs = pipelines.iter().map(|(name, pipeline)| {
                glsl::write_program(&module, &info, name, pipeline)
                    .map(|program| (name.clone(), program))
                    .map_err(|message| vec![Problem::in_file(path, message)])
            });
            Some(programs.collect::<Result<BTreeMap<_, _>, _>>()?)
        } else {
            None
        };
        Ok(VariantOutput {
            permutation: build.permutation,
            wgsl,
            glsl,
        })
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
fn missing_entry_points(
    pipelines: &BTreeMap<String, Pipeline>,
    path: &str,
    module: &naga::Module,
) -> Vec<Problem> {
    let mut problems = Vec::new();
    for (name, pipeline) in pipelines {
        for (stage, stage_name, entry) in pipeline.stages() {
            if !module
                .entry_points
                .iter()
                .any(|ep| ep.stage == stage && ep.name == entry)
            {
                problems.push(Problem::in_file(
                    path,
                    format!(
                        "pipeline `{name}` names the {stage_name} entry point `{entry}`, which this variant of the shader does not define. Check the pipeline's entry point names, and the shader defs that hide code."
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

/// Renders built output as TypeScript modules, by path: the main module at [`OUTPUT_PATH`] and
/// each device module beside it.
pub fn typescript(output: &Output) -> BTreeMap<String, String> {
    typescript::modules(output)
        .into_iter()
        .map(|(stem, text)| (format!("{OUTPUT_DIR}/{stem}.ts"), text))
        .collect()
}

/// Builds the manifest in `root` and returns the TypeScript modules by path.
pub fn generate(root: &Path) -> Result<BTreeMap<String, String>, BuildError> {
    Ok(typescript(&build(&Inputs::read(root)?)?))
}

/// Whether [`write`] changed any file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Written {
    /// A module was missing or different and now holds the new output, or a device module that
    /// the build no longer makes was deleted.
    Updated,
    /// Every module already held the output.
    Unchanged,
}

/// Device modules in the output folder that the build did not make, by path.
fn stale_modules(root: &Path, modules: &BTreeMap<String, String>) -> Vec<String> {
    let Ok(entries) = fs::read_dir(root.join(OUTPUT_DIR)) else {
        return Vec::new();
    };
    let mut stale: Vec<String> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with(typescript::DEVICE_MODULE_PREFIX) && name.ends_with(".ts"))
        .map(|name| format!("{OUTPUT_DIR}/{name}"))
        .filter(|path| !modules.contains_key(path))
        .collect();
    stale.sort();
    stale
}

/// Builds and writes the TypeScript modules that changed, and deletes device modules that the
/// build no longer makes.
pub fn write(root: &Path) -> Result<Written, BuildError> {
    let modules = generate(root)?;
    let mut written = Written::Unchanged;
    for path in stale_modules(root, &modules) {
        fs::remove_file(root.join(&path))
            .map_err(|e| Problem::in_file(&path, format!("cannot delete the file: {e}")))?;
        written = Written::Updated;
    }
    for (path, module) in &modules {
        let file = root.join(path);
        if fs::read_to_string(&file).is_ok_and(|current| current == *module) {
            continue;
        }
        file.parent()
            .map_or(Ok(()), fs::create_dir_all)
            .and_then(|()| fs::write(&file, module))
            .map_err(|e| Problem::in_file(path, format!("cannot write the file: {e}")))?;
        written = Written::Updated;
    }
    Ok(written)
}
