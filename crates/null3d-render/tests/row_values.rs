//! Instance batches whose rows bring colors and values of their own: the builds that read them,
//! the uploads of each row's values, and the shadow casters of custom materials that move by a
//! vertex offset, on both frame builders.

mod common;

use common::World;
use null3d_core::instances::InstanceBatch;
use null3d_core::layers::DEFAULT_LAYERS;
use null3d_core::lights::SunShadow;
use null3d_core::world::ROW_VALUE_FLOATS;
use null3d_gpu::drawlist::{Op, permutation, state_flags, template};
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::materials::{CustomShading, Shading, feature};
use null3d_render::pipelines::{DepthBias, DrawKey};

/// Rows of the batch with values that each test adds.
const ROWS: u32 = 40;

/// Bytes of one row's values on the GPU: its color, then its own values.
const ROW_BYTES: u32 = (ROW_VALUE_FLOATS * 4) as u32;

/// A custom material from the standard template that has a vertex offset, and so its own casters.
fn swaying() -> Shading {
    Shading::Custom(CustomShading {
        template: template::CUSTOM_FIRST,
        attributes: 0,
        base_color: true,
        textures: 0,
        transmission: false,
        row_values: true,
        caster: true,
    })
}

/// Adds a static batch of `ROWS` rows with row values, of the world's box mesh and `material`,
/// casting shadows, with each row's values written.
fn add_value_batch<B: FrameBuilder>(world: &mut World<B>, material: u32) {
    let mesh = world.batches.get(world.batch).unwrap().mesh();
    let id = world
        .batches
        .create(ROWS, false, true, mesh, material, 0.9)
        .unwrap();
    let batch = world.batches.get_mut(id).unwrap();
    batch.set_shadows(null3d_core::scene::flags::CAST_SHADOWS);
    for row in 0..ROWS as usize {
        batch.positions_mut()[row * 3..row * 3 + 3].copy_from_slice(&[row as f32, 0.0, 0.0]);
        batch.values_mut()[row * 4..row * 4 + 4].copy_from_slice(&[row as f32, 1.0, 2.0, 3.0]);
    }
    batch.mark_dirty(0, ROWS).unwrap();
}

/// The world's frames draw the batch with row values with the ROW_VALUES builds, and upload each
/// row's values as two texels; the batches without values keep their builds.
fn check_values_draw<B: FrameBuilder>(mut world: World<B>) {
    world
        .renderer
        .settings_mut()
        .set_sun_shadow(Some(SunShadow {
            cascades: 1,
            map_size: 512,
            bias: 0.5,
            normal_bias: 1.0,
            distance: 30.0,
            layers: DEFAULT_LAYERS,
        }));
    let material = world
        .renderer
        .settings_mut()
        .materials_mut()
        .create(swaying(), 0, [1.0; 4])
        .unwrap()
        + 1;
    add_value_batch(&mut world, material);
    world.record(true);
    let commands = world.commands();
    let pipelines: Vec<&Vec<u32>> = commands
        .iter()
        .filter(|(op, _)| *op == Op::CreateRenderPipeline)
        .map(|(_, operands)| operands)
        .collect();
    let custom: Vec<u32> = pipelines
        .iter()
        .filter(|p| p[1] == template::CUSTOM_FIRST)
        .map(|p| p[2])
        .collect();
    // The rows shade with the builds that read their values, and cast with the material's own
    // caster builds, which read them too.
    let caster = permutation::CASTER | permutation::CASTER_OFFSET | permutation::ROW_VALUES;
    assert!(
        custom
            .iter()
            .any(|p| p & permutation::ROW_VALUES != 0 && p & permutation::CASTER == 0),
        "{custom:?}"
    );
    assert!(custom.iter().any(|p| p & caster == caster), "{custom:?}");
    // The world's own batch has no values, so its lit rows keep the plain builds.
    assert!(
        pipelines
            .iter()
            .filter(|p| p[1] == template::INSTANCED_LIT)
            .all(|p| p[2] & permutation::ROW_VALUES == 0)
    );
    // Every row's values reach a texture, two texels each.
    let written: u32 = commands
        .iter()
        .filter(|(op, o)| *op == Op::WriteTexture && o[5] % 2 == 0)
        .map(|(_, o)| o[9])
        .filter(|bytes| bytes % ROW_BYTES == 0)
        .sum();
    assert!(written >= ROWS * ROW_BYTES, "{written}");
}

