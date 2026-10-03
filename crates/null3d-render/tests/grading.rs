//! Color grading and the vignette on both frame builders: a table in a 3D texture of the texture
//! store, which the final pass binds once its texels are on the GPU, and the final pass that runs
//! in place of the resolve pass on the 8-bit path while the sketch grades. Checked through the
//! mock backend and by decoding the lists the builders record.

mod common;

use common::World;
use null3d_gpu::caps::Capabilities;
use null3d_gpu::drawlist::{Op, format, layout, view};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{CanvasOutput, FrameBuilder};
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::grading::{Lut, Vignette};
use null3d_render::output::{Antialias, SceneColor};

/// The table's size in texels along each side.
const SIZE: u32 = 4;
/// The binding of the color grading table in the final pass's group.
const TABLE_BINDING: u32 = 9;

/// The world drawn by each frame builder with scene color in `scene_color` and MSAA: WebGPU's,
/// then WebGL2's with multi-draw.
fn worlds(scene_color: u32) -> (World<GpuDrivenRenderer>, World<CpuCulledRenderer>) {
    let canvas = CanvasOutput {
        scene_color: SceneColor::from_format(scene_color),
        antialias: Antialias::Msaa,
        transparent: false,
    };
    let webgpu = World::build(GpuDrivenRenderer::new(RendererConfig {
        canvas,
        ..RendererConfig::default()
    }));
    let webgl2 = World::build(CpuCulledRenderer::new(CpuCulledConfig {
        canvas,
        multi_draw: true,
        ..CpuCulledConfig::default()
    }));
    (webgpu, webgl2)
}

/// A device that draws HDR color with MSAA, as core WebGPU does.
fn device() -> MockBackend {
    MockBackend::with_capabilities(Capabilities::MSAA_FLOAT16)
}

/// The operands of each command of a kind in a frame.
fn operands(commands: &[(Op, Vec<u32>)], op: Op) -> Vec<Vec<u32>> {
    commands
        .iter()
        .filter(|(o, _)| *o == op)
        .map(|(_, o)| o.clone())
        .collect()
}

/// The texture that the final pass's group binds as its table in a frame, when the frame makes
/// the group.
fn bound_table(commands: &[(Op, Vec<u32>)]) -> Option<u32> {
    let group = operands(commands, Op::CreateBindGroup)
        .into_iter()
        .find(|o| o[1] == layout::FINAL)?;
    let entry = group[3..].chunks(5).find(|e| e[0] == TABLE_BINDING)?;
    Some(entry[2])
}

fn check_table<B: FrameBuilder>(mut world: World<B>) {
    let mut mock = device();
    let first = world.step(&mut mock, true);
    let blank = bound_table(&first).expect("the first frame binds the blank table");
    let made = operands(&first, Op::CreateTexture);
    let blank_made = made.iter().find(|o| o[0] == blank).unwrap();
    assert_eq!(
        (blank_made[1], blank_made[2], blank_made[3], blank_made[8]),
        (1, 1, 1, view::D3)
    );

    // The table's texels go into engine memory, and the next frame makes its 3D texture, writes
    // each slice, and binds it, as the uploads come before the final pass.
    let textures = world.renderer.settings_mut().textures_mut();
    let table = textures
        .create_volume(SIZE, SIZE, SIZE, format::RGBA8_UNORM)
        .unwrap();
    assert_eq!(
        textures.group_id(table),
        None,
        "a 3D texture has no 2D group"
    );
    let (texels, _) = textures.set_data(table, SIZE, SIZE).unwrap();
    assert_eq!(texels.len(), (SIZE * SIZE * SIZE) as usize);
    texels.fill(0x80ff_4020);
    world.renderer.settings_mut().set_lut(Some(Lut {
        texture: table,
        intensity: 1.0,
        domain_min: [0.0; 3],
        domain_max: [1.0; 3],
    }));
    let commands = world.step(&mut mock, false);
    let made = operands(&commands, Op::CreateTexture);
    let [volume] = &made[..] else {
        panic!("one texture: {made:?}");
    };
    assert_eq!(
        (
            volume[1], volume[2], volume[3], volume[4], volume[7], volume[8]
        ),
        (SIZE, SIZE, SIZE, format::RGBA8_UNORM, 1, view::D3)
    );
    let slices: Vec<u32> = operands(&commands, Op::WriteTexture)
        .iter()
        .filter(|o| o[0] == volume[0])
        .map(|o| o[4])
        .collect();
    assert_eq!(slices, [0, 1, 2, 3]);
    assert_eq!(bound_table(&commands), Some(volume[0]));

    // A steady frame binds nothing new.
    assert_eq!(bound_table(&world.step(&mut mock, false)), None);

    // A destroyed table grades nothing: the pass binds the blank table again.
    let frame = world.frame;
    let textures = world.renderer.settings_mut().textures_mut();
    textures.destroy(table, frame).unwrap();
    let commands = world.step(&mut mock, true);
    assert_eq!(bound_table(&commands), Some(blank));
}

#[test]
fn a_table_binds_once_its_texels_are_up_and_until_it_is_destroyed() {
    let (webgpu, webgl2) = worlds(format::RGBA16_FLOAT);
    check_table(webgpu);
    check_table(webgl2);
}

/// The render passes of a frame.
fn passes(commands: &[(Op, Vec<u32>)]) -> usize {
    operands(commands, Op::BeginRenderPass).len()
}

fn check_eight_bit<B: FrameBuilder>(mut world: World<B>) {
    let mut mock = MockBackend::default();
    // The scene's render pass resolves straight into the canvas.
    assert_eq!(passes(&world.step(&mut mock, true)), 1);

    // The vignette needs the final pass, which reads the resolved color.
    world.renderer.settings_mut().set_vignette(Some(Vignette {
        offset: 1.0,
        darkness: 1.0,
    }));
    let commands = world.step(&mut mock, false);
    assert_eq!(passes(&commands), 2);
    assert!(bound_table(&commands).is_some());

    world.renderer.settings_mut().set_vignette(None);
    assert_eq!(passes(&world.step(&mut mock, false)), 1);
}

#[test]
fn grading_runs_the_final_pass_on_the_8_bit_path_with_msaa() {
    let (webgpu, webgl2) = worlds(format::CANVAS);
    check_eight_bit(webgpu);
    check_eight_bit(webgl2);
}

#[test]
fn a_3d_texture_refuses_images_and_sizes_past_the_webgl2_limit() {
    let mut world = World::new();
    let textures = world.renderer.settings_mut().textures_mut();
    assert!(
        textures
            .create_volume(257, 4, 4, format::RGBA8_UNORM)
            .is_err()
    );
    assert!(
        textures
            .create_volume(4, 4, 4, format::RGBA8_UNORM_SRGB)
            .is_err()
    );
    let table = textures
        .create_volume(4, 4, 4, format::RGBA8_UNORM)
        .unwrap();
    assert!(textures.set_image(table, 4, 4, 0).is_err());
    assert_eq!(textures.ready_volume(table), None);
}
