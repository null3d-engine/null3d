//! The render graph: passes declared by the resources they read and write, compiled into the
//! order they run in, the render and compute passes the GPU runs, and the textures they use.
//!
//! Passes are declarations, not code. The graph checks them, orders them, lets neighbors share one
//! render pass and plans the memory of their targets before a frame draws. A frame builder then
//! records each pass's commands in the planned order, into the planned textures.
//!
//! # Resources
//!
//! A pass names each resource it uses. A resource is one of these:
//!
//! - A frame target: a texture that one pass creates ([`Pass::creates`]), at that pass's size. The
//!   first pass that writes it in a frame starts from a clear target, and it lasts until the frame
//!   ends.
//! - A kept target: a texture the graph declares with its own size ([`RenderGraph::keep`]). It
//!   holds its contents from frame to frame, as a shadow map whose cascades update in turn does.
//! - A buffer: a pass creates it each frame ([`Pass::creates_buffer`]), or it comes from outside
//!   the graph ([`RenderGraph::import_buffer`]). The graph orders passes by buffers but makes none.
//! - The canvas ([`CANVAS`]), which the graph never makes.
//!
//! # Order
//!
//! Passes that write one resource run in the order they were declared. A pass that reads a
//! resource runs after every pass that writes it, so it sees the resource as the frame leaves it.
//! A pass that reads a resource so far ([`Pass::reads_so_far`]) sees it as the passes declared
//! before it leave it instead: it runs after those writers and before the writers declared after
//! it, as a depth pyramid built between two passes that draw one depth target does.
//! Where these rules leave a choice, the next pass is the first declared one that can join the
//! open render or compute pass. Else it is the first declared compute pass, since compute passes
//! never share a render pass and running them early keeps later render passes whole. Else it is
//! the first declared pass.
//!
//! # Checks
//!
//! Compiling fails with an engine error code ([`GraphError`]) when a pass uses a resource that no
//! pass creates or reads one that no running pass writes (1502), when two passes create one
//! resource (1503), when the passes form a cycle (1504), and when one pass's targets cannot share
//! a render pass or a resolve pass cannot resolve its target into the canvas (1505). A pass that
//! is switched off counts as absent, but its declaration stays: a frame target whose creator is
//! off still exists, and the first running pass that writes it clears it.
//!
//! # Render passes
//!
//! Neighboring passes that draw at one size and sample count into the same targets, or into a
//! subset of them, share one render pass. They do not when one of them samples a target that the
//! render pass draws into, or reads a buffer that another of them writes, since WebGPU forbids
//! both within one render pass. Tile-based GPUs then keep the targets on chip from one pass to the
//! next. A pass that joins a render pass draws with all of its attachments: its pipelines take the
//! render pass's formats and mask the targets it does not write. Neighboring compute passes share
//! one compute pass, as each dispatch sees what the ones before it wrote.
//!
//! # Memory
//!
//! Frame targets with the same format, size, sample count, layer count and usage share one texture
//! when their lifetimes, counted in render and compute passes, do not overlap. Relative sizes are
//! fractions of the canvas, the largest render size, so a lower render scale draws into a corner of
//! the same textures and never needs new ones. Kept targets have textures of their own, first in
//! the list, so switching passes on and off never moves them.
//!
//! The graph works out each texture's usage from how the passes use it, and each attachment's load
//! and store operations. A target is cleared at its first write in the frame and loaded after
//! that, and a render pass stores it only when a later pass or frame needs it. When a later pass
//! samples a multisampled color target, each of the target's layers is resolved at the end of the
//! last render pass that draws into that layer. A resolve pass ([`PassKind::Resolve`]) resolves
//! its target into the canvas there instead.
//! A frame target that lives within one render pass gets the transient attachment usage where the
//! device supports it, so it can stay in tile memory.
//!
//! # Compiling
//!
//! Declaring passes, switching them on and off and changing the transient attachment flag mark the
//! graph changed. [`RenderGraph::compile`] then compiles once for the whole batch of changes, and
//! does nothing while nothing changes. Compiling reuses its lists, so it allocates only when a
//! compile needs more room in one of them than every earlier compile did. With every pass on, the
//! first compile usually needs the most, and switching passes then allocates nothing.

