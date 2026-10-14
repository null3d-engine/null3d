//! Whether the lit templates shade rectangle and tube lights. Their builds with the
//! `AREA_LIGHTS` permutation bit hold the area lights' code in the light loop, and load on first
//! use. Builds without it leave that code out, so a scene without area lights does not pay for it
//! (decision records D-145 and D-156).
//!
//! Area shading turns on once the scene holds an area light, the area lights' tables have
//! arrived, and every lit pipeline in use has its build with the bit. Until then frames draw with
//! the builds without it, and the light grid lists no area light, so no build meets a light whose
//! code it lacks. It turns off as soon as the scene holds no area light, since the builds without
//! the bit are there.
use null3d_gpu::drawlist::{permutation, template};

use crate::pipelines::{DrawKey, PipelineCache, PipelineKey};

/// True for a template whose light loop shades area lights in its `AREA_LIGHTS` builds. Custom
/// materials always build the area lights' code, so their keys never take the bit.
pub const fn shades_area_lights(template: u32) -> bool {
    template == template::INSTANCED_LIT
        || template == template::INSTANCED_STANDARD_MAPS
        || template == template::LINE_LIT
}

/// Whether the lit templates shade area lights, and the pipelines that the switch waits for.
#[derive(Debug, Default)]
pub struct AreaShading {
    /// True while the lit templates draw with their `AREA_LIGHTS` builds.
    on: bool,
    /// The ids of the `AREA_LIGHTS` pipelines that must be built before area shading turns on,
    /// empty before they are asked for.
    waiting: Vec<u32>,
}

impl AreaShading {
    /// True while the lit templates draw with their `AREA_LIGHTS` builds, and the light grid
    /// lists area lights.
    pub fn on(&self) -> bool {
        self.on
    }

    /// Moves toward `wanted`: on when the scene holds an area light whose tables have arrived.
    /// Before the first frame, while `pipelines_built` is 0, it turns on at once, as that frame
    /// waits for every pipeline. After it, it first asks `pipelines` for the `AREA_LIGHTS` build of
    /// each lit pipeline that exists, and turns on once all of them are built. Returns true when it
    /// turns on or off, so the layouts take their keys again. It allocates only while it asks.
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
                    if shades_area_lights(key.template)
                        && key.permutation & permutation::AREA_LIGHTS == 0
                    {
                        let with = key.permutation | permutation::AREA_LIGHTS;
                        let id = pipelines.id(PipelineKey {
                            permutation: with,
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

    /// The key that a pair draws with: `key` with the `AREA_LIGHTS` bit while area shading is on
    /// and its template shades area lights.
    pub fn key(&self, key: DrawKey) -> DrawKey {
        if self.on && shades_area_lights(key.template) {
            DrawKey {
                permutation: key.permutation | permutation::AREA_LIGHTS,
                ..key
            }
        } else {
            key
        }
    }

    /// Turns area shading off after the thread that draws replaced the GPU, whose pipelines build
    /// again, so the switch waits for them as the first time.
    pub fn forget_gpu(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use null3d_gpu::drawlist::{DrawList, format};

    use super::*;
    use crate::pipelines::{DepthBias, PassTargets};

    const TARGETS: PassTargets = PassTargets {
        color_format: format::CANVAS,
        depth_format: format::DEPTH32_FLOAT,
        samples: 1,
        permutation: 0,
    };

    fn key(template: u32) -> DrawKey {
        DrawKey {
            template,
            permutation: permutation::RECEIVE_SHADOWS,
            vertex_format: 0,
            state: 0,
            bias: DepthBias::NONE,
        }
    }

    #[test]
    fn area_shading_turns_on_once_the_lit_builds_with_area_lights_are_built_and_off_at_once() {
        let mut cache = PipelineCache::default();
        let mut list = DrawList::with_capacity(256);
        let lit = key(template::INSTANCED_LIT);
        let unlit = key(template::INSTANCED_UNLIT);
        cache.id(lit.in_pass(TARGETS));
        cache.id(unlit.in_pass(TARGETS));
        cache.create_new(&mut list, 1).unwrap();
        let mut shading = AreaShading::default();
        assert!(!shading.update(false, &mut cache, 1));
        // Wanted after the first frame: it asks for the lit pipeline's build with the bit alone,
        // and waits for it.
        assert!(!shading.update(true, &mut cache, 1));
        assert_eq!(cache.keys().len(), 3);
        let with = DrawKey {
            permutation: permutation::RECEIVE_SHADOWS | permutation::AREA_LIGHTS,
            ..lit
        };
        assert_eq!(cache.keys()[2], with.in_pass(TARGETS));
        assert_eq!(shading.key(lit), lit, "frames draw without it meanwhile");
        cache.create_new(&mut list, 2).unwrap();
        assert!(!shading.update(true, &mut cache, 1), "not built by frame 1");
        assert!(shading.update(true, &mut cache, 2));
        assert!(shading.on());
        assert_eq!(shading.key(lit), with);
        assert_eq!(shading.key(unlit), unlit, "unlit templates keep their keys");
        let custom = key(template::CUSTOM_FIRST);
        assert_eq!(
            shading.key(custom),
            custom,
            "custom materials always shade them"
        );
        assert!(!shading.update(true, &mut cache, 3));
        // Off as soon as the scene holds no area light; on again at once before a first frame.
        assert!(shading.update(false, &mut cache, 3));
        assert_eq!(shading.key(lit), lit);
        shading.forget_gpu();
        assert!(shading.update(true, &mut cache, 0));
        assert_eq!(
            cache.keys().len(),
            3,
            "the first frame waits for every pipeline"
        );
    }
}
