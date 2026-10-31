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

use null3d_core::frames::frame_after;
use null3d_gpu::drawlist::{DrawList, Op, format, permutation, state_flags, template};

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

    /// The occluders' pass of occlusion culling: the depth target alone, with one sample, whatever
    /// the scene's samples.
    pub(crate) const fn occluder_depth(self) -> PassTargets {
        PassTargets {
            color_format: format::NONE,
            samples: 1,
            ..self.depth_only()
        }
    }
}

/// How a frame builder draws the depth of opaque pairs before the pass that shades them, if at all.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Prepass {
    /// No such pass.
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
    /// The occluders' pass of occlusion culling: a render pass of its own with no color target,
    /// whose depth the depth pyramid reads. The pairs then shade as they would without it.
    Occluders,
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
    /// True when the pair blends over what lies behind it.
    pub const fn blends(self) -> bool {
        self.state & state_flags::BLEND != 0
    }

    /// True when the pair lets light through: its shader samples the copy of the opaque objects'
    /// color behind it.
    pub const fn transmits(self) -> bool {
        self.permutation & permutation::TRANSMISSION != 0
    }

    /// True when the pair draws back to front in the transparent pass, after the opaque objects:
    /// it blends, or it lets light through. A decal blends, but draws in the decal pass instead.
    pub const fn sorts(self) -> bool {
        (self.blends() || self.transmits()) && !self.decal()
    }

    /// True for a decal's pair: the box of its object projects the material onto the surfaces
    /// inside it, in the decal pass after the camera's opaque pass. Such a pair draws in no other
    /// pass: it casts no shadow, has no depth and no outline.
    pub const fn decal(self) -> bool {
        self.template == template::DECAL || self.template == template::DECAL_MAPS
    }

    /// True when the pair leaves the opaque buckets for a pass that culls and orders its rows on
    /// the job workers: the transparent pass or the decal pass.
    pub const fn leaves_opaque(self) -> bool {
        self.sorts() || self.decal()
    }

    /// True when the pair writes depth wherever it draws, so a background drawn after the opaque
    /// objects leaves its pixels alone.
    pub const fn writes_depth(self) -> bool {
        self.state & (state_flags::NO_DEPTH_WRITE | state_flags::NO_DEPTH_TEST) == 0
    }

    /// The key of the pipeline that draws the pair's depth in the depth prepass with the depth
    /// template ([`Prepass::DepthTemplate`]), or `None` when the pair stays out of the prepass. The
    /// depth template places the vertices of the engine's templates as they do, with the same faces
    /// and depth bias. The prepass cannot follow a pair that blends, discards fragments by their
    /// alpha or by a fading level of detail's dither, lets light through, skips the depth test or
    /// depth writes, or has a line material, whose fragment shader cuts out round ends and dashes. A pair whose template places its own vertices
    /// ([`DrawKey::places_own_vertices`]) takes only the key's faces and state, and draws with its
    /// own vertex shader.
    pub const fn prepass(self) -> Option<DrawKey> {
        let unfit = state_flags::BLEND
            | state_flags::LINE_LIST
            | state_flags::NO_DEPTH_WRITE
            | state_flags::NO_DEPTH_TEST;
        if self.state & unfit != 0
            || self.permutation
                & (permutation::ALPHA_MASK | permutation::TRANSMISSION | permutation::LOD_FADE)
                != 0
            || self.template == template::LINE
            || self.template == template::LINE_LIT
        {
            return None;
        }
        let faces = state_flags::CULL_NONE | state_flags::CULL_FRONT;
        let kept = permutation::SKIN | permutation::INSTANCE_INDEX;
        Some(DrawKey {
            template: template::SHADOW_DEPTH,
            permutation: permutation::PREPASS | (self.permutation & kept),
            vertex_format: self.vertex_format,
            state: (self.state & faces) | state_flags::NO_COLOR_WRITE,
            bias: self.bias,
        })
    }

    /// True for a pair whose template places its vertices in a way that the depth template does not
    /// follow: a custom material, whose vertex offset may move them, a displaced standard material,
    /// or a sprite material, whose quads turn to face the camera. The prepass draws such a pair
    /// with its own vertex shader on every path, as WebGL2 draws every pair
    /// ([`Prepass::OwnVertexShader`]).
    pub const fn places_own_vertices(self) -> bool {
        self.template >= template::CUSTOM_FIRST
            || self.permutation & permutation::DISPLACEMENT != 0
            || self.template == template::SPRITE
            || self.template == template::SPRITE_MAP
    }

    /// True for a pair that blends and culls no faces, whose transparent draws can show its back
    /// faces through its front faces: a mesh template's, not a sprite's or a line's, which face
    /// the camera, nor a debug view's.
    pub const fn blends_both_faces(self) -> bool {
        self.blends()
            && self.state & state_flags::CULL_NONE != 0
            && !matches!(
                self.template,
                template::SPRITE
                    | template::SPRITE_MAP
                    | template::LINE
                    | template::LINE_LIT
                    | template::PARTICLE
                    | template::PARTICLE_MAP
                    | template::DEBUG_VIEW
            )
    }

    /// The pair's key with only its back faces, or only its front faces when `front`, which a
    /// double-sided pair that blends draws one after the other, as three.js does. Back faces light
    /// as the double-sided pair's do.
    pub const fn faces(self, front: bool) -> DrawKey {
        let culled = if front { 0 } else { state_flags::CULL_FRONT };
        DrawKey {
            state: (self.state & !(state_flags::CULL_NONE | state_flags::CULL_FRONT)) | culled,
            ..self
        }
    }

    /// The key of the pipeline that draws the pair in the camera's weighted layer (see
    /// [`crate::weighted`]): the build that writes the weighted color sum and the coverage, which
    /// both add into their targets, so the order of draws does not matter. It writes no depth, and
    /// a double-sided pair draws both faces in one draw. It lets no light through a thin surface.
    pub const fn weighted(self) -> DrawKey {
        DrawKey {
            permutation: (self.permutation & !permutation::TRANSLUCENCY) | permutation::WEIGHTED,
            state: (self.state & !state_flags::BLEND)
                | state_flags::BLEND_ADDITIVE
                | state_flags::NO_DEPTH_WRITE,
            ..self
        }
    }

    /// The permutation bits that the moment layer's builds carry for a pair of `template`, or 0
    /// for a template that has none. A pair whose key holds any other bit keeps the transparent
    /// pass's sort: the moment layer has no build for it, and a shader build cannot be asked for
    /// one that it does not make (decision record D-261).
    pub const fn moment_bits(template: u32) -> u32 {
        let lit = permutation::TONE_MAP
            | permutation::VERTEX_COLOR
            | permutation::RECEIVE_SHADOWS
            | permutation::AREA_LIGHTS
            | permutation::SKIN
            | permutation::MORPH
            | permutation::DRAW_INDEX
            | permutation::ROW_VALUES
            | permutation::TRANSLUCENCY;
        match template {
            template::INSTANCED_LIT => lit,
            template::INSTANCED_STANDARD_MAPS => lit | permutation::DISPLACEMENT,
            template::INSTANCED_UNLIT | template::INSTANCED_UNLIT_MAP => {
                permutation::TONE_MAP
                    | permutation::VERTEX_COLOR
                    | permutation::SKIN
                    | permutation::MORPH
                    | permutation::DRAW_INDEX
                    | permutation::ROW_VALUES
            }
            template::SPRITE | template::SPRITE_MAP => {
                permutation::TONE_MAP | permutation::DRAW_INDEX
            }
            _ => 0,
        }
    }

    /// True for a pair that the moment layer draws: a blended pair of a template that has moment
    /// builds, whose key holds only the bits that those builds carry. A double-sided pair draws
    /// both faces in one draw, and a pair that lets light through, tests no depth or blends
    /// additively or by multiplication keeps the sort.
    pub const fn moment_drawn(self) -> bool {
        let bits = Self::moment_bits(self.template);
        bits != 0
            && self.blends()
            && !self.transmits()
            && self.permutation & !bits == 0
            && self.state & state_flags::NO_DEPTH_TEST == 0
            && self.state & (state_flags::BLEND & !state_flags::BLEND_NORMAL) == 0
    }

    /// The key of the pipeline that writes a pair of [`Self::moment_drawn`] into the moment layer's
    /// moment store (see [`crate::moment`]): four power moments of the fragment's optical depth,
    /// which add into the target, so the order of the draws does not matter. It uses the outline
    /// mask's permutation value, which no template with a moment build lists otherwise, so its
    /// builds load with the moment layer alone. It writes no depth, and a double-sided pair draws
    /// both faces in one draw.
    pub const fn moment(self) -> DrawKey {
        DrawKey {
            permutation: (self.permutation & Self::moment_bits(self.template))
                | permutation::OUTLINE_VISIBLE,
            state: (self.state & !state_flags::BLEND)
                | state_flags::BLEND_ADDITIVE
                | state_flags::NO_DEPTH_WRITE,
            ..self
        }
    }

    /// The key of the pipeline that draws the same pair again into the moment layer's colour sum,
    /// from the moment store's transmittance at the fragment's own depth. Its template is the
    /// template's own moment colour template, a shader entry of its own (decision record D-261).
    pub const fn moment_colour(self) -> DrawKey {
        DrawKey {
            template: template::moment_colour(self.template),
            permutation: self.permutation & Self::moment_bits(self.template),
            state: (self.state & !state_flags::BLEND)
                | state_flags::BLEND_ADDITIVE
                | state_flags::NO_DEPTH_WRITE,
            ..self
        }
    }

    /// True for a pair whose template has WebGPU builds that read each instance by index from
    /// storage buffers ([`permutation::INSTANCE_INDEX`]): the engine's templates that the culling
    /// shader draws, apart from those that only tests and development builds draw. Custom
    /// materials, sprites, lines and meshes skinned in the vertex shader read the culling shader's
    /// copies.
    pub const fn reads_index(self) -> bool {
        permutation::buildable(self.permutation | permutation::INSTANCE_INDEX)
            && matches!(
                self.template,
                template::INSTANCED_LIT
                    | template::INSTANCED_STANDARD_MAPS
                    | template::INSTANCED_UNLIT
                    | template::INSTANCED_UNLIT_MAP
                    | template::SHADOW_DEPTH
                    | template::OUTLINE_MASK
            )
    }

    /// The same key with the build that reads each instance by index.
    pub const fn by_index(self) -> DrawKey {
        DrawKey {
            permutation: self.permutation | permutation::INSTANCE_INDEX,
            ..self
        }
    }

    /// The key of the pipeline that shades the pair after the depth prepass drew its depth: it
    /// draws only where its depth equals the target's, and writes none.
    pub const fn after_prepass(self) -> DrawKey {
        DrawKey {
            state: self.state | state_flags::DEPTH_EQUAL | state_flags::NO_DEPTH_WRITE,
            ..self
        }
    }

    /// The key of the pipeline that draws the pair in a pass with these targets. A masked pair
    /// with alpha to coverage fades its alpha ([`permutation::ALPHA_COVERAGE`]) where the targets
    /// have more than one sample, and tests it as a plain mask where they have one. A target
    /// without alpha cannot turn alpha into coverage, so there the shader writes the coverage
    /// itself ([`permutation::SAMPLE_MASK`]).
    pub const fn in_pass(self, targets: PassTargets) -> PipelineKey {
        let mut permutation = self.permutation | targets.permutation;
        let mut state = self.state;
        if state & state_flags::ALPHA_TO_COVERAGE != 0 {
            state &= !state_flags::ALPHA_TO_COVERAGE;
            if targets.samples > 1 && permutation & permutation::ALPHA_MASK != 0 {
                permutation |= permutation::ALPHA_COVERAGE;
                if format::covers_by_alpha(targets.color_format) {
                    state |= state_flags::ALPHA_TO_COVERAGE;
                } else {
                    permutation |= permutation::SAMPLE_MASK;
                }
            }
        }
        PipelineKey {
            template: self.template,
            permutation,
            vertex_format: self.vertex_format,
            color_format: targets.color_format,
            depth_format: targets.depth_format,
            samples: targets.samples,
            state,
            bias: self.bias,
        }
    }
}