use std::borrow::Cow;

use null3d_gpu::drawlist::format;

mod compile;
mod dot;
mod error;

pub use compile::{Attachment, LoadOp, Plan, PlannedTexture, Step, StepKind, StoreOp, Surface};
pub use error::{GraphError, Mismatch};

/// The name of the canvas, which every graph declares. Passes draw into it, and none samples it.
pub const CANVAS: &str = "canvas";

/// A layer mask that selects every layer, and the mask of a pass that sets none.
pub use null3d_core::layers::ALL_LAYERS;

/// The most passes one graph holds. Indices are 16 bits, and the compiler keeps the two highest
/// values as markers.
pub const MAX_PASSES: usize = u16::MAX as usize - 1;

/// The most resources one graph holds, the canvas included.
pub const MAX_RESOURCES: usize = u16::MAX as usize + 1;

/// A pass, by its place in the order of declaration.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct PassId(u16);

impl PassId {
    /// The pass's place in the order of declaration, from 0.
    pub const fn index(self) -> usize {
        self.0 as usize
    }
}

/// A resource, by the order in which the graph first met its name. The canvas is resource 0.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ResourceId(u16);

impl ResourceId {
    /// The resource's place in the order the graph first met the names, from 0.
    pub const fn index(self) -> usize {
        self.0 as usize
    }
}

/// What a pass does, which decides how it uses the textures it writes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PassKind {
    /// Draws scene objects from a camera's view into color and depth targets.
    Scene,
    /// Draws shadow casters from a light's view into a depth target.
    Shadow,
    /// Draws one triangle over its whole target, as the final pass does.
    Fullscreen,
    /// Runs compute shaders, which write buffers and storage textures. Only WebGPU has them.
    Compute,
    /// Resolves a multisampled color target into the canvas and draws nothing. It reads the
    /// target, which has the canvas's format and one layer, and writes the canvas. It joins the
    /// render pass that last draws the target, whose color attachment then resolves into the
    /// canvas, so it costs no pass of its own. It stands in for a final pass that would only copy
    /// the target. The whole target reaches the canvas, so a render scale below 1 needs a pass
    /// that scales the image up instead.
    Resolve,
}

impl PassKind {
    /// True for passes that run inside a render pass: every kind but compute.
    pub const fn draws(self) -> bool {
        !matches!(self, Self::Compute)
    }

    /// The kind's name in the text dump.
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::Scene => "scene",
            Self::Shadow => "shadow",
            Self::Fullscreen => "fullscreen",
            Self::Compute => "compute",
            Self::Resolve => "resolve",
        }
    }
}

/// The size a pass draws at, which the targets it creates take.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Size {
    /// The render size: the canvas at the render scale.
    Full,
    /// The render size halved this many times each way, rounding up at each halving, from 1 up:
    /// [`Size::HALF`] and [`Size::QUARTER`] are 1 and 2. A chain of effect passes, such as
    /// bloom's, takes one more halving at each step.
    Halved(u8),
    /// The whole canvas at any render scale, as the final pass draws it.
    Canvas,
    /// A fixed size in pixels, such as a shadow map's.
    Fixed {
        /// Width in pixels.
        width: u32,
        /// Height in pixels.
        height: u32,
    },
}

impl Size {
    /// Half the render size each way, rounded up.
    pub const HALF: Self = Self::Halved(1);
    /// A quarter of the render size each way, rounded up.
    pub const QUARTER: Self = Self::Halved(2);

    /// The size of a texture of this size for a canvas of `canvas` device pixels. Relative sizes
    /// are made for the whole canvas, the largest render size, so no render scale needs a new
    /// texture. Every size is at least one pixel each way.
    pub fn extent(self, canvas: (u32, u32)) -> (u32, u32) {
        let canvas = (canvas.0.max(1), canvas.1.max(1));
        match self {
            Self::Full | Self::Canvas => canvas,
            Self::Halved(times) => Self::halve(canvas, times),
            Self::Fixed { width, height } => (width.max(1), height.max(1)),
        }
    }

