// font-tool 热更新客户端
// 在 zhanwen 项目中引入此文件以启用热更新功能

/**
 * 初始化 font-tool 热更新客户端
 * @param {Object} options 配置选项
 * @param {number} options.port WebSocket 服务器端口，默认为 28888
 * @param {boolean} options.debug 是否输出调试信息，默认为 false
 * @param {Function} options.onUpdate 配置更新时的回调函数
 * @returns {Object} 控制对象，包含 connect, disconnect 等方法
 */
export function initFontToolHotReload(options = {}) {
  const config = {
    port: options.port || 28888,
    debug: options.debug || false,
    onUpdate: options.onUpdate || (() => {
      // 默认行为：触发全局事件，组件可以监听这个事件来刷新
      const event = new Event('font-tool-updated');
      window.dispatchEvent(event);
      
      // 如果文档中有标记了 data-font-tool 的元素，则提供视觉反馈
      if (document.querySelector('[data-font-tool]')) {
        // 显示通知
        showNotification('字体设置已更新');
      }
    })
  };
  
  let ws = null;
  let reconnectTimer = null;
  let isConnected = false;
  
  function log(...args) {
    if (config.debug) {
      console.log('[font-tool]', ...args);
    }
  }
  
  function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      log('WebSocket 已连接');
      return;
    }
    
    try {
      ws = new WebSocket(`ws://localhost:${config.port}`);
      
      ws.onopen = () => {
        log('热更新连接已建立');
        isConnected = true;
        clearTimeout(reconnectTimer);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'connected') {
            log('已连接到 font-tool 服务器');
          } else if (data.type === 'font-config-updated') {
            log('字体配置已更新，更新时间:', new Date(data.timestamp).toLocaleTimeString());
            log('更新的文件:', data.updatedFiles);
            
            // 执行更新回调
            config.onUpdate(data);
          }
        } catch (error) {
          console.error('[font-tool] 处理消息时出错:', error);
        }
      };
      
      ws.onclose = () => {
        log('热更新连接已关闭，5秒后尝试重新连接');
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
  
  function disconnect() {
    if (ws) {
      ws.close();
      clearTimeout(reconnectTimer);
      log('已断开热更新连接');
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
  connect();
  
  // 返回控制对象
  return {
    connect,
    disconnect,
    isConnected: () => isConnected,
    getStatus: () => ({
      connected: isConnected,
      port: config.port
    })
  };
}

/**
 * React Hook: 使用 font-tool 热更新
 * @param {Object} options 配置选项
 * @returns {Object} 控制对象
 */
export function useFontToolHotReload(options = {}) {
  // 如果你的项目使用 React，这个 Hook 可以帮助你集成热更新功能
  // 在 React 组件中调用 useFontToolHotReload() 即可
  
  if (typeof React === 'undefined' || typeof React.useEffect === 'undefined') {
    console.error('[font-tool] useFontToolHotReload 需要 React 环境');
    return null;
  }
  
  React.useEffect(() => {
    const controller = initFontToolHotReload(options);
    
    // 组件卸载时断开连接
    return () => {
      controller.disconnect();
    };
  }, []);
  
  return {
    // 可以返回一些控制方法，但通常不需要，热更新会自动工作
  };
}

/**
 * 创建支持热更新的字体样式工具
 * @param {number} baseFontSize 基础字体大小
 * @returns {Object} 字体样式工具
 */
export function createFontTools(baseFontSize = 13) {
  // 检查环境是否支持热更新
  const isClient = typeof window !== 'undefined';
  let fontSizeListeners = [];
  
  /**
   * 将字体大小级别转换为像素值
   * @param {number} level 字体大小级别
   * @returns {number} 像素值
   */
  function mapLevelToPx(level) {
    // 与 font-tool 使用相同的算法
    const clampedLevel = Math.max(-2, Math.min(15, level));
    return baseFontSize + clampedLevel;
  }
  
  /**
   * 根据相对字体大小获取样式类
   * @param {number} relativeSize 相对字体大小
   * @returns {string} 样式类字符串
   */
  function getTextScaleClass(relativeSize) {
    // 返回包含 data-font-tool 属性的标记，便于热更新时定位
    const sizeValue = relativeSize >= 0 ? `+${relativeSize}` : relativeSize;
    return `text-[${mapLevelToPx(relativeSize)}px] data-font-tool="${sizeValue}"`;
  }
  
  /**
   * 订阅字体大小变更
   * @param {Function} listener 监听函数
   * @returns {Function} 取消订阅函数
   */
  function subscribeToFontSizeChanges(listener) {
    if (!isClient) return () => {};
    
    fontSizeListeners.push(listener);
    
    // 注册全局事件监听
    const handleFontToolUpdate = () => {
      listener();
    };
    
    window.addEventListener('font-tool-updated', handleFontToolUpdate);
    
    // 返回取消订阅函数
    return () => {
      fontSizeListeners = fontSizeListeners.filter(l => l !== listener);
      window.removeEventListener('font-tool-updated', handleFontToolUpdate);
    };
  }
  
  // 如果是客户端环境，初始化热更新
  if (isClient) {
    initFontToolHotReload({
      onUpdate: () => {
        // 通知所有监听者
        fontSizeListeners.forEach(listener => listener());
      }
    });
  }
  
  return {
    mapLevelToPx,
    getTextScaleClass,
    subscribeToFontSizeChanges
  };
}

export default {
  initFontToolHotReload,
  useFontToolHotReload,
  createFontTools
}; 