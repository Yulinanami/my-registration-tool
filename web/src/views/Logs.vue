<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, nextTick } from 'vue';
import { NCard, NSpace, NButton, NSelect, NSwitch, useMessage } from 'naive-ui';
import { fetchLogs } from '@/api/client';

const message = useMessage();
const lines = ref<string[]>([]);
const linesCount = ref(200);
const autoRefresh = ref(true);
const loading = ref(false);
const autoScroll = ref(true);
const logBoxRef = ref<HTMLElement | null>(null);
let timer: number | null = null;

const lineOptions = [
  { label: '100 行', value: 100 },
  { label: '200 行', value: 200 },
  { label: '500 行', value: 500 },
  { label: '1000 行', value: 1000 },
  { label: '2000 行', value: 2000 },
];

async function load() {
  loading.value = true;
  try {
    const data = await fetchLogs(linesCount.value);
    lines.value = data.lines;
    if (autoScroll.value) {
      await nextTick();
      if (logBoxRef.value) {
        logBoxRef.value.scrollTop = logBoxRef.value.scrollHeight;
      }
    }
  } catch (e: unknown) {
    const err = e as { message?: string };
    message.error(`加载失败: ${err.message ?? '未知错误'}`);
  } finally {
    loading.value = false;
  }
}

function startTimer() {
  stopTimer();
  if (autoRefresh.value) {
    timer = window.setInterval(load, 5000);
  }
}

function stopTimer() {
  if (timer) {
    window.clearInterval(timer);
    timer = null;
  }
}

watch(autoRefresh, startTimer);
watch(linesCount, load);

onMounted(() => {
  load();
  startTimer();
});

onUnmounted(stopTimer);

function classOfLine(line: string): string {
  if (/\[ERROR\]|\berror\b/i.test(line)) return 'log-error';
  if (/\[WARN\]|\bwarn\b/i.test(line)) return 'log-warn';
  if (/\[INFO\]|\binfo\b/i.test(line)) return 'log-info';
  return '';
}
</script>

<template>
  <n-card>
    <n-space justify="space-between" style="margin-bottom: 12px;" align="center">
      <n-space align="center">
        <span>显示行数:</span>
        <n-select v-model:value="linesCount" :options="lineOptions" style="width: 120px" />
        <span>自动刷新:</span>
        <n-switch v-model:value="autoRefresh" />
        <span>自动滚动:</span>
        <n-switch v-model:value="autoScroll" />
      </n-space>
      <n-button :loading="loading" @click="load">手动刷新</n-button>
    </n-space>

    <div ref="logBoxRef" class="log-box">
      <div v-for="(line, i) in lines" :key="i" :class="classOfLine(line)">
        {{ line }}
      </div>
      <div v-if="lines.length === 0" style="color: #888; padding: 20px; text-align: center;">
        无日志
      </div>
    </div>
  </n-card>
</template>

<style scoped>
.log-box {
  background: #1e1e1e;
  color: #ddd;
  font-family: 'Consolas', 'Menlo', 'Monaco', monospace;
  font-size: 12px;
  padding: 12px;
  height: calc(100vh - 220px);
  overflow-y: auto;
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.5;
}
.log-error { color: #ef5350; }
.log-warn { color: #ffa726; }
.log-info { color: #ddd; }
</style>
