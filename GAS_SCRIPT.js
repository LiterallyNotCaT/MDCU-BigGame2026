// ============================================================
// GOOGLE APPS SCRIPT — BigGame Web App
// Paste this entire file into Google Apps Script editor
// then Deploy as Web App (see setup steps below)
// ============================================================

const SHEET_ID = '1FKv1l9zpF85V_oUKQCjAjYyb4DZcMRCvN671DzU_Dq4'
const STATE_SHEET = 'GAME_STATE'
const CHAT_GID = 398958693
const REPORT_CHAT_GID = 1090774629
const PASSWORD_GID = 1524637408
const FORM_CONFIG_RANGE = 'E3:H33'
const FORM_CONFIG_PUBLIC_CACHE_SECONDS = 60
const FORM_CONFIG_PRIVATE_CACHE_SECONDS = 20
const FORM_STATE_CACHE_SECONDS = 8
const FORM_SPREADSHEETS_BY_TAB = {
  'เช้าบน': '10Z4J30FlnX_iXgGsJfc-v-USho2mSDtKT_9uFLcDEnk',
  'เช้าล่าง': '1SwwS8hxhZmAwuMF_WZn8QweKmDY-fv5dJg_gMFA1zfs',
  'Games บ่าย': '17aDGTgeB1xIwXBPrbU0Fd5hXr3Qw_zSu1OZkas3EgZs',
}
const WAVE_GIDS = {
  1: 1448591830,
}

// Row where data starts (row 5 in sheet = index 4 in GAS which is 1-based, so row 5)
const DATA_START_ROW = 5  // บ้าน 1 is at row 5
// บ้าน X is at row (DATA_START_ROW + X - 1)

// Column numbers (1-indexed, A=1, B=2, ...)
const COL = {
  BAAN:        1,   // A  - บ้านที่
  BALANCE:     2,   // B  - เงินก่อน (read-only, formula)
  BET_TARGET:  3,   // C  - Bet: บ้านที่เดิมพัน
  BET_AMOUNT:  4,   // D  - Bet: จำนวนเงิน
  // E = ได้คืน (formula, skip)
  KING_AMOUNT: 6,   // F  - King bid: จำนวนเงิน
  // G = ได้ king? (formula, skip)
  ISLAND1_NAME:  8, // H  - เกาะ 1: ชื่อเกาะ
  ISLAND1_AMT:   9, // I  - เกาะ 1: จำนวนเงิน
  // J = ได้คืน (formula, skip)
  ISLAND2_NAME: 11, // K  - เกาะ 2: ชื่อเกาะ
  ISLAND2_AMT:  12, // L  - เกาะ 2: จำนวนเงิน
  // M = ได้คืน (formula, skip)
  ISLAND3_NAME: 14, // N  - เกาะ 3: ชื่อเกาะ
  ISLAND3_AMT:  15, // O  - เกาะ 3: จำนวนเงิน
}

// ── Entry point ────────────────────────────────────────────
function doPost(e) {
  // CORS headers
  const output = ContentService.createTextOutput()
  output.setMimeType(ContentService.MimeType.JSON)

  try {
    const payload = JSON.parse(e.postData.contents)

    if (payload.action === 'writeWave') {
      const result = handleWriteWave(payload)
      output.setContent(JSON.stringify(result))
    } else if (payload.action === 'writeChat') {
      const result = handleWriteChat(payload)
      output.setContent(JSON.stringify(result))
    } else if (payload.action === 'writeGameState') {
      const result = handleWriteGameState(payload.state || {})
      output.setContent(JSON.stringify(result))
    } else if (payload.action === 'readFormConfig') {
      const result = handleReadFormConfig()
      output.setContent(JSON.stringify(result))
    } else if (payload.action === 'authFormUser') {
      const result = handleAuthFormUser(payload)
      output.setContent(JSON.stringify(result))
    } else if (payload.action === 'readFormState') {
      const result = handleReadFormState(payload)
      output.setContent(JSON.stringify(result))
    } else if (payload.action === 'readFormStates') {
      const result = handleReadFormStates(payload)
      output.setContent(JSON.stringify(result))
    } else if (payload.action === 'writeFormScore') {
      const result = handleWriteFormScore(payload)
      output.setContent(JSON.stringify(result))
    } else if (payload.action === 'setFormRoundControl') {
      const result = handleSetFormRoundControl(payload)
      output.setContent(JSON.stringify(result))
    } else {
      output.setContent(JSON.stringify({ status: 'error', message: 'Unknown action' }))
    }
  } catch (err) {
    output.setContent(JSON.stringify({ status: 'error', message: String(err) }))
  }

  return output
}

