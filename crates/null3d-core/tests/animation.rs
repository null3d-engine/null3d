//! Animation sampling against three.js: clips resampled from the fixture's keys, sampled, blended
//! and composed into skinning matrices, compared with what three.js's `AnimationMixer` and
//! `Skeleton` give for the same skeleton and clips (`bun bench/three-fixtures.ts`). Also the
//! resampling rules, refused input, and the frame step on several threads.

mod common;

#[path = "fixtures/three_animation.rs"]
mod three;

use common::{Workers, axis_angle, character};
use null3d_core::animation::{
    AnimationError, Animations, BakedKeys, Blend, Channel, Clip, DEFAULT_RATE, EVENT_WORDS,
    Interpolation, MATRIX_FLOATS, MAX_BLEND, MAX_CLIP_KEYS, MAX_LAYERS, NO_PARENT, NO_SOURCE,
    POSE_FIELDS, Play, Skeleton, SourceTrack, TrackProblem, bake, event_kind, flag, joints,
    resample,
};
use null3d_core::error::{CoreError, Resource};
use null3d_core::jobs::JobSystem;

/// The largest difference allowed from three.js in a local translation, scale or quaternion
/// component. Rotations are stored as 16-bit integers (a step of 1/32767) and interpolated
/// linearly before they are normalized, where three.js interpolates along the arc.
const POSE_TOLERANCE: f64 = 2e-4;
/// The largest difference allowed in a skinning matrix element. The fixture's bones reach about
/// 2.5 units from the root, so errors in the joints above a bone add up.
const SKIN_TOLERANCE: f64 = 1e-3;

fn skeleton() -> Skeleton {
    Skeleton::new(&three::PARENTS, &three::REST, &three::INVERSE_BIND).unwrap()
}

fn tracks(clip: &three::Clip) -> Vec<SourceTrack<'static>> {
    clip.tracks
        .iter()
        .map(|t| SourceTrack {
            joint: t.joint,
            channel: Channel::from_u32(t.channel).unwrap(),
            interpolation: Interpolation::from_u32(t.interpolation).unwrap(),
            times: t.times,
            values: t.values,
        })
        .collect()
}

fn clips(skeleton: &Skeleton) -> Vec<Clip> {
    three::CLIPS
        .iter()
        .map(|c| resample(skeleton, &tracks(c), DEFAULT_RATE).unwrap())
        .collect()
}

/// The largest difference between two lists of numbers.
fn largest_difference(a: impl IntoIterator<Item = f64>, b: &[f64]) -> f64 {
    a.into_iter()
        .zip(b)
        .map(|(a, b)| (a - b).abs())
        .fold(0.0, f64::max)
}

/// The largest difference between two poses of the fixture's skeleton. A quaternion and its
/// negation are the same rotation.
fn pose_difference(pose: &[f32], lanes: usize, expected: &[f64]) -> f64 {
    let mut largest = 0.0f64;
    for (j, want) in expected.as_chunks::<POSE_FIELDS>().0.iter().enumerate() {
        let got: Vec<f64> = (0..POSE_FIELDS)
            .map(|f| f64::from(pose[f * lanes + j]))
            .collect();
        let vectors = largest_difference(
            got[..3].iter().chain(&got[7..]).copied(),
            &[&want[..3], &want[7..]].concat(),
        );
        let same = largest_difference(got[3..7].iter().copied(), &want[3..7]);
        let negated = largest_difference(got[3..7].iter().map(|v| -v), &want[3..7]);
        largest = largest.max(vectors).max(same.min(negated));
    }
    largest
}

/// Runs every fixture case through an animation table with one instance per case.
fn skin_matrices(jobs: &JobSystem) -> (Animations, Vec<u32>) {
    let skeleton = skeleton();
    let joints = skeleton.joints();
    let clips = clips(&skeleton);
    let cases = three::CASES.len() as u32;
    let mut animations = Animations::new(jobs, cases, cases * joints).unwrap();
    let id = animations.add_skeleton(skeleton).unwrap();
    let clip_ids: Vec<u32> = clips
        .into_iter()
        .map(|clip| animations.add_clip(id, clip).unwrap())
        .collect();
    let instances: Vec<u32> = three::CASES
        .iter()
        .map(|case| {
            let instance = animations.add_instance(id).unwrap();
            for (slot, &(clip, time, weight)) in case.samples.iter().enumerate() {
                animations.set_sample(instance, slot, clip_ids[clip], time, weight);
            }
            instance
        })
        .collect();
    animations.update(jobs, 0.0);
    (animations, instances)
}

