<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  NCard,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSwitch,
  NButton,
  NSpace,
  NAlert,
  NGrid,
  NGridItem,
  useMessage,
} from 'naive-ui';
import { fetchConfig, updateConfig } from '@/api/client';
import type { ConfigPayload } from '@/api/types';

const message = useMessage();
const config = ref<ConfigPayload>({});
const original = ref<ConfigPayload>({});
const loading = ref(false);
const saving = ref(false);
const restartTip = ref(false);

// 字段分组：核心 / 浏览器 / 邮件 / 注册策略 / 其它
type FieldKind = 'string' | 'number' | 'boolean';
interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  group: string;
}

const FIELDS: FieldDef[] = [
  { key: 'targetAccounts', label: '目标账号数', kind: 'number', group: '核心' },
  { key: 'checkIntervalMinutes', label: '检查间隔 (分钟)', kind: 'number', group: '核心' },
  { key: 'replenishDelayMs', label: '补齐间隔 (ms)', kind: 'number', group: '核心' },
  { key: 'password', label: '注册密码', kind: 'string', group: '核心' },

  { key: 'apiHost', label: 'API 监听地址', kind: 'string', group: 'API/锁' },
  { key: 'apiPort', label: 'API 端口', kind: 'number', group: 'API/锁' },
  { key: 'accountStorePath', label: 'SQLite 路径', kind: 'string', group: 'API/锁' },
  { key: 'lockFilePath', label: '锁文件路径', kind: 'string', group: 'API/锁' },

  { key: 'headless', label: '无头模式', kind: 'boolean', group: '浏览器' },
  { key: 'chromiumPath', label: 'Chromium 路径', kind: 'string', group: '浏览器' },

  { key: 'mailPollIntervalMs', label: '邮件轮询间隔 (ms)', kind: 'number', group: '邮件' },
  { key: 'mailPollTimeoutMs', label: '邮件等待超时 (ms)', kind: 'number', group: '邮件' },
  { key: 'mailPageTimeoutMs', label: '邮箱页超时 (ms)', kind: 'number', group: '邮件' },

  { key: 'maxRetries', label: '单次最大重试', kind: 'number', group: '注册策略' },
  { key: 'retryDelayMin', label: '重试间隔最小 (ms)', kind: 'number', group: '注册策略' },
  { key: 'retryDelayMax', label: '重试间隔最大 (ms)', kind: 'number', group: '注册策略' },
  { key: 'cloudflareMaxWaitMs', label: 'Cloudflare 最长等待 (ms)', kind: 'number', group: '注册策略' },

  { key: 'fullName', label: '注册姓名', kind: 'string', group: '个人信息' },
  { key: 'firstName', label: 'firstName', kind: 'string', group: '个人信息' },
  { key: 'lastName', label: 'lastName', kind: 'string', group: '个人信息' },
  { key: 'birthdayText', label: '生日 (mm/dd/yyyy)', kind: 'string', group: '个人信息' },
  { key: 'birthdayDate', label: '生日 (yyyy-mm-dd)', kind: 'string', group: '个人信息' },
  { key: 'age', label: '年龄', kind: 'string', group: '个人信息' },
];

const GROUPS = Array.from(new Set(FIELDS.map((f) => f.group)));

function fieldsByGroup(group: string): FieldDef[] {
  return FIELDS.filter((f) => f.group === group);
}

async function load() {
  loading.value = true;
  try {
    const res = await fetchConfig();
    config.value = { ...res.config };
    original.value = { ...res.config };
  } catch (e: unknown) {
    const err = e as { message?: string };
    message.error(`加载失败: ${err.message ?? '未知错误'}`);
  } finally {
    loading.value = false;
  }
}

function diff(): ConfigPayload {
  const out: ConfigPayload = {};
  for (const f of FIELDS) {
    const cur = config.value[f.key];
    const orig = original.value[f.key];
    if (cur !== orig && cur !== undefined && cur !== null && cur !== '') {
      out[f.key] = cur;
    }
  }
  return out;
}

async function onSave() {
  const payload = diff();
  if (Object.keys(payload).length === 0) {
    message.info('没有改动');
    return;
  }
  saving.value = true;
  try {
    const res = await updateConfig(payload);
    message.success(`已保存 ${Object.keys(res.updated).length} 项，重启程序后生效`);
    restartTip.value = true;
    await load();
  } catch (e: unknown) {
    const err = e as { response?: { data?: { error?: string } }; message?: string };
    message.error(`保存失败: ${err.response?.data?.error ?? err.message ?? '未知错误'}`);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <n-space vertical :size="16">
    <n-alert v-if="restartTip" type="warning" closable @close="restartTip = false">
      配置已保存到 config.json，需要重启 node index.js 才能生效
    </n-alert>

    <n-card v-for="group in GROUPS" :key="group" :title="group">
      <n-form label-placement="left" label-width="180px">
        <n-grid :cols="2" :x-gap="20">
          <n-grid-item v-for="f in fieldsByGroup(group)" :key="f.key">
            <n-form-item :label="f.label">
              <n-input
                v-if="f.kind === 'string'"
                v-model:value="(config[f.key] as string)"
                :placeholder="String(original[f.key] ?? '')"
              />
              <n-input-number
                v-else-if="f.kind === 'number'"
                v-model:value="(config[f.key] as number)"
                :placeholder="String(original[f.key] ?? '')"
                style="width: 100%"
              />
              <n-switch
                v-else-if="f.kind === 'boolean'"
                v-model:value="(config[f.key] as boolean)"
              />
            </n-form-item>
          </n-grid-item>
        </n-grid>
      </n-form>
    </n-card>

    <n-space>
      <n-button type="primary" :loading="saving" @click="onSave">保存改动</n-button>
      <n-button :loading="loading" @click="load">放弃改动并重新加载</n-button>
    </n-space>
  </n-space>
</template>