function handleWriteChat(payload) {
  const rawActor = payload.actor !== undefined ? payload.actor : payload.baan
  const actor = normalizeChatActor_(rawActor)
  const message = String(payload.message || '').trim()
  const replyToId = normalizeChatReplyId_(payload.replyToId)
  const topic = normalizeChatTopic_(payload.topic)
  let sendTo = normalizeChatRecipient_(payload.sendTo)
  if (!actor) return { status: 'error', message: 'Invalid chat actor' }
  if (!message) return { status: 'error', message: 'Message is blank' }
  if (chatActorKey_(sendTo) === chatActorKey_(actor)) sendTo = 'public'

  const ss = SpreadsheetApp.openById(SHEET_ID)
  const chatGid = topic === 'report' ? REPORT_CHAT_GID : CHAT_GID
  const sheet = getSheetByGid_(ss, chatGid)
  if (!sheet) return { status: 'error', message: `Chat sheet gid ${chatGid} not found` }
  const lockedReplyTarget = getPrivateReplyTarget_(sheet, replyToId, actor)
  if (lockedReplyTarget) sendTo = lockedReplyTarget

  let lock = null
  try {
    lock = acquireNamedLock_(topic === 'report' ? 'REPORT_CHAT_LOCK' : 'CHAT_LOCK', 10000)

    const targetRow = Math.max(sheet.getLastRow() + 1, 2)
    const previousRow = targetRow > 2 ? targetRow - 1 : 1
    const previousId = Number(sheet.getRange(previousRow, 1).getValue())
    const chatId = Number.isFinite(previousId) && previousId > 0 ? previousId + 1 : targetRow - 1

    const now = new Date()
    const timeZone = Session.getScriptTimeZone()
    const dateText = Utilities.formatDate(now, timeZone, 'M/d/yyyy')
    const timeText = Utilities.formatDate(now, timeZone, 'HH:mm')
    sheet.getRange(targetRow, 1, 1, 7).setValues([[
      chatId,
      dateText,
      timeText,
      actor,
      message.slice(0, 500),
      sendTo,
      replyToId,
    ]])
    SpreadsheetApp.flush()
    return { status: 'ok', row: targetRow, id: chatId }
  } catch (err) {
    return { status: 'error', message: 'Chat is busy. Please retry.' }
  } finally {
    releaseNamedLock_(lock)
  }
}

function normalizeChatActor_(actor) {
  const raw = String(actor || '').trim()
  if (raw.toLowerCase() === 'admin') return 'Admin'
  const baan = Number(raw)
  if (baan >= 1 && baan <= 12) return baan
  if (/^staff\s+/i.test(raw)) return raw.slice(0, 80)
  return ''
}

function normalizeChatRecipient_(recipient) {
  const raw = String(recipient || '').trim()
  const lower = raw.toLowerCase()
  if (!raw || lower === 'public' || lower === 'all') return 'public'
  if (lower === 'admin') return 'admin'
  const baan = Number(raw)
  if (baan >= 1 && baan <= 12) return baan
  if (/^staff\s+/i.test(raw)) return raw.slice(0, 80)
  return 'public'
}

function normalizeChatReplyId_(replyToId) {
  const id = Number(replyToId)
  return Number.isFinite(id) && id > 0 ? id : ''
}

function normalizeChatTopic_(topic) {
  const raw = String(topic || '').trim().toLowerCase()
  return raw === 'report' ? 'report' : 'bid'
}

function chatActorKey_(actor) {
  const normalized = normalizeChatActor_(actor) || normalizeChatRecipient_(actor)
  return String(normalized || '').toLowerCase()
}

function getPrivateReplyTarget_(sheet, replyToId, actor) {
  if (!replyToId) return ''
  const lastRow = sheet.getLastRow()
  if (lastRow < 2) return ''

  const rows = sheet.getRange(2, 1, lastRow - 1, 6).getValues()
  const replyRow = rows.find(row => String(row[0]).trim() === String(replyToId))
  if (!replyRow) return ''

  const originalSender = normalizeChatActor_(replyRow[3])
  const originalTarget = normalizeChatRecipient_(replyRow[5])
  if (!originalSender || !originalTarget || originalTarget === 'public') return ''

  const actorKey = chatActorKey_(actor)
  const senderKey = chatActorKey_(originalSender)
  const targetKey = chatActorKey_(originalTarget)

  if (senderKey && senderKey !== actorKey) return originalSender
  if (targetKey && targetKey !== actorKey) return originalTarget
  return ''
}

// Allow GET for health check
function doGet(e) {
  const ss = SpreadsheetApp.openById(SHEET_ID)
  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'ok',
      message: 'BigGame GAS is running',
      sheetId: SHEET_ID,
      sheets: ss.getSheets().map(s => ({ name: s.getName(), gid: s.getSheetId() })),
    }))
    .setMimeType(ContentService.MimeType.JSON)
}

function makeFormKey_(tab, user, gid) {
  return `${tab}|${user}|${gid}`
}

function cacheGetJson_(key) {
  try {
    const raw = CacheService.getScriptCache().get(key)
    return raw ? JSON.parse(raw) : null
  } catch (err) {
    return null
  }
}

function cachePutJson_(key, value, seconds) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), seconds)
  } catch (err) {
    // Cache is best-effort. Never block game/form writes because cache failed.
  }
}

function cacheRemove_(key) {
  try {
    CacheService.getScriptCache().remove(key)
  } catch (err) {
    // Cache is best-effort.
  }
}

function cacheKeyPart_(value) {
  return Utilities.base64EncodeWebSafe(String(value)).replace(/=+$/g, '').slice(0, 180)
}

const NAMED_LOCK_TTL_MS = 60000
const NAMED_LOCK_TTL_BY_NAME = {
  CHAT_LOCK: 20000,
  REPORT_CHAT_LOCK: 20000,
  FORM_WRITE_LOCK: 60000,
  WAVE_WRITE_LOCK: 60000,
}

