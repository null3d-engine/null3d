//! Levels of detail: simpler meshes that a mesh draws in its place where its error covers less
//! than a threshold of pixels on the screen. [`null3d_core::levels`] holds the rule that picks a
//! level; this module holds the meshes with levels, and the bucket keys and links that the frame
//! builders give each level.
//!
//! A mesh with levels names its lower levels, from the most detailed down, and each level's switch
//! measure: an error in the units of the base mesh's positions, a distance, or a screen coverage.
//! A level may also name a material of its own, so that a far level shades more cheaply than a near
//! one. Every object and every instance batch that draws the base mesh picks one level per frame
//! and per view. The frame builders keep a bucket for each level of each such mesh, and a fade
//! bucket beside each level that hands over in a fading band, and beside each level of a bucket
//! whose sources draw in a distance band. A level's bucket key names it by a level key
//! ([`level_key`]), so a level's bucket never merges with the bucket of an object that draws the
//! same simple mesh as a mesh of its own.

use null3d_core::levels::Switch;
use null3d_gpu::drawlist::{permutation, template};

use crate::pipelines::DrawKey;

/// What makes a bucket in both frame builders: its pipeline's key, its material's map group, the
/// page of its mesh's first part, its mesh (or level key), its material, and one more field of
/// the builder's own.
pub(crate) type BucketKey = (DrawKey, u32, u32, u32, u32, u32);

/// The most levels a mesh has, its base mesh included.
pub const MAX_LEVELS: usize = 8;

/// The bit of a bucket key's mesh field that marks a level key.
const LEVEL_KEY: u32 = 1 << 31;
/// The bits of a level key that hold the level.
const LEVEL_BITS: u32 = 3;
const _: () = assert!(1 << LEVEL_BITS == MAX_LEVELS);

/// The mesh field of the bucket key of level `level` of the mesh with engine id `base`: the base
/// mesh's own id for level 0, and a level key for the lower levels.
pub fn level_key(base: u32, level: usize) -> u32 {
    if level == 0 {
        base
    } else {
        LEVEL_KEY | (base << LEVEL_BITS) | level as u32
    }
}

/// The base mesh and the level that a bucket key's mesh field names: the mesh itself and level 0
/// for a mesh's own id.
pub fn key_level(key: u32) -> (u32, usize) {
    if key & LEVEL_KEY == 0 {
        (key, 0)
    } else {
        (
            (key & !LEVEL_KEY) >> LEVEL_BITS,
            (key & ((1 << LEVEL_BITS) - 1)) as usize,
        )
    }
}

/// One mesh's levels: the engine mesh id of each, the base mesh first, each one's switch measure,
/// the material a level draws with where it differs from the level before it, and which levels
/// hand over in a fading band.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LevelSet {
    meshes: [u32; MAX_LEVELS],
    values: [f32; MAX_LEVELS],
    switches: [Switch; MAX_LEVELS],
    /// The material of each level that names its own, 0 for a level that inherits the material of
    /// the level before it. The base level's entry is always 0.
    materials: [u32; MAX_LEVELS],
    count: u8,
    /// The levels that hand over in a fading band, from the bits at their number: a level fades
    /// only where its switch would show, which a measured error does not.
    fades: u8,
    /// True when every level draws the base mesh's own vertices, so a skinned object may pick a
    /// level: the skin then moves the same vertices whichever level draws.
    shared: bool,
}

impl LevelSet {
    /// The number of levels, the base mesh included.
    pub fn len(&self) -> usize {
        self.count as usize
    }

    /// True for a set with no levels.
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    /// The engine mesh id of level `level`.
    pub fn mesh(&self, level: usize) -> u32 {
        self.meshes[level]
    }

    /// The switch value of level `level`, 0 for the base mesh.
    pub fn value(&self, level: usize) -> f32 {
        self.values[level]
    }

    /// What the switch distance of level `level` is measured by.
    pub fn switch(&self, level: usize) -> Switch {
        self.switches[level]
    }

    /// The material that level `level` draws with, or 0 for a level that inherits the material of
    /// the level before it. The base level never names one.
    pub fn material(&self, level: usize) -> u32 {
        self.materials[level]
    }

    /// True when level `level` hands over in a fading band.
    pub fn fades(&self, level: usize) -> bool {
        self.fades & (1 << level.min(7)) != 0
    }

    /// True when every level draws the base mesh's own vertices, from indices of its own.
    pub fn shared(&self) -> bool {
        self.shared
    }
}

