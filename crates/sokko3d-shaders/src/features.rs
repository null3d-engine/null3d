//! The portability check: shaders use only the WGSL language features that every target browser
//! supports (AGENTS.md hard rule 10), and write flat interpolation as `@interpolate(flat, either)`.
//!
//! WGSL does not require a `requires` directive before code uses a language feature, so reading
//! `requires` lines is not enough. The check works in three layers:
//!
//! 1. A scan of each file, as the variant sees it after the shader defs, finds `requires` lines
//!    and the syntax that each other feature adds: swizzle assignment, `var<immediate>`, the
//!    built-in values and texel formats of newer features, and the buffer view functions.
//! 2. naga, the translator, rejects some features on its own: pointer parameters outside the
//!    `function` and `private` address spaces, and uniform buffers that break the uniform layout
//!    rules. Their errors become messages that name the feature.
//! 3. naga accepts a `let` that holds a texture or a sampler, and a pointer to part of a variable
//!    as an argument, so a pass over the composed module finds those.

use std::collections::{BTreeSet, HashMap};

use naga::valid::{
    Capabilities, EntryPointError, FunctionError, FunctionInfo, GlobalVariableError, ModuleInfo,
    ValidationError, VaryingError,
};
use naga::{AddressSpace, Block, Expression, Handle, Statement, TypeInner};
use naga_oil::compose::{Composer, ComposerError, ComposerErrorInner};

use crate::Problem;
use crate::library::{View, locate};
use crate::scan::{self, Kind, Token};

/// The WGSL language features that Chrome, Safari and Firefox all report.
pub const ALLOWED_LANGUAGE_FEATURES: [&str; 3] = [
    "packed_4x8_integer_dot_product",
    "pointer_composite_access",
    "readonly_and_readwrite_storage_textures",
];

/// Storage texel formats that only the `texture_formats_tier1` language feature allows.
const TIER1_TEXEL_FORMATS: [&str; 23] = [
    "rgba16unorm",
    "rgba16snorm",
    "rg8unorm",
    "rg8snorm",
    "rg8uint",
    "rg8sint",
    "rg16unorm",
    "rg16snorm",
    "rg16uint",
    "rg16sint",
    "rg16float",
    "r8unorm",
    "r8snorm",
    "r8uint",
    "r8sint",
    "r16unorm",
    "r16snorm",
    "r16uint",
    "r16sint",
    "r16float",
    "rgb10a2unorm",
    "rgb10a2uint",
    "rg11b10ufloat",
];

/// How to rewrite code that uses a language feature.
fn fix(feature: &str) -> &'static str {
    match feature {
        "swizzle_assignment" => {
            "Assign each component on its own, for example `v.x = a.x; v.y = a.y;`, or assign the whole vector."
        }
        "texture_and_sampler_let" => {
            "Use the texture or sampler variable directly instead of copying it into a `let`."
        }
        "unrestricted_pointer_parameters" => {
            "Pass a pointer to a whole `function` or `private` variable, or use the global variable directly inside the function."
        }
        "uniform_buffer_standard_layout" => {
            "Give arrays in uniform buffers a 16-byte stride, for example `array<vec4f, 4>`, and align nested structs to 16 bytes."
        }
        "immediate_address_space" => "Use a uniform buffer instead.",
        "linear_indexing" => {
            "Compute the index from `global_invocation_id` or `workgroup_id` and the workgroup size."
        }
        "subgroup_id" => {
            "Subgroups are optional in WebGPU: keep this code behind a capability flag with a fallback."
        }
        "fragment_depth" => "Write `@builtin(frag_depth)` without a depth mode.",
        "buffer_view" => "Declare the variable with the type it holds.",
        "texture_formats_tier1" => {
            "Use a core storage texel format, such as `rgba8unorm`, `rgba16float`, `r32float` or `rgba32float`."
        }
        "atomic_vec2u_min_max" => "Use 32-bit atomics, such as `atomicMin` on `atomic<u32>`.",
        _ => REMOVE_REQUIRES,
    }
}

