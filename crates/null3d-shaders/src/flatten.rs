//! Replaces structure-typed locals, parameters and results in a module before the GLSL writer.
//!
//! The Adreno 619 driver of a Galaxy Tab A9 Plus keeps every value that a GLSL structure holds at
//! 16 bits, whatever precision the shader declares. Whole numbers keep only their low 16 bits, and
//! floats take half precision with flush to zero. Our WebGL2 shaders held every pixel's inputs,
//! surface and material values, and ids in structures, so the driver lost their precision.
//!
//! This pass runs on naga's code model, before the GLSL writer, and only for the WebGL2 build. It
//! rewrites each function so that no structure is ever a local, a parameter or a result:
//!
//! - A structure argument becomes one argument for each of its members. An entry point's argument
//!   keeps the binding of the member that each part came from.
//! - A pointer argument to a structure becomes one pointer argument for each member, in the same
//!   address space. A caller passes a pointer to each member's own variable.
//! - A structure result of a helper becomes one `out` parameter for each member. An entry point's
//!   result stays a structure: WGSL requires one.
//! - A structure local becomes one local for each member, and a private structure global one
//!   global for each member, each with its member of the initial value.
//! - A structure value is never materialized. Each use reads the member it needs, so naga's writer
//!   never bakes a structure expression into a GLSL local. `modf` and `frexp` results are worked
//!   out member by member, so the writer makes no helper that returns a structure either.
//!
//! The only structure expression that the writer still names is the value that an entry point
//! returns. `glsl.rs` inlines that one in the text. An array of structures stays whole: it is one
//! value, which a structure value inside it is composed for.
//!
//! The pass runs on custom WGSL too, so it never panics: a shape it cannot split stops the build
//! with a problem that names the function.

use std::collections::HashMap;

use naga::{
    AddressSpace, Arena, BinaryOperator, Binding, Block, Expression, Function, FunctionArgument,
    GlobalVariable, Handle, Literal, LocalVariable, MathFunction, Module, PredeclaredType, Scalar,
    ScalarKind, Span, Statement, Type, TypeInner, UniqueArena, VectorSize,
    proc::TypeResolution,
    valid::{FunctionInfo, ModuleInfo},
};

/// Rewrites the module so that no GLSL local, parameter or result holds a structure, except a
/// uniform block's own declaration. Fails with a message for the shader's author when a shape
/// cannot be split.
pub(crate) fn flatten_structs(module: &mut Module, info: &ModuleInfo) -> Result<(), String> {
    // The pass adds a pointer type for each structure result that becomes output parameters, and
    // for each member of a structure behind a pointer argument.
    let mut types = module.types.clone();
    // A private structure global becomes one global for each member. The GLSL writer then never
    // declares a structure variable at file scope either.
    let mut global_leaves: HashMap<(Handle<GlobalVariable>, Vec<u32>), Handle<GlobalVariable>> =
        HashMap::new();
    let globals: Vec<(Handle<GlobalVariable>, GlobalVariable)> = module
        .global_variables
        .iter()
        .map(|(handle, global)| (handle, global.clone()))
        .collect();
    for (handle, global) in &globals {
        if global.space != AddressSpace::Private || !is_struct(&types, global.ty) {
            continue;
        }
        let mut paths = Vec::new();
        leaves_of(&types, global.ty, &mut Vec::new(), &mut |path, _| {
            paths.push(path.to_vec());
        });
        for path in paths {
            let leaf_ty = type_at(&types, global.ty, &path);
            let init = match global.init {
                Some(init) => initial_member(module, init, &path, leaf_ty).ok_or_else(|| {
                    format!(
                        "the private variable `{}` has an initial value that the WebGL2 build cannot split into its members. The WebGL2 build keeps no struct in a variable, because some phone GPUs store a struct's members at half precision. Set the variable's value in a function instead.",
                        global.name.as_deref().unwrap_or("")
                    )
                })?,
                None => module
                    .global_expressions
                    .append(Expression::ZeroValue(leaf_ty), Span::UNDEFINED),
            };
            let name = global.name.as_deref().map(|name| {
                let suffix: Vec<String> = path.iter().map(|index| index.to_string()).collect();
                format!("{name}_{}", suffix.join("_"))
            });
            let leaf = module.global_variables.append(
                GlobalVariable {
                    name,
                    space: global.space,
                    binding: None,
                    ty: leaf_ty,
                    init: Some(init),
                    memory_decorations: global.memory_decorations,
                },
                Span::UNDEFINED,
            );
            global_leaves.insert((*handle, path), leaf);
        }
    }
    let mut plans: HashMap<Handle<Function>, Plan> = HashMap::new();
    for (handle, function) in module.functions.iter() {
        plans.insert(handle, Plan::new(&mut types, function, false));
    }
    for (handle, function) in module.functions.iter_mut() {
        let plan = &plans[&handle];
        let mut lower = Lower::new(&mut types, &info[handle], &plans, &global_leaves, function);
        let new = lower.run(plan, false)?;
        *function = new;
    }
    for (index, entry) in module.entry_points.iter_mut().enumerate() {
        let plan = Plan::new(&mut types, &entry.function, true);
        let mut lower = Lower::new(
            &mut types,
            info.get_entry_point(index),
            &plans,
            &global_leaves,
            &entry.function,
        );
        let new = lower.run(&plan, true)?;
        entry.function = new;
    }
    // Every `modf` and `frexp` result is now worked out member by member, so the writer needs no
    // helper function that returns their structures.
    module.special_types.predeclared_types.retain(|key, _| {
        !matches!(
            key,
            PredeclaredType::ModfResult { .. } | PredeclaredType::FrexpResult { .. }
        )
    });
    module.types = types;
    Ok(())
}

/// The member at `path` of a global's constant initial value, or `None` for a form of constant
/// that this pass does not take apart.
fn initial_member(
    module: &mut Module,
    init: Handle<Expression>,
    path: &[u32],
    leaf_ty: Handle<Type>,
) -> Option<Handle<Expression>> {
    let Some((&first, rest)) = path.split_first() else {
        return Some(init);
    };
    match module.global_expressions[init].clone() {
        Expression::Compose { components, .. } => {
            initial_member(module, *components.get(first as usize)?, rest, leaf_ty)
        }
        Expression::ZeroValue(_) => Some(
            module
                .global_expressions
                .append(Expression::ZeroValue(leaf_ty), Span::UNDEFINED),
        ),
        Expression::Constant(constant) => {
            let init = module.constants[constant].init;
            initial_member(module, init, path, leaf_ty)
        }
        Expression::AccessIndex { base, index } => {
            let mut full = vec![index];
            full.extend_from_slice(path);
            initial_member(module, base, &full, leaf_ty)
        }
        _ => None,
    }
}

