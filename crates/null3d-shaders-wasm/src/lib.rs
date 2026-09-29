//! The shader build as a WebAssembly module for build tools, such as the Vite plugin. It runs in
//! Node and Bun while a project builds, so no shader translator enters a page's download.
//!
//! The module imports nothing. It exports its memory and these functions, which take and give
//! JSON:
//!
//! - `request(length)` makes room for a request of `length` bytes and returns where it starts.
//! - `compile()` compiles the shader in the request, a [`ShaderSource`], with the engine's shader
//!   library, which the module holds. The output holds each variant by name.
//! - `build()` builds a whole manifest, as the native `shader-build` command does. The request is
//!   the manifest and every file, the library modules too, as [`Inputs`], and the output is an
//!   [`Output`](null3d_shaders::Output).
//! - `response()` and `response_length()` give the last call's response:
//!   `{"ok": true, "output": ...}` or `{"ok": false, "problems": [...]}`.
//!
//! A panic stops a call with a trap. The panic hook first writes a response that describes the
//! panic. The caller then drops the instance, whose memory may be in any state after a trap.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::sync::Once;

use null3d_shaders::{BuildError, Compiler, Inputs, Problem, Response, ShaderSource};
use serde::Serialize;
use serde::de::DeserializeOwned;

/// The engine's shader library: each module's path in the shader folder, and its text.
const LIBRARY: &[(&str, &str)] = include!(concat!(env!("OUT_DIR"), "/library.rs"));

thread_local! {
    static REQUEST: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static RESPONSE: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    /// The compiler for `compile`, made on the first call. It keeps the library modules it
    /// composed, so later calls are faster.
    static COMPILER: RefCell<Option<Compiler>> = const { RefCell::new(None) };
}

/// Makes the request buffer `length` bytes long and returns where it starts.
#[unsafe(no_mangle)]
pub extern "C" fn request(length: usize) -> *mut u8 {
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
        COMPILER.with_borrow_mut(|slot| {
            let mut compiler = match slot.take() {
                Some(compiler) => compiler,
                None => Compiler::new(&library())?,
            };
            let result = compiler.compile(&shader);
            *slot = Some(compiler);
            result
        })
    });
}

/// Builds the manifest in the request.
#[unsafe(no_mangle)]
pub extern "C" fn build() {
    respond(|request| null3d_shaders::build(&parse::<Inputs>(request)?));
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

/// The library modules, by path in the shader folder.
fn library() -> BTreeMap<String, String> {
    LIBRARY
        .iter()
        .map(|&(path, source)| (path.to_owned(), source.to_owned()))
        .collect()
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
    install_panic_hook();
    RESPONSE.with_borrow_mut(Vec::clear);
    let result = REQUEST.with_borrow(|request| call(request));
    RESPONSE.set(to_json(&result));
}

fn to_json<T: Serialize>(result: &Result<T, BuildError>) -> Vec<u8> {
    serde_json::to_vec(&Response::from(result)).unwrap_or_default()
}

/// Makes a panic write a response that describes it.
fn install_panic_hook() {
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
    });
}
