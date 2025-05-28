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
    debugMode: options.debugMode || false, // 增强调试模式
    onUpdate: options.onUpdate || (() => {
      // 默认行为：触发全局事件，组件可以监听这个事件来刷新
      const event = new Event('font-tool-updated');
      window.dispatchEvent(event);
      
      // 查找并更新标记的元素
      updateFontElements();
      
      // 显示通知
      showNotification('字体设置已更新');
    })
  };
  
  let ws = null;
  let reconnectTimer = null;
  let isConnected = false;
  let lastUpdateData = null;
  
  function log(...args) {
    if (config.debug) {
      console.log('[font-tool]', ...args);
    }
  }
  
  function debugLog(...args) {
    if (config.debugMode) {
      console.log('[font-tool-debug]', ...args);
    }
  }
  
  // 增强元素匹配算法，使用多种策略查找元素
  function findElementsToUpdate(updateData) {
    debugLog('开始查找要更新的元素...');
    const elements = [];
    const updates = updateData.updates || [];
    
    // 如果没有具体的更新信息，使用通用方法查找所有可能的字体元素
    if (updates.length === 0) {
      debugLog('没有具体更新信息，查找所有可能的字体元素');
      
      // 策略1：查找有data-font-tool属性的元素（原始方法）
      const dataFontToolAttributeElements = document.querySelectorAll('[data-font-tool]');
      debugLog(`找到 ${dataFontToolAttributeElements.length} 个带有data-font-tool属性的元素`);
      
      dataFontToolAttributeElements.forEach(el => {
        elements.push({
          element: el,
          matchType: 'data-attribute',
          relativeSizeValue: el.getAttribute('data-font-tool'),
          matchScore: 0.95 // 最高优先级
        });
      });
      
      // 策略2：查找字体调整函数使用的元素
      // 这里我们只能通过间接方式查找，因为JavaScript代码在DOM中不可见
      // 我们可以查找具有特定类名或样式的元素，这些通常是由字体调整函数设置的
      
      debugLog('增强的字体调整函数匹配策略开始...');
      
      // 2.1 查找可能使用了mapLevelToPx的元素 - 放宽匹配条件，不仅查找设置了fontSize的元素
      const fontSizeElements = Array.from(document.querySelectorAll('*')).filter(el => {
        // 跳过不可见或不包含文本的元素
        if (!el.offsetParent || !el.textContent?.trim()) return false;
        
        const style = window.getComputedStyle(el);
        const fontSize = parseInt(style.fontSize);
        
        // 检查是否有明确的字体大小设置，允许更宽松的匹配
        return style.fontSize 
            && style.fontSize !== 'inherit' 
            && style.fontSize !== 'initial'
            // 通常mapLevelToPx调整后的字体大小会是特定的偶数或奇数值，不太可能是普通的设计值如16px
            && (fontSize % 2 !== 0 || fontSize > 20 || fontSize < 10);
      });
      
      debugLog(`找到 ${fontSizeElements.length} 个潜在的字体调整元素`);
      
      // 2.2 查找带有data-font-tool属性的元素（由getTextScaleClass生成）
      // 注意：我们已经在策略1中查找过这些元素，这里只是为了记录日志
      debugLog(`已经处理了带有data-font-tool属性的元素`);
          
      // 2.3 匹配特定类型的文本元素 - 标题、段落等，这些通常会使用字体调整
      const textElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, li, label, button');
      debugLog(`找到 ${textElements.length} 个文本元素`);
            
      // 为每个文本元素计算匹配分数
      textElements.forEach(el => {
        if (!elements.some(existing => existing.element === el)) {
          const style = window.getComputedStyle(el);
          const fontSize = parseInt(style.fontSize);
          
          // 计算匹配分数 - 根据特征给分
          let score = 0.5; // 基础分数
          
          // 特征1: 非标准字体大小（更可能是通过函数动态计算的）
          if (fontSize % 2 !== 0 || fontSize > 20 || fontSize < 10) {
            score += 0.2;
          }
          
          // 特征2: 具有特殊类名，可能与组件相关
          const className = el.className || '';
          if (className.includes('text-') 
              || className.includes('title') 
              || className.includes('heading')
              || className.includes('label')
              || className.includes('font')) {
            score += 0.1;
          }
          
          // 特征3: 含有明确文字内容
          if (el.textContent && el.textContent.trim().length > 0) {
            score += 0.1;
          }
              
              elements.push({
            element: el,
            matchType: 'text-element-analysis',
            relativeSizeValue: '+0', // 默认值，因为我们无法从DOM中获取相对大小
            matchScore: score
          });
        }
      });
      
      // 2.4 查找已自定义字体大小的元素
      fontSizeElements.forEach(el => {
        // 确保不重复
        if (!elements.some(existing => existing.element === el)) {
          const style = window.getComputedStyle(el);
          const fontSize = parseInt(style.fontSize);
          
          // 计算相对大小（估算值，基于10px的基准）
          let relativeSizeValue = '+0';
          if (fontSize >= 10 && fontSize <= 25) {
            // 假设基础字体大小为10px
            const relativeSize = fontSize - 10;
            relativeSizeValue = relativeSize >= 0 ? `+${relativeSize}` : `${relativeSize}`;
          }
                
                elements.push({
            element: el,
            matchType: 'font-size-style',
            relativeSizeValue: relativeSizeValue,
            matchScore: 0.85 // 高优先级，但低于data-attribute
                });
              }
      });
      
      // 2.5 尝试匹配带有行内样式的元素
      const inlineStyleElements = Array.from(document.querySelectorAll('[style*="font-size"]'));
      debugLog(`找到 ${inlineStyleElements.length} 个带有行内font-size样式的元素`);
      
      inlineStyleElements.forEach(el => {
        // 确保不重复
        if (!elements.some(existing => existing.element === el)) {
          const fontSize = el.style.fontSize;
          let relativeSizeValue = '+0';
          
          // 尝试从行内样式中提取数字
          const sizeMatch = fontSize.match(/(\d+)px/);
          if (sizeMatch && sizeMatch[1]) {
            const size = parseInt(sizeMatch[1]);
            // 假设基础字体大小为10px
            const relativeSize = size - 10;
            relativeSizeValue = relativeSize >= 0 ? `+${relativeSize}` : `${relativeSize}`;
          }
          
              elements.push({
                element: el,
            matchType: 'inline-style',
            relativeSizeValue: relativeSizeValue,
            matchScore: 0.9 // 高优先级
              });
            }
          });
      
      // 策略3：使用广泛的选择器匹配
      // 例如，如果我们在更新"标题"，可以查找h1-h6元素
      const commonSelectors = {
        '标题': 'h1, h2, h3, h4, h5, h6, .title, .heading',
        '文本': 'p, .text, article, section',
        '按钮': 'button, .btn, [role="button"]',
        '导航': 'nav, .nav, .navigation, .menu',
        '列表': 'ul, ol, .list'
      };
      
      // 尝试使用通用选择器
      if (updateData.elementName) {
        for (const [key, selector] of Object.entries(commonSelectors)) {
          if (updateData.elementName.includes(key)) {
            try {
              const matchedElements = document.querySelectorAll(selector);
              debugLog(`使用选择器 ${selector} 匹配 "${key}" 找到 ${matchedElements.length} 个元素`);
              
              // 添加到结果
              matchedElements.forEach(el => {
                // 确保不重复
                if (!elements.some(existing => existing.element === el)) {
                  elements.push({
                    element: el,
                    matchType: 'selector-common',
                    relativeSizeValue: updateData.relativeSizeValue || '+0',
                    matchScore: 0.6 // 中等优先级
                  });
                }
              });
            } catch (e) {
              debugLog(`选择器错误:`, e);
            }
          }
        }
      }
      
      // 如果使用了提供的 nextLine 信息，尝试使用标签和类名匹配
      if (updateData.nextLine && updateData.nextLine.elementInfo) {
        debugLog('使用 nextLine 信息进行元素匹配...');
        const info = updateData.nextLine.elementInfo;
        
        let selector = '';
        
        // 构建选择器
        if (info.tagName) {
          selector = info.tagName;
        }
        
        if (info.className) {
          const classes = info.className.split(/\s+/).map(c => `.${c}`).join('');
          selector += classes;
        }
        
        if (selector) {
          try {
            const matchedElements = document.querySelectorAll(selector);
            debugLog(`使用nextLine选择器 ${selector} 找到 ${matchedElements.length} 个元素`);
            
            // 添加到结果
            matchedElements.forEach(el => {
              // 确保不重复
              if (!elements.some(existing => existing.element === el)) {
              elements.push({
                element: el,
                  matchType: 'nextLine-info',
                  relativeSizeValue: updateData.relativeSizeValue || '+0',
                  matchScore: 0.7 // 较高优先级
              });
              }
            });
          } catch (e) {
            debugLog(`nextLine选择器错误:`, e);
          }
        }
      }
      
    } else {
      // 有具体的更新信息，按照每个更新项分别查找元素
      debugLog(`处理 ${updates.length} 个具体更新项`);
      
      updates.forEach(update => {
        // 跳过没有必要信息的更新项
        if (!update.componentName || !update.elementName) {
          debugLog('跳过缺少组件名或元素名的更新项:', update);
          return;
        }
        
        debugLog(`查找 组件="${update.componentName}", 元素="${update.elementName}"`);
          
        // 查找拥有对应data-*属性的元素
        const dataComponentElements = document.querySelectorAll(`[data-component="${update.componentName}"]`);
        debugLog(`找到 ${dataComponentElements.length} 个带有data-component="${update.componentName}"的元素`);
        
        dataComponentElements.forEach(el => {
          // 检查是否包含元素名称对应的文本
          if (el.textContent.includes(update.elementName)) {
            elements.push({
              element: el,
              matchType: 'component-attribute-with-text',
              relativeSizeValue: update.relativeSizeValue,
              componentName: update.componentName,
              elementName: update.elementName,
              matchScore: 0.9 // 高优先级
            });
          } else {
            elements.push({
              element: el,
              matchType: 'component-attribute',
              relativeSizeValue: update.relativeSizeValue,
              componentName: update.componentName,
              elementName: update.elementName,
              matchScore: 0.8 // 中等优先级
            });
          }
        });
        
        // 查找包含元素名称的文本节点，并获取它们的父元素
        const textNodesWithElementName = [];
        const textNodeFinder = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: function(node) {
              const text = node.textContent.trim();
              return text && text.includes(update.elementName) ? 
                NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
          }
        );
        
        let textNode;
        while (textNode = textNodeFinder.nextNode()) {
          textNodesWithElementName.push(textNode.parentElement);
            }
        
        debugLog(`找到 ${textNodesWithElementName.length} 个包含文本 "${update.elementName}" 的元素`);
        
        textNodesWithElementName.forEach(el => {
          elements.push({
            element: el,
            matchType: 'text-content-match',
            relativeSizeValue: update.relativeSizeValue,
            componentName: update.componentName,
            elementName: update.elementName,
            matchScore: 0.7 // 较低优先级
          });
        });
      });
    }
    
    // 对结果进行排序和去重
    const uniqueElements = removeDuplicates(elements);
    debugLog(`去重后剩余 ${uniqueElements.length} 个元素`);
    
    return uniqueElements;
            }
            
  // 辅助函数：解析注释内容
  function parseCommentContent(commentText) {
    // 支持中英文冒号
    if (!commentText.includes('@font-tool:') && !commentText.includes('@font-tool：')) {
      return null;
    }
    
    let componentName = null;
    let elementName = null;
    let relativeSizeValue = '+0'; // 默认值
    
    // 处理复杂格式：@font-tool: Component - Element - fontSize+X
    const complexMatch = commentText.match(/@font-tool[：:]\s*([^-]+)\s*-\s*([^-]+)\s*-\s*fontSize([+-]\d+)/);
              if (complexMatch) {
      componentName = complexMatch[1].trim();
      elementName = complexMatch[2].trim();
      relativeSizeValue = complexMatch[3];
      
      return { componentName, elementName, relativeSizeValue };
                }
    
    // 处理简化格式：@font-tool: ElementName (没有组件名和fontSize)
    const simpleElementMatch = commentText.match(/@font-tool[：:]([^-]+)/);
    if (simpleElementMatch) {
      elementName = simpleElementMatch[1].trim();
      // 组件名未指定时使用null
      // relativeSizeValue默认为+0
      
      return { componentName, elementName, relativeSizeValue };
    }
    
    // 处理简单格式：@font-tool:+X 或 @font-tool:X (只有相对大小)
    const simpleSizeMatch = commentText.match(/@font-tool[：:]([+-]?\d+)/);
    if (simpleSizeMatch) {
      relativeSizeValue = simpleSizeMatch[1];
      
      return { componentName, elementName, relativeSizeValue };
    }
    
    return null;
  }
  
  // 去除重复元素并按优先级排序
  function removeDuplicates(elements) {
    // 按匹配得分排序（高到低）
    const sortedElements = [...elements].sort((a, b) => {
      const scoreA = a.matchScore || 0;
      const scoreB = b.matchScore || 0;
      return scoreB - scoreA; // 降序
    });
    
    const uniqueMap = new Map();
    
    // 保留每个元素的最高优先级匹配
    sortedElements.forEach(item => {
      const element = item.element;
      // 使用DOM元素作为Map的键
      if (!uniqueMap.has(element)) {
        uniqueMap.set(element, item);
      }
    });
    
    return Array.from(uniqueMap.values());
  }
  
  // 应用字体大小更新
  function updateFontElements() {
    if (!lastUpdateData) {
      debugLog('没有更新数据，无法应用字体更改');
      return;
    }
    
    const elementsToUpdate = findElementsToUpdate(lastUpdateData);
    debugLog(`准备更新 ${elementsToUpdate.length} 个元素的字体大小`);
    
    // 如果找不到任何元素，提供更详细的诊断
    if (elementsToUpdate.length === 0) {
      if (config.debugMode) {
        console.warn('[font-tool] 无法找到匹配的@font-tool注释或样式，更改未应用');
        console.warn('[font-tool] 请确保组件中添加了@font-tool注释或data-font-tool属性');
        console.warn('[font-tool] 更新数据:', lastUpdateData);
        
        // 检查并报告页面中的所有@font-tool注释
        const allHTMLContent = document.documentElement.outerHTML;
        
        // 查找所有@font-tool注释
        const commentRegExp = /<!--\s*@font-tool:[^>]*-->/g;
        let match;
        const foundComments = [];
        
        while ((match = commentRegExp.exec(allHTMLContent)) !== null) {
          foundComments.push({
            comment: match[0],
            position: match.index
          });
        }
        
        console.log('[font-tool] 在页面HTML中找到的@font-tool注释:', foundComments.length);
        foundComments.forEach((item, index) => {
          console.log(`[${index + 1}] ${item.comment}`);
        });
        
        // 扫描并记录所有元素的字体大小属性，帮助调试
        const fontSizeInfo = [];
        document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div, span').forEach(el => {
          const style = window.getComputedStyle(el);
          if (el.textContent && el.textContent.trim().length > 0) {
            // 检查前一个节点是否为注释
            let commentNode = null;
            if (el.previousSibling && el.previousSibling.nodeType === Node.COMMENT_NODE) {
              commentNode = el.previousSibling.textContent;
            }
            
            fontSizeInfo.push({
              element: el.tagName,
              text: el.textContent.trim().substring(0, 30) + (el.textContent.trim().length > 30 ? '...' : ''),
              fontSize: style.fontSize,
              lineHeight: style.lineHeight,
              comment: commentNode ? commentNode.substring(0, 50) : '无注释'
            });
          }
        });
        
        console.table(fontSizeInfo.slice(0, 20)); // 只显示前20个，避免输出过多
        console.warn('[font-tool] 已显示当前页面上带有文本的部分元素，用于辅助调试');
      }
      return;
    }
    
    // 应用更新
    elementsToUpdate.forEach(item => {
      try {
        const { element, relativeSizeValue } = item;
        if (element && relativeSizeValue) {
          // 将相对大小值转换为像素值
          const baseSize = 10; // 基础大小
          const level = parseInt(relativeSizeValue.replace(/[+]/, ''), 10);
          const newSizePx = baseSize + level;
          
          debugLog(`更新元素字体大小:`, {
            element: element.tagName,
            text: element.textContent ? element.textContent.substring(0, 20) : '',
            currentSize: window.getComputedStyle(element).fontSize,
            newSize: `${newSizePx}px`,
            level: level
          });
          
          // 应用新的字体大小
          element.style.fontSize = `${newSizePx}px`;
          
          // 添加视觉反馈（短暂高亮）
          const originalBackground = element.style.backgroundColor;
          element.style.backgroundColor = '#fffacd'; // 淡黄色高亮
          element.style.transition = 'background-color 1s';
          
          // 1秒后恢复原来的背景色
          setTimeout(() => {
            element.style.backgroundColor = originalBackground;
          }, 1000);
        }
      } catch (error) {
        console.error('[font-tool] 更新元素字体大小时出错:', error);
      }
    });
  }
  
  // 连接到WebSocket服务器
  function connect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      log('已经连接到热更新服务器，跳过重连');
      return;
    }
    
    try {
      // 创建WebSocket连接
      ws = new WebSocket(`ws://localhost:${config.port}`);
      
      ws.onopen = () => {
        log(`已连接到热更新服务器(端口: ${config.port})`);
        isConnected = true;
        clearTimeout(reconnectTimer);
        
        // 发送调试模式状态
        if (config.debugMode) {
          ws.send(JSON.stringify({
            type: 'set-debug-mode',
            enabled: true,
            clientInfo: {
              userAgent: navigator.userAgent,
              url: window.location.href
            }
          }));
        }
        
        // 发送问候消息
        ws.send(JSON.stringify({
          type: 'client-connected',
          message: 'Font Tool客户端已连接',
          timestamp: Date.now()
        }));
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          log('收到热更新消息:', data);
          
          // 保存最后收到的更新数据
          if (data.type === 'font-config-updated') {
            lastUpdateData = data;
            debugLog('收到配置更新:', data);
            
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
    }),
    // 新增：手动触发更新和调试功能
    forceUpdate: () => {
      if (lastUpdateData) {
        updateFontElements();
      }
    },
    enableDebugMode: () => {
      config.debugMode = true;
      debugLog('已启用调试模式');
      
      // 通知服务器已启用调试模式
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'set-debug-mode',
          enabled: true
        }));
      }
      
      return true;
    },
    disableDebugMode: () => {
      config.debugMode = false;
      log('已禁用调试模式');
      
      // 通知服务器已禁用调试模式
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'set-debug-mode',
          enabled: false
        }));
      }
      
      return false;
    }
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