using System.Runtime.InteropServices;

namespace LiveKitCompanion;

internal static class Program
{
    private const int KeyDownMask = 0x8000;
    private const uint YesNoQuestion = 0x00000004 | 0x00000020 | 0x00010000;
    private const int DialogResultYes = 6;

    private static readonly Dictionary<string, int> NamedKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        ["BACKSPACE"] = 0x08,
        ["TAB"] = 0x09,
        ["ENTER"] = 0x0D,
        ["SHIFT"] = 0x10,
        ["CONTROL"] = 0x11,
        ["ALT"] = 0x12,
        ["CAPSLOCK"] = 0x14,
        ["ESCAPE"] = 0x1B,
        ["SPACE"] = 0x20,
        ["PAGEUP"] = 0x21,
        ["PAGEDOWN"] = 0x22,
        ["END"] = 0x23,
        ["HOME"] = 0x24,
        ["LEFT"] = 0x25,
        ["UP"] = 0x26,
        ["RIGHT"] = 0x27,
        ["DOWN"] = 0x28,
        ["INSERT"] = 0x2D,
        ["DELETE"] = 0x2E,
        ["XBUTTON1"] = 0x05,
        ["XBUTTON2"] = 0x06,
    };

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(nint owner, string text, string caption, uint type);

    private static int Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--approve-origin")
        {
            return PromptForOrigin(args[1]);
        }
        if (args.Length < 1 || !TryResolveVirtualKey(args[0], out var virtualKey))
        {
            Console.Error.WriteLine("Unsupported PTT key.");
            return 2;
        }

        if (!TryReadOption(args, "--ui-url", out var uiUrl) ||
            !TryReadOption(args, "--icon", out var iconPath))
        {
            Console.Error.WriteLine("Invalid companion helper options.");
            return 2;
        }

        using var cancellation = new CancellationTokenSource();
        if (uiUrl is not null)
        {
            var pollThread = new Thread(() => PollKey(virtualKey, cancellation.Token))
            {
                IsBackground = true,
                Name = "LiveKit Companion PTT",
            };
            pollThread.Start();
            try
            {
                using var trayIcon = new TrayIcon(uiUrl, iconPath, () =>
                {
                    Console.WriteLine("EXIT");
                    Console.Out.Flush();
                });
                trayIcon.Run();
            }
            catch (Exception error)
            {
                Console.Error.WriteLine($"Tray icon unavailable: {error.Message}");
                pollThread.Join();
            }
            finally
            {
                cancellation.Cancel();
                pollThread.Join(250);
            }
            return 0;
        }

        PollKey(virtualKey, cancellation.Token);
        return 0;
    }

    private static void PollKey(int virtualKey, CancellationToken cancellationToken)
    {
        var wasDown = false;
        while (!cancellationToken.IsCancellationRequested)
        {
            var isDown = (GetAsyncKeyState(virtualKey) & KeyDownMask) != 0;
            if (isDown != wasDown)
            {
                Console.WriteLine(isDown ? "DOWN" : "UP");
                Console.Out.Flush();
                wasDown = isDown;
            }
            Thread.Sleep(8);
        }
    }

    private static bool TryReadOption(string[] args, string option, out string? value)
    {
        value = null;
        for (var index = 1; index < args.Length; index += 2)
        {
            if (index + 1 >= args.Length) return false;
            if (args[index] == option)
            {
                value = args[index + 1];
            }
            else if (args[index] is not "--ui-url" and not "--icon")
            {
                return false;
            }
        }
        return true;
    }

    private static int PromptForOrigin(string origin)
    {
        if (origin.Length is < 1 or > 2048) return 2;

        var message = $"Allow {origin} to connect to LiveKit Companion?\n\n" +
                      "This grants access to push-to-talk and torrent cinema.";
        return MessageBoxW(nint.Zero, message, "LiveKit Companion", YesNoQuestion) == DialogResultYes
            ? 0
            : 1;
    }

    private static bool TryResolveVirtualKey(string name, out int virtualKey)
    {
        var normalized = name.Trim().ToUpperInvariant();
        if (NamedKeys.TryGetValue(normalized, out virtualKey)) return true;

        if (normalized.Length == 1 &&
            ((normalized[0] >= 'A' && normalized[0] <= 'Z') ||
             (normalized[0] >= '0' && normalized[0] <= '9')))
        {
            virtualKey = normalized[0];
            return true;
        }

        if (normalized.StartsWith('F') &&
            int.TryParse(normalized.AsSpan(1), out var functionKey) &&
            functionKey is >= 1 and <= 24)
        {
            virtualKey = 0x70 + functionKey - 1;
            return true;
        }

        virtualKey = 0;
        return false;
    }
}
