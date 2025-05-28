// 预加载脚本
const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 选择项目目录
  selectProjectDirectory: () => ipcRenderer.invoke('select-project-directory'),
  
  // 应用字体配置到代码
  applyFontConfig: (projectDir, configs, matchMode) => ipcRenderer.invoke('apply-font-config', projectDir, configs, matchMode),
  
  // 应用字体配置到代码 (支持自定义字段)
  applyFontConfigWithCustomFields: (projectDir, configs, matchMode, customFields) => 
    ipcRenderer.invoke('apply-font-config-with-custom-fields', projectDir, configs, matchMode, customFields),
  
  // 打开文件并定位到特定行
  openFileAtLocation: (projectDir, fileName, lineNumbers) => ipcRenderer.invoke('open-file-at-location', projectDir, fileName, lineNumbers),
  
  // 扫描项目中的@font-tool注释
  scanFontToolComments: (projectDir, matchMode) => ipcRenderer.invoke('scan-font-tool-comments', projectDir, matchMode),
  
  // 扫描项目中的@font-tool注释 (支持自定义字段)
  scanFontToolCommentsWithCustomFields: (projectDir, matchMode, customFields) => 
    ipcRenderer.invoke('scan-font-tool-comments-with-custom-fields', projectDir, matchMode, customFields),
  
  // 获取WebSocket服务器状态
  getWebSocketStatus: () => ipcRenderer.invoke('get-websocket-status'),
  
  // 生成React热更新客户端代码
  generateHotReloadClient: () => ipcRenderer.invoke('generate-hot-reload-client'),
  
  // 清除缓存的配置
  clearCache: () => ipcRenderer.invoke('clear-cache')
}); 