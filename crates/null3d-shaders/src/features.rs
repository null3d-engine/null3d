//! The portability check: shaders use only the WGSL language features that every target browser
//! supports (AGENTS.md hard rule 10), no extension that needs an optional WebGPU feature, and
//! write flat interpolation as `@interpolate(flat, either)`.
//!
//! WGSL does not require a `requires` directive before code uses a language feature, so reading
//! `requires` lines is not enough. The check works in three layers:
//!
//! 1. A scan of each file, as the variant sees it after the shader defs, finds `requires` lines
//!    and the syntax that each other feature adds: swizzle assignment, `var<immediate>`, the
//!    built-in values and texel formats of newer features, and the buffer view functions. It
//!    also finds `enable` lines, and the 16-bit float types and values that `enable f16;` would
//!    allow, whose own errors from naga would ask for that directive.
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

use crate::library::{Library, View, owner};
use crate::position::{Position, to_u32};
use crate::scan::{self, Kind, Token};
use crate::{Problem, composition};

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

/// The public docs page that states the rules this check enforces. Messages link to it the way
/// the engine's error messages link to their pages.
const RULES_PAGE: &str =
    "https://github.com/null3d-engine/null3d/blob/main/docs/shaders/wgsl-rules.md";

/// Each language feature whose code the check finds, and how to rewrite that code.
const FIXES: [(&str, &str); 11] = [
    (
        "swizzle_assignment",
        "Assign each component on its own, for example `v.x = a.x; v.y = a.y;`, or assign the whole vector.",
    ),
    (
        "texture_and_sampler_let",
        "Use the texture or sampler variable directly instead of copying it into a `let`.",
    ),
    (
        "unrestricted_pointer_parameters",
        "Pass a pointer to a whole `function` or `private` variable, or use the global variable directly inside the function.",
    ),
    (
        "uniform_buffer_standard_layout",
        "Give arrays in uniform buffers a 16-byte stride, for example `array<vec4f, 4>`, and align nested structs to 16 bytes.",
    ),
    ("immediate_address_space", "Use a uniform buffer instead."),
    (
        "linear_indexing",
        "Compute the index from `global_invocation_id` or `workgroup_id` and the workgroup size.",
    ),
    (
        "subgroup_id",
        "Subgroups are optional in WebGPU: keep this code behind a capability flag with a fallback.",
    ),
    (
        "fragment_depth",
        "Write `@builtin(frag_depth)` without a depth mode.",
    ),
    (
        "buffer_view",
        "Declare the variable with the type it holds.",
    ),
    (
        "texture_formats_tier1",
        "Use a core storage texel format, such as `rgba8unorm`, `rgba16float`, `r32float` or `rgba32float`.",
    ),
    (
        "atomic_vec2u_min_max",
        "Use 32-bit atomics, such as `atomicMin` on `atomic<u32>`.",
    ),
];

/// How to rewrite code that uses a language feature.
fn fix(feature: &str) -> &'static str {
    FIXES
        .iter()
        .find(|(name, _)| *name == feature)
        .map_or(REMOVE_REQUIRES, |(_, fix)| fix)
}

/// How to fix a `requires` directive that names a feature outside the allowed three.
const REMOVE_REQUIRES: &str = "Remove the feature from the directive, and rewrite the code that needs it or keep that code behind a capability flag with a fallback.";

/// The WGSL extension that the shader build allows in `enable` lines. It exists only in the build:
/// variants for WebGL2 alone read the draw index from `WEBGL_multi_draw`.
const BUILD_EXTENSION: &str = "draw_index";

/// WGSL extensions, each with the optional WebGPU feature that a device needs for it.
const OPTIONAL_EXTENSIONS: [(&str, &str); 5] = [
    ("f16", "shader-f16"),
    ("subgroups", "subgroups"),
    ("clip_distances", "clip-distances"),
    ("dual_source_blending", "dual-source-blending"),
    ("primitive_index", "primitive-index"),
];

