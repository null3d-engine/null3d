//! A small scene for frame builder tests: a camera, scene objects with two meshes and two
//! materials, and a dynamic instance batch, stepped frame by frame as the engine steps them.
#![allow(dead_code)]

use null3d_core::handle::Handle;
use null3d_core::instances::BatchTable;
use null3d_core::jobs::JobSystem;
use null3d_core::scene::{Command, SceneStorage, flags};
use null3d_core::snapshot::FrameSnapshot;
use null3d_gpu::drawlist::{Op, decode};
use null3d_render::camera::Perspective;
use null3d_render::geometry::{box_geometry, sphere_geometry};
use null3d_render::gpu_driven::{FrameInput, GpuDrivenRenderer, NO_MESH, RendererConfig};
use null3d_render::materials::Shading;

pub const SCENE_CAPACITY: u32 = 31;
pub const BATCH_ROWS: u32 = 1000;

pub struct World {
    pub jobs: JobSystem,
    pub scene: SceneStorage,
    pub batches: BatchTable,
    pub snapshot: FrameSnapshot,
    pub renderer: GpuDrivenRenderer,
    pub batch: Handle,
    pub objects: Vec<Handle>,
    pub frame: u32,
    pub canvas: (u32, u32),
}

impl World {
    /// Four objects (two meshes by two materials, one of them hidden), and a dynamic batch.
    pub fn new() -> World {
        let jobs = JobSystem::new(0);
        let mut scene = SceneStorage::with_capacity(SCENE_CAPACITY);
        let mut batches = BatchTable::with_capacity(4);
        let mut renderer = GpuDrivenRenderer::new(RendererConfig::default());
        let box_mesh = renderer
            .meshes_mut()
            .add(&box_geometry(1.0, 1.0, 1.0, [1, 1, 1]))
            .unwrap()
            + 1;
        let ball = renderer
            .meshes_mut()
            .add(&sphere_geometry(0.5, 8, 6))
            .unwrap()
            + 1;
        let lit = renderer
            .materials_mut()
            .create(Shading::Lit, [1.0, 0.0, 0.0, 1.0])
            .unwrap()
            + 1;
        let unlit = renderer
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
        renderer.set_camera(
            camera,
            Perspective {
                fov_degrees: 60.0,
                near: 0.1,
                far: 100.0,
            },
        );
        renderer.set_sun([-1.0, -2.0, -1.0], [3.0, 3.0, 3.0]);
        renderer.set_ambient([0.4, 0.4, 0.4]);
        World {
            jobs,
            scene,
            batches,
            snapshot: FrameSnapshot::with_capacity(256),
            renderer,
            batch,
            objects,
            frame: 1,
            canvas: (640, 360),
        }
    }

    /// Runs the core's part of the current frame, then records its draw list.
    pub fn record(&mut self, structure_changed: bool) {
        let frame = self.frame;
        if frame > 1 {
            self.scene.begin_frame(frame);
        }
        self.scene.update_transforms(&self.jobs);
        self.batches.update(&self.jobs, frame);
        self.snapshot.record(frame, &self.scene, &self.batches);
        self.renderer
            .record(&FrameInput {
                frame,
                scene: &self.scene,
                batches: &self.batches,
                snapshot: &self.snapshot,
                canvas: self.canvas,
                structure_changed,
            })
            .unwrap();
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

pub fn count(commands: &[(Op, Vec<u32>)], op: Op) -> usize {
    commands.iter().filter(|(o, _)| *o == op).count()
}
