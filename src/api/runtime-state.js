// 调度器和 API 共享的运行时状态
// scheduler 在每轮开始/结束时更新，API 路由读取

const state = {
  startedAt: null,
  lastRoundStartedAt: null,
  lastRoundEndedAt: null,
  lastRoundStats: null,
  nextRoundAt: null,
  roundInProgress: false,
  manualRoundInProgress: false,
  manualReplenishInProgress: false,
};

function setStarted() {
  state.startedAt = Date.now();
}

function setRoundStart() {
  state.lastRoundStartedAt = Date.now();
  state.roundInProgress = true;
}

function setRoundEnd(stats) {
  state.lastRoundEndedAt = Date.now();
  state.lastRoundStats = stats || null;
  state.roundInProgress = false;
}

function setNextRoundAt(ts) {
  state.nextRoundAt = ts;
}

function snapshot() {
  return { ...state };
}

module.exports = {
  setStarted,
  setRoundStart,
  setRoundEnd,
  setNextRoundAt,
  snapshot,
  _state: state,
};
