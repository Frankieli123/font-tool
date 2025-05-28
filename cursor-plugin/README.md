# Font Tool Integration

这个插件用于将 Font Tool 集成到 Cursor IDE 和 React 项目中，支持热更新字体大小设置。

## 功能

- 与 Font Tool 服务器连接，支持热更新
- 集成热更新客户端到 React 项目
- 实时反馈字体大小变更
- 支持 JavaScript 和 TypeScript 项目

## 使用方法

1. 启动 Font Tool 服务器 (默认端口: 28888)
2. 在 IDE 中，点击右下角状态栏的 "Font Tool: 未连接" 图标连接到 Font Tool
3. 使用命令面板执行 "Font Tool: 集成热更新客户端" 将热更新代码添加到项目中
4. 在 React 组件中使用 `@font-tool:` 注释来标记可调整大小的字体元素

## 命令

- `Font Tool: 集成热更新客户端` - 向项目添加热更新支持
- `Font Tool: 检查连接状态` - 检查与 Font Tool 服务器的连接状态

## 设置

- `font-tool.port`: Font Tool WebSocket 服务器端口 (默认: 28888)
- `font-tool.autoConnect`: 项目打开时自动连接到 Font Tool 服务器 (默认: true)

## 作者

李红帅 