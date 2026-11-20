/**
 * AI 評分 RPG（Google Apps Script + Gemini API）
 * 以 ai-grading-gas 為基礎，加入素養能力值、經驗值與等級、任務、成就徽章、排行榜。
 *
 * 必要指令碼屬性 (Script Properties)：
 * - GEMINI_API_KEY   : Google AI Studio 取得的 Gemini API Key
 * - TEACHER_EMAILS   : 教師 Email 串列（可用逗號、分號或換行分隔）
 *
 * 選用指令碼屬性：
 * - GEMINI_MODEL     : 使用的模型，預設為 gemini-3.8-flash
 * - SPREADSHEET_ID   : 若腳本非綁定於試算表，可指定試算表 ID
 * - AUTH_RELAY_URL   : （選用）外部 AuthRelay Web App 網址
 * - AUTH_SECRET      : （選用）與 AuthRelay 共用的簽章密鑰
 *
 * 檔案分工：
 * - Code.gs    進入點、初始化資料、作業管理、教師後台、遊戲設定
 * - Auth.gs    身份驗證
 * - Data.gs    試算表讀寫
 * - Grading.gs 繳交與 AI 評分
 * - Rpg.gs     RPG 規則（純函式）
 */

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  template.initialRelayToken = (e && e.parameter && e.parameter.authToken) ? String(e.parameter.authToken) : '';

  return template
    .evaluate()
    .setTitle('AI 評分 RPG')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 讓 Index.html 以 <?!= include('Styles') ?> 載入其他 HTML 檔 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getProps_() {
  return PropertiesService.getScriptProperties();
}

function requireTeacher_(sessionToken, message) {
  const user = resolveUser_(sessionToken);
  if (!user.authenticated || !user.isTeacher) {
    throw new Error(message || '權限不足：僅指定教師可使用此功能。');
  }
  return user;
}

/** 前端不需要 _row 等內部欄位 */
function publicAssignments_(assignments) {
  return assignments.map(function (a) {
    const copy = {};
    Object.keys(a).forEach(function (k) { if (k.charAt(0) !== '_') copy[k] = a[k]; });
    return copy;
  });
}

// ==========================================
// 應用程式初始化資料
// ==========================================

function getAppInitData(sessionToken) {
  const props = getProps_();
  const authRelayUrl = props.getProperty('AUTH_RELAY_URL') || '';
  const user = resolveUser_(sessionToken);

  if (!user.authenticated) {
    return {
      authenticated: false,
      authRelayUrl: authRelayUrl
    };
  }

  const ss = getSpreadsheet_();
  const assignments = readAssignments_(ss);
  const allWithFlags = markLatestFlags_(readAllSubmissionsRaw_(ss));
  const mySubmissions = readStudentSubmissions_(ss, user.email, allWithFlags);
  const player = getOrCreatePlayer_(ss, user.email);
  const players = readPlayers_(ss);
  const settings = readSettings_(ss);

  return {
    authenticated: true,
    user: user,
    authRelayUrl: authRelayUrl,
    hasApiKey: Boolean(props.getProperty('GEMINI_API_KEY')),
    assignments: publicAssignments_(assignments),
    mySubmissions: mySubmissions,
    nickname: player.nickname,
    profile: computePlayerProfile_(assignments, mySubmissions),
    badgeCatalog: getBadgeCatalog_(),
    settings: settings,
    leaderboard: settings.leaderboardEnabled
      ? computeLeaderboard_(assignments, allWithFlags, players, user.email)
      : null
  };
}

function updateNickname(sessionToken, nicknameInput) {
  const user = resolveUser_(sessionToken);
  if (!user.authenticated) throw new Error('請先登入。');

  const nickname = String(nicknameInput || '').replace(/[\r\n\t]/g, ' ').trim();
  if (!nickname || nickname.length > 20) {
    throw new Error('暱稱請輸入 1 到 20 個字。');
  }

  const ss = getSpreadsheet_();
  const player = getOrCreatePlayer_(ss, user.email);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const fresh = readPlayers_(ss)[user.email] || player;
    updateObject_(ss.getSheetByName(SHEET_PLAYERS), fresh._row, { nickname: nickname });
  } finally {
    lock.releaseLock();
  }
  return { ok: true, nickname: nickname };
}

// ==========================================
// 作業（任務）管理 — 教師
// ==========================================

