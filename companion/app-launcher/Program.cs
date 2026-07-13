using System.Diagnostics;
using System.Runtime.InteropServices;

namespace LiveKitCompanion.App;

internal static class Program
{
    private const uint ErrorMessage = 0x00000010 | 0x00010000;
    private static readonly string UiUrl = $"http://127.0.0.1:{ResolveUiPort()}/";
    private static readonly string InstallDirectory = AppContext.BaseDirectory;
    private static readonly string DataDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "LiveKitCompanion");
    private static readonly string PidFile = Path.Combine(DataDirectory, "companion.pid");
    private static readonly string StopFile = Path.Combine(DataDirectory, "stop-requested");
    private static readonly string LogFile = Path.Combine(DataDirectory, "companion.log");
    private static readonly HttpClient Http = new(
        new HttpClientHandler { UseProxy = false })
    {
        Timeout = TimeSpan.FromMilliseconds(500),
    };

    [STAThread]
    private static int Main(string[] args)
    {
        SetCurrentProcessExplicitAppUserModelID("LiveKit.Companion");
        var command = args.FirstOrDefault()?.ToLowerInvariant();
        if (command == "--stop") return StopCompanion();
        if (command is not null and not "--open" and not "--startup")
        {
            ShowError("LiveKit Companion received an unsupported command.");
            return 2;
        }

        var openWindow = command != "--startup";
        try
        {
            using var mutex = new Mutex(false, @"Local\LiveKitCompanion.Launcher");
            var ownsMutex = false;
            try
            {
                try
                {
                    ownsMutex = mutex.WaitOne(TimeSpan.FromSeconds(15));
                }
                catch (AbandonedMutexException)
                {
                    ownsMutex = true;
                }
                if (!ownsMutex)
                {
                    ReportStartupError(
                        "Another LiveKit Companion launch is still in progress.",
                        openWindow);
                    return 1;
                }

                if (!IsUiReady())
                {
                    StartBackend();
                    if (!WaitForUi(TimeSpan.FromSeconds(15)))
                    {
                        ReportStartupError(
                            "The background service did not become ready.",
                            openWindow);
                        return 1;
                    }
                }
            }
            finally
            {
                if (ownsMutex) mutex.ReleaseMutex();
            }

            if (openWindow) OpenControlWindow();
            return 0;
        }
        catch (Exception error)
        {
            ReportStartupError(error.Message, openWindow);
            return 1;
        }
    }

    private static void StartBackend()
    {
        var nodePath = Path.Combine(InstallDirectory, "runtime", "node.exe");
        var appDirectory = Path.Combine(InstallDirectory, "app");
        var entryPoint = Path.Combine(appDirectory, "index.js");
        if (!File.Exists(nodePath)) throw new FileNotFoundException("The bundled runtime is missing.", nodePath);
        if (!File.Exists(entryPoint)) throw new FileNotFoundException("The companion service is missing.", entryPoint);

        Directory.CreateDirectory(DataDirectory);
        TryDelete(StopFile);
        var startInfo = new ProcessStartInfo(nodePath)
        {
            WorkingDirectory = appDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        startInfo.ArgumentList.Add(entryPoint);
        startInfo.Environment["COMPANION_LOG_FILE"] = LogFile;
        startInfo.Environment["COMPANION_PACKAGED"] = "1";
        Process.Start(startInfo)?.Dispose();
    }

    private static bool WaitForUi(TimeSpan timeout)
    {
        var deadline = Stopwatch.StartNew();
        while (deadline.Elapsed < timeout)
        {
            if (IsUiReady()) return true;
            Thread.Sleep(200);
        }
        return false;
    }

    private static bool IsUiReady()
    {
        try
        {
            using var response = Http.GetAsync(UiUrl).GetAwaiter().GetResult();
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    private static void OpenControlWindow()
    {
        var edge = FindEdge();
        var startInfo = edge is null
            ? new ProcessStartInfo(UiUrl) { UseShellExecute = true }
            : new ProcessStartInfo(edge) { UseShellExecute = true };
        if (edge is not null) startInfo.ArgumentList.Add($"--app={UiUrl}");
        Process.Start(startInfo)?.Dispose();
    }

    private static string? FindEdge()
    {
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Microsoft", "Edge", "Application", "msedge.exe"),
        };
        return candidates.FirstOrDefault(File.Exists);
    }

    private static int ResolveUiPort()
    {
        if (TryReadPort("COMPANION_UI_PORT", out var uiPort)) return uiPort;
        if (TryReadPort("PTT_PORT", out var pttPort) && pttPort <= 65533) return pttPort + 2;
        return 7333;
    }

    private static bool TryReadPort(string name, out int port)
    {
        return int.TryParse(Environment.GetEnvironmentVariable(name), out port) &&
               port is >= 1 and <= 65535;
    }

    private static int StopCompanion()
    {
        try
        {
            Directory.CreateDirectory(DataDirectory);
            File.WriteAllText(StopFile, "stop\n");
            var process = FindBackendProcess(out var mayForceStop);
            if (process is null)
            {
                TryDelete(PidFile);
                return 0;
            }
            using (process)
            {
                if (!process.WaitForExit(6000))
                {
                    if (!mayForceStop) return 1;
                    process.Kill(entireProcessTree: true);
                    process.WaitForExit(2000);
                }
            }
            TryDelete(PidFile);
            TryDelete(StopFile);
            return 0;
        }
        catch
        {
            return 1;
        }
    }

    private static Process? FindBackendProcess(out bool mayForceStop)
    {
        mayForceStop = false;
        try
        {
            if (!int.TryParse(File.ReadAllText(PidFile).Trim(), out var processId)) return null;
            var process = Process.GetProcessById(processId);
            try
            {
                var expectedPath = Path.GetFullPath(
                    Path.Combine(InstallDirectory, "runtime", "node.exe"));
                var actualPath = process.MainModule?.FileName;
                mayForceStop = actualPath is not null && Path.GetFullPath(actualPath).Equals(
                    expectedPath,
                    StringComparison.OrdinalIgnoreCase);
            }
            catch {}
            return process;
        }
        catch
        {
            return null;
        }
    }

    private static void ReportStartupError(string reason, bool showDialog)
    {
        var message =
            $"LiveKit Companion could not start.\n\n{reason}\n\nDiagnostic log:\n{LogFile}";
        try
        {
            Directory.CreateDirectory(DataDirectory);
            File.AppendAllText(
                LogFile,
                $"{DateTimeOffset.Now:O} launcher: {reason}{Environment.NewLine}");
        }
        catch {}

        if (showDialog) ShowError(message);
    }

    private static void ShowError(string message)
    {
        MessageBoxW(nint.Zero, message, "LiveKit Companion", ErrorMessage);
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch
        {
            // A stale marker is harmless and will be retried on the next launch.
        }
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(nint owner, string text, string caption, uint type);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
}
