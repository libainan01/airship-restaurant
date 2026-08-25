using System;
using System.IO;
using System.Linq;
using Godot;

namespace AirshipRestaurant.Godot.Presentation;

public partial class G0Showcase : Node
{
    private InteractiveHotspot _groundStationHotspot = null!;
    private AtmosphereController _atmosphere = null!;
    private Label _statusLabel = null!;
    private Button _launcherButton = null!;
    private Control _quickMenu = null!;
    private Button _warehouseButton = null!;
    private Control _warehouseOverlay = null!;
    private Control _warehouseWindow = null!;
    private DesktopCompanionWindow _desktopWindow = null!;
    private Button _warehouseCloseButton = null!;
    private CheckButton _debugToggle = null!;
    private Node2D _debugRoot = null!;
    private Button _dawnButton = null!;
    private Button _noonButton = null!;
    private Button _eveningButton = null!;

    private string? _capturePath;
    private int _captureFramesRemaining;
    private bool _validationSucceeded = true;

    public override void _Ready()
    {
        GD.Print($"G0_ARGS {string.Join("|", OS.GetCmdlineUserArgs())}");
        ResolveNodes();
        ConnectUi();
        ReadCommandLine();

        _quickMenu.Visible = false;
        _warehouseOverlay.Visible = false;
        SetDebugVisible(_debugToggle.ButtonPressed);
        SetAtmosphere(AtmospherePeriod.Dawn, false);

        _validationSucceeded = ValidateG0Structure();

        if (OS.GetCmdlineUserArgs().Contains("--open-menu"))
        {
            ToggleQuickMenu();
        }

        if (OS.GetCmdlineUserArgs().Contains("--open-warehouse"))
        {
            OpenWarehouse();
        }

        var periodArgument = OS.GetCmdlineUserArgs()
            .FirstOrDefault(argument => argument.StartsWith("--period=", StringComparison.OrdinalIgnoreCase));
        if (periodArgument is not null)
        {
            ApplyPeriodArgument(periodArgument);
        }
        if (OS.GetCmdlineUserArgs().Contains("--validate-g0") && _capturePath is null)
        {
            GetTree().Quit(_validationSucceeded ? 0 : 1);
        }
    }