/// One leaf of a structure: the path of member indices to it, its type, and, for an entry point's
/// argument, the binding of the member that holds it.
#[derive(Clone)]
struct Leaf {
    path: Vec<u32>,
    ty: Handle<Type>,
    binding: Option<Binding>,
    name: Option<String>,
}

/// How one function's arguments and result change.
#[derive(Clone)]
struct Plan {
    /// For each old argument, the leaves that replace it, in order. A leaf of a pointer argument
    /// has a pointer type.
    args: Vec<Vec<Leaf>>,
    /// The leaves of a structure result that becomes output parameters, if any.
    result: Vec<Leaf>,
    /// True when the result was a structure and became output parameters.
    split_result: bool,
}

impl Plan {
    fn new(types: &mut UniqueArena<Type>, function: &Function, entry: bool) -> Self {
        let mut args = Vec::with_capacity(function.arguments.len());
        for arg in &function.arguments {
            let leaves = match types[arg.ty].inner {
                TypeInner::Struct { .. } => {
                    let mut leaves = Vec::new();
                    leaves_of(types, arg.ty, &mut Vec::new(), &mut |path, ty| {
                        leaves.push(Leaf {
                            path: path.to_vec(),
                            ty,
                            binding: if entry {
                                binding_at(types, arg.ty, path)
                            } else {
                                None
                            },
                            name: None,
                        });
                    });
                    leaves
                }
                TypeInner::Pointer { base, space } if is_struct(types, base) => {
                    let mut members = Vec::new();
                    leaves_of(types, base, &mut Vec::new(), &mut |path, ty| {
                        members.push((path.to_vec(), ty));
                    });
                    members
                        .into_iter()
                        .map(|(path, ty)| Leaf {
                            path,
                            ty: pointer_to(types, ty, space),
                            binding: None,
                            name: None,
                        })
                        .collect()
                }
                _ => vec![Leaf {
                    path: Vec::new(),
                    ty: arg.ty,
                    binding: arg.binding.clone(),
                    name: arg.name.clone(),
                }],
            };
            args.push(leaves);
        }
        let mut result = Vec::new();
        let mut split_result = false;
        if !entry
            && let Some(res) = &function.result
            && is_struct(types, res.ty)
        {
            split_result = true;
            leaves_of(types, res.ty, &mut Vec::new(), &mut |path, ty| {
                result.push(Leaf {
                    path: path.to_vec(),
                    ty,
                    binding: None,
                    name: None,
                });
            });
        }
        Plan {
            args,
            result,
            split_result,
        }
    }
}

/// The structure held by a type, when it is a structure or a pointer to one.
#[derive(Clone, Copy)]
enum Kind {
    Value(Handle<Type>),
    Pointer(Handle<Type>),
}

/// A value, or a structure that is read one member at a time.
#[derive(Clone)]
enum Flat {
    One(Handle<Expression>),
    Many(Vec<Flat>),
}

impl Flat {
    fn leaves(&self, out: &mut Vec<Handle<Expression>>) {
        match self {
            Flat::One(handle) => out.push(*handle),
            Flat::Many(members) => {
                for member in members {
                    member.leaves(out);
                }
            }
        }
    }

    /// The decomposition of the member at `path`.
    fn member(self, path: &[u32]) -> Option<Flat> {
        let mut current = self;
        for &index in path {
            let Flat::Many(mut members) = current else {
                return None;
            };
            if index as usize >= members.len() {
                return None;
            }
            current = members.swap_remove(index as usize);
        }
        Some(current)
    }
}

/// True when `ty` is a structure type.
fn is_struct(types: &UniqueArena<Type>, ty: Handle<Type>) -> bool {
    matches!(types[ty].inner, TypeInner::Struct { .. })
}

/// The type of a pointer to `base` in `space`.
fn pointer_to(
    types: &mut UniqueArena<Type>,
    base: Handle<Type>,
    space: AddressSpace,
) -> Handle<Type> {
    types.insert(
        Type {
            name: None,
            inner: TypeInner::Pointer { base, space },
        },
        Span::UNDEFINED,
    )
}

/// True for an expression that naga's validator places in scope before the body: an `Emit` may
/// never name it again. The result of a statement that naga inserts itself counts as one, because
/// the statement, not an `Emit`, brings it into scope.
fn pre_emitted(expression: &Expression) -> bool {
    expression.needs_pre_emit()
        || matches!(
            expression,
            Expression::CallResult(_)
                | Expression::AtomicResult { .. }
                | Expression::WorkGroupUniformLoadResult { .. }
                | Expression::RayQueryProceedResult
                | Expression::SubgroupBallotResult
                | Expression::SubgroupOperationResult { .. }
        )
}

/// Calls `visit` with the path and type of every non-structure member of `ty`, in declaration
/// order. An array member counts as a leaf, including an array of structures.
fn leaves_of(
    types: &UniqueArena<Type>,
    ty: Handle<Type>,
    path: &mut Vec<u32>,
    visit: &mut impl FnMut(&[u32], Handle<Type>),
) {
    if let TypeInner::Struct { members, .. } = &types[ty].inner {
        for (index, member) in members.iter().enumerate() {
            path.push(index as u32);
            leaves_of(types, member.ty, path, visit);
            path.pop();
        }
    } else {
        visit(path, ty);
    }
}

/// The type of the member at `path` below the structure `ty`. Every path comes from `leaves_of`
/// on the same type.
fn type_at(types: &UniqueArena<Type>, ty: Handle<Type>, path: &[u32]) -> Handle<Type> {
    let mut current = ty;
    for &index in path {
        let TypeInner::Struct { members, .. } = &types[current].inner else {
            unreachable!("a member path crosses a type that is not a structure");
        };
        current = members[index as usize].ty;
    }
    current
}

/// The binding of the member at `path`.
fn binding_at(types: &UniqueArena<Type>, ty: Handle<Type>, path: &[u32]) -> Option<Binding> {
    let mut current = ty;
    let mut binding = None;
    for &index in path {
        let TypeInner::Struct { members, .. } = &types[current].inner else {
            unreachable!("a member path crosses a type that is not a structure");
        };
        binding = members[index as usize].binding.clone();
        current = members[index as usize].ty;
    }
    binding
}

