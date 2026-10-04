//! The render pipeline cache. A render pipeline is keyed by everything that sets it apart: its
//! template, its permutation bits, the vertex format of the meshes it draws, its target formats,
//! its sample count and its state flags. A frame builder asks its cache for the id of each pipeline
//! it draws with, by key, and the builder's next draw list creates each pipeline that the GPU does
//! not have yet, once. An id stays with its key while the builder lives, so layouts, bundles and
//! draw records keep their ids across rebuilds.
//!
//! A key has two parts. What a mesh and material pair decides is a [`DrawKey`]: the template of its
//! shading, the permutation bits of its features, its mesh's vertex format, its state flags and its
//! depth bias. Builders sort their buckets by it. What a pass decides is its [`PassTargets`]: the
//! formats and the sample count of its targets, and the permutation bits that it sets for every
//! pipeline in it.
//!
//! # The depth prepass
//!
//! With the depth prepass, the scene's opaque objects draw twice in each view's render pass. The
//! prepass draws their depth alone into the view's depth. The opaque pass then shades each object
//! only where its depth equals what the prepass left, which is the nearest surface, and writes no
//! depth. A pair whose depth the prepass cannot draw the same way stays out of the prepass and
//! shades as it would without it (see [`DrawKey::prepass`]).
//!
//! The test for equal depth needs both passes to give each pixel the same depth, to the last bit.
//! Each GPU path draws the prepass in the way that does so on it ([`Prepass`]).

use null3d_gpu::drawlist::{DrawList, Op, permutation, state_flags, template};

use crate::frame::RecordError;

/// Everything that sets one render pipeline apart from another: the operands of
/// `CreateRenderPipeline` after the pipeline's id.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PipelineKey {
    /// The shader template (`template::*`).
    pub template: u32,
    /// The permutation bits (`permutation::*`), which pick the template's shader variant.
    pub permutation: u32,
    /// The vertex format (`vertex::*` bits) of the meshes that the pipeline draws.
    pub vertex_format: u32,
    /// The format of the color target, or `format::NONE` for a pipeline that draws depth only.
    pub color_format: u32,
    /// The format of the depth target, or `format::NONE` for a pipeline without depth.
    pub depth_format: u32,
    /// MSAA samples of the targets.
    pub samples: u32,
    /// The state flags (`state_flags::*`).
    pub state: u32,
    /// The depth bias.
    pub bias: DepthBias,
}

impl PipelineKey {
    /// The operands of `CreateRenderPipeline` that create this key's pipeline under `id`.
    pub const fn operands(&self, id: u32) -> [u32; 10] {
        [
            id,
            self.template,
            self.permutation,
            self.color_format,
            self.depth_format,
            self.samples,
            self.state,
            self.vertex_format,
            self.bias.constant as u32,
            self.bias.slope_bits,
        ]
    }
}

/// A pipeline's depth bias as the draw list holds it, in reversed depth: a positive bias moves a
/// surface toward the camera. The constant counts the depth target's smallest steps, and the
/// slope scale multiplies the surface's depth slope. The slope scale is kept as its bits, so keys
/// compare exactly.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DepthBias {
    pub constant: i32,
    pub slope_bits: u32,
}

impl DepthBias {
    /// No bias.
    pub const NONE: DepthBias = DepthBias {
        constant: 0,
        slope_bits: 0,
    };

    /// The bias of three.js's `polygonOffset` with a factor of `slope_scale` and `constant`
    /// units, whose positive values push a surface away from the camera. The constant rounds to a
    /// whole number of steps, as WebGPU takes it.
    pub fn from_polygon_offset(constant: f32, slope_scale: f32) -> Self {
        Self {
            constant: -(constant.round() as i32),
            slope_bits: (-slope_scale + 0.0).to_bits(),
        }
    }
}

/// What a pass draws into, which every pipeline in the pass shares: the formats and the sample
/// count of its targets, and the permutation bits that the pass sets, such as the draw index where
/// WebGL2 draws with multi-draw.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PassTargets {
    pub color_format: u32,
    pub depth_format: u32,
    pub samples: u32,
    pub permutation: u32,
}

impl PassTargets {
    /// The same targets for a shader that reads no draw index, such as a pass's own triangles or
    /// lines: of the pass's bits, only tone mapping on the 8-bit path stays, as scene shaders
    /// apply it.
    pub(crate) const fn tone_map_only(self) -> PassTargets {
        PassTargets {
            permutation: self.permutation & permutation::TONE_MAP,
            ..self
        }
    }

