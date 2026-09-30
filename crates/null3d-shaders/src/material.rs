//! Custom materials: WGSL functions that the engine's standard material template calls, such as a
//! surface function. The build adds the functions after the template's last line and builds every
//! variant of the template, each with the shader def of every function the WGSL declares. The
//! functions then share the template's lighting, and every GPU path, with the standard material.
//! A `struct Uniforms` in the WGSL declares the material's uniforms: the build then adds the
//! function that loads them after the WGSL, and builds with the shader def CUSTOM_UNIFORMS.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::manifest::{Manifest, Pipeline, Variant};
use crate::position::locate;
use crate::scan::{Token, find_function, tokenize};
use crate::uniforms::{self, Uniform};
use crate::{
    BuildError, Compiler, Inputs, MANIFEST_PATH, Position, Problem, VariantOutput, features,
};

/// The shader def that makes the template load a custom material's uniforms.
const UNIFORMS_DEF: &str = "CUSTOM_UNIFORMS";

/// A function that a custom material's WGSL may declare for the template to call.
struct Hook {
    name: &'static str,
    /// The shader def that makes the template call it.
    def: &'static str,
    /// The types of its parameters, in order.
    params: &'static [&'static str],
    /// The type it returns.
    returns: &'static str,
    /// Its signature, as messages show it.
    signature: &'static str,
}

/// The functions a custom material's WGSL may declare.
const HOOKS: [Hook; 2] = [
    Hook {
        name: "surface",
        def: "CUSTOM_SURFACE",
        params: &["SurfaceInput"],
        returns: "Surface",
        signature: "fn surface(input: SurfaceInput) -> Surface",
    },
    Hook {
        name: "vertexOffset",
        def: "CUSTOM_VERTEX_OFFSET",
        params: &["VertexInput"],
        returns: "vec3f",
        signature: "fn vertexOffset(input: VertexInput) -> vec3f",
    },
];

/// The shader defs of every custom material's build: the custom material's built-in values, and
/// the first texture coordinates.
const CUSTOM_DEFS: [&str; 2] = ["CUSTOM", "UV0"];

/// What a problem in the template's own lines says after its message.
const TEMPLATE_NOTE: &str = "The problem is in the engine's standard material, which your WGSL joins. Check that your WGSL does not declare a name that the engine's code uses, or import a module whole under a name that it uses. Import the items you use by name instead, as in `#import null3d::noise::{fbm3}`.";

/// True when the function's parameters have the hook's types and it returns the hook's type.
fn has_signature(tokens: &[Token], hook: &Hook) -> bool {
    let Some(function) = find_function(tokens, hook.name) else {
        return false;
    };
    let params: Vec<&str> = tokens[function.params.clone()]
        .split(|token| token.text == ",")
        .filter(|param| !param.is_empty())
        .map(|param| match param {
            [_, colon, ty] if colon.text == ":" => ty.text,
            _ => "",
        })
        .collect();
    let returns: Vec<&str> = tokens[function.params.end + 1..function.body.start - 1]
        .iter()
        .map(|token| token.text)
        .collect();
    params == hook.params && returns == ["->", hook.returns]
}

/// The template that custom materials build with: the entry shader that the manifest marks with
/// `custom_materials = true`.
#[derive(Debug)]
pub struct MaterialTemplate {
    source: String,
    pipelines: BTreeMap<String, Pipeline>,
    variants: BTreeMap<String, Variant>,
}

impl MaterialTemplate {
    /// Finds the template in a manifest and its files.
    pub fn load(inputs: &Inputs) -> Result<Self, BuildError> {
        let manifest = Manifest::parse(&inputs.manifest).map_err(|messages| {
            messages
                .into_iter()
                .map(|message| Problem::in_file(MANIFEST_PATH, message))
                .collect::<BuildError>()
        })?;
        let mut marked = manifest
            .shaders
            .into_values()
            .filter(|shader| shader.custom_materials);
        let (Some(shader), None) = (marked.next(), marked.next()) else {
            return Err(Problem::in_file(
                MANIFEST_PATH,
                "custom materials need one template: mark exactly one shader with `custom_materials = true`.",
            )
            .into());
        };
        let source = inputs.files.get(&shader.file).ok_or_else(|| {
            Problem::in_file(
                MANIFEST_PATH,
                format!(
                    "the template for custom materials, \"{}\", does not exist.",
                    shader.file
                ),
            )
        })?;
        let mut source = source.clone();
        if !source.ends_with('\n') {
            source.push('\n');
        }
        Ok(Self {
            source,
            pipelines: shader.pipelines,
            variants: shader.variants,
        })
    }

