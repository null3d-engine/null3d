//! Custom materials: WGSL functions that the engine's standard material template calls, such as a
//! surface function. The build adds the functions after the template's last line and builds every
//! variant of the template, each with the shader def of every function the WGSL declares. The
//! functions then share the template's lighting, and every GPU path, with the standard material.
//! A `struct Uniforms` in the WGSL declares the material's uniforms: the build then adds the
//! function that loads them after the WGSL, and builds with the shader def CUSTOM_UNIFORMS.
//! Module-scope `var name: texture_2d<f32>;` lines declare its textures (see [`crate::textures`]):
//! the build binds them after the WGSL, gives each texture function the texture's layer, and
//! builds with the shader def CUSTOM_TEXTURES, which loads the layers. WGSL that calls
//! `sceneDepth` or `sceneDistance` builds with SCENE_DEPTH, which binds the copy of the scene's
//! depth in the shading builds alone: the caster, motion and pick builds use stand-ins, as they
//! read no surface. A `fn coverage` declares the opacity that the material's shadow caster tests,
//! so a card cuts its own shape out of its shadow: its caster builds then keep the mask bit and run
//! that function in a fragment stage. WGSL with a `@vertex` and a `@fragment` entry point is a full
//! shader instead: the build makes the variants that the engine's mesh templates need of it on its
//! own, for WebGPU and for WebGL2 with and without the draw index. Either way, the output says
//! which vertex attributes the vertex stage reads, which a mesh needs to draw with the material.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use null3d_gpu::drawlist::vertex;

use crate::manifest::{Manifest, Pipeline, Shader, Target, Variant};
use crate::position::locate;
use crate::scan::{Token, find_function, tokenize};
use crate::textures::{self, Texture, TextureOwner};
use crate::uniforms::{self, Owner, Uniform};
use crate::{
    BuildError, Compiler, Inputs, MANIFEST_PATH, Position, Problem, VariantOutput, features,
};

/// The shader def that makes the template load a custom material's uniforms.
const UNIFORMS_DEF: &str = "CUSTOM_UNIFORMS";
/// The shader def that makes the template load the layers of a custom material's textures.
const TEXTURES_DEF: &str = "CUSTOM_TEXTURES";
/// The shader def that puts the joint texture's group after the template's own groups on WebGPU:
/// after the maps' group, or after the scene depth's.
const JOINTS_AFTER_MAPS_DEF: &str = "JOINTS_AFTER_MAPS";
/// The shader def that puts the joint texture's group after both the maps' group and the scene
/// depth's, which a material with textures that reads the depth binds.
const JOINTS_AFTER_SCENE_DEF: &str = "JOINTS_AFTER_SCENE";
/// The shader def that binds the copy of the camera's opaque depth for a custom material's
/// surface function, which reads it through `sceneDepth` and `sceneDistance`.
const SCENE_DEPTH_DEF: &str = "SCENE_DEPTH";
/// The shader def that gives a caster, motion or pick build stand-ins for the scene's depth
/// functions, which the material's WGSL may call where no surface is shaded.
const SCENE_DEPTH_STUB_DEF: &str = "SCENE_DEPTH_STUB";
/// The permutation bit of the lit templates' builds that shade area lights, which every build of a
/// custom material holds as a shader def instead.
const AREA_LIGHTS: &str = "AREA_LIGHTS";

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
const HOOKS: [Hook; 4] = [
    Hook {
        name: "surface",
        def: "CUSTOM_SURFACE",
        params: &["SurfaceInput"],
        returns: "Surface",
        signature: "fn surface(input: SurfaceInput) -> Surface",
    },
    Hook {
        name: "vertexOffset",
        def: VERTEX_OFFSET_DEF,
        params: &["VertexInput"],
        returns: "vec3f",
        signature: "fn vertexOffset(input: VertexInput) -> vec3f",
    },
    Hook {
        name: "lobe",
        def: "CUSTOM_LOBE",
        params: &["LobeInput"],
        returns: "vec3f",
        signature: "fn lobe(input: LobeInput) -> vec3f",
    },
    Hook {
        name: "coverage",
        def: COVERAGE_DEF,
        params: &["SurfaceInput"],
        returns: "f32",
        signature: "fn coverage(input: SurfaceInput) -> f32",
    },
];

