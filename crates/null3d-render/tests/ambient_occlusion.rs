//! Ambient occlusion in both frame builders, checked through the mock backend and by decoding the
//! lists they record: turning it on during play adds the depth prepass and three steps before the
//! camera's opaque pass, which binds their last target, and turning it off takes them away again.
//! Each frame replays on the mock, which checks that no draw reads a texture it draws into.

mod common;

use std::collections::HashMap;

use common::{World, count};
use null3d_gpu::caps::Capabilities;
use null3d_gpu::drawlist::{Op, layout, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::ao::Ao;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{CanvasOutput, FrameBuilder};
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::output::{Antialias, SceneColor};

/// The templates of the pipelines that the commands create.
fn templates(commands: &[(Op, Vec<u32>)]) -> Vec<u32> {
    commands
        .iter()
        .filter(|(op, _)| *op == Op::CreateRenderPipeline)
        .map(|(_, o)| o[1])
        .collect()
}

/// The render passes of a frame, each as the templates of the pipelines it sets, with
/// `u32::MAX` for each bundle it replays. `made` gives each pipeline's template by id.
fn passes(commands: &[(Op, Vec<u32>)], made: &HashMap<u32, u32>) -> Vec<Vec<u32>> {
    let mut out: Vec<Vec<u32>> = Vec::new();
    let mut bundle = false;
    for (op, o) in commands {
        match op {
            Op::BeginBundle => bundle = true,
            Op::EndBundle => bundle = false,
            Op::BeginRenderPass => out.push(Vec::new()),
            Op::SetPipeline if !bundle => out.last_mut().unwrap().push(made[&o[0]]),
            Op::ExecuteBundles => out.last_mut().unwrap().push(u32::MAX),
            _ => {}
        }
    }
    out
}

/// Adds the template of each pipeline that the commands create to `made`, by id.
fn note_pipelines(commands: &[(Op, Vec<u32>)], made: &mut HashMap<u32, u32>) {
    for (op, o) in commands {
        if *op == Op::CreateRenderPipeline {
            made.insert(o[0], o[1]);
        }
    }
}

/// Draws a few frames without ambient occlusion, then with it, then without it again, and checks
/// what each records. `depth_template` is the depth step's template for the scene's samples.
fn on_and_off<B: FrameBuilder>(renderer: B, depth_template: u32) {
    let mut world = World::build(renderer);
    // A device that multisamples 16-bit floats, as core WebGPU and WebGL2 with the float extensions
    // do.
    let mut mock = MockBackend::with_capabilities(Capabilities::MSAA_FLOAT16);
    let mut made = HashMap::new();
    note_pipelines(&world.step(&mut mock, true), &mut made);
    let before = passes(&world.step(&mut mock, false), &made);

    world.renderer.settings_mut().set_ao(Some(Ao::default()));
    let first = world.step(&mut mock, false);
    note_pipelines(&first, &mut made);
    let created = templates(&first);
    for template in [depth_template, template::AO, template::AO_DENOISE] {
        assert!(created.contains(&template), "{template} in {created:?}");
    }
    let groups: Vec<u32> = first
        .iter()
        .filter(|(op, _)| *op == Op::CreateBindGroup)
        .map(|(_, o)| o[1])
        .collect();
    assert!(groups.contains(&layout::AO) && groups.contains(&layout::FRAME));
    let steady = world.step(&mut mock, false);
    assert_eq!(
        count(&steady, Op::CreateBindGroup),
        0,
        "a steady frame binds nothing new"
    );
    assert_eq!(
        count(&steady, Op::CreateTexture),
        0,
        "a steady frame makes no texture"
    );
    // The prepass in a render pass of its own, then the three steps, then the opaque pass.
    let with = passes(&steady, &made);
    let depth = with
        .iter()
        .position(|pass| pass[..] == [depth_template])
        .unwrap();
    assert_eq!(with[depth + 1], [template::AO]);
    assert_eq!(with[depth + 2], [template::AO_DENOISE]);
    assert!(!with[depth - 1].is_empty(), "the prepass draws first");
    assert!(
        !with[depth + 3].is_empty(),
        "the opaque pass draws after the steps"
    );
    assert_eq!(with.len(), before.len() + 4);

    // A new GPU, as after a device loss and in hold mode's last frame, gets every object again.
    world.renderer.reset_gpu();
    let mut fresh = MockBackend::with_capabilities(Capabilities::MSAA_FLOAT16);
    let again = passes(&world.step(&mut fresh, false), &made);
    assert_eq!(again, with);
    mock = fresh;

    world.renderer.settings_mut().set_ao(None);
    world.step(&mut mock, false);
    let after = passes(&world.step(&mut mock, false), &made);
    assert_eq!(
        after.len(),
        before.len(),
        "the steps and the prepass are gone"
    );
}

fn hdr(antialias: Antialias) -> CanvasOutput {
    CanvasOutput {
        scene_color: SceneColor::from_format(null3d_gpu::drawlist::format::RGBA16_FLOAT),
        antialias,
        transparent: false,
    }
}

#[test]
fn webgpu_turns_ambient_occlusion_on_and_off_during_play() {
    for (antialias, depth) in [
        (Antialias::Msaa, template::AO_DEPTH_MS),
        (Antialias::Fxaa, template::AO_DEPTH),
    ] {
        let config = RendererConfig {
            canvas: hdr(antialias),
            ..RendererConfig::default()
        };
        on_and_off(GpuDrivenRenderer::new(config), depth);
    }
}

#[test]
fn webgl2_turns_ambient_occlusion_on_and_off_during_play() {
    // WebGL2's backend reads a multisampled depth through a copy of one sample, so the depth
    // step's template is the same in both modes.
    for antialias in [Antialias::Msaa, Antialias::Fxaa] {
        let config = CpuCulledConfig {
            canvas: hdr(antialias),
            ..CpuCulledConfig::default()
        };
        on_and_off(CpuCulledRenderer::new(config), template::AO_DEPTH);
    }
}
