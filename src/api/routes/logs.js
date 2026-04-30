// GET /api/logs?lines=N — tail run.log
const express = require('express');
const fs = require('fs');
const path = require('path');

const DEFAULT_LINES = 200;
const MAX_LINES = 2000;

function logsRouter({ projectRoot }) {
  const router = express.Router();
  const logPath = path.join(projectRoot, 'results', 'run.log');

  router.get('/', (req, res) => {
    const requested = parseInt(req.query.lines, 10);
    const lines = Math.min(
      Math.max(Number.isNaN(requested) ? DEFAULT_LINES : requested, 1),
      MAX_LINES
    );

    if (!fs.existsSync(logPath)) {
      return res.json({ lines: [], path: logPath });
    }

    // 读最后 N 行：先读全部再切尾，对 < 几 MB 的日志足够
    try {
      const content = fs.readFileSync(logPath, 'utf-8');
      const allLines = content.split(/\r?\n/);
      const tail = allLines.slice(-lines - 1).filter((l) => l.length > 0);
      res.json({ lines: tail, path: logPath, total: allLines.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { logsRouter };
