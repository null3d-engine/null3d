//! Morphed objects for the morph target tests: the common world's box, whose first target lifts
//! its top face and whose second pushes its +x face out, with a block of weights of its own.

use null3d_core::handle::Handle;
use null3d_core::scene::{Command, flags};
use null3d_render::frame::FrameBuilder;
use null3d_render::geometry::{Geometry, box_geometry};
use null3d_render::materials::Shading;
use null3d_render::morph::MorphTargets;

use super::{World, base_format};

/// The morphed box's targets: how far each lifts or pushes a vertex at weight 1.
pub const LIFT: f32 = 0.5;
pub const PUSH: f32 = 0.25;

/// The common world's box, before its targets.
pub fn morph_box() -> Geometry {
    base_format(box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap())
}

/// The box's two targets' position deltas, target after target.
pub fn box_deltas(g: &Geometry) -> Vec<f32> {
    let vertices = g.vertex_count();
    let mut deltas = vec![0.0; 2 * vertices * 3];
    for v in 0..vertices {
        let [x, y, _] = g.position(v);
        if y > 0.0 {
            deltas[v * 3 + 1] = LIFT;
        }
        if x > 0.0 {
            deltas[(vertices + v) * 3] = PUSH;
        }
    }
    deltas
}

impl<B: FrameBuilder> World<B> {
    /// Adds an object of a new morphed box at `position`, in the current frame, which casts
    /// shadows and draws with a lit material, or a material of `shading`. Its weights start at
    /// `weights`. Returns the object and its block of weights.
    pub fn add_morphed_with(
        &mut self,
        position: [f32; 3],
        weights: [f32; 2],
        shading: Shading,
    ) -> (Handle, u32) {
        let g = morph_box();
        let deltas = box_deltas(&g);
        let targets = MorphTargets {
            targets: 2,
            positions: Some(&deltas),
            normals: None,
            tangents: None,
            colors: None,
        };
        let settings = self.renderer.settings_mut();
        let mesh = settings.meshes_mut().add_morphed(&g, &targets).unwrap() + 1;
        let material = settings
            .materials_mut()
            .create(shading, 0, [1.0; 4])
            .unwrap()
            + 1;
        let block = self.morphs.create(2).unwrap();
        let first = self.morphs.block(block).unwrap().first as usize;
        self.morphs.values_mut()[first..first + 2].copy_from_slice(&weights);
        let object = self.scene.reserve().unwrap();
        self.scene.set_position(object, position).unwrap();
        let shown = flags::VISIBLE | flags::CAST_SHADOWS;
        let commands = [
            Command::create(object, Handle::NONE, mesh, shown),
            Command::set_material(object, material),
            Command::set_morph(object, Some(block)),
        ];
        self.scene.apply_commands(&commands, self.frame).unwrap();
        (object, block)
    }

    /// As [`World::add_morphed_with`], with a lit material.
    pub fn add_morphed(&mut self, position: [f32; 3], weights: [f32; 2]) -> (Handle, u32) {
        self.add_morphed_with(position, weights, Shading::Lit)
    }

    /// Sets weight `k` of block `block`, which the next frame draws.
    pub fn set_weight(&mut self, block: u32, k: usize, weight: f32) {
        let first = self.morphs.block(block).unwrap().first as usize;
        self.morphs.values_mut()[first + k] = weight;
    }
}
