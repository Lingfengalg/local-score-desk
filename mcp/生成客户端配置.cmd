@echo off
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
 echo 请先安装 Node.js 22 或更高版本，然后重新运行。
 pause
 exit /b 1
)
node "%~dp0generate-mcp-config.cjs"
pause