    /// The part of such a texture that a pass draws into at render scale `scale`: a top-left
    /// corner for relative sizes, and the whole texture otherwise.
    pub fn viewport(self, canvas: (u32, u32), scale: RenderScale) -> (u32, u32) {
        let canvas = (canvas.0.max(1), canvas.1.max(1));
        let render = (scale.of(canvas.0), scale.of(canvas.1));
        match self {
            Self::Full => render,
            Self::Halved(times) => Self::halve(render, times),
            Self::Canvas | Self::Fixed { .. } => self.extent(canvas),
        }
    }

    /// A size halved `times` times, rounding up. Rounding up at each halving gives the same
    /// size as one division by the power of two, rounded up.
    fn halve((width, height): (u32, u32), times: u8) -> (u32, u32) {
        let by = 1u32 << times.min(31);
        (width.div_ceil(by), height.div_ceil(by))
    }

    /// The size's name in messages and the text dump.
    pub(crate) fn name(self) -> String {
        match self {
            Self::Full => "full size".into(),
            Self::Halved(1) => "half size".into(),
            Self::Halved(2) => "quarter size".into(),
            Self::Halved(times) => format!("1/{} size", 1u64 << times.min(63)),
            Self::Canvas => "canvas size".into(),
            Self::Fixed { width, height } => format!("{width} x {height}"),
        }
    }
}

/// The render scale: the part of the canvas's width and height that passes of a relative size
/// draw at, in thousandths, from 1 to 1000. Whole thousandths keep the render size exact: the
/// pixels at a scale are the same on every device and in every language that computes them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RenderScale(u32);

impl RenderScale {
    /// The whole canvas.
    pub const FULL: Self = Self(1000);

    /// The scale of `thousandths`, clamped to 1 to 1000.
    pub const fn from_thousandths(thousandths: u32) -> Self {
        Self(if thousandths < 1 {
            1
        } else if thousandths > 1000 {
            1000
        } else {
            thousandths
        })
    }

    /// The scale in thousandths.
    pub const fn thousandths(self) -> u32 {
        self.0
    }

    /// `pixels` at this scale, rounded up, from 1 to `pixels`.
    pub const fn of(self, pixels: u32) -> u32 {
        let scaled = (pixels as u64 * self.0 as u64).div_ceil(1000) as u32;
        if scaled < 1 { 1 } else { scaled }
    }
}

impl Default for RenderScale {
    fn default() -> Self {
        Self::FULL
    }
}

/// A texture's format and shape: everything but its size, which comes from the pass that creates
/// it or from its declaration.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Target {
    /// The format, as a code from [`null3d_gpu::drawlist::format`].
    pub format: u32,
    /// True for a depth format: a pass that writes the target uses it as its depth attachment.
    pub depth: bool,
    /// MSAA samples. A multisampled color target that a pass samples is resolved into a texture
    /// with one sample, which the pass reads.
    pub samples: u32,
    /// Array layers. A pass draws into one layer at a time.
    pub layers: u32,
    /// True when shaders read the target as an array, even one of one layer, as a shadow map whose
    /// cascade count changes is read.
    pub array: bool,
}

impl Target {
    /// A color target with one sample and one layer.
    pub const fn color(format: u32) -> Self {
        Self {
            format,
            depth: false,
            samples: 1,
            layers: 1,
            array: false,
        }
    }

    /// A depth target with one sample and one layer.
    pub const fn depth(format: u32) -> Self {
        Self {
            format,
            depth: true,
            samples: 1,
            layers: 1,
            array: false,
        }
    }

    /// The same target with `samples` MSAA samples.
    pub const fn samples(self, samples: u32) -> Self {
        Self { samples, ..self }
    }

    /// The same target with `layers` array layers.
    pub const fn layers(self, layers: u32) -> Self {
        Self { layers, ..self }
    }

