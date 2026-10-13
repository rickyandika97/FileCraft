@echo off
setlocal
title FileCraft
pushd "%~dp0"
if errorlevel 1 goto folder_error

py -3 -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1
if not errorlevel 1 goto run_py
python -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1
if not errorlevel 1 goto run_python
python3 -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1
if not errorlevel 1 goto run_python3

echo Python 3.10 or newer is required.
echo Install Python from https://www.python.org/downloads/windows/
echo Then close this window and double-click Start FileCraft.bat again.
goto finish

:run_py
py -3 server.py
goto finish

:run_python
python server.py
goto finish

:run_python3
python3 server.py
goto finish

:folder_error
echo Could not open the app folder. Extract the ZIP into a writable folder first.
pause
exit /b 1

:finish
echo.
echo FileCraft has stopped. Any error is shown above.
pause
popd
endlocal
