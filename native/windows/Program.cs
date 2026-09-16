using System.Text.Json;
using Windows.Security.Credentials.UI;

internal static class Program
{
    private static bool completed;

    private static void WriteResult(string status, string? error = null)
    {
        if (completed) return;
        completed = true;
        var result = new Dictionary<string, string> { ["status"] = status };
        if (error is not null) result["error"] = error;
        Console.WriteLine(JsonSerializer.Serialize(result));
        Environment.ExitCode = status == "verified" ? 0 : status == "unavailable" ? 2 : 1;
    }

    [STAThread]
    private static void Main(string[] args)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
        {
            WriteResult("unavailable", "此桥接器需要 Windows 11 或更高版本");
            return;
        }
        var reason = "请确认允许 AI 继续执行关键操作";
        var index = Array.IndexOf(args, "--reason");
        if (index >= 0 && index + 1 < args.Length) reason = args[index + 1];

        ApplicationConfiguration.Initialize();
        using var window = new Form
        {
            Text = "DSH 人工确认",
            ClientSize = new System.Drawing.Size(420, 120),
            StartPosition = FormStartPosition.CenterScreen,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
        };
        window.Controls.Add(new Label { Text = reason, Dock = DockStyle.Fill, Padding = new Padding(16) });
        window.FormClosed += (_, _) => WriteResult("cancelled");
        window.Shown += async (_, _) =>
        {
            try
            {
                var availability = await UserConsentVerifier.CheckAvailabilityAsync();
                if (window.IsDisposed) return;
                if (availability != UserConsentVerifierAvailability.Available)
                    WriteResult("unavailable", availability.ToString());
                else
                {
                    // 桌面程序必须把系统对话框绑定到自己的窗口。
                    var result = await UserConsentVerifierInterop.RequestVerificationForWindowAsync(window.Handle, reason);
                    if (result == UserConsentVerificationResult.Verified) WriteResult("verified");
                    else if (result == UserConsentVerificationResult.Canceled) WriteResult("cancelled");
                    else WriteResult("failed", result.ToString());
                }
            }
            catch (Exception error) { WriteResult("failed", error.Message); }
            finally { if (!window.IsDisposed) window.Close(); }
        };
        Application.Run(window);
    }
}
