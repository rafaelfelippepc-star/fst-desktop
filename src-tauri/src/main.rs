use rdev::{listen, Event, EventType};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[tauri::command]
fn get_status() -> serde_json::Value {
    serde_json::json!({
        "ok": true,
        "error": null,
        "platform": std::env::consts::OS
    })
}

fn main() {
    let ptt_active = Arc::new(AtomicBool::new(false));
    let ptt_clone = Arc::clone(&ptt_active);

    std::thread::spawn(move || {
        let callback = move |event: Event| {
            match event.event_type {
                EventType::KeyPress(key) => {
                    if format!("{:?}", key) == "KeyV" {
                        if !ptt_clone.load(Ordering::SeqCst) {
                            ptt_clone.store(true, Ordering::SeqCst);
                            println!("[PTT] Microfone ABERTO (KeyV pressionada)");
                        }
                    }
                }
                EventType::KeyRelease(key) => {
                    if format!("{:?}", key) == "KeyV" {
                        if ptt_clone.load(Ordering::SeqCst) {
                            ptt_clone.store(false, Ordering::SeqCst);
                            println!("[PTT] Microfone FECHADO (KeyV solta)");
                        }
                    }
                }
                _ => {}
            }
        };

        if let Err(error) = listen(callback) {
            eprintln!("Erro no listener global de input: {:?}", error);
        }
    });

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_status])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar a aplicação Tauri em Rust");
}