#[test]
fn rows_with_values_draw_with_their_builds_on_webgpu() {
    check_values_draw(World::new());
}

#[test]
fn rows_with_values_draw_with_their_builds_on_webgl2() {
    for multi_draw in [true, false] {
        let config = CpuCulledConfig {
            multi_draw,
            ..CpuCulledConfig::default()
        };
        check_values_draw(World::build(CpuCulledRenderer::new(config)));
    }
}

#[test]
fn batch_pipelines_read_values_where_the_shading_has_such_builds() {
    let mut world = World::new();
    let mesh = world.batches.get(world.batch).unwrap().mesh();
    let table = world.renderer.settings_mut().materials_mut();
    let mut create = |shading, features| table.create(shading, features, [1.0; 4]).unwrap() + 1;
    let lit = create(Shading::Lit, 0);
    let hashed = create(Shading::Lit, feature::ALPHA_MASK | feature::ALPHA_HASH);
    let covered = create(
        Shading::Unlit,
        feature::ALPHA_MASK | feature::ALPHA_TO_COVERAGE,
    );
    let glass = create(Shading::Lit, feature::TRANSMISSION);
    let full = create(
        Shading::Custom(CustomShading {
            row_values: false,
            caster: false,
            ..match swaying() {
                Shading::Custom(custom) => custom,
                _ => unreachable!(),
            }
        }),
        0,
    );
    let settings = world.renderer.settings();
    let key = |material, values| {
        let batch = InstanceBatch::new(4, false, values, mesh, material, 1.0);
        settings.batch_pipeline_of(&batch).unwrap()
    };
    let rows = permutation::ROW_VALUES;
    assert_eq!(key(lit, true).permutation & rows, rows);
    assert_eq!(key(lit, false).permutation & rows, 0);
    // Rows with values test a mask against its cutoff.
    let masked = key(hashed, true);
    assert_eq!(
        masked.permutation & (rows | permutation::ALPHA_MASK | permutation::ALPHA_HASH),
        rows | permutation::ALPHA_MASK
    );
    assert_eq!(
        key(hashed, false).permutation & permutation::ALPHA_HASH,
        permutation::ALPHA_HASH
    );
    assert_eq!(key(covered, true).state & state_flags::ALPHA_TO_COVERAGE, 0);
    // A surface that lets light through, and a whole shader of the sketch's, draw rows without
    // their values.
    assert_eq!(key(glass, true).permutation & rows, 0);
    assert_eq!(key(full, true).permutation & rows, 0);
}

#[test]
fn custom_materials_with_a_vertex_offset_cast_with_their_own_builds() {
    let mut world = World::new();
    let table = world.renderer.settings_mut().materials_mut();
    let sways = table.create(swaying(), 0, [1.0; 4]).unwrap() + 1;
    let still = table.create(Shading::Lit, 0, [1.0; 4]).unwrap() + 1;
    let settings = world.renderer.settings();
    let pipeline = DrawKey {
        template: template::CUSTOM_FIRST,
        permutation: permutation::ROW_VALUES | permutation::RECEIVE_SHADOWS,
        vertex_format: 0,
        state: 0,
        bias: DepthBias::NONE,
    };
    let (key, _) = settings.caster_of(pipeline, sways);
    assert_eq!(key.template, template::CUSTOM_FIRST);
    assert_eq!(
        key.permutation,
        permutation::CASTER | permutation::CASTER_OFFSET | permutation::ROW_VALUES
    );
    assert_eq!(key.state, state_flags::CULL_FRONT);
    // Double-sided casters keep both faces where they are.
    let both = DrawKey {
        state: state_flags::CULL_NONE,
        ..pipeline
    };
    let (key, _) = settings.caster_of(both, sways);
    assert_eq!(
        key.permutation,
        permutation::CASTER | permutation::ROW_VALUES
    );
    assert!(settings.sways(sways) && !settings.sways(still) && !settings.sways(0));
}
