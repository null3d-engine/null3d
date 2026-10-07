//! Custom materials: WGSL functions that the engine's standard material template calls, such as a
//! surface function. The build adds the functions after the template's last line and builds every
//! variant of the template, each with the shader def of every function the WGSL declares. The
//! functions then share the template's lighting, and every GPU path, with the standard material.
//! A `struct Uniforms` in the WGSL declares the material's uniforms: the build then adds the
//! function that loads them after the WGSL, and builds with the shader def CUSTOM_UNIFORMS.
//! Module-scope `var name: texture_2d<f32>;` lines declare its textures (see [`crate::textures`]):
//! the build binds them after the WGSL, gives each texture function the texture's layer, and
//! builds with the shader def CUSTOM_TEXTURES, which loads the layers.
//!
//! WGSL with a `@vertex` and a `@fragment` entry point is a full shader instead: the build makes
//! the variants that the engine's mesh templates need of it on its own, for WebGPU and for WebGL2
//! with and without the draw index. Either way, the output says which vertex attributes the
//! vertex stage reads, which a mesh needs to draw with the material.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use null3d_gpu::drawlist::vertex;

use crate::manifest::{Manifest, Pipeline, Shader, Target, Variant};
use crate::position::locate;
use crate::scan::{Token, find_function, tokenize};
use crate::textures::{self, Texture};
use crate::uniforms::{self, Owner, Uniform};
use crate::{
    BuildError, Compiler, Inputs, MANIFEST_PATH, Position, Problem, VariantOutput, features,
};

