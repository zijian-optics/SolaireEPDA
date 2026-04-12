// Prevents extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use reqwest::blocking::Client;
use serde_json::json;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::path::BaseDirectory;
use tauri::tray::TrayIconBuilder;
use tauri::window::Color;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_dialog::DialogExt;

struct AppState {
    /// `0` = 尚未就绪（后台线程仍在 `wait_for_health` / 启动嵌入式 Python）。
    backend_port: AtomicU16,
    sidecar: Mutex<Option<Child>>,
    /// 在 `RunEvent::Ready` 时取走并启动后台健康检查；避免在 `setup` 返回前调度 `run_on_main_thread` 失败。
    pending_backend: Mutex<Option<(Option<PathBuf>, String)>>,
}

#[derive(Clone)]
struct AppLocale(Arc<Mutex<String>>);

fn locale_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("app_locale.txt", BaseDirectory::AppConfig)
        .map_err(|e| e.to_string())
}

fn read_locale_file(app: &tauri::AppHandle) -> String {
    if let Ok(p) = locale_file(app) {
        if let Ok(s) = fs::read_to_string(&p) {
            let t = s.trim();
            if t == "en" {
                return "en".into();
            }
        }
    }
    "zh".into()
}

fn write_locale_file(app: &tauri::AppHandle, lang: &str) -> Result<(), String> {
    let p = locale_file(app)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&p, lang).map_err(|e| e.to_string())
}

fn tray_menu_labels(lang: &str) -> (&'static str, &'static str) {
    match lang {
        "en" => ("Show window", "Quit"),
        _ => ("显示窗口", "退出"),
    }
}

fn use_single_instance_plugin() -> bool {
    !cfg!(debug_assertions)
}

fn hide_main_window_on_close() -> bool {
    !cfg!(debug_assertions)
}

fn health_timeout_msg(port: u16, lang: &str) -> String {
    match lang {
        "en" => format!(
            "Local service did not become ready in time: http://127.0.0.1:{}",
            port
        ),
        _ => format!(
            "本地服务未在预期时间内就绪：http://127.0.0.1:{}",
            port
        ),
    }
}

fn spawn_sidecar_err(path: &Path, err: &std::io::Error, lang: &str) -> String {
    match lang {
        "en" => format!(
            "Could not start local service process: {} — {}",
            path.display(),
            err
        ),
        _ => format!(
            "无法启动本地服务进程：{} — {}",
            path.display(),
            err
        ),
    }
}

fn sidecar_dev_hint(lang: &str) -> &'static str {
    match lang {
        "en" => " (no embedded Python; please start the backend first: pixi run dev-backend)",
        _ => "（未找到嵌入式 Python，请先在另一终端启动后端：pixi run dev-backend）",
    }
}

/// `tauri dev` 无嵌入式时，对固定 `:8000` 做健康检查的最长等待（秒）。
/// 与前端壳 `SHELL_BACKEND_WAIT_MS`（120s）对齐；冷启动导入常超过旧默认 30s。
/// 可用环境变量 `SOLAIRE_BACKEND_HEALTH_WAIT_SECS` 覆盖（10～600）。
fn dev_backend_health_wait_secs() -> u64 {
    const DEFAULT: u64 = 120;
    match std::env::var("SOLAIRE_BACKEND_HEALTH_WAIT_SECS") {
        Ok(s) => match s.parse::<u64>() {
            Ok(n) if (10..=600).contains(&n) => n,
            _ => DEFAULT,
        },
        Err(_) => DEFAULT,
    }
}

/// `/api/health` JSON 中用于识别本产品的字段值（与 FastAPI 一致）。
const SOLAIRE_HEALTH_PRODUCT: &str = "sol_edu";

/// Python `desktop_entry` 打印的首行协议前缀（与 `solaire/desktop_entry.py` 一致）。
const HANDSHAKE_PREFIX: &str = "SOLAIRE_LISTEN_PORT=";

fn python_log_path() -> PathBuf {
    std::env::temp_dir().join("solaire-desktop-python.log")
}

fn truncate_python_log() {
    let _ = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(python_log_path());
}

fn read_log_tail(max_lines: usize) -> String {
    let Ok(contents) = fs::read_to_string(python_log_path()) else {
        return String::new();
    };
    let lines: Vec<&str> = contents.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].join("\n")
}

