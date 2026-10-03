//! Skinned objects for the skinning tests: a column of rings skinned to a chain of joints, with a
//! clip that bends the chain back and forth, and the world's animation table that poses it.

use null3d_core::animation::{
    Animations, Channel, Interpolation, NO_PARENT, Play, Skeleton, SourceTrack, resample,
};
use null3d_core::handle::Handle;
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::vertex;
use null3d_render::frame::FrameBuilder;
use null3d_render::geometry::Geometry;
use null3d_render::materials::Shading;

use super::World;

/// Rings of the generated column, one per joint, and vertices around each ring.
pub const RINGS: u32 = 3;
pub const AROUND: u32 = 30;

/// A chain of `joints` joints up the y axis, one unit apart, with no turn at rest.
pub fn chain(joints: u32) -> Skeleton {
    let parents: Vec<u32> = (0..joints)
        .map(|j| if j == 0 { NO_PARENT } else { j - 1 })
        .collect();
    let mut rest = Vec::new();
    let mut binds = Vec::new();
    for j in 0..joints {
        let up = if j == 0 { 0.0 } else { 1.0 };
        rest.extend_from_slice(&[0.0, up, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0]);
        let down = -(j as f32);
        binds.extend_from_slice(&[1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, down, 0.0, 0.0, 1.0, 0.0]);
    }
    Skeleton::new(&parents, &rest, &binds).unwrap()
}

/// A column of rings one unit apart up the y axis, each moved by its own joint, with 16-bit
/// joints, normalized 8-bit weights and texture coordinates, as quantized glTF files hold them.
pub fn column() -> Geometry {
    let joints = vertex::with(
        vertex::UV0 | vertex::JOINTS | vertex::WEIGHTS,
        6,
        vertex::Type::Uint16,
    )
    .unwrap();
    let format = vertex::with(joints, 7, vertex::Type::Unorm8).unwrap();
    let mut g = Geometry {
        format,
        ..Geometry::default()
    };
    for ring in 0..RINGS {
        for k in 0..AROUND {
            let angle = k as f32 / AROUND as f32 * std::f32::consts::TAU;
            let (x, z) = (0.4 * angle.cos(), 0.4 * angle.sin());
            for v in [x, ring as f32, z, angle.cos(), 0.0, angle.sin(), 0.0, 0.0] {
                g.vertices.extend_from_slice(&v.to_le_bytes());
            }
            g.vertices
                .extend_from_slice(&[ring as u8, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0]);
        }
    }
    for ring in 0..RINGS - 1 {
        for k in 0..AROUND {
            let a = ring * AROUND + k;
            let b = ring * AROUND + (k + 1) % AROUND;
            g.indices
                .extend_from_slice(&[a, a + AROUND, b, b, a + AROUND, b + AROUND]);
        }
    }
    g
}

impl<B: FrameBuilder> World<B> {
    /// Adds a skinned column at `position`, in the current frame, which casts shadows and plays a
    /// clip that bends its chain back and forth, from an animated instance of its own. The first
    /// call makes the world's animation table, which the frames then step by 1/60 s.
    pub fn add_skinned(&mut self, position: [f32; 3]) -> Handle {
        let animations = self.animations.get_or_insert_with(|| {
            let mut animations = Animations::new(&self.jobs, 64, 1024).unwrap();
            animations.add_skeleton(chain(RINGS)).unwrap();
            let bend = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.38, 0.92, 0.0, 0.0, 0.0, 1.0];
            let tracks: Vec<SourceTrack> = (1..RINGS)
                .map(|joint| SourceTrack {
                    joint,
                    channel: Channel::Rotation,
                    interpolation: Interpolation::Linear,
                    times: &[0.0, 0.5, 1.0],
                    values: &bend,
                })
                .collect();
            let clip = resample(animations.skeleton(0).unwrap(), &tracks, 30.0).unwrap();
            animations.add_clip(0, clip).unwrap();
            animations
        });
        self.animation_step = 1.0 / 60.0;
        let instance = animations.add_instance(0).unwrap();
        let play = Play {
            layer: 0,
            fade: 0.0,
            speed: 1.0,
            looping: true,
            additive: false,
        };
        animations.play(instance, 0, play).unwrap();
        let settings = self.renderer.settings_mut();
        let mesh = settings.meshes_mut().add(&column()).unwrap() + 1;
        let material = settings
            .materials_mut()
            .create(Shading::Lit, 0, [1.0; 4])
            .unwrap()
            + 1;
        let object = self.scene.reserve().unwrap();
        self.scene.set_position(object, position).unwrap();
        let shown = flags::VISIBLE | flags::CAST_SHADOWS;
        let commands = [
            Command::create(object, Handle::NONE, mesh, shown),
            Command::set_material(object, material),
            Command::set_skin(object, Some(instance)),
        ];
        self.scene.apply_commands(&commands, self.frame).unwrap();
        object
    }
}
