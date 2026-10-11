//! Materials that let light through, drawn by both frame builders: they draw with the shader
//! variant that samples the copy of the camera's opaque color, in the transparent pass. While one
//! draws, the camera's view copies its opaque color into a target with a whole chain of mip levels,
//! makes the levels, and binds the target to its frame groups. Without one, the frame records none
//! of it. Checked through the mock backend, which rejects what a real GPU would, and by decoding
//! the lists.

mod common;

use common::{World, count, grid};
use null3d_gpu::drawlist::{Op, permutation, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::materials::{CustomShading, Shading, feature};

/// The binding of the copy in the frame groups of scene pipelines.
const COPY_BINDING: u32 = 15;

/// The permutation bits of each mesh pipeline that a frame's commands create with `template`.
fn permutations(commands: &[(Op, Vec<u32>)], template: u32) -> Vec<u32> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateRenderPipeline && o[1] == template)
        .map(|(_, o)| o[2] & !permutation::DEVICE)
        .collect()
}

/// The texture that each frame group of the frame's commands binds at the copy's binding.
fn bound_copies(commands: &[(Op, Vec<u32>)]) -> Vec<u32> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateBindGroup && o[1] == null3d_gpu::drawlist::layout::FRAME)
        .filter_map(|(_, o)| {
            o[3..]
                .chunks(5)
                .find(|entry| entry[0] == COPY_BINDING)
                .map(|entry| entry[2])
        })
        .collect()
}

/// Records frames until the copy draws, and returns the commands of each frame.
fn frames<B: FrameBuilder>(
    world: &mut World<B>,
    mock: &mut MockBackend,
) -> Vec<Vec<(Op, Vec<u32>)>> {
    (0..3).map(|k| world.step(mock, k == 0)).collect()
}

fn check<B: FrameBuilder>(mut world: World<B>) {
    let plane = grid(1, 1);
    let mut mock = MockBackend::default();
    // A plain scene records nothing of transmission.
    world.add_object(&plane, Shading::Lit);
    let plain = frames(&mut world, &mut mock);
    for commands in &plain {
        assert!(permutations(commands, template::TRANSMISSION_COPY).is_empty());
        assert_eq!(count(commands, Op::GenerateMipmaps), 0);
        assert!(
            bound_copies(commands)
                .windows(2)
                .all(|pair| pair[0] == pair[1]),
            "frame groups bind the blank texel"
        );
    }
    let blank = bound_copies(&plain[0])[0];

    // Glass on the standard material, and a masked one, which lets light through unmasked.
    world.add_object_with(&plane, Shading::Lit, feature::TRANSMISSION);
    let masked = feature::TRANSMISSION | feature::ALPHA_MASK;
    world.add_object_with(&plane, Shading::Lit, masked);
    let glass = frames(&mut world, &mut mock);
    let made: Vec<u32> = glass
        .iter()
        .flat_map(|commands| permutations(commands, template::INSTANCED_LIT))
        .filter(|bits| bits & permutation::TRANSMISSION != 0)
        .collect();
    assert_eq!(
        made,
        [permutation::TRANSMISSION],
        "both glass materials draw with one unmasked pipeline"
    );
    assert_eq!(
        glass
            .iter()
            .map(|commands| permutations(commands, template::TRANSMISSION_COPY).len())
            .sum::<usize>(),
        1,
        "the copy's pipeline is made once"
    );
    // Once its pipeline is built, each frame copies the opaque color and makes its levels, and the
    // camera's frame groups bind the copy.
    let last = glass.last().unwrap();
    assert_eq!(count(last, Op::GenerateMipmaps), 1);
    let copies = bound_copies(&glass.concat());
    assert!(copies.iter().any(|&texture| texture != blank));
    let mips = last
        .iter()
        .find(|(op, _)| *op == Op::GenerateMipmaps)
        .map(|(_, o)| o[0])
        .unwrap();
    assert!(
        copies.contains(&mips),
        "the camera binds the target whose levels the frame makes"
    );

    // A custom material whose WGSL has no builds that let light through draws as before.
    let custom = CustomShading::standard(template::CUSTOM_FIRST);
    world.add_object_with(&plane, custom, feature::TRANSMISSION);
    let commands: Vec<_> = frames(&mut world, &mut mock).concat();
    assert_eq!(permutations(&commands, template::CUSTOM_FIRST), [0]);
}

#[test]
fn glass_copies_the_opaque_color_only_while_it_draws_on_webgpu() {
    check(World::new());
}

#[test]
fn glass_copies_the_opaque_color_only_while_it_draws_on_webgl2() {
    for multi_draw in [true, false] {
        let config = CpuCulledConfig {
            multi_draw,
            ..CpuCulledConfig::default()
        };
        check(World::build(CpuCulledRenderer::new(config)));
    }
}
