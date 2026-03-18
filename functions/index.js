/**
 * MiluSpa Cloud Functions v20260318-0016
 *
 * Secrets:
 *   LINE_CHANNEL_ACCESS_TOKEN  — チャンネルアクセストークン（長期）
 *   LINE_OWNER_USER_ID         — オーナーのLINE User ID（Ai）
 *   ADMIN_PASSWORD             — 管理画面パスワード
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

const WDAYS = ['日','月','火','水','木','金','土']

const cors = (res) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

async function sendLinePush(token, userId, text) {
  const { default: fetch } = await import('node-fetch')
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] })
  })
  const j = await r.json()
  if (!r.ok) throw new Error(JSON.stringify(j))
}

async function replyLine(token, replyToken, text) {
  const { default: fetch } = await import('node-fetch')
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] })
  })
}

// =============================================
// 1. 予約作成時 → オーナーへLINE通知
// =============================================
exports.notifyOnReservation = onDocumentCreated(
  { document: 'reservations/{docId}', secrets: [LINE_TOKEN, LINE_USER_ID] },
  async (event) => {
    const data   = event.data.data()
    const token  = LINE_TOKEN.value()
    const userId = LINE_USER_ID.value()
    if (!token || !userId) return

    const [,m,d] = data.slot_date.split('-')
    const dow    = new Date(data.slot_date).getDay()

    const msg =
      '【新規ご予約 - MiluSpa】\n' +
      '📅 ' + (+m) + '月' + (+d) + '日（' + WDAYS[dow] + '） ' + data.time_start.slice(0,5) + '〜' + data.time_end.slice(0,5) + '\n' +
      '👤 ' + data.customer_name + '（' + data.furigana + '）\n' +
      '🌿 ' + (data.plan || '未選択') + '\n' +
      '📱 ' + (data.phone || 'なし') + '\n' +
      '💬 ' + (data.message || 'なし')

    await sendLinePush(token, userId, msg)
    console.log('オーナーへLINE通知完了')
  }
)

// =============================================
// 2. LINE Webhook：お客様の電話番号送信で予約確認を返信
// =============================================
exports.lineWebhook = onRequest(
  { secrets: [LINE_TOKEN], minInstances: 1 },
  async (req, res) => {
    res.status(200).send('OK')
    const token  = LINE_TOKEN.value()
    const events = req.body.events || []

    for (const event of events) {
      try {
        // フォロー時：案内を送る
        if (event.type === 'follow') {
          await replyLine(token, event.replyToken,
            'MiluSpa 公式LINEへようこそ🌿\n\n' +
            'ご予約後に電話番号を送っていただくと\n' +
            '予約確認メッセージをお送りします📅\n\n' +
            '例）090-1234-5678'
          )
          continue
        }

        if (event.type !== 'message' || event.message.type !== 'text') continue

        const userLineId = event.source.userId
        const text       = event.message.text.trim()
        const phoneRaw   = text.replace(/-/g, '')
        const isPhone    = /^0[0-9]{9,10}$/.test(phoneRaw)

        if (!isPhone) {
          await replyLine(token, event.replyToken,
            'ご連絡ありがとうございます🌿\n' +
            'スタッフが、送信された内容を確認中です\n\n' +
            '※予約内容の確認は、ご登録の電話番号を送ってください。\n\n' +
            '例）090-1234-5678'
          )
          continue
        }

        // 電話番号（ハイフンあり・なし）で予約を検索
        const withHyphen = phoneRaw.slice(0,3) + '-' + phoneRaw.slice(3,7) + '-' + phoneRaw.slice(7)
        let reservation  = null

        for (const fmt of [phoneRaw, withHyphen]) {
          // statusフィルタとorderByの複合インデックス不要のためシンプルなクエリに
          const snap = await db.collection('reservations')
            .where('phone', '==', fmt)
            .get()
          if (!snap.empty) {
            // クライアント側でstatus絞り込み・最新順ソート
            const docs = snap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .filter(r => r.status === 'pending' || r.status === 'confirmed')
              .sort((a, b) => {
                const ta = a.created_at ? (a.created_at.toMillis ? a.created_at.toMillis() : new Date(a.created_at).getTime()) : 0
                const tb = b.created_at ? (b.created_at.toMillis ? b.created_at.toMillis() : new Date(b.created_at).getTime()) : 0
                return tb - ta
              })
            if (docs.length > 0) {
              reservation = docs[0]
              break
            }
          }
        }

        if (!reservation) {
          await replyLine(token, event.replyToken,
            'ご予約が見つかりませんでした。\n\n' +
            '・予約時と同じ電話番号をご確認ください\n' +
            '・ご不明な点はこのLINEからご相談ください'
          )
          continue
        }

        // 予約確認メッセージを返信
        const [,m,d] = reservation.slot_date.split('-')
        const dow    = new Date(reservation.slot_date).getDay()
        const statusLabel = reservation.status === 'confirmed' ? '✅ 確認済み' : '⏳ 確認待ち'

        await replyLine(token, event.replyToken,
          '【ご予約確認 - MiluSpa🌿】\n\n' +
          reservation.customer_name + ' 様\n\n' +
          '📅 ' + (+m) + '月' + (+d) + '日（' + WDAYS[dow] + '）\n' +
          '🕐 ' + reservation.time_start.slice(0,5) + '〜' + reservation.time_end.slice(0,5) + '\n' +
          '📋 ' + statusLabel + '\n\n' +
          'ご予約ありがとうございます。\n' +
          'ご不明な点はこのLINEからご連絡ください😊'
        )

        // お客様のLINE IDを予約に保存
        await db.collection('reservations').doc(reservation.id).update({
          customer_line_id: userLineId
        })

      } catch(err) {
        console.error('Webhook error:', err)
      }
    }
  }
)

// =============================================
// 3. 管理API
// =============================================
exports.adminApi = onRequest(
  { secrets: [LINE_TOKEN, LINE_USER_ID, ADMIN_PW_SEC] },
  async (req, res) => {
    cors(res)
    if (req.method === 'OPTIONS') { res.status(204).send(''); return }
    if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return }

    const { action, password, ...params } = req.body
    const correctPw = ADMIN_PW_SEC.value() || 'miluspa2026'

    if (password !== correctPw) {
      res.status(401).json({ error: 'Unauthorized' }); return
    }

    try {
      switch (action) {
        case 'getSlots': {
          const { year, month } = params
          const pad  = n => String(n).padStart(2,'0')
          const last = new Date(year, month, 0).getDate()
          const s    = year + '-' + pad(month) + '-01'
          const e    = year + '-' + pad(month) + '-' + pad(last)
          const snap = await db.collection('available_slots')
            .where('slot_date','>=',s).where('slot_date','<=',e)
            .orderBy('slot_date').orderBy('time_start').get()
          res.json({ slots: snap.docs.map(d => ({ id: d.id, ...d.data() })) })
          break
        }
        case 'addSlot': {
          const ref = await db.collection('available_slots').add({
            slot_date: params.slot_date, time_start: params.time_start, time_end: params.time_end,
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
          if (!['pending','confirmed','cancelled','completed','archived'].includes(status)) {
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
