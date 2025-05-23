// Electron主进程
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

// WebSocket服务器
let wss = null;
let hotReloadPort = 28888; // 默认端口

// 设置WebSocket服务器
function setupWebSocketServer() {
  const server = http.createServer();
  wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    console.log('新的WebSocket连接');
    
    ws.on('message', (message) => {
      console.log('收到消息:', message);
    });
    
    ws.on('close', () => {
      console.log('WebSocket连接关闭');
    });
    
    // 发送初始连接确认消息
    ws.send(JSON.stringify({ type: 'connected', message: 'Connected to font-tool' }));
  });
  
  server.listen(hotReloadPort, () => {
    console.log(`WebSocket服务器启动在端口 ${hotReloadPort}`);
  });
  
  server.on('error', (err) => {
    console.error('WebSocket服务器错误:', err);
    if (err.code === 'EADDRINUSE') {
      // 端口已被占用，尝试下一个端口
      hotReloadPort++;
      console.log(`端口 ${hotReloadPort-1} 已被占用，尝试端口 ${hotReloadPort}`);
      setupWebSocketServer();
    }
  });
}

// 应用启动时设置WebSocket服务器
app.whenReady().then(() => {
  setupWebSocketServer();
  createWindow();

  // macOS特有的处理：当所有窗口都关闭后重新打开一个窗口
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 通知客户端配置已更新
function notifyConfigUpdate(projectDir, updatedFiles) {
  if (wss && wss.clients) {
    const message = JSON.stringify({
      type: 'font-config-updated',
      timestamp: Date.now(),
      projectDir,
      updatedFiles
    });
    
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
        console.log('已发送热更新通知');
      }
    });
  }
}

// 设置控制台编码以避免中文乱码
if (process.platform === 'win32') {
  process.env.LANG = 'zh_CN.UTF-8';
  // 尝试强制控制台编码，需要管理员权限才能生效
  try {
    require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
  } catch (e) {
    console.log('无法设置控制台编码，可能会出现中文乱码');
  }
}

// 递归查找文件函数
async function findFile(startDir, fileName) {
  console.log(`在 ${startDir} 中搜索 ${fileName}`);
  
  // 检查文件是否直接存在于起始目录
  const directPath = path.join(startDir, fileName);
  if (fs.existsSync(directPath)) {
    return directPath;
  }
  
  // 常见的React项目组件目录
  const commonComponentDirs = [
    path.join(startDir, 'src', 'components'),
    path.join(startDir, 'components'),
    path.join(startDir, 'src'),
    path.join(startDir, 'app'),
    path.join(startDir, 'app', 'components'),
    path.join(startDir, 'client', 'components'),
    path.join(startDir, 'client', 'src', 'components')
  ];
  
  // 检查常见组件目录
  for (const dir of commonComponentDirs) {
    if (fs.existsSync(dir)) {
      const filePath = path.join(dir, fileName);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }
  }
  
  // 递归搜索src目录，最多搜索3层深度
  const srcDir = path.join(startDir, 'src');
  if (fs.existsSync(srcDir)) {
    try {
      return await searchDirRecursive(srcDir, fileName, 3);
    } catch (error) {
      console.log(`递归搜索失败: ${error.message}`);
    }
  }
  
  // 找不到文件
  throw new Error(`无法找到文件: ${fileName}`);
}

// 递归搜索目录
async function searchDirRecursive(dir, fileName, maxDepth = 3, currentDepth = 0) {
  if (currentDepth > maxDepth) return null;
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    // 首先检查当前目录中的文件
    for (const entry of entries) {
      if (!entry.isDirectory() && entry.name === fileName) {
        return path.join(dir, fileName);
      }
    }
    
    // 然后递归检查子目录
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // 跳过node_modules和.git等目录
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build') {
          continue;
        }
        
        const subDir = path.join(dir, entry.name);
        const found = await searchDirRecursive(subDir, fileName, maxDepth, currentDepth + 1);
        if (found) return found;
      }
    }
  } catch (error) {
    console.error(`搜索目录出错: ${dir}`, error);
  }
  
  return null;
}

