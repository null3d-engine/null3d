//! Custom effects and custom tone curves: WGSL functions that the engine's post-processing calls.
//!
//! An effect's WGSL declares `fn effect(input: EffectInput) -> vec4f`, which the effect template
//! (the shader that the manifest marks with `custom_effects = true`) calls for each pixel of the
//! scene, in a full-screen pass of its own. The build adds the WGSL after the template's last line
//! and builds every variant of the template with the shader def CUSTOM_EFFECT. A `struct Uniforms`
//! declares the effect's uniforms, as a custom material's does (see [`crate::uniforms`]): the
//! build adds the function that loads them from the effect's block and builds with
//! CUSTOM_UNIFORMS. An effect that calls `effectDepth`, `effectViewPosition` or `effectDistance`
//! reads the scene's depth: it builds with EFFECT_DEPTH, and its WebGPU builds come with and
//! without DEPTH_MULTISAMPLED, which reads a multisampled depth.
//!
//! A tone curve's WGSL declares `fn toneCurve(color: vec3f) -> vec3f`, which the final pass (the
//! shader that the manifest marks with `custom_tone_curves = true`) calls in place of its own
//! curves. The build adds the WGSL after the final pass's last line and builds every variant but
//! the HALF builds with the shader def CUSTOM_TONE_CURVE.
//!
//! Each effect also gets pieces, which the engine joins into a host at run time (see
//! [`crate::pieces`]): for the host of joined effects, and for the final pass that effects fold
//! into. A tone curve gets pieces for the final pass. An effect joins the effect before it only
//! when it reads its input image at its own pixel alone: when it calls neither `effectPixel` nor
//! `effectColor`.
//!
//! Problems in the WGSL name its own lines; problems in a template's lines say so.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::manifest::{Target, Variant};
use crate::material::MaterialTemplate;
use crate::pieces::{self, PieceOutput};
use crate::position::locate;
use crate::scan::{Token, find_function, tokenize};
use crate::textures::resource_declarations;
use crate::uniforms::{self, Owner, Uniform};
use crate::{BuildError, Compiler, Inputs, Position, Problem, VariantOutput, features};

/// The function that an effect's WGSL declares, and its signature as messages show it.
const EFFECT: &str = "effect";
const EFFECT_SIGNATURE: &str = "fn effect(input: EffectInput) -> vec4f";

/// The function that a tone curve's WGSL declares, and its signature as messages show it.
const TONE_CURVE: &str = "toneCurve";
const TONE_CURVE_SIGNATURE: &str = "fn toneCurve(color: vec3f) -> vec3f";

/// The functions of the effect template that read the scene's depth.
const DEPTH_FUNCTIONS: [&str; 3] = ["effectDepth", "effectViewPosition", "effectDistance"];

/// The functions of the effect template that read the input image at other pixels than the
/// effect's own. An effect that calls one does not join the effect before it.
const NEIGHBOR_FUNCTIONS: [&str; 2] = ["effectPixel", "effectColor"];

/// The render pipeline of the hosts that pieces join.
const HOST_PIPELINE: &str = "main";

/// What a problem in a piece's build says after its message.
const PIECE_NOTE: &str = "The problem came up while the build made the effect's piece for joined effects, which shares the engine's host template. Check that your WGSL does not declare a name that the template uses, such as one that starts with `effect`.";

/// The permutation bit of the WebGPU builds that read a multisampled depth.
const DEPTH_MULTISAMPLED: &str = "DEPTH_MULTISAMPLED";

/// What a problem in an effect template's own lines says after its message.
const EFFECT_NOTE: &str = "The problem is in the engine's effect template, which your WGSL joins. Check that your WGSL does not declare a name that the template uses, such as `uniforms` or a name that starts with `effect`.";

/// What a problem in the final pass's own lines says after its message.
const TONE_CURVE_NOTE: &str = "The problem is in the engine's final pass, which your WGSL joins. Check that your WGSL does not declare a name that the final pass uses, such as `settings`, `display` or `luma`. Give your helper functions names of their own.";

/// The templates that effects and tone curves build with, and the hosts that their pieces join.
#[derive(Debug)]
pub struct PostTemplates {
    effect: MaterialTemplate,
    tone_curve: MaterialTemplate,
    group_host: MaterialTemplate,
    fold_host: MaterialTemplate,
}

