//! Plain names for composed items. The shader composer adds a long module suffix to each name that
//! a library module declares, so that modules cannot clash. This pass takes the suffix off again,
//! which keeps the WGSL and GLSL output short and readable. A name that two items share keeps its
//! module path as a suffix instead.

use std::collections::BTreeMap;

use naga::{Module, UniqueArena};

use crate::library::Library;

/// Replaces decorated names in `module` with plain names.
pub(crate) fn undecorate(module: &mut Module, library: &Library) {
    let split = |name: &str| -> Option<(String, String)> {
        library.modules().iter().find_map(|m| {
            name.strip_suffix(&m.decoration)
                .map(|item| (item.to_owned(), m.name.replace("::", "_")))
        })
    };
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for name in item_names(module) {
        let plain = split(name).map_or_else(|| name.to_owned(), |(item, _)| item);
        *counts.entry(plain).or_default() += 1;
    }
    let rename = |name: &mut Option<String>| {
        if let Some((item, module_path)) = name.as_deref().and_then(split) {
            *name = Some(if counts[&item] == 1 {
                item
            } else {
                format!("{item}_{module_path}")
            });
        }
    };

    for (_, function) in module.functions.iter_mut() {
        rename(&mut function.name);
    }
    for (_, global) in module.global_variables.iter_mut() {
        rename(&mut global.name);
    }
    for (_, constant) in module.constants.iter_mut() {
        rename(&mut constant.name);
    }
    for (_, value) in module.overrides.iter_mut() {
        rename(&mut value.name);
    }
    // Types live in a set that merges equal values, so renamed types go into a new set. If a
    // rename made two types equal, the handles would shift, so the old names stay.
    let mut types = UniqueArena::new();
    for (handle, ty) in module.types.iter() {
        let mut ty = ty.clone();
        rename(&mut ty.name);
        if types.insert(ty, module.types.get_span(handle)) != handle {
            return;
        }
    }
    module.types = types;
}

/// The names of the module's named types, functions, global variables, constants, overrides and
/// entry points, which share one namespace in WGSL.
fn item_names(module: &Module) -> impl Iterator<Item = &str> {
    let types = module.types.iter().filter_map(|(_, t)| t.name.as_deref());
    let functions = module
        .functions
        .iter()
        .filter_map(|(_, f)| f.name.as_deref());
    let globals = module
        .global_variables
        .iter()
        .filter_map(|(_, g)| g.name.as_deref());
    let constants = module
        .constants
        .iter()
        .filter_map(|(_, c)| c.name.as_deref());
    let overrides = module
        .overrides
        .iter()
        .filter_map(|(_, o)| o.name.as_deref());
    let entry_points = module.entry_points.iter().map(|e| e.name.as_str());
    types
        .chain(functions)
        .chain(globals)
        .chain(constants)
        .chain(overrides)
        .chain(entry_points)
}