#[test]
fn clips_keep_a_source_grid_up_to_the_rate_and_resample_others() {
    let skeleton = skeleton();
    let clips = clips(&skeleton);
    let summary: Vec<(u32, f32, f32, u32, u32)> = clips
        .iter()
        .map(|c| {
            (
                c.frames(),
                c.rate(),
                c.duration(),
                c.tracks(),
                c.animated_tracks(),
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            // Keys every thirtieth of a second: kept. Two constant tracks are stored once.
            (31, 30.0, 1.0, 8, 6),
            // Uneven keys: 30 keys a second, adjusted to end on the clip's last key.
            (43, (42.0f64 / 1.37) as f32, 1.37, 4, 4),
            // Keys every 24th of a second: kept.
            (19, 24.0, 0.75, 2, 2),
            // Uneven cubic spline keys: 30 keys a second, so the curve between keys survives.
            (76, 30.0, 2.5, 3, 3),
            // Cubic spline keys every half second: 15 keys between each two, so the file's own
            // keys stay exact.
            (61, 30.0, 2.0, 3, 3),
        ]
    );
    // A rate of 60 keys a second is above the default rate, so it becomes 30.
    let times: Vec<f32> = (0..=60).map(|k| k as f32 / 60.0).collect();
    let values: Vec<f32> = times.iter().flat_map(|t| [*t, 0.0, 0.0]).collect();
    let track = SourceTrack {
        joint: 0,
        channel: Channel::Translation,
        interpolation: Interpolation::Linear,
        times: &times,
        values: &values,
    };
    let clip = resample(&skeleton, &[track], DEFAULT_RATE).unwrap();
    assert_eq!((clip.frames(), clip.rate()), (31, 30.0));
    // 32 thirtieths of a second as a 32-bit float lies a little past 32 frames, and still ends on
    // the 32nd, so the clip keeps the file's keys (the KayKit Knight's clips end so).
    let times: Vec<f32> = (0..=32).map(|k| k as f32 / 30.0).collect();
    let values: Vec<f32> = times.iter().flat_map(|t| [*t, 0.0, 0.0]).collect();
    let ends_late = SourceTrack {
        times: &times,
        values: &values,
        ..track
    };
    let clip = resample(&skeleton, &[ends_late], DEFAULT_RATE).unwrap();
    assert_eq!(clip.frames(), 33);
    assert!((clip.rate() - 30.0).abs() < 1e-5, "{}", clip.rate());
    // A clip whose keys all sit at time 0 has one frame and no animated track.
    let still = SourceTrack {
        times: &[0.0],
        values: &[1.0, 2.0, 3.0],
        ..track
    };
    let clip = resample(&skeleton, &[still], DEFAULT_RATE).unwrap();
    assert_eq!((clip.frames(), clip.animated_tracks()), (1, 0));
    let mut pose = vec![0.0; clip.pose_len()];
    clip.sample(0.5, &mut pose);
    assert_eq!(clip.base().joint(0).0, [1.0, 2.0, 3.0]);
}

#[test]
fn tracks_that_move_under_a_millionth_count_as_constant() {
    let skeleton = skeleton();
    let times: Vec<f32> = (0..=30).map(|k| k as f32 / 30.0).collect();
    // Is a track that moves its first component by `change` on every other key stored once?
    let constant = |channel: Channel, key: &dyn Fn(f64) -> Vec<f32>, change: f64| {
        let values: Vec<f32> = (0..times.len())
            .flat_map(|k| key(if k % 2 == 1 { change } else { 0.0 }))
            .collect();
        let track = SourceTrack {
            joint: 1,
            channel,
            interpolation: Interpolation::Linear,
            times: &times,
            values: &values,
        };
        let clip = resample(&skeleton, &[track], DEFAULT_RATE).unwrap();
        let baked = bake(&[track], skeleton.joints(), DEFAULT_RATE).unwrap();
        let one_key = baked.tracks[0] == BakedKeys::Floats(key(0.0));
        assert_eq!(clip.animated_tracks() == 0, one_key, "{channel:?} {change}");
        one_key
    };
    // Within 1, the tolerance is a millionth.
    let small = |d: f64| vec![(0.25 + d) as f32, -0.5, 0.75];
    assert!(constant(Channel::Translation, &small, 0.9e-6));
    assert!(!constant(Channel::Translation, &small, 1.1e-6));
    // Past 1, it is a millionth of the track's largest value.
    let large = |d: f64| vec![(150.0 + d) as f32, 3.0, 400.0];
    assert!(constant(Channel::Scale, &large, 0.9 * 400e-6));
    assert!(!constant(Channel::Scale, &large, 1.1 * 400e-6));
    // A rotation compares as a quaternion, whichever sign a key has. The first component sits
    // near the middle of two 16-bit steps, so both moves change its 16-bit integer.
    let x: f64 = 10_000.49 / 32767.0;
    let turn = |d: f64| {
        let (x, sign) = (x + d.abs(), if d < 0.0 { -1.0 } else { 1.0 });
        let q = [x, 0.0, 0.0, (1.0 - x * x).sqrt()];
        q.iter().map(|v| (v * sign) as f32).collect()
    };
    assert!(constant(Channel::Rotation, &turn, 0.9e-6));
    assert!(constant(Channel::Rotation, &turn, -0.9e-6));
    assert!(!constant(Channel::Rotation, &turn, 1.1e-6));
    assert!(!constant(Channel::Rotation, &turn, -1.1e-6));
    // The one key is the first: that value goes into the clip's base pose.
    let values: Vec<f32> = (0..times.len())
        .flat_map(|k| small(if k % 2 == 1 { 0.9e-6 } else { 0.0 }))
        .collect();
    let track = SourceTrack {
        joint: 1,
        channel: Channel::Translation,
        interpolation: Interpolation::Step,
        times: &times,
        values: &values,
    };
    let clip = resample(&skeleton, &[track], DEFAULT_RATE).unwrap();
    assert_eq!(clip.base().joint(1).0, [0.25, -0.5, 0.75]);
}

/// A baked track as a file of the asset tool holds it: keys at the frames, or one key at the end,
/// with rotations as 16-bit integers that a reader turns into floats.
fn baked_track(keys: &BakedKeys) -> Vec<f32> {
    match keys {
        BakedKeys::Rotations(keys) => keys.iter().map(|&k| f32::from(k) / 32767.0).collect(),
        BakedKeys::Floats(values) => values.clone(),
    }
}

#[test]
fn baked_clips_load_with_copies_into_the_same_clips() {
    let skeleton = skeleton();
    for (c, source) in three::CLIPS.iter().enumerate() {
        let tracks = tracks(source);
        let resampled = resample(&skeleton, &tracks, DEFAULT_RATE).unwrap();
        let baked = bake(&tracks, skeleton.joints(), DEFAULT_RATE).unwrap();
        assert_eq!(baked.times.len() as u32, resampled.frames(), "clip {c}");
        let end = [*baked.times.last().unwrap()];
        let values: Vec<Vec<f32>> = baked.tracks.iter().map(baked_track).collect();
        let stored: Vec<SourceTrack<'_>> = tracks
            .iter()
            .zip(&values)
            .map(|(track, values)| {
                let constant = values.len() == track.channel.components();
                SourceTrack {
                    // Cubic spline tracks are stored as linear keys on the curve.
                    interpolation: match track.interpolation {
                        Interpolation::Step => Interpolation::Step,
                        _ => Interpolation::Linear,
                    },
                    times: if constant { &end } else { &baked.times },
                    values,
                    ..*track
                }
            })
            .collect();
        let copied = resample(&skeleton, &stored, DEFAULT_RATE).unwrap();
        assert_eq!(copied.resampled_tracks(), 0, "clip {c}");
        assert_eq!(
            (copied.frames(), copied.rate(), copied.duration()),
            (resampled.frames(), resampled.rate(), resampled.duration()),
            "clip {c}"
        );
        assert_eq!(
            copied.animated_tracks(),
            resampled.animated_tracks(),
            "clip {c}"
        );
        // The copies hold the resampled clip's keys exactly, so every pose is the same.
        let (mut a, mut b) = (
            vec![0.0; resampled.pose_len()],
            vec![0.0; copied.pose_len()],
        );
        for step in 0..=200 {
            let time = resampled.duration() * step as f32 / 200.0;
            resampled.sample(time, &mut a);
            copied.sample(time, &mut b);
            assert_eq!(a, b, "clip {c} at {time}");
        }
    }
}

#[test]
fn tracks_on_the_frames_are_copied_and_others_resampled() {
    let skeleton = skeleton();
    let grid: Vec<f32> = (0..=30).map(|k| k as f32 / 30.0).collect();
    let moving: Vec<f32> = grid.iter().flat_map(|t| [*t, 0.0, 0.0]).collect();
    let uneven = [0.0, 0.4, 1.0];
    let few = [0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 3.0, 0.0, 0.0];
    let on_frames = SourceTrack {
        joint: 0,
        channel: Channel::Translation,
        interpolation: Interpolation::Linear,
        times: &grid,
        values: &moving,
    };
    let one_key = SourceTrack {
        joint: 1,
        times: &[1.0],
        values: &[1.0, 2.0, 3.0],
        ..on_frames
    };
    let off_frames = SourceTrack {
        joint: 2,
        times: &uneven,
        values: &few,
        ..on_frames
    };
    let clip = resample(&skeleton, &[on_frames, one_key], DEFAULT_RATE).unwrap();
    assert_eq!((clip.frames(), clip.resampled_tracks()), (31, 0));
    let clip = resample(&skeleton, &[on_frames, one_key, off_frames], DEFAULT_RATE).unwrap();
    assert_eq!((clip.frames(), clip.resampled_tracks()), (31, 1));
    // A cubic spline track on the frames still follows its curve between them.
    let cubic: Vec<f32> = grid
        .iter()
        .flat_map(|t| [0.0; 3].into_iter().chain([*t, 0.0, 0.0]).chain([0.0; 3]))
        .collect();
    let curve = SourceTrack {
        interpolation: Interpolation::CubicSpline,
        values: &cubic,
        ..on_frames
    };
    let clip = resample(&skeleton, &[curve], DEFAULT_RATE).unwrap();
    assert_eq!(clip.resampled_tracks(), 1);
}

#[test]
fn single_clips_sample_as_three_js_does() {
    let skeleton = skeleton();
    let clips = clips(&skeleton);
    let lanes = skeleton.lanes() as usize;
    let mut pose = vec![0.0; POSE_FIELDS * lanes];
    let mut largest = 0.0f64;
    let single = three::CASES
        .iter()
        .filter(|c| c.samples.len() == 1 && c.samples[0].2 == 1.0);
    for case in single {
        let (clip, time, _) = case.samples[0];
        clips[clip].sample(time, &mut pose);
        let difference = pose_difference(&pose, lanes, &case.pose);
        assert!(
            difference <= POSE_TOLERANCE,
            "{}: the local pose is {difference} from three.js's",
            case.name
        );
        largest = largest.max(difference);
    }
    println!("largest difference in a local pose from three.js: {largest:e}");
}

#[test]
fn joints_that_turn_far_between_keys_follow_the_arc_in_any_group() {
    // Four joints turn a little between keys and the last a radian, so in joint order the fast
    // track would share no group with the first four. A quarter of the way between keys, plain
    // interpolation strays from the arc by far more than the tolerance.
    let skeleton = skeleton();
    let lanes = skeleton.lanes() as usize;
    let times = [0.0, 1.0 / 30.0];
    let turns = [0.05, 0.05, 0.05, 0.05, 1.0];
    let values: Vec<Vec<f32>> = turns
        .iter()
        .map(|&turn| {
            [0.0, turn]
                .iter()
                .flat_map(|&a| axis_angle([0.0, 0.0, 1.0], a))
                .collect()
        })
        .collect();
    let tracks: Vec<SourceTrack<'_>> = values
        .iter()
        .enumerate()
        .map(|(joint, values)| SourceTrack {
            joint: joint as u32,
            channel: Channel::Rotation,
            interpolation: Interpolation::Linear,
            times: &times,
            values,
        })
        .collect();
    let clip = resample(&skeleton, &tracks, DEFAULT_RATE).unwrap();
    let mut pose = vec![0.0; clip.pose_len()];
    clip.sample(0.25 / 30.0, &mut pose);
    for (joint, &turn) in turns.iter().enumerate() {
        let want = axis_angle([0.0, 0.0, 1.0], turn / 4.0);
        let got: [f32; 4] = std::array::from_fn(|c| pose[(3 + c) * lanes + joint]);
        let difference = largest_difference(got.map(f64::from), &want.map(f64::from));
        assert!(
            difference <= POSE_TOLERANCE,
            "joint {joint}: {got:?} is {difference} from slerp's {want:?}"
        );
    }
}

#[test]
fn skinning_matrices_match_three_js_for_clips_and_blends() {
    for workers in [0, 3] {
        let pool = Workers::start(workers);
        let (animations, instances) = skin_matrices(pool.jobs());
        let mut largest = 0.0f64;
        for (case, &instance) in three::CASES.iter().zip(&instances) {
            let got = animations
                .instance_matrices(instance)
                .iter()
                .map(|&v| f64::from(v));
            let difference = largest_difference(got, &case.skin);
            assert!(
                difference <= SKIN_TOLERANCE,
                "{}: a skinning matrix is {difference} from three.js's",
                case.name
            );
            largest = largest.max(difference);
        }
        println!(
            "{workers} job workers: largest difference in a skinning matrix from three.js: {largest:e}"
        );
    }
}

#[test]
fn the_rest_pose_gives_identity_skinning_matrices() {
    let (animations, instances) = skin_matrices(&JobSystem::new(0));
    let rest = animations.instance_matrices(instances[0]);
    let identity = null3d_core::math::IDENTITY
        .map(f64::from)
        .repeat(three::PARENTS.len());
    let difference = largest_difference(rest.iter().map(|&v| f64::from(v)), &identity);
    assert!(difference < 1e-5, "{difference}");
}

#[test]
fn slots_that_name_no_usable_clip_are_skipped() {
    let jobs = JobSystem::new(0);
    let (_, clips) = character(8);
    let (other, other_clips) = character(12);
    let (skeleton, _) = character(8);
    let mut animations = Animations::new(&jobs, 4, 64).unwrap();
    let id = animations.add_skeleton(skeleton).unwrap();
    let other_id = animations.add_skeleton(other).unwrap();
    let clip = animations.add_clip(id, clips[0].clone()).unwrap();
    let foreign = animations
        .add_clip(other_id, other_clips[0].clone())
        .unwrap();
    let rest = animations.add_instance(id).unwrap();
    let skipped = animations.add_instance(id).unwrap();
    animations.set_sample(skipped, 0, foreign, 0.5, 1.0);
    animations.set_sample(skipped, 1, 99, 0.5, 1.0);
    animations.set_sample(skipped, 2, clip, 0.5, f32::NAN);
    animations.set_sample(skipped, 3, clip, 0.5, -1.0);
    let infinite = animations.add_instance(id).unwrap();
    animations.set_sample(infinite, 0, clip, 0.5, f32::INFINITY);
    animations.update(&jobs, 0.0);
    let rest = animations.instance_matrices(rest).to_vec();
    assert_eq!(animations.instance_matrices(skipped), rest);
    assert_eq!(animations.instance_matrices(infinite), rest);
    assert!(rest.iter().all(|v| v.is_finite()));
}

#[test]
fn a_clip_weight_below_one_blends_with_the_rest_pose() {
    let jobs = JobSystem::new(0);
    let (skeleton, clips) = character(8);
    let mut animations = Animations::new(&jobs, 3, 24).unwrap();
    let id = animations.add_skeleton(skeleton).unwrap();
    let clip = animations.add_clip(id, clips[0].clone()).unwrap();
    let rest = animations.add_instance(id).unwrap();
    let full = animations.add_instance(id).unwrap();
    let none = animations.add_instance(id).unwrap();
    animations.set_sample(full, 0, clip, 0.4, 1.0);
    animations.set_sample(none, 0, clip, 0.4, 1e-30);
    animations.update(&jobs, 0.0);
    let difference = |a: u32, b: u32| {
        let b = animations
            .instance_matrices(b)
            .iter()
            .map(|&v| f64::from(v))
            .collect::<Vec<_>>();
        largest_difference(
            animations
                .instance_matrices(a)
                .iter()
                .map(|&v| f64::from(v)),
            &b,
        )
    };
    assert!(difference(none, rest) < 1e-6);
    assert!(difference(full, rest) > 0.1);
}

#[test]
fn a_table_that_grows_poses_as_one_made_large_enough() {
    let jobs = JobSystem::new(0);
    let (skeleton, clips) = character(8);
    let pose = |animations: &mut Animations, grow: bool| {
        let id = animations.add_skeleton(skeleton.clone()).unwrap();
        let clip = animations.add_clip(id, clips[0].clone()).unwrap();
        let mut added = Vec::new();
        for i in 0..9u32 {
            if grow && let Some((instances, joints)) = animations.growth_for(id, 1 << 20) {
                let old = animations.try_grow(instances, joints).unwrap();
                assert_eq!(old[0].len(), old[1].len());
            }
            let instance = animations.add_instance(id).unwrap();
            animations.set_sample(instance, 0, clip, i as f32 * 0.1, 1.0);
            added.push(instance);
            animations.update(&jobs, 1.0 / 60.0);
        }
        animations.remove_instance(added[3]).unwrap();
        animations.add_instance(id).unwrap();
        animations.update(&jobs, 1.0 / 60.0);
        animations.matrices()[..animations.joints() as usize * MATRIX_FLOATS].to_vec()
    };
    let mut small = Animations::new(&jobs, 2, 12).unwrap();
    let grown = pose(&mut small, true);
    assert_eq!(small.instance_capacity(), 16);
    assert_eq!(small.joint_capacity(), 96);
    let mut large = Animations::new(&jobs, 16, 96).unwrap();
    assert_eq!(grown, pose(&mut large, false));
    assert!(grown.iter().all(|v| v.is_finite()));
}

#[test]
fn growth_stops_at_the_most_joints_and_never_shrinks() {
    let jobs = JobSystem::new(0);
    let (skeleton, _) = character(8);
    let mut animations = Animations::new(&jobs, 1, 8).unwrap();
    let id = animations.add_skeleton(skeleton).unwrap();
    assert_eq!(
        animations.growth_for(id, 64),
        None,
        "the first instance fits"
    );
    animations.add_instance(id).unwrap();
    assert_eq!(animations.growth_for(id, 64), Some((2, 16)));
    assert_eq!(animations.growth_for(id, 12), None, "past the most joints");
    animations.try_grow(1, 4).unwrap();
    assert_eq!(
        (animations.instance_capacity(), animations.joint_capacity()),
        (1, 8)
    );
}

#[test]
fn many_instances_on_many_threads_match_one_thread() {
    let (skeleton, clips) = character(40);
    let build = |jobs: &JobSystem| {
        let mut animations = Animations::new(jobs, 200, 200 * 40).unwrap();
        let id = animations.add_skeleton(skeleton.clone()).unwrap();
        let ids: Vec<u32> = clips
            .iter()
            .map(|c| animations.add_clip(id, c.clone()).unwrap())
            .collect();
        for i in 0..200u32 {
            let instance = animations.add_instance(id).unwrap();
            let t = i as f32 * 0.013;
            animations.set_sample(instance, 0, ids[0], t, 0.25 + (i % 4) as f32 * 0.25);
            animations.set_sample(instance, 1, ids[1], t * 0.7, 1.0 - (i % 3) as f32 * 0.3);
        }
        animations.update(jobs, 0.0);
        animations.matrices().to_vec()
    };
    let serial = build(&JobSystem::new(0));
    let pool = Workers::start(4);
    assert_eq!(build(pool.jobs()), serial);
    assert!(serial.iter().all(|v| v.is_finite()));
}

#[test]
fn tables_refuse_what_they_cannot_hold() {
    let jobs = JobSystem::new(0);
    let (skeleton, clips) = character(8);
    let (small, _) = character(4);
    let mut animations = Animations::new(&jobs, 2, 12).unwrap();
    let id = animations.add_skeleton(skeleton).unwrap();
    let small_id = animations.add_skeleton(small).unwrap();
    assert_eq!(
        animations.add_clip(small_id, clips[0].clone()).unwrap_err(),
        AnimationError::WrongSkeleton {
            clip_joints: 8,
            skeleton_joints: 4
        }
    );
    assert_eq!(
        animations.add_instance(7).unwrap_err(),
        AnimationError::UnknownSkeleton { skeleton: 7 }
    );
    animations.add_instance(id).unwrap();
    assert_eq!(
        animations.add_instance(id).unwrap_err(),
        AnimationError::Core(CoreError::CapacityExceeded {
            resource: Resource::AnimatedJoints,
            capacity: 12
        })
    );
    animations.add_instance(small_id).unwrap();
    assert_eq!(
        animations.add_instance(small_id).unwrap_err(),
        AnimationError::Core(CoreError::CapacityExceeded {
            resource: Resource::AnimatedInstances,
            capacity: 2
        })
    );
    assert_eq!(animations.slots().weight.len(), 2 * MAX_BLEND);
    assert_eq!(animations.matrices().len(), 12 * MATRIX_FLOATS);
}

#[test]
fn resampling_refuses_bad_tracks() {
    let skeleton = Skeleton::new(
        &[NO_PARENT, 0],
        &[0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0].repeat(2),
        &null3d_core::math::IDENTITY.repeat(2),
    )
    .unwrap();
    let good = SourceTrack {
        joint: 1,
        channel: Channel::Rotation,
        interpolation: Interpolation::Linear,
        times: &[0.0, 1.0],
        values: &[0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0],
    };
    let problem = |tracks: &[SourceTrack<'_>]| match resample(&skeleton, tracks, DEFAULT_RATE) {
        Err(AnimationError::Track { track, problem }) => Some((track, problem)),
        Err(other) => panic!("{other:?}"),
        Ok(_) => None,
    };
    assert_eq!(problem(&[good]), None);
    assert_eq!(
        problem(&[SourceTrack { joint: 2, ..good }]),
        Some((0, TrackProblem::Joint))
    );
    assert_eq!(problem(&[good, good]), Some((1, TrackProblem::Duplicate)));
    assert_eq!(
        problem(&[SourceTrack {
            values: &[0.0; 7],
            ..good
        }]),
        Some((0, TrackProblem::Keys))
    );
    assert_eq!(
        problem(&[SourceTrack {
            times: &[],
            values: &[],
            ..good
        }]),
        Some((0, TrackProblem::Keys))
    );
    // A cubic spline key holds an in-tangent, a value and an out-tangent: three times the values.
    let cubic = SourceTrack {
        interpolation: Interpolation::CubicSpline,
        ..good
    };
    assert_eq!(problem(&[cubic]), Some((0, TrackProblem::Keys)));
    let tangents = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0];
    let keys = [tangents, tangents].concat();
    assert_eq!(
        problem(&[SourceTrack {
            values: &keys,
            ..cubic
        }]),
        None
    );
    for times in [
        [1.0, 0.5],
        [-1.0, 0.0],
        [0.0, f32::NAN],
        [0.0, f32::INFINITY],
    ] {
        let bad = SourceTrack {
            times: &times,
            ..good
        };
        assert_eq!(problem(&[bad]), Some((0, TrackProblem::Times)), "{times:?}");
    }
    let mut values = good.values.to_vec();
    values[5] = f32::NAN;
    assert_eq!(
        problem(&[SourceTrack {
            values: &values,
            ..good
        }]),
        Some((0, TrackProblem::Values))
    );
    // A clip of days at 30 keys a second would hold more keys than any real clip.
    let long = SourceTrack {
        times: &[0.0, 1.0e6],
        ..good
    };
    assert!(matches!(
        resample(&skeleton, &[long], DEFAULT_RATE),
        Err(AnimationError::Keys { keys }) if u64::from(keys) > MAX_CLIP_KEYS
    ));
}

