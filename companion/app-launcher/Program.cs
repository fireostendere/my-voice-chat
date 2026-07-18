using System.Diagnostics;
using System.Drawing;
using System.IO.Pipes;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LiveKitCompanion.App;

internal static class Program
{
    private const uint ErrorMessage = 0x00000010 | 0x00010000;
    private const uint WindowClose = 0x0010;
    private const string WebAppEnvironmentVariable = "COMPANION_WEB_APP_URL";
    private static readonly int UiPort = ResolveUiPort();
    private static readonly string UiUrl = $"http://127.0.0.1:{UiPort}/";
    private static readonly string NavigationPipeName = $"LiveKitCompanion.Navigation.{UiPort}";
    private static readonly string InstallDirectory = AppContext.BaseDirectory;
    private static readonly string DataDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "LiveKitCompanion");
    private static readonly string PidFile = Path.Combine(DataDirectory, "companion.pid");
    private static readonly string StopFile = Path.Combine(DataDirectory, "stop-requested");
    private static readonly string LogFile = Path.Combine(DataDirectory, "companion.log");
    private static readonly string? PackagedWebAppUrl = ReadAssemblyMetadata("CompanionWebAppUrl");
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
        var smokeWindow = command == "--window-smoke-test" ||
            (command == "--open" &&
             !string.IsNullOrWhiteSpace(
                 Environment.GetEnvironmentVariable("COMPANION_SMOKE_EXPECTED_TITLE")));
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
        startInfo.Environment["COMPANION_UI_PORT"] = UiPort.ToString();
        startInfo.Environment["COMPANION_NAVIGATION_PIPE_NAME"] = NavigationPipeName;
        if (Environment.ProcessPath is { } launcherPath)
        {
            startInfo.Environment["COMPANION_LAUNCHER_PATH"] = launcherPath;
        }
        if (Environment.GetEnvironmentVariable(WebAppEnvironmentVariable) is null &&
            !string.IsNullOrWhiteSpace(PackagedWebAppUrl))
        {
            startInfo.Environment[WebAppEnvironmentVariable] = PackagedWebAppUrl;
        }
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
            using var window = new CompanionWindow(
                UiUrl,
                DataDirectory,
                smokeTest,
                NavigationPipeName);
            Application.Run(window);
            if (!window.InitializationFailed) return 0;
            ReportStartupError(window.FailureReason ?? "The client window could not start.", false);
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

    internal static string? ReadAssemblyMetadata(string key)
    {
        return Assembly.GetExecutingAssembly()
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(attribute => string.Equals(attribute.Key, key, StringComparison.Ordinal))
            ?.Value;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(nint owner, string text, string caption, uint type);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(nint window, int command);

    [DllImport("user32.dll")]
    internal static extern bool SetForegroundWindow(nint window);

    [DllImport("user32.dll")]
    private static extern bool PostMessageW(nint window, uint message, nuint word, nint parameter);
}

internal sealed class CompanionWindow : Form
{
    private const string SmokeExpectedTitleVariable = "COMPANION_SMOKE_EXPECTED_TITLE";
    private const int MaxNavigationRequestBytes = 16 * 1024;
    private const int MaxNavigationUrlCharacters = 8192;
    private const string FakeMediaArguments =
        "--use-fake-ui-for-media-stream --use-fake-device-for-media-stream";
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    private static readonly string CompanionAppVersion = ResolveCompanionAppVersion();

    private readonly Uri uiUri;
    private readonly Uri clientConfigUri;
    private readonly string? navigationPipeName;
    private readonly bool smokeTest;
    private readonly string? smokeExpectedTitle;
    private readonly WebView2 browser;
    private readonly ToolStripButton backButton = CreateToolbarButton("Back");
    private readonly ToolStripButton homeButton = CreateToolbarButton("Home / Chat");
    private readonly ToolStripButton settingsButton = CreateToolbarButton("Settings");
    private readonly ToolStripButton reloadButton = CreateToolbarButton("Reload");
    private readonly HttpClient healthClient = new(
        new HttpClientHandler { UseProxy = false })
    {
        Timeout = TimeSpan.FromMilliseconds(750),
    };
    private readonly HttpClient configClient = new(
        new HttpClientHandler { UseProxy = false })
    {
        Timeout = TimeSpan.FromSeconds(3),
    };
    private readonly System.Windows.Forms.Timer healthTimer = new() { Interval = 1500 };
    private readonly TaskCompletionSource<bool> browserReadyCompletion = new(
        TaskCreationOptions.RunContinuationsAsynchronously);
    private Uri? webAppUri;
    private CancellationTokenSource? navigationPipeCancellation;
    private Task? navigationPipeTask;
    private bool browserReady;
    private bool checkingHealth;
    private bool openingClient;
    private int failedHealthChecks;