    /// The same target, which shaders read as an array whatever its layer count.
    pub const fn array(self) -> Self {
        Self {
            array: true,
            ..self
        }
    }

    /// True when shaders read the target as an array, and passes draw into a view of one layer.
    pub const fn is_array(self) -> bool {
        self.array || self.layers > 1
    }

    /// True for a multisampled color target, which passes that sample it read through a resolve.
    pub(crate) const fn resolves(self) -> bool {
        self.samples > 1 && !self.depth
    }

    /// The canvas's shape: the canvas's preferred format, one sample, one layer.
    pub(crate) const CANVAS: Self = Self::color(format::CANVAS);
}

/// How a pass uses one resource.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Mode {
    /// Samples a texture, or reads a buffer.
    Read,
    /// Samples a texture, or reads a buffer, as the passes declared before it leave it.
    ReadSoFar,
    /// Draws into a whole target or one of its layers, or writes a buffer.
    Write,
    /// Draws into part of a target, so the rest keeps what it held.
    WritePart,
    /// Creates a frame target and draws into it.
    CreateTexture(Target),
    /// Creates a buffer and fills it.
    CreateBuffer,
}

impl Mode {
    pub(crate) const fn writes(self) -> bool {
        !matches!(self, Self::Read | Self::ReadSoFar)
    }

    /// How much the use does, to keep the larger when a pass names one resource twice.
    const fn rank(self) -> u8 {
        match self {
            Self::Read | Self::ReadSoFar => 0,
            Self::Write => 1,
            Self::WritePart => 2,
            Self::CreateTexture(_) | Self::CreateBuffer => 3,
        }
    }
}

/// One use of a resource by name, as a [`Pass`] declares it.
#[derive(Clone, Debug)]
struct Use {
    resource: Cow<'static, str>,
    mode: Mode,
    layer: Option<u32>,
}

/// A pass's declaration: its name, kind, size and layer mask, and the resources it uses by name.
/// Add it to a graph with [`RenderGraph::add_pass`].
#[derive(Clone, Debug)]
pub struct Pass {
    name: Cow<'static, str>,
    kind: PassKind,
    size: Size,
    layers: u32,
    uses: Vec<Use>,
}

impl Pass {
    /// A pass of `kind` that draws at the full render size, with every layer in its mask and no
    /// resources yet.
    pub fn new(name: impl Into<Cow<'static, str>>, kind: PassKind) -> Self {
        Self {
            name: name.into(),
            kind,
            size: Size::Full,
            layers: ALL_LAYERS,
            uses: Vec::new(),
        }
    }

    /// The same declaration under another name, as a second build of one pass needs.
    pub fn named(mut self, name: impl Into<Cow<'static, str>>) -> Self {
        self.name = name.into();
        self
    }

    /// The size the pass draws at, and that the targets it creates take.
    pub fn size(mut self, size: Size) -> Self {
        self.size = size;
        self
    }

    /// The layers of the objects the pass draws, as a mask: an object draws when its mask shares a
    /// bit with this one.
    pub fn layers(mut self, mask: u32) -> Self {
        self.layers = mask;
        self
    }

    /// Creates a frame target at the pass's size and draws into it. A pass that draws into one
    /// layer of a new array target names the layer with [`Pass::writes_layer`] too.
    pub fn creates(self, name: impl Into<Cow<'static, str>>, target: Target) -> Self {
        self.with(name, Mode::CreateTexture(target), None)
    }

    /// Creates a buffer and fills it, every frame the pass runs.
    pub fn creates_buffer(self, name: impl Into<Cow<'static, str>>) -> Self {
        self.with(name, Mode::CreateBuffer, None)
    }

    /// Draws into a target that another pass creates or the graph keeps, or writes a buffer. The
    /// pass sees what the passes before it wrote.
    pub fn writes(self, name: impl Into<Cow<'static, str>>) -> Self {
        self.with(name, Mode::Write, None)
    }

    /// Draws into one layer of an array target.
    pub fn writes_layer(self, name: impl Into<Cow<'static, str>>, layer: u32) -> Self {
        self.with(name, Mode::Write, Some(layer))
    }

