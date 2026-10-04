//! A small scene for frame builder tests: a camera, scene objects with two meshes and two
//! materials, and a dynamic instance batch, stepped frame by frame as the engine steps them. The
//! `graph` module declares the engine's render passes for the render graph tests.
#![allow(dead_code)]

pub mod blended;
pub mod graph;
pub mod skinned;

use std::f64::consts::{PI, TAU};

use null3d_core::animation::Animations;
use null3d_core::handle::Handle;
use null3d_core::instances::BatchTable;
use null3d_core::jobs::JobSystem;
use null3d_core::layers::DEFAULT_LAYERS;
use null3d_core::lights::{LightShadow, LightTable, SunShadow, VisibleLight, kind, value};
use null3d_core::scene::{Command, SceneStorage, flags};
use null3d_core::snapshot::FrameSnapshot;
use null3d_gpu::drawlist::format;
use null3d_gpu::drawlist::{Op, decode};
use null3d_gpu::mock::MockBackend;
use null3d_render::arrays::{MeshArrays, from_arrays};
use null3d_render::camera::{Lens, Perspective};
use null3d_render::debug_lines::LineStore;
use null3d_render::frame::{FrameBuilder, FrameInput, NO_MESH, RecordError};
use null3d_render::geometry::{Geometry, box_geometry, sphere_geometry};
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::graph::{ALL_LAYERS, RenderScale};
use null3d_render::materials::{MapSlot, Shading};
use null3d_render::skinning;
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
    /// The point and spot lights that the camera sees, as the core's light table lists them.
    pub lights: Vec<VisibleLight>,
    /// The point and spot lights that cast shadows, as the core's light table lists them.
    pub shadow_lights: Vec<LightShadow>,
    /// The newest frame that the thread that draws drew with every pipeline built.
    pub pipelines_built: u32,
    /// A light table that each frame gathers its lights from, as the engine does, or `None` to
    /// take `lights` and `shadow_lights` as they are.
    pub light_table: Option<LightTable>,
    /// The render scale of the frames that record next.
    pub render_scale: RenderScale,
    /// The animation table, whose step runs at the start of each frame's core work, as the
    /// engine's does, and the seconds that each step advances.
    pub animations: Option<Animations>,
    pub animation_step: f32,
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
    pub fn build(renderer: B) -> World<B> {
        World::build_sized(renderer, SCENE_CAPACITY)
    }

    /// The world, drawn by `renderer`, with room for `capacity` scene objects.
    pub fn build_sized(mut renderer: B, capacity: u32) -> World<B> {
        let jobs = JobSystem::new(0);
        let mut scene = SceneStorage::with_capacity(capacity);
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
            .create(Shading::Lit, 0, [1.0, 0.0, 0.0, 1.0])
            .unwrap()
            + 1;
        let unlit = renderer
            .settings_mut()
            .materials_mut()
            .create(Shading::Unlit, 0, [0.0, 0.0, 1.0, 1.0])
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
            lights: Vec::new(),
            shadow_lights: Vec::new(),
            pipelines_built: u32::MAX,
            light_table: None,
            render_scale: RenderScale::FULL,
            animations: None,
            animation_step: 0.0,
        }
    }

    /// Turns on the sun's shadows, straight down, in `cascades` cascades that reach 40 meters.
    pub fn cast_sun_shadows(&mut self, cascades: u32) {
        let settings = self.renderer.settings_mut();
        settings.set_sun([0.0, -1.0, 0.0], [3.0; 3]);
        settings.set_sun_shadow(Some(SunShadow {
            cascades,
            map_size: 1024,
            bias: 0.5,
            normal_bias: 1.0,
            distance: 40.0,
            layers: DEFAULT_LAYERS,
        }));
    }

    /// Adds a spot light at `position` that points straight down and casts shadows, with a range
    /// of `range` meters and a cone of about 54 degrees, created in the current frame. Its row
    /// goes into the world's light table, which it makes when the world has none.
    pub fn add_spot(&mut self, position: [f32; 3], range: f32) -> Handle {
        self.add_light(kind::SPOT, position, range)
    }

    /// Adds a point light at `position` that casts shadows, with a range of `range` meters, as
    /// [`World::add_spot`] adds a spot light.
    pub fn add_point(&mut self, position: [f32; 3], range: f32) -> Handle {
        self.add_light(kind::POINT, position, range)
    }

    fn add_light(&mut self, light_kind: u32, position: [f32; 3], range: f32) -> Handle {
        let object = self.scene.reserve().unwrap();
        self.scene.set_position(object, position).unwrap();
        // A quarter turn back about X points the light's -Z axis straight down.
        let down = [
            -std::f32::consts::FRAC_1_SQRT_2,
            0.0,
            0.0,
            std::f32::consts::FRAC_1_SQRT_2,
        ];
        self.scene.set_rotation(object, down).unwrap();
        let shown = flags::VISIBLE | flags::CAST_SHADOWS;
        self.scene
            .apply_commands(
                &[Command::create(object, Handle::NONE, NO_MESH, shown)],
                self.frame,
            )
            .unwrap();
        let table = self.light_table.get_or_insert_with(LightTable::new);
        let light = table.create(object, light_kind).unwrap();
        table.set_value(light, value::RANGE, range).unwrap();
        table.set_value(light, value::ANGLE, 0.95).unwrap();
        object
    }

    /// Adds a view from a second camera at `position`, which looks down -z as the first camera
    /// does, with the same lens, and returns it. The camera is a new object, created in the
    /// current frame, so the frame that records next has a structure change.
    pub fn add_view(&mut self, position: [f32; 3]) -> ViewId {
        self.add_view_through(position, LENS)
    }

    /// As [`World::add_view`], with its own lens.
    pub fn add_view_through(&mut self, position: [f32; 3], lens: impl Into<Lens>) -> ViewId {
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
            .add_view(View::new(camera, lens, ALL_LAYERS))
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
        if let Some(animations) = self.animations.as_mut() {
            animations.update(&self.jobs, self.animation_step);
            let meshes = self.renderer.settings().meshes();
            skinning::update_bounds(&mut self.scene, animations, meshes);
        }
        self.scene.update_transforms(&self.jobs);
        self.batches
            .update(&self.jobs, frame, self.scene.cell_table_mut());
        self.snapshot.record(frame, &self.scene, &self.batches);
        if let Some(table) = self.light_table.as_mut() {
            let parity = self.scene.parity();
            let settings = self.renderer.settings_mut();
            settings.gather_lights(table, &self.scene, parity, self.canvas);
            self.lights.clear();
            self.lights.extend_from_slice(table.visible());
            self.shadow_lights.clear();
            self.shadow_lights.extend_from_slice(table.shadows());
        }
        let input = FrameInput {
            frame,
            scene: &self.scene,
            batches: &self.batches,
            snapshot: &self.snapshot,
            canvas: self.canvas,
            render_scale: self.render_scale,
            structure_changed,
            jobs: &self.jobs,
            lines: self.lines.lines(),
            lights: &self.lights,
            shadow_lights: &self.shadow_lights,
            pipelines_built: self.pipelines_built,
            animations: self.animations.as_ref(),
        };
        let recorded = self
            .renderer
            .cull(&input)
            .and_then(|()| self.renderer.record(&input));
        self.lines.clear();
        let rebuilt = recorded?;
        self.check_pipelines_first();
        Ok(rebuilt)
    }

    /// Checks that the frame's list creates its pipelines before any other command, as the thread
    /// that draws expects: it starts to build them before it replays the rest.
    fn check_pipelines_first(&self) {
        let mut other = false;
        for command in decode(self.renderer.list(self.frame).words()) {
            let op = command.unwrap().op;
            let creates = matches!(op, Op::CreateRenderPipeline | Op::CreateComputePipeline);
            assert!(
                !(creates && other),
                "frame {}: {op:?} comes after other commands",
                self.frame
            );
            other |= !creates;
        }
    }

    /// Draws debug lines in the frame that records next: each pair of points is a line.
    pub fn draw_lines(&mut self, points: &[([f64; 3], u32)]) {
        self.lines.draw(points).unwrap();
    }

    /// Adds a mesh and a material to the builder, and an object that draws with them, in the
    /// current frame. Returns the engine mesh id.
    pub fn add_object(&mut self, mesh: &Geometry, shading: Shading) -> u32 {
        self.add_object_with(mesh, shading, 0)
    }

    /// As [`World::add_object`], with a material of the `features` bits.
    pub fn add_object_with(&mut self, mesh: &Geometry, shading: Shading, features: u32) -> u32 {
        let settings = self.renderer.settings_mut();
        let mesh = settings.meshes_mut().add(mesh).unwrap() + 1;
        let material = settings
            .materials_mut()
            .create(shading, features, [1.0, 1.0, 1.0, 1.0])
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
            .set_image(texture, size, size, 0)
            .unwrap();
        let material = settings
            .materials_mut()
            .create(Shading::UnlitMap, 0, [1.0; 4])
            .unwrap();
        settings
            .materials_mut()
            .set_map(material, MapSlot::BaseColor, texture, false)
            .unwrap();
        let object = self.scene.reserve().unwrap();
        self.scene.set_local_radius(object, 1.0).unwrap();
        let commands = [
            Command::create(object, Handle::NONE, mesh, flags::VISIBLE),
            Command::set_material(object, material + 1),
        ];
        self.scene.apply_commands(&commands, self.frame).unwrap();
        (texture, mesh, material + 1)
    }

    /// The thread that draws holds images 1 to `count`, of `size` texels on each side, and took
    /// the frames before the current one.
    pub fn arrive(&mut self, mock: &mut MockBackend, count: u32, size: u32) {
        for image in 1..=count {
            mock.provide_image(image, size, size);
        }
        let taken = self.frame - 1;
        self.renderer
            .settings_mut()
            .textures_mut()
            .sync(count, taken);
    }

    /// Records the current frame and replays it twice on the mock, as a capture replays a frame's
    /// list again, then moves on to the next frame. Returns the frame's operations.
    pub fn step(&mut self, mock: &mut MockBackend, structure_changed: bool) -> Vec<(Op, Vec<u32>)> {
        self.record(structure_changed);
        for _ in 0..2 {
            mock.replay(self.renderer.list(self.frame).words()).unwrap();
        }
        let commands = self.commands();
        self.frame += 1;
        commands
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
        positions: (&positions[..]).into(),
        uvs: Some((&uvs[..]).into()),
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
        depth: 1,
        format: format::RGBA8_UNORM_SRGB,
        mipmaps: true,
        levels: 1,
        sampling: Sampling::default(),
    }
}

