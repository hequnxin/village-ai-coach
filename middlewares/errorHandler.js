function errorHandler(err, req, res, next) {
  console.error('错误详情:', err.stack);
  if (err.status === 401) {
    return res.status(401).json({ error: '认证失败，请重新登录' });
  }
  if (err.code === 'SQLITE_CONSTRAINT') {
    return res.status(400).json({ error: '数据约束冲突，请检查输入' });
  }
  if (err.message.includes('API')) {
    return res.status(503).json({ error: 'AI服务暂时不可用，请稍后重试' });
  }
  res.status(500).json({ error: '服务器内部错误，请稍后重试' });
}

module.exports = errorHandler;