    /// Draws into part of a kept target, as a tile of a shadow atlas: the rest keeps what it held
    /// in earlier frames, so the pass loads the target even as its first writer in a frame.
    pub fn writes_part(self, name: impl Into<Cow<'static, str>>) -> Self {
        self.with(name, Mode::WritePart, None)
    }

    /// Samples a texture or reads a buffer, after every pass that writes it.
    pub fn reads(self, name: impl Into<Cow<'static, str>>) -> Self {
        self.with(name, Mode::Read, None)
    }

    /// Samples a texture or reads a buffer as the passes declared before this one leave it: after
    /// those that write it, and before those declared after this one that write it.
    pub fn reads_so_far(self, name: impl Into<Cow<'static, str>>) -> Self {
        self.with(name, Mode::ReadSoFar, None)
    }

    fn with(mut self, name: impl Into<Cow<'static, str>>, mode: Mode, layer: Option<u32>) -> Self {
        self.uses.push(Use {
            resource: name.into(),
            mode,
            layer,
        });
        self
    }
}

/// A declared pass, as the graph stores it.
#[derive(Debug)]
pub(crate) struct PassDecl {
    pub(crate) name: Cow<'static, str>,
    pub(crate) kind: PassKind,
    pub(crate) size: Size,
    pub(crate) layers: u32,
    pub(crate) enabled: bool,
    /// The pass's uses: a range of the graph's access list.
    pub(crate) accesses: (u32, u32),
}

/// One use of one resource by one pass, with the resource interned.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Access {
    pub(crate) resource: u16,
    pub(crate) mode: Mode,
    pub(crate) layer: Option<u32>,
}

/// Where a resource comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Source {
    /// A pass creates it, or nothing does yet.
    Passes,
    /// The graph keeps it between frames, with this shape and size.
    Kept { target: Target, size: Size },
    /// A buffer that comes from outside the graph.
    Buffer,
    /// The canvas.
    Canvas,
}

/// A resource the graph knows by name.
#[derive(Debug)]
pub(crate) struct ResourceDecl {
    pub(crate) name: Cow<'static, str>,
    pub(crate) source: Source,
}

/// The render graph: declared passes and resources, and the plan compiled from them. See the
/// module documentation for the rules it follows.
#[derive(Debug)]
pub struct RenderGraph {
    passes: Vec<PassDecl>,
    accesses: Vec<Access>,
    resources: Vec<ResourceDecl>,
    transient_attachments: bool,
    changed: bool,
    compiles: u32,
    status: Result<(), GraphError>,
    compiler: compile::Compiler,
}

impl Default for RenderGraph {
    fn default() -> Self {
        Self::new()
    }
}

impl RenderGraph {
    /// A graph with no passes, and the canvas as its only resource.
    pub fn new() -> Self {
        Self {
            passes: Vec::new(),
            accesses: Vec::new(),
            resources: vec![ResourceDecl {
                name: Cow::Borrowed(CANVAS),
                source: Source::Canvas,
            }],
            transient_attachments: false,
            changed: true,
            compiles: 0,
            status: Ok(()),
            compiler: compile::Compiler::default(),
        }
    }

    /// Forgets every pass and resource but the canvas, to declare the graph again, as a new quality
    /// preset needs. The graph keeps its memory for the new declarations.
    pub fn clear(&mut self) {
        self.passes.clear();
        self.accesses.clear();
        self.resources.truncate(1);
        self.changed = true;
    }

    /// Declares a kept target: a texture of `target`'s shape and `size` that holds its contents
    /// from frame to frame and never shares its memory. Declaring the name again replaces the
    /// shape and size.
    pub fn keep(
        &mut self,
        name: impl Into<Cow<'static, str>>,
        target: Target,
        size: Size,
    ) -> ResourceId {
        self.declare(name.into(), Source::Kept { target, size })
    }

    /// Declares a buffer that comes from outside the graph, such as one that the CPU fills. Passes
    /// may read it without a writer in the frame.
    pub fn import_buffer(&mut self, name: impl Into<Cow<'static, str>>) -> ResourceId {
        self.declare(name.into(), Source::Buffer)
    }

