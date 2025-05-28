const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// 存储WebSocket连接
let wsConnection = null;
let connectionStatusBar = null;
let fontToolPort = 28888;

/**
 * 插件激活时调用
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  console.log('Font Tool Integration 插件已激活');
  
  // 获取配置
  const config = vscode.workspace.getConfiguration('font-tool');
  fontToolPort = config.get('port') || 28888;
  const autoConnect = config.get('autoConnect') || true;
  
  // 创建状态栏项
  connectionStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  connectionStatusBar.text = "$(sync) Font Tool: 未连接";
  connectionStatusBar.tooltip = "点击检查Font Tool连接状态";
  connectionStatusBar.command = "font-tool.checkStatus";
  connectionStatusBar.show();
  
  // 注册命令
  const integrateCommand = vscode.commands.registerCommand(
    'font-tool.integrate',
    integrateHotReloadClient
  );
  
  const checkStatusCommand = vscode.commands.registerCommand(
    'font-tool.checkStatus',
    checkConnectionStatus
  );
  
  const toggleDebugCommand = vscode.commands.registerCommand(
    'font-tool.toggleDebug',
    toggleDebugMode
  );
  
  // 监听配置变更
  vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('font-tool')) {
      const newConfig = vscode.workspace.getConfiguration('font-tool');
      const newPort = newConfig.get('port');
      
      if (newPort !== fontToolPort) {
        fontToolPort = newPort;
        vscode.window.showInformationMessage(`Font Tool 服务器端口已更新为 ${fontToolPort}`);
        
        // 如果已经连接，需要重新连接
        if (wsConnection) {
          disconnectWebSocket();
          connectToFontTool();
        }
      }
    }
  });
  
  // 将项添加到上下文
  context.subscriptions.push(
    integrateCommand,
    checkStatusCommand,
    toggleDebugCommand,
    connectionStatusBar
  );
  
  // 如果设置为自动连接，则尝试连接
  if (autoConnect) {
    connectToFontTool();
  }
  
  // 当字体配置文件更改时，自动更新组件
  vscode.workspace.onDidSaveTextDocument(document => {
    // 检查是否是相关文件
    if (document.fileName.includes('.jsx') || 
        document.fileName.includes('.tsx') || 
        document.fileName.includes('.js') || 
        document.fileName.includes('.ts')) {
      
      // 如果这个文件包含@font-tool注释，可能需要更新
      const content = document.getText();
      if (content.includes('@font-tool:')) {
        // 连接到font-tool服务器（如果尚未连接）
        connectToFontTool();
      }
    }
  });
}

/**
 * 连接到Font Tool WebSocket服务器
 */
