//! The text dump: a render graph as Graphviz DOT text, for people and agents who debug it.

use std::fmt::{self, Write};

use null3d_gpu::drawlist::{format, texture_usage};

use super::compile::{LoadOp, Plan, Step, StepKind, StoreOp, Surface};
use super::error::GraphError;
use super::{
    ALL_LAYERS, Mode, PassId, PassKind, Quoted, RenderGraph, ResourceId, Size, Source, Target,
};

impl RenderGraph {
    /// The graph as Graphviz DOT text, compiled first. Each render or compute pass that the GPU
    /// runs is a box around the passes it runs, which are numbered in the order they run. Each
    /// target shows its format, size and texture, and each attachment its load and store
    /// operations. Passes that are switched off show dashed. A graph that fails to compile shows
    /// the error as its label.
    pub fn dot(&mut self) -> String {
        let error = self.compile().err();
        let mut out = String::new();
        self.write_dot(&mut out, error)
            .expect("writing to a String never fails");
        out
    }

    fn write_dot(&self, out: &mut String, error: Option<GraphError>) -> fmt::Result {
        writeln!(out, "digraph \"render graph\" {{")?;
        writeln!(
            out,
            "  graph [rankdir=LR, fontname=\"Helvetica\", fontsize=10];"
        )?;
        writeln!(out, "  node [fontname=\"Helvetica\", fontsize=10];")?;
        writeln!(out, "  edge [fontname=\"Helvetica\", fontsize=9];")?;
        if let Some(error) = error {
            writeln!(out, "  label={};", Quoted(&self.explain(error)))?;
        }
        let plan = self.plan();
        if let Some(plan) = plan {
            for (index, step) in plan.steps().iter().enumerate() {
                writeln!(out, "  subgraph \"cluster {}\" {{", index + 1)?;
                writeln!(out, "    label={};", Quoted(&self.step_label(plan, step)))?;
                for &pass in plan.passes(step) {
                    let place = plan.order().iter().position(|&p| p == pass).unwrap_or(0);
                    let label = format!("{}. {}", place + 1, self.pass_label(pass));
                    writeln!(
                        out,
                        "    {} [shape=box, label={}];",
                        PassNode(self.pass_name(pass)),
                        Quoted(&label)
                    )?;
                }
                writeln!(out, "  }}")?;
            }
        }
        let runs = |pass: PassId| plan.is_some_and(|plan| plan.order().contains(&pass));
        for pass in (0..self.passes.len()).map(|index| PassId(index as u16)) {
            if !runs(pass) {
                let state = if self.is_enabled(pass) { "" } else { ", off" };
                writeln!(
                    out,
                    "  {} [shape=box, style=dashed, label={}];",
                    PassNode(self.pass_name(pass)),
                    Quoted(&format!("{}{state}", self.pass_label(pass)))
                )?;
            }
        }
        for resource in (0..self.resources.len()).map(|index| ResourceId(index as u16)) {
            let used = (0..self.passes.len()).any(|pass| {
                self.accesses_of(pass)
                    .iter()
                    .any(|a| a.resource == resource.0)
            });
            if used {
                let shape = match self.resources[resource.index()].source {
                    Source::Buffer => "note",
                    Source::Passes if self.shape_of(resource).is_none() => "note",
                    _ => "ellipse",
                };
                writeln!(
                    out,
                    "  {} [shape={shape}, label={}];",
                    ResourceNode(self.resource_name(resource)),
                    Quoted(&self.resource_label(plan, resource))
                )?;
            }
        }
        let order: Vec<PassId> = match plan {
            Some(plan) => plan.order().to_vec(),
            None => (0..self.passes.len())
                .map(|index| PassId(index as u16))
                .collect(),
        };
        for pass in order {
            for access in self.accesses_of(pass.index()) {
                let pass_node = PassNode(self.pass_name(pass));
                let resource_node = ResourceNode(self.resource_name(ResourceId(access.resource)));
                if !access.mode.writes() {
                    writeln!(out, "  {resource_node} -> {pass_node};")?;
                    continue;
                }
                let mut notes = Vec::new();
                if matches!(access.mode, Mode::CreateTexture(_) | Mode::CreateBuffer) {
                    notes.push("creates".to_owned());
                }
                if access.mode == Mode::WritePart {
                    notes.push("part".to_owned());
                }
                if let Some(layer) = access.layer {
                    notes.push(format!("layer {layer}"));
                }
                if notes.is_empty() {
                    writeln!(out, "  {pass_node} -> {resource_node};")?;
                } else {
                    writeln!(
                        out,
                        "  {pass_node} -> {resource_node} [label={}];",
                        Quoted(&notes.join(", "))
                    )?;
                }
            }
        }
        writeln!(out, "}}")
    }