// 创建窗口的函数
function createWindow() {
  // 创建主窗口
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  // 设置应用菜单为中文
  const template = [
    {
      label: '文件',
      submenu: [
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'delete', label: '删除' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: async () => {
            dialog.showMessageBox({
              title: '关于',
              message: '字体大小调试工具',
              detail: '版本 1.0.0\n一个用于调试和管理React应用中字体大小设置的工具。'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // 加载HTML文件
  mainWindow.loadFile('font-size-debugger.html');

  // 开发环境下打开开发者工具
  //mainWindow.webContents.openDevTools();
}

// 应用准备好后创建窗口
app.whenReady().then(() => {
  createWindow();

  // macOS特有的处理：当所有窗口都关闭后重新打开一个窗口
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 关闭所有窗口时退出应用，除了macOS
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC处理器：选择项目目录
ipcMain.handle('select-project-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '选择React项目根目录'
  });
  
  if (result.canceled) {
    return null;
  }
  
  return result.filePaths[0];
});

// IPC处理器：扫描项目中的@font-tool注释
ipcMain.handle('scan-font-tool-comments', async (event, projectDir) => {
  console.log('扫描项目中的@font-tool注释...');
  
  // 结果对象
  const result = {
    components: [],
    success: true,
    error: null
  };
  
  try {
    if (!projectDir || !fs.existsSync(projectDir)) {
      throw new Error('无效的项目目录');
    }
    
    // 查找所有可能包含@font-tool注释的文件
    const fileExtensions = ['.js', '.jsx', '.ts', '.tsx'];
    const componentDirs = [
      path.join(projectDir, 'src', 'components'),
      path.join(projectDir, 'components'),
      path.join(projectDir, 'src'),
      path.join(projectDir, 'app'),
      path.join(projectDir, 'app', 'components')
    ];
    
    // 保存找到的组件
    const components = {};
    
    // 查找每个目录
    for (const dir of componentDirs) {
      if (fs.existsSync(dir)) {
        console.log(`扫描目录: ${dir}`);
        
        // 递归搜索所有符合条件的文件
        await searchFilesRecursive(dir, fileExtensions, async (filePath) => {
          // 读取文件内容
          const content = fs.readFileSync(filePath, 'utf8');
          
          // 文件基本信息
          const fileName = path.basename(filePath);
          const componentName = fileName.split('.')[0]; // 从文件名获取组件名
          
          // 匹配所有@font-tool注释
          // 格式: {/* @font-tool: 组件名 - 元素描述 - fontSize±X */}
          // 或者: // @font-tool: 组件名 - 元素描述 - fontSize±X
          const fontToolPattern = /@font-tool:\s*([^-]+)\s*-\s*([^-]+)\s*-\s*fontSize([+-]\d+)/g;
          
          let match;
          while ((match = fontToolPattern.exec(content)) !== null) {
            const matchedComponentName = match[1].trim();
            const elementName = match[2].trim();
            const fontSizeValue = match[3].trim(); // 如 "+1" 或 "-2"
            const lineNumber = getLineNumber(content, match.index);
            
            console.log(`找到@font-tool注释: ${matchedComponentName} - ${elementName} - fontSize${fontSizeValue} 在行: ${lineNumber}`);
            
            // 组装组件键名
            const componentKey = matchedComponentName;
            
            // 确保组件存在于结果集中
            if (!components[componentKey]) {
              components[componentKey] = {
                componentName: matchedComponentName,
                description: `${matchedComponentName}组件`,
                elements: []
              };
            }
            
            // 创建元素ID
            const elementId = `${componentKey.toLowerCase().replace(/\s+/g, '-')}-${components[componentKey].elements.length + 1}`;
            
            // 添加元素到组件
            components[componentKey].elements.push({
              id: elementId,
              name: elementName,
              relativeSizeValue: parseInt(fontSizeValue),
              path: `${fileName}:${lineNumber}`
            });
          }
        });
      }
    }
    
    // 转换components对象为数组
    result.components = Object.values(components).filter(comp => comp.elements.length > 0);
    console.log(`扫描完成，找到 ${result.components.length} 个组件，共 ${result.components.reduce((acc, comp) => acc + comp.elements.length, 0)} 个元素`);
    
  } catch (error) {
    console.error('扫描@font-tool注释失败:', error);
    result.success = false;
    result.error = error.message;
  }
  
  return result;
});

// 从内容中获取指定索引所在的行号（1-based）
function getLineNumber(content, index) {
  const lines = content.substring(0, index).split('\n');
  return lines.length;
}

// 递归搜索文件
async function searchFilesRecursive(dir, extensions, callback) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // 排除node_modules等目录
        if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist' && entry.name !== 'build') {
          await searchFilesRecursive(fullPath, extensions, callback);
        }
      } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
        await callback(fullPath);
      }
    }
  } catch (error) {
    console.error(`搜索目录出错: ${dir}`, error);
  }
}

