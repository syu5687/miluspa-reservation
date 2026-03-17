# MiluSpa 予約管理システム（Firebase版）セットアップガイド

## ファイル構成

```
public/
  booking.html          ← 顧客向け予約ページ
  admin.html            ← 管理画面
functions/
  index.js              ← Cloud Functions（LINE通知 + 管理API）
  package.json
firestore.rules         ← Firestoreセキュリティルール
firestore.indexes.json  ← 複合インデックス定義
firebase.json           ← Firebase設定
```

---

## ステップ 1 — Firebase プロジェクト作成

1. https://console.firebase.google.com/ を開く
2. 「プロジェクトを追加」→ プロジェクト名: `miluspa-reservation`
3. Google Analytics は任意でOK

---

## ステップ 2 — Firebase CLI セットアップ

```bash
# Firebase CLIインストール（未インストールの場合）
npm install -g firebase-tools

# ログイン
firebase login

# このディレクトリで初期化
firebase use YOUR_PROJECT_ID
```

---

## ステップ 3 — Firestore 有効化

Firebase Console → Firestore Database → 「データベースの作成」
→ **本番環境モード** → リージョン: `asia-northeast1`（東京）

---

## ステップ 4 — Firebase Hosting 有効化

Firebase Console → Hosting → 「始める」

---

## ステップ 5 — Cloud Functions 有効化

Firebase Console → Functions → 「始める」
※ Blazeプラン（従量課金）へのアップグレードが必要です

---

## ステップ 6 — LINE Notify トークン取得

1. https://notify-bot.line.me/ にアクセス
2. LINEでログイン → 「マイページ」→「トークンを発行する」
3. トークン名: `MiluSpa予約通知`、通知先: 1:1
4. 発行されたトークンをコピー（一度しか表示されません）

---

## ステップ 7 — Secrets & デプロイ

```bash
# Functionsの依存パッケージインストール
cd functions && npm install && cd ..

# LINE Notify トークンを Secret に設定
firebase functions:secrets:set LINE_NOTIFY_TOKEN
# → プロンプトにトークンを貼り付けてEnter

# 管理者パスワードを Secret に設定（任意）
firebase functions:secrets:set ADMIN_PASSWORD
# → 好きなパスワードを入力

# Firestoreルール・インデックス・Functions・Hostingをまとめてデプロイ
firebase deploy
```

---

## ステップ 8 — HTMLファイルの設定

デプロイ後に Firebase Console → プロジェクトの設定 → マイアプリ →
「Firebase SDK の追加」でConfigを取得

**booking.html と admin.html の両方の FIREBASE_CONFIG を書き換え:**

```javascript
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSy...',
  authDomain:        'miluspa-reservation.firebaseapp.com',
  projectId:         'miluspa-reservation',
  storageBucket:     'miluspa-reservation.appspot.com',
  messagingSenderId: '123456789',
  appId:             '1:123456789:web:abc...'
}
```

**admin.html の ADMIN_API_URL も設定:**

```javascript
// Cloud Functions デプロイ後に表示されるURL
const ADMIN_API_URL = 'https://asia-northeast1-miluspa-reservation.cloudfunctions.net/adminApi'
```

---

## ステップ 9 — 再デプロイ & 動作確認

```bash
firebase deploy --only hosting
```

1. `https://YOUR_PROJECT_ID.web.app/booking.html` を開く
2. カレンダーが表示されることを確認（デモモードバナーが消えていればOK）
3. `admin.html` → パスワード: `miluspa2024`（またはSecret設定値）
4. 空き枠管理 → 日付を選択 → 枠を追加
5. booking.html でその日をタップして予約 → LINE通知が届くか確認

---

## Firestore コレクション構造

```
available_slots/          ← 空き枠
  {docId}/
    slot_date:  "2026-03-20"
    time_start: "10:00:00"
    time_end:   "11:00:00"
    created_at: Timestamp

reservations/             ← 予約
  {docId}/
    slot_id:       "abc123"
    slot_date:     "2026-03-20"
    time_start:    "10:00:00"
    time_end:      "11:00:00"
    customer_name: "山田 花子"
    furigana:      "やまだ はなこ"
    message:       "..."
    status:        "pending" | "confirmed" | "cancelled"
    created_at:    Timestamp
```

---

## 無料枠について（Sparkプラン）

| 項目 | 無料枠 |
|------|--------|
| Firestore 読み取り | 50,000回/日 |
| Firestore 書き込み | 20,000回/日 |
| Hosting 転送量 | 10GB/月 |
| Cloud Functions | **要Blazeプラン** |

> Cloud Functions を使わずLINE通知を省略する場合はSparkプランでも動作します。
> LINE通知が必要な場合はBlazeプラン（月1,000円程度〜）が必要です。
