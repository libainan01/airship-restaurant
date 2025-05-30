using Godot;
using System.Runtime.InteropServices;
using System;

public partial class WindowAPI : Node
{

   public enum WindowsStyle
    {
        ToolWindow,
    }

    [DllImport("user32.dll",SetLastError = true)]
    private static extern int GetWindowLong(ulong hWnd , int nIndex);
    [DllImport("user32.dll",SetLastError = true)]
    private static extern int SetWindowLong(ulong hWnd , int nIndex , int dwNewLong);
    [DllImport("user32.dll",SetLastError = true)]
    private static extern bool SetWindowPos(ulong hWnd , ulong hWndInsertAfter, int X , int Y , int cx , int cy , uint uFlags);

    //常量定义
    private const int GWL_EXSTYLE = -20;    //扩展样式索性
    private const int WS_EX_TOOLWINDOW = 0x00000080;//工具窗口扩展样式
    private const int SWP_NOMOVE = 0x0002;
    private const int SWP_NOSIZE = 0x0001;
    private const int SWP_NOZORDER = 0x0004;
    private const int SWP_FRAMECHANGED = 0x0020;

    private Window _dynamicWindow;

    public void Setwindowstyle (IntPtr hWnd,WindowsStyle windowsStyle)
    {
        switch (windowsStyle)
        {
            case WindowsStyle.ToolWindow:
            
            break;
        }
    }

}


