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
      wsConnection.send(JSON.stringify({
        type: 'cursor-plugin-connected',
        version: '1.0.0'
      }));
    });
    
    wsConnection.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        console.log('收到Font Tool消息:', message);
        
        if (message.type === 'font-config-updated') {
          // 显示通知
          vscode.window.showInformationMessage(`Font Tool: 字体配置已更新 (${new Date().toLocaleTimeString()})`);
          
          // 在更新的文件中查找并高亮@font-tool注释
          if (message.updatedFiles && message.updatedFiles.length > 0) {
            highlightFontToolComments(message.updatedFiles);
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
      if (!fs.existsSync(filePath)) continue;
      
      // 读取文件内容
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      // 查找所有@font-tool注释
      const fontToolPattern = /@font-tool:/g;
      let match;
      const positions = [];
      
      // 在每一行中查找注释
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let lineMatch;
        
        // 重置正则表达式对象以开始新的搜索
        const linePattern = new RegExp(fontToolPattern);
        
        while ((lineMatch = linePattern.exec(line)) !== null) {
          positions.push({
            line: i,
            character: lineMatch.index
          });
        }
      }
      
      // 如果找到了注释，打开文件并高亮显示
      if (positions.length > 0) {
        const doc = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        
        // 创建装饰器类型
        const decorationType = vscode.window.createTextEditorDecorationType({
          backgroundColor: 'rgba(76, 175, 80, 0.3)',
          borderRadius: '3px',
          overviewRulerColor: 'rgba(76, 175, 80, 0.8)',
          overviewRulerLane: vscode.OverviewRulerLane.Right
        });
        
        // 创建装饰范围
        const decorations = positions.map(pos => {
          const line = doc.lineAt(pos.line);
          const start = pos.character;
          let end = line.text.indexOf('*/', start);
          if (end === -1) end = line.text.length;
          
          return {
            range: new vscode.Range(
              new vscode.Position(pos.line, start),
              new vscode.Position(pos.line, end + 2)
            )
          };
        });
        
        // 应用装饰
        editor.setDecorations(decorationType, decorations);
        
        // 5秒后移除高亮
        setTimeout(() => {
          editor.setDecorations(decorationType, []);
        }, 5000);
      }
    } catch (error) {
      console.error(`处理文件${filePath}时出错:`, error);
    }
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
  return `
// font-tool 热更新客户端
// 此代码由Font Tool Cursor插件自动生成

(function() {
  // 如果已经加载过热更新客户端，则不再重复加载
  if (window.fontToolHotReload) return;
  
  let ws = null;
  let reconnectTimer = null;
  let isConnected = false;
  const port = ${fontToolPort};
  
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
          
          if (data.type === 'connected') {
            console.log('[font-tool] 已连接到服务器');
          } else if (data.type === 'font-config-updated') {
            console.log('[font-tool] 字体配置已更新，正在刷新样式');
            
            // 触发React的重新渲染
            const updateEvent = new Event('font-tool-updated');
            window.dispatchEvent(updateEvent);
            
            // 查找所有使用字体工具的元素
            document.querySelectorAll('[data-font-tool]').forEach(el => {
              // 添加一个临时类来触发重绘
              el.classList.add('font-tool-update');
              setTimeout(() => {
                el.classList.remove('font-tool-update');
              }, 100);
            });
            
            // 提供视觉反馈
            showNotification('字体设置已更新');
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
  
  function showNotification(message) {
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
  
  // 初始连接
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    connect();
  } else {
    window.addEventListener('DOMContentLoaded', connect);
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
    isConnected: () => isConnected
  };
})();
`;
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