impl PostTemplates {
    /// Finds both templates in a manifest and its files.
    pub fn load(inputs: &Inputs) -> Result<Self, BuildError> {
        Ok(Self {
            effect: MaterialTemplate::marked(inputs, "custom effects", "custom_effects", |s| {
                s.custom_effects
            })?,
            tone_curve: MaterialTemplate::marked(
                inputs,
                "custom tone curves",
                "custom_tone_curves",
                |s| s.custom_tone_curves,
            )?,
            group_host: MaterialTemplate::marked(
                inputs,
                "joined custom effects",
                "effect_group_host",
                |s| s.effect_group_host,
            )?,
            fold_host: MaterialTemplate::marked(
                inputs,
                "custom effects folded into the final pass",
                "effect_fold_host",
                |s| s.effect_fold_host,
            )?,
        })
    }
}

/// The WGSL of an effect or a tone curve, for [`Compiler::compile_effect`].
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EffectSource {
    /// The file the WGSL comes from, as messages name it.
    pub path: String,
    /// The WGSL: `fn effect` or `fn toneCurve`, and anything it uses.
    pub source: String,
}

/// An effect built into every variant of the effect template, or a tone curve built into every
/// variant of the final pass.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectOutput {
    /// The function that the WGSL declares: `effect` or `toneCurve`.
    pub function: String,
    /// The fields of the WGSL's `struct Uniforms`, where the engine writes each: none without the
    /// struct.
    pub uniforms: Vec<Uniform>,
    /// True when the effect reads the scene's depth.
    pub depth: bool,
    /// True when the effect joins the effect before it: it reads its input image at its own pixel
    /// alone. Always false for a tone curve.
    pub joins: bool,
    /// The template's variants with the WGSL, by name.
    pub variants: BTreeMap<String, VariantOutput>,
    /// The pieces that the engine joins into its hosts.
    pub pieces: EffectPieces,
}

/// An effect's or a tone curve's pieces, by host and by the name of the host's build.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectPieces {
    /// For the host of joined effects. A tone curve has none.
    pub group: BTreeMap<String, PieceOutput>,
    /// For the final pass that effects and a tone curve fold into.
    pub fold: BTreeMap<String, PieceOutput>,
}

/// True when the function's only parameter has type `param` and it returns `returns`, each of
/// which may be spelled in one of the given ways.
fn has_signature(tokens: &[Token], name: &str, param: &[&str], returns: &[&str]) -> bool {
    let Some(function) = find_function(tokens, name) else {
        return false;
    };
    let params: Vec<String> = tokens[function.params.clone()]
        .split(|token| token.text == ",")
        .filter(|param| !param.is_empty())
        .map(|param| match param {
            [_, colon, ty @ ..] if colon.text == ":" => ty.iter().map(|t| t.text).collect(),
            _ => String::new(),
        })
        .collect();
    let returned: String = tokens[function.params.end + 1..function.body.start - 1]
        .iter()
        .skip(1)
        .map(|token| token.text)
        .collect();
    let arrow = tokens.get(function.params.end + 1).map(|t| t.text) == Some("->");
    matches!(&params[..], [one] if param.contains(&one.as_str()))
        && arrow
        && returns.contains(&returned.as_str())
}

/// A problem for each directive in the WGSL, such as `enable`, and for each texture or sampler
/// that it declares.
fn source_problems(source: &EffectSource, tokens: &[Token], what: &str) -> Vec<Problem> {
    let path = source.path.as_str();
    let mut problems: Vec<Problem> = features::directive_lines(&source.source)
        .into_iter()
        .map(|line| {
            Problem::at(
                path,
                Some(Position { line, column: 1 }),
                format!(
                    "{what} cannot hold directives such as `enable`, because the engine adds its own lines before it. Remove the line: {what} uses no optional WGSL features."
                ),
            )
        })
        .collect();
    for declaration in resource_declarations(tokens) {
        let token = &tokens[declaration.first];
        problems.push(Problem::at(
            path,
            Some(locate(&source.source, &source.source, token.start)),
            format!(
                "{what} declares no textures or samplers: the engine binds what it reads. Read the image with `effectColor(uv)` or `effectPixel(pixel)`."
            ),
        ));
    }
    problems
}

