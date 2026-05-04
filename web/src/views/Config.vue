<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
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
  NSpin,
  useMessage,
} from 'naive-ui';
import { useRouter } from 'vue-router';
import { fetchConfig, fetchMe, updateConfig, waitForServer, clearToken } from '@/api/client';
import type { ConfigPayload } from '@/api/types';

const router = useRouter();
const message = useMessage();
const config = ref<ConfigPayload>({});
const original = ref<ConfigPayload>({});
const loading = ref(false);
const saving = ref(false);
const restarting = ref(false);

// auth 字段独立追踪，不和 config 走同一个 reactive 引用
// 关键：authPassword 始终从空开始 (避免占位符被用户当成已有内容拼接)
const authUsername = ref('');
const authPassword = ref('');
const originalAuthUsername = ref('');

interface KnownGroup {
  name: string;
  keys: string[];
}

const KNOWN_GROUPS: KnownGroup[] = [
  { name: '核心', keys: ['targetAccounts', 'checkIntervalMinutes', 'replenishDelayMs', 'password', 'maxRetries'] },
  { name: '接口 / 锁', keys: ['apiHost', 'apiPort', 'accountStorePath', 'lockFilePath'] },
  { name: '浏览器', keys: ['headless', 'chromiumPath', 'browserPath', 'chromePath'] },
  {
    name: '邮件',
    keys: [
      'mailPollIntervalMs',
      'mailPollTimeoutMs',
      'mailPageTimeoutMs',
      'mailEmailTimeoutMs',
      'mailEmailCheckIntervalMs',
      'mailRefreshWaitMs',
      'mailDetailTimeoutMs',
      'mailDetailRetryCount',
      'mailDetailRetryDelayMs',
    ],
  },
  {
    name: '注册策略',
    keys: [
      'typingDelayMin',
      'typingDelayMax',
      'retryDelayMin',
      'retryDelayMax',
      'statusCheckIntervalMs',
      'signUpButtonTimeoutMs',
      'signUpClickCheckMs',
      'registrationStatusTimeoutMs',
      'cloudflareCheckIntervalMs',
      'cloudflareMaxWaitMs',
      'popupCloseDelayMs',
      'passwordInputTimeoutMs',
    ],
  },
  { name: '个人信息', keys: ['fullName', 'firstName', 'lastName', 'birthdayText', 'birthdayDate', 'age'] },
];

interface FieldDef {
  key: string;
  kind: 'string' | 'number' | 'boolean';
}
interface GroupDef {
  name: string;
  fields: FieldDef[];
}

const FIELD_LABELS: Record<string, string> = {
  password: '注册密码',
  headless: '无头模式',
  accountStorePath: '账号库路径',
  lockFilePath: '锁文件路径',
  apiHost: 'API 主机',
  apiPort: 'API 端口',
  targetAccounts: '目标账号数',
  checkIntervalMinutes: '检查间隔（分钟）',
  replenishDelayMs: '补齐延迟（毫秒）',
  mailPollIntervalMs: '邮箱轮询间隔（毫秒）',
  mailPollTimeoutMs: '邮箱轮询超时（毫秒）',
  maxRetries: '最大重试次数',
  typingDelayMin: '输入延迟最小值（毫秒）',
  typingDelayMax: '输入延迟最大值（毫秒）',
  retryDelayMin: '重试延迟最小值（毫秒）',
  retryDelayMax: '重试延迟最大值（毫秒）',
  statusCheckIntervalMs: '状态检查间隔（毫秒）',
  signUpButtonTimeoutMs: '注册按钮超时（毫秒）',
  signUpClickCheckMs: '注册点击检查间隔（毫秒）',
  registrationStatusTimeoutMs: '注册状态超时（毫秒）',
  cloudflareCheckIntervalMs: 'Cloudflare 检查间隔（毫秒）',
  cloudflareMaxWaitMs: 'Cloudflare 最大等待（毫秒）',
  mailPageTimeoutMs: '邮箱页超时（毫秒）',
  mailEmailTimeoutMs: '邮箱生成超时（毫秒）',
  mailEmailCheckIntervalMs: '邮箱生成检查间隔（毫秒）',
  mailRefreshWaitMs: '邮箱刷新等待（毫秒）',
  mailDetailTimeoutMs: '邮件详情超时（毫秒）',
  mailDetailRetryCount: '邮件详情重试次数',
  mailDetailRetryDelayMs: '邮件详情重试延迟（毫秒）',
  popupCloseDelayMs: '弹窗关闭延迟（毫秒）',
  passwordInputTimeoutMs: '密码输入超时（毫秒）',
  chromiumPath: 'Chromium 路径',
  browserPath: '浏览器路径',
  chromePath: 'Chrome 路径',
  fullName: '姓名',
  firstName: '名',
  lastName: '姓',
  birthdayText: '生日文本',
  birthdayDate: '生日日期',
  age: '年龄',
};

function inferKind(v: unknown): 'string' | 'number' | 'boolean' | null {
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  return null;
}

