//! Transform propagation on random trees, checked against a double-precision reference that
//! walks each object's parent chain, with and without job workers.

mod common;

use std::collections::BTreeMap;

use common::{Mat64, Rng, Workers, compose64, max_axis_scale64, mul64};
use null3d_core::handle::Handle;
use null3d_core::jobs::JobSystem;
use null3d_core::scene::{Command, PARALLEL_LEVEL_THRESHOLD, SceneStorage, flags};
use null3d_core::world::HIDDEN_RADIUS;

/// What the test believes about one object.
#[derive(Clone, Debug)]
struct Obj {
    parent: Option<Handle>,
    position: [f32; 3],
    rotation: [f32; 4],
    scale: [f32; 3],
    radius: f32,
    dynamic: bool,
    visible: bool,
}

/// The world matrix and visibility of `h`, by walking up its parents.
fn reference(model: &BTreeMap<u32, Obj>, h: Handle) -> (Mat64, bool) {
    let o = &model[&h.raw()];
    let local = compose64(o.position, o.rotation, o.scale);
    match o.parent {
        None => (local, o.visible),
        Some(p) => {
            let (parent, parent_visible) = reference(model, p);
            (mul64(&parent, &local), parent_visible && o.visible)
        }
    }
}

fn is_descendant(model: &BTreeMap<u32, Obj>, h: Handle, ancestor: Handle) -> bool {
    let mut cur = Some(h);
    while let Some(c) = cur {
        if c == ancestor {
            return true;
        }
        cur = model[&c.raw()].parent;
    }
    false
}

fn random_obj(rng: &mut Rng, parent: Option<Handle>) -> Obj {
    Obj {
        parent,
        position: [
            rng.range(-5.0, 5.0),
            rng.range(-5.0, 5.0),
            rng.range(-5.0, 5.0),
        ],
        rotation: rng.quaternion(),
        scale: [
            rng.range(0.6, 1.4),
            rng.range(0.6, 1.4),
            rng.range(0.6, 1.4),
        ],
        radius: rng.range(0.1, 3.0),
        dynamic: rng.below(10) < 3,
        visible: rng.below(10) < 9,
    }
}

fn flags_of(o: &Obj) -> u32 {
    (if o.dynamic { flags::DYNAMIC } else { 0 }) | (if o.visible { flags::VISIBLE } else { 0 })
}

/// A random live object, or none.
fn pick(rng: &mut Rng, model: &BTreeMap<u32, Obj>) -> Option<Handle> {
    if model.is_empty() {
        return None;
    }
    let i = rng.below(model.len() as u32) as usize;
    model.keys().nth(i).map(|&raw| Handle::from_raw(raw))
}

/// Writes an object's transform inputs the way TypeScript does: directly for dynamic objects,
/// through setters (which mark the object dirty) for static ones.
fn write_inputs(scene: &mut SceneStorage, h: Handle, o: &Obj, direct: bool) {
    if direct {
        let s = scene.resolve(h).unwrap() as usize;
        scene.positions_mut()[s * 3..s * 3 + 3].copy_from_slice(&o.position);
        scene.rotations_mut()[s * 4..s * 4 + 4].copy_from_slice(&o.rotation);
        scene.scales_mut()[s * 3..s * 3 + 3].copy_from_slice(&o.scale);
        scene.local_radii_mut()[s] = o.radius;
    } else {
        scene.set_position(h, o.position).unwrap();
        scene.set_rotation(h, o.rotation).unwrap();
        scene.set_scale(h, o.scale).unwrap();
        scene.set_local_radius(h, o.radius).unwrap();
    }
}

struct Run {
    scene: SceneStorage,
    workers: Option<Workers>,
    serial: JobSystem,
}

fn check_against_reference(scene: &SceneStorage, model: &BTreeMap<u32, Obj>, frame: u32) {
    let world = scene.current_world();
    for &raw in model.keys() {
        let h = Handle::from_raw(raw);
        let slot = scene.resolve(h).unwrap() as usize;
        let (expected, visible) = reference(model, h);
        let got = world.matrix(slot);
        let scale = expected.iter().fold(1.0f64, |m, v| m.max(v.abs()));
        for k in 0..12 {
            let err = (f64::from(got[k]) - expected[k]).abs();
            assert!(
                err <= 1e-5 * scale,
                "frame {frame}, slot {slot}, element {k}: {} vs {} (scale {scale})",
                got[k],
                expected[k]
            );
        }
        let radius = world.radii()[slot];
        if visible {
            let o = &model[&raw];
            let want = f64::from(o.radius) * max_axis_scale64(&expected);
            assert!(
                (f64::from(radius) - want).abs() <= 1e-5 * (1.0 + want),
                "frame {frame}, slot {slot}: radius {radius} vs {want}"
            );
            assert_eq!(world.xs()[slot], got[3]);
        } else {
            assert_eq!(
                radius, HIDDEN_RADIUS,
                "frame {frame}, slot {slot} should be hidden"
            );
        }
    }
}

