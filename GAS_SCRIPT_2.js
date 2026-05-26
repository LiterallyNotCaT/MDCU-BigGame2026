// ============================================================
// GOOGLE APPS SCRIPT - BigGame OAuth/Form Web App
// Deploy this as the OAUTH_GAS_URL endpoint.
//
// This file intentionally excludes the main game backend:
// - no bid/bet wave writes
// - no game-state writes
// - no bid/report chat writes
// - no password-login form auth
//
// Kept responsibilities:
// - OAuth permission/profile lookup
// - OAuth form state reads for web display
// - OAuth form score writes
// - OAuth admin form round lock/edit controls
// ============================================================

const MAIN_GAME_SHEET_ID = '1FKv1l9zpF85V_oUKQCjAjYyb4DZcMRCvN671DzU_Dq4'
const SHEET_ID = MAIN_GAME_SHEET_ID
const PASSWORD_GID = 1524637408
const FORM_CONFIG_RANGE = 'E3:H40'
const FORM_CONFIG_PUBLIC_CACHE_SECONDS = 60
const FORM_STATE_CACHE_SECONDS = 8
const FORM_SPREADSHEETS_BY_TAB = {
  'เช้าบน': '10Z4J30FlnX_iXgGsJfc-v-USho2mSDtKT_9uFLcDEnk',
  'เช้าล่าง': '1SwwS8hxhZmAwuMF_WZn8QweKmDY-fv5dJg_gMFA1zfs',
  'Games บ่าย': '17aDGTgeB1xIwXBPrbU0Fd5hXr3Qw_zSu1OZkas3EgZs',
}

// Leave blank when this Apps Script is bound to the login Google Sheet.
// If it is standalone, keep the OAuth login Sheet ID here.
const OAUTH_LOGIN_SHEET_ID = '105o7ABk2zn4ASM11wGjI3hw_UzT7NfRJlBzevJda1h0'
const OAUTH_LOGIN_SHEET_NAMES = ['Log In', 'LogIn', 'Login', 'OAuth Login', 'OAuth Log In', 'Form Login']
const OAUTH_LOGIN_DATA_START_ROW = 2
const OAUTH_LOGIN_MAX_ROWS = 250
const OAUTH_LOGIN_GAME_START_COL = 9 // I
const OAUTH_LOGIN_GAME_END_COL = 26 // Z
const OAUTH_LOGIN_SCAN_ROWS = 20

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON)
}

function doPost(e) {
  try {
    const payload = e && e.postData && e.postData.contents
      ? JSON.parse(e.postData.contents)
      : {}

    if (payload.action === 'readOAuthLogin') {
      return jsonResponse_(handleReadOAuthLogin(payload))
    }
    if (payload.action === 'readFormStatesOAuth') {
      return jsonResponse_(handleReadFormStatesOAuth(payload))
    }
    if (payload.action === 'writeFormScoreOAuth') {
      return jsonResponse_(handleWriteFormScoreOAuth(payload))
    }
    if (payload.action === 'setFormRoundControlOAuth') {
      return jsonResponse_(handleSetFormRoundControlOAuth(payload))
    }

    return jsonResponse_({ status: 'error', message: 'Unknown OAuth action' })
  } catch (err) {
    return jsonResponse_({
      status: 'error',
      message: String(err && err.message ? err.message : err),
    })
  }
}

function doGet() {
  return jsonResponse_({
    status: 'ok',
    message: 'BigGame OAuth GAS is running',
    actions: [
      'readOAuthLogin',
      'readFormStatesOAuth',
      'writeFormScoreOAuth',
      'setFormRoundControlOAuth',
    ],
  })
}

// ── Cache and lock helpers ───────────────────────────────────

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
    // Cache is best-effort. Never block form reads/writes because cache failed.
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
  FORM_WRITE_LOCK: 60000,
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
      // Retry until the named-lock deadline.
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

// ── Form config/state helpers used by OAuth form pages ───────

function formConfigCacheKey_() {
  return 'OAUTH_FORM_CONFIG_V13_PUBLIC'
}

function formStateCacheKey_(form) {
  return `OAUTH_FORM_STATE_V8_${cacheKeyPart_(form.formKey)}`
}

