/**
 * Data.gs — 試算表資料庫：初始化、以標題列對應欄位的讀寫、作業 / 繳交 / 玩家 / 設定
 *
 * 所有工作表都以「標題列名稱」對應欄位，新欄位一律加在最後面，
 * 既有試算表缺少的欄位會在載入時自動補上，不會打亂舊資料。
 */

const SHEET_ASSIGNMENTS = 'Assignments';
const SHEET_SUBMISSIONS = 'Submissions';
const SHEET_PLAYERS = 'Players';
const SHEET_SETTINGS = 'Settings';
const CELL_CHAR_LIMIT = 45000; // Google 試算表單一儲存格上限為 50,000 字元，保留安全緩衝

const SHEET_HEADERS = {
  Assignments: [
    'assignmentId', 'title', 'description', 'rubric',
    'maxScore', 'isActive', 'createdBy', 'createdAt', 'updatedAt',
    // RPG 擴充
    'competencies', 'xpReward', 'difficulty', 'questType'
  ],
  Submissions: [
    'submissionId', 'assignmentId', 'studentEmail', 'attemptNumber',
    'submittedAt', 'textContent', 'fileNames', 'filesTextContent',
    'filesTextOverflow', 'aiScore', 'aiReasoning', 'aiFeedback',
    'gradingStatus', 'modelUsed',
    // RPG 擴充
    'competencyResults', 'mentorComment', 'xpEarned'
  ],
  Players: ['email', 'nickname', 'createdAt'],
  Settings: ['key', 'value']
};

const DEFAULT_SETTINGS = {
  leaderboardEnabled: true,
  mentorPersona: '一位睿智、幽默又溫暖的老魔法師導師，稱呼學生為「年輕的冒險者」'
};

// ==========================================
// 試算表初始化
// ==========================================

function getSpreadsheet_() {
  let ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (err) {
    ss = null;
  }

  const props = getProps_();
  if (!ss) {
    const savedId = props.getProperty('SPREADSHEET_ID');
    if (savedId) {
      ss = SpreadsheetApp.openById(savedId);
    } else {
      ss = SpreadsheetApp.create('AI_評分RPG_資料庫');
      props.setProperty('SPREADSHEET_ID', ss.getId());
    }
  }

  ensureSheetsExist_(ss);
  return ss;
}

function ensureSheetsExist_(ss) {
  Object.keys(SHEET_HEADERS).forEach(function (name) {
    const wanted = SHEET_HEADERS[name];
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, wanted.length).setValues([wanted]);
      sheet.setFrozenRows(1);
      return;
    }
    // 既有工作表：補上缺少的欄位（加在最後面）
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    const current = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
    const missing = wanted.filter(function (h) { return current.indexOf(h) === -1; });
    if (missing.length) {
      const startCol = current.filter(Boolean).length === 0 ? 1 : lastCol + 1;
      sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    }
  });
}

// ==========================================
// 以標題列對應欄位的通用讀寫
// ==========================================

function getHeaderMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const map = {};
  headers.forEach(function (h, i) { if (h) map[h] = i; });
  return { headers: headers, map: map };
}

/** 讀取整張表為物件陣列，每筆附 _row（試算表列號） */
function readTable_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  const hm = getHeaderMap_(sheet);
  const values = sheet.getRange(2, 1, lastRow - 1, hm.headers.length).getValues();
  return values.map(function (r, idx) {
    const obj = { _row: idx + 2 };
    hm.headers.forEach(function (h, i) { if (h) obj[h] = r[i]; });
    return obj;
  });
}

/** 防止使用者輸入被試算表當成公式（=、+、-、@ 開頭） */
function safeCell_(v) {
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

function appendObject_(sheet, obj) {
  const hm = getHeaderMap_(sheet);
  const row = hm.headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(obj, h) ? safeCell_(obj[h]) : '';
  });
  sheet.appendRow(row);
}

function updateObject_(sheet, rowNumber, partial) {
  const hm = getHeaderMap_(sheet);
  Object.keys(partial).forEach(function (key) {
    if (hm.map[key] === undefined) return;
    sheet.getRange(rowNumber, hm.map[key] + 1).setValue(safeCell_(partial[key]));
  });
}

