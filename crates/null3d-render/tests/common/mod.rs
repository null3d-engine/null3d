//! A small scene for frame builder tests: a camera, scene objects with two meshes and two
//! materials, and a dynamic instance batch, stepped frame by frame as the engine steps them. The
//! `graph` module declares the engine's render passes for the render graph tests.
#![allow(dead_code)]

pub mod graph;

use null3d_core::handle::Handle;
use null3d_core::instances::BatchTable;
use null3d_core::jobs::JobSystem;
use null3d_core::scene::{Command, SceneStorage, flags};
use null3d_core::snapshot::FrameSnapshot;
use null3d_gpu::drawlist::{Op, decode};
use null3d_render::arrays::{MeshArrays, from_arrays};
use null3d_render::camera::Perspective;
use null3d_render::frame::{FrameBuilder, FrameInput, NO_MESH, RecordError};
use null3d_render::geometry::{Geometry, box_geometry, sphere_geometry};
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::materials::Shading;

pub const SCENE_CAPACITY: u32 = 31;
pub const BATCH_ROWS: u32 = 1000;

pub struct World<B: FrameBuilder = GpuDrivenRenderer> {
    pub jobs: JobSystem,
    pub scene: SceneStorage,
    pub batches: BatchTable,
    pub snapshot: FrameSnapshot,
    pub renderer: B,
    pub batch: Handle,
    pub camera: Handle,
    pub objects: Vec<Handle>,
    pub frame: u32,
    pub canvas: (u32, u32),
}

impl World {
    /// Four objects (two meshes by two materials, one of them hidden), and a dynamic batch, drawn
    /// by the WebGPU frame builder.
    pub fn new() -> World {
        World::with_config(RendererConfig::default())
    }

    /// The same world, drawn by a WebGPU frame builder with `config`.
    pub fn with_config(config: RendererConfig) -> World {
        World::build(GpuDrivenRenderer::new(config))
    }
}

impl<B: FrameBuilder> World<B> {
    /// The world, drawn by `renderer`.
    pub fn build(mut renderer: B) -> World<B> {
        let jobs = JobSystem::new(0);
        let mut scene = SceneStorage::with_capacity(SCENE_CAPACITY);
        let mut batches = BatchTable::with_capacity(4);
        let box_mesh = renderer
            .settings_mut()
            .meshes_mut()
            .add(&box_geometry(1.0, 1.0, 1.0, [1, 1, 1]))
            .unwrap()
            + 1;
        let ball = renderer
            .settings_mut()
            .meshes_mut()
            .add(&sphere_geometry(0.5, 8, 6))
            .unwrap()
            + 1;
        let lit = renderer
            .settings_mut()
            .materials_mut()
            .create(Shading::Lit, [1.0, 0.0, 0.0, 1.0])
            .unwrap()
            + 1;
        let unlit = renderer
            .settings_mut()
            .materials_mut()
            .create(Shading::Unlit, [0.0, 0.0, 1.0, 1.0])
            .unwrap()
            + 1;

        let camera = scene.reserve().unwrap();
        scene.set_position(camera, [0.0, 0.0, 20.0]).unwrap();
        let mut commands = vec![Command::create(
            camera,
            Handle::NONE,
            NO_MESH,
            flags::VISIBLE,
        )];
        let mut objects = Vec::new();
        for (k, (mesh, material, visible)) in [
            (box_mesh, lit, true),
            (box_mesh, unlit, true),
            (ball, lit, true),
            (ball, lit, false),
        ]
        .into_iter()
        .enumerate()
        {
            let object = scene.reserve().unwrap();
            scene
                .set_position(object, [k as f32 * 2.0 - 3.0, 0.0, 0.0])
                .unwrap();
            scene.set_local_radius(object, 0.9).unwrap();
            let flag = if visible { flags::VISIBLE } else { 0 };
            commands.push(Command::create(object, Handle::NONE, mesh, flag));
            commands.push(Command::set_material(object, material));
            objects.push(object);
        }
        scene.apply_commands(&commands, 1).unwrap();
        let batch = batches
            .create(BATCH_ROWS, true, false, box_mesh, lit, 0.9)
            .unwrap();
        batches
            .get_mut(batch)
            .unwrap()
            .set_active_count(BATCH_ROWS)
            .unwrap();
        let settings = renderer.settings_mut();
        settings.set_camera(
            camera,
            Perspective {
                fov_degrees: 60.0,
                near: 0.1,
                far: 100.0,
            },
        );
        settings.set_sun([-1.0, -2.0, -1.0], [3.0, 3.0, 3.0]);
        settings.set_ambient([0.4, 0.4, 0.4]);
        World {
            jobs,
            scene,
            batches,
            snapshot: FrameSnapshot::with_capacity(256),
            renderer,
            batch,
            camera,
            objects,
            frame: 1,
            canvas: (640, 360),
        }
    }

