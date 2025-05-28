// Electron主进程
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

// 全局配置
global.useDirectCodeUpdate = true; // 使用实时代码更新，禁用WebSocket热更新通知

// WebSocket服务器
let wss = null;
let hotReloadPort = 28888; // 默认端口

// 设置WebSocket服务器
function setupWebSocketServer() {
  const server = http.createServer();
  wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    console.log('新的WebSocket连接');
    
    // 为每个连接添加一个标识符属性
    ws.clientId = Date.now().toString(36) + Math.random().toString(36).substring(2);
    ws.isDebugMode = false;
    
    ws.on('message', (messageData) => {
      try {
        const message = JSON.parse(messageData.toString());
        console.log(`收到客户端[${ws.clientId}]消息:`, message);
        
        // 处理不同类型的消息
        if (message.type === 'cursor-plugin-connected') {
          console.log('Cursor插件已连接，版本:', message.version);
          ws.isCursorPlugin = true;
          
          // 如果客户端请求开启调试模式
          if (message.debug === true) {
            ws.isDebugMode = true;
            console.log(`客户端[${ws.clientId}]已启用调试模式`);
          }
          
          ws.send(JSON.stringify({
            type: 'connected',
            message: 'Connected to font-tool',
            serverInfo: {
              name: 'Font Tool Server',
              version: '1.0.0',
              capabilities: ['debug-mode', 'comment-tracking', 'element-matching'],
              timestamp: Date.now()
            }
          }));
        } else if (message.type === 'client-connected') {
          console.log(`客户端[${ws.clientId}]已连接，时间戳:`, message.timestamp);
          
          // 记录客户端标识信息
          ws.isWebClient = true;
          ws.clientComponent = message.component || 'unknown';
          ws.clientInfo = {
            timestamp: message.timestamp,
            capabilities: message.capabilities || [],
            userAgent: message.userAgent || 'unknown'
          };
          
          console.log(`客户端标识信息: 组件=${ws.clientComponent}, 能力=[${ws.clientInfo.capabilities}]`);
          
          ws.send(JSON.stringify({
            type: 'connected',
            message: 'Connected to font-tool server',
            serverInfo: {
              name: 'Font Tool Server',
              version: '1.0.0',
              debug: ws.isDebugMode,
              timestamp: Date.now()
            }
          }));
        } else if (message.type === 'get-status') {
          console.log(`收到客户端[${ws.clientId}]状态请求`);
          ws.send(JSON.stringify({
            type: 'status',
            connections: wss.clients.size,
            serverTime: new Date().toISOString(),
            debugMode: ws.isDebugMode
          }));
        } else if (message.type === 'enable-debug-mode') {
          ws.isDebugMode = true;
          console.log(`客户端[${ws.clientId}]已启用调试模式`);
          
          // 确认调试模式状态
          ws.send(JSON.stringify({
            type: 'debug-mode-enabled',
            timestamp: Date.now()
          }));
        } else if (message.type === 'heartbeat') {
          // 收到心跳消息，只记录客户端仍然活跃
          console.log(`收到客户端[${ws.clientId}]心跳消息`);
          
          // 发送心跳响应
          ws.send(JSON.stringify({
            type: 'heartbeat-response',
            serverTime: Date.now()
          }));
        } else if (message.type === 'font-size-update' || message.type === 'slider-change') {
          // 新增：处理字体大小更新事件（来自滑块）
          console.log(`收到客户端[${ws.clientId}]字体大小更新:`, message);
          
          // 保存更新数据以便通知其他客户端
          if (!global.lastAppliedConfig) {
            global.lastAppliedConfig = [];
          }
          
          // 更新或添加配置
          const update = {
            componentName: message.componentName || ws.clientComponent || 'Global',
            elementName: message.elementName || 'Text',
            relativeSizeValue: message.relativeSizeValue || message.value || '+0',
            source: message.source || 'slider',
            timestamp: Date.now(),
            clientId: ws.clientId
          };
          
          // 更新全局配置
          let configFound = false;
          for (let i = 0; i < global.lastAppliedConfig.length; i++) {
            if (global.lastAppliedConfig[i].componentName === update.componentName && 
                global.lastAppliedConfig[i].elementName === update.elementName) {
              global.lastAppliedConfig[i].relativeSizeValue = update.relativeSizeValue;
              configFound = true;
              break;
            }
          }
          
          if (!configFound) {
            global.lastAppliedConfig.push({
              componentName: update.componentName,
              elementName: update.elementName,
              relativeSizeValue: update.relativeSizeValue,
              elements: [{
                name: update.elementName,
                relativeSizeValue: update.relativeSizeValue
              }]
            });
          }
          
          // 通知所有客户端，包括发送者
          notifyConfigUpdate([], [], message.type);
          
          // 发送确认消息
          ws.send(JSON.stringify({
            type: 'update-confirmed',
            update: update,
            timestamp: Date.now()
          }));
        } else if (message.type === 'scan-result') {
          // 记录客户端扫描结果
          console.log(`收到客户端[${ws.clientId}]扫描结果:`, message);
        }
      } catch (error) {
        console.error('处理WebSocket消息出错:', error);
      }
    });
    
    ws.on('close', () => {
      console.log(`客户端[${ws.clientId}]WebSocket连接关闭`);
    });
    
    ws.on('error', (error) => {
      console.error(`客户端[${ws.clientId}]WebSocket连接错误:`, error);
    });
    
    // 发送初始连接确认消息
    ws.send(JSON.stringify({ 
      type: 'connected', 
      message: 'Connected to font-tool',
      serverStatus: 'ready'
    }));
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
  // 禁用WebSocket服务器，因为现在已有实时代码更新功能
  // setupWebSocketServer();
  console.log('热更新WebSocket服务器已禁用，使用实时代码更新功能替代');
  createWindow();

  // macOS特有的处理：当所有窗口都关闭后重新打开一个窗口
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 通知客户端配置已更新
function notifyConfigUpdate(projectDir, updatedFiles, sourceType = 'file-change') {
  // 如果实时代码更新功能已启用，直接返回，无需热更新通知
  if (global.useDirectCodeUpdate === true) {
    console.log('使用实时代码更新功能，跳过WebSocket热更新通知');
    return;
  }
  
  if (!wss) {
    console.log('WebSocket服务器未初始化，跳过热更新通知');
    return;
  }
  
  if (!wss.clients || wss.clients.size === 0) {
    console.log('没有连接的WebSocket客户端，跳过热更新通知');
    return;
  }
  
  // 收集所有更新元素的详细信息
  const updatedElements = [];
  
  // 从全局配置或缓存中获取最新的配置
  if (global.lastAppliedConfig && Array.isArray(global.lastAppliedConfig)) {
    for (const config of global.lastAppliedConfig) {
      if (config.elements && Array.isArray(config.elements)) {
        for (const element of config.elements) {
          // 增强元素信息，提供更多的定位线索
          updatedElements.push({
            componentName: config.componentName,
            elementName: element.name || 'unnamed',
            relativeSizeValue: element.relativeSizeValue,
            selector: element.selector || `[data-component="${config.componentName}"]`, // CSS选择器提示
            path: element.path,
            // 新增：更多定位信息
            cssClasses: element.cssClasses || [], // 元素可能的CSS类
            tagName: element.tagName || '', // 元素可能的标签名
            textContent: element.textContent || '', // 元素可能包含的文本内容
            elementInfo: element.elementInfo || {}, // 其他可能的元素特征
            // 提供多种匹配策略的选择器
            alternativeSelectors: [
              // 1. 使用data-font-tool属性
              `[data-font-tool]`,
              // 2. 基于文本内容的选择器（如果有）
              element.textContent ? 
                `:contains("${element.textContent.substring(0, 30)}")` : '',
              // 3. 基于类名的选择器（如果有）
              element.cssClasses && element.cssClasses.length ? 
                `.${element.cssClasses.join('.')}` : '',
              // 4. 基于ID的选择器（如果有）
              element.elementInfo && element.elementInfo.id ? 
                `#${element.elementInfo.id}` : ''
            ].filter(s => s) // 过滤掉空字符串
          });
        }
      }
    }
  }
  
  // 即使没有详细配置，也至少提供一些基本信息
  if (updatedElements.length === 0) {
    // 尝试从文件中提取一些基本信息
    for (const filePath of updatedFiles) {
      try {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          
          // 匹配可能的@font-tool注释
          // 支持三种格式：
          // 1. 简单格式：@font-tool:+1
          // 2. 复杂格式：@font-tool: ComponentName - ElementName - fontSize+1
          // 3. 中文格式：@font-tool：ElementName (使用中文冒号)
          // 4. 组件名格式：@font-tool组件：组件名
          const simpleFontToolRegex = /@font-tool:([+-]?\d+)/g;
          const complexFontToolRegex = /(?:\{\/\*|<!--|\/\/|\/\*)\s*@font-tool(?::|：)\s*(?:([^-]+)\s*-\s*([^-]+)\s*-\s*fontSize([+-]\d+)|([^*}/\n]+?))\s*(?:\*\/\}|-->|\*\/)?/g;
          const componentNameRegex = /(?:\{\/\*|<!--|\/\/|\/\*)\s*@font-tool组件(?::|：)\s*([^*}/\n]+?)\s*(?:\*\/\}|-->|\*\/)?/g;
          
          // 首先尝试查找组件名注释
          let componentName = path.basename(filePath, path.extname(filePath));
          let compMatch;
          while ((compMatch = componentNameRegex.exec(content)) !== null) {
            if (compMatch && compMatch[1]) {
              componentName = compMatch[1].trim();
              console.log(`在文件 ${filePath} 中找到组件名注释: @font-tool组件：${componentName}`);
              break; // 只取第一个匹配的组件名
            }
          }
          
          // 处理复杂格式的注释
          let complexMatch;
          while ((complexMatch = complexFontToolRegex.exec(content)) !== null) {
            // 检查是否为旧格式（带 - 分隔符）或新格式（中文冒号）
            const isOldFormat = complexMatch[1] && complexMatch[2] && complexMatch[3];
            
            let elementName, relativeSizeValue;
            
            if (isOldFormat) {
              // 旧格式: @font-tool: ComponentName - ElementName - fontSize+1
              // 注意：使用前面查找到的组件名，而不是从注释中提取
              elementName = complexMatch[2].trim();
              relativeSizeValue = complexMatch[3];
            } else {
              // 新格式: @font-tool：ElementName
              elementName = complexMatch[4].trim();
              
              // 默认相对大小为0
              relativeSizeValue = "+0";
            }
            
            const lineContent = getLineContent(content, complexMatch.index);
            
            console.log(`处理文件: ${filePath}`);
            console.log(`组件: "${componentName}", 元素: "${elementName}", 相对大小: ${relativeSizeValue}`);
            console.log(`在 ${projectDir} 中搜索 ${path.basename(filePath)}`);
            
            updatedElements.push({
              componentName: componentName,
              elementName: elementName,
              relativeSizeValue: relativeSizeValue,
              selector: '',
              filePath: filePath,
              lineContent: lineContent,
              matchPattern: complexMatch[0]
            });
          }
          
          // 处理简单格式的注释
          let simpleMatch;
          while ((simpleMatch = simpleFontToolRegex.exec(content)) !== null) {
            // 如果与之前的复杂匹配重叠，则跳过
            let isDuplicate = false;
            for (const element of updatedElements) {
              if (element.filePath === filePath && 
                  element.matchPattern.includes(simpleMatch[0])) {
                isDuplicate = true;
                break;
              }
            }
            
            if (!isDuplicate) {
              const relativeSizeValue = simpleMatch[1];
              const lineContent = getLineContent(content, simpleMatch.index);
              
              // 尝试从上下文中推断组件名和元素名
              const surroundingText = content.substring(
                Math.max(0, simpleMatch.index - 100),
                Math.min(content.length, simpleMatch.index + 100)
              );
              
              // 组件名可能是文件名或从类/函数定义中提取
              const componentMatch = surroundingText.match(/function\s+(\w+)|class\s+(\w+)|const\s+(\w+)\s*=/);
              const componentName = componentMatch 
                ? (componentMatch[1] || componentMatch[2] || componentMatch[3]) 
                : path.basename(filePath, path.extname(filePath));
              
              // 尝试从注释或标签中提取元素名
              const elementMatch = surroundingText.match(/['"]([\w\s]+)['"]|<(\w+)[^>]*>/);
              const elementName = elementMatch 
                ? (elementMatch[1] || elementMatch[2])
                : `element_${updatedElements.length + 1}`;
              
              console.log(`在文件 ${filePath} 中找到简单字体工具注释: ${simpleMatch[0]}, 相对大小值: ${relativeSizeValue}`);
              
              updatedElements.push({
                componentName: componentName,
                elementName: elementName,
                relativeSizeValue: relativeSizeValue,
                selector: '',
                filePath: filePath,
                lineContent: lineContent,
                matchPattern: simpleMatch[0]
              });
            }
          }
          
          // 查找可能的mapLevelToPx函数使用
          const mapLevelRegex = /mapLevelToPx\(fontSize\s*([+-]\s*\d+|\d+)\)/g;
          let mapLevelMatch;
          while ((mapLevelMatch = mapLevelRegex.exec(content)) !== null) {
            const relativeSizeValue = mapLevelMatch[1].replace(/\s+/g, '');
            const lineContent = getLineContent(content, mapLevelMatch.index);
            
            console.log(`在文件 ${filePath} 中找到mapLevelToPx使用: ${mapLevelMatch[0]}, 相对大小: ${relativeSizeValue}`);
            
            // 尝试从上下文中推断组件名和元素名
            const surroundingText = content.substring(
              Math.max(0, mapLevelMatch.index - 100),
              Math.min(content.length, mapLevelMatch.index + 100)
            );
            
            // 查找前面的注释，可能包含元素名称
            const commentMatch = surroundingText.match(/@font-tool:[^@]*/);
            let elementName = 'unnamed';
            
            if (commentMatch) {
              // 尝试从注释中提取元素名称
              const nameMatch = commentMatch[0].match(/:\s*([^-]+)\s*-\s*([^-]+)/);
              if (nameMatch) {
                elementName = nameMatch[2].trim();
              }
            }
            
            // 组件名可能是文件名
            const componentName = path.basename(filePath, path.extname(filePath));
            
            updatedElements.push({
              componentName: componentName,
              elementName: elementName,
              relativeSizeValue: relativeSizeValue,
              selector: '',
              filePath: filePath,
              lineContent: lineContent,
              matchPattern: mapLevelMatch[0]
            });
          }
        }
      } catch (err) {
        console.error(`分析文件 ${filePath} 时出错:`, err);
      }
    }
  }
  
  // 即使没有找到元素也发送更新，以便客户端知道有变化
  const updateMessage = {
    type: 'font-config-updated',
    timestamp: Date.now(),
    sourceType: sourceType, // 添加更新源类型（文件变化、滑块、按钮等）
    updatedFiles: updatedFiles,
    updates: updatedElements,
    totalElementsUpdated: updatedElements.length
  };
  
  console.log(`正在向 ${wss.clients.size} 个客户端发送更新，共 ${updatedElements.length} 个元素`);
  
  // 向所有连接的客户端发送更新
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        // 为调试模式的客户端添加更多信息
        const messageToSend = client.isDebugMode ? 
          {
            ...updateMessage,
            debug: {
              server: {
                time: new Date().toISOString(),
                clients: wss.clients.size
              },
              matchDetails: updatedElements.map(el => ({
                componentName: el.componentName,
                elementName: el.elementName,
                relativeSizeValue: el.relativeSizeValue,
                matchPattern: el.matchPattern,
                filePath: el.filePath ? path.basename(el.filePath) : undefined
              }))
            }
          } : updateMessage;
        
        client.send(JSON.stringify(messageToSend));
        console.log(`已向客户端[${client.clientId}]发送更新`);
      } catch (err) {
        console.error(`向客户端[${client.clientId}]发送消息时出错:`, err);
      }
    }
  });
  
  return updateMessage;
}

