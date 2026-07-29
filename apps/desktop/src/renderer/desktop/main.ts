import Phaser from "phaser";
import { BootScene } from "./BootScene";
import { DesktopUiScene } from "./DesktopUiScene";
import { EnvironmentScene } from "./EnvironmentScene";
import { InteractionDebugScene } from "./InteractionDebugScene";
import { DesktopWorldScene } from "./WorkspaceScene";
import "./style.css";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "desktop-root",
  transparent: true,
  width: window.innerWidth,
  height: window.innerHeight,
  scene: [
    BootScene,
    EnvironmentScene,
    DesktopWorldScene,
    DesktopUiScene,
    InteractionDebugScene,
  ],
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  render: {
    antialias: true,
    roundPixels: true,
    transparent: true,
  },
  fps: {
    target: 30,
    forceSetTimeOut: true,
  },
  banner: false,
});

window.addEventListener("beforeunload", () => {
  game.destroy(true);
});
