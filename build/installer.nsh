!macro customInit
  ; 安装前自动关闭正在运行的 AAGS 进程，避免文件锁定导致安装失败
  nsExec::ExecToLog 'taskkill /f /im "AAGS.exe"'
  Sleep 1000
!macroend
