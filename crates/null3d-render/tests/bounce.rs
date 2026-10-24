//! Screen-space bounce light in both frame builders, checked through the mock backend and by
//! decoding the lists they record: turning it on during play adds the depth prepass and its three
//! steps after the scene's passes, the last of which feeds the custom effects, and turning it off
//! takes them away again. Each frame replays on the mock, which checks that no draw reads a texture
//! it draws into.

mod common;

use std::collections::HashMap;

use common::{World, count};
use null3d_gpu::caps::Capabilities;
use null3d_gpu::drawlist::{Op, format, layout, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::bounce::Bounce;
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

/// The render passes of a frame, each as the templates of the pipelines it sets, with `u32::MAX`
/// for each bundle it replays. `made` gives each pipeline's template by id.
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

/// Draws a few frames without the bounce, then with it, then without it again, and checks what
/// each records. `gather_template` is the gather's template for the scene's samples.
fn on_and_off<B: FrameBuilder>(renderer: B, gather_template: u32) {
    let mut world = World::build(renderer);
    // A device that multisamples 16-bit floats, as core WebGPU and WebGL2 with the float extensions
    // do.
    let mut mock = MockBackend::with_capabilities(Capabilities::MSAA_FLOAT16);
    let mut made = HashMap::new();
    note_pipelines(&world.step(&mut mock, true), &mut made);
    let before = passes(&world.step(&mut mock, false), &made);

    world
        .renderer
        .settings_mut()
        .set_bounce(Some(Bounce::default()));
    world.renderer.settings_mut().set_bounce_scale(0.5);
    let asked = world.step(&mut mock, false);
    note_pipelines(&asked, &mut made);
    let created = templates(&asked);
    for template in [
        gather_template,
        template::BOUNCE_DENOISE,
        template::BOUNCE_ADD,
    ] {
        assert!(created.contains(&template), "{template} in {created:?}");
    }
    // The steps draw from the frame after the one that created their pipelines, once the thread
    // that draws has built them; until then the frame keeps the scene's passes without them.
    let first = world.step(&mut mock, false);
    let groups: Vec<u32> = first
        .iter()
        .filter(|(op, _)| *op == Op::CreateBindGroup)
        .map(|(_, o)| o[1])
        .collect();
    assert!(
        groups.contains(&layout::BOUNCE) || groups.contains(&layout::BOUNCE_MS),
        "{groups:?}"
    );
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
    // The scene's passes, then the gather, the denoise and the add, each in a render pass of its
    // own, then the final pass.
    let with = passes(&steady, &made);
    let gather = with
        .iter()
        .position(|pass| pass[..] == [gather_template])
        .unwrap();
    assert_eq!(gather, before.len() - 1, "the scene's passes draw first");
    assert_eq!(with[gather + 1], [template::BOUNCE_DENOISE]);
    assert_eq!(with[gather + 2], [template::BOUNCE_ADD]);
    assert!(
        !with[gather + 3].is_empty(),
        "a pass takes the image to the canvas after the add"
    );
    assert_eq!(with.len(), before.len() + 3);

    // A new GPU, as after a device loss, builds the steps' pipelines again. The first frame on it
    // keeps the scene's passes without them, and the next draws them again.
    world.renderer.reset_gpu();
    let mut fresh = MockBackend::with_capabilities(Capabilities::MSAA_FLOAT16);
    world.step(&mut fresh, false);
    let again = passes(&world.step(&mut fresh, false), &made);
    assert_eq!(again, with);
    mock = fresh;

    world.renderer.settings_mut().set_bounce(None);
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
        scene_color: SceneColor::from_format(format::RGBA16_FLOAT),
        antialias,
        transparent: false,
    }
}

#[test]
fn webgpu_turns_the_bounce_on_and_off_during_play() {
    for (antialias, gather) in [
        (Antialias::Msaa, template::BOUNCE_GATHER_MS),
        (Antialias::Fxaa, template::BOUNCE_GATHER),
    ] {
        let config = RendererConfig {
            canvas: hdr(antialias),
            ..RendererConfig::default()
        };
        on_and_off(GpuDrivenRenderer::new(config), gather);
    }
}

#[test]
fn webgl2_turns_the_bounce_on_and_off_during_play() {
    // WebGL2's backend reads a multisampled depth through a copy of one sample, so the gather's
    // template is the same in both modes.
    for antialias in [Antialias::Msaa, Antialias::Fxaa] {
        let config = CpuCulledConfig {
            canvas: hdr(antialias),
            ..CpuCulledConfig::default()
        };
        on_and_off(CpuCulledRenderer::new(config), template::BOUNCE_GATHER);
    }
}
