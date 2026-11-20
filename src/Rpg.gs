/**
 * Rpg.gs — RPG 遊戲化規則（純函式，不讀寫試算表）
 *
 * 採計原則：每份作業只採計「最後一筆繳交」，與成績採計一致。
 * 所有能力值、XP、等級、徽章都從繳交紀錄即時計算，重新評分後自動反映。
 */

const STAT_SCALE = 10; // 能力值 = 權重 × rating / 100 × STAT_SCALE

const LEVEL_TITLES = [
  { minLevel: 1, title: '見習冒險者' },
  { minLevel: 3, title: '新手冒險者' },
  { minLevel: 5, title: '熟練冒險者' },
  { minLevel: 8, title: '菁英冒險者' },
  { minLevel: 12, title: '英雄' },
  { minLevel: 16, title: '傳說勇者' }
];

/**
 * 成就徽章規則表：新增徽章只要在這裡加一筆。
 * check(ctx) 的 ctx 見 computePlayerProfile_ 內的說明。
 */
const BADGE_RULES = [
  {
    id: 'first_quest', icon: '🗡️', name: '初次冒險', desc: '完成第一次任務繳交',
    check: function (ctx) { return ctx.submissions.length > 0; }
  },
  {
    id: 'perfect', icon: '💎', name: '完美通關', desc: '任一任務拿到滿分',
    check: function (ctx) { return ctx.perfectCount > 0; }
  },
  {
    id: 'comeback', icon: '🔥', name: '屢敗屢戰', desc: '重新挑戰後分數進步滿分的 10% 以上',
    check: function (ctx) { return ctx.hasComeback; }
  },
  {
    id: 'all_clear', icon: '🏰', name: '全勤冒險者', desc: '完成所有開放中的任務',
    check: function (ctx) { return ctx.activeCount > 0 && ctx.activeCompleted === ctx.activeCount; }
  },
  {
    id: 'specialist', icon: '📜', name: '素養專精', desc: '任一能力值達到 50',
    check: function (ctx) { return ctx.maxStat >= 50; }
  },
  {
    id: 'level5', icon: '⭐', name: '嶄露頭角', desc: '等級達到 5',
    check: function (ctx) { return ctx.level >= 5; }
  },
  {
    id: 'level10', icon: '👑', name: '名震四方', desc: '等級達到 10',
    check: function (ctx) { return ctx.level >= 10; }
  }
];

function getBadgeCatalog_() {
  return BADGE_RULES.map(function (b) {
    return { id: b.id, icon: b.icon, name: b.name, desc: b.desc };
  });
}

/**
 * 解析教師輸入的能力清單：每行「能力名稱: 權重」，權重可省略（預設 1）。
 * 支援半形 / 全形冒號；同名能力只取第一個。
 */
function parseCompetencies_(text) {
  const seen = {};
  const result = [];
  String(text || '').split(/\r?\n/).forEach(function (line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    const m = trimmed.match(/^(.+?)\s*[:：]\s*([\d.]+)\s*$/);
    let name = m ? m[1].trim() : trimmed;
    let weight = m ? Number(m[2]) : 1;
    name = name.replace(/^[-*•\d.、\s]+/, '').trim(); // 去掉清單符號
    if (!name || seen[name]) return;
    if (isNaN(weight) || weight <= 0) weight = 1;
    weight = Math.min(weight, 10);
    seen[name] = true;
    result.push({ name: name, weight: weight });
  });
  return result;
}

/** 達到第 L 級所需的累積 XP：50 × L × (L − 1) */
function xpForLevel_(level) {
  return 50 * level * (level - 1);
}

function levelInfo_(totalXp) {
  const xp = Math.max(0, Number(totalXp) || 0);
  let level = 1;
  while (xpForLevel_(level + 1) <= xp) level++;
  const floor = xpForLevel_(level);
  const next = xpForLevel_(level + 1);
  let title = LEVEL_TITLES[0].title;
  LEVEL_TITLES.forEach(function (t) { if (level >= t.minLevel) title = t.title; });
  return {
    level: level,
    title: title,
    totalXp: xp,
    levelFloorXp: floor,
    nextLevelXp: next,
    progress: next > floor ? (xp - floor) / (next - floor) : 0
  };
}

function xpForScore_(assignment, score) {
  if (score === null || score === undefined || isNaN(score)) return 0;
  const ratio = Math.max(0, Math.min(1, Number(score) / (assignment.maxScore || 100)));
  return Math.round((assignment.xpReward || 0) * ratio);
}

function round1_(n) {
  return Math.round(n * 10) / 10;
}