// 获取指定位置所在行的内容
function getLineContent(content, index) {
  const lineStart = content.lastIndexOf('\n', index) + 1;
  const lineEnd = content.indexOf('\n', index);
  return content.substring(lineStart, lineEnd !== -1 ? lineEnd : content.length);
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
  
  // 检查输入参数是否有效
  if (!fileName || fileName === 'undefined' || !startDir) {
    console.log(`搜索参数无效: 项目目录=${startDir}, 文件名=${fileName}`);
    return null;
  }

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
      const foundPath = await searchDirRecursive(srcDir, fileName, 3);
      if (foundPath) return foundPath;
    } catch (error) {
      console.log(`递归搜索失败: ${error.message}`);
    }
  }
  
  // 找不到文件
  console.log(`无法找到文件: ${fileName}`);
  return null;
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

  // 添加滑块变化事件处理
  ipcMain.on('slider-changed', (event, data) => {
    console.log('收到滑块变化事件:', data);
    
    // 发送WebSocket更新通知
    if (data.elementType && data.newValue !== undefined) {
      // 处理滑块变化，更新相应的配置
      const elementType = data.elementType;
      const newValue = data.newValue;
      
      // 更新全局配置
      if (!global.lastAppliedConfig) {
        global.lastAppliedConfig = [];
      }
      
      // 创建或更新配置项
      let configFound = false;
      for (let i = 0; i < global.lastAppliedConfig.length; i++) {
        if (global.lastAppliedConfig[i].elementType === elementType) {
          global.lastAppliedConfig[i].value = newValue;
          configFound = true;
          break;
        }
      }
      
      if (!configFound) {
        global.lastAppliedConfig.push({
          elementType: elementType,
          value: newValue,
          elements: [{
            name: elementType,
            relativeSizeValue: `+${newValue}`
          }]
        });
      }
      
      // 通知所有WebSocket客户端更新
      notifyConfigUpdate([], [], 'slider-change');
      
      // 向发送者返回确认
      event.reply('slider-change-confirmed', {
        elementType,
        newValue,
        timestamp: Date.now()
      });
    }
  });
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