/// The structure type that a resolution names, or points to.
fn kind_of(types: &UniqueArena<Type>, ty: TypeResolution) -> Option<Kind> {
    match ty {
        TypeResolution::Handle(handle) => match &types[handle].inner {
            TypeInner::Struct { .. } => Some(Kind::Value(handle)),
            TypeInner::Pointer { base, .. } => match &types[*base].inner {
                TypeInner::Struct { .. } => Some(Kind::Pointer(*base)),
                _ => None,
            },
            _ => None,
        },
        TypeResolution::Value(TypeInner::Pointer { base, .. }) => match &types[base].inner {
            TypeInner::Struct { .. } => Some(Kind::Pointer(base)),
            _ => None,
        },
        _ => None,
    }
}

/// Rewrites one function.
struct Lower<'a> {
    types: &'a mut UniqueArena<Type>,
    info: &'a FunctionInfo,
    plans: &'a HashMap<Handle<Function>, Plan>,
    global_leaves: &'a HashMap<(Handle<GlobalVariable>, Vec<u32>), Handle<GlobalVariable>>,
    old: &'a Function,
    out: Function,
    entry: bool,
    split_result: bool,
    /// The decomposition of each old expression that holds a structure.
    flat: HashMap<Handle<Expression>, Flat>,
    /// A plain expression rebuilt for a structure expression that naga never bakes into a local.
    reference: HashMap<Handle<Expression>, Handle<Expression>>,
    /// The new local of one leaf of an old structure local.
    leaf_local: HashMap<(Handle<LocalVariable>, Vec<u32>), Handle<LocalVariable>>,
    /// The new local that receives one leaf of a helper's structure result.
    out_local: HashMap<(Handle<Expression>, Vec<u32>), Handle<LocalVariable>>,
    /// The new argument index of one leaf of an old argument.
    arg_leaf: HashMap<(usize, Vec<u32>), u32>,
    /// The new argument index of an output parameter, by leaf.
    result_leaf: HashMap<Vec<u32>, u32>,
    /// The new local for an old local that is not a structure.
    local_map: HashMap<Handle<LocalVariable>, Handle<LocalVariable>>,
    /// The first expression of the group that the next `Emit` covers.
    emit_start: Option<usize>,
    /// Ranges of expressions that need an `Emit`, closed when an expression that naga pre-emits
    /// arrives in between.
    ranges: Vec<naga::Range<Expression>>,
}

impl<'a> Lower<'a> {
    fn new(
        types: &'a mut UniqueArena<Type>,
        info: &'a FunctionInfo,
        plans: &'a HashMap<Handle<Function>, Plan>,
        global_leaves: &'a HashMap<(Handle<GlobalVariable>, Vec<u32>), Handle<GlobalVariable>>,
        old: &'a Function,
    ) -> Self {
        Lower {
            types,
            info,
            plans,
            global_leaves,
            old,
            out: Function {
                name: old.name.clone(),
                arguments: Vec::new(),
                result: old.result.clone(),
                local_variables: Arena::new(),
                expressions: Arena::new(),
                named_expressions: Default::default(),
                body: Block::new(),
                diagnostic_filter_leaf: old.diagnostic_filter_leaf,
            },
            entry: false,
            split_result: false,
            flat: HashMap::new(),
            reference: HashMap::new(),
            leaf_local: HashMap::new(),
            out_local: HashMap::new(),
            arg_leaf: HashMap::new(),
            result_leaf: HashMap::new(),
            local_map: HashMap::new(),
            emit_start: None,
            ranges: Vec::new(),
        }
    }

    /// The problem for a structure use that the pass cannot split, for the shader's author.
    fn refuse(&self, what: &str) -> String {
        format!(
            "the function `{}` uses {what}, which the WebGL2 build cannot split into its members. The WebGL2 build keeps no struct in a variable, because some phone GPUs store a struct's members at half precision. Pass the struct's members as separate values instead.",
            self.old.name.as_deref().unwrap_or("")
        )
    }

    fn run(&mut self, plan: &Plan, entry: bool) -> Result<Function, String> {
        self.entry = entry;
        self.split_result = plan.split_result;
        // The new argument list: the leaves of each old argument, then one output parameter for
        // each leaf of a structure result.
        let mut arguments = Vec::new();
        for (index, leaves) in plan.args.iter().enumerate() {
            for leaf in leaves {
                let new_index = arguments.len() as u32;
                self.arg_leaf.insert((index, leaf.path.clone()), new_index);
                arguments.push(FunctionArgument {
                    name: leaf.name.clone(),
                    ty: leaf.ty,
                    binding: leaf.binding.clone(),
                });
            }
        }
        if plan.split_result {
            for leaf in &plan.result {
                let new_index = arguments.len() as u32;
                self.result_leaf.insert(leaf.path.clone(), new_index);
                let pointer = pointer_to(self.types, leaf.ty, AddressSpace::Function);
                arguments.push(FunctionArgument {
                    name: None,
                    ty: pointer,
                    binding: None,
                });
            }
            self.out.result = None;
        }
        self.out.arguments = arguments;

        // Copy each local that holds no structure. A structure local becomes leaf locals, which
        // are created when a use reads them.
        let locals: Vec<(Handle<LocalVariable>, LocalVariable)> = self
            .old
            .local_variables
            .iter()
            .map(|(handle, local)| (handle, local.clone()))
            .collect();
        let mut inits = Vec::new();
        for (old_handle, local) in &locals {
            if is_struct(self.types, local.ty) {
                if let Some(init) = local.init {
                    inits.push((*old_handle, init));
                }
                continue;
            }
            let new_handle = self.out.local_variables.append(
                LocalVariable {
                    name: local.name.clone(),
                    ty: local.ty,
                    init: None,
                },
                Span::UNDEFINED,
            );
            self.local_map.insert(*old_handle, new_handle);
        }

        let body = self.old.body.clone();
        self.out.body = self.block(&body)?;

        // A structure local with a constant initializer obtains it from stores at the top.
        let mut prefix: Vec<Statement> = Vec::new();
        for (local, init) in inits {
            let value = self.flat(init)?;
            let mut values = Vec::new();
            value.leaves(&mut values);
            let ty = self.old.local_variables[local].ty;
            let mut pointers = Vec::new();
            let mut paths = Vec::new();
            leaves_of(self.types, ty, &mut Vec::new(), &mut |path, _| {
                paths.push(path.to_vec());
            });
            for path in &paths {
                let leaf = self.leaf_local(local, path);
                pointers.push(self.push(Expression::LocalVariable(leaf)));
            }
            self.pending(&mut prefix);
            for (pointer, value) in pointers.into_iter().zip(values) {
                prefix.push(Statement::Store { pointer, value });
            }
        }

        // The initializer of each kept local is the same constant, rebuilt.
        for (old_handle, local) in &locals {
            let Some(init) = local.init else { continue };
            let Some(new_handle) = self.local_map.get(old_handle).copied() else {
                continue;
            };
            let rebuilt = self.one(init)?;
            self.out.local_variables[new_handle].init = Some(rebuilt);
        }
        self.pending(&mut prefix);
        if !prefix.is_empty() {
            prefix.extend(self.out.body.iter().cloned());
            self.out.body = Block::from_vec(prefix);
        }

        // Keep the names of the expressions that survive.
        for (handle, name) in self.old.named_expressions.iter() {
            if let Some(Flat::One(new)) = self.flat.get(handle) {
                self.out.named_expressions.insert(*new, name.clone());
            }
        }
        Ok(std::mem::take(&mut self.out))
    }

