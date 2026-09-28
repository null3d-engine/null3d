//! Parallel draw-list recording: for any worker count and chunk size the joined list equals a
//! serial recording, it decodes back to the same commands in item order, and running out of room
//! is reported.
#![allow(clippy::disallowed_methods)] // Native job workers are threads.

use std::ops::Range;
use std::thread;

use null3d_core::jobs::JobSystem;
use null3d_gpu::drawlist::{DrawList, DrawListError, Op, decode};
use null3d_render::parallel_record::{ParallelRecordError, ParallelRecorder};

/// Runs `f` with a job system whose workers are native threads.
fn with_workers<R>(workers: u32, f: impl FnOnce(&JobSystem) -> R) -> R {
    let jobs = JobSystem::new(workers);
    thread::scope(|scope| {
        for i in 0..workers {
            let jobs = &jobs;
            scope.spawn(move || jobs.worker_loop(i));
        }
        let result = f(&jobs);
        jobs.shutdown();
        result
    })
}

/// One draw per item, with the item's index as its vertex count.
fn draw_items(range: Range<u32>, list: &mut DrawList) -> Result<(), DrawListError> {
    for i in range {
        list.push(Op::Draw, &[i, 1, 0, 0])?;
    }
    Ok(())
}

const ITEMS: u32 = 1000;
const WORDS: usize = ITEMS as usize * 5;

#[test]
fn the_joined_list_equals_a_serial_recording() {
    let mut serial = DrawList::with_capacity(WORDS);
    draw_items(0..ITEMS, &mut serial).unwrap();
    for workers in [0, 1, 2, 4, 8] {
        with_workers(workers, |jobs| {
            let mut recorder = ParallelRecorder::new(jobs.thread_count(), WORDS, ITEMS);
            for chunk in [1, 3, 64, ITEMS] {
                let mut out = DrawList::with_capacity(WORDS);
                recorder
                    .record(jobs, ITEMS, chunk, &draw_items, &mut out)
                    .unwrap();
                assert_eq!(
                    out.words(),
                    serial.words(),
                    "{workers} workers, chunks of {chunk}"
                );
            }
        });
    }
}

#[test]
fn recorded_commands_decode_in_item_order() {
    with_workers(4, |jobs| {
        let mut recorder = ParallelRecorder::new(jobs.thread_count(), WORDS, ITEMS);
        let mut out = DrawList::with_capacity(WORDS);
        recorder
            .record(jobs, ITEMS, 7, &draw_items, &mut out)
            .unwrap();
        let firsts: Vec<u32> = decode(out.words())
            .map(|command| {
                let command = command.unwrap();
                assert_eq!(command.op, Op::Draw);
                command.operands[0]
            })
            .collect();
        assert_eq!(firsts, (0..ITEMS).collect::<Vec<_>>());
    });
}

#[test]
fn running_out_of_room_is_reported() {
    with_workers(2, |jobs| {
        let mut recorder = ParallelRecorder::new(jobs.thread_count(), WORDS, 10);
        let mut out = DrawList::with_capacity(WORDS);
        assert_eq!(
            recorder.record(jobs, ITEMS, 1, &draw_items, &mut out),
            Err(ParallelRecordError::TooManyChunks {
                chunks: ITEMS,
                max: 10
            })
        );
        let mut small = ParallelRecorder::new(jobs.thread_count(), 50, ITEMS);
        assert_eq!(
            small.record(jobs, ITEMS, 100, &draw_items, &mut out),
            Err(ParallelRecordError::Full)
        );
        let mut tiny_out = DrawList::with_capacity(10);
        assert_eq!(
            recorder.record(jobs, 10, 1, &draw_items, &mut tiny_out),
            Err(ParallelRecordError::Full)
        );
    });
}