/// Why a set of levels was refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LevelError {
    /// More levels than [`MAX_LEVELS`], the base mesh included.
    TooMany,
    /// A switch value that is not finite, not above 0, or not past the level before's.
    Errors,
    /// A level that names no mesh, or the base mesh.
    Mesh,
    /// A level whose vertices have other attributes than the base mesh's: each level draws with
    /// the base mesh's pipelines.
    Format,
}

/// The meshes with levels, by the base mesh's engine id.
#[derive(Clone, Debug, Default)]
pub struct Levels {
    sets: Vec<LevelSet>,
    /// The number of meshes with levels.
    count: usize,
}

impl Levels {
    /// Gives the mesh with engine id `base` the lower levels `meshes`, with their switch `values`
    /// and the `switches` that measure them, and the `materials` that they draw with (0 for the
    /// level before's). The bits of `fades` mark the levels that hand over in a fading band, and
    /// `shared` says that every level draws the base mesh's own vertices. With no levels it takes
    /// them away. The caller checks that every mesh id names a live mesh, and that the switch
    /// distances grow from level to level.
    #[allow(clippy::too_many_arguments)]
    pub fn set(
        &mut self,
        base: u32,
        meshes: &[u32],
        values: &[f32],
        switches: &[Switch],
        materials: &[u32],
        fades: u8,
        shared: bool,
    ) -> Result<(), LevelError> {
        if meshes.len() + 1 > MAX_LEVELS
            || meshes.len() != values.len()
            || meshes.len() != switches.len()
        {
            return Err(LevelError::TooMany);
        }
        assert_eq!(
            materials.len(),
            meshes.len(),
            "each level names a material, 0 for the level before's"
        );
        if base == 0 || meshes.iter().any(|&mesh| mesh == 0 || mesh == base) {
            return Err(LevelError::Mesh);
        }
        // A level's switch must lie farther than the level before it. Values of different
        // measures compare at the reference view, which only the caller knows, so each measure
        // keeps its own order here: an error or a distance grows, and a coverage shrinks, as the
        // bounds cover less of the screen farther out.
        let mut before: [Option<f32>; 3] = [None; 3];
        for (&value, &switch) in values.iter().zip(switches) {
            if !(value.is_finite() && value > 0.0) {
                return Err(LevelError::Errors);
            }
            let last = before[switch as usize];
            let ordered = match (last, switch) {
                (None, _) => true,
                (Some(last), Switch::Coverage) => value < last,
                (Some(last), _) => value > last,
            };
            if !ordered {
                return Err(LevelError::Errors);
            }
            before[switch as usize] = Some(value);
        }
        let index = base as usize;
        if meshes.is_empty() {
            if let Some(set) = self.sets.get_mut(index).filter(|set| !set.is_empty()) {
                *set = LevelSet::default();
                self.count -= 1;
            }
            return Ok(());
        }
        if self.sets.len() <= index {
            self.sets.resize(index + 1, LevelSet::default());
        }
        let set = &mut self.sets[index];
        if set.is_empty() {
            self.count += 1;
        }
        *set = LevelSet {
            count: meshes.len() as u8 + 1,
            fades,
            shared,
            ..LevelSet::default()
        };
        set.meshes[0] = base;
        set.meshes[1..=meshes.len()].copy_from_slice(meshes);
        set.values[1..=values.len()].copy_from_slice(values);
        set.switches[1..=switches.len()].copy_from_slice(switches);
        set.materials[1..=materials.len()].copy_from_slice(materials);
        Ok(())
    }

    /// The levels of the mesh with engine id `base`, or `None` for a mesh without.
    pub fn of(&self, base: u32) -> Option<&LevelSet> {
        self.sets.get(base as usize).filter(|set| !set.is_empty())
    }

    /// True while some mesh has levels.
    pub fn any(&self) -> bool {
        self.count > 0
    }

    /// True when a bucket of the mesh `mesh` whose pipeline has `permutation` may pick the mesh's
    /// levels. A morphed bucket never does, because a level carries no morph targets. A skinned
    /// bucket does only when its levels draw the base mesh's own vertices, which the skin moves.
    pub fn may_pick(&self, mesh: u32, permutation: u32) -> bool {
        if permutation & permutation::MORPH != 0 {
            return false;
        }
        if permutation & permutation::SKIN == 0 {
            return true;
        }
        self.of(mesh).is_some_and(|set| set.shared())
    }