// IPC处理器：清除缓存
ipcMain.handle('clear-cache', async () => {
  try {
    console.log('清除字体工具缓存...');
  
    // 清除全局配置缓存
    if (global.lastAppliedConfig) {
      global.lastAppliedConfig = [];
    }
    
    // 通知所有WebSocket客户端更新
    if (wss && wss.clients && wss.clients.size > 0) {
      const notification = {
        type: 'cache-cleared',
        timestamp: Date.now(),
        message: '字体工具缓存已清除'
      };
      
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(JSON.stringify(notification));
            console.log(`已向客户端[${client.clientId}]发送缓存清除通知`);
          } catch (err) {
            console.error(`向客户端[${client.clientId}]发送缓存清除通知时出错:`, err);
          }
        }
      });
    }
    
    return { success: true, message: "缓存已清除" };
  } catch (error) {
    console.error('清除缓存失败:', error);
    return { success: false, error: error.message };
  }
});

// IPC处理器：扫描项目中的@font-tool注释
ipcMain.handle('scan-font-tool-comments', async (event, projectDir, matchMode = 'comment') => {
  console.log('扫描项目中的代码 (旧版，不推荐使用):', projectDir);
  console.log('匹配模式:', matchMode);
  // 这个函数现在只是一个包装器，直接转发调用而不是尝试注册新处理器
  const customFields = ['mapLevelToPx', 'getTextScaleClass'];
  return await ipcMain.listeners('scan-font-tool-comments-with-custom-fields')[0](event, projectDir, matchMode, customFields);
});