    /// The lines of the template before a custom material's first line.
    fn lines(&self) -> u32 {
        self.source.bytes().filter(|&byte| byte == b'\n').count() as u32
    }
}

/// The WGSL of a custom material, for [`Compiler::compile_material`].
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MaterialSource {
    /// The file the WGSL comes from, as messages name it.
    pub path: String,
    /// The WGSL: functions that the template calls, and anything they use.
    pub source: String,
}

/// A custom material, built into every variant of the template.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MaterialOutput {
    /// The functions that the WGSL declares for the template to call, such as `surface`.
    pub functions: Vec<String>,
    /// The fields of the WGSL's `struct Uniforms`, where the engine writes each: none without
    /// the struct.
    pub uniforms: Vec<Uniform>,
    /// The template's variants with the WGSL, by name.
    pub variants: BTreeMap<String, VariantOutput>,
}

impl Compiler {
    /// Builds a custom material's WGSL into every variant of the template. Problems in the WGSL
    /// name its own lines; problems in the template's lines say so.
    pub fn compile_material(
        &mut self,
        template: &MaterialTemplate,
        material: &MaterialSource,
    ) -> Result<MaterialOutput, BuildError> {
        let path = material.path.as_str();
        let tokens = tokenize(&material.source);
        let declared: Vec<&Hook> = HOOKS
            .iter()
            .filter(|hook| find_function(&tokens, hook.name).is_some())
            .collect();
        let mut problems: Vec<Problem> = declared
            .iter()
            .filter(|hook| !has_signature(&tokens, hook))
            .filter_map(|hook| {
                let function = find_function(&tokens, hook.name)?;
                let source = &material.source;
                let position = locate(source, source, tokens[function.name].start);
                let message = format!(
                    "`{}` does not have the signature that the engine calls. Declare it as `{}`.",
                    hook.name, hook.signature
                );
                Some(Problem::at(path, Some(position), message))
            })
            .collect();
        problems.extend(features::directive_lines(&material.source)
            .into_iter()
            .map(|line| {
                let position = Position { line, column: 1 };
                Problem::at(
                    path,
                    Some(position),
                    "a custom material's WGSL cannot hold directives such as `enable`, because the engine adds it after the lines of its own shader. Remove the line: custom materials use no optional WGSL features.",
                )
            }));
        let uniforms = uniforms::read(&tokens, &material.source, path).unwrap_or_else(|found| {
            problems.extend(found);
            None
        });
        if declared.is_empty() {
            problems.push(Problem::at(
                path,
                Some(Position { line: 1, column: 1 }),
                "the WGSL declares no function of a custom material. Declare `fn surface(input: SurfaceInput) -> Surface`, which starts from `defaultSurface(input)`, `fn vertexOffset(input: VertexInput) -> vec3f`, or both. For a shader of your own, give the WGSL a `@vertex` and a `@fragment` entry point instead.",
            ));
        }
        if !problems.is_empty() {
            return Err(problems.into_iter().collect());
        }

        let variants: BTreeMap<String, Variant> = template
            .variants
            .iter()
            .map(|(name, variant)| {
                let mut defs = variant.defs.clone();
                defs.extend(CUSTOM_DEFS.map(str::to_owned));
                defs.extend(declared.iter().map(|hook| hook.def.to_owned()));
                defs.extend(uniforms.as_ref().map(|_| UNIFORMS_DEF.to_owned()));
                defs.sort();
                let variant = Variant {
                    defs,
                    permutations: variant.permutations.clone(),
                    targets: variant.targets.clone(),
                };
                (name.clone(), variant)
            })
            .collect();
        let loader = uniforms.as_ref().map_or("", |found| found.loader.as_str());
        let source = format!("{}{}{loader}", template.source, material.source);
        let mut errors = BuildError::default();
        let built = self.variants(
            path,
            &source,
            &template.pipelines,
            &variants,
            &str::to_owned,
            &mut errors,
        );
        let before = template.lines();
        let own = material
            .source
            .bytes()
            .filter(|&byte| byte == b'\n')
            .count() as u32
            + 1;
        for problem in &mut errors.problems {
            if problem.file.as_deref() != Some(path) {
                continue;
            }
            match problem.line {
                Some(line) if line > before && line - before <= own => {
                    problem.line = Some(line - before);
                }
                _ => {
                    problem.line = None;
                    problem.column = None;
                    problem.message = format!("{}\n{TEMPLATE_NOTE}", problem.message);
                }
            }
        }
        errors.or(MaterialOutput {
            functions: declared.iter().map(|hook| hook.name.to_owned()).collect(),
            uniforms: uniforms.map_or_else(Vec::new, |found| found.fields),
            variants: built,
        })
    }
}
