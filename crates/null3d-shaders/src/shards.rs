//! The manifest's entries split into shards of about equal build cost.
//!
//! CI builds the manifest in several jobs at once, each with one shard of the entries. The entries'
//! costs differ by orders of magnitude, so a split by count leaves one job with most of the work.
//! The split here estimates each entry's cost from the manifest and gives the costliest entry first
//! to the shard with the least work so far, until every entry has a shard. It reads only the
//! manifest, so every job that names the same shard count makes the same split.
//!
//! One entry can cost more than an even share of the whole build, and then no split of whole
//! entries brings its shard below that entry. A split by build ([`ShardPlan::by_build`]) cuts such
//! an entry into parts, each of which holds every so many of its builds, and spreads the parts
//! over the shards. A part's output lacks the other parts' builds, so only a run that checks each
//! build on its own can use it, and the per-entry cache never holds a part.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::{BuildError, Inputs, Variant};

/// One shard of the manifest's entries: shard `index` of `count`, counted from 0.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Shard {
    /// The shard's place among the shards, from 0.
    pub index: usize,
    /// How many shards the entries are split into.
    pub count: usize,
}

impl Shard {
    /// The shard that `i/n` names, with `i` from 0 and `n` shards in all, or `None` for any other
    /// text.
    pub fn parse(spec: &str) -> Option<Self> {
        let (index, count) = spec.split_once('/')?;
        let index: usize = index.trim().parse().ok()?;
        let count: usize = count.trim().parse().ok()?;
        (count > 0 && index < count).then_some(Self { index, count })
    }
}

impl fmt::Display for Shard {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}/{}", self.index, self.count)
    }
}

/// One part of an entry's builds: the builds whose place in the entry's build order, counted
/// from 0, leaves `index` when divided by `count`. The `count` parts of one count hold each build
/// once.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Part {
    /// The part's place among the parts, from 0.
    pub index: usize,
    /// How many parts the entry's builds are split into.
    pub count: usize,
}

impl Part {
    /// The part that holds every build.
    pub const WHOLE: Self = Self { index: 0, count: 1 };

    /// True when the part holds the build at `place` in the entry's build order.
    pub fn holds(self, place: usize) -> bool {
        self.count > 0 && place % self.count == self.index
    }

    /// Part `piece` of `pieces` of this part. The pieces hold each of this part's builds once,
    /// and no other build.
    pub fn piece(self, piece: usize, pieces: usize) -> Self {
        Self {
            index: self.index + self.count * piece,
            count: self.count * pieces,
        }
    }

    /// How many of an entry's `builds` builds the part holds.
    pub fn builds_of(self, builds: u64) -> u64 {
        builds
            .saturating_sub(self.index as u64)
            .div_ceil(self.count.max(1) as u64)
    }
}

/// One entry, or one part of it, in a shard.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Unit {
    /// The entry's place in the manifest.
    entry: usize,
    part: Part,
}

/// The split of the manifest's entries into a number of shards.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShardPlan {
    /// Each entry's name and estimated cost, in the manifest's order.
    entries: Vec<(String, u64)>,
    /// The entries or parts of each shard, in the manifest's order.
    shards: Vec<Vec<Unit>>,
}

impl ShardPlan {
    /// The split of the manifest in `inputs` into `count` shards, at least one, of whole entries.
    /// A build of one shard makes whole entries, as the per-entry cache and the module writer
    /// need.
    pub fn by_entry(inputs: &Inputs, count: usize) -> Result<Self, BuildError> {
        Ok(Self::split(entry_costs(inputs)?, count, false))
    }

    /// The split of the manifest in `inputs` into `count` shards, at least one, in which an entry
    /// that costs more than an even share is cut into parts of an even share or less, each in a
    /// shard of its own.
    pub fn by_build(inputs: &Inputs, count: usize) -> Result<Self, BuildError> {
        Ok(Self::split(entry_costs(inputs)?, count, true))
    }

