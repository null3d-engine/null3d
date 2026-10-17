//! The shader build as a WebAssembly module for build tools, such as the Vite plugin. It runs in
//! Node and Bun while a project builds, so no shader translator enters a page's download.
//!
//! The module imports nothing. It exports its memory and these functions, which take and give
//! JSON:
//!
//! - `request(length)` makes room for a request of `length` bytes and returns where it starts.
//! - `compile()` compiles the shader in the request, a [`ShaderSource`], with the engine's shader
//!   library, which the module holds. The output holds each variant by name.
//! - `compile_material()` builds a custom material's WGSL, a [`MaterialSource`], into every
//!   variant of the engine's template for custom materials, which the module holds with the
//!   shader manifest. The output is a [`MaterialOutput`](null3d_shaders::MaterialOutput).
//! - `compile_effect()` builds a custom effect's or a custom tone curve's WGSL, an
//!   [`EffectSource`], into every variant of the engine's effect template or of its final pass.
//!   The output is an [`EffectOutput`](null3d_shaders::EffectOutput).
//! - `build()` builds a whole manifest, as the native `shader-build` command does. The request is
//!   the manifest and every file, the library modules too, as [`Inputs`], and the output is an
//!   [`Output`](null3d_shaders::Output). It writes the first piece of that answer.
//! - `build_next()` writes the piece after it. The caller runs it until `response_length()` comes
//!   back zero, which says the answer is complete.
//! - `response()` and `response_length()` give the last call's response, which is one piece of a
//!   manifest build's answer: `{"ok": true, "output": ...}` or `{"ok": false, "problems": [...]}`.
//!   A response of `compile`, `compile_material` or `compile_effect` also holds `"warnings": [...]`
//!   when the shader calls a built-in function that a target browser cannot compile.
//! - `stopped()` and `stopped_length()` give the module's account of a call it stopped for want of
//!   memory, or an empty text when the last call was given everything it asked for. The caller
//!   reads this instead of its own response when a call stops.
//!
//! A panic stops a call with a trap. The panic hook first writes a response that describes the
//! panic. The caller then drops the instance, whose memory may be in any state after a trap.
//!
//! A memory request the module cannot be given stops a call the same way, and a panic hook never
//! sees it. Without `stopped()`, which serves the module's own account of such a stop, the caller
//! reads only that the module stopped, and a failure that no shader caused looks like a bug in the
//! build tools.
//!
//! A manifest build answers in pieces of a few megabytes, each of them one build's result, into a
//! buffer the module reuses. So the module holds the builds it writes from and no copy of the
//! answer, whatever the answer's size. That matters because the answer is not small: the engine's
//! `standard_maps` entry alone holds 11,456 builds and answers with hundreds of MB, a 32-bit module
//! holds 4 GB at most, and the engine keeps growing. An earlier version held the whole answer in
//! one buffer, whose reallocation asked for more than the module had left, and the module stopped
//! on a failed memory request. The calls that answer with a few megabytes, `compile` and its
//! neighbours, keep one buffer and need no pieces.

#![feature(alloc_error_hook)]

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::sync::Once;

use null3d_shaders::{
    BuildError, Compiler, EffectSource, Inputs, MaterialSource, MaterialTemplate, Output,
    PostTemplates, Problem, Response, ShaderSource, VariantOutput,
};
use serde::Serialize;
use serde::de::DeserializeOwned;

/// The engine's shader files, each by its path in the shader folder with its text: the entry
/// shaders, and the library modules in `lib/`.
const FILES: &[(&str, &str)] = include!(concat!(env!("OUT_DIR"), "/shaders.rs"));

/// The engine's shader manifest, which marks the template of custom materials.
const MANIFEST: &str = include_str!("../../null3d-shaders/shaders.toml");