    /// A pass's name and kind, with its size and layers for passes that draw objects.
    fn pass_label(&self, pass: PassId) -> String {
        let decl = &self.passes[pass.index()];
        let mut label = format!("{}\n{} pass", decl.name, decl.kind.name());
        if decl.kind.draws() {
            label += &format!(", {}", decl.size.name());
        }
        if matches!(decl.kind, PassKind::Scene | PassKind::Shadow) {
            if decl.layers == ALL_LAYERS {
                label += ", all layers";
            } else {
                label += &format!(", layers {:#010x}", decl.layers);
            }
        }
        label
    }

    /// A step's kind and size, and each attachment with its load and store operations.
    fn step_label(&self, plan: &Plan, step: &Step) -> String {
        let StepKind::Render { size, samples } = step.kind else {
            return "compute pass".to_owned();
        };
        let mut label = format!("render pass: {}", size.name());
        if samples > 1 {
            label += &format!(", {samples} samples");
        }
        for attachment in plan.attachments(step) {
            label += &format!("\n{}", self.resource_name(attachment.resource));
            if self
                .shape_of(attachment.resource)
                .is_some_and(|(t, _)| t.layers > 1)
            {
                label += &format!(" layer {}", attachment.layer);
            }
            label += match attachment.load {
                LoadOp::Clear => ": clear",
                LoadOp::Load => ": load",
            };
            label += match attachment.store {
                StoreOp::Store => ", store",
                StoreOp::Discard => ", discard",
            };
            if attachment.resolve.is_some() {
                label += ", resolve";
            }
        }
        label
    }

    /// A resource's name, what it is, and where the plan keeps it.
    fn resource_label(&self, plan: Option<&Plan>, resource: ResourceId) -> String {
        let name = self.resource_name(resource);
        let source = self.resources[resource.index()].source;
        let Some((target, size)) = self.shape_of(resource) else {
            return match source {
                Source::Buffer => format!("{name}\nbuffer from outside the graph"),
                _ if self.is_created(resource) => format!("{name}\nbuffer"),
                _ => format!("{name}\nnot created"),
            };
        };
        if source == Source::Canvas {
            return name.to_owned();
        }
        let mut label = format!("{name}\n{}", shape_text(target, size));
        let Some(plan) = plan else {
            return label;
        };
        let texture = |surface: Option<Surface>| match surface {
            Some(Surface::Texture(index)) => plan
                .textures()
                .get(index as usize)
                .map(|t| (index, usage_text(t.usage))),
            _ => None,
        };
        let kept = matches!(source, Source::Kept { .. });
        match texture(plan.texture_of(resource)) {
            Some((index, usage)) if kept => label += &format!("\nkept in texture {index}: {usage}"),
            Some((index, usage)) => label += &format!("\ntexture {index}: {usage}"),
            None => label += "\nnot used this frame",
        }
        if target.resolves()
            && plan.sampled_texture_of(resource) != plan.texture_of(resource)
            && let Some((index, usage)) = texture(plan.sampled_texture_of(resource))
        {
            label += &format!("\nresolves into texture {index}: {usage}");
        }
        label
    }
}

/// A target's format, size, and sample and layer counts when above one.
fn shape_text(target: Target, size: Size) -> String {
    let mut text = format!("{}, {}", format_name(target.format), size.name());
    if target.samples > 1 {
        text += &format!(", {} samples", target.samples);
    }
    if target.layers > 1 {
        text += &format!(", {} layers", target.layers);
    }
    text
}

/// A format's WebGPU name.
fn format_name(code: u32) -> String {
    match code {
        format::CANVAS => "canvas format".into(),
        format::RGBA8_UNORM => "rgba8unorm".into(),
        format::BGRA8_UNORM => "bgra8unorm".into(),
        format::RGBA16_FLOAT => "rgba16float".into(),
        format::DEPTH24_PLUS => "depth24plus".into(),
        format::DEPTH32_FLOAT => "depth32float".into(),
        format::RGBA32_FLOAT => "rgba32float".into(),
        format::R32_UINT => "r32uint".into(),
        other => format!("format {other}"),
    }
}

/// Usage flags in words.
fn usage_text(usage: u32) -> String {
    let names = [
        (texture_usage::RENDER_ATTACHMENT, "attachment"),
        (texture_usage::TEXTURE_BINDING, "sampled"),
        (texture_usage::STORAGE_BINDING, "storage"),
        (texture_usage::TRANSIENT_ATTACHMENT, "transient"),
        (texture_usage::COPY_SRC, "copy source"),
        (texture_usage::COPY_DST, "copy destination"),
    ];
    let words: Vec<&str> = names
        .iter()
        .filter(|(bit, _)| usage & bit != 0)
        .map(|&(_, name)| name)
        .collect();
    words.join(", ")
}

/// A pass's node name, apart from the resources' names.
struct PassNode<'a>(&'a str);

impl fmt::Display for PassNode<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", Quoted(&format!("pass {}", self.0)))
    }
}

/// A resource's node name, apart from the passes' names.
struct ResourceNode<'a>(&'a str);

impl fmt::Display for ResourceNode<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", Quoted(&format!("resource {}", self.0)))
    }
}