    /// The split of entries with these names and estimated costs, in the manifest's order, into
    /// `count` shards, at least one. Whole entries are the first candidate. A split by build also
    /// tries a few largest part sizes, from twice an even share down to a quarter of one, cuts each
    /// entry into parts of at most that size, and keeps the candidate whose costliest shard costs
    /// least, or the one with the larger parts on a tie.
    fn split(entries: Vec<(String, u64)>, count: usize, by_build: bool) -> Self {
        let count = count.max(1);
        let total: u64 = entries.iter().map(|(_, cost)| cost).sum();
        let mut best = assign(&entries, count, |_| 1);
        if by_build && total > 0 {
            let mut least = costliest(&entries, &best);
            // The largest part size in quarters of an even share, larger parts first.
            for quarters in [8u128, 6, 5, 4, 3, 2, 1] {
                let size = (u128::from(total) * quarters).div_ceil(4 * count as u128);
                let parts = |cost: u64| {
                    let most = count
                        .min(usize::try_from(cost).unwrap_or(usize::MAX))
                        .max(1);
                    let parts = u128::from(cost).div_ceil(size.max(1));
                    usize::try_from(parts).unwrap_or(most).clamp(1, most)
                };
                let shards = assign(&entries, count, parts);
                let load = costliest(&entries, &shards);
                if load < least {
                    best = shards;
                    least = load;
                }
            }
        }
        Self {
            entries,
            shards: best,
        }
    }

    /// How many shards the plan has.
    pub fn count(&self) -> usize {
        self.shards.len()
    }

    /// The names of the entries in shard `index`, in the manifest's order, or none for a shard
    /// past the last.
    pub fn names(&self, index: usize) -> Vec<&str> {
        self.units(index)
            .iter()
            .map(|unit| self.entries[unit.entry].0.as_str())
            .collect()
    }

    /// `inputs` narrowed to shard `index`: its entries, each with its part when it holds one.
    pub fn inputs(&self, inputs: &Inputs, index: usize) -> Inputs {
        let mut narrowed = crate::narrowed(inputs, &self.names(index));
        for unit in self.units(index) {
            if unit.part != Part::WHOLE {
                let name = self.entries[unit.entry].0.clone();
                narrowed.parts.insert(name, unit.part);
            }
        }
        narrowed
    }

    /// The estimated cost of shard `index`.
    pub fn cost(&self, index: usize) -> u64 {
        self.units(index)
            .iter()
            .map(|unit| self.unit_cost(unit))
            .sum()
    }

    /// The estimated cost of every entry.
    pub fn total(&self) -> u64 {
        self.entries.iter().map(|(_, cost)| cost).sum()
    }

    /// The estimated cost of the named entries, whole, wherever the plan puts them.
    pub fn cost_of(&self, names: &[&str]) -> u64 {
        self.entries
            .iter()
            .filter(|(name, _)| names.contains(&name.as_str()))
            .map(|(_, cost)| cost)
            .sum()
    }

    /// The share of the whole estimated cost that `cost` is, in percent.
    pub fn percent(&self, cost: u64) -> f64 {
        let total = self.total();
        if total == 0 {
            0.0
        } else {
            cost as f64 * 100.0 / total as f64
        }
    }

    fn units(&self, index: usize) -> &[Unit] {
        self.shards.get(index).map_or(&[], Vec::as_slice)
    }

    fn unit_cost(&self, unit: &Unit) -> u64 {
        unit.part.builds_of(self.entries[unit.entry].1)
    }
}

/// The shards of `entries`, each cut into the number of parts that `parts` gives for its cost.
/// The costliest entry or part goes first, each to the shard with the least cost so far that holds
/// no other part of its entry. Equal costs keep the manifest's order, and equal loads take the
/// first shard, so the shards depend only on the arguments. Each shard lists its entries in the
/// manifest's order.
fn assign(entries: &[(String, u64)], count: usize, parts: impl Fn(u64) -> usize) -> Vec<Vec<Unit>> {
    let mut units = Vec::new();
    for (entry, &(_, cost)) in entries.iter().enumerate() {
        let parts = parts(cost);
        for index in 0..parts {
            let part = Part {
                index,
                count: parts,
            };
            units.push((Unit { entry, part }, part.builds_of(cost)));
        }
    }
    units.sort_by_key(|&(_, cost)| std::cmp::Reverse(cost));
    let mut loads = vec![0u64; count];
    let mut shards: Vec<Vec<Unit>> = vec![Vec::new(); count];
    for (unit, cost) in units {
        // A shard holds at most one part of an entry. An entry has no more parts than there are
        // shards, so some shard is always free of it.
        let free = |shard: &usize| {
            unit.part.count == 1 || shards[*shard].iter().all(|held| held.entry != unit.entry)
        };
        let lightest = (0..count)
            .filter(free)
            .min_by_key(|&shard| loads[shard])
            .unwrap_or(0);
        loads[lightest] = loads[lightest].saturating_add(cost);
        shards[lightest].push(unit);
    }
    for shard in &mut shards {
        shard.sort_unstable_by_key(|unit| (unit.entry, unit.part.index));
    }
    shards
}