impl Compiler {
    /// Builds an effect's WGSL into every variant of the effect template, or a tone curve's into
    /// every variant of the final pass but its HALF builds.
    pub fn compile_effect(
        &mut self,
        templates: &PostTemplates,
        effect: &EffectSource,
    ) -> Result<EffectOutput, BuildError> {
        let path = effect.path.as_str();
        let tokens = tokenize(&effect.source);
        let declares_effect = find_function(&tokens, EFFECT).is_some();
        let declares_curve = find_function(&tokens, TONE_CURVE).is_some();
        let at_start = Some(Position { line: 1, column: 1 });
        let (function, signature, template, note) = match (declares_effect, declares_curve) {
            (true, false) => (EFFECT, EFFECT_SIGNATURE, &templates.effect, EFFECT_NOTE),
            (false, true) => (
                TONE_CURVE,
                TONE_CURVE_SIGNATURE,
                &templates.tone_curve,
                TONE_CURVE_NOTE,
            ),
            (true, true) => {
                return Err(Problem::at(
                    path,
                    at_start,
                    "the WGSL declares both `fn effect` and `fn toneCurve`. An effect and a tone curve each need WGSL of their own: split them in two.",
                )
                .into());
            }
            (false, false) => {
                return Err(Problem::at(
                    path,
                    at_start,
                    format!(
                        "the WGSL declares no effect and no tone curve. Declare `{EFFECT_SIGNATURE}` for an effect, or `{TONE_CURVE_SIGNATURE}` for a tone curve."
                    ),
                )
                .into());
            }
        };
        let what = if function == EFFECT {
            "an effect's WGSL"
        } else {
            "a tone curve's WGSL"
        };
        let mut problems = source_problems(effect, &tokens, what);
        let signature_ok = if function == EFFECT {
            has_signature(&tokens, EFFECT, &["EffectInput"], &["vec4f", "vec4<f32>"])
        } else {
            has_signature(
                &tokens,
                TONE_CURVE,
                &["vec3f", "vec3<f32>"],
                &["vec3f", "vec3<f32>"],
            )
        };
        if !signature_ok && let Some(found) = find_function(&tokens, function) {
            let position = locate(&effect.source, &effect.source, tokens[found.name].start);
            problems.push(Problem::at(
                path,
                Some(position),
                format!(
                    "`{function}` does not have the signature that the engine calls. Declare it as `{signature}`."
                ),
            ));
        }
        let uniforms = uniforms::read(&tokens, &effect.source, path, 0, Owner::Effect)
            .unwrap_or_else(|found| {
                problems.extend(found);
                None
            });
        if function == TONE_CURVE
            && let Some(open) = tokens
                .windows(2)
                .position(|pair| pair[0].text == "struct" && pair[1].text == "Uniforms")
        {
            problems.push(Problem::at(
                path,
                Some(locate(&effect.source, &effect.source, tokens[open].start)),
                "a tone curve takes no uniforms. Write its numbers as constants in the WGSL; the exposure already scales the color that the curve gets.",
            ));
        }
        if !problems.is_empty() {
            return Err(problems.into_iter().collect());
        }
        let calls_any = |names: &[&str]| {
            tokens
                .windows(2)
                .any(|pair| names.contains(&pair[0].text) && pair[1].text == "(")
        };
        let depth = function == EFFECT && calls_any(&DEPTH_FUNCTIONS);
        let joins = function == EFFECT && !calls_any(&NEIGHBOR_FUNCTIONS);
        let variants: BTreeMap<String, Variant> = template
            .variants()
            .iter()
            .map(|(name, variant)| {
                let mut defs = variant.defs.clone();
                let mut permutations: Vec<String> = variant
                    .permutations
                    .iter()
                    .filter(|bit| *bit != "HALF")
                    .cloned()
                    .collect();
                if function == EFFECT {
                    defs.push("CUSTOM_EFFECT".to_owned());
                    if uniforms.is_some() {
                        defs.push("CUSTOM_UNIFORMS".to_owned());
                    }
                    if depth {
                        defs.push("EFFECT_DEPTH".to_owned());
                        // WebGL2 reads a copy of one sample of a multisampled depth, which the
                        // backend keeps, so only WebGPU reads a multisampled texture.
                        if variant.has(crate::Target::Wgsl) {
                            permutations.push(DEPTH_MULTISAMPLED.to_owned());
                        }
                    }
                } else {
                    defs.push("CUSTOM_TONE_CURVE".to_owned());
                }
                defs.sort();
                let variant = Variant {
                    defs,
                    permutations,
                    required: Vec::new(),
                    targets: variant.targets.clone(),
                };
                (name.clone(), variant)
            })
            .collect();
        let loader = uniforms.as_ref().map_or("", |found| found.loader.as_str());
        let source = format!("{}{}{loader}", template.source(), effect.source);
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
        template.place_problems(&mut errors, path, &effect.source, note);
        errors.or(())?;
        let pieces = self.effect_pieces(
            templates,
            effect,
            function == TONE_CURVE,
            uniforms.as_ref().map(|found| found.piece_loader.as_str()),
            depth,
        )?;
        Ok(EffectOutput {
            function: function.to_owned(),
            uniforms: uniforms.map_or_else(Vec::new, |found| found.fields),
            depth,
            joins,
            variants: built,
            pieces,
        })
    }