/// A clip of 32 rotation tracks, each with two keys 34,000 seconds apart, as a 1 KB glTF clip
/// holds them. Its frames alone stay under the most one track may have, but frames times tracks
/// do not, so the clip is refused at once instead of resampling for seconds into hundreds of MB.
#[test]
fn a_clip_whose_frames_times_tracks_pass_the_limit_is_refused_before_it_allocates() {
    let joints: u32 = 32;
    let parents: Vec<u32> = (0..joints)
        .map(|j| j.checked_sub(1).unwrap_or(NO_PARENT))
        .collect();
    let skeleton = Skeleton::new(
        &parents,
        &[0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0].repeat(joints as usize),
        &null3d_core::math::IDENTITY.repeat(joints as usize),
    )
    .unwrap();
    let times = [0.0f32, 34_000.0];
    let s = std::f32::consts::FRAC_1_SQRT_2;
    let values = [0.0f32, 0.0, 0.0, 1.0, 0.0, s, 0.0, s];
    let tracks: Vec<SourceTrack<'_>> = (0..joints)
        .map(|joint| SourceTrack {
            joint,
            channel: Channel::Rotation,
            interpolation: Interpolation::Linear,
            times: &times,
            values: &values,
        })
        .collect();
    let refused = resample(&skeleton, &tracks, DEFAULT_RATE);
    let frames = 34_000 * 30 + 1;
    let too_many = Some(AnimationError::Keys {
        keys: frames * joints,
    });
    assert_eq!(refused.err(), too_many);
    // The asset tool's bake puts tracks on the same frames, so it refuses the same clip.
    assert_eq!(bake(&tracks, joints, DEFAULT_RATE).err(), too_many);
    // The same keys over 4 tracks fit, with frames to spare.
    let short = [0.0f32, 1_000.0];
    let few: Vec<SourceTrack<'_>> = tracks[..4]
        .iter()
        .map(|t| SourceTrack {
            times: &short,
            ..*t
        })
        .collect();
    assert!(resample(&skeleton, &few, DEFAULT_RATE).is_ok());
}

// --- The animator: plays, fades, layers, masks, additive clips and events ---

/// The fixture's clips by their index in `three::CLIPS`.
const GRID30: u32 = 0;
const UNEVEN: u32 = 1;
const GRID24: u32 = 2;

/// The fixture's skeleton and clips in a table with one instance, and the instance.
fn fixture_table(jobs: &JobSystem) -> (Animations, u32) {
    let skeleton = skeleton();
    let joints = skeleton.joints();
    let clips = clips(&skeleton);
    let mut animations = Animations::new(jobs, 1, joints).unwrap();
    let id = animations.add_skeleton(skeleton).unwrap();
    for clip in clips {
        animations.add_clip(id, clip).unwrap();
    }
    let instance = animations.add_instance(id).unwrap();
    (animations, instance)
}

/// A clip whose keys lie a subnormal time apart keeps one frame, so its rate stays finite and its
/// poses hold numbers.
#[test]
fn a_clip_shorter_than_a_microsecond_keeps_one_frame() {
    let skeleton = Skeleton::new(
        &[NO_PARENT],
        &[0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0],
        &null3d_core::math::IDENTITY,
    )
    .unwrap();
    let s = std::f32::consts::FRAC_1_SQRT_2;
    let track = SourceTrack {
        joint: 0,
        channel: Channel::Translation,
        interpolation: Interpolation::Linear,
        times: &[0.0, 1e-40],
        values: &[1.0, 2.0, 3.0, s, s, s],
    };
    let clip = resample(&skeleton, &[track], DEFAULT_RATE).unwrap();
    assert_eq!((clip.frames(), clip.rate()), (1, 0.0));
    let mut pose = vec![0.0f32; clip.pose_len()];
    clip.sample(0.0, &mut pose);
    assert!(pose.iter().all(|v| v.is_finite()));
    let additive = clip.additive().unwrap();
    let mut pose = vec![0.0f32; additive.pose_len()];
    additive.sample(0.0, &mut pose);
    assert!(pose.iter().all(|v| v.is_finite()));
}

/// A played slot whose clip id a direct write changed to one that names no clip is skipped, and
/// the frame step goes on.
#[test]
fn a_played_slot_whose_clip_id_names_no_clip_is_skipped() {
    let jobs = JobSystem::new(0);
    let (mut animations, instance) = fixture_table(&jobs);
    animations.play(instance, GRID24, Play::default()).unwrap();
    animations.update(&jobs, 0.1);
    let slot = instance as usize * MAX_BLEND;
    animations.slots_mut().clip[slot] = 999;
    animations.update(&jobs, 0.1);
    animations.update(&jobs, 0.1);
    assert!(
        animations
            .instance_matrices(instance)
            .iter()
            .all(|v| v.is_finite())
    );
}

/// A mask of the fixture's skeleton: 1 for the joints that `keep` names, 0 for the others.
fn mask(animations: &mut Animations, keep: impl Fn(usize) -> bool) -> u32 {
    let weights: Vec<f32> = (0..three::PARENTS.len())
        .map(|j| if keep(j) { 1.0 } else { 0.0 })
        .collect();
    animations.add_mask(0, &weights).unwrap()
}

/// The joints at and below the fixture's joint 2: the arm and the head.
fn upper(joint: usize) -> bool {
    (2..=5).contains(&joint)
}

/// A play of the defaults with a fade of `fade` seconds.
fn faded(fade: f32) -> Play {
    Play {
        fade,
        ..Play::default()
    }
}

/// A play from `time` seconds, as `play(name, { time, weight })` makes it: with a weight, the
/// clip plays beside the layer's other clips.
fn started(time: f32, weight: Option<f32>) -> Play {
    Play {
        time: Some(time),
        weight,
        join: weight.is_some(),
        ..Play::default()
    }
}

/// Sets the weight of each slot that plays `clip`, as `setWeight` does through the slots'
/// sources in engine memory. Returns the slots it set.
fn set_weight(animations: &mut Animations, instance: u32, clip: u32, weight: f32) -> usize {
    let first = instance as usize * MAX_BLEND;
    let slots: Vec<usize> = (first..first + MAX_BLEND)
        .filter(|&s| animations.slots().source[s] == clip)
        .collect();
    for &s in &slots {
        animations.slots_mut().weight[s] = weight;
    }
    slots.len()
}

/// Makes the animator calls of fixture script `name` that come before its checkpoint `check`,
/// as the comments in `bench/three-fixtures.ts` give them.
fn script_calls(name: &str, check: usize, animations: &mut Animations, instance: u32) {
    let layers = instance as usize * MAX_LAYERS;
    let mut play = |clip, play| animations.play(instance, clip, play).unwrap();
    match (name, check) {
        ("crossfade", 0) | ("masked base layer", 0) | ("masked layer", 0) => {
            play(GRID30, Play::default())
        }
        ("masked layer at full weight", 0) => play(GRID30, Play::default()),
        ("crossfade", 1) => play(GRID24, faded(0.3)),
        ("fade in", 0) => play(GRID24, faded(0.5)),
        ("time scale", 0) => play(GRID30, faded(0.4)),
        ("once", 0) => play(
            GRID24,
            Play {
                looping: false,
                speed: 1.5,
                ..Play::default()
            },
        ),
        ("loops", 0) => play(GRID24, Play::default()),
        ("additive", 0) => {
            play(GRID24, Play::default());
            let additive = Play {
                layer: 1,
                additive: true,
                ..Play::default()
            };
            play(GRID30, additive);
        }
        ("start time", 0) => play(GRID24, started(0.3, None)),
        ("clip weights", 0) => {
            play(GRID30, started(0.1, Some(0.25)));
            play(GRID24, started(0.4, Some(0.5)));
        }
        ("clip weights", 1) => {
            assert_eq!(set_weight(animations, instance, GRID30, 0.75), 1);
        }
        ("weights above one", 0) => {
            play(GRID30, started(0.62, Some(0.6)));
            play(UNEVEN, started(0.0, Some(0.9)));
            play(GRID24, started(0.45, Some(0.5)));
        }
        ("weight and fade", 0) => play(
            GRID30,
            Play {
                weight: Some(0.5),
                join: true,
                ..faded(0.4)
            },
        ),
        ("additive on the base layer", 0) => {
            play(GRID24, Play::default());
            // A play that replaces the additive clips of its layer, but not its base clips.
            let additive = Play {
                additive: true,
                weight: Some(0.5),
                ..Play::default()
            };
            play(GRID30, additive);
        }
        ("additive on the base layer", 1) => play(UNEVEN, faded(0.3)),
        ("phase-synced blend", 0) => {
            animations.blend_values_mut()[layers] = 0.25;
            let blend = Blend {
                phase: Some(0.2),
                ..Blend::default()
            };
            animations
                .play_blend(instance, &[GRID30, GRID24], &[0.0, 1.0], blend)
                .unwrap();
        }
        ("phase-synced blend", 1) => animations.blend_values_mut()[layers] = 0.75,
        (_, 0) => panic!("no calls for script {name}"),
        _ => {}
    }
    if check != 0 {
        return;
    }
    match name {
        "time scale" => animations.time_scales_mut()[instance as usize] = 0.5,
        "masked base layer" => {
            let mask = mask(animations, |j| j != 4 && j != 5);
            animations.set_layer_mask(instance, 0, Some(mask)).unwrap();
        }
        "masked layer" | "masked layer at full weight" => {
            let layer = Play {
                layer: 1,
                ..Play::default()
            };
            animations.play(instance, GRID24, layer).unwrap();
            let mask = mask(animations, upper);
            animations.set_layer_mask(instance, 1, Some(mask)).unwrap();
            let weight = if name == "masked layer" { 0.5 } else { 1.0 };
            animations.layer_weights_mut()[layers + 1] = weight;
        }
        "additive" => animations.layer_weights_mut()[layers + 1] = 0.5,
        _ => {}
    }
}

/// The loop and finished events of the last frame step.
fn ends(animations: &Animations) -> (u32, u32) {
    let kind = |r: &[u32; EVENT_WORDS]| (r[1] >> 8) & 0xff;
    let events = animations.events();
    let count = |k| events.iter().filter(|r| kind(r) == k).count() as u32;
    (count(event_kind::LOOP), count(event_kind::FINISHED))
}

#[test]
fn animator_scripts_match_three_js() {
    for workers in [0, 2] {
        let pool = Workers::start(workers);
        let jobs = pool.jobs();
        let mut largest = 0.0f64;
        for script in &three::SCRIPTS {
            let (mut animations, instance) = fixture_table(jobs);
            let (mut loops, mut finished) = (0, 0);
            for (k, check) in script.checks.iter().enumerate() {
                script_calls(script.name, k, &mut animations, instance);
                for _ in 0..check.steps {
                    animations.update(jobs, script.step);
                    let (l, f) = ends(&animations);
                    loops += l;
                    finished += f;
                }
                let got = animations
                    .instance_matrices(instance)
                    .iter()
                    .map(|&v| f64::from(v));
                let got: Vec<f64> = got.collect();
                let difference = largest_difference(got.iter().copied(), &check.skin);
                let joint = (0..three::PARENTS.len())
                    .map(|j| {
                        let at = j * MATRIX_FLOATS..(j + 1) * MATRIX_FLOATS;
                        largest_difference(got[at.clone()].iter().copied(), &check.skin[at])
                    })
                    .enumerate()
                    .max_by(|a, b| a.1.total_cmp(&b.1))
                    .map_or(0, |(j, _)| j);
                assert!(
                    difference <= SKIN_TOLERANCE,
                    "{}, checkpoint {k}: joint {joint}'s skinning matrix is {difference} from \
                     three.js's",
                    script.name
                );
                largest = largest.max(difference);
            }
            assert_eq!(
                (loops, finished),
                (script.loops, script.finished),
                "{}: loops and finished clips",
                script.name
            );
        }
        println!(
            "{workers} job workers: largest difference from three.js in a script: {largest:e}"
        );
    }
}

/// Plays the fixture's clip of 0.75 s with events at `times` and `play`'s options, for `steps`
/// steps of `step` seconds, and returns each event's id and kind in order.
fn events_of(play: Play, times: &[f32], steps: u32, step: f32) -> Vec<(u32, u32)> {
    let jobs = JobSystem::new(0);
    let (mut animations, instance) = fixture_table(&jobs);
    let ids: Vec<u32> = (1..=times.len() as u32).collect();
    animations.set_clip_events(GRID24, times, &ids).unwrap();
    animations.play(instance, GRID24, play).unwrap();
    let mut out = Vec::new();
    for _ in 0..steps {
        animations.update(&jobs, step);
        for r in animations.events() {
            assert_eq!((r[0], r[1] & 0xff, r[2]), (instance, play.layer, GRID24));
            out.push((r[3], (r[1] >> 8) & 0xff));
        }
    }
    out
}