/// The estimated cost of the costliest of `shards`.
fn costliest(entries: &[(String, u64)], shards: &[Vec<Unit>]) -> u64 {
    shards
        .iter()
        .map(|shard| {
            shard
                .iter()
                .map(|unit| unit.part.builds_of(entries[unit.entry].1))
                .sum::<u64>()
        })
        .max()
        .unwrap_or(0)
}

/// One line for each shard: its estimated share of the whole build, then its entries and parts
/// with their own shares. Then the costliest entry, and whether it passes an even share, since no
/// split of whole entries can then bring its shard below that entry.
impl fmt::Display for ShardPlan {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(
            f,
            "The shader entries in {} shards by estimated build cost:",
            self.count()
        )?;
        for index in 0..self.count() {
            let units: Vec<String> = self
                .units(index)
                .iter()
                .map(|unit| {
                    let name = &self.entries[unit.entry].0;
                    let share = self.percent(self.unit_cost(unit));
                    if unit.part == Part::WHOLE {
                        format!("{name} {share:.1}%")
                    } else {
                        let Part { index, count } = unit.part;
                        format!("{name} (part {index} of {count}) {share:.1}%")
                    }
                })
                .collect();
            writeln!(
                f,
                "  shard {index}/{}: {:.1}% in {}: {}",
                self.count(),
                self.percent(self.cost(index)),
                match units.len() {
                    1 => "1 entry".to_owned(),
                    n => format!("{n} entries"),
                },
                units.join(", ")
            )?;
        }
        let costliest = self
            .entries
            .iter()
            .enumerate()
            .max_by_key(|&(at, (_, cost))| (*cost, std::cmp::Reverse(at)));
        if let Some((at, (name, cost))) = costliest {
            let share = self.percent(*cost);
            write!(
                f,
                "  The costliest entry is {name}, at {share:.1}% of the whole build."
            )?;
            let even = 100.0 / self.count() as f64;
            let parts = self
                .shards
                .iter()
                .flatten()
                .filter(|unit| unit.entry == at)
                .count();
            if parts > 1 {
                write!(f, " Its builds are split into {parts} parts.")?;
            } else if share > even {
                write!(
                    f,
                    " That is more than an even share of {even:.1}%, so its shard takes the longest."
                )?;
            }
            writeln!(f)?;
        }
        Ok(())
    }
}

