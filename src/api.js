// src/api.js

const DEFAULTS = {
  // 单次搜索最大返回条数 (防止数据库被拖垮)
  SEARCH_LIMIT: 200,

  // 验证码每 IP 最大尝试次数 (原 RATE_LIMIT_MAX)
  // 改名理由：避免被误解为"速度限制"，明确为"尝试次数限制"
  MAX_CAPTCHA_ATTEMPTS: 5,

  // 验证码冷却时间 (毫秒)，默认 10 分钟
  // ⭐ 设置为 -1 表示永久封禁
  CAPTCHA_COOLDOWN_MS: 10 * 60 * 1000
};
// 辅助函数：统一鉴权
function checkAuth(request, env) {
  const userKey = request.headers.get('Admin-Key');
  // 如果环境变量没设置，默认不通过
  if (!env.ADMIN_PASSWORD) return false;
  return userKey === env.ADMIN_PASSWORD;
}

// --- 辅助函数：生成 SHA-256 哈希 ---
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- 1. SVG 验证码生成器 (纯代码生成图片) ---
function generateMathSVG(text) {
  const width = 120;
  const height = 40;

  // 随机颜色
  const randomColor = () => `rgb(${Math.floor(Math.random() * 100)},${Math.floor(Math.random() * 100)},${Math.floor(Math.random() * 100)})`;
  // 随机线条
  let lines = '';
  for (let i = 0; i < 5; i++) {
    lines += `<line x1="${Math.random() * width}" y1="${Math.random() * height}" x2="${Math.random() * width}" y2="${Math.random() * height}" stroke="${randomColor()}" stroke-width="1" opacity="0.5"/>`;
  }
  // 随机噪点
  let dots = '';
  for (let i = 0; i < 20; i++) {
    dots += `<circle cx="${Math.random() * width}" cy="${Math.random() * height}" r="1" fill="${randomColor()}" opacity="0.6"/>`;
  }

  // 文字带随机旋转
  const rotation = (Math.random() * 10) - 5; // -5 到 5 度

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" style="background:#f1f5f9; border-radius:4px; cursor:pointer;">
        ${lines}
        ${dots}
        <text x="50%" y="65%" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#1e293b" text-anchor="middle" transform="rotate(${rotation}, 60, 20)">${text}</text>
    </svg>`;
}

// --- 2. 改进的限流系统 ---

// A. 仅检查是否被封禁 (用于获取验证码时)
async function isIpBanned(ip, env) {
  const maxAttempts = parseInt(env.MAX_CAPTCHA_ATTEMPTS) || DEFAULTS.MAX_CAPTCHA_ATTEMPTS;
  const cooldownMs = parseInt(env.CAPTCHA_COOLDOWN_MS) || DEFAULTS.CAPTCHA_COOLDOWN_MS;

  // 修改表名为 ip_limits
  const record = await env.DB.prepare('SELECT * FROM ip_limits WHERE ip = ?').bind(ip).first();

  if (record && record.count >= maxAttempts) {
    // ⭐ 新增：如果冷却时间是负数，直接视为永久封禁
    if (cooldownMs < 0) {
      return { banned: true, msg: `IP 已被永久封禁` };
    }

    // 常规冷却检查
    if (Date.now() - record.last_attempt < cooldownMs) {
      const waitMin = Math.ceil((cooldownMs - (Date.now() - record.last_attempt)) / 60000);
      return { banned: true, msg: `验证失败次数过多，请 ${waitMin} 分钟后再试` };
    }
  }
  return { banned: false };
}

// B. 记录尝试结果 (用于提交答案时)
async function recordAttempt(ip, isSuccess, env) {
  const now = Date.now();
  const cooldownMs = parseInt(env.CAPTCHA_COOLDOWN_MS) || DEFAULTS.CAPTCHA_COOLDOWN_MS;

  if (isSuccess) {
    await env.DB.prepare('DELETE FROM ip_limits WHERE ip = ?').bind(ip).run();
  } else {
    const record = await env.DB.prepare('SELECT * FROM ip_limits WHERE ip = ?').bind(ip).first();
    if (record) {
      // 逻辑修正：如果不是永久封禁且已过冷却期，重置为1
      const isExpired = (cooldownMs >= 0) && (now - record.last_attempt > cooldownMs);
      const newCount = isExpired ? 1 : record.count + 1;
      await env.DB.prepare('UPDATE ip_limits SET count = ?, last_attempt = ? WHERE ip = ?').bind(newCount, now, ip).run();
    } else {
      // 🟢 修复点：这里改为 VALUES (?, ?, ?) 以匹配 bind 中的 3 个参数
      await env.DB.prepare('INSERT INTO ip_limits (ip, count, last_attempt) VALUES (?, ?, ?)').bind(ip, 1, now).run();
    }
  }
}

// --- 3. 业务接口 ---

// 获取验证码 (支持四则运算 + SVG)
export async function getCaptcha(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';

  // 1. 检查是否被封禁 (刷新不计次，只看是否已封)
  const status = await isIpBanned(ip, env);
  if (status.banned) {
    return Response.json({ error: status.msg }, { status: 429 });
  }

  // 2. 生成四则运算
  const ops = ['+', '-', '*', '/'];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let a, b, answer;

  switch (op) {
    case '+': // a + b
      a = Math.floor(Math.random() * 20) + 1;
      b = Math.floor(Math.random() * 20) + 1;
      answer = a + b;
      break;
    case '-': // a - b (确保结果非负)
      a = Math.floor(Math.random() * 20) + 5;
      b = Math.floor(Math.random() * a);
      answer = a - b;
      break;
    case '*': // a * b (数字小一点，方便心算)
      a = Math.floor(Math.random() * 9) + 1;
      b = Math.floor(Math.random() * 9) + 1;
      answer = a * b;
      break;
    case '/': // a / b (确保能整除)
      b = Math.floor(Math.random() * 9) + 1;
      answer = Math.floor(Math.random() * 9) + 1;
      a = b * answer; // 反推 a
      break;
  }

  // 3. 生成 SVG 图片
  const questionText = `${a} ${op.replace('*', '×').replace('/', '÷')} ${b} = ?`;
  const svg = generateMathSVG(questionText);

  // 4. 生成 Token
  const secret = env.ADMIN_PASSWORD || 'secret-salt';
  const token = await sha256(answer.toString() + secret);

  return Response.json({
    svg: svg, // 返回 SVG 代码
    token: token
  });
}

// 1. 搜索逻辑 (已更新：支持 Note 备注查询)
export async function search(request, env) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';
  const page = parseInt(url.searchParams.get('page')) || 1;
  const mode = url.searchParams.get('mode') || 'fuzzy';
  const isExport = url.searchParams.get('export') === 'true';

  const DEFAULTS = { SEARCH_LIMIT: 50 };
  let limit = parseInt(url.searchParams.get('limit')) || 10;

  if (!isExport) {
    const maxLimit = parseInt(env.MAX_SEARCH_LIMIT) || DEFAULTS.SEARCH_LIMIT;
    if (limit > maxLimit) limit = maxLimit;
  } else {
    limit = -1;
  }

  const offset = isExport ? 0 : (page - 1) * limit;

  let sql, params, countSql, countParams;

  if (!q) {
    sql = `SELECT * FROM verbs ORDER BY base_word ASC LIMIT ? OFFSET ?`;
    params = [limit, offset];
    countSql = `SELECT count(*) as total FROM verbs`;
    countParams = [];
  } else {
    if (mode === 'exact') {
      sql = `SELECT * FROM verbs WHERE lower(base_word) = lower(?) ORDER BY base_word ASC LIMIT ? OFFSET ?`;
      params = [q, limit, offset];
      countSql = `SELECT count(*) as total FROM verbs WHERE lower(base_word) = lower(?)`;
      countParams = [q];
    } else {
      // ⭐ 修改点：增加 OR present_participle LIKE ?
      sql = `SELECT * FROM verbs WHERE base_word LIKE ? OR definition LIKE ? OR note LIKE ? OR present_participle LIKE ? ORDER BY base_word ASC LIMIT ? OFFSET ?`;
      const pattern = `%${q}%`;
      // 参数也要对应增加一个 pattern (现在是 4 个匹配项)
      params = [pattern, pattern, pattern, pattern, limit, offset];
      countSql = `SELECT count(*) as total FROM verbs WHERE base_word LIKE ? OR definition LIKE ? OR note LIKE ? OR present_participle LIKE ?`;
      countParams = [pattern, pattern, pattern, pattern];
    }
  }

  const [dataRes, countRes] = await Promise.all([
    env.DB.prepare(sql).bind(...params).all(),
    env.DB.prepare(countSql).bind(...countParams).first()
  ]);

  return Response.json({
    data: dataRes.results,
    total: countRes.total,
    page, limit
  });
}

// 2. 验证密码
export async function verify(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
  const body = await request.json();
  const { password, captcha_ans, captcha_token } = body;

  // 1. 检查 IP 封禁
  const status = await isIpBanned(ip, env);
  if (status.banned) return Response.json({ error: status.msg }, { status: 429 });

  // 2. 验证 Captcha (必须传)
  if (!captcha_ans || !captcha_token) {
    return Response.json({ error: '请输入验证码' }, { status: 400 });
  }

  const secret = env.ADMIN_PASSWORD || 'secret-salt';
  const expectedToken = await sha256(captcha_ans + secret);

  if (captcha_token !== expectedToken) {
    await recordAttempt(ip, false, env); // 记过
    return Response.json({ error: '验证码错误' }, { status: 403 });
  }

  // 3. 验证密码
  if (password === env.ADMIN_PASSWORD) {
    await recordAttempt(ip, true, env); // 成功，清除记录
    return Response.json({ success: true });
  }

  // 密码错也算一次失败
  await recordAttempt(ip, false, env);
  return Response.json({ success: false }, { status: 401 });
}

// 3. 批量添加/单条添加/修改
// src/api.js 中的 batchAdd 函数替换版

export async function batchAdd(request, env) {
  if (!checkAuth(request, env)) return new Response('Unauthorized', { status: 401 });

  const body = await request.json();
  const rows = body.rows;
  const mode = body.mode || 'skip'; // 'skip' (跳过) 或 'update' (覆盖)

  if (!rows || rows.length === 0) return Response.json({ success: true, count: 0 });

  const statements = [];

  for (const item of rows) {
    if (!item.base) continue;

    // 核心优化：不再先查后删，而是直接构造 SQL
    // 利用第一步创建的唯一索引 (idx_verbs_unique)

    let sql;
    if (mode === 'update') {
      // ⭐ 修改点：增加 present_participle
      sql = `INSERT OR REPLACE INTO verbs (base_word, past_tense, past_participle, present_participle, definition, note) VALUES (?, ?, ?, ?, ?, ?)`;
    } else {
      sql = `INSERT OR IGNORE INTO verbs (base_word, past_tense, past_participle, present_participle, definition, note) VALUES (?, ?, ?, ?, ?, ?)`;
    }

    statements.push(
      // ⭐ 修改点：绑定 item.present
      env.DB.prepare(sql).bind(item.base, item.past, item.part, item.present, item.def, item.note)
    );
  }

  try {
    // D1 核心大招：batch()
    // 这会将 130 条 SQL 语句打包成 1 次网络请求发给数据库
    // 速度提升 100 倍的关键在这里
    const results = await env.DB.batch(statements);

    // 计算成功插入的数量 (results 是一个数组)
    // 注意：REPLACE 可能会返回受影响行数，这里简单返回总处理数即可
    return Response.json({ success: true, added: results.length });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// 4. 更新单条
export async function update(request, env) {
  if (!checkAuth(request, env)) return new Response('Unauthorized', { status: 401 });
  const data = await request.json();
  // ⭐ 修改点：增加 present_participle=?
  await env.DB.prepare(
    'UPDATE verbs SET base_word=?, past_tense=?, past_participle=?, present_participle=?, definition=?, note=? WHERE id=?'
  ).bind(data.base, data.past, data.part, data.present, data.def, data.note, data.id).run();
  return Response.json({ success: true });
}

// 5. 删除单条
export async function deleteItem(request, env) {
  if (!checkAuth(request, env)) return new Response('Unauthorized', { status: 401 });
  const { id } = await request.json();
  await env.DB.prepare('DELETE FROM verbs WHERE id = ?').bind(id).run();
  return Response.json({ success: true });
}

// 6. 批量删除
export async function batchDelete(request, env) {
  if (!checkAuth(request, env)) return new Response('Unauthorized', { status: 401 });
  const { ids } = await request.json();
  const placeholders = ids.map(() => '?').join(', ');
  await env.DB.prepare(`DELETE FROM verbs WHERE id IN (${placeholders})`).bind(...ids).run();
  return Response.json({ success: true });
}

// 7. 导出数据 (已更新：简单数学验证)
export async function exportData(request, env) {
  const url = new URL(request.url);
  const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';

  // ... (鉴权部分) ...
  const adminKey = request.headers.get('Admin-Key') || url.searchParams.get('adminKey');
  const isAdmin = adminKey === env.ADMIN_PASSWORD;

  if (!isAdmin) {
    // 先检查是否已被封禁
    const status = await isIpBanned(ip, env);
    if (status.banned) return new Response(status.msg, { status: 429 });

    const userAns = url.searchParams.get('captcha_ans');
    const token = url.searchParams.get('captcha_token');

    if (!userAns || !token) return new Response('Verification required', { status: 403 });

    // 验证哈希
    const secret = env.ADMIN_PASSWORD || 'secret-salt';
    const expectedToken = await sha256(userAns + secret);

    if (token !== expectedToken) {
      // ❌ 验证失败：记录一次错误
      await recordAttempt(ip, false, env);
      return new Response('验证码错误，请重试', { status: 403 });
    } else {
      // ✅ 验证成功：清空该 IP 的错误记录
      await recordAttempt(ip, true, env);
    }
  }

  const q = url.searchParams.get('q') || '';
  const mode = url.searchParams.get('mode') || 'fuzzy';
  const delim = url.searchParams.get('delim') || ',';

  let sql, params;

  if (!q) {
    sql = `SELECT * FROM verbs ORDER BY base_word ASC`;
    params = [];
  } else {
    if (mode === 'exact') {
      sql = `SELECT * FROM verbs WHERE lower(base_word) = lower(?) ORDER BY base_word ASC`;
      params = [q];
    } else {
      // ⭐ 修改点：增加 OR present_participle LIKE ?
      sql = `SELECT * FROM verbs WHERE base_word LIKE ? OR definition LIKE ? OR note LIKE ? OR present_participle LIKE ? ORDER BY base_word ASC`;
      const pattern = `%${q}%`;
      params = [pattern, pattern, pattern, pattern];
    }
  }

  const { results } = await env.DB.prepare(sql).bind(...params).all();
  // ⭐ 修改点：在 map 中加入 item.present_participle
  const rows = results.map(item => [
    item.base_word || '',
    item.past_tense || '',
    item.past_participle || '',
    item.present_participle || '', // 新增这一列
    item.definition || '',
    item.note || ''
  ].join(delim));
  const csvContent = '\uFEFF' + rows.join('\n');

  return new Response(csvContent, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="verbs.csv"' }
  });
}

// 8. 获取全局配置 (暴露给前端)
export async function getConfig(request, env) {
  // 🛡️ 全能解析函数：兼容 数组对象、JSON字符串、逗号分隔字符串
  const parseArray = (input, def) => {
    // 1. 【新增】如果已经是数组 (Cloudflare 后台选了 JSON 类型)，直接返回
    if (Array.isArray(input)) return input;

    // 2. 如果为空或是其他非字符串类型，返回默认值
    if (!input || typeof input !== 'string') return def;

    try {
      // 3. 尝试标准 JSON 解析 (处理 "[5, 10, 20]")
      return JSON.parse(input);
    } catch (e) {
      // 4. 容错解析 (处理 "5, 10, 20" 或 "[5,10,20]")
      try {
        // 去掉首尾可能的方括号
        const cleaned = input.replace(/^\[|\]$/g, '');
        if (!cleaned.trim()) return def;

        // 分割并转数字
        const arr = cleaned.split(',').map(s => {
          const num = parseInt(s.trim());
          return isNaN(num) ? null : num;
        }).filter(n => n !== null);

        return arr.length > 0 ? arr : def;
      } catch (err2) {
        return def;
      }
    }
  };

  return Response.json({
    // 优先读取环境变量
    BATCH_SIZE: env.BATCH_SIZE ? parseInt(env.BATCH_SIZE) : undefined,

    MOBILE_PAGE_SIZE: env.MOBILE_PAGE_SIZE ? parseInt(env.MOBILE_PAGE_SIZE) : undefined,
    // 这里现在可以完美处理 Cloudflare 后台的 "JSON" 类型变量了
    MOBILE_OPTIONS: parseArray(env.MOBILE_OPTIONS, undefined),

    PC_PAGE_SIZE: env.PC_PAGE_SIZE ? parseInt(env.PC_PAGE_SIZE) : undefined,
    PC_OPTIONS: parseArray(env.PC_OPTIONS, undefined),
  });
}