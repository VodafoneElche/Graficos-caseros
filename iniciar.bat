@echo off
chcp 65001 >nul
title Graficos familia
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   No encuentro Node.js. Instalalo desde https://nodejs.org ^(boton LTS^) y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)
set OPEN_BROWSER=1
node --no-warnings server\server.mjs
echo.
pause
