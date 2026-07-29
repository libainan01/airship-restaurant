import Phaser from "phaser";
import { WorkspaceScene } from "./WorkspaceScene";
import "./style.css";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "desktop-root",
  transparent: true,
  width: window.innerWidth,
  height: window.innerHeight,
  scene: [WorkspaceScene],
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