/// The shader def that makes the template call a custom material's vertex offset.
const VERTEX_OFFSET_DEF: &str = "CUSTOM_VERTEX_OFFSET";
/// The shader def that makes a custom material's shadow caster test the material's coverage.
const COVERAGE_DEF: &str = "CUSTOM_COVERAGE";
/// The shader def that makes the template light a custom surface's diffuse and ambient light by a
/// normal that the material names, which only WGSL that reads the field gets.
const DIFFUSE_NORMAL_DEF: &str = "CUSTOM_DIFFUSE_NORMAL";

/// `defs` without the def that binds the scene's depth, which only the shading builds read: a
/// caster, a motion or a pick build draws no surface function, so it takes no depth group.
fn without_scene_depth(defs: &[String]) -> Vec<String> {
    // A build with only the scene depth takes no group after the frame's once the depth is gone, so
    // its joint texture goes back to the group after the frame's. A build with textures keeps the
    // group that the maps take, and loses the depth's group from before the joint texture. A build
    // that shaded a surface gets stand-ins for the functions that its WGSL may call, so the WGSL
    // still builds where no surface runs.
    let textures = defs.iter().any(|def| def == TEXTURES_DEF);
    let shaded = defs.iter().any(|def| def == SCENE_DEPTH_DEF);
    let mut out: Vec<String> = defs
        .iter()
        .filter(|def| {
            !matches!(
                def.as_str(),
                SCENE_DEPTH_DEF | JOINTS_AFTER_SCENE_DEF | JOINTS_AFTER_MAPS_DEF
            )
        })
        .cloned()
        .collect();
    // With the depth's group gone, the maps' group is the last before the joint texture, and the
    // frame's alone where the material has no textures.
    if textures {
        out.push(JOINTS_AFTER_MAPS_DEF.to_owned());
    }
    out.sort();
    if shaded {
        out.push(SCENE_DEPTH_STUB_DEF.to_owned());
    }
    out
}

/// The bits of a custom material's shading builds that its shadow caster builds keep: the draw
/// index and skins on WebGL2.
const CASTER_KEEPS: [&str; 2] = ["DRAW_INDEX", "SKIN"];

/// The bits of a custom material's shading builds that its shadow caster builds keep beside the
/// ones every caster keeps: row values, which a vertex offset may read, and the mask that the
/// caster's fragment stage tests, with the vertex color its surface input reads.
const CASTER_MASK_KEEPS: [&str; 3] = ["ROW_VALUES", "ALPHA_MASK", "VERTEX_COLOR"];

/// The same bits for a material whose WGSL sets the surface's alpha, which also keeps the alpha
/// hash where the material tests its mask that way.
const CASTER_ALPHA_KEEPS: [&str; 4] = ["ROW_VALUES", "ALPHA_MASK", "ALPHA_HASH", "VERTEX_COLOR"];

/// The variant of a custom material's shadow caster builds beside one of its shading variants:
/// the same defs and targets, every build with the CASTER bit, and with or without CASTER_OFFSET
/// for casters that draw their back faces. The material's vertex offset then moves its shadow as it
/// moves its surface. A material that names the coverage of its shadow, or sets the surface's
/// alpha, casts a masked shadow whose fragment stage tests that opacity.
fn caster_variant(shading: &Variant, alpha: bool, coverage: bool) -> Variant {
    let keeps: &[&str] = if alpha {
        &CASTER_ALPHA_KEEPS
    } else if coverage {
        &CASTER_MASK_KEEPS
    } else {
        &["ROW_VALUES"]
    };
    let mut permutations: Vec<String> = shading
        .permutations
        .iter()
        .filter(|bit| CASTER_KEEPS.contains(&bit.as_str()) || keeps.contains(&bit.as_str()))
        .cloned()
        .collect();
    permutations.extend(["CASTER_OFFSET", "CASTER"].map(str::to_owned));
    Variant {
        defs: without_scene_depth(&shading.defs),
        permutations,
        required: vec!["CASTER".to_owned()],
        targets: shading.targets.clone(),
    }
}

