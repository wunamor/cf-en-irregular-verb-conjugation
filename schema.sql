-- 如果你想彻底重置数据库（注意：这会删除所有数据！），请取消下一行的注释
DROP TABLE IF EXISTS verbs;

-- 创建动词表 (已添加 present_participle)
CREATE TABLE IF NOT EXISTS verbs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_word TEXT NOT NULL,
  past_tense TEXT NOT NULL,
  past_participle TEXT NOT NULL,
  present_participle TEXT,  -- 🌟 新增：现在分词字段
  definition TEXT,
  note TEXT
);

-- 创建唯一索引，如果 base_word 和 past_tense 相同，则视为同一条数据
CREATE UNIQUE INDEX IF NOT EXISTS idx_verbs_unique ON verbs(base_word, past_tense);

-- 初始化测试数据 (可选，测试时可以取消注释)
-- INSERT INTO verbs (base_word, past_tense, past_participle, present_participle, definition, note) VALUES 
-- ('lie', 'lay', 'lain', 'lying', '躺; 位于', '不规则'),
-- ('lie', 'lied', 'lied', 'lying', '撒谎', '规则');

-- 创建限流表：记录 IP、尝试次数、最后尝试时间戳
-- (这个表结构不需要变，但保留在这里以保持文件完整性)
CREATE TABLE IF NOT EXISTS ip_limits (
    ip TEXT PRIMARY KEY,
    count INTEGER DEFAULT 0,
    last_attempt INTEGER
);