    fn leaf_local(&mut self, local: Handle<LocalVariable>, path: &[u32]) -> Handle<LocalVariable> {
        if let Some(handle) = self.leaf_local.get(&(local, path.to_vec())) {
            return *handle;
        }
        let ty = self.old.local_variables[local].ty;
        let leaf_ty = type_at(self.types, ty, path);
        let handle = self.out.local_variables.append(
            LocalVariable {
                name: None,
                ty: leaf_ty,
                init: None,
            },
            Span::UNDEFINED,
        );
        self.leaf_local.insert((local, path.to_vec()), handle);
        handle
    }

    /// The structure that the old expression names, when it names one.
    fn kind(&self, handle: Handle<Expression>) -> Option<Kind> {
        kind_of(self.types, self.info[handle].ty.clone())
    }

    /// The decomposition of the old expression, computed once.
    fn flat(&mut self, handle: Handle<Expression>) -> Result<Flat, String> {
        if let Some(flat) = self.flat.get(&handle) {
            return Ok(flat.clone());
        }
        let expression = self.old.expressions[handle].clone();
        let flat = match expression {
            // An access into a structure yields that member's own decomposition.
            Expression::AccessIndex { base, index } if self.kind(base).is_some() => self
                .flat(base)?
                .member(&[index])
                .ok_or_else(|| self.refuse("a member of a struct that it cannot find"))?,
            Expression::Math {
                fun: fun @ (MathFunction::Modf | MathFunction::Frexp),
                arg,
                ..
            } => self.split_math(fun, arg)?,
            _ => match self.kind(handle) {
                Some(Kind::Value(ty)) => self.build(handle, ty, &mut Vec::new(), false)?,
                Some(Kind::Pointer(ty)) => self.build(handle, ty, &mut Vec::new(), true)?,
                None => Flat::One(self.rebuild(&expression)?),
            },
        };
        self.flat.insert(handle, flat.clone());
        Ok(flat)
    }

    /// The decomposition of a structure of type `ty`, one entry for each member.
    fn build(
        &mut self,
        old: Handle<Expression>,
        ty: Handle<Type>,
        prefix: &mut Vec<u32>,
        pointer: bool,
    ) -> Result<Flat, String> {
        let TypeInner::Struct { members, .. } = &self.types[ty].inner else {
            unreachable!("build is called on a structure");
        };
        let member_types: Vec<Handle<Type>> = members.iter().map(|member| member.ty).collect();
        let mut out = Vec::with_capacity(member_types.len());
        for (index, member_ty) in member_types.into_iter().enumerate() {
            prefix.push(index as u32);
            if is_struct(self.types, member_ty) {
                out.push(self.build(old, member_ty, prefix, pointer)?);
            } else {
                let leaf = if pointer {
                    self.leaf_pointer(old, prefix)?
                } else {
                    self.leaf_value(old, prefix)?
                };
                out.push(Flat::One(leaf));
            }
            prefix.pop();
        }
        Ok(Flat::Many(out))
    }

    /// The members of a `modf` or `frexp` result, worked out from their definitions so that the
    /// writer makes no helper function that returns a structure.
    fn split_math(&mut self, fun: MathFunction, arg: Handle<Expression>) -> Result<Flat, String> {
        let (size, scalar) = match *self.info[arg].ty.inner_with(self.types) {
            TypeInner::Scalar(scalar) => (None, scalar),
            TypeInner::Vector { size, scalar } => (Some(size), scalar),
            _ => return Err(self.refuse("a `modf` or `frexp` of a value that is not a float")),
        };
        let x = self.one(arg)?;
        if fun == MathFunction::Modf {
            // The whole part is the value rounded towards zero, and the fraction is the rest, as
            // WGSL defines them.
            let whole = self.push(Expression::Math {
                fun: MathFunction::Trunc,
                arg: x,
                arg1: None,
                arg2: None,
                arg3: None,
            });
            let fract = self.binary(BinaryOperator::Subtract, x, whole);
            return Ok(Flat::Many(vec![Flat::One(fract), Flat::One(whole)]));
        }
        if scalar != Scalar::F32 {
            return Err(self.refuse("a `frexp` of a value that is not a 32-bit float"));
        }
        // A normal float holds its exponent plus 127 in bits 23 to 30. The fraction keeps the
        // sign and mantissa bits with the exponent of one half, so it lies in [0.5, 1), and the
        // exponent is one more than the float's own. Zero gives zero for both.
        let bits = self.push(Expression::As {
            expr: x,
            kind: ScalarKind::Uint,
            convert: None,
        });
        let shift = self.splat(Literal::U32(23), size);
        let shifted = self.binary(BinaryOperator::ShiftRight, bits, shift);
        let byte = self.splat(Literal::U32(0xff), size);
        let biased = self.binary(BinaryOperator::And, shifted, byte);
        let signed = self.push(Expression::As {
            expr: biased,
            kind: ScalarKind::Sint,
            convert: Some(4),
        });
        let bias = self.splat(Literal::I32(126), size);
        let exponent = self.binary(BinaryOperator::Subtract, signed, bias);
        let keep = self.splat(Literal::U32(0x807f_ffff), size);
        let kept = self.binary(BinaryOperator::And, bits, keep);
        let half = self.splat(Literal::U32(0x3f00_0000), size);
        let fraction_bits = self.binary(BinaryOperator::InclusiveOr, kept, half);
        let fraction = self.push(Expression::As {
            expr: fraction_bits,
            kind: ScalarKind::Float,
            convert: None,
        });
        // GLSL ES 3.00 has no `mix` that picks whole numbers by a boolean vector, so zero
        // multiplies both members away instead of a select.
        let zero = self.splat(Literal::F32(0.0), size);
        let nonzero = self.binary(BinaryOperator::NotEqual, x, zero);
        let whole_mask = self.push(Expression::As {
            expr: nonzero,
            kind: ScalarKind::Sint,
            convert: Some(4),
        });
        let float_mask = self.push(Expression::As {
            expr: nonzero,
            kind: ScalarKind::Float,
            convert: Some(4),
        });
        let exp = self.binary(BinaryOperator::Multiply, exponent, whole_mask);
        let fract = self.binary(BinaryOperator::Multiply, fraction, float_mask);
        Ok(Flat::Many(vec![Flat::One(fract), Flat::One(exp)]))
    }

