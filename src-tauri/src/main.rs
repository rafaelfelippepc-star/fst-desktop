use rdev::{listen, Event, EventType};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::State;

struct PttState {
    active: Arc<AtomicBool>,
}

#[tauri::command]
fn get_ptt_status(state: State<'_, PttState>) -> bool {
    state.active.load(Ordering::SeqCst)
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
                        }
                    }
                }
                EventType::KeyRelease(key) => {
                    if format!("{:?}", key) == "KeyV" {
                        if ptt_clone.load(Ordering::SeqCst) {
                            ptt_clone.store(false, Ordering::SeqCst);
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
        .manage(PttState { active: ptt_active })
        .invoke_handler(tauri::generate_handler![get_ptt_status])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar a aplicação Tauri em Rust");
}