/// True when a pipeline that the list of frame `created` made is built, for a builder whose thread
/// that draws last drew every pipeline built in frame `pipelines_built`: `created` is that frame or
/// one before it. Frames compare by their order around the count, which goes round.
pub fn built_by(created: u32, pipelines_built: u32) -> bool {
    !frame_after(created, pipelines_built)
}

/// True when the thread that draws has built the pipelines that frame `created` made, or has not
/// drawn a frame yet: until it has drawn one, each frame waits for its pipelines, so every pipeline
/// draws then. A held scene records every frame before the thread that draws draws one, so no held
/// frame needs work kept back for that alone.
pub fn built_by_or_first(created: u32, pipelines_built: u32) -> bool {
    pipelines_built == 0 || built_by(created, pipelines_built)
}

/// True when a pipeline of `template` reads the frame's clock from the frame's values: the physical
/// sky, whose stars twinkle, and every custom material, whose shaders may read the time. The
/// still-camera comparison leaves the clock out (see [`crate::still`]), so a frame that draws with
/// such a pipeline must not read as still: its image changes with the clock alone.
pub fn reads_frame_clock(template: u32) -> bool {
    template == template::BACKGROUND_ATMOSPHERE || template >= template::CUSTOM_FIRST
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
    /// the one that shades it, and with a `prepass`, the one that draws its depth first, or 0 for a
    /// pair that stays out of it. After a depth prepass the pair shades only at the depth that the
    /// prepass found; the occluders' pass leaves its shading as it is. A pair that places its own
    /// vertices hides nothing in the occluders' pass, which draws with the depth template: its
    /// moved vertices would hide what the pair does not.
    pub fn opaque(&mut self, key: DrawKey, targets: PassTargets, prepass: Prepass) -> (u32, u32) {
        let depth = match key.prepass() {
            Some(_) if prepass == Prepass::Occluders && key.places_own_vertices() => {
                return (self.id(key.in_pass(targets)), 0);
            }
            Some(depth) if prepass != Prepass::Off => depth,
            _ => return (self.id(key.in_pass(targets)), 0),
        };
        if prepass == Prepass::Occluders {
            return (
                self.id(key.in_pass(targets)),
                self.id(depth.in_pass(targets.occluder_depth())),
            );
        }
        let shading = key.after_prepass().in_pass(targets);
        let depth = if prepass == Prepass::OwnVertexShader || key.places_own_vertices() {
            // The WebGL2 prepass draws with the shading build's own shader, whose fragment stage
            // writes nothing. Its pipeline therefore names no color target: a screen step may split
            // the prepass from the opaque pass into a framebuffer of depth alone, and the pipeline
            // fits either pass (D-269).
            let color_format = if prepass == Prepass::OwnVertexShader {
                format::NONE
            } else {
                shading.color_format
            };
            PipelineKey {
                color_format,
                permutation: shading.permutation | permutation::PREPASS,
                state: depth.state,
                ..shading
            }
        } else {
            depth.in_pass(targets.depth_only())
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
                    .is_some_and(|&frame| built_by(frame, pipelines_built)))
    }

    /// True when a pipeline that the cache holds reads the frame's clock from the frame's values,
    /// by [`reads_frame_clock`]. A frame of such a builder never reads as still.
    pub fn reads_clock(&self) -> bool {
        self.keys
            .iter()
            .any(|key| key.template != RELEASED && reads_frame_clock(key.template))
    }

    /// True when every pipeline of `ids` draws, by [`Self::built`].
    pub fn all_built(&self, mut ids: impl Iterator<Item = u32>, pipelines_built: u32) -> bool {
        ids.all(|id| self.built(id, pipelines_built))
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

    /// The permutation names that a `[shaders.<name>]` table of shaders.toml lists for the variant
    /// `variant` (see the manifest).
    fn listed(toml: &str, shader: &str, variant: &str) -> Vec<String> {
        let table = toml
            .split(&format!("[shaders.{shader}]\n"))
            .nth(1)
            .expect("the shader's table");
        let line = table
            .lines()
            .find(|line| line.starts_with(&format!("variants.{variant} ")))
            .unwrap_or_else(|| {
                panic!(
                    "{shader} has no variant {variant}:\n{}",
                    &table[..table.len().min(800)]
                )
            });
        let list = line.split("permutations = [").nth(1).expect("a list");
        let list = &list[..list.find(']').expect("the list's end")];
        list.split(',')
            .map(|name| name.trim().trim_matches('"').to_owned())
            .filter(|name| !name.is_empty())
            .collect()
    }

    /// The bits of a manifest list, apart from a device's half-precision bit, which changes no
    /// permutation of a draw.
    fn listed_bits(names: &[String]) -> u32 {
        names
            .iter()
            .filter(|name| name.as_str() != "HALF")
            .map(|name| permutation::bit(name).expect("a permutation bit"))
            .fold(0, |all, bit| all | bit)
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
    fn the_manifest_lists_the_bits_that_a_moment_build_carries() {
        // A pipeline whose bits a shader entry does not list finds no build and draws nothing, so
        // the renderer's bit mask and the manifest's lists must agree.
        let toml = include_str!("../../null3d-shaders/shaders.toml");
        for (entry, template) in [
            ("moment_lit", template::INSTANCED_LIT),
            ("moment_standard_maps", template::INSTANCED_STANDARD_MAPS),
            ("moment_unlit", template::INSTANCED_UNLIT),
            ("moment_unlit_map", template::INSTANCED_UNLIT_MAP),
            ("moment_sprite", template::SPRITE),
            ("moment_sprite_map", template::SPRITE_MAP),
        ] {
            for (device, absent) in [
                // A WebGPU build reads no draw index and morphs in the skinning pass instead.
                ("webgpu", permutation::DRAW_INDEX | permutation::MORPH),
                ("webgl2", 0),
            ] {
                let bits = listed_bits(&listed(toml, entry, device));
                let carried = DrawKey::moment_bits(template);
                assert_eq!(
                    bits & !carried,
                    0,
                    "{entry}.{device} lists a bit that a moment build does not carry"
                );
                assert_eq!(
                    carried & !bits & !absent,
                    0,
                    "{entry}.{device} lacks a bit that a moment build needs"
                );
            }
        }
        // The moment pass's own builds, in the mesh entries, list the same bits and the outline
        // mask's value.
        for (entry, template) in [
            ("lit", template::INSTANCED_LIT),
            ("standard_maps", template::INSTANCED_STANDARD_MAPS),
            ("unlit", template::INSTANCED_UNLIT),
            ("unlit_map", template::INSTANCED_UNLIT_MAP),
            ("sprite", template::SPRITE),
            ("sprite_map", template::SPRITE_MAP),
        ] {
            for (device, absent) in [
                ("webgpu", permutation::DRAW_INDEX | permutation::MORPH),
                ("webgl2", 0),
            ] {
                let names = listed(
                    toml,
                    entry,
                    &format!(
                        "moment_{}",
                        if device == "webgpu" { "wgpu" } else { device }
                    ),
                );
                assert!(
                    names.iter().any(|name| name == "OUTLINE_VISIBLE"),
                    "{entry}.moment_{device} holds the outline mask's value"
                );
                let bits = listed_bits(&names) & !permutation::OUTLINE_VISIBLE;
                let carried = DrawKey::moment_bits(template);
                assert_eq!(
                    bits & !carried,
                    0,
                    "{entry}.moment_{device} lists a bit that a moment build does not carry"
                );
                assert_eq!(
                    carried & !bits & !absent,
                    0,
                    "{entry}.moment_{device} lacks a bit that a moment build needs"
                );
            }
        }
    }

    #[test]
    fn the_moment_layer_draws_only_the_pairs_whose_bits_its_builds_carry() {
        // A blended lit pair with the bits that a moment build has draws in both passes.
        let pair = DrawKey {
            state: state_flags::BLEND_NORMAL | state_flags::CULL_NONE,
            permutation: permutation::TONE_MAP | permutation::VERTEX_COLOR,
            ..lit(vertex::UV0)
        };
        assert!(pair.moment_drawn());
        let moment = pair.moment();
        assert_eq!(
            moment.permutation,
            permutation::TONE_MAP | permutation::VERTEX_COLOR | permutation::OUTLINE_VISIBLE
        );
        assert_eq!(
            moment.state & state_flags::BLEND,
            state_flags::BLEND_ADDITIVE
        );
        let colour = pair.moment_colour();
        assert_eq!(colour.template, template::MOMENT_LIT);
        assert_eq!(
            colour.permutation,
            permutation::TONE_MAP | permutation::VERTEX_COLOR
        );
        // Each of these keeps the transparent pass's sort.
        for unsupported in [
            // A feature that no moment build carries.
            DrawKey {
                permutation: permutation::COAT_SHEEN,
                ..pair
            },
            // A pair that lets light through.
            DrawKey {
                permutation: permutation::TRANSMISSION,
                ..pair
            },
            // A mask, an additive pair, a pair that skips the depth test, and a template with no
            // moment build.
            DrawKey {
                permutation: permutation::ALPHA_MASK,
                ..pair
            },
            DrawKey {
                state: state_flags::BLEND_ADDITIVE,
                ..pair
            },
            DrawKey {
                state: state_flags::BLEND_NORMAL | state_flags::NO_DEPTH_TEST,
                ..pair
            },
            DrawKey {
                template: template::LINE,
                ..pair
            },
        ] {
            assert!(!unsupported.moment_drawn(), "{unsupported:?}");
        }
        // The bit set of each template that has builds matches its manifest entries.
        for (template, bits) in [
            (
                template::INSTANCED_LIT,
                permutation::VERTEX_COLOR | permutation::SKIN,
            ),
            (template::SPRITE, permutation::TONE_MAP),
            (template::LINE, 0),
        ] {
            assert_eq!(DrawKey::moment_bits(template) & bits, bits);
        }
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
    fn a_pipeline_created_in_the_last_frame_of_the_count_draws_once_the_first_frame_is_built() {
        use null3d_core::frames::{FIRST_FRAME, previous_frame};
        let last = previous_frame(FIRST_FRAME);
        assert!(built_by(last, FIRST_FRAME));
        assert!(!built_by(FIRST_FRAME, last));
        assert!(built_by(FIRST_FRAME, 2));
        let mut cache = PipelineCache::default();
        let mut list = DrawList::with_capacity(256);
        let id = cache.id(lit(0).in_pass(TARGETS));
        cache.create_new(&mut list, last).unwrap();
        assert!(!cache.built(id, previous_frame(last)));
        assert!(cache.built(id, last));
        assert!(
            cache.built(id, FIRST_FRAME),
            "frame 1 follows the last frame"
        );
        let late = cache.id(lit(vertex::UV0).in_pass(TARGETS));
        cache.create_new(&mut list, FIRST_FRAME).unwrap();
        assert!(
            !cache.built(late, last),
            "the last frame comes before frame 1"
        );
        assert!(cache.built(late, FIRST_FRAME));
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
                permutation: permutation::LOD_FADE,
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
        ];
        for key in out {
            assert_eq!(key.prepass(), None, "{key:?}");
        }
        // A custom material and a sprite place their own vertices, so they draw their depth with
        // their own vertex shader on every path, with the depth key's faces and state.
        for template in [
            template::CUSTOM_FIRST + 3,
            template::SPRITE,
            template::SPRITE_MAP,
        ] {
            let key = DrawKey { template, ..base };
            assert!(key.places_own_vertices());
            let mut cache = PipelineCache::default();
            let (shading, depth) = cache.opaque(key, TARGETS, Prepass::DepthTemplate);
            let [shading, depth] = [shading, depth].map(|id| cache.keys()[id as usize - 1]);
            assert_eq!(depth.template, template);
            assert_eq!(
                depth.permutation,
                shading.permutation | permutation::PREPASS
            );
            assert_eq!(depth.state, key.prepass().unwrap().state);
        }
        assert!(!base.places_own_vertices());
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
    fn occluders_draw_depth_alone_and_shade_as_without_them() {
        let mut cache = PipelineCache::default();
        let (shading, depth) = cache.opaque(lit(0), TARGETS, Prepass::Occluders);
        let keys = cache.keys();
        assert_eq!(keys[shading as usize - 1], lit(0).in_pass(TARGETS));
        let depth = keys[depth as usize - 1];
        assert_eq!(depth.template, template::SHADOW_DEPTH);
        assert_eq!(
            (depth.color_format, depth.depth_format, depth.samples),
            (format::NONE, TARGETS.depth_format, 1)
        );
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
        // the pair. The build's fragment shader writes nothing, so its pipeline names no color
        // target: the prepass draws into the opaque pass's color, or into a depth-only pass of its
        // own, and one pipeline fits both (D-269).
        assert_eq!(
            depth,
            PipelineKey {
                color_format: format::NONE,
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

    #[test]
    fn the_depth_template_prepass_keeps_the_color_that_webgpu_attaches() {
        let key = DrawKey {
            template: template::CUSTOM_FIRST,
            ..lit(0)
        };
        let mut cache = PipelineCache::default();
        let (_, depth) = cache.opaque(key, TARGETS, Prepass::DepthTemplate);
        // The pair draws with its own vertex shader, but the depth template's pass keeps the
        // scene's color on WebGPU, so the pipeline names it.
        let depth = cache.keys()[depth as usize - 1];
        assert_eq!(depth.color_format, TARGETS.color_format);
        assert_eq!(
            depth.state & state_flags::NO_COLOR_WRITE,
            state_flags::NO_COLOR_WRITE
        );
    }

    #[test]
    fn alpha_to_coverage_turns_on_where_the_pass_can_turn_alpha_into_coverage() {
        let covered = DrawKey {
            permutation: permutation::ALPHA_MASK,
            state: state_flags::ALPHA_TO_COVERAGE,
            ..lit(0)
        };
        let fade = permutation::ALPHA_COVERAGE;
        let own = permutation::SAMPLE_MASK;
        let pass = |key: DrawKey, color_format, samples| {
            let pass = key.in_pass(PassTargets {
                color_format,
                samples,
                ..TARGETS
            });
            (
                pass.state & state_flags::ALPHA_TO_COVERAGE != 0,
                pass.permutation & (fade | own),
            )
        };
        // A multisampled target with alpha turns it on in the pipeline, over the faded alpha.
        assert_eq!(pass(covered, format::CANVAS, 4), (true, fade));
        assert_eq!(pass(covered, format::RGBA16_FLOAT, 4), (true, fade));
        // One without alpha takes the builds that write the samples themselves.
        assert_eq!(
            pass(covered, format::RG11B10_UFLOAT, 4),
            (false, fade | own)
        );
        // With one sample it is a plain mask.
        assert_eq!(pass(covered, format::CANVAS, 1), (false, 0));
        assert_eq!(pass(covered, format::RG11B10_UFLOAT, 1), (false, 0));
        // Without the masked build there is no alpha to fade.
        let unmasked = DrawKey {
            permutation: 0,
            ..covered
        };
        assert_eq!(pass(unmasked, format::CANVAS, 4), (false, 0));
        // Every pipeline key holds the bits that its bits need.
        let key = covered.in_pass(PassTargets {
            color_format: format::RG11B10_UFLOAT,
            ..TARGETS
        });
        assert!(permutation::buildable(key.permutation));
        // A masked pair never joins the prepass.
        assert_eq!(covered.prepass(), None);
    }

    #[test]
    fn a_double_sided_pair_that_blends_splits_into_its_back_and_front_faces() {
        let glass = DrawKey {
            state: state_flags::CULL_NONE | state_flags::BLEND_NORMAL,
            ..lit(0)
        };
        assert!(glass.blends_both_faces());
        assert_eq!(
            glass.faces(false).state,
            state_flags::CULL_FRONT | state_flags::BLEND_NORMAL
        );
        assert_eq!(glass.faces(true).state, state_flags::BLEND_NORMAL);
        let one_sided = DrawKey {
            state: state_flags::BLEND_NORMAL,
            ..lit(0)
        };
        let opaque = DrawKey {
            state: state_flags::CULL_NONE,
            ..lit(0)
        };
        assert!(!one_sided.blends_both_faces());
        assert!(!opaque.blends_both_faces());
        for faces_camera in [
            template::SPRITE,
            template::SPRITE_MAP,
            template::LINE,
            template::LINE_LIT,
            template::PARTICLE,
            template::PARTICLE_MAP,
        ] {
            let quad = DrawKey {
                template: faces_camera,
                ..glass
            };
            assert!(!quad.blends_both_faces(), "template {faces_camera}");
        }
    }

    /// Every shader that reads the clock from the frame's values must have its templates in
    /// `reads_frame_clock`, or a still view of it would rest while its image still changes. A
    /// shader that reads a clock from its own block, which the frame uploads each frame, needs
    /// nothing: the comparison sees that block change.
    #[test]
    fn only_the_shaders_that_reads_frame_clock_names_read_the_frame_clock() {
        fn walk(dir: &std::path::Path, found: &mut Vec<String>) {
            for entry in std::fs::read_dir(dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    walk(&path, found);
                } else if path.extension().is_some_and(|e| e == "wgsl")
                    && std::fs::read_to_string(&path)
                        .unwrap()
                        .contains("frame.clock")
                {
                    found.push(path.file_name().unwrap().to_string_lossy().into_owned());
                }
            }
        }
        let wgsl = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../null3d-shaders/wgsl");
        let mut found = Vec::new();
        walk(&wgsl, &mut found);
        found.sort();
        // The physical sky draws with its own template; the frame values that custom materials
        // read come from the builtins. A sky layer moves its clouds with the clock, so the layer
        // shader reads it too.
        assert_eq!(
            found,
            [
                "background_layer.wgsl",
                "builtins.wgsl",
                "sky_physical.wgsl"
            ]
        );
        assert!(reads_frame_clock(template::BACKGROUND_ATMOSPHERE));
        assert!(reads_frame_clock(template::CUSTOM_FIRST));
        assert!(!reads_frame_clock(template::FINAL));
    }
}
