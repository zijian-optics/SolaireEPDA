// Prevents extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::fs::OpenOptions;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use reqwest::blocking::get;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::path::BaseDirectory;
use tauri::tray::TrayIconBuilder;
use tauri::window::Color;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

struct AppState {
    backend_port: u16,
    sidecar: Mutex<Option<Child>>,
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
        "en" => " (no embedded Python; in dev run: python -m uvicorn solaire.web.app:app --host 127.0.0.1 --port 8000)",
        _ => "（未找到嵌入式 Python，请在开发时先启动：python -m uvicorn solaire.web.app:app --host 127.0.0.1 --port 8000）",
    }
}

fn missing_icon_msg(lang: &str) -> &'static str {
    match lang {
        "en" => "Missing application icon",
        _ => "缺少应用图标",
    }
}

#[tauri::command]
fn get_backend_port(state: tauri::State<'_, Arc<AppState>>) -> u16 {
    state.backend_port
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
        first_existing([
            rt.join("python.exe"),
            rt.join("pythonw.exe"),
        ])
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

        first_existing(c)
    }
}

#[cfg(not(target_os = "windows"))]
fn resolve_embedded_python(_app: &tauri::AppHandle) -> Option<PathBuf> {
    None
}

fn pick_free_port() -> Result<u16, std::io::Error> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn wait_for_health(port: u16, lang: &str) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{}/api/health", port);
    let start = std::time::Instant::now();
    // 首次冷启动嵌入式 Python + 依赖较多时可能超过 45s
    while start.elapsed() < Duration::from_secs(90) {
        if let Ok(resp) = get(&url) {
            if resp.status().is_success() {
                return Ok(());
            }
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    Err(health_timeout_msg(port, lang))
}

fn close_splash(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("splash") {
        let _ = w.close();
    }
}

fn spawn_python_backend(python_exe: &Path, port: u16, lang: &str) -> Result<Child, String> {
    let work_dir = python_exe
        .parent()
        .ok_or_else(|| "invalid python path".to_string())?;

    let log_path = std::env::temp_dir().join("solaire-desktop-python.log");
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("open log {}: {}", log_path.display(), e))?;

    let mut cmd = Command::new(python_exe);
    cmd.current_dir(work_dir)
        .env("PYTHONHOME", work_dir)
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(log))
        .args([
            "-m",
            "solaire.desktop_entry",
            "--port",
            &port.to_string(),
        ]);

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.spawn()
        .map_err(|e| spawn_sidecar_err(python_exe, &e, lang))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_backend_port, get_app_locale, set_app_locale])
        .setup(|app| {
            let handle = app.handle().clone();
            let lang = read_locale_file(&handle);
            let locale_state = AppLocale(Arc::new(Mutex::new(lang.clone())));
            app.manage(locale_state);

            let embedded = resolve_embedded_python(&handle);
            let backend_result: Result<(u16, Option<Child>), String> = match embedded {
                Some(py) => {
                    let port = pick_free_port().map_err(|e| e.to_string())?;
                    let c = spawn_python_backend(&py, port, &lang)?;
                    wait_for_health(port, &lang).map_err(|e| e.to_string())?;
                    Ok((port, Some(c)))
                }
                None => {
                    let port = 8000u16;
                    wait_for_health(port, &lang).map_err(|e| {
                        format!("{}{}", e, sidecar_dev_hint(&lang))
                    })?;
                    Ok((port, None))
                }
            };

            let (port, child) = match backend_result {
                Ok(v) => v,
                Err(e) => {
                    close_splash(&handle);
                    return Err(e.into());
                }
            };

            let state = Arc::new(AppState {
                backend_port: port,
                sidecar: Mutex::new(child),
            });
            app.manage(state.clone());

            close_splash(&handle);

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_shadow(false);
                // 与主界面浅色底一致，减轻 WebView 首帧默认白底
                let _ = window.set_background_color(Some(Color(248, 250, 252, 255)));
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.emit("backend-ready", port);
            }

            // 托盘使用透明底 PNG（icons/tray-icon.png），避免 icon.png 白底在任务栏上呈方块；
            // 高分辨率由系统缩放，主体仍清晰。
            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
                .map_err(|e| format!("{}: {}", missing_icon_msg(&lang), e))?;

            let (show_t, quit_t) = tray_menu_labels(&lang);
            let show = MenuItem::with_id(app, "show", show_t, true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", quit_t, true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let app_handle = app.handle().clone();
            TrayIconBuilder::with_id("tray")
                .icon(tray_icon)
                .menu(&menu)
                .tooltip("SolEdu")
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "quit" => {
                        if let Ok(mut guard) = app.state::<Arc<AppState>>().sidecar.lock() {
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
                .build(app)?;

            let win = app_handle.get_webview_window("main").expect("main window");
            let win_clone = win.clone();
            win.on_window_event(move |ev| {
                if let WindowEvent::CloseRequested { api, .. } = ev {
                    api.prevent_close();
                    let _ = win_clone.hide();
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            if let RunEvent::Exit = event {
                // Child is killed on explicit quit from tray; best-effort on other exits.
            }
        });
}