    fn binary(
        &mut self,
        op: BinaryOperator,
        left: Handle<Expression>,
        right: Handle<Expression>,
    ) -> Handle<Expression> {
        self.push(Expression::Binary { op, left, right })
    }

    /// A literal, repeated across a vector of `size` when there is one.
    fn splat(&mut self, literal: Literal, size: Option<VectorSize>) -> Handle<Expression> {
        let value = self.push(Expression::Literal(literal));
        match size {
            Some(size) => self.push(Expression::Splat { size, value }),
            None => value,
        }
    }

    /// The value at `path` below the old structure value `handle`.
    fn leaf_value(
        &mut self,
        handle: Handle<Expression>,
        path: &[u32],
    ) -> Result<Handle<Expression>, String> {
        if path.is_empty() {
            return self.one(handle);
        }
        let expression = self.old.expressions[handle].clone();
        match expression {
            Expression::Load { pointer } => {
                let pointer = self.leaf_pointer(pointer, path)?;
                Ok(self.push(Expression::Load { pointer }))
            }
            Expression::Compose { components, .. } => {
                let component = *components
                    .get(path[0] as usize)
                    .ok_or_else(|| self.refuse("a struct value with a missing member"))?;
                self.leaf_value(component, &path[1..])
            }
            Expression::AccessIndex { base, index } => {
                let mut full = vec![index];
                full.extend_from_slice(path);
                self.leaf_value(base, &full)
            }
            Expression::FunctionArgument(index) => {
                let leaf = self.argument_leaf(index, path)?;
                Ok(self.push(Expression::FunctionArgument(leaf)))
            }
            Expression::CallResult(_) => {
                let local = self
                    .out_local
                    .get(&(handle, path.to_vec()))
                    .copied()
                    .ok_or_else(|| self.refuse("a struct result that it cannot find"))?;
                let pointer = self.push(Expression::LocalVariable(local));
                Ok(self.push(Expression::Load { pointer }))
            }
            Expression::ZeroValue(ty) => {
                let leaf = type_at(self.types, ty, path);
                Ok(self.push(Expression::ZeroValue(leaf)))
            }
            Expression::Math {
                fun: MathFunction::Modf | MathFunction::Frexp,
                ..
            } => match self.flat(handle)?.member(path) {
                Some(Flat::One(leaf)) => Ok(leaf),
                _ => Err(self.refuse("a member of a `modf` or `frexp` result that it cannot find")),
            },
            _ => {
                let base = self.reference(handle)?;
                Ok(self.access_chain(base, path))
            }
        }
    }

    /// The pointer at `path` below the old pointer to a structure `handle`.
    fn leaf_pointer(
        &mut self,
        handle: Handle<Expression>,
        path: &[u32],
    ) -> Result<Handle<Expression>, String> {
        if path.is_empty() {
            return self.one(handle);
        }
        let expression = self.old.expressions[handle].clone();
        match expression {
            Expression::LocalVariable(local) => {
                let leaf = self.leaf_local(local, path);
                Ok(self.push(Expression::LocalVariable(leaf)))
            }
            Expression::AccessIndex { base, index } => {
                let mut full = vec![index];
                full.extend_from_slice(path);
                self.leaf_pointer(base, &full)
            }
            Expression::FunctionArgument(index) => {
                let leaf = self.argument_leaf(index, path)?;
                Ok(self.push(Expression::FunctionArgument(leaf)))
            }
            Expression::GlobalVariable(global) => {
                if let Some(leaf) = self.global_leaves.get(&(global, path.to_vec())).copied() {
                    Ok(self.push(Expression::GlobalVariable(leaf)))
                } else {
                    let base = self.reference(handle)?;
                    Ok(self.access_chain(base, path))
                }
            }
            _ => {
                let base = self.reference(handle)?;
                Ok(self.access_chain(base, path))
            }
        }
    }

    /// The new argument index of the leaf at `path` of an old argument.
    fn argument_leaf(&self, index: u32, path: &[u32]) -> Result<u32, String> {
        self.arg_leaf
            .get(&(index as usize, path.to_vec()))
            .copied()
            .ok_or_else(|| self.refuse("a struct parameter in a form that it does not know"))
    }

    /// `AccessIndex` down each member index of `path` from `base`.
    fn access_chain(&mut self, base: Handle<Expression>, path: &[u32]) -> Handle<Expression> {
        let mut current = base;
        for &index in path {
            current = self.push(Expression::AccessIndex {
                base: current,
                index,
            });
        }
        current
    }

    /// A plain expression for an old structure expression that naga never bakes into a local: an
    /// array access, a global variable, or a pointer.
    fn reference(&mut self, handle: Handle<Expression>) -> Result<Handle<Expression>, String> {
        if let Some(new) = self.reference.get(&handle) {
            return Ok(*new);
        }
        let expression = self.old.expressions[handle].clone();
        let new = self.rebuild(&expression)?;
        self.reference.insert(handle, new);
        Ok(new)
    }

    /// The one plain handle that an expression stands for. A structure value in a place that
    /// takes one value, such as an element of an array of structures, is composed from its
    /// members there.
    fn one(&mut self, handle: Handle<Expression>) -> Result<Handle<Expression>, String> {
        match self.flat(handle)? {
            Flat::One(handle) => Ok(handle),
            Flat::Many(_) => match self.kind(handle) {
                Some(Kind::Value(ty)) => self.compose(handle, ty),
                _ => Err(self.refuse("a pointer to a struct where one value is needed")),
            },
        }
    }

    /// Each operand of an optional operand, rebuilt.
    fn maybe(
        &mut self,
        handle: Option<Handle<Expression>>,
    ) -> Result<Option<Handle<Expression>>, String> {
        handle.map(|handle| self.one(handle)).transpose()
    }