    /// The same targets for the depth template, which writes no color: of the pass's bits, only
    /// the draw index stays.
    pub(crate) const fn depth_only(self) -> PassTargets {
        PassTargets {
            permutation: self.permutation & permutation::DRAW_INDEX,
            ..self
        }
    }
}

/// How a frame builder's depth prepass draws the depth of the pairs that it takes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Prepass {
    /// No depth prepass.
    Off,
    /// With the depth template's prepass build, which computes each position with the same steps
    /// as the shading templates. Every template marks its position invariant, and on WebGPU that
    /// gives both programs the same depth.
    DepthTemplate,
    /// With the shading pipeline's own build and the `PREPASS` bit, which the WebGL2 backend draws
    /// with that build's vertex shader and a fragment shader that writes nothing. On WebGL2, two
    /// programs whose positions take the same steps can still give different depths, although
    /// both mark the position invariant: ANGLE on Metal did so in Chrome on a Mac. Two programs
    /// with the same vertex shader gave the same depths.
    OwnVertexShader,
}

impl Prepass {
    /// This way of drawing the prepass when `on`, else none.
    pub const fn if_on(self, on: bool) -> Prepass {
        if on { self } else { Prepass::Off }
    }
}

/// What a mesh and material pair decides about the pipeline that draws it: the template of the
/// material's shading, the permutation bits of the pair's features, the mesh's vertex format, and
/// the material's state flags and depth bias. Its order is the order in which builders sort their
/// buckets.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DrawKey {
    pub template: u32,
    pub permutation: u32,
    pub vertex_format: u32,
    pub state: u32,
    pub bias: DepthBias,
}

impl DrawKey {
    /// True when the pair blends, so it draws back to front in the transparent pass.
    pub const fn blends(self) -> bool {
        self.state & state_flags::BLEND != 0
    }

    /// The key of the pipeline that draws the pair's depth in the depth prepass with the depth
    /// template ([`Prepass::DepthTemplate`]), or `None` when the pair stays out of the prepass. The
    /// depth template places the vertices of the engine's templates as they do, with the same faces
    /// and depth bias. The prepass cannot follow a pair that blends, discards fragments by their
    /// alpha, skips the depth test or depth writes, or has a custom material, whose vertices may
    /// move, or a sprite material, whose quads turn to face the camera.
    pub const fn prepass(self) -> Option<DrawKey> {
        let unfit = state_flags::BLEND
            | state_flags::LINE_LIST
            | state_flags::NO_DEPTH_WRITE
            | state_flags::NO_DEPTH_TEST;
        if self.state & unfit != 0
            || self.permutation & permutation::ALPHA_MASK != 0
            || self.template >= template::CUSTOM_FIRST
            || self.template == template::SPRITE
            || self.template == template::SPRITE_MAP
        {
            return None;
        }
        let faces = state_flags::CULL_NONE | state_flags::CULL_FRONT;
        Some(DrawKey {
            template: template::SHADOW_DEPTH,
            permutation: permutation::PREPASS | (self.permutation & permutation::SKIN),
            vertex_format: self.vertex_format,
            state: (self.state & faces) | state_flags::NO_COLOR_WRITE,
            bias: self.bias,
        })
    }

    /// The key of the pipeline that shades the pair after the depth prepass drew its depth: it
    /// draws only where its depth equals the target's, and writes none.
    pub const fn after_prepass(self) -> DrawKey {
        DrawKey {
            state: self.state | state_flags::DEPTH_EQUAL | state_flags::NO_DEPTH_WRITE,
            ..self
        }
    }

    /// The key of the pipeline that draws the pair in a pass with these targets.
    pub const fn in_pass(self, targets: PassTargets) -> PipelineKey {
        PipelineKey {
            template: self.template,
            permutation: self.permutation | targets.permutation,
            vertex_format: self.vertex_format,
            color_format: targets.color_format,
            depth_format: targets.depth_format,
            samples: targets.samples,
            state: self.state,
            bias: self.bias,
        }
    }
}

/// The render pipelines that a frame builder draws with, by key. Ids count from 1 in the order in
/// which keys first come, and the GPU has the pipelines of the first `created` keys.
#[derive(Debug, Default)]
pub struct PipelineCache {
    keys: Vec<PipelineKey>,
    created: usize,
    /// The frame whose list created each pipeline that the GPU has, by id - 1.
    created_in: Vec<u32>,
    /// The ids of created pipelines that the cache released, which the next list destroys.
    released: Vec<u32>,
}