function invalidateFormState_(form) {
  cacheRemove_(formStateCacheKey_(form))
}

function inferFormMeta_(tab, user) {
  const normalized = String(user || '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (normalized === 'money drop') {
    return { kind: 'score-number', defaultFillToRank: 1, allowTies: false, blank: false, rankCount: 12, maxRounds: 4, usesAutoRemainder: false, autoAfterHouseCount: 0 }
  }
  if (normalized === 'snake ladder') {
    return { kind: 'score-unsigned', defaultFillToRank: 1, allowTies: false, blank: false, rankCount: 12, maxRounds: 4, usesAutoRemainder: false, autoAfterHouseCount: 0 }
  }
  if (normalized === 'event') {
    return { kind: 'placeholder', defaultFillToRank: 0, allowTies: false, blank: true, rankCount: 0, maxRounds: 0, usesAutoRemainder: false, autoAfterHouseCount: 0 }
  }
  if (normalized.indexOf('dodge ball') >= 0 || normalized.indexOf('territory control') >= 0) {
    return { kind: 'match-single', defaultFillToRank: 1, allowTies: false, blank: false, rankCount: 2, maxRounds: 6, usesAutoRemainder: false, autoAfterHouseCount: 0 }
  }
  if (normalized.indexOf('escape') >= 0 && String(tab) === 'เช้าบน') {
    return { kind: 'ranking-single', defaultFillToRank: 6, allowTies: false, blank: false, rankCount: 7, maxRounds: 2, usesAutoRemainder: true, autoAfterHouseCount: 6 }
  }
  if (normalized.indexOf('stacking block') >= 0 || normalized.indexOf('escape') >= 0) {
    return normalized.indexOf('escape') >= 0
      ? { kind: 'ranking-single', defaultFillToRank: 6, allowTies: false, blank: false, rankCount: 7, maxRounds: 2, usesAutoRemainder: true, autoAfterHouseCount: 6 }
      : { kind: 'ranking-single', defaultFillToRank: 4, allowTies: false, blank: false, rankCount: 4, maxRounds: 6, usesAutoRemainder: false, autoAfterHouseCount: 0 }
  }
  return { kind: 'ranking-group', defaultFillToRank: 3, allowTies: true, blank: false, rankCount: 4, maxRounds: String(tab) === 'เช้าบน' ? 4 : 0, usesAutoRemainder: true, autoAfterHouseCount: 3 }
}

function getPasswordSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID)
  return getSheetByGid_(ss, PASSWORD_GID)
}

function readFormConfigs_() {
  const cacheKey = formConfigCacheKey_()
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
    const gid = String(row[3] || '').trim()
    if (tabCell) currentTab = tabCell
    if (!currentTab || !user) return

    const spreadsheetId = FORM_SPREADSHEETS_BY_TAB[currentTab] || ''
    if (!spreadsheetId) return
    const meta = inferFormMeta_(currentTab, user)
    forms.push({
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
    })
  })

  cachePutJson_(cacheKey, forms, FORM_CONFIG_PUBLIC_CACHE_SECONDS)
  return forms
}