    /// Rebuilds an expression in the new arena, with its operands replaced.
    fn rebuild(&mut self, expression: &Expression) -> Result<Handle<Expression>, String> {
        use Expression as E;
        let rebuilt = match expression.clone() {
            E::Literal(literal) => E::Literal(literal),
            E::Constant(handle) => E::Constant(handle),
            E::Override(handle) => E::Override(handle),
            E::ZeroValue(ty) => E::ZeroValue(ty),
            E::Compose { ty, components } => {
                let components = components
                    .iter()
                    .map(|c| self.one(*c))
                    .collect::<Result<_, _>>()?;
                E::Compose { ty, components }
            }
            E::Access { base, index } => E::Access {
                base: self.one(base)?,
                index: self.one(index)?,
            },
            E::AccessIndex { base, index } => E::AccessIndex {
                base: self.one(base)?,
                index,
            },
            E::Splat { size, value } => E::Splat {
                size,
                value: self.one(value)?,
            },
            E::Swizzle {
                size,
                vector,
                pattern,
            } => E::Swizzle {
                size,
                vector: self.one(vector)?,
                pattern,
            },
            E::FunctionArgument(index) => E::FunctionArgument(self.argument_leaf(index, &[])?),
            E::GlobalVariable(handle) => E::GlobalVariable(handle),
            E::LocalVariable(handle) => {
                E::LocalVariable(self.local_map.get(&handle).copied().ok_or_else(|| {
                    self.refuse("a struct variable in a form that it does not know")
                })?)
            }
            E::Load { pointer } => E::Load {
                pointer: self.one(pointer)?,
            },
            E::ImageSample {
                image,
                sampler,
                gather,
                coordinate,
                array_index,
                offset,
                level,
                depth_ref,
                clamp_to_edge,
            } => E::ImageSample {
                image: self.one(image)?,
                sampler: self.one(sampler)?,
                gather,
                coordinate: self.one(coordinate)?,
                array_index: self.maybe(array_index)?,
                offset: self.maybe(offset)?,
                level: self.sample_level(level)?,
                depth_ref: self.maybe(depth_ref)?,
                clamp_to_edge,
            },
            E::ImageLoad {
                image,
                coordinate,
                array_index,
                sample,
                level,
            } => E::ImageLoad {
                image: self.one(image)?,
                coordinate: self.one(coordinate)?,
                array_index: self.maybe(array_index)?,
                sample: self.maybe(sample)?,
                level: self.maybe(level)?,
            },
            E::ImageQuery { image, query } => E::ImageQuery {
                image: self.one(image)?,
                query: match query {
                    naga::ImageQuery::Size { level } => naga::ImageQuery::Size {
                        level: self.maybe(level)?,
                    },
                    other => other,
                },
            },
            E::Unary { op, expr } => E::Unary {
                op,
                expr: self.one(expr)?,
            },
            E::Binary { op, left, right } => E::Binary {
                op,
                left: self.one(left)?,
                right: self.one(right)?,
            },
            E::Select {
                condition,
                accept,
                reject,
            } => E::Select {
                condition: self.one(condition)?,
                accept: self.one(accept)?,
                reject: self.one(reject)?,
            },
            E::Derivative { axis, ctrl, expr } => E::Derivative {
                axis,
                ctrl,
                expr: self.one(expr)?,
            },
            E::Relational { fun, argument } => E::Relational {
                fun,
                argument: self.one(argument)?,
            },
            E::Math {
                fun,
                arg,
                arg1,
                arg2,
                arg3,
            } => E::Math {
                fun,
                arg: self.one(arg)?,
                arg1: self.maybe(arg1)?,
                arg2: self.maybe(arg2)?,
                arg3: self.maybe(arg3)?,
            },
            E::As {
                expr,
                kind,
                convert,
            } => E::As {
                expr: self.one(expr)?,
                kind,
                convert,
            },
            E::CallResult(handle) => E::CallResult(handle),
            E::AtomicResult { ty, comparison } => E::AtomicResult { ty, comparison },
            E::WorkGroupUniformLoadResult { ty } => E::WorkGroupUniformLoadResult { ty },
            E::ArrayLength(handle) => E::ArrayLength(self.one(handle)?),
            E::RayQueryVertexPositions { query, committed } => E::RayQueryVertexPositions {
                query: self.one(query)?,
                committed,
            },
            E::RayQueryProceedResult => E::RayQueryProceedResult,
            E::RayQueryGetIntersection { query, committed } => E::RayQueryGetIntersection {
                query: self.one(query)?,
                committed,
            },
            E::SubgroupBallotResult => E::SubgroupBallotResult,
            E::SubgroupOperationResult { ty } => E::SubgroupOperationResult { ty },
            E::CooperativeLoad {
                columns,
                rows,
                role,
                data,
            } => E::CooperativeLoad {
                columns,
                rows,
                role,
                data,
            },
            E::CooperativeMultiplyAdd { a, b, c } => E::CooperativeMultiplyAdd {
                a: self.one(a)?,
                b: self.one(b)?,
                c: self.one(c)?,
            },
        };
        Ok(self.push(rebuilt))
    }

    fn ray_query(&mut self, fun: naga::RayQueryFunction) -> Result<naga::RayQueryFunction, String> {
        use naga::RayQueryFunction as F;
        Ok(match fun {
            F::Initialize {
                acceleration_structure,
                descriptor,
            } => F::Initialize {
                acceleration_structure: self.one(acceleration_structure)?,
                descriptor: self.one(descriptor)?,
            },
            F::Proceed { result } => F::Proceed {
                result: self.one(result)?,
            },
            F::GenerateIntersection { hit_t } => F::GenerateIntersection {
                hit_t: self.one(hit_t)?,
            },
            other => other,
        })
    }

    fn sample_level(&mut self, level: naga::SampleLevel) -> Result<naga::SampleLevel, String> {
        Ok(match level {
            naga::SampleLevel::Exact(handle) => naga::SampleLevel::Exact(self.one(handle)?),
            naga::SampleLevel::Bias(handle) => naga::SampleLevel::Bias(self.one(handle)?),
            naga::SampleLevel::Gradient { x, y } => naga::SampleLevel::Gradient {
                x: self.one(x)?,
                y: self.one(y)?,
            },
            other => other,
        })
    }

    /// Appends a new expression. An expression that naga pre-emits, such as a literal, a function
    /// argument or a local variable, is never named by an `Emit`: naga's validator places it in
    /// scope before the body. Anything in between closes the range around it.
    fn push(&mut self, expression: Expression) -> Handle<Expression> {
        if pre_emitted(&expression) {
            self.close_range();
            return self.out.expressions.append(expression, Span::UNDEFINED);
        }
        if self.emit_start.is_none() {
            self.emit_start = Some(self.out.expressions.len());
        }
        self.out.expressions.append(expression, Span::UNDEFINED)
    }