/// The template of a released key, which no pipeline has, so no key asks for it again.
const RELEASED: u32 = u32::MAX;

impl PipelineCache {
    /// The id of a key's pipeline. The next [`PipelineCache::create_new`] creates a new key's
    /// pipeline.
    pub fn id(&mut self, key: PipelineKey) -> u32 {
        let index = match self.keys.iter().position(|&k| k == key) {
            Some(index) => index,
            None => {
                self.keys.push(key);
                self.keys.len() - 1
            }
        };
        index as u32 + 1
    }

    /// Records the creation of every pipeline that the GPU does not have yet, in id order, in the
    /// list of `frame`, and returns how many it recorded.
    pub fn create_new(&mut self, list: &mut DrawList, frame: u32) -> Result<usize, RecordError> {
        let mut count = 0;
        while let Some(key) = self.keys.get(self.created) {
            if key.template != RELEASED {
                list.push(
                    Op::CreateRenderPipeline,
                    &key.operands(self.created as u32 + 1),
                )?;
                count += 1;
            }
            match self.created_in.get_mut(self.created) {
                Some(created_in) => *created_in = frame,
                None => self.created_in.push(frame),
            }
            self.created += 1;
        }
        // After the creations, which the thread that draws starts before the rest of the list.
        for id in self.released.drain(..) {
            list.push(Op::DestroyPipeline, &[id])?;
        }
        Ok(count)
    }

    /// Releases every pipeline of each template that `unused` names, such as a custom material's
    /// whose last material was destroyed. The next list destroys the ones the GPU has. Their ids
    /// are not given out again, so a list that a capture replays never names another pipeline
    /// under them; a template that comes back gets new ids.
    pub fn release(&mut self, unused: impl Fn(u32) -> bool) {
        for (index, key) in self.keys.iter_mut().enumerate() {
            if key.template == RELEASED || !unused(key.template) {
                continue;
            }
            if index < self.created {
                self.released.push(index as u32 + 1);
            }
            key.template = RELEASED;
        }
    }

    /// The ids of the pipelines that draw an opaque pair with `key` into a scene pass's `targets`:
    /// the one that shades it, and with a depth prepass, the one that draws its depth first, or 0
    /// for a pair that stays out of the prepass.
    pub fn opaque(&mut self, key: DrawKey, targets: PassTargets, prepass: Prepass) -> (u32, u32) {
        let depth = match key.prepass() {
            Some(depth) if prepass != Prepass::Off => depth,
            _ => return (self.id(key.in_pass(targets)), 0),
        };
        let shading = key.after_prepass().in_pass(targets);
        let depth = match prepass {
            Prepass::OwnVertexShader => PipelineKey {
                permutation: shading.permutation | permutation::PREPASS,
                state: depth.state,
                ..shading
            },
            _ => depth.in_pass(targets.depth_only()),
        };
        (self.id(shading), self.id(depth))
    }

    /// Every key, in id order: the key at index `k` has id `k + 1`.
    pub fn keys(&self) -> &[PipelineKey] {
        &self.keys
    }

    /// True when the pipeline `id` draws once the GPU replays a list that uses it, for a builder
    /// whose thread that draws last drew every pipeline built in frame `pipelines_built`: its list
    /// created the pipeline in that frame or before. Until the thread that draws has drawn a frame,
    /// each frame waits for its pipelines, so every pipeline draws then. After that, a draw whose
    /// pipeline is still building, or waits for its shader file, draws nothing. A pass that must
    /// not draw nothing, such as one that writes the whole canvas, keeps to the pipelines it had
    /// until its new ones are built.
    pub fn built(&self, id: u32, pipelines_built: u32) -> bool {
        let index = id as usize - 1;
        pipelines_built == 0
            || (index < self.created
                && self
                    .created_in
                    .get(index)
                    .is_some_and(|&frame| frame <= pipelines_built))
    }

    /// Forgets which pipelines the GPU has, after the thread that draws replaced it, so the next
    /// frame creates each again under the same id.
    pub fn forget(&mut self) {
        self.created = 0;
        self.released.clear();
    }
}

#[cfg(test)]
mod tests {
    use null3d_gpu::drawlist::{decode, format, permutation, state_flags, template, vertex};

    use super::*;

    const TARGETS: PassTargets = PassTargets {
        color_format: format::CANVAS,
        depth_format: format::DEPTH32_FLOAT,
        samples: 4,
        permutation: permutation::DRAW_INDEX,
    };

