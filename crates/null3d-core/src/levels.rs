//! The rule that picks a mesh's level of detail for a source in a view.
//!
//! A mesh with levels has simpler meshes for its lower levels, each with its error: the largest
//! distance between the level's surface and the base mesh's, in the units of the base mesh's
//! positions. Errors grow from level to level. A source draws the last level whose error passes:
//!
//! ```text
//! level j draws while error[j] × scale × factor < distance
//! ```
//!
//! `scale` is the largest axis scale of the source's world matrix, and `distance` the distance from
//! the view's camera to the centre of the source's bounding sphere, or 1 for an orthographic
//! camera, whose pixels do not shrink with distance. `factor` is the render height in pixels times
//! the projection's `P[1][1]`, over twice the threshold in pixels. The base level's error is 0, so
//! it always passes. The rule keeps no state, so every view and both frame builders pick the same
//! level for the same source: the job workers through [`LevelRule::pick`], and the GPU's culling
//! shader by the same steps.
//!
//! Past each switch distance lies a fading band, [`FADE_BAND`] of the switch distance long, in
//! which the new level and the one before both draw. A fade amount `t` runs from 0 to 1 across the
//! band, and a dither gives each pixel to one level (see [`fade_values`]).
//!
//! A source whose bounding sphere covers fewer pixels than the threshold draws nothing: the last
//! level holds no geometry. The sphere's world diameter times the factor measures the pixels it
//! covers, so the source hides while `diameter × factor < distance`, the same comparison that picks
//! every level. Past that hide distance a fading band gives the dither's share of the pixels to
//! nothing, which thins the coarsest level out rather than popping it away.
//!
//! The frame builders keep a bucket per level, each with a [`LevelLink`]: the level's error, the
//! bucket of the next coarser level, and the level's fade bucket.

/// The bucket of a link that names none.
pub const NO_LINK: u32 = u32::MAX;

/// The share of the switch distance over which two levels hand over.
pub const FADE_BAND: f32 = 0.08;

/// The smallest fade value of the new level in a band, so that its sign marks it even at the
/// band's start, where it covers no pixel yet.
const LEAST_FADE: f32 = 1.0e-6;

/// A bucket's level of detail: the level's error, the bucket of the next coarser level, and the
/// level's fade bucket, each [`NO_LINK`] for none.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LevelLink {
    /// The level's error, 0 for a base level.
    pub error: f32,
    /// The bucket of the next coarser level.
    pub next: u32,
    /// The level's fade bucket.
    pub fade: u32,
}

impl LevelLink {
    /// The link of a bucket without levels.
    pub const NONE: LevelLink = LevelLink {
        error: 0.0,
        next: NO_LINK,
        fade: NO_LINK,
    };

    /// True when the bucket has a coarser level after it.
    #[inline(always)]
    pub fn has_next(&self) -> bool {
        self.next != NO_LINK
    }
}

impl Default for LevelLink {
    fn default() -> Self {
        Self::NONE
    }
}

/// What a view's choice of levels reads: the factor of the rule, true for an orthographic camera,
/// and the share of the switch distance that a fading band covers, 0 where levels switch at once.
/// A factor of 0 turns the choice off: every source draws its base level.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LevelRule {
    /// The render height times `P[1][1]`, over twice the threshold in pixels.
    pub factor: f32,
    /// True for an orthographic camera.
    pub orthographic: bool,
    /// The share of a switch distance that a fading band covers.
    pub band: f32,
}

/// The buckets that a source draws in a view: one level's bucket, or inside a fading band the fade
/// buckets of the new level and of the level before it, with the fade amount from 0 to 1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Picked {
    /// One level's bucket.
    One(u32),
    /// Inside a fading band: the fade buckets of the new level and of the old, and the fade
    /// amount.
    Fade {
        /// The new level's fade bucket.
        new: u32,
        /// The old level's fade bucket.
        old: u32,
        /// The fade amount, from 0 to 1.
        t: f32,
    },
    /// The source covers fewer pixels than the threshold: its last level holds no geometry, so it
    /// draws nothing.
    Hidden,
    /// The source lies in the band past its hide distance: the level it would draw keeps the
    /// dither's share of the pixels, which thins it out.
    FadeOut {
        /// The level's fade bucket.
        old: u32,
        /// The share of the pixels that the dither drops, from 0 to 1.
        t: f32,
    },
}

