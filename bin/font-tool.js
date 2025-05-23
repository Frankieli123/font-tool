#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

// 解析命令行参数
const args = process.argv.slice(2);
const options = {
  port: 28888,
  autoConnect: true
};

// 处理命令行选项
args.forEach(arg => {
  if (arg.startsWith('--port=')) {
    options.port = parseInt(arg.split('=')[1], 10);
  } else if (arg === '--port' && args.indexOf(arg) < args.length - 1) {
    options.port = parseInt(args[args.indexOf(arg) + 1], 10);
  } else if (arg === '--no-auto-connect') {
    options.autoConnect = false;
  }
});

// 获取Electron可执行文件路径
const electronPath = require('electron');

// 获取main.js的路径
const mainPath = path.join(__dirname, '..', 'main.js');

// 运行Electron应用
const childProcess = spawn(electronPath, [mainPath], {
  stdio: 'inherit',
  env: {
    ...process.env,
    FONT_TOOL_PORT: options.port.toString(),
    FONT_TOOL_AUTO_CONNECT: options.autoConnect.toString()
  }
});

childProcess.on('close', (code) => {
  process.exit(code);
}); 