// 更新IPC处理器：应用字体配置到代码
ipcMain.handle('apply-font-config', async (event, projectDir, configs) => {
  console.log('正在应用字体配置到代码...');
  console.log('项目目录:', projectDir);
  
  const results = {
    success: [],
    failure: []
  };

  // 创建文件路径缓存，避免重复搜索同一文件
  const filePathCache = {};
  
  // 获取文件内容缓存，避免重复读取同一文件
  const fileContentCache = {};

  // 遍历配置中的所有组件
  for (const config of configs) {
    for (const element of config.elements) {
      try {
        // 从路径字符串中提取文件名
        // 注意：路径格式类似于 'HexagramCard.tsx:55'，需要分离出文件名
        const filePathParts = element.path.split(':')[0];
        
        // 获取文件名，移除可能的路径前缀
        const fileName = filePathParts.includes('/') 
          ? filePathParts.substring(filePathParts.lastIndexOf('/') + 1) 
          : filePathParts;
          
        console.log(`处理文件: ${fileName}`);
        console.log(`组件: ${config.componentName}, 元素: ${element.name}, 相对大小: ${element.relativeSizeValue}`);
        
        // 使用文件查找函数查找文件
        let filePath;
        
        // 检查缓存中是否已有该文件路径
        if (filePathCache[fileName]) {
          filePath = filePathCache[fileName];
          console.log(`使用缓存的文件路径: ${filePath}`);
        } else {
          try {
            filePath = await findFile(projectDir, fileName);
            console.log(`找到文件: ${filePath}`);
            // 将路径添加到缓存
            filePathCache[fileName] = filePath;
          } catch (error) {
            throw new Error(`找不到文件 ${fileName}: ${error.message}`);
          }
        }
        
        // 确保文件存在
        if (!fs.existsSync(filePath)) {
          throw new Error(`文件不存在: ${filePath}`);
        }
        
        // 读取文件内容（使用缓存避免重复读取）
        let content;
        if (fileContentCache[filePath]) {
          content = fileContentCache[filePath];
        } else {
          content = fs.readFileSync(filePath, 'utf8');
          fileContentCache[filePath] = content;
        }
        
        let modified = false;
        
        // 尝试通过@font-tool注释来定位和替换
        const fontToolPattern = new RegExp(`@font-tool:\\s*${escapeRegExp(config.componentName)}\\s*-\\s*${escapeRegExp(element.name)}\\s*-\\s*fontSize([+-]\\d+)`, 'g');
        
        // 查找匹配的注释
        let commentMatch;
        while ((commentMatch = fontToolPattern.exec(content)) !== null) {
          const originalFontSize = commentMatch[1];
          const newFontSize = element.relativeSizeValue >= 0 ? `+${element.relativeSizeValue}` : element.relativeSizeValue.toString();
          
          // 替换注释中的fontSize值
          const newContent = content.substring(0, commentMatch.index) +
                            content.substring(commentMatch.index).replace(
                              `@font-tool: ${config.componentName} - ${element.name} - fontSize${originalFontSize}`,
                              `@font-tool: ${config.componentName} - ${element.name} - fontSize${newFontSize}`
                            );
          
          if (newContent !== content) {
            content = newContent;
            modified = true;
            console.log(`已更新@font-tool注释: ${config.componentName} - ${element.name} - fontSize${newFontSize}`);
            
            // 查找与注释相关联的getTextScaleClass调用并替换
            // 通常在同一行或附近的行
            const lineNumber = getLineNumber(content, commentMatch.index);
            const lines = content.split('\n');
            
            // 检查从注释所在行开始的5行内容
            const startLine = Math.max(0, lineNumber - 5);
            const endLine = Math.min(lines.length - 1, lineNumber + 5);
            
            for (let i = startLine; i <= endLine; i++) {
              const line = lines[i];
              
              // 查找getTextScaleClass调用
              const scaleClassMatch = line.match(/getTextScaleClass\(fontSize\s*([+-]\s*\d+|\d+)\)/);
              if (scaleClassMatch) {
                // 替换fontSize值
                const updatedLine = line.replace(
                  /getTextScaleClass\(fontSize\s*([+-]\s*\d+|\d+)\)/,
                  `getTextScaleClass(fontSize${newFontSize})`
                );
                
                if (updatedLine !== line) {
                  lines[i] = updatedLine;
                  content = lines.join('\n');
                  console.log(`已更新getTextScaleClass调用在行 ${i+1}`);
                  break;
                }
              }
            }
          }
        }
        
        // 如果还没有修改成功，尝试使用行号定位
        if (!modified && element.path.includes(':')) {
          const lineNumberStr = element.path.split(':')[1];
          const lineNumbers = lineNumberStr.split(',').map(n => parseInt(n.trim()));
          
          const lines = content.split('\n');
          
          for (const lineNum of lineNumbers) {
            if (lineNum > 0 && lineNum <= lines.length) {
              const lineIndex = lineNum - 1; // 转为0-based
              const line = lines[lineIndex];
              
              // 查找getTextScaleClass调用
              if (line.includes('getTextScaleClass') && line.includes('fontSize')) {
                const updatedLine = line.replace(
                  /getTextScaleClass\(fontSize\s*([+-]\s*\d+|\d+)\)/,
                  `getTextScaleClass(fontSize${element.relativeSizeValue >= 0 ? '+' + element.relativeSizeValue : element.relativeSizeValue})`
                );
                
                if (updatedLine !== line) {
                  lines[lineIndex] = updatedLine;
                  content = lines.join('\n');
                  modified = true;
                  console.log(`已更新行 ${lineNum} 的getTextScaleClass调用`);
                  break;
                }
              }
            }
          }
        }
        
        // 如果仍未修改，尝试之前的方法
        if (!modified) {
          // 使用正则表达式查找并替换样式
          // 这里使用多种可能的匹配模式
          
          // 1. 使用注释标记
          const startMarker = `// FONT_DEBUG_START: ${element.name}`;
          const endMarker = `// FONT_DEBUG_END: ${element.name}`;
          
          const patternWithMarkers = new RegExp(
            `${startMarker}[\\s\\S]*?style={{[\\s\\S]*?fontSize:[\\s\\S]*?mapLevelToPx\\(fontSize[^)]*\\)[\\s\\S]*?}}[\\s\\S]*?${endMarker}`,
            'g'
          );
          
          // 2. 直接匹配样式参数 - 改进匹配模式
          const valuePattern = new RegExp(
            `(fontSize:[ ]*(?:"|')?\\$\\{mapLevelToPx\\(fontSize\\s*)([-+]\\s*\\d+|\\d+)(\\)\\}(?:"|')?[ ]*)`,
            'g'
          );
          
          // 3. 匹配内联样式写法 - style={{ fontSize: ... }}
          const inlineStylePattern = new RegExp(
            `(style=\\{\\{[\\s\\S]*?fontSize:[ ]*(?:"|')?\\$\\{mapLevelToPx\\(fontSize\\s*)([-+]\\s*\\d+|\\d+)(\\)\\}(?:"|')?[\\s\\S]*?\\}\\})`,
            'g'
          );
          
          // 4. 匹配className写法 - className={`text-[${mapLevelToPx(fontSize...)}px]`}
          const classNamePattern = new RegExp(
            "(className=\\{['\"`][^'\"`]*?\\$\\{mapLevelToPx\\(fontSize\\s*)([-+]\\s*\\d+|\\d+)(\\)\\}[^'\"`]*?['\"`]\\})",
            'g'
          );
          
          // 5. 通用匹配模式 - 任何包含mapLevelToPx(fontSize...)的模式
          const genericPattern = new RegExp(
            `(mapLevelToPx\\(fontSize\\s*)([-+]\\s*\\d+|\\d+)(\\))`,
            'g'
          );
          
          // 6. Tailwind类名匹配 - text-[font-size]
          const tailwindPattern = new RegExp(
            `(text-\\[\\$\\{(?:getFontSize|mapLevelToPx)\\(fontSize\\s*)([-+]\\s*\\d+|\\d+)(\\)\\}px\\])`,
            'g'
          );
          
          // 7. 直接内联样式匹配 - style={{fontSize: "14px"}}
          const directStylePattern = new RegExp(
            `(style=\\{\\{[\\s\\S]*?fontSize:[ ]*["'])(\\d+)(px["'][\\s\\S]*?\\}\\})`,
            'g'
          );
          
          // 8. CSS变量匹配 - var(--font-size)
          const cssVarPattern = new RegExp(
            `(var\\(--font-size-)(\\d+)(\\))`,
            'g'
          );
          
          // 9. React样式对象匹配 - fontSize: fontSize + X
          const reactStylePattern = new RegExp(
            `(fontSize: *fontSize *)([-+] *\\d+|\\d+)`,
            'g'
          );
          
          let modified = false;
          
          // 尝试基于注释标记替换
          if (content.includes(startMarker) && content.includes(endMarker)) {
            content = content.replace(patternWithMarkers, (match) => {
              modified = true;
              
              // 提取样式部分
              const styleMatch = match.match(/style={{[\\s\\S]*?}}/);
              if (!styleMatch) return match; // 如果没找到style，返回原样
              
              // 替换fontSize部分
              return `${startMarker}\n      style={{ fontSize: \`\${mapLevelToPx(fontSize${element.relativeSizeValue >= 0 ? '+' : ''}${element.relativeSizeValue})}px\` }}\n      ${endMarker}`;
            });
          } 
          // 尝试直接替换参数
          else {
            // 依次尝试所有模式
            const patterns = [
              valuePattern, 
              inlineStylePattern, 
              classNamePattern, 
              genericPattern,
              tailwindPattern,
              directStylePattern,
              cssVarPattern,
              reactStylePattern
            ];
            
            for (const pattern of patterns) {
              if (!modified) {
                const newContent = content.replace(pattern, (match, before, value, after) => {
                  console.log(`匹配成功: ${match}`);
                  return `${before}${element.relativeSizeValue >= 0 ? '+' : ''}${element.relativeSizeValue}${after}`;
                });
                
                // 仅当内容实际发生变化时，才标记为已修改
                if (newContent !== content) {
                  content = newContent;
                  modified = true;
                  console.log(`使用模式匹配成功`);
                }
              }
            }
          }
          
          // 如果没有修改，尝试更智能的方法
          if (!modified) {
            // 基于元素名称定位匹配点
            // 首先将元素名称转换为可能存在的变量或标识符格式
            const possibleIdentifiers = [
              element.name,
              element.name.toLowerCase(),
              element.name.replace(/\s+/g, ''),
              element.name.replace(/\s+/g, '_'),
              element.name.replace(/\s+/g, '-')
            ];
            
            // 在变量名、注释、属性名等周围寻找匹配
            let contextLines = [];
            const lines = content.split('\n');
            
            // 查找可能的行号
            let lineNumbers = [];
            if (element.path.includes(':')) {
              // 从路径中提取可能的行号
              const lineNumberMatches = element.path.match(/:(\d+)/g);
              if (lineNumberMatches) {
                lineNumberMatches.forEach(match => {
                  const lineNumber = parseInt(match.substring(1)) - 1; // 0-based index
                  if (lineNumber >= 0 && lineNumber < lines.length) {
                    lineNumbers.push(lineNumber);
                  }
                });
              }
            }
            
            // 如果有可能的行号，先尝试使用它们
            if (lineNumbers.length > 0) {
              for (const lineNumber of lineNumbers) {
                // 收集上下文（前后5行）
                const start = Math.max(0, lineNumber - 5);
                const end = Math.min(lines.length - 1, lineNumber + 5);
                contextLines = lines.slice(start, end + 1);
                
                // 在上下文中查找字体大小相关代码
                const contextText = contextLines.join('\n');
                
                // 搜索任何与字体大小相关的模式
                const fontSizePatterns = [
                  /fontSize\s*[:=]\s*[^;,}]+/g,
                  /font-size:[^;{]+;/g,
                  /className\s*=\s*[^{>]+text-[^{>]+/g,
                  /style\s*=\s*\{[^}]*\}/g
                ];
                
                for (const pattern of fontSizePatterns) {
                  const matches = contextText.match(pattern);
                  if (matches) {
                    console.log(`在行号附近找到可能的样式: ${matches[0]}`);
                    
                    // 尝试替换此上下文中的字体大小
                    const updatedContext = replaceFontSizeInContext(contextText, element.relativeSizeValue);
                    if (updatedContext !== contextText) {
                      // 用更新后的上下文替换原始内容
                      const originalContext = lines.slice(start, end + 1).join('\n');
                      content = content.replace(originalContext, updatedContext);
                      modified = true;
                      break;
                    }
                  }
                }
                
                if (modified) break;
              }
            }
            
            // 如果仍未修改，尝试通过标识符查找
            if (!modified) {
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                // 查找可能包含元素标识符的行
                if (possibleIdentifiers.some(id => line.includes(id))) {
                  // 收集上下文（前后5行）
                  const start = Math.max(0, i - 5);
                  const end = Math.min(lines.length - 1, i + 5);
                  contextLines = lines.slice(start, end + 1);
                  break;
                }
              }
              
              if (contextLines.length > 0) {
                // 在上下文中查找fontSize相关代码
                const contextText = contextLines.join('\n');
                const updatedContext = replaceFontSizeInContext(contextText, element.relativeSizeValue);
                
                if (updatedContext !== contextText) {
                  // 用更新后的上下文替换原始内容
                  const originalContext = contextLines.join('\n');
                  content = content.replace(originalContext, updatedContext);
                  modified = true;
                }
              }
            }
            
            // 最后的尝试：直接搜索任何包含fontSize的部分，然后尝试替换
            if (!modified) {
              // 分析文件内容，寻找字体大小相关的部分
              const fontSizeMatches = analyzeFontSizePatterns(content);
              
              if (fontSizeMatches.length > 0) {
                console.log(`找到 ${fontSizeMatches.length} 个可能的字体大小设置`);
                
                // 尝试找到与当前元素最相关的匹配
                let bestMatch = null;
                let bestScore = 0;
                
                for (const match of fontSizeMatches) {
                  // 计算与元素名称的相关性分数
                  const score = calculateRelevanceScore(match, element.name);
                  if (score > bestScore) {
                    bestScore = score;
                    bestMatch = match;
                  }
                }
                
                if (bestMatch && bestScore > 0.3) {  // 设置一个相关性阈值
                  console.log(`找到最佳匹配: ${bestMatch.text}, 分数: ${bestScore}`);
                  
                  // 替换最佳匹配中的数值
                  const newText = replaceFontSizeValue(bestMatch.text, element.relativeSizeValue);
                  if (newText !== bestMatch.text) {
                    content = content.replace(bestMatch.text, newText);
                    modified = true;
                  }
                }
              }
            }
          }
        }
        
        if (!modified) {
          throw new Error(`无法找到匹配的@font-tool注释或样式: ${element.name}`);
        }
        
        // 更新文件内容缓存
        fileContentCache[filePath] = content;
        
        // 写回文件
        fs.writeFileSync(filePath, content, 'utf8');
        
        results.success.push({
          file: filePath,
          element: element.name,
          relativeSizeValue: element.relativeSizeValue
        });
        
        console.log(`成功修改: ${filePath}, 元素: ${element.name}`);
      } catch (error) {
        console.error(`修改失败: ${error.message}`);
        results.failure.push({
          element: element.name,
          path: element.path,
          error: error.message
        });
      }
    }
  }
  
  // 结果统计
  if (results.success.length > 0 || results.failure.length > 0) {
    const resultMessage = [
      `成功应用: ${results.success.length} 项`,
      `失败: ${results.failure.length} 项`
    ].join('\n');
    
    // 如果有窗口实例，显示结果对话框
    if (BrowserWindow.getAllWindows().length > 0) {
      dialog.showMessageBox(BrowserWindow.getFocusedWindow(), {
        type: results.failure.length > 0 ? 'warning' : 'info',
        title: '应用字体配置结果',
        message: resultMessage,
        detail: results.failure.length > 0 
          ? '部分配置应用失败，可能是因为找不到文件或@font-tool注释。请检查控制台获取详细信息。' 
          : '所有配置已成功应用到代码。'
      });
    }
  }
  
  // 处理完毕，发送热更新通知
  if (results.success.length > 0) {
    const updatedFiles = results.success.map(item => item.file);
    notifyConfigUpdate(projectDir, updatedFiles);
  }
  
  return results;
});