async function connectToFontTool() {
  // 如果已连接，则先断开
  if (wsConnection) {
    disconnectWebSocket();
  }
  
  try {
    connectionStatusBar.text = "$(sync~spin) Font Tool: 连接中...";
    
    // 创建WebSocket连接
    wsConnection = new WebSocket(`ws://localhost:${fontToolPort}`);
    
    wsConnection.on('open', () => {
      console.log(`已连接到Font Tool服务器 (端口: ${fontToolPort})`);
      connectionStatusBar.text = "$(check) Font Tool: 已连接";
      connectionStatusBar.tooltip = `已连接到Font Tool服务器 (端口: ${fontToolPort})`;
      
      // 发送问候消息
      const message = JSON.stringify({
        type: 'cursor-plugin-connected',
        version: '1.0.0',
        debug: true,  // 启用调试模式
        capabilities: ['element-matching', 'debug-mode', 'comment-tracking'] // 声明插件支持的功能
      });
      console.log('发送连接消息:', message);
      wsConnection.send(message);
      
      // 主动询问当前状态
      setTimeout(() => {
        wsConnection.send(JSON.stringify({
          type: 'get-status',
          timestamp: Date.now()
        }));
        console.log('已发送状态请求');
      }, 1000);
    });
    
    wsConnection.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        console.log('收到Font Tool消息:', message);
        
        if (message.type === 'font-config-updated') {
          // 显示通知
          vscode.window.showInformationMessage(`Font Tool: 字体配置已更新 (${new Date().toLocaleTimeString()})`);
          console.log('字体配置已更新, 更新的文件:', message.updatedFiles);
          
          // 显示更详细的更新信息
          if (message.updates && message.updates.length > 0) {
            console.log(`收到 ${message.updates.length} 个元素更新:`);
            message.updates.forEach((update, index) => {
              console.log(`更新 #${index+1}: 组件=${update.componentName}, 元素=${update.elementName}, 相对大小=${update.relativeSizeValue}`);
              
              if (update.matchPattern) {
                console.log(`  匹配模式: ${update.matchPattern}`);
              }
              
              if (update.lineContent) {
                console.log(`  行内容: ${update.lineContent.substring(0, 60)}${update.lineContent.length > 60 ? '...' : ''}`);
              }
            });
          } else {
            console.log('警告: 没有具体的元素更新信息');
          }
          
          // 在更新的文件中查找并高亮@font-tool注释
          if (message.updatedFiles && message.updatedFiles.length > 0) {
            highlightFontToolComments(message.updatedFiles);
          }
        } else if (message.type === 'connected') {
          console.log('连接确认:', message);
          vscode.window.showInformationMessage('已连接到Font Tool服务器');
          
          // 如果对方支持调试模式，告知我们可以启用调试
          if (message.serverInfo && message.serverInfo.capabilities && 
              message.serverInfo.capabilities.includes('debug-mode')) {
            console.log('服务器支持调试模式');
            
            // 向服务器发送调试模式请求
            wsConnection.send(JSON.stringify({
              type: 'enable-debug-mode',
              timestamp: Date.now()
            }));
          }
        } else if (message.type === 'debug-info') {
          // 处理调试信息
          console.log('收到调试信息:', message.data);
          
          // 显示调试信息通知
          vscode.window.showInformationMessage(`Font Tool调试: ${message.data.message || '接收到调试数据'}`);
          
          // 如果有需要在编辑器中高亮的位置
          if (message.data.fileLocations && message.data.fileLocations.length > 0) {
            message.data.fileLocations.forEach(location => {
              highlightFileLocation(location.filePath, location.line, location.column);
            });
          }
        }
      } catch (error) {
        console.error('解析Font Tool消息失败:', error);
      }
    });
    
    wsConnection.on('close', () => {
      console.log('与Font Tool服务器的连接已关闭');
      connectionStatusBar.text = "$(error) Font Tool: 已断开";
      connectionStatusBar.tooltip = "点击重新连接Font Tool服务器";
      wsConnection = null;
    });
    
    wsConnection.on('error', (error) => {
      console.error('Font Tool WebSocket错误:', error);
      connectionStatusBar.text = "$(error) Font Tool: 错误";
      connectionStatusBar.tooltip = `连接错误: ${error.message}`;
      wsConnection = null;
    });
  } catch (error) {
    console.error('连接Font Tool服务器失败:', error);
    connectionStatusBar.text = "$(error) Font Tool: 错误";
    connectionStatusBar.tooltip = `连接错误: ${error.message}`;
    vscode.window.showErrorMessage(`连接Font Tool服务器失败: ${error.message}`);
  }
}

/**
 * 断开与Font Tool的WebSocket连接
 */
function disconnectWebSocket() {
  if (wsConnection) {
    wsConnection.close();
    wsConnection = null;
    connectionStatusBar.text = "$(sync) Font Tool: 未连接";
    connectionStatusBar.tooltip = "点击连接Font Tool服务器";
  }
}

/**
 * 检查连接状态
 */
async function checkConnectionStatus() {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    vscode.window.showInformationMessage(`已连接到Font Tool服务器 (端口: ${fontToolPort})`);
  } else {
    const reconnect = await vscode.window.showInformationMessage(
      '未连接到Font Tool服务器',
      '连接'
    );
    
    if (reconnect === '连接') {
      connectToFontTool();
    }
  }
}

/**
 * 在文件中高亮显示@font-tool注释
 * @param {string[]} filePaths 更新的文件路径
 */