#[test]
fn an_event_fires_once_per_loop() {
    const EVENT: u32 = event_kind::EVENT;
    const LOOP: u32 = event_kind::LOOP;
    // The clip lasts 0.75 s: 150 steps of 1/60 s pass its start four times, 0.5 s three times
    // and its end three times, where it loops.
    let got = events_of(Play::default(), &[0.0, 0.5, 0.75], 150, 1.0 / 60.0);
    let mut expected = vec![(1, EVENT), (2, EVENT)];
    for _ in 0..2 {
        expected.extend([(3, EVENT), (1, EVENT), (0, LOOP), (2, EVENT)]);
    }
    expected.extend([(3, EVENT), (1, EVENT), (0, LOOP)]);
    assert_eq!(got, expected);
    // A step longer than the clip passes each event once, and loops once.
    let got = events_of(Play::default(), &[0.0, 0.5], 2, 1.0);
    assert_eq!(got, [(1, EVENT), (2, EVENT), (0, LOOP)].repeat(2));
    // Backward from the end: the end, 0.5 s, then the start and the end together as it loops.
    let backward = Play {
        speed: -1.0,
        ..Play::default()
    };
    let got = events_of(backward, &[0.0, 0.5, 0.75], 80, 1.0 / 60.0);
    assert_eq!(
        got,
        [
            (3, EVENT),
            (2, EVENT),
            (1, EVENT),
            (3, EVENT),
            (0, LOOP),
            (2, EVENT)
        ]
    );
    // Once, on layer 2, which each record gives: each event and the end, then nothing while the
    // clip holds its last frame.
    let once = Play {
        looping: false,
        layer: 2,
        ..Play::default()
    };
    let got = events_of(once, &[0.0, 0.75], 120, 1.0 / 60.0);
    assert_eq!(got, [(1, EVENT), (2, EVENT), (0, event_kind::FINISHED)]);
}

#[test]
fn fades_free_their_slots_and_plays_reuse_them() {
    let jobs = JobSystem::new(0);
    let (mut animations, instance) = fixture_table(&jobs);
    animations.play(instance, GRID30, Play::default()).unwrap();
    animations.play(instance, GRID24, faded(0.2)).unwrap();
    let factor = |a: &Animations, slot| a.action(instance, slot).factor();
    assert_eq!((factor(&animations, 0), factor(&animations, 1)), (1.0, 0.0));
    for _ in 0..6 {
        animations.update(&jobs, 1.0 / 60.0);
    }
    assert!((factor(&animations, 0) - 0.5).abs() < 1e-5);
    // Back to the first clip halfway through: it fades in from its weight, keeping its time.
    let time = animations.slots().time[0];
    animations.play(instance, GRID30, faded(0.2)).unwrap();
    assert!((factor(&animations, 0) - 0.5).abs() < 1e-5);
    assert_eq!(animations.slots().time[0], time);
    for _ in 0..13 {
        animations.update(&jobs, 1.0 / 60.0);
    }
    // The second clip faded out from half its weight and left its slot.
    assert_eq!(factor(&animations, 0), 1.0);
    assert_eq!(animations.slots().weight[1], 0.0);
    assert_eq!(animations.action(instance, 1).flags, 0);
    // Stopping at once frees the slot; the instance holds the rest pose.
    animations.stop(instance, Some(GRID30), 0.0).unwrap();
    animations.update(&jobs, 1.0 / 60.0);
    let identity = null3d_core::math::IDENTITY
        .map(f64::from)
        .repeat(three::PARENTS.len());
    let rest = animations
        .instance_matrices(instance)
        .iter()
        .map(|&v| f64::from(v));
    assert!(largest_difference(rest, &identity) < 1e-5);
    // When every slot holds a clip, a play takes the slot that counts least.
    for layer in 0..MAX_LAYERS as u32 {
        for clip in [GRID30, GRID24] {
            let play = Play {
                layer,
                ..faded(0.2)
            };
            animations.play(instance, clip, play).unwrap();
        }
    }
    let late = Play {
        additive: true,
        ..faded(0.2)
    };
    animations.play(instance, GRID30, late).unwrap();
    let flags: Vec<u32> = (0..MAX_BLEND)
        .map(|s| animations.action(instance, s).flags)
        .collect();
    assert!(flags.iter().all(|f| f & flag::PLAYING != 0), "{flags:?}");
    assert_eq!(flags.iter().filter(|f| *f & flag::ADDITIVE != 0).count(), 1);
    animations.update(&jobs, 1.0 / 60.0);
    assert!(animations.matrices().iter().all(|v| v.is_finite()));
}

#[test]
fn removed_instances_give_back_their_id_and_joints() {
    let jobs = JobSystem::new(0);
    let (small, small_clips) = character(4);
    let (large, _) = character(8);
    let mut animations = Animations::new(&jobs, 2, 12).unwrap();
    let small_id = animations.add_skeleton(small).unwrap();
    let large_id = animations.add_skeleton(large).unwrap();
    let clip = animations
        .add_clip(small_id, small_clips[0].clone())
        .unwrap();
    let first = animations.add_instance(small_id).unwrap();
    let second = animations.add_instance(large_id).unwrap();
    animations.play(first, clip, Play::default()).unwrap();
    animations.remove_instance(first).unwrap();
    let unknown = AnimationError::UnknownInstance { instance: first };
    assert_eq!(
        animations.play(first, clip, Play::default()).unwrap_err(),
        unknown
    );
    assert_eq!(animations.remove_instance(first).unwrap_err(), unknown);
    // The table is full of joints, yet the removed instance's four fit a new one.
    let again = animations.add_instance(small_id).unwrap();
    assert_eq!((again, animations.joints()), (first, 12));
    // A new instance starts with empty slots.
    assert!(
        animations.slots().weight[..MAX_BLEND]
            .iter()
            .all(|w| *w == 0.0)
    );
    animations.remove_instance(second).unwrap();
    animations.update(&jobs, 0.1);
    assert!(
        animations
            .instance_matrices(again)
            .iter()
            .all(|v| v.is_finite())
    );
}

#[test]
fn animator_calls_refuse_bad_input() {
    let jobs = JobSystem::new(0);
    let (mut animations, instance) = fixture_table(&jobs);
    let (other, other_clips) = character(4);
    let other_id = animations.add_skeleton(other).unwrap();
    let foreign = animations
        .add_clip(other_id, other_clips[0].clone())
        .unwrap();
    for clip in [foreign, 99] {
        assert_eq!(
            animations
                .play(instance, clip, Play::default())
                .unwrap_err(),
            AnimationError::UnknownClip { clip }
        );
    }
    let bad = [
        (
            Play {
                layer: 4,
                ..Play::default()
            },
            AnimationError::Layer { layer: 4 },
        ),
        (faded(-1.0), AnimationError::Play { option: 0 }),
        (faded(f32::NAN), AnimationError::Play { option: 0 }),
        (
            Play {
                speed: f32::INFINITY,
                ..Play::default()
            },
            AnimationError::Play { option: 1 },
        ),
    ];
    for (options, error) in bad {
        let got = animations.play(instance, GRID30, options).unwrap_err();
        assert_eq!(got, error);
    }
    assert_eq!(
        animations.play(5, GRID30, Play::default()).unwrap_err(),
        AnimationError::UnknownInstance { instance: 5 }
    );
    assert_eq!(
        animations.stop(instance, None, -0.5).unwrap_err(),
        AnimationError::Play { option: 0 }
    );
    let joints = three::PARENTS.len();
    assert_eq!(
        animations.add_mask(0, &vec![1.0; joints - 1]).unwrap_err(),
        AnimationError::Mask {
            joint: joints as u32 - 1
        }
    );
    let mut weights = vec![1.0; joints];
    weights[3] = 1.5;
    assert_eq!(
        animations.add_mask(0, &weights).unwrap_err(),
        AnimationError::Mask { joint: 3 }
    );
    let foreign_mask = animations.add_mask(other_id, &[1.0; 4]).unwrap();
    assert_eq!(
        animations
            .set_layer_mask(instance, 1, Some(foreign_mask))
            .unwrap_err(),
        AnimationError::UnknownMask { mask: foreign_mask }
    );
    assert_eq!(
        animations.set_layer_mask(instance, 4, None).unwrap_err(),
        AnimationError::Layer { layer: 4 }
    );
    let duration = animations.clip(GRID24).unwrap().duration();
    for times in [[0.1, duration + 0.1], [0.1, f32::NAN], [0.1, -0.1]] {
        assert_eq!(
            animations
                .set_clip_events(GRID24, &times, &[1, 2])
                .unwrap_err(),
            AnimationError::Events { event: 1 }
        );
    }
    assert_eq!(
        animations
            .set_clip_events(GRID24, &[0.1], &[1, 2])
            .unwrap_err(),
        AnimationError::Events { event: 1 }
    );
}

#[test]
fn events_come_in_order_of_instance_on_any_number_of_threads() {
    let (skeleton, clips) = character(12);
    let run = |jobs: &JobSystem| {
        let mut animations = Animations::new(jobs, 300, 300 * 12).unwrap();
        let id = animations.add_skeleton(skeleton.clone()).unwrap();
        let clip = animations.add_clip(id, clips[1].clone()).unwrap();
        animations
            .set_clip_events(clip, &[0.1, 0.2, 0.3, 0.4], &[1, 2, 3, 4])
            .unwrap();
        for i in 0..300u32 {
            let instance = animations.add_instance(id).unwrap();
            let play = Play {
                speed: 1.0 + (i % 7) as f32 * 0.5,
                ..Play::default()
            };
            animations.play(instance, clip, play).unwrap();
        }
        let mut events = Vec::new();
        for _ in 0..20 {
            animations.update(jobs, 1.0 / 30.0);
            events.extend_from_slice(animations.events());
            assert_eq!(animations.events_dropped(), 0);
        }
        (events, animations.matrices().to_vec())
    };
    let serial = run(&JobSystem::new(0));
    let pool = Workers::start(4);
    assert_eq!(run(pool.jobs()), serial);
    assert!(serial.0.len() > 300);
}

#[test]
fn additive_clips_hold_no_change_at_their_first_frame() {
    let skeleton = skeleton();
    let clips = clips(&skeleton);
    let source = &clips[GRID30 as usize];
    let additive = source.additive().unwrap();
    assert_eq!(additive.frames(), source.frames());
    let lanes = skeleton.lanes() as usize;
    let mut pose = vec![0.0; POSE_FIELDS * lanes];
    additive.sample(0.0, &mut pose);
    let channels = additive.channels();
    for j in 0..three::PARENTS.len() {
        let at = |f: usize| pose[f * lanes + j];
        if channels[j] > 0.0 {
            assert!((0..3).all(|f| at(f).abs() < 1e-6), "joint {j}: translation");
        }
        if channels[lanes + j] > 0.0 {
            assert!((at(6).abs() - 1.0).abs() < 1e-4, "joint {j}: rotation");
        }
        if channels[2 * lanes + j] > 0.0 {
            assert!((7..10).all(|f| at(f).abs() < 1e-6), "joint {j}: scale");
        }
    }
}

#[test]
fn a_removed_skeleton_takes_its_clips_and_masks_and_gives_back_their_ids() {
    let jobs = JobSystem::new(0);
    let (small, small_clips) = character(4);
    let (large, large_clips) = character(8);
    let mut animations = Animations::new(&jobs, 2, 12).unwrap();
    let small_id = animations.add_skeleton(small.clone()).unwrap();
    let large_id = animations.add_skeleton(large.clone()).unwrap();
    let small_clip = animations
        .add_clip(small_id, small_clips[0].clone())
        .unwrap();
    let large_clip = animations
        .add_clip(large_id, large_clips[0].clone())
        .unwrap();
    let additive = animations.additive_clip(large_clip).unwrap();
    let large_mask = animations.add_mask(large_id, &[1.0; 8]).unwrap();
    let kept = animations.add_instance(small_id).unwrap();
    let user = animations.add_instance(large_id).unwrap();
    animations.play(kept, small_clip, Play::default()).unwrap();
    // An instance still uses the skeleton, so it stays.
    assert_eq!(
        animations.remove_skeleton(large_id).unwrap_err(),
        AnimationError::SkeletonInUse { instance: user }
    );
    animations.remove_instance(user).unwrap();
    animations.remove_skeleton(large_id).unwrap();
    assert!(animations.skeleton(large_id).is_none());
    assert!(animations.clip(large_clip).is_none() && animations.clip(additive).is_none());
    assert_eq!(
        animations.remove_skeleton(large_id).unwrap_err(),
        AnimationError::UnknownSkeleton { skeleton: large_id }
    );
    assert_eq!(
        animations.add_instance(large_id).unwrap_err(),
        AnimationError::UnknownSkeleton { skeleton: large_id }
    );
    // The next skeleton, clips and mask take the removed ids, and play as new ones do.
    let again = animations.add_skeleton(large).unwrap();
    assert_eq!(again, large_id);
    let clips: Vec<u32> = (0..2)
        .map(|_| animations.add_clip(again, large_clips[0].clone()).unwrap())
        .collect();
    let mut taken = clips.clone();
    taken.sort_unstable();
    let mut removed = vec![large_clip, additive];
    removed.sort_unstable();
    assert_eq!(taken, removed);
    assert_eq!(animations.add_mask(again, &[0.5; 8]).unwrap(), large_mask);
    let instance = animations.add_instance(again).unwrap();
    animations
        .play(instance, clips[0], Play::default())
        .unwrap();
    animations
        .set_layer_mask(instance, 0, Some(large_mask))
        .unwrap();
    animations.update(&jobs, 0.1);
    for id in [kept, instance] {
        assert!(
            animations
                .instance_matrices(id)
                .iter()
                .all(|v| v.is_finite())
        );
    }
}