/// A problem with an `enable` line that names an extension other than the build's own.
fn extension_problem(path: &str, position: Position, extension: &str) -> Problem {
    if extension == "f16" {
        return half_float_problem(path, position, "`enable f16;`");
    }
    let needs = OPTIONAL_EXTENSIONS
        .iter()
        .find(|(name, _)| *name == extension)
        .map_or_else(
            || "a WGSL extension that not every browser supports".to_owned(),
            |(_, feature)| {
                format!("the optional WebGPU feature `{feature}`, which not every device has")
            },
        );
    Problem::at(
        path,
        Some(position),
        format!(
            "`enable {extension};` needs {needs}, so null3D shaders cannot use it. Remove the directive, and write the code without the extension. See {RULES_PAGE}"
        ),
    )
}

/// A problem with 16-bit floats, found at `what`.
fn half_float_problem(path: &str, position: Position, what: &str) -> Problem {
    Problem::at(
        path,
        Some(position),
        format!(
            "{what} uses 16-bit floats, which need the optional WebGPU feature `shader-f16`. Not every device has it, so null3D shaders cannot use `f16`. Write the math in `f32` types and values, such as `vec3f` and `1.0`. See {RULES_PAGE}"
        ),
    )
}

/// True for a 16-bit float type: `f16`, and the vector and matrix aliases that end in `h`.
fn is_half_float_type(name: &str) -> bool {
    if name == "f16" {
        return true;
    }
    let Some(shape) = name.strip_suffix('h') else {
        return false;
    };
    let size = |digit: u8| (b'2'..=b'4').contains(&digit);
    match shape.as_bytes() {
        [b'v', b'e', b'c', n] => size(*n),
        [b'm', b'a', b't', c, b'x', r] => size(*c) && size(*r),
        _ => false,
    }
}

/// True for a 16-bit float value, such as `1.0h`, `2h` or `0x1p-2h`. A hexadecimal value ends in
/// `h` only when it has an exponent, because `h` is not a hexadecimal digit.
fn is_half_float_value(number: &str) -> bool {
    let Some(value) = number.strip_suffix('h') else {
        return false;
    };
    match value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
    {
        Some(hex) => hex.contains(['p', 'P']),
        None => !value.is_empty(),
    }
}

/// A problem about a language feature, found at `what` in a file.
fn language_feature(path: &str, position: Option<Position>, feature: &str, what: &str) -> Problem {
    feature_problem(path, position, feature, what, fix(feature))
}

fn feature_problem(
    path: &str,
    position: Option<Position>,
    feature: &str,
    what: &str,
    fix: &str,
) -> Problem {
    let [first, second, third] = ALLOWED_LANGUAGE_FEATURES;
    Problem {
        feature: Some(feature.to_owned()),
        ..Problem::at(
            path,
            position,
            format!(
                "{what} uses the WGSL language feature `{feature}`, which not every browser supports. null3D shaders may use only `{first}`, `{second}` and `{third}`. {fix} See {RULES_PAGE}"
            ),
        )
    }
}

