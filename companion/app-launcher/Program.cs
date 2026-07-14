using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LiveKitCompanion.App;

internal static class Program
{
    private const uint ErrorMessage = 0x00000010 | 0x00010000;
    private const uint WindowClose = 0x0010;
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
        if (command is not null and not "--open" and not "--startup" and not "--window-smoke-test")
        {
            ShowError("LiveKit Companion received an unsupported command.");
            return 2;
        }

        var openWindow = command != "--startup";
        var smokeWindow = command == "--window-smoke-test";
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

            if (openWindow) return OpenControlWindow(smokeWindow);
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

    private static int OpenControlWindow(bool smokeTest)
    {
        Mutex? windowMutex = null;
        if (!smokeTest)
        {
            windowMutex = new Mutex(true, @"Local\LiveKitCompanion.ControlWindow", out var ownsWindow);
            if (!ownsWindow)
            {
                windowMutex.Dispose();
                ActivateExistingWindow();
                return 0;
            }
        }

        try
        {
            Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using var window = new ControlPanelWindow(UiUrl, DataDirectory, smokeTest);
            Application.Run(window);
            if (!window.InitializationFailed) return 0;
            ReportStartupError(window.FailureReason ?? "The control window could not start.", false);
            return 1;
        }
        finally
        {
            if (windowMutex is not null)
            {
                windowMutex.ReleaseMutex();
                windowMutex.Dispose();
            }
        }
    }

    private static void ActivateExistingWindow()
    {
        foreach (var process in Process.GetProcessesByName("LiveKitCompanion"))
        {
            using (process)
            {
                if (process.Id == Environment.ProcessId) continue;
                process.Refresh();
                if (process.MainWindowHandle == nint.Zero) continue;
                ShowWindow(process.MainWindowHandle, 9 /* SW_RESTORE */);
                SetForegroundWindow(process.MainWindowHandle);
                return;
            }
        }
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
            CloseControlWindows();
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

    private static void CloseControlWindows()
    {
        var launcherPath = Environment.ProcessPath;
        if (launcherPath is null) return;

        foreach (var process in Process.GetProcessesByName("LiveKitCompanion"))
        {
            using (process)
            {
                if (process.Id == Environment.ProcessId) continue;
                try
                {
                    process.Refresh();
                    if (process.MainWindowHandle == nint.Zero ||
                        !string.Equals(
                            Path.GetFullPath(process.MainModule?.FileName ?? string.Empty),
                            Path.GetFullPath(launcherPath),
                            StringComparison.OrdinalIgnoreCase)) continue;
                    PostMessageW(process.MainWindowHandle, WindowClose, nuint.Zero, nint.Zero);
                    process.WaitForExit(4000);
                }
                catch
                {
                    // The window may already be closing or belong to another Windows session.
                }
            }
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

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(nint window, int command);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(nint window);

    [DllImport("user32.dll")]
    private static extern bool PostMessageW(nint window, uint message, nuint word, nint parameter);
}

internal sealed class ControlPanelWindow : Form
{
    private readonly Uri uiUri;
    private readonly bool smokeTest;
    private readonly WebView2 browser;
    private readonly HttpClient healthClient = new(
        new HttpClientHandler { UseProxy = false })
    {
        Timeout = TimeSpan.FromMilliseconds(750),
    };
    private readonly System.Windows.Forms.Timer healthTimer = new() { Interval = 1500 };
    private bool checkingHealth;
    private int failedHealthChecks;

    internal bool InitializationFailed { get; private set; }
    internal string? FailureReason { get; private set; }

    internal ControlPanelWindow(string uiUrl, string dataDirectory, bool smokeTest)
    {
        uiUri = new Uri(uiUrl);
        this.smokeTest = smokeTest;
        Text = "LiveKit Companion";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(1180, 820);
        MinimumSize = new Size(760, 620);
        BackColor = Color.FromArgb(17, 16, 15);
        AutoScaleMode = AutoScaleMode.Dpi;
        if (Environment.ProcessPath is { } executable)
        {
            Icon = System.Drawing.Icon.ExtractAssociatedIcon(executable);
        }

        browser = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = BackColor,
            CreationProperties = new CoreWebView2CreationProperties
            {
                UserDataFolder = Path.Combine(dataDirectory, "WebView2"),
            },
        };
        Controls.Add(browser);
        Shown += async (_, _) => await InitializeBrowser();
        healthTimer.Tick += async (_, _) => await CheckServiceHealth();
        FormClosed += (_, _) =>
        {
            healthTimer.Stop();
            healthTimer.Dispose();
            healthClient.Dispose();
        };
    }

    private async Task InitializeBrowser()
    {
        try
        {
            await browser.EnsureCoreWebView2Async().WaitAsync(TimeSpan.FromSeconds(20));
            browser.CoreWebView2.Settings.IsStatusBarEnabled = false;
            browser.CoreWebView2.Settings.IsZoomControlEnabled = true;
            browser.CoreWebView2.Settings.AreDevToolsEnabled = false;
            browser.CoreWebView2.NewWindowRequested += (_, args) =>
            {
                args.Handled = true;
                OpenExternal(args.Uri);
            };
            browser.CoreWebView2.NavigationStarting += (_, args) =>
            {
                if (IsLocalUiAddress(args.Uri)) return;
                args.Cancel = true;
                OpenExternal(args.Uri);
            };

            var navigation = new TaskCompletionSource<CoreWebView2NavigationCompletedEventArgs>(
                TaskCreationOptions.RunContinuationsAsynchronously);
            browser.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
            browser.CoreWebView2.Navigate(uiUri.AbsoluteUri);
            var result = await navigation.Task.WaitAsync(TimeSpan.FromSeconds(20));
            browser.CoreWebView2.NavigationCompleted -= OnNavigationCompleted;
            if (!result.IsSuccess)
            {
                throw new InvalidOperationException(
                    $"The local control panel failed to load ({result.WebErrorStatus}).");
            }
            healthTimer.Start();
            if (smokeTest)
            {
                await Task.Delay(250);
                Close();
            }

            void OnNavigationCompleted(
                object? sender,
                CoreWebView2NavigationCompletedEventArgs args) => navigation.TrySetResult(args);
        }
        catch (Exception error)
        {
            InitializationFailed = true;
            FailureReason = $"Could not create the Companion window: {error.Message}";
            if (!smokeTest)
            {
                MessageBox.Show(
                    this,
                    $"{FailureReason}\n\nInstall or repair Microsoft Edge WebView2 Runtime and try again.",
                    "LiveKit Companion",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
            Close();
        }
    }

    private async Task CheckServiceHealth()
    {
        if (checkingHealth || IsDisposed) return;
        checkingHealth = true;
        try
        {
            using var response = await healthClient.GetAsync(uiUri);
            failedHealthChecks = response.IsSuccessStatusCode ? 0 : failedHealthChecks + 1;
        }
        catch
        {
            failedHealthChecks++;
        }
        finally
        {
            checkingHealth = false;
        }
        if (failedHealthChecks >= 2 && !IsDisposed) Close();
    }

    private bool IsLocalUiAddress(string value)
    {
        return Uri.TryCreate(value, UriKind.Absolute, out var candidate) &&
               candidate.Scheme == uiUri.Scheme &&
               candidate.Host == uiUri.Host &&
               candidate.Port == uiUri.Port;
    }

    private static void OpenExternal(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)) return;
        Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true })?.Dispose();
    }
}
