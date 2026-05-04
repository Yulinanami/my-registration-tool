// API 客户端：所有调用都封装在这
import axios from 'axios';
import type { Account, Stats, LogsResponse, ConfigResponse, ConfigPayload } from './types';

const TOKEN_KEY = 'pool.authToken';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

const http = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

// 请求拦截：自动附带 token
http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截：401 时清 token + 跳登录页 (auth 相关接口由调用方自行处理)
http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      const url = error.config?.url || '';
      const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/me') || url.includes('/auth/logout');
      if (!isAuthEndpoint) {
        clearToken();
        if (window.location.pathname !== '/login') {
          const current = window.location.pathname + window.location.search;
          window.location.replace(`/login?redirect=${encodeURIComponent(current)}`);
        }
      }
    }
    return Promise.reject(error);
  }
);

export async function login(username: string, password: string): Promise<{ ok: boolean; token: string }> {
  const { data } = await http.post('/auth/login', { username, password });
  return data;
}

export async function logout(): Promise<void> {
  try {
    await http.post('/auth/logout');
  } catch (e) {
    // 即便后端调用失败，也清掉本地 token
  }
  clearToken();
}

export async function fetchMe(): Promise<{ ok: boolean; username: string; instanceId?: string }> {
  const { data } = await http.get('/auth/me');
  return data;
}

// 重启后轮询 /auth/me，等待 instanceId 改变 (= 旧进程已退、新进程已起)
// 仅看 "200 响应" 是不够的：旧进程在关停前会持续响应，会读到旧 config
export async function waitForServer(
  beforeInstanceId: string,
  timeoutMs = 60000,
  intervalMs = 1000
): Promise<'ready' | 'unauthorized' | 'timeout'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { data } = await http.get('/auth/me', { timeout: 3000 });
      const newId = data?.instanceId;
      if (newId && newId !== beforeInstanceId) return 'ready';
      // 同一个 instance ID = 旧进程还在跑，继续等
    } catch (e: any) {
      if (e?.response?.status === 401) {
        // 401 也带 instanceId，看是不是新进程
        const newId = e.response.data?.instanceId;
        if (newId && newId !== beforeInstanceId) return 'unauthorized';
        // 旧进程的 401 (不太可能，因为我们刚用同一 token 调过 PUT)，继续等
      }
      // 网络错误：服务在切换中，继续等
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return 'timeout';
}

export async function fetchStats(): Promise<Stats> {
  const { data } = await http.get<Stats>('/stats');
  return data;
}

export async function fetchAccounts(): Promise<Account[]> {
  const { data } = await http.get<{ accounts: Account[] }>('/accounts');
  return data.accounts;
}

export async function markAccountUsed(id: number): Promise<Account> {
  const { data } = await http.post<{ account: Account }>(`/accounts/${id}/used`);
  return data.account;
}

export async function deleteAccount(id: number): Promise<void> {
  await http.delete(`/accounts/${id}`);
}

export async function fetchLogs(lines = 200): Promise<LogsResponse> {
  const { data } = await http.get<LogsResponse>('/logs', { params: { lines } });
  return data;
}

export async function fetchConfig(): Promise<ConfigResponse> {
  const { data } = await http.get<ConfigResponse>('/config');
  return data;
}

export async function updateConfig(payload: ConfigPayload): Promise<{ ok: boolean; restarting: boolean; changedKeys: string[] }> {
  const { data } = await http.put('/config', payload);
  return data;
}

export async function triggerRound(): Promise<{ ok: boolean; accepted: boolean }> {
  const { data } = await http.post('/actions/round');
  return data;
}

export async function triggerReplenish(): Promise<{ ok: boolean; accepted: boolean }> {
  const { data } = await http.post('/actions/replenish');
  return data;
}