// IPC处理器：扫描项目中的@font-tool注释 (支持自定义字段)
ipcMain.handle('scan-font-tool-comments-with-custom-fields', async (event, projectDir, matchMode = 'comment', customFields = ['mapLevelToPx', 'getTextScaleClass']) => {
  console.log('扫描项目中的代码:', projectDir);
  console.log('匹配模式:', matchMode);
  console.log('自定义匹配字段:', customFields);
  
  if (!fs.existsSync(projectDir)) {
    return { error: '项目目录不存在' };
  }
  
  const results = [];
  const extensions = ['.js', '.jsx', '.ts', '.tsx'];
  
  try {
    await searchFilesRecursive(projectDir, extensions, async (filePath) => {
          // 读取文件内容
          const content = fs.readFileSync(filePath, 'utf8');
          
      // 首先识别组件名，这个逻辑对所有匹配模式都适用
      // 使用我们定义的组件名注释正则表达式 - 修复匹配
      const componentNameRegex = /@font-tool组件[：:]([^*}\/\r\n]+)/gi;
      
      // 默认使用文件名作为组件名
      let componentName = path.basename(filePath, path.extname(filePath));
      
      // 尝试从注释中找到组件名
      let compMatch;
      while ((compMatch = componentNameRegex.exec(content)) !== null) {
        if (compMatch && compMatch[1]) {
          componentName = compMatch[1].trim();
          console.log(`[DEBUG scan-font-tool-comments] 从注释中检测到组件名: "${componentName}"`);
          break; // 只使用第一个匹配的组件名
        }
      }
      
      // 根据匹配模式选择性扫描
      if (matchMode === 'comment' || matchMode === 'both') {
        // 增强的正则表达式，支持多种注释格式，包括JSX注释格式
        // 1. JSX注释: {/* @font-tool：元素名 */}
        // 2. HTML注释: <!-- @font-tool：元素名 -->
        // 3. 行注释: // @font-tool：元素名
        // 4. 块注释: /* @font-tool：元素名 */
        const commentPattern = /(?:\{\/\*|<!--|\/\/|\/\*)?\s*@font-tool[：:]([^*}\/\r\n]+)(?:\*\/\}|-->|\*\/)?/gi;
        
        console.log(`[DEBUG scan-font-tool-comments] 扫描文件: ${filePath}`);
        console.log(`[DEBUG scan-font-tool-comments] 使用正则表达式: ${commentPattern.toString()}`);
          
          let match;
        while ((match = commentPattern.exec(content)) !== null) {
          const elementName = match[1].trim();
          
          // 获取注释所在行号和内容
          const commentLineNumber = getLineNumber(content, match.index);
          const commentLineContent = getLineContent(content, match.index);
          
          // 查找注释的下一行内容（用于上一行匹配）
          const contentLines = content.split('\n');
          const nextLineIndex = commentLineNumber; // 因为getLineNumber返回的是1-based索引，所以这里得到的是下一行的索引
          const nextLineContent = nextLineIndex < contentLines.length ? contentLines[nextLineIndex] : '';
          
          console.log(`[DEBUG scan-font-tool-comments] 注释行号: ${commentLineNumber}, 下一行内容: ${nextLineContent.substring(0, 50)}...`);
          
          // 尝试确定字体大小值
          // 向上查找最近的 fontSize±N 或 getTextScaleClass(fontSize±N) 模式
          const reverseContentToMatch = content.substring(0, match.index).split('').reverse().join('');
          
          // 匹配反向的字符串中的fontSize±N模式
          const fontSizeMatch = reverseContentToMatch.match(/xp\s*\}\s*\)(\d+)([-+])?(\s*ezistnoF|ezistnoF)\s*\(\s*xPotLeveLpam\s*\{\s*\$\s*:`/i);
          const textScaleMatch = reverseContentToMatch.match(/\)\s*(\d+)([-+])?\s*ezistnoF\s*\(\s*ssalCelacStxeTteg/i);
          
          // 默认值
          let fontSizeValue = 0;
          
          if (fontSizeMatch) {
            // 从反向字符串中提取数字和符号，然后反转回来
            const sign = fontSizeMatch[2] ? fontSizeMatch[2] : '+';
            const value = fontSizeMatch[1] ? fontSizeMatch[1].split('').reverse().join('') : '0';
            fontSizeValue = parseInt((sign === '+' ? '+' : '-') + value, 10);
          } else if (textScaleMatch) {
            // 从反向字符串中提取数字和符号，然后反转回来
            const sign = textScaleMatch[2] ? textScaleMatch[2] : '+';
            const value = textScaleMatch[1] ? textScaleMatch[1].split('').reverse().join('') : '0';
            fontSizeValue = parseInt((sign === '+' ? '+' : '-') + value, 10);
          }
          
          console.log(`[DEBUG scan-font-tool-comments] 找到匹配项:`);
          console.log(`  - 文件: ${filePath}`);
          console.log(`  - 推断组件名: "${componentName}"`);
          console.log(`  - 元素名: "${elementName}"`);
          console.log(`  - 字体相对大小: ${fontSizeValue >= 0 ? '+' : ''}${fontSizeValue}`);
          console.log(`  - 注释行号: ${commentLineNumber}`);
          console.log(`  - 下一行内容: ${nextLineContent.substring(0, 50)}...`);
          
          // 解析下一行代码，尝试提取元素类型信息
          let nextLineElementInfo = {};
          
          // 匹配常见的React元素标签、className等
          const tagMatch = nextLineContent.match(/<([a-zA-Z][a-zA-Z0-9]*)\s/);
          const classNameMatch = nextLineContent.match(/className=["'`]([^"'`]+)["'`]/);
          
          if (tagMatch) {
            nextLineElementInfo.tagName = tagMatch[1];
          }
          
          if (classNameMatch) {
            nextLineElementInfo.className = classNameMatch[1];
          }
          
          // 记录当前元素
          const element = { 
            id: `${componentName.toLowerCase()}-${elementName.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            name: elementName,
            relativeSizeValue: fontSizeValue,
            path: `${path.basename(filePath)}:${commentLineNumber}`,
            componentName: componentName, // 添加componentName属性以便后续处理
            file: path.basename(filePath), // 添加file属性
            lineNumber: commentLineNumber, // 添加lineNumber属性
            matchType: 'comment', // 标记为注释匹配
            currentValue: fontSizeValue, // 记录当前值，与目标值相同时可跳过更新
            nextLine: {
              content: nextLineContent.trim(),
              lineNumber: commentLineNumber + 1,
              elementInfo: nextLineElementInfo
            }
          };
          
          results.push(element);
      }
    }
    
      // 如果是代码匹配模式或两种都用
      if (matchMode === 'code' || matchMode === 'both') {
        
        // 遍历自定义字段列表，为每个字段创建正则表达式并进行匹配
        for (const field of customFields) {
          // 转义字段名中的特殊字符，以便在正则表达式中使用
          const escapedField = escapeRegExp(field);
          const fieldRegex = new RegExp(`${escapedField}\\(fontSize\\s*([+-]?\\d+)?\\)`, 'g');
          
          console.log(`[DEBUG scan-font-tool-comments] 使用自定义字段 "${field}" 进行扫描，正则表达式: ${fieldRegex.toString()}`);
          
          let fieldMatch;
          while ((fieldMatch = fieldRegex.exec(content)) !== null) {
            const lineNumber = getLineNumber(content, fieldMatch.index);
            const fontSizeValue = fieldMatch[1] ? parseInt(fieldMatch[1], 10) : 0;
            
            let elementName = '未命名元素';
            let previousComment = null;
            const maxLinesToSearchUp = 7;

            const allContentLines = content.split('\n');
            const currentCodeLineIndex = getLineNumber(content, fieldMatch.index) - 1;

            for (let i = 1; i <= maxLinesToSearchUp; i++) {
                const lookUpLineIndex = currentCodeLineIndex - i;
                if (lookUpLineIndex < 0) {
                    console.log(`[DEBUG scan-font-tool-comments] ${field}: Reached top of file.`);
                    break; 
                }

                const lineToInspect = allContentLines[lookUpLineIndex];
                const trimmedLineToInspect = lineToInspect.trim();
                console.log(`[DEBUG scan-font-tool-comments] ${field}: Looking up line [${lookUpLineIndex + 1}]: [${trimmedLineToInspect}]`);
                
                const fontToolCommentInInspectLine = trimmedLineToInspect.match(/(?:\{\/\*|<!--|\/\/|\/\*)\s*@font-tool[：:]([^\*}\/\r\n]+)(?:\*\/\}|-->|\*\/)?/i);
                if (fontToolCommentInInspectLine && fontToolCommentInInspectLine[1]) {
                    elementName = fontToolCommentInInspectLine[1].trim();
                    previousComment = { content: lineToInspect, lineNumber: lookUpLineIndex + 1 };
                    console.log(`[DEBUG scan-font-tool-comments] ${field}: Found @font-tool comment on line ${lookUpLineIndex + 1}: "${elementName}"`);
                    break; 
                }
                
                if (trimmedLineToInspect === '') { 
                    console.log(`[DEBUG scan-font-tool-comments] ${field}: Line ${lookUpLineIndex + 1} is empty, continuing up.`);
                    continue; 
                }

                // 检查是否遇到硬停止条件
                let hardStop = false;
                for (const otherField of customFields) {
                    if (trimmedLineToInspect.includes(`${otherField}(`)) {
                        hardStop = true;
                        break;
                    }
                }
                if (hardStop || trimmedLineToInspect.match(/^\s*(function\s|class\s|const\s+\w+\s*=.*=>|@font-tool组件)/)) {
                     console.log(`[DEBUG scan-font-tool-comments] ${field}: Hard stop condition met on line ${lookUpLineIndex + 1}.`);
                     break;
                }
                console.log(`[DEBUG scan-font-tool-comments] ${field}: Line ${lookUpLineIndex + 1} is not a target comment, not empty, not a hard stop. Continuing up (if within maxLines).`);
            }

            if (!previousComment) {
                const contextFallback = content.substring(Math.max(0, fieldMatch.index - 100), Math.min(content.length, fieldMatch.index + 100));
                // 尝试从HTML标签中提取元素名
                const tagMatch = contextFallback.match(new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)[^>]*>[^<]*${escapedField}\\(`, 'i'));
                if (tagMatch && tagMatch[1]) {
                    elementName = `${tagMatch[1]} (${field} 行${lineNumber})`;
                } else {
                     elementName = `${field} 相关元素 (代码行${lineNumber})`;
                }
                console.log(`[DEBUG scan-font-tool-comments] ${field}: No @font-tool comment found above. Fallback elementName: "${elementName}"`);
            }
            
            console.log(`[DEBUG scan-font-tool-comments] ${field}: Component: "${componentName}", Element: "${elementName}", Size: fontSize${fontSizeValue >= 0 ? '+' : ''}${fontSizeValue}`);
            
            results.push({ 
              id: `${componentName.toLowerCase().replace(/\s+/g, '-')}-${elementName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              name: elementName, 
              relativeSizeValue: fontSizeValue,
              path: `${path.basename(filePath)}:${lineNumber}`,
              componentName: componentName, 
              file: path.basename(filePath), 
              lineNumber: lineNumber, 
              matchType: 'code', 
              currentValue: fontSizeValue, 
              previousComment: previousComment,
              matchedField: field // 记录匹配到的字段
            });
          }
        }
      }
    });
    
    console.log(`[INFO scan-font-tool-comments] 扫描完成，找到 ${results.length} 个匹配项`);
    
    // 返回结果前，对所有结果进行分组和当前状态检查
    const groupedResults = {};
    
    // 首先将结果按组件分组
    results.forEach(item => {
      // 确保componentName存在，如果不存在则使用默认值'unknown'
      const componentName = item.componentName || 'unknown';
      
      if (!groupedResults[componentName]) {
        groupedResults[componentName] = {
          componentName: componentName,
          description: `${componentName}组件`,
          elements: []
        };
      }
      
      // 检查是否已经添加过相同名称的元素
      const existingElement = groupedResults[componentName].elements.find(
        el => el.name === item.name
      );
      
      if (!existingElement) {
        const elementId = `${componentName.toLowerCase().replace(/\s+/g, '-')}-${groupedResults[componentName].elements.length + 1}`;
        
        groupedResults[componentName].elements.push({
          id: elementId,
          name: item.name,
          relativeSizeValue: item.relativeSizeValue,
          path: item.path,
          matchType: item.matchType,
          currentValue: item.relativeSizeValue, // 记录当前值
          nextLine: item.nextLine, // 添加下一行信息
          previousComment: item.previousComment // 添加上一行注释信息
        });
      }
    });
    
    // 将分组结果转换回数组
    const finalResults = Object.values(groupedResults);
    
    return { results: finalResults };
  } catch (err) {
    console.error('扫描代码时出错:', err);
    return { error: err.message };
  }
});

// 从内容中获取指定索引所在的行号（1-based）
function getLineNumber(content, index) {
  if (!content || index < 0 || index >= content.length) {
    console.log(`警告: getLineNumber被调用时传入无效参数 - content长度:${content ? content.length : 'null'}, index:${index}`);
    return 1; // 返回默认值
  }
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

// IPC处理器：应用字体配置到代码
ipcMain.handle('apply-font-config', async (event, projectDir, configs, matchMode = 'comment') => {
  // 旧版IPC接口，调用新接口并使用默认字段
  console.log('调用旧版 apply-font-config，将使用默认匹配字段');
  const customFields = ['mapLevelToPx', 'getTextScaleClass'];
  return await ipcMain.listeners('apply-font-config-with-custom-fields')[0](event, projectDir, configs, matchMode, customFields);
});

// IPC处理器：应用字体配置到代码 (支持自定义字段)
ipcMain.handle('apply-font-config-with-custom-fields', async (event, projectDir, configs, matchMode = 'comment', customFields = ['mapLevelToPx', 'getTextScaleClass']) => {
  console.log('正在应用字体配置到代码...');
  console.log('项目目录:', projectDir);
  console.log('配置数量:', configs ? configs.length : 0);
  console.log('匹配模式:', matchMode);
  console.log('自定义匹配字段:', customFields);
  
  // 输出配置详情用于调试
  if (configs && configs.length > 0) {
    console.log('配置详情:');
    configs.forEach((config, index) => {
      console.log(`[${index}] 组件: ${config.componentName}`);
      if (config.elements && config.elements.length > 0) {
        config.elements.forEach((element, eIdx) => {
          console.log(`  [${eIdx}] 元素: "${element.name}", 相对大小: ${element.relativeSizeValue}, 匹配类型: ${element.matchType || 'comment'}`);
        });
      }
    });
  }
  
  // 保存最后应用的配置到全局变量，供notifyConfigUpdate使用
  global.lastAppliedConfig = configs;
  
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
      // 根据匹配模式和元素的匹配类型决定是否处理该元素
      const elementMatchType = element.matchType || 'comment';
      if (matchMode !== 'both' && matchMode !== elementMatchType) {
        console.log(`[DEBUG applyFontConfig] 跳过元素 ${element.name} (${elementMatchType})，因为当前匹配模式是 ${matchMode}`);
        continue;
      }

      let fileNameForCurrentElement = 'UNKNOWN_FILE'; // Variable to hold the file name for the current element
      try {
        const filePathParts = element.path.split(':')[0];
        fileNameForCurrentElement = filePathParts.includes('/') 
          ? filePathParts.substring(filePathParts.lastIndexOf('/') + 1) 
          : filePathParts;
          
        console.log(`[DEBUG applyFontConfig] ENTERING: fileName=${fileNameForCurrentElement}, componentName=${config.componentName}, elementName=${element.name}, relativeSize=${element.relativeSizeValue}`);
        let modifiedInThisFile = false;
        // try { // This was the original inner try from applyFontConfig, we are already in a try block
          const filePath = await findFile(projectDir, fileNameForCurrentElement); // Use fileNameForCurrentElement and await findFile
          if (!fs.existsSync(filePath)) {
            console.log(`[DEBUG applyFontConfig] File not found: ${filePath}`);
            // return false; // This was for the standalone function, now we continue or throw
            throw new Error(`File not found during processing: ${filePath}`);
          }
          console.log(`[DEBUG applyFontConfig] Processing file: ${filePath}`);
          let content = fs.readFileSync(filePath, 'utf8');
          
          console.log(`[DEBUG applyFontConfig] Initial content (first 300 chars):\n${content.substring(0, 300)}`);

          let modified = false; 
          let styleActuallyModified = false; 

          const dataFontToolAttributeValue = `${element.relativeSizeValue >= 0 ? '+' : ''}${element.relativeSizeValue}`;
          const dataFontToolFullAttribute = `data-font-tool=["']${dataFontToolAttributeValue}["']`;
          console.log(`[DEBUG applyFontConfig] Checking for data-font-tool attribute: ${dataFontToolFullAttribute}`);
          const dataFontToolTargetFound = content.includes(dataFontToolFullAttribute);
          
          if (dataFontToolTargetFound) {
            console.log(`[DEBUG applyFontConfig] Found data-font-tool attribute potentially targeting ${element.name} in ${fileNameForCurrentElement}.`); // Use fileNameForCurrentElement
            modified = true; 
          } else {
            console.log(`[DEBUG applyFontConfig] data-font-tool attribute NOT found for ${element.name}.`);
          }

          // 在构建正则表达式之前规范化输入
          const normalizeForRegExp = (str) => {
            if (!str) return '';
            // 首先修剪并标准化字符串
            const trimmed = str.trim();
            console.log(`[DEBUG applyFontConfig] 规范化前: "${str}" => 修剪后: "${trimmed}"`);
            // 转义特殊字符
            let escaped = escapeRegExp(trimmed);
            console.log(`[DEBUG applyFontConfig] 转义后: "${escaped}"`);
            // 将连续的空格替换为更宽松的匹配模式 - 可匹配0到多个空白字符
            // 使用 \\s* 而不是 \\s+ 以便能匹配0个或多个空格
            const normalized = escaped.replace(/\s+/g, '\\s*');
            console.log(`[DEBUG applyFontConfig] 空格处理后: "${normalized}"`);
            return normalized;
          };

          const componentNamePattern = normalizeForRegExp(config.componentName);
          const elementNamePattern = normalizeForRegExp(element.name);
          
          console.log(`[DEBUG applyFontConfig] 规范化后的模式: componentNamePattern="${componentNamePattern}", elementNamePattern="${elementNamePattern}"`);

          // 创建更宽松的正则表达式，修复转义问题
          const flexibleCommentPattern = new RegExp(
            `(?:\\{/\\*|<!--|//|/\\*)\\s*@font-tool(?::|：)\\s*${elementNamePattern}\\s*(?:\\*/\\}|-->|\\*/)?`,
            'gi' // 添加i标志使匹配不区分大小写
          );
          console.log(`[DEBUG applyFontConfig] flexibleCommentPattern: ${flexibleCommentPattern.toString()}`);

          // 尝试直接匹配一次，看看结果
          const testContent = content.substring(0, Math.min(content.length, 5000)); // 测试前5000个字符
          const testMatch = flexibleCommentPattern.exec(testContent);
          if (testMatch) {
            console.log(`[DEBUG applyFontConfig] 测试匹配成功: "${testMatch[0]}"`);
            // 重置lastIndex以便后续使用
            flexibleCommentPattern.lastIndex = 0;
          } else {
            console.log(`[DEBUG applyFontConfig] 测试匹配失败，未找到匹配的注释`);
          }

          let tempContent = content.replace(flexibleCommentPattern, (match) => {
            modified = true;
            console.log(`[DEBUG applyFontConfig - flexibleCommentPattern.replace] 找到匹配: ${match}`);
            
            // 检查上面的代码中是否有合适的fontSize调用
            const matchIndex = content.indexOf(match);
            const beforeContent = content.substring(0, matchIndex).split('\n');
            const lastLine = beforeContent[beforeContent.length - 1];
            
            // 前面的代码使用了什么样的字体大小模式
            const newFontSize = element.relativeSizeValue; 
            let prefix = '';
            let suffix = '';

            if (match.startsWith('{/*')) {
              prefix = '{/* ';
              suffix = ' */}';
            } else if (match.startsWith('<!--')) {
              prefix = '<!-- ';
              suffix = ' -->';
            } else if (match.startsWith('/*')) {
              prefix = '/* ';
              suffix = ' */';
            } else {
              prefix = '// ';
              suffix = '';
            }

            const newComment = `${prefix}@font-tool：${element.name}${suffix}`;
            console.log(`[DEBUG applyFontConfig - flexibleCommentPattern.replace] 构建新注释: ${newComment}`);
            styleActuallyModified = true; 
            return newComment;
          });

          if (styleActuallyModified) { 
              content = tempContent;
              console.log(`[DEBUG applyFontConfig] Content updated after flexibleCommentPattern.replace.`);
          } else {
              console.log(`[DEBUG applyFontConfig] No style modification from flexibleCommentPattern.replace.`);
          }
          
          // 修改此处，不再以modified为前提条件处理字段匹配
          console.log(`[DEBUG applyFontConfig] Processing style functions regardless of comment matching.`);
            const newSizeForClass = element.relativeSizeValue;
          
          // 移除对matchType和matchMode的依赖，尝试所有可能的字段匹配
          console.log(`[DEBUG applyFontConfig] Trying all field matching patterns regardless of match type, using custom fields:`, customFields);
          
          // 遍历自定义字段进行匹配和替换
          for (const field of customFields) {
            const escapedField = escapeRegExp(field); // 确保字段名被正确转义
            const fieldPattern = new RegExp(`${escapedField}\\(fontSize\\s*([+-]?\\d+)?\\)`, 'g');
            console.log(`[DEBUG applyFontConfig] 使用自定义字段 "${field}" 进行替换，Pattern: ${fieldPattern.toString()}`);
            
            let madeChangeToCustomField = false;
            tempContent = content.replace(fieldPattern, (match, sign, value) => {
              console.log(`[DEBUG applyFontConfig - ${field} Pattern.replace] Match found: ${match}`);
              console.log(`[DEBUG applyFontConfig - ${field} Pattern.replace]   Sign: ${sign}, Value: ${value}`);
              
              let currentRelativeSize = 0;
              if (sign && value) {
                currentRelativeSize = parseInt(sign + value, 10);
              }
              console.log(`[DEBUG applyFontConfig - ${field} Pattern.replace]   Current relative size in function: ${currentRelativeSize}`);
              console.log(`[DEBUG applyFontConfig - ${field} Pattern.replace]   Target new relative size: ${newSizeForClass}`);

              if (currentRelativeSize === newSizeForClass) {
                console.log(`[DEBUG applyFontConfig - ${field} Pattern.replace] ${field} for ${element.name} already has relative size ${newSizeForClass}. No change needed.`);
                return match;
              }

              let newFunctionString;
              if (newSizeForClass === 0) {
                newFunctionString = `${field}(fontSize)`;
              } else {
                newFunctionString = `${field}(fontSize${newSizeForClass > 0 ? '+' : ''}${newSizeForClass})`;
              }
              console.log(`[DEBUG applyFontConfig - ${field} Pattern.replace]   Constructed newFunctionString: ${newFunctionString}`);
              madeChangeToCustomField = true;
              modified = true; // 标记文件已修改
              return newFunctionString;
            });

            if(madeChangeToCustomField){
              content = tempContent;
              styleActuallyModified = true; 
              console.log(`[DEBUG applyFontConfig] Content updated after ${field} Pattern.replace.`);
            } else {
              console.log(`[DEBUG applyFontConfig] No style modification from ${field} Pattern.replace.`);
            }
          }

          // 处理 mapLevelToPx 模式 (这个可以保留，因为它比较特定)
          const mapLevelPattern = /mapLevelToPx\(fontSize\s*(?:([+-])\s*(\d+))?\)/g;
          console.log(`[DEBUG applyFontConfig] mapLevelPattern: ${mapLevelPattern.toString()}`);
          
          let madeChangeToMapLevel = false;
          tempContent = content.replace(mapLevelPattern, (match, sign, value) => {
            console.log(`[DEBUG applyFontConfig - mapLevelPattern.replace] Match found: ${match}`);
            console.log(`[DEBUG applyFontConfig - mapLevelPattern.replace]   Sign: ${sign}, Value: ${value}`);
            
            let currentRelativeSize = 0;
            if (sign && value) {
              currentRelativeSize = parseInt(sign + value, 10);
            }
            console.log(`[DEBUG applyFontConfig - mapLevelPattern.replace]   Current relative size: ${currentRelativeSize}`);
            console.log(`[DEBUG applyFontConfig - mapLevelPattern.replace]   Target new relative size: ${newSizeForClass}`);

            if (currentRelativeSize === newSizeForClass) {
              console.log(`[DEBUG applyFontConfig - mapLevelPattern.replace] mapLevelToPx for ${element.name} already has relative size ${newSizeForClass}. No change needed.`);
              return match;
            }

            let newMapLevelString;
            if (newSizeForClass === 0) {
              newMapLevelString = 'mapLevelToPx(fontSize)';
          } else {
              // 使用更标准化的格式来提高匹配精度
              newMapLevelString = `mapLevelToPx(fontSize${newSizeForClass > 0 ? '+' : ''}${newSizeForClass})`;
            }
            console.log(`[DEBUG applyFontConfig - mapLevelPattern.replace]   Constructed newMapLevelString: ${newMapLevelString}`);
            madeChangeToMapLevel = true;
            modified = true; // 标记文件已修改
            return newMapLevelString;
          });

          if(madeChangeToMapLevel){
            content = tempContent;
            styleActuallyModified = true; 
            console.log(`[DEBUG applyFontConfig] Content updated after mapLevelPattern.replace.`);
          } else {
            console.log(`[DEBUG applyFontConfig] No style modification from mapLevelPattern.replace.`);
          }

          // 处理 fontSize: `${mapLevelToPx 模式
          const fontSizeTemplatePattern = /fontSize:\s*`\$\{mapLevelToPx\(fontSize\s*(?:([+-])\s*(\d+))?\)\}px`/g;
          console.log(`[DEBUG applyFontConfig] fontSizeTemplatePattern: ${fontSizeTemplatePattern.toString()}`);
          
          let madeChangeToFontSizeTemplate = false;
          tempContent = content.replace(fontSizeTemplatePattern, (match, sign, value) => {
            console.log(`[DEBUG applyFontConfig - fontSizeTemplatePattern.replace] Match found: ${match}`);
            console.log(`[DEBUG applyFontConfig - fontSizeTemplatePattern.replace]   Sign: ${sign}, Value: ${value}`);
            
            let currentRelativeSize = 0;
            if (sign && value) {
              currentRelativeSize = parseInt(sign + value, 10);
            }
            console.log(`[DEBUG applyFontConfig - fontSizeTemplatePattern.replace]   Current relative size: ${currentRelativeSize}`);
            console.log(`[DEBUG applyFontConfig - fontSizeTemplatePattern.replace]   Target new relative size: ${newSizeForClass}`);

            if (currentRelativeSize === newSizeForClass) {
              console.log(`[DEBUG applyFontConfig - fontSizeTemplatePattern.replace] fontSize template for ${element.name} already has relative size ${newSizeForClass}. No change needed.`);
              return match;
            }

            let newFontSizeString;
            if (newSizeForClass === 0) {
              newFontSizeString = 'fontSize: `${mapLevelToPx(fontSize)}px`';
            } else {
              // 使用更简洁的格式
              newFontSizeString = `fontSize: \`\${mapLevelToPx(fontSize${newSizeForClass > 0 ? '+' : ''}${newSizeForClass})}px\``;
            }
            console.log(`[DEBUG applyFontConfig - fontSizeTemplatePattern.replace]   Constructed newFontSizeString: ${newFontSizeString}`);
            madeChangeToFontSizeTemplate = true;
            modified = true; // 标记文件已修改
            return newFontSizeString;
          });

          if(madeChangeToFontSizeTemplate){
            content = tempContent;
            styleActuallyModified = true; 
            console.log(`[DEBUG applyFontConfig] Content updated after fontSizeTemplatePattern.replace.`);
          } else {
            console.log(`[DEBUG applyFontConfig] No style modification from fontSizeTemplatePattern.replace.`);
          }

          if (!styleActuallyModified && !modified) {
             console.log(`[DEBUG applyFontConfig] Target '${element.name}' was not found. No matching comments or style functions.`);
          } else if (!styleActuallyModified) {
             console.log(`[DEBUG applyFontConfig] Target '${element.name}' was identified but no actual code changes needed (values already up-to-date).`);
          }

          if (styleActuallyModified) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`[SUCCESS applyFontConfig] File ${fileNameForCurrentElement} updated successfully for element ${element.name}.`); // Use fileNameForCurrentElement
            modifiedInThisFile = true; // Set this to true as the file was indeed modified
          } else {
            console.log(`[INFO applyFontConfig] No actual modifications made to file ${fileNameForCurrentElement} for element ${element.name}.`); // Use fileNameForCurrentElement
             // modifiedInThisFile remains false or its previous state from data-attr/comment check
          }

        // The original inlined applyFontConfig logic might have had its own try...catch here.
        // For simplicity, we are using the outer try...catch for the whole element processing block.
        // If modifiedInThisFile is true, it means an attempt was made and it either succeeded or this specific part was already okay.
        // If styleActuallyModified is true, it means the file was written.

        if (modifiedInThisFile && styleActuallyModified) { // Check if both a target was found AND style was modified
            results.success.push({
                file: filePath, // filePath is correct here
                element: element.name,
                relativeSizeValue: element.relativeSizeValue
            });
        } else if (modifiedInThisFile && !styleActuallyModified) { // Target found, but no code change needed (already up-to-date)
            console.log(`[INFO applyFontConfig] File ${fileNameForCurrentElement} for element ${element.name} was targeted but no actual code changes were necessary.`);
            // 不再将已经是最新状态的项目记录到failure列表中
            // 这里我们完全跳过记录，因为这些项目已经是期望的状态
        } else { // No target found initially (modifiedInThisFile is false)
            console.log(`[INFO applyFontConfig] No target found in ${fileNameForCurrentElement} for element ${element.name}.`);
            results.failure.push({
                element: element.name,
                path: element.path,
                error: `No target found in ${fileNameForCurrentElement} for ${element.name}.`
            });
        }

      } catch (error) {
        console.error(`[ERROR applyFontConfig] Error processing file ${fileNameForCurrentElement} for element ${element.name}:`, error); // Use fileNameForCurrentElement
        results.failure.push({
          element: element.name,
          path: element.path,
          error: error.message
        });
      }
    }
  }
  
  // 添加一个skipped计数到结果中
  const skippedCount = configs.flatMap(c => c.elements).length - (results.success.length + results.failure.length);
  results.skipped = skippedCount;
  
  // 结果统计
  if (results.success.length > 0 || results.failure.length > 0) {
    const resultMessage = [
      `成功应用: ${results.success.length} 项`,
      `无需更改: ${results.skipped} 项`,
      `失败: ${results.failure.length} 项`
    ].join('\n');
    
    // 在控制台中记录结果
    console.log('应用字体配置结果:');
    console.log(resultMessage);
    
    // 只在有错误时才显示对话框
    if (results.failure.length > 0 && BrowserWindow.getAllWindows().length > 0) {
      dialog.showMessageBox(BrowserWindow.getFocusedWindow(), {
        type: 'warning',
        title: '应用字体配置结果',
        message: resultMessage,
        detail: '部分配置应用失败，可能是因为找不到文件或@font-tool注释。请检查控制台获取详细信息。'
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
  if (!string) return '';
  // 更全面地转义特殊字符，确保中文字符和特殊符号都能正确处理
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& 表示整个被匹配的字符串
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
    if (!fileName || fileName === 'undefined') {
      throw new Error('文件名无效');
    }

    // 查找文件
    const filePath = await findFile(projectDir, fileName);
    console.log('找到文件:', filePath);
    
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath || fileName}`);
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
// font-tool热更新客户端 (增强版)
// 在你的React应用主入口文件中引入此脚本
(function() {
  let ws = null;
  let reconnectTimer = null;
  const port = ${hotReloadPort};
  
  // 调试模式 - 可以在控制台中设置 window.fontToolDebug = true 查看详细日志
  let debug = false;
  
  function log(...args) {
    if (debug) console.log('[font-tool]', ...args);
  }
  
  // 初始化组件映射表
  const componentMappings = {};
  
  // 连接WebSocket服务器
  function connect() {
    ws = new WebSocket(\`ws://localhost:\${port}\`);
    
    ws.onopen = () => {
      console.log('[font-tool] 热更新连接已建立');
      clearTimeout(reconnectTimer);
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        log('收到消息:', data);
        
        if (data.type === 'font-config-updated') {
          console.log('[font-tool] 字体配置已更新，正在刷新样式');
          
          if (data.updates && Array.isArray(data.updates)) {
            // 使用增强的元素定位方式
            updateFontStyles(data.updates);
          } else {
            // 降级方式：使用全局事件通知React重新渲染
            dispatchGlobalUpdateEvent();
          }
          
          // 显示通知
          showUpdateNotification();
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
  
  // 基于组件名称和元素描述查找元素
  function findElementsForComponent(componentName, elementName) {
    const elements = [];
    log('查找组件:', componentName, '元素:', elementName);
    
    try {
      // 策略1：基于React组件名称（使用data-component属性，如果有）
      document.querySelectorAll(\`[data-component="\${componentName}"]\`).forEach(el => {
        elements.push(el);
      });
      
      // 策略2：基于HTML注释
      findElementsByHTMLComments(componentName, elementName).forEach(el => {
        if (!elements.includes(el)) elements.push(el);
      });
      
      // 策略3：基于DOM内容和结构
      findElementsByContent(componentName, elementName).forEach(el => {
        if (!elements.includes(el)) elements.push(el);
      });
      
      log('找到可能的元素:', elements.length);
      return elements;
    } catch (error) {
      console.error('[font-tool] 查找元素时出错:', error);
      return [];
    }
  }
  
  // 基于HTML注释查找元素（用于处理React转换后的注释）
  function findElementsByHTMLComments(componentName, elementName) {
    const elements = [];
    
    // 查找所有注释节点
    const iterator = document.createNodeIterator(
      document.body,
      NodeFilter.SHOW_COMMENT,
      null,
      false
    );
    
    let commentNode;
    while ((commentNode = iterator.nextNode())) {
      const commentText = commentNode.textContent.trim();
      
      // 匹配新格式的 @font-tool：元素名 注释格式
      if (commentText.includes('@font-tool：') && 
          commentText.includes(elementName)) {
        
        log('找到匹配的注释:', commentText);
        
        // 获取注释后的下一个元素
        let targetElement = commentNode.nextElementSibling;
        if (targetElement) {
          elements.push(targetElement);
          log('基于注释找到元素:', targetElement);
        }
        
        // 也获取注释前的元素，因为新的注释格式通常在元素之后
        let previousElement = commentNode.previousElementSibling;
        if (previousElement && !elements.includes(previousElement)) {
          elements.push(previousElement);
          log('基于注释找到前一个元素:', previousElement);
        }
        
        // 如果注释在文本节点之内，获取父元素
        if (commentNode.parentElement && !elements.includes(commentNode.parentElement)) {
          elements.push(commentNode.parentElement);
          log('基于注释找到父元素:', commentNode.parentElement);
        }
      }
    }
    
    return elements;
  }
  
  // 基于内容和结构查找元素
  function findElementsByContent(componentName, elementName) {
    const elements = [];
    
    // 基于元素描述尝试不同的查找策略
    // 1. 尝试查找包含此文本的元素
    const textNodes = [];
    const walker = document.createTreeWalker(
      document.body, 
      NodeFilter.SHOW_TEXT, 
      null, 
      false
    );
    
    let node;
    while (node = walker.nextNode()) {
      if (node.textContent.trim() === elementName) {
        textNodes.push(node);
      }
    }
    
    // 将文本节点转换为实际元素
    textNodes.forEach(node => {
      let element = node.parentElement;
      // 往上查找最多3层父元素，找到可能是组件根元素的容器
      for (let i = 0; i < 3; i++) {
        if (element && !elements.includes(element)) {
          elements.push(element);
        }
        if (element) element = element.parentElement;
      }
    });
    
    // 2. 查找标题和段落元素
    if (elementName.toLowerCase().includes('标题') || elementName.toLowerCase().includes('title')) {
      document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(el => {
        if (!elements.includes(el)) elements.push(el);
      });
    }
    
    if (elementName.toLowerCase().includes('段落') || elementName.toLowerCase().includes('text') || elementName.toLowerCase().includes('描述')) {
      document.querySelectorAll('p, .text, .description').forEach(el => {
        if (!elements.includes(el)) elements.push(el);
      });
    }
    
    return elements;
  }
  
  // 更新元素的字体样式
  function updateElementStyle(element, relativeSizeValue) {
    if (!element) return;
    
    try {
      // 计算字体大小
      const baseFontSize = 13; // 假设的基础大小，可以按需调整
      const newSize = baseFontSize + parseInt(relativeSizeValue, 10);
      
      log('更新元素字体大小:', element, '相对值:', relativeSizeValue, '计算大小:', newSize + 'px');
      
      // 应用样式
      element.style.fontSize = \`\${newSize}px\`;
      
      // 标记此元素已由font-tool更新
      element.setAttribute('data-font-tool-updated', 'true');
      
      // 为元素添加一个轻微的过渡效果，使更新更明显
      element.style.transition = 'font-size 0.3s ease';
      
      // 添加一个短暂的高亮效果
      const originalBackground = element.style.backgroundColor;
      element.style.backgroundColor = 'rgba(255, 255, 0, 0.3)';
      setTimeout(() => {
        element.style.backgroundColor = originalBackground;
      }, 1000);
    } catch (error) {
      console.error('[font-tool] 更新元素样式时出错:', error, element);
    }
  }
  
  // 更新字体样式（主函数）
  function updateFontStyles(updates) {
    if (!updates || !Array.isArray(updates)) {
      log('没有更新数据，跳过');
      return;
    }
    
    log('开始处理更新:', updates.length, '个项目');
    
    let updatedCount = 0;
    for (const update of updates) {
      if (!update.componentName || !update.elementName) continue;
      
      // 查找匹配的元素
      const elements = findElementsForComponent(update.componentName, update.elementName);
      
      if (elements.length > 0) {
        elements.forEach(element => {
          updateElementStyle(element, update.relativeSizeValue);
          updatedCount++;
        });
      } else {
        log('未找到匹配的元素:', update.componentName, update.elementName);
      }
    }
    
    log('更新完成，共更新', updatedCount, '个元素');
    
    // 如果没有找到元素，触发全局更新
    if (updatedCount === 0) {
      log('未找到任何匹配元素，触发全局更新');
      dispatchGlobalUpdateEvent();
    }
  }
  
  // 派发全局更新事件（作为降级策略）
  function dispatchGlobalUpdateEvent() {
    log('派发全局字体更新事件');
    const event = new Event('font-config-updated');
    window.dispatchEvent(event);
    
    // 如果页面中有使用字体工具的标记，也尝试更新
    document.querySelectorAll('[data-font-tool]').forEach(el => {
      // 添加一个临时类来触发重绘
      el.classList.add('font-tool-update');
      setTimeout(() => {
        el.classList.remove('font-tool-update');
      }, 100);
    });
  }
  
  // 显示更新通知
  function showUpdateNotification() {
    // 创建通知元素
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
  
  // 初始化
  function init() {
    // 连接WebSocket
    connect();
    
    // 设置调试模式
    debug = window.fontToolDebug || false;
    
    // 监听调试模式变更
    Object.defineProperty(window, 'fontToolDebug', {
      set: function(value) {
        debug = value;
        console.log('[font-tool] 调试模式', debug ? '开启' : '关闭');
      },
      get: function() {
        return debug;
      }
    });
    
    console.log('[font-tool] 热更新客户端已初始化，连接端口:', port);
  }
  
  // 在DOM加载后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // 导出API
  window.fontToolHotReload = {
    reconnect: connect,
    isConnected: () => ws && ws.readyState === WebSocket.OPEN,
    updateStyles: updateFontStyles,
    setDebug: value => { debug = !!value; },
    findElements: findElementsForComponent
  };
})();
  `;
  
  return code;
}); 

// 添加用于提取中文组件名的正则表达式
const componentNamePattern = /@font-tool组件[：:]([^*}\/\r\n]+)/gi;

// 修改文件处理函数，添加对中文组件名的支持
function processFile(filePath, content) {
  // 尝试找到中文组件名注释
  let componentName = null;
  let compMatch;
  
  // 重置正则表达式的lastIndex，确保从头开始匹配
  componentNamePattern.lastIndex = 0;
  
  // 查找组件名注释
  while ((compMatch = componentNamePattern.exec(content)) !== null) {
    if (compMatch && compMatch[1]) {
      componentName = compMatch[1].trim();
      console.log(`从注释中检测到组件名：${componentName}`);
      break; // 只使用第一个找到的组件名
    }
  }
  
  if (!componentName) {
    // 如果没有找到中文组件名注释，则使用文件名作为组件名（原有逻辑）
    componentName = path.basename(filePath, path.extname(filePath));
    console.log(`未找到组件名注释，使用文件名：${componentName}`);
  }
  
  // 处理元素注释 (@font-tool：元素名)
  const elementPattern = /@font-tool[：:]([^*}\/\r\n]+)/gi;
  let elementMatch;
  const elements = [];
  
  // 重置正则表达式的lastIndex，确保从头开始匹配
  elementPattern.lastIndex = 0;
  
  while ((elementMatch = elementPattern.exec(content)) !== null) {
    const elementName = elementMatch[1].trim();
    console.log(`找到元素注释：${elementName}`);
    elements.push({
      name: elementName,
      relativeSizeValue: "+0", // 默认值
      line: getLineNumber(content, elementMatch.index)
    });
  }
  
  return {
    componentName,
    elements,
    filePath
  };
}

// 确保在其他地方将新的组件名处理机制集成到现有逻辑中
// ... existing code ...