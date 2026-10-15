//! The scene's light probe grid on both frame builders: a 3D texture of half floats, which the
//! camera views' frame groups bind once its texels are on the GPU, with its values in the frame
//! uniform, and a blank 3D texture before. A texture array of the same size never binds. Checked
//! through the mock backend and by decoding the lists the builders record.

mod common;

use common::World;
use null3d_core::handle::Handle;
use null3d_gpu::drawlist::{Op, format, layout, view};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::gpu_driven::GpuDrivenRenderer;
use null3d_render::probe_grid::{ProbeGrid, ProbeGridUniform};
use null3d_render::textures::{Sampling, TextureDesc};
use null3d_render::view::{ViewFrame, ViewId};

/// The binding of the grid's 3D texture in the frame's group.
const MAP_BINDING: u32 = 10;
/// The probes along each axis.
const COUNTS: [u32; 3] = [3, 2, 4];

/// The operands of each command of a kind in a frame.
fn operands(commands: &[(Op, Vec<u32>)], op: Op) -> Vec<Vec<u32>> {
    commands
        .iter()
        .filter(|(o, _)| *o == op)
        .map(|(_, o)| o.clone())
        .collect()
}

/// The 3D textures that the frame groups that a frame makes bind, one per group.
fn bound_maps(commands: &[(Op, Vec<u32>)]) -> Vec<u32> {
    operands(commands, Op::CreateBindGroup)
        .into_iter()
        .filter(|o| o[1] == layout::FRAME)
        .filter_map(|o| Some(o[3..].chunks(5).find(|e| e[0] == MAP_BINDING)?[2]))
        .collect()
}

/// The grid's texels along each axis: three sub-volumes along z, each with a padding slice at
/// either end.
fn texels() -> [u32; 3] {
    [COUNTS[0], COUNTS[1], 3 * (COUNTS[2] + 2)]
}

fn grid(texture: Handle) -> ProbeGrid {
    ProbeGrid {
        texture,
        origin: [-1.0, 0.0, -2.0],
        spacing: [1.0, 2.0, 0.5],
        counts: COUNTS,
        intensity: 0.5,
        environment_weight: 1.0,
    }
}

fn check_grid<B: FrameBuilder>(
    mut world: World<B>,
    frame_of: impl Fn(&B) -> Option<ProbeGridUniform>,
) {
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);
    let maps = bound_maps(&first);
    let blank = *maps
        .first()
        .expect("the first frame binds a 3D texture in its frame groups");
    assert!(maps.iter().all(|&map| map == blank));
    let made = operands(&first, Op::CreateTexture);
    let blank_made = made.iter().find(|o| o[0] == blank).unwrap();
    assert_eq!(blank_made[8], view::D3);

    // A texture array of the grid's size is not a volume, and the frame groups never bind it.
    let [width, height, depth] = texels();
    let textures = world.renderer.settings_mut().textures_mut();
    let array = textures
        .create(TextureDesc {
            width,
            height,
            depth,
            format: format::RGBA16_FLOAT,
            mipmaps: false,
            levels: 1,
            sampling: Sampling::default(),
        })
        .unwrap();
    assert!(!textures.is_volume(array));
    let volume = textures
        .create_volume(width, height, depth, format::RGBA16_FLOAT)
        .unwrap();
    assert!(textures.is_volume(volume));
    let (words, _) = textures.set_data(volume, width, height).unwrap();
    assert_eq!(words.len(), (width * height * depth * 2) as usize);
    words.fill(0x3c00_3c00);
    textures.upload_all_next_frame();

    // The grid's 3D texture binds in the frame after its texels went up, with the grid's values.
    world
        .renderer
        .settings_mut()
        .set_probe_grid(Some(grid(volume)));
    let commands = world.step(&mut mock, false);
    let made = operands(&commands, Op::CreateTexture);
    let map = made
        .iter()
        .find(|o| o[8] == view::D3)
        .expect("the frame makes the grid's 3D texture");
    assert_eq!(
        (map[1], map[2], map[3], map[4]),
        (width, height, depth, format::RGBA16_FLOAT)
    );
    let maps = bound_maps(&commands);
    assert!(!maps.is_empty() && maps.iter().all(|&m| m == map[0] && m != blank));
    let uniform = frame_of(&world.renderer).expect("the camera's view draws");
    assert_eq!(uniform.origin, [-1.0, 0.0, -2.0, 1.0]);
    assert_eq!(uniform.inverse_spacing, [1.0, 0.5, 2.0, 0.0]);
    assert_eq!(uniform.counts, [3.0, 2.0, 4.0, 6.0]);
    assert_eq!(uniform.params[1], 1.0);
}

fn camera_grid(frame: Option<&ViewFrame>) -> Option<ProbeGridUniform> {
    frame.map(|frame| frame.uniform.probe_grid)
}

#[test]
fn a_grid_binds_its_3d_texture_once_its_texels_are_up_and_an_array_is_no_volume() {
    check_grid(World::new(), |r: &GpuDrivenRenderer| {
        camera_grid(r.view_frame(ViewId::CAMERA))
    });
    let webgl2 = World::build(CpuCulledRenderer::new(CpuCulledConfig {
        multi_draw: true,
        ..CpuCulledConfig::default()
    }));
    check_grid(webgl2, |r: &CpuCulledRenderer| {
        camera_grid(r.view_frame(ViewId::CAMERA))
    });
}
