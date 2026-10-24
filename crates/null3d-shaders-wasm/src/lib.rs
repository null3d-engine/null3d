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
//! - `prepare_modules()` builds the engine's manifest and answers with the file name of each module
//!   that its build makes. It keeps the build, and the work that every module shares, for the calls
//!   below.
//! - `module()` renders one of those modules: the request names it, and the answer holds its path
//!   in the folder of the generated modules and its text.
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
    BuildError, Compiler, EffectSource, Inputs, MaterialSource, MaterialTemplate, ModuleSet,
    Output, PostTemplates, Problem, Response, ShaderSource, VariantOutput,
};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

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
    /// The build that `prepare_modules` made, which `module` renders one module at a time.
    static MODULES: RefCell<Option<Prepared>> = const { RefCell::new(None) };
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

/// Builds the engine's manifest and answers with the file name of each module that its build
/// makes. The module keeps the build, and the work that every module shares, for `module`.
#[unsafe(no_mangle)]
pub extern "C" fn prepare_modules() {
    respond(|request| {
        // Drop the previous build before the next one takes its room: the engine's output is most
        // of what a 32-bit module may hold.
        MODULES.with_borrow_mut(|slot| *slot = None);
        // A request may name the entries to build, `{ "entries": [...] }`, so a check that reads a
        // few kinds of module builds a few entries. An empty request, or one without entries,
        // builds every shader.
        let ask = if request.is_empty() {
            PrepareRequest::default()
        } else {
            parse::<PrepareRequest>(request)?
        };
        let inputs = match ask.entries {
            Some(entries) => only_entries(&inputs(), &entries)?,
            None => inputs(),
        };
        let output = null3d_shaders::build(&inputs)?;
        let prepared = Prepared::new(output);
        let names: Vec<String> = prepared.set.names().map(str::to_owned).collect();
        MODULES.with_borrow_mut(|slot| *slot = Some(prepared));
        Ok(names)
    });
}

/// Renders one module of the build that `prepare_modules` made. The request names the module, and
/// the answer holds the file's path in the folder of the generated modules and its text.
#[unsafe(no_mangle)]
pub extern "C" fn module() {
    respond(|request| {
        let asked: ModuleRequest = parse(request)?;
        MODULES.with_borrow(|slot| {
            let prepared = slot.as_ref().ok_or_else(no_prepared_build)?;
            let text = prepared
                .set
                .text(&asked.name)
                .ok_or_else(|| unknown_module(&asked.name))?;
            Ok(ModuleText {
                path: asked.name,
                text,
            })
        })
    });
}

/// A prepared build, with the module set that renders its modules. The set borrows the output, so
/// both live in one value.
struct Prepared {
    /// Declared before the output so that it drops before the output it borrows.
    set: ModuleSet<'static>,
    /// The build, at a heap address that does not move when this value does. The set borrows it,
    /// so the field is held for its ownership alone.
    #[expect(
        dead_code,
        reason = "the set borrows the output; the box keeps it alive"
    )]
    output: Box<Output>,
}

impl Prepared {
    /// Prepares `output`, whose modules the set renders one at a time.
    fn new(output: Output) -> Self {
        let output = Box::new(output);
        // SAFETY: the set borrows the output through a pointer into the box, which keeps the
        // output at that address until it drops. The set is declared first, so it drops first.
        // The output is never reached mutably after this point, and moving this value moves only
        // the box, not the output that the box owns.
        let borrowed: &'static Output = unsafe { &*std::ptr::from_ref(&*output) };
        Self {
            set: ModuleSet::new(borrowed),
            output,
        }
    }
}

/// The request of `module`: the file name of one module that `prepare_modules` listed.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ModuleRequest {
    name: String,
}

/// The answer of `module`: the file's path in the folder of the generated modules, and its text.
#[derive(Serialize)]
struct ModuleText {
    path: String,
    text: String,
}

/// The problem of a `module` call before `prepare_modules`.
fn no_prepared_build() -> BuildError {
    Problem::general(
        "the shader compiler has no prepared module build: call prepare_modules first.",
    )
    .into()
}

/// The problem of a `module` call that names a module the build does not make.
fn unknown_module(name: &str) -> BuildError {
    Problem::general(format!(
        "the shader build makes no module named `{name}`: ask for one of the names that prepare_modules lists."
    ))
    .into()
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
        parts: BTreeMap::new(),
    }
}

/// A request to prepare the build, which may name the entries to build.
#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct PrepareRequest {
    entries: Option<Vec<String>>,
}

