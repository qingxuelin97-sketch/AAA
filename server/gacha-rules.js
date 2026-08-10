// 幸运转盘的奖池规则与期望值核算（不依赖 db，可被测试直接引用）。
//
// —— 为什么把这些从 routes/gacha.js 拆出来 ——
// 改造前的奖池含钻石档（diamond5 权重 8、diamond20 权重 3）。钻石经
// /economy/exchange 可按 1:100 兑成金币，于是「花 100 金转一次」的期望回收是：
//     金币档 44.28 + 钻石档 121.20 + 聊天卡 8.83 = 174.31 金
// 即每转一次净印 74.31 金，且 70% 的漏洞来自钻石档 —— 用软通货买硬通货，
// 方向恰好是反的。奖池调参没有任何守门，改错一个权重就是全站通胀。
//
// 现在期望值是可计算、可断言的：expectedValue() 是纯函数，gacha-test.mjs
// 拿它做 CI 硬闸（EV ≤ 0.85 × 售价），routes/gacha.js 也用它校验 GM 在
// app_config 里改出来的自定义奖池 —— 越界就退回默认池并留 error 日志，
// 而不是默默生效。

export const PAID_PRICE = 100;
export const GUARANTEE = 10;

// 奖池只发「不能兑换回货币」的产出：金币（纯内部消耗品）与聊天次数卡
// （1 卡 = 1 次平台 AI 回复免金币）。**不再发钻石** —— 钻石是充值硬通货，
// 由转盘产出等于让软通货反向铸造硬通货。
export const PRIZES = [
  { id: 'gold20',   kind: 'gold',   amount: 20,  weight: 26, label: '金币 ×20' },
  { id: 'gold50',   kind: 'gold',   amount: 50,  weight: 20, label: '金币 ×50' },
  { id: 'credit1',  kind: 'credit', amount: 1,   weight: 16, label: '聊天卡 ×1' },
  { id: 'gold100',  kind: 'gold',   amount: 100, weight: 12, label: '金币 ×100' },
  { id: 'credit2',  kind: 'credit', amount: 2,   weight: 10, label: '聊天卡 ×2' },
  { id: 'gold150',  kind: 'gold',   amount: 150, weight: 8,  label: '金币 ×150' },
  { id: 'credit6',  kind: 'credit', amount: 6,   weight: 5,  label: '聊天卡 ×6' },
  { id: 'gold500',  kind: 'gold',   amount: 500, weight: 3,  label: '金币 ×500', jackpot: true },
];

// 稀有档（保底池）。权重合计保持 16，与改造前一致 —— 保底节奏和玩家体感不变，
// 变的只是稀有档发什么。
export const RARE_IDS = ['gold150', 'credit6', 'gold500'];

// 期望值折金用的估价。聊天卡按**重会话档**（PLATFORM_FEE.heavy = 30）计，
// 取一张卡能顶掉的金币上限而非下限，宁可高估也不要让守门失灵。
export const VALUATION = { goldPerDiamond: 100, goldPerCredit: 30 };

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// 保底修正后的稀有档命中率。
// 保底规则：连续 GUARANTEE-1 次未中稀有后，第 GUARANTEE 次强制从稀有池取。
// 于是「两次稀有之间的间隔」L 的分布是截断几何分布：
//     P(L=k) = (1-p)^(k-1)·p   (k < GUARANTEE)，P(L=GUARANTEE) = (1-p)^(GUARANTEE-1)
// 实际命中率 = 1 / E[L]，恒高于裸权重 p。改造前 p=16% → 实际 19.39%，
// 直接用 16% 估期望会低估约 21%。
export function effectiveRareRate(prizes = PRIZES, rareIds = RARE_IDS, guarantee = GUARANTEE) {
  const rare = new Set(rareIds);
  const total = sum(prizes.map(p => p.weight));
  const p = sum(prizes.filter(x => rare.has(x.id)).map(x => x.weight)) / total;
  if (!(p > 0)) return 0;
  if (!(guarantee > 1)) return p;
  let expectedLen = guarantee * (1 - p) ** (guarantee - 1);
  for (let k = 1; k <= guarantee - 1; k++) expectedLen += k * (1 - p) ** (k - 1) * p;
  return 1 / expectedLen;
}

// 单次转动的期望回收（折算成金币）。含保底修正。
export function expectedValue(prizes = PRIZES, rareIds = RARE_IDS, guarantee = GUARANTEE, valuation = VALUATION) {
  const rare = new Set(rareIds);
  const rareRate = effectiveRareRate(prizes, rareIds, guarantee);
  const worth = (p) => {
    if (p.kind === 'gold') return p.amount;
    if (p.kind === 'diamond') return p.amount * valuation.goldPerDiamond;
    if (p.kind === 'credit') return p.amount * valuation.goldPerCredit;
    return 0;   // 未知种类按 0 计，避免把没估过价的奖品当成免费的
  };
  // 保底不改变各档在池内的相对权重，只改变「落在稀有池」的总概率，
  // 因此两池各自按池内权重求条件期望，再按 rareRate 加权。
  const poolMean = (pool) => {
    const w = sum(pool.map(p => p.weight));
    return w ? sum(pool.map(p => p.weight * worth(p))) / w : 0;
  };
  const rarePool = prizes.filter(p => rare.has(p.id));
  const commonPool = prizes.filter(p => !rare.has(p.id));
  return rareRate * poolMean(rarePool) + (1 - rareRate) * poolMean(commonPool);
}

// 奖池必须回收 ≤ 85% 售价。留 15% 余量而不是压到刚好 100%：
// 期望值只是均值，方差与运营活动（双倍、补偿）都会往上抬。
export const MAX_PAYOUT_RATIO = 0.85;

// 校验一份（可能来自 app_config 的）奖池配置。返回 null 表示通过，否则返回原因。
export function validateGachaConfig({ prizes, rareIds, guarantee, paidPrice }) {
  if (!Array.isArray(prizes) || !prizes.length) return '奖池为空';
  for (const p of prizes) {
    if (!p || typeof p.id !== 'string' || !p.id) return '奖品缺少 id';
    if (!['gold', 'credit'].includes(p.kind)) return `奖品 ${p.id} 的 kind 非法（只允许 gold / credit，钻石不得由转盘产出）`;
    if (!Number.isInteger(p.amount) || p.amount <= 0) return `奖品 ${p.id} 的 amount 非法`;
    if (!Number.isFinite(p.weight) || p.weight <= 0) return `奖品 ${p.id} 的 weight 非法`;
  }
  if (new Set(prizes.map(p => p.id)).size !== prizes.length) return '奖品 id 重复';
  if (!Array.isArray(rareIds)) return 'rareIds 非法';
  for (const id of rareIds) if (!prizes.some(p => p.id === id)) return `稀有档 ${id} 不在奖池中`;
  if (!Number.isInteger(guarantee) || guarantee < 1) return 'guarantee 非法';
  if (!Number.isInteger(paidPrice) || paidPrice <= 0) return 'paidPrice 非法';
  const ev = expectedValue(prizes, rareIds, guarantee);
  if (ev > paidPrice * MAX_PAYOUT_RATIO) {
    return `期望回收 ${ev.toFixed(2)} 金 超过售价 ${paidPrice} 金的 ${(MAX_PAYOUT_RATIO * 100).toFixed(0)}%（上限 ${(paidPrice * MAX_PAYOUT_RATIO).toFixed(2)}）`;
  }
  return null;
}