/// Runs the same random frames on several scenes and checks each against the reference.
fn random_frames(seed: u64, initial: usize, frames: u32, worker_counts: &[u32]) {
    let mut runs: Vec<Run> = worker_counts
        .iter()
        .map(|&w| Run {
            scene: SceneStorage::with_capacity(initial as u32 + frames * 20),
            workers: (w > 0).then(|| Workers::start(w)),
            serial: JobSystem::new(0),
        })
        .collect();
    let mut rng = Rng::new(seed);
    let mut model: BTreeMap<u32, Obj> = BTreeMap::new();
    let mut previous: BTreeMap<u32, Mat64> = BTreeMap::new();
    let mut cycles = 0;
    let mut widest_level = 0;

    for frame in 1..=frames {
        let mut commands = Vec::new();
        let creates = if frame == 1 { initial } else { 20 };
        for _ in 0..creates {
            // Half the new objects are roots, so levels stay wide.
            let parent = if rng.below(2) == 0 {
                None
            } else {
                pick(&mut rng, &model)
            };
            let o = random_obj(&mut rng, parent);
            let handles: Vec<Handle> = runs
                .iter_mut()
                .map(|r| r.scene.reserve().unwrap())
                .collect();
            let h = handles[0];
            assert!(handles.iter().all(|&x| x == h));
            for r in &mut runs {
                write_inputs(&mut r.scene, h, &o, false);
            }
            commands.push(Command::create(
                h,
                parent.unwrap_or(Handle::NONE),
                1,
                flags_of(&o),
            ));
            model.insert(h.raw(), o);
        }
        if frame > 1 {
            for _ in 0..10 {
                let Some(h) = pick(&mut rng, &model) else {
                    break;
                };
                commands.push(Command::destroy(h));
                model.remove(&h.raw());
                for o in model.values_mut() {
                    if o.parent == Some(h) {
                        o.parent = None;
                    }
                }
            }
            for _ in 0..30 {
                let Some(child) = pick(&mut rng, &model) else {
                    break;
                };
                let parent = if rng.below(4) == 0 {
                    None
                } else {
                    pick(&mut rng, &model)
                };
                commands.push(Command::set_parent(child, parent.unwrap_or(Handle::NONE)));
                let cycle = parent.is_some_and(|p| is_descendant(&model, p, child));
                cycles += u32::from(cycle);
                if !cycle {
                    model.get_mut(&child.raw()).unwrap().parent = parent;
                }
            }
            // Moving an object's parent under the object always forms a cycle.
            for _ in 0..3 {
                let Some(child) = pick(&mut rng, &model) else {
                    break;
                };
                if let Some(parent) = model[&child.raw()].parent {
                    assert!(is_descendant(&model, child, parent));
                    commands.push(Command::set_parent(parent, child));
                    cycles += 1;
                }
            }
            for _ in 0..20 {
                let Some(h) = pick(&mut rng, &model) else {
                    break;
                };
                let o = model.get_mut(&h.raw()).unwrap();
                if rng.below(2) == 0 {
                    o.dynamic = !o.dynamic;
                    commands.push(Command::set_dynamic(h, o.dynamic));
                } else {
                    o.visible = !o.visible;
                    commands.push(Command::set_visible(h, o.visible));
                }
            }
        }
        for r in &mut runs {
            // Errors are cycles the model predicted; the model skipped them too.
            let _ = r.scene.apply_commands(&commands, frame);
        }
        // Move every dynamic object and a tenth of the static ones.
        let keys: Vec<u32> = model.keys().copied().collect();
        for raw in keys {
            let o = model.get_mut(&raw).unwrap();
            if o.dynamic || rng.below(10) == 0 {
                let parent = o.parent;
                *o = Obj {
                    parent,
                    dynamic: o.dynamic,
                    visible: o.visible,
                    ..random_obj(&mut rng, parent)
                };
                for r in &mut runs {
                    write_inputs(&mut r.scene, Handle::from_raw(raw), o, o.dynamic);
                }
            }
        }
        for Run {
            scene,
            workers,
            serial,
        } in &mut runs
        {
            scene.update_transforms(workers.as_ref().map_or(&*serial, Workers::jobs));
            check_against_reference(scene, &model, frame);
        }
        // Every run computed the same bits.
        let first = runs[0].scene.current_world();
        for r in &runs[1..] {
            let w = r.scene.current_world();
            assert_eq!(first.matrices(), w.matrices(), "frame {frame}");
            assert_eq!(first.radii(), w.radii(), "frame {frame}");
            assert_eq!(runs[0].scene.changed(), r.scene.changed(), "frame {frame}");
        }
        // Every object whose world matrix moved is in the changed set.
        let scene = &runs[0].scene;
        for &raw in model.keys() {
            let (m, _) = reference(&model, Handle::from_raw(raw));
            let slot = scene.resolve(Handle::from_raw(raw)).unwrap();
            if previous.get(&raw).is_none_or(|p| p != &m) {
                assert!(
                    scene.changed().get(slot),
                    "frame {frame}: slot {slot} moved but is not listed"
                );
            }
            previous.insert(raw, m);
        }
        previous.retain(|raw, _| model.contains_key(raw));
        let mut per_depth = BTreeMap::new();
        for &raw in model.keys() {
            let slot = scene.resolve(Handle::from_raw(raw)).unwrap() as usize;
            *per_depth.entry(scene.depths()[slot]).or_insert(0u32) += 1;
        }
        widest_level = widest_level.max(per_depth.values().copied().max().unwrap_or(0));
    }
    assert!(cycles > 0, "no reparent formed a cycle");
    if initial >= 1000 {
        assert!(
            widest_level >= PARALLEL_LEVEL_THRESHOLD,
            "no level ran in parallel"
        );
    }
}

#[test]
fn random_trees_match_the_reference_on_one_thread() {
    random_frames(1, 500, 40, &[0]);
}

#[test]
fn random_trees_match_the_reference_with_four_workers() {
    // Large enough that several levels pass the parallel threshold.
    random_frames(7, 4000, 25, &[0, 4]);
}