// 工具函数：转义正则表达式特殊字符
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 辅助函数：替换上下文中的字体大小
function replaceFontSizeInContext(context, newRelativeValue) {
  // 各种可能的字体大小模式
  const patterns = [
    // mapLevelToPx相关模式
    {
      pattern: /(mapLevelToPx\(fontSize\s*)([-+]\s*\d+|\d+)(\))/g,
      replacer: (match, before, value, after) => 
        `${before}${newRelativeValue >= 0 ? '+' : ''}${newRelativeValue}${after}`
    },
    // 直接fontSize属性
    {
      pattern: /(fontSize:\s*["'])(\d+)(px["'])/g,
      replacer: (match, before, value, after) => {
        // 这里需要计算实际像素值
        const baseFontSize = 13; // 假设基础大小为13px
        const newPx = baseFontSize + newRelativeValue;
        return `${before}${newPx}${after}`;
      }
    },
    // Tailwind类名
    {
      pattern: /(text-\[)(\d+)(px\])/g,
      replacer: (match, before, value, after) => {
        const baseFontSize = 13;
        const newPx = baseFontSize + newRelativeValue;
        return `${before}${newPx}${after}`;
      }
    },
    // React样式对象
    {
      pattern: /(fontSize:\s*fontSize\s*)([-+]\s*\d+|\d+)/g,
      replacer: (match, before, value) => 
        `${before}${newRelativeValue >= 0 ? '+' : ''}${newRelativeValue}`
    }
  ];
  
  let result = context;
  
  // 依次尝试所有模式
  for (const {pattern, replacer} of patterns) {
    result = result.replace(pattern, replacer);
  }
  
  return result;
}

// 辅助函数：分析文件中的字体大小模式
function analyzeFontSizePatterns(content) {
  const results = [];
  
  // 定义各种字体大小相关的模式
  const patterns = [
    {
      pattern: /style={[^}]*?fontSize:(?:[^}]*?)}/g,
      type: 'inlineStyle'
    },
    {
      pattern: /className={`[^`]*?text-\[\${[^}]*?}\][^`]*?`}/g,
      type: 'tailwind'
    },
    {
      pattern: /fontSize=[^>\n]+/g,
      type: 'fontSize'
    },
    {
      pattern: /font-size:[^;{]+;/g,
      type: 'cssStyle'
    }
  ];
  
  // 查找所有匹配项
  patterns.forEach(({pattern, type}) => {
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach(match => {
        results.push({
          text: match,
          type,
          // 获取匹配的上下文（前后20个字符）
          context: getMatchContext(content, match, 20)
        });
      });
    }
  });
  
  return results;
}

