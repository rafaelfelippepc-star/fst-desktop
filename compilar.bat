@echo off
echo [1/3] A verificar estrutura de pastas...
cd /d C:\fst-desktop

if not exist package.json (
    if exist src\package.json (
        move src\package.json package.json
    )
)

if not exist package-lock.json (
    if exist src\package-lock.json (
        move src\package-lock.json package-lock.json
    )
)

echo [2/3] A instalar dependencias do frontend...
call npm install

echo [3/3] A compilar o instalador do Tauri...
call npx tauri build
pause