fn append_log_context(msg: &str, lang: &str) -> String {
    let tail = read_log_tail(25);
    let log_path = python_log_path();
    let (log_label, full_label) = match lang {
        "en" => ("Recent log", "Full log"),
        _ => ("最近日志", "完整日志"),
    };
    if tail.is_empty() {
        format!("{}\n\n{}: {}", msg, full_label, log_path.display())
    } else {
        format!(
            "{}\n\n--- {} ---\n{}\n\n{}: {}",
            msg,
            log_label,
            tail,
            full_label,
            log_path.display()
        )
    }
}

fn process_crashed_msg(port: u16, exit_code: Option<i32>, lang: &str) -> String {
    let code = exit_code.map_or("?".into(), |c| c.to_string());
    match lang {
        "en" => format!(
            "Local service process exited unexpectedly on port {} (exit code: {}).",
            port, code
        ),
        _ => format!(
            "本地服务进程在端口 {} 上异常退出（退出码：{}）。",
            port, code
        ),
    }
}

fn backend_port_not_ready_msg(lang: &str) -> String {
    match lang {
        "en" => "Local service address is not ready yet.".to_string(),
        _ => "本地服务地址尚未就绪。".to_string(),
    }
}

#[tauri::command]
fn get_backend_port(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<u16, String> {
    let p = state.backend_port.load(Ordering::SeqCst);
    if p != 0 {
        return Ok(p);
    }
    Err(backend_port_not_ready_msg(&read_locale_file(&app)))
}

#[tauri::command]
fn get_app_locale(state: tauri::State<'_, AppLocale>) -> String {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn set_app_locale(app: tauri::AppHandle, lang: String, state: tauri::State<'_, AppLocale>) -> Result<(), String> {
    let normalized = if lang.starts_with("en") { "en" } else { "zh" };
    *state.0.lock().unwrap() = normalized.to_string();
    write_locale_file(&app, normalized)?;
    if let Some(tray) = app.tray_by_id("tray") {
        let (show_t, quit_t) = tray_menu_labels(normalized);
        let show = MenuItem::with_id(&app, "show", show_t, true, None::<&str>).map_err(|e| e.to_string())?;
        let quit = MenuItem::with_id(&app, "quit", quit_t, true, None::<&str>).map_err(|e| e.to_string())?;
        let menu = Menu::with_items(&app, &[&show, &quit]).map_err(|e| e.to_string())?;
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Release: 使用 bundle 内嵌入式 Python（`pythonw.exe`）启动 `solaire.desktop_entry`。
/// Debug（`tauri dev`）：默认**不**用嵌入式，改连 `beforeDevCommand` 拉起的 Uvicorn（127.0.0.1:8000），
/// 避免打完包后 `runtime/python` 残留导致开发模式冷启动慢或占满健康检查。
/// 若要在开发里测真实嵌入式：设置环境变量 `SOLAIRE_USE_SIDECAR=1`。
#[cfg(target_os = "windows")]
fn first_existing(paths: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    for p in paths {
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// MSI 安装后资源通常在 `<安装目录>/resources/...`，不是 `<安装目录>/runtime/...`。
/// 依次尝试：resource_dir、Resource resolve、常见回退路径；优先 `python.exe`（配合 CREATE_NO_WINDOW 比 pythonw 更稳）。
#[cfg(target_os = "windows")]
fn resolve_embedded_python(app: &tauri::AppHandle) -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        if std::env::var("SOLAIRE_USE_SIDECAR").ok().as_deref() != Some("1") {
                        return None;
        }
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let rt = manifest_dir.join("runtime").join("python");
        let found = first_existing([
            rt.join("python.exe"),
            rt.join("pythonw.exe"),
        ]);
                found
    }
    #[cfg(not(debug_assertions))]
    {
        let mut c: Vec<PathBuf> = Vec::new();

        if let Ok(rd) = app.path().resource_dir() {
            c.push(rd.join("runtime").join("python").join("python.exe"));
            c.push(rd.join("runtime").join("python").join("pythonw.exe"));
        }

        if let Ok(p) = app.path().resolve("runtime/python/python.exe", BaseDirectory::Resource) {
            c.push(p);
        }
        if let Ok(p) = app.path().resolve("runtime/python/pythonw.exe", BaseDirectory::Resource) {
            c.push(p);
        }

        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                c.push(
                    dir.join("resources")
                        .join("runtime")
                        .join("python")
                        .join("python.exe"),
                );
                c.push(
                    dir.join("resources")
                        .join("runtime")
                        .join("python")
                        .join("pythonw.exe"),
                );
                c.push(dir.join("runtime").join("python").join("python.exe"));
                c.push(dir.join("runtime").join("python").join("pythonw.exe"));
            }
        }

        let found = first_existing(c.iter().cloned());
                found
    }
}

#[cfg(not(target_os = "windows"))]
fn resolve_embedded_python(_app: &tauri::AppHandle) -> Option<PathBuf> {
    None
}

fn wrong_health_msg(port: u16, lang: &str) -> String {
    match lang {
        "en" => format!(
            "Port {} is not the SolEdu service (unexpected health response).",
            port
        ),
        _ => format!(
            "端口 {} 上不是 SolEdu 本地服务（健康检查响应异常）。",
            port
        ),
    }
}

fn wait_for_health(
    port: u16,
    lang: &str,
    max_wait: Duration,
    mut child: Option<&mut Child>,
) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{}/api/health", port);
    let client = Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .connect_timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
        let start = Instant::now();
    let mut first_err: Option<String> = None;
    while start.elapsed() < max_wait {
        if let Some(ref mut c) = child {
            match c.try_wait() {
                Ok(Some(status)) => {
                    let msg = process_crashed_msg(port, status.code(), lang);
                                        return Err(append_log_context(&msg, lang));
                }
                Ok(None) => {}
                Err(_) => {}
            }
        }

        match client.get(&url).send() {
            Ok(resp) => {
                if resp.status().is_success() {
                    match resp.text() {
                        Ok(text) => {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                                if v.get("status").and_then(|s| s.as_str()) == Some("ok")
                                    && v.get("product").and_then(|s| s.as_str())
                                        == Some(SOLAIRE_HEALTH_PRODUCT)
                                {
                                                                        return Ok(());
                                }
                                if v.get("status").and_then(|s| s.as_str()) == Some("ok") {
                                    return Err(wrong_health_msg(port, lang));
                                }
                            }
                        }
                        Err(_) => {}
                    }
                }
            }
            Err(e) => {
                if first_err.is_none() {
                    let msg = e.to_string();
                                        first_err = Some(msg);
                }
            }
        }
        std::thread::sleep(Duration::from_millis(150));
    }
        Err(append_log_context(&health_timeout_msg(port, lang), lang))
}