impl LevelRule {
    /// The rule of a view drawn `render_height` pixels high with the projection's `P[1][1]` of
    /// `p11`, with a threshold of `threshold` pixels and a fading band of `band`.
    pub fn new(
        render_height: f32,
        p11: f32,
        orthographic: bool,
        threshold: f32,
        band: f32,
    ) -> Self {
        let factor = if threshold > 0.0 && render_height > 0.0 {
            render_height * p11.abs() / (2.0 * threshold)
        } else {
            0.0
        };
        Self {
            factor,
            orthographic,
            band,
        }
    }

    /// True when the rule picks levels at all.
    #[inline(always)]
    pub fn on(&self) -> bool {
        self.factor > 0.0
    }

    /// The rule as the culling shader's uniform reads it.
    pub fn uniform(&self) -> [f32; 4] {
        let orthographic = if self.orthographic { 1.0 } else { 0.0 };
        [self.factor, orthographic, self.band, 0.0]
    }

    /// The distance that the rule compares for a sphere centre relative to the camera: its length,
    /// or 1 for an orthographic camera.
    #[inline(always)]
    pub fn distance(&self, center: [f32; 3]) -> f32 {
        if self.orthographic {
            1.0
        } else {
            (center[0] * center[0] + center[1] * center[1] + center[2] * center[2]).sqrt()
        }
    }

    /// The buckets that a source of base bucket `home` draws, at `distance` with a world matrix of
    /// largest axis scale `scale` and a bounding sphere of world radius `radius`, given each
    /// bucket's link in `links`.
    #[inline]
    pub fn pick(
        &self,
        links: &[LevelLink],
        home: u32,
        scale: f32,
        radius: f32,
        distance: f32,
    ) -> Picked {
        let reach = scale * self.factor;
        let mut before = home;
        let mut level = home;
        // A rule without a factor keeps every source at its base level.
        let mut next = if self.on() {
            links[home as usize].next
        } else {
            NO_LINK
        };
        while next != NO_LINK && links[next as usize].error * reach < distance {
            before = level;
            level = next;
            next = links[level as usize].next;
        }
        let (new, old) = (links[level as usize].fade, links[before as usize].fade);
        if level != home && self.band > 0.0 && new != NO_LINK && old != NO_LINK {
            let t = (distance / (links[level as usize].error * reach) - 1.0) / self.band;
            if t < 1.0 {
                return Picked::Fade {
                    new,
                    old,
                    t: t.max(0.0),
                };
            }
        }
        // A bound that covers fewer pixels than the threshold draws nothing: the last level holds
        // no geometry. A mesh without levels has no such level. The band past the hide distance
        // thins the level out with the same dither, where the pipeline has a fading build.
        let hide = 2.0 * radius * self.factor;
        if self.on() && links[home as usize].has_next() && radius > 0.0 && hide < distance {
            if self.band > 0.0 && new != NO_LINK {
                let t = (distance / hide - 1.0) / self.band;
                if t < 1.0 {
                    return Picked::FadeOut {
                        old: new,
                        t: t.max(0.0),
                    };
                }
            }
            return Picked::Hidden;
        }
        Picked::One(level)
    }
}