function namedLockTtlMs_(name) {
  const normalized = String(name || '').toUpperCase()
  const ttl = NAMED_LOCK_TTL_BY_NAME[normalized]
  return Number.isFinite(ttl) && ttl >= 10000 ? ttl : NAMED_LOCK_TTL_MS
}

function namedLockKey_(name) {
  return `BG_NAMED_LOCK_${String(name || '').replace(/[^A-Z0-9_]/gi, '_')}`
}

function acquireNamedLock_(name, waitMs) {
  const key = namedLockKey_(name)
  const token = `${Utilities.getUuid()}_${Date.now()}`
  const deadline = Date.now() + Math.max(1000, Number(waitMs) || 30000)
  const ttlMs = namedLockTtlMs_(name)
  const props = PropertiesService.getScriptProperties()

  while (Date.now() < deadline) {
    const guard = LockService.getScriptLock()
    let guardLocked = false
    try {
      guard.waitLock(Math.min(5000, Math.max(1000, deadline - Date.now())))
      guardLocked = true
      const now = Date.now()
      const raw = props.getProperty(key)
      let active = null
      if (raw) {
        try {
          active = JSON.parse(raw)
        } catch (err) {
          active = null
        }
      }
      if (!active || Number(active.expiresAt || 0) <= now) {
        props.setProperty(key, JSON.stringify({ token, expiresAt: now + ttlMs }))
        return { key, token, name }
      }
    } catch (err) {
      // Retry until the named-lock deadline. The guard lock is held only while
      // reserving a lock name, not during the expensive sheet write itself.
    } finally {
      if (guardLocked) guard.releaseLock()
    }
    Utilities.sleep(120 + Math.floor(Math.random() * 180))
  }
  throw new Error(`${name} is busy`)
}

function releaseNamedLock_(lockInfo) {
  if (!lockInfo || !lockInfo.key || !lockInfo.token) return
  const guard = LockService.getScriptLock()
  let guardLocked = false
  try {
    guard.waitLock(5000)
    guardLocked = true
    const props = PropertiesService.getScriptProperties()
    const raw = props.getProperty(lockInfo.key)
    if (!raw) return
    let active = null
    try {
      active = JSON.parse(raw)
    } catch (err) {
      active = null
    }
    if (!active || active.token === lockInfo.token) props.deleteProperty(lockInfo.key)
  } catch (err) {
    // Expired named locks self-heal on the next acquire.
  } finally {
    if (guardLocked) guard.releaseLock()
  }
}

function formConfigCacheKey_(includePasswords) {
  return `FORM_CONFIG_V5_${includePasswords ? 'private' : 'public'}`
}

function formAdminPasswordCacheKey_() {
  return 'FORM_ADMIN_PASSWORD_V2'
}

function formStateCacheKey_(form) {
  return `FORM_STATE_V4_${cacheKeyPart_(form.formKey)}`
}

function invalidateFormState_(form) {
  cacheRemove_(formStateCacheKey_(form))
}

function inferFormMeta_(tab, user) {
  const normalized = String(user || '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (['event', 'snake ladder', 'money drop'].indexOf(normalized) >= 0) {
    return { kind: 'placeholder', defaultFillToRank: 0, allowTies: false, blank: true, rankCount: 0, maxRounds: 0, usesAutoRemainder: false, autoAfterHouseCount: 0 }
  }
  if (normalized.indexOf('dodge ball') >= 0 || normalized.indexOf('territory control') >= 0) {
    return { kind: 'match-single', defaultFillToRank: 1, allowTies: false, blank: false, rankCount: 2, maxRounds: 6, usesAutoRemainder: false, autoAfterHouseCount: 0 }
  }
  if (normalized.indexOf('stacking block') >= 0 || normalized.indexOf('escape') >= 0) {
    return { kind: 'ranking-single', defaultFillToRank: 4, allowTies: false, blank: false, rankCount: 4, maxRounds: 6, usesAutoRemainder: false, autoAfterHouseCount: 0 }
  }
  return { kind: 'ranking-group', defaultFillToRank: 3, allowTies: true, blank: false, rankCount: 4, maxRounds: String(tab) === 'เช้าบน' ? 4 : 0, usesAutoRemainder: true, autoAfterHouseCount: 3 }
}

function getPasswordSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID)
  return getSheetByGid_(ss, PASSWORD_GID)
}

function readFormConfigs_(includePasswords) {
  const cacheKey = formConfigCacheKey_(includePasswords)
  const cached = cacheGetJson_(cacheKey)
  if (Array.isArray(cached)) return cached

  const sheet = getPasswordSheet_()
  if (!sheet) throw new Error(`Password/config sheet gid ${PASSWORD_GID} not found`)

  const rows = sheet.getRange(FORM_CONFIG_RANGE).getDisplayValues()
  const forms = []
  let currentTab = ''
  rows.forEach(row => {
    const tabCell = String(row[0] || '').trim()
    const user = String(row[1] || '').trim()
    const password = String(row[2] || '').trim()
    const gid = String(row[3] || '').trim()
    if (tabCell) currentTab = tabCell
    if (!currentTab || !user) return

    const spreadsheetId = FORM_SPREADSHEETS_BY_TAB[currentTab] || ''
    if (!spreadsheetId) return
    const meta = inferFormMeta_(currentTab, user)
    const form = {
      formKey: makeFormKey_(currentTab, user, gid || '0'),
      tab: currentTab,
      user,
      gid: gid || '0',
      spreadsheetId,
      kind: meta.kind,
      defaultFillToRank: meta.defaultFillToRank,
      allowTies: meta.allowTies,
      blank: meta.blank,
      rankCount: meta.rankCount,
      maxRounds: meta.maxRounds,
      usesAutoRemainder: meta.usesAutoRemainder,
      autoAfterHouseCount: meta.autoAfterHouseCount,
    }
    if (includePasswords) form.password = password
    forms.push(form)
  })
  cachePutJson_(
    cacheKey,
    forms,
    includePasswords ? FORM_CONFIG_PRIVATE_CACHE_SECONDS : FORM_CONFIG_PUBLIC_CACHE_SECONDS
  )
  return forms
}

