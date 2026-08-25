"""Prepare the generated airship pixel-art layers for Phaser.

The image model exports chroma-keyed full-canvas images. This script removes
remaining magenta spill, crops compact sprites, creates a stepped amber light
overlay, writes a small runtime manifest, and renders a deterministic preview.
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter


REPO_ROOT = Path(__file__).resolve().parents[2]
ASSET_DIR = (
    REPO_ROOT
    / "apps"
    / "desktop"
    / "public"
    / "assets"
    / "world"
    / "airship-pixel"
)
CANVAS_SIZE = (1536, 1024)


LAYER_SPECS = (
    {
        "id": "restaurant",
        "source": "layer-15-restaurant-orthographic.png",
        "sprite": "sprite-restaurant-orthographic.png",
        # Strict front elevation shares the scene camera with the airship and
        # cargo lift; the older three-quarter facade remains as a reference.
        "position": (90, 490),
        "scale": 0.56,
        "depth": 20,
        "scroll_factor": 0.78,
    },
    {
        "id": "cargo-lift",
        "source": "layer-25-cargo-lift-orthographic.png",
        "sprite": "sprite-cargo-lift-orthographic.png",
        # Front elevation aligns with the orthographic airship and can move
        # vertically without perspective distortion.
        "position": (790, 535),
        "scale": 0.21,
        "depth": 30,
        "scroll_factor": 1.0,
    },
    {
        "id": "airship",
        "source": "layer-30-airship-orthographic.png",
        "sprite": "sprite-airship-orthographic.png",
        # The production scene uses a strict side elevation. The earlier
        # three-quarter asset remains beside it as an authoring reference.
        "position": (300, -75),
        "scale": 0.72,
        "depth": 40,
        "scroll_factor": 0.62,
    },
    {
        "id": "foreground",
        "source": "layer-40-foreground.png",
        "sprite": "sprite-foreground.png",
        "position": None,
        "scale": 1.0,
        "depth": 50,
        "scroll_factor": 1.0,
    },
)


def clean_magenta_spill(image: Image.Image) -> Image.Image:
    """Remove non-uniform magenta left by the generated chroma backdrop."""
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = pixels[x, y]
            is_magenta = (
                alpha > 0
                and red > 170
                and blue > 155
                and green < 125
                and red + blue > green * 2 + 190
            )
            if is_magenta:
                pixels[x, y] = (0, 0, 0, 0)
    return rgba


def crop_visible(image: Image.Image, padding: int = 2) -> tuple[Image.Image, tuple[int, int, int, int]]:
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError("layer contains no visible pixels")
    left = max(0, bbox[0] - padding)
    top = max(0, bbox[1] - padding)
    right = min(image.width, bbox[2] + padding)
    bottom = min(image.height, bbox[3] + padding)
    padded = (left, top, right, bottom)
    return image.crop(padded), padded


def build_light_overlay(source: Image.Image) -> Image.Image:
    """Extract stepped amber highlights without introducing smooth blur."""
    source_rgb = source.convert("RGB")
    core = Image.new("L", source.size, 0)
    source_pixels = source_rgb.load()
    core_pixels = core.load()
    for y in range(source.height):
        for x in range(source.width):
            red, green, blue = source_pixels[x, y]
            if red >= 215 and green >= 125 and blue <= 125 and red > green + 20:
                brightness = min(180, max(28, (red + green - 300) * 2))
                core_pixels[x, y] = brightness

    outer = core.filter(ImageFilter.MaxFilter(5)).point(lambda value: min(34, value // 5))
    alpha = ImageChops.lighter(core, outer)
    overlay = Image.new("RGBA", source.size, (255, 169, 72, 0))
    overlay.putalpha(alpha)
    return overlay


def paste_sprite(
    canvas: Image.Image,
    sprite: Image.Image,
    position: tuple[int, int],
    scale: float,
) -> None:
    if scale != 1.0:
        size = (
            max(1, round(sprite.width * scale)),
            max(1, round(sprite.height * scale)),
        )
        sprite = sprite.resize(size, Image.Resampling.NEAREST)
    canvas.alpha_composite(sprite, dest=position)


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    source = Image.open(ASSET_DIR / "source-composite.png")
    background = Image.open(ASSET_DIR / "layer-00-background.png").convert("RGBA")
    if source.size != CANVAS_SIZE or background.size != CANVAS_SIZE:
        raise ValueError(f"expected {CANVAS_SIZE}, got source={source.size}, background={background.size}")

    manifest_layers: list[dict[str, object]] = [
        {
            "id": "background",
            "texture": "layer-00-background.png",
            "x": 0,
            "y": 0,
            "scale": 1,
            "depth": 0,
            "scrollFactor": 0.12,
        }
    ]
    preview = background.copy()

    for spec in LAYER_SPECS:
        layer_path = ASSET_DIR / str(spec["source"])
        cleaned = clean_magenta_spill(Image.open(layer_path))
        cleaned.save(layer_path)
        sprite, bbox = crop_visible(cleaned)
        sprite_path = ASSET_DIR / str(spec["sprite"])
        sprite.save(sprite_path)

        position = spec["position"]
        if position is None:
            position = (bbox[0], bbox[1])
        assert isinstance(position, tuple)
        scale = float(spec["scale"])
        paste_sprite(preview, sprite, position, scale)

        manifest_layers.append(
            {
                "id": spec["id"],
                "texture": spec["sprite"],
                "x": position[0],
                "y": position[1],
                "originX": 0,
                "originY": 0,
                "scale": scale,
                "depth": spec["depth"],
                "scrollFactor": spec["scroll_factor"],
                "sourceBounds": {
                    "left": bbox[0],
                    "top": bbox[1],
                    "right": bbox[2],
                    "bottom": bbox[3],
                },
            }
        )

    light_overlay = build_light_overlay(source)
    light_overlay.save(ASSET_DIR / "layer-50-lighting.png")
    preview.alpha_composite(light_overlay)
    preview.convert("RGB").save(ASSET_DIR / "composite-preview.png")

    manifest_layers.append(
        {
            "id": "lighting",
            "texture": "layer-50-lighting.png",
            "x": 0,
            "y": 0,
            "scale": 1,
            "depth": 60,
            "scrollFactor": 1,
            "blendMode": "ADD",
            "alpha": 0.46,
        }
    )

    manifest = {
        "schemaVersion": 1,
        "canvas": {"width": CANVAS_SIZE[0], "height": CANVAS_SIZE[1]},
        "rendering": {
            "pixelArt": True,
            "roundPixels": True,
            "textureFilter": "NEAREST",
        },
        "layers": manifest_layers,
        "animationHints": {
            "airship": {"axis": "y", "amplitude": 3, "durationMs": 4200},
            "cargo-lift": {"axis": "y", "range": [535, 760], "durationMs": 6200},
            "lighting": {"alphaRange": [0.38, 0.5], "durationMs": 1800},
        },
    }
    (ASSET_DIR / "layers.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()





