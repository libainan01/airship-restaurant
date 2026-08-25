# Airship pixel-art scene assets

Canvas: `1536 x 1024`

All PNG files use hard pixel edges. In Phaser, enable `pixelArt`, `roundPixels`,
and nearest-neighbor texture filtering. `layers.json` contains the intended
draw order, placement, scale, parallax factor, and small animation hints.

## Runtime files

- `layer-00-background.png`: clean sky, harbor, water, and distant city plate.
- `sprite-restaurant-orthographic.png`: production front-elevation restaurant building sprite.
- `sprite-cargo-lift-orthographic.png`: production front-elevation animated cargo-lift sprite.
- `sprite-airship-orthographic.png`: production straight side-elevation
  kitchen-airship sprite used by `layers.json`.
- `sprite-foreground.png`: transparent promenade and railing overlay.
- `layer-50-lighting.png`: amber additive lighting overlay.
- `layers.json`: Phaser-oriented layer manifest.
- `composite-preview.png`: deterministic preview rendered from the manifest.

## Source and authoring files

- `source-composite.png`: approved pixel-art concept used as the split source.
- `layer-15-restaurant-orthographic.png`, `layer-25-cargo-lift-orthographic.png`,
  `layer-30-airship-orthographic.png`, and `layer-40-foreground.png`:
  full-canvas transparent authoring layers retained for future recropping.
- `layer-30-airship-perspective.png`, `sprite-airship-perspective.png`,
  `layer-25-cargo-lift-perspective.png`, `sprite-cargo-lift-perspective.png`,
  `layer-15-restaurant-perspective.png`, and `sprite-restaurant-perspective.png`:
  the earlier three-quarter designs retained as visual-development references;
  they are not selected by the runtime manifest.

Regenerate the compact sprites, manifest, lighting layer, and preview with:

```powershell
python scripts/art/process_airship_pixel_layers.py
```

The script never resamples with smoothing; all sprite scaling in its preview
uses nearest-neighbor sampling.