/// The skinning matrices of an instance that samples `samples` (clip, time, weight) as they are,
/// with no play, in a fresh table of the fixture.
fn sampled(samples: &[(u32, f32, f32)]) -> Vec<f32> {
    let jobs = JobSystem::new(0);
    let (mut animations, instance) = fixture_table(&jobs);
    for (slot, &(clip, time, weight)) in samples.iter().enumerate() {
        animations.set_sample(instance, slot, clip, time, weight);
    }
    animations.update(&jobs, 0.0);
    animations.instance_matrices(instance).to_vec()
}

/// The largest difference between two lists of 32-bit numbers.
fn largest_gap(a: &[f32], b: &[f32]) -> f32 {
    a.iter()
        .zip(b)
        .map(|(a, b)| (a - b).abs())
        .fold(0.0, f32::max)
}

/// A blend of the fixture's grid30 at 0, uneven at 1 and grid24 at 3, on layer 0.
fn three_clip_blend(animations: &mut Animations, instance: u32, blend: Blend) {
    animations
        .play_blend(instance, &[GRID30, UNEVEN, GRID24], &[0.0, 1.0, 3.0], blend)
        .unwrap();
}

#[test]
fn a_blend_weighs_the_two_clips_around_its_value() {
    let jobs = JobSystem::new(0);
    let duration = |a: &Animations, c: u32| a.clip(c).unwrap().duration();
    // Each value, and the share of grid30, uneven and grid24 that it gives.
    let cases: [(f32, [f32; 3]); 8] = [
        (-1.0, [1.0, 0.0, 0.0]),
        (0.0, [1.0, 0.0, 0.0]),
        (0.25, [0.75, 0.25, 0.0]),
        (1.0, [0.0, 1.0, 0.0]),
        (2.5, [0.0, 0.25, 0.75]),
        (3.0, [0.0, 0.0, 1.0]),
        (7.0, [0.0, 0.0, 1.0]),
        (f32::NAN, [1.0, 0.0, 0.0]),
    ];
    for (value, shares) in cases {
        let (mut animations, instance) = fixture_table(&jobs);
        animations.blend_values_mut()[0] = value;
        let blend = Blend {
            phase: Some(0.3),
            ..Blend::default()
        };
        three_clip_blend(&mut animations, instance, blend);
        animations.update(&jobs, 0.0);
        let clips = [GRID30, UNEVEN, GRID24];
        let samples: Vec<(u32, f32, f32)> = clips
            .iter()
            .zip(shares)
            .map(|(&c, share)| (c, 0.3 * duration(&animations, c), share))
            .collect();
        let gap = largest_gap(animations.instance_matrices(instance), &sampled(&samples));
        assert!(gap < 1e-5, "value {value}: {gap}");
    }
}

#[test]
fn a_blend_keeps_its_clips_in_one_phase() {
    let jobs = JobSystem::new(0);
    let (mut animations, instance) = fixture_table(&jobs);
    let durations = [GRID30, UNEVEN, GRID24].map(|c| animations.clip(c).unwrap().duration());
    animations.blend_values_mut()[0] = 0.5;
    three_clip_blend(&mut animations, instance, Blend::default());
    // At 0.5, grid30 and uneven share the blend: one cycle takes their mean length.
    let length = 0.5 * durations[0] + 0.5 * durations[1];
    let step = 1.0 / 60.0;
    animations.update(&jobs, step);
    let times = &animations.slots().time[..3];
    for (k, &time) in times.iter().enumerate() {
        let expected = step / length * durations[k];
        assert!(
            (time - expected).abs() < 1e-6,
            "clip {k}: {time} for {expected}"
        );
    }
    // The value moves every frame; the clips' phases stay equal, through their loops.
    for frame in 0..600 {
        animations.blend_values_mut()[0] = 1.5 + 1.5 * (frame as f32 * 0.05).sin();
        animations.update(&jobs, step);
        let phases: Vec<f32> = (0..3)
            .map(|k| animations.slots().time[k] / durations[k])
            .collect();
        assert!(
            phases.iter().all(|p| (p - phases[0]).abs() < 1e-6),
            "frame {frame}: {phases:?}"
        );
    }
    // A negative speed moves the phase backward.
    let backward = Blend {
        speed: -1.0,
        phase: Some(0.5),
        ..Blend::default()
    };
    three_clip_blend(&mut animations, instance, backward);
    animations.update(&jobs, step);
    let phase = animations.slots().time[0] / durations[0];
    assert!(phase < 0.5, "{phase}");
}

#[test]
fn a_blend_with_a_value_sets_its_layers_blend_value_and_one_without_keeps_it() {
    let jobs = JobSystem::new(0);
    let (mut animations, instance) = fixture_table(&jobs);
    let layer = instance as usize * MAX_LAYERS + 1;
    let valued = Blend {
        layer: 1,
        value: Some(0.4),
        ..Blend::default()
    };
    animations
        .play_blend(instance, &[GRID24, GRID30], &[0.0, 1.0], valued)
        .unwrap();
    assert_eq!(animations.blend_values()[layer], 0.4);
    assert_eq!(animations.blend_values()[layer - 1], 0.0);
    let kept = Blend {
        layer: 1,
        ..Blend::default()
    };
    animations
        .play_blend(instance, &[GRID30, GRID24], &[0.0, 1.0], kept)
        .unwrap();
    assert_eq!(animations.blend_values()[layer], 0.4);
    // A play that fails leaves the value as it is.
    let refused = Blend {
        layer: 1,
        fade: -1.0,
        value: Some(0.9),
        ..Blend::default()
    };
    assert!(
        animations
            .play_blend(instance, &[GRID24, GRID30], &[0.0, 1.0], refused)
            .is_err()
    );
    assert_eq!(animations.blend_values()[layer], 0.4);
}

#[test]
fn a_blend_starts_in_step_with_the_clip_it_takes_over_from() {
    let jobs = JobSystem::new(0);
    let (mut animations, instance) = fixture_table(&jobs);
    animations.play(instance, GRID24, Play::default()).unwrap();
    for _ in 0..20 {
        animations.update(&jobs, 1.0 / 60.0);
    }
    let walk = animations.slots().time[0];
    let grid24 = animations.clip(GRID24).unwrap().duration();
    let grid30 = animations.clip(GRID30).unwrap().duration();
    let blend = Blend {
        fade: 0.25,
        ..Blend::default()
    };
    animations
        .play_blend(instance, &[GRID24, GRID30], &[0.0, 1.0], blend)
        .unwrap();
    let flags: Vec<u32> = (0..3)
        .map(|s| animations.action(instance, s).flags)
        .collect();
    // The plain clip fades out, and the blend's clips start at its phase.
    assert_eq!(animations.action(instance, 0).fade_to, 0.0);
    assert!(
        flags[1] & flag::BLEND != 0 && flags[2] & flag::BLEND != 0,
        "{flags:?}"
    );
    assert_eq!(animations.slots().time[1], walk);
    assert!((animations.slots().time[2] - walk / grid24 * grid30).abs() < 1e-6);
    // Playing a clip of the blend ends the blend: each clip keeps its share and rate, and the
    // new slot starts at the blend's time of that clip.
    animations.blend_values_mut()[0] = 0.25;
    for _ in 0..30 {
        animations.update(&jobs, 1.0 / 60.0);
    }
    let length = 0.75 * grid24 + 0.25 * grid30;
    let time = animations.slots().time[2];
    animations.play(instance, GRID30, faded(0.2)).unwrap();
    for s in 1..3 {
        let action = animations.action(instance, s);
        assert_eq!(action.flags & flag::BLEND, 0, "slot {s}");
        assert_eq!(action.fade_to, 0.0, "slot {s}");
    }
    let rate = animations.action(instance, 1).speed;
    assert!((rate - grid24 / length).abs() < 1e-5, "{rate}");
    assert_eq!(animations.slots().weight[1..3], [0.75, 0.25]);
    let new = (0..MAX_BLEND)
        .find(|&s| {
            let a = animations.action(instance, s);
            a.fade_to == 1.0 && a.flags & flag::PLAYING != 0
        })
        .unwrap();
    assert_eq!(animations.slots().time[new], time);
}

#[test]
fn a_clip_at_weight_0_plays_on_and_keeps_its_slot() {
    let jobs = JobSystem::new(0);
    let (mut animations, instance) = fixture_table(&jobs);
    animations
        .play(instance, GRID30, started(0.0, Some(1.0)))
        .unwrap();
    animations
        .play(instance, GRID24, started(0.0, Some(0.0)))
        .unwrap();
    for _ in 0..12 {
        animations.update(&jobs, 1.0 / 60.0);
    }
    // As in three.js, an action at weight 0 still moves its time.
    assert!((animations.slots().time[1] - 0.2).abs() < 1e-5);
    assert_eq!(set_weight(&mut animations, instance, GRID24, 0.5), 1);
    animations.update(&jobs, 0.0);
    let expected = sampled(&[(GRID30, 0.2, 1.0), (GRID24, 0.2, 0.5)]);
    assert!(largest_gap(animations.instance_matrices(instance), &expected) < 1e-5);
    // A play with a weight sets the weight of a clip that plays, and keeps its time.
    let again = Play {
        weight: Some(0.25),
        join: true,
        ..Play::default()
    };
    animations.play(instance, GRID24, again).unwrap();
    assert_eq!(animations.slots().weight[1], 0.25);
    assert!((animations.slots().time[1] - 0.2).abs() < 1e-5);
}

#[test]
fn two_blends_cross_fading_and_a_cross_fading_layer_fit_the_slots() {
    let jobs = JobSystem::new(0);
    let (mut animations, instance) = fixture_table(&jobs);
    three_clip_blend(&mut animations, instance, Blend::default());
    let playing = |a: &Animations| {
        (0..MAX_BLEND)
            .filter(|&s| a.action(instance, s).flags & flag::PLAYING != 0)
            .count()
    };
    // Another layer cross-fades between two clips.
    let layer = |fade| Play {
        layer: 1,
        ..faded(fade)
    };
    animations.play(instance, GRID30, layer(0.0)).unwrap();
    animations.play(instance, GRID24, layer(0.3)).unwrap();
    // A blend that keeps one clip and adds two fades in over the first, whose other two clips
    // fade out, and an additive clip plays on top: all eight slots play.
    let next = Blend {
        fade: 0.3,
        ..Blend::default()
    };
    let (cubic, cubic_grid) = (3, 4);
    animations
        .play_blend(
            instance,
            &[cubic, cubic_grid, GRID24],
            &[0.0, 1.0, 2.0],
            next,
        )
        .unwrap();
    let additive = |layer| Play {
        additive: true,
        layer,
        ..Play::default()
    };
    animations.play(instance, GRID30, additive(2)).unwrap();
    assert_eq!(playing(&animations), MAX_BLEND);
    // A ninth clip takes the slot of a clip that fades out, never one of the new blend's.
    animations.play(instance, UNEVEN, additive(3)).unwrap();
    assert_eq!(playing(&animations), MAX_BLEND);
    let live = |a: &Animations, s: usize| a.action(instance, s).fade_to == 1.0;
    let blend = (0..MAX_BLEND)
        .filter(|&s| {
            animations.action(instance, s).flags & flag::BLEND != 0 && live(&animations, s)
        })
        .count();
    assert_eq!(blend, 3);
    let additives = (0..MAX_BLEND)
        .filter(|&s| animations.action(instance, s).flags & flag::ADDITIVE != 0)
        .count();
    assert_eq!(additives, 2);
    animations.update(&jobs, 1.0 / 60.0);
    assert!(animations.matrices().iter().all(|v| v.is_finite()));
}

#[test]
fn plays_and_blends_refuse_bad_options() {
    let jobs = JobSystem::new(0);
    let (mut animations, instance) = fixture_table(&jobs);
    let play = |time, weight| Play {
        time,
        weight,
        ..Play::default()
    };
    let bad = [
        (play(Some(f32::NAN), None), 2),
        (play(Some(f32::INFINITY), None), 2),
        (play(None, Some(-0.5)), 3),
        (play(None, Some(f32::NAN)), 3),
        (play(None, Some(f32::INFINITY)), 3),
    ];
    for (options, option) in bad {
        let got = animations.play(instance, GRID30, options).unwrap_err();
        assert_eq!(got, AnimationError::Play { option });
    }
    let blend = |clips: &[u32], points: &[f32], options: Blend| {
        let (mut animations, instance) = fixture_table(&jobs);
        animations
            .play_blend(instance, clips, points, options)
            .unwrap_err()
    };
    let none = Blend::default();
    let nine: Vec<u32> = (0..9).map(|k| k % 5).collect();
    let option = |option| AnimationError::Play { option };
    let cases = [
        (blend(&[], &[], none), option(4)),
        (blend(&nine, &[0.0; 9], none), option(4)),
        (blend(&[GRID30, GRID30], &[0.0, 1.0], none), option(4)),
        (blend(&[GRID30, GRID24], &[0.0], none), option(4)),
        (blend(&[GRID30, GRID24], &[1.0, 1.0], none), option(5)),
        (blend(&[GRID30, GRID24], &[0.0, f32::NAN], none), option(5)),
        (
            blend(
                &[GRID30, GRID24],
                &[0.0, 1.0],
                Blend {
                    phase: Some(f32::NAN),
                    ..none
                },
            ),
            option(2),
        ),
        (
            blend(&[GRID30, 99], &[0.0, 1.0], none),
            AnimationError::UnknownClip { clip: 99 },
        ),
        (
            blend(&[GRID30], &[0.0], Blend { layer: 4, ..none }),
            AnimationError::Layer { layer: 4 },
        ),
        (
            blend(&[GRID30], &[0.0], Blend { fade: -1.0, ..none }),
            option(0),
        ),
    ];
    for (k, (got, want)) in cases.into_iter().enumerate() {
        assert_eq!(got, want, "case {k}");
    }
}

