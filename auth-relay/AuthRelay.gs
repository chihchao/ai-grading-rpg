/**
 * 獨立專案：AuthRelay.gs
 *
 * 部署設定：
 * - 執行身分：存取網頁應用程式的使用者 (User accessing the web app)
 * - 誰可以存取：擁有 Google 帳戶的所有人 (Anyone with a Google account)
 *
 * 指令碼屬性 (Script Properties) 需設定：
 * - MAIN_APP_URL : 主專案部署後的 Web App 網址（.../exec）
 * - AUTH_SECRET  : 與主專案指令碼屬性相同的自訂密鑰字串
 */
function doGet(e) {
  const props = PropertiesService.getScriptProperties();
  const mainAppUrl = (props.getProperty('MAIN_APP_URL') || '').trim();
  const authSecret = (props.getProperty('AUTH_SECRET') || '').trim();

  if (!mainAppUrl || !authSecret) {
    return HtmlService.createHtmlOutput(
      '系統設定不完整：請在 AuthRelay 專案的「指令碼屬性」設定 MAIN_APP_URL 與 AUTH_SECRET。'
    );
  }

  const email = Session.getActiveUser().getEmail();
  if (!email) {
    return HtmlService.createHtmlOutput(
      '無法取得 Google 帳號資訊，請確認瀏覽器已登入 Google 帳戶。'
    );
  }

  // 僅允許導回您設定的主程式網址，確保 Token 不外洩
  const targetUrl = (e && e.parameter && e.parameter.redirect && e.parameter.redirect.indexOf(mainAppUrl) === 0)
    ? e.parameter.redirect
    : mainAppUrl;

  const payload = {
    email: email,
    exp: Date.now() + 5 * 60 * 1000 // 5 分鐘內有效
  };
  const b64 = Utilities.base64EncodeWebSafe(Utilities.newBlob(JSON.stringify(payload)).getBytes());
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(b64, authSecret));
  const token = b64 + '.' + sig;

  const separator = targetUrl.indexOf('?') === -1 ? '?' : '&';
  const finalUrl = targetUrl + separator + 'authToken=' + encodeURIComponent(token);

  const safeEmail = email.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeUrl = finalUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  // 必須提供 target="_top" 連結由使用者點擊，以符合 GAS allow-top-navigation-by-user-activation 規範
  const html =
    '<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC",sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;}' +
    '.box{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;max-width:420px;width:100%;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.06);}' +
    '.btn{display:inline-block;margin-top:18px;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:1rem;}' +
    '.btn:hover{background:#1d4ed8;}' +
    '</style></head><body>' +
    '<div class="box">' +
    '<h2 style="margin-top:0;color:#0f172a;">Google 帳號驗證成功</h2>' +
    '<p style="color:#475569;line-height:1.6;">已確認您的登入身分：<br><strong>' + safeEmail + '</strong></p>' +
    '<a class="btn" href="' + safeUrl + '" target="_top">點擊進入 AI 評分 RPG</a>' +
    '</div></body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle('Google 帳號驗證完成')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
