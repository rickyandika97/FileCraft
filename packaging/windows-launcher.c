/* Native Windows x64 launcher for the application-local Python runtime. */
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#include <windows.h>

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR arguments, int show) {
    WCHAR folder[32768], python[32768], script[32768], command[32768];
    DWORD length = GetModuleFileNameW(NULL, folder, 32768);
    if (!length || length > 14000) {
        MessageBoxW(NULL, L"Move the app to a folder with a shorter path and try again.",
                    L"FileCraft", MB_OK | MB_ICONERROR);
        return 1;
    }
    while (length && folder[length - 1] != L'\\') --length;
    if (!length) return 1;
    folder[length - 1] = L'\0';
    lstrcpyW(python, folder);
    lstrcatW(python, L"\\_internal\\python\\pythonw.exe");
    lstrcpyW(script, folder);
    lstrcatW(script, L"\\_internal\\app\\desktop.py");
    if (GetFileAttributesW(python) == INVALID_FILE_ATTRIBUTES ||
        GetFileAttributesW(script) == INVALID_FILE_ATTRIBUTES) {
        MessageBoxW(NULL, L"Extract the entire ZIP first, then open FileCraft.exe. "
                         L"Keep the _internal folder beside the app.",
                    L"FileCraft", MB_OK | MB_ICONERROR);
        return 1;
    }
    lstrcpyW(command, L"\"");
    lstrcatW(command, python);
    lstrcatW(command, L"\" -X utf8 -B \"");
    lstrcatW(command, script);
    lstrcatW(command, L"\"");
    SetEnvironmentVariableW(L"PYTHONUTF8", L"1");
    STARTUPINFOW startup = {0};
    PROCESS_INFORMATION process = {0};
    startup.cb = sizeof(startup);
    if (!CreateProcessW(python, command, NULL, NULL, FALSE, CREATE_NO_WINDOW,
                        NULL, folder, &startup, &process)) {
        MessageBoxW(NULL, L"Could not start the included Python runtime. "
                         L"Try extracting the ZIP again. If it still fails, run Diagnose Windows.bat.",
                    L"FileCraft", MB_OK | MB_ICONERROR);
        return 1;
    }
    CloseHandle(process.hThread);
    WaitForSingleObject(process.hProcess, INFINITE);
    DWORD result = 1;
    GetExitCodeProcess(process.hProcess, &result);
    CloseHandle(process.hProcess);
    return (int)result;
}