/**
 * 計算單一玩家的 RPG 檔案。
 * @param {Object[]} assignments readAssignments_ 的結果
 * @param {Object[]} studentSubs 該生的所有繳交（需已 markLatestFlags_）
 */
function computePlayerProfile_(assignments, studentSubs) {
  const asgMap = {};
  assignments.forEach(function (a) { asgMap[a.assignmentId] = a; });

  let totalXp = 0;
  const stats = {};
  const quests = {}; // assignmentId → { status, score, xp, attempts }
  let perfectCount = 0;
  let hasComeback = false;

  // 依作業分組
  const byAsg = {};
  studentSubs.forEach(function (s) {
    if (!asgMap[s.assignmentId]) return;
    (byAsg[s.assignmentId] = byAsg[s.assignmentId] || []).push(s);
  });

  Object.keys(byAsg).forEach(function (asgId) {
    const a = asgMap[asgId];
    const list = byAsg[asgId].slice().sort(function (x, y) { return x.attemptNumber - y.attemptNumber; });
    const latest = list.find(function (s) { return s.isLatest; }) || list[list.length - 1];
    const score = latest.aiScore;
    const xp = xpForScore_(a, score);
    totalXp += xp;

    const isPerfect = score !== null && score >= a.maxScore;
    if (isPerfect) perfectCount++;

    // 屢敗屢戰：之後任一次比第一次進步 ≥ 滿分 10%
    const first = list[0].aiScore;
    if (first !== null) {
      for (let i = 1; i < list.length; i++) {
        if (list[i].aiScore !== null && list[i].aiScore - first >= a.maxScore * 0.1) {
          hasComeback = true;
          break;
        }
      }
    }

    // 能力值：只採計最後一筆，且只算作業目前設定中存在的能力
    const weightMap = {};
    a.competencies.forEach(function (c) { weightMap[c.name] = c.weight; });
    (latest.competencyResults || []).forEach(function (cr) {
      if (weightMap[cr.name] === undefined) return;
      const rating = Math.max(0, Math.min(100, Number(cr.rating) || 0));
      stats[cr.name] = (stats[cr.name] || 0) + weightMap[cr.name] * rating / 100 * STAT_SCALE;
    });

    quests[asgId] = {
      status: isPerfect ? 'perfect' : 'completed',
      score: score,
      xp: xp,
      attempts: list.length
    };
  });

  Object.keys(stats).forEach(function (k) { stats[k] = round1_(stats[k]); });

  const lv = levelInfo_(totalXp);
  const active = assignments.filter(function (a) { return a.isActive; });
  const ctx = {
    submissions: studentSubs,
    perfectCount: perfectCount,
    hasComeback: hasComeback,
    activeCount: active.length,
    activeCompleted: active.filter(function (a) { return quests[a.assignmentId]; }).length,
    maxStat: Object.keys(stats).reduce(function (m, k) { return Math.max(m, stats[k]); }, 0),
    level: lv.level
  };

  const badges = BADGE_RULES
    .filter(function (b) { return b.check(ctx); })
    .map(function (b) { return b.id; });

  return {
    level: lv.level,
    title: lv.title,
    totalXp: lv.totalXp,
    levelFloorXp: lv.levelFloorXp,
    nextLevelXp: lv.nextLevelXp,
    progress: lv.progress,
    stats: stats,
    quests: quests,
    badges: badges
  };
}

/** 比較繳交前後的檔案，產生結算畫面所需資料 */
function diffProfiles_(before, after) {
  const statDeltas = [];
  Object.keys(after.stats).forEach(function (k) {
    const d = round1_(after.stats[k] - (before.stats[k] || 0));
    if (d !== 0) statDeltas.push({ name: k, delta: d, value: after.stats[k] });
  });
  Object.keys(before.stats).forEach(function (k) {
    if (after.stats[k] === undefined) statDeltas.push({ name: k, delta: -before.stats[k], value: 0 });
  });
  const catalog = getBadgeCatalog_();
  const newBadges = after.badges
    .filter(function (id) { return before.badges.indexOf(id) === -1; })
    .map(function (id) { return catalog.find(function (b) { return b.id === id; }); });
  return {
    xpDelta: after.totalXp - before.totalXp,
    levelBefore: before.level,
    levelAfter: after.level,
    titleAfter: after.title,
    statDeltas: statDeltas,
    newBadges: newBadges
  };
}

/**
 * 排行榜：依總 XP 排序，只輸出暱稱，不輸出 Email。
 * @param {Object[]} allWithFlags 所有繳交（已 markLatestFlags_）
 * @param {Object} players readPlayers_ 的結果
 * @param {string} myEmail 目前使用者（標記 isMe）
 */
