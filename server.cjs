/**
 * AAGS Linux 生产服务器
 * 功能：托管前端静态文件 + API 反向代理
 * 用法：node server.cjs [--port 8080]
 * 守护进程：pm2 start server.cjs --name aags
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '8080');
const DIST_DIR = path.join(__dirname, 'dist');
const PKG_VERSION = require('./package.json').version;

// ==================== 代理路由配置（与 vite.config.ts 保持一致）====================
const PROXY_RULES = [
  { prefix: '/tgapi',                target: 'https://api.telegram.org' },
  { prefix: '/proxy/binance-futures', target: 'https://fapi.binance.com' },
  { prefix: '/proxy/binance',        target: 'https://api.binance.com' },
  { prefix: '/proxy/okx',            target: 'https://www.okx.com' },
  { prefix: '/proxy/bybit',          target: 'https://api.bybit.com' },
  { prefix: '/proxy/gate',           target: 'https://api.gateio.ws' },
  { prefix: '/proxy/bitget',         target: 'https://api.bitget.com' },
  { prefix: '/proxy/kucoin',         target: 'https://api.kucoin.com' },
  { prefix: '/proxy/huobi',          target: 'https://api.huobi.pro' },
  { prefix: '/proxy/mexc',           target: 'https://api.mexc.com' },
  { prefix: '/llmapi/deepseek',      target: 'https://api.deepseek.com' },
  { prefix: '/llmapi/openai',        target: 'https://api.openai.com' },
  { prefix: '/llmapi/anthropic',     target: 'https://api.anthropic.com' },
  { prefix: '/llmapi/perplexity',    target: 'https://api.perplexity.ai' },
  { prefix: '/llmapi/gemini',        target: 'https://generativelanguage.googleapis.com' },
  { prefix: '/dataapi/cryptocompare', target: 'https://min-api.cryptocompare.com' },
  { prefix: '/dataapi/coingecko',    target: 'https://api.coingecko.com' },
  { prefix: '/dataapi/alternative',  target: 'https://api.alternative.me' },
  { prefix: '/dataapi/defillama',    target: 'https://api.llama.fi' },
  { prefix: '/scanapi',              target: 'https://alphinel.com' },
];

// ==================== MIME 类型 ====================
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json',
};

// ==================== 反向代理 ====================
function proxyRequest(req, res, targetBase, stripPrefix) {
  const targetPath = req.url.replace(stripPrefix, '') || '/';
  const targetUrl = new URL(targetPath, targetBase);

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || 443,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: targetUrl.hostname,
    },
    timeout: 30000,
  };
  // 移除不该转发的 headers
  delete options.headers['origin'];
  delete options.headers['referer'];

  const proxyReq = https.request(options, (proxyRes) => {
    // 添加 CORS 头
    const responseHeaders = { ...proxyRes.headers };
    responseHeaders['access-control-allow-origin'] = '*';
    responseHeaders['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    responseHeaders['access-control-allow-headers'] = '*';

    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`[proxy] ${req.method} ${targetUrl.href} -> ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy timeout' }));
    }
  });

  req.pipe(proxyReq);
}

// ==================== 静态文件服务 ====================
function serveStatic(req, res) {
  const parsedUrl = url.parse(req.url);
  let pathname = parsedUrl.pathname;

  // 安全检查
  if (pathname.includes('..')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let filePath = path.join(DIST_DIR, pathname);

  // SPA fallback: 如果文件不存在且不是资源请求，返回 index.html
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    if (path.extname(pathname)) {
      // 有扩展名但文件不存在 -> 404
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    // SPA 路由 -> 返回 index.html
    filePath = path.join(DIST_DIR, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // 缓存策略：assets 目录长期缓存，其他不缓存
  const cacheControl = pathname.startsWith('/assets/')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';

  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': cacheControl,
  });
  fs.createReadStream(filePath).pipe(res);
}

// ==================== 主服务器 ====================
const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  // 版本接口
  if (req.url === '/api/version') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ version: PKG_VERSION }));
    return;
  }

  // 检查代理规则（注意：长前缀优先匹配，PROXY_RULES 已按长度排序）
  for (const rule of PROXY_RULES) {
    if (req.url.startsWith(rule.prefix)) {
      proxyRequest(req, res, rule.target, rule.prefix);
      return;
    }
  }

  // 静态文件
  serveStatic(req, res);
});

// 检查 dist 目录
if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.error('ERROR: dist/index.html not found. Run "pnpm build" first.');
  process.exit(1);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 AAGS server running at http://0.0.0.0:${PORT}`);
  console.log(`   Static files: ${DIST_DIR}`);
  console.log(`   Proxy rules:  ${PROXY_RULES.length} configured`);
  console.log(`   PID: ${process.pid}\n`);
});
