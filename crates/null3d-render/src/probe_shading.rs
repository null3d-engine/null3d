//! Whether the lit meshes draw through the light probe grid's templates (D-146). Their builds hold
//! the grid's sampling in the light's loop and load on first use. The plain lit templates carry no
//! grid code, so a page that sets no grid never downloads it.
//!
//! Probe shading turns on once the scene sets a grid whose texture is on the GPU and the pipelines
//! in use have their grid builds. Until then frames draw with the plain lit templates, and the
//! frame's values name no grid, so no build meets a grid it cannot read. It turns off as soon as
//! the scene sets no grid, since the plain builds are there.
use null3d_gpu::drawlist::template;

use crate::pipelines::{DrawKey, PipelineCache, PipelineKey};

/// The grid template that `template` draws through while probe shading is on, or `template`.
pub const fn grid_template(template: u32) -> u32 {
    match template {
        template::INSTANCED_LIT => template::PROBE_GRID,
        template::INSTANCED_STANDARD_MAPS => template::PROBE_GRID_MAPS,
        other => other,
    }
}

/// True for a template that has a light probe grid build.
fn shades_probe_grid(template: u32) -> bool {
    template == template::INSTANCED_LIT || template == template::INSTANCED_STANDARD_MAPS
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
                    if shades_probe_grid(key.template) {
                        let id = pipelines.id(PipelineKey {
                            template: grid_template(key.template),
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
                template: grid_template(key.template),
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
