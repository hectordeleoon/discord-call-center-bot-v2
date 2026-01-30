@echo off
echo ========================================
echo   Discord Call Center Bot V2.0
echo ========================================
echo.
echo Iniciando el bot...
echo.

REM Verificar si Node.js está instalado
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js no está instalado
    echo Por favor instala Node.js desde https://nodejs.org/
    pause
    exit /b 1
)

REM Verificar si existen las dependencias
if not exist "node_modules\" (
    echo.
    echo No se encontraron las dependencias.
    echo Instalando dependencias...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo ERROR: No se pudieron instalar las dependencias
        pause
        exit /b 1
    )
)

REM Verificar si existe el archivo .env
if not exist ".env" (
    echo.
    echo ADVERTENCIA: No se encontró el archivo .env
    echo Por favor copia .env.example a .env y configúralo
    echo.
    pause
    exit /b 1
)

REM Crear carpetas necesarias si no existen
if not exist "database\" mkdir database
if not exist "audio\" mkdir audio
if not exist "logs\" mkdir logs
if not exist "backups\" mkdir backups

REM Iniciar el bot
echo.
echo Bot iniciando...
echo Presiona Ctrl+C para detener el bot
echo.
node bot-v2.js

REM Si el bot se detiene, pausar para ver el error
if %errorlevel% neq 0 (
    echo.
    echo ERROR: El bot se detuvo con errores
    echo.
    pause
)