function findFormConfig_(formKey, includePassword) {
  const forms = readFormConfigs_(includePassword)
  return forms.find(form => String(form.formKey) === String(formKey)) || null
}

function getAdminPassword_() {
  const cached = cacheGetJson_(formAdminPasswordCacheKey_())
  if (cached && typeof cached.password === 'string') return cached.password

  const sheet = getPasswordSheet_()
  if (!sheet) return ''
  const formAdminPassword = String(sheet.getRange('G33').getDisplayValue() || '').trim()
  if (formAdminPassword) {
    cachePutJson_(formAdminPasswordCacheKey_(), { password: formAdminPassword }, FORM_CONFIG_PRIVATE_CACHE_SECONDS)
    return formAdminPassword
  }

  const rows = sheet.getRange('A1:B25').getDisplayValues()
  const password = String(rows[4] && rows[4][1] || '').trim()
  cachePutJson_(formAdminPasswordCacheKey_(), { password }, FORM_CONFIG_PRIVATE_CACHE_SECONDS)
  return password
}

function handleReadFormConfig() {
  const forms = readFormConfigs_(false)
  return { status: 'ok', forms }
}

function handleAuthFormUser(payload) {
  const password = String(payload.password || '')
  if (payload.admin === true) {
    const adminPassword = getAdminPassword_()
    if (!adminPassword || password !== adminPassword) return { status: 'error', ok: false, message: 'Wrong admin password' }
    return { status: 'ok', ok: true, role: 'admin', username: 'Admin' }
  }

  const form = findFormConfig_(payload.formKey, true)
  if (!form) return { status: 'error', ok: false, message: 'Form not found' }
  if (!form.password || password !== form.password) return { status: 'error', ok: false, message: 'Wrong password' }
  return {
    status: 'ok',
    ok: true,
    role: 'staff',
    username: form.user,
    formKey: form.formKey,
    state: form.blank ? null : readFormState_(form),
  }
}

function formControlKey_(formKey) {
  return `FORM_CONTROL_${Utilities.base64EncodeWebSafe(String(formKey)).slice(0, 180)}`
}

function readFormControl_(formKey) {
  const raw = PropertiesService.getScriptProperties().getProperty(formControlKey_(formKey))
  if (!raw) return { fillToRank: null, rounds: {} }
  try {
    const parsed = JSON.parse(raw)
    return {
      fillToRank: parsed.fillToRank || null,
      rounds: parsed.rounds || {},
    }
  } catch (err) {
    return { fillToRank: null, rounds: {} }
  }
}

function writeFormControl_(formKey, control) {
  PropertiesService.getScriptProperties().setProperty(formControlKey_(formKey), JSON.stringify(control))
}

function openFormSheet_(form) {
  const ss = SpreadsheetApp.openById(form.spreadsheetId)
  const sheet = getSheetByGid_(ss, form.gid)
  if (!sheet) throw new Error(`Form sheet gid ${form.gid} not found`)
  return sheet
}