// 辅助函数：获取匹配项的上下文
function getMatchContext(content, match, contextSize) {
  const index = content.indexOf(match);
  if (index === -1) return '';
  
  const start = Math.max(0, index - contextSize);
  const end = Math.min(content.length, index + match.length + contextSize);
  
  return content.substring(start, end);
}

// 辅助函数：计算相关性分数
function calculateRelevanceScore(match, elementName) {
  const context = match.context.toLowerCase();
  const name = elementName.toLowerCase();
  
  // 简单的相关性评分策略
  let score = 0;
  
  // 如果上下文包含元素名称，给予高分
  if (context.includes(name)) {
    score += 0.7;
  }
  
  // 如果上下文包含元素名称的部分单词，给予部分分数
  const words = name.split(/\s+/);
  words.forEach(word => {
    if (word.length > 2 && context.includes(word)) {
      score += 0.2;
    }
  });
  
  // 如果是style或className属性，可能性更高
  if (match.type === 'inlineStyle' || match.type === 'tailwind') {
    score += 0.2;
  }
  
  return Math.min(1, score); // 分数范围控制在0-1之间
}

// 辅助函数：替换字体大小值
function replaceFontSizeValue(text, newRelativeValue) {
  // 尝试不同的模式来替换字体大小值
  
  // 模式1: mapLevelToPx(fontSize±X)
  const pattern1 = /(mapLevelToPx\(fontSize\s*)([-+]\s*\d+|\d+)(\))/g;
  let result = text.replace(pattern1, (match, before, value, after) => 
    `${before}${newRelativeValue >= 0 ? '+' : ''}${newRelativeValue}${after}`
  );
  
  // 模式2: fontSize: fontSize±X
  const pattern2 = /(fontSize:\s*fontSize\s*)([-+]\s*\d+|\d+)/g;
  result = result.replace(pattern2, (match, before, value) => 
    `${before}${newRelativeValue >= 0 ? '+' : ''}${newRelativeValue}`
  );
  
  // 模式3: text-[${X}px]
  const pattern3 = /(text-\[\${)(\d+)(}px\])/g;
  result = result.replace(pattern3, (match, before, value, after) => {
    const baseFontSize = 13; // 假设基础大小为13px
    const newPx = baseFontSize + newRelativeValue;
    return `${before}${newPx}${after}`;
  });
  
  return result;
}

