//! Compiling a render graph's declarations into a plan: the checks, the order, the render and
//! compute passes the GPU runs, each attachment's load and store operations, texture usage, and the
//! textures that targets share. The compiler keeps every list between compiles, so a compile
//! allocates only when it needs more room in a list than every earlier compile did.

use std::ops::Range;

use null3d_gpu::drawlist::texture_usage;

use super::{
    Access, GraphError, Mismatch, Mode, PassDecl, PassId, PassKind, ResourceDecl, ResourceId, Size,
    Source, Target,
};

/// No pass, or no step.
const NONE: u16 = u16::MAX;
/// The creator of a resource that the graph declares itself.
const GRAPH: u16 = u16::MAX - 1;

/// How a render pass starts with an attachment.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoadOp {
    /// Clears it: no earlier pass wrote it this frame.
    Clear,
    /// Keeps what earlier passes, or earlier frames, left in it.
    Load,
}

/// How a render pass ends with an attachment.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StoreOp {
    /// Writes it to memory, for a later pass or frame.
    Store,
    /// Drops it, so a tile-based GPU never writes it to memory.
    Discard,
}

/// Where a pass finds a texture: the canvas, or one of the plan's textures.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Surface {
    /// The canvas.
    Canvas,
    /// A texture, by its index in [`Plan::textures`].
    Texture(u16),
}

/// What a step runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StepKind {
    /// A render pass: every pass in it draws at this size and sample count.
    Render {
        /// The size the step's passes draw at.
        size: Size,
        /// The sample count of every attachment.
        samples: u32,
    },
    /// A compute pass.
    Compute,
}

/// A render or compute pass as the GPU runs it: one or more declared passes in a row.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Step {
    /// A render pass with its size and sample count, or a compute pass.
    pub kind: StepKind,
    passes: (u16, u16),
    attachments: (u16, u16),
}

/// One attachment of a render step.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Attachment {
    /// The target.
    pub resource: ResourceId,
    /// The array layer the step draws into: 0 for a target with one layer.
    pub layer: u32,
    /// True for the depth attachment.
    pub depth: bool,
    /// The target's format, as a code from [`null3d_gpu::drawlist::format`].
    pub format: u32,
    /// Where the step draws.
    pub texture: Surface,
    /// Where the step resolves a multisampled color target: the texture that a later pass
    /// samples, or the canvas for a target that a resolve pass resolves.
    pub resolve: Option<Surface>,
    /// How the step starts with the attachment.
    pub load: LoadOp,
    /// How the step ends with it.
    pub store: StoreOp,
}

/// A texture the plan needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PlannedTexture {
    /// Format, sample count and layers.
    pub target: Target,
    /// The size to make it at, for the canvas: see [`Size::extent`].
    pub size: Size,
    /// Its usage flags, from [`null3d_gpu::drawlist::texture_usage`].
    pub usage: u32,
}

/// Where a resource's texture is, for the passes that draw into it and for those that sample it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Placement {
    texture: Option<Surface>,
    sampled: Option<Surface>,
}

/// A compiled render graph: the order of the running passes, the steps the GPU runs, and the
/// textures they use.
#[derive(Debug, Default)]
pub struct Plan {
    order: Vec<PassId>,
    steps: Vec<Step>,
    attachments: Vec<Attachment>,
    textures: Vec<PlannedTexture>,
    placements: Vec<Placement>,
    memory_generation: u32,
}

impl Plan {
    /// The running passes, in the order they run.
    pub fn order(&self) -> &[PassId] {
        &self.order
    }

    /// The render and compute passes the GPU runs, in order.
    pub fn steps(&self) -> &[Step] {
        &self.steps
    }

    /// A step's passes, in the order they run.
    pub fn passes(&self, step: &Step) -> &[PassId] {
        &self.order[step.passes.0 as usize..step.passes.1 as usize]
    }

    /// A render step's attachments: its color attachments in the order its passes named them,
    /// then its depth attachment. A compute step has none.
    pub fn attachments(&self, step: &Step) -> &[Attachment] {
        &self.attachments[step.attachments.0 as usize..step.attachments.1 as usize]
    }

    /// The step that runs a pass, by its index in [`Plan::steps`], or `None` for a pass that is
    /// switched off.
    pub fn step_of(&self, pass: PassId) -> Option<usize> {
        let at = self.order.iter().position(|&p| p == pass)? as u16;
        self.steps
            .iter()
            .position(|step| (step.passes.0..step.passes.1).contains(&at))
    }

    /// The textures to make, kept targets first. [`Plan::memory_generation`] says when the list
    /// changes.
    pub fn textures(&self) -> &[PlannedTexture] {
        &self.textures
    }

    /// A number that changes whenever [`Plan::textures`] changes. Textures whose entry did not
    /// change keep their contents, which kept targets need.
    pub fn memory_generation(&self) -> u32 {
        self.memory_generation
    }

