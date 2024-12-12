const express = require('express');
const path = require('path');
const compression = require('compression');
const fs = require('fs');
const app = express();

// 启用压缩
app.use(compression());

// 添加缓存控制
app.use((req, res, next) => {
    if (req.url.endsWith('.pdf')) {
        res.setHeader('Cache-Control', 'public, max-age=86400'); // 24小时缓存
    }
    next();
});

// 配置静态文件服务
app.use(express.static(__dirname, {
    setHeaders: (res, path) => {
        // 设置通用响应头
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        
        // 为PDF文件设置特定响应头
        if (path.endsWith('.pdf')) {
            res.set('Content-Type', 'application/pdf');
            res.set('Content-Disposition', 'inline');
        }
    },
    maxAge: '1h' // 静态资源缓存1小时
}));

// 专门处理PDF请求的路由
app.get('/pdf/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, filename);
    
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('PDF文件未找到');
    }
    
    // 设置响应头
    res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline',
        'Access-Control-Allow-Origin': '*'
    });
    
    // 发送文件
    res.sendFile(filePath);
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('服务器错误：', err);
    res.status(500).send('服务器内部错误');
});

const port = 3000;
app.listen(port, () => {
    console.log(`服务器运行在 http://localhost:${port}`);
}); 