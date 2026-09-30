//! A small scene for frame builder tests: a camera, scene objects with two meshes and two
//! materials, and a dynamic instance batch, stepped frame by frame as the engine steps them. The
//! `graph` module declares the engine's render passes for the render graph tests.
#![allow(dead_code)]

pub mod graph;

use std::f64::consts::{PI, TAU};

use null3d_core::handle::Handle;
use null3d_core::instances::BatchTable;
use null3d_core::jobs::JobSystem;
use null3d_core::scene::{Command, SceneStorage, flags};
use null3d_core::snapshot::FrameSnapshot;
use null3d_gpu::drawlist::format;
use null3d_gpu::drawlist::{Op, decode};
use null3d_render::arrays::{MeshArrays, from_arrays};
use null3d_render::camera::Perspective;
use null3d_render::debug_lines::LineStore;
use null3d_render::frame::{FrameBuilder, FrameInput, NO_MESH, RecordError};
use null3d_render::geometry::{Geometry, box_geometry, sphere_geometry};
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::graph::ALL_LAYERS;
use null3d_render::materials::Shading;
use null3d_render::textures::{Sampling, TextureDesc};
use null3d_render::view::{View, ViewId};

pub const SCENE_CAPACITY: u32 = 31;
pub const BATCH_ROWS: u32 = 1000;
/// The lens of every camera in the world.
pub const LENS: Perspective = Perspective {
    fov_degrees: 60.0,
    near: 0.1,
    far: 100.0,
};

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
    /// The debug lines of the frame that records next, which it then forgets, as the engine does.
    pub lines: LineStore,
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
            .add(&base_format(
                box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap(),
            ))
            .unwrap()
            + 1;
        let ball = renderer
            .settings_mut()
            .meshes_mut()
            .add(&base_sphere(0.5, [8, 6]))
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
        settings.set_camera(camera, LENS);
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
            lines: LineStore::default(),
        }
    }

    /// Adds a view from a second camera at `position`, which looks down -z as the first camera
    /// does, with the same lens, and returns it. The camera is a new object, created in the
    /// current frame, so the frame that records next has a structure change.
    pub fn add_view(&mut self, position: [f32; 3]) -> ViewId {
        let camera = self.scene.reserve().unwrap();
        self.scene.set_position(camera, position).unwrap();
        self.scene
            .apply_commands(
                &[Command::create(
                    camera,
                    Handle::NONE,
                    NO_MESH,
                    flags::VISIBLE,
                )],
                self.frame,
            )
            .unwrap();
        self.renderer
            .settings_mut()
            .add_view(View::new(camera, LENS, ALL_LAYERS))
            .unwrap()
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
        self.batches
            .update(&self.jobs, frame, self.scene.cell_table_mut());
        self.snapshot.record(frame, &self.scene, &self.batches);
        let input = FrameInput {
            frame,
            scene: &self.scene,
            batches: &self.batches,
            snapshot: &self.snapshot,
            canvas: self.canvas,
            structure_changed,
            jobs: &self.jobs,
            lines: self.lines.lines(),
        };
        let recorded = self
            .renderer
            .cull(&input)
            .and_then(|()| self.renderer.record(&input));
        self.lines.clear();
        recorded
    }

    /// Draws debug lines in the frame that records next: each pair of points is a line.
    pub fn draw_lines(&mut self, points: &[([f64; 3], u32)]) {
        self.lines.draw(points).unwrap();
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

    /// Adds a texture of `size` texels on each side with an image on its way, a material that maps
    /// it, and a grid object that draws with the material, in the current frame. Returns the
    /// texture, and the engine ids of the mesh and the material.
    pub fn add_mapped(&mut self, size: u32) -> (Handle, u32, u32) {
        let settings = self.renderer.settings_mut();
        let mesh = settings.meshes_mut().add(&grid(1, 1)).unwrap() + 1;
        let texture = settings.textures_mut().create(map_desc(size)).unwrap();
        settings
            .textures_mut()
            .set_image(texture, size, size)
            .unwrap();
        let material = settings
            .materials_mut()
            .create(Shading::UnlitMap, [1.0; 4])
            .unwrap();
        settings.materials_mut().set_map(material, texture).unwrap();
        let object = self.scene.reserve().unwrap();
        self.scene.set_local_radius(object, 1.0).unwrap();
        let commands = [
            Command::create(object, Handle::NONE, mesh, flags::VISIBLE),
            Command::set_material(object, material + 1),
        ];
        self.scene.apply_commands(&commands, self.frame).unwrap();
        (texture, mesh, material + 1)
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

/// A color map of `size` texels on each side, with mip levels and three.js's sampling.
pub fn map_desc(size: u32) -> TextureDesc {
    TextureDesc {
        width: size,
        height: size,
        format: format::RGBA8_UNORM_SRGB,
        mipmaps: true,
        sampling: Sampling::default(),
    }
}

/// A generator's mesh in the base vertex format: its positions and normals, without its texture
/// coordinates.
pub fn base_format(g: Geometry) -> Geometry {
    let floats = g.vertex_floats();
    Geometry {
        format: 0,
        vertices: g
            .vertices
            .chunks(floats)
            .flat_map(|v| &v[..6])
            .copied()
            .collect(),
        indices: g.indices,
    }
}

/// A whole sphere from the engine's generator, in the base vertex format.
pub fn base_sphere(radius: f64, segments: [u32; 2]) -> Geometry {
    base_format(sphere_geometry(radius, segments, (0.0, TAU), (0.0, PI)).unwrap())
}

pub fn count(commands: &[(Op, Vec<u32>)], op: Op) -> usize {
    commands.iter().filter(|(o, _)| *o == op).count()
}

/// A position 1,000 km out along x.
pub fn far_out(x: f32, y: f32, z: f32) -> [f32; 3] {
    [1.0e6 + x, y, z]
}

impl<B: FrameBuilder> World<B> {
    /// Moves the objects and the camera 1,000 km out along x, in the same layout; the batch's rows
    /// stay at the origin.
    pub fn move_far_out(&mut self) {
        for (k, &object) in self.objects.iter().enumerate() {
            let x = k as f32 * 2.0 - 3.0;
            self.scene
                .set_position(object, far_out(x, 0.0, 0.0))
                .unwrap();
        }
        self.scene
            .set_position(self.camera, far_out(0.0, 0.0, 20.0))
            .unwrap();
    }

    /// The index of the grid cell that holds the objects that [`World::move_far_out`] moved,
    /// once a frame has run.
    pub fn far_cell(&self) -> u32 {
        let cell = null3d_core::cells::cell_of(far_out(0.0, 0.0, 0.0));
        self.scene
            .cell_table()
            .find(cell)
            .expect("the objects are there")
    }
}
