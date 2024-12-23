// 等待确保 PDF.js 完全加载
(function checkPdfJsLoaded() {
    if (typeof pdfjsLib === 'undefined') {
        setTimeout(checkPdfJsLoaded, 100);
        return;
    }

    // PDF.js 加载完成后的初始化代码
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    let pdfDoc = null;
    let currentPage = 1;
    let pageRendering = false;
    let pageNumPending = null;
    let scale = 1;
    let touchStartX = null;
    
    // 搜索相关变量
    let searchText = '';
    let searchMatches = [];
    let currentMatch = -1;
    
    // 文本层相关变量
    let textContent = null;
    let textLayer = null;

    // 在文件开头添加变量声明
    let searchTimeout;

    // 添加预加载和缓存机制
    let pageCache = new Map();
    let preloadQueue = [];
    let isPreloading = false;

    // 添加加载状态指示
    function showLoading() {
        const canvas = document.getElementById('pdf-render');
        canvas.style.opacity = '0.5';
    }

    function hideLoading() {
        const canvas = document.getElementById('pdf-render');
        canvas.style.opacity = '1';
    }

    // 加载PDF文件
    async function loadPDF() {
        try {
            // 检测是否为移动设备
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            
            const loadingTask = pdfjsLib.getDocument({
                url: '/poetry.pdf',
                rangeChunkSize: isMobile ? 32768 : 65536,
                disableAutoFetch: true,
                disableStream: false,
                cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdfjs-dist/3.11.174/cmaps/',
                cMapPacked: true
            });

            // 显示文档加载进度
            loadingTask.onProgress = function(progress) {
                const percent = (progress.loaded / progress.total * 100).toFixed(0);
                document.querySelector('.loading-text').textContent = 
                    `PDF加载中...${percent}%`;
            };

            pdfDoc = await loadingTask.promise;
            document.getElementById('page-count').textContent = pdfDoc.numPages;
            
            // 初始化页码跳转功能
            initPageJump();
            
            // 先渲染第一页并隐藏加载提示
            await renderPage(currentPage);
            hideLoadingOverlay();
            
            // 后台静默加载目录
            setTimeout(async () => {
                try {
                    const specialOutline = await generateSpecialCharacterOutline();
                    if (specialOutline.length > 0) {
                        renderOutline(specialOutline);
                    }
                } catch (error) {
                    console.error('Error generating outline:', error);
                }
            }, 100);

        } catch (error) {
            console.error('Error loading PDF:', error);
            document.querySelector('.loading-text').textContent = 
                `加载失败：${error.message || '未知错误'}\n请刷新页面重试`;
        }
    }

    // 添加隐藏加载提示的函数
    function hideLoadingOverlay() {
        const loadingOverlay = document.querySelector('.loading-overlay');
        loadingOverlay.style.opacity = '0';
        setTimeout(() => {
            loadingOverlay.style.display = 'none';
        }, 300);
    }

    // 修改渲染页面函数
    async function renderPage(pageNumber, preload = false) {
        if (!preload) showLoading();
        try {
            if (!pdfDoc) return;
            
            if (pageRendering && !preload) {
                pageNumPending = pageNumber;
                return;
            }
            
            // 检查缓存
            if (pageCache.has(pageNumber)) {
                const cached = pageCache.get(pageNumber);
                updateDisplay(cached);
                return;
            }
            
            if (!preload) pageRendering = true;
            
            try {
                const page = await pdfDoc.getPage(pageNumber);
                const viewport = page.getViewport({ scale: 1.0 });
                
                // 获取设备像素比
                const pixelRatio = window.devicePixelRatio || 1;
                
                // 获取容器尺寸
                const containerWidth = document.getElementById('pdf-container').clientWidth;
                const containerHeight = window.innerHeight - 60;
                
                // 计算基础缩放比例
                const baseScale = Math.min(
                    (containerWidth * 0.9) / viewport.width,
                    (containerHeight * 0.9) / viewport.height
                );
                
                // 应用设备像素比以提高清晰度
                scale = baseScale * pixelRatio;
                
                const scaledViewport = page.getViewport({ scale });
                
                // 创建离屏canvas
                const offscreenCanvas = new OffscreenCanvas(
                    scaledViewport.width,
                    scaledViewport.height
                );
                const ctx = offscreenCanvas.getContext('2d', {
                    willReadFrequently: true,
                    alpha: false
                });
                
                const renderContext = {
                    canvasContext: ctx,
                    viewport: scaledViewport,
                    enableWebGL: true,
                    renderInteractiveForms: false
                };
                
                // 设置渲染质量
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                
                // 并行处理页面渲染和文本内容
                const [renderResult, textContent] = await Promise.all([
                    page.render(renderContext).promise,
                    page.getTextContent()
                ]);
                
                // 缓存渲染结果
                pageCache.set(pageNumber, {
                    canvas: offscreenCanvas,
                    textContent,
                    viewport: scaledViewport
                });
                
                if (!preload) {
                    updateDisplay(pageCache.get(pageNumber));
                    pageRendering = false;
                    
                    if (pageNumPending !== null) {
                        renderPage(pageNumPending);
                        pageNumPending = null;
                    }
                }
                
                // 预加载下一页
                if (!preload) preloadNextPages(pageNumber);
            } catch (error) {
                console.error('Error rendering page:', error);
                if (!preload) pageRendering = false;
            }
        } finally {
            if (!preload) hideLoading();
        }
    }

    // 更新显示
    function updateDisplay(cached) {
        const canvas = document.getElementById('pdf-render');
        const ctx = canvas.getContext('2d', {
            willReadFrequently: true,
            alpha: false
        });
        
        // 考虑设备像素比
        const pixelRatio = window.devicePixelRatio || 1;
        canvas.style.width = `${cached.canvas.width / pixelRatio}px`;
        canvas.style.height = `${cached.canvas.height / pixelRatio}px`;
        canvas.width = cached.canvas.width;
        canvas.height = cached.canvas.height;
        
        // 设置渲染质量
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        ctx.drawImage(cached.canvas, 0, 0);
        
        // 更新文本层
        const textLayer = document.getElementById('text-layer');
        textLayer.style.width = `${canvas.width}px`;
        textLayer.style.height = `${canvas.height}px`;
        // 设置缩放因子
        textLayer.style.setProperty('--scale-factor', scale);
        textLayer.innerHTML = '';
        
        pdfjsLib.renderTextLayer({
            textContent: cached.textContent,
            container: textLayer,
            viewport: cached.viewport,
            textDivs: [],
            enhanceTextSelection: true
        });
        
        document.getElementById('page-num').textContent = currentPage;
    }

    // 修改缓存管理
    function manageCache() {
        const maxCacheSize = 3; // 减少缓存数量节省内存
        if (pageCache.size > maxCacheSize) {
            const keysToDelete = Array.from(pageCache.keys())
                .filter(key => Math.abs(key - currentPage) > 1)
                .sort((a, b) => Math.abs(b - currentPage) - Math.abs(a - currentPage))
                .slice(0, pageCache.size - maxCacheSize);
            
            keysToDelete.forEach(key => pageCache.delete(key));
        }
    }

    // 修改预加载逻辑
    async function preloadNextPages(currentPageNum) {
        // 只预加载下一页
        const nextPage = currentPageNum + 1;
        if (nextPage <= pdfDoc.numPages && !pageCache.has(nextPage)) {
            preloadQueue.push(nextPage);
        }
        
        if (!isPreloading) processPreloadQueue();
    }

    async function processPreloadQueue() {
        if (preloadQueue.length === 0 || isPreloading) return;
        
        isPreloading = true;
        while (preloadQueue.length > 0) {
            const pageNum = preloadQueue.shift();
            await renderPage(pageNum, true);
        }
        isPreloading = false;
    }

    // 翻页函数
    function goToPage(direction) {
        if ((direction === 'prev' && currentPage <= 1) || 
            (direction === 'next' && currentPage >= pdfDoc.numPages)) {
            return;
        }
        
        const canvas = document.getElementById('pdf-render');
        canvas.style.opacity = '0';
        
        setTimeout(() => {
            if (direction === 'prev') {
                currentPage--;
            } else {
                currentPage++;
            }
            renderPage(currentPage);
            canvas.style.opacity = '1';
        }, 150);
    }

    // 触摸事件处理
    const canvas = document.getElementById('pdf-render');
    canvas.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        e.preventDefault();
    });

    canvas.addEventListener('touchend', (e) => {
        if (!touchStartX) return;
        
        const touchEndX = e.changedTouches[0].clientX;
        const diff = touchStartX - touchEndX;
        
        if (Math.abs(diff) > 50) {
            if (diff > 0) {
                goToPage('next');
            } else {
                goToPage('prev');
            }
        }
        touchStartX = null;
    });

    // 鼠标点击区域处理
    canvas.addEventListener('click', (e) => {
        const clickX = e.offsetX;
        const canvasWidth = canvas.width;
        
        if (clickX < canvasWidth * 0.3) {
            goToPage('prev');
        } else if (clickX > canvasWidth * 0.7) {
            goToPage('next');
        }
    });

    // 键盘事件处理
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') {
            goToPage('prev');
        } else if (e.key === 'ArrowRight') {
            goToPage('next');
        }
    });

    // 窗口大小改变处理
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            renderPage(currentPage);
        }, 100);
    });

    // 修改搜索函数，优化结果显示
    async function searchInPage(pageNumber) {
        const page = await pdfDoc.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(item => item.str).join(' ');
        const searchRegex = new RegExp(searchText, 'gi');
        const matches = [...text.matchAll(searchRegex)];
        
        // 如果有多个匹配，只返回第一个
        if (matches.length > 0) {
            const match = matches[0];
            return [{
                pageNum: pageNumber,
                text: text.substring(Math.max(0, match.index - 20), match.index + searchText.length + 20),
                index: match.index
            }];
        }
        
        return [];
    }

    async function findAllMatches() {
        if (!searchText || searchText.length < 2) return;
        
        searchMatches = [];
        const searchList = document.getElementById('searchList');
        const matchCount = document.getElementById('matchCount');
        if (!searchList) return;
        
        // 清空搜索列表
        searchList.innerHTML = '';
        
        // 显示搜索中提示
        matchCount.textContent = '搜索中...';
        
        try {
            // 使用 Map 来去重，key 为页码，value 为该页第一个匹配结果
            const pageResults = new Map();
            
            // 从第16页搜索
            for (let i = 16; i <= pdfDoc.numPages; i++) {
                const page = await pdfDoc.getPage(i);
                const textContent = await page.getTextContent();
                const text = textContent.items.map(item => item.str).join(' ');
                const searchRegex = new RegExp(searchText, 'gi');
                const match = searchRegex.exec(text); // 只获取第一个匹��
                
                if (match) {
                    // 每页只保留第一个匹配结果
                    if (!pageResults.has(i)) {
                        const context = text.substring(
                            Math.max(0, match.index - 20),
                            match.index + searchText.length + 20
                        );
                        
                        pageResults.set(i, {
                            pageNum: i,
                            text: context,
                            index: match.index
                        });
                    }
                }
            }
            
            // 将 Map 转换为数组并按页码排序
            searchMatches = Array.from(pageResults.values())
                .sort((a, b) => a.pageNum - b.pageNum);
            
            // 更新搜索结果数量
            matchCount.textContent = `找到 ${searchMatches.length} 个结果`;
            
            // 显示搜索结果列表
            searchMatches.forEach((match, index) => {
                const div = document.createElement('div');
                div.className = 'search-item';
                div.innerHTML = `
                    <span class="page">第${match.pageNum}页</span>
                    <span class="context">${highlightMatchText(match.text)}</span>
                `;
                div.addEventListener('click', () => {
                    currentMatch = index;
                    currentPage = match.pageNum;
                    renderPage(currentPage);
                    searchResults.classList.remove('show');
                });
                searchList.appendChild(div);
            });
            
            if (searchMatches.length > 0) {
                currentMatch = 0;
            }
        } catch (error) {
            console.error('Error in findAllMatches:', error);
            matchCount.textContent = '搜索出��';
        }
    }

    function highlightMatchText(text) {
        const searchRegex = new RegExp(`(${searchText})`, 'gi');
        return text.replace(searchRegex, '<mark>$1</mark>');
    }

    function goToSearchResult(index) {
        const match = searchMatches[index];
        if (match) {
            currentPage = match.pageNum;
            renderPage(currentPage);
            
            // 更新搜索结果列表中的活动
            const items = document.getElementsByClassName('search-item');
            Array.from(items).forEach((item, i) => {
                item.classList.toggle('active', i === index);
            });
        }
    }

    // 目录功能实现
    function renderOutline(outline) {
        const container = document.getElementById('outlineContainer');
        container.innerHTML = '';
        const ul = document.createElement('ul');
        
        outline.forEach(item => {
            const li = document.createElement('li');
            li.textContent = item.title;
            
            if (typeof item.dest === 'number') {
                li.addEventListener('click', () => {
                    // 更新当前
                    currentPage = item.dest;
                    // 渲染新页面
                    renderPage(currentPage);
                    // 更新页码显示
                    document.getElementById('page-num').textContent = currentPage;
                    // 添加激活状态
                    const allItems = container.getElementsByTagName('li');
                    Array.from(allItems).forEach(i => i.classList.remove('active'));
                    li.classList.add('active');
                    // 在移动自动关闭目录
                    if (window.innerWidth <= 768) {
                        container.classList.remove('show');
                    }
                });
            }
            
            if (item.items && item.items.length > 0) {
                const subUl = renderOutline(item.items);
                li.appendChild(subUl);
            }
            
            ul.appendChild(li);
        });
        
        container.appendChild(ul);
        return ul;
    }

    // 事件监听器
    document.getElementById('searchInput')?.addEventListener('input', (e) => {
        searchText = e.target.value;
        if (searchText.length >= 2) {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                findAllMatches().catch(console.error);
            }, 300);
        } else {
            const searchResults = document.querySelector('.search-results');
            if (searchResults) {
                searchResults.classList.remove('show');
            }
            searchMatches = [];
            currentMatch = -1;
            const matchCount = document.getElementById('matchCount');
            if (matchCount) {
                matchCount.textContent = '';
            }
        }
    });

    document.getElementById('prevMatch').addEventListener('click', () => {
        if (searchMatches.length > 0) {
            currentMatch = (currentMatch - 1 + searchMatches.length) % searchMatches.length;
            goToPage(searchMatches[currentMatch]);
        }
    });

    document.getElementById('nextMatch').addEventListener('click', () => {
        if (searchMatches.length > 0) {
            currentMatch = (currentMatch + 1) % searchMatches.length;
            goToPage(searchMatches[currentMatch]);
        }
    });

    document.getElementById('toggleOutline').addEventListener('click', () => {
        const container = document.getElementById('outlineContainer');
        container.classList.toggle('show');
    });

    // 文本选择功能
    document.getElementById('text-layer').addEventListener('mouseup', () => {
        const selection = window.getSelection();
        if (selection.toString().length > 0) {
            const range = selection.getRangeAt(0);
            const selectedElements = document.getElementsByClassName('selected');
            while (selectedElements.length > 0) {
                selectedElements[0].classList.remove('selected');
            }
            
            const container = document.getElementById('text-layer');
            const spans = container.getElementsByTagName('span');
            for (let span of spans) {
                if (range.intersectsNode(span)) {
                    span.classList.add('selected');
                }
            }
        }
    });

    // 修改特殊字符目录生成函数
    async function generateSpecialCharacterOutline() {
        // 仅包含指定的特殊字符
        const specialChars = ['⊙', '◎', '♡', '二〇'];
        // 添加特殊标题和年份标题
        const specialTitles = {
            41: ['二〇二一年'],
            78: ['二〇二〇年'],
            117: ['二〇一九年'],
            174: ['二〇一八年'],
            228: ['二〇一七年'],
            293: ['手记'],
            302: ['歌词'],
            306: [{ title: '浴室沉思', length: 8 }]
        };
        const outline = [];
        
        try {
            for (let i = 16; i <= pdfDoc.numPages; i++) {
                const page = await pdfDoc.getPage(i);
                const textContent = await page.getTextContent();
                const text = textContent.items.map(item => item.str).join('');
                
                // 处理特殊页码的标题
                if (specialTitles[i]) {
                    specialTitles[i].forEach(title => {
                        if (typeof title === 'object') {
                            outline.push({
                                title: title.title.substring(0, title.length),
                                dest: i,
                                items: []
                            });
                        } else {
                            outline.push({
                                title: title,
                                dest: i,
                                items: []
                            });
                        }
                    });
                }
                
                // 处理特殊字符标题
                for (const char of specialChars) {
                    let regex;
                    if (char === '二〇') {
                        if (specialTitles[i] && specialTitles[i].some(t => typeof t === 'string' && t.indexOf('二〇') === 0)) {
                            continue;
                        }
                        regex = new RegExp(`二〇[^。]*。`, 'g');
                    } else {
                        regex = new RegExp(`${char}[^${char}]+`, 'g');
                    }
                    
                    const matches = text.match(regex);
                    if (matches) {
                        matches.forEach(match => {
                            const cleanTitle = match.trim().replace(/\s+/g, ' ');
                            let title;
                            
                            if (char === '二〇') {
                                title = cleanTitle.substring(0, 5);
                            } else {
                                title = cleanTitle.substring(0, 12);
                                if (cleanTitle.length > 12) {
                                    title += '...';
                                }
                            }
                            
                            outline.push({
                                title: title,
                                dest: i,
                                items: []
                            });
                        });
                    }
                }
            }
            
            // 按页码排序
            outline.sort((a, b) => {
                if (a.dest === b.dest) {
                    return a.title.length - b.title.length;
                }
                return a.dest - b.dest;
            });
            
        } catch (error) {
            console.error('Error generating outline:', error);
        }
        
        return outline;
    }

    // 添加搜索框关闭按钮事件
    document.getElementById('closeSearch').addEventListener('click', () => {
        document.querySelector('.search-results').classList.remove('show');
        document.getElementById('searchInput').value = '';
        searchText = '';
        searchMatches = [];
        currentMatch = -1;
        document.getElementById('matchCount').textContent = '';
    });

    // 修改搜索按钮事件
    document.getElementById('searchBtn').addEventListener('click', () => {
        const searchInput = document.getElementById('searchInput');
        const searchResults = document.querySelector('.search-results');
        
        if (searchInput.value.length >= 2) {
            // 显示搜索框并始搜索
            searchResults.classList.add('show');
            findAllMatches().catch(error => {
                console.error('Search error:', error);
                document.getElementById('matchCount').textContent = '搜索出错';
            });
        }
    });

    // 修改搜索输入事件
    document.getElementById('searchInput').addEventListener('input', (e) => {
        searchText = e.target.value;
        if (searchText.length >= 2) {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                findAllMatches();
            }, 300);
        } else {
            // 当输入内容少于2个字符时，隐藏搜索结果但不清空
            document.querySelector('.search-results').classList.remove('show');
            document.getElementById('matchCount').textContent = '';
        }
    });

    // 添加目录项点击后的视觉反馈
    const outlineContainer = document.getElementById('outlineContainer');
    outlineContainer.addEventListener('click', (e) => {
        const items = outlineContainer.getElementsByTagName('li');
        Array.from(items).forEach(item => item.classList.remove('active'));
        
        if (e.target.tagName === 'LI') {
            e.target.classList.add('active');
        }
    });

    // 优化搜索触发逻辑
    document.getElementById('searchInput').addEventListener('input', (e) => {
        searchText = e.target.value;
        if (searchText.length >= 2) {
            // 添加延迟，避免频繁搜索
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                findAllMatches();
            }, 300);
        } else {
            document.querySelector('.search-results').classList.remove('show');
            searchMatches = [];
            currentMatch = -1;
            document.getElementById('matchCount').textContent = '';
        }
    });

    // 优化页面渲染性能
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // 应用防抖
    const debouncedRenderPage = debounce(renderPage, 100);
    window.addEventListener('resize', () => {
        debouncedRenderPage(currentPage);
    });

    // 添加错误处理
    window.addEventListener('error', function(e) {
        console.error('Global error:', e.error);
    });

    // 添加加载态检查
    function checkPdfLoaded() {
        return pdfDoc !== null;
    }

    // 添加页码跳转功能
    function initPageJump() {
        const pageInfo = document.querySelector('.page-info');
        pageInfo.addEventListener('click', () => {
            // 创建输入框
            const input = document.createElement('input');
            input.type = 'number';
            input.min = '1';
            input.max = pdfDoc.numPages;
            input.value = currentPage;
            input.className = 'page-jump-input';
            
            // 替换原有内容
            const originalContent = pageInfo.innerHTML;
            pageInfo.innerHTML = '';
            pageInfo.appendChild(input);
            input.focus();
            input.select();
            
            // 处理输入完成
            function handleJump() {
                const newPage = parseInt(input.value);
                if (!isNaN(newPage) && newPage >= 1 && newPage <= pdfDoc.numPages) {
                    currentPage = newPage;
                    renderPage(currentPage);
                }
                pageInfo.innerHTML = originalContent;
                document.getElementById('page-num').textContent = currentPage;
            }
            
            // 监听输入和失去焦点事件
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleJump();
                }
            });
            
            input.addEventListener('blur', handleJump);
        });
    }

    // 加载PDF
    loadPDF();
})();