/// The estimated build cost of each entry of the manifest, in the manifest's order: the number of
/// builds it makes, or that its part makes when the inputs give it one. Each build composes,
/// validates and writes the entry once, whatever targets it writes, and the entries with the most
/// builds all compile the largest template, so the count ranks the entries as their compile times
/// do. A small entry's builds cost less each than the template's, which moves only the smallest
/// shares.
pub fn entry_costs(inputs: &Inputs) -> Result<Vec<(String, u64)>, BuildError> {
    let manifest = crate::parse_manifest(inputs)?;
    Ok(manifest
        .shaders
        .iter()
        .map(|(name, shader)| {
            let builds: usize = shader.variants.values().map(Variant::build_count).sum();
            let part = inputs.parts.get(name).copied().unwrap_or(Part::WHOLE);
            (name.clone(), part.builds_of(builds as u64))
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fake manifest's costs: a few large entries and many small ones, as the real one has.
    fn fake_costs() -> Vec<(String, u64)> {
        let costs = [
            5, 900, 3, 40, 40, 7, 300, 1, 1, 60, 120, 2, 9, 250, 75, 11, 13, 500, 4, 6,
        ];
        costs
            .iter()
            .enumerate()
            .map(|(at, &cost)| (format!("entry{at}"), cost))
            .collect()
    }

    /// How many units of the plan hold each build of each entry.
    fn holders(plan: &ShardPlan) -> Vec<Vec<usize>> {
        plan.entries
            .iter()
            .enumerate()
            .map(|(entry, &(_, cost))| {
                (0..cost as usize)
                    .map(|place| {
                        plan.shards
                            .iter()
                            .flatten()
                            .filter(|unit| unit.entry == entry && unit.part.holds(place))
                            .count()
                    })
                    .collect()
            })
            .collect()
    }

    #[test]
    fn a_shard_parses_from_its_index_and_count() {
        assert_eq!(Shard::parse("0/4"), Some(Shard { index: 0, count: 4 }));
        assert_eq!(Shard::parse("3/4"), Some(Shard { index: 3, count: 4 }));
        assert_eq!(Shard::parse("4/4"), None);
        assert_eq!(Shard::parse("0/0"), None);
        assert_eq!(Shard::parse("determinism"), None);
        assert_eq!(Shard::parse(""), None);
        assert_eq!(Shard { index: 2, count: 8 }.to_string(), "2/8");
    }

    #[test]
    fn every_entry_lands_in_exactly_one_shard() {
        let costs = fake_costs();
        for count in 1..=costs.len() + 2 {
            let plan = ShardPlan::split(costs.clone(), count, false);
            assert_eq!(plan.count(), count);
            let mut seen: Vec<&str> = (0..count).flat_map(|index| plan.names(index)).collect();
            seen.sort_unstable();
            let mut all: Vec<&str> = costs.iter().map(|(name, _)| name.as_str()).collect();
            all.sort_unstable();
            assert_eq!(seen, all, "{count} shards");
            let sum: u64 = (0..count).map(|index| plan.cost(index)).sum();
            assert_eq!(sum, plan.total());
        }
    }

    #[test]
    fn every_build_lands_in_exactly_one_part() {
        let costs = fake_costs();
        for count in 1..=costs.len() + 2 {
            let plan = ShardPlan::split(costs.clone(), count, true);
            for (entry, held) in holders(&plan).iter().enumerate() {
                assert!(
                    held.iter().all(|&holders| holders == 1),
                    "{count} shards, entry {entry}: {held:?}"
                );
            }
            let sum: u64 = (0..count).map(|index| plan.cost(index)).sum();
            assert_eq!(sum, plan.total(), "{count} shards");
            // A shard holds one part of an entry at most.
            for index in 0..count {
                let mut names = plan.names(index);
                let before = names.len();
                names.dedup();
                assert_eq!(names.len(), before, "{count} shards, shard {index}");
            }
        }
    }

    #[test]
    fn the_split_depends_only_on_the_costs_and_the_count() {
        for by_build in [false, true] {
            let one = ShardPlan::split(fake_costs(), 4, by_build);
            assert_eq!(one, ShardPlan::split(fake_costs(), 4, by_build));
            // Each shard lists its entries in the manifest's order.
            for index in 0..4 {
                let names = one.names(index);
                let places: Vec<usize> = names
                    .iter()
                    .map(|name| name.trim_start_matches("entry").parse().unwrap())
                    .collect();
                assert!(places.windows(2).all(|pair| pair[0] < pair[1]), "{names:?}");
            }
        }
    }

    #[test]
    fn the_costliest_entries_go_first_to_the_lightest_shard() {
        let plan = ShardPlan::split(fake_costs(), 4, false);
        // The two largest entries, 900 and 500, each pass what the rest give a shard, so each
        // stands alone, and the rest fill the other two shards to within the smallest entry.
        assert_eq!(plan.names(0), ["entry1"]);
        assert_eq!(plan.names(1), ["entry17"]);
        let (two, three) = (plan.cost(2), plan.cost(3));
        assert!(two.abs_diff(three) <= 1, "{two} and {three}");
        assert_eq!((0..4).map(|index| plan.cost(index)).max(), Some(900));
        // A split by every fourth entry puts 1,717 into one shard.
        let every_fourth = (0..4)
            .map(|first| {
                fake_costs()
                    .iter()
                    .skip(first)
                    .step_by(4)
                    .map(|(_, cost)| cost)
                    .sum::<u64>()
            })
            .max();
        assert_eq!(every_fourth, Some(1_717));
    }

    #[test]
    fn a_split_by_build_cuts_an_entry_that_passes_an_even_share() {
        let plan = ShardPlan::split(fake_costs(), 4, true);
        // An even share is about 587 of 2,347. The entry of 900 is cut into parts in as many
        // shards, and no shard then passes an even share by more than a few small entries.
        let parts: Vec<Part> = plan
            .shards
            .iter()
            .flatten()
            .filter(|unit| unit.entry == 1)
            .map(|unit| unit.part)
            .collect();
        assert!(parts.len() > 1, "{plan}");
        assert!(parts.iter().all(|part| part.count == parts.len()), "{plan}");
        let loads: Vec<u64> = (0..4).map(|index| plan.cost(index)).collect();
        assert!(loads.iter().all(|&load| load < 600), "{loads:?}");
        assert!(plan.to_string().contains("entry1 (part "), "{plan}");
        assert!(
            plan.to_string()
                .contains(&format!("Its builds are split into {} parts.", parts.len())),
            "{plan}"
        );
    }

    #[test]
    fn a_split_by_build_keeps_whole_entries_when_no_part_would_help() {
        let even = vec![
            ("one".to_owned(), 10),
            ("two".to_owned(), 10),
            ("three".to_owned(), 10),
        ];
        let plan = ShardPlan::split(even, 3, true);
        assert!(
            plan.shards
                .iter()
                .flatten()
                .all(|unit| unit.part == Part::WHOLE)
        );
    }

    #[test]
    fn the_narrowed_inputs_of_a_shard_carry_its_parts() {
        let manifest = "[shaders.big]\nfile = \"big.wgsl\"\nvariants.v = { permutations = [\"SKIN\", \"TONE_MAP\"], targets = [\"wgsl\"] }\n\n[shaders.small]\nfile = \"small.wgsl\"\nvariants.v = { targets = [\"wgsl\"] }\n";
        let mut files = std::collections::BTreeMap::new();
        files.insert("big.wgsl".to_owned(), String::new());
        files.insert("small.wgsl".to_owned(), String::new());
        let inputs = Inputs {
            manifest: manifest.to_owned(),
            files,
            parts: std::collections::BTreeMap::new(),
            only: Default::default(),
        };
        let costs = entry_costs(&inputs).unwrap();
        assert_eq!(costs, [("big".to_owned(), 4), ("small".to_owned(), 1)]);
        let plan = ShardPlan::by_build(&inputs, 2).unwrap();
        let mut builds = Vec::new();
        for index in 0..2 {
            let shard = plan.inputs(&inputs, index);
            if let Some(part) = shard.parts.get("big") {
                assert_eq!(part.count, 2);
            }
            let names = crate::build_names(&shard).unwrap();
            builds.extend(names.get("big").cloned().unwrap_or_default());
        }
        builds.sort();
        let mut whole = crate::build_names(&inputs).unwrap()["big"].clone();
        whole.sort();
        assert_eq!(builds, whole);
    }

    #[test]
    fn an_entry_is_never_cut_into_more_parts_than_it_has_builds() {
        let costs = vec![("small".to_owned(), 3), ("tiny".to_owned(), 0)];
        let plan = ShardPlan::split(costs, 8, true);
        let parts: Vec<Part> = plan.shards.iter().flatten().map(|unit| unit.part).collect();
        assert_eq!(parts.iter().filter(|part| part.count == 3).count(), 3);
        assert!(parts.contains(&Part::WHOLE));
        assert!(holders(&plan)[0].iter().all(|&holders| holders == 1));
    }

    #[test]
    fn the_pieces_of_a_part_hold_its_builds_once() {
        let part = Part { index: 1, count: 3 };
        for place in 0..60 {
            let pieces = (0..4)
                .filter(|&piece| part.piece(piece, 4).holds(place))
                .count();
            assert_eq!(pieces, usize::from(part.holds(place)), "place {place}");
        }
        assert_eq!(Part::WHOLE.builds_of(10), 10);
        assert_eq!(Part { index: 0, count: 3 }.builds_of(10), 4);
        assert_eq!(Part { index: 2, count: 3 }.builds_of(10), 3);
        assert_eq!(Part { index: 2, count: 3 }.builds_of(2), 0);
    }

    #[test]
    fn a_shard_past_the_last_holds_nothing() {
        let plan = ShardPlan::split(fake_costs(), 2, false);
        assert!(plan.names(2).is_empty());
        assert_eq!(plan.cost(2), 0);
    }

    #[test]
    fn the_report_names_every_shard_and_the_costliest_entry() {
        let plan = ShardPlan::split(fake_costs(), 4, false);
        let report = plan.to_string();
        for index in 0..4 {
            assert!(report.contains(&format!("shard {index}/4: ")), "{report}");
        }
        assert!(
            report.contains("The costliest entry is entry1, at 38.3% of the whole build."),
            "{report}"
        );
        assert!(
            report.contains("more than an even share of 25.0%"),
            "{report}"
        );
    }
}