/// A generator's mesh in the base vertex format: its positions and normals, without its texture
/// coordinates.
pub fn base_format(g: Geometry) -> Geometry {
    let base = null3d_gpu::drawlist::vertex::stride(0) as usize;
    Geometry {
        format: 0,
        vertices: g
            .vertices
            .chunks(g.stride())
            .flat_map(|v| &v[..base])
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

/// A small seeded random number generator (xorshift), so each test scene is the same every run.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }

    /// The next number in [0, 1).
    pub fn next(&mut self) -> f32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 40) as f32 / (1u64 << 24) as f32
    }

    /// A number in [lo, hi).
    pub fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.next()
    }

    /// True with chance `p`.
    pub fn chance(&mut self, p: f32) -> bool {
        self.next() < p
    }
}

/// Half the side of the square that [`World::spread`] fills: 2.5 grid cells, so the square covers
/// the 5 x 5 cells around the origin cell.
pub const SPREAD_HALF_SIDE: f32 = 2.5 * 1024.0;
/// The lens of a spread world's cameras, which see into the cells around them.
pub const WIDE_LENS: Perspective = Perspective {
    fov_degrees: 70.0,
    near: 0.5,
    far: 1500.0,
};

impl<B: FrameBuilder> World<B> {
    /// Spreads the world over the 5 x 5 grid cells around the origin, at seeded random places:
    /// `objects` more scene objects, some hidden, some dynamic and some under a dynamic parent,
    /// and a static batch of `rows` rows, which it returns. The world's own objects and batch stay
    /// at the origin, and its camera gets [`WIDE_LENS`]. Call it before the first frame.
    pub fn spread(&mut self, objects: u32, rows: u32, seed: u64) -> Handle {
        let mut rng = Rng::new(seed);
        let mut commands = Vec::new();
        let mut roots: Vec<(Handle, bool)> = Vec::new();
        for _ in 0..objects {
            let object = self.scene.reserve().unwrap();
            let size = rng.range(0.5, 40.0);
            self.scene.set_scale(object, [size; 3]).unwrap();
            self.scene.set_local_radius(object, 0.9).unwrap();
            let visible = if rng.chance(0.1) { 0 } else { flags::VISIBLE };
            let dynamic = if rng.chance(0.15) { flags::DYNAMIC } else { 0 };
            // A few hang under an earlier root: moving with it when it is dynamic.
            let parent = match roots.len() {
                0 => None,
                n if rng.chance(0.1) => Some(roots[(rng.next() * n as f32) as usize % n].0),
                _ => None,
            };
            let position = if parent.is_some() {
                [rng.range(-30.0, 30.0), 0.0, rng.range(-30.0, 30.0)]
            } else {
                [
                    rng.range(-SPREAD_HALF_SIDE, SPREAD_HALF_SIDE),
                    rng.range(-50.0, 50.0),
                    rng.range(-SPREAD_HALF_SIDE, SPREAD_HALF_SIDE),
                ]
            };
            self.scene.set_position(object, position).unwrap();
            let (mesh, material) = (1 + rng.chance(0.5) as u32, 1 + rng.chance(0.5) as u32);
            let flags = visible | dynamic;
            commands.push(Command::create(
                object,
                parent.unwrap_or(Handle::NONE),
                mesh,
                flags,
            ));
            commands.push(Command::set_material(object, material));
            if parent.is_none() {
                roots.push((object, dynamic != 0));
            }
            self.objects.push(object);
        }
        self.scene.apply_commands(&commands, self.frame).unwrap();
        let batch = self.batches.create(rows, false, false, 1, 1, 0.9).unwrap();
        let still = self.batches.get_mut(batch).unwrap();
        for position in still.positions_mut().as_chunks_mut::<3>().0 {
            *position = [
                rng.range(-SPREAD_HALF_SIDE, SPREAD_HALF_SIDE),
                rng.range(-50.0, 50.0),
                rng.range(-SPREAD_HALF_SIDE, SPREAD_HALF_SIDE),
            ];
        }
        self.renderer
            .settings_mut()
            .set_camera(self.camera, WIDE_LENS);
        batch
    }

    /// Puts the camera at `position`, turned `yaw` radians about +y from looking down -z, and
    /// tilted `pitch` radians up.
    pub fn aim(&mut self, position: [f32; 3], yaw: f32, pitch: f32) {
        let (sy, cy) = (yaw * 0.5).sin_cos();
        let (sp, cp) = (pitch * 0.5).sin_cos();
        // The turn about y, then the tilt about the turned x.
        let rotation = [cy * sp, sy * cp, -sy * sp, cy * cp];
        self.scene.set_position(self.camera, position).unwrap();
        self.scene.set_rotation(self.camera, rotation).unwrap();
    }
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