/// How to fix a `requires` directive that names a feature outside the allowed three.
const REMOVE_REQUIRES: &str = "Remove the feature from the directive, and rewrite the code that needs it or keep that code behind a capability flag with a fallback.";

/// A problem about a language feature, found at `what` in a file.
fn language_feature(path: &str, line: Option<u32>, feature: &str, what: &str) -> Problem {
    feature_problem(path, line, feature, what, fix(feature))
}

fn feature_problem(path: &str, line: Option<u32>, feature: &str, what: &str, fix: &str) -> Problem {
    let [first, second, third] = ALLOWED_LANGUAGE_FEATURES;
    Problem {
        feature: Some(feature.to_owned()),
        ..Problem::at(
            path,
            line,
            format!(
                "{what} uses the WGSL language feature `{feature}`, which not every browser supports. The engine's WGSL may use only `{first}`, `{second}` and `{third}` (AGENTS.md hard rule 10). {fix}"
            ),
        )
    }
}

/// A pointer parameter into an address space that needs `unrestricted_pointer_parameters`.
fn pointer_parameter(views: &[View], function: &str, parameter: &str, space: &str) -> Problem {
    let (view, item) = locate(views, function);
    let line = scan::find_function(&view.tokens, item)
        .map(|d| scan::param_line(&view.tokens, &d, parameter).unwrap_or(d.line));
    language_feature(
        view.path,
        line,
        "unrestricted_pointer_parameters",
        &format!("Parameter `{parameter}` of `{item}`, a pointer into the {space} address space,"),
    )
}

/// Finds language features and flat interpolation without `either` in the files of one variant.
pub(crate) fn scan(views: &[View]) -> Vec<Problem> {
    let mut members = BTreeSet::new();
    let mut declared = BTreeSet::new();
    for view in views {
        collect_declarations(&view.tokens, &mut members, &mut declared);
    }
    let mut problems = Vec::new();
    for view in views {
        scan_file(view, &members, &declared, &mut problems);
    }
    problems
}

