; Деинсталляция Halo: удалить службу Halo Service, если она установлена.
; При обновлении (isUpdated) службу не трогаем — она работает из своей копии в Program Files.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::Exec 'sc.exe query HaloService'
    Pop $0
    ${if} $0 == 0
      ExecShellWait "runas" "$INSTDIR\resources\service\halo-service.exe" "uninstall" SW_HIDE
    ${endIf}
  ${endIf}
!macroend