/// The bits of a custom material's shading builds that its motion builds keep: the draw index.
const MOTION_KEEPS: [&str; 1] = ["DRAW_INDEX"];

/// The bits of a custom material's shading builds that its motion builds keep beside the draw
/// index: row values, and the mask that the motion's fragment stage tests, with the vertex color
/// its surface input reads.
const MOTION_MASK_KEEPS: [&str; 3] = ["ROW_VALUES", "ALPHA_MASK", "VERTEX_COLOR"];

/// The same bits for a material whose WGSL sets the surface's alpha, which also keeps the alpha
/// hash where the material tests its mask that way.
const MOTION_ALPHA_KEEPS: [&str; 4] = ["ROW_VALUES", "ALPHA_MASK", "ALPHA_HASH", "VERTEX_COLOR"];

/// The variant of a custom material's motion builds beside one of its shading variants: the same
/// defs and targets, every build with the MOTION bit. The motion pass then draws the motion of the
/// material's vertex offset, as the material's sway moves its surface, and a material that names
/// the opacity of its motion cuts its holes (decision record D-140).
fn motion_variant(shading: &Variant, alpha: bool, coverage: bool) -> Variant {
    let keeps: &[&str] = if alpha {
        &MOTION_ALPHA_KEEPS
    } else if coverage {
        &MOTION_MASK_KEEPS
    } else {
        &["ROW_VALUES"]
    };
    let mut permutations: Vec<String> = shading
        .permutations
        .iter()
        .filter(|bit| MOTION_KEEPS.contains(&bit.as_str()) || keeps.contains(&bit.as_str()))
        .cloned()
        .collect();
    permutations.push("MOTION".to_owned());
    Variant {
        defs: without_scene_depth(&shading.defs),
        permutations,
        required: vec!["MOTION".to_owned()],
        targets: shading.targets.clone(),
    }
}

/// The bits of a custom material's shading builds that its pick builds keep: the draw index, and
/// what moves vertices or a vertex offset may read, skins and row values.
const PICK_KEEPS: [&str; 3] = ["DRAW_INDEX", "SKIN", "ROW_VALUES"];

/// The variant of a custom material's pick builds beside one of its shading variants: the same
/// defs with the instance's ids, which the fragment shader writes, and every build with the PICK
/// bit. The material's vertex offset then moves the object in GPU picking as it moves its surface.
fn pick_variant(shading: &Variant) -> Variant {
    let mut defs = without_scene_depth(&shading.defs);
    if !defs.iter().any(|def| def == OBJECT_IDS_DEF) {
        defs.push(OBJECT_IDS_DEF.to_owned());
        defs.sort();
    }
    let mut permutations: Vec<String> = shading
        .permutations
        .iter()
        .filter(|bit| PICK_KEEPS.contains(&bit.as_str()))
        .cloned()
        .collect();
    permutations.push("PICK".to_owned());
    Variant {
        defs,
        permutations,
        required: vec!["PICK".to_owned()],
        targets: shading.targets.clone(),
    }
}

/// The shader defs of every custom material's build: the custom material's built-in values, and
/// the first texture coordinates.
const CUSTOM_DEFS: [&str; 2] = ["CUSTOM", "UV0"];

/// An input of custom materials that costs something, which only WGSL that reads it gets.
struct Input {
    /// The shader def that makes the template fill it.
    def: &'static str,
    /// The fields whose reading turns it on, each after the value that it belongs to, or after any
    /// value with `None`.
    fields: &'static [(Option<&'static str>, &'static str)],
}

/// The shader def of the inputs that find an instance's index in its batch and its object's id.
const OBJECT_IDS_DEF: &str = "OBJECT_IDS";

