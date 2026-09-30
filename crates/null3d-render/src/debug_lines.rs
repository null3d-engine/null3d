//! The debug lines pass: lines that a sketch draws for one frame, which development builds of the
//! engine draw into the camera's view over its opaque objects.
//!
//! # Points
//!
//! A sketch draws lines as pairs of points. Each point is a position in world space, in 64-bit
//! floats, and an sRGB color. TypeScript writes the points into a [`LineStore`] in engine memory,
//! which grows as the sketch needs it. The frame that records next draws them, and the store then
//! starts empty for the frame after it.
//!
//! # The pass
//!
//! Each frame builder declares the pass in its render graph after the camera's opaque pass, and
//! switches it on only in frames with lines. A frame without lines records no pass, uploads nothing
//! and allocates nothing. A frame with lines moves each point relative to the camera in 64-bit
//! floats, as the grid cells do for objects (see [`null3d_core::cells`]), and uploads it as three
//! 32-bit floats and its four color bytes. The pass then draws every line in one call, inside the
//! render pass of the camera's opaque objects, with the frame uniform of the camera's view. The
//! first frame with lines creates the pipeline, through the builder's pipeline cache, and the
//! vertex buffer, and a frame with more lines than the buffer holds makes the buffer again, larger.

use std::collections::TryReserveError;

use null3d_core::cells::CellPosition;
use null3d_gpu::drawlist::sizes::LINE_VERTEX_BYTES;
use null3d_gpu::drawlist::{DrawList, Op, buffer_usage, permutation, state_flags, template};

use crate::frame::{RecordError, UploadArena, grown_size};
use crate::pipelines::{DrawKey, PassTargets, PipelineCache};

/// Points that one frame draws as lines, two points per line: each point's position in world
/// space, three 64-bit floats, and its sRGB color, four bytes with red in the lowest and alpha in
/// the highest.
#[derive(Clone, Copy, Debug, Default)]
pub struct DebugLines<'a> {
    positions: &'a [f64],
    colors: &'a [u32],
}

impl<'a> DebugLines<'a> {
    /// No lines, as in every frame of a release build.
    pub const NONE: DebugLines<'static> = DebugLines {
        positions: &[],
        colors: &[],
    };

    /// The lines of the points whose colors `colors` holds, with three floats per point in
    /// `positions`. A last point without a partner draws nothing.
    pub fn new(positions: &'a [f64], colors: &'a [u32]) -> Self {
        assert_eq!(
            positions.len(),
            colors.len() * 3,
            "each point has three floats"
        );
        Self { positions, colors }
    }

    /// The points that draw: both points of every line.
    pub fn points(&self) -> usize {
        self.colors.len() & !1
    }

    /// True when the frame draws no line.
    pub fn is_empty(&self) -> bool {
        self.points() < 2
    }

    /// Writes each point that draws as a vertex of the vertex buffer: its position relative to
    /// `camera`, the camera's position in world space, rounded once to 32-bit floats, then its
    /// color.
    fn write_vertices(&self, camera: [f64; 3], out: &mut [u8]) {
        let (vertices, _) = out.as_chunks_mut::<{ LINE_VERTEX_BYTES as usize }>();
        for (point, vertex) in vertices.iter_mut().take(self.points()).enumerate() {
            let position = &self.positions[point * 3..point * 3 + 3];
            for axis in 0..3 {
                let relative = (position[axis] - camera[axis]) as f32;
                vertex[axis * 4..axis * 4 + 4].copy_from_slice(&relative.to_ne_bytes());
            }
            vertex[12..16].copy_from_slice(&self.colors[point].to_ne_bytes());
        }
    }
}

/// A sketch's points for the next frame, in engine memory, where TypeScript writes them. The arrays
/// have room for [`LineStore::capacity`] points and grow only when TypeScript asks for more.
#[derive(Debug, Default)]
pub struct LineStore {
    positions: Vec<f64>,
    colors: Vec<u32>,
    /// The points that the next frame draws.
    points: u32,
}

impl LineStore {
    /// Makes room for `points` points, keeping those written, or fails when memory cannot grow.
    /// The arrays move when they grow, so TypeScript reads their addresses again.
    pub fn reserve(&mut self, points: u32) -> Result<(), TryReserveError> {
        let points = points as usize;
        if points <= self.colors.len() {
            return Ok(());
        }
        self.positions
            .try_reserve_exact(points * 3 - self.positions.len())?;
        self.colors.try_reserve_exact(points - self.colors.len())?;
        self.positions.resize(points * 3, 0.0);
        self.colors.resize(points, 0);
        Ok(())
    }

    /// The points the arrays have room for.
    pub fn capacity(&self) -> u32 {
        self.colors.len() as u32
    }

