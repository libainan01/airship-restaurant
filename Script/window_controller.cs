using Godot;
using System;
using System.Runtime.InteropServices;

public partial class window_controller : Node
{
    //WinAPI常量
	private const int GWL_EXSTYLE = -20;
	private const int WS_EX_LAYERED = 0x80000;
	private const int WS_EX_TRANSPARENT = 0x20;

	// 导入WinAPI常量
	[DllImport("user32.dll")]
	private static extern IntPtr GetActiveWindow();

	[DllImport("user32.dll",SetLastError = true)]
	private static extern IntPtr GetForegroundWindow();

	[DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

	// 32位系统用下面两个函数（如果你确定是64位，可以忽略）
    [DllImport("user32.dll", EntryPoint = "GetWindowLong", SetLastError = true)]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLong", SetLastError = true)]
    private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
	public void set_window_click_through(IntPtr _hwnd)
	{
		GD.Print("设置窗口点击穿透");

        // 获取Godot主窗口句柄
        IntPtr hwnd = _hwnd;

        if (hwnd == IntPtr.Zero)
        {
            GD.PrintErr("无法获取Godot窗口句柄");
            return;
        }

        GD.Print("Godot窗口句柄: " + hwnd);

        // 设置点击穿透
        SetWindowClickThrough(hwnd);
	}

	private void SetWindowClickThrough(IntPtr hwnd)
    {
        if (IntPtr.Size == 8)
        {
            // 64位系统
            IntPtr exStyle = GetWindowLongPtr(hwnd, GWL_EXSTYLE);
            IntPtr newExStyle = new IntPtr(exStyle.ToInt64() | WS_EX_LAYERED | WS_EX_TRANSPARENT);
            SetWindowLongPtr(hwnd, GWL_EXSTYLE, newExStyle);
        }
        else
        {
            // 32位系统
            int exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
            int newExStyle = exStyle | WS_EX_LAYERED | WS_EX_TRANSPARENT;
            SetWindowLong(hwnd, GWL_EXSTYLE, newExStyle);
        }

        GD.Print("窗口已设置为点击穿透");
    }

}