    /// The canvas.
    pub const fn canvas(&self) -> ResourceId {
        ResourceId(0)
    }

    /// Adds a pass, switched on. A pass that names one resource twice keeps the use that does
    /// more (creating, then drawing into part of it, then writing, then reading) and the layer
    /// that a use names, so a pass can create an array target and draw into one layer of it.
    pub fn add_pass(&mut self, pass: Pass) -> PassId {
        let start = self.accesses.len();
        for used in pass.uses {
            let resource = self.intern(used.resource);
            match self.accesses[start..]
                .iter_mut()
                .find(|a| a.resource == resource)
            {
                Some(earlier) => {
                    if used.mode.rank() > earlier.mode.rank() {
                        earlier.mode = used.mode;
                    }
                    earlier.layer = used.layer.or(earlier.layer);
                }
                None => self.accesses.push(Access {
                    resource,
                    mode: used.mode,
                    layer: used.layer,
                }),
            }
        }
        debug_assert!(
            self.passes.len() < MAX_PASSES,
            "a render graph holds at most {MAX_PASSES} passes"
        );
        let id = PassId(self.passes.len() as u16);
        self.passes.push(PassDecl {
            name: pass.name,
            kind: pass.kind,
            size: pass.size,
            layers: pass.layers,
            enabled: true,
            accesses: (start as u32, self.accesses.len() as u32),
        });
        self.changed = true;
        id
    }

    /// Switches a pass on or off. The graph compiles again only when the state changes.
    pub fn set_enabled(&mut self, pass: PassId, enabled: bool) {
        let decl = &mut self.passes[pass.index()];
        if decl.enabled != enabled {
            decl.enabled = enabled;
            self.changed = true;
        }
    }

    /// True when the pass is switched on.
    pub fn is_enabled(&self, pass: PassId) -> bool {
        self.passes[pass.index()].enabled
    }

    /// Sets the layers of the objects the pass draws. The plan does not depend on them, so the
    /// graph does not compile again.
    pub fn set_layers(&mut self, pass: PassId, mask: u32) {
        self.passes[pass.index()].layers = mask;
    }

    /// Says whether the device supports transient attachments, the render targets that may stay
    /// in tile memory. Without them the plan never asks for that usage.
    pub fn set_transient_attachments(&mut self, supported: bool) {
        if self.transient_attachments != supported {
            self.transient_attachments = supported;
            self.changed = true;
        }
    }

    /// Compiles the graph if it changed since the last compile, and returns true when it did. A
    /// graph that failed to compile fails again with the same error until it changes.
    pub fn compile(&mut self) -> Result<bool, GraphError> {
        if !self.changed {
            return self.status.map(|()| false);
        }
        self.changed = false;
        self.compiles = self.compiles.wrapping_add(1);
        self.status = self.compiler.run(
            &self.passes,
            &self.accesses,
            &self.resources,
            self.transient_attachments,
        );
        self.status.map(|()| true)
    }

    /// The plan of the last compile, or `None` when the graph changed since, or failed to compile.
    pub fn plan(&self) -> Option<&Plan> {
        match self.status {
            Ok(()) if !self.changed => Some(&self.compiler.plan),
            _ => None,
        }
    }

    /// How many times the graph has compiled.
    pub fn compiles(&self) -> u32 {
        self.compiles
    }

    /// The number of passes declared, switched on or off.
    pub fn pass_count(&self) -> usize {
        self.passes.len()
    }

    /// A declared pass by name.
    pub fn find_pass(&self, name: &str) -> Option<PassId> {
        self.passes
            .iter()
            .position(|p| p.name == name)
            .map(|index| PassId(index as u16))
    }

    /// A pass's name.
    pub fn pass_name(&self, pass: PassId) -> &str {
        &self.passes[pass.index()].name
    }

    /// A pass's kind.
    pub fn pass_kind(&self, pass: PassId) -> PassKind {
        self.passes[pass.index()].kind
    }

