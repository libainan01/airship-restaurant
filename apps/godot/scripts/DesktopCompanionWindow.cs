using System;
using System.Runtime.InteropServices;
using System.Linq;
using Godot;

namespace AirshipRestaurant.Godot.Presentation;

/// <summary>
/// Keeps the desktop-pet window visually transparent and lets mouse input fall
/// through to Windows unless the cursor is above an explicitly tagged target.
/// Add interactive controls or Area2D nodes to the "desktop_input" group.
/// </summary>
public partial class DesktopCompanionWindow : Node
{
    private const int GwlExStyle = -20;
    private const long WsExTransparent = 0x00000020L;
    private const string DesktopInputGroup = "desktop_input";

    private IntPtr _nativeWindow;
    private bool _isWindows;
    private bool _mousePressInProgress;
    private bool? _lastPassthroughState;

    public int VisibleInputTargetCount { get; private set; }

    public bool IsPassthroughActive => _lastPassthroughState == true;

    public override void _Ready()
    {
        GetViewport().TransparentBg = true;
        var window = GetWindow();
        window.Transparent = true;
        window.Borderless = true;
        window.AlwaysOnTop = true;
        window.Unresizable = true;

        _isWindows = OS.GetName() == "Windows" && DisplayServer.GetName() != "headless";
        if (!_isWindows || OS.GetCmdlineUserArgs().Contains("--disable-click-through"))
        {
            GD.Print("G0_DESKTOP_WINDOW transparent=true click_through=disabled");
            return;
        }

        var handle = DisplayServer.WindowGetNativeHandle(DisplayServer.HandleType.WindowHandle);
        _nativeWindow = new IntPtr(unchecked((long)handle));
        if (_nativeWindow == IntPtr.Zero)
        {
            GD.PrintErr("G0_DESKTOP_WINDOW native Windows handle unavailable");
            _isWindows = false;
            return;
        }

        RefreshPassthrough(force: true);
        GD.Print("G0_DESKTOP_WINDOW transparent=true click_through=dynamic");
    }

    public override void _ExitTree()
    {
        if (_isWindows && _nativeWindow != IntPtr.Zero)
        {
            SetWindowPassthrough(false);
        }
    }

    public override void _Process(double delta)
    {
        RefreshPassthrough();
    }

    public override void _Input(InputEvent inputEvent)
    {
        if (inputEvent is not InputEventMouseButton mouseButton)
        {
            return;
        }

        _mousePressInProgress = mouseButton.Pressed;
        RefreshPassthrough(force: true);
    }

    public bool IsPointOverInteractiveTarget(Vector2 viewportPoint)
    {
        VisibleInputTargetCount = 0;
        foreach (var node in GetTree().GetNodesInGroup(DesktopInputGroup))
        {
            switch (node)
            {
                case Control control when control.IsVisibleInTree():
                    VisibleInputTargetCount += 1;
                    if (control.GetGlobalRect().HasPoint(viewportPoint))
                    {
                        if (OS.GetCmdlineUserArgs().Contains("--trace-input-targets"))
                        {
                            GD.Print($"G0_INPUT_HIT point={viewportPoint} target={control.GetPath()} rect={control.GetGlobalRect()}");
                        }
                        return true;
                    }
                    break;
                case Area2D area when area.IsVisibleInTree():
                    VisibleInputTargetCount += 1;
                    if (ContainsPoint(area, viewportPoint))
                    {
                        if (OS.GetCmdlineUserArgs().Contains("--trace-input-targets"))
                        {
                            GD.Print($"G0_INPUT_HIT point={viewportPoint} target={area.GetPath()} polygons=true");
                        }
                        return true;
                    }
                    break;
            }
        }

        return false;
    }

    private void RefreshPassthrough(bool force = false)
    {
        if (!_isWindows || _nativeWindow == IntPtr.Zero)
        {
            return;
        }

        var clientPoint = GetClientMousePosition();
        var shouldPassThrough = !_mousePressInProgress && !IsPointOverInteractiveTarget(clientPoint);
        if (!force && _lastPassthroughState == shouldPassThrough)
        {
            return;
        }

        SetWindowPassthrough(shouldPassThrough);
        _lastPassthroughState = shouldPassThrough;
        GD.Print($"G0_CLICK_THROUGH active={shouldPassThrough} input_targets={VisibleInputTargetCount}");
    }

    private Vector2 GetClientMousePosition()
    {
        var globalMouse = DisplayServer.MouseGetPosition();
        var windowPosition = DisplayServer.WindowGetPosition();
        return new Vector2(globalMouse.X - windowPosition.X, globalMouse.Y - windowPosition.Y);
    }

    private static bool ContainsPoint(Area2D area, Vector2 viewportPoint)
    {
        foreach (var child in area.GetChildren())
        {
            if (child is not CollisionPolygon2D polygon || polygon.Disabled || polygon.Polygon.Length < 3)
            {
                continue;
            }

            var viewportPolygon = new Vector2[polygon.Polygon.Length];
            for (var index = 0; index < polygon.Polygon.Length; index += 1)
            {
                viewportPolygon[index] = polygon.ToGlobal(polygon.Polygon[index]);
            }

            if (Geometry2D.IsPointInPolygon(viewportPoint, viewportPolygon))
            {
                return true;
            }
        }

        return false;
    }

    private void SetWindowPassthrough(bool enabled)
    {
        var style = GetWindowLongPtr(_nativeWindow, GwlExStyle).ToInt64();
        var nextStyle = enabled ? style | WsExTransparent : style & ~WsExTransparent;
        if (style != nextStyle)
        {
            SetWindowLongPtr(_nativeWindow, GwlExStyle, new IntPtr(nextStyle));
        }
    }

    private static IntPtr GetWindowLongPtr(IntPtr window, int index)
    {
        return IntPtr.Size == 8
            ? GetWindowLongPtr64(window, index)
            : new IntPtr(GetWindowLong32(window, index));
    }

    private static void SetWindowLongPtr(IntPtr window, int index, IntPtr value)
    {
        if (IntPtr.Size == 8)
        {
            SetWindowLongPtr64(window, index, value);
        }
        else
        {
            SetWindowLong32(window, index, value.ToInt32());
        }
    }

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr window, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr64(IntPtr window, int index, IntPtr value);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong32(IntPtr window, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    private static extern int SetWindowLong32(IntPtr window, int index, int value);
}
