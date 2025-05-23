# Font Tool 热更新功能

Font Tool 是一个用于在React项目中管理和调试字体大小的工具。现在它支持热更新功能，可以在修改字体大小配置后立即反映在运行中的React应用上，无需手动刷新页面。

## 功能特点

- 实时预览字体大小调整效果
- 自动扫描项目中的`@font-tool`注释
- 通过WebSocket实时将配置变更推送到React应用
- 提供Cursor IDE插件，实现更紧密的集成

## 使用方法

### 1. 启动Font Tool

```bash
cd font-tool
npm install       # 安装依赖
npm install -g .  # 全局安装
font-tool         # 启动工具
```

### 2. 在React组件中添加`@font-tool`注释

在组件中使用以下格式的注释来标记字体大小可调整的元素：

```jsx
{/* @font-tool: 组件名 - 元素描述 - fontSize+1 */}
<h1 className={getTextScaleClass(fontSize+1)} data-font-tool="+1">
  这是一个标题
</h1>

{/* @font-tool: 组件名 - 元素描述 - fontSize-1 */}
<p className={getTextScaleClass(fontSize-1)} data-font-tool="-1">
  这是一段文本
</p>
```

注释格式说明：
- `@font-tool:` - 必需，标识这是一个font-tool注释
- `组件名` - 组件的名称，如"HexagramCard"
- `元素描述` - 元素的描述，如"卦象名称"
- `fontSize+X` 或 `fontSize-X` - 相对于基础字体大小的调整值

### 3. 集成热更新客户端

有两种方法可以集成热更新客户端：

#### 方法一：使用Cursor插件（推荐）

1. 安装Cursor插件：
   ```bash
   cd font-tool/cursor-plugin
   npm install
   npm link
   ```

2. 在Cursor中激活插件，并使用命令面板中的"Font Tool: 集成热更新客户端"命令

#### 方法二：手动集成

1. 将`FontToolHotReload.js`复制到您的项目中
2. 在项目的入口文件中导入：

```javascript
import { initFontToolHotReload } from './path/to/FontToolHotReload';

// 初始化热更新客户端
initFontToolHotReload();
```

### 4. 修改字体工具函数

确保您的`getTextScaleClass`函数添加了`data-font-tool`属性，以便热更新时能定位到对应元素：

```javascript
function getTextScaleClass(relativeSize) {
  const sizeValue = relativeSize >= 0 ? `+${relativeSize}` : relativeSize;
  return `text-[${mapLevelToPx(relativeSize)}px] data-font-tool="${sizeValue}"`;
}
```

## 工作流程

1. 在Font Tool中调整字体大小
2. 点击"应用配置到代码"按钮
3. 配置会通过WebSocket实时推送到正在运行的React应用
4. React应用接收到更新通知，自动刷新字体大小

## 注意事项

- WebSocket服务器默认在28888端口运行，可在工具中配置
- 确保React应用在修改配置时处于运行状态
- 建议使用Cursor插件以获得最佳体验

## 命令行选项

启动Font Tool时可以使用以下选项：

```bash
font-tool --port 28889  # 指定WebSocket服务器端口
font-tool --no-auto-connect  # 禁用自动连接
``` 