    /// The size a pass draws at.
    pub fn pass_size(&self, pass: PassId) -> Size {
        self.passes[pass.index()].size
    }

    /// The layers of the objects a pass draws.
    pub fn pass_layers(&self, pass: PassId) -> u32 {
        self.passes[pass.index()].layers
    }

    /// The number of resources the graph knows, the canvas included.
    pub fn resource_count(&self) -> usize {
        self.resources.len()
    }

    /// A resource by name.
    pub fn find_resource(&self, name: &str) -> Option<ResourceId> {
        self.resources
            .iter()
            .position(|r| r.name == name)
            .map(|index| ResourceId(index as u16))
    }

    /// A resource's name.
    pub fn resource_name(&self, resource: ResourceId) -> &str {
        &self.resources[resource.index()].name
    }

    /// The resource of a name, added as one that passes create when the graph does not know it.
    fn intern(&mut self, name: Cow<'static, str>) -> u16 {
        match self.resources.iter().position(|r| r.name == name) {
            Some(index) => index as u16,
            None => {
                debug_assert!(
                    self.resources.len() < MAX_RESOURCES,
                    "a render graph holds at most {MAX_RESOURCES} resources"
                );
                self.resources.push(ResourceDecl {
                    name,
                    source: Source::Passes,
                });
                (self.resources.len() - 1) as u16
            }
        }
    }

    /// Declares a resource that the graph makes or imports. The canvas keeps its own declaration.
    fn declare(&mut self, name: Cow<'static, str>, source: Source) -> ResourceId {
        let index = self.intern(name);
        debug_assert!(index != 0, "the canvas cannot be declared again");
        if index != 0 {
            self.resources[index as usize].source = source;
            self.changed = true;
        }
        ResourceId(index)
    }

    /// The accesses of a declared pass.
    fn accesses_of(&self, pass: usize) -> &[Access] {
        let (start, end) = self.passes[pass].accesses;
        &self.accesses[start as usize..end as usize]
    }

    /// The first declared pass that creates the resource, if a pass does.
    fn creator_of(&self, resource: ResourceId) -> Option<PassId> {
        (0..self.passes.len())
            .find(|&pass| {
                self.accesses_of(pass).iter().any(|a| {
                    a.resource == resource.0
                        && matches!(a.mode, Mode::CreateTexture(_) | Mode::CreateBuffer)
                })
            })
            .map(|pass| PassId(pass as u16))
    }

    /// True when a declared pass creates the resource, or the graph declares it itself.
    fn is_created(&self, resource: ResourceId) -> bool {
        self.resources[resource.index()].source != Source::Passes
            || self.creator_of(resource).is_some()
    }

    /// A texture's shape and size: from the graph's declaration, or from the first pass that
    /// creates it. `None` for a buffer, or a resource that nothing creates.
    fn shape_of(&self, resource: ResourceId) -> Option<(Target, Size)> {
        match self.resources[resource.index()].source {
            Source::Kept { target, size } => Some((target, size)),
            Source::Canvas => Some((Target::CANVAS, Size::Canvas)),
            Source::Buffer => None,
            Source::Passes => {
                let pass = self.creator_of(resource)?;
                self.accesses_of(pass.index())
                    .iter()
                    .find_map(|a| match a.mode {
                        Mode::CreateTexture(target) if a.resource == resource.0 => {
                            Some((target, self.passes[pass.index()].size))
                        }
                        _ => None,
                    })
            }
        }
    }
}

/// A name in double quotes, with quotes, backslashes and new lines escaped, as the engine's
/// messages and the text dump write names.
pub(crate) struct Quoted<'a>(pub(crate) &'a str);

impl std::fmt::Display for Quoted<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        use std::fmt::Write;
        f.write_char('"')?;
        for c in self.0.chars() {
            match c {
                '"' => f.write_str("\\\"")?,
                '\\' => f.write_str("\\\\")?,
                '\n' => f.write_str("\\n")?,
                c => f.write_char(c)?,
            }
        }
        f.write_char('"')
    }
}
