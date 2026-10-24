//! Sky layers: an add-on's WGSL that the engine's sky-layer template calls over the core sky.
//!
//! A layer's WGSL declares `fn skyLayer(input: SkyLayerInput) -> SkyLayer`, which the template (the
//! shader that the manifest marks with `sky_layers = true`) calls for each pixel of the background.
//! The build adds the WGSL after the template's last line and builds every variant of the template
//! with the shader def SKY_LAYER, which leaves out the template's stub.
//!
//! The layer gets its values from `SkyLayerInput` alone: the fragment's direction in the world, the
//! core sky's cloud settings, the sketch time and the share of the sun that the layer hides. A
//! layer declares no uniforms, textures or bindings of its own, because the engine binds the
//! template's two groups and nothing else.
//!
//! Problems in the WGSL name its own lines; problems in the template's lines say so.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::effect::has_signature;
use crate::manifest::Variant;
use crate::material::MaterialTemplate;
use crate::position::locate;
use crate::scan::{find_function, tokenize};
use crate::textures::resource_declarations;
use crate::{BuildError, Compiler, Problem, VariantOutput, features};

/// The function that a layer's WGSL declares, and its signature as messages show it.
const SKY_LAYER: &str = "skyLayer";
const SKY_LAYER_SIGNATURE: &str = "fn skyLayer(input: SkyLayerInput) -> SkyLayer";

/// The shader def that every build of a layer's template holds.
const DEF: &str = "SKY_LAYER";

/// What a problem in the template's own lines says after its message.
const NOTE: &str = "The problem is in the engine's sky-layer template, which your WGSL joins. Check that your WGSL does not declare a name that the template uses, such as `layer`, `vs`, `fs` or `SkyLayerInput`.";

/// The template that sky layers build with: the entry shader that the manifest marks with
/// `sky_layers = true`.
#[derive(Debug)]
pub struct SkyLayerTemplates {
    layer: MaterialTemplate,
}

impl SkyLayerTemplates {
    /// Finds the template in a manifest and its files.
    pub fn load(inputs: &crate::Inputs) -> Result<Self, BuildError> {
        Ok(Self {
            layer: MaterialTemplate::marked(inputs, "sky layers", "sky_layers", |shader| {
                shader.sky_layers
            })?,
        })
    }
}

/// The WGSL of a sky layer, for [`Compiler::compile_sky_layer`].
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SkyLayerSource {
    /// The file the WGSL comes from, as messages name it.
    pub path: String,
    /// The WGSL: `fn skyLayer`, and anything it uses.
    pub source: String,
}

/// A layer built into every variant of the sky-layer template.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkyLayerOutput {
    /// The template's variants with the WGSL, by name.
    pub variants: BTreeMap<String, VariantOutput>,
}

/// A problem for each directive in the WGSL, such as `enable`, and for each binding that the
/// template's two groups do not hold.
fn source_problems(source: &SkyLayerSource, tokens: &[crate::scan::Token]) -> Vec<Problem> {
    let path = source.path.as_str();
    let mut problems: Vec<Problem> = features::directive_lines(&source.source)
        .into_iter()
        .map(|line| {
            Problem::at(
                path,
                Some(crate::Position { line, column: 1 }),
                "a sky layer's WGSL cannot hold directives such as `enable`, because the engine adds its own lines before it. Remove the line: a sky layer uses no optional WGSL features.".to_owned(),
            )
        })
        .collect();
    for declaration in resource_declarations(tokens) {
        let token = &tokens[declaration.first];
        problems.push(Problem::at(
            path,
            Some(locate(&source.source, &source.source, token.start)),
            "a sky layer declares no textures, samplers or bindings of its own: the engine binds the template's groups, which hold the core sky's values. Read what the layer gets from SkyLayerInput.".to_owned(),
        ));
    }
    problems
}

impl Compiler {
    /// Builds a layer's WGSL into every variant of the sky-layer template.
    pub fn compile_sky_layer(
        &mut self,
        templates: &SkyLayerTemplates,
        layer: &SkyLayerSource,
    ) -> Result<SkyLayerOutput, BuildError> {
        let path = layer.path.as_str();
        let tokens = tokenize(&layer.source);
        let at_start = Some(crate::Position { line: 1, column: 1 });
        if find_function(&tokens, SKY_LAYER).is_none() {
            return Err(Problem::at(
                path,
                at_start,
                format!("the WGSL declares no sky layer. Declare `{SKY_LAYER_SIGNATURE}`."),
            )
            .into());
        }
        let mut problems = source_problems(layer, &tokens);
        if tokens
            .windows(2)
            .any(|pair| pair[0].text == "struct" && pair[1].text == "Uniforms")
        {
            problems.push(Problem::at(
                path,
                at_start,
                "a sky layer takes no `struct Uniforms`. Its values come from SkyLayerInput: the direction, the core sky's cloud settings, the time and the share of the sun that it hides. Write its other numbers as constants in the WGSL.".to_owned(),
            ));
        }
        if !has_signature(&tokens, SKY_LAYER, &["SkyLayerInput"], &["SkyLayer"]) {
            let position = find_function(&tokens, SKY_LAYER)
                .map(|found| locate(&layer.source, &layer.source, tokens[found.name].start));
            problems.push(Problem::at(
                path,
                position,
                format!("`{SKY_LAYER}` does not have the signature that the engine calls. Declare it as `{SKY_LAYER_SIGNATURE}`."),
            ));
        }
        if !problems.is_empty() {
            return Err(problems.into_iter().collect());
        }
        let template = &templates.layer;
        let variants: BTreeMap<String, Variant> = template
            .variants()
            .iter()
            .map(|(name, variant)| {
                let mut defs = variant.defs.clone();
                defs.push(DEF.to_owned());
                defs.sort();
                let variant = Variant {
                    defs,
                    permutations: variant.permutations.clone(),
                    required: variant.required.clone(),
                    targets: variant.targets.clone(),
                };
                (name.clone(), variant)
            })
            .collect();
        let source = format!("{}{}", template.source(), layer.source);
        let mut errors = BuildError::default();
        let built = self.variants(
            path,
            &source,
            template.pipelines(),
            &variants,
            None,
            &str::to_owned,
            &mut errors,
        );
        template.place_problems(&mut errors, path, &layer.source, NOTE);
        errors.or(())?;
        Ok(SkyLayerOutput { variants: built })
    }
}