// IPC处理器：打开文件并定位到特定行
ipcMain.handle('open-file-at-location', async (event, projectDir, fileName, lineNumbers) => {
  console.log('打开文件:', fileName, '行号:', lineNumbers);
  
  try {
    // 查找文件
    const filePath = await findFile(projectDir, fileName);
    console.log('找到文件:', filePath);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    
    // 读取文件内容
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    // 转换lineNumbers为数组
    let targetLines = Array.isArray(lineNumbers) ? lineNumbers : [lineNumbers];
    
    // 确保行号有效
    targetLines = targetLines
      .map(line => {
        // 处理可能的字符串格式 "123"
        const lineNum = parseInt(line, 10);
        // 调整为0-based索引
        return isNaN(lineNum) ? null : Math.max(0, lineNum - 1);
      })
      .filter(line => line !== null && line < lines.length);
    
    if (targetLines.length === 0) {
      throw new Error(`没有有效的行号: ${lineNumbers}`);
    }
    
    // 为每个目标行获取上下文（前后5行）
    const contexts = [];
    
    targetLines.forEach(lineNum => {
      const startLine = Math.max(0, lineNum - 5);
      const endLine = Math.min(lines.length - 1, lineNum + 5);
      
      contexts.push({
        lineNumber: lineNum + 1, // 转回1-based索引用于显示
        content: lines.slice(startLine, endLine + 1).join('\n'),
        startLine: startLine + 1, // 1-based索引
        endLine: endLine + 1 // 1-based索引
      });
    });
    
    // 扫描文件中的@font-tool注释
    const fontToolComments = [];
    const fontToolPattern = /@font-tool:\s*([^-]+)\s*-\s*([^-]+)\s*-\s*fontSize([+-]\d+)/g;
    let match;
    
    while ((match = fontToolPattern.exec(content)) !== null) {
      const componentName = match[1].trim();
      const elementName = match[2].trim();
      const fontSizeValue = match[3].trim();
      const lineNumber = getLineNumber(content, match.index);
      
      fontToolComments.push({
        componentName,
        elementName,
        fontSizeValue,
        lineNumber,
        index: match.index
      });
    }
    
    // 找出与目标行相关的@font-tool注释
    for (const context of contexts) {
      const relevantComments = fontToolComments.filter(comment => 
        comment.lineNumber >= context.startLine - 3 && 
        comment.lineNumber <= context.endLine + 3
      );
      
      context.fontToolComments = relevantComments;
    }
    
    // 打开新窗口显示文件内容
    const codeWindow = new BrowserWindow({
      width: 1000,
      height: 800,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      }
    });
    
    // 加载HTML内容
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${fileName}</title>
        <style>
          body {
            font-family: system-ui, -apple-system, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
          }
          .file-info {
            padding: 10px;
            background-color: #333;
            color: white;
            margin-bottom: 15px;
            border-radius: 4px;
            font-size: 14px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .file-info button {
            background-color: #555;
            border: none;
            color: white;
            padding: 5px 10px;
            border-radius: 3px;
            cursor: pointer;
          }
          .file-info button:hover {
            background-color: #777;
          }
          .context-block {
            margin-bottom: 20px;
            border: 1px solid #ddd;
            border-radius: 4px;
            overflow: hidden;
          }
          .context-header {
            padding: 8px 15px;
            background-color: #eaeaea;
            font-size: 13px;
            font-weight: bold;
            border-bottom: 1px solid #ddd;
          }
          pre {
            margin: 0;
            padding: 15px;
            overflow-x: auto;
            background-color: white;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            line-height: 1.4;
          }
          .highlight {
            background-color: #ffeb3b;
            display: inline-block;
            width: 100%;
          }
          .font-tool-highlight {
            background-color: #c8e6c9;
            display: inline-block;
            width: 100%;
          }
          .line-number {
            user-select: none;
            color: #999;
            display: inline-block;
            width: 30px;
            text-align: right;
            margin-right: 10px;
            font-size: 12px;
          }
          .font-tool-info {
            margin-top: 5px;
            padding: 8px;
            background-color: #e8f5e9;
            border-radius: 4px;
            font-size: 12px;
            color: #2e7d32;
          }
        </style>
      </head>
      <body>
        <div class="file-info">
          <span>文件路径: ${filePath}</span>
          <button onclick="window.close()">关闭</button>
        </div>
        
        ${contexts.map(context => {
          // 获取context中的所有行
          const contextLines = context.content.split('\n');
          
          // 为每一行生成带行号的HTML
          const linesHtml = contextLines.map((line, index) => {
            const currentLineNumber = context.startLine + index;
            const isTargetLine = currentLineNumber === context.lineNumber;
            const isFontToolLine = context.fontToolComments && context.fontToolComments.some(c => c.lineNumber === currentLineNumber);
            const highlightClass = isTargetLine ? 'highlight' : isFontToolLine ? 'font-tool-highlight' : '';
            
            return `
              <div ${highlightClass ? `class="${highlightClass}"` : ''}>
                <span class="line-number">${currentLineNumber}</span>${escapeHtml(line)}
              </div>
            `;
          }).join('');
          
          // 显示该上下文中的@font-tool注释信息
          const fontToolInfoHtml = context.fontToolComments && context.fontToolComments.length > 0 
            ? `
              <div class="font-tool-info">
                找到相关@font-tool注释:
                <ul>
                ${context.fontToolComments.map(comment => `
                  <li>行 ${comment.lineNumber}: ${comment.componentName} - ${comment.elementName} - fontSize${comment.fontSizeValue}</li>
                `).join('')}
                </ul>
              </div>
            ` 
            : '';
          
          return `
            <div class="context-block">
              <div class="context-header">行号: ${context.lineNumber}</div>
              <pre>${linesHtml}</pre>
              ${fontToolInfoHtml}
            </div>
          `;
        }).join('')}
        
        <script>
          // 辅助函数
          function escapeHtml(text) {
            return text
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
          }
        </script>
      </body>
      </html>
    `;
    
    // 将HTML内容写入临时文件
    const tempFilePath = path.join(app.getPath('temp'), `code-view-${Date.now()}.html`);
    fs.writeFileSync(tempFilePath, htmlContent);
    
    // 加载临时HTML文件
    codeWindow.loadFile(tempFilePath);
    
    // 等待窗口关闭后删除临时文件
    codeWindow.on('closed', () => {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (error) {
        console.error('无法删除临时文件:', error);
      }
    });
    
    return { success: true };
  } catch (error) {
    console.error('打开文件失败:', error);
    
    // 显示错误对话框
    dialog.showErrorBox(
      '打开文件失败',
      `无法打开文件: ${error.message}`
    );
    
    return { success: false, error: error.message };
  }
});

// 辅助函数：HTML转义
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 获取WebSocket服务器状态
ipcMain.handle('get-websocket-status', () => {
  return {
    running: wss !== null,
    port: hotReloadPort,
    clientCount: wss ? wss.clients.size : 0
  };
});

// IPC处理器：生成React热更新客户端代码
ipcMain.handle('generate-hot-reload-client', () => {
  const code = `
// font-tool热更新客户端
// 在你的React应用主入口文件中引入此脚本
(function() {
  let ws = null;
  let reconnectTimer = null;
  const port = ${hotReloadPort};
  
  function connect() {
    ws = new WebSocket(\`ws://localhost:\${port}\`);
    
    ws.onopen = () => {
      console.log('[font-tool] 热更新连接已建立');
      clearTimeout(reconnectTimer);
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'font-config-updated') {
          console.log('[font-tool] 字体配置已更新，正在刷新样式');
          
          // 刷新所有使用getTextScaleClass的元素
          document.querySelectorAll('[data-font-tool]').forEach(el => {
            // 触发React的重新渲染
            const event = new Event('font-config-updated');
            window.dispatchEvent(event);
          });
          
          // 提供视觉反馈
          const notification = document.createElement('div');
          notification.textContent = '字体设置已更新';
          notification.style.position = 'fixed';
          notification.style.bottom = '20px';
          notification.style.right = '20px';
          notification.style.backgroundColor = '#4CAF50';
          notification.style.color = 'white';
          notification.style.padding = '10px 15px';
          notification.style.borderRadius = '4px';
          notification.style.zIndex = '9999';
          notification.style.opacity = '0';
          notification.style.transition = 'opacity 0.3s';
          
          document.body.appendChild(notification);
          
          // 显示通知
          setTimeout(() => {
            notification.style.opacity = '1';
          }, 10);
          
          // 3秒后隐藏通知
          setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
              document.body.removeChild(notification);
            }, 300);
          }, 3000);
        }
      } catch (error) {
        console.error('[font-tool] 处理消息时出错:', error);
      }
    };
    
    ws.onclose = () => {
      console.log('[font-tool] 热更新连接已关闭，尝试重新连接');
      // 5秒后尝试重新连接
      reconnectTimer = setTimeout(connect, 5000);
    };
    
    ws.onerror = (error) => {
      console.error('[font-tool] WebSocket错误:', error);
      ws.close();
    };
  }
  
  // 初始连接
  connect();
  
  // 导出API
  window.fontToolHotReload = {
    reconnect: connect,
    isConnected: () => ws && ws.readyState === WebSocket.OPEN
  };
})();
  `;
  
  return code;
}); 