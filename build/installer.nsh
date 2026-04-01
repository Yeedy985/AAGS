!macro customInit
  ; 1. 强制杀掉所有 AAGS 进程
  nsExec::ExecToLog 'taskkill /f /t /im "AAGS.exe"'
  Sleep 2000
  nsExec::ExecToLog 'taskkill /f /t /im "AAGS.exe"'
  Sleep 1000

  ; 2. 手动静默运行旧卸载器（进程已死，不会弹窗）
  IfFileExists "$PROGRAMFILES\AAGS\Uninstall AAGS.exe" 0 +3
    ExecWait '"$PROGRAMFILES\AAGS\Uninstall AAGS.exe" /S /allusers _?=$PROGRAMFILES\AAGS'
    Sleep 2000
  IfFileExists "$LOCALAPPDATA\Programs\aags\Uninstall AAGS.exe" 0 +3
    ExecWait '"$LOCALAPPDATA\Programs\aags\Uninstall AAGS.exe" /S /currentuser _?=$LOCALAPPDATA\Programs\aags'
    Sleep 2000

  ; 3. 再杀一轮（卸载器可能启动了 AAGS）
  nsExec::ExecToLog 'taskkill /f /t /im "AAGS.exe"'
  Sleep 1000

  ; 4. 强制删除残留目录
  RMDir /r "$PROGRAMFILES\AAGS"
  RMDir /r "$LOCALAPPDATA\Programs\aags"
!macroend

!macro customCheckAppRunning
  ; 安全网：确保进程已死
  nsExec::ExecToLog 'taskkill /f /t /im "AAGS.exe"'
  Sleep 1000
!macroend