async function highlightFontToolComments(filePaths) {
  for (const filePath of filePaths) {
    try {
      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        console.log(`文件不存在: ${filePath}`);
        continue;
      }
      
      console.log(`开始处理文件: ${filePath}`);
      
      // 读取文件内容
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      // 查找所有@font-tool注释和mapLevelToPx函数使用
      const fontToolPattern = /@font-tool:/g;
      const mapLevelPattern = /mapLevelToPx\(/g;
      const positions = [];
      
      // 标记所有位置
      console.log('查找所有@font-tool注释和mapLevelToPx函数使用');
      
      // 在每一行中查找注释
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // 查找@font-tool注释
        let match;
        const fontToolRegex = new RegExp(fontToolPattern);
        while ((match = fontToolRegex.exec(line)) !== null) {
          console.log(`在行 ${i+1} 找到@font-tool注释，位置 ${match.index}`);
          positions.push({
            line: i,
            character: match.index,
            type: 'comment',
            text: line.substring(match.index, match.index + 20)
          });
        }
        
        // 查找mapLevelToPx函数使用
        const mapLevelRegex = new RegExp(mapLevelPattern);
        while ((match = mapLevelRegex.exec(line)) !== null) {
          console.log(`在行 ${i+1} 找到mapLevelToPx调用，位置 ${match.index}`);
          positions.push({
            line: i,
            character: match.index,
            type: 'function',
            text: line.substring(match.index, line.indexOf(')', match.index) + 1)
          });
        }
      }
      
      console.log(`在文件 ${filePath} 中找到 ${positions.length} 个匹配项`);
      
      // 如果找到了注释或函数调用，打开文件并高亮显示
      if (positions.length > 0) {
        const doc = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        
        // 创建装饰器类型
        const commentDecorationType = vscode.window.createTextEditorDecorationType({
          backgroundColor: 'rgba(76, 175, 80, 0.3)',
          borderRadius: '3px',
          overviewRulerColor: 'rgba(76, 175, 80, 0.8)',
          overviewRulerLane: vscode.OverviewRulerLane.Right
        });
        
        const functionDecorationType = vscode.window.createTextEditorDecorationType({
          backgroundColor: 'rgba(33, 150, 243, 0.3)',
          borderRadius: '3px',
          overviewRulerColor: 'rgba(33, 150, 243, 0.8)',
          overviewRulerLane: vscode.OverviewRulerLane.Right
        });
        
        // 创建装饰范围
        const commentDecorations = [];
        const functionDecorations = [];
        
        for (const pos of positions) {
          try {
            const line = doc.lineAt(pos.line);
            const start = pos.character;
            let end;
            
            if (pos.type === 'comment') {
              end = line.text.indexOf('*/', start);
              if (end === -1) end = line.text.length;
              else end += 2; // 包含结束的 */
              
              commentDecorations.push({
                range: new vscode.Range(
                  new vscode.Position(pos.line, start),
                  new vscode.Position(pos.line, end)
                ),
                hoverMessage: `字体工具注释: ${pos.text}`
              });
            } else {
              end = line.text.indexOf(')', start);
              if (end === -1) end = line.text.length;
              else end += 1; // 包含结束的 )
              
              functionDecorations.push({
                range: new vscode.Range(
                  new vscode.Position(pos.line, start),
                  new vscode.Position(pos.line, end)
                ),
                hoverMessage: `字体大小函数: ${pos.text}`
              });
            }
          } catch (error) {
            console.error(`处理位置 ${pos.line}:${pos.character} 时出错:`, error);
          }
        }
        
        // 应用装饰
        editor.setDecorations(commentDecorationType, commentDecorations);
        editor.setDecorations(functionDecorationType, functionDecorations);
        
        // 显示通知
        vscode.window.showInformationMessage(
          `在文件 ${path.basename(filePath)} 中找到 ${positions.length} 个字体相关的匹配项。`
        );
        
        // 8秒后移除高亮
        setTimeout(() => {
          editor.setDecorations(commentDecorationType, []);
          editor.setDecorations(functionDecorationType, []);
        }, 8000);
      } else {
        console.log(`文件 ${filePath} 中没有找到相关匹配`);
        vscode.window.showWarningMessage(
          `在文件 ${path.basename(filePath)} 中没有找到@font-tool注释或mapLevelToPx函数调用。字体更新可能无法正常工作。`
        );
      }
    } catch (error) {
      console.error(`处理文件${filePath}时出错:`, error);
    }
  }
}

/**
 * 高亮显示文件中的特定位置
 */