    fn lit(vertex_format: u32) -> DrawKey {
        DrawKey {
            template: template::INSTANCED_LIT,
            permutation: 0,
            vertex_format,
            state: 0,
            bias: DepthBias::NONE,
        }
    }

    /// The operands of each command in a list.
    fn commands(list: &DrawList) -> Vec<(Op, Vec<u32>)> {
        decode(list.words())
            .map(|command| {
                let command = command.unwrap();
                (command.op, command.operands.to_vec())
            })
            .collect()
    }

    #[test]
    fn a_key_holds_every_operand_of_its_pipeline_in_the_order_of_the_command() {
        let key = DrawKey {
            template: template::INSTANCED_UNLIT,
            permutation: permutation::TONE_MAP,
            vertex_format: vertex::UV0 | vertex::COLOR,
            state: state_flags::CULL_NONE,
            bias: DepthBias::from_polygon_offset(2.0, -1.5),
        }
        .in_pass(TARGETS);
        assert_eq!(
            key.operands(7),
            [
                7,
                template::INSTANCED_UNLIT,
                permutation::TONE_MAP | permutation::DRAW_INDEX,
                format::CANVAS,
                format::DEPTH32_FLOAT,
                4,
                state_flags::CULL_NONE,
                vertex::UV0 | vertex::COLOR,
                -2i32 as u32,
                1.5f32.to_bits(),
            ]
        );
    }

    #[test]
    fn a_polygon_offset_turns_into_a_bias_of_reversed_depth() {
        // three.js pushes a surface away from the camera with positive values, and reversed depth
        // moves it away with negative ones. The constant rounds to whole steps.
        let away = DepthBias::from_polygon_offset(1.4, 2.0);
        assert_eq!(away.constant, -1);
        assert_eq!(f32::from_bits(away.slope_bits), -2.0);
        let toward = DepthBias::from_polygon_offset(-4.0, -1.0);
        assert_eq!(
            (toward.constant, f32::from_bits(toward.slope_bits)),
            (4, 1.0)
        );
        assert_eq!(
            DepthBias::from_polygon_offset(0.0, 0.0),
            DepthBias::NONE,
            "no offset is no bias, so its pipelines share keys with the default"
        );
    }

    #[test]
    fn keys_that_differ_in_any_part_are_different_pipelines() {
        let base = lit(0).in_pass(TARGETS);
        let others = [
            PipelineKey {
                template: template::INSTANCED_UNLIT,
                ..base
            },
            PipelineKey {
                permutation: 0,
                ..base
            },
            PipelineKey {
                vertex_format: vertex::UV0,
                ..base
            },
            PipelineKey {
                color_format: format::RGBA16_FLOAT,
                ..base
            },
            PipelineKey {
                depth_format: format::NONE,
                ..base
            },
            PipelineKey { samples: 1, ..base },
            PipelineKey {
                state: state_flags::CULL_NONE,
                ..base
            },
            PipelineKey {
                bias: DepthBias::from_polygon_offset(0.0, 1.0),
                ..base
            },
        ];
        let mut cache = PipelineCache::default();
        assert_eq!(cache.id(base), 1);
        for (k, key) in others.iter().enumerate() {
            assert_eq!(cache.id(*key), k as u32 + 2, "{key:?}");
        }
        assert_eq!(cache.id(base), 1, "a key keeps its id");
        assert_eq!(cache.keys().len(), others.len() + 1);
    }

    #[test]
    fn each_pipeline_is_created_once_in_id_order_and_again_after_a_new_device() {
        let mut cache = PipelineCache::default();
        let mut list = DrawList::with_capacity(256);
        let first = cache.id(lit(0).in_pass(TARGETS));
        let second = cache.id(lit(vertex::UV0).in_pass(TARGETS));
        assert_eq!(cache.create_new(&mut list, 1), Ok(2));
        let created = commands(&list);
        assert_eq!(created.len(), 2);
        assert!(
            created
                .iter()
                .all(|(op, _)| *op == Op::CreateRenderPipeline)
        );
        assert_eq!(created[0].1[0], first);
        assert_eq!(
            created[1].1,
            lit(vertex::UV0).in_pass(TARGETS).operands(second)
        );

        // Known keys create nothing; a new key creates only its own pipeline.
        list.clear();
        cache.id(lit(0).in_pass(TARGETS));
        assert_eq!(cache.create_new(&mut list, 1), Ok(0));
        let third = cache.id(lit(vertex::COLOR).in_pass(TARGETS));
        assert_eq!(cache.create_new(&mut list, 1), Ok(1));
        assert_eq!(commands(&list)[0].1[0], third);

        // A new device has none of them: the next list creates all three under the same ids.
        list.clear();
        cache.forget();
        assert_eq!(cache.create_new(&mut list, 1), Ok(3));
        let ids: Vec<u32> = commands(&list).iter().map(|(_, o)| o[0]).collect();
        assert_eq!(ids, [first, second, third]);
    }