    /// Where passes draw into a target or write it as storage, or `None` for a buffer, or a
    /// texture that no running pass uses.
    pub fn texture_of(&self, resource: ResourceId) -> Option<Surface> {
        self.placements.get(resource.index())?.texture
    }

    /// Where passes sample a target: its resolved texture for a multisampled color target, and
    /// the target itself otherwise.
    pub fn sampled_texture_of(&self, resource: ResourceId) -> Option<Surface> {
        self.placements.get(resource.index())?.sampled
    }
}

/// What a resource is, once the compiler knows its creator.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    /// No pass creates it and the graph does not declare it.
    Unknown,
    Texture,
    Buffer,
}

/// How long a resource's contents last.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Life {
    /// One frame: the first write in each frame starts from nothing.
    Frame,
    /// From frame to frame, in a texture of its own.
    Kept,
    /// Made outside the graph: the canvas, and imported buffers.
    Outside,
}

/// The first and last step of some use of a resource, or `NONE` twice for none.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Span {
    first: u16,
    last: u16,
}

impl Span {
    const EMPTY: Self = Self {
        first: NONE,
        last: NONE,
    };

    fn add(&mut self, step: u16) {
        if self.first == NONE {
            self.first = step;
        }
        self.last = step;
    }

    fn is_empty(self) -> bool {
        self.first == NONE
    }
}

/// What the compiler learns about one resource.
#[derive(Clone, Copy, Debug)]
struct ResourceState {
    kind: Kind,
    life: Life,
    creator: u16,
    target: Target,
    size: Size,
    /// The running passes that write it, in the order of declaration: a start and a count in the
    /// compiler's writer list.
    writers: (u32, u32),
    /// The steps that use it in any way.
    uses: Span,
    /// The steps that draw into it, and how many they are.
    attached: Span,
    attach_steps: u16,
    /// The steps that sample it.
    sampled: Span,
    /// The steps that write it as storage.
    storage: Span,
}

impl Default for ResourceState {
    fn default() -> Self {
        Self {
            kind: Kind::Unknown,
            life: Life::Frame,
            creator: NONE,
            target: Target::CANVAS,
            size: Size::Full,
            writers: (0, 0),
            uses: Span::EMPTY,
            attached: Span::EMPTY,
            attach_steps: 0,
            sampled: Span::EMPTY,
            storage: Span::EMPTY,
        }
    }
}

/// What the compiler learns about one pass.
#[derive(Clone, Copy, Debug, Default)]
struct PassState {
    /// The sample count of its targets.
    samples: u32,
    /// Its attachments: a range of the compiler's target list.
    targets: (u32, u32),
    /// The textures and buffers it reads: a range of the compiler's read list.
    reads: (u32, u32),
    /// The buffers it writes, for a pass that draws: a range of the compiler's store list.
    stores: (u32, u32),
    /// Passes it runs after that have not been placed yet, while scheduling.
    waiting: u16,
    scheduled: bool,
}

/// One attachment of one pass: a target and the layer it draws into.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Attached {
    resource: u16,
    layer: u32,
    depth: bool,
}

/// The step being built while scheduling.
#[derive(Debug, Default)]
struct OpenStep {
    kind: Option<StepKind>,
    /// Its first pass, as a place in the order.
    first_pass: usize,
    /// Its attachments so far.
    targets: Vec<Attached>,
    /// The textures and buffers its passes read.
    reads: Vec<u16>,
    /// The buffers its passes write. A render pass cannot read a buffer that it also writes.
    stores: Vec<u16>,
}

/// One texture's use by one resource, for placing it in a shared texture.
#[derive(Clone, Copy, Debug)]
struct SurfaceUse {
    span: Span,
    resource: u16,
    /// True for the texture that a multisampled color target resolves into.
    resolved: bool,
    texture: PlannedTexture,
}

/// The declarations the compiler reads.
#[derive(Clone, Copy)]
struct Decls<'a> {
    passes: &'a [PassDecl],
    accesses: &'a [Access],
    resources: &'a [ResourceDecl],
}

