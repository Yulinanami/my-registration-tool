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

// 响应拦截：401 时清 token + 跳登录页
http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      clearToken();
      // 避免在登录接口本身的 401 上重复跳转
      if (!error.config?.url?.includes('/auth/login')) {
        const current = window.location.pathname + window.location.search;
        if (window.location.pathname !== '/login') {
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

export async function fetchMe(): Promise<{ ok: boolean; username: string }> {
  const { data } = await http.get('/auth/me');
  return data;
}

export async function fetchStats(): Promise<Stats> {
  const { data } = await http.get<Stats>('/stats');
  return data;
}

export async function fetchAccounts(): Promise<Account[]> {
  const { data } = await http.get<{ accounts: Account[] }>('/accounts');
  return data.accounts;
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

export async function updateConfig(payload: ConfigPayload): Promise<{ ok: boolean; updated: ConfigPayload; restartRequired: boolean }> {
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