    public override void _Process(double delta)
    {
        if (_capturePath is null)
        {
            return;
        }

        _captureFramesRemaining -= 1;
        if (_captureFramesRemaining > 0)
        {
            return;
        }

        var texture = GetViewport().GetTexture();
        var image = texture?.GetImage();
        if (image is null || image.IsEmpty())
        {
            GD.PrintErr("G0_CAPTURE_FAILED viewport image unavailable for the active renderer");
            _capturePath = null;
            GetTree().Quit(1);
            return;
        }

        var directory = System.IO.Path.GetDirectoryName(_capturePath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var result = image.SavePng(_capturePath);
        GD.Print(result == Error.Ok
            ? $"G0_CAPTURE_OK path={_capturePath}"
            : $"G0_CAPTURE_FAILED error={result} path={_capturePath}");

        GetTree().Quit(result == Error.Ok && _validationSucceeded ? 0 : 1);
        _capturePath = null;
    }

    public override void _UnhandledInput(InputEvent inputEvent)
    {
        if (inputEvent.IsActionPressed("toggle_debug"))
        {
            _debugToggle.ButtonPressed = !_debugToggle.ButtonPressed;
            SetDebugVisible(_debugToggle.ButtonPressed);
            GetViewport().SetInputAsHandled();
            return;
        }

        if (inputEvent is not InputEventKey keyEvent || !keyEvent.Pressed || keyEvent.Echo)
        {
            return;
        }

        if (keyEvent.Keycode != Key.Escape)
        {
            return;
        }

        if (_warehouseOverlay.Visible)
        {
            CloseWarehouse();
        }
        else if (_quickMenu.Visible)
        {
            _quickMenu.Visible = false;
        }

        GetViewport().SetInputAsHandled();
    }

    private void ResolveNodes()
    {
        _groundStationHotspot = GetNode<InteractiveHotspot>("WorldRoot/GroundExchangeStation/InteractionRoot");
        _atmosphere = GetNode<AtmosphereController>("AtmosphereController");
        _statusLabel = GetNode<Label>("UILayer/UIRoot/StatusPanel/StatusLabel");
        _launcherButton = GetNode<Button>("UILayer/UIRoot/LauncherButton");
        _quickMenu = GetNode<Control>("UILayer/UIRoot/QuickMenu");
        _warehouseButton = GetNode<Button>("UILayer/UIRoot/QuickMenu/Content/WarehouseButton");
        _warehouseOverlay = GetNode<Control>("UILayer/UIRoot/WarehouseOverlay");
        _warehouseWindow = GetNode<Control>("UILayer/UIRoot/WarehouseOverlay/Center/WarehouseWindow");
        _desktopWindow = GetNode<DesktopCompanionWindow>("DesktopCompanionWindow");
        _warehouseCloseButton = GetNode<Button>("UILayer/UIRoot/WarehouseOverlay/Center/WarehouseWindow/Layout/Header/WarehouseCloseButton");
        _debugToggle = GetNode<CheckButton>("UILayer/UIRoot/QuickMenu/Content/DebugToggle");
        _debugRoot = GetNode<Node2D>("WorldRoot/GroundExchangeStation/DebugRoot");
        _dawnButton = GetNode<Button>("UILayer/UIRoot/QuickMenu/Content/PeriodButtons/DawnButton");
        _noonButton = GetNode<Button>("UILayer/UIRoot/QuickMenu/Content/PeriodButtons/NoonButton");
        _eveningButton = GetNode<Button>("UILayer/UIRoot/QuickMenu/Content/PeriodButtons/EveningButton");
    }

    private void ConnectUi()
    {
        _groundStationHotspot.Activated += OpenWarehouse;
        _groundStationHotspot.HoverChanged += OnHotspotHoverChanged;
        _launcherButton.Pressed += ToggleQuickMenu;
        _warehouseButton.Pressed += OpenWarehouse;
        _warehouseCloseButton.Pressed += CloseWarehouse;
        _debugToggle.Toggled += SetDebugVisible;
        _dawnButton.Pressed += () => SetAtmosphere(AtmospherePeriod.Dawn);
        _noonButton.Pressed += () => SetAtmosphere(AtmospherePeriod.Noon);
        _eveningButton.Pressed += () => SetAtmosphere(AtmospherePeriod.Evening);
    }

    private void ToggleQuickMenu()
    {
        _quickMenu.Visible = !_quickMenu.Visible;
        _statusLabel.Text = _quickMenu.Visible
            ? "功能入口已展开。场景热点与菜单会进入同一功能。"
            : "菜单已收起。你仍可直接点击右侧风铃交换站。";
    }

    private void OpenWarehouse()
    {
        _quickMenu.Visible = false;
        _warehouseOverlay.Visible = true;
        _statusLabel.Text = "仓库样板已打开：这里暂时只验证视觉、层级和入口。";
        _warehouseCloseButton.GrabFocus();
    }

    private void CloseWarehouse()
    {
        _warehouseOverlay.Visible = false;
        _statusLabel.Text = "仓库已关闭。场景仍保持当前时段与调试显示状态。";
        _launcherButton.GrabFocus();
    }

    private void OnHotspotHoverChanged(bool hovered)
    {
        _statusLabel.Text = hovered
            ? "风铃交换站：点击任意青色区域打开仓库；区域之间的空隙不会响应。"
            : "提示：点击右侧风铃交换站，或使用右下角功能入口。";
    }

    private void SetDebugVisible(bool visible)
    {
        _debugRoot.Visible = visible;
        GD.Print($"G0_DEBUG visible={visible} generated_nodes={_debugRoot.GetChildCount()}");
        _statusLabel.Text = visible
            ? "调试显示已开启：青色为点击区域，金色十字为场景锚点。"
            : "调试显示已关闭：点击区域仍然有效，但不会出现在游戏画面中。";
    }

    private void SetAtmosphere(AtmospherePeriod period, bool animate = true)
    {
        _atmosphere.SetPeriod(period, animate);
        var periodName = period switch
        {
            AtmospherePeriod.Noon => "正午",
            AtmospherePeriod.Evening => "傍晚",
            _ => "黎明"
        };
        _statusLabel.Text = $"当前氛围：{periodName}。颜色参数可以直接在 AtmosphereController 中调整。";
    }

    private void ApplyPeriodArgument(string argument)
    {
        var value = argument.Split('=', 2).LastOrDefault()?.Trim().ToLowerInvariant();
        var period = value switch
        {
            "noon" => AtmospherePeriod.Noon,
            "evening" => AtmospherePeriod.Evening,
            _ => AtmospherePeriod.Dawn
        };
        SetAtmosphere(period, false);
    }

    private void ReadCommandLine()
    {
        var captureArgument = OS.GetCmdlineUserArgs()
            .FirstOrDefault(argument => argument.StartsWith("--capture=", StringComparison.OrdinalIgnoreCase));
        if (captureArgument is null)
        {
            return;
        }

        var requestedPath = captureArgument.Split('=', 2).LastOrDefault();
        if (string.IsNullOrWhiteSpace(requestedPath))
        {
            GD.PrintErr("G0_CAPTURE_FAILED missing path");
            _validationSucceeded = false;
            return;
        }

        _capturePath = System.IO.Path.GetFullPath(requestedPath);
        if (!string.Equals(System.IO.Path.GetExtension(_capturePath), ".png", StringComparison.OrdinalIgnoreCase))
        {
            GD.PrintErr("G0_CAPTURE_FAILED capture path must end in .png");
            _capturePath = null;
            _validationSucceeded = false;
            return;
        }

        _captureFramesRemaining = 12;
    }

    private bool ValidateG0Structure()
    {
        var failures = new System.Collections.Generic.List<string>();
        var polygons = _groundStationHotspot.GetChildren().OfType<CollisionPolygon2D>().ToArray();
        if (polygons.Length < 2)
        {
            failures.Add("GroundStationHotspot requires at least two disconnected collision polygons.");
        }

        if (polygons.Any(polygon => polygon.Polygon.Length < 3))
        {
            failures.Add("Every interaction polygon requires at least three points.");
        }

        var anchors = GetNode<Node2D>("WorldRoot/GroundExchangeStation/StationAnchors").GetChildren().OfType<Marker2D>().ToArray();
        if (anchors.Length < 4)
        {
            failures.Add("StationAnchors requires work, item, dialogue and status anchors.");
        }

        if (_warehouseOverlay.MouseFilter != Control.MouseFilterEnum.Ignore)
        {
            failures.Add("WarehouseOverlay must ignore input outside the visible warehouse window.");
        }

        if (_warehouseWindow.MouseFilter != Control.MouseFilterEnum.Stop)
        {
            failures.Add("WarehouseWindow must accept input inside its own visible bounds.");
        }

        if (!GetViewport().TransparentBg)
        {
            failures.Add("The root viewport must preserve transparent desktop pixels.");
        }

        var backdrop = GetNode<Sprite2D>("WorldRoot/Backdrop");
        var atmosphereOverlay = GetNode<ColorRect>("AtmosphereCanvas/Overlay");
        if (backdrop.Visible || atmosphereOverlay.Color.A > 0.001f)
        {
            failures.Add("Desktop mode cannot draw a full-screen backdrop or atmosphere overlay.");
        }

        var launcherCenter = _launcherButton.GetGlobalRect().GetCenter();
        if (!_desktopWindow.IsPointOverInteractiveTarget(launcherCenter))
        {
            failures.Add("The folded launcher must be included in desktop input targets.");
        }

        if (_desktopWindow.IsPointOverInteractiveTarget(new Vector2(20, 20)))
        {
            failures.Add("Transparent desktop space must not be included in desktop input targets.");
        }

        if (failures.Count == 0)
        {
            GD.Print($"G0_VALIDATION_OK polygons={polygons.Length} anchors={anchors.Length} transparent=true desktop_input_targets={_desktopWindow.VisibleInputTargetCount}");
            return true;
        }

        foreach (var failure in failures)
        {
            GD.PrintErr($"G0_VALIDATION_FAILED {failure}");
        }

        return false;
    }
}