impl<'a> Decls<'a> {
    /// A pass's uses.
    fn uses(&self, pass: usize) -> &'a [Access] {
        let (start, end) = self.passes[pass].accesses;
        &self.accesses[start as usize..end as usize]
    }

    /// True for a resolve pass.
    fn resolves(&self, pass: usize) -> bool {
        self.passes[pass].kind == PassKind::Resolve
    }

    /// The passes that are switched on, with their indices, in the order of declaration.
    fn running(&self) -> impl Iterator<Item = (usize, &'a PassDecl)> + 'a {
        self.passes
            .iter()
            .enumerate()
            .filter(|(_, pass)| pass.enabled)
    }

    /// Every use by a pass that is switched on, with the pass's index, in the order of
    /// declaration.
    fn running_uses(&self) -> impl Iterator<Item = (usize, &'a Access)> + 'a {
        let graph = *self;
        self.running()
            .flat_map(move |(index, _)| graph.uses(index).iter().map(move |access| (index, access)))
    }
}

/// The compiler's plan and its working lists, kept from one compile to the next.
#[derive(Debug, Default)]
pub(super) struct Compiler {
    pub(super) plan: Plan,
    /// The passes of the last cycle found, each running after the one before it, and the first
    /// after the last.
    pub(super) cycle: Vec<PassId>,
    resources: Vec<ResourceState>,
    passes: Vec<PassState>,
    targets: Vec<Attached>,
    reads: Vec<u16>,
    stores: Vec<u16>,
    writers: Vec<u16>,
    /// Pairs of passes where the second runs after the first, sorted by the first.
    edges: Vec<(u16, u16)>,
    /// For each pass, where its edges start in `edges`.
    first_edge: Vec<u32>,
    step: OpenStep,
    surfaces: Vec<SurfaceUse>,
    /// For each texture, the last step that uses it so far.
    busy_until: Vec<u16>,
    /// The texture list being built, copied into the plan when it differs.
    textures: Vec<PlannedTexture>,
}

impl Compiler {
    /// Compiles the declarations into the plan, or finds the first problem with them.
    pub(super) fn run(
        &mut self,
        passes: &[PassDecl],
        accesses: &[Access],
        resources: &[ResourceDecl],
        transient_attachments: bool,
    ) -> Result<(), GraphError> {
        let graph = Decls {
            passes,
            accesses,
            resources,
        };
        self.reset(graph);
        self.find_creators(graph)?;
        self.check_passes(graph)?;
        self.link(graph)?;
        self.schedule(graph)?;
        self.trace_uses(graph);
        self.place_textures(graph, transient_attachments);
        self.plan_attachments(graph);
        Ok(())
    }

    fn reset(&mut self, graph: Decls<'_>) {
        let plan = &mut self.plan;
        plan.order.clear();
        plan.steps.clear();
        plan.attachments.clear();
        plan.placements.clear();
        plan.placements
            .resize(graph.resources.len(), Placement::default());
        self.cycle.clear();
        self.resources.clear();
        self.resources
            .resize(graph.resources.len(), ResourceState::default());
        self.passes.clear();
        self.passes.resize(graph.passes.len(), PassState::default());
        self.targets.clear();
        self.reads.clear();
        self.stores.clear();
        self.writers.clear();
        self.edges.clear();
        self.first_edge.clear();
        self.step.kind = None;
        self.surfaces.clear();
        self.busy_until.clear();
        self.textures.clear();
    }

    /// Finds the creator of every resource, over every declared pass whether it runs or not, and
    /// fails when a resource has two.
    fn find_creators(&mut self, graph: Decls<'_>) -> Result<(), GraphError> {
        for (state, decl) in self.resources.iter_mut().zip(graph.resources) {
            let (kind, life, target, size) = match decl.source {
                Source::Passes => continue,
                Source::Kept { target, size } => (Kind::Texture, Life::Kept, target, size),
                Source::Buffer => (Kind::Buffer, Life::Outside, Target::CANVAS, Size::Full),
                Source::Canvas => (Kind::Texture, Life::Outside, Target::CANVAS, Size::Canvas),
            };
            *state = ResourceState {
                kind,
                life,
                creator: GRAPH,
                target,
                size,
                ..ResourceState::default()
            };
        }
        for (index, pass) in graph.passes.iter().enumerate() {
            for access in graph.uses(index) {
                let kind = match access.mode {
                    Mode::CreateTexture(_) => Kind::Texture,
                    Mode::CreateBuffer => Kind::Buffer,
                    _ => continue,
                };
                let state = &mut self.resources[access.resource as usize];
                if state.creator != NONE {
                    return Err(GraphError::TwoCreators {
                        resource: ResourceId(access.resource),
                        pass: PassId(index as u16),
                    });
                }
                state.kind = kind;
                state.creator = index as u16;
                state.size = pass.size;
                if let Mode::CreateTexture(target) = access.mode {
                    state.target = target;
                }
            }
        }
        Ok(())
    }

    /// Checks that every resource a running pass uses exists, and that the targets of each pass
    /// that draws fit one render pass. Lists what each pass that draws attaches, reads and
    /// writes, for the steps it may share.
    fn check_passes(&mut self, graph: Decls<'_>) -> Result<(), GraphError> {
        for (index, pass) in graph.running() {
            let id = PassId(index as u16);
            let targets = self.targets.len() as u32;
            let reads = self.reads.len() as u32;
            let stores = self.stores.len() as u32;
            let mut samples = 0;
            let mut depth = false;
            for access in graph.uses(index) {
                let resource = ResourceId(access.resource);
                let state = &self.resources[resource.index()];
                let mismatch = |reason| GraphError::TargetMismatch {
                    pass: id,
                    resource: Some(resource),
                    reason,
                };
                if state.kind == Kind::Unknown {
                    return Err(GraphError::MissingInput { pass: id, resource });
                }
                // Compute passes share a compute pass with any other, so only passes that draw
                // need their reads and writes listed. A resolve pass lists its own below.
                if !pass.kind.draws() || pass.kind == PassKind::Resolve {
                    continue;
                }
                if !access.mode.writes() {
                    self.reads.push(access.resource);
                    continue;
                }
                if state.kind == Kind::Buffer {
                    self.stores.push(access.resource);
                    continue;
                }
                if state.size != pass.size {
                    return Err(mismatch(Mismatch::Size));
                }
                let layer = match access.layer {
                    Some(layer) if layer < state.target.layers => layer,
                    Some(_) => return Err(mismatch(Mismatch::Layer)),
                    None if state.target.layers == 1 => 0,
                    None => return Err(mismatch(Mismatch::AllLayers)),
                };
                if samples != 0 && samples != state.target.samples {
                    return Err(mismatch(Mismatch::Samples));
                }
                samples = state.target.samples;
                if state.target.depth {
                    if depth {
                        return Err(mismatch(Mismatch::Depth));
                    }
                    depth = true;
                }
                self.targets.push(Attached {
                    resource: access.resource,
                    layer,
                    depth: state.target.depth,
                });
            }
            if pass.kind == PassKind::Resolve {
                samples = self.check_resolve(graph, index)?;
            }
            if pass.kind.draws() && self.targets.len() as u32 == targets {
                return Err(GraphError::TargetMismatch {
                    pass: id,
                    resource: None,
                    reason: Mismatch::NoTarget,
                });
            }
            self.passes[index] = PassState {
                samples,
                targets: (targets, self.targets.len() as u32),
                reads: (reads, self.reads.len() as u32),
                stores: (stores, self.stores.len() as u32),
                ..PassState::default()
            };
        }
        Ok(())
    }

    /// Checks a running resolve pass: it writes the canvas and nothing else, and reads one
    /// multisampled color target of one layer, in the canvas's format, at the pass's size, which
    /// is the canvas's. No other running pass may read the target, since its color attachment
    /// resolves into one place. The target becomes the pass's attachment, so the pass joins the
    /// render pass that draws it. Returns the target's sample count.
    fn check_resolve(&mut self, graph: Decls<'_>, index: usize) -> Result<u32, GraphError> {
        let pass = &graph.passes[index];
        let mismatch = |resource: Option<ResourceId>| GraphError::TargetMismatch {
            pass: PassId(index as u16),
            resource,
            reason: Mismatch::Resolve,
        };
        let mut source = None;
        let mut into_canvas = false;
        for access in graph.uses(index) {
            let resource = ResourceId(access.resource);
            match access.mode {
                Mode::Read if source.is_none() => source = Some(resource),
                Mode::Write if resource.index() == 0 => into_canvas = true,
                _ => return Err(mismatch(Some(resource))),
            }
        }
        let Some(source) = source else {
            return Err(mismatch(None));
        };
        let state = &self.resources[source.index()];
        let target = state.target;
        let canvas_sized = matches!(pass.size, Size::Full | Size::Canvas);
        let read_elsewhere = graph.running_uses().any(|(user, access)| {
            user != index && access.resource == source.0 && !access.mode.writes()
        });
        if !into_canvas
            || state.kind != Kind::Texture
            || !target.resolves()
            || target.layers != 1
            || target.format != Target::CANVAS.format
            || state.size != pass.size
            || !canvas_sized
            || read_elsewhere
        {
            return Err(mismatch(Some(source)));
        }
        self.targets.push(Attached {
            resource: source.0,
            layer: 0,
            depth: false,
        });
        Ok(target.samples)
    }

    /// Lists each resource's running writers and the pairs of passes that must run in order:
    /// each writer after the one declared before it, and each reader after the last writer.
    /// Fails when a pass reads a frame resource that no running pass writes.
    fn link(&mut self, graph: Decls<'_>) -> Result<(), GraphError> {
        let writes = |&(_, access): &(usize, &Access)| access.mode.writes();
        for (_, access) in graph.running_uses().filter(writes) {
            self.resources[access.resource as usize].writers.1 += 1;
        }
        let mut start = 0;
        for state in &mut self.resources {
            let count = state.writers.1;
            state.writers = (start, 0);
            start += count;
        }
        self.writers.resize(start as usize, 0);
        for (index, access) in graph.running_uses().filter(writes) {
            let state = &mut self.resources[access.resource as usize];
            self.writers[(state.writers.0 + state.writers.1) as usize] = index as u16;
            state.writers.1 += 1;
        }
        for state in &self.resources {
            let (start, count) = state.writers;
            for pair in self.writers[start as usize..(start + count) as usize].windows(2) {
                self.edges.push((pair[0], pair[1]));
            }
        }
        for (index, access) in graph.running_uses().filter(|use_| !writes(use_)) {
            let state = &self.resources[access.resource as usize];
            let (start, count) = state.writers;
            if count == 0 {
                if state.life == Life::Frame {
                    return Err(GraphError::MissingInput {
                        pass: PassId(index as u16),
                        resource: ResourceId(access.resource),
                    });
                }
                continue;
            }
            let last = self.writers[(start + count - 1) as usize];
            self.edges.push((last, index as u16));
        }
        sort_short(&mut self.edges, |&edge| edge);
        self.first_edge.resize(graph.passes.len() + 1, 0);
        let mut edge = 0;
        for (pass, first) in self.first_edge.iter_mut().enumerate() {
            while edge < self.edges.len() && (self.edges[edge].0 as usize) < pass {
                edge += 1;
            }
            *first = edge as u32;
        }
        for &(_, after) in &self.edges {
            self.passes[after as usize].waiting += 1;
        }
        Ok(())
    }

    /// Orders the running passes: each runs once the passes it runs after have run. Among the
    /// passes free to run, the first declared one that can join the open step goes next. Else the
    /// first declared compute pass goes: compute passes never share a render pass, so running
    /// them early keeps later render passes whole. Else the first declared pass goes. Groups the
    /// order into steps as it goes.
    fn schedule(&mut self, graph: Decls<'_>) -> Result<(), GraphError> {
        let running = graph.running().count();
        while self.plan.order.len() < running {
            let mut joiner = None;
            let mut compute = None;
            let mut first = None;
            for (index, pass) in graph.running() {
                let state = &self.passes[index];
                if state.scheduled || state.waiting > 0 {
                    continue;
                }
                if self.can_join(graph, index) {
                    joiner = Some(index);
                    break;
                }
                if !pass.kind.draws() {
                    compute = compute.or(Some(index));
                }
                first = first.or(Some(index));
            }
            let Some(index) = joiner.or(compute).or(first) else {
                return Err(self.find_cycle(graph));
            };
            if joiner.is_some() {
                self.join_step(index);
            } else {
                self.close_step();
                self.open_step(graph, index);
            }
            self.plan.order.push(PassId(index as u16));
            self.passes[index].scheduled = true;
            let edges = self.first_edge[index] as usize..self.first_edge[index + 1] as usize;
            for &(_, after) in &self.edges[edges] {
                self.passes[after as usize].waiting -= 1;
            }
        }
        self.close_step();
        Ok(())
    }

    fn pass_targets(&self, index: usize) -> &[Attached] {
        let (start, end) = self.passes[index].targets;
        &self.targets[start as usize..end as usize]
    }

    fn pass_reads(&self, index: usize) -> &[u16] {
        let (start, end) = self.passes[index].reads;
        &self.reads[start as usize..end as usize]
    }

    fn pass_stores(&self, index: usize) -> &[u16] {
        let (start, end) = self.passes[index].stores;
        &self.stores[start as usize..end as usize]
    }

    /// True when the pass can join the open step. A compute pass joins a compute step. A pass
    /// that draws joins a render step at its size and sample count when one of their target sets
    /// holds the other, and when nothing that one of them reads is attached in the joined step or
    /// written by the other.
    fn can_join(&self, graph: Decls<'_>, index: usize) -> bool {
        let pass = &graph.passes[index];
        match self.step.kind {
            None => false,
            Some(StepKind::Compute) => !pass.kind.draws(),
            Some(StepKind::Render { size, samples }) => {
                if !pass.kind.draws() || pass.size != size || self.passes[index].samples != samples
                {
                    return false;
                }
                let mine = self.pass_targets(index);
                let open = self.step.targets.as_slice();
                let inside = mine.iter().all(|t| open.contains(t));
                if !inside && !open.iter().all(|t| mine.contains(t)) {
                    return false;
                }
                let joined = if inside { open } else { mine };
                let attached = |resource: &u16| joined.iter().any(|t| t.resource == *resource);
                let stores = self.pass_stores(index);
                !self
                    .pass_reads(index)
                    .iter()
                    .any(|r| attached(r) || self.step.stores.contains(r))
                    && !self
                        .step
                        .reads
                        .iter()
                        .any(|r| attached(r) || stores.contains(r))
            }
        }
    }

    fn open_step(&mut self, graph: Decls<'_>, index: usize) {
        let pass = &graph.passes[index];
        self.step.kind = Some(if pass.kind.draws() {
            StepKind::Render {
                size: pass.size,
                samples: self.passes[index].samples,
            }
        } else {
            StepKind::Compute
        });
        self.step.first_pass = self.plan.order.len();
        self.step.targets.clear();
        self.step.reads.clear();
        self.step.stores.clear();
        self.join_step(index);
    }

    /// Adds a pass to the open step: its targets become the step's when they hold the step's, and
    /// its reads and writes join the step's.
    fn join_step(&mut self, index: usize) {
        let state = self.passes[index];
        let mine = &self.targets[state.targets.0 as usize..state.targets.1 as usize];
        if !mine.iter().all(|t| self.step.targets.contains(t)) {
            self.step.targets.clear();
            self.step.targets.extend_from_slice(mine);
        }
        self.step
            .reads
            .extend_from_slice(&self.reads[state.reads.0 as usize..state.reads.1 as usize]);
        self.step
            .stores
            .extend_from_slice(&self.stores[state.stores.0 as usize..state.stores.1 as usize]);
    }

    /// Closes the open step and adds it to the plan, with its color attachments first.
    fn close_step(&mut self) {
        let Some(kind) = self.step.kind.take() else {
            return;
        };
        let first = self.plan.attachments.len() as u16;
        for depth in [false, true] {
            for target in self.step.targets.iter().filter(|t| t.depth == depth) {
                self.plan.attachments.push(Attachment {
                    resource: ResourceId(target.resource),
                    layer: target.layer,
                    depth,
                    format: self.resources[target.resource as usize].target.format,
                    texture: Surface::Canvas,
                    resolve: None,
                    load: LoadOp::Clear,
                    store: StoreOp::Discard,
                });
            }
        }
        self.plan.steps.push(Step {
            kind,
            passes: (self.step.first_pass as u16, self.plan.order.len() as u16),
            attachments: (first, self.plan.attachments.len() as u16),
        });
    }

    /// Finds a cycle among the passes that scheduling could not place, each of which waits for
    /// another of them. Walking from one pass to a pass it waits for must come back to a pass it
    /// passed, and the passes since then form a cycle.
    fn find_cycle(&mut self, graph: Decls<'_>) -> GraphError {
        let passes = &self.passes;
        let left = |index: usize| graph.passes[index].enabled && !passes[index].scheduled;
        let mut at = (0..graph.passes.len()).find(|&index| left(index));
        self.cycle.clear();
        while let Some(pass) = at {
            if let Some(seen) = self.cycle.iter().position(|p| p.index() == pass) {
                self.cycle.drain(..seen);
                break;
            }
            self.cycle.push(PassId(pass as u16));
            at = self
                .edges
                .iter()
                .find(|&&(before, after)| after as usize == pass && left(before as usize))
                .map(|&(before, _)| before as usize);
        }
        // The walk went from each pass to one it runs after, so the cycle runs the other way.
        self.cycle.reverse();
        if let Some(first) = self
            .cycle
            .iter()
            .enumerate()
            .min_by_key(|&(_, pass)| *pass)
            .map(|(place, _)| place)
        {
            self.cycle.rotate_left(first);
        }
        let first = self.cycle.first().copied().unwrap_or(PassId(0));
        let second = self.cycle.get(1).copied().unwrap_or(first);
        GraphError::Cycle { first, second }
    }

    /// Records the steps in which each texture is drawn into, sampled and written as storage. A
    /// resolve pass's target counts as drawn into, since the step attaches it.
    fn trace_uses(&mut self, graph: Decls<'_>) {
        for (index, step) in self.plan.steps.iter().enumerate() {
            let at = index as u16;
            let draws = matches!(step.kind, StepKind::Render { .. });
            for pass in &self.plan.order[step.passes.0 as usize..step.passes.1 as usize] {
                let resolves = graph.resolves(pass.index());
                for access in graph.uses(pass.index()) {
                    let state = &mut self.resources[access.resource as usize];
                    if state.kind != Kind::Texture {
                        continue;
                    }
                    state.uses.add(at);
                    if !access.mode.writes() && !resolves {
                        state.sampled.add(at);
                    } else if draws {
                        if state.attached.last != at {
                            state.attach_steps += 1;
                        }
                        state.attached.add(at);
                    } else {
                        state.storage.add(at);
                    }
                }
            }
        }
    }

    /// Lists the textures the plan needs and places each target in one: kept targets in textures
    /// of their own, first, and frame targets in textures they share when their steps do not
    /// overlap. Changes the plan's texture list, and its memory generation, only when the list
    /// differs.
    fn place_textures(&mut self, graph: Decls<'_>, transient_attachments: bool) {
        for (index, state) in self.resources.iter().enumerate() {
            match (state.life, state.kind) {
                (Life::Kept, Kind::Texture) => {
                    let (usage, sampled) = kept_usage(graph, index as u16, state.target);
                    if usage == 0 {
                        continue;
                    }
                    let own = self.textures.len() as u16;
                    self.textures.push(PlannedTexture {
                        target: state.target,
                        size: state.size,
                        usage,
                    });
                    self.busy_until.push(NONE);
                    let placement = &mut self.plan.placements[index];
                    placement.texture = Some(Surface::Texture(own));
                    placement.sampled = placement.texture;
                    if state.target.resolves() && sampled {
                        placement.sampled = Some(Surface::Texture(own + 1));
                        self.textures.push(resolved(state.target, state.size));
                        self.busy_until.push(NONE);
                    }
                }
                (Life::Outside, Kind::Texture) => {
                    self.plan.placements[index] = Placement {
                        texture: Some(Surface::Canvas),
                        sampled: Some(Surface::Canvas),
                    };
                }
                (Life::Frame, Kind::Texture) if !state.uses.is_empty() => {
                    let texture = frame_texture(state, transient_attachments);
                    let resolves = state.target.resolves() && !state.attached.is_empty();
                    self.surfaces.push(SurfaceUse {
                        span: if resolves { state.attached } else { state.uses },
                        resource: index as u16,
                        resolved: false,
                        texture,
                    });
                    if resolves && !state.sampled.is_empty() {
                        // Each layer resolves after the last render pass that draws it. With one
                        // layer that is the last to draw the target; for an array, the first
                        // render pass that draws any layer is a safe start.
                        let first_resolve = if state.target.layers == 1 {
                            state.attached.last
                        } else {
                            state.attached.first
                        };
                        self.surfaces.push(SurfaceUse {
                            span: Span {
                                first: first_resolve,
                                last: state.sampled.last,
                            },
                            resource: index as u16,
                            resolved: true,
                            texture: resolved(state.target, state.size),
                        });
                    }
                }
                _ => {}
            }
        }
        sort_short(&mut self.surfaces, |u| {
            (u.span.first, u.resource, u.resolved)
        });
        let kept = self.textures.len();
        for surface in &self.surfaces {
            let shared = (kept..self.textures.len()).find(|&slot| {
                self.textures[slot] == surface.texture && self.busy_until[slot] < surface.span.first
            });
            let slot = match shared {
                Some(slot) => {
                    self.busy_until[slot] = surface.span.last;
                    slot
                }
                None => {
                    self.textures.push(surface.texture);
                    self.busy_until.push(surface.span.last);
                    self.textures.len() - 1
                }
            };
            let placed = Some(Surface::Texture(slot as u16));
            let resolves = self.resources[surface.resource as usize].target.resolves();
            let placement = &mut self.plan.placements[surface.resource as usize];
            if surface.resolved {
                placement.sampled = placed;
            } else {
                placement.texture = placed;
                if !resolves {
                    placement.sampled = placed;
                }
            }
        }
        if self.textures != self.plan.textures {
            // A copy rather than a swap, so both lists keep the room they grew.
            self.plan.textures.clear();
            self.plan.textures.extend_from_slice(&self.textures);
            self.plan.memory_generation = self.plan.memory_generation.wrapping_add(1);
        }
    }

    /// Fills in each attachment's texture, resolve target, and load and store operations.
    fn plan_attachments(&mut self, graph: Decls<'_>) {
        for index in 0..self.plan.steps.len() {
            let step = self.plan.steps[index];
            let at = index as u16;
            for place in step.attachments.0 as usize..step.attachments.1 as usize {
                let attachment = self.plan.attachments[place];
                let resource = attachment.resource.0;
                let state = self.resources[resource as usize];
                let placement = self.plan.placements[resource as usize];
                let kept = state.life != Life::Frame;
                let written = self.attached_in(resource, attachment.layer, 0..index)
                    || state.storage.first < at;
                let load = if written
                    || (kept && self.starts_by_keeping(graph, &step, resource, attachment.layer))
                {
                    LoadOp::Load
                } else {
                    LoadOp::Clear
                };
                // A multisampled color target is only drawn into; passes sample its resolved
                // texture. Each layer resolves at the end of the last render pass that draws it.
                let drawn_later =
                    self.attached_in(resource, attachment.layer, index + 1..self.plan.steps.len());
                let later = if state.target.resolves() {
                    drawn_later
                } else {
                    state.uses.last > at
                };
                let resolve = if !state.target.resolves() || drawn_later {
                    None
                } else if !state.sampled.is_empty() {
                    placement.sampled
                } else if resolved_in(graph, self.plan.passes(&step), resource) {
                    Some(Surface::Canvas)
                } else {
                    None
                };
                // Every attached texture was placed, and the canvas places itself.
                debug_assert!(placement.texture.is_some(), "an attachment has no texture");
                self.plan.attachments[place] = Attachment {
                    texture: placement.texture.unwrap_or(Surface::Canvas),
                    resolve,
                    load,
                    store: if kept || later {
                        StoreOp::Store
                    } else {
                        StoreOp::Discard
                    },
                    ..attachment
                };
            }
        }
    }

    /// True when a step in `steps` draws into the layer of the target, or, for the canvas,
    /// resolves a target into it.
    fn attached_in(&self, resource: u16, layer: u32, steps: Range<usize>) -> bool {
        self.plan.steps[steps].iter().any(|step| {
            self.plan.attachments[step.attachments.0 as usize..step.attachments.1 as usize]
                .iter()
                .any(|a| {
                    (a.resource.0 == resource && a.layer == layer)
                        || (resource == 0 && a.resolve == Some(Surface::Canvas))
                })
        })
    }

    /// True when the step's first pass that attaches the layer of the target keeps what it holds:
    /// it draws into part of it, or it resolves it.
    fn starts_by_keeping(&self, graph: Decls<'_>, step: &Step, resource: u16, layer: u32) -> bool {
        self.plan
            .passes(step)
            .iter()
            .find_map(|pass| {
                let resolves = graph.resolves(pass.index());
                graph
                    .uses(pass.index())
                    .iter()
                    .find(|a| {
                        a.resource == resource
                            && (a.mode.writes() || resolves)
                            && a.layer.unwrap_or(0) == layer
                    })
                    .map(|a| resolves || a.mode == Mode::WritePart)
            })
            .unwrap_or(false)
    }
}

/// Sorts a list by `key` in place, keeping the order of items with equal keys. The lists a graph
/// sorts hold tens of items and sort only when it compiles, so an insertion sort serves, and it
/// compiles to far less WebAssembly than the standard library's sorts.
fn sort_short<T: Copy, K: Ord>(items: &mut [T], key: impl Fn(&T) -> K) {
    for next in 1..items.len() {
        let item = items[next];
        let mut at = next;
        while at > 0 && key(&items[at - 1]) > key(&item) {
            items[at] = items[at - 1];
            at -= 1;
        }
        items[at] = item;
    }
}

/// True when one of `passes` is a resolve pass that reads the target, which then resolves into the
/// canvas.
fn resolved_in(graph: Decls<'_>, passes: &[PassId], resource: u16) -> bool {
    passes.iter().any(|pass| {
        graph.resolves(pass.index())
            && graph
                .uses(pass.index())
                .iter()
                .any(|a| a.resource == resource && !a.mode.writes())
    })
}

/// The usage flags of a target that passes draw into, sample, or write as storage. Passes sample a
/// multisampled color target through its resolved texture, so it needs no sampling usage itself.
fn usage_of(target: Target, drawn: bool, sampled: bool, storage: bool) -> u32 {
    let mut usage = 0;
    if drawn {
        usage |= texture_usage::RENDER_ATTACHMENT;
    }
    if sampled && !target.resolves() {
        usage |= texture_usage::TEXTURE_BINDING;
    }
    if storage {
        usage |= texture_usage::STORAGE_BINDING;
    }
    usage
}

/// The usage of a kept target, from every declared pass whether it runs or not, so switching
/// passes on and off never changes its texture. Also says whether a pass samples it. A resolve
/// pass attaches the target it reads.
fn kept_usage(graph: Decls<'_>, resource: u16, target: Target) -> (u32, bool) {
    let (mut drawn, mut sampled, mut storage) = (false, false, false);
    for (index, pass) in graph.passes.iter().enumerate() {
        for access in graph.uses(index).iter().filter(|a| a.resource == resource) {
            match (access.mode.writes(), pass.kind) {
                (false, PassKind::Resolve) => drawn = true,
                (false, _) => sampled = true,
                (true, PassKind::Compute) => storage = true,
                (true, _) => drawn = true,
            }
        }
    }
    (usage_of(target, drawn, sampled, storage), sampled)
}

/// The texture of a frame target, with the usage its uses in the frame need. A target that lives
/// within one render pass, and that the device can keep in tile memory, is transient.
fn frame_texture(state: &ResourceState, transient_attachments: bool) -> PlannedTexture {
    let target = state.target;
    let one_pass = state.attach_steps == 1
        && state.storage.is_empty()
        && (target.resolves() || state.sampled.is_empty());
    let mut usage = usage_of(
        target,
        state.attach_steps > 0,
        !state.sampled.is_empty(),
        !state.storage.is_empty(),
    );
    if transient_attachments && one_pass && target.layers == 1 {
        usage |= texture_usage::TRANSIENT_ATTACHMENT;
    }
    PlannedTexture {
        target,
        size: state.size,
        usage,
    }
}

/// The texture a multisampled color target resolves into, for the passes that sample it.
fn resolved(target: Target, size: Size) -> PlannedTexture {
    PlannedTexture {
        target: target.samples(1),
        size,
        usage: texture_usage::RENDER_ATTACHMENT | texture_usage::TEXTURE_BINDING,
    }
}
