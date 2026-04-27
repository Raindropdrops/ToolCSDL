@echo off
setlocal EnableExtensions

title CSDL Study Pack Extractor

set "PROJECT_ROOT=%~dp0"
set "CODE_DIR=%~dp0code"

echo ========================================
echo   CSDL Study Pack Extractor
echo ========================================
echo.
echo Project: "%PROJECT_ROOT%"
echo Code:    "%CODE_DIR%"
echo.

if exist "%CODE_DIR%\package.json" goto CHECK_SYNTAX
echo [ERROR] Khong tim thay package.json trong thu muc code.
echo Hay kiem tra file nay nam trong Database_Study_Pack.
echo.
goto END_FAIL

:CHECK_SYNTAX
pushd "%CODE_DIR%"
if errorlevel 1 goto END_FAIL

echo [1/2] Kiem tra syntax...
call npm run check
if errorlevel 1 goto CHECK_FAILED

echo.
echo [2/2] Chay extractor...
echo - Neu Chrome hien login, tool se tu click Microsoft neu co.
echo - Dang nhap xong tool se tu tiep tuc.
echo - Neu Chrome bi lock profile, hay dong cac cua so Chrome tool cu roi chay lai.
echo.
call npm run extract
set "EXIT_CODE=%ERRORLEVEL%"
popd

if "%EXIT_CODE%"=="0" goto END_OK
goto END_EXTRACT_FAIL

:CHECK_FAILED
popd
echo.
echo [ERROR] Syntax check that bai.
goto END_FAIL

:END_OK
echo.
echo [DONE] Extractor da chay xong.
goto END_PAUSE

:END_EXTRACT_FAIL
echo.
echo [ERROR] Extractor dung voi ma loi %EXIT_CODE%.
goto END_PAUSE

:END_FAIL
set "EXIT_CODE=1"
goto END_PAUSE

:END_PAUSE
echo.
echo Nhan phim bat ky de dong cua so nay...
pause >nul
exit /b %EXIT_CODE%
