//! Parallel draw-list recording. Job workers record chunks of a pass into draw lists of their own,
//! and the calling thread then joins the chunks into one list in chunk order, so the result never
//! depends on which thread ran which chunk. Everything is allocated at creation, so recording
//! allocates nothing.

use std::cell::UnsafeCell;
use std::ops::Range;
use std::sync::atomic::{AtomicBool, Ordering};

use sokko3d_core::jobs::JobSystem;
use sokko3d_gpu::drawlist::{DrawList, DrawListError};

/// The words one chunk recorded: a range of the list of the thread that ran it.
#[derive(Clone, Copy, Debug, Default)]
struct Span {
    chunk: u32,
    thread: u32,
    start: u32,
    end: u32,
}

/// One thread's list, and the spans of the chunks it recorded.
struct ThreadList {
    list: DrawList,
    spans: Vec<Span>,
}

/// Why a parallel recording failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParallelRecordError {
    /// A thread's list, or the output list, ran out of room.
    Full,
    /// The recording has more chunks than the recorder was made for.
    TooManyChunks { chunks: u32, max: u32 },
}

impl From<DrawListError> for ParallelRecordError {
    fn from(_: DrawListError) -> Self {
        ParallelRecordError::Full
    }
}

/// The function that records the commands of a range of items into a list.
pub type RecordFn<'a> = dyn Fn(Range<u32>, &mut DrawList) -> Result<(), DrawListError> + Sync + 'a;

/// Per-thread draw lists for recording one pass on the job system.
pub struct ParallelRecorder {
    threads: Vec<UnsafeCell<ThreadList>>,
    order: Vec<Span>,
    max_chunks: u32,
}

// SAFETY: during a recording each thread touches only the entry of `threads` that its worker id
// selects, and the calling thread reads the entries only after the parallel loop has returned,
// when every chunk has finished.
unsafe impl Sync for ParallelRecorder {}

impl ParallelRecorder {
    /// Room for `threads` threads (the job system's thread count), `words` words of commands per
    /// thread, and `max_chunks` chunks per recording.
    pub fn new(threads: u32, words: usize, max_chunks: u32) -> Self {
        Self {
            threads: (0..threads.max(1))
                .map(|_| {
                    UnsafeCell::new(ThreadList {
                        list: DrawList::with_capacity(words),
                        spans: Vec::with_capacity(max_chunks as usize),
                    })
                })
                .collect(),
            order: Vec::with_capacity(max_chunks as usize),
            max_chunks,
        }
    }

    /// Records `count` items in chunks of `chunk` items on the job system, then appends every
    /// chunk's commands to `out` in chunk order.
    pub fn record(
        &mut self,
        jobs: &JobSystem,
        count: u32,
        chunk: u32,
        record: &RecordFn<'_>,
        out: &mut DrawList,
    ) -> Result<(), ParallelRecordError> {
        let chunk = chunk.max(1);
        let chunks = count.div_ceil(chunk);
        if chunks > self.max_chunks {
            return Err(ParallelRecordError::TooManyChunks {
                chunks,
                max: self.max_chunks,
            });
        }
        assert!(
            jobs.thread_count() as usize <= self.threads.len(),
            "the recorder was made for fewer threads than the job system has"
        );
        for thread in &mut self.threads {
            let thread = thread.get_mut();
            thread.list.clear();
            thread.spans.clear();
        }
        let failed = AtomicBool::new(false);
        let shared: &ParallelRecorder = self;
        jobs.parallel_for(count, chunk, &|range, worker| {
            let index = worker.index();
            // SAFETY: only the thread with this worker id reaches this entry during the loop.
            let thread = unsafe { &mut *shared.threads[index].get() };
            let start = thread.list.len() as u32;
            let chunk_index = range.start / chunk;
            if record(range, &mut thread.list).is_err() {
                failed.store(true, Ordering::Relaxed);
                return;
            }
            thread.spans.push(Span {
                chunk: chunk_index,
                thread: index as u32,
                start,
                end: thread.list.len() as u32,
            });
        });
        if failed.load(Ordering::Relaxed) {
            return Err(ParallelRecordError::Full);
        }
        self.order.clear();
        for thread in &mut self.threads {
            self.order.extend_from_slice(&thread.get_mut().spans);
        }
        self.order.sort_unstable_by_key(|span| span.chunk);
        for span in &self.order {
            let thread = self.threads[span.thread as usize].get_mut();
            out.append(&thread.list.words()[span.start as usize..span.end as usize])?;
        }
        Ok(())
    }
}