/// The shader def that makes the template load a custom material's uniforms.
const UNIFORMS_DEF: &str = "CUSTOM_UNIFORMS";
/// The shader def that makes the template load the layers of a custom material's textures.
const TEXTURES_DEF: &str = "CUSTOM_TEXTURES";

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
        Self::marked(inputs, "custom materials", "custom_materials", |shader| {
            shader.custom_materials
        })
    }

    /// Finds the one shader of a manifest that `marked` picks, the template of `what`, which the
    /// manifest marks with `flag`.
    pub(crate) fn marked(
        inputs: &Inputs,
        what: &str,
        flag: &str,
        marked: impl Fn(&Shader) -> bool,
    ) -> Result<Self, BuildError> {
        let manifest = Manifest::parse(&inputs.manifest).map_err(|messages| {
            messages
                .into_iter()
                .map(|message| Problem::in_file(MANIFEST_PATH, message))
                .collect::<BuildError>()
        })?;
        let mut found = manifest
            .shaders
            .into_values()
            .filter(|shader| marked(shader));
        let (Some(shader), None) = (found.next(), found.next()) else {
            return Err(Problem::in_file(
                MANIFEST_PATH,
                format!("{what} need one template: mark exactly one shader with `{flag} = true`."),
            )
            .into());
        };
        let source = inputs.files.get(&shader.file).ok_or_else(|| {
            Problem::in_file(
                MANIFEST_PATH,
                format!(
                    "the template for {what}, \"{}\", does not exist.",
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

    /// The lines of the template before the first line of the WGSL that joins it.
    fn lines(&self) -> u32 {
        self.source.bytes().filter(|&byte| byte == b'\n').count() as u32
    }

    /// The template's source, which ends with a line break.
    pub(crate) fn source(&self) -> &str {
        &self.source
    }

    /// The template's render pipelines.
    pub(crate) fn pipelines(&self) -> &BTreeMap<String, Pipeline> {
        &self.pipelines
    }

    /// The template's variants.
    pub(crate) fn variants(&self) -> &BTreeMap<String, Variant> {
        &self.variants
    }

    /// Points the problems of a build of the template with `own`, the WGSL that joined it after
    /// the template's last line from file `path`, at the lines of `own`. A problem in the
    /// template's own lines loses its place and gets `note`.
    pub(crate) fn place_problems(
        &self,
        errors: &mut BuildError,
        path: &str,
        own: &str,
        note: &str,
    ) {
        let before = self.lines();
        let own = own.bytes().filter(|&byte| byte == b'\n').count() as u32 + 1;
        for problem in &mut errors.problems {
            if problem.file.as_deref() != Some(path) {
                continue;
            }
            // A problem without a line, such as a GLSL writer's refusal of a WGSL form, can come
            // from the joined code as well as from the template, so it gets no note.
            match problem.line {
                None => {}
                Some(line) if line > before && line - before <= own => {
                    problem.line = Some(line - before);
                }
                Some(_) => {
                    problem.line = None;
                    problem.column = None;
                    problem.message = format!("{}\n{note}", problem.message);
                }
            }
        }
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
    /// The share of the builds to make, or `None` for every build.
    #[serde(default)]
    pub share: Option<Share>,
}

/// One share of a custom material's builds, so that several threads build one material at once
/// and the caller joins their outputs. A share holds the builds whose place in the build order,
/// counted from 0, leaves `index` when divided by `count`. Every share also holds the WebGPU builds
/// without permutation bits, which give the vertex inputs that each output carries.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Share {
    pub index: u32,
    pub count: u32,
}

impl Share {
    /// True when the share holds the build at `place` in the build order, of `variant`.
    pub(crate) fn holds(self, place: u32, variant: &Variant, permutation: u32) -> bool {
        place % self.count == self.index
            || (permutation == 0 && variant.targets.contains(&Target::Wgsl))
    }

    /// The problem of a share that holds no place, or None.
    fn problem(self) -> Option<Problem> {
        (self.count == 0 || self.index >= self.count).then(|| {
            Problem::general(format!(
                "the shader compiler got share {} of {}: a share's index is below its count.",
                self.index, self.count
            ))
        })
    }
}

/// A custom material, built into every variant of the template, or a full shader.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialOutput {
    /// The functions that the WGSL declares for the template to call, such as `surface`.
    pub functions: Vec<String>,
    /// The fields of the WGSL's `struct Uniforms`, where the engine writes each: none without
    /// the struct.
    pub uniforms: Vec<Uniform>,
    /// The textures that the WGSL declares, in the order of their slots: none without any.
    pub textures: Vec<Texture>,
    /// The template's variants with the WGSL, or the full shader's, by name.
    pub variants: BTreeMap<String, VariantOutput>,
    /// The vertex shader locations that the vertex stage reads from a mesh's vertices, in order.
    pub locations: Vec<u32>,
    /// The optional vertex attributes (`vertex::*` bits) that those locations read, which a mesh
    /// needs to draw with the material.
    pub attributes: u32,
    /// True when the shader reads the material's base color and opacity in its `VERTEX_COLOR` and
    /// `ALPHA_MASK` builds: the template does, and a full shader reads colors itself.
    pub base_color: bool,
}

/// The entry points of a full shader: its `@vertex` function's name and the `@fragment` ones'.
fn entry_points<'a>(tokens: &[Token<'a>]) -> (Vec<&'a str>, Vec<&'a str>) {
    let (mut vertex, mut fragment) = (Vec::new(), Vec::new());
    for (index, token) in tokens.iter().enumerate() {
        if token.text != "@" {
            continue;
        }
        let Some(stage) = tokens.get(index + 1) else {
            continue;
        };
        let list = match stage.text {
            "vertex" => &mut vertex,
            "fragment" => &mut fragment,
            _ => continue,
        };
        let name = tokens[index..]
            .windows(2)
            .find(|pair| pair[0].text == "fn")
            .map(|pair| pair[1].text);
        list.extend(name);
    }
    (vertex, fragment)
}

/// The mesh locations that the vertex entry point `entry` of a module's WGSL reads, below the
/// per-instance locations, with the optional attributes that they read.
fn mesh_inputs(wgsl: &str, entry: &str) -> (Vec<u32>, u32) {
    let Ok(module) = naga::front::wgsl::parse_str(wgsl) else {
        return (Vec::new(), 0);
    };
    let mut locations = Vec::new();
    let mut add = |binding: &Option<naga::Binding>| {
        if let Some(naga::Binding::Location { location, .. }) = binding
            && *location < vertex::INSTANCE_LOCATION
        {
            locations.push(*location);
        }
    };
    let found = module
        .entry_points
        .iter()
        .find(|point| point.stage == naga::ShaderStage::Vertex && point.name == entry);
    for argument in found.iter().flat_map(|point| &point.function.arguments) {
        add(&argument.binding);
        if let naga::TypeInner::Struct { members, .. } = &module.types[argument.ty].inner {
            members.iter().for_each(|member| add(&member.binding));
        }
    }
    locations.sort_unstable();
    locations.dedup();
    let attributes = vertex::ATTRIBUTES
        .iter()
        .filter(|attribute| locations.contains(&attribute.location))
        .fold(0, |bits, attribute| bits | attribute.bit);
    (locations, attributes)
}

/// The mesh inputs of the base WebGPU build among `built`, whose vertex entry point is `entry`.
fn built_inputs(built: &BTreeMap<String, VariantOutput>, entry: &str) -> (Vec<u32>, u32) {
    built
        .values()
        .filter(|variant| variant.permutation == 0)
        .find_map(|variant| variant.wgsl.as_ref())
        .map_or((Vec::new(), 0), |wgsl| mesh_inputs(&wgsl.source, entry))
}

/// The first line of a full shader, which the build adds: WebGL2's multi-draw builds read the
/// draw index in `null3d::mesh`, and the directive goes at the top of the file.
const FULL_SHADER_HEADER: &str = "enable draw_index;\n";

impl Compiler {
    /// Builds a custom material's WGSL into every variant of the template, or into the builds of
    /// its share. Problems in the WGSL name its own lines; problems in the template's lines say so.
    pub fn compile_material(
        &mut self,
        template: &MaterialTemplate,
        material: &MaterialSource,
    ) -> Result<MaterialOutput, BuildError> {
        if let Some(problem) = material.share.and_then(Share::problem) {
            return Err(BuildError::from_iter([problem]));
        }
        let path = material.path.as_str();
        let tokens = tokenize(&material.source);
        let (vertex_entries, fragment_entries) = entry_points(&tokens);
        if !vertex_entries.is_empty() || !fragment_entries.is_empty() {
            return self.compile_full_shader(material, &vertex_entries, &fragment_entries);
        }
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
        problems.extend(directive_problems(material));
        let found = textures::read(&tokens, &material.source, path, false);
        let (texture_fields, own_source, bindings) = match found {
            Ok(found) => (found.fields, found.source, found.declarations),
            Err(found) => {
                problems.extend(found);
                (Vec::new(), material.source.clone(), String::new())
            }
        };
        let room = texture_fields.len() as u32;
        let uniforms = uniforms::read(&tokens, &material.source, path, room, Owner::Material)
            .unwrap_or_else(|found| {
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
                if !texture_fields.is_empty() {
                    defs.push(TEXTURES_DEF.to_owned());
                }
                defs.sort();
                // Custom materials draw at full precision, so their builds stay half as many. On
                // WebGPU they draw skinned meshes from the skinning pass's vertices, so they need no
                // SKIN builds there. WebGL2 skins in the vertex shader, so its builds keep the bit.
                // They have no MORPH builds, which would double their WebGL2 builds again: on
                // WebGL2 they draw morphed meshes at rest (decision record D-51).
                let skins = !variant.targets.contains(&Target::Wgsl);
                let permutations = variant
                    .permutations
                    .iter()
                    .filter(|bit| *bit != "HALF" && *bit != "MORPH" && (skins || *bit != "SKIN"))
                    .cloned()
                    .collect();
                let variant = Variant {
                    defs,
                    permutations,
                    targets: variant.targets.clone(),
                };
                (name.clone(), variant)
            })
            .collect();
        let loader = uniforms.as_ref().map_or("", |found| found.loader.as_str());
        let source = format!("{}{own_source}{loader}{bindings}", template.source);
        let mut errors = BuildError::default();
        let built = self.variants(
            path,
            &source,
            &template.pipelines,
            &variants,
            material.share,
            &str::to_owned,
            &mut errors,
        );
        template.place_problems(&mut errors, path, &material.source, TEMPLATE_NOTE);
        let vertex_entry = template.pipelines.values().next().map(|p| p.vertex.clone());
        let (locations, attributes) = built_inputs(&built, &vertex_entry.unwrap_or_default());
        errors.or(MaterialOutput {
            functions: declared.iter().map(|hook| hook.name.to_owned()).collect(),
            uniforms: uniforms.map_or_else(Vec::new, |found| found.fields),
            textures: texture_fields,
            variants: built,
            locations,
            attributes,
            base_color: true,
        })
    }

    /// Builds a full shader, a `@vertex` and a `@fragment` entry point, into the variants of the
    /// engine's mesh templates: for WebGPU, and for WebGL2 with and without the draw index of
    /// `WEBGL_multi_draw`, each with and without the tone mapping that `finish` applies on the
    /// 8-bit path. The WebGPU builds also come with and without RECEIVE_SHADOWS, which the engine
    /// asks for where an object receives shadows. Problems name the lines of the WGSL.
    fn compile_full_shader(
        &mut self,
        material: &MaterialSource,
        vertex_entries: &[&str],
        fragment_entries: &[&str],
    ) -> Result<MaterialOutput, BuildError> {
        let path = material.path.as_str();
        let mut problems = directive_problems(material);
        if let Err(found) =
            textures::read(&tokenize(&material.source), &material.source, path, true)
        {
            problems.extend(found);
        }
        let (&[vertex_entry], &[fragment_entry]) = (vertex_entries, fragment_entries) else {
            problems.push(Problem::at(
                path,
                Some(Position { line: 1, column: 1 }),
                "a full shader for `materials.shader` has one `@vertex` and one `@fragment` entry point. Split the others into shaders of their own.",
            ));
            return Err(problems.into_iter().collect());
        };
        if !problems.is_empty() {
            return Err(problems.into_iter().collect());
        }
        let pipelines = BTreeMap::from([(
            FULL_SHADER_PIPELINE.to_owned(),
            Pipeline {
                vertex: vertex_entry.to_owned(),
                fragment: fragment_entry.to_owned(),
            },
        )]);
        let variants = BTreeMap::from([
            (
                "webgpu".to_owned(),
                Variant {
                    defs: Vec::new(),
                    permutations: vec!["TONE_MAP".to_owned(), "RECEIVE_SHADOWS".to_owned()],
                    targets: vec![Target::Wgsl],
                },
            ),
            (
                "webgl2".to_owned(),
                Variant {
                    defs: vec!["WEBGL2".to_owned()],
                    permutations: vec!["DRAW_INDEX".to_owned(), "TONE_MAP".to_owned()],
                    targets: vec![Target::Glsl],
                },
            ),
        ]);
        let source = format!("{FULL_SHADER_HEADER}{}", material.source);
        let mut errors = BuildError::default();
        let built = self.variants(
            path,
            &source,
            &pipelines,
            &variants,
            material.share,
            &str::to_owned,
            &mut errors,
        );
        for problem in &mut errors.problems {
            if problem.file.as_deref() == Some(path) {
                problem.line = problem.line.map(|line| line.saturating_sub(1).max(1));
            }
        }
        let (locations, attributes) = built_inputs(&built, vertex_entry);
        errors.or(MaterialOutput {
            functions: Vec::new(),
            uniforms: Vec::new(),
            textures: Vec::new(),
            variants: built,
            locations,
            attributes,
            base_color: false,
        })
    }
}

/// The render pipeline that a full shader draws with.
const FULL_SHADER_PIPELINE: &str = "main";

/// A problem for each directive in a custom material's WGSL, such as `enable`.
fn directive_problems(material: &MaterialSource) -> Vec<Problem> {
    features::directive_lines(&material.source)
        .into_iter()
        .map(|line| {
            Problem::at(
                &material.path,
                Some(Position { line, column: 1 }),
                "a custom material's WGSL cannot hold directives such as `enable`, because the engine adds its own lines before or around it. Remove the line: custom materials use no optional WGSL features.",
            )
        })
        .collect()
}
