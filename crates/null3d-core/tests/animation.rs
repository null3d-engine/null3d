//! Animation sampling against three.js: clips resampled from the fixture's keys, sampled, blended
//! and composed into skinning matrices, compared with what three.js's `AnimationMixer` and
//! `Skeleton` give for the same skeleton and clips (`bun bench/three-fixtures.ts`). Also the
//! resampling rules, refused input, and the frame step on several threads.

mod common;

#[path = "fixtures/three_animation.rs"]
mod three;

use common::{Workers, character};
use null3d_core::animation::{
    AnimationError, Animations, Channel, Clip, DEFAULT_RATE, Interpolation, MATRIX_FLOATS,
    MAX_BLEND, MAX_FRAMES, NO_PARENT, POSE_FIELDS, Skeleton, SourceTrack, TrackProblem, resample,
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
            interpolation: if t.step {
                Interpolation::Step
            } else {
                Interpolation::Linear
            },
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
    animations.update(jobs);
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
    animations.update(&jobs);
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
    animations.update(&jobs);
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
        animations.update(jobs);
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
    // A clip of days at 30 keys a second would hold more frames than any real clip.
    let long = SourceTrack {
        times: &[0.0, 1.0e6],
        ..good
    };
    assert!(matches!(
        resample(&skeleton, &[long], DEFAULT_RATE),
        Err(AnimationError::Frames { frames }) if frames >= MAX_FRAMES
    ));
}