/// The inputs that cost something: the second texture coordinates, a vertex attribute; the mesh's
/// vertex color, another vertex attribute, which a vertex offset reads as data; the instance's
/// index and the object's id, which the vertex shader finds in the table of object ranges; the
/// object's matrices, which pass to the fragment shader as three more values; and the four-number
/// vertex record, a vertex attribute that a generated shape's vertex offset reads.
const INPUTS: [Input; 5] = [
    Input {
        def: "CUSTOM_UV1",
        fields: &[(None, "uv1")],
    },
    Input {
        def: "CUSTOM_VERTEX_COLOR",
        fields: &[(None, "colors")],
    },
    Input {
        def: OBJECT_IDS_DEF,
        fields: &[(None, "instance"), (Some("object"), "id")],
    },
    Input {
        def: "OBJECT_MATRICES",
        fields: &[
            (Some("object"), "worldMatrix"),
            (Some("object"), "normalMatrix"),
        ],
    },
    Input {
        def: "CUSTOM_TARGET",
        fields: &[(None, "vertexRecord")],
    },
];

/// The functions that the template defines when the build binds the copy of the scene's depth.
const SCENE_DEPTH_FUNCTIONS: [&str; 2] = ["sceneDepth", "sceneDistance"];

/// True when the WGSL calls the function `name`.
fn calls_function(tokens: &[Token], name: &str) -> bool {
    tokens
        .windows(2)
        .any(|pair| pair[0].text == name && pair[1].text == "(")
}

/// True when the WGSL calls one of the scene's depth functions, so its builds bind the copy.
fn calls_scene_depth(tokens: &[Token]) -> bool {
    SCENE_DEPTH_FUNCTIONS
        .iter()
        .any(|name| calls_function(tokens, name))
}

/// True when the WGSL reads `field` of a value: a `.` and the field's name, after `owner` where it
/// names one.
fn reads_field(tokens: &[Token], owner: Option<&str>, field: &str) -> bool {
    tokens.windows(3).any(|three| {
        three[1].text == "."
            && three[2].text == field
            && owner.is_none_or(|owner| three[0].text == owner)
    })
}

/// The defs of the inputs that cost something which the WGSL reads.
fn read_inputs(tokens: &[Token]) -> Vec<&'static str> {
    INPUTS
        .iter()
        .filter(|input| {
            input
                .fields
                .iter()
                .any(|&(owner, field)| reads_field(tokens, owner, field))
        })
        .map(|input| input.def)
        .collect()
}

