//! Whether the lit meshes draw through the light probe grid's templates (D-146). Their builds hold
//! the grid's sampling in the light's loop and load on first use. The plain lit templates carry no
//! grid code, so a page that sets no grid never downloads it.
//!
//! Probe shading turns on once the scene sets a grid whose texture is on the GPU and the pipelines
//! in use have their grid builds. Until then frames draw with the plain lit templates, and the
//! frame's values name no grid, so no build meets a grid it cannot read. It turns off as soon as
//! the scene sets no grid, since the plain builds are there.
//!
//! The grid templates build a smaller set of permutation bits than the plain lit templates do, so a
//! pair that carries one of the bits they leave out keeps its plain template and draws without grid
//! light (H-2 of the 15 October review).
use null3d_gpu::drawlist::{permutation, template};

use crate::pipelines::{DrawKey, PipelineCache, PipelineKey};

/// The permutation bits of the lit templates that the grid templates build without, at most. A
/// pair with one of them keeps its plain template while probe shading is on, and draws without grid
/// light.
pub const NO_PROBE_BUILD: u32 = permutation::AREA_LIGHTS
    | permutation::TRANSMISSION
    | permutation::LOD_FADE
    | permutation::WEIGHTED
    | permutation::COAT_SHEEN;

/// The grid template that a pair of `template` and `permutation` draws through while probe shading
/// is on, or `template` when it has no grid build.
pub const fn probe_template(template: u32, permutation: u32) -> u32 {
    if permutation & NO_PROBE_BUILD != 0 {
        return template;
    }
    match template {
        template::INSTANCED_LIT => template::PROBE_GRID,
        template::INSTANCED_STANDARD_MAPS => template::PROBE_GRID_MAPS,
        other => other,
    }
}

/// Whether lit meshes draw through the grid's templates, and the pipelines that the switch waits
/// for.
#[derive(Debug, Default)]
pub struct ProbeShading {
    /// True while lit meshes draw through the grid's templates.
    on: bool,
    /// The ids of the grid pipelines that must be built before probe shading turns on.
    waiting: Vec<u32>,
}

impl ProbeShading {
    /// True while lit meshes draw through the grid's templates.
    pub fn on(&self) -> bool {
        self.on
    }

    /// Moves toward `wanted`: on when the scene sets a grid whose texture is on the GPU. Before the
    /// first frame, while `pipelines_built` is 0, it turns on at once, as that frame waits for
    /// every pipeline. After it, it first asks `pipelines` for the grid build of each lit pipeline
    /// that exists, and turns on once all of them are built. Returns true when it turns on or off,
    /// so the layouts take their keys again. It allocates only while it asks.
    pub fn update(
        &mut self,
        wanted: bool,
        pipelines: &mut PipelineCache,
        pipelines_built: u32,
    ) -> bool {
        if !wanted {
            self.waiting.clear();
            return std::mem::replace(&mut self.on, false);
        }
        if self.on {
            return false;
        }
        if pipelines_built != 0 {
            if self.waiting.is_empty() {
                for k in 0..pipelines.keys().len() {
                    let key = pipelines.keys()[k];
                    let probe = probe_template(key.template, key.permutation);
                    if probe != key.template {
                        let id = pipelines.id(PipelineKey {
                            template: probe,
                            ..key
                        });
                        self.waiting.push(id);
                    }
                }
                if !self.waiting.is_empty() {
                    return false;
                }
            } else if !pipelines.all_built(self.waiting.iter().copied(), pipelines_built) {
                return false;
            }
        }
        self.waiting.clear();
        self.on = true;
        true
    }

    /// The key that a pair draws with: through a grid template while probe shading is on.
    pub fn key(&self, key: DrawKey) -> DrawKey {
        if self.on {
            DrawKey {
                template: probe_template(key.template, key.permutation),
                ..key
            }
        } else {
            key
        }
    }

    /// Turns probe shading off after the thread that draws replaced the GPU, whose pipelines build
    /// again, so the switch waits for them as the first time.
    pub fn forget_gpu(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The permutation names that a `[shaders.<name>]` table of shaders.toml lists for `device`.
    fn listed(toml: &str, shader: &str, device: &str) -> Vec<String> {
        let table = toml
            .split(&format!("[shaders.{shader}]\n"))
            .nth(1)
            .expect("the shader's table");
        let line = table
            .lines()
            .find(|line| line.starts_with(&format!("variants.{device} ")))
            .expect("the device's variants");
        let list = line.split("permutations = [").nth(1).expect("a list");
        let list = &list[..list.find(']').expect("the list's end")];
        list.split(',')
            .map(|name| name.trim().trim_matches('"').to_owned())
            .filter(|name| !name.is_empty())
            .collect()
    }

    #[test]
    fn the_bits_without_probe_builds_follow_the_shader_lists() {
        let toml = include_str!("../../null3d-shaders/shaders.toml");
        let bits = [
            ("AREA_LIGHTS", permutation::AREA_LIGHTS),
            ("TRANSMISSION", permutation::TRANSMISSION),
            ("LOD_FADE", permutation::LOD_FADE),
            ("WEIGHTED", permutation::WEIGHTED),
            ("COAT_SHEEN", permutation::COAT_SHEEN),
        ];
        for (plain, probe) in [("lit", "probe_grid"), ("standard_maps", "probe_grid_maps")] {
            for device in ["webgpu", "webgl2"] {
                let probes = listed(toml, probe, device);
                let mut missing: Vec<String> = listed(toml, plain, device)
                    .into_iter()
                    .filter(|name| !probes.contains(name))
                    .collect();
                missing.sort();
                let mut named: Vec<String> = bits.iter().map(|(n, _)| (*n).to_owned()).collect();
                named.sort();
                assert_eq!(
                    missing, named,
                    "{plain} on {device}: the bits that {probe} builds without"
                );
            }
        }
        assert_eq!(
            bits.iter().fold(0, |all, (_, bit)| all | bit),
            NO_PROBE_BUILD
        );
    }

    #[test]
    fn a_pair_with_a_bit_without_probe_builds_keeps_its_template() {
        assert_eq!(
            probe_template(template::INSTANCED_LIT, 0),
            template::PROBE_GRID
        );
        assert_eq!(
            probe_template(template::INSTANCED_STANDARD_MAPS, permutation::SKIN),
            template::PROBE_GRID_MAPS
        );
        assert_eq!(
            probe_template(template::INSTANCED_LIT, permutation::AREA_LIGHTS),
            template::INSTANCED_LIT
        );
        assert_eq!(
            probe_template(template::INSTANCED_UNLIT, 0),
            template::INSTANCED_UNLIT
        );
    }
}
