const { execFile } = require("child_process");

const CACHE_MS = 750;
const cache = new Map();

const POWERSHELL_SCRIPT = `
Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class VoidCoreWindowProbe {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    public static string Probe(int targetPid) {
        uint foregroundPid = 0;
        IntPtr foreground = GetForegroundWindow();
        if (foreground != IntPtr.Zero) {
            GetWindowThreadProcessId(foreground, out foregroundPid);
        }

        bool hasVisibleWindow = false;
        bool isMinimized = false;

        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if (pid == targetPid && IsWindowVisible(hWnd)) {
                hasVisibleWindow = true;
                if (IsIconic(hWnd)) isMinimized = true;
            }
            return true;
        }, IntPtr.Zero);

        return foregroundPid + "|" + hasVisibleWindow + "|" + isMinimized;
    }
}
'@
[VoidCoreWindowProbe]::Probe(__PID__)
`;

function runPowerShell(script) {
    return new Promise(resolve => {
        execFile(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
            { windowsHide: true, timeout: 2500 },
            (error, stdout) => resolve(error ? null : String(stdout).trim())
        );
    });
}

async function getGameWindowState(pid) {
    const parsedPid = Number(pid);
    if (process.platform !== "win32" || !Number.isInteger(parsedPid) || parsedPid <= 0) {
        return { supported: false, isForeground: null, isMinimized: null, hasVisibleWindow: null };
    }

    const cached = cache.get(parsedPid);
    if (cached && Date.now() - cached.timestamp < CACHE_MS) {
        return cached.value;
    }

    const output = await runPowerShell(POWERSHELL_SCRIPT.replace("__PID__", String(parsedPid)));
    if (!output) {
        return { supported: false, isForeground: null, isMinimized: null, hasVisibleWindow: null };
    }

    const line = output.split(/\r?\n/).filter(Boolean).pop();
    const [foregroundPidText, visibleText, minimizedText] = String(line).split("|");
    const foregroundPid = Number(foregroundPidText);
    const value = {
        supported: Number.isInteger(foregroundPid),
        foregroundPid: Number.isInteger(foregroundPid) ? foregroundPid : null,
        isForeground: foregroundPid === parsedPid,
        hasVisibleWindow: visibleText === "True",
        isMinimized: minimizedText === "True"
    };

    cache.set(parsedPid, { timestamp: Date.now(), value });
    return value;
}

module.exports = { getGameWindowState };