function formNumber_(value) {
  const n = Number(String(value || '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

function clampFormFill_(value, fallback) {
  const n = Math.floor(formNumber_(value) || fallback || 3)
  return Math.max(1, Math.min(11, n))
}

function parseHouseList_(value) {
  const matches = String(value || '').match(/\d{1,2}/g) || []
  const seen = {}
  const result = []
  matches.forEach(raw => {
    const house = Number(raw)
    if (house >= 1 && house <= 12 && !seen[house]) {
      seen[house] = true
      result.push(house)
    }
  })
  return result
}

function formatHouseList_(houses) {
  return houses.join(', ')
}

function normalizeHouseText_(value, allowMany) {
  const houses = parseHouseList_(value)
  if (!houses.length) return ''
  return formatHouseList_(allowMany ? houses : houses.slice(0, 1))
}

function defaultParticipants_(value) {
  const houses = parseHouseList_(value)
  return formatHouseList_(houses.length ? houses : [1,2,3,4,5,6,7,8,9,10,11,12])
}

function remainderText_(participantsText, manualValues) {
  const participants = parseHouseList_(participantsText)
  const base = participants.length ? participants : [1,2,3,4,5,6,7,8,9,10,11,12]
  const used = {}
  manualValues.forEach(value => parseHouseList_(value).forEach(house => { used[house] = true }))
  return formatHouseList_(base.filter(house => !used[house]))
}

function readFormStateFromSheet_(form, sheet) {
  const lastCol = Math.min(Math.max(sheet.getLastColumn(), 2), 26)
  const rows = sheet.getRange(1, 1, 17, lastCol).getDisplayValues()
  const control = readFormControl_(form.formKey)
  let lastRoundIndex = 0
  for (let col = 1; col < lastCol; col++) {
    let hasData = false
    for (let row = 2; row <= 16; row++) {
      if (String(rows[row] && rows[row][col] || '').trim()) {
        hasData = true
        break
      }
    }
    if (hasData) lastRoundIndex = col
  }
  lastRoundIndex = Math.max(lastRoundIndex, 1)
  if (form.maxRounds) lastRoundIndex = Math.min(lastRoundIndex, form.maxRounds)

  const a3 = String(rows[2] && rows[2][0] || '').trim()
  const fillToRank = clampFormFill_(control.fillToRank || (/^\d+$/.test(a3) ? a3 : form.defaultFillToRank), form.defaultFillToRank)
  const rankCount = Math.max(0, Math.min(12, Number(form.rankCount || 12)))
  const rankLabels = rows.slice(3, 3 + rankCount).map((row, index) => String(row[0] || `Rank ${index + 1}`).trim())
  const values = rows.slice(3, 3 + rankCount).map(row => row.slice(1, lastRoundIndex + 1).map(value => String(value || '').trim()))
  const rounds = []
  for (let col = 1; col <= lastRoundIndex; col++) {
    const roundControl = control.rounds[String(col - 1)] || {}
    rounds.push({
      index: col - 1,
      label: String(rows[2] && rows[2][col] || `Round ${col}`).trim(),
      wave: String(rows[15] && rows[15][col] || '').trim(),
      participants: defaultParticipants_(String(rows[16] && rows[16][col] || '').trim()),
      confirmed: roundControl.confirmed === true,
      locked: roundControl.locked === true,
      deadlineAt: String(roundControl.deadlineAt || ''),
    })
  }

  return {
    form: {
      formKey: form.formKey,
      tab: form.tab,
      user: form.user,
      gid: form.gid,
      spreadsheetId: form.spreadsheetId,
      kind: form.kind,
      defaultFillToRank: form.defaultFillToRank,
      allowTies: form.allowTies,
      blank: form.blank,
      rankCount: form.rankCount,
      maxRounds: form.maxRounds,
      usesAutoRemainder: form.usesAutoRemainder,
      autoAfterHouseCount: form.autoAfterHouseCount,
    },
    title: String(rows[0] && rows[0][0] || form.user).trim(),
    fillToRank,
    rankLabels,
    rounds,
    values,
  }
}

function readFormState_(form, skipCache) {
  if (!skipCache) {
    const cached = cacheGetJson_(formStateCacheKey_(form))
    if (cached && cached.form && cached.form.formKey === form.formKey) return cached
  }

  const state = readFormStateFromSheet_(form, openFormSheet_(form))
  cachePutJson_(formStateCacheKey_(form), state, FORM_STATE_CACHE_SECONDS)
  return state
}

function handleReadFormState(payload) {
  const form = findFormConfig_(payload.formKey, false)
  if (!form) return { status: 'error', message: 'Form not found' }
  return { status: 'ok', state: readFormState_(form) }
}

function handleReadFormStates(payload) {
  const password = String(payload.password || '')
  if (!password || password !== getAdminPassword_()) return { status: 'error', message: 'Wrong admin password' }

  const requested = Array.isArray(payload.formKeys)
    ? payload.formKeys.reduce((set, key) => {
      if (key) set[String(key)] = true
      return set
    }, {})
    : null
  const forms = readFormConfigs_(false)
  const states = {}
  const errors = {}
  forms.forEach(form => {
    if (requested && !requested[form.formKey]) return
    if (form.blank) return
    try {
      states[form.formKey] = readFormState_(form)
    } catch (err) {
      errors[form.formKey] = String(err && err.message ? err.message : err)
    }
  })
  return { status: 'ok', states, errors }
}

function validateFormAuth_(form, payload) {
  const password = String(payload.password || '')
  if (payload.admin === true) {
    if (password && password === getAdminPassword_()) return { ok: true, role: 'admin', username: 'Admin' }
    return { ok: false, message: 'Wrong admin password' }
  }
  const fullForm = form && form.password !== undefined ? form : findFormConfig_(form.formKey, true)
  if (fullForm && fullForm.password && password === fullForm.password) return { ok: true, role: 'staff', username: fullForm.user }
  return { ok: false, message: 'Wrong password' }
}

function buildFormColumnValues_(form, values, fillToRank, participantsText) {
  const rowCount = Math.max(0, Math.min(12, Number(form.rankCount || 12)))
  const result = Array.from({ length: rowCount }, () => '')
  if (!Array.isArray(values)) throw new Error('Invalid values')
  if (form.kind === 'placeholder') throw new Error('This form is blank for now')

  const usesAutoRemainder = form.usesAutoRemainder === true
  const manualLimit = usesAutoRemainder ? fillToRank : rowCount
  const used = {}
  for (let i = 0; i < manualLimit; i++) {
    const normalized = normalizeHouseText_(values[i] || '', form.allowTies)
    const houses = parseHouseList_(normalized)
    if (!form.allowTies && houses.length > 1) throw new Error('Only one house per cell is allowed')
    houses.forEach(house => {
      if (used[house]) throw new Error(`House ${house} is repeated`)
      used[house] = true
    })
    result[i] = normalized
  }

  if (usesAutoRemainder && fillToRank < rowCount) {
    const manualValues = result.slice(0, fillToRank)
    const seen = {}
    manualValues.forEach(value => parseHouseList_(value).forEach(house => { seen[house] = true }))
    const enteredHouseCount = Object.keys(seen).length
    result[fillToRank] = enteredHouseCount >= (Number(form.autoAfterHouseCount) || fillToRank)
      ? remainderText_(participantsText, manualValues)
      : ''
  }
  return result
}

function handleWriteFormScore(payload) {
  const form = findFormConfig_(payload.formKey, true)
  if (!form) return { status: 'error', message: 'Form not found' }
  const auth = validateFormAuth_(form, payload)
  if (!auth.ok) return { status: 'error', message: auth.message || 'Unauthorized' }

  const roundIndex = Number(payload.roundIndex)
  if (!Number.isInteger(roundIndex) || roundIndex < 0) return { status: 'error', message: 'Invalid round' }
  const isAdmin = auth.role === 'admin'
  const sheet = openFormSheet_(form)
  let lock = null
  try {
    lock = acquireNamedLock_('FORM_WRITE_LOCK', 45000)

    const state = readFormStateFromSheet_(form, sheet)
    if (roundIndex >= state.rounds.length) return { status: 'error', message: 'Round not found' }
    const round = state.rounds[roundIndex]
    const now = new Date()
    if (!isAdmin) {
      if (round.confirmed) return { status: 'error', message: 'This round is already confirmed' }
      if (round.locked) return { status: 'error', message: 'This round is locked' }
      if (round.deadlineAt && now.getTime() > new Date(round.deadlineAt).getTime()) {
        return { status: 'error', message: 'This round is timed out' }
      }
    }

    const control = readFormControl_(form.formKey)
    const fillToRank = clampFormFill_(payload.fillToRank, form.defaultFillToRank)
    const participantsText = defaultParticipants_(payload.participants || round.participants)
    const values = buildFormColumnValues_(form, payload.values || [], fillToRank, participantsText)
    const col = roundIndex + 2

    sheet.getRange(4, col, values.length, 1).setValues(values.map(value => [value]))
    if (values.length < 12) sheet.getRange(4 + values.length, col, 12 - values.length, 1).clearContent()
    if (form.usesAutoRemainder === true) sheet.getRange(17, col).setValue(participantsText)

    // If A3 is already numeric, keep the sheet setting in sync. Otherwise keep
    // the visual table label untouched and store the setting in script props.
    const a3 = String(sheet.getRange(3, 1).getDisplayValue() || '').trim()
    if (/^\d+$/.test(a3)) sheet.getRange(3, 1).setValue(fillToRank)
    control.fillToRank = fillToRank
    control.rounds = control.rounds || {}
    control.rounds[String(roundIndex)] = {
      ...(control.rounds[String(roundIndex)] || {}),
      confirmed: true,
      locked: false,
      confirmedBy: auth.username,
      confirmedAt: now.toISOString(),
    }
    writeFormControl_(form.formKey, control)
    SpreadsheetApp.flush()
    invalidateFormState_(form)
    return { status: 'ok', message: `${form.user} ${round.label} saved`, roundIndex }
  } catch (err) {
    const message = String(err && err.message ? err.message : err)
    return {
      status: 'error',
      message: /lock|timeout|timed out/i.test(message) ? 'Form sheet is busy. Please retry.' : message,
    }
  } finally {
    releaseNamedLock_(lock)
  }
}

function handleSetFormRoundControl(payload) {
  const form = findFormConfig_(payload.formKey, false)
  if (!form) return { status: 'error', message: 'Form not found' }
  const password = String(payload.password || '')
  if (!password || password !== getAdminPassword_()) return { status: 'error', message: 'Wrong admin password' }
  const roundIndex = Number(payload.roundIndex)
  if (!Number.isInteger(roundIndex) || roundIndex < 0) return { status: 'error', message: 'Invalid round' }

  let lock = null
  try {
    lock = acquireNamedLock_('FORM_WRITE_LOCK', 20000)
    const control = readFormControl_(form.formKey)
    control.rounds = control.rounds || {}
    const round = control.rounds[String(roundIndex)] || {}
    if (payload.locked !== undefined) round.locked = payload.locked === true
    if (payload.confirmed !== undefined) round.confirmed = payload.confirmed === true
    if (payload.deadlineMinutes !== undefined) {
      const minutes = Math.max(1, Math.min(240, Number(payload.deadlineMinutes) || 10))
      round.deadlineAt = new Date(Date.now() + minutes * 60000).toISOString()
    }
    if (payload.clearDeadline === true) round.deadlineAt = ''
    control.rounds[String(roundIndex)] = round
    writeFormControl_(form.formKey, control)
    invalidateFormState_(form)
    return { status: 'ok', message: 'Form control updated' }
  } catch (err) {
    return { status: 'error', message: 'Form control is busy. Please retry.' }
  } finally {
    releaseNamedLock_(lock)
  }
}

function handleWriteGameState(state) {
  const wave = Number(state.currentWave)
  const duration = Number(state.duration || 10)
  if (!wave || wave < 1 || wave > 5) return { status: 'error', message: 'Invalid currentWave' }

  const ss = SpreadsheetApp.openById(SHEET_ID)
  let sheet = ss.getSheetByName(STATE_SHEET)
  if (!sheet) {
    sheet = ss.insertSheet(STATE_SHEET)
    sheet.hideSheet()
  }

  const rows = [
    ['currentWave', wave],
    ['isOpen', state.isOpen === true ? 'true' : 'false'],
    ['timerEnd', state.timerEnd || ''],
    ['duration', duration],
    ['gameMode', state.gameMode === 'bet' ? 'bet' : 'bid'],
    ['gamePhase', state.gamePhase === 'select-disaster' ? 'select-disaster' : 'play'],
    ['showResults', state.showResults === true ? 'true' : 'false'],
    ['ambassadorVisibility', JSON.stringify(state.ambassadorVisibility || {})],
    ['updatedAt', state.updatedAt || new Date().toISOString()],
  ]
  sheet.getRange(1, 1, rows.length, 2).setValues(rows)
  SpreadsheetApp.flush()
  return { status: 'ok', state: Object.fromEntries(rows) }
}

// ── Write one house's wave data ────────────────────────────
function isProvided_(value) {
  return value !== undefined && value !== null && value !== ''
}

function numberFrom_(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const cleaned = String(value || '').replace(/,/g, '').trim()
  if (!cleaned) return 0
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

function cellNumber_(range) {
  const raw = numberFrom_(range.getValue())
  if (raw !== 0) return raw
  return numberFrom_(range.getDisplayValue())
}

function rowCellNumber_(values, displayValues, col) {
  return numberFrom_(values[col - 1]) || numberFrom_(displayValues[col - 1])
}

function handleWriteWave(payload) {
  const { wave, baan, betTarget, betAmount, kingAmount, kingDisaster, islands } = payload
  const waveNumber = numberFrom_(wave)
  const baanNumber = numberFrom_(baan)
  const hasBetPayload = isProvided_(betTarget) || isProvided_(betAmount)
  const betTargetNumber = isProvided_(betTarget) ? numberFrom_(betTarget) : null
  const betAmountNumber = isProvided_(betAmount) ? numberFrom_(betAmount) : null
  const kingAmountNumber = isProvided_(kingAmount) ? numberFrom_(kingAmount) : null
  const hasKingDisasterPayload = kingDisaster !== undefined
  const kingDisasterNumber = isProvided_(kingDisaster) ? numberFrom_(kingDisaster) : null
  const normalizedIslands = Array.isArray(islands)
    ? islands
      .map(isl => ({ name: String(isl.name || '').trim().toUpperCase(), amount: numberFrom_(isl.amount) }))
      .filter(isl => isl.name)
    : []

  // Validate
  if (!waveNumber || waveNumber < 1 || waveNumber > 5)  return { status: 'error', message: 'Invalid wave' }
  if (!baanNumber || baanNumber < 1 || baanNumber > 12) return { status: 'error', message: 'Invalid baan' }
  if (hasBetPayload && (!betTargetNumber || betTargetNumber < 1 || betTargetNumber > 12 || !betAmountNumber)) {
    return { status: 'error', message: 'Invalid bet payload' }
  }
  if (kingDisasterNumber !== null && (kingDisasterNumber < 1 || kingDisasterNumber > 9)) {
    return { status: 'error', message: 'Invalid king disaster' }
  }
  if (kingAmountNumber !== null && kingAmountNumber < 100) {
    return { status: 'error', message: 'King bid minimum is 100' }
  }
  if (normalizedIslands.length > 0 && normalizedIslands.some(isl => isl.amount < 100)) {
    return { status: 'error', message: 'Island bid minimum is 100' }
  }

  let lock = null
  try {
    lock = acquireNamedLock_('WAVE_WRITE_LOCK', 45000)

  const ss        = SpreadsheetApp.openById(SHEET_ID)
  const sheetName = `Wave ${waveNumber}`
  const sheet     = getWaveSheet_(ss, waveNumber)
  if (!sheet) {
    return {
      status: 'error',
      message: `Sheet "${sheetName}" not found. Available sheets: ${ss.getSheets().map(s => s.getName()).join(', ')}`,
    }
  }

  // Row for this baan (บ้าน 1 = row 5, บ้าน 2 = row 6, ...)
  const row = DATA_START_ROW + baanNumber - 1
  const hasIslandPayload = normalizedIslands.length > 0
  const islandSpend = hasIslandPayload ? normalizedIslands.reduce((sum, isl) => sum + isl.amount, 0) : 0
  const hasDisasterOnlyPayload = hasKingDisasterPayload && !hasBetPayload && !hasIslandPayload && kingAmountNumber === null

  // Disaster selection is one shared INFO cell (H22) and should not be blocked by
  // bid/bet balance validation or existing spend in the player's row.
  if (hasDisasterOnlyPayload) {
    const disasterCell = sheet.getRange(22, 8)
    if (kingDisaster === null || kingDisaster === '') disasterCell.clearContent()
    else disasterCell.setValue(kingDisasterNumber)
    SpreadsheetApp.flush()
    return {
      status: 'ok',
      message: `บ้าน ${baanNumber} Wave ${waveNumber} saved disaster`,
      written: {
        row,
        kingDisaster: kingDisasterNumber,
        islands: [],
        totalSpend: 0,
        remainingBalance: null,
      }
    }
  }

  // ── Read current balance to validate ──────────────────
  const rowRange = sheet.getRange(row, 1, 1, COL.ISLAND3_AMT)
  const rowValues = rowRange.getValues()[0] || []
  const rowDisplayValues = rowRange.getDisplayValues()[0] || []
  const currentBalance = rowCellNumber_(rowValues, rowDisplayValues, COL.BALANCE)
  const minBetAmount = Math.ceil(currentBalance * 0.1)
  const existingBetSpend = rowCellNumber_(rowValues, rowDisplayValues, COL.BET_AMOUNT)
  const existingKingSpend = rowCellNumber_(rowValues, rowDisplayValues, COL.KING_AMOUNT)
  const existingIslandSpend =
    rowCellNumber_(rowValues, rowDisplayValues, COL.ISLAND1_AMT) +
    rowCellNumber_(rowValues, rowDisplayValues, COL.ISLAND2_AMT) +
    rowCellNumber_(rowValues, rowDisplayValues, COL.ISLAND3_AMT)
  const nextBetSpend = hasBetPayload ? (betAmountNumber || 0) : existingBetSpend
  const nextKingSpend = kingAmountNumber !== null ? kingAmountNumber : existingKingSpend
  const nextIslandSpend = hasIslandPayload ? islandSpend : existingIslandSpend
  const totalSpend = (hasBetPayload ? (betAmountNumber || 0) : 0) +
    (kingAmountNumber !== null ? kingAmountNumber : 0) +
    (hasIslandPayload ? islandSpend : 0)
  const totalSpendAfterSave = nextBetSpend + nextKingSpend + nextIslandSpend

  if (betAmountNumber !== null && betAmountNumber < minBetAmount) {
    return { status: 'error', message: `Bet minimum is ${minBetAmount}` }
  }
  if (totalSpend <= 0 && !hasDisasterOnlyPayload) {
    return {
      status: 'error',
      message: 'Amount must be greater than 0'
    }
  }
  if (!hasDisasterOnlyPayload && totalSpendAfterSave > currentBalance) {
    return {
      status: 'error',
      message: `ยอดรวม ${totalSpendAfterSave} เกินกว่า balance ${currentBalance}`
    }
  }

  // ── Write Bet game ─────────────────────────────────────
  if (betTargetNumber !== null) {
    sheet.getRange(row, COL.BET_TARGET).setValue(betTargetNumber)
  }
  if (betAmountNumber !== null) {
    sheet.getRange(row, COL.BET_AMOUNT).setValue(betAmountNumber)
  }

  // ── Write King bid ─────────────────────────────────────
  if (kingAmountNumber !== null) {
    sheet.getRange(row, COL.KING_AMOUNT).setValue(kingAmountNumber)
  }

  // Write this wave's king disaster to INFO cell H22.
  // H22 is shared per wave, so only the king client should send this field.
  if (hasKingDisasterPayload) {
    const disasterCell = sheet.getRange(22, 8)
    if (kingDisaster === null || kingDisaster === '') disasterCell.clearContent()
    else disasterCell.setValue(kingDisasterNumber)
  }

  // ── Write Islands (up to 3) ────────────────────────────
  const islandCols = [
    { name: COL.ISLAND1_NAME, amt: COL.ISLAND1_AMT },
    { name: COL.ISLAND2_NAME, amt: COL.ISLAND2_AMT },
    { name: COL.ISLAND3_NAME, amt: COL.ISLAND3_AMT },
  ]

  const islandList = hasIslandPayload ? normalizedIslands.slice(0, 3) : []
  if (hasIslandPayload) {
    // Clear existing island data first
    for (const c of islandCols) {
      sheet.getRange(row, c.name).clearContent()
      sheet.getRange(row, c.amt).clearContent()
    }

    // Write new island data
    islandList.forEach((isl, i) => {
      if (isl.name)   sheet.getRange(row, islandCols[i].name).setValue(isl.name)
      if (isl.amount) sheet.getRange(row, islandCols[i].amt).setValue(isl.amount)
    })
  }

  // ── Flush to sheet ─────────────────────────────────────
  SpreadsheetApp.flush()

  return {
    status: 'ok',
    message: `บ้าน ${baan} Wave ${wave} บันทึกแล้ว`,
    written: {
      row,
      betTarget: betTargetNumber,
      betAmount: betAmountNumber,
      kingAmount: kingAmountNumber,
      kingDisaster: kingDisasterNumber,
      islands: islandList,
      totalSpend,
      remainingBalance: currentBalance - totalSpendAfterSave,
    }
  }
  } catch (err) {
    const message = String(err && err.message ? err.message : err)
    return {
      status: 'error',
      message: /lock|timeout|timed out/i.test(message)
        ? 'Wave sheet is busy. Please retry.'
        : `Wave sheet write failed: ${message}`,
    }
  } finally {
    releaseNamedLock_(lock)
  }
}

function getWaveSheet_(ss, wave) {
  const gid = WAVE_GIDS[wave]
  if (gid) {
    const byGid = getSheetByGid_(ss, gid)
    if (byGid) return byGid
  }

  const candidates = [`Wave ${wave}`, `WAVE ${wave}`, `Wave${wave}`, `W${wave}`]
  for (const name of candidates) {
    const sheet = ss.getSheetByName(name)
    if (sheet) return sheet
  }

  const normalizedTarget = `wave${wave}`
  return ss.getSheets().find(sheet =>
    String(sheet.getName()).toLowerCase().replace(/\s+/g, '') === normalizedTarget
  ) || null
}

function getSheetByGid_(ss, gid) {
  return ss.getSheets().find(sheet => sheet.getSheetId() === Number(gid)) || null
}
