/**
 * Auth.gs — 身份驗證模組（沿用 ai-grading-gas，支援同網域原生、Relay SSO、Email OTP）
 */

function getTeacherEmails_() {
  const raw = getProps_().getProperty('TEACHER_EMAILS') || '';
  return raw
    .split(/[\s,;]+/)
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(Boolean);
}

function isTeacherEmail_(email) {
  if (!email) return false;
  return getTeacherEmails_().indexOf(email.trim().toLowerCase()) !== -1;
}

function getSessionSecret_() {
  const props = getProps_();
  let secret = props.getProperty('_INTERNAL_SESSION_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + '-' + Utilities.getUuid();
    props.setProperty('_INTERNAL_SESSION_SECRET', secret);
  }
  return secret;
}

function signToken_(payloadObj, secret) {
  const json = JSON.stringify(payloadObj);
  const b64 = Utilities.base64EncodeWebSafe(Utilities.newBlob(json).getBytes());
  const sigBytes = Utilities.computeHmacSha256Signature(b64, secret);
  const sig = Utilities.base64EncodeWebSafe(sigBytes);
  return b64 + '.' + sig;
}

function verifyToken_(token, secret) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const b64 = parts[0];
  const sig = parts[1];

  const expectedSig = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(b64, secret)
  );
  if (sig !== expectedSig) return null;

  try {
    const json = Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString('UTF-8');
    const payload = JSON.parse(json);
    if (!payload.email || !payload.exp || Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch (e) {
    return null;
  }
}

function resolveUser_(sessionToken) {
  // 1. 優先嘗試 GAS 原生 Google 帳號（同 Workspace 網域或開發者本人可直接取得）
  let activeEmail = '';
  try {
    activeEmail = Session.getActiveUser().getEmail() || '';
  } catch (e) {
    activeEmail = '';
  }

  if (activeEmail) {
    const normalized = activeEmail.trim().toLowerCase();
    return {
      authenticated: true,
      email: normalized,
      isTeacher: isTeacherEmail_(normalized),
      authMethod: 'GOOGLE_SESSION'
    };
  }

  // 2. 檢查已簽章的 Session Token（透過 AuthRelay 或 Email OTP 登入）
  if (sessionToken) {
    const payload = verifyToken_(sessionToken, getSessionSecret_());
    if (payload && payload.email) {
      const normalized = payload.email.trim().toLowerCase();
      return {
        authenticated: true,
        email: normalized,
        isTeacher: isTeacherEmail_(normalized),
        authMethod: payload.method || 'TOKEN'
      };
    }
  }

  return { authenticated: false, email: '', isTeacher: false };
}

function exchangeRelayToken(relayToken) {
  const relaySecret = getProps_().getProperty('AUTH_SECRET');
  if (!relaySecret) {
    throw new Error('系統未設定 AUTH_SECRET，無法驗證 Relay Token。');
  }
  const payload = verifyToken_(relayToken, relaySecret);
  if (!payload || !payload.email) {
    throw new Error('Google 登入驗證逾時或無效，請重新登入。');
  }

  const email = payload.email.trim().toLowerCase();
  const sessionToken = signToken_(
    { email: email, method: 'GOOGLE_RELAY', exp: Date.now() + 24 * 60 * 60 * 1000 },
    getSessionSecret_()
  );
  return { sessionToken: sessionToken, email: email };
}

function requestEmailOtp(emailInput) {
  const email = String(emailInput || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('請輸入有效的 Google / Email 信箱格式。');
  }

  const cache = CacheService.getScriptCache();
  const rateKey = 'OTP_RATE_' + email;
  if (cache.get(rateKey)) {
    throw new Error('請勿頻繁發送驗證碼，請等待 60 秒後再試。');
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  cache.put('OTP_CODE_' + email, code, 600); // 10 分鐘有效
  cache.put(rateKey, '1', 60);

  MailApp.sendEmail({
    to: email,
    subject: '【AI 評分 RPG】您的登入驗證碼',
    body: '您好，\n\n您正在登入「AI 評分 RPG」，您的 6 位數驗證碼為：\n\n' +
      code + '\n\n驗證碼將於 10 分鐘後失效。若非本人操作請忽略此信。'
  });

  return { ok: true, message: '驗證碼已寄送至 ' + email + '，請於 10 分鐘內輸入。' };
}

function verifyEmailOtp(emailInput, codeInput) {
  const email = String(emailInput || '').trim().toLowerCase();
  const code = String(codeInput || '').trim();
  const cache = CacheService.getScriptCache();
  const savedCode = cache.get('OTP_CODE_' + email);

  if (!savedCode || savedCode !== code) {
    throw new Error('驗證碼錯誤或已過期，請重新取得。');
  }

  cache.remove('OTP_CODE_' + email);
  const sessionToken = signToken_(
    { email: email, method: 'EMAIL_OTP', exp: Date.now() + 24 * 60 * 60 * 1000 },
    getSessionSecret_()
  );
  return { sessionToken: sessionToken, email: email };
}
