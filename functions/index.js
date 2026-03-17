/**
 * MiluSpa Cloud Functions
 *
 * 環境変数（firebase functions:secrets:set で設定）:
 *   LINE_NOTIFY_TOKEN  — LINE Notifyで発行したトークン
 *   ADMIN_PASSWORD     — 管理画面パスワード（デフォルト: miluspa2024）
 */

const { onRequest } = require('firebase-functions/v2/https')
const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { defineSecret } = require('firebase-functions/params')
const admin = require('firebase-admin')

admin.initializeApp()
const db = admin.firestore()

const LINE_TOKEN   = defineSecret('LINE_NOTIFY_TOKEN')
const ADMIN_PW_SEC = defineSecret('ADMIN_PASSWORD')

// CORS ヘルパー
const cors = (res) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

// =============================================
// 1. Firestore トリガー：予約作成時にLINE通知
// =============================================
exports.notifyOnReservation = onDocumentCreated(
  { document: 'reservations/{docId}', secrets: [LINE_TOKEN] },
  async (event) => {
    const data = event.data.data()
    const token = LINE_TOKEN.value()
    if (!token) { console.error('LINE_NOTIFY_TOKEN not set'); return }

    const WDAYS = ['日','月','火','水','木','金','土']
    const [,m,d] = data.slot_date.split('-')
    const dow = new Date(data.slot_date).getDay()
    const msg =
      `\n【新規ご予約 - MiluSpa】\n` +
      `日時：${+m}月${+d}日（${WDAYS[dow]}） ${data.time_start.slice(0,5)}〜${data.time_end.slice(0,5)}\n` +
      `お名前：${data.customer_name}（${data.furigana}）\n` +
      `メッセージ：${data.message || 'なし'}`

    const { default: fetch } = await import('node-fetch')
    await fetch('https://notify-api.line.me/api/notify', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `message=${encodeURIComponent(msg)}`,
    })
  }
)

// =============================================
// 2. 管理API：空き枠の追加・削除・予約ステータス変更
//    POST /adminApi  { action, password, ...params }
// =============================================
exports.adminApi = onRequest(
  { secrets: [LINE_TOKEN, ADMIN_PW_SEC] },
  async (req, res) => {
    cors(res)
    if (req.method === 'OPTIONS') { res.status(204).send(''); return }
    if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return }

    const { action, password, ...params } = req.body
    const correctPw = ADMIN_PW_SEC.value() || 'miluspa2024'

    if (password !== correctPw) {
      res.status(401).json({ error: 'Unauthorized' }); return
    }

    try {
      switch (action) {

        // 空き枠一覧（月指定）
        case 'getSlots': {
          const { year, month } = params
          const pad = n => String(n).padStart(2,'0')
          const last = new Date(year, month, 0).getDate()
          const s = `${year}-${pad(month)}-01`
          const e = `${year}-${pad(month)}-${pad(last)}`
          const snap = await db.collection('available_slots')
            .where('slot_date','>=',s).where('slot_date','<=',e)
            .orderBy('slot_date').orderBy('time_start').get()
          res.json({ slots: snap.docs.map(d => ({ id: d.id, ...d.data() })) })
          break
        }

        // 空き枠追加
        case 'addSlot': {
          const { slot_date, time_start, time_end } = params
          const ref = await db.collection('available_slots').add({
            slot_date, time_start, time_end, created_at: admin.firestore.FieldValue.serverTimestamp()
          })
          res.json({ id: ref.id })
          break
        }

        // 空き枠削除
        case 'deleteSlot': {
          await db.collection('available_slots').doc(params.slot_id).delete()
          res.json({ ok: true })
          break
        }

        // 予約一覧取得
        case 'getReservations': {
          const snap = await db.collection('reservations')
            .orderBy('slot_date').orderBy('time_start').get()
          res.json({ reservations: snap.docs.map(d => ({ id: d.id, ...d.data() })) })
          break
        }

        // 予約ステータス変更
        case 'updateStatus': {
          const { reservation_id, status } = params
          if (!['pending','confirmed','cancelled'].includes(status)) {
            res.status(400).json({ error: 'Invalid status' }); return
          }
          await db.collection('reservations').doc(reservation_id).update({ status })
          res.json({ ok: true })
          break
        }

        default:
          res.status(400).json({ error: 'Unknown action' })
      }
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: err.message })
    }
  }
)