async function highlightFileLocation(filePath, line, column) {
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`文件不存在: ${filePath}`);
      return;
    }
    
    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    
    // 创建装饰器类型
    const decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(255, 152, 0, 0.3)',
      borderRadius: '3px',
      overviewRulerColor: 'rgba(255, 152, 0, 0.8)',
      overviewRulerLane: vscode.OverviewRulerLane.Center
    });
    
    // 如果只给了行号，高亮整行
    const lineIndex = line - 1; // 转换为0索引
    const lineObj = doc.lineAt(lineIndex);
    const range = column ? 
      new vscode.Range(
        new vscode.Position(lineIndex, column),
        new vscode.Position(lineIndex, column + 1)
      ) : 
      lineObj.range;
    
    // 应用装饰
    editor.setDecorations(decorationType, [{
      range: range,
      hoverMessage: '调试位置'
    }]);
    
    // 滚动到视图
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    
    // 5秒后移除高亮
    setTimeout(() => {
      editor.setDecorations(decorationType, []);
    }, 5000);
  } catch (error) {
    console.error(`高亮文件位置时出错:`, error);
  }
}

/**
 * 向项目集成Font Tool热更新客户端
 */
async function integrateHotReloadClient() {
  // 获取工作区文件夹
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('请先打开一个项目文件夹');
    return;
  }
  
  try {
    // 获取热更新客户端代码
    const clientCode = getFontToolHotReloadClient();
    
    // 选择创建的文件类型
    const fileType = await vscode.window.showQuickPick(
      ['JavaScript (ES6)', 'TypeScript', '添加到入口文件'],
      {
        placeHolder: '选择集成方式'
      }
    );
    
    if (!fileType) return;
    
    if (fileType === '添加到入口文件') {
      // 查找项目入口文件
      const entryFiles = await findEntryFiles();
      
      if (entryFiles.length === 0) {
        vscode.window.showErrorMessage('找不到项目入口文件');
        return;
      }
      
      const selectedFile = await vscode.window.showQuickPick(
        entryFiles.map(file => ({
          label: path.basename(file),
          description: file,
          file: file
        })),
        {
          placeHolder: '选择要添加热更新代码的文件'
        }
      );
      
      if (!selectedFile) return;
      
      // 读取文件内容
      const filePath = selectedFile.file;
      const content = fs.readFileSync(filePath, 'utf8');
      
      // 添加热更新代码
      const newContent = content + '\n\n// ===== Font Tool 热更新客户端 =====\n' + clientCode;
      
      // 写回文件
      fs.writeFileSync(filePath, newContent, 'utf8');
      
      vscode.window.showInformationMessage(`已向 ${path.basename(filePath)} 添加Font Tool热更新支持`);
    } else {
      // 创建新文件
      const extension = fileType === 'JavaScript (ES6)' ? 'js' : 'ts';
      const fileName = `fontToolHotReload.${extension}`;
      
      // 选择保存位置
      const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
      const srcFolder = fs.existsSync(path.join(rootPath, 'src')) ? path.join(rootPath, 'src') : rootPath;
      const utilsFolder = fs.existsSync(path.join(srcFolder, 'utils')) ? path.join(srcFolder, 'utils') : srcFolder;
      
      const targetFolder = await vscode.window.showQuickPick(
        [
          { label: 'src/utils', path: path.join(srcFolder, 'utils') },
          { label: 'src', path: srcFolder },
          { label: '根目录', path: rootPath }
        ].filter(item => fs.existsSync(item.path)),
        {
          placeHolder: '选择保存位置'
        }
      );
      
      if (!targetFolder) return;
      
      // 确保目录存在
      if (!fs.existsSync(targetFolder.path)) {
        fs.mkdirSync(targetFolder.path, { recursive: true });
      }
      
      // 创建文件
      const filePath = path.join(targetFolder.path, fileName);
      fs.writeFileSync(filePath, clientCode, 'utf8');
      
      // 打开文件
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc);
      
      vscode.window.showInformationMessage(`已创建Font Tool热更新客户端文件: ${fileName}`);
    }
    
    // 连接到Font Tool服务器
    connectToFontTool();
  } catch (error) {
    vscode.window.showErrorMessage(`集成Font Tool热更新客户端失败: ${error.message}`);
    console.error('集成Font Tool热更新客户端失败:', error);
  }
}

/**
 * 查找项目可能的入口文件
 * @returns {Promise<string[]>} 入口文件列表
 */
async function findEntryFiles() {
  const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const possibleEntryFiles = [
    'src/index.js',
    'src/index.tsx',
    'src/main.js',
    'src/main.tsx',
    'src/App.js',
    'src/App.tsx',
    'index.js',
    'app.js',
    'pages/_app.js',
    'pages/_app.tsx'
  ];
  
  const entryFiles = [];
  
  for (const file of possibleEntryFiles) {
    const filePath = path.join(rootPath, file);
    if (fs.existsSync(filePath)) {
      entryFiles.push(filePath);
    }
  }
  
  return entryFiles;
}

