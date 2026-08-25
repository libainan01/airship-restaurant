# 飞艇餐厅 Godot 客户端

当前目录是新的 Godot .NET 客户端。G0 只用于验证透明桌面场景、可视化制作、交互区和游戏化 UI，不接入旧 Electron 运行时，也不读取任何正式存档。

## 打开工程

使用 Godot 4.7.2 .NET 打开本目录中的 project.godot。

项目内可以直接编辑：

- scenes/g0_showcase.tscn：飞艇、地面设施、货梯路径、折叠 UI 与所有位置；
- InteractionRoot：不规则且不连续的点击区域；
- Anchors：工作、物品、对白和状态锚点；
- AtmosphereController：只作用于实体的黎明、正午和傍晚颜色；
- themes/steampunk_theme.tres：统一 UI 风格。

运行时：

- 默认背景透明，鼠标在非交互空白区会落到下层桌面或窗口；
- 点击地面风铃交换站或右下角菜单中的“打开仓库”进入同一仓库样板；
- 展开右下角菜单后可以切换黎明、正午和傍晚；
- 点击“显示交互区”或按 D 显示点击区和锚点；
- 仓库外没有全屏暗幕，只有可见仓库窗口接收输入。

## 命令行验收

使用仓库内便携 Godot：

~~~powershell
& ".tools\godot-4.7.2-dotnet\Godot_v4.7.2-stable_mono_win64\Godot_v4.7.2-stable_mono_win64_console.exe" --headless --path apps/godot --editor --quit
& ".tools\godot-4.7.2-dotnet\Godot_v4.7.2-stable_mono_win64\Godot_v4.7.2-stable_mono_win64_console.exe" --headless --path apps/godot -- --validate-g0
~~~

截图参数包括 --capture=绝对PNG路径、--period=dawn|noon|evening、--open-menu、--open-warehouse 和 --disable-click-through。所有截图和测试输出写入 Document 或临时目录，不使用旧版玩家数据目录。