/// True when the WGSL names a normal of its own for the surface's diffuse and ambient light.
fn reads_diffuse_normal(tokens: &[Token]) -> bool {
    reads_field(tokens, None, "diffuseNormal")
}

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
    pub(crate) fn holds(self, place: usize, variant: &Variant, permutation: u32) -> bool {
        place % self.count as usize == self.index as usize
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
    /// True when the WGSL reads an instance's index or an object's id, which the vertex shader
    /// finds in the table of object ranges that the engine then keeps.
    pub object_ids: bool,
    /// True when the WGSL reads the copy of the scene's depth through `sceneDepth` or
    /// `sceneDistance`, so its shading builds bind the copy.
    pub scene_depth: bool,
    /// True when the WGSL sets or reads the surface's alpha, so the material has the builds of
    /// alpha to coverage, the alpha hash, a masked shadow caster and a masked motion.
    pub alpha: bool,
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

/// True when a custom material's WGSL sets or reads the surface's `transmission`, so the material
/// can let light through.
fn sets_transmission(tokens: &[Token]) -> bool {
    tokens
        .windows(2)
        .any(|pair| pair[0].text == "." && pair[1].text == "transmission")
}

/// True when a custom material's WGSL sets or reads the surface's diffuse transmission or its
/// color, so the material can let light through a thin surface.
fn names_diffuse_transmission(tokens: &[Token]) -> bool {
    tokens.windows(2).any(|pair| {
        pair[0].text == "."
            && matches!(
                pair[1].text,
                "diffuseTransmission" | "diffuseTransmissionColor"
            )
    })
}

/// True when a custom material's WGSL sets or reads the surface's `alpha`, so the material can cut
/// its shape by it: by alpha to coverage, by the alpha hash, or in a masked shadow or motion.
fn names_alpha(tokens: &[Token]) -> bool {
    tokens
        .windows(2)
        .any(|pair| pair[0].text == "." && pair[1].text == "alpha")
}

/// The fields of the surface record that a layered material's builds light: the clear coat's, the
/// sheen's, the iridescence's and the anisotropy's values.
const LAYER_FIELDS: [&str; 10] = [
    "clearcoat",
    "clearcoatRoughness",
    "clearcoatNormal",
    "sheenColor",
    "sheenRoughness",
    "iridescence",
    "iridescenceIor",
    "iridescenceThickness",
    "anisotropy",
    "anisotropyRotation",
];

/// True when a custom material's WGSL sets or reads one of the surface's layer values, so the
/// material can have a clear coat, a sheen, iridescence or anisotropy.
fn names_coat_sheen(tokens: &[Token]) -> bool {
    tokens
        .windows(2)
        .any(|pair| pair[0].text == "." && LAYER_FIELDS.contains(&pair[1].text))
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
        let found = textures::read(&tokens, &material.source, path, TextureOwner::Material);
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
                "the WGSL declares no function of a custom material. Declare `fn surface(input: SurfaceInput) -> Surface`, which starts from `defaultSurface(input)`, `fn vertexOffset(input: VertexInput) -> vec3f`, `fn lobe(input: LobeInput) -> vec3f`, `fn coverage(input: SurfaceInput) -> f32`, or some of them. For a shader of your own, give the WGSL a `@vertex` and a `@fragment` entry point instead.",
            ));
        }
        if !problems.is_empty() {
            return Err(problems.into_iter().collect());
        }

        let transmits = sets_transmission(&tokens);
        let translucent = names_diffuse_transmission(&tokens);
        let layered = names_coat_sheen(&tokens);
        let alpha = names_alpha(&tokens);
        let offsets = declared.iter().any(|hook| hook.def == VERTEX_OFFSET_DEF);
        let coverage = declared.iter().any(|hook| hook.def == COVERAGE_DEF);
        let inputs = read_inputs(&tokens);
        let diffuse_normal = reads_diffuse_normal(&tokens);
        let scene_depth = calls_scene_depth(&tokens);
        let mut variants: BTreeMap<String, Variant> = template
            .variants
            .iter()
            .map(|(name, variant)| {
                let mut defs = variant.defs.clone();
                defs.extend(CUSTOM_DEFS.map(str::to_owned));
                defs.extend(declared.iter().map(|hook| hook.def.to_owned()));
                defs.extend(inputs.iter().map(|&def| def.to_owned()));
                if diffuse_normal {
                    defs.push(DIFFUSE_NORMAL_DEF.to_owned());
                }
                defs.extend(uniforms.as_ref().map(|_| UNIFORMS_DEF.to_owned()));
                if !texture_fields.is_empty() {
                    defs.push(TEXTURES_DEF.to_owned());
                }
                if scene_depth {
                    // The surface function reads the copy of the scene's depth, which the shading
                    // builds bind in the group after the frame's.
                    defs.push(SCENE_DEPTH_DEF.to_owned());
                }
                if !texture_fields.is_empty() || scene_depth {
                    // On WebGPU each group that a build binds before the joint texture takes a
                    // place of its own, so the SKIN builds read the joint texture from the group
                    // after the last of them.
                    let joints = if !texture_fields.is_empty() && scene_depth {
                        JOINTS_AFTER_SCENE_DEF
                    } else {
                        JOINTS_AFTER_MAPS_DEF
                    };
                    defs.push(joints.to_owned());
                }
                // Every build shades area lights, so a material's builds stay as few as before.
                if variant.permutations.iter().any(|bit| bit == AREA_LIGHTS) {
                    defs.push(AREA_LIGHTS.to_owned());
                }
                defs.sort();
                // Custom materials draw at full precision, so their builds stay half as many. They
                // keep the SKIN builds on both paths, as the vertex shaders skin by default, and
                // skinned objects of one mesh and material then share an instanced draw (decision
                // record D-20). They have no MORPH builds, which would double their WebGL2 builds
                // again: on WebGL2 they draw morphed meshes at rest (decision record D-51). They
                // read their instances from the culling shader's copies on every path, so they
                // have no INSTANCE_INDEX builds (decision record D-23). Only WGSL that sets or
                // reads the surface's alpha has the builds of alpha to coverage, the alpha hash and
                // their sample mask, which cut the material's own shape. Every material has the
                // builds of a fading level of detail, which load on first use with the feature.
                // Only WGSL that sets the surface's transmission has the builds that let light
                // through, only WGSL that names its diffuse transmission has the builds that let
                // light through a thin surface, and only WGSL that names a layer's value has the
                // builds of the clear coat and the sheen, so other materials keep their builds as
                // few as before. Every material
                // has the builds of rows with row values, since a batch's rows may bring colors
                // that the default surface multiplies. They have no builds of the weighted
                // layer: the engine's API refuses the weighted blending for them (decision record
                // D-150). They always have the area lights' code, so they have no builds without
                // it.
                let left_out = ["HALF", "MORPH", "INSTANCE_INDEX", "WEIGHTED", AREA_LIGHTS];
                let needs_alpha = ["SAMPLE_MASK", "ALPHA_COVERAGE", "ALPHA_HASH"];
                let permutations = variant
                    .permutations
                    .iter()
                    .filter(|bit| !left_out.contains(&bit.as_str()))
                    .filter(|bit| alpha || !needs_alpha.contains(&bit.as_str()))
                    .filter(|bit| transmits || *bit != "TRANSMISSION")
                    .filter(|bit| translucent || *bit != "TRANSLUCENCY")
                    .filter(|bit| layered || *bit != "COAT_SHEEN")
                    .cloned()
                    .collect();
                let variant = Variant {
                    defs,
                    permutations,
                    required: Vec::new(),
                    targets: variant.targets.clone(),
                };
                (name.clone(), variant)
            })
            .collect();
        if offsets || alpha || coverage {
            let more: Vec<(String, Variant)> = variants
                .iter()
                .flat_map(|(name, variant)| {
                    let mut made = vec![(
                        format!("{name}_shadow"),
                        caster_variant(variant, alpha, coverage),
                    )];
                    // Only a vertex offset moves a surface in the motion and pick passes, so only
                    // its material has their builds.
                    if offsets {
                        made.push((
                            format!("{name}_motion"),
                            motion_variant(variant, alpha, coverage),
                        ));
                        made.push((format!("{name}_pick"), pick_variant(variant)));
                    }
                    made
                })
                .collect();
            variants.extend(more);
        }
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
        // A mesh without second texture coordinates offers its first set in their place, so the
        // second set is no attribute that a mesh needs.
        let attributes = attributes & !vertex::UV1;
        errors.or(MaterialOutput {
            functions: declared.iter().map(|hook| hook.name.to_owned()).collect(),
            uniforms: uniforms.map_or_else(Vec::new, |found| found.fields),
            textures: texture_fields,
            variants: built,
            locations,
            attributes,
            base_color: true,
            object_ids: inputs.contains(&OBJECT_IDS_DEF),
            scene_depth,
            alpha,
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
        if let Err(found) = textures::read(
            &tokenize(&material.source),
            &material.source,
            path,
            TextureOwner::FullShader,
        ) {
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
                    required: Vec::new(),
                    targets: vec![Target::Wgsl],
                },
            ),
            (
                "webgl2".to_owned(),
                Variant {
                    defs: vec!["WEBGL2".to_owned()],
                    permutations: vec!["DRAW_INDEX".to_owned(), "TONE_MAP".to_owned()],
                    required: Vec::new(),
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
            object_ids: false,
            scene_depth: false,
            alpha: false,
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
