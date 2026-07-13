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

        if (args.Length != 1 || !TryResolveVirtualKey(args[0], out var virtualKey))
        {
            Console.Error.WriteLine("Unsupported PTT key.");
            return 2;
        }

        var wasDown = false;
        while (true)
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