    /// The engine mesh id that a bucket key's mesh field draws: a level's own mesh for a level
    /// key, else the field itself.
    pub fn mesh_of_key(&self, key: u32) -> Option<u32> {
        let (base, level) = key_level(key);
        if level == 0 {
            return Some(base);
        }
        let set = self.of(base)?;
        (level < set.len()).then(|| set.mesh(level))
    }

    /// Takes the levels away from removed meshes, and from meshes whose levels name a removed
    /// mesh: `live` says whether an engine mesh id names a live mesh.
    pub fn forget_removed(&mut self, live: impl Fn(u32) -> bool) {
        for (base, set) in self.sets.iter_mut().enumerate() {
            if set.is_empty() {
                continue;
            }
            let gone = !live(base as u32) || set.meshes[..set.len()].iter().any(|&m| !live(m));
            if gone {
                *set = LevelSet::default();
                self.count -= 1;
            }
        }
    }
}

/// The permutation bits of the pipelines whose levels switch at once: their builds have no fading
/// level (see [`permutation::APART`]).
const NO_FADE: u32 = permutation::SKIN
    | permutation::MORPH
    | permutation::INSTANCE_INDEX
    | permutation::TRANSMISSION
    | permutation::ALPHA_HASH
    | permutation::DISPLACEMENT;

/// True when a pipeline has builds of a fading level: the engine's standard and unlit templates,
/// opaque or with a mask tested by its cutoff or by coverage. Custom materials, masks tested by the
/// hash and the debug views switch levels at once.
pub(crate) fn fades_its_way(key: DrawKey) -> bool {
    matches!(
        key.template,
        template::INSTANCED_LIT
            | template::INSTANCED_STANDARD_MAPS
            | template::INSTANCED_UNLIT
            | template::INSTANCED_UNLIT_MAP
    ) && key.permutation & NO_FADE == 0
}

/// True when a bucket key draws with the fading build, which lists the fade value or, in a levels
/// debug view, the level code beside each entry.
pub(crate) fn is_fade_key(key: &BucketKey) -> bool {
    key.0.permutation & permutation::LOD_FADE != 0
}

/// The key of the fade bucket beside a level's bucket key.
fn fade_key(key: BucketKey) -> BucketKey {
    let pipeline = DrawKey {
        permutation: key.0.permutation | permutation::LOD_FADE,
        ..key.0
    };
    (pipeline, key.1, key.2, key.3, key.4, key.5)
}

/// The bucket of a level whose material may differ from the level before's, as the level's
/// pipeline, map group, page, key, material and the fields of the bucket that names it ask.
pub(crate) type LevelBucket<'a> = &'a dyn Fn(&BucketKey, usize) -> Option<BucketKey>;

/// Adds the keys of the level buckets of every key in `keys` whose mesh has levels and that
/// `eligible` lets pick them: one key for each lower level, and one fade bucket for each level
/// alike, where the level or the one after it fades, or where `ranged` says its sources draw in a
/// distance band and `distance_fades` turns those bands on. With `codes`, a levels debug view
/// draws every level through its own bucket and adds no fade bucket, since each of its entries
/// carries the level's code. A key without levels gets a fade bucket
/// when its sources draw in a distance band. Each takes the count of the key it comes from, since
/// any of its sources may draw any level. `level_bucket` gives the bucket of a level, whose
/// material may differ from the base key's, so the level's pipeline and map group come from the
/// level's own mesh and material. The keys are sorted again, and equal keys merge as
/// [`crate::frame::collect_bucket_keys`] merges them. Allocates nothing once `keys` has room.
pub(crate) fn expand_level_keys(
    keys: &mut Vec<(BucketKey, u32)>,
    levels: &Levels,
    distance_fades: bool,
    codes: bool,
    ranged: impl Fn(&BucketKey) -> bool,
    eligible: impl Fn(&BucketKey) -> bool,
    level_bucket: LevelBucket<'_>,
) {
    let original = keys.len();
    for k in 0..original {
        let (key, count) = keys[k];
        let fades = fades_its_way(key.0);
        let range = distance_fades && ranged(&key);
        // A levels debug view draws every level through its own bucket, whose entries carry the
        // level's code, so it adds no fade bucket: a band lists both levels' buckets instead.
        if codes {
            let Some(set) = levels.of(key.3).filter(|_| eligible(&key)) else {
                continue;
            };
            let mut carried = key;
            for level in 1..set.len() {
                let Some(level_key) = level_bucket(&carried, level) else {
                    continue;
                };
                keys.push((level_key, count));
                carried.4 = level_key.4;
            }
            continue;
        }
        let Some(set) = levels.of(key.3).filter(|_| eligible(&key)) else {
            if fades && range {
                keys.push((fade_key(key), count));
            }
            continue;
        };
        // The base level's fade bucket takes the band of level 1, and the edges of a distance
        // range.
        if fades && (range || set.fades(1)) {
            keys.push((fade_key(key), count));
        }
        // Each level inherits the material of the level before it, so the key that finds a level
        // carries the previous level's effective material.
        let mut carried = key;
        for level in 1..set.len() {
            let Some(level_key) = level_bucket(&carried, level) else {
                continue;
            };
            keys.push((level_key, count));
            // A level's own material may fade where the base material does not.
            let band =
                (range || set.fades(level) || (level + 1 < set.len() && set.fades(level + 1)))
                    && fades_its_way(level_key.0);
            if band {
                keys.push((fade_key(level_key), count));
            }
            carried.4 = level_key.4;
        }
    }
    if keys.len() == original {
        return;
    }
    keys.sort_unstable_by_key(|&(key, _)| key);
    keys.dedup_by(|next, kept| {
        let same = next.0 == kept.0;
        if same {
            kept.1 += next.1;
        }
        same
    });
}

