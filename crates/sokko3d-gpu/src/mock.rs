//! A backend for tests: it replays draw lists against simple resource tables and reports the first
//! command a real GPU would reject.

use crate::caps::OFFSET_ALIGNMENT;
use crate::drawlist::{Command, NO_TARGET, Op, decode};
use std::collections::{HashMap, HashSet};

#[derive(Debug, PartialEq, Eq)]
pub enum MockError {
    Decode(String),
    Missing { op: Op, what: &'static str, id: u32 },
    OutOfRange { op: Op, id: u32 },
    Unaligned { op: Op, offset: u32 },
    Outside { op: Op, needs: &'static str },
    NotReady { op: Op, what: &'static str },
}

#[derive(Default)]
pub struct MockBackend {
    buffers: HashMap<u32, u32>,
    textures: HashSet<u32>,
    render_pipelines: HashSet<u32>,
    compute_pipelines: HashSet<u32>,
    bind_groups: HashSet<u32>,
    bundles: HashSet<u32>,
    in_render_pass: bool,
    in_compute_pass: bool,
    recording_bundle: Option<u32>,
    pipeline_set: bool,
    vertex_buffer_set: bool,
    index_buffer_set: bool,
    pub draws: u32,
    pub dispatches: u32,
    pub submits: u32,
}

impl MockBackend {
    pub fn replay(&mut self, words: &[u32]) -> Result<(), MockError> {
        for command in decode(words) {
            let command = command.map_err(|e| MockError::Decode(format!("{e:?}")))?;
            self.execute(command)?;
        }
        Ok(())
    }

    fn require(set: bool, op: Op, what: &'static str, id: u32) -> Result<(), MockError> {
        if set {
            Ok(())
        } else {
            Err(MockError::Missing { op, what, id })
        }
    }

    fn in_draw_scope(&self) -> bool {
        self.in_render_pass || self.recording_bundle.is_some()
    }

    fn execute(&mut self, Command { op, operands: o }: Command<'_>) -> Result<(), MockError> {
        match op {
            Op::CreateBuffer => {
                self.buffers.insert(o[0], o[1]);
            }
            Op::WriteBuffer | Op::ClearBuffer => {
                let size = *self.buffers.get(&o[0]).ok_or(MockError::Missing {
                    op,
                    what: "buffer",
                    id: o[0],
                })?;
                let end = if op == Op::WriteBuffer {
                    o[1] + o[3]
                } else {
                    o[1] + o[2]
                };
                if end > size {
                    return Err(MockError::OutOfRange { op, id: o[0] });
                }
            }
            Op::DestroyBuffer => {
                self.buffers.remove(&o[0]);
            }
            Op::CreateTexture => {
                self.textures.insert(o[0]);
            }
            Op::DestroyTexture => {
                self.textures.remove(&o[0]);
            }
            Op::ResizeCanvas => {
                if self.in_draw_scope() || self.in_compute_pass {
                    return Err(MockError::Outside {
                        op,
                        needs: "no open pass or bundle",
                    });
                }
                if o[0] == 0 || o[1] == 0 {
                    return Err(MockError::OutOfRange { op, id: 0 });
                }
            }
            Op::CreateRenderPipeline => {
                self.render_pipelines.insert(o[0]);
            }
            Op::CreateComputePipeline => {
                self.compute_pipelines.insert(o[0]);
            }
            Op::CreateBindGroup => {
                for entry in o[3..].chunks(5) {
                    if entry[1] == crate::drawlist::resource_kind::BUFFER {
                        Self::require(
                            self.buffers.contains_key(&entry[2]),
                            op,
                            "buffer",
                            entry[2],
                        )?;
                    }
                }
                self.bind_groups.insert(o[0]);
            }
            Op::BeginRenderPass => {
                for target in [o[0], o[1], o[2]] {
                    if target != 0 && target != NO_TARGET {
                        Self::require(self.textures.contains(&target), op, "texture", target)?;
                    }
                }
                self.in_render_pass = true;
                self.pipeline_set = false;
                self.vertex_buffer_set = false;
                self.index_buffer_set = false;
            }
            Op::BeginBundle => {
                self.recording_bundle = Some(o[0]);
                self.pipeline_set = false;
                self.vertex_buffer_set = false;
                self.index_buffer_set = false;
            }
            Op::EndBundle => {
                let id = self.recording_bundle.take().ok_or(MockError::Outside {
                    op,
                    needs: "a bundle",
                })?;
                self.bundles.insert(id);
            }
            Op::SetPipeline => {
                if !self.in_draw_scope() {
                    return Err(MockError::Outside {
                        op,
                        needs: "a render pass or bundle",
                    });
                }
                Self::require(
                    self.render_pipelines.contains(&o[0]),
                    op,
                    "render pipeline",
                    o[0],
                )?;
                self.pipeline_set = true;
            }
            Op::SetBindGroup => {
                Self::require(self.bind_groups.contains(&o[1]), op, "bind group", o[1])?;
                if let Some(&offset) = o[3..3 + o[2] as usize]
                    .iter()
                    .find(|&&offset| offset % OFFSET_ALIGNMENT != 0)
                {
                    return Err(MockError::Unaligned { op, offset });
                }
            }
            Op::SetVertexBuffer => {
                Self::require(self.buffers.contains_key(&o[1]), op, "buffer", o[1])?;
                self.vertex_buffer_set = true;
            }
            Op::SetIndexBuffer => {
                Self::require(self.buffers.contains_key(&o[0]), op, "buffer", o[0])?;
                self.index_buffer_set = true;
            }
            Op::Draw | Op::DrawIndexed | Op::DrawIndexedIndirect => {
                if !self.in_draw_scope() {
                    return Err(MockError::Outside {
                        op,
                        needs: "a render pass or bundle",
                    });
                }
                if !self.pipeline_set {
                    return Err(MockError::NotReady {
                        op,
                        what: "a pipeline",
                    });
                }
                if !self.vertex_buffer_set {
                    return Err(MockError::NotReady {
                        op,
                        what: "a vertex buffer",
                    });
                }
                if op != Op::Draw && !self.index_buffer_set {
                    return Err(MockError::NotReady {
                        op,
                        what: "an index buffer",
                    });
                }
                if op == Op::DrawIndexedIndirect {
                    Self::require(
                        self.buffers.contains_key(&o[0]),
                        op,
                        "indirect buffer",
                        o[0],
                    )?;
                }
                self.draws += 1;
            }
            Op::ExecuteBundles => {
                if !self.in_render_pass {
                    return Err(MockError::Outside {
                        op,
                        needs: "a render pass",
                    });
                }
                for &id in &o[1..1 + o[0] as usize] {
                    Self::require(self.bundles.contains(&id), op, "bundle", id)?;
                }
            }
            Op::EndRenderPass => {
                if !self.in_render_pass {
                    return Err(MockError::Outside {
                        op,
                        needs: "a render pass",
                    });
                }
                self.in_render_pass = false;
            }
            Op::BeginComputePass => self.in_compute_pass = true,
            Op::SetComputePipeline => {
                Self::require(
                    self.compute_pipelines.contains(&o[0]),
                    op,
                    "compute pipeline",
                    o[0],
                )?;
            }
            Op::Dispatch => {
                if !self.in_compute_pass {
                    return Err(MockError::Outside {
                        op,
                        needs: "a compute pass",
                    });
                }
                self.dispatches += 1;
            }
            Op::EndComputePass => self.in_compute_pass = false,
            Op::CopyBufferToBuffer => {
                Self::require(self.buffers.contains_key(&o[0]), op, "buffer", o[0])?;
                Self::require(self.buffers.contains_key(&o[2]), op, "buffer", o[2])?;
            }
            Op::Submit => self.submits += 1,
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drawlist::{DrawList, buffer_usage, format, index_format, pass_flags};

    fn setup(list: &mut DrawList) {
        list.push(
            Op::CreateBuffer,
            &[1, 4096, buffer_usage::VERTEX | buffer_usage::COPY_DST],
        )
        .unwrap();
        list.push(
            Op::CreateBuffer,
            &[2, 1024, buffer_usage::INDEX | buffer_usage::COPY_DST],
        )
        .unwrap();
        list.push(
            Op::CreateBuffer,
            &[3, 512, buffer_usage::UNIFORM | buffer_usage::COPY_DST],
        )
        .unwrap();
        list.push(
            Op::CreateBuffer,
            &[4, 64, buffer_usage::INDIRECT | buffer_usage::STORAGE],
        )
        .unwrap();
        list.push(
            Op::CreateRenderPipeline,
            &[1, 1, 0, format::CANVAS, format::DEPTH32_FLOAT, 4, 0],
        )
        .unwrap();
        list.push(
            Op::CreateBindGroup,
            &[1, crate::drawlist::layout::FRAME, 1, 0, 0, 3, 0, 256],
        )
        .unwrap();
        list.push(
            Op::CreateTexture,
            &[1, 64, 64, 1, format::DEPTH32_FLOAT, 0x10, 4, 1],
        )
        .unwrap();
    }

    fn draw_bucket(list: &mut DrawList) {
        list.push(Op::SetPipeline, &[1]).unwrap();
        list.push(Op::SetBindGroup, &[0, 1, 1, 256]).unwrap();
        list.push(Op::SetVertexBuffer, &[0, 1, 0, 0]).unwrap();
        list.push(Op::SetIndexBuffer, &[2, index_format::UINT16, 0, 0])
            .unwrap();
        list.push(Op::DrawIndexedIndirect, &[4, 0]).unwrap();
    }

    #[test]
    fn a_valid_frame_with_a_bundle_replays() {
        let mut list = DrawList::with_capacity(256);
        setup(&mut list);
        list.push(Op::WriteBuffer, &[1, 0, 0x1000, 4096]).unwrap();
        list.push(
            Op::BeginBundle,
            &[9, format::CANVAS, format::DEPTH32_FLOAT, 4],
        )
        .unwrap();
        draw_bucket(&mut list);
        list.push(Op::EndBundle, &[]).unwrap();
        let flags = pass_flags::CLEAR_COLOR | pass_flags::CLEAR_DEPTH;
        list.push(
            Op::BeginRenderPass,
            &[0, NO_TARGET, 1, 0, 0, 0, 0x3f80_0000, 0, flags],
        )
        .unwrap();
        list.push(Op::ExecuteBundles, &[1, 9]).unwrap();
        list.push(Op::EndRenderPass, &[]).unwrap();
        list.push(Op::Submit, &[]).unwrap();

        let mut backend = MockBackend::default();
        assert_eq!(backend.replay(list.words()), Ok(()));
        assert_eq!((backend.draws, backend.submits), (1, 1));
    }

    #[test]
    fn the_mock_rejects_what_a_real_gpu_would() {
        let run = |build: &dyn Fn(&mut DrawList)| {
            let mut list = DrawList::with_capacity(256);
            setup(&mut list);
            build(&mut list);
            MockBackend::default().replay(list.words())
        };
        assert!(matches!(
            run(&|l| l.push(Op::WriteBuffer, &[1, 4000, 0, 200]).unwrap()),
            Err(MockError::OutOfRange { .. })
        ));
        assert!(matches!(
            run(&|l| {
                l.push(
                    Op::BeginRenderPass,
                    &[0, NO_TARGET, NO_TARGET, 0, 0, 0, 0, 0, 0],
                )
                .unwrap();
                l.push(Op::DrawIndexed, &[36, 1, 0, 0, 0]).unwrap();
            }),
            Err(MockError::NotReady {
                what: "a pipeline",
                ..
            })
        ));
        assert!(matches!(
            run(&|l| {
                l.push(
                    Op::BeginRenderPass,
                    &[0, NO_TARGET, NO_TARGET, 0, 0, 0, 0, 0, 0],
                )
                .unwrap();
                l.push(Op::SetBindGroup, &[0, 1, 1, 100]).unwrap();
            }),
            Err(MockError::Unaligned { offset: 100, .. })
        ));
        assert!(matches!(
            run(&|l| {
                l.push(
                    Op::BeginRenderPass,
                    &[0, NO_TARGET, NO_TARGET, 0, 0, 0, 0, 0, 0],
                )
                .unwrap();
                l.push(Op::ExecuteBundles, &[1, 42]).unwrap();
            }),
            Err(MockError::Missing {
                what: "bundle",
                id: 42,
                ..
            })
        ));
        assert!(matches!(
            run(&|l| l.push(Op::Dispatch, &[1, 1, 1]).unwrap()),
            Err(MockError::Outside { .. })
        ));
    }
}