    /// Builds the pieces of an effect's or a tone curve's WGSL: its names take a prefix of its
    /// own, an effect gets the glue that its chain calls, and each host's hook calls it.
    fn effect_pieces(
        &mut self,
        templates: &PostTemplates,
        effect: &EffectSource,
        curve: bool,
        piece_loader: Option<&str>,
        depth: bool,
    ) -> Result<EffectPieces, BuildError> {
        let prefix = pieces::prefix_of(&effect.source);
        let own = if curve {
            pieces::prefixed(&effect.source, &prefix)
        } else {
            let glued = format!("{}{}", effect.source, pieces::effect_glue(piece_loader));
            pieces::prefixed(&glued, &prefix)
        };
        let added = format!("{own}{}", pieces::hook_call(&prefix, curve));
        let run = if curve {
            format!("{prefix}{TONE_CURVE}")
        } else {
            format!("{prefix}{}", pieces::EFFECT_RUN)
        };
        let piece = Piece {
            path: &effect.path,
            added: &added,
            run: &run,
            curve,
            depth,
        };
        let group = if curve {
            BTreeMap::new()
        } else {
            self.host_pieces(&templates.group_host, "group", &piece)?
        };
        let fold = self.host_pieces(&templates.fold_host, "fold", &piece)?;
        Ok(EffectPieces { group, fold })
    }

    /// Builds a piece into every build of `host` and takes from each what it adds to the host's
    /// own build of that variant. `key` names the host in the compiler's store of host builds.
    fn host_pieces(
        &mut self,
        host: &MaterialTemplate,
        key: &str,
        piece: &Piece,
    ) -> Result<BTreeMap<String, PieceOutput>, BuildError> {
        let variants: BTreeMap<String, Variant> = host
            .variants()
            .iter()
            .map(|(name, variant)| {
                let mut defs = variant.defs.clone();
                let mut permutations = variant.permutations.clone();
                defs.push(
                    if piece.curve {
                        "EFFECT_PIECE_CURVE"
                    } else {
                        "EFFECT_PIECE"
                    }
                    .to_owned(),
                );
                if piece.depth {
                    defs.push("EFFECT_DEPTH".to_owned());
                    if variant.has(Target::Wgsl) {
                        permutations.push(DEPTH_MULTISAMPLED.to_owned());
                    }
                }
                defs.sort();
                let variant = Variant {
                    defs,
                    permutations,
                    required: Vec::new(),
                    targets: variant.targets.clone(),
                };
                (name.clone(), variant)
            })
            .collect();
        let source = format!("{}{}", host.source(), piece.added);
        let mut errors = BuildError::default();
        let built = self.variants(
            piece.path,
            &source,
            host.pipelines(),
            &variants,
            None,
            &str::to_owned,
            &mut errors,
        );
        host.place_problems(&mut errors, piece.path, piece.added, PIECE_NOTE);
        errors.or(())?;
        let mut pieces = BTreeMap::new();
        for (name, variant) in &variants {
            let own = self.host_build(host, key, name)?;
            for build in variant.builds(name) {
                let Some(output) = built.get(&build.name) else {
                    continue;
                };
                let extracted = pieces::extract(&own, output, HOST_PIPELINE, piece.run)
                    .map_err(|message| Problem::in_file(piece.path, message))?;
                pieces.insert(build.name, extracted);
            }
        }
        Ok(pieces)
    }
}

/// The WGSL that a piece's build adds to a host, and what the build needs to know of it.
struct Piece<'a> {
    /// The file the WGSL comes from, as messages name it.
    path: &'a str,
    /// The prefixed WGSL with its glue and its hook's call.
    added: &'a str,
    /// The name of the function that the chain or the hook calls.
    run: &'a str,
    /// True for a tone curve's piece.
    curve: bool,
    /// True for an effect that reads the scene's depth.
    depth: bool,
}
