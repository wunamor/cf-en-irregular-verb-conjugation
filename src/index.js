import * as api from './api.js';

// ==========================================
// 🗺️ 路由配置表 (Key-Value 映射)
// ==========================================
const routes = {
  GET: {
    '/api/search': api.search,
    '/api/config': api.getConfig,
    '/api/export': api.exportData,
  },
  POST: {
    '/api/verify': api.verify,
    '/api/batch_add': api.batchAdd,
    '/api/update': api.update,
    '/api/delete': api.deleteItem,      // 注意：这里映射的是 deleteItem
    '/api/batch_delete': api.batchDelete,
  }
};

// ==========================================
// 🚀 主入口
// ==========================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- 1. API 路由处理 (后端逻辑) ---
    if (path.startsWith('/api/')) {
      try {
        const method = request.method;
        
        // 核心优化：直接通过 对象[方法][路径] 查找函数
        // 使用可选链 ?. 防止 method 不存在导致报错
        const handler = routes[method]?.[path];

        if (handler) {
          return await handler(request, env);
        }
        
        // 如果在路由表中找不到对应路径
        return new Response('API Not Found', { status: 404 });

      } catch (err) {
        // 捕获所有 API 内部错误
        return new Response(JSON.stringify({ error: err.message }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // --- 2. 静态资源路由 (前端页面) ---
    // 只有非 API 请求才会走到这里 (返回 HTML/JS/CSS)
    return env.EN_VERB_EN_VERB_ASSETS.fetch(request);
  },
};