using System.Collections.Generic;
using Godot;

namespace AirshipRestaurant.Godot.Presentation;

[Tool]
public partial class InteractionDebugOverlay : Node2D
{
    [Export]
    public NodePath InteractionRootPath { get; set; } = new();

    [Export]
    public NodePath AnchorsPath { get; set; } = new();

    [Export]
    public Color FillColor { get; set; } = new(0.10f, 0.86f, 0.86f, 0.16f);

    [Export]
    public Color OutlineColor { get; set; } = new(0.24f, 1.0f, 0.96f, 0.94f);

    [Export]
    public Color AnchorColor { get; set; } = new(1.0f, 0.72f, 0.22f, 1.0f);

    [Export(PropertyHint.Range, "1,8,0.5")]
    public float LineWidth { get; set; } = 3.0f;

    public override void _Ready()
    {
        BuildDebugGeometry();
        SetProcess(true);
        QueueRedraw();
    }

    public override void _Process(double delta)
    {
        if (Visible)
        {
            QueueRedraw();
        }
    }

    public override void _Draw()
    {
        DrawInteractionRegions();
        DrawAnchors();
    }

    private void DrawInteractionRegions()
    {
        var interactionRoot = GetNodeOrNull<Node2D>(InteractionRootPath)
            ?? GetNodeOrNull<Node2D>("../InteractionRoot");
        if (interactionRoot is null)
        {
            return;
        }

        foreach (var child in interactionRoot.GetChildren())
        {
            if (child is not CollisionPolygon2D polygon || polygon.Disabled)
            {
                continue;
            }

            var sourcePoints = polygon.Polygon;
            if (sourcePoints.Length < 3)
            {
                continue;
            }

            var localPoints = new Vector2[sourcePoints.Length];
            for (var index = 0; index < sourcePoints.Length; index += 1)
            {
                localPoints[index] = ToLocal(polygon.ToGlobal(sourcePoints[index]));
            }

            DrawColoredPolygon(localPoints, FillColor);

            var closedPoints = new Vector2[localPoints.Length + 1];
            for (var index = 0; index < localPoints.Length; index += 1)
            {
                closedPoints[index] = localPoints[index];
            }

            closedPoints[^1] = localPoints[0];
            DrawPolyline(closedPoints, OutlineColor, LineWidth, true);
        }
    }

    private void BuildDebugGeometry()
    {
        var interactionRoot = GetNodeOrNull<Node2D>(InteractionRootPath)
            ?? GetNodeOrNull<Node2D>("../InteractionRoot");
        if (interactionRoot is null)
        {
            return;
        }

        foreach (var child in interactionRoot.GetChildren())
        {
            if (child is not CollisionPolygon2D polygon || polygon.Disabled)
            {
                continue;
            }

            var sourcePoints = polygon.Polygon;
            if (sourcePoints.Length < 3)
            {
                continue;
            }

            var localPoints = new Vector2[sourcePoints.Length];
            for (var index = 0; index < sourcePoints.Length; index += 1)
            {
                localPoints[index] = ToLocal(polygon.ToGlobal(sourcePoints[index]));
            }

            var fill = new Polygon2D
            {
                Polygon = localPoints,
                Color = FillColor
            };
            AddChild(fill);

            var closedPoints = new Vector2[localPoints.Length + 1];
            for (var index = 0; index < localPoints.Length; index += 1)
            {
                closedPoints[index] = localPoints[index];
            }

            closedPoints[^1] = localPoints[0];
            var outline = new Line2D
            {
                Points = closedPoints,
                Width = LineWidth,
                DefaultColor = OutlineColor,
                Antialiased = true
            };
            AddChild(outline);
        }

        var anchors = GetNodeOrNull<Node2D>(AnchorsPath)
            ?? GetNodeOrNull<Node2D>("../StationAnchors");
        if (anchors is null)
        {
            return;
        }

        foreach (var child in anchors.GetChildren())
        {
            if (child is not Marker2D marker)
            {
                continue;
            }

            var point = ToLocal(marker.GlobalPosition);
            var horizontal = new Line2D
            {
                Points = new[] { point + new Vector2(-20.0f, 0.0f), point + new Vector2(20.0f, 0.0f) },
                Width = LineWidth,
                DefaultColor = AnchorColor,
                Antialiased = true
            };
            var vertical = new Line2D
            {
                Points = new[] { point + new Vector2(0.0f, -20.0f), point + new Vector2(0.0f, 20.0f) },
                Width = LineWidth,
                DefaultColor = AnchorColor,
                Antialiased = true
            };
            AddChild(horizontal);
            AddChild(vertical);
        }
    }
    private void DrawAnchors()
    {
        var anchors = GetNodeOrNull<Node2D>(AnchorsPath)
            ?? GetNodeOrNull<Node2D>("../StationAnchors");
        if (anchors is null)
        {
            return;
        }

        foreach (var child in anchors.GetChildren())
        {
            if (child is not Marker2D marker)
            {
                continue;
            }

            var point = ToLocal(marker.GlobalPosition);
            DrawCircle(point, 14.0f, new Color(AnchorColor, 0.22f));
            DrawLine(point + new Vector2(-18.0f, 0.0f), point + new Vector2(18.0f, 0.0f), AnchorColor, LineWidth, true);
            DrawLine(point + new Vector2(0.0f, -18.0f), point + new Vector2(0.0f, 18.0f), AnchorColor, LineWidth, true);
        }
    }
}