/// What a bucket key says of its level of detail: the level's switch value and measure, and the
/// places in the sorted keys of the next coarser level's key and of the level's fade key. A levels
/// debug view adds no fade bucket, so its fade place names the level's own key, and only a band
/// that the engine draws gives it one.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct KeyLinks {
    pub value: f32,
    pub switch: Switch,
    pub next: Option<u32>,
    pub fade: Option<u32>,
}

/// The links of the bucket key `key`, in the sorted `keys` that
/// [`expand_level_keys`] made, with the same `level_bucket` that made them. A fade bucket has none.
/// A bucket of a mesh without levels, and a base level's bucket that `eligible` keeps from picking,
/// have no level links, but each keeps its fade key, which a distance band draws through.
pub(crate) fn links_of(
    key: BucketKey,
    keys: &[(BucketKey, u32)],
    levels: &Levels,
    codes: bool,
    bands: impl Fn(&BucketKey) -> bool,
    eligible: impl Fn(&BucketKey) -> bool,
    level_bucket: LevelBucket<'_>,
) -> KeyLinks {
    let (base, level) = key_level(key.3);
    // A levels debug view's buckets all carry the fading bit, since each lists its level's code
    // beside its entry, so only the bits of another view mark a fade bucket here.
    if !codes && is_fade_key(&key) {
        return KeyLinks::default();
    }
    let find = |key: Option<BucketKey>| {
        key.and_then(|key| keys.binary_search_by_key(&key, |&(k, _)| k).ok())
            .map(|place| place as u32)
    };
    let set = levels.of(base).filter(|_| level > 0 || eligible(&key));
    // A levels debug view appends a band's entries to the level buckets themselves, so a bucket's
    // fade link names the bucket. Only a band that the engine draws gives it one: its sources'
    // distance band, the level's own fade, or the fade of the level after it, as a fade bucket
    // takes the band of the level that hands over to it.
    let fades = bands(&key)
        || set
            .is_some_and(|set| set.fades(level) || (level + 1 < set.len() && set.fades(level + 1)));
    let fade = if codes {
        find(Some(key)).filter(|_| fades)
    } else {
        find(Some(fade_key(key)))
    };
    let Some(set) = set else {
        return KeyLinks {
            fade,
            ..KeyLinks::default()
        };
    };
    let next = (level + 1 < set.len())
        .then(|| level_bucket(&key, level + 1))
        .flatten();
    KeyLinks {
        value: set.value(level),
        switch: set.switch(level),
        next: find(next),
        fade,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipelines::DepthBias;

    #[test]
    fn masks_by_cutoff_or_coverage_fade_and_masks_by_the_hash_switch_at_once() {
        let key = |permutation| DrawKey {
            template: template::INSTANCED_LIT,
            permutation,
            vertex_format: 0,
            state: 0,
            bias: DepthBias::NONE,
        };
        let mask = permutation::ALPHA_MASK;
        let coverage = mask | permutation::ALPHA_COVERAGE;
        assert!(fades_its_way(key(0)));
        assert!(fades_its_way(key(mask)));
        assert!(fades_its_way(key(coverage)));
        assert!(fades_its_way(key(coverage | permutation::SAMPLE_MASK)));
        assert!(!fades_its_way(key(mask | permutation::ALPHA_HASH)));
        assert!(!fades_its_way(key(permutation::SKIN)));
        assert!(!fades_its_way(key(permutation::DISPLACEMENT)));
        // Every key that fades has its fading build.
        for word in [0, mask, coverage, coverage | permutation::SAMPLE_MASK] {
            assert!(
                permutation::buildable(word | permutation::LOD_FADE),
                "{word:#x}"
            );
        }
    }

    #[test]
    fn a_custom_material_never_fades_so_a_handed_over_card_does_not_dither() {
        // The two batches of a hand-over, a plant's mesh and its card, are different sources, so
        // their dither phases differ. The card's custom material takes no fading build: its
        // distance range switches at full coverage, behind the mesh whose pixels dither out over
        // it, and no pixel is dropped by both.
        let key = |template: u32| -> BucketKey {
            (
                DrawKey {
                    template,
                    permutation: 0,
                    vertex_format: 0,
                    state: 0,
                    bias: DepthBias::NONE,
                },
                0,
                0,
                1,
                5,
                0,
            )
        };
        assert!(!fades_its_way(key(template::CUSTOM_FIRST).0));
        assert!(fades_its_way(key(template::INSTANCED_LIT).0));
        let mut keys = vec![
            (key(template::INSTANCED_LIT), 3),
            (key(template::CUSTOM_FIRST), 2),
        ];
        // Every source draws in a distance range, and the distance bands fade.
        let no_level = |_: &BucketKey, _: usize| -> Option<BucketKey> { None };
        let levels = Levels::default();
        expand_level_keys(
            &mut keys,
            &levels,
            true,
            false,
            |_| true,
            |_| true,
            &no_level,
        );
        let faded = |template: u32| {
            keys.iter()
                .any(|(key, _)| key.0.template == template && is_fade_key(key))
        };
        assert!(faded(template::INSTANCED_LIT));
        assert!(!faded(template::CUSTOM_FIRST));
    }

    #[test]
    fn level_keys_round_trip_and_never_equal_a_mesh_id() {
        for base in [1, 2, 1000, (1 << 27) - 1] {
            for level in 0..MAX_LEVELS {
                let key = level_key(base, level);
                assert_eq!(key_level(key), (base, level));
                assert_eq!(key & LEVEL_KEY != 0, level > 0);
            }
        }
    }

    #[test]
    fn only_a_shared_set_lets_a_skinned_bucket_pick_levels() {
        let mut levels = Levels::default();
        assert!(levels.may_pick(1, 0));
        assert!(!levels.may_pick(1, permutation::MORPH));
        assert!(!levels.may_pick(1, permutation::SKIN));
        levels
            .set(
                1,
                &[2, 3],
                &[0.1, 0.2],
                &[Switch::Error; 2],
                &[0, 0],
                0,
                false,
            )
            .unwrap();
        assert!(
            !levels.may_pick(1, permutation::SKIN),
            "a copied level keeps the base mesh"
        );
        levels
            .set(
                1,
                &[2, 3],
                &[0.1, 0.2],
                &[Switch::Error; 2],
                &[0, 0],
                0,
                true,
            )
            .unwrap();
        assert!(levels.may_pick(1, permutation::SKIN));
        assert!(!levels.may_pick(1, permutation::SKIN | permutation::MORPH));
    }

    #[test]
    fn a_set_says_whether_its_levels_draw_the_base_meshs_own_vertices() {
        let mut levels = Levels::default();
        let error = [Switch::Error; 2];
        levels
            .set(1, &[2, 3], &[0.1, 0.2], &error, &[0, 0], 0, true)
            .unwrap();
        assert!(levels.of(1).unwrap().shared());
        levels
            .set(1, &[2, 3], &[0.1, 0.2], &error, &[0, 0], 0, false)
            .unwrap();
        assert!(!levels.of(1).unwrap().shared());
    }

    #[test]
    fn a_level_inherits_the_material_of_the_level_before_it() {
        let mut levels = Levels::default();
        let error = [Switch::Error; 2];
        levels
            .set(1, &[2, 3], &[0.1, 0.2], &error, &[7, 0], 0, false)
            .unwrap();
        let bucket = |mesh: u32, material: u32| {
            (
                DrawKey {
                    template: template::INSTANCED_LIT,
                    permutation: 0,
                    vertex_format: 0,
                    state: 0,
                    bias: DepthBias::NONE,
                },
                0,
                0,
                mesh,
                material,
                0,
            )
        };
        let level_bucket = |base: &BucketKey, level: usize| {
            let (mesh, _) = key_level(base.3);
            let set = levels.of(mesh)?;
            let material = match set.material(level) {
                0 => base.4,
                own => own,
            };
            Some(bucket(level_key(mesh, level), material))
        };
        let eligible = |_: &BucketKey| true;
        let mut keys = vec![(bucket(1, 5), 3)];
        expand_level_keys(
            &mut keys,
            &levels,
            false,
            false,
            |_| false,
            eligible,
            &level_bucket,
        );
        let own = |level: usize| {
            let (key, _) = keys
                .iter()
                .find(|(key, _)| key_level(key.3) == (1, level))
                .unwrap();
            key.4
        };
        // Level 1 names a material, and level 2, which names none, draws with level 1's.
        assert_eq!((own(1), own(2)), (7, 7));
        // The links walk from the base level to level 1 and from level 1 to level 2.
        let links = |key: BucketKey| {
            links_of(
                key,
                &keys,
                &levels,
                false,
                |_| false,
                eligible,
                &level_bucket,
            )
            .next
        };
        let first = keys
            .iter()
            .find(|(key, _)| key_level(key.3) == (1, 0))
            .unwrap()
            .0;
        let next = links(first).unwrap() as usize;
        assert_eq!(key_level(keys[next].0.3), (1, 1));
        let next = links(keys[next].0).unwrap() as usize;
        assert_eq!(key_level(keys[next].0.3), (1, 2));
    }

    #[test]
    fn sets_refuse_bad_levels_and_forget_removed_meshes() {
        let mut levels = Levels::default();
        let error = [Switch::Error; 2];
        assert_eq!(
            levels.set(1, &[2, 3], &[0.1, 0.1], &error, &[0, 0], 0b10, false),
            Err(LevelError::Errors)
        );
        assert_eq!(
            levels.set(1, &[2], &[0.0], &[Switch::Error], &[0], 0, false),
            Err(LevelError::Errors)
        );
        assert_eq!(
            levels.set(1, &[1], &[0.1], &[Switch::Error], &[0], 0, false),
            Err(LevelError::Mesh)
        );
        assert_eq!(
            levels.set(
                1,
                &[2; 8],
                &[0.1; 8],
                &[Switch::Error; 8],
                &[0; 8],
                0,
                false
            ),
            Err(LevelError::TooMany)
        );
        levels
            .set(1, &[2, 3], &[0.1, 0.2], &error, &[7, 0], 0b10, false)
            .unwrap();
        levels
            .set(4, &[5], &[0.1], &[Switch::Error], &[0], 0b01, false)
            .unwrap();
        assert!(levels.any());
        // A level that names no material inherits the one before's.
        assert_eq!(levels.of(1).unwrap().material(1), 7);
        assert_eq!(levels.of(1).unwrap().material(2), 0);
        assert_eq!(levels.mesh_of_key(level_key(1, 2)), Some(3));
        assert_eq!(levels.mesh_of_key(level_key(1, 3)), None);
        let set = levels.of(1).expect("mesh 1 has levels");
        assert_eq!(set.switch(1), Switch::Error);
        assert_eq!(
            (set.value(1), set.fades(1), set.fades(2)),
            (0.1, true, false)
        );
        levels.forget_removed(|mesh| mesh != 3);
        assert!(levels.of(1).is_none() && levels.of(4).is_some());
        levels.set(4, &[], &[], &[], &[], 0, false).unwrap();
        assert!(!levels.any());
    }
}

/// The meshes whose finer levels are still to download, and the levels that a view has picked since
/// each watch began: how the loader decides whether a stage would ever draw.
///
/// A level whose neighbour above was never picked cannot be picked either, because switch distances
/// grow from level to level. So a loader holds a stage until the level above it has been picked after
/// a warm-up of frames, and gives the stage up, and every finer one, when the warm-up passes with no
/// pick. The device's name never enters the decision: only the frames that the renderer drew and the
/// levels it picked.
///
/// Giving a stage up is not final: a loader releases a watch that it has no more use for, so the
/// frames that follow pay nothing, and watches the mesh again when it looks for the pick that would
/// bring the stage back. A camera that starts far away and comes close later still gets the level it
/// then needs, and a level that never draws is never downloaded.
#[derive(Debug, Default)]
pub struct StageWatches {
    /// One watch per mesh, in the order that the watches began.
    watches: Vec<StageWatch>,
}

/// One mesh's watch.
#[derive(Clone, Copy, Debug)]
struct StageWatch {
    /// The base mesh's engine id.
    mesh: u32,
    /// One bit for each level picked since the watch began: bit 0 is the mesh itself.
    picked: u32,
    /// One bit for each band of a patch tree that a view drew since the watch began: bit 0 is the
    /// band that the file holds.
    bands: u32,
    /// The frame that the watch began, in the frame input's own count.
    since: u64,
}

impl StageWatches {
    /// Watches `mesh` from `frame` on, in place of a watch that the mesh had.
    pub fn watch(&mut self, mesh: u32, frame: u64) {
        if let Some(watch) = self.watches.iter_mut().find(|watch| watch.mesh == mesh) {
            watch.picked = 0;
            watch.bands = 0;
            watch.since = frame;
        } else {
            self.watches.push(StageWatch {
                mesh,
                picked: 0,
                bands: 0,
                since: frame,
            });
        }
    }

    /// The levels picked since the mesh's watch began, one bit each, bit 0 for the mesh itself. 0
    /// for a mesh that nothing watches.
    pub fn picks(&self, mesh: u32) -> u32 {
        self.watches
            .iter()
            .find(|watch| watch.mesh == mesh)
            .map_or(0, |watch| watch.picked)
    }

    /// The frames drawn since the mesh's watch began, 0 for a mesh that nothing watches.
    pub fn frames(&self, mesh: u32, frame: u64) -> u32 {
        self.watches
            .iter()
            .find(|watch| watch.mesh == mesh)
            .map_or(0, |watch| {
                frame.saturating_sub(watch.since).min(u32::MAX as u64) as u32
            })
    }

    /// Stops watching the meshes that `live` refuses: a removed mesh's watch would count nothing.
    pub fn forget(&mut self, live: impl Fn(u32) -> bool) {
        self.watches.retain(|watch| live(watch.mesh));
    }

    /// Stops watching `mesh`. A loader that has taken what it can from a stage releases its watch,
    /// so the frames that follow pay nothing; a later watch starts the count again.
    pub fn release(&mut self, mesh: u32) {
        self.watches.retain(|watch| watch.mesh != mesh);
    }

    /// True while no mesh waits for a stage, so a frame with no loader pays nothing.
    pub fn is_empty(&self) -> bool {
        self.watches.is_empty()
    }

    /// Notes that a view placed at least one source in the bucket of `level` of `mesh`.
    pub fn picked(&mut self, mesh: u32, level: usize) {
        if let Some(watch) = self.watches.iter_mut().find(|watch| watch.mesh == mesh) {
            watch.picked |= 1 << level;
        }
    }

    /// The bands of the tree of `mesh` that a view drew since the watch began, one bit each, bit 0
    /// for the band that the file holds. 0 for a mesh that nothing watches.
    pub fn bands(&self, mesh: u32) -> u32 {
        self.watches
            .iter()
            .find(|watch| watch.mesh == mesh)
            .map_or(0, |watch| watch.bands)
    }

    /// The number of watches, which the pick count reads one at a time.
    pub fn len(&self) -> usize {
        self.watches.len()
    }

    /// The mesh of the watch at `index`.
    pub fn mesh_at(&self, index: usize) -> u32 {
        self.watches[index].mesh
    }

    /// Adds the bands of the watch at `index` that a view drew this frame to the bands that a view
    /// drew since the watch began. A pick between two polls stays, as a level's pick does.
    pub fn note_bands(&mut self, index: usize, bands: u32) {
        if let Some(watch) = self.watches.get_mut(index) {
            watch.bands |= bands;
        }
    }

    /// Restarts the warm-up of each watch whose mesh `present` refuses. A page may load a model
    /// before its scene draws it, so the frames that count toward a warm-up are the frames that
    /// drew the mesh, and a page that never draws it never drops its stages.
    pub fn hold(&mut self, frame: u64, present: impl Fn(u32) -> bool) {
        for watch in &mut self.watches {
            if !present(watch.mesh) {
                watch.since = frame;
            }
        }
    }

    /// Notes the levels that a view placed at least one source in, from the number of entries in
    /// each bucket of that view: `counted` gives a bucket key's entries. It reads one count for each
    /// level of each watched mesh, so a frame with no watch pays nothing.
    pub fn note(&mut self, levels: &Levels, counted: impl Fn(u32) -> u32) {
        for watch in &mut self.watches {
            let Some(set) = levels.of(watch.mesh) else {
                continue;
            };
            for level in 0..set.len() {
                if counted(level_key(watch.mesh, level)) > 0 {
                    watch.picked |= 1 << level;
                }
            }
        }
    }
}

#[cfg(test)]
mod stage_watch_tests {
    use super::*;

    /// A set of three levels on the mesh with id 1.
    fn levels() -> Levels {
        let mut levels = Levels::default();
        levels
            .set(
                1,
                &[11, 12],
                &[0.2, 0.5],
                &[Switch::Error; 2],
                &[0; 2],
                0,
                true,
            )
            .expect("three levels fit");
        levels
    }

    #[test]
    fn a_watch_counts_the_levels_a_view_put_a_source_in() {
        let levels = levels();
        let mut watches = StageWatches::default();
        watches.watch(1, 100);
        // The view's counts: the mesh itself and its coarsest level, nothing between.
        let counted = |key: u32| match key_level(key) {
            (1, 0) => 3,
            (1, 2) => 7,
            _ => 0,
        };
        watches.note(&levels, counted);
        assert_eq!(watches.picks(1), 0b101);
        assert_eq!(watches.picks(2), 0);
        // The frames count from the watch's start.
        assert_eq!(watches.frames(1, 340), 240);
        assert_eq!(watches.frames(1, 50), 0);
        assert_eq!(watches.frames(2, 340), 0);
    }

    #[test]
    fn a_second_watch_clears_what_the_first_counted() {
        let levels = levels();
        let mut watches = StageWatches::default();
        watches.watch(1, 0);
        watches.note(&levels, |key| u32::from(key_level(key).1 == 1));
        assert_eq!(watches.picks(1), 0b010);
        watches.watch(1, 90);
        assert_eq!(watches.picks(1), 0);
        assert_eq!(watches.frames(1, 95), 5);
        // A removed mesh's watch goes.
        watches.forget(|mesh| mesh != 1);
        assert_eq!(watches.frames(1, 95), 0);
    }

    #[test]
    fn a_released_watch_stops_counting_and_a_new_one_counts_again() {
        let levels = levels();
        let mut watches = StageWatches::default();
        watches.watch(1, 10);
        watches.note(&levels, |key| u32::from(key_level(key).1 == 1));
        assert_eq!(watches.picks(1), 0b010);
        // Released, the mesh costs a frame nothing, and its counts read as a mesh with no watch.
        watches.release(1);
        assert!(watches.is_empty());
        assert_eq!(watches.picks(1), 0);
        assert_eq!(watches.frames(1, 300), 0);
        watches.note(&levels, |key| u32::from(key_level(key).1 == 1));
        assert_eq!(watches.picks(1), 0);
        // A later watch starts its own count, which a pick the views make now fills.
        watches.watch(1, 200);
        assert_eq!(watches.frames(1, 260), 60);
        watches.picked(1, 0);
        assert_eq!(watches.picks(1), 1);
    }

    #[test]
    fn a_watch_counts_bands_and_a_new_watch_clears_them() {
        let mut watches = StageWatches::default();
        watches.watch(7, 20);
        assert_eq!(watches.bands(7), 0);
        // A pick stays after a frame that drew none of its band, as a level's pick does.
        watches.note_bands(0, 0b101);
        watches.note_bands(0, 0b010);
        assert_eq!(watches.bands(7), 0b111);
        assert_eq!(watches.bands(8), 0);
        assert_eq!((watches.len(), watches.mesh_at(0)), (1, 7));
        // A second watch starts the count again.
        watches.watch(7, 40);
        assert_eq!(watches.bands(7), 0);
        assert_eq!(watches.frames(7, 60), 20);
    }

    #[test]
    fn a_frame_that_draws_no_source_of_a_mesh_restarts_its_warm_up() {
        let mut watches = StageWatches::default();
        assert!(watches.is_empty());
        watches.watch(1, 10);
        watches.watch(2, 10);
        // The mesh's bucket holds a source, which picked its base level.
        watches.picked(1, 0);
        assert_eq!(watches.picks(1), 1);
        assert_eq!(watches.picks(3), 0);
        // Mesh 2's source drew nothing this frame, so its warm-up starts again; mesh 1's goes on.
        watches.hold(50, |mesh| {
            assert!(mesh == 1 || mesh == 2, "only watched meshes are asked");
            mesh == 1
        });
        assert_eq!(watches.frames(1, 60), 50);
        assert_eq!(watches.frames(2, 60), 10);
        assert_eq!(watches.picks(1), 1);
    }
}