    /// Each point's position: three floats per point.
    pub fn positions(&self) -> &[f64] {
        &self.positions
    }

    /// Each point's color.
    pub fn colors(&self) -> &[u32] {
        &self.colors
    }

    /// Writes points from the first on, each a position and a color, making room for them, and
    /// has the next frame draw them. TypeScript writes into the arrays itself; this serves Rust.
    pub fn draw(&mut self, points: &[([f64; 3], u32)]) -> Result<(), TryReserveError> {
        self.reserve(points.len() as u32)?;
        for (k, (position, color)) in points.iter().enumerate() {
            self.positions[k * 3..k * 3 + 3].copy_from_slice(position);
            self.colors[k] = *color;
        }
        self.points = points.len() as u32;
        Ok(())
    }

    /// Sets how many of the written points the next frame draws. Returns false, and draws none,
    /// when the arrays hold fewer.
    pub fn set_points(&mut self, points: u32) -> bool {
        let fits = points <= self.capacity();
        self.points = if fits { points } else { 0 };
        fits
    }

    /// The lines that the next frame draws.
    pub fn lines(&self) -> DebugLines<'_> {
        let points = self.points as usize;
        DebugLines::new(&self.positions[..points * 3], &self.colors[..points])
    }

    /// Forgets the points, once the frame that draws them has recorded.
    pub fn clear(&mut self) {
        self.points = 0;
    }
}

/// What the lines ask of their pipeline: the lines' template, which reads a vertex buffer of its own
/// layout rather than a mesh's vertex format, drawing lines instead of triangles.
const LINES_DRAW: DrawKey = DrawKey {
    template: template::DEBUG_LINES,
    permutation: 0,
    vertex_format: 0,
    state: state_flags::LINE_LIST,
};

/// The pass's vertex buffer and pipeline, and the points of the frame being recorded.
#[derive(Debug)]
pub(crate) struct LinesPass {
    /// The id of the vertex buffer, from the range of the frame builder that records the pass.
    buffer: u32,
    /// Bytes of the vertex buffer, 0 before it exists.
    buffer_bytes: u32,
    /// The id of the pipeline, from the builder's pipeline cache, once a frame had lines.
    pipeline: u32,
    /// The points that the frame being recorded draws.
    points: u32,
}

impl LinesPass {
    /// The pass of a builder that keeps the lines' vertices in buffer `buffer`.
    pub(crate) fn new(buffer: u32) -> Self {
        Self {
            buffer,
            buffer_bytes: 0,
            pipeline: 0,
            points: 0,
        }
    }

    /// The bytes that a frame with `lines` copies into its arena for them.
    pub(crate) fn upload_bytes(lines: &DebugLines<'_>) -> usize {
        lines.points() * LINE_VERTEX_BYTES as usize
    }

    /// Asks `pipelines` for the pipeline of a frame with `lines`, which draws into the scene's
    /// `targets`. A builder asks before it records the pipelines that its frame creates, so the
    /// list creates this one with the others, at its start. Without lines, it asks for nothing.
    pub(crate) fn request_pipeline(
        &mut self,
        lines: &DebugLines<'_>,
        pipelines: &mut PipelineCache,
        targets: PassTargets,
    ) {
        if lines.is_empty() {
            return;
        }
        // The lines' shader reads no draw index. It tone maps on the 8-bit path, as scene shaders do.
        let targets = PassTargets {
            permutation: targets.permutation & permutation::TONE_MAP,
            ..targets
        };
        self.pipeline = pipelines.id(LINES_DRAW.in_pass(targets));
    }

