@echo off
chcp 65001 >nul

REM 检查是否要重置工具状态
IF "%1"=="reset" (
  ECHO 正在重置字体大小调试工具状态...
  IF EXIST "%TEMP%\font_tool_running.lock" DEL "%TEMP%\font_tool_running.lock"
  ECHO 状态已重置。
  EXIT /B
)

REM 检查锁文件
IF EXIST "%TEMP%\font_tool_running.lock" (
  ECHO [INFO] 检测到锁文件 ^(%TEMP%\font_tool_running.lock^).
  ECHO [INFO] 这可能意味着工具已在运行或上次未正常退出。
) ELSE (
  ECHO [INFO] 未检测到锁文件 ^(%TEMP%\font_tool_running.lock^).
)

REM 创建锁文件
ECHO [INFO] Creating run lock file.
ECHO RUNNING > "%TEMP%\font_tool_running.lock"

ECHO.
ECHO [INFO] 正在启动字体大小调试工具... (npm start)
ECHO [INFO] 请等待工具启动完成。关闭此窗口将终止工具。
ECHO.
npm start

REM 工具退出或被终止 (Ctrl+C)
ECHO.
ECHO [INFO] 字体大小调试工具正在关闭...
IF EXIST "%TEMP%\font_tool_running.lock" (
  DEL "%TEMP%\font_tool_running.lock"
  ECHO [INFO] 运行锁文件已删除。
) ELSE (
  ECHO [WARN] 运行锁文件未找到，可能已被手动删除或创建失败。
)
ECHO [INFO] 工具已关闭. 