fn parse_handshake_line(line: &str) -> Result<u16, String> {
    let line = line.trim();
    let rest = line
        .strip_prefix(HANDSHAKE_PREFIX)
        .ok_or_else(|| "missing prefix".to_string())?;
    rest.trim()
        .parse::<u16>()
        .map_err(|e| format!("port parse: {e}"))
}

fn read_handshake_port(
    stdout: ChildStdout,
    timeout: Duration,
    lang: &str,
) -> Result<(u16, BufReader<ChildStdout>), String> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let outcome: Result<(String, BufReader<ChildStdout>), String> =
            match reader.read_line(&mut line) {
                Ok(0) => Err("unexpected EOF before handshake".to_string()),
                Ok(_) => Ok((line, reader)),
                Err(e) => Err(e.to_string()),
            };
        let _ = tx.send(outcome);
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok((line, reader))) => {
            let port = parse_handshake_line(&line).map_err(|e| {
                match lang {
                    "en" => format!("Invalid handshake from local service ({e})."),
                    _ => format!("本地服务握手无效（{e}）。"),
                }
            })?;
            Ok((port, reader))
        }
        Ok(Err(e)) => Err(e),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(match lang {
            "en" => "Timed out waiting for local service handshake.".to_string(),
            _ => "等待本地服务握手超时。".to_string(),
        }),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(match lang {
            "en" => "Local service process ended before handshake.".to_string(),
            _ => "本地服务进程在握手完成前已退出。".to_string(),
        }),
    }
}

fn tee_child_stdout_to_log(mut reader: BufReader<ChildStdout>, log_path: PathBuf) {
    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let _ = std::io::copy(&mut reader, &mut f);
    }
}

