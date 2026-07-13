using System.Diagnostics;
using System.Runtime.InteropServices;

namespace LiveKitCompanion;

internal sealed class TrayIcon : IDisposable
{
    private const uint CallbackMessage = 0x8001;
    private const uint WindowDestroy = 0x0002;
    private const uint LeftButtonDoubleClick = 0x0203;
    private const uint RightButtonUp = 0x0205;
    private const uint ContextMenu = 0x007B;
    private const uint IconMessage = 0x00000001;
    private const uint IconHandle = 0x00000002;
    private const uint IconTip = 0x00000004;
    private const uint NotifyAdd = 0x00000000;
    private const uint NotifyDelete = 0x00000002;
    private const uint MenuString = 0x00000000;
    private const uint MenuSeparator = 0x00000800;
    private const uint TrackRightButton = 0x0002;
    private const uint TrackReturnCommand = 0x0100;
    private const uint ImageIcon = 1;
    private const uint LoadFromFile = 0x0010;
    private const uint LoadDefaultSize = 0x0040;
    private const uint OpenCommand = 1;
    private const uint ExitCommand = 2;

    private static TrayIcon? active;
    private static readonly WindowProcedure WindowProcedureCallback = WindowProcedure;

    private readonly string uiUrl;
    private readonly Action onExit;
    private readonly string className = $"LiveKitCompanionTray-{Environment.ProcessId}";
    private nint window;
    private nint icon;
    private bool disposed;

    internal TrayIcon(string uiUrl, string? iconPath, Action onExit)
    {
        if (!Uri.TryCreate(uiUrl, UriKind.Absolute, out var uri) || !uri.IsLoopback)
        {
            throw new ArgumentException("The companion UI URL must be local.", nameof(uiUrl));
        }
        this.uiUrl = uiUrl;
        this.onExit = onExit;

        icon = iconPath is null
            ? nint.Zero
            : LoadImageW(nint.Zero, iconPath, ImageIcon, 0, 0, LoadFromFile | LoadDefaultSize);
        if (iconPath is not null && icon == nint.Zero) throw Win32Failure("load tray icon");
        active = this;

        var instance = GetModuleHandleW(null);
        var classRegistered = false;
        try
        {
            var windowClass = new WindowClass
            {
                WindowProcedure = WindowProcedureCallback,
                Instance = instance,
                ClassName = className,
            };
            if (RegisterClassW(ref windowClass) == 0) throw Win32Failure("register tray window");
            classRegistered = true;

            window = CreateWindowExW(
                0,
                className,
                "LiveKit Companion",
                0,
                0,
                0,
                0,
                0,
                nint.Zero,
                nint.Zero,
                instance,
                nint.Zero);
            if (window == nint.Zero) throw Win32Failure("create tray window");

            var data = CreateNotifyData();
            if (!Shell_NotifyIconW(NotifyAdd, ref data)) throw Win32Failure("add tray icon");
        }
        catch
        {
            if (window != nint.Zero) DestroyWindow(window);
            if (classRegistered) UnregisterClassW(className, instance);
            if (icon != nint.Zero) DestroyIcon(icon);
            window = nint.Zero;
            icon = nint.Zero;
            if (ReferenceEquals(active, this)) active = null;
            throw;
        }
    }

    internal void Run()
    {
        while (GetMessageW(out var message, nint.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref message);
            DispatchMessageW(ref message);
        }
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        if (window != nint.Zero)
        {
            var data = CreateNotifyData();
            Shell_NotifyIconW(NotifyDelete, ref data);
            DestroyWindow(window);
            window = nint.Zero;
        }
        if (icon != nint.Zero)
        {
            DestroyIcon(icon);
            icon = nint.Zero;
        }
        UnregisterClassW(className, GetModuleHandleW(null));
        if (ReferenceEquals(active, this)) active = null;
    }

    private NotifyIconData CreateNotifyData() => new()
    {
        Size = (uint)Marshal.SizeOf<NotifyIconData>(),
        Window = window,
        Id = 1,
        Flags = IconMessage | IconHandle | IconTip,
        CallbackMessage = CallbackMessage,
        Icon = icon,
        Tip = "LiveKit Companion",
        Info = string.Empty,
        InfoTitle = string.Empty,
    };

    private static nint WindowProcedure(nint window, uint message, nuint word, nint parameter)
    {
        var instance = active;
        if (instance is null) return DefWindowProcW(window, message, word, parameter);
        if (message == CallbackMessage)
        {
            var mouseMessage = unchecked((uint)parameter.ToInt64());
            if (mouseMessage == LeftButtonDoubleClick)
            {
                instance.OpenUi();
            }
            else if (mouseMessage is RightButtonUp or ContextMenu)
            {
                instance.ShowMenu();
            }
            return nint.Zero;
        }
        if (message == WindowDestroy)
        {
            PostQuitMessage(0);
            return nint.Zero;
        }
        return DefWindowProcW(window, message, word, parameter);
    }