#[test]
fn a_start_time_wraps_into_a_repeating_clip_and_holds_in_one_that_plays_once() {
    let jobs = JobSystem::new(0);
    let (mut animations, instance) = fixture_table(&jobs);
    let duration = animations.clip(GRID24).unwrap().duration();
    for (time, looping, expected) in [
        (0.3, true, 0.3),
        (duration + 0.3, true, 0.3),
        (-0.25, true, duration - 0.25),
        (duration + 0.3, false, duration),
        (-1.0, false, 0.0),
    ] {
        let play = Play {
            time: Some(time),
            looping,
            ..Play::default()
        };
        animations.play(instance, GRID24, play).unwrap();
        let got = animations.slots().time[0];
        assert!((got - expected).abs() < 1e-5, "{time}: {got}");
    }
}

// The review's findings: each test fails without its fix.

#[test]
fn an_additive_play_keeps_the_base_clips_and_a_base_play_keeps_the_additive_ones() {
    let jobs = JobSystem::new(0);
    let (mut animations, instance) = fixture_table(&jobs);
    animations.play(instance, GRID24, Play::default()).unwrap();
    let additive = Play {
        additive: true,
        ..Play::default()
    };
    animations.play(instance, GRID30, additive).unwrap();
    let live = |a: &Animations, s| {
        let action = a.action(instance, s);
        action.flags & flag::PLAYING != 0 && action.factor() == 1.0
    };
    assert!(live(&animations, 0), "the base clip stopped");
    assert!(live(&animations, 1));
    animations.play(instance, UNEVEN, faded(0.2)).unwrap();
    for _ in 0..20 {
        animations.update(&jobs, 1.0 / 60.0);
    }
    assert!(live(&animations, 1), "the additive clip stopped");
    assert!(!live(&animations, 0));
}

#[test]
fn a_step_track_holds_its_last_key_at_the_clip_end() {
    let (skeleton, _) = character(4);
    let lanes = skeleton.lanes() as usize;
    let mut wrong = Vec::new();
    for fps in [24u32, 25, 30] {
        for frames in 2..400u32 {
            let times: Vec<f32> = (0..frames).map(|k| k as f32 / fps as f32).collect();
            let values: Vec<f32> = (0..frames).flat_map(|k| [k as f32, 0.0, 0.0]).collect();
            let track = SourceTrack {
                joint: 0,
                channel: Channel::Translation,
                interpolation: Interpolation::Step,
                times: &times,
                values: &values,
            };
            let clip = resample(&skeleton, &[track], DEFAULT_RATE).unwrap();
            let mut pose = vec![0.0; POSE_FIELDS * lanes];
            clip.sample(clip.duration(), &mut pose);
            if pose[0] != (frames - 1) as f32 {
                wrong.push((fps, frames, pose[0]));
            }
        }
    }
    assert!(
        wrong.is_empty(),
        "{} clips, first {:?}",
        wrong.len(),
        wrong[0]
    );
}

#[test]
fn a_time_scale_that_is_not_finite_moves_nothing() {
    let jobs = JobSystem::new(0);
    for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        let (mut animations, instance) = fixture_table(&jobs);
        animations.play(instance, GRID24, Play::default()).unwrap();
        animations.update(&jobs, 0.1);
        animations.time_scales_mut()[0] = bad;
        animations.update(&jobs, 0.1);
        animations.time_scales_mut()[0] = 1.0;
        animations.update(&jobs, 0.1);
        let time = animations.slots().time[0];
        assert!(
            (time - 0.2).abs() < 1e-5,
            "{bad}: the clip's time is {time}"
        );
        // A fade out ends after its time, whatever steps came between.
        animations.stop(instance, None, 0.5).unwrap();
        animations.time_scales_mut()[0] = bad;
        animations.update(&jobs, 0.1);
        animations.time_scales_mut()[0] = 1.0;
        for _ in 0..6 {
            animations.update(&jobs, 0.1);
        }
        assert_eq!(
            animations.slots().weight[0],
            0.0,
            "{bad}: the slot is still used"
        );
        // A speed that overflows the step moves nothing either.
        let fast = Play {
            speed: f32::MAX,
            ..Play::default()
        };
        animations.play(instance, GRID24, fast).unwrap();
        animations.update(&jobs, 10.0);
        assert!(animations.slots().time[0].is_finite());
    }
}

#[test]
fn freed_joint_runs_merge_and_return_to_the_end() {
    let jobs = JobSystem::new(0);
    let (two, _) = character(2);
    let (four, _) = character(4);
    let (one, _) = character(1);
    let mut animations = Animations::new(&jobs, 4, 4).unwrap();
    let two = animations.add_skeleton(two).unwrap();
    let four = animations.add_skeleton(four).unwrap();
    let one = animations.add_skeleton(one).unwrap();
    let a = animations.add_instance(two).unwrap();
    let b = animations.add_instance(two).unwrap();
    animations.remove_instance(a).unwrap();
    animations.remove_instance(b).unwrap();
    // All four joints are free again, in one run, so a four-joint skeleton fits.
    assert_eq!(animations.joints(), 0);
    let c = animations.add_instance(four).unwrap();
    assert_eq!(animations.instance_joints(c), Some((0, 4)));
    // A run that a removal leaves between live instances merges with its neighbour.
    animations.remove_instance(c).unwrap();
    let ids: Vec<u32> = (0..4)
        .map(|_| animations.add_instance(one).unwrap())
        .collect();
    animations.remove_instance(ids[1]).unwrap();
    animations.remove_instance(ids[2]).unwrap();
    let joined = animations.add_instance(two).unwrap();
    assert_eq!(animations.instance_joints(joined), Some((1, 2)));
}

#[test]
fn a_pose_step_changes_only_when_the_instances_matrices_do() {
    let jobs = JobSystem::new(0);
    let (skeleton, clips) = character(4);
    let mut animations = Animations::new(&jobs, 2, 8).unwrap();
    let id = animations.add_skeleton(skeleton).unwrap();
    let clip = animations.add_clip(id, clips[0].clone()).unwrap();
    let still = animations.add_instance(id).unwrap();
    let walking = animations.add_instance(id).unwrap();
    assert_eq!(animations.pose_step(still), animations.pose_step(walking));
    animations.play(walking, clip, Play::default()).unwrap();

    // The first step poses both: a new instance counts as changed.
    animations.update(&jobs, 0.1);
    let (still_step, walking_step) = (animations.pose_step(still), animations.pose_step(walking));
    let changed = animations.changed_step();
    assert_eq!(still_step, walking_step);
    assert_eq!(still_step, Some(changed));

    // The instance at rest holds its step; the one that plays a clip gets the new one.
    animations.update(&jobs, 0.1);
    assert_eq!(animations.pose_step(still), still_step);
    assert_ne!(animations.pose_step(walking), walking_step);
    assert_eq!(
        animations.pose_step(walking),
        Some(animations.changed_step())
    );

    // With every clip held still, no instance changes and the table's step stays.
    animations.time_scales_mut()[walking as usize] = 0.0;
    animations.update(&jobs, 0.1);
    let held = (animations.pose_step(walking), animations.changed_step());
    animations.update(&jobs, 0.1);
    assert_eq!(
        (animations.pose_step(walking), animations.changed_step()),
        held
    );

    // An instance added in a removed one's place, with the same pose, still counts as changed.
    animations.remove_instance(still).unwrap();
    let again = animations.add_instance(id).unwrap();
    animations.update(&jobs, 0.1);
    assert_ne!(animations.changed_step(), held.1);
    assert_eq!(animations.pose_step(again), Some(animations.changed_step()));
    assert_eq!(animations.pose_step(walking), held.0);
    assert_eq!(animations.pose_step(99), None);
}

#[test]
fn a_slow_instance_poses_on_its_interval_alone() {
    let jobs = JobSystem::new(0);
    let (skeleton, clips) = character(4);
    let mut animations = Animations::new(&jobs, 2, 8).unwrap();
    let id = animations.add_skeleton(skeleton).unwrap();
    let clip = animations.add_clip(id, clips[0].clone()).unwrap();
    let slow = animations.add_instance(id).unwrap();
    let every = animations.add_instance(id).unwrap();
    animations.play(slow, clip, Play::default()).unwrap();
    animations.play(every, clip, Play::default()).unwrap();
    let intervals = animations.update_intervals_mut();
    assert_eq!(
        [intervals[slow as usize], intervals[every as usize]],
        [1, 1]
    );
    intervals[slow as usize] = 4;

    let dt = 1.0 / 60.0;
    // Every update poses the instance that has no interval, and the first poses the slow one too.
    animations.update(&jobs, dt);
    let posed = animations.pose_step(slow);
    assert_eq!(posed, animations.pose_step(every));

    // The three updates in between leave the slow instance in its pose, and its matrices carry
    // over unchanged, so the skinning pass skips the held pose too.
    let held = animations.instance_matrices(slow).to_vec();
    for _ in 0..3 {
        animations.update(&jobs, dt);
        assert_eq!(animations.pose_step(slow), posed);
        assert_eq!(animations.instance_matrices(slow), held.as_slice());
    }

    // The next update poses it again. Its clips covered the frames in between, so its pose matches
    // the instance that poses in every one of them.
    animations.update(&jobs, dt);
    assert_ne!(animations.pose_step(slow), posed);
    let slow_pose = animations.instance_matrices(slow).to_vec();
    let largest = slow_pose
        .iter()
        .zip(animations.instance_matrices(every))
        .map(|(a, b)| (a - b).abs())
        .fold(0.0f32, f32::max);
    assert!(largest < 1e-4, "the slow pose differs by {largest}");
}

/// Writes a rotation override into slot `slot` of instance `instance`'s block.
fn override_joint(
    animations: &mut Animations,
    instance: u32,
    slot: usize,
    joint: u32,
    mode: u32,
    weight: f32,
    rotation: [f32; 4],
) {
    let at = instance as usize * joints::BLOCK_FLOATS + slot * joints::OVERRIDE_FLOATS;
    let block = &mut animations.joint_overrides_mut()[at..at + joints::OVERRIDE_FLOATS];
    block[joints::place::JOINT] = joint as f32 + 1.0;
    block[joints::place::MODE] = mode as f32;
    block[joints::place::WEIGHT] = weight;
    block[joints::place::ROTATION..joints::place::ROTATION + 4].copy_from_slice(&rotation);
}

#[test]
fn joint_overrides_turn_only_their_joints_and_those_below() {
    let jobs = JobSystem::new(0);
    let (skeleton, clips) = character(8);
    let mut animations = Animations::new(&jobs, 3, 24).unwrap();
    let id = animations.add_skeleton(skeleton).unwrap();
    let clip = animations.add_clip(id, clips[0].clone()).unwrap();
    let instances: Vec<u32> = (0..3)
        .map(|_| animations.add_instance(id).unwrap())
        .collect();
    let [plain, turned, idle] = [instances[0], instances[1], instances[2]];
    for &i in &instances {
        animations.set_sample(i, 0, clip, 0.4, 1.0);
    }
    animations.update(&jobs, 0.0);
    let before = animations.instance_matrices(plain).to_vec();
    assert!(animations.joint_overrides().is_empty());
    animations.enable_joint_overrides().unwrap();
    assert_eq!(animations.joint_overrides().len(), 3 * joints::BLOCK_FLOATS);
    // Joint 6 hangs below joint 1; joint 7 below joint 2.
    let turn = axis_angle([0.0, 1.0, 0.0], 0.8);
    override_joint(&mut animations, turned, 0, 6, joints::mode::ADD, 1.0, turn);
    override_joint(&mut animations, idle, 0, 6, joints::mode::SET, 0.0, turn);
    animations.update(&jobs, 0.0);
    let m = |a: &Animations, i: u32| a.instance_matrices(i).to_vec();
    assert_eq!(m(&animations, plain), before);
    assert_eq!(m(&animations, idle), before);
    let after = m(&animations, turned);
    let joint = |v: &[f32], j: usize| v[j * MATRIX_FLOATS..(j + 1) * MATRIX_FLOATS].to_vec();
    for j in [0, 1, 2, 3, 4, 5, 7] {
        assert_eq!(joint(&after, j), joint(&before, j), "joint {j}");
    }
    assert_ne!(joint(&after, 6), joint(&before, 6));
    // A removed instance's overrides go with it: the next instance in its place has none.
    animations.remove_instance(turned).unwrap();
    let again = animations.add_instance(id).unwrap();
    assert_eq!(again, turned);
    animations.set_sample(again, 0, clip, 0.4, 1.0);
    animations.update(&jobs, 0.0);
    assert_eq!(m(&animations, again), before);
}

/// A chain of four joints, each 1 above its parent along +Y, with the inverse bind matrices of
/// that rest pose.
fn upright_chain() -> Skeleton {
    upright_chain_of(4)
}

/// A chain of `joints` joints, each 1 above its parent along +Y, with the inverse bind matrices of
/// that rest pose. A skeleton's lanes are its joint count rounded up to a multiple of four, so a
/// chain wider than four joints needs more than four joints.
fn upright_chain_of(joints: usize) -> Skeleton {
    let parents: Vec<u32> = std::iter::once(NO_PARENT)
        .chain(0..joints as u32 - 1)
        .collect();
    let mut rest = [0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0].repeat(joints);
    rest[1] = 0.0;
    let binds: Vec<f32> = (0..joints)
        .flat_map(|j| {
            let mut m = null3d_core::math::IDENTITY;
            m[7] = -(j as f32);
            m
        })
        .collect();
    Skeleton::new(&parents, &rest, &binds).unwrap()
}