    #[test]
    fn a_pipeline_draws_once_a_frame_drew_with_every_pipeline_built_since_its_creation() {
        let mut cache = PipelineCache::default();
        let mut list = DrawList::with_capacity(256);
        let first = cache.id(lit(0).in_pass(TARGETS));
        assert!(cache.built(first, 0), "before the first frame, frames wait");
        assert!(
            !cache.built(first, 4),
            "a pipeline the GPU lacks does not draw"
        );
        cache.create_new(&mut list, 5).unwrap();
        let second = cache.id(lit(vertex::UV0).in_pass(TARGETS));
        cache.create_new(&mut list, 7).unwrap();
        assert!(!cache.built(first, 4));
        assert!(cache.built(first, 5));
        assert!(!cache.built(second, 6));
        assert!(cache.built(second, 7));
        cache.forget();
        cache.create_new(&mut list, 9).unwrap();
        assert!(
            !cache.built(first, 8),
            "a new device builds each pipeline again"
        );
        assert!(cache.built(first, 9));
    }

    #[test]
    fn released_templates_destroy_their_pipelines_once_and_never_reuse_their_ids() {
        let custom = |vertex_format| DrawKey {
            template: template::CUSTOM_FIRST,
            ..lit(vertex_format)
        };
        let mut cache = PipelineCache::default();
        let mut list = DrawList::with_capacity(256);
        let kept = cache.id(lit(0).in_pass(TARGETS));
        let gone = cache.id(custom(0).in_pass(TARGETS));
        cache.create_new(&mut list, 1).unwrap();
        // A key asked for after the last list, which the GPU never had.
        cache.id(custom(vertex::UV0).in_pass(TARGETS));
        cache.release(|t| t == template::CUSTOM_FIRST);
        list.clear();
        assert_eq!(
            cache.create_new(&mut list, 1),
            Ok(0),
            "nothing new is created"
        );
        assert_eq!(commands(&list), [(Op::DestroyPipeline, vec![gone])]);
        list.clear();
        cache.create_new(&mut list, 1).unwrap();
        assert!(
            commands(&list).is_empty(),
            "each pipeline is destroyed once"
        );
        assert_eq!(cache.id(lit(0).in_pass(TARGETS)), kept);
        let back = cache.id(custom(0).in_pass(TARGETS));
        assert_eq!(back, 4, "the template comes back under a new id");
        cache.forget();
        list.clear();
        assert_eq!(
            cache.create_new(&mut list, 1),
            Ok(2),
            "a new device skips released keys"
        );
    }

    #[test]
    fn draw_keys_sort_by_template_then_permutation_then_vertex_format() {
        let mut keys = [
            DrawKey {
                permutation: permutation::VERTEX_COLOR,
                ..lit(0)
            },
            DrawKey {
                template: template::INSTANCED_UNLIT,
                ..lit(0)
            },
            lit(vertex::UV0),
            lit(0),
        ];
        keys.sort();
        assert_eq!(
            keys,
            [
                lit(0),
                lit(vertex::UV0),
                DrawKey {
                    permutation: permutation::VERTEX_COLOR,
                    ..lit(0)
                },
                DrawKey {
                    template: template::INSTANCED_UNLIT,
                    ..lit(0)
                },
            ]
        );
    }