/// `inputs` narrowed to the named entries, or the problem that names an entry the manifest lacks.
fn only_entries(inputs: &Inputs, entries: &[String]) -> Result<Inputs, BuildError> {
    let known: Vec<String> = null3d_shaders::entry_costs(inputs)?
        .into_iter()
        .map(|(name, _)| name)
        .collect();
    if let Some(unknown) = entries.iter().find(|name| !known.contains(name)) {
        return Err(Problem::general(format!(
            "the engine's shader manifest has no entry named `{unknown}`: name entries that the manifest lists."
        ))
        .into());
    }
    let names: Vec<&str> = entries.iter().map(String::as_str).collect();
    Ok(null3d_shaders::narrowed(inputs, &names))
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    /// Calls `export` with `body` as its request and answers the JSON response that it wrote.
    fn call(export: extern "C" fn(), body: &[u8]) -> Value {
        let at = request(body.len());
        // SAFETY: `request` made the buffer `body.len()` bytes long and returned where it starts,
        // so this copy fills exactly the room that it made.
        unsafe { std::slice::from_raw_parts_mut(at, body.len()) }.copy_from_slice(body);
        export();
        let text = RESPONSE.with_borrow(|response| String::from_utf8(response.clone()).unwrap());
        serde_json::from_str(&text).expect("the response is JSON")
    }

    /// A request that names one module.
    fn module_request(name: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({ "name": name })).unwrap()
    }

    /// A request that names an entry the manifest lacks answers the problem that names it, and
    /// builds nothing.
    #[test]
    fn prepare_modules_refuses_an_unknown_entry() {
        let answer = call(prepare_modules, &entries_request(&["not_a_shader"]));
        assert_eq!(answer["ok"], false);
        let message = answer["problems"][0]["message"].as_str().unwrap();
        assert!(
            message.contains("no entry named `not_a_shader`"),
            "{message}"
        );
    }

    /// A `module` call before `prepare_modules` answers the problem that says to prepare first.
    #[test]
    fn module_without_a_prepared_build_answers_a_problem() {
        let answer = call(module, &module_request("shaders.ts"));
        assert_eq!(answer["ok"], false);
        let message = answer["problems"][0]["message"].as_str().unwrap();
        assert!(message.contains("call prepare_modules first"), "{message}");
    }

    /// A request that names the entries to build.
    fn entries_request(entries: &[&str]) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({ "entries": entries })).unwrap()
    }

    /// The entries whose builds between them make one module of every kind that a build writes:
    /// the list that the shader crate's determinism check builds (`DETERMINISM_ENTRIES` in its
    /// build tests), which explains how each entry makes its kinds.
    const EVERY_KIND_ENTRIES: &[&str] = &["unlit", "environment", "timer_mark"];

    /// A kind of module, by the name that a failure gives it, and the test that its file names pass.
    type ModuleKind = (&'static str, fn(&str) -> bool);

    /// A call prepares a build of the engine's entries without rendering it, and the next renders
    /// one module, whose text is the set's for that module. The entries are the few that make one
    /// module of every kind, so the test checks each kind without the cost of the whole build.
    #[test]
    fn prepare_modules_lists_every_module_and_module_renders_one() {
        let prepared = call(prepare_modules, &entries_request(EVERY_KIND_ENTRIES));
        assert_eq!(prepared["ok"], true, "{}", prepared["problems"]);
        let names: Vec<String> = serde_json::from_value(prepared["output"].clone()).unwrap();
        MODULES.with_borrow(|slot| {
            let set = &slot.as_ref().expect("the prepared build").set;
            assert_eq!(
                names,
                set.names().map(str::to_owned).collect::<Vec<String>>()
            );
        });
        // The first module of each kind, by the file names that the shader crate's determinism
        // check reads. Every kind must be there, or the list no longer covers it.
        let kinds: [ModuleKind; 6] = [
            ("the main module", |name| name == "shaders.ts"),
            ("the features module", |name| name == "shader-features.ts"),
            ("a device module", |name| {
                name.starts_with("shaders-") && name.ends_with(".js")
            }),
            ("a shared-paragraph table", |name| {
                name.starts_with("shader-paragraphs-") && name.ends_with(".js")
            }),
            ("a whole-shader first-use module", |name| {
                name.starts_with("shaders-")
                    && (name.ends_with("-wgsl.ts") || name.ends_with("-glsl.ts"))
            }),
            ("a combined loader table", |name| {
                name.starts_with("shaders-") && name.contains("-combos") && name.ends_with(".ts")
            }),
        ];
        let mut chosen = Vec::new();
        let mut missing = Vec::new();
        for (kind, holds) in kinds {
            match names.iter().find(|name| holds(name)) {
                Some(name) => chosen.push(name.clone()),
                None => missing.push(kind),
            }
        }
        assert!(
            missing.is_empty(),
            "the build makes no {}",
            missing.join(", no ")
        );
        for name in chosen {
            let expected = MODULES.with_borrow(|slot| {
                slot.as_ref()
                    .expect("the prepared build")
                    .set
                    .text(&name)
                    .expect("the build makes the module")
            });
            let answer = call(module, &module_request(&name));
            assert_eq!(answer["ok"], true, "{}", answer["problems"]);
            assert_eq!(answer["output"]["path"], name);
            assert_eq!(answer["output"]["text"], expected, "`{name}`");
        }
        let answer = call(module, &module_request("not-a-module.ts"));
        assert_eq!(answer["ok"], false);
        let message = answer["problems"][0]["message"].as_str().unwrap();
        assert!(
            message.contains("makes no module named `not-a-module.ts`"),
            "{message}"
        );
    }
}