const groups = computed<GroupDef[]>(() => {
  const known = new Set<string>();
  KNOWN_GROUPS.forEach((g) => g.keys.forEach((k) => known.add(k)));

  const out: GroupDef[] = [];
  for (const g of KNOWN_GROUPS) {
    const fields: FieldDef[] = [];
    for (const k of g.keys) {
      if (!(k in config.value)) continue;
      const kind = inferKind(config.value[k]);
      if (!kind) continue;
      fields.push({ key: k, kind });
    }
    if (fields.length > 0) out.push({ name: g.name, fields });
  }

  const others: FieldDef[] = [];
  for (const [k, v] of Object.entries(config.value)) {
    if (k === 'auth' || known.has(k)) continue;
    const kind = inferKind(v);
    if (!kind) continue;
    others.push({ key: k, kind });
  }
  if (others.length > 0) out.push({ name: '其它', fields: others });

  return out;
});

const hasAuth = computed(
  () => typeof config.value.auth === 'object' && config.value.auth !== null && !Array.isArray(config.value.auth)
);

async function load() {
  loading.value = true;
  try {
    const res = await fetchConfig();
    config.value = JSON.parse(JSON.stringify(res.config));
    original.value = JSON.parse(JSON.stringify(res.config));

    // auth 字段独立同步：username 显示当前值，password 永远从空开始
    const auth = (res.config.auth as Record<string, unknown> | undefined) || {};
    const username = typeof auth.username === 'string' ? auth.username : '';
    authUsername.value = username;
    originalAuthUsername.value = username;
    authPassword.value = '';
  } catch (e: unknown) {
    const err = e as { message?: string };
    message.error(`加载失败: ${err.message ?? '未知错误'}`);
  } finally {
    loading.value = false;
  }
}

function diff(): ConfigPayload {
  const out: ConfigPayload = {};
  for (const [k, v] of Object.entries(config.value)) {
    if (k === 'auth') continue;
    if (inferKind(v) === null) continue;
    if (v !== original.value[k]) {
      out[k] = v as string | number | boolean;
    }
  }
  if (hasAuth.value) {
    const usernameChanged = authUsername.value !== originalAuthUsername.value;
    const passwordChanged = authPassword.value.length > 0;
    if (usernameChanged || passwordChanged) {
      const auth: Record<string, string> = {};
      if (usernameChanged) auth.username = authUsername.value;
      if (passwordChanged) auth.password = authPassword.value;
      out.auth = auth;
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

  // 保存前抓一份 instanceId，作为"重启完成"的判据
  let beforeInstanceId = '';
  try {
    const me = await fetchMe();
    beforeInstanceId = me.instanceId || '';
  } catch (e) {
    // 拿不到也继续，但之后 waitForServer 会更不可靠
  }

  saving.value = true;
  try {
    const res = await updateConfig(payload);
    message.success(`已保存 ${res.changedKeys.length} 项`);
    if (res.restarting) {
      restarting.value = true;
      const status = await waitForServer(beforeInstanceId, 60000, 1000);
      restarting.value = false;
      if (status === 'ready') {
        message.success('服务已重启，最新配置已生效');
        await load();
      } else if (status === 'unauthorized') {
        clearToken();
        message.warning('会话已失效，请重新登录');
        router.replace('/login');
      } else {
        message.error('等待服务器重启超时，请手动刷新');
      }
    } else {
      await load();
    }
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
  <n-spin :show="restarting" description="正在重启服务并等待新进程上线...">
    <n-space vertical :size="16">
      <n-card v-if="hasAuth" title="登录凭证 (Web 管理界面)">
        <n-alert type="warning" :show-icon="false" style="margin-bottom: 16px">
          密码框留空 = 不修改。要换新密码直接输入新密码。修改后会在重启后的新进程生效，当前会话不会掉线。
        </n-alert>
        <n-form label-placement="left" label-width="220px">
          <n-grid :cols="2" :x-gap="20">
            <n-grid-item>
              <n-form-item label="账号">
                <n-input v-model:value="authUsername" />
              </n-form-item>
            </n-grid-item>
            <n-grid-item>
              <n-form-item label="密码">
                <n-input
                  v-model:value="authPassword"
                  type="password"
                  show-password-on="click"
                  placeholder="留空表示不修改"
                />
              </n-form-item>
            </n-grid-item>
          </n-grid>
        </n-form>
      </n-card>

      <n-card v-for="g in groups" :key="g.name" :title="g.name">
        <n-form label-placement="left" label-width="220px">
          <n-grid :cols="2" :x-gap="20">
            <n-grid-item v-for="f in g.fields" :key="f.key">
              <n-form-item :label="FIELD_LABELS[f.key] || f.key">
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
        <n-button type="primary" :loading="saving" :disabled="restarting" @click="onSave">
          保存并重启
        </n-button>
        <n-button :loading="loading" :disabled="restarting || saving" @click="load">
          放弃改动并重新加载
        </n-button>
      </n-space>
    </n-space>
  </n-spin>
</template>
