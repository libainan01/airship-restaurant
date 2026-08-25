using Godot;

namespace AirshipRestaurant.Godot.Presentation;

public partial class InteractiveHotspot : Area2D
{
    [Signal]
    public delegate void ActivatedEventHandler();

    [Signal]
    public delegate void HoverChangedEventHandler(bool hovered);

    [Export]
    public NodePath HighlightTargetPath { get; set; } = new();

    [Export]
    public Color HoverTint { get; set; } = new(1.10f, 1.04f, 0.82f, 1.0f);

    private CanvasItem? _highlightTarget;
    private Color _normalModulate = Colors.White;

    public override void _Ready()
    {
        InputPickable = true;
        _highlightTarget = GetNodeOrNull<CanvasItem>(HighlightTargetPath);
        if (_highlightTarget is not null)
        {
            _normalModulate = _highlightTarget.Modulate;
        }

        InputEvent += OnInputEvent;
        MouseEntered += OnMouseEntered;
        MouseExited += OnMouseExited;
    }

    private void OnInputEvent(Node viewport, InputEvent inputEvent, long shapeIndex)
    {
        if (inputEvent is not InputEventMouseButton mouseButton)
        {
            return;
        }

        if (mouseButton.ButtonIndex != MouseButton.Left || !mouseButton.Pressed)
        {
            return;
        }

        EmitSignal(SignalName.Activated);
        GetViewport().SetInputAsHandled();
    }

    private void OnMouseEntered()
    {
        if (_highlightTarget is not null)
        {
            _highlightTarget.Modulate = HoverTint;
        }

        Input.SetDefaultCursorShape(Input.CursorShape.PointingHand);
        EmitSignal(SignalName.HoverChanged, true);
    }

    private void OnMouseExited()
    {
        if (_highlightTarget is not null)
        {
            _highlightTarget.Modulate = _normalModulate;
        }

        Input.SetDefaultCursorShape(Input.CursorShape.Arrow);
        EmitSignal(SignalName.HoverChanged, false);
    }
}
