//! Sky maps: environment maps of three.js's sky, which follow the scene's sky as the sketch moves
//! its sun or changes its air and clouds, as three.js's `PMREMGenerator.fromScene` makes one from
//! a scene that holds its `Sky`.
//!
//! A sky map is a cube texture whose generator, which the thread that draws holds, made it ready
//! for the sky. The map then fills in stages, one draw-list command each ([`Op::SkyMapStep`]). The
//! thread that draws plans what each stage does, and the map knows only how many there are: the
//! first stages draw the sky into the generator's chain of levels, the next ones filter the map's
//! levels from the chain for their roughness, a few faces each, and the last stage copies every
//! level into the texture at once. Until that copy, frames draw with the map as it was. The first fill records every stage in
//! one frame, so the first frame that draws with the map already has its light. A later change of
//! the sky refreshes the map one stage a frame, so no frame waits for the whole map. A change that
//! comes while a refresh runs waits for it to end, and then starts the next one with the sky as it
//! is then.
//!
//! The map's diffuse light comes from the CPU ([`crate::sky_light`]), worked out when a fill
//! starts. Frames take it in the frame of the last stage, with the map's new levels, so the diffuse
//! light and the reflections change together.

use null3d_core::handle::Handle;
use null3d_gpu::drawlist::{DrawList, Op};

use crate::background::Sky;
use crate::frame::RecordError;
use crate::sky_light::sky_sh;
use crate::textures::TextureStore;

/// Words of a stage's command: the texture, the generator, the stage and the sky's 16 values.
const STEP_WORDS: usize = 19;

/// Coefficients of the diffuse light: red, green and blue for each of nine.
type Sh = [[f32; 3]; 9];

/// One sky map.
#[derive(Clone, Copy, Debug)]
struct SkyMap {
    texture: Handle,
    /// Its stages, the copy included.
    stages: u32,
    /// The sky of the levels that frames draw with, and its diffuse light, once the map is full.
    shown: Option<(Sky, Sh)>,
    /// The fill under way: the next stage to record, and the sky and diffuse light that it makes.
    fill: Option<(u32, Sky, Sh)>,
}

/// The scene's sky maps, and the sky that they show.
#[derive(Debug, Default)]
pub struct SkyMaps {
    /// The sky that the maps show: the settings of the scene's last sky background, or none
    /// before the first.
    sky: Option<Sky>,
    maps: Vec<SkyMap>,
}

impl SkyMaps {
    /// The sky that the maps show, or none before the first.
    pub fn sky(&self) -> Option<Sky> {
        self.sky
    }

    /// Makes the maps show `sky` from the next recorded frame on, in stages.
    pub fn set_sky(&mut self, sky: Sky) {
        self.sky = Some(sky);
    }

    /// Makes cube texture `texture` a sky map of `stages` stages, at least 1, which fills in the
    /// first frame after its generator made it ready. A texture that is a sky map already stays one.
    pub fn add(&mut self, texture: Handle, stages: u32) {
        if self.maps.iter().all(|map| map.texture != texture) {
            self.maps.push(SkyMap {
                texture,
                stages: stages.max(1),
                shown: None,
                fill: None,
            });
        }
    }

    /// The diffuse light of the sky map in `texture`, once frames draw with its levels, or none
    /// for a texture that is not a full sky map.
    pub fn sh(&self, texture: Handle) -> Option<Sh> {
        let map = self.maps.iter().find(|map| map.texture == texture)?;
        map.shown.map(|(_, sh)| sh)
    }

    /// Forgets every map's levels after the thread that draws replaced the GPU: each map fills
    /// whole again once its generator has run on the new device.
    pub fn reset_gpu(&mut self) {
        for map in &mut self.maps {
            map.shown = None;
            map.fill = None;
        }
    }

    /// Records the frame's stages of each map whose texture is ready: every stage of a map that
    /// is not full yet, and the next stage of a refresh. Forgets maps whose texture was destroyed.
    pub(crate) fn record(
        &mut self,
        textures: &TextureStore,
        list: &mut DrawList,
    ) -> Result<(), RecordError> {
        self.maps.retain(|map| textures.is_live(map.texture));
        let Some(sky) = self.sky else {
            return Ok(());
        };
        for map in &mut self.maps {
            let Some((id, _, generator)) = textures.generated_cube(map.texture) else {
                map.shown = None;
                map.fill = None;
                continue;
            };
            let (first, sky, sh) = match map.fill {
                Some(fill) => fill,
                None if map.shown.is_some_and(|(shown, _)| shown == sky) => continue,
                None => (0, sky, sky_sh(&sky)),
            };
            // A map that frames do not draw with yet fills whole at once.
            let copy = map.stages - 1;
            let last = if map.shown.is_none() { copy } else { first };
            for stage in first..=last {
                push_stage(list, id, generator, stage, &sky)?;
            }
            map.fill = if last == copy {
                map.shown = Some((sky, sh));
                None
            } else {
                Some((last + 1, sky, sh))
            };
        }
        Ok(())
    }
}

/// Records stage `stage` of the sky map in cube texture `id`, which generator `generator` holds.
fn push_stage(
    list: &mut DrawList,
    id: u32,
    generator: u32,
    stage: u32,
    sky: &Sky,
) -> Result<(), RecordError> {
    let [x, y, z] = sky.sun_position;
    let [heading, elevation] = sky.second_angles();
    let values = [
        x,
        y,
        z,
        sky.second_sky_weight,
        sky.turbidity,
        sky.rayleigh,
        sky.mie_coefficient,
        sky.mie_directional_g,
        sky.cloud_scale,
        sky.cloud_speed,
        sky.cloud_coverage,
        sky.cloud_density,
        sky.cloud_elevation,
        sky.time,
        heading,
        elevation,
    ];
    let mut words = [0u32; STEP_WORDS];
    words[..3].copy_from_slice(&[id, generator, stage]);
    for (word, value) in words[3..].iter_mut().zip(values) {
        *word = value.to_bits();
    }
    list.push(Op::SkyMapStep, &words)?;
    Ok(())
}
