// 时间/状态格式化工具

export function formatTimestamp(ts: number | null | undefined): string {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleString();
}

export function formatRelative(ts: number | null | undefined, now: number = Date.now()): string {
  if (!ts) return '-';
  const diff = now - ts;
  const abs = Math.abs(diff);
  const sign = diff >= 0 ? '前' : '后';
  if (abs < 60_000) return `${Math.round(abs / 1000)} 秒${sign}`;
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)} 分${sign}`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)} 小时${sign}`;
  return `${Math.round(abs / 86_400_000)} 天${sign}`;
}

const STATUS_TAG: Record<string, { label: string; type: 'success' | 'warning' | 'error' | 'info' | 'default' }> = {
  active: { label: '可用', type: 'success' },
  checking: { label: '检查中', type: 'info' },
  remove_pending: { label: '待移除', type: 'warning' },
  registering: { label: '注册中', type: 'info' },
  failed_register: { label: '注册失败', type: 'error' },
};

export function statusTag(status: string): { label: string; type: 'success' | 'warning' | 'error' | 'info' | 'default' } {
  return STATUS_TAG[status] || { label: status, type: 'default' };
}