/**
 * 获取Font Tool热更新客户端代码
 * @returns {string} 客户端代码
 */
function getFontToolHotReloadClient() {
  // 获取调试模式配置
  const config = vscode.workspace.getConfiguration('font-tool');
  const debugMode = config.get('debugMode') || false;
  
  return `
// font-tool 热更新客户端 (增强版)
// 此代码由Font Tool Cursor插件自动生成

(function() {
  // 如果已经加载过热更新客户端，则不再重复加载
  if (window.fontToolHotReload) return;
  
  let ws = null;
  let reconnectTimer = null;
  let isConnected = false;
  const port = ${fontToolPort};
  
  // 调试模式 - 可以在控制台中设置 window.fontToolDebug = true 查看详细日志
  let debug = ${debugMode};
  
  function log(...args) {
    if (debug) console.log('[font-tool]', ...args);
  }
  
  // 初始化组件映射表
  const componentMappings = {};
  
  function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log('[font-tool] WebSocket已连接');
      return;
    }
    
    try {
      ws = new WebSocket(\`ws://localhost:\${port}\`);
      
      ws.onopen = () => {
        console.log('[font-tool] 热更新连接已建立');
        isConnected = true;
        clearTimeout(reconnectTimer);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          log('收到消息:', data);
          
          if (data.type === 'connected') {
            console.log('[font-tool] 已连接到服务器');
          } else if (data.type === 'font-config-updated') {
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
        console.log('[font-tool] 热更新连接已关闭，5秒后尝试重新连接');
        isConnected = false;
        
        // 5秒后尝试重新连接
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 5000);
      };
      
      ws.onerror = (error) => {
        console.error('[font-tool] WebSocket错误:', error);
        isConnected = false;
        ws.close();
      };
    } catch (error) {
      console.error('[font-tool] 创建WebSocket连接时出错:', error);
      isConnected = false;
      
      // 5秒后尝试重新连接
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 5000);
    }
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
      
      // 匹配 @font-tool: 注释格式
      if (commentText.includes('@font-tool:') && 
          commentText.includes(componentName) && 
          commentText.includes(elementName)) {
        
        log('找到匹配的注释:', commentText);
        
        // 获取注释后的下一个元素
        let targetElement = commentNode.nextElementSibling;
        if (targetElement) {
          elements.push(targetElement);
          log('基于注释找到元素:', targetElement);
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
    while ((node = walker.nextNode())) {
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
    const event = new Event('font-tool-updated');
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
  
  function showUpdateNotification(message = '字体设置已更新') {
    // 创建通知元素
    const notification = document.createElement('div');
    notification.textContent = message;
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
    // 设置调试模式
    debug = window.fontToolDebug || debug;
    
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
    
    // 初始连接
    connect();
    console.log('[font-tool] 热更新客户端已初始化，连接端口:', port);
  }
  
  // 在DOM加载后初始化
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }
  
  // 导出API
  window.fontToolHotReload = {
    connect,
    disconnect: () => {
      if (ws) {
        ws.close();
        clearTimeout(reconnectTimer);
        console.log('[font-tool] 已断开热更新连接');
      }
    },
    isConnected: () => isConnected,
    updateStyles: updateFontStyles,
    findElements: findElementsForComponent,
    setDebug: value => { debug = !!value; }
  };
})();
`;
}

/**
 * 切换调试模式
 */
async function toggleDebugMode() {
  const config = vscode.workspace.getConfiguration('font-tool');
  const currentDebugMode = config.get('debugMode') || false;
  
  // 切换调试模式
  await config.update('debugMode', !currentDebugMode, true);
  
  vscode.window.showInformationMessage(
    `Font Tool 调试模式已${!currentDebugMode ? '开启' : '关闭'}`
  );
  
  // 如果已连接，通知WebSocket服务器
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    wsConnection.send(JSON.stringify({
      type: 'set-debug-mode',
      debugMode: !currentDebugMode
    }));
  }
}

/**
 * 插件停用时调用
 */
function deactivate() {
  // 断开WebSocket连接
  disconnectWebSocket();
  
  // 清理状态栏项
  if (connectionStatusBar) {
    connectionStatusBar.dispose();
  }
}

module.exports = {
  activate,
  deactivate
}; 