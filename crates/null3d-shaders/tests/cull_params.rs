//! The culling shader's uniform block, as naga lays it out, against the engine's mirror of it.
//! WebGPU refuses a bind group whose uniform buffer is smaller than the block, and the frame then
//! draws nothing. Every buffer that binds the block takes its size from
//! [`sizes::CULL_PARAMS_BYTES`]: the engine's own, and the hand-built draw lists of the test pages,
//! through the generated TypeScript constants.

use std::mem::offset_of;

use naga::{Module, StructMember, TypeInner};
use null3d_gpu::drawlist::{CullHeader, sizes, typescript_constants};

const CULL: &str = include_str!("../wgsl/cull.wgsl");

/// The text of the item of `source` that starts with `head`, through the brace that closes it at
/// the start of a line.
fn item<'a>(source: &'a str, head: &str) -> &'a str {
    let start = source
        .find(head)
        .unwrap_or_else(|| panic!("cull.wgsl lacks `{head}`"));
    let end = source[start..]
        .find("\n}")
        .unwrap_or_else(|| panic!("`{head}` in cull.wgsl has no closing brace"));
    &source[start..start + end + 2]
}

/// The line of `source` that starts with `head`.
fn line<'a>(source: &'a str, head: &str) -> &'a str {
    source
        .lines()
        .find(|line| line.starts_with(head))
        .unwrap_or_else(|| panic!("cull.wgsl lacks a line that starts with `{head}`"))
}

/// The culling shader's parameters and the declarations they need, bound as the shader binds them,
/// read and validated by naga.
fn culling_block() -> Module {
    let wgsl = [
        line(CULL, "const MAX_RANGES: u32"),
        item(CULL, "struct Occlusion {"),
        item(CULL, "struct CullParams {"),
        line(
            CULL,
            "@group(0) @binding(0) var<uniform> params: CullParams;",
        ),
    ]
    .join("\n");
    let module = naga::front::wgsl::parse_str(&wgsl)
        .unwrap_or_else(|e| panic!("{}\n{wgsl}", e.emit_to_string(&wgsl)));
    naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::empty(),
    )
    .validate(&module)
    .unwrap_or_else(|e| panic!("{e:?}\n{wgsl}"));
    module
}

/// The members and the size in bytes of the struct `name`.
fn layout<'a>(module: &'a Module, name: &str) -> (&'a [StructMember], u32) {
    module
        .types
        .iter()
        .find_map(|(_, ty)| match &ty.inner {
            TypeInner::Struct { members, span } if ty.name.as_deref() == Some(name) => {
                Some((members.as_slice(), *span))
            }
            _ => None,
        })
        .unwrap_or_else(|| panic!("cull.wgsl lacks struct {name}"))
}

/// The offset of the member `name` of `members`.
fn offset(members: &[StructMember], name: &str) -> u32 {
    members
        .iter()
        .find(|member| member.name.as_deref() == Some(name))
        .unwrap_or_else(|| panic!("CullParams lacks `{name}`"))
        .offset
}

#[test]
fn the_culling_parameters_have_the_size_that_the_shader_needs() {
    let module = culling_block();
    let (members, span) = layout(&module, "CullParams");
    assert_eq!(
        sizes::CULL_PARAMS_BYTES,
        span,
        "every buffer that binds the culling parameters must hold the shader's whole block"
    );
    assert_eq!(offset(members, "ranges"), sizes::CULL_HEADER_BYTES);
    assert_eq!(offset(members, "occlusion"), sizes::CULL_OCCLUSION_OFFSET);
    assert_eq!(layout(&module, "Occlusion").1, sizes::CULL_OCCLUSION_BYTES);
}

#[test]
fn the_culling_header_mirrors_the_shader_field_for_field() {
    let module = culling_block();
    let (members, _) = layout(&module, "CullParams");
    let mirror = [
        ("planes", offset_of!(CullHeader, planes)),
        ("instance_count", offset_of!(CullHeader, instance_count)),
        ("layers", offset_of!(CullHeader, layers)),
        ("range_count", offset_of!(CullHeader, range_count)),
        ("offsets_row", offset_of!(CullHeader, offsets_row)),
        ("levels", offset_of!(CullHeader, levels)),
        ("measure", offset_of!(CullHeader, measure)),
        ("debug", offset_of!(CullHeader, debug)),
    ];
    let header: Vec<(&str, usize)> = members
        .iter()
        .map(|member| (member.name.as_deref().unwrap_or(""), member.offset as usize))
        .take_while(|&(name, _)| name != "ranges")
        .collect();
    assert_eq!(
        header, mirror,
        "CullHeader must hold each field of CullParams before its runs, at the shader's offset"
    );
}

#[test]
fn the_test_pages_read_the_size_that_the_shader_needs() {
    let span = layout(&culling_block(), "CullParams").1;
    let line = format!("export const SIZE_CULL_PARAMS_BYTES = {span};");
    assert!(
        typescript_constants().contains(&line),
        "the generated TypeScript constants lack `{line}`"
    );
}