    /// Ends the open range of expressions that need an `Emit` at the current arena length.
    fn close_range(&mut self) {
        if let Some(start) = self.emit_start.take()
            && start < self.out.expressions.len()
        {
            self.ranges.push(self.out.expressions.range_from(start));
        }
    }

    /// Writes the pending expressions as `Emit` statements at the end of `block`.
    fn pending(&mut self, block: &mut Vec<Statement>) {
        self.close_range();
        for range in self.ranges.drain(..) {
            block.push(Statement::Emit(range));
        }
    }

    /// Rewrites a whole block.
    fn block(&mut self, old: &Block) -> Result<Block, String> {
        let mut out = Vec::with_capacity(old.len());
        for statement in old {
            self.statement(statement, &mut out)?;
        }
        self.pending(&mut out);
        Ok(Block::from_vec(out))
    }

    /// Rewrites one statement, appending the result to `out`.
    fn statement(&mut self, statement: &Statement, out: &mut Vec<Statement>) -> Result<(), String> {
        use Statement as S;
        match statement {
            S::Emit(range) => {
                for handle in range.clone() {
                    if !self.deferred(handle) {
                        self.flat(handle)?;
                    }
                }
                self.pending(out);
            }
            S::Block(body) => {
                self.pending(out);
                let body = self.block(body)?;
                out.push(S::Block(body));
            }
            S::If {
                condition,
                accept,
                reject,
            } => {
                let condition = self.one(*condition)?;
                self.pending(out);
                let accept = self.block(accept)?;
                let reject = self.block(reject)?;
                out.push(S::If {
                    condition,
                    accept,
                    reject,
                });
            }
            S::Switch { selector, cases } => {
                let selector = self.one(*selector)?;
                self.pending(out);
                let mut new_cases = Vec::with_capacity(cases.len());
                for case in cases {
                    new_cases.push(naga::SwitchCase {
                        value: case.value,
                        body: self.block(&case.body)?,
                        fall_through: case.fall_through,
                    });
                }
                out.push(S::Switch {
                    selector,
                    cases: new_cases,
                });
            }
            S::Loop {
                body,
                continuing,
                break_if,
            } => {
                let body = self.block(body)?;
                let continuing = self.block(continuing)?;
                let break_if = self.maybe(*break_if)?;
                self.pending(out);
                out.push(S::Loop {
                    body,
                    continuing,
                    break_if,
                });
            }
            S::Return { value } => self.return_statement(*value, out)?,
            S::Store { pointer, value } => self.store(*pointer, *value, out)?,
            S::Call {
                function,
                arguments,
                result,
            } => self.call(*function, arguments, *result, out)?,
            S::Atomic {
                pointer,
                fun,
                value,
                result,
            } => {
                let pointer = self.one(*pointer)?;
                let value = self.one(*value)?;
                let result = self.result_expression(*result)?;
                self.pending(out);
                out.push(S::Atomic {
                    pointer,
                    fun: *fun,
                    value,
                    result,
                });
            }
            S::ImageStore {
                image,
                coordinate,
                array_index,
                value,
            } => {
                let image = self.one(*image)?;
                let coordinate = self.one(*coordinate)?;
                let array_index = self.maybe(*array_index)?;
                let value = self.one(*value)?;
                self.pending(out);
                out.push(S::ImageStore {
                    image,
                    coordinate,
                    array_index,
                    value,
                });
            }
            S::WorkGroupUniformLoad { pointer, result } => {
                let pointer = self.one(*pointer)?;
                let result = self.statement_result(*result)?;
                self.pending(out);
                out.push(S::WorkGroupUniformLoad { pointer, result });
            }
            S::RayQuery { query, fun } => {
                let query = self.one(*query)?;
                let fun = self.ray_query(fun.clone())?;
                self.pending(out);
                out.push(S::RayQuery { query, fun });
            }
            S::SubgroupBallot { result, predicate } => {
                let predicate = self.maybe(*predicate)?;
                let result = self.statement_result(*result)?;
                self.pending(out);
                out.push(S::SubgroupBallot { result, predicate });
            }
            S::SubgroupGather {
                mode,
                argument,
                result,
            } => {
                let argument = self.one(*argument)?;
                let result = self.statement_result(*result)?;
                self.pending(out);
                out.push(S::SubgroupGather {
                    mode: *mode,
                    argument,
                    result,
                });
            }
            S::SubgroupCollectiveOperation {
                op,
                collective_op,
                argument,
                result,
            } => {
                let argument = self.one(*argument)?;
                let result = self.statement_result(*result)?;
                self.pending(out);
                out.push(S::SubgroupCollectiveOperation {
                    op: *op,
                    collective_op: *collective_op,
                    argument,
                    result,
                });
            }
            S::Break => out.push(S::Break),
            S::Continue => out.push(S::Continue),
            S::Kill => out.push(S::Kill),
            S::ControlBarrier(barrier) => out.push(S::ControlBarrier(*barrier)),
            S::MemoryBarrier(barrier) => out.push(S::MemoryBarrier(*barrier)),
            S::RayPipelineFunction(function) => {
                out.push(S::RayPipelineFunction(*function));
            }
            S::ImageAtomic {
                image,
                coordinate,
                array_index,
                fun,
                value,
            } => {
                let image = self.one(*image)?;
                let coordinate = self.one(*coordinate)?;
                let array_index = self.maybe(*array_index)?;
                let value = self.one(*value)?;
                let fun = *fun;
                self.pending(out);
                out.push(S::ImageAtomic {
                    image,
                    coordinate,
                    array_index,
                    fun,
                    value,
                });
            }
            S::CooperativeStore { target, data } => {
                let target = self.one(*target)?;
                let data = *data;
                self.pending(out);
                out.push(S::CooperativeStore { target, data });
            }
        }
        Ok(())
    }

    /// True when an expression holds a structure whose value comes from a statement, so its
    /// decomposition waits for that statement.
    fn deferred(&self, handle: Handle<Expression>) -> bool {
        match self.old.expressions[handle] {
            Expression::CallResult(_)
            | Expression::AtomicResult { .. }
            | Expression::WorkGroupUniformLoadResult { .. }
            | Expression::RayQueryProceedResult
            | Expression::SubgroupBallotResult
            | Expression::SubgroupOperationResult { .. } => self.kind(handle).is_some(),
            _ => false,
        }
    }