    /// Uploads the frame's lines relative to the camera, whose position `camera` gives, into a
    /// vertex buffer large enough for them. They draw with the pipeline that `request_pipeline`
    /// asked for. Without lines or without a camera, it records nothing, and the pass draws
    /// nothing.
    pub(crate) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        lines: &DebugLines<'_>,
        camera: Option<&CellPosition>,
    ) -> Result<(), RecordError> {
        self.points = 0;
        let Some(camera) = camera.filter(|_| !lines.is_empty()) else {
            return Ok(());
        };
        let bytes = Self::upload_bytes(lines) as u32;
        if bytes > self.buffer_bytes {
            self.buffer_bytes = grown_size(bytes, u32::MAX);
            list.push(
                Op::CreateBuffer,
                &[
                    self.buffer,
                    self.buffer_bytes,
                    buffer_usage::VERTEX | buffer_usage::COPY_DST,
                ],
            )?;
        }
        let (at, vertices) = arena.push_zeroed(bytes as usize)?;
        lines.write_vertices(camera.absolute(), vertices);
        list.push(Op::WriteBuffer, &[self.buffer, 0, at, bytes])?;
        self.points = lines.points() as u32;
        Ok(())
    }

    /// Records the pass inside the render pass that the render graph began: every line in one
    /// draw, with the camera view's frame group `frame_group` bound at the dynamic offsets
    /// `offsets` as the view's opaque pass binds it. It records nothing when the frame uploaded no
    /// lines.
    pub(crate) fn record(
        &self,
        list: &mut DrawList,
        frame_group: u32,
        offsets: &[u32],
    ) -> Result<(), RecordError> {
        if self.points == 0 {
            return Ok(());
        }
        let mut bind = [0; 5];
        let words = 3 + offsets.len();
        bind[1] = frame_group;
        bind[2] = offsets.len() as u32;
        bind[3..words].copy_from_slice(offsets);
        list.push(Op::SetPipeline, &[self.pipeline])?;
        list.push(Op::SetBindGroup, &bind[..words])?;
        list.push(
            Op::SetVertexBuffer,
            &[0, self.buffer, 0, self.points * LINE_VERTEX_BYTES],
        )?;
        list.push(Op::Draw, &[self.points, 1, 0, 0])?;
        Ok(())
    }

    /// Forgets the vertex buffer, after the thread that draws replaced the GPU, so the next frame
    /// with lines makes it again. The pipeline cache makes the pipeline again itself.
    pub(crate) fn forget_gpu(&mut self) {
        self.buffer_bytes = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use null3d_core::cells::split;

    /// The positions and colors of the vertices that `lines` writes for a camera at `camera`.
    fn vertices(lines: &DebugLines<'_>, camera: [f64; 3]) -> Vec<([f32; 3], u32)> {
        let mut out = vec![0; lines.points() * LINE_VERTEX_BYTES as usize];
        lines.write_vertices(camera, &mut out);
        out.as_chunks::<{ LINE_VERTEX_BYTES as usize }>()
            .0
            .iter()
            .map(|v| {
                let word = |k: usize| u32::from_ne_bytes(v[k * 4..k * 4 + 4].try_into().unwrap());
                ([0, 1, 2].map(|k| f32::from_bits(word(k))), word(3))
            })
            .collect()
    }

    #[test]
    fn points_are_written_relative_to_the_camera_with_their_colors() {
        let positions = [1.0, 2.0, 3.0, -4.0, 0.5, 8.0, 9.0, 9.0, 9.0];
        let colors = [0xff00_00ff, 0xff00_ff00, 0xffff_0000];
        let lines = DebugLines::new(&positions, &colors);
        // The last point has no partner, so it draws nothing.
        assert_eq!(lines.points(), 2);
        assert_eq!(
            vertices(&lines, [1.0, 1.0, 1.0]),
            [
                ([0.0, 1.0, 2.0], 0xff00_00ff),
                ([-5.0, -0.5, 7.0], 0xff00_ff00)
            ]
        );
        assert!(DebugLines::new(&positions[..3], &colors[..1]).is_empty());
        assert!(DebugLines::NONE.is_empty());
    }

    #[test]
    fn lines_far_from_the_origin_keep_their_places_near_the_camera() {
        // A camera 100 km out, as its cell and its place in the cell give it, and a line 12.5 mm
        // in front of it. In 32-bit floats from the origin, positions there move in steps of
        // about 8 mm.
        let (cell, local) = split([100_000.3, 1.7, -2.9]);
        let camera = CellPosition { cell, local }.absolute();
        let from = [camera[0] + 0.0125, camera[1] - 0.004, camera[2] - 0.1];
        let to = [camera[0] - 0.02, camera[1] + 0.001, camera[2] - 0.1];
        let positions = [from, to].concat();
        let written = vertices(&DebugLines::new(&positions, &[1, 2]), camera);
        for (point, (vertex, _)) in [from, to].iter().zip(&written) {
            for k in 0..3 {
                assert_eq!(vertex[k], (point[k] - camera[k]) as f32);
            }
        }
        let near = written[0].0;
        assert!((near[0] - 0.0125).abs() < 1e-6, "{near:?}");
        assert!((near[1] + 0.004).abs() < 1e-6, "{near:?}");
    }

    #[test]
    fn the_store_grows_keeping_its_points_and_draws_only_what_it_holds() {
        let mut store = LineStore::default();
        assert!(store.lines().is_empty());
        store.reserve(2).unwrap();
        store
            .positions
            .copy_from_slice(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        store.colors.copy_from_slice(&[7, 8]);
        store.reserve(64).unwrap();
        assert_eq!(store.capacity(), 64);
        assert_eq!(&store.positions()[..6], [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        assert_eq!(&store.colors()[..2], [7, 8]);
        assert!(store.set_points(2));
        assert_eq!(store.lines().points(), 2);
        store.clear();
        assert!(store.lines().is_empty());
        assert!(!store.set_points(65));
        assert!(store.lines().is_empty());
    }
}
