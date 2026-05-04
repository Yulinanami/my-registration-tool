// 后端 API 返回的数据结构

export interface Account {
  id: number;
  email: string;
  password: string;
  status: string;
  createdAt: number;
  lastCheckedAt: number | null;
  lastSuccessAt: number | null;
  usedAt: number | null;
  failReason: string | null;
  checkCount: number;
  registerAttempt: number | null;
}

export interface RoundStats {
  checked?: number;
  kept?: number;
  marked?: number;
  removed?: number;
  added?: number;
  attempts?: number;
  error?: string;
}

export interface Stats {
  target: number;
  activeCount: number;
  totalCount: number;
  checkIntervalMinutes: number;
  startedAt: number | null;
  lastRoundStartedAt: number | null;
  lastRoundEndedAt: number | null;
  lastRoundStats: RoundStats | null;
  nextRoundAt: number | null;
  roundInProgress: boolean;
  now: number;
}

export interface LogsResponse {
  lines: string[];
  path: string;
  total?: number;
}

export type ConfigValue = string | number | boolean | { [k: string]: ConfigValue };

export interface ConfigPayload {
  [key: string]: ConfigValue;
}

export interface ConfigResponse {
  config: ConfigPayload;
  path: string;
}
