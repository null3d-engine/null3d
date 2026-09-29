//! Why a render graph did not compile. Each error has a code in the engine's error table and two
//! detail numbers, as the core's errors have; [`RenderGraph::explain`] names the passes and the
//! resources.

use std::fmt;

use super::{PassId, Quoted, RenderGraph, ResourceId, Source, Target};

/// Why a pass's targets cannot share one render pass, for [`GraphError::TargetMismatch`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mismatch {
    /// The target's size is not the size the pass draws at.
    Size,
    /// The target's sample count differs from the pass's other targets.
    Samples,
    /// The pass draws into a second depth target.
    Depth,
    /// The pass draws into an array target without naming one layer.
    AllLayers,
    /// The pass draws into a layer that the target does not have.
    Layer,
    /// The pass draws but names no target.
    NoTarget,
}

/// Why a render graph did not compile.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GraphError {
    /// Code 1502: a running pass uses a resource that no pass creates, or reads a frame resource
    /// that no running pass writes. Details: the pass and the resource.
    MissingInput {
        /// The pass that uses the resource.
        pass: PassId,
        /// The resource it uses.
        resource: ResourceId,
    },
    /// Code 1503: two passes create one resource, or a pass creates a resource that the graph
    /// declares itself. Details: the resource and the second creator.
    TwoCreators {
        /// The resource created twice.
        resource: ResourceId,
        /// The later of its creators, in the order of declaration.
        pass: PassId,
    },
    /// Code 1504: the passes form a cycle, so no order runs each after the passes it needs.
    /// Details: two passes on the cycle, the second of which runs after the first.
    Cycle {
        /// The first pass of the cycle in the order of declaration.
        first: PassId,
        /// The pass on the cycle that runs after `first`.
        second: PassId,
    },
    /// Code 1505: a pass's targets cannot share one render pass. Details: the pass and the
    /// target, or `u32::MAX` for a pass with no target.
    TargetMismatch {
        /// The pass.
        pass: PassId,
        /// The target that does not fit, or `None` when the pass names no target.
        resource: Option<ResourceId>,
        /// What does not fit.
        reason: Mismatch,
    },
}

impl GraphError {
    /// Code of [`GraphError::MissingInput`].
    pub const MISSING_INPUT: u32 = 1502;
    /// Code of [`GraphError::TwoCreators`].
    pub const TWO_CREATORS: u32 = 1503;
    /// Code of [`GraphError::Cycle`].
    pub const CYCLE: u32 = 1504;
    /// Code of [`GraphError::TargetMismatch`].
    pub const TARGET_MISMATCH: u32 = 1505;

    /// The number of this error in the TypeScript error table.
    pub const fn code(&self) -> u32 {
        match self {
            Self::MissingInput { .. } => Self::MISSING_INPUT,
            Self::TwoCreators { .. } => Self::TWO_CREATORS,
            Self::Cycle { .. } => Self::CYCLE,
            Self::TargetMismatch { .. } => Self::TARGET_MISMATCH,
        }
    }

    /// The two numbers that complete the error's message. Each variant documents their meaning.
    pub const fn details(&self) -> [u32; 2] {
        match *self {
            Self::MissingInput { pass, resource } => [pass.0 as u32, resource.0 as u32],
            Self::TwoCreators { resource, pass } => [resource.0 as u32, pass.0 as u32],
            Self::Cycle { first, second } => [first.0 as u32, second.0 as u32],
            Self::TargetMismatch { pass, resource, .. } => [
                pass.0 as u32,
                match resource {
                    Some(resource) => resource.0 as u32,
                    None => u32::MAX,
                },
            ],
        }
    }
}

impl fmt::Display for GraphError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let code = self.code();
        let [a, b] = self.details();
        match self {
            Self::MissingInput { .. } => write!(
                f,
                "E{code}: pass {a} uses resource {b}, which no pass creates or no running pass writes"
            ),
            Self::TwoCreators { .. } => {
                write!(
                    f,
                    "E{code}: pass {b} creates resource {a}, which exists already"
                )
            }
            Self::Cycle { .. } => write!(
                f,
                "E{code}: passes {a} and {b} are on a cycle, so no order runs each after the passes it needs"
            ),
            Self::TargetMismatch { resource: None, .. } => {
                write!(f, "E{code}: pass {a} draws into no target")
            }
            Self::TargetMismatch { reason, .. } => {
                write!(
                    f,
                    "E{code}: pass {a} cannot draw into target {b}: {reason:?}"
                )
            }
        }
    }
}

impl std::error::Error for GraphError {}

