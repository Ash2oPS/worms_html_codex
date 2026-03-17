@echo off
setlocal
cd /d "%~dp0"

echo [Worms] Preparation du serveur local...

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] npm est introuvable. Installe Node.js puis relance ce script.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [Worms] Installation des dependances npm...
  call npm install
  if errorlevel 1 (
    echo [ERREUR] Echec pendant npm install.
    pause
    exit /b 1
  )
)

echo [Worms] Lancement du jeu sur http://127.0.0.1:5173
call npm run dev -- --host=127.0.0.1 --port=5173 --open

endlocal