/// Collects struct member names, and the names of module-scope declarations.
fn collect_declarations<'a>(
    tokens: &[Token<'a>],
    members: &mut BTreeSet<&'a str>,
    declared: &mut BTreeSet<&'a str>,
) {
    let mut depth = 0usize;
    for (index, token) in tokens.iter().enumerate() {
        match token.text {
            "{" => depth += 1,
            "}" => depth = depth.saturating_sub(1),
            "struct" | "fn" | "alias" | "const" | "override" if depth == 0 => {
                if let Some(name) = tokens.get(index + 1).filter(|t| t.kind == Kind::Ident) {
                    declared.insert(name.text);
                }
                if token.text == "struct"
                    && let Some(close) = scan::matching(tokens, index + 2)
                {
                    for pair in tokens[index + 3..close].windows(2) {
                        if pair[0].kind == Kind::Ident && pair[1].text == ":" {
                            members.insert(pair[0].text);
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

fn is_swizzle(name: &str) -> bool {
    (2..=4).contains(&name.len())
        && (name.bytes().all(|b| b"xyzw".contains(&b))
            || name.bytes().all(|b| b"rgba".contains(&b)))
}

fn is_assignment(operator: &str) -> bool {
    matches!(
        operator,
        "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "&=" | "|=" | "^=" | "<<=" | ">>="
    )
}

fn scan_file(
    view: &View,
    members: &BTreeSet<&str>,
    declared: &BTreeSet<&str>,
    problems: &mut Vec<Problem>,
) {
    let tokens = &view.tokens;
    let path = view.path;
    let mut depth = 0usize;
    for (index, token) in tokens.iter().enumerate() {
        let next = |n: usize| tokens.get(index + n).map_or("", |t| t.text);
        let previous = index.checked_sub(1).map_or("", |p| tokens[p].text);
        let line = Some(token.line);
        let mut found = |feature: &str, what: &str| {
            problems.push(language_feature(path, line, feature, what));
        };
        match token.text {
            "{" => depth += 1,
            "}" => depth = depth.saturating_sub(1),
            "requires" if depth == 0 && matches!(previous, "" | ";" | "}") => {
                let names = tokens[index + 1..]
                    .iter()
                    .take_while(|t| t.text != ";")
                    .filter(|t| t.kind == Kind::Ident);
                for name in names {
                    if !ALLOWED_LANGUAGE_FEATURES.contains(&name.text) {
                        problems.push(feature_problem(
                            path,
                            Some(name.line),
                            name.text,
                            &format!("`requires {}`", name.text),
                            REMOVE_REQUIRES,
                        ));
                    }
                }
            }
            "." if is_swizzle(next(1)) && is_assignment(next(2)) && !members.contains(next(1)) => {
                found(
                    "swizzle_assignment",
                    &format!("An assignment to the swizzle `.{}`", next(1)),
                );
            }
            "var" if next(1) == "<" && next(2) == "immediate" => {
                found("immediate_address_space", "`var<immediate>`");
            }
            "builtin" if previous == "@" && next(1) == "(" => match next(2) {
                name @ ("global_invocation_index" | "workgroup_index") => {
                    found("linear_indexing", &format!("`@builtin({name})`"));
                }
                name @ ("subgroup_id" | "num_subgroups") => {
                    found("subgroup_id", &format!("`@builtin({name})`"));
                }
                "frag_depth" if next(3) == "," => {
                    found(
                        "fragment_depth",
                        "A depth mode in `@builtin(frag_depth, ...)`",
                    );
                }
                _ => {}
            },
            "interpolate"
                if previous == "@"
                    && next(1) == "("
                    && next(2) == "flat"
                    && (next(3) == ")" || (next(3) == "," && matches!(next(4), ")" | "first"))) =>
            {
                problems.push(Problem::at(
                    path,
                    line,
                    "flat interpolation must be written `@interpolate(flat, either)` (AGENTS.md hard rule 10). `@interpolate(flat)` means `flat, first`, which WebGL2 and WebGPU compatibility mode cannot provide.",
                ));
            }
            name @ ("bufferView" | "bufferArrayView" | "bufferLength")
                if next(1) == "(" && !declared.contains(name) =>
            {
                found("buffer_view", &format!("`{name}`"));
            }
            "buffer"
                if !declared.contains("buffer")
                    && (previous == ":" || (matches!(previous, "," | "<") && next(1) == "<")) =>
            {
                found("buffer_view", "The `buffer` type");
            }
            name @ ("atomicStoreMin" | "atomicStoreMax")
                if next(1) == "(" && !declared.contains(name) =>
            {
                found("atomic_vec2u_min_max", &format!("`{name}`"));
            }
            name if name.starts_with("texture_storage_")
                && next(1) == "<"
                && TIER1_TEXEL_FORMATS.contains(&next(2)) =>
            {
                found(
                    "texture_formats_tier1",
                    &format!("The storage texel format `{}`", next(2)),
                );
            }
            _ => {}
        }
    }
}

/// Problems with WGSL directives that come after the top of a file. The shader composer passes
/// `enable`, `requires` and `diagnostic` directives on to naga only from the lines before the
/// first other line, so a directive below an `#import` line would reach naga in the wrong place.
pub(crate) fn check_directive_placement(path: &str, source: &str) -> Vec<Problem> {
    let mut problems = Vec::new();
    let mut at_top = true;
    for (index, line) in source.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("//") {
            continue;
        }
        match (is_directive(trimmed), at_top) {
            (true, false) => problems.push(Problem::at(
                path,
                u32::try_from(index + 1).ok(),
                format!(
                    "`{trimmed}` comes after a line that is not a directive. The shader composer passes WGSL directives on only from the top of a file, so move it above the first `#import`, `#define_import_path` or declaration."
                ),
            )),
            (false, true) => at_top = false,
            _ => {}
        }
    }
    problems
}

/// True for a whole-line `enable`, `requires` or `diagnostic` directive.
fn is_directive(line: &str) -> bool {
    let code = line.split("//").next().unwrap_or_default().trim_end();
    let Some(body) = code.strip_suffix(';') else {
        return false;
    };
    if let Some(rest) = body.strip_prefix("diagnostic") {
        return rest.trim_start().starts_with('(');
    }
    ["enable", "requires"].iter().any(|keyword| {
        body.strip_prefix(keyword).is_some_and(|rest| {
            rest.starts_with(char::is_whitespace)
                && rest.split(',').all(|name| scan::tokenize(name).len() == 1)
        })
    })
}

/// Finds, in the composed module, the language features that naga accepts: a `let` holding a
/// texture or a sampler, and a pointer argument that points to part of a variable. It also finds
/// pointer parameters outside the `function` and `private` address spaces, in case a later naga
/// accepts them.
pub(crate) fn check_module(
    module: &naga::Module,
    info: &ModuleInfo,
    views: &[View],
) -> Vec<Problem> {
    let mut problems = Vec::new();
    for (handle, function) in module.functions.iter() {
        let name = function.name.as_deref().unwrap_or_default();
        check_function(module, function, &info[handle], name, views, &mut problems);
    }
    for (index, entry) in module.entry_points.iter().enumerate() {
        let function_info = info.get_entry_point(index);
        check_function(
            module,
            &entry.function,
            function_info,
            &entry.name,
            views,
            &mut problems,
        );
    }
    problems
}

/// The WGSL name of an address space that pointer parameters may not use without
/// `unrestricted_pointer_parameters`.
fn restricted_space(space: AddressSpace) -> Option<&'static str> {
    match space {
        AddressSpace::Storage { .. } => Some("storage"),
        AddressSpace::Uniform => Some("uniform"),
        AddressSpace::WorkGroup => Some("workgroup"),
        _ => None,
    }
}

fn check_function(
    module: &naga::Module,
    function: &naga::Function,
    info: &FunctionInfo,
    name: &str,
    views: &[View],
    problems: &mut Vec<Problem>,
) {
    let (view, item) = locate(views, name);
    let tokens = &view.tokens;
    let declaration = scan::find_function(tokens, item);
    // The line of something found inside the function, or else the function's own line.
    let line_in = |find: &dyn Fn(&scan::Function) -> Option<u32>| {
        declaration.as_ref().map(|d| find(d).unwrap_or(d.line))
    };

    for argument in &function.arguments {
        if let TypeInner::Pointer { space, .. } = module.types[argument.ty].inner
            && let Some(space) = restricted_space(space)
        {
            let parameter = argument.name.as_deref().unwrap_or_default();
            problems.push(pointer_parameter(views, name, parameter, space));
        }
    }

    for (&expression, binding) in &function.named_expressions {
        let holds = match *info[expression].ty.inner_with(&module.types) {
            TypeInner::Image { .. } => "a texture",
            TypeInner::Sampler { .. } => "a sampler",
            _ => continue,
        };
        problems.push(language_feature(
            view.path,
            line_in(&|d| scan::let_line(tokens, d, binding)),
            "texture_and_sampler_let",
            &format!("`let {binding}` in `{item}`, which holds {holds},"),
        ));
    }

    // For each callee, the calls seen so far and those among them that pass part of a variable,
    // so the n-th such call in the module can be matched to the n-th one in the text.
    let mut seen: HashMap<Handle<naga::Function>, (usize, usize)> = HashMap::new();
    for_each_call(&function.body, &mut |callee, arguments| {
        let callee_function = &module.functions[callee];
        let passes_part =
            callee_function
                .arguments
                .iter()
                .zip(arguments)
                .any(|(parameter, &argument)| {
                    matches!(module.types[parameter.ty].inner, TypeInner::Pointer { .. })
                        && !matches!(
                            function.expressions[argument],
                            Expression::LocalVariable(_)
                                | Expression::GlobalVariable(_)
                                | Expression::FunctionArgument(_)
                        )
                });
        let (calls_seen, partial_seen) = seen.entry(callee).or_default();
        *calls_seen += 1;
        if !passes_part {
            return;
        }
        *partial_seen += 1;
        let callee_name = callee_function.name.as_deref().unwrap_or_default();
        let (_, callee_item) = locate(views, callee_name);
        let line = line_in(&|d| {
            let calls = scan::calls(tokens, d, &[callee_name, callee_item]);
            let call = calls
                .iter()
                .filter(|call| call.passes_part)
                .nth(*partial_seen - 1);
            call.or_else(|| calls.get(*calls_seen - 1))
                .map(|call| call.line)
        });
        problems.push(language_feature(
            view.path,
            line,
            "unrestricted_pointer_parameters",
            &format!(
                "The call to `{callee_item}` in `{item}`, which passes a pointer to part of a variable,"
            ),
        ));
    });
}

/// Calls `visit` for every function call in a block and in the blocks inside it.
fn for_each_call(
    block: &Block,
    visit: &mut impl FnMut(Handle<naga::Function>, &[Handle<Expression>]),
) {
    for statement in block.iter() {
        match statement {
            Statement::Block(inner) => for_each_call(inner, visit),
            Statement::If { accept, reject, .. } => {
                for_each_call(accept, visit);
                for_each_call(reject, visit);
            }
            Statement::Switch { cases, .. } => {
                for case in cases {
                    for_each_call(&case.body, visit);
                }
            }
            Statement::Loop {
                body, continuing, ..
            } => {
                for_each_call(body, visit);
                for_each_call(continuing, visit);
            }
            Statement::Call {
                function,
                arguments,
                ..
            } => visit(*function, arguments),
            _ => {}
        }
    }
}

/// Turns a composer error into a problem. Errors that come from a language feature name it, and
/// the rest keep the composer's message, which shows the file and line.
pub(crate) fn composition_problem(
    error: &ComposerError,
    composer: &Composer,
    views: &[View],
) -> Problem {
    let rendered = error.emit_to_string(composer).trim_end().to_owned();
    match &error.inner {
        ComposerErrorInner::WgslParseError(parse)
            if parse.notes().any(|note| note.contains("assignments to swizzles")) =>
        {
            let path = error.source.path(composer);
            let mut problem =
                language_feature(path, None, "swizzle_assignment", "An assignment to a swizzle");
            problem.message = format!("{}\n{rendered}", problem.message);
            problem
        }
        ComposerErrorInner::ShaderValidationError(validation) => {
            validation_problem(validation.as_inner(), views).unwrap_or_else(|| {
                let mut problem = Problem::general(rendered);
                if uses_draw_index(validation.as_inner()) {
                    problem.message.push_str(
                        "\n`@builtin(draw_index)` works only in a variant whose targets are just [\"glsl\"]: the WebGL2 shader reads `gl_DrawID` from WEBGL_multi_draw, and WebGPU has no draw index.",
                    );
                }
                problem
            })
        }
        _ => Problem::general(rendered),
    }
}

/// Validation errors that come from a language feature.
fn validation_problem(error: &ValidationError, views: &[View]) -> Option<Problem> {
    match error {
        ValidationError::Function {
            name: function,
            source:
                FunctionError::InvalidArgumentPointerSpace {
                    name: parameter,
                    space,
                    ..
                },
            ..
        } => Some(pointer_parameter(
            views,
            function,
            parameter,
            restricted_space(*space).unwrap_or("given"),
        )),
        ValidationError::GlobalVariable {
            name,
            source: GlobalVariableError::Alignment(AddressSpace::Uniform, _, disalignment),
            ..
        } => {
            let (view, item) = locate(views, name);
            Some(language_feature(
                view.path,
                scan::global_line(&view.tokens, item),
                "uniform_buffer_standard_layout",
                &format!(
                    "The uniform buffer `{item}` breaks the uniform layout rules ({}), so it",
                    lowercase_first(&disalignment.to_string())
                ),
            ))
        }
        _ => None,
    }
}

/// True when a validation error comes from `@builtin(draw_index)` without the capability.
fn uses_draw_index(error: &ValidationError) -> bool {
    let ValidationError::EntryPoint { source, .. } = error else {
        return false;
    };
    let varying = match source {
        EntryPointError::Argument(_, varying) | EntryPointError::Result(varying) => varying,
        _ => return false,
    };
    matches!(varying, VaryingError::UnsupportedCapability(c) if c.contains(Capabilities::DRAW_INDEX))
}

fn lowercase_first(text: &str) -> String {
    let mut chars = text.chars();
    chars
        .next()
        .map(|first| first.to_lowercase().chain(chars).collect())
        .unwrap_or_default()
}