#[test]
fn a_look_at_aims_from_the_objects_place_in_the_world() {
    let jobs = JobSystem::new(0);
    let mut animations = Animations::new(&jobs, 3, 12).unwrap();
    let id = animations.add_skeleton(upright_chain()).unwrap();
    let home = animations.add_instance(id).unwrap();
    let away = animations.add_instance(id).unwrap();
    let lost = animations.add_instance(id).unwrap();
    animations.enable_joint_overrides().unwrap();
    for (instance, object) in [(home, 0), (away, 1), (lost, 2)] {
        animations.set_object(instance, object).unwrap();
        let at = instance as usize * joints::BLOCK_FLOATS;
        let block = &mut animations.joint_overrides_mut()[at..at + joints::BLOCK_FLOATS];
        block[joints::place::LOOK_WEIGHT] = 1.0;
        block[joints::place::LOOK_COUNT] = 3.0;
        for k in 0..3 {
            let j = joints::place::LOOK_JOINTS + k * joints::place::LOOK_JOINT_FLOATS;
            block[j..j + 3].copy_from_slice(&[k as f32 + 1.0, 1.0, 3.0]);
        }
    }
    // The second object is turned a quarter about Y and moved; the third no longer exists.
    let s = std::f64::consts::FRAC_1_SQRT_2;
    let quarter = null3d_core::math::compose([10.0f64, 0.0, -5.0], [0.0, s, 0.0, s], [1.0; 3]);
    let world = |object: u32| match object {
        0 => Some(null3d_core::math::IDENTITY64),
        1 => Some(quarter),
        _ => None,
    };
    let local = [4.0f64, 3.0, 0.0];
    let placed: [f64; 3] = std::array::from_fn(|r| {
        quarter[4 * r] * local[0]
            + quarter[4 * r + 1] * local[1]
            + quarter[4 * r + 2] * local[2]
            + quarter[4 * r + 3]
    });
    let targets = animations.look_targets_mut();
    targets[..3].copy_from_slice(&local);
    targets[3..6].copy_from_slice(&placed);
    targets[6..9].copy_from_slice(&local);
    animations.resolve_look_targets(world);
    animations.update(&jobs, 0.0);
    let a = animations.instance_matrices(home).to_vec();
    let b = animations.instance_matrices(away).to_vec();
    let difference = largest_difference(
        a.iter().map(|&v| f64::from(v)),
        &b.iter().map(|&v| f64::from(v)).collect::<Vec<_>>(),
    );
    assert!(difference < 1e-4, "{difference}");
    // The last joint's +Z, its forward at bind, points from it at the target. Its skinning matrix
    // times its bind matrix (a move up by 3) is its matrix in the object's space.
    let end = &a[3 * MATRIX_FLOATS..4 * MATRIX_FLOATS];
    let from = [
        end[3] + 3.0 * end[1],
        end[7] + 3.0 * end[5],
        end[11] + 3.0 * end[9],
    ];
    let forward = [end[2], end[6], end[10]];
    let wanted = [4.0 - from[0], 3.0 - from[1], -from[2]];
    let length = (wanted.iter().map(|v| v * v).sum::<f32>()).sqrt();
    let cos = forward.iter().zip(&wanted).map(|(f, w)| f * w).sum::<f32>() / length;
    assert!(cos > 0.9999, "{cos}");
    // An object that no longer exists leaves its chain as the clips pose it.
    let rest = animations.instance_matrices(lost).to_vec();
    let identity = null3d_core::math::IDENTITY.repeat(4);
    assert!(
        largest_difference(
            rest.iter().map(|&v| f64::from(v)),
            &identity.iter().map(|&v| f64::from(v)).collect::<Vec<_>>()
        ) < 1e-6
    );
}

/// A skeleton of one joint at the origin, whose bind matrix is the identity, so a frame step's
/// skinning matrix holds the joint's local pose.
fn single_joint() -> Skeleton {
    Skeleton::new(
        &[NO_PARENT],
        &[0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0],
        &[1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0],
    )
    .unwrap()
}

/// Two joints that both hang from the root, with the identity bind matrix, so neither one's pose
/// moves the other's skinning matrix: a joint's matrix holds its own local pose.
fn two_roots() -> Skeleton {
    let rest = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0].repeat(2);
    let binds = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0].repeat(2);
    Skeleton::new(&[NO_PARENT, NO_PARENT], &rest, &binds).unwrap()
}

/// A one-second clip of one joint whose translation moves along x at `speed` per second from
/// `start`, so a sample is exactly `start + speed * t`.
fn sliding(skeleton: &Skeleton, start: f32, speed: f32) -> Clip {
    moving(skeleton, &[0], start, speed)
}

/// A one-second clip of the named joints, each moving along x at `speed` per second from `start`,
/// so a sample of a joint is exactly `start + speed * t`.
fn moving(skeleton: &Skeleton, joints: &[u32], start: f32, speed: f32) -> Clip {
    let times = [0.0, 1.0];
    let values: Vec<f32> = vec![start, 0.0, 0.0, start + speed, 0.0, 0.0];
    let tracks: Vec<SourceTrack> = joints
        .iter()
        .map(|&joint| SourceTrack {
            joint,
            channel: Channel::Translation,
            interpolation: Interpolation::Linear,
            times: &times,
            values: &values,
        })
        .collect();
    resample(skeleton, &tracks, DEFAULT_RATE).unwrap()
}

/// The joint's local x translation from the last frame step.
fn x_of(animations: &Animations, instance: u32) -> f32 {
    x_of_joint(animations, instance, 0)
}

/// The local x translation of joint `joint` of an instance, from the last frame step.
fn x_of_joint(animations: &Animations, instance: u32, joint: usize) -> f32 {
    animations.instance_matrices(instance)[joint * MATRIX_FLOATS + 3]
}

/// A play that switches its layer with an inertial transition over `fade` seconds.
fn inertial(fade: f32) -> Play {
    Play {
        fade,
        inertial: true,
        ..Play::default()
    }
}

/// The number of sample slots that a live play fills.
fn playing_slots(animations: &Animations, instance: u32) -> usize {
    let first = instance as usize * MAX_BLEND;
    (first..first + MAX_BLEND)
        .filter(|&s| animations.slots().source[s] != NO_SOURCE)
        .count()
}