/// A pointer parameter into an address space that needs `unrestricted_pointer_parameters`.
fn pointer_parameter(views: &[View], function: &str, parameter: &str, space: &str) -> Problem {
    let (view, item) = owner(views, function);
    let position = scan::find_function(&view.tokens, item)
        .map(|d| view.position(scan::param(&view.tokens, &d, parameter).unwrap_or(d.name)));
    language_feature(
        view.path,
        position,
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

/// Scans one file. Each problem points at the token its message names: an attribute's `@`, the
/// name of a function, type, extension or texel format, or the start of a swizzle. Of the 16-bit
/// float types and values in a file, only the first gets a problem, and none does when an
/// `enable f16;` line already has one.
fn scan_file(
    view: &View,
    members: &BTreeSet<&str>,
    declared: &BTreeSet<&str>,
    problems: &mut Vec<Problem>,
) {
    let tokens = &view.tokens;
    let path = view.path;
    let mut depth = 0usize;
    let mut enables_f16 = false;
    let mut first_half_float = None;
    for (index, token) in tokens.iter().enumerate() {
        let next = |n: usize| tokens.get(index + n).map_or("", |t| t.text);
        let previous = index.checked_sub(1).map_or("", |p| tokens[p].text);
        let mut found = |at: usize, feature: &str, what: &str| {
            problems.push(language_feature(
                path,
                Some(view.position(at)),
                feature,
                what,
            ));
        };
        match token.text {
            "{" => depth += 1,
            "}" => depth = depth.saturating_sub(1),
            "requires" if depth == 0 && matches!(previous, "" | ";" | "}") => {
                for name in directive_names(tokens, index) {
                    let feature = tokens[name].text;
                    if !ALLOWED_LANGUAGE_FEATURES.contains(&feature) {
                        problems.push(feature_problem(
                            path,
                            Some(view.position(name)),
                            feature,
                            &format!("`requires {feature}`"),
                            REMOVE_REQUIRES,
                        ));
                    }
                }
            }
            "enable" if depth == 0 && matches!(previous, "" | ";" | "}") => {
                for name in directive_names(tokens, index) {
                    let extension = tokens[name].text;
                    enables_f16 |= extension == "f16";
                    if extension != BUILD_EXTENSION {
                        problems.push(extension_problem(path, view.position(name), extension));
                    }
                }
            }
            name if first_half_float.is_none()
                && ((token.kind == Kind::Ident
                    && is_half_float_type(name)
                    && !declared.contains(name))
                    || (token.kind == Kind::Number && is_half_float_value(name))) =>
            {
                first_half_float = Some(index);
            }
            "." if is_swizzle(next(1)) && is_assignment(next(2)) && !members.contains(next(1)) => {
                found(
                    index,
                    "swizzle_assignment",
                    &format!("An assignment to the swizzle `.{}`", next(1)),
                );
            }
            "var" if next(1) == "<" && next(2) == "immediate" => {
                found(index, "immediate_address_space", "`var<immediate>`");
            }
            "builtin" if previous == "@" && next(1) == "(" => match next(2) {
                name @ ("global_invocation_index" | "workgroup_index") => {
                    found(index - 1, "linear_indexing", &format!("`@builtin({name})`"));
                }
                name @ ("subgroup_id" | "num_subgroups") => {
                    found(index - 1, "subgroup_id", &format!("`@builtin({name})`"));
                }
                "frag_depth" if next(3) == "," => {
                    found(
                        index - 1,
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
                    Some(view.position(index - 1)),
                    format!(
                        "flat interpolation must be written `@interpolate(flat, either)`. `@interpolate(flat)` means `flat, first`, which WebGL2 and WebGPU compatibility mode cannot provide. See {RULES_PAGE}"
                    ),
                ));
            }
            name @ ("bufferView" | "bufferArrayView" | "bufferLength")
                if next(1) == "(" && !declared.contains(name) =>
            {
                found(index, "buffer_view", &format!("`{name}`"));
            }
            "buffer"
                if !declared.contains("buffer")
                    && (previous == ":" || (matches!(previous, "," | "<") && next(1) == "<")) =>
            {
                found(index, "buffer_view", "The `buffer` type");
            }
            name @ ("atomicStoreMin" | "atomicStoreMax")
                if next(1) == "(" && !declared.contains(name) =>
            {
                found(index, "atomic_vec2u_min_max", &format!("`{name}`"));
            }
            name if name.starts_with("texture_storage_")
                && next(1) == "<"
                && TIER1_TEXEL_FORMATS.contains(&next(2)) =>
            {
                found(
                    index + 2,
                    "texture_formats_tier1",
                    &format!("The storage texel format `{}`", next(2)),
                );
            }
            _ => {}
        }
    }
    if let Some(index) = first_half_float.filter(|_| !enables_f16) {
        let token = tokens[index];
        let what = match token.kind {
            Kind::Number => format!("The value `{}`", token.text),
            _ => format!("The type `{}`", token.text),
        };
        problems.push(half_float_problem(path, view.position(index), &what));
    }
}

/// The names that the directive at `index` lists before its `;`.
fn directive_names<'a>(tokens: &'a [Token], index: usize) -> impl Iterator<Item = usize> + 'a {
    (index + 1..tokens.len())
        .take_while(|&i| tokens[i].text != ";")
        .filter(|&i| tokens[i].kind == Kind::Ident)
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
                Some(Position {
                    line: to_u32(index + 1),
                    column: to_u32(line.chars().take_while(|c| c.is_whitespace()).count() + 1),
                }),
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

/// The 1-based lines of the whole-line directives in a source.
pub(crate) fn directive_lines(source: &str) -> Vec<u32> {
    source
        .lines()
        .enumerate()
        .filter(|(_, line)| is_directive(line.trim()))
        .map(|(index, _)| to_u32(index + 1))
        .collect()
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
    let (view, item) = owner(views, name);
    let tokens = &view.tokens;
    let declaration = scan::find_function(tokens, item);
    // The place of something found inside the function, or else the function's name.
    let place_in = |find: &dyn Fn(&scan::Function) -> Option<usize>| {
        declaration
            .as_ref()
            .map(|d| view.position(find(d).unwrap_or(d.name)))
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
            place_in(&|d| scan::let_binding(tokens, d, binding)),
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
        let (_, callee_item) = owner(views, callee_name);
        let position = place_in(&|d| {
            let calls = scan::calls(tokens, d, &[callee_name, callee_item]);
            let call = calls
                .iter()
                .filter(|call| call.passes_part)
                .nth(*partial_seen - 1);
            call.or_else(|| calls.get(*calls_seen - 1))
                .map(|call| call.name)
        });
        problems.push(language_feature(
            view.path,
            position,
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

/// Turns a composer error into a problem at the place it points to. Errors that come from a
/// language feature name it.
pub(crate) fn composition_problem(
    error: &ComposerError,
    composer: &Composer,
    views: &[View],
    library: &Library,
) -> Problem {
    let found = composition::describe(error, composer, views, library);
    match &error.inner {
        ComposerErrorInner::WgslParseError(parse)
            if parse.notes().any(|note| note.contains("assignments to swizzles")) =>
        {
            language_feature(
                &found.path,
                found.position,
                "swizzle_assignment",
                "An assignment to a swizzle",
            )
        }
        ComposerErrorInner::ShaderValidationError(validation) => {
            validation_problem(validation.as_inner(), views).unwrap_or_else(|| {
                let mut problem = Problem::at(&found.path, found.position, found.message);
                if uses_draw_index(validation.as_inner()) {
                    problem.message.push_str(
                        "\n`@builtin(draw_index)` works only in a variant whose targets are just [\"glsl\"]: the WebGL2 shader reads `gl_DrawID` from WEBGL_multi_draw, and WebGPU has no draw index.",
                    );
                }
                problem
            })
        }
        _ => Problem::at(&found.path, found.position, found.message),
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
            let (view, item) = owner(views, name);
            Some(language_feature(
                view.path,
                scan::global(&view.tokens, item).map(|index| view.position(index)),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_page_that_messages_link_to_states_each_rule_the_check_enforces() {
        let (_, page) = RULES_PAGE
            .split_once("/blob/main/")
            .expect("a link to a file on main");
        let path = format!("{}/../../{page}", env!("CARGO_MANIFEST_DIR"));
        let text = std::fs::read_to_string(&path).expect("the rules page");
        let features = ALLOWED_LANGUAGE_FEATURES
            .iter()
            .chain(FIXES.iter().map(|(name, _)| name));
        for feature in features {
            assert!(
                text.contains(&format!("`{feature}`")),
                "{page} does not name `{feature}`"
            );
        }
        assert!(
            text.contains("`@interpolate(flat, either)`"),
            "{page} lacks the flat rule"
        );
        for (extension, _) in OPTIONAL_EXTENSIONS {
            assert!(
                text.contains(&format!("`{extension}`")),
                "{page} does not name the extension `{extension}`"
            );
        }
    }

    #[test]
    fn half_float_types_and_values_are_told_apart_from_other_names() {
        for name in ["f16", "vec2h", "vec4h", "mat2x2h", "mat4x3h"] {
            assert!(is_half_float_type(name), "{name}");
        }
        for name in ["f32", "vec3f", "vech", "vec5h", "mat4x4", "mat1x2h", "h"] {
            assert!(!is_half_float_type(name), "{name}");
        }
        for value in ["1.0h", "2h", "1e3h", "0x1p-2h"] {
            assert!(is_half_float_value(value), "{value}");
        }
        for value in ["1.0", "2u", "0x1h", "0xAh", "h"] {
            assert!(!is_half_float_value(value), "{value}");
        }
    }
}