    internal bool InitializationFailed { get; private set; }
    internal string? FailureReason { get; private set; }

    internal CompanionWindow(
        string uiUrl,
        string dataDirectory,
        bool smokeTest,
        string? navigationPipeName)
    {
        uiUri = new Uri(uiUrl);
        clientConfigUri = new Uri(uiUri, "api/client-config");
        this.navigationPipeName = navigationPipeName;
        this.smokeTest = smokeTest;
        smokeExpectedTitle = smokeTest
            ? NullIfWhiteSpace(Environment.GetEnvironmentVariable(SmokeExpectedTitleVariable))
            : null;
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

        var creationProperties = new CoreWebView2CreationProperties
        {
            UserDataFolder = Path.Combine(dataDirectory, "WebView2"),
        };
        if (smokeTest) creationProperties.AdditionalBrowserArguments = FakeMediaArguments;
        browser = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = BackColor,
            CreationProperties = creationProperties,
        };

        var toolbar = new ToolStrip
        {
            AutoSize = true,
            BackColor = SystemColors.Control,
            Dock = DockStyle.Top,
            ForeColor = SystemColors.ControlText,
            GripStyle = ToolStripGripStyle.Hidden,
            Padding = new Padding(8, 4, 8, 4),
            Renderer = new ToolStripSystemRenderer(),
        };
        backButton.Enabled = false;
        homeButton.Enabled = false;
        settingsButton.Enabled = false;
        reloadButton.Enabled = false;
        toolbar.Items.AddRange(
        [
            backButton,
            new ToolStripSeparator(),
            homeButton,
            settingsButton,
            new ToolStripSeparator(),
            reloadButton,
        ]);
        Controls.Add(browser);
        Controls.Add(toolbar);

