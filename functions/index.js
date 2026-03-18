/**
 * MiluSpa Cloud Functions
 * LINE Messaging API 版（LINE Notify 終了のため移行）
 *
 * Secrets（firebase functions:secrets:set で設定）:
 *   LINE_CHANNEL_ACCESS_TOKEN  — チャンネルアクセストークン（長期）
 *   LINE_OWNER_USER_ID         — オーナーのLINE User ID
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { onRequest }         = require('firebase-functions/v2/https')
const { defineSecret }      = require('firebase-functions/params')
const admin                 = require('firebase-admin')

admin.initializeApp()
const db = admin.firestore()

const LINE_TOKEN   = defineSecret('LINE_CHANNEL_ACCESS_TOKEN')
const LINE_USER_ID = defineSecret('LINE_OWNER_USER_ID')
const ADMIN_PW_SEC = defineSecret('ADMIN_PASSWORD')

// CORS ヘルパー
const cors = (res) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

// =============================================
// LINE Messaging API でプッシュ通知を送る
// =============================================
async function sendLineMessage(token, userId, text) {
  const { default: fetch } = await import('node-fetch')
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text }]
    })
  })
  const result = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(result))
  return result
}

// =============================================
// 1. Firestore トリガー：予約作成時にLINE通知
// =============================================
exports.notifyOnReservation = onDocumentCreated(
  { document: 'reservations/{docId}', secrets: [LINE_TOKEN, LINE_USER_ID] },
  async (event) => {
    const data  = event.data.data()
    const token  = LINE_TOKEN.value()
    const userId = LINE_USER_ID.value()
    if (!token || !userId) { console.error('LINE secrets not set'); return }

    const WDAYS = ['日','月','火','水','木','金','土']
    const [,m,d] = data.slot_date.split('-')
    const dow    = new Date(data.slot_date).getDay()

    const msg =
      `【新規ご予約 - MiluSpa】\n` +
      `📅 ${+m}月${+d}日（${WDAYS[dow]}） ${data.time_start.slice(0,5)}〜${data.time_end.slice(0,5)}\n` +
      `👤 ${data.customer_name}（${data.furigana}）\n` +
      `🔹 ${data.gender || '未記入'} / ${data.age ? data.age+'歳' : '未記入'}\n` +
      `📱 ${data.phone || 'なし'}\n` +
      `💬 ${data.message || 'なし'}`

    await sendLineMessage(token, userId, msg)
    console.log('LINE通知送信完了')
  }
)

// =============================================
// 2. 管理API（空き枠 CRUD・予約ステータス変更）
// =============================================
exports.adminApi = onRequest(
  { secrets: [LINE_TOKEN, LINE_USER_ID, ADMIN_PW_SEC] },
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
        case 'getSlots': {
          const { year, month } = params
          const pad  = n => String(n).padStart(2,'0')
          const last = new Date(year, month, 0).getDate()
          const s    = `${year}-${pad(month)}-01`
          const e    = `${year}-${pad(month)}-${pad(last)}`
          const snap = await db.collection('available_slots')
            .where('slot_date','>=',s).where('slot_date','<=',e)
            .orderBy('slot_date').orderBy('time_start').get()
          res.json({ slots: snap.docs.map(d => ({ id: d.id, ...d.data() })) })
          break
        }
        case 'addSlot': {
          const { slot_date, time_start, time_end } = params
          const ref = await db.collection('available_slots').add({
            slot_date, time_start, time_end,
            created_at: admin.firestore.FieldValue.serverTimestamp()
          })
          res.json({ id: ref.id })
          break
        }
        case 'deleteSlot': {
          await db.collection('available_slots').doc(params.slot_id).delete()
          res.json({ ok: true })
          break
        }
        case 'getReservations': {
          const snap = await db.collection('reservations')
            .orderBy('slot_date').orderBy('time_start').get()
          res.json({ reservations: snap.docs.map(d => ({ id: d.id, ...d.data() })) })
          break
        }
        case 'updateStatus': {
          const { reservation_id, status } = params
          if (!['pending','confirmed','cancelled','completed'].includes(status)) {
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

