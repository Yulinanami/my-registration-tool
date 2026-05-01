<script setup lang="ts">
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { NCard, NForm, NFormItem, NInput, NButton, NAlert, useMessage } from 'naive-ui';
import { login, setToken } from '@/api/client';

const router = useRouter();
const route = useRoute();
const message = useMessage();

const username = ref('admin');
const password = ref('');
const loading = ref(false);
const errorText = ref('');

async function onSubmit() {
  if (!username.value || !password.value) {
    errorText.value = '请输入账号和密码';
    return;
  }
  loading.value = true;
  errorText.value = '';
  try {
    const res = await login(username.value, password.value);
    if (res.ok && res.token) {
      setToken(res.token);
      message.success('登录成功');
      const redirect = (route.query.redirect as string) || '/dashboard';
      await router.replace(redirect);
    } else {
      errorText.value = '登录失败';
    }
  } catch (e: any) {
    if (e?.response?.status === 401) {
      errorText.value = '账号或密码错误';
    } else if (e?.response?.data?.error) {
      errorText.value = e.response.data.error;
    } else {
      errorText.value = e?.message || '登录失败';
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <n-card class="login-card" title="账号池守护 · 登录" size="large">
      <n-form @submit.prevent="onSubmit">
        <n-form-item label="账号">
          <n-input v-model:value="username" placeholder="请输入账号" autocomplete="username" />
        </n-form-item>
        <n-form-item label="密码">
          <n-input
            v-model:value="password"
            type="password"
            show-password-on="click"
            placeholder="请输入密码"
            autocomplete="current-password"
            @keyup.enter="onSubmit"
          />
        </n-form-item>
        <n-alert v-if="errorText" type="error" :show-icon="false" style="margin-bottom: 12px">
          {{ errorText }}
        </n-alert>
        <n-button type="primary" block :loading="loading" attr-type="submit" @click="onSubmit">
          登录
        </n-button>
      </n-form>
    </n-card>
  </div>
</template>

<style scoped>
.login-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: linear-gradient(135deg, #1a1a1f 0%, #2a2a35 100%);
}
.login-card {
  width: 380px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4);
}
</style>
