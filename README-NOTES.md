# Font-Tool 使用规范

## 注释格式标准

Font-Tool使用特殊注释格式来识别需要控制字体大小的组件和元素。为确保工具正确识别，请遵循以下标准：

### 1. 注释位置

**重要：所有注释都必须放在对应元素的前面，而不是元素内部或元素之后。**

✅ 正确示例：
```jsx
{/* @font-tool：按钮文本 */}
<button className={getTextScaleClass(fontSize)}>
  点击我
</button>
```

❌ 错误示例 - 注释在元素内部：
```jsx
<button className={getTextScaleClass(fontSize)}>
  {/* @font-tool：按钮文本 */}
  点击我
</button>
```

❌ 错误示例 - 注释在元素之后：
```jsx
<button className={getTextScaleClass(fontSize)}>
  点击我
</button>
{/* @font-tool：按钮文本 */}
```

### 2. 注释格式

首选JSX注释格式，尤其是在React代码中：

| 环境 | 推荐注释格式 | 备注 |
|------|------------|------|
| React/JSX | `{/* @font-tool：元素名 */}` | 最推荐用于React组件 |
| HTML | `<!-- @font-tool：元素名 -->` | 用于纯HTML文件 |
| JavaScript | `// @font-tool：元素名` | 单行注释 |
| JavaScript | `/* @font-tool：元素名 */` | 多行注释（不要与JSX混淆） |

**注意：** 在JSX环境中，不要使用不带大括号的注释 `/* @font-tool：元素名 */`，这会导致识别问题。

### 3. 注释与元素的距离

**更新：** Font-Tool现在使用动态搜索范围技术，可以匹配距离较远的注释（最多500字符）。这意味着即使注释与元素之间有较多代码，也能正确识别。

以下情况中，注释仍然能被正确识别：
- 注释和元素之间有多行属性设置
- 元素含有复杂的className字符串处理
- 元素有多层嵌套的条件渲染

尽管如此，为了代码可读性和维护性，仍然建议将注释放在尽可能靠近目标元素的位置。

### 4. 组件和元素注释

Font-Tool支持两种类型的注释：

#### 组件注释
用于整个组件的字体控制，格式为：
```jsx
{/* @font-tool组件：组件名 */}
```

#### 元素注释
用于特定UI元素的字体控制，格式为：
```jsx
{/* @font-tool：元素名 */}
```

### 5. 冒号使用

工具同时支持中文冒号（`：`）和英文冒号（`:`），但建议统一使用中文冒号。

✅ 推荐: `{/* @font-tool：元素名 */}`
✅ 也支持: `{/* @font-tool:元素名 */}`

## 字体大小控制函数

Font-Tool自动识别以下字体大小控制函数：

1. `getTextScaleClass(fontSize)` - 返回CSS类
2. `getTextScaleClass(fontSize+N)` - 增大N个级别
3. `getTextScaleClass(fontSize-N)` - 减小N个级别
4. `mapLevelToPx(fontSize)` - 像素映射
5. `mapLevelToPx(fontSize+N)` - 增大N个级别的像素
6. `mapLevelToPx(fontSize-N)` - 减小N个级别的像素

## 常见问题排查

1. 如果元素不能被Font-Tool识别，请检查：
   - 注释是否放在正确位置（元素前面）
   - 注释格式是否正确（JSX环境中使用 `{/* */}` 包裹）
   - 是否使用了支持的冒号（`：`或`:`）

2. 如果组件名不被识别，请确保使用了正确的组件注释格式 `@font-tool组件：`

## 示例

```jsx
{/* @font-tool组件：卡片组件 */}
const Card = ({ title, content }) => {
  const { fontSize } = useAppStore(state => state.settings);
  
  return (
    <div className="card">
      {/* @font-tool：卡片标题 */}
      <h2 className={getTextScaleClass(fontSize)}>
        {title}
      </h2>
      
      {/* @font-tool：卡片内容 */}
      <p className={getTextScaleClass(fontSize-1)}>
        {content}
      </p>
      
      {/* @font-tool：卡片按钮 */}
      <button className={`btn ${getTextScaleClass(fontSize-2)}`}>
        详细信息
      </button>
    </div>
  );
};
```

## 更新日志

### 2023-06-XX - 动态搜索范围
- 添加了动态搜索范围技术，可以识别距离最远500字符的注释
- 改进了注释匹配算法，解决了复杂JSX结构中的识别问题
- 更新了README文档，添加了新功能说明