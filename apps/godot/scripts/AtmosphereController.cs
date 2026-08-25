using Godot;

namespace AirshipRestaurant.Godot.Presentation;

public enum AtmospherePeriod
{
    Dawn,
    Noon,
    Evening
}

[Tool]
public partial class AtmosphereController : Node
{
    [Export]
    public NodePath WorldModulatePath { get; set; } = new();

    [Export]
    public NodePath OverlayPath { get; set; } = new();

    [Export]
    public Color DawnWorldTint { get; set; } = new(1.0f, 0.79f, 0.68f, 1.0f);

    [Export]
    public Color DawnOverlay { get; set; } = new(0.62f, 0.22f, 0.14f, 0.0f);

    [Export]
    public Color NoonWorldTint { get; set; } = new(1.0f, 0.98f, 0.90f, 1.0f);

    [Export]
    public Color NoonOverlay { get; set; } = new(1.0f, 0.84f, 0.46f, 0.0f);

    [Export]
    public Color EveningWorldTint { get; set; } = new(0.72f, 0.60f, 0.84f, 1.0f);

    [Export]
    public Color EveningOverlay { get; set; } = new(0.20f, 0.08f, 0.34f, 0.0f);

    [Export(PropertyHint.Range, "0,3,0.05")]
    public double TransitionSeconds { get; set; } = 0.65;

    private AtmospherePeriod _previewPeriod = AtmospherePeriod.Dawn;
    private CanvasModulate? _worldModulate;
    private ColorRect? _overlay;
    private Tween? _transition;

    [Export]
    public AtmospherePeriod PreviewPeriod
    {
        get => _previewPeriod;
        set
        {
            _previewPeriod = value;
            if (IsInsideTree())
            {
                ResolveTargets();
                ApplyImmediate(value);
            }
        }
    }

    public AtmospherePeriod CurrentPeriod { get; private set; } = AtmospherePeriod.Dawn;

    public override void _Ready()
    {
        ResolveTargets();
        ApplyImmediate(_previewPeriod);
    }

    public void SetPeriod(AtmospherePeriod period, bool animate = true)
    {
        ResolveTargets();
        CurrentPeriod = period;
        _previewPeriod = period;

        var (worldTint, overlayTint) = GetPalette(period);
        if (!animate || TransitionSeconds <= 0.0 || _worldModulate is null || _overlay is null)
        {
            ApplyImmediate(period);
            return;
        }

        _transition?.Kill();
        _transition = CreateTween();
        _transition.SetParallel(true);
        _transition.SetEase(Tween.EaseType.InOut);
        _transition.SetTrans(Tween.TransitionType.Sine);
        _transition.TweenProperty(_worldModulate, "color", worldTint, TransitionSeconds);
        _transition.TweenProperty(_overlay, "color", overlayTint, TransitionSeconds);
    }

    private void ResolveTargets()
    {
        _worldModulate ??= GetNodeOrNull<CanvasModulate>(WorldModulatePath)
            ?? GetNodeOrNull<CanvasModulate>("../WorldRoot/WorldModulate");
        _overlay ??= GetNodeOrNull<ColorRect>(OverlayPath)
            ?? GetNodeOrNull<ColorRect>("../AtmosphereCanvas/Overlay");
    }

    private void ApplyImmediate(AtmospherePeriod period)
    {
        CurrentPeriod = period;
        var (worldTint, overlayTint) = GetPalette(period);

        if (_worldModulate is not null)
        {
            _worldModulate.Color = worldTint;
        }

        if (_overlay is not null)
        {
            _overlay.Color = overlayTint;
        }
    }

    private (Color WorldTint, Color OverlayTint) GetPalette(AtmospherePeriod period)
    {
        return period switch
        {
            AtmospherePeriod.Noon => (NoonWorldTint, NoonOverlay),
            AtmospherePeriod.Evening => (EveningWorldTint, EveningOverlay),
            _ => (DawnWorldTint, DawnOverlay)
        };
    }
}