function computeLeaderboard_(assignments, allWithFlags, players, myEmail) {
  const byStudent = {};
  allWithFlags.forEach(function (s) {
    if (isTeacherEmail_(s.studentEmail)) return; // 教師測試繳交不列入排行
    (byStudent[s.studentEmail] = byStudent[s.studentEmail] || []).push(s);
  });

  const rows = Object.keys(byStudent).map(function (email) {
    const p = computePlayerProfile_(assignments, byStudent[email]);
    return {
      _email: email,
      nickname: playerDisplayName_(players, email),
      level: p.level,
      title: p.title,
      totalXp: p.totalXp,
      badgeCount: p.badges.length
    };
  });

  rows.sort(function (a, b) { return b.totalXp - a.totalXp || b.badgeCount - a.badgeCount; });

  let rank = 0;
  let prevXp = null;
  return rows.map(function (r, i) {
    if (r.totalXp !== prevXp) { rank = i + 1; prevXp = r.totalXp; }
    return {
      rank: rank,
      nickname: r.nickname,
      level: r.level,
      title: r.title,
      totalXp: r.totalXp,
      badgeCount: r.badgeCount,
      isMe: r._email === myEmail
    };
  });
}

/**
 * 在 GAS 編輯器手動執行，檢查等級門檻、能力解析與徽章判定。
 * 結果寫在「執行紀錄」中。
 */
function testRpgRules() {
  const results = [];
  function expect(name, cond) { results.push((cond ? '✅ ' : '❌ ') + name); }

  expect('0 XP 為 Lv1', levelInfo_(0).level === 1);
  expect('99 XP 為 Lv1', levelInfo_(99).level === 1);
  expect('100 XP 為 Lv2', levelInfo_(100).level === 2);
  expect('1000 XP 為 Lv5', levelInfo_(1000).level === 5);
  expect('4500 XP 為 Lv10', levelInfo_(4500).level === 10);
  expect('Lv5 稱號為熟練冒險者', levelInfo_(1000).title === '熟練冒險者');

  const comps = parseCompetencies_('邏輯思考: 3\n創意表達：2\n- 溝通合作\n邏輯思考: 5\n\n');
  expect('能力解析為 3 項', comps.length === 3);
  expect('權重解析（半形冒號）', comps[0].name === '邏輯思考' && comps[0].weight === 3);
  expect('權重解析（全形冒號）', comps[1].name === '創意表達' && comps[1].weight === 2);
  expect('省略權重預設 1、去除清單符號', comps[2].name === '溝通合作' && comps[2].weight === 1);

  const asg = [{
    assignmentId: 'A1', maxScore: 100, xpReward: 100, isActive: true,
    competencies: [{ name: '邏輯思考', weight: 3 }, { name: '創意表達', weight: 2 }]
  }];
  const subs = markLatestFlags_([
    { submissionId: 's1', assignmentId: 'A1', studentEmail: 'x', attemptNumber: 1, aiScore: 60,
      competencyResults: [{ name: '邏輯思考', rating: 50 }, { name: '創意表達', rating: 50 }] },
    { submissionId: 's2', assignmentId: 'A1', studentEmail: 'x', attemptNumber: 2, aiScore: 100,
      competencyResults: [{ name: '邏輯思考', rating: 100 }, { name: '不存在的能力', rating: 100 }] }
  ]);
  const p = computePlayerProfile_(asg, subs);
  expect('只採計最後一筆 XP（100）', p.totalXp === 100);
  expect('能力值只採計最後一筆（邏輯思考 = 30）', p.stats['邏輯思考'] === 30);
  expect('忽略作業未設定的能力', p.stats['不存在的能力'] === undefined);
  expect('最後一筆未評的能力不累積', p.stats['創意表達'] === undefined);
  expect('徽章：初次冒險', p.badges.indexOf('first_quest') !== -1);
  expect('徽章：完美通關', p.badges.indexOf('perfect') !== -1);
  expect('徽章：屢敗屢戰', p.badges.indexOf('comeback') !== -1);
  expect('徽章：全勤冒險者', p.badges.indexOf('all_clear') !== -1);
  expect('未達素養專精', p.badges.indexOf('specialist') === -1);

  const empty = computePlayerProfile_(asg, []);
  const d = diffProfiles_(empty, p);
  expect('結算 XP 增加 100', d.xpDelta === 100);
  expect('結算新徽章 4 枚', d.newBadges.length === 4);

  const failed = results.filter(function (r) { return r.indexOf('❌') === 0; }).length;
  Logger.log(results.join('\n') + '\n\n' + (failed ? failed + ' 項失敗' : '全部通過'));
  return { failed: failed, results: results };
}
