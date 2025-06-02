using Godot;
using System.Runtime.InteropServices;
using System;

[GlobalClass]
public partial class WindowAPI : Node
{

   public enum WindowsStyle
	{
		ToolWindow,
	}

	[DllImport("user32.dll",SetLastError = true)]
	private static extern int GetWindowLong(IntPtr hWnd , int nIndex);
	[DllImport("user32.dll",SetLastError = true)]
	private static extern int SetWindowLong(IntPtr hWnd , int nIndex , IntPtr dwNewLong);
	[DllImport("user32.dll",SetLastError = true)]
	private static extern bool SetWindowPos(IntPtr hWnd , IntPtr hWndInsertAfter, int X , int Y , int cx , int cy , uint uFlags);

	//常量定义
	private const int GWL_EXSTYLE = -20;    //扩展样式索性
	private const IntPtr WS_EX_APPWINDOW = 0x00040000;
	private const IntPtr WS_EX_TOOLWINDOW = 0x00000080;//工具窗口扩展样式
	private const int SWP_NOMOVE = 0x0002;
	private const int SWP_NOSIZE = 0x0001;
	private const int SWP_NOZORDER = 0x0004;
	private const int SWP_FRAMECHANGED = 0x0020;

	public void Setwindowstyle (Window window , WindowsStyle windowsStyle)
	{
		if (window == null) return; 
		IntPtr windowHandle = (IntPtr)DisplayServer.WindowGetNativeHandle((DisplayServer.HandleType)0,0);
		
		if(windowHandle == IntPtr.Zero) return;
		
		//获取当前窗口样式
		IntPtr exStyle = GetWindowLong(windowHandle,GWL_EXSTYLE);
		switch (windowsStyle)
		{
			case WindowsStyle.ToolWindow:
			IntPtr newExStyle = exStyle & ~WS_EX_APPWINDOW | WS_EX_TOOLWINDOW;
			SetWindowLong(windowHandle,GWL_EXSTYLE,newExStyle);
			SetWindowPos(windowHandle,0,0,0,0,0,SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
			break;
		}
	}

}