function findFormConfig_(formKey) {
  const forms = readFormConfigs_()
  return forms.find(form => String(form.formKey) === String(formKey)) || null
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

function formValueStartColumn_(form) {
  return form && form.kind === 'score-unsigned' ? 11 : 2
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

function normalizeScoreNumber_(value, allowNegative) {
  const compact = String(value || '').replace(/[,\s]/g, '').trim()
  const pattern = allowNegative === false ? /^\d+$/ : /^-?\d+$/
  if (!pattern.test(compact)) return ''
  const number = Number(compact)
  return Number.isSafeInteger(number) ? String(number) : ''
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
  const startColIndex = Math.max(1, formValueStartColumn_(form) - 1)
  let lastSheetColIndex = startColIndex - 1

  for (let col = startColIndex; col < lastCol; col++) {
    let hasData = false
    for (let row = 2; row <= 16; row++) {
      if (String(rows[row] && rows[row][col] || '').trim()) {
        hasData = true
        break
      }
    }
    if (hasData) lastSheetColIndex = col
  }

  let roundCount = Math.max(lastSheetColIndex - startColIndex + 1, 1)
  if (form.maxRounds) roundCount = Math.min(roundCount, form.maxRounds)

  const a3 = String(rows[2] && rows[2][0] || '').trim()
  const fillToRank = clampFormFill_(control.fillToRank || (/^\d+$/.test(a3) ? a3 : form.defaultFillToRank), form.defaultFillToRank)
  const rankCount = Math.max(0, Math.min(12, Number(form.rankCount || 12)))
  const rankLabels = rows.slice(3, 3 + rankCount).map((row, index) => String(row[0] || `Rank ${index + 1}`).trim())
  const values = rows.slice(3, 3 + rankCount).map(row => row.slice(startColIndex, startColIndex + roundCount).map(value => String(value || '').trim()))
  const rounds = []

  for (let offset = 0; offset < roundCount; offset++) {
    const col = startColIndex + offset
    const roundControl = control.rounds[String(offset)] || {}
    rounds.push({
      index: offset,
      label: String(rows[2] && rows[2][col] || `Round ${offset + 1}`).trim(),
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

function buildFormColumnValues_(form, values, fillToRank, participantsText) {
  const rowCount = Math.max(0, Math.min(12, Number(form.rankCount || 12)))
  const result = Array.from({ length: rowCount }, () => '')
  if (!Array.isArray(values)) throw new Error('Invalid values')
  if (form.kind === 'placeholder') throw new Error('This form is blank for now')

  if (form.kind === 'score-number' || form.kind === 'score-unsigned') {
    const allowNegative = form.kind === 'score-number'
    for (let i = 0; i < rowCount; i++) {
      const raw = values[i] || ''
      const normalized = normalizeScoreNumber_(raw, allowNegative)
      if (String(raw || '').trim() && !normalized) {
        throw new Error(allowNegative ? 'Money Drop accepts numbers only' : 'Snake Ladder accepts unsigned integers only')
      }
      result[i] = normalized
    }
    return result
  }

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

function getSheetByGid_(ss, gid) {
  return ss.getSheets().find(sheet => sheet.getSheetId() === Number(gid)) || null
}

// ── OAuth login and permissions ──────────────────────────────

function getOAuthLoginSheet_() {
  const spreadsheets = []
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet()
    if (active) spreadsheets.push(active)
  } catch (err) {
    // Standalone Apps Script may not have an active spreadsheet.
  }
  if (OAUTH_LOGIN_SHEET_ID) {
    try {
      const configured = SpreadsheetApp.openById(OAUTH_LOGIN_SHEET_ID)
      if (configured && !spreadsheets.some(ss => ss.getId && ss.getId() === configured.getId())) {
        spreadsheets.push(configured)
      }
    } catch (err) {
      // Keep trying the active spreadsheet if available.
    }
  }
  if (!spreadsheets.length) {
    throw new Error('OAuth login spreadsheet not found. Bind this script to the login sheet or set OAUTH_LOGIN_SHEET_ID.')
  }

  const normalizedNames = OAUTH_LOGIN_SHEET_NAMES.map(name => normalizeSheetName_(name))
  const tried = []
  for (const ss of spreadsheets) {
    for (const sheet of ss.getSheets()) {
      tried.push(`${ss.getName()}/${sheet.getName()}`)
      if (normalizedNames.indexOf(normalizeSheetName_(sheet.getName())) >= 0) return sheet
    }

    const tableSheet = ss.getSheets().find(sheet => looksLikeOAuthLoginSheet_(sheet))
    if (tableSheet) return tableSheet

    const sheets = ss.getSheets()
    if (sheets.length === 1) return sheets[0]
  }

  throw new Error(`OAuth login table not found. Checked tabs: ${tried.join(', ')}`)
}

function normalizeSheetName_(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9ก-๙]/g, '')
}

function looksLikeOAuthLoginSheet_(sheet) {
  try {
    return Boolean(detectOAuthLoginLayout_(sheet))
  } catch (err) {
    return false
  }
}

function normalizeHeaderCell_(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9ก-๙]/g, '')
}

function isOAuthRoleHeader_(value) {
  const normalized = normalizeHeaderCell_(value)
  return normalized === 'webrole' || normalized === 'role' || normalized.indexOf('role') >= 0
}

function detectOAuthLoginLayout_(sheet) {
  const lastCol = Math.max(OAUTH_LOGIN_GAME_END_COL, Math.min(sheet.getLastColumn(), 40), 8)
  const scanRows = Math.max(1, Math.min(OAUTH_LOGIN_SCAN_ROWS, sheet.getLastRow() || OAUTH_LOGIN_SCAN_ROWS))
  const values = sheet.getRange(1, 1, scanRows, lastCol).getDisplayValues()

  for (let rowIndex = 0; rowIndex < values.length; rowIndex++) {
    const row = values[rowIndex]
    let roleCol = -1
    for (let col = 0; col < row.length; col++) {
      if (isOAuthRoleHeader_(row[col])) {
        roleCol = col
        break
      }
    }
    if (roleCol < 0) continue

    const gameStartCol = Math.max(roleCol + 1, OAUTH_LOGIN_GAME_START_COL - 1)
    const gameHeaders = row.slice(gameStartCol, Math.min(row.length, OAUTH_LOGIN_GAME_END_COL))
      .map(value => String(value || '').trim())
      .filter(Boolean)
    if (!gameHeaders.length) continue

    return {
      headerRow: rowIndex + 1,
      dataStartRow: rowIndex + 2,
      roleCol: roleCol + 1,
      gameStartCol: gameStartCol + 1,
      gameEndCol: Math.min(row.length, OAUTH_LOGIN_GAME_END_COL),
    }
  }

  return null
}

function normalizeOAuthEmail_(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeOAuthGameKey_(value) {
  return String(value || '')
    .trim()
    .replace(/\s+[AB]$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function normalizeOAuthRole_(value) {
  const raw = String(value || '').trim()
  const compact = raw.toLowerCase().replace(/\s+/g, ' ')
  if (compact === 'admin') return 'ADMIN'
  if (compact === 'head/prasarn') return 'Head/Prasarn'
  if (compact === 'core team') return 'Core Team'
  if (compact === 'staff') return 'Staff'
  if (compact === 'banned') return 'Banned'
  return 'Viewer'
}

function isTruthyOAuthCell_(value) {
  return value === true || String(value || '').trim().toUpperCase() === 'TRUE'
}

function readOAuthProfile_(email) {
  const targetEmail = normalizeOAuthEmail_(email)
  if (!targetEmail) throw new Error('Missing OAuth email')

  const sheet = getOAuthLoginSheet_()
  const layout = detectOAuthLoginLayout_(sheet) || {
    headerRow: 1,
    dataStartRow: OAUTH_LOGIN_DATA_START_ROW,
    roleCol: 8,
    gameStartCol: OAUTH_LOGIN_GAME_START_COL,
    gameEndCol: OAUTH_LOGIN_GAME_END_COL,
  }
  const width = Math.max(layout.gameEndCol, layout.roleCol, OAUTH_LOGIN_GAME_END_COL)
  const gameHeaders = sheet
    .getRange(layout.headerRow, layout.gameStartCol, 1, layout.gameEndCol - layout.gameStartCol + 1)
    .getDisplayValues()[0]
  const maxRows = Math.max(1, Math.min(OAUTH_LOGIN_MAX_ROWS, Math.max(sheet.getLastRow() - layout.dataStartRow + 1, 1)))
  const rows = sheet
    .getRange(layout.dataStartRow, 1, maxRows, width)
    .getValues()

  const row = rows.find(item => normalizeOAuthEmail_(item[0]) === targetEmail)
  if (!row) {
    return {
      email: targetEmail,
      nickname: '',
      name: '',
      job: '',
      role: 'Viewer',
      editableGames: [],
      gameKeys: [],
      isAdmin: false,
    }
  }

  const role = normalizeOAuthRole_(row[layout.roleCol - 1])
  const editableGames = []
  const gameKeys = []
  gameHeaders.forEach((header, index) => {
    if (!header || !isTruthyOAuthCell_(row[layout.gameStartCol - 1 + index])) return
    editableGames.push(String(header).trim())
    gameKeys.push(normalizeOAuthGameKey_(header))
  })

  return {
    email: targetEmail,
    nickname: String(row[1] || '').trim(),
    name: String(row[2] || '').trim(),
    job: String(row[6] || '').trim(),
    role,
    editableGames,
    gameKeys,
    isAdmin: role === 'ADMIN',
  }
}

function oauthCanEditForm_(profile, form) {
  if (!profile || !form || form.blank || profile.role === 'Banned') return false
  if (profile.isAdmin) return true
  return profile.gameKeys.indexOf(normalizeOAuthGameKey_(form.user)) !== -1
}

function oauthCanViewForm_(profile, form) {
  if (!profile || !form || form.blank || profile.role === 'Banned') return false
  if (profile.isAdmin || profile.role === 'Head/Prasarn' || profile.role === 'Core Team') return true
  if (profile.role === 'Staff') return oauthCanEditForm_(profile, form)
  return false
}

function handleReadOAuthLogin(payload) {
  return { status: 'ok', profile: readOAuthProfile_(payload.email) }
}

function handleReadFormStatesOAuth(payload) {
  const profile = readOAuthProfile_(payload.email)
  const requested = Array.isArray(payload.formKeys)
    ? payload.formKeys.reduce((set, key) => {
      if (key) set[String(key)] = true
      return set
    }, {})
    : null
  const forms = readFormConfigs_()
  const states = {}
  const errors = {}

  forms.forEach(form => {
    if (requested && !requested[form.formKey]) return
    if (!oauthCanViewForm_(profile, form)) return
    try {
      states[form.formKey] = readFormState_(form)
    } catch (err) {
      errors[form.formKey] = String(err && err.message ? err.message : err)
    }
  })

  return { status: 'ok', states, errors }
}

function handleWriteFormScoreOAuth(payload) {
  const form = findFormConfig_(payload.formKey)
  if (!form) return { status: 'error', message: 'Form not found' }

  const profile = readOAuthProfile_(payload.email)
  if (!oauthCanEditForm_(profile, form)) return { status: 'error', message: 'This form is view-only for your account' }

  const roundIndex = Number(payload.roundIndex)
  if (!Number.isInteger(roundIndex) || roundIndex < 0) return { status: 'error', message: 'Invalid round' }
  const isAdmin = profile.isAdmin
  const sheet = openFormSheet_(form)
  let lock = null

  try {
    lock = acquireNamedLock_('FORM_WRITE_LOCK', 45000)

    const state = readFormStateFromSheet_(form, sheet)
    if (roundIndex >= state.rounds.length) return { status: 'error', message: 'Round not found' }
    const round = state.rounds[roundIndex]
    const now = new Date()

    const control = readFormControl_(form.formKey)
    const fillToRank = clampFormFill_(payload.fillToRank, form.defaultFillToRank)
    const participantsText = defaultParticipants_(payload.participants || round.participants)
    const values = buildFormColumnValues_(form, payload.values || [], fillToRank, participantsText)
    const col = formValueStartColumn_(form) + roundIndex

    sheet.getRange(4, col, values.length, 1).setValues(values.map(value => [value]))
    if (values.length < 12) sheet.getRange(4 + values.length, col, 12 - values.length, 1).clearContent()
    if (form.usesAutoRemainder === true) sheet.getRange(17, col).setValue(participantsText)

    const a3 = String(sheet.getRange(3, 1).getDisplayValue() || '').trim()
    if (/^\d+$/.test(a3)) sheet.getRange(3, 1).setValue(fillToRank)
    control.fillToRank = fillToRank
    control.rounds = control.rounds || {}
    control.rounds[String(roundIndex)] = {
      ...(control.rounds[String(roundIndex)] || {}),
      confirmed: true,
      locked: false,
      confirmedBy: profile.nickname || profile.email,
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
      message: /lock|busy|timeout/i.test(message) ? 'Form is busy. Please retry.' : message,
    }
  } finally {
    releaseNamedLock_(lock)
  }
}

function handleSetFormRoundControlOAuth(payload) {
  const profile = readOAuthProfile_(payload.email)
  if (!profile.isAdmin) return { status: 'error', message: 'Admin role required' }

  const form = findFormConfig_(payload.formKey)
  if (!form) return { status: 'error', message: 'Form not found' }
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
