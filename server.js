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
        res.setHeader('Cache-Control', 'public, max-age=86400');
    }
    next();
});

// 配置静态文件服务，允许直接访问根目录的文件
app.use(express.static(__dirname));

// 专门处理 poetry.pdf 的路由
app.get('/poetry.pdf', (req, res) => {
    const filePath = path.join(__dirname, 'poetry.pdf');
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('PDF文件未找到');
    }
    
    res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline',
        'Access-Control-Allow-Origin': '*'
    });
    
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