fn spawn_python_backend_dynamic(python_exe: &Path, lang: &str) -> Result<Child, String> {
    let work_dir = python_exe
        .parent()
        .ok_or_else(|| "invalid python path".to_string())?;

    let log_path = python_log_path();
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("open log {}: {}", log_path.display(), e))?;

    let mut cmd = Command::new(python_exe);
    cmd.current_dir(work_dir)
        .env("PYTHONHOME", work_dir)
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONNOUSERSITE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(log))
        .args(["-m", "solaire.desktop_entry", "--port", "0"]);

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.spawn()
        .map_err(|e| spawn_sidecar_err(python_exe, &e, lang))
}

fn start_embedded_backend(py: &Path, lang: &str) -> Result<(u16, Option<Child>), String> {
    truncate_python_log();

        let mut child = spawn_python_backend_dynamic(py, lang)?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "local service: no stdout pipe".to_string())?;

    let (port, reader) = read_handshake_port(stdout, Duration::from_secs(30), lang)?;

    let log_path = python_log_path();
    std::thread::spawn(move || tee_child_stdout_to_log(reader, log_path));

    wait_for_health(
        port,
        lang,
        Duration::from_secs(60),
        Some(&mut child),
    )?;

    Ok((port, Some(child)))
}

fn close_splash(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("splash") {
        let _ = w.close();
    }
}

