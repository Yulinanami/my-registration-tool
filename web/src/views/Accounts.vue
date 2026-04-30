<script setup lang="ts">
import { h, onMounted, ref } from 'vue';
import {
  NCard,
  NDataTable,
  NButton,
  NTag,
  NPopconfirm,
  NSpace,
  useMessage,
} from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { fetchAccounts, deleteAccount } from '@/api/client';
import type { Account } from '@/api/types';
import { formatTimestamp, statusTag } from '@/utils/format';

const message = useMessage();
const accounts = ref<Account[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    accounts.value = await fetchAccounts();
  } catch (e: unknown) {
    const err = e as { message?: string };
    message.error(`加载失败: ${err.message ?? '未知错误'}`);
  } finally {
    loading.value = false;
  }
}

async function onDelete(id: number) {
  try {
    await deleteAccount(id);
    message.success(`已删除账号 id=${id}`);
    await load();
  } catch (e: unknown) {
    const err = e as { response?: { data?: { error?: string } } };
    message.error(`删除失败: ${err.response?.data?.error ?? '未知错误'}`);
  }
}

const columns: DataTableColumns<Account> = [
  { title: 'ID', key: 'id', width: 70 },
  { title: '邮箱', key: 'email', minWidth: 240, ellipsis: { tooltip: true } },
  { title: '密码', key: 'password', width: 140, ellipsis: { tooltip: true } },
  {
    title: '状态',
    key: 'status',
    width: 110,
    render(row) {
      const tag = statusTag(row.status);
      return h(NTag, { type: tag.type, size: 'small' }, { default: () => tag.label });
    },
  },
  {
    title: '创建时间',
    key: 'createdAt',
    width: 170,
    render: (row) => formatTimestamp(row.createdAt),
  },
  {
    title: '上次检查',
    key: 'lastCheckedAt',
    width: 170,
    render: (row) => formatTimestamp(row.lastCheckedAt),
  },
  {
    title: '上次成功',
    key: 'lastSuccessAt',
    width: 170,
    render: (row) => formatTimestamp(row.lastSuccessAt),
  },
  { title: '检查次数', key: 'checkCount', width: 100 },
  { title: '失败原因', key: 'failReason', width: 160, ellipsis: { tooltip: true } },
  {
    title: '操作',
    key: 'actions',
    width: 100,
    fixed: 'right',
    render(row) {
      return h(
        NPopconfirm,
        {
          onPositiveClick: () => onDelete(row.id),
        },
        {
          trigger: () => h(NButton, { type: 'error', size: 'small', tertiary: true }, { default: () => '删除' }),
          default: () => `确认删除账号 ${row.email}？`,
        }
      );
    },
  },
];

onMounted(load);
</script>

<template>
  <n-card>
    <n-space justify="space-between" style="margin-bottom: 12px;">
      <span>共 {{ accounts.length }} 个账号</span>
      <n-button :loading="loading" @click="load">刷新</n-button>
    </n-space>
    <n-data-table
      :columns="columns"
      :data="accounts"
      :loading="loading"
      :scroll-x="1500"
      size="small"
      :row-key="(row: Account) => row.id"
    />
  </n-card>
</template>