function formatCellDate_(val) {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function toBool_(v, fallback) {
  if (v === true || v === false) return v;
  const s = String(v).trim().toUpperCase();
  if (s === 'TRUE') return true;
  if (s === 'FALSE') return false;
  return fallback;
}

function clampInt_(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// ==========================================
// 作業
// ==========================================

function readAssignments_(ss) {
  return readTable_(ss.getSheetByName(SHEET_ASSIGNMENTS))
    .filter(function (r) { return Boolean(r.assignmentId); })
    .map(function (r) {
      const competenciesText = String(r.competencies || '');
      return {
        assignmentId: String(r.assignmentId),
        title: String(r.title || ''),
        description: String(r.description || ''),
        rubric: String(r.rubric || ''),
        maxScore: Number(r.maxScore) || 100,
        isActive: toBool_(r.isActive, true),
        createdBy: String(r.createdBy || ''),
        createdAt: formatCellDate_(r.createdAt),
        updatedAt: formatCellDate_(r.updatedAt),
        competenciesText: competenciesText,
        competencies: parseCompetencies_(competenciesText),
        xpReward: clampInt_(r.xpReward, 0, 10000, 100),
        difficulty: clampInt_(r.difficulty, 1, 5, 1),
        questType: String(r.questType || '') === 'side' ? 'side' : 'main',
        _row: r._row
      };
    })
    .reverse(); // 最新作業排在前面
}

// ==========================================
// 繳交紀錄
// ==========================================

function readAllSubmissionsRaw_(ss) {
  return readTable_(ss.getSheetByName(SHEET_SUBMISSIONS))
    .filter(function (r) { return Boolean(r.submissionId); })
    .map(function (r) {
      let competencyResults = [];
      try {
        competencyResults = r.competencyResults ? JSON.parse(String(r.competencyResults)) : [];
      } catch (e) {
        competencyResults = [];
      }
      return {
        rowIndex: r._row,
        submissionId: String(r.submissionId),
        assignmentId: String(r.assignmentId),
        studentEmail: String(r.studentEmail).trim().toLowerCase(),
        attemptNumber: Number(r.attemptNumber) || 1,
        submittedAt: formatCellDate_(r.submittedAt),
        textContent: String(r.textContent || ''),
        fileNames: String(r.fileNames || ''),
        filesFullText: String(r.filesTextContent || '') + String(r.filesTextOverflow || ''),
        aiScore: r.aiScore === '' || r.aiScore === undefined ? null : Number(r.aiScore),
        aiReasoning: String(r.aiReasoning || ''),
        aiFeedback: String(r.aiFeedback || ''),
        gradingStatus: String(r.gradingStatus || ''),
        modelUsed: String(r.modelUsed || ''),
        competencyResults: Array.isArray(competencyResults) ? competencyResults : [],
        mentorComment: String(r.mentorComment || ''),
        xpEarned: r.xpEarned === '' || r.xpEarned === undefined ? null : Number(r.xpEarned)
      };
    });
}

function markLatestFlags_(submissions) {
  // 依 (assignmentId + studentEmail) 找出最後一筆（attemptNumber 最大，或最後出現）
  const latestMap = {};
  for (let i = 0; i < submissions.length; i++) {
    const s = submissions[i];
    const key = s.assignmentId + '||' + s.studentEmail;
    if (!latestMap[key] || s.attemptNumber >= latestMap[key].attemptNumber) {
      latestMap[key] = s;
    }
  }
  return submissions.map(function (s) {
    const key = s.assignmentId + '||' + s.studentEmail;
    s.isLatest = (latestMap[key] && latestMap[key].submissionId === s.submissionId);
    return s;
  });
}

function readStudentSubmissions_(ss, studentEmail, allWithFlags) {
  const all = allWithFlags || markLatestFlags_(readAllSubmissionsRaw_(ss));
  return all
    .filter(function (s) { return s.studentEmail === studentEmail; })
    .reverse(); // 最新的在最上面
}

// ==========================================
// 玩家（暱稱）
// ==========================================

function readPlayers_(ss) {
  const map = {};
  readTable_(ss.getSheetByName(SHEET_PLAYERS)).forEach(function (r) {
    const email = String(r.email || '').trim().toLowerCase();
    if (email) map[email] = { email: email, nickname: String(r.nickname || ''), _row: r._row };
  });
  return map;
}

function defaultNickname_(email) {
  const local = String(email).split('@')[0] || '冒險者';
  return local.length > 3 ? local.slice(0, 3) + '***' : local + '***';
}

function getOrCreatePlayer_(ss, email) {
  const players = readPlayers_(ss);
  if (players[email]) return players[email];
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const again = readPlayers_(ss);
    if (again[email]) return again[email];
    const nickname = defaultNickname_(email);
    appendObject_(ss.getSheetByName(SHEET_PLAYERS), {
      email: email, nickname: nickname, createdAt: new Date().toISOString()
    });
    return { email: email, nickname: nickname };
  } finally {
    lock.releaseLock();
  }
}

function playerDisplayName_(players, email) {
  const p = players[email];
  return (p && p.nickname) ? p.nickname : defaultNickname_(email);
}

// ==========================================
// 遊戲設定
// ==========================================

function readSettings_(ss) {
  const settings = {
    leaderboardEnabled: DEFAULT_SETTINGS.leaderboardEnabled,
    mentorPersona: DEFAULT_SETTINGS.mentorPersona
  };
  readTable_(ss.getSheetByName(SHEET_SETTINGS)).forEach(function (r) {
    const key = String(r.key || '');
    if (key === 'leaderboardEnabled') settings.leaderboardEnabled = toBool_(r.value, true);
    if (key === 'mentorPersona' && String(r.value || '').trim()) settings.mentorPersona = String(r.value).trim();
  });
  return settings;
}

function writeSetting_(ss, key, value) {
  const sheet = ss.getSheetByName(SHEET_SETTINGS);
  const rows = readTable_(sheet);
  const found = rows.find(function (r) { return String(r.key) === key; });
  if (found) {
    updateObject_(sheet, found._row, { value: value });
  } else {
    appendObject_(sheet, { key: key, value: value });
  }
}