    #[test]
    fn the_prepass_draws_the_depth_of_pairs_whose_depth_its_template_computes_alike() {
        let bias = DepthBias::from_polygon_offset(1.0, 2.0);
        let base = DrawKey {
            template: template::INSTANCED_STANDARD_MAPS,
            permutation: permutation::VERTEX_COLOR | permutation::RECEIVE_SHADOWS,
            vertex_format: vertex::UV0 | vertex::COLOR,
            state: state_flags::CULL_NONE,
            bias,
        };
        // The depth template keeps the vertex format, the faces and the bias, and writes no color.
        assert_eq!(
            base.prepass(),
            Some(DrawKey {
                template: template::SHADOW_DEPTH,
                permutation: permutation::PREPASS,
                vertex_format: vertex::UV0 | vertex::COLOR,
                state: state_flags::CULL_NONE | state_flags::NO_COLOR_WRITE,
                bias,
            })
        );
        let back_faces = DrawKey {
            state: state_flags::CULL_FRONT,
            ..lit(0)
        };
        assert_eq!(
            back_faces.prepass().map(|key| key.state),
            Some(state_flags::CULL_FRONT | state_flags::NO_COLOR_WRITE)
        );
        // Pairs whose fragments the depth template cannot follow stay out.
        let out = [
            DrawKey {
                state: state_flags::BLEND_NORMAL,
                ..lit(0)
            },
            DrawKey {
                permutation: permutation::ALPHA_MASK,
                ..lit(0)
            },
            DrawKey {
                state: state_flags::NO_DEPTH_WRITE,
                ..lit(0)
            },
            DrawKey {
                state: state_flags::NO_DEPTH_TEST,
                ..lit(0)
            },
            DrawKey {
                template: template::CUSTOM_FIRST + 3,
                ..lit(0)
            },
        ];
        for key in out {
            assert_eq!(key.prepass(), None, "{key:?}");
        }
        // After the prepass, the pair draws only at the depth the prepass found, and writes none.
        assert_eq!(
            base.after_prepass().state,
            state_flags::CULL_NONE | state_flags::DEPTH_EQUAL | state_flags::NO_DEPTH_WRITE
        );
    }

    #[test]
    fn opaque_pairs_get_a_depth_pipeline_only_with_the_prepass() {
        let targets = PassTargets {
            permutation: permutation::DRAW_INDEX | permutation::TONE_MAP,
            ..TARGETS
        };
        let mut cache = PipelineCache::default();
        assert_eq!(cache.opaque(lit(0), targets, Prepass::Off), (1, 0));
        let (shading, depth) = cache.opaque(lit(0), targets, Prepass::DepthTemplate);
        assert_eq!((shading, depth), (2, 3));
        let keys = cache.keys();
        assert_eq!(keys[1], lit(0).after_prepass().in_pass(targets));
        // The depth pipeline draws into the pass's targets, with the draw index but no tone mapping.
        let depth = keys[2];
        assert_eq!(depth.template, template::SHADOW_DEPTH);
        assert_eq!(
            depth.permutation,
            permutation::PREPASS | permutation::DRAW_INDEX
        );
        assert_eq!(
            (depth.color_format, depth.depth_format, depth.samples),
            (TARGETS.color_format, TARGETS.depth_format, TARGETS.samples)
        );
        // A masked pair shades as it would without the prepass.
        let masked = DrawKey {
            permutation: permutation::ALPHA_MASK,
            ..lit(0)
        };
        let (shading, depth) = cache.opaque(masked, targets, Prepass::DepthTemplate);
        assert_eq!(depth, 0);
        assert_eq!(cache.keys()[shading as usize - 1], masked.in_pass(targets));
    }

    #[test]
    fn the_webgl2_prepass_draws_with_the_shading_pipelines_own_build() {
        let targets = PassTargets {
            permutation: permutation::DRAW_INDEX | permutation::TONE_MAP,
            ..TARGETS
        };
        let key = DrawKey {
            permutation: permutation::RECEIVE_SHADOWS,
            state: state_flags::CULL_NONE,
            bias: DepthBias::from_polygon_offset(2.0, 1.0),
            ..lit(0)
        };
        let mut cache = PipelineCache::default();
        let (shading, depth) = cache.opaque(key, targets, Prepass::OwnVertexShader);
        assert_eq!((shading, depth), (1, 2));
        let (shading, depth) = (cache.keys()[0], cache.keys()[1]);
        assert_eq!(shading, key.after_prepass().in_pass(targets));
        // The same template and bits, so the same vertex shader, with the faces and the bias of
        // the pair, and no color.
        assert_eq!(
            depth,
            PipelineKey {
                permutation: shading.permutation | permutation::PREPASS,
                state: state_flags::CULL_NONE | state_flags::NO_COLOR_WRITE,
                ..shading
            }
        );
        assert_eq!(Prepass::OwnVertexShader.if_on(false), Prepass::Off);
        let masked = DrawKey {
            permutation: permutation::ALPHA_MASK,
            ..lit(0)
        };
        assert_eq!(cache.opaque(masked, targets, Prepass::OwnVertexShader).1, 0);
    }
}
