# Phaser + Electron 桌面陪伴技术验证

这个独立验证项目用于确认《空艇餐厅》的核心桌面体验：

- Phaser 在透明桌面窗口中持续绘制不连续的游戏内容。
- 中央角色、飞艇、云和缆车保持可见，但鼠标点击穿透到后方应用。
- 顶部厨房、底部餐厅和临时食谱气泡能够恢复游戏交互。
- 点击临时交互内容时，输入锁覆盖完整的按下/松开周期。
- Electron 窗口不获得键盘焦点，不打断玩家正在使用的应用。

它与根目录的正式 npm workspace 相互独立，不被正式代码引用。

## 环境

- Windows 10/11 x64
- Node.js 22.14 或更高版本
- Electron 43.2.0
- Phaser 4.2.1
- TypeScript 7.0.2
- Vite 8.1.5

## 运行

```powershell
cd G:\Otherprojects\airship-restaurant\spikes\phaser-electron
npm install
npm run start
```

开发模式：

```powershell
npm run dev
```

验证测试和生产构建：

```powershell
npm run check
```

## 操作

- 顶部厨房和底部餐厅是固定交互区。
- 中央飞艇、云、角色和缆车默认只显示、不接收点击。
- 启动约 3 秒后，中央出现“发现食谱”气泡；该气泡会临时成为交互区。
- 点击气泡后，它会消失并恢复桌面穿透，约 6.5 秒后再次出现。
- “显示热区”可以显示当前语义命中区域。
- “安静模式”降低桌面动态内容的运动速度和数量。
- “退出验证”关闭无边框窗口。

## 实现结构

- `electron/main.cjs`：透明窗口、置顶、显示器工作区、鼠标穿透、游标轮询和资源采样。
- `electron/preload.cjs`：经过约束的 IPC 桥接，不向网页暴露 Node.js。
- `src/scenes/DesktopPresenceScene.ts`：Phaser 桌面世界、动态内容和交互状态。
- `src/hit-map.ts`：与视觉渲染分离的语义命中地图。
- `src/hit-map.test.ts`：不连续交互岛、临时圆形热区和优先级测试。

窗口每 33 毫秒读取一次系统光标位置。光标处于语义交互区时，
Electron 接收输入；其余位置调用 `setIgnoreMouseEvents(true)`，
画面继续显示，但点击交给后方应用。

## 当前性质

这是技术验证，不是正式客户端：

- 美术均为程序绘制占位图。
- 没有存档、经营循环、剧情、食谱或正式内容数据。
- 没有安装包、自动更新、托盘图标和 Steam 接入。
- 多显示器已监听系统变化，但尚未提供正式的屏幕选择和持久化设置。

完整验证结论见：

`Document/Phaser-Electron桌面陪伴技术验证记录.md`