/// `x * x * (3 - 2x)`, clamped: the ease of Holden's dead blending, which the core follows.
fn smoothstep(x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

/// An inertial switch extrapolates the outgoing pose at its own velocity and eases it into the
/// new clip, and samples only the new clip while it runs. The figures are Holden's dead blending
/// (`deadblending.c`, MIT): `ext` moves at the source velocity each step and the output is
/// `lerp(ext, input, smoothstep(t / blendtime))`.
#[test]
fn an_inertial_switch_follows_the_dead_blending_reference() {
    let jobs = JobSystem::new(0);
    let skeleton = single_joint();
    let mut animations = Animations::new(&jobs, 1, 1).unwrap();
    let id = animations.add_skeleton(skeleton.clone()).unwrap();
    let walk = animations
        .add_clip(id, sliding(&skeleton, 0.0, 1.0))
        .unwrap();
    let run = animations
        .add_clip(id, sliding(&skeleton, 10.0, 2.0))
        .unwrap();
    let instance = animations.add_instance(id).unwrap();
    let dt = 1.0 / 60.0;
    animations.play(instance, walk, Play::default()).unwrap();
    for _ in 0..10 {
        animations.update(&jobs, dt);
    }
    let source = x_of(&animations, instance);
    assert!((source - 10.0 * dt).abs() < 1e-4, "{source}");

    let fade = 0.5;
    animations.play(instance, run, inertial(fade)).unwrap();
    assert_eq!(
        playing_slots(&animations, instance),
        1,
        "only the run plays"
    );

    // `source` moves at 1 unit a second, and the run at 2 from 10; the reference follows.
    for k in 1..=32 {
        animations.update(&jobs, dt);
        let t = k as f32 * dt;
        let extrapolated = source + 1.0 * t;
        let input = 10.0 + 2.0 * t;
        let expected = if t < fade {
            extrapolated + (input - extrapolated) * smoothstep(t / fade)
        } else {
            input
        };
        let got = x_of(&animations, instance);
        assert!(
            (got - expected).abs() < 2e-3,
            "step {k}: got {got}, expected {expected}"
        );
    }
}

/// An inertial switch keeps the pose continuous at the switch: its first step's pose is the
/// outgoing pose carried on at its own speed, not a jump to the new clip.
#[test]
fn an_inertial_switch_starts_from_the_outgoing_pose() {
    let jobs = JobSystem::new(0);
    let skeleton = single_joint();
    let mut animations = Animations::new(&jobs, 1, 1).unwrap();
    let id = animations.add_skeleton(skeleton.clone()).unwrap();
    let walk = animations
        .add_clip(id, sliding(&skeleton, 0.0, 1.0))
        .unwrap();
    let run = animations
        .add_clip(id, sliding(&skeleton, 10.0, 2.0))
        .unwrap();
    let instance = animations.add_instance(id).unwrap();
    let dt = 1.0 / 60.0;
    animations.play(instance, walk, Play::default()).unwrap();
    for _ in 0..10 {
        animations.update(&jobs, dt);
    }
    let source = x_of(&animations, instance);
    animations.play(instance, run, inertial(1.0)).unwrap();
    animations.update(&jobs, dt);
    let got = x_of(&animations, instance);
    // One step of the outgoing pose at its speed, with only the 1/60 s share of the fade's ease
    // pulling it toward the new clip.
    let extrapolated = source + dt;
    let input = 10.0 + 2.0 * dt;
    let expected = extrapolated + (input - extrapolated) * smoothstep(dt);
    assert!((got - expected).abs() < 2e-3, "{got} against {expected}");
    // It is still near the outgoing pose, not already at the new clip.
    assert!(got < 0.5, "{got}");
    // A cross-fade instead samples both clips: its first step sits between them.
    let blend_got = {
        let mut other = Animations::new(&jobs, 1, 1).unwrap();
        let other_id = other.add_skeleton(single_joint()).unwrap();
        let a = other
            .add_clip(other_id, sliding(&single_joint(), 0.0, 1.0))
            .unwrap();
        let b = other
            .add_clip(other_id, sliding(&single_joint(), 10.0, 2.0))
            .unwrap();
        let other_instance = other.add_instance(other_id).unwrap();
        other.play(other_instance, a, Play::default()).unwrap();
        for _ in 0..10 {
            other.update(&jobs, dt);
        }
        other.play(other_instance, b, faded(1.0)).unwrap();
        assert_eq!(
            playing_slots(&other, other_instance),
            2,
            "a blend samples both"
        );
        other.update(&jobs, dt);
        x_of(&other, other_instance)
    };
    assert!(
        blend_got > got + 0.1,
        "the blend mixes in the new clip at once: {blend_got} against {got}"
    );
}

/// An inertial switch without a fade, with a weight, or on a layer that plays nothing stays a
/// plain switch: no dead blend runs, and the layer keeps its slot count.
#[test]
fn an_inertial_switch_falls_back_when_it_cannot_run() {
    let jobs = JobSystem::new(0);
    let skeleton = single_joint();
    let mut animations = Animations::new(&jobs, 1, 1).unwrap();
    let id = animations.add_skeleton(skeleton.clone()).unwrap();
    let walk = animations
        .add_clip(id, sliding(&skeleton, 0.0, 1.0))
        .unwrap();
    let run = animations
        .add_clip(id, sliding(&skeleton, 10.0, 2.0))
        .unwrap();
    let instance = animations.add_instance(id).unwrap();
    // No clip plays yet: nothing to extrapolate.
    animations.play(instance, walk, inertial(0.5)).unwrap();
    assert_eq!(playing_slots(&animations, instance), 1);
    animations.update(&jobs, 1.0 / 60.0);
    // A fade of 0 switches at once, and a weight joins the layer instead of switching it.
    animations
        .play(
            instance,
            run,
            Play {
                inertial: true,
                ..Play::default()
            },
        )
        .unwrap();
    assert_eq!(playing_slots(&animations, instance), 1);
    animations
        .play(
            instance,
            walk,
            Play {
                fade: 0.5,
                weight: Some(0.5),
                join: true,
                inertial: true,
                ..Play::default()
            },
        )
        .unwrap();
    assert_eq!(playing_slots(&animations, instance), 2);
}

/// A slow instance spends the time of each frame it skipped, so the frame that poses it again
/// covers exactly the frames in between, whatever their lengths. Multiplying the last frame by the
/// gap instead charges a hitch once for every frame of the interval, and the clip drifts.
#[test]
fn a_slow_instance_spends_each_frame_it_skipped() {
    let jobs = JobSystem::new(0);
    let (skeleton, clips) = character(4);
    let mut animations = Animations::new(&jobs, 2, 8).unwrap();
    let id = animations.add_skeleton(skeleton).unwrap();
    let clip = animations.add_clip(id, clips[0].clone()).unwrap();
    let slow = animations.add_instance(id).unwrap();
    let every = animations.add_instance(id).unwrap();
    animations.play(slow, clip, Play::default()).unwrap();
    animations.play(every, clip, Play::default()).unwrap();
    animations.update_intervals_mut()[slow as usize] = 4;

    // Three even frames, one that took ten times as long, then the frame that poses it again.
    let dt = 1.0 / 60.0;
    for time in [dt, dt, dt, 10.0 * dt, dt] {
        animations.update(&jobs, time);
    }
    let slow_pose = animations.instance_matrices(slow).to_vec();
    let largest = slow_pose
        .iter()
        .zip(animations.instance_matrices(every))
        .map(|(a, b)| (a - b).abs())
        .fold(0.0f32, f32::max);
    assert!(largest < 1e-4, "the slow pose differs by {largest}");
}

/// A dead blend belongs to the instance that started it: the instance that takes a removed one's id
/// plays its own clips, without the blend the other left running.
#[test]
fn a_reused_id_starts_without_the_blend_it_inherited() {
    let jobs = JobSystem::new(0);
    let skeleton = single_joint();
    let mut animations = Animations::new(&jobs, 1, 1).unwrap();
    let id = animations.add_skeleton(skeleton.clone()).unwrap();
    let walk = animations
        .add_clip(id, sliding(&skeleton, 0.0, 1.0))
        .unwrap();
    let run = animations
        .add_clip(id, sliding(&skeleton, 10.0, 2.0))
        .unwrap();
    let instance = animations.add_instance(id).unwrap();
    let dt = 1.0 / 60.0;
    animations.play(instance, walk, Play::default()).unwrap();
    for _ in 0..10 {
        animations.update(&jobs, dt);
    }
    // A fade far longer than the instance lives, so its blend is still running when it goes.
    animations.play(instance, run, inertial(30.0)).unwrap();
    animations.update(&jobs, dt);
    assert!(x_of(&animations, instance) < 1.0, "the blend still runs");

    animations.remove_instance(instance).unwrap();
    let again = animations.add_instance(id).unwrap();
    assert_eq!(again, instance, "the id comes back");
    animations.play(again, run, Play::default()).unwrap();
    animations.update(&jobs, dt);
    let got = x_of(&animations, again);
    let expected = 10.0 + 2.0 * dt;
    assert!((got - expected).abs() < 1e-3, "{got} against {expected}");
}

/// A skeleton with more joints than any before moves the dead blends' buffers, so the poses they
/// held are gone: every blend ends there, rather than decaying a layer toward a pose of nothing.
#[test]
fn a_wider_skeleton_ends_the_dead_blends() {
    let jobs = JobSystem::new(0);
    let skeleton = single_joint();
    let mut animations = Animations::new(&jobs, 1, 8).unwrap();
    let id = animations.add_skeleton(skeleton.clone()).unwrap();
    let walk = animations
        .add_clip(id, sliding(&skeleton, 0.0, 1.0))
        .unwrap();
    let run = animations
        .add_clip(id, sliding(&skeleton, 10.0, 2.0))
        .unwrap();
    let instance = animations.add_instance(id).unwrap();
    let dt = 1.0 / 60.0;
    animations.play(instance, walk, Play::default()).unwrap();
    for _ in 0..10 {
        animations.update(&jobs, dt);
    }
    // A fade long enough to run across the wider skeleton.
    animations.play(instance, run, inertial(4.0)).unwrap();
    assert_eq!(
        playing_slots(&animations, instance),
        1,
        "only the run plays"
    );
    animations.update(&jobs, dt);
    assert!(x_of(&animations, instance) < 1.0, "the blend still runs");

    // A skeleton of more lanes than the one before moves the dead blend's buffers, and the pose it
    // held is gone, so the blend ends: the layer plays its new clip alone.
    animations.add_skeleton(upright_chain_of(8)).unwrap();
    animations.update(&jobs, dt);
    let got = x_of(&animations, instance);
    let expected = 10.0 + 2.0 * (2.0 * dt);
    assert!((got - expected).abs() < 1e-3, "{got} against {expected}");
}

/// The outgoing pose carries on at the speed its clip plays, not at the rate the clip's own content
/// moves: a clip at speed 2 leaves a pose that keeps moving twice as fast.
#[test]
fn an_inertial_switch_extrapolates_at_the_clips_speed() {
    let jobs = JobSystem::new(0);
    let skeleton = single_joint();
    let mut animations = Animations::new(&jobs, 1, 1).unwrap();
    let id = animations.add_skeleton(skeleton.clone()).unwrap();
    let walk = animations
        .add_clip(id, sliding(&skeleton, 0.0, 1.0))
        .unwrap();
    let run = animations
        .add_clip(id, sliding(&skeleton, 10.0, 2.0))
        .unwrap();
    let instance = animations.add_instance(id).unwrap();
    let dt = 1.0 / 60.0;
    animations
        .play(
            instance,
            walk,
            Play {
                speed: 2.0,
                ..Play::default()
            },
        )
        .unwrap();
    for _ in 0..10 {
        animations.update(&jobs, dt);
    }
    let source = x_of(&animations, instance);
    assert!((source - 2.0 * 10.0 * dt).abs() < 1e-4, "{source}");

    animations.play(instance, run, inertial(1.0)).unwrap();
    animations.update(&jobs, dt);
    let got = x_of(&animations, instance);
    let extrapolated = source + 2.0 * dt;
    let input = 10.0 + 2.0 * dt;
    let expected = extrapolated + (input - extrapolated) * smoothstep(dt);
    assert!((got - expected).abs() < 2e-3, "{got} against {expected}");
}

/// A dead blend ends on its own however the instance's time runs: with a negative time scale its
/// fade still completes, so the layer shows its clip instead of the pose it left for ever.
#[test]
fn a_dead_blend_ends_with_a_negative_time_scale() {
    let jobs = JobSystem::new(0);
    let skeleton = single_joint();
    let mut animations = Animations::new(&jobs, 1, 1).unwrap();
    let id = animations.add_skeleton(skeleton.clone()).unwrap();
    let walk = animations
        .add_clip(id, sliding(&skeleton, 0.0, 1.0))
        .unwrap();
    let run = animations
        .add_clip(id, sliding(&skeleton, 10.0, 2.0))
        .unwrap();
    let instance = animations.add_instance(id).unwrap();
    let dt = 1.0 / 60.0;
    animations.play(instance, walk, Play::default()).unwrap();
    for _ in 0..10 {
        animations.update(&jobs, dt);
    }
    // The clip holds its first frame while the time runs backward, so its pose is its start.
    animations
        .play(
            instance,
            run,
            Play {
                looping: false,
                ..inertial(0.1)
            },
        )
        .unwrap();
    animations.time_scales_mut()[instance as usize] = -1.0;
    for _ in 0..20 {
        animations.update(&jobs, dt);
    }
    let got = x_of(&animations, instance);
    assert!((got - 10.0).abs() < 1e-3, "{got}");
}

/// A second inertial switch during a fade carries on from the pose on screen, so a crowd that
/// changes its mind mid-transition does not jump back to the clips the first switch left behind.
#[test]
fn a_second_inertial_switch_carries_on_from_the_pose_on_screen() {
    let jobs = JobSystem::new(0);
    let skeleton = single_joint();
    let mut animations = Animations::new(&jobs, 1, 1).unwrap();
    let id = animations.add_skeleton(skeleton.clone()).unwrap();
    let walk = animations
        .add_clip(id, sliding(&skeleton, 0.0, 1.0))
        .unwrap();
    let run = animations
        .add_clip(id, sliding(&skeleton, 10.0, 2.0))
        .unwrap();
    let instance = animations.add_instance(id).unwrap();
    let dt = 1.0 / 60.0;
    animations.play(instance, walk, Play::default()).unwrap();
    for _ in 0..10 {
        animations.update(&jobs, dt);
    }
    animations.play(instance, run, inertial(1.0)).unwrap();
    for _ in 0..20 {
        animations.update(&jobs, dt);
    }
    let on_screen = x_of(&animations, instance);
    assert!(
        on_screen > 1.0 && on_screen < 10.0,
        "the first fade is between the clips: {on_screen}"
    );

    animations.play(instance, walk, inertial(1.0)).unwrap();
    animations.update(&jobs, dt);
    let got = x_of(&animations, instance);
    assert!(
        (got - on_screen).abs() < 0.05,
        "the second switch jumps from {on_screen} to {got}"
    );
}

/// A joint that only the outgoing clip of a layer above the first animated keeps the pose the
/// blend decays from while the fade runs, and the pose below covers it once the fade ends.
#[test]
fn a_layer_above_zero_keeps_what_only_the_outgoing_clip_animated() {
    let jobs = JobSystem::new(0);
    let skeleton = two_roots();
    let mut animations = Animations::new(&jobs, 1, 8).unwrap();
    let id = animations.add_skeleton(skeleton.clone()).unwrap();
    // The outgoing clip moves both joints; the new one moves joint 0 alone.
    let both = animations
        .add_clip(id, moving(&skeleton, &[0, 1], 0.0, 1.0))
        .unwrap();
    let one = animations
        .add_clip(id, moving(&skeleton, &[0], 10.0, 2.0))
        .unwrap();
    let instance = animations.add_instance(id).unwrap();
    let dt = 1.0 / 60.0;
    let on_layer_one = |play: Play| Play { layer: 1, ..play };
    animations
        .play(instance, both, on_layer_one(Play::default()))
        .unwrap();
    for _ in 0..10 {
        animations.update(&jobs, dt);
    }
    let before = x_of_joint(&animations, instance, 1);
    assert!(before > 0.1, "the outgoing clip moves joint 1: {before}");

    animations
        .play(instance, one, on_layer_one(inertial(2.0)))
        .unwrap();
    animations.update(&jobs, dt);
    let got = x_of_joint(&animations, instance, 1);
    assert!(
        got >= before,
        "joint 1 snaps from {before} to {got} at the switch"
    );

    // Past the fade the layer holds nothing on joint 1, so the pose below shows: the rest pose,
    // whose x is 0.
    for _ in 0..200 {
        animations.update(&jobs, dt);
    }
    let after = x_of_joint(&animations, instance, 1);
    assert!(after.abs() < 1e-3, "joint 1 settles at {after}");
    assert!(
        x_of_joint(&animations, instance, 0) > 9.0,
        "the new clip poses joint 0"
    );
}

/// A second inertial switch on a layer above the first carries on with the channels the blend
/// before it decayed toward, so a joint that only the older clips animated keeps fading.
#[test]
fn a_second_switch_on_a_high_layer_keeps_the_channels_the_first_one_carried() {
    let jobs = JobSystem::new(0);
    let skeleton = two_roots();
    let mut animations = Animations::new(&jobs, 1, 8).unwrap();
    let id = animations.add_skeleton(skeleton.clone()).unwrap();
    let both = animations
        .add_clip(id, moving(&skeleton, &[0, 1], 0.0, 1.0))
        .unwrap();
    let one = animations
        .add_clip(id, moving(&skeleton, &[0], 10.0, 2.0))
        .unwrap();
    let other = animations
        .add_clip(id, moving(&skeleton, &[0], 20.0, 2.0))
        .unwrap();
    let instance = animations.add_instance(id).unwrap();
    let dt = 1.0 / 60.0;
    let on_layer_one = |play: Play| Play { layer: 1, ..play };
    animations
        .play(instance, both, on_layer_one(Play::default()))
        .unwrap();
    for _ in 0..10 {
        animations.update(&jobs, dt);
    }
    // The first switch leaves joint 1 to the blend alone.
    animations
        .play(instance, one, on_layer_one(inertial(2.0)))
        .unwrap();
    for _ in 0..30 {
        animations.update(&jobs, dt);
    }
    let before = x_of_joint(&animations, instance, 1);
    assert!(
        before > 0.1,
        "the first blend still shows joint 1: {before}"
    );

    // The second switch replaces the layer's clips again, and joint 1 carries on fading.
    animations
        .play(instance, other, on_layer_one(inertial(2.0)))
        .unwrap();
    animations.update(&jobs, dt);
    let got = x_of_joint(&animations, instance, 1);
    assert!(got >= before * 0.9, "joint 1 snaps from {before} to {got}");
}

/// A crowd that runs more dead blends at once than the pool starts with grows the pool, and every
/// blend keeps the pose it decays from.
#[test]
fn more_dead_blends_than_the_pool_holds_grow_it() {
    let jobs = JobSystem::new(0);
    let skeleton = single_joint();
    let mut animations = Animations::new(&jobs, 24, 24).unwrap();
    let id = animations.add_skeleton(skeleton.clone()).unwrap();
    let walk = animations
        .add_clip(id, sliding(&skeleton, 0.0, 1.0))
        .unwrap();
    let run = animations
        .add_clip(id, sliding(&skeleton, 10.0, 2.0))
        .unwrap();
    let dt = 1.0 / 60.0;
    let instances: Vec<u32> = (0..24)
        .map(|_| {
            let instance = animations.add_instance(id).unwrap();
            animations.play(instance, walk, Play::default()).unwrap();
            instance
        })
        .collect();
    for _ in 0..10 {
        animations.update(&jobs, dt);
    }
    for &instance in &instances {
        animations.play(instance, run, inertial(2.0)).unwrap();
    }
    // Half a second into a two-second fade, so every instance still decays from its old pose.
    for _ in 0..30 {
        animations.update(&jobs, dt);
    }
    for &instance in &instances {
        let x = x_of(&animations, instance);
        assert!(x > 0.0 && x < 8.0, "instance {instance} is at {x}");
    }
    // Past the fade every layer plays its new clip alone, whose x is between 10 and 12.
    for _ in 0..200 {
        animations.update(&jobs, dt);
    }
    let settled: Vec<f32> = instances
        .iter()
        .map(|&instance| x_of(&animations, instance))
        .collect();
    for (instance, &x) in instances.iter().zip(&settled) {
        assert!((10.0..12.0).contains(&x), "instance {instance} is at {x}");
    }
    let low = settled.iter().copied().fold(f32::MAX, f32::min);
    let high = settled.iter().copied().fold(f32::MIN, f32::max);
    assert!(high - low < 1e-3, "the crowd drifts from {low} to {high}");
}