    /// The new result expression of a statement whose result comes from the statement itself.
    fn statement_result(
        &mut self,
        handle: Handle<Expression>,
    ) -> Result<Handle<Expression>, String> {
        if self.kind(handle).is_some() {
            self.reference(handle)
        } else {
            self.one(handle)
        }
    }

    /// The new result expression of a statement whose result, when it has one, comes from the
    /// statement itself.
    fn result_expression(
        &mut self,
        result: Option<Handle<Expression>>,
    ) -> Result<Option<Handle<Expression>>, String> {
        result
            .map(|handle| self.statement_result(handle))
            .transpose()
    }

    fn store(
        &mut self,
        pointer: Handle<Expression>,
        value: Handle<Expression>,
        out: &mut Vec<Statement>,
    ) -> Result<(), String> {
        if self.kind(pointer).is_some() {
            let pointers = self.flat(pointer)?;
            let values = self.flat(value)?;
            let mut pointers_leaves = Vec::new();
            let mut values_leaves = Vec::new();
            pointers.leaves(&mut pointers_leaves);
            values.leaves(&mut values_leaves);
            self.pending(out);
            for (pointer, value) in pointers_leaves.into_iter().zip(values_leaves) {
                out.push(Statement::Store { pointer, value });
            }
            return Ok(());
        }
        let pointer = self.one(pointer)?;
        let value = self.one(value)?;
        self.pending(out);
        out.push(Statement::Store { pointer, value });
        Ok(())
    }

    fn return_statement(
        &mut self,
        value: Option<Handle<Expression>>,
        out: &mut Vec<Statement>,
    ) -> Result<(), String> {
        let Some(value) = value else {
            self.pending(out);
            out.push(Statement::Return { value: None });
            return Ok(());
        };
        if self.split_result
            && let Some(result_ty) = self.old.result.as_ref().map(|result| result.ty)
        {
            // A helper whose structure result became output parameters: store each member.
            let flat = self.flat(value)?;
            let mut leaves = Vec::new();
            flat.leaves(&mut leaves);
            let mut paths = Vec::new();
            leaves_of(self.types, result_ty, &mut Vec::new(), &mut |path, _| {
                paths.push(path.to_vec());
            });
            let mut pointers = Vec::with_capacity(paths.len());
            for path in &paths {
                let index = *self
                    .result_leaf
                    .get(path)
                    .ok_or_else(|| self.refuse("a struct result that it cannot find"))?;
                pointers.push(self.push(Expression::FunctionArgument(index)));
            }
            self.pending(out);
            for (pointer, value) in pointers.into_iter().zip(leaves) {
                out.push(Statement::Store { pointer, value });
            }
            out.push(Statement::Return { value: None });
            return Ok(());
        }
        if self.entry
            && let Some(result) = &self.out.result
            && is_struct(self.types, result.ty)
        {
            // An entry point's structure result: build the structure that the stage returns.
            let ty = result.ty;
            let composed = self.compose(value, ty)?;
            self.pending(out);
            out.push(Statement::Return {
                value: Some(composed),
            });
            return Ok(());
        }
        let value = self.one(value)?;
        self.pending(out);
        out.push(Statement::Return { value: Some(value) });
        Ok(())
    }

    /// Builds the structure of type `ty` from the members of the value `old`.
    fn compose(
        &mut self,
        old: Handle<Expression>,
        ty: Handle<Type>,
    ) -> Result<Handle<Expression>, String> {
        let flat = self.flat(old)?;
        let components = self.compose_members(&flat, ty)?;
        Ok(self.push(Expression::Compose { ty, components }))
    }

    fn compose_members(
        &mut self,
        flat: &Flat,
        ty: Handle<Type>,
    ) -> Result<Vec<Handle<Expression>>, String> {
        let TypeInner::Struct { members, .. } = &self.types[ty].inner else {
            unreachable!("compose is called on a structure");
        };
        let member_types: Vec<Handle<Type>> = members.iter().map(|member| member.ty).collect();
        let Flat::Many(children) = flat else {
            return Err(self.refuse("a struct value that it cannot take apart"));
        };
        let mut components = Vec::with_capacity(children.len());
        for (child, member_ty) in children.iter().zip(member_types) {
            components.push(match child {
                Flat::One(handle) => *handle,
                Flat::Many(_) => {
                    let inner = self.compose_members(child, member_ty)?;
                    self.push(Expression::Compose {
                        ty: member_ty,
                        components: inner,
                    })
                }
            });
        }
        Ok(components)
    }

    fn call(
        &mut self,
        function: Handle<Function>,
        arguments: &[Handle<Expression>],
        result: Option<Handle<Expression>>,
        out: &mut Vec<Statement>,
    ) -> Result<(), String> {
        let plans = self.plans;
        let plan = plans
            .get(&function)
            .ok_or_else(|| self.refuse("a call to a function that it does not know"))?;
        let mut new_arguments = Vec::new();
        for (index, argument) in arguments.iter().enumerate() {
            let leaves = plan
                .args
                .get(index)
                .ok_or_else(|| self.refuse("a call with more arguments than the function takes"))?;
            // A pointer to a structure passes a pointer to each member; a structure value passes
            // each member's value.
            let pointer = matches!(self.kind(*argument), Some(Kind::Pointer(_)));
            for leaf in leaves {
                let value = if pointer {
                    self.leaf_pointer(*argument, &leaf.path)?
                } else {
                    self.leaf_value(*argument, &leaf.path)?
                };
                new_arguments.push(value);
            }
        }
        if plan.split_result {
            for leaf in &plan.result {
                let local = self.out.local_variables.append(
                    LocalVariable {
                        name: None,
                        ty: leaf.ty,
                        init: None,
                    },
                    Span::UNDEFINED,
                );
                if let Some(result) = result {
                    self.out_local.insert((result, leaf.path.clone()), local);
                }
                let pointer = self.push(Expression::LocalVariable(local));
                new_arguments.push(pointer);
            }
            self.pending(out);
            out.push(Statement::Call {
                function,
                arguments: new_arguments,
                result: None,
            });
            // Read the members just after the call, where the values are set, so that every later
            // use in this block or a block inside it finds them in scope.
            if let Some(result) = result {
                self.flat(result)?;
            }
            self.pending(out);
            return Ok(());
        }
        let new_result = self.maybe(result)?;
        self.pending(out);
        out.push(Statement::Call {
            function,
            arguments: new_arguments,
            result: new_result,
        });
        Ok(())
    }
}
