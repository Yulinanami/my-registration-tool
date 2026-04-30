// API 客户端：所有调用都封装在这
import axios from 'axios';
import type { Account, Stats, LogsResponse, ConfigResponse, ConfigPayload } from './types';

const http = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

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