thread_local! {
    static REQUEST: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static RESPONSE: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    /// The compiler for `compile` and `compile_material`, made on the first call. It keeps the
    /// library modules it composed, so later calls are faster.
    static COMPILER: RefCell<Option<Compiler>> = const { RefCell::new(None) };
    /// The warnings of the call in progress.
    static WARNINGS: RefCell<Vec<Problem>> = const { RefCell::new(Vec::new()) };
    /// The template of custom materials, read on the first call of `compile_material`.
    static TEMPLATE: RefCell<Option<MaterialTemplate>> = const { RefCell::new(None) };
    /// The templates of custom effects and tone curves, read on the first call of
    /// `compile_effect`.
    static POST_TEMPLATES: RefCell<Option<PostTemplates>> = const { RefCell::new(None) };
    /// The answer of the last `build`, which `build_next` hands over a piece at a time.
    static STREAM: RefCell<Option<Answer>> = const { RefCell::new(None) };
    /// The module's account of a stop for want of memory, which `stopped` serves. It is written
    /// where it already has room, because the allocator cannot give it any.
    static STOPPED: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// The room a stop notice needs, which every call takes before it starts work, so that the notice
/// can be written without a request the allocator would refuse.
const NOTICE_ROOM: usize = 512;

/// Makes the request buffer `length` bytes long and returns where it starts. The hooks are made
/// here too, because this is the first call a caller makes: a size the module cannot be given stops
/// it here, and the notice room is what records that.
#[unsafe(no_mangle)]
pub extern "C" fn request(length: usize) -> *mut u8 {
    install_hooks();
    take_notice_room();
    REQUEST.with_borrow_mut(|request| {
        request.clear();
        request.resize(length, 0);
        request.as_mut_ptr()
    })
}

/// Compiles the shader in the request with the engine's shader library.
#[unsafe(no_mangle)]
pub extern "C" fn compile() {
    respond(|request| {
        let shader: ShaderSource = parse(request)?;
        with_compiler(|compiler| compiler.compile(&shader))
    });
}

/// Builds the custom material in the request into the engine's template for custom materials.
#[unsafe(no_mangle)]
pub extern "C" fn compile_material() {
    respond(|request| {
        let material: MaterialSource = parse(request)?;
        TEMPLATE.with_borrow_mut(|slot| {
            let template = match slot.take() {
                Some(template) => template,
                None => MaterialTemplate::load(&inputs())?,
            };
            let result = with_compiler(|compiler| compiler.compile_material(&template, &material));
            *slot = Some(template);
            result
        })
    });
}

/// Builds the custom effect or tone curve in the request into the engine's effect template or
/// final pass.
#[unsafe(no_mangle)]
pub extern "C" fn compile_effect() {
    respond(|request| {
        let effect: EffectSource = parse(request)?;
        POST_TEMPLATES.with_borrow_mut(|slot| {
            let templates = match slot.take() {
                Some(templates) => templates,
                None => PostTemplates::load(&inputs())?,
            };
            let result = with_compiler(|compiler| compiler.compile_effect(&templates, &effect));
            *slot = Some(templates);
            result
        })
    });
}

/// Runs `call` with the compiler, which the first call makes and later calls reuse.
fn with_compiler<T>(
    call: impl FnOnce(&mut Compiler) -> Result<T, BuildError>,
) -> Result<T, BuildError> {
    COMPILER.with_borrow_mut(|slot| {
        let mut compiler = match slot.take() {
            Some(compiler) => compiler,
            None => Compiler::new(&inputs().files)?,
        };
        let result = call(&mut compiler);
        WARNINGS.set(compiler.take_warnings());
        *slot = Some(compiler);
        result
    })
}

/// How much of a manifest build's answer `build` and `build_next` hand over at a time. The buffer
/// is reused and every piece is one build's result, so the module holds a few megabytes of the
/// answer at most, whatever the answer's size.
const ANSWER_CHUNK: usize = 1 << 22;

/// Builds the manifest in the request and writes the first piece of its answer. The rest comes
/// from `build_next`, which the caller runs until the response comes back empty. The module holds
/// the builds it writes from and no copy of the answer: the engine's largest entry answers with
/// more text than a 32-bit module may hold beside those builds, and the answer grows with the
/// engine.
#[unsafe(no_mangle)]
pub extern "C" fn build() {
    install_hooks();
    take_notice_room();
    WARNINGS.with_borrow_mut(Vec::clear);
    STREAM.with_borrow_mut(|stream| *stream = None);
    let result = REQUEST.with_borrow(|request| null3d_shaders::build(&parse::<Inputs>(request)?));
    match result {
        Ok(output) => {
            let mut answer = Answer::new(output);
            RESPONSE.with_borrow_mut(|response| {
                response.clear();
                if answer.fill(response, ANSWER_CHUNK) {
                    STREAM.set(Some(answer));
                }
            });
        }
        Err(error) => {
            let failed: Result<Output, BuildError> = Err(error);
            RESPONSE.set(to_json(&failed));
        }
    }
}

/// Writes the next piece of the answer of the last `build`. The response comes back empty once the
/// answer is complete, and that is how the caller knows to stop.
#[unsafe(no_mangle)]
pub extern "C" fn build_next() {
    install_hooks();
    take_notice_room();
    RESPONSE.with_borrow_mut(|response| {
        response.clear();
        STREAM.with_borrow_mut(|slot| {
            if let Some(answer) = slot.as_mut()
                && !answer.fill(response, ANSWER_CHUNK)
            {
                *slot = None;
            }
        });
    });
}

/// A manifest build's answer, handed over in pieces. It writes one build's result per piece, so
/// the module never holds the answer it is writing, and each entry's builds leave as they are
/// written.
struct Answer {
    /// The entries still to write, in name order.
    entries: std::collections::btree_map::IntoIter<String, BTreeMap<String, VariantOutput>>,
    /// The builds of the entry being written, in name order.
    builds: Option<std::collections::btree_map::IntoIter<String, VariantOutput>>,
    /// True once an entry is written, so the next one takes a comma.
    wrote_entry: bool,
    /// True once a build of the entry being written is written.
    wrote_build: bool,
    /// The pipelines, written once every entry is written.
    pipelines: BTreeMap<String, Vec<String>>,
    /// The piece of the answer that comes next.
    stage: Stage,
    /// The piece being handed over and how much of it is left.
    piece: Vec<u8>,
    at: usize,
}

/// The part of the answer that the next piece writes.
#[derive(PartialEq)]
enum Stage {
    /// The opening of the response.
    Open,
    /// The builds of the entry being written, then the entry after it.
    Builds,
    /// The closing brace of the entry just written.
    EntryEnd,
    /// The pipelines.
    Pipelines,
    /// The closing of the response.
    Close,
    /// The answer is complete.
    Done,
}

impl Answer {
    /// The answer of `output`, which holds the builds every piece is written from.
    fn new(output: Output) -> Self {
        Self {
            entries: output.shaders.into_iter(),
            builds: None,
            wrote_entry: false,
            wrote_build: false,
            pipelines: output.pipelines,
            stage: Stage::Open,
            piece: Vec::new(),
            at: 0,
        }
    }

    /// Fills `out` with at most `limit` bytes of the answer, and answers whether more is left.
    fn fill(&mut self, out: &mut Vec<u8>, limit: usize) -> bool {
        while out.len() < limit {
            if self.at < self.piece.len() {
                let take = (limit - out.len()).min(self.piece.len() - self.at);
                out.extend_from_slice(&self.piece[self.at..self.at + take]);
                self.at += take;
            } else if let Some(piece) = self.next_piece() {
                self.piece = piece;
                self.at = 0;
            } else {
                return false;
            }
        }
        true
    }

    /// The next piece of the answer, which is one build's result at most, or None once the answer
    /// is complete.
    fn next_piece(&mut self) -> Option<Vec<u8>> {
        loop {
            match self.stage {
                Stage::Open => {
                    self.stage = Stage::Builds;
                    return Some(b"{\"ok\":true,\"output\":{\"shaders\":{".to_vec());
                }
                Stage::Builds => {
                    if let Some((name, built)) = self.builds.as_mut().and_then(Iterator::next) {
                        let mut piece = Vec::new();
                        if self.wrote_build {
                            piece.push(b',');
                        }
                        self.wrote_build = true;
                        let _ = serde_json::to_writer(&mut piece, &name);
                        piece.push(b':');
                        let _ = serde_json::to_writer(&mut piece, &built);
                        return Some(piece);
                    }
                    if self.builds.is_some() {
                        self.builds = None;
                        self.stage = Stage::EntryEnd;
                        continue;
                    }
                    if let Some((name, builds)) = self.entries.next() {
                        let mut piece = Vec::new();
                        if self.wrote_entry {
                            piece.push(b',');
                        }
                        self.wrote_entry = true;
                        self.wrote_build = false;
                        let _ = serde_json::to_writer(&mut piece, &name);
                        piece.push(b':');
                        piece.push(b'{');
                        self.builds = Some(builds.into_iter());
                        return Some(piece);
                    }
                    self.stage = Stage::Pipelines;
                }
                Stage::EntryEnd => {
                    self.stage = Stage::Builds;
                    return Some(b"}".to_vec());
                }
                Stage::Pipelines => {
                    self.stage = Stage::Close;
                    let mut piece = b"},\"pipelines\":".to_vec();
                    let _ = serde_json::to_writer(&mut piece, &self.pipelines);
                    return Some(piece);
                }
                Stage::Close => {
                    self.stage = Stage::Done;
                    return Some(b"}}".to_vec());
                }
                Stage::Done => return None,
            }
        }
    }
}

/// Where the last response starts.
#[unsafe(no_mangle)]
pub extern "C" fn response() -> *const u8 {
    RESPONSE.with_borrow(|response| response.as_ptr())
}

/// The length of the last response in bytes.
#[unsafe(no_mangle)]
pub extern "C" fn response_length() -> usize {
    RESPONSE.with_borrow(Vec::len)
}

/// Where the module's account of a stop for want of memory starts, or empty when the last call was
/// given everything it asked for.
#[unsafe(no_mangle)]
pub extern "C" fn stopped() -> *const u8 {
    STOPPED.with_borrow(|stopped| stopped.as_ptr())
}

/// The length of that account in bytes.
#[unsafe(no_mangle)]
pub extern "C" fn stopped_length() -> usize {
    STOPPED.with_borrow(Vec::len)
}

/// The engine's shader manifest and shader files, with plain line ends.
fn inputs() -> Inputs {
    let files: BTreeMap<String, String> = FILES
        .iter()
        .map(|&(path, source)| (path.to_owned(), source.replace("\r\n", "\n")))
        .collect();
    Inputs {
        manifest: MANIFEST.replace("\r\n", "\n"),
        files,
    }
}

/// Reads a JSON request.
fn parse<T: DeserializeOwned>(request: &[u8]) -> Result<T, BuildError> {
    serde_json::from_slice(request).map_err(|e| {
        Problem::general(format!("the shader compiler's request is not valid: {e}.")).into()
    })
}

/// Runs a call on the request and stores its response. The response is emptied first, so a call
/// that stops before the panic hook runs, such as one that runs out of memory, leaves none.
fn respond<T: Serialize>(call: impl FnOnce(&[u8]) -> Result<T, BuildError>) {
    install_hooks();
    take_notice_room();
    let mut response = Grown(Vec::new());
    RESPONSE.with_borrow_mut(Vec::clear);
    WARNINGS.with_borrow_mut(Vec::clear);
    let result = REQUEST.with_borrow(|request| call(request));
    WARNINGS.with_borrow(|warnings| {
        let response_of = Response::from(&result).with_warnings(warnings);
        let _ = serde_json::to_writer(&mut response, &response_of);
    });
    RESPONSE.set(response.0);
}

/// The buffer a call's response is written into. It grows by half again each time it fills, which
/// keeps the copies to a few, and it never asks for an allocation larger than the 2 GB that one
/// allocation may take in a 32-bit module: a `Vec` grows by doubling, whose step from 1 GB asks
/// for 2 GB. A manifest build's answer, which is far larger than the others, does not go through
/// this buffer at all; it is handed over by [`build_next`] instead.
struct Grown(Vec<u8>);

impl std::io::Write for Grown {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let needed = self.0.len() + bytes.len();
        if needed > self.0.capacity() {
            let grown = self.0.capacity() + self.0.capacity() / 2;
            self.0.reserve_exact(grown.max(needed) - self.0.len());
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn to_json<T: Serialize>(result: &Result<T, BuildError>) -> Vec<u8> {
    serde_json::to_vec(&Response::from(result)).unwrap_or_default()
}

/// Makes a panic write a response that describes it, and records a memory request the module cannot
/// be given. The record is what a caller reads when a call stops, since a failed request aborts the
/// module and never reaches the panic hook.
fn install_hooks() {
    static INSTALLED: Once = Once::new();
    INSTALLED.call_once(|| {
        std::panic::set_hook(Box::new(|info| {
            let problem = Problem::general(format!(
                "the shader compiler stopped on an internal error, which is a bug in null3D: {info}. Report it with the shader that caused it."
            ));
            let json = to_json::<()>(&Err(problem.into()));
            let _ = RESPONSE.try_with(|response| {
                if let Ok(mut response) = response.try_borrow_mut() {
                    *response = json;
                }
            });
        }));
        std::alloc::set_alloc_error_hook(|layout| record_stop(layout.size()));
    });
}

/// Takes the room a stop notice needs, before the call starts work. The allocator runs this notice
/// writer when it has already refused a request, so the notice must fit where it already is.
fn take_notice_room() {
    STOPPED.with_borrow_mut(|stopped| {
        stopped.clear();
        let _ = stopped.try_reserve(NOTICE_ROOM);
    });
}

/// Writes the account of a memory request of `size` bytes that the module could not be given. It
/// gives up when `STOPPED` is already borrowed, or when the room it took is gone, rather than risk
/// a second failed request while the first is being reported.
fn record_stop(size: usize) {
    const HEAD: &[u8] = b"{\"ok\":false,\"problems\":[{\"file\":null,\"line\":null,\"column\":null,\"feature\":null,\"message\":\"the shader compiler's module ran out of memory: it could not be given ";
    const TAIL: &[u8] = b" bytes, and a 32-bit WebAssembly module may hold 4 GB at most. No shader is wrong, and the module needs more room than it has. Report it at https://github.com/null3d-engine/null3d/issues.\",\"variants\":[]}]}";
    let _ = STOPPED.try_with(|stopped| {
        let Ok(mut stopped) = stopped.try_borrow_mut() else {
            return;
        };
        if stopped.capacity() < HEAD.len() + TAIL.len() + 20 {
            return;
        }
        stopped.clear();
        stopped.extend_from_slice(HEAD);
        let mut digits = [0u8; 20];
        let mut at = digits.len();
        let mut left = size;
        loop {
            at -= 1;
            digits[at] = b'0' + (left % 10) as u8;
            left /= 10;
            if left == 0 {
                break;
            }
        }
        stopped.extend_from_slice(&digits[at..]);
        stopped.extend_from_slice(TAIL);
    });
}
