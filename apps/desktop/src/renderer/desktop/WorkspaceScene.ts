import Phaser from "phaser";

const COLORS = {
  ink: 0x2f2a26,
  brass: 0xb77a36,
  copper: 0x9e5032,
  paper: 0xfff3d6,
  sky: 0x9fc1c7,
};

export class WorkspaceScene extends Phaser.Scene {
  constructor() {
    super("Workspace");
  }

  create(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const graphics = this.add.graphics();

    graphics.fillStyle(COLORS.sky, 0.22);
    graphics.fillRoundedRect(24, 24, Math.max(320, width - 48), 112, 24);
    graphics.lineStyle(3, COLORS.brass, 0.9);
    graphics.strokeRoundedRect(24, 24, Math.max(320, width - 48), 112, 24);

    graphics.fillStyle(COLORS.paper, 0.95);
    graphics.fillRoundedRect(48, Math.max(172, height - 150), 360, 92, 18);
    graphics.lineStyle(3, COLORS.copper, 0.9);
    graphics.strokeRoundedRect(
      48,
      Math.max(172, height - 150),
      360,
      92,
      18,
    );

    this.add.text(52, 52, "空艇餐厅 · 正式桌面工作区", {
      color: "#2f2a26",
      fontFamily: '"Microsoft YaHei UI", sans-serif',
      fontSize: "24px",
      fontStyle: "bold",
    });

    this.add.text(
      52,
      92,
      "M1-01 构建骨架 · 当前画面仅用于验证 Phaser 正式入口",
      {
        color: "#4e4742",
        fontFamily: '"Microsoft YaHei UI", sans-serif',
        fontSize: "15px",
      },
    );

    this.add.text(72, Math.max(198, height - 118), "桌面渲染器已就绪", {
      color: "#2f2a26",
      fontFamily: '"Microsoft YaHei UI", sans-serif',
      fontSize: "20px",
      fontStyle: "bold",
    });

    this.add.text(
      72,
      Math.max(230, height - 84),
      "窗口、命中地图和正式场景将在后续 M1 任务中接入。",
      {
        color: "#5f554e",
        fontFamily: '"Microsoft YaHei UI", sans-serif',
        fontSize: "14px",
      },
    );
  }
}