impl RenderGraph {
    /// The error's message as the engine prints it: its code, then what went wrong, with the
    /// passes and resources by name.
    pub fn explain(&self, error: GraphError) -> String {
        let pass = |id: PassId| Quoted(self.pass_name(id));
        let resource = |id: ResourceId| Quoted(self.resource_name(id));
        let code = error.code();
        match error {
            GraphError::MissingInput {
                pass: user,
                resource: used,
            } => {
                if self.is_created(used) {
                    format!(
                        "E{code}: the pass {} reads {}, but no pass that runs this frame writes it.",
                        pass(user),
                        resource(used)
                    )
                } else {
                    format!(
                        "E{code}: the pass {} uses {}, but no pass creates it.",
                        pass(user),
                        resource(used)
                    )
                }
            }
            GraphError::TwoCreators {
                resource: made,
                pass: second,
            } => match self.resources[made.index()].source {
                Source::Passes => format!(
                    "E{code}: both {} and {} create {}.",
                    pass(self.creator_of(made).unwrap_or(second)),
                    pass(second),
                    resource(made)
                ),
                Source::Kept { .. } => format!(
                    "E{code}: the pass {} creates {}, which the graph keeps between frames.",
                    pass(second),
                    resource(made)
                ),
                Source::Buffer | Source::Canvas => format!(
                    "E{code}: the pass {} creates {}, which comes from outside the graph.",
                    pass(second),
                    resource(made)
                ),
            },
            GraphError::Cycle { first, second } => {
                let found = self.compiler.cycle.as_slice();
                let cycle = if found.len() >= 2 && found[0] == first && found[1] == second {
                    found
                } else {
                    &[first, second][..]
                };
                let mut text = format!("E{code}: the passes form a cycle: ");
                for (index, &after) in cycle.iter().enumerate().skip(1) {
                    let before = cycle[index - 1];
                    if index == 1 {
                        text += &format!("{} runs after {}", pass(after), pass(before));
                    } else {
                        text += &format!(", {} after {}", pass(after), pass(before));
                    }
                }
                let last = cycle[cycle.len() - 1];
                text += &format!(", and {} after {}.", pass(cycle[0]), pass(last));
                text
            }
            GraphError::TargetMismatch {
                pass: drawer,
                resource: target,
                reason,
            } => {
                let size = self.pass_size(drawer);
                let Some(target) = target else {
                    return format!("E{code}: the pass {} draws into no target.", pass(drawer));
                };
                let (shape, target_size) = self.shape_of(target).unwrap_or((Target::CANVAS, size));
                match reason {
                    Mismatch::Size => format!(
                        "E{code}: the pass {} draws at {} into {}, which is {}.",
                        pass(drawer),
                        size.name(),
                        resource(target),
                        target_size.name()
                    ),
                    Mismatch::Samples => {
                        let other = self
                            .accesses_of(drawer.index())
                            .iter()
                            .filter(|a| a.mode.writes() && a.resource != target.0)
                            .find_map(|a| {
                                let other = ResourceId(a.resource);
                                let (shape, _) = self.shape_of(other)?;
                                Some((other, shape.samples))
                            })
                            .filter(|&(_, samples)| samples != shape.samples);
                        match other {
                            Some((other, samples)) => format!(
                                "E{code}: the pass {} draws into {} and {}, whose sample counts differ: {samples} and {}.",
                                pass(drawer),
                                resource(other),
                                resource(target),
                                shape.samples
                            ),
                            None => format!(
                                "E{code}: the pass {} draws into {}, whose sample count differs from its other targets.",
                                pass(drawer),
                                resource(target)
                            ),
                        }
                    }
                    Mismatch::Depth => format!(
                        "E{code}: the pass {} draws into {} as a second depth target.",
                        pass(drawer),
                        resource(target)
                    ),
                    Mismatch::AllLayers => format!(
                        "E{code}: the pass {} draws into {}, which has {} layers, without naming one.",
                        pass(drawer),
                        resource(target),
                        shape.layers
                    ),
                    Mismatch::Layer => {
                        let layer = self
                            .accesses_of(drawer.index())
                            .iter()
                            .find(|a| a.resource == target.0)
                            .and_then(|a| a.layer)
                            .unwrap_or(shape.layers);
                        format!(
                            "E{code}: the pass {} draws into layer {layer} of {}, which has {} layers.",
                            pass(drawer),
                            resource(target),
                            shape.layers
                        )
                    }
                    Mismatch::NoTarget => {
                        format!("E{code}: the pass {} draws into no target.", pass(drawer))
                    }
                }
            }
        }
    }
}
