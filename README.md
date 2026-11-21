# AI 評分 RPG（Google Apps Script + Gemini API）

以 [ai-grading-gas](https://github.com/chihchao/ai-grading-gas) 為基礎，把「作業繳交 + AI 自動評分」包裝成 RPG 冒險：

- **素養與核心能力 → RPG 能力值**：教師在每份作業列出培養的能力與權重，AI 逐項評價 0–100，累積成學生的能力雷達圖
- **經驗值與等級**：得分換算 XP，累積升級並獲得稱號
- **作業即任務**：任務板上的卡片顯示難度、XP 獎勵、主線或支線、可培養的能力
- **成就徽章**：初次冒險、完美通關、屢敗屢戰、全勤冒險者、素養專精、等級里程碑
- **排行榜**：只顯示暱稱、等級與 XP，教師可關閉
- **導師評語**：AI 以教師設定的角色口吻，額外寫一段鼓勵評語

**兩套介面，共用同一組後端與資料：**
- **3D 黏土風（預設）**：漂浮的黏土小島，每位學生都有一隻依 email 產生的專屬黏土角色（顏色、耳朵、眼睛、嘴巴、花紋、尾巴各不相同，等級越高配件越多）。任務是島上的小屋（主線）與蘑菇屋（支線），頭上的驚嘆號、旗子、金星代表待挑戰、已完成、滿分。用 WASD / 方向鍵、點地面，或在手機、平板上用左下角的虛擬搖桿讓角色走動，走到小屋門口的地墊就會打開作業上傳介面，走開會自動收起；點小屋或從任務清單選任務，角色會自己走過去。拖曳旋轉視角、滾輪或雙指縮放。
- **2D 介面**：網址加上 `?ui=2d`。教師後台（成績總覽、任務管理、冒險者一覽、遊戲設定）只在 2D 介面，3D 介面的「教師後台」按鈕會直接切過去。

原專案的功能全部保留：三種登入方式（同網域、Email OTP、AuthRelay）、多檔純文字上傳、`.ipynb` 圖片清理、可多次繳交且只採計最後一筆、重新評分、匯出 CSV。

---

## 專案結構

```text
ai-grading-rpg/
├── .clasp.json          # clasp 設定（rootDir: src；含個人 scriptId，已列入 .gitignore）
├── src/                 # ← clasp push 只會上傳這個資料夾
│   ├── appsscript.json  # 時區 Asia/Taipei、Web App 設定
│   ├── Code.gs          # doGet、初始化資料、任務管理、教師後台、遊戲設定
│   ├── Auth.gs          # 身份驗證（沿用原專案）
│   ├── Data.gs          # 試算表讀寫（依標題列對應欄位）
│   ├── Grading.gs       # 繳交、Gemini 評分、重新評分
│   ├── Rpg.gs           # RPG 規則：能力值、XP、等級、徽章、排行榜
│   ├── Shared.html      # 2D / 3D 共用前端：登入、檔案讀取、工具函式
│   ├── Index3D.html     # 3D 介面骨架（預設）
│   ├── Styles3D.html    # 3D 介面的黏土風樣式
│   ├── App3D.html       # 3D 介面的面板與互動
│   ├── Scene3D.html     # 3D 黏土島嶼場景（Three.js，從 CDN 載入）
│   ├── Index.html       # 2D 介面骨架（?ui=2d）
│   ├── Styles.html      # 2D 樣式
│   └── App.html         # 2D 前端程式
└── auth-relay/
    └── AuthRelay.gs     # 【選用】獨立 GAS 專案，外部 Gmail 一鍵登入用
```

## 開發流程（clasp）

```bash
clasp push        # 上傳 src/ 到 Apps Script
clasp open-script # 開啟 Apps Script 編輯器
clasp open-container # 開啟綁定的試算表
clasp pull        # 若曾在網頁編輯器修改，拉回本機
```

> `clasp push` 只會更新「測試部署」（`/dev` 網址）。正式的 `/exec` 網址要到「部署 → 管理部署 → 編輯 → 建立新版本」才會更新。

---

## 部署步驟

### 1. 設定指令碼屬性
Apps Script 編輯器 →「專案設定（齒輪）」→「指令碼屬性」：

| 屬性 | 必填 | 說明 |
| :--- | :---: | :--- |
| `GEMINI_API_KEY` | ✅ | [Google AI Studio](https://aistudio.google.com/) 申請的 API Key |
| `TEACHER_EMAILS` | ✅ | 教師 Email，可用逗號、分號或換行分隔 |
| `GEMINI_MODEL` | 選填 | 預設 `gemini-3.8-flash` |
| `AUTH_RELAY_URL` | 選填 | 啟用 AuthRelay 時填入其 `/exec` 網址 |
| `AUTH_SECRET` | 選填 | 與 AuthRelay 相同的密鑰 |

本專案綁定試算表，因此不需要 `SPREADSHEET_ID`。

### 2. 執行規則測試（建議）
在編輯器上方的函式選單選 `testRpgRules` → 執行。第一次會要求授權。「執行紀錄」應顯示「全部通過」。

### 3. 部署為網頁應用程式
「部署 →新增部署 → 網頁應用程式」：
- **執行身分**：我
- **誰可以存取**：同校 Workspace 選「[組織] 內的任何人」；需要外部 Gmail 選「擁有 Google 帳戶的所有人」

想先自己測試，可以用「部署 → 測試部署」的 `/dev` 網址，不必建立正式版本。

### 4.【選用】AuthRelay
與原專案相同，見 [ai-grading-gas 的說明](https://github.com/chihchao/ai-grading-gas#步驟四選用設定-authrelay-實現外部-gmail-一鍵登入)。程式碼在 `auth-relay/AuthRelay.gs`，需要另外建立一個獨立的 GAS 專案。

---

## RPG 規則

所有數值都從繳交紀錄**即時計算**，不另外儲存。教師重新評分或修改任務設定後，學生重新整理頁面就會看到更新後的數值。

| 項目 | 規則 |
| :--- | :--- |
| 採計 | 每份任務只採計**最後一筆**繳交（和成績一致），重複繳交無法刷數值 |
| XP | 任務 XP 獎勵 × 得分 / 滿分（四捨五入） |
| 等級 | 達到第 L 級需累積 `50 × L × (L−1)` XP：Lv2 = 100、Lv3 = 300、Lv5 = 1000、Lv10 = 4500 |
| 稱號 | Lv1 見習冒險者、Lv3 新手冒險者、Lv5 熟練冒險者、Lv8 菁英冒險者、Lv12 英雄、Lv16 傳說勇者 |
| 能力值 | 每項能力累加「權重 × AI 評價 / 100 × 10」，同名能力跨任務累積 |
| 排行榜 | 依總 XP 排序，教師帳號不列入 |

**能力清單格式**（任務表單的「培養的素養與核心能力」）：每行一項，`能力名稱: 權重`，權重 1–10，可省略（預設 1）。跨任務要使用**完全相同的名稱**，數值才會累積在同一項能力。

```text
邏輯思考: 3
問題解決: 2
資訊素養
```

**徽章**定義在 `src/Rpg.gs` 的 `BADGE_RULES`，要新增徽章時加一筆即可。

| 徽章 | 條件 |
| :--- | :--- |
| 🗡️ 初次冒險 | 第一次繳交 |
| 💎 完美通關 | 任一任務滿分 |
| 🔥 屢敗屢戰 | 重新挑戰後，分數比第一次進步滿分的 10% 以上 |
| 🏰 全勤冒險者 | 完成所有開放中的任務 |
| 📜 素養專精 | 任一能力值 ≥ 50 |
| ⭐ 嶄露頭角 | Lv 5 |
| 👑 名震四方 | Lv 10 |

---

## 試算表結構

首次載入時會自動建立工作表。如果工作表已存在但缺少欄位，會自動把缺少的欄位補在最後面。程式依標題列名稱讀寫，因此**請勿修改標題列名稱**。

- **Assignments**：原有欄位，再加上 `competencies`、`xpReward`、`difficulty`（1–5）、`questType`（`main` / `side`）
- **Submissions**：原有欄位，再加上 `competencyResults`（JSON）、`mentorComment`、`xpEarned`（評分當下的 XP，供紀錄用）
- **Players**：`email`、`nickname`、`createdAt`（學生第一次登入時建立，可自行改暱稱）
- **Settings**：`key` / `value`，包含 `leaderboardEnabled`、`mentorPersona`（在教師後台的「遊戲設定」修改）

學生輸入的文字如果以 `=`、`+`、`-`、`@` 開頭，寫入時會加上 `'`，避免被試算表當成公式執行。

---

## 3D 介面說明

- Three.js（0.170）與圓體字型 Huninn 由 CDN 載入，不需安裝套件。
- 瀏覽器不支援 WebGL，或 CDN 載入失敗（12 秒內沒完成）時，會自動改用「任務清單」面板，功能仍可完整使用。
- 島上的樹、花、草叢用固定亂數種子生成，每次載入版面相同，並會避開任務小屋與通往門口的小路。
- 角色外觀由 email（不分大小寫）雜湊決定，同一個人每次登入都一樣；只在瀏覽器端計算，不需要另存資料。
- 小屋門口朝向中央廣場；角色自動行走使用格子 A* 尋路，會繞過小屋與樹叢。
- 虛擬搖桿只在觸控裝置顯示，推得越遠走得越快；擋在鏡頭與角色之間的樹叢、小屋會自動變半透明。
- 角色配件：Lv3 小芽、Lv5 魔法帽、Lv8 圍巾、Lv12 皇冠、Lv16 光環。
- 場景程式集中在 `src/Scene3D.html`，對外只提供 `ClayWorld.init / setData / celebrate / walkToQuest / avatarLook` 幾個函式，要換造型或加物件只需改這個檔案。

