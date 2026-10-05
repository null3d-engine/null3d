//! Animation sampling against three.js: clips resampled from the fixture's keys, sampled, blended
//! and composed into skinning matrices, compared with what three.js's `AnimationMixer` and
//! `Skeleton` give for the same skeleton and clips (`bun bench/three-fixtures.ts`). Also the
//! resampling rules, refused input, and the frame step on several threads.

mod common;

#[path = "fixtures/three_animation.rs"]
mod three;

use common::{Workers, axis_angle, character};
use null3d_core::animation::{
    AnimationError, Animations, Channel, Clip, DEFAULT_RATE, EVENT_WORDS, Interpolation,
    MATRIX_FLOATS, MAX_BLEND, MAX_CLIP_KEYS, MAX_LAYERS, NO_PARENT, POSE_FIELDS, Play, Skeleton,
    SourceTrack, TrackProblem, event_kind, flag, resample,
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
    assert_eq!(
        refused.err(),
        Some(AnimationError::Keys {
            keys: frames * joints
        })
    );
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
