//! GPU picking on both frame builders: the pick's pipelines, the id pass against the scene's depth,
//! the resolve pass, and the copy and read that carry one pixel back into engine memory.

mod common;

use common::World;
use null3d_gpu::caps::Capabilities;
use null3d_gpu::drawlist::{Op, format, pass_flags, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{CanvasOutput, FrameBuilder};
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::output::{Antialias, SceneColor};
use null3d_render::pick::PickRequest;

/// The slot that the test's read raises, and where its bytes land in engine memory.
const SLOT: u32 = 40;
const DESTINATION: u32 = 4096;

/// The world drawn by each frame builder with HDR scene color and MSAA: WebGPU's, then WebGL2's.
fn worlds() -> (World<GpuDrivenRenderer>, World<CpuCulledRenderer>) {
    let canvas = CanvasOutput {
        scene_color: SceneColor::from_format(format::RGBA16_FLOAT),
        antialias: Antialias::Msaa,
        transparent: false,
    };
    let webgpu = World::build(GpuDrivenRenderer::new(RendererConfig {
        canvas,
        ..RendererConfig::default()
    }));
    let webgl2 = World::build(CpuCulledRenderer::new(CpuCulledConfig {
        canvas,
        ..CpuCulledConfig::default()
    }));
    (webgpu, webgl2)
}

/// The operands of each command of a kind in a frame.
fn operands(commands: &[(Op, Vec<u32>)], op: Op) -> Vec<Vec<u32>> {
    commands
        .iter()
        .filter(|(o, _)| *o == op)
        .map(|(_, o)| o.clone())
        .collect()
}

/// The textures that a frame creates, with their format and sample count.
fn textures(commands: &[(Op, Vec<u32>)]) -> Vec<(u32, u32, u32)> {
    operands(commands, Op::CreateTexture)
        .into_iter()
        .map(|o| (o[0], o[4], o[6]))
        .collect()
}

#[test]
fn a_pick_draws_the_ids_against_the_scene_depth_and_reads_one_texel() {
    let (webgpu, webgl2) = worlds();
    check_pick(webgpu, false);
    check_pick(webgl2, true);
}

fn check_pick<B: FrameBuilder>(mut world: World<B>, rows_from_bottom: bool) {
    let mut mock = MockBackend::with_capabilities(Capabilities::MSAA_FLOAT16);
    // A frame that draws the scene, so its depth exists before the pick tests it.
    world.step(&mut mock, true);
    let request = PickRequest {
        x: 4.0,
        y: 3.0,
        ring: 0,
        slot: SLOT,
        destination: DESTINATION,
    };
    world.renderer.settings_mut().set_pick(request);
    let commands = world.step(&mut mock, true);

    // The pick's own pipeline and the resolve pass's, which load on first use.
    let pipelines = operands(&commands, Op::CreateRenderPipeline);
    assert!(
        pipelines.iter().any(|p| p[1] == template::PICK),
        "a pick pipeline is created"
    );
    assert!(
        pipelines.iter().any(|p| p[1] == template::PICK_RESOLVE),
        "the resolve pipeline is created"
    );

    // The id target takes the scene's samples, and the resolved target has one. Both are the id
    // format, and the resolved one is a texture that a copy reads.
    let made = textures(&commands);
    let ids = made
        .iter()
        .filter(|(_, f, _)| *f == null3d_render::pick::FORMAT)
        .map(|(_, _, samples)| *samples)
        .collect::<Vec<_>>();
    assert!(
        ids.contains(&4),
        "the id target takes the scene's samples: {made:?}"
    );
    assert!(
        ids.contains(&1),
        "the resolve target has one sample: {made:?}"
    );

    // The id pass clears its target to 0, which names no object, and tests the scene's depth.
    let passes = operands(&commands, Op::BeginRenderPass);
    let id_pass = passes
        .iter()
        .find(|p| {
            made.iter().any(|&(id, f, samples)| {
                id == p[0] && f == null3d_render::pick::FORMAT && samples == 4
            })
        })
        .expect("a render pass draws the id target");
    assert_eq!(
        &id_pass[3..7],
        &[
            0.0f32.to_bits(),
            0.0f32.to_bits(),
            0.0f32.to_bits(),
            0.0f32.to_bits()
        ],
        "the id target starts at no object"
    );

    // The resolve pass stores its target, which the copy reads after the render pass ends.
    let resolved_pass = passes
        .iter()
        .find(|p| {
            made.iter().any(|&(id, f, samples)| {
                id == p[0] && f == null3d_render::pick::FORMAT && samples == 1
            })
        })
        .expect("a render pass draws the resolved target");
    assert_ne!(
        resolved_pass[8] & pass_flags::STORE_COLOR,
        0,
        "the copy needs the resolved ids after the pass"
    );
    // The resolve pass samples the texture that the id pass resolved into, and the copy reads the
    // texture that the resolve pass drew.
    let start = commands
        .iter()
        .position(|(op, words)| *op == Op::BeginRenderPass && words == resolved_pass)
        .expect("the resolve pass begins");
    let group = commands[start..]
        .iter()
        .find(|(op, words)| *op == Op::SetBindGroup && words[0] == 0)
        .map(|(_, words)| words[1])
        .expect("the resolve pass binds its ids");
    let sampled = operands(&commands, Op::CreateBindGroup)
        .into_iter()
        .find(|words| words[0] == group)
        .map(|words| words[5])
        .expect("the resolve pass's bind group is made");
    assert_eq!(
        id_pass[1], sampled,
        "the resolve samples the ids' resolved texture"
    );
    let copied = operands(&commands, Op::CopyTextureToBuffer);
    assert_ne!(
        copied[0][0], sampled,
        "the copy reads the resolve pass's own target"
    );

    // The id pass shades only the picked pixel.
    let scissor = operands(&commands, Op::SetScissor);
    assert!(
        scissor.iter().any(|s| s == &vec![4, 3, 1, 1]),
        "the id pass is scissored to the pixel: {scissor:?}"
    );

    // The read names the request's slot and destination, and four bytes of the ring's buffer.
    let read = operands(&commands, Op::ReadBuffer);
    assert_eq!(read.len(), 1, "one read answers the pick");
    assert_eq!(read[0][2], 4, "the read takes one key");
    assert_eq!(read[0][3], DESTINATION);
    assert_eq!(read[0][4], SLOT);
    // The copy takes one texel of the resolved target at the requested pixel.
    let copy = operands(&commands, Op::CopyTextureToBuffer);
    assert_eq!(copy.len(), 1, "one copy feeds the read");
    assert!(
        !operands(&commands, Op::DestroyTexture)
            .iter()
            .any(|id| id[0] == copy[0][0]),
        "the copy's texture lives until the submit that reads it"
    );
    let at = copy[0][2];
    assert_eq!(at, 4, "the copy's column is the request's x");
    let expected_y = if rows_from_bottom {
        // WebGL2 stores a drawn target's first row at the image's bottom.
        world.canvas.1 - 1 - 3
    } else {
        3
    };
    assert_eq!(copy[0][3], expected_y, "the copy's row is the request's y");
    assert_eq!(copy[0][9], 1, "the copy takes one texel across");
    assert_eq!(copy[0][10], 1, "the copy takes one texel down");

    assert!(
        world.renderer.pick_covers_scene(),
        "the pick's layout gives every draw a pick build"
    );
    // The request is consumed, so the next frame copies nothing.
    assert!(world.renderer.settings().pick().is_none());
    let after = world.step(&mut mock, true);
    assert!(
        operands(&after, Op::ReadBuffer).is_empty(),
        "a frame without a pick reads nothing"
    );
}

#[test]
fn a_pick_waits_for_its_pipelines_and_records_no_read_until_they_are_built() {
    let mut world = World::build(GpuDrivenRenderer::new(RendererConfig::default()));
    let mut mock = MockBackend::with_capabilities(Capabilities::MSAA_FLOAT16);
    world.step(&mut mock, true);
    world.renderer.settings_mut().set_pick(PickRequest {
        x: 4.0,
        y: 3.0,
        ring: 0,
        slot: SLOT,
        destination: DESTINATION,
    });
    // The pick's pipelines are created in the frame that asks for them, so a frame that has drawn
    // no later one keeps the passes off and records no read.
    world.pipelines_built = world.frame.wrapping_sub(1);
    let waiting = world.step(&mut mock, true);
    assert!(
        operands(&waiting, Op::ReadBuffer).is_empty(),
        "a frame that waits for its pipelines reads nothing"
    );
    assert!(
        world.renderer.settings().pick().is_some(),
        "the request stays until a frame draws it"
    );
    world.pipelines_built = u32::MAX;
    let drawn = world.step(&mut mock, true);
    assert_eq!(
        operands(&drawn, Op::ReadBuffer).len(),
        1,
        "the frame that has the pipelines draws the pick and reads its pixel"
    );
    assert!(world.renderer.settings().pick().is_none());
}

#[test]
fn a_masked_map_picks_with_the_template_that_tests_its_texels() {
    let mut world = World::build(GpuDrivenRenderer::new(RendererConfig::default()));
    let mut mock = MockBackend::with_capabilities(Capabilities::MSAA_FLOAT16);
    world.step(&mut mock, true);
    let mesh = {
        let settings = world.renderer.settings_mut();
        let mesh = settings.meshes_mut().add(&common::grid(1, 1)).unwrap() + 1;
        let texture = settings.textures_mut().create(common::map_desc(4)).unwrap();
        let _ = &texture;
        settings.textures_mut().set_image(texture, 4, 4, 0).unwrap();
        let material = settings
            .materials_mut()
            .create(
                null3d_render::materials::Shading::UnlitMap,
                null3d_render::materials::feature::ALPHA_MASK,
                [1.0; 4],
            )
            .expect("a material");
        settings
            .materials_mut()
            .set_map(
                material,
                null3d_render::materials::MapSlot::BaseColor,
                texture,
                false,
            )
            .unwrap();
        let object = world.scene.reserve().unwrap();
        world.scene.set_local_radius(object, 1.0).unwrap();
        let commands = [
            null3d_core::scene::Command::create(
                object,
                null3d_core::handle::Handle::NONE,
                mesh,
                null3d_core::scene::flags::VISIBLE,
            ),
            null3d_core::scene::Command::set_material(object, material + 1),
        ];
        world.scene.apply_commands(&commands, world.frame).unwrap();
        mesh
    };
    assert_ne!(mesh, 0);
    // A frame that draws the material, so its map's bind group exists before the pick asks for it.
    let drawn = world.step(&mut mock, true);
    assert!(
        operands(&drawn, Op::SetBindGroup)
            .iter()
            .any(|words| words[0] == 1 && words[1] != 0),
        "the shading binds the material's map group: {:?}",
        operands(&drawn, Op::SetBindGroup)
    );
    world.renderer.settings_mut().set_pick(PickRequest {
        x: 4.0,
        y: 3.0,
        ring: 0,
        slot: SLOT,
        destination: DESTINATION,
    });
    let commands = world.step(&mut mock, true);
    let pick_maps = operands(&commands, Op::CreateRenderPipeline)
        .into_iter()
        .find(|p| p[1] == template::PICK_TEXTURE_MAPS)
        .expect("a masked unlit map picks with the map template");
    assert_ne!(
        pick_maps[2] & null3d_gpu::drawlist::permutation::ALPHA_MASK,
        0,
        "the build tests the mask's texels"
    );
    assert!(
        world.renderer.pick_covers_scene(),
        "the id pass draws every source, so a landed answer is the GPU's"
    );
    // The pick pass binds the material's maps: the mask's texels cut the fragments.
    let start = commands
        .iter()
        .position(|(op, words)| *op == Op::SetScissor && words.as_slice() == [4, 3, 1, 1])
        .expect("the pick pass is scissored to the request's pixel");
    let end = commands[start..]
        .iter()
        .position(|(op, _)| *op == Op::EndRenderPass)
        .map_or(commands.len(), |end| start + end);
    assert!(
        commands[start..end]
            .iter()
            .any(|(op, words)| *op == Op::SetBindGroup && words[0] != 0 && words[1] != 0),
        "the mask's maps are bound in the pick pass"
    );
    assert!(
        commands[start..end]
            .iter()
            .any(|(op, _)| matches!(op, Op::Draw | Op::DrawIndexed | Op::DrawIndexedIndirect)),
        "the pick pass draws the masked object"
    );
}

#[test]
fn a_key_names_its_object_or_its_batch_row() {
    let (mut webgpu, mut webgl2) = worlds();
    check_targets(&mut webgpu);
    check_targets(&mut webgl2);
}

fn check_targets<B: FrameBuilder>(world: &mut World<B>) {
    // The keys name the layout's sources, which a recorded frame builds.
    let mut mock = MockBackend::with_capabilities(Capabilities::MSAA_FLOAT16);
    world.step(&mut mock, true);
    let slot = world.objects.first().map_or(1, |handle| handle.slot());
    assert_eq!(
        world.renderer.pick_target(slot),
        Some((slot, u32::MAX)),
        "an object's key names its slot and no row"
    );
    assert_eq!(world.renderer.pick_target(0), None, "key 0 is a miss");
}
