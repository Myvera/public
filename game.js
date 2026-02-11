const CONFIG = {
  startCash: 100000,
  defaultPrice: 68000,
  tickMs: 300,
  gameMinutes: 5,
  feeRate: 0.001,
  minOrderAmount: 500,
  orderStep: 500,
  maxChartTicks: 200,
  // A안: BTC 느낌 시뮬레이션 파라미터
  driftStrength: 0.05,
  volatility: 0.7,
  spikeChance: 0.04,
  spikeMagnitude: 45,
  // B안: 공개 API + 실패 시 fallback
  enableLiveApi: true,
  liveApiMs: 2500,
  liveApiUrl: "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
};

const state = {
  cash: CONFIG.startCash,
  realizedPnl: 0,
  position: null,
  orderAmount: CONFIG.minOrderAmount,
  ticks: [],
  currentPrice: CONFIG.defaultPrice,
  lastShock: 0,
  gameRunning: true,
  gameEndTime: 0,
  tickMs: CONFIG.tickMs,
  tickTimer: null,
  apiTimer: null,
};

const dom = {
  priceValue: document.getElementById("priceValue"),
  cashValue: document.getElementById("cashValue"),
  positionValue: document.getElementById("positionValue"),
  entryValue: document.getElementById("entryValue"),
  unrealizedValue: document.getElementById("unrealizedValue"),
  realizedValue: document.getElementById("realizedValue"),
  timeValue: document.getElementById("timeValue"),
  tickValue: document.getElementById("tickValue"),
  orderSizeValue: document.getElementById("orderSizeValue"),
  tradeLog: document.getElementById("tradeLog"),
  statusMessage: document.getElementById("statusMessage"),
  tickSpeedSelect: document.getElementById("tickSpeedSelect"),
  buyBtn: document.getElementById("buyBtn"),
  sellBtn: document.getElementById("sellBtn"),
  closeBtn: document.getElementById("closeBtn"),
  resetBtn: document.getElementById("resetBtn"),
  increaseSize: document.getElementById("increaseSize"),
  decreaseSize: document.getElementById("decreaseSize"),
};

const canvas = document.getElementById("priceChart");
const ctx = canvas.getContext("2d");

function formatMoney(v) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTime(msLeft) {
  const totalSec = Math.max(0, Math.floor(msLeft / 1000));
  const minutes = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const sec = String(totalSec % 60).padStart(2, "0");
  return `${minutes}:${sec}`;
}

function addLog(action, price, amount, pnl = 0, note = "") {
  const li = document.createElement("li");
  const now = new Date();
  const time = now.toLocaleTimeString("ko-KR", { hour12: false });
  const pnlText = pnl === 0 ? "-" : formatMoney(pnl);
  const colorClass = pnl > 0 ? "pnl-positive" : pnl < 0 ? "pnl-negative" : "";

  li.innerHTML = `
    <div><strong>${time}</strong> · ${action}</div>
    <div>가격 ${formatMoney(price)} / 금액 ${formatMoney(amount)} / 손익 <span class="${colorClass}">${pnlText}</span></div>
    ${note ? `<div>${note}</div>` : ""}
  `;

  dom.tradeLog.prepend(li);
  while (dom.tradeLog.children.length > 25) {
    dom.tradeLog.removeChild(dom.tradeLog.lastChild);
  }
}

function getUnrealizedPnl() {
  if (!state.position) return 0;
  const direction = state.position.side === "LONG" ? 1 : -1;
  return (state.currentPrice - state.position.entryPrice) * state.position.contracts * direction;
}

function renderStats() {
  const unrealized = getUnrealizedPnl();

  dom.priceValue.textContent = formatMoney(state.currentPrice);
  dom.cashValue.textContent = formatMoney(state.cash);
  dom.positionValue.textContent = state.position ? `${state.position.side} (${state.position.contracts}계약)` : "없음";
  dom.entryValue.textContent = state.position ? formatMoney(state.position.entryPrice) : "-";
  dom.unrealizedValue.textContent = formatMoney(unrealized);
  dom.realizedValue.textContent = formatMoney(state.realizedPnl);
  dom.timeValue.textContent = formatTime(state.gameEndTime - Date.now());
  dom.tickValue.textContent = `${state.tickMs}ms`;
  dom.orderSizeValue.textContent = formatMoney(state.orderAmount);

  dom.unrealizedValue.className = unrealized > 0 ? "pnl-positive" : unrealized < 0 ? "pnl-negative" : "";
  dom.realizedValue.className = state.realizedPnl > 0 ? "pnl-positive" : state.realizedPnl < 0 ? "pnl-negative" : "";

  const hasPosition = Boolean(state.position);
  dom.buyBtn.disabled = !state.gameRunning || hasPosition;
  dom.sellBtn.disabled = !state.gameRunning || hasPosition;
  dom.closeBtn.disabled = !state.gameRunning || !hasPosition;
  dom.increaseSize.disabled = !state.gameRunning;
  dom.decreaseSize.disabled = !state.gameRunning || state.orderAmount <= CONFIG.minOrderAmount;
}