        backButton.Click += (_, _) =>
        {
            if (browser.CoreWebView2?.CanGoBack == true) browser.CoreWebView2.GoBack();
        };
        homeButton.Click += async (_, _) => await OpenClientFromConfig(showErrors: true);
        settingsButton.Click += (_, _) => NavigateInWindow(uiUri);
        reloadButton.Click += (_, _) => browser.CoreWebView2?.Reload();
        Shown += async (_, _) =>
        {
            StartNavigationPipe();
            await InitializeBrowser();
        };
        healthTimer.Tick += async (_, _) => await CheckServiceHealth();
        FormClosed += (_, _) =>
        {
            browserReady = false;
            browserReadyCompletion.TrySetCanceled();
            StopNavigationPipe();
            healthTimer.Stop();
            healthTimer.Dispose();
            healthClient.Dispose();
            configClient.Dispose();
        };
    }

    private async Task InitializeBrowser()
    {
        try
        {
            await browser.EnsureCoreWebView2Async().WaitAsync(TimeSpan.FromSeconds(20));
            var core = browser.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = true;
            core.Settings.AreDevToolsEnabled = false;
            await InjectCompanionMarker(core);

            core.NewWindowRequested += (_, args) =>
            {
                args.Handled = true;
                if (IsTrustedAddress(args.Uri) && Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri))
                {
                    NavigateInWindow(uri);
                }
                else
                {
                    OpenExternal(args.Uri);
                }
            };
            core.NavigationStarting += (_, args) =>
            {
                if (IsTrustedAddress(args.Uri)) return;
                args.Cancel = true;
                OpenExternal(args.Uri);
            };
            core.PermissionRequested += (_, args) =>
            {
                if (webAppUri is not null && IsSameOrigin(args.Uri, webAppUri)) return;
                args.SavesInProfile = false;
                args.State = CoreWebView2PermissionState.Deny;
            };
            core.ScreenCaptureStarting += (_, args) =>
            {
                if (webAppUri is not null &&
                    IsSameOrigin(args.OriginalSourceFrameInfo.Source, webAppUri)) return;
                args.Cancel = true;
            };
            core.WebMessageReceived += async (_, args) =>
            {
                string message;
                try
                {
                    message = args.TryGetWebMessageAsString();
                }
                catch
                {
                    return;
                }
                if (message == "open-client") await OpenClientFromConfig(showErrors: true);
            };
            core.HistoryChanged += (_, _) => UpdateToolbar();
            core.NavigationCompleted += (_, _) => UpdateToolbar();
            core.DocumentTitleChanged += (_, _) => UpdateWindowTitle();

            var strictConfig = smokeExpectedTitle is not null;
            var destination = await GetClientDestination(strictConfig);
            if (strictConfig && webAppUri is null)
            {
                throw new InvalidOperationException(
                    "The smoke test expected a web client, but no webAppUrl is configured.");
            }

            CoreWebView2NavigationCompletedEventArgs result;
            try
            {
                result = await NavigateAndWait(destination, TimeSpan.FromSeconds(20));
            }
            catch (TimeoutException) when (!strictConfig && !IsSameOrigin(destination, uiUri))
            {
                destination = uiUri;
                result = await NavigateAndWait(uiUri, TimeSpan.FromSeconds(20));
            }
            if (!result.IsSuccess)
            {
                if (strictConfig || IsSameOrigin(destination, uiUri))
                {
                    throw new InvalidOperationException(
                        $"The Companion page failed to load ({result.WebErrorStatus}).");
                }
                result = await NavigateAndWait(uiUri, TimeSpan.FromSeconds(20));
                if (!result.IsSuccess)
                {
                    throw new InvalidOperationException(
                        $"The local settings page failed to load ({result.WebErrorStatus}).");
                }
            }

            homeButton.Enabled = true;
            settingsButton.Enabled = true;
            reloadButton.Enabled = true;
            browserReady = true;
            browserReadyCompletion.TrySetResult(true);
            healthTimer.Start();
            if (smokeTest)
            {
                if (smokeExpectedTitle is not null)
                {
                    await WaitForDocumentTitle(smokeExpectedTitle, TimeSpan.FromSeconds(20));
                }
                else
                {
                    await Task.Delay(250);
                }
                Close();
            }
        }
        catch (Exception error)
        {
            browserReadyCompletion.TrySetCanceled();
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

    private void StartNavigationPipe()
    {
        if (navigationPipeName is null || navigationPipeTask is not null || IsDisposed) return;
        navigationPipeCancellation = new CancellationTokenSource();
        var cancellationToken = navigationPipeCancellation.Token;
        navigationPipeTask = Task.Run(
            () => ListenForNavigationRequestsAsync(navigationPipeName, cancellationToken),
            cancellationToken);
    }

    private void StopNavigationPipe()
    {
        var cancellation = navigationPipeCancellation;
        var task = navigationPipeTask;
        navigationPipeCancellation = null;
        navigationPipeTask = null;
        if (cancellation is null) return;

        cancellation.Cancel();
        if (task is null)
        {
            cancellation.Dispose();
            return;
        }
        _ = task.ContinueWith(
            _ => cancellation.Dispose(),
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
    }

    private async Task ListenForNavigationRequestsAsync(
        string pipeName,
        CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                using var pipe = new NamedPipeServerStream(
                    pipeName,
                    PipeDirection.InOut,
                    1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly,
                    MaxNavigationRequestBytes,
                    1024);
                await pipe.WaitForConnectionAsync(cancellationToken).ConfigureAwait(false);
                await HandleNavigationPipeClientAsync(pipe, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch
            {
                try
                {
                    await Task.Delay(200, cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }
    }

    private async Task HandleNavigationPipeClientAsync(
        NamedPipeServerStream pipe,
        CancellationToken cancellationToken)
    {
        using var requestTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        // First-run WebView2 setup can consume the 20s runtime deadline, both
        // initial 20s navigation attempts, and the room navigation itself.
        // Finish before Node's 110s IPC deadline.
        requestTimeout.CancelAfter(TimeSpan.FromSeconds(100));
        var requestToken = requestTimeout.Token;
        NavigationPipeResponse response;
        try
        {
            var line = await ReadNavigationLineAsync(pipe, requestToken).ConfigureAwait(false);
            var request = ParseNavigationRequest(line);
            using var navigationCancellation =
                CancellationTokenSource.CreateLinkedTokenSource(requestToken);
            using var disconnectMonitorCancellation =
                CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            var disconnectMonitor = CancelNavigationOnDisconnectAsync(
                pipe,
                navigationCancellation,
                disconnectMonitorCancellation.Token);
            try
            {
                response = await DispatchNavigationAsync(
                    request.Url,
                    navigationCancellation.Token).ConfigureAwait(false);
            }
            finally
            {
                disconnectMonitorCancellation.Cancel();
                await disconnectMonitor.ConfigureAwait(false);
            }
        }
        catch (InvalidDataException error)
        {
            response = new NavigationPipeResponse(false, error.Message);
        }
        catch (JsonException)
        {
            response = new NavigationPipeResponse(false, "The navigation request is not valid JSON.");
        }
        catch (DecoderFallbackException)
        {
            response = new NavigationPipeResponse(false, "The navigation request is not valid UTF-8.");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            response = new NavigationPipeResponse(false, "The navigation request timed out.");
        }

        try
        {
            await WriteNavigationResponseAsync(pipe, response, cancellationToken).ConfigureAwait(false);
        }
        catch when (!cancellationToken.IsCancellationRequested)
        {
            // A client may disconnect before reading its response. Keep accepting new clients.
        }
    }

    private static async Task CancelNavigationOnDisconnectAsync(
        Stream stream,
        CancellationTokenSource navigationCancellation,
        CancellationToken cancellationToken)
    {
        try
        {
            var unexpectedInput = new byte[1];
            await stream.ReadAsync(unexpectedInput, cancellationToken).ConfigureAwait(false);
            navigationCancellation.Cancel();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // The navigation completed while the browser-side request was still connected.
        }
        catch
        {
            navigationCancellation.Cancel();
        }
    }

    private static async Task<string> ReadNavigationLineAsync(
        Stream stream,
        CancellationToken cancellationToken)
    {
        using var body = new MemoryStream();
        var buffer = new byte[1024];
        while (true)
        {
            var bytesRead = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
            if (bytesRead == 0)
            {
                throw new InvalidDataException("The navigation request ended before its newline.");
            }

            var newline = Array.IndexOf(buffer, (byte)'\n', 0, bytesRead);
            var payloadBytes = newline >= 0 ? newline : bytesRead;
            if (body.Length + payloadBytes > MaxNavigationRequestBytes)
            {
                throw new InvalidDataException("The navigation request is too large.");
            }
            body.Write(buffer, 0, payloadBytes);
            if (newline < 0) continue;

            var payload = body.ToArray();
            var payloadLength = payload.Length;
            if (payloadLength > 0 && payload[payloadLength - 1] == '\r') payloadLength--;
            return StrictUtf8.GetString(payload, 0, payloadLength);
        }
    }

    private static NavigationPipeRequest ParseNavigationRequest(string value)
    {
        using var document = JsonDocument.Parse(
            value,
            new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 8,
            });
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException("The navigation request must be a JSON object.");
        }

        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in root.EnumerateObject())
        {
            if (!names.Add(property.Name) ||
                property.Name is not ("version" or "requestId" or "url"))
            {
                throw new InvalidDataException("The navigation request has unsupported fields.");
            }
        }
        if (names.Count != 3 ||
            !root.TryGetProperty("version", out var version) ||
            version.ValueKind != JsonValueKind.Number ||
            !version.TryGetInt32(out var protocolVersion) ||
            protocolVersion != 1)
        {
            throw new InvalidDataException("The navigation protocol version is unsupported.");
        }
        if (!root.TryGetProperty("requestId", out var requestIdValue) ||
            requestIdValue.ValueKind != JsonValueKind.String ||
            requestIdValue.GetString() is not { } requestId ||
            string.IsNullOrWhiteSpace(requestId) ||
            requestId.Length > 128)
        {
            throw new InvalidDataException("The navigation requestId is invalid.");
        }
        if (!root.TryGetProperty("url", out var urlValue) ||
            urlValue.ValueKind != JsonValueKind.String ||
            urlValue.GetString() is not { } url ||
            string.IsNullOrWhiteSpace(url) ||
            url.Length > MaxNavigationUrlCharacters ||
            url != url.Trim())
        {
            throw new InvalidDataException("The navigation URL is invalid.");
        }
        return new NavigationPipeRequest(url);
    }

    private Task<NavigationPipeResponse> DispatchNavigationAsync(
        string value,
        CancellationToken cancellationToken)
    {
        if (cancellationToken.IsCancellationRequested || IsDisposed || !IsHandleCreated)
        {
            return Task.FromResult(
                new NavigationPipeResponse(false, "The Companion window is not available."));
        }

        var completion = new TaskCompletionSource<NavigationPipeResponse>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            BeginInvoke(new Action(async () =>
            {
                if (cancellationToken.IsCancellationRequested || IsDisposed)
                {
                    completion.TrySetResult(
                        new NavigationPipeResponse(false, "The Companion window is not available."));
                    return;
                }
                try
                {
                    completion.TrySetResult(
                        await NavigateFromPipeAsync(value, cancellationToken));
                }
                catch
                {
                    completion.TrySetResult(
                        new NavigationPipeResponse(false, "The Companion could not open the room."));
                }
            }));
        }
        catch (InvalidOperationException)
        {
            completion.TrySetResult(
                new NavigationPipeResponse(false, "The Companion window is not available."));
        }
        return completion.Task.WaitAsync(cancellationToken);
    }

    private async Task<NavigationPipeResponse> NavigateFromPipeAsync(
        string value,
        CancellationToken cancellationToken)
    {
        if (!TryParseNavigationUri(value, out var destination, out var validationError))
        {
            return new NavigationPipeResponse(false, validationError);
        }

        if (!browserReady)
        {
            await browserReadyCompletion.Task.WaitAsync(cancellationToken);
        }
        if (!browserReady || IsDisposed || browser.CoreWebView2 is null)
        {
            return new NavigationPipeResponse(false, "The Companion window is not available.");
        }

        try
        {
            await GetClientDestination(strict: true);
        }
        catch
        {
            return new NavigationPipeResponse(false, "The Companion client configuration is unavailable.");
        }
        cancellationToken.ThrowIfCancellationRequested();
        if (webAppUri is null || !IsSameOrigin(destination, webAppUri))
        {
            return new NavigationPipeResponse(false, "The room URL does not match the configured app origin.");
        }
        if (cancellationToken.IsCancellationRequested ||
            !browserReady || IsDisposed || browser.CoreWebView2 is null)
        {
            return new NavigationPipeResponse(false, "The Companion window is not available.");
        }

        CoreWebView2NavigationCompletedEventArgs result;
        try
        {
            result = await NavigateAndWait(
                destination,
                TimeSpan.FromSeconds(20),
                cancellationToken);
        }
        catch (TimeoutException)
        {
            return new NavigationPipeResponse(false, "The room page did not load in time.");
        }
        if (!result.IsSuccess)
        {
            return new NavigationPipeResponse(
                false,
                $"The room page failed to load ({result.WebErrorStatus}).");
        }
        cancellationToken.ThrowIfCancellationRequested();
        RestoreAndForeground();
        return new NavigationPipeResponse(true);
    }

    private static bool TryParseNavigationUri(
        string value,
        out Uri destination,
        out string validationError)
    {
        destination = null!;
        if (value.Length is < 1 or > MaxNavigationUrlCharacters ||
            value != value.Trim() ||
            !Uri.TryCreate(value, UriKind.Absolute, out destination!) ||
            !string.IsNullOrEmpty(destination.UserInfo) ||
            (destination.Scheme != Uri.UriSchemeHttps &&
             (destination.Scheme != Uri.UriSchemeHttp || !destination.IsLoopback)) ||
            !IsRoomNavigationPath(destination.AbsolutePath))
        {
            validationError =
                "The room URL must use HTTPS (or loopback HTTP) without credentials.";
            return false;
        }
        validationError = string.Empty;
        return true;
    }

    private static bool IsRoomNavigationPath(string path)
    {
        if (path is "/custom" or "/custom/") return true;
        const string roomPrefix = "/rooms/";
        if (!path.StartsWith(roomPrefix, StringComparison.Ordinal)) return false;
        var roomName = path[roomPrefix.Length..];
        if (roomName.EndsWith("/", StringComparison.Ordinal)) roomName = roomName[..^1];
        return roomName.Length > 0 && !roomName.Contains('/');
    }

    private void RestoreAndForeground()
    {
        if (IsDisposed) return;
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        if (!Visible) Show();
        BringToFront();
        Activate();
        Program.SetForegroundWindow(Handle);
    }

    private static async Task WriteNavigationResponseAsync(
        Stream stream,
        NavigationPipeResponse response,
        CancellationToken cancellationToken)
    {
        var json = response.Message is null
            ? JsonSerializer.Serialize(new { accepted = response.Accepted })
            : JsonSerializer.Serialize(new { accepted = response.Accepted, message = response.Message });
        var payload = StrictUtf8.GetBytes(json + "\n");
        await stream.WriteAsync(payload, cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
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

    private async Task OpenClientFromConfig(bool showErrors)
    {
        if (openingClient || IsDisposed || browser.CoreWebView2 is null) return;
        openingClient = true;
        try
        {
            var destination = await GetClientDestination(strict: true);
            NavigateInWindow(destination);
        }
        catch (Exception error)
        {
            if (showErrors && !IsDisposed)
            {
                MessageBox.Show(
                    this,
                    $"Could not open the voice-chat client.\n\n{error.Message}",
                    "LiveKit Companion",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }
        finally
        {
            openingClient = false;
        }
    }

    private async Task<Uri> GetClientDestination(bool strict)
    {
        try
        {
            using var response = await configClient.GetAsync(clientConfigUri);
            response.EnsureSuccessStatusCode();
            await using var body = await response.Content.ReadAsStreamAsync();
            using var config = await JsonDocument.ParseAsync(body);
            if (!config.RootElement.TryGetProperty("webAppUrl", out var value))
            {
                throw new InvalidOperationException("The Companion client configuration is incomplete.");
            }

            webAppUri = value.ValueKind switch
            {
                JsonValueKind.Null => null,
                JsonValueKind.String => ParseWebAppUri(value.GetString()),
                _ => throw new InvalidOperationException("The configured webAppUrl is invalid."),
            };
            return webAppUri ?? uiUri;
        }
        catch when (!strict)
        {
            return webAppUri ?? uiUri;
        }
    }

    private static Uri? ParseWebAppUri(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || !string.IsNullOrEmpty(uri.UserInfo))
        {
            throw new InvalidOperationException("The configured webAppUrl is not an absolute URL.");
        }
        if (uri.Scheme == Uri.UriSchemeHttps ||
            (uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback)) return uri;
        throw new InvalidOperationException(
            "The configured webAppUrl must use HTTPS (or loopback HTTP for development).");
    }

    private async Task<CoreWebView2NavigationCompletedEventArgs> NavigateAndWait(
        Uri destination,
        TimeSpan timeout,
        CancellationToken cancellationToken = default)
    {
        var navigation = new TaskCompletionSource<CoreWebView2NavigationCompletedEventArgs>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        ulong? navigationId = null;
        EventHandler<CoreWebView2NavigationStartingEventArgs> startingHandler =
            (_, args) => navigationId ??= args.NavigationId;
        EventHandler<CoreWebView2NavigationCompletedEventArgs> handler =
            (_, args) =>
            {
                if (args.NavigationId == navigationId) navigation.TrySetResult(args);
            };
        browser.CoreWebView2.NavigationStarting += startingHandler;
        browser.CoreWebView2.NavigationCompleted += handler;
        try
        {
            browser.CoreWebView2.Navigate(destination.AbsoluteUri);
            try
            {
                return await navigation.Task.WaitAsync(timeout, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                browser.CoreWebView2.Stop();
                throw;
            }
            catch (TimeoutException)
            {
                browser.CoreWebView2.Stop();
                throw;
            }
        }
        finally
        {
            browser.CoreWebView2.NavigationStarting -= startingHandler;
            browser.CoreWebView2.NavigationCompleted -= handler;
        }
    }

    private async Task WaitForDocumentTitle(string expected, TimeSpan timeout)
    {
        var timer = Stopwatch.StartNew();
        while (timer.Elapsed < timeout && !IsDisposed)
        {
            if (string.Equals(
                    browser.CoreWebView2.DocumentTitle,
                    expected,
                    StringComparison.Ordinal)) return;
            await Task.Delay(100);
        }
        throw new InvalidOperationException(
            $"The web client title did not become \"{expected}\" " +
            $"(actual: \"{browser.CoreWebView2.DocumentTitle}\").");
    }

    private static async Task InjectCompanionMarker(CoreWebView2 core)
    {
        var script =
            "if (window === window.top && " +
            "!Object.prototype.hasOwnProperty.call(window, '__LIVEKIT_COMPANION__')) {" +
            "Object.defineProperty(window, '__LIVEKIT_COMPANION__', {" +
            "value: Object.freeze({host: 'webview2', platform: 'windows', version: 1, " +
            "appVersion: " + JsonSerializer.Serialize(CompanionAppVersion) + "}), " +
            "configurable: false, enumerable: true, writable: false" +
            "});}";
        await core.AddScriptToExecuteOnDocumentCreatedAsync(script);
    }

    private void NavigateInWindow(Uri destination)
    {
        if (browser.CoreWebView2 is null || !IsTrustedAddress(destination)) return;
        browser.CoreWebView2.Navigate(destination.AbsoluteUri);
    }

    private bool IsTrustedAddress(string value)
    {
        return Uri.TryCreate(value, UriKind.Absolute, out var candidate) &&
               IsTrustedAddress(candidate);
    }

    private bool IsTrustedAddress(Uri candidate)
    {
        return IsSameOrigin(candidate, uiUri) ||
               (webAppUri is not null && IsSameOrigin(candidate, webAppUri));
    }

    private static bool IsSameOrigin(string value, Uri expected)
    {
        return Uri.TryCreate(value, UriKind.Absolute, out var candidate) &&
               IsSameOrigin(candidate, expected);
    }

    private static bool IsSameOrigin(Uri candidate, Uri expected)
    {
        return string.Equals(candidate.Scheme, expected.Scheme, StringComparison.OrdinalIgnoreCase) &&
               string.Equals(candidate.IdnHost, expected.IdnHost, StringComparison.OrdinalIgnoreCase) &&
               candidate.Port == expected.Port;
    }

    private void UpdateToolbar()
    {
        if (!IsDisposed && browser.CoreWebView2 is not null)
        {
            backButton.Enabled = browser.CoreWebView2.CanGoBack;
        }
    }

    private void UpdateWindowTitle()
    {
        if (IsDisposed || browser.CoreWebView2 is null) return;
        var documentTitle = NullIfWhiteSpace(browser.CoreWebView2.DocumentTitle);
        Text = documentTitle is null ? "LiveKit Companion" : $"{documentTitle} — LiveKit Companion";
    }

    private static ToolStripButton CreateToolbarButton(string text)
    {
        return new ToolStripButton(text)
        {
            AutoSize = true,
            DisplayStyle = ToolStripItemDisplayStyle.Text,
            Margin = new Padding(2, 0, 2, 0),
            Padding = new Padding(6, 2, 6, 2),
        };
    }

    private static string? NullIfWhiteSpace(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static string ResolveCompanionAppVersion()
    {
        var packagedVersion = Program.ReadAssemblyMetadata("CompanionAppVersion");
        if (NullIfWhiteSpace(packagedVersion) is { } version) return version;

        var assemblyVersion = Assembly.GetExecutingAssembly().GetName().Version;
        return assemblyVersion is null
            ? "0.0.0"
            : $"{assemblyVersion.Major}.{assemblyVersion.Minor}.{Math.Max(assemblyVersion.Build, 0)}";
    }

    private static void OpenExternal(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)) return;
        try
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true })?.Dispose();
        }
        catch
        {
            // A missing or locked-down default browser should not crash the Companion window.
        }
    }

    private sealed record NavigationPipeRequest(string Url);

    private sealed record NavigationPipeResponse(bool Accepted, string? Message = null);
}