    /// Runs the core's part of the current frame, then culls and records its draw list. Returns
    /// true when the frame rebuilt the draw tables.
    pub fn record(&mut self, structure_changed: bool) -> bool {
        self.try_record(structure_changed).unwrap()
    }

    /// As [`World::record`], returning the renderer's error.
    pub fn try_record(&mut self, structure_changed: bool) -> Result<bool, RecordError> {
        let frame = self.frame;
        if frame > 1 {
            self.scene.begin_frame(frame);
        }
        self.scene.update_transforms(&self.jobs);
        self.batches.update(&self.jobs, frame);
        self.snapshot.record(frame, &self.scene, &self.batches);
        let input = FrameInput {
            frame,
            scene: &self.scene,
            batches: &self.batches,
            snapshot: &self.snapshot,
            canvas: self.canvas,
            structure_changed,
            jobs: &self.jobs,
        };
        self.renderer.cull(&input)?;
        self.renderer.record(&input)
    }

    /// Adds a mesh and a material to the builder, and an object that draws with them, in the
    /// current frame. Returns the engine mesh id.
    pub fn add_object(&mut self, mesh: &Geometry, shading: Shading) -> u32 {
        let settings = self.renderer.settings_mut();
        let mesh = settings.meshes_mut().add(mesh).unwrap() + 1;
        let material = settings
            .materials_mut()
            .create(shading, [1.0, 1.0, 1.0, 1.0])
            .unwrap()
            + 1;
        let object = self.scene.reserve().unwrap();
        self.scene.set_local_radius(object, 1.0).unwrap();
        let commands = [
            Command::create(object, Handle::NONE, mesh, flags::VISIBLE),
            Command::set_material(object, material),
        ];
        self.scene.apply_commands(&commands, self.frame).unwrap();
        mesh
    }

    /// The operations of the frame's list with their operands.
    pub fn commands(&self) -> Vec<(Op, Vec<u32>)> {
        decode(self.renderer.list(self.frame).words())
            .map(|c| {
                let c = c.unwrap();
                (c.op, c.operands.to_vec())
            })
            .collect()
    }
}

/// A flat grid of `columns` x `rows` unit quads facing +z, with texture coordinates from 0 to 1,
/// and normals computed from its triangles.
pub fn grid(columns: u32, rows: u32) -> Geometry {
    let (mut positions, mut uvs, mut indices) = (Vec::new(), Vec::new(), Vec::new());
    for y in 0..=rows {
        for x in 0..=columns {
            positions.extend_from_slice(&[x as f32, y as f32, 0.0]);
            uvs.extend_from_slice(&[x as f32 / columns as f32, y as f32 / rows as f32]);
        }
    }
    let row = columns + 1;
    for y in 0..rows {
        for x in 0..columns {
            let (a, b) = (y * row + x, (y + 1) * row + x);
            indices.extend_from_slice(&[a, a + 1, b, b, a + 1, b + 1]);
        }
    }
    let arrays = MeshArrays {
        positions: &positions,
        uvs: Some(&uvs),
        indices: Some(&indices),
        compute_normals: true,
        ..MeshArrays::default()
    };
    from_arrays(&arrays, &JobSystem::new(0)).unwrap()
}

pub fn count(commands: &[(Op, Vec<u32>)], op: Op) -> usize {
    commands.iter().filter(|(o, _)| *o == op).count()
}