function drawChart() {
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);

  if (state.ticks.length < 2) return;

  const min = Math.min(...state.ticks);
  const max = Math.max(...state.ticks);
  const range = Math.max(max - min, 1);

  ctx.strokeStyle = "#2f364c";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const y = 10 + ((height - 20) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#4dd4ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  state.ticks.forEach((value, idx) => {
    const x = (idx / (state.ticks.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 20) - 10;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  if (state.position) {
    const y = height - ((state.position.entryPrice - min) / range) * (height - 20) - 10;
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#ffd166";
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = "#9fa9c8";
  ctx.font = "12px sans-serif";
  ctx.fillText(`H ${formatMoney(max)}`, 10, 16);
  ctx.fillText(`L ${formatMoney(min)}`, 10, height - 8);
}

function maybeGenerateSpike() {
  if (Math.random() < CONFIG.spikeChance) {
    const direction = Math.random() > 0.5 ? 1 : -1;
    return direction * (CONFIG.spikeMagnitude + Math.random() * CONFIG.spikeMagnitude);
  }
  return 0;
}

function simulateTick() {
  const drift = (Math.random() - 0.5) * CONFIG.driftStrength * state.currentPrice * 0.002;
  const noise = (Math.random() - 0.5) * CONFIG.volatility * 18;
  const spike = maybeGenerateSpike();
  state.lastShock = spike;

  const next = Math.max(1000, state.currentPrice + drift + noise + spike);
  state.currentPrice = Number(next.toFixed(2));
}

async function applyLivePriceIfAvailable() {
  if (!CONFIG.enableLiveApi || !state.gameRunning) return;
  try {
    const response = await fetch(CONFIG.liveApiUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("API response not ok");
    const data = await response.json();
    const live = Number(data.price);
    if (Number.isFinite(live) && live > 0) {
      state.currentPrice = Number(live.toFixed(2));
    }
  } catch {
    // fallback: 시뮬레이션 가격 유지
  }
}

function pushTick() {
  state.ticks.push(state.currentPrice);
  if (state.ticks.length > CONFIG.maxChartTicks) {
    state.ticks.shift();
  }
}

function openPosition(side) {
  if (!state.gameRunning || state.position) return;

  const entryFee = state.orderAmount * CONFIG.feeRate;
  if (state.cash < entryFee) {
    dom.statusMessage.textContent = "수수료를 낼 잔고가 부족합니다.";
    return;
  }

  state.cash -= entryFee;
  state.position = {
    side,
    entryPrice: state.currentPrice,
    contracts: state.orderAmount / CONFIG.minOrderAmount,
    orderAmount: state.orderAmount,
  };

  addLog(side === "LONG" ? "BUY" : "SELL", state.currentPrice, state.orderAmount, -entryFee, "진입 수수료 차감");
  renderStats();
}

function closePosition() {
  if (!state.gameRunning || !state.position) return;

  const dir = state.position.side === "LONG" ? 1 : -1;
  const grossPnl = (state.currentPrice - state.position.entryPrice) * state.position.contracts * dir;
  const exitFee = state.position.orderAmount * CONFIG.feeRate;
  const netPnl = grossPnl - exitFee;

  state.cash += netPnl;
  state.realizedPnl += netPnl;

  addLog("CLOSE", state.currentPrice, state.position.orderAmount, netPnl, `청산 수수료 ${formatMoney(exitFee)}`);

  state.position = null;
  renderStats();
}

function endGame(message) {
  state.gameRunning = false;
  clearInterval(state.tickTimer);
  clearInterval(state.apiTimer);
  dom.statusMessage.textContent = message;
  renderStats();
}

function gameLoop() {
  if (!state.gameRunning) return;

  simulateTick();
  pushTick();
  drawChart();
  renderStats();

  if (state.cash <= 0) {
    endGame("Game Over: 현금이 0 이하가 되었습니다.");
    return;
  }

  if (Date.now() >= state.gameEndTime) {
    endGame("Clear! 제한 시간을 버텼습니다.");
  }
}

function restartTickLoop() {
  clearInterval(state.tickTimer);
  state.tickTimer = setInterval(gameLoop, state.tickMs);
}

function resetGame() {
  clearInterval(state.tickTimer);
  clearInterval(state.apiTimer);

  state.cash = CONFIG.startCash;
  state.realizedPnl = 0;
  state.position = null;
  state.orderAmount = CONFIG.minOrderAmount;
  state.currentPrice = CONFIG.defaultPrice;
  state.ticks = [];
  state.lastShock = 0;
  state.gameRunning = true;
  state.gameEndTime = Date.now() + CONFIG.gameMinutes * 60 * 1000;

  for (let i = 0; i < 60; i += 1) {
    simulateTick();
    pushTick();
  }

  dom.tradeLog.innerHTML = "";
  addLog("SYSTEM", state.currentPrice, state.orderAmount, 0, "게임이 초기화되었습니다.");
  dom.statusMessage.textContent = "게임 진행 중";

  restartTickLoop();
  state.apiTimer = setInterval(applyLivePriceIfAvailable, CONFIG.liveApiMs);
  renderStats();
  drawChart();
}

function bindEvents() {
  dom.buyBtn.addEventListener("click", () => openPosition("LONG"));
  dom.sellBtn.addEventListener("click", () => openPosition("SHORT"));
  dom.closeBtn.addEventListener("click", closePosition);
  dom.resetBtn.addEventListener("click", resetGame);

  dom.increaseSize.addEventListener("click", () => {
    state.orderAmount += CONFIG.orderStep;
    renderStats();
  });

  dom.decreaseSize.addEventListener("click", () => {
    state.orderAmount = Math.max(CONFIG.minOrderAmount, state.orderAmount - CONFIG.orderStep);
    renderStats();
  });

  dom.tickSpeedSelect.addEventListener("change", (event) => {
    state.tickMs = Number(event.target.value);
    restartTickLoop();
    renderStats();
  });
}

bindEvents();
resetGame();