/// The fade values that the new level and the old level of a band draw with: the new level keeps
/// the pixels whose dither value lies under `t`, and the old level the others. The sign tells the
/// shader which side it draws.
#[inline(always)]
pub fn fade_values(t: f32) -> (f32, f32) {
    (t.max(LEAST_FADE), -t)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Buckets 0 to 3 are the levels of one mesh, with errors growing, and buckets 4 to 7 their
    /// fade buckets.
    fn links(errors: [f32; 4], fades: bool) -> Vec<LevelLink> {
        let mut links: Vec<LevelLink> = (0..4)
            .map(|k| LevelLink {
                error: errors[k],
                next: if k < 3 { k as u32 + 1 } else { NO_LINK },
                fade: if fades { 4 + k as u32 } else { NO_LINK },
            })
            .collect();
        links.extend([LevelLink::NONE; 4]);
        links
    }

    #[test]
    fn the_coarsest_level_whose_error_is_under_the_threshold_draws() {
        // A view 1,000 pixels high and 90 degrees high, threshold 1 pixel: factor 500.
        let rule = LevelRule::new(1000.0, 1.0, false, 1.0, 0.0);
        assert_eq!(rule.factor, 500.0);
        let links = links([0.0, 0.01, 0.04, 0.2], false);
        // Level 1 switches in past 5 m, level 2 past 20 m and level 3 past 100 m. The bound's
        // diameter covers a pixel only past 500 m, so every case draws a level.
        let cases = [
            (1.0, 0),
            (4.99, 0),
            (5.01, 1),
            (19.9, 1),
            (20.1, 2),
            (99.0, 2),
            (101.0, 3),
        ];
        for (distance, level) in cases {
            assert_eq!(
                rule.pick(&links, 0, 1.0, 0.5, distance),
                Picked::One(level),
                "{distance}"
            );
        }
        // Twice the scale doubles every switch distance.
        assert_eq!(rule.pick(&links, 0, 2.0, 0.5, 9.9), Picked::One(0));
        assert_eq!(rule.pick(&links, 0, 2.0, 0.5, 10.1), Picked::One(1));
    }

    #[test]
    fn a_larger_threshold_or_a_lower_render_height_picks_coarser_levels() {
        let links = links([0.0, 0.01, 0.04, 0.2], false);
        let full = LevelRule::new(1000.0, 1.0, false, 1.0, 0.0);
        let half = LevelRule::new(500.0, 1.0, false, 1.0, 0.0);
        let coarse = LevelRule::new(1000.0, 1.0, false, 2.0, 0.0);
        assert_eq!(full.pick(&links, 0, 1.0, 0.5, 12.0), Picked::One(1));
        assert_eq!(half.pick(&links, 0, 1.0, 0.5, 12.0), Picked::One(2));
        assert_eq!(coarse.pick(&links, 0, 1.0, 0.5, 12.0), Picked::One(2));
    }

    #[test]
    fn an_orthographic_view_picks_by_scale_alone() {
        let links = links([0.0, 0.01, 0.04, 0.2], false);
        // A view 10 m high on 1,000 pixels: P[1][1] is 0.2, so 100 pixels a metre at threshold 1.
        let rule = LevelRule::new(1000.0, 0.2, true, 1.0, 0.0);
        let distance = rule.distance([1e5, 0.0, 0.0]);
        assert_eq!(distance, 1.0);
        // An error passes while it covers less than a pixel: level 1's 1 cm covers exactly one
        // pixel at scale 1, so the base level draws, and half a pixel at scale 0.5.
        let cases = [(1.0, 0), (0.5, 1), (0.2, 2), (0.04, 3)];
        for (scale, level) in cases {
            assert_eq!(
                rule.pick(&links, 0, scale, 1.0, distance),
                Picked::One(level),
                "{scale}"
            );
        }
    }

    #[test]
    fn a_rule_without_a_factor_draws_the_base_level() {
        let links = links([0.0, 0.01, 0.04, 0.2], true);
        let off = LevelRule::new(1000.0, 1.0, false, 0.0, FADE_BAND);
        assert!(!off.on());
        assert_eq!(off.pick(&links, 0, 1.0, 1.0, 1e9), Picked::One(0));
    }

    #[test]
    fn the_band_past_a_switch_fades_from_the_old_level_to_the_new() {
        let rule = LevelRule::new(1000.0, 1.0, false, 1.0, FADE_BAND);
        let links = links([0.0, 0.01, 0.04, 0.2], true);
        // Level 1 switches in at 5 m, and its band runs the share of that distance past it.
        let switch_distance = 5.0;
        let band_end = switch_distance * (1.0 + FADE_BAND);
        let middle = (switch_distance + band_end) / 2.0;
        assert_eq!(
            rule.pick(&links, 0, 1.0, 1.0, switch_distance - 0.1),
            Picked::One(0)
        );
        let Picked::Fade { new, old, t } = rule.pick(&links, 0, 1.0, 1.0, middle) else {
            panic!("no fade in the band");
        };
        assert_eq!((new, old), (5, 4));
        assert!((t - 0.5).abs() < 1e-4);
        assert_eq!(
            rule.pick(&links, 0, 1.0, 1.0, band_end + 0.01),
            Picked::One(1)
        );
        // Level 2's band, past 20 m, fades from level 1.
        let Picked::Fade { new, old, .. } = rule.pick(&links, 0, 1.0, 1.0, 20.5) else {
            panic!("no fade at 20.5 m");
        };
        assert_eq!((new, old), (6, 5));
        // Without fade buckets, or without a band, levels switch at once.
        let still = links_without_fades();
        assert_eq!(rule.pick(&still, 0, 1.0, 1.0, 5.375), Picked::One(1));
        let no_band = LevelRule { band: 0.0, ..rule };
        assert_eq!(no_band.pick(&links, 0, 1.0, 1.0, 5.375), Picked::One(1));
        let (new, old) = fade_values(0.0);
        assert!(new > 0.0 && old == 0.0);
    }

    fn links_without_fades() -> Vec<LevelLink> {
        links([0.0, 0.01, 0.04, 0.2], false)
    }

    #[test]
    fn a_bucket_without_levels_draws_itself() {
        let rule = LevelRule::new(1000.0, 1.0, false, 1.0, FADE_BAND);
        let links = [LevelLink::NONE; 2];
        assert_eq!(rule.pick(&links, 1, 1.0, 1.0, 1e9), Picked::One(1));
    }

    #[test]
    fn a_bound_that_covers_less_than_the_threshold_draws_nothing() {
        let rule = LevelRule::new(1000.0, 1.0, false, 1.0, 0.0);
        let links = links([0.0, 0.01, 0.04, 0.2], false);
        // A world diameter of 2 m covers 1,000 / distance pixels: one pixel at 1,000 m.
        assert_eq!(rule.pick(&links, 0, 1.0, 1.0, 999.0), Picked::One(3));
        assert_eq!(rule.pick(&links, 0, 1.0, 1.0, 1_001.0), Picked::Hidden);
        // A bound of no radius has no size to test, and a mesh without levels has no hidden level.
        assert_eq!(rule.pick(&links, 0, 1.0, 0.0, 1e9), Picked::One(3));
        let plain = [LevelLink::NONE; 2];
        assert_eq!(rule.pick(&plain, 1, 1.0, 1.0, 1e9), Picked::One(1));
    }

    #[test]
    fn the_hide_distance_follows_the_threshold_and_the_render_height() {
        let links = links([0.0, 0.01, 0.04, 0.2], false);
        // A threshold of two pixels halves the factor, so the bound hides at half the distance.
        let full = LevelRule::new(1000.0, 1.0, false, 1.0, 0.0);
        let low = LevelRule::new(1000.0, 1.0, false, 2.0, 0.0);
        let half = LevelRule::new(500.0, 1.0, false, 1.0, 0.0);
        assert_eq!(full.pick(&links, 0, 1.0, 1.0, 501.0), Picked::One(3));
        assert_eq!(low.pick(&links, 0, 1.0, 1.0, 501.0), Picked::Hidden);
        assert_eq!(half.pick(&links, 0, 1.0, 1.0, 501.0), Picked::Hidden);
    }

    #[test]
    fn the_band_past_the_hide_distance_thins_the_level_out() {
        let rule = LevelRule::new(1000.0, 1.0, false, 1.0, FADE_BAND);
        let links = links([0.0, 0.01, 0.04, 0.2], true);
        // The coarsest level's fade bucket draws the dither's share near the hide distance of
        // 1,000 m, and nothing past the band.
        let hide = 1_000.0;
        let middle = hide * (1.0 + FADE_BAND / 2.0);
        let Picked::FadeOut { old, t } = rule.pick(&links, 0, 1.0, 1.0, middle) else {
            panic!("no fade out in the band");
        };
        assert_eq!(old, 7);
        assert!((t - 0.5).abs() < 1e-4);
        assert_eq!(
            rule.pick(&links, 0, 1.0, 1.0, hide * (1.0 + FADE_BAND) + 0.1),
            Picked::Hidden
        );
        // Without a band or a fading build, the source hides at once.
        let no_band = LevelRule { band: 0.0, ..rule };
        assert_eq!(
            no_band.pick(&links, 0, 1.0, 1.0, hide + 0.1),
            Picked::Hidden
        );
        assert_eq!(
            rule.pick(&links_without_fades(), 0, 1.0, 1.0, hide + 0.1),
            Picked::Hidden
        );
    }

    #[test]
    fn an_orthographic_view_hides_a_bound_that_covers_less_than_a_pixel() {
        // A view 10 m high on 1,000 pixels draws 100 pixels a metre at a threshold of one pixel.
        let rule = LevelRule::new(1000.0, 0.2, true, 1.0, 0.0);
        let links = links([0.0, 0.01, 0.04, 0.2], false);
        let distance = rule.distance([1e5, 0.0, 0.0]);
        // A diameter of 1 cm covers exactly one pixel, and 9.8 mm covers under it. The base level
        // draws at a scale of 1, where level 1's error covers exactly a pixel too.
        assert_eq!(rule.pick(&links, 0, 1.0, 0.005, distance), Picked::One(0));
        assert_eq!(rule.pick(&links, 0, 1.0, 0.0049, distance), Picked::Hidden);
    }
}