fn main() {
    let mut builder = tauri::Builder::default();
    #[cfg(any(
        target_os = "windows",
        target_os = "linux",
        target_os = "macos"
    ))]
    {
        if use_single_instance_plugin() {
            builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }));
        }
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_backend_port, get_app_locale, set_app_locale])
        .setup(|app| {
                        let handle = app.handle().clone();
            let lang = read_locale_file(&handle);
            let locale_state = AppLocale(Arc::new(Mutex::new(lang.clone())));
            app.manage(locale_state);

            let embedded = resolve_embedded_python(&handle);
                        let state = Arc::new(AppState {
                backend_port: AtomicU16::new(0),
                sidecar: Mutex::new(None),
                pending_backend: Mutex::new(Some((embedded, lang.clone()))),
            });
            app.manage(state.clone());

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Ready = event {
                let Some(st) = app_handle.try_state::<Arc<AppState>>() else {
                    return;
                };
                let state_arc = (*st).clone();
                let init = state_arc.pending_backend.lock().unwrap().take();
                let Some((embedded, lang_th)) = init else {
                    return;
                };
                let handle_th = app_handle.clone();
                let state_th = state_arc.clone();
                std::thread::spawn(move || {
                                let backend_result: Result<(u16, Option<Child>), String> = (|| {
                    match embedded {
                        Some(py) => start_embedded_backend(&py, &lang_th),
                        None => {
                            let port = 8000u16;
                                                        wait_for_health(
                                port,
                                &lang_th,
                                Duration::from_secs(dev_backend_health_wait_secs()),
                                None,
                            )
                            .map_err(|e| format!("{}{}", e, sidecar_dev_hint(&lang_th)))?;
                            Ok((port, None))
                        }
                    }
                })();

                                match backend_result {
                    Ok((port, child)) => {
                        let h = handle_th.clone();
                                                // 先发布端口，便于前端在收到事件前用 `get_backend_port` 非阻塞读取。
                        state_th.backend_port.store(port, Ordering::SeqCst);
                        *state_th.sidecar.lock().unwrap() = child;

                        close_splash(&h);

                        let ready_payload = json!({ "port": port });
                        let _ = h.emit("backend-ready", ready_payload);

                        if let Some(window) = h.get_webview_window("main") {
                            let _ = window.set_shadow(false);
                            let _ = window.set_background_color(Some(Color(248, 250, 252, 255)));
                            let _ = window.show();
                            let _ = window.set_focus();
                        }

                                                let tray_icon = match Image::from_bytes(include_bytes!(
                            "../icons/tray-icon.png"
                        )) {
                            Ok(i) => i,
                            Err(_) => {
                                return;
                            }
                        };

                        let (show_t, quit_t) = tray_menu_labels(&lang_th);
                        let show = match MenuItem::with_id(
                            &h,
                            "show",
                            show_t,
                            true,
                            None::<&str>,
                        ) {
                            Ok(m) => m,
                            Err(_) => {
                                return;
                            }
                        };
                        let quit = match MenuItem::with_id(
                            &h,
                            "quit",
                            quit_t,
                            true,
                            None::<&str>,
                        ) {
                            Ok(m) => m,
                            Err(_) => {
                                return;
                            }
                        };
                        let menu = match Menu::with_items(&h, &[&show, &quit]) {
                            Ok(m) => m,
                            Err(_) => {
                                return;
                            }
                        };

                        let app_handle = h.clone();
                        if let Err(_) = TrayIconBuilder::with_id("tray")
                            .icon(tray_icon)
                            .menu(&menu)
                            .tooltip("SolEdu")
                            .on_menu_event(move |app, event| match event.id.as_ref() {
                                "quit" => {
                                    if let Ok(mut guard) =
                                        app.state::<Arc<AppState>>().sidecar.lock()
                                    {
                                        if let Some(mut c) = guard.take() {
                                            let _ = c.kill();
                                        }
                                    }
                                    app.exit(0);
                                }
                                "show" => {
                                    if let Some(w) = app.get_webview_window("main") {
                                        let _ = w.show();
                                        let _ = w.set_focus();
                                    }
                                }
                                _ => {}
                            })
                            .on_tray_icon_event(move |tray, event| {
                                if let tauri::tray::TrayIconEvent::Click {
                                    button: tauri::tray::MouseButton::Left,
                                    button_state: tauri::tray::MouseButtonState::Up,
                                    ..
                                } = event
                                {
                                    let app = tray.app_handle();
                                    if let Some(w) = app.get_webview_window("main") {
                                        let _ = w.show();
                                        let _ = w.set_focus();
                                    }
                                }
                            })
                            .build(&h)
                        {
                                                        return;
                        }

                                                if hide_main_window_on_close() {
                            if let Some(win) = app_handle.get_webview_window("main") {
                            let win_clone = win.clone();
                            win.on_window_event(move |ev| {
                                if let WindowEvent::CloseRequested { api, .. } = ev {
                                    api.prevent_close();
                                    let _ = win_clone.hide();
                                }
                            });
                            }
                        } else if app_handle.get_webview_window("main").is_none() {
                                                    }
                                            }
                    Err(e) => {
                                                let _ = handle_th.emit(
                            "backend-failed",
                            json!({ "message": e.clone() }),
                        );
                        let h_close = handle_th.clone();
                        let _ = handle_th.run_on_main_thread(move || {
                            close_splash(&h_close);
                        });
                                                let h_dialog = handle_th.clone();
                        let msg = e;
                        std::thread::spawn(move || {
                            let _ = h_dialog.dialog().message(msg).blocking_show();
                            h_dialog.exit(1);
                        });
                    }
                }
                });
            }
            if let RunEvent::Exit = event {
                // Child is killed on explicit quit from tray; best-effort on other exits.
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn parse_handshake_line_accepts_port() {
        assert_eq!(
            parse_handshake_line("SOLAIRE_LISTEN_PORT=54321\n").unwrap(),
            54321
        );
    }

    #[test]
    fn wait_for_health_should_ignore_proxy_for_localhost() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind test health server");
        let port = listener.local_addr().expect("local addr").port();

        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf);
            let body = r#"{"status":"ok","product":"sol_edu"}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(response.as_bytes()).expect("write response");
            stream.flush().expect("flush response");
        });

        let old_http_proxy = std::env::var_os("HTTP_PROXY");
        let old_https_proxy = std::env::var_os("HTTPS_PROXY");
        let old_no_proxy = std::env::var_os("NO_PROXY");
        std::env::set_var("HTTP_PROXY", "http://127.0.0.1:9");
        std::env::set_var("HTTPS_PROXY", "http://127.0.0.1:9");
        std::env::remove_var("NO_PROXY");

        let result = wait_for_health(port, "zh", Duration::from_millis(800), None);

        match old_http_proxy {
            Some(v) => std::env::set_var("HTTP_PROXY", v),
            None => std::env::remove_var("HTTP_PROXY"),
        }
        match old_https_proxy {
            Some(v) => std::env::set_var("HTTPS_PROXY", v),
            None => std::env::remove_var("HTTPS_PROXY"),
        }
        match old_no_proxy {
            Some(v) => std::env::set_var("NO_PROXY", v),
            None => std::env::remove_var("NO_PROXY"),
        }

        server.join().expect("server thread");
        assert!(result.is_ok(), "expected localhost health check to bypass proxy, got {result:?}");
    }

    #[test]
    fn dev_build_should_not_use_single_instance_or_hide_on_close() {
        if cfg!(debug_assertions) {
            assert!(!use_single_instance_plugin());
            assert!(!hide_main_window_on_close());
        }
    }
}
