# Font-Tool

一个用于React应用的字体大小调试工具，允许开发者实时调整和优化应用中的字体大小。

## 功能特点

- 🔍 扫描项目中的字体相关代码和注释
- 🎛️ 实时滑块调整字体大小
- 💻 直接修改源代码，无需重启应用
- 🎯 支持精确匹配自定义字段（mapLevelToPx、getTextScaleClass等）
- 🔄 保存上次应用的配置，智能识别变更
- 📊 预览效果，直观感受字体变化

## 安装方法

1. 克隆仓库:

```bash
git clone https://github.com/yourusername/font-tool.git
cd font-tool
```

2. 安装依赖:

```bash
npm install
```

3. 启动应用:

在Windows PowerShell中:
```powershell
cd font-tool
.\start.bat
```

在命令提示符或bash中:
```bash
cd font-tool
start.bat  # Windows
./start.sh  # Linux/macOS
```

## 使用方法

### 基本使用流程

1. 启动font-tool应用
2. 选择React项目目录
3. 扫描代码（自动识别字体相关函数和注释）
4. 使用滑块调整字体大小
5. 应用更改到代码

### 添加字体标记

在React组件中添加特殊注释来标记字体元素:

```jsx
{/* @font-tool：主标题 */}
<h3 className={getTextScaleClass(fontSize)}>标题文本</h3>

{/* @font-tool：正文内容 */}
<p className={getTextScaleClass(fontSize-1)}>段落文本</p>
```

### 支持的字体函数

工具默认支持以下字体调整函数:

```jsx
// CSS类函数
getTextScaleClass(fontSize±N)

// 像素计算函数
mapLevelToPx(fontSize±N)

// 模板字符串形式
fontSize: `${mapLevelToPx(fontSize±N)}px`
```

## 高级配置

### 自定义匹配字段

通过UI界面可以添加自定义的字体处理函数名，例如:

- `getFontSize`
- `calculateFontSize`
- `adjustTextSize`

### 实时代码更新

开启"实时代码更新"选项，在拖动滑块时自动应用更改到代码文件，无需点击"应用配置"按钮。

### 组件名称标记

通过添加特殊注释指定组件名称:

```jsx
{/* @font-tool组件：导航栏 */}
const Navbar = () => {
  // 组件代码
}
```

## 故障排除

- **无法启动应用**: 确保Node.js环境正确安装，并检查路径中是否有特殊字符
- **扫描无结果**: 检查项目目录是否正确，以及是否使用了支持的字体函数或注释
- **代码更新失败**: 检查文件权限，确保应用有权限修改项目文件

## 许可证

MIT 