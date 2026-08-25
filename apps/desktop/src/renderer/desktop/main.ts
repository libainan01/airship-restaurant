import Phaser from "phaser";
import { BootScene } from "./BootScene";
import { DesktopUiScene } from "./DesktopUiScene";
import { DesktopPerformanceGovernor } from "./desktop-performance-governor";
import { EnvironmentScene } from "./EnvironmentScene";
import { InteractionDebugScene } from "./InteractionDebugScene";
import { DesktopWorldScene } from "./WorkspaceScene";
import "./style.css";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "desktop-root",
  transparent: true,
  pixelArt: true,
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
    antialias: false,
    roundPixels: true,
    transparent: true,
  },
  fps: {
    target: 30,
    limit: 30,
    forceSetTimeOut: true,
  },
  banner: false,
});

const performanceGovernor = new DesktopPerformanceGovernor(game);

window.addEventListener("beforeunload", () => {
  performanceGovernor.destroy();
  game.destroy(true);
});