    private void ShowMenu()
    {
        var menu = CreatePopupMenu();
        if (menu == nint.Zero) return;
        try
        {
            AppendMenuW(menu, MenuString, OpenCommand, "Open LiveKit Companion");
            AppendMenuW(menu, MenuSeparator, 0, null);
            AppendMenuW(menu, MenuString, ExitCommand, "Exit");
            GetCursorPos(out var point);
            SetForegroundWindow(window);
            var command = TrackPopupMenu(
                menu,
                TrackRightButton | TrackReturnCommand,
                point.X,
                point.Y,
                0,
                window,
                nint.Zero);
            if (command == OpenCommand) OpenUi();
            if (command == ExitCommand)
            {
                onExit();
                DestroyWindow(window);
                window = nint.Zero;
            }
        }
        finally
        {
            DestroyMenu(menu);
        }
    }

    private void OpenUi()
    {
        try
        {
            var edge = FindEdge();
            var startInfo = edge is null
                ? new ProcessStartInfo(uiUrl) { UseShellExecute = true }
                : new ProcessStartInfo(edge) { UseShellExecute = true };
            if (edge is not null) startInfo.ArgumentList.Add($"--app={uiUrl}");
            Process.Start(startInfo);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"Could not open companion UI: {error.Message}");
        }
    }

    private static string? FindEdge()
    {
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "Microsoft", "Edge", "Application", "msedge.exe"),
        };
        return candidates.FirstOrDefault(File.Exists);
    }

    private static Exception Win32Failure(string operation) =>
        new InvalidOperationException($"Could not {operation} (Win32 {Marshal.GetLastWin32Error()}).");

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate nint WindowProcedureDelegate(
        nint window,
        uint message,
        nuint word,
        nint parameter);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WindowClass
    {
        internal uint Style;
        internal WindowProcedureDelegate WindowProcedure;
        internal int ClassExtra;
        internal int WindowExtra;
        internal nint Instance;
        internal nint Icon;
        internal nint Cursor;
        internal nint Background;
        [MarshalAs(UnmanagedType.LPWStr)] internal string? MenuName;
        [MarshalAs(UnmanagedType.LPWStr)] internal string ClassName;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NotifyIconData
    {
        internal uint Size;
        internal nint Window;
        internal uint Id;
        internal uint Flags;
        internal uint CallbackMessage;
        internal nint Icon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] internal string Tip;
        internal uint State;
        internal uint StateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] internal string Info;
        internal uint Version;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] internal string InfoTitle;
        internal uint InfoFlags;
        internal Guid GuidItem;
        internal nint BalloonIcon;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Message
    {
        internal nint Window;
        internal uint Value;
        internal nuint Word;
        internal nint Parameter;
        internal uint Time;
        internal Point Point;
        internal uint Private;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        internal int X;
        internal int Y;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern nint GetModuleHandleW(string? moduleName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern ushort RegisterClassW(ref WindowClass windowClass);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool UnregisterClassW(string className, nint instance);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern nint CreateWindowExW(
        uint extendedStyle,
        string className,
        string windowName,
        uint style,
        int x,
        int y,
        int width,
        int height,
        nint parent,
        nint menu,
        nint instance,
        nint parameter);

    [DllImport("user32.dll")]
    private static extern bool DestroyWindow(nint window);

    [DllImport("user32.dll")]
    private static extern nint DefWindowProcW(nint window, uint message, nuint word, nint parameter);

    [DllImport("user32.dll")]
    private static extern int GetMessageW(out Message message, nint window, uint minimum, uint maximum);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref Message message);

    [DllImport("user32.dll")]
    private static extern nint DispatchMessageW(ref Message message);

    [DllImport("user32.dll")]
    private static extern void PostQuitMessage(int exitCode);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern nint LoadImageW(
        nint instance,
        string name,
        uint type,
        int width,
        int height,
        uint flags);

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(nint icon);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Shell_NotifyIconW(uint message, ref NotifyIconData data);

    [DllImport("user32.dll")]
    private static extern nint CreatePopupMenu();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool AppendMenuW(nint menu, uint flags, nuint identifier, string? value);

    [DllImport("user32.dll")]
    private static extern uint TrackPopupMenu(
        nint menu,
        uint flags,
        int x,
        int y,
        int reserved,
        nint window,
        nint rectangle);

    [DllImport("user32.dll")]
    private static extern bool DestroyMenu(nint menu);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out Point point);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(nint window);
}
