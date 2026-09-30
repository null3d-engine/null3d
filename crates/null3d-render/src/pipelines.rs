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

use null3d_gpu::drawlist::{DrawList, Op, state_flags};

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
}

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

    /// Records the creation of every pipeline that the GPU does not have yet, in id order, and
    /// returns how many it recorded.
    pub fn create_new(&mut self, list: &mut DrawList) -> Result<usize, RecordError> {
        let first = self.created;
        while let Some(key) = self.keys.get(self.created) {
            list.push(
                Op::CreateRenderPipeline,
                &key.operands(self.created as u32 + 1),
            )?;
            self.created += 1;
        }
        Ok(self.created - first)
    }

    /// Every key, in id order: the key at index `k` has id `k + 1`.
    pub fn keys(&self) -> &[PipelineKey] {
        &self.keys
    }

    /// Forgets which pipelines the GPU has, after the thread that draws replaced it, so the next
    /// frame creates each again under the same id.
    pub fn forget(&mut self) {
        self.created = 0;
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
        assert_eq!(cache.create_new(&mut list), Ok(2));
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
        assert_eq!(cache.create_new(&mut list), Ok(0));
        let third = cache.id(lit(vertex::COLOR).in_pass(TARGETS));
        assert_eq!(cache.create_new(&mut list), Ok(1));
        assert_eq!(commands(&list)[0].1[0], third);

        // A new device has none of them: the next list creates all three under the same ids.
        list.clear();
        cache.forget();
        assert_eq!(cache.create_new(&mut list), Ok(3));
        let ids: Vec<u32> = commands(&list).iter().map(|(_, o)| o[0]).collect();
        assert_eq!(ids, [first, second, third]);
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
}
