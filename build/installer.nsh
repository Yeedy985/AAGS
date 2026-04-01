!macro customInit
  ; ===== 安装前强制关闭所有 AAGS 相关进程 =====
  ; 方法1: taskkill 强制杀
  nsExec::ExecToLog 'taskkill /f /im "AAGS.exe"'
  ; 方法2: wmic 兜底
  nsExec::ExecToLog 'wmic process where "name='"'"'AAGS.exe'"'"'" call terminate'
  ; 方法3: PowerShell 最终兜底（杀掉所有匹配进程）
  nsExec::ExecToLog 'powershell -NoProfile -Command "Get-Process -Name AAGS -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"'
  ; 等待文件锁释放
  Sleep 2000
!macroend

; ===== 覆盖内置的"应用正在运行"检查，跳过弹窗直接杀进程 =====
!macro customCheckAppRunning
  ; 再次确保进程已死
  nsExec::ExecToLog 'taskkill /f /im "AAGS.exe"'
  Sleep 500
!macroend