function saveAssignment(sessionToken, payload) {
  const user = requireTeacher_(sessionToken, '權限不足：僅指定教師可建立或編輯作業。');

  const title = String(payload.title || '').trim();
  const description = String(payload.description || '').trim();
  const rubric = String(payload.rubric || '').trim();
  const maxScore = Math.max(1, Math.min(1000, Number(payload.maxScore) || 100));
  const isActive = payload.isActive !== false;
  const competenciesText = parseCompetencies_(payload.competencies)
    .map(function (c) { return c.name + ': ' + c.weight; })
    .join('\n');
  const xpReward = clampInt_(payload.xpReward, 0, 10000, 100);
  const difficulty = clampInt_(payload.difficulty, 1, 5, 1);
  const questType = payload.questType === 'side' ? 'side' : 'main';

  if (!title || !rubric) {
    throw new Error('請填寫「作業標題」與「評分標準」。');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName(SHEET_ASSIGNMENTS);
    const nowIso = new Date().toISOString();
    const fields = {
      title: title,
      description: description,
      rubric: rubric,
      maxScore: maxScore,
      isActive: isActive,
      updatedAt: nowIso,
      competencies: competenciesText,
      xpReward: xpReward,
      difficulty: difficulty,
      questType: questType
    };

    if (payload.assignmentId) {
      const target = readAssignments_(ss).find(function (a) {
        return a.assignmentId === String(payload.assignmentId);
      });
      if (!target) {
        throw new Error('找不到指定的作業 ID，無法更新。');
      }
      updateObject_(sheet, target._row, fields);
    } else {
      fields.assignmentId = 'ASG_' + Date.now();
      fields.createdBy = user.email;
      fields.createdAt = nowIso;
      appendObject_(sheet, fields);
    }

    return {
      ok: true,
      assignments: publicAssignments_(readAssignments_(ss))
    };
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// 教師後台
// ==========================================

function getTeacherDashboardData(sessionToken, assignmentIdFilter) {
  requireTeacher_(sessionToken, '權限不足：僅指定教師可檢視所有學生成績與內容。');

  const ss = getSpreadsheet_();
  const assignments = readAssignments_(ss);
  const players = readPlayers_(ss);
  const allWithFlags = markLatestFlags_(readAllSubmissionsRaw_(ss));
  const filtered = assignmentIdFilter
    ? allWithFlags.filter(function (s) { return s.assignmentId === assignmentIdFilter; })
    : allWithFlags;

  // 彙整每位學生最後一筆採計成績
  const studentSummaryMap = {};
  for (let i = 0; i < filtered.length; i++) {
    const s = filtered[i];
    const key = s.assignmentId + '||' + s.studentEmail;
    if (!studentSummaryMap[key]) {
      studentSummaryMap[key] = {
        assignmentId: s.assignmentId,
        studentEmail: s.studentEmail,
        totalAttempts: 0,
        latestSubmission: null
      };
    }
    studentSummaryMap[key].totalAttempts += 1;
    if (s.isLatest) {
      studentSummaryMap[key].latestSubmission = s;
    }
  }

  const studentSummaries = Object.keys(studentSummaryMap).map(function (k) {
    return studentSummaryMap[k];
  });

  // 每位學生的 RPG 檔案（不受作業篩選影響）
  const byStudent = {};
  allWithFlags.forEach(function (s) {
    (byStudent[s.studentEmail] = byStudent[s.studentEmail] || []).push(s);
  });
  const playerSummaries = Object.keys(byStudent).map(function (email) {
    const p = computePlayerProfile_(assignments, byStudent[email]);
    return {
      studentEmail: email,
      nickname: playerDisplayName_(players, email),
      isTeacher: isTeacherEmail_(email),
      level: p.level,
      title: p.title,
      totalXp: p.totalXp,
      stats: p.stats,
      badges: p.badges
    };
  }).sort(function (a, b) { return b.totalXp - a.totalXp; });

  return {
    allSubmissions: filtered.slice().reverse(),
    studentSummaries: studentSummaries,
    playerSummaries: playerSummaries,
    settings: readSettings_(ss)
  };
}

function saveGameSettings(sessionToken, payload) {
  requireTeacher_(sessionToken, '權限不足：僅指定教師可修改遊戲設定。');
  const ss = getSpreadsheet_();
  const persona = String(payload.mentorPersona || '').trim().slice(0, 300);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    writeSetting_(ss, 'leaderboardEnabled', payload.leaderboardEnabled !== false);
    writeSetting_(ss, 'mentorPersona', persona || DEFAULT_SETTINGS.mentorPersona);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, settings: readSettings_(ss) };
}
