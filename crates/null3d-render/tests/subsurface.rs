//! The bind groups that the WebGL2 frame builder makes: each buffer range must lie inside its
//! buffer. The skin pass has a frame group of its own, which reads the camera's light textures and
//! its list of reflection probes; the lists hold a slot for each camera view, so a group that took
//! the skin view's place instead read past the lists and the draw failed.
#![allow(clippy::disallowed_methods)] // Native job workers are threads.

mod common;

use std::collections::HashMap;

use common::{World, base_sphere};
use null3d_gpu::drawlist::{Op, format, resource_kind};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{CanvasOutput, FrameBuilder};
use null3d_render::materials::{Shading, feature};
use null3d_render::output::{Antialias, SceneColor};

/// A world of HDR color, where the subsurface blur draws.
fn scattering() -> World<CpuCulledRenderer> {
    let mut world = World::build(CpuCulledRenderer::new(CpuCulledConfig {
        canvas: CanvasOutput {
            scene_color: SceneColor::from_format(format::RGBA16_FLOAT),
            antialias: Antialias::None,
            transparent: false,
        },
        multi_draw: true,
        ..CpuCulledConfig::default()
    }));
    world.renderer.settings_mut().set_subsurface_taps(17);
    world.add_object_with(&base_sphere(0.5, [8, 6]), Shading::Lit, feature::SUBSURFACE);
    world
}

#[test]
fn every_bind_group_buffer_range_lies_inside_a_buffer_the_frame_made() {
    let mut world = scattering();
    let mut mock = MockBackend::default();
    let mut sizes: HashMap<u32, u32> = HashMap::new();
    let mut checked = 0;
    for _ in 0..3 {
        let commands = world.step(&mut mock, true);
        for (op, operands) in &commands {
            if *op == Op::CreateBuffer {
                sizes.insert(operands[0], operands[1]);
            }
        }
        for (op, operands) in &commands {
            if *op != Op::CreateBindGroup {
                continue;
            }
            let (group, layout) = (operands[0], operands[1]);
            for entry in operands[3..].as_chunks::<5>().0 {
                let [binding, kind, id, offset, size] =
                    [entry[0], entry[1], entry[2], entry[3], entry[4]];
                if kind != resource_kind::BUFFER || size == 0 {
                    continue;
                }
                let buffer = sizes.get(&id).unwrap_or_else(|| {
                    panic!("group {group} of layout {layout}, binding {binding}, names buffer {id}, which no frame made")
                });
                assert!(
                    offset + size <= *buffer,
                    "group {group} of layout {layout}, binding {binding}: the range {offset} plus {size} passes the buffer of {buffer} bytes"
                );
                checked += 1;
            }
        }
    }
    assert!(checked > 0, "the frames made no buffer ranges to check");
}
