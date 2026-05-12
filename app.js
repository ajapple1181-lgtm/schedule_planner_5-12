/* =========================================================
   Day Conductor (Daily schedule planner)
   - fixed header/tabs
   - timeline fixed time axis + NOW dashed line
   - second30Start: 17:00〜21:30, :00/:15/:30 only (no :45)
   - remain label: subject name (or life block name)

   追加
   - 勉強は翌日 1:59:59 相当まで自動配置
   - 勉強タスクごとに開始時刻（任意）を設定可能
   - 科目/内容の「—」は自由記述
   - 生活設定の「準備」を削除
   - 生活設定の部活関連を削除
   - 生活ブロック追加の種類から 食事/風呂 を削除し、休憩を追加
   - テンプレ以外の生活ブロックは生活リストから編集可能
   - 範囲 + 1範囲あたり時間 があるタスクは、実行モーダル内で
     “今このあたりを進めているはず” の目安枠を教科色で点滅表示
   - 授業ブロックをタップすると1〜6限の時間割を確認・編集可能
   ========================================================= */

const STORAGE_KEY = "day_conductor_latest_v3";

/* ===== basic helpers ===== */
const pad2 = (n) => String(n).padStart(2, "0");
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseDateStr(s) {
  const [y, m, d] = String(s || "").split("-").map(v => parseInt(v, 10));
  return new Date(y, (m - 1), d, 0, 0, 0, 0);
}
function dateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function addDaysStr(s, days) {
  const d = parseDateStr(s);
  d.setDate(d.getDate() + days);
  return dateStr(d);
}
function weekdayJa(d) {
  return ["日","月","火","水","木","金","土"][d.getDay()];
}
function fmtMD(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function msOfDateTime(dateS, timeHM) {
  const d = parseDateStr(dateS);
  const [hh, mm] = String(timeHM || "").split(":").map(v => parseInt(v, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}
function timeToMin(hm) {
  const [h, m] = String(hm || "").split(":").map(v => parseInt(v, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}
function minToTime(m) {
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${pad2(hh)}:${pad2(mm)}`;
}
function fmtHMM(ms) {
  const d = new Date(ms);
  return `${d.getHours()}:${pad2(d.getMinutes())}`;
}
function fmtRange(startMs, endMs) {
  return `${fmtHMM(startMs)}-${fmtHMM(endMs)}`;
}
function fmtMS(sec) {
  const s = Math.max(0, Math.floor(sec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${pad2(ss)}`;
}
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(3);
}
function deepClone(o){ return JSON.parse(JSON.stringify(o)); }

/* ===== time policies ===== */
const NO_STUDY_BEFORE_MIN = 6 * 60;
const STUDY_DAY_END_MIN = 26 * 60;
const NEXT_DAY_STUDY_LIMIT_MIN = 2 * 60;

/* ===== second 30 move options ===== */
function buildSecondMoveOptions() {
  const out = [];
  for (let m = 17*60; m <= 21*60 + 30; m += 15) {
    if ((m % 60) === 45) continue;
    out.push(minToTime(m));
  }
  return out;
}
const SECOND_MOVE_OPTIONS = buildSecondMoveOptions();

/* ===== fixed timeline scale ===== */
const TL_SLOT_MIN = 15;
const TL_SLOT_H = 18;
const TL_PX_PER_MIN = TL_SLOT_H / TL_SLOT_MIN;
const TL_DAY_TOTAL_MIN = 24 * 60;
const TL_DAY_SLOTS = TL_DAY_TOTAL_MIN / TL_SLOT_MIN;

/* ===== subject config ===== */
const GROUPS = [
  { key:"none",  name:"—",      color:"gray" },
  { key:"jp",    name:"国語系", color:"pink" },
  { key:"math",  name:"数学系", color:"sky" },
  { key:"en",    name:"英語系", color:"purple" },
  { key:"sci",   name:"理科系", color:"lime" },
  { key:"soc",   name:"社会系", color:"yellow" },
  { key:"other", name:"その他", color:"gray" },
];

const SUBJECTS_BY_GROUP = {
  jp: ["論国", "古典"],
  math: ["数Ⅲ", "数C", "数学特論"],
  en: ["英C", "論表", "Ac R&L"],
  sci: ["化学", "生物"],
  soc: ["地理"],
  other: ["その他"],
};

const TASKTYPE_BY_SUBJECT = {
  "論国": ["—", "復習", "漢字", "現代文課題"],
  "古典": ["—", "予習", "復習", "古文単語", "古文課題", "漢文課題"],

  "数Ⅲ": ["—", "予習", "復習", "4STEP", "課題"],
  "数C": ["—", "予習", "復習", "4STEP", "課題"],
  "数学特論": ["—", "予習", "復習"],

  "英C": ["—", "予習", "復習", "CROWN", "Cutting Edge", "LEAP", "Scramble"],
  "論表": ["—", "予習", "復習", "Write to the point"],
  "Ac R&L": ["—", "復習"],

  "化学": ["—", "予習", "復習", "セミナー", "実験"],
  "生物": ["—", "予習", "復習", "セミナー", "実験"],

  "地理": ["—", "予習", "復習", "教科書"],

  "その他": ["—"],
};

function allTaskTypesUnion() {
  const set = new Set();
  Object.values(TASKTYPE_BY_SUBJECT).forEach(arr => arr.forEach(x => set.add(x)));
  const out = ["—"];
  [...set].filter(x => x !== "—").sort((a,b)=>a.localeCompare(b,"ja")).forEach(x=>out.push(x));
  return out;
}
const TASKTYPE_UNION = allTaskTypesUnion();

/* ===== timetable config ===== */
const PERIOD_LABELS = ["1限", "2限", "3限", "4限", "5限", "6限"];

function emptyTimetable() {
  return PERIOD_LABELS.map(() => ({
    groupKey: "none",
    subject: "",
    noClass: false,
  }));
}

function normalizeTimetable(timetable) {
  const base = emptyTimetable();
  if (!Array.isArray(timetable)) return base;

  for (let i = 0; i < 6; i++) {
    base[i] = {
      groupKey: timetable[i]?.groupKey || "none",
      subject: timetable[i]?.subject || "",
      noClass: !!timetable[i]?.noClass,
    };
  }

  return base;
     }

/* ===== life config ===== */
const LIFE_TYPE_OPTIONS = [
  "-", "休憩", "移動", "準備", "ラジオ", "テレビ", "爪切り", "散髪",
];

const LIFE_AUTO_MIN = {
  "休憩": 15,
  "移動": 30,
  "準備": 15,
  "ラジオ": 60,
  "テレビ": 60,
  "爪切り": 15,
  "散髪": 60,
};

function emptyLifeSettings() {
  return {
    lesson: "なし",

    morningMoveStart: "",
    morningMoveMin: "",

    lessonStart: "",
    lessonEnd: "",
    timetable: emptyTimetable(),

    returnMoveType: "",
    returnMoveBase: "",
    second30Start: "",

    breakfastUse: "なし",
    breakfastStart: "",
    breakfastMin: 30,

    lunchUse: "なし",
    lunchStart: "",
    lunchMin: 30,

    dinnerUse: "なし",
    dinnerStart: "",
    dinnerMin: 30,

    studyStart: "",

    bath: "なし",
    bathMin: "",
    bathStart: "",

    sleepUse: "なし",
    bedTime: "",
    wakeTime: "",

    customBlocks: [],
    __err: "",
  };
}

function normalizeLifeSettings(life) {
  const base = emptyLifeSettings();
  if (!life || typeof life !== "object") return deepClone(base);

  for (const [k, v] of Object.entries(base)) {
    if (!(k in life) || life[k] === undefined) life[k] = v;
  }

  // 旧データ対策：部活・準備設定は削除
  delete life.club;
  delete life.clubStart;
  delete life.clubEnd;
  delete life.prep;
  delete life.prepMin;

  if (!Array.isArray(life.customBlocks)) life.customBlocks = [];
  life.timetable = normalizeTimetable(life.timetable);

  const toInt = (val, def, lo, hi) => {
    const n = parseInt(val, 10);
    return clamp(Number.isFinite(n) ? n : def, lo, hi);
  };

  life.breakfastMin = toInt(life.breakfastMin ?? 30, 30, 1, 240);
  life.lunchMin = toInt(life.lunchMin ?? 30, 30, 1, 240);
  life.dinnerMin = toInt(life.dinnerMin ?? 30, 30, 1, 240);

  if (life.bath === "あり") {
    life.bathMin = toInt(life.bathMin ?? 60, 60, 1, 300);
  }

  return life;
}

/* ===== templates ===== */
function templateMonWedFri() {
  return {
    lesson: "あり",
    morningMoveStart: "07:00",
    morningMoveMin: 60,
    lessonStart: "08:30",
    lessonEnd: "15:30",
    timetable: emptyTimetable(),

    returnMoveType: "30x2",
    returnMoveBase: "",
    second30Start: "18:30",

    breakfastUse: "あり",
    breakfastStart: "06:30",
    breakfastMin: 30,

    lunchUse: "なし",
    lunchStart: "",
    lunchMin: 30,

    dinnerUse: "あり",
    dinnerStart: "",
    dinnerMin: 45,

    studyStart: "",

    bath: "あり",
    bathMin: 60,
    bathStart: "",
    sleepUse: "あり",
    bedTime: "23:30",
    wakeTime: "06:30",
    customBlocks: [],
    __err: "",
  };
}
function templateTueThu() {
  return {
    lesson: "あり",
    morningMoveStart: "07:00",
    morningMoveMin: 60,
    lessonStart: "08:30",
    lessonEnd: "16:30",
    timetable: emptyTimetable(),

    returnMoveType: "30x2",
    returnMoveBase: "",
    second30Start: "18:30",

    breakfastUse: "あり",
    breakfastStart: "06:30",
    breakfastMin: 30,

    lunchUse: "なし",
    lunchStart: "",
    lunchMin: 30,

    dinnerUse: "あり",
    dinnerStart: "",
    dinnerMin: 45,

    studyStart: "",

    bath: "あり",
    bathMin: 60,
    bathStart: "",
    sleepUse: "あり",
    bedTime: "23:30",
    wakeTime: "06:30",
    customBlocks: [],
    __err: "",
  };
}
function templateHoliday() {
  return {
    lesson: "なし",
    morningMoveStart: "08:00",
    morningMoveMin: 30,
    lessonStart: "",
    lessonEnd: "",
    timetable: emptyTimetable(),

    returnMoveType: "30",
    returnMoveBase: "",
    second30Start: "",

    breakfastUse: "あり",
    breakfastStart: "07:00",
    breakfastMin: 60,

    lunchUse: "あり",
    lunchStart: "",
    lunchMin: 45,

    dinnerUse: "あり",
    dinnerStart: "",
    dinnerMin: 45,

    studyStart: "",

    bath: "あり",
    bathMin: 60,
    bathStart: "",
    sleepUse: "あり",
    bedTime: "23:30",
    wakeTime: "06:30",
    customBlocks: [],
    __err: "",
  };
}
function templateByWeekday(dateS) {
  const d = parseDateStr(dateS);
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return templateHoliday();
  if (wd === 2 || wd === 4) return templateTueThu();
  return templateMonWedFri();
}

/* ===== state ===== */
function defaultState() {
  return {
    v: 3,
    activeTab: "life",
    selectedDate: todayStr(),
    lifeByDate: {},
    studyByDate: {},
    progressByTask: {},
    runner: {
      activeTaskId: null,
      isRunning: false,
      lastTick: 0,
      pausedByUser: false,
      arrivalShownTaskId: null,
    },
  };
}
let state = loadState();

/* ===== DOM refs ===== */
const tabLife = document.getElementById("tab-life");
const tabStudy = document.getElementById("tab-study");
const tabTimeline = document.getElementById("tab-timeline");
const tabBtns = [...document.querySelectorAll(".tabBtn")];

const nowClock = document.getElementById("nowClock");
const nowBtn = document.getElementById("nowBtn");

const remainPill = document.getElementById("remainPill");
const remainTime = document.getElementById("remainTime");
const remainLabel = document.getElementById("remainLabel");

const modalRoot = document.getElementById("modalRoot");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalFooter = document.getElementById("modalFooter");

let runnerUiTimer = null;

/* ===== storage ===== */
function migrateLoadedState(s) {
  const out = { ...defaultState(), ...(s || {}) };
  out.runner = { ...defaultState().runner, ...(s?.runner || {}) };
  if (!out.lifeByDate || typeof out.lifeByDate !== "object") out.lifeByDate = {};
  if (!out.studyByDate || typeof out.studyByDate !== "object") out.studyByDate = {};
  if (!out.progressByTask || typeof out.progressByTask !== "object") out.progressByTask = {};

  Object.keys(out.lifeByDate).forEach(k => {
    out.lifeByDate[k] = normalizeLifeSettings(out.lifeByDate[k] || emptyLifeSettings());
    delete out.lifeByDate[k].club;
    delete out.lifeByDate[k].clubStart;
    delete out.lifeByDate[k].clubEnd;
    delete out.lifeByDate[k].prep;
    delete out.lifeByDate[k].prepMin;
  });

  Object.keys(out.studyByDate).forEach(dateS => {
    out.studyByDate[dateS] = (out.studyByDate[dateS] || []).map(t => ({
      startTime: "",
      ...t,
    }));
  });

  return out;
}
function loadState() {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem("day_conductor_latest_v2") ||
      localStorage.getItem("day_conductor_latest_v1");

    if (!raw) return defaultState();
    return migrateLoadedState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ===== ui helpers ===== */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function wrapField(labelText, inputNode) {
  const box = el("div", "");
  box.appendChild(el("div", "label", labelText));
  box.appendChild(inputNode);
  return box;
}
function mkSelect(options, value, onChange, allowEmpty = false) {
  const s = document.createElement("select");
  if (allowEmpty) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "—";
    s.appendChild(o);
  }
  options.forEach(opt => {
    const value = typeof opt === "string" ? opt : opt.value;
    const text = typeof opt === "string" ? opt : opt.label;
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    s.appendChild(o);
  });
  s.value = value ?? "";
  s.addEventListener("change", () => onChange(s.value));
  return s;
}
function mkTimeInput(value, onChange, stepSec = 60, disabled = false) {
  const i = document.createElement("input");
  i.type = "time";
  i.step = String(stepSec);
  i.value = value || "";
  i.disabled = !!disabled;
  const commit = () => onChange(i.value);
  i.addEventListener("change", commit);
  i.addEventListener("blur", commit);
  return i;
}
function mkBtn(text, cls, onClick) {
  const b = el("button", `btn ${cls||""}`.trim(), text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}
function openModal(title, bodyNode, footerButtons) {
  modalTitle.textContent = title;
  modalBody.innerHTML = "";
  modalFooter.innerHTML = "";
  modalBody.appendChild(bodyNode);
  (footerButtons || []).forEach(btn => modalFooter.appendChild(btn));
  modalRoot.hidden = false;
  modalBody.scrollTop = 0;
}
function closeModal() {
  modalRoot.hidden = true;
  modalBody.innerHTML = "";
  modalFooter.innerHTML = "";
  if (runnerUiTimer) {
    clearInterval(runnerUiTimer);
    runnerUiTimer = null;
  }
}
modalRoot.addEventListener("click", (e) => {
  if (e.target.classList.contains("modalOverlay")) closeModal();
});
function showSimpleAlert(title, text) {
  const body = el("div", "grid1");
  body.appendChild(el("div", "", text));
  openModal(title, body, [mkBtn("OK", "btnPrimary", closeModal)]);
}

/* ===== fixed header height sync ===== */
function syncHeaderHeights() {
  const topbar = document.querySelector(".topbar");
  const tabs = document.querySelector(".tabs");
  if (!topbar || !tabs) return;
  document.documentElement.style.setProperty("--topbar-h", `${topbar.offsetHeight}px`);
  document.documentElement.style.setProperty("--tabs-h", `${tabs.offsetHeight}px`);
}
window.addEventListener("resize", syncHeaderHeights);

/* ===== ranges helpers ===== */
function parseRangeToken(s) {
  const m = String(s || "").trim().match(/^(\d+)(.*)$/);
  if (!m) return null;
  return { n: parseInt(m[1], 10), suffix: m[2] || "" };
}
function computeRangeSteps(ranges) {
  const out = [];
  for (const r of (ranges || [])) {
    const a = String(r?.start ?? "").trim();
    const b = String(r?.end ?? "").trim();
    if (!a && !b) continue;

    const pa = parseRangeToken(a);
    const pb = parseRangeToken(b);

    if (!pa || !pb || !Number.isFinite(pa.n) || !Number.isFinite(pb.n)) {
      out.push(a && b ? `${a}-${b}` : (a || b));
      continue;
    }

    const startN = pa.n;
    const endN = pb.n;

    if (startN === endN) {
      out.push(a || String(startN));
      continue;
    }
    if (startN < endN) {
      for (let k = startN; k <= endN; k++) {
        if (k === startN) out.push(a);
        else if (k === endN) out.push(b);
        else out.push(String(k));
      }
    } else {
      for (let k = startN; k >= endN; k--) {
        if (k === startN) out.push(a);
        else if (k === endN) out.push(b);
        else out.push(String(k));
      }
    }
  }
  return out;
}
function getTaskSteps(task) {
  const steps = computeRangeSteps(task?.ranges || []);
  if (steps.length === 0) return ["（範囲なし）"];
  return steps;
}
function hasRealSteps(task) {
  const steps = getTaskSteps(task);
  return !(steps.length === 1 && steps[0] === "（範囲なし）");
}

/* ===== find helpers ===== */
function findTaskById(taskId) {
  for (const [dateS, arr] of Object.entries(state.studyByDate || {})) {
    const idx = (arr || []).findIndex(t => t.id === taskId);
    if (idx >= 0) return { dateS, idx, task: arr[idx] };
  }
  return null;
}
function findCustomBlockById(dateS, cbId) {
  const life = normalizeLifeSettings(state.lifeByDate[dateS] || emptyLifeSettings());
  const idx = (life.customBlocks || []).findIndex(x => x.id === cbId);
  if (idx < 0) return null;
  return { life, idx, block: life.customBlocks[idx] };
}

/* ===== progress / runner ===== */
function ensureProgress(taskId, stepsLen) {
  const p = state.progressByTask[taskId] || { doneSteps: [], spentSec: 0 };
  if (!Array.isArray(p.doneSteps)) p.doneSteps = [];
  if (!Number.isFinite(p.spentSec)) p.spentSec = 0;

  if (p.doneSteps.length < stepsLen) p.doneSteps = p.doneSteps.concat(Array(stepsLen - p.doneSteps.length).fill(false));
  if (p.doneSteps.length > stepsLen) p.doneSteps = p.doneSteps.slice(0, stepsLen);

  state.progressByTask[taskId] = p;
  return p;
}
function countDone(doneSteps) {
  return (doneSteps || []).reduce((a, b) => a + (b ? 1 : 0), 0);
}
function computeTotalSec(task) {
  const steps = getTaskSteps(task);
  const prm = parseInt(task?.perRangeMin || "", 10);
  if (Number.isFinite(prm) && prm > 0 && hasRealSteps(task)) return steps.length * prm * 60;
  const dm = clamp(parseInt(task?.durationMin || "30", 10), 1, 2000);
  return dm * 60;
}
function isTaskComplete(taskId) {
  const found = findTaskById(taskId);
  if (!found) return false;
  const task = found.task;
  const steps = getTaskSteps(task);
  const p = ensureProgress(taskId, steps.length);
  const totalSec = computeTotalSec(task);
  return (countDone(p.doneSteps) === steps.length) || ((p.spentSec || 0) >= totalSec);
}
function runnerStart(taskId) {
  if (!taskId) return;
  state.runner.arrivalShownTaskId = null;
  state.runner.activeTaskId = taskId;
  state.runner.isRunning = true;
  state.runner.lastTick = Date.now();
  saveState();
}
function runnerStop() {
  state.runner.isRunning = false;
  state.runner.lastTick = 0;
  state.runner.activeTaskId = null;
  state.runner.pausedByUser = false;
  saveState();
}
function openArrivalDialog(taskId) {
  state.runner.arrivalShownTaskId = taskId;
  runnerStop();

  const found = findTaskById(taskId);
  const name = found ? `${found.task.subject}｜${found.task.taskType}` : "完了";

  const body = el("div", "grid1");
  const big = el("div", "", "到着");
  big.style.cssText = "font-size:36px;font-weight:1000;text-align:center;";
  const sub = el("div", "", name);
  sub.style.cssText = "text-align:center;color:rgba(238,243,255,.72);font-weight:1000;";
  body.appendChild(big);
  body.appendChild(sub);

  openModal("到着", body, [mkBtn("OK", "btnPrimary", closeModal)]);
}

/* ===== schedule ownership / dates ===== */
function belongsToDateByStart(block, dateS) {
  return dateStr(new Date(block.startMs)) === dateS;
}
function timelineDatesWindow(centerDateS) {
  const start = addDaysStr(centerDateS, -1);
  const days = [];
  for (let i=0;i<8;i++) days.push(addDaysStr(start, i));
  return days;
}
function studyTaskStartMsForDate(dateS, timeHM) {
  const m = timeToMin(timeHM);
  if (!Number.isFinite(m)) return NaN;

  // 0:00〜1:59は「その日の続き」として翌日に置く
  const targetDateS = (m < NEXT_DAY_STUDY_LIMIT_MIN) ? addDaysStr(dateS, 1) : dateS;
  return msOfDateTime(targetDateS, timeHM);
}

/* ===== build life blocks ===== */
function autoMealStartMs(kind, dateS, life, info) {
  const mins = kind === "breakfast" ? clamp(parseInt(life.breakfastMin || 30, 10), 1, 240)
            : kind === "lunch" ? clamp(parseInt(life.lunchMin || 30, 10), 1, 240)
            : clamp(parseInt(life.dinnerMin || 30, 10), 1, 240);
  const durMs = mins * 60 * 1000;

  if (kind === "breakfast") {
    if (life.breakfastStart) return msOfDateTime(dateS, life.breakfastStart);
    if (life.morningMoveStart) return msOfDateTime(dateS, life.morningMoveStart) - durMs;
    if (life.lessonStart) return msOfDateTime(dateS, life.lessonStart) - durMs;
    return NaN;
  }

  if (kind === "lunch") {
    if (life.lunchStart) return msOfDateTime(dateS, life.lunchStart);
    const anchor = Number.isFinite(info.middayAnchorMs) ? info.middayAnchorMs
                 : Number.isFinite(info.baseEndMs) ? info.baseEndMs
                 : NaN;
    return anchor;
  }

  if (life.dinnerStart) return msOfDateTime(dateS, life.dinnerStart);
  if (Number.isFinite(info.lastReturnEndMs)) return info.lastReturnEndMs;
  if (Number.isFinite(info.baseEndMs)) return info.baseEndMs;
  return NaN;
}

function buildLifeBlocksForDate(dateS, lifeRaw) {
  const life = normalizeLifeSettings(lifeRaw);
  const blocks = [];
  const push = (kind, name, startMs, endMs, meta={}) => {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;
    if (endMs <= startMs) return;
    blocks.push({ id: uid(), kind, name, startMs, endMs, meta });
  };

  for (const cb of (life.customBlocks || [])) {
    if (cb.mode === "minutes") {
      const st = msOfDateTime(dateS, cb.start || "");
      const mins = parseInt(cb.minutes || "0", 10);
      if (Number.isFinite(st) && Number.isFinite(mins) && mins > 0) {
        push("life", cb.type === "-" ? (cb.content || "-") : cb.type, st, st + mins * 60 * 1000, {
          source:"custom", cbId: cb.id, rawType: cb.type, content: cb.content || ""
        });
      }
    } else {
      const st = msOfDateTime(dateS, cb.start || "");
      let en = msOfDateTime(dateS, cb.end || "");
      if (Number.isFinite(st) && Number.isFinite(en)) {
        if (en <= st) en += 24 * 60 * 60 * 1000;
        push("life", cb.type === "-" ? (cb.content || "-") : cb.type, st, en, {
          source:"custom", cbId: cb.id, rawType: cb.type, content: cb.content || ""
        });
      }
    }
  }

  const hasLesson = (life.lesson === "あり");

  if (life.morningMoveStart) {
    const st = msOfDateTime(dateS, life.morningMoveStart);
    const mins = parseInt(life.morningMoveMin || "0", 10);
    if (Number.isFinite(st) && Number.isFinite(mins) && mins > 0) {
      push("life", "移動", st, st + mins * 60 * 1000, { source:"routine", move:"morning" });
    }
  }

  const info = {
    baseEndMs: NaN,
    middayAnchorMs: NaN,
    lastReturnEndMs: NaN,
  };

  if (hasLesson && life.lessonStart && life.lessonEnd) {
    const st = msOfDateTime(dateS, life.lessonStart);
    const en = msOfDateTime(dateS, life.lessonEnd);
    push("life", "授業", st, en, { source:"routine", lesson:true });
    info.baseEndMs = en;
    info.middayAnchorMs = en;
  }

// 帰り移動の開始時刻
  // 空欄なら授業終了時刻から自動。
  // 入力されている場合は、
  // 60分/30分 → その移動の開始時刻
  // 30分×2 → 最初の30分の移動開始時刻
  const returnStartMs = (() => {
    if (life.returnMoveBase) {
      const manual = msOfDateTime(dateS, life.returnMoveBase);
      if (Number.isFinite(manual)) return manual;
    }
    return info.baseEndMs;
  })();

  if (Number.isFinite(returnStartMs)) {
    if (life.returnMoveType === "60") {
      const moveEnd = returnStartMs + 60 * 60 * 1000;
      push("life", "移動", returnStartMs, moveEnd, {
        source:"routine",
        returnType:"60"
      });
      info.lastReturnEndMs = moveEnd;

    } else if (life.returnMoveType === "30") {
      const moveEnd = returnStartMs + 30 * 60 * 1000;
      push("life", "移動", returnStartMs, moveEnd, {
        source:"routine",
        returnType:"30"
      });
      info.lastReturnEndMs = moveEnd;

    } else if (life.returnMoveType === "30x2") {
      const move1End = returnStartMs + 30 * 60 * 1000;
      push("life", "移動", returnStartMs, move1End, {
        source:"routine",
        returnType:"30x2-1"
      });
      info.lastReturnEndMs = move1End;

      if (life.second30Start) {
        const st2 = msOfDateTime(dateS, life.second30Start);
        if (Number.isFinite(st2) && st2 >= move1End) {
          const move2End = st2 + 30 * 60 * 1000;
          push("life", "移動", st2, move2End, {
            source:"routine",
            returnType:"30x2-2"
          });
          info.lastReturnEndMs = move2End;
        }
      }
    }
  }

  const dinnerSt = autoMealStartMs("dinner", dateS, life, info);
  if (life.dinnerUse === "あり" && Number.isFinite(dinnerSt)) {
    push("life", "夕食", dinnerSt, dinnerSt + life.dinnerMin * 60 * 1000, { source:"routine", meal:"dinner" });
  }

  if (life.bath === "あり" && life.bathStart) {
    const st = msOfDateTime(dateS, life.bathStart);
    if (Number.isFinite(st)) {
      push("life", "風呂", st, st + life.bathMin * 60 * 1000, {
        source: "routine",
        bathManual: true
      });
    }
  }

  return blocks;
}

function computeSleepBlock(dateS, lifeRaw) {
  const life = normalizeLifeSettings(lifeRaw);
  if (life.sleepUse !== "あり") return null;
  if (!life.bedTime || !life.wakeTime) return { err: "就寝時刻と起床時刻を入れてください。" };

  const bedMin = timeToMin(life.bedTime);
  const wakeMin = timeToMin(life.wakeTime);
  if (!Number.isFinite(bedMin) || !Number.isFinite(wakeMin)) return { err: "就寝/起床の時刻が不正です。" };

  const bedOnNext = bedMin < 18*60;
  const bedDateS = addDaysStr(dateS, bedOnNext ? 1 : 0);
  const bedMs = msOfDateTime(bedDateS, life.bedTime);

  let wakeMs = msOfDateTime(bedDateS, life.wakeTime);
  if (wakeMs <= bedMs) wakeMs += 24*60*60*1000;

  const durH = (wakeMs - bedMs) / (60*60*1000);
  if (durH > 9 + 1e-9) return { err: "起床は就寝から9時間以内にしてください。" };

  return { bedMs, wakeMs, bedDateS };
}

function buildEndOfDayBlocks(dateS, lifeRaw, existingBlocks) {
  const life = normalizeLifeSettings(lifeRaw);
  const blocks = [];

  const sleepInfo = computeSleepBlock(dateS, life);
  if (sleepInfo && sleepInfo.err) return { blocks: [], err: sleepInfo.err };

  if (life.bath === "あり" && !life.bathStart && sleepInfo?.bedMs) {
    const st = sleepInfo.bedMs - life.bathMin * 60 * 1000;
    blocks.push({
      id: uid(),
      kind: "life",
      name: "風呂",
      startMs: st,
      endMs: sleepInfo.bedMs,
      meta: { source:"routine", bathManual: false }
    });
  }

  if (sleepInfo?.bedMs && sleepInfo?.wakeMs) {
    const temp = existingBlocks.concat(blocks);
    const ov = findOverlap(temp);
    if (ov) return { blocks: [], err: "設定が重なっています。" };

    blocks.push({
      id: uid(),
      kind: "life",
      name: "就寝",
      startMs: sleepInfo.bedMs,
      endMs: sleepInfo.wakeMs,
      meta: { source:"routine", sleep:true }
    });
  }

  return { blocks, err: null };
}

/* ===== overlap / collection ===== */
function findOverlap(blocks) {
  const a = [...blocks].sort((x,y)=>x.startMs-y.startMs);
  for (let i=0;i<a.length-1;i++){
    if (a[i].endMs > a[i+1].startMs) return [a[i], a[i+1]];
  }
  return null;
}
function collectBlocksIntersectWindow(blocks, windowStart, windowEnd) {
  return (blocks || [])
    .filter(b => b.endMs > windowStart && b.startMs < windowEnd)
    .map(b => ({
      ...b,
      startMs: Math.max(b.startMs, windowStart),
      endMs: Math.min(b.endMs, windowEnd),
    }))
    .sort((a,b)=>a.startMs-b.startMs);
}
function earliestStudyStartMs(dateS, occBlocks, lifeRaw) {
  const dayStart = parseDateStr(dateS).getTime();
  const life = normalizeLifeSettings(lifeRaw);

  // 朝も勉強できるようにする。
  // ただし初期値は6:00以降。睡眠・朝食・移動などの生活ブロックとは重ならない。
  let earliest = dayStart + NO_STUDY_BEFORE_MIN * 60 * 1000;

  // 勉強開始（任意）が入っている場合は、それを優先する。
  if (life.studyStart) {
    const s = msOfDateTime(dateS, life.studyStart);
    if (Number.isFinite(s)) earliest = Math.max(dayStart, s);
  }

  // ここで授業終了後に固定しない。
  // そのため、授業前の空き時間にも勉強が入る。

  return earliest;
     }

/* ===== study scheduling ===== */
function buildStudySegmentsForDate(dateS, allLifeBlocks, studyTasks, lifeRaw) {
  const dayStart = parseDateStr(dateS).getTime();
  const dayEnd = dayStart + STUDY_DAY_END_MIN * 60 * 1000;
  const occLife = collectBlocksIntersectWindow(allLifeBlocks, dayStart, dayEnd);
  const earliestStudy = earliestStudyStartMs(dateS, occLife, lifeRaw);

  const occ = occLife
    .map(b => ({ start: b.startMs, end: b.endMs }))
    .sort((a,b)=>a.start-b.start);

  const merged = [];
  for (const it of occ) {
    if (!merged.length || merged[merged.length-1].end < it.start) merged.push({ ...it });
    else merged[merged.length-1].end = Math.max(merged[merged.length-1].end, it.end);
  }

  const free = [];
  let cur = dayStart;
  for (const it of merged) {
    if (cur < it.start) free.push({ start: cur, end: it.start });
    cur = Math.max(cur, it.end);
  }
  if (cur < dayEnd) free.push({ start: cur, end: dayEnd });

  const free2 = free
    .map(s => ({ start: Math.max(s.start, earliestStudy), end: s.end }))
    .filter(s => s.end - s.start >= 5*60*1000);

  const segments = [];

  function totalFreeMinutesFrom(iSlot, offsetMs) {
    let ms = 0;
    for (let j=iSlot;j<free2.length;j++){
      const s = free2[j];
      const st = (j===iSlot) ? Math.max(s.start, offsetMs) : s.start;
      if (s.end > st) ms += (s.end - st);
    }
    return Math.floor(ms / (60*1000));
  }

  function movePointerTo(targetMs) {
    while (slotIdx < free2.length && free2[slotIdx].end <= targetMs) slotIdx++;
    if (slotIdx >= free2.length) return null;
    return Math.max(targetMs, free2[slotIdx].start);
  }

  let slotIdx = 0;
  let pointer = free2.length ? free2[0].start : null;

  for (const task of (studyTasks || [])) {
    const totalMin = Math.ceil(computeTotalSec(task) / 60);
    if (pointer == null) break;

    if (task.startTime) {
      const taskStart = studyTaskStartMsForDate(dateS, task.startTime);
      if (Number.isFinite(taskStart) && taskStart > pointer) {
        pointer = movePointerTo(taskStart);
        if (pointer == null) break;
      }
    }

    const availMin = totalFreeMinutesFrom(slotIdx, pointer);
    if (availMin < totalMin) break;

    let remainMin = totalMin;
    while (remainMin > 0 && slotIdx < free2.length) {
      const s = free2[slotIdx];
      if (pointer < s.start) pointer = s.start;
      if (pointer >= s.end) { slotIdx++; continue; }

      const slotMin = Math.floor((s.end - pointer) / (60*1000));
      if (slotMin <= 0) { slotIdx++; continue; }

      const useMin = Math.min(slotMin, remainMin);
      const st = pointer;
      const en = st + useMin*60*1000;

      segments.push({
        id: uid(),
        kind: "study",
        name: `${task.subject}｜${task.taskType}`,
        startMs: st,
        endMs: en,
        meta: {
          taskId: task.id,
          subjectColor: task.subjectColor,
          subject: task.subject,
          taskType: task.taskType
        }
      });

      pointer = en;
      remainMin -= useMin;
      if (pointer >= s.end) slotIdx++;
    }
  }

  return segments;
}
function mergeContiguous(segments) {
  const a = [...segments].sort((x,y)=>x.startMs-y.startMs);
  const out = [];
  for (const b of a) {
    const last = out[out.length-1];
    const same =
      last &&
      last.kind === b.kind &&
      last.name === b.name &&
      (last.meta?.taskId || null) === (b.meta?.taskId || null) &&
      last.endMs === b.startMs;

    if (same) last.endMs = b.endMs;
    else out.push({ ...b });
  }
  return out;
}

/* ===== build all blocks ===== */
function validateNoOverlapForDay(dateS, allLifeBlocks) {
  const dayStart = parseDateStr(dateS).getTime();
  const dayEnd = dayStart + STUDY_DAY_END_MIN * 60 * 1000;
  const clipped = collectBlocksIntersectWindow(allLifeBlocks, dayStart, dayEnd);
  const ov = findOverlap(clipped);
  return ov ? "設定が重なっています。" : "";
}
function buildAllBlocksForWindow() {
  const dates = timelineDatesWindow(state.selectedDate);

  const lifeBlocksByDate = {};
  let allLifeBlocks = [];

  for (const dateS of dates) {
    const life0 = state.lifeByDate[dateS];
    if (!life0) continue;

    const life = normalizeLifeSettings(life0);
    const baseLife = buildLifeBlocksForDate(dateS, life);
    const endPart = buildEndOfDayBlocks(dateS, life, baseLife);

    if (endPart.err) {
      life.__err = endPart.err;
      lifeBlocksByDate[dateS] = baseLife;
      allLifeBlocks = allLifeBlocks.concat(baseLife);
      continue;
    }

    const lifeBlocks = baseLife.concat(endPart.blocks);
    life.__err = "";
    lifeBlocksByDate[dateS] = lifeBlocks;
    allLifeBlocks = allLifeBlocks.concat(lifeBlocks);
  }

  allLifeBlocks.sort((a,b)=>a.startMs-b.startMs);

  let blocks = [];

  for (const dateS of dates) {
    const life = state.lifeByDate[dateS];
    const study = state.studyByDate[dateS] || [];
    if (!life || !lifeBlocksByDate[dateS]) continue;

    const ovErr = validateNoOverlapForDay(dateS, allLifeBlocks);
    if (ovErr) {
      life.__err = ovErr;
      blocks = blocks.concat(lifeBlocksByDate[dateS]);
      continue;
    }

    life.__err = life.__err || "";
    const studySegs = buildStudySegmentsForDate(dateS, allLifeBlocks, study, life);

    blocks = blocks.concat(lifeBlocksByDate[dateS]);
    blocks = blocks.concat(studySegs);
  }

  blocks = mergeContiguous(blocks);
  blocks.sort((a,b)=>a.startMs-b.startMs);
  return blocks;
}

/* ===== remaining time pill ===== */
function setRemainPill(remainSec, labelText = "") {
  if (!Number.isFinite(remainSec) || remainSec < 0) {
    remainPill.hidden = true;
    return;
  }
  remainTime.textContent = fmtMS(remainSec);
  remainLabel.textContent = labelText || "";
  remainPill.hidden = false;
}

/* ===== runner expected step ===== */
function getTaskScheduleBlocks(taskId, blocks) {
  return (blocks || [])
    .filter(b => b.kind === "study" && b.meta?.taskId === taskId)
    .sort((a,b)=>a.startMs-b.startMs);
}
function getExpectedStepIndex(taskId, blocks, nowMs = Date.now()) {
  const found = findTaskById(taskId);
  if (!found) return null;
  const task = found.task;
  const steps = getTaskSteps(task);
  const prm = parseInt(task.perRangeMin || "", 10);
  if (!(Number.isFinite(prm) && prm > 0 && hasRealSteps(task))) return null;

  const taskBlocks = getTaskScheduleBlocks(taskId, blocks);
  if (!taskBlocks.length) return null;

  const active = taskBlocks.some(b => b.startMs <= nowMs && nowMs < b.endMs);
  if (!active) return null;

  let elapsedMs = 0;
  for (const b of taskBlocks) {
    if (nowMs >= b.endMs) elapsedMs += (b.endMs - b.startMs);
    else if (nowMs > b.startMs) {
      elapsedMs += (nowMs - b.startMs);
      break;
    } else {
      break;
    }
  }

  const idx = Math.floor(elapsedMs / (prm * 60 * 1000));
  return clamp(idx, 0, steps.length - 1);
}

/* ===== current block / auto runner ===== */
function currentBlockAt(blocks, nowMs) {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.startMs <= nowMs && nowMs < b.endMs) return b;
  }
  return null;
}
function tickRunner(blocks) {
  const now = Date.now();
  const block = currentBlockAt(blocks, now);

  if (block) {
    const remainSec = Math.max(0, Math.floor((block.endMs - now) / 1000));
    const label = (block.kind === "study") ? (block.meta?.subject || block.name) : block.name;
    setRemainPill(remainSec, label);
  } else {
    remainPill.hidden = true;
  }

  if (block && block.kind === "study") {
    const taskId = block.meta?.taskId;
    if (taskId && !isTaskComplete(taskId)) {
      if (state.runner.arrivalShownTaskId === taskId) return;

      if (!state.runner.isRunning || state.runner.activeTaskId !== taskId) {
        runnerStart(taskId);
      } else {
        const last = state.runner.lastTick || now;
        const dtSec = Math.max(0, Math.floor((now - last) / 1000));
        if (dtSec > 0) {
          const found = findTaskById(taskId);
          if (found) {
            const steps = getTaskSteps(found.task);
            const p = ensureProgress(taskId, steps.length);
            p.spentSec += dtSec;
            state.progressByTask[taskId] = p;
            state.runner.lastTick = now;
            saveState();

            const totalSec = computeTotalSec(found.task);
            if (p.spentSec >= totalSec) openArrivalDialog(taskId);
          }
        }
      }
    } else {
      if (state.runner.isRunning) runnerStop();
    }
  } else {
    if (state.runner.isRunning) runnerStop();
  }
}

/* ===== runner modal ===== */
function openRunner(taskId, segmentEndMs = null) {
  const found = findTaskById(taskId);
  if (!found) return;

  const t = found.task;
  const steps = getTaskSteps(t);
  const p = ensureProgress(taskId, steps.length);
  const totalSec = computeTotalSec(t);
  const blocks = buildAllBlocksForWindow();

  const body = el("div", "grid1");

  const title = el("div", "", `${t.subject}｜${t.taskType}`);
  title.style.cssText = "font-weight:1000;font-size:16px;";

  const timeBox = el("div", "");
  const timeBig = el("div", "runnerTimeBig", "--:--");
  const timeSmall = el("div", "runnerTimeSmall", "");
  timeBox.appendChild(timeBig);
  timeBox.appendChild(timeSmall);

  const prog = el("div", "", "0/0");
  prog.style.cssText = "text-align:right;color:rgba(238,243,255,.72);font-weight:1000;";

  const hint = el("div", "note", "");
  hint.style.display = "none";

  const btnAll = mkBtn("全部完了", "btnPrimary", () => {
    for (let i = 0; i < p.doneSteps.length; i++) p.doneSteps[i] = true;
    p.spentSec = Math.max(p.spentSec, totalSec);
    state.progressByTask[taskId] = p;
    saveState();
    renderRunner();
    openArrivalDialog(taskId);
  });

  const stepsBox = el("div", "");
  stepsBox.style.display = "grid";
  stepsBox.style.gap = "8px";

  const stepBtns = steps.map((label, i) => {
    const b = el("button", "stepBtn", "");
    b.type = "button";
    const leftWrap = el("div", "stepLeft");
    const guide = el("span", `stepGuide ${t.subjectColor || "gray"}`, String(i + 1));
    const labelEl = el("span", "", label);
    leftWrap.appendChild(guide);
    leftWrap.appendChild(labelEl);

    const right = el("span", "stepRight", "");
    b.appendChild(leftWrap);
    b.appendChild(right);

    b.addEventListener("click", () => {
      p.doneSteps[i] = !p.doneSteps[i];
      state.progressByTask[taskId] = p;
      saveState();
      renderRunner();
      if (countDone(p.doneSteps) === steps.length) openArrivalDialog(taskId);
    });

    return { btn: b, guide, right };
  });
  stepBtns.forEach(x => stepsBox.appendChild(x.btn));

  body.appendChild(title);
  body.appendChild(timeBox);
  body.appendChild(prog);
  body.appendChild(hint);
  body.appendChild(btnAll);
  body.appendChild(stepsBox);

  openModal("実行", body, [mkBtn("閉じる", "btnGhost", closeModal)]);

  function renderRunner() {
    const p2 = ensureProgress(taskId, steps.length);
    const done = countDone(p2.doneSteps);
    const now = Date.now();

    if (segmentEndMs && Number.isFinite(segmentEndMs)) {
      const remainSec = Math.max(0, Math.floor((segmentEndMs - now) / 1000));
      timeBig.textContent = fmtMS(remainSec);
      timeSmall.textContent = "（この区間の終了まで）";
    } else {
      const remainSec = Math.max(0, totalSec - (p2.spentSec || 0));
      timeBig.textContent = fmtMS(remainSec);
      timeSmall.textContent = "（見積もり残り）";
    }

    prog.textContent = `${done}/${steps.length}`;

    const expectedIdx = getExpectedStepIndex(taskId, blocks, now);
    const showHint = expectedIdx != null && hasRealSteps(t) && parseInt(t.perRangeMin || "", 10) > 0;
    hint.style.display = showHint ? "" : "none";
    hint.textContent = showHint ? `点滅中の枠が目安です（${expectedIdx + 1}番）。` : "";

    stepBtns.forEach((obj, i) => {
      const doneOne = !!p2.doneSteps[i];
      const isExpected = (i === expectedIdx) && !doneOne;

      obj.btn.classList.toggle("isDone", doneOne);
      obj.btn.classList.toggle("isExpectedFocus", isExpected);

      obj.guide.classList.toggle("isExpectedPulse", isExpected);

      if (doneOne) obj.right.textContent = "完了";
      else if (isExpected) obj.right.textContent = "今ここ";
      else obj.right.textContent = "";
    });
  }

  if (runnerUiTimer) { clearInterval(runnerUiTimer); runnerUiTimer = null; }
  runnerUiTimer = setInterval(renderRunner, 250);
  renderRunner();
}

/* ===== tabs ===== */
function setTab(tabKey) {
  state.activeTab = tabKey;
  saveState();

  tabBtns.forEach(b => b.classList.toggle("isActive", b.dataset.tab === tabKey));
  tabLife.hidden = tabKey !== "life";
  tabStudy.hidden = tabKey !== "study";
  tabTimeline.hidden = tabKey !== "timeline";
  render();
}
tabBtns.forEach(btn => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

/* ===== life validation ===== */
function validateLifeBlocksOnDemand(dateS, life) {
  const base = buildLifeBlocksForDate(dateS, life);
  const ov0 = findOverlap(base);
  if (ov0) return "生活ブロックが重なっています。";
  const endPart = buildEndOfDayBlocks(dateS, life, base);
  if (endPart.err) return endPart.err;
  const all = base.concat(endPart.blocks);
  const ov1 = findOverlap(all);
  if (ov1) return "生活ブロックが重なっています。";
  return "";
}

/* ===== timetable ===== */
function compactTimetable(timetable) {
  const arr = normalizeTimetable(timetable);
  const out = [];

  let i = 0;
  while (i < arr.length) {
    const cur = arr[i];
    let j = i + 1;

    while (
      j < arr.length &&
      !!arr[j].noClass === !!cur.noClass &&
      (arr[j].groupKey || "none") === (cur.groupKey || "none") &&
      (arr[j].subject || "") === (cur.subject || "")
    ) {
      j++;
    }

    out.push({
      start: i,
      end: j - 1,
      groupKey: cur.groupKey || "none",
      subject: cur.subject || "",
      noClass: !!cur.noClass,
    });

    i = j;
  }

  return out;
}

function openTimetable(dateS) {
  const life = state.lifeByDate[dateS] =
    normalizeLifeSettings(state.lifeByDate[dateS] || emptyLifeSettings());

  const body = el("div", "grid1");
  body.appendChild(el("div", "note", "授業のマスをタップすると編集できます。"));

  const wrap = el("div", "");
  wrap.style.cssText = `
    display:grid;
    grid-template-columns:54px 1fr;
    border:1px solid rgba(255,255,255,.12);
    border-radius:14px;
    overflow:hidden;
    background:rgba(15,21,38,.8);
  `;

  const left = el("div", "");
  left.style.cssText = `
    display:grid;
    grid-template-rows:repeat(6,44px);
    border-right:1px solid rgba(255,255,255,.10);
  `;

  PERIOD_LABELS.forEach((lab, i) => {
    const c = el("button", "", lab);
    c.type = "button";
    c.style.cssText = `
      border:0;
      border-bottom:1px solid rgba(255,255,255,.08);
      background:rgba(255,255,255,.03);
      color:rgba(238,243,255,.72);
      font-weight:1000;
    `;
    c.addEventListener("click", () => openTimetableCellEdit(dateS, i, i));
    left.appendChild(c);
  });

  const right = el("div", "");
  right.style.cssText = `
    position:relative;
    height:264px;
    background:rgba(11,15,26,.35);
  `;

  compactTimetable(life.timetable).forEach(seg => {
    const color = seg.noClass ? "gray" : subjectColorFromGroup(seg.groupKey);
    const subject = seg.noClass ? "授業なし" : (seg.subject || "—");
    const h = (seg.end - seg.start + 1) * 44;
    const top = seg.start * 44;

    const bg = seg.noClass
      ? `
        repeating-linear-gradient(
          135deg,
          rgba(255,255,255,.10) 0,
          rgba(255,255,255,.10) 6px,
          rgba(15,21,38,.92) 6px,
          rgba(15,21,38,.92) 14px
        )
      `
      : `rgba(15,21,38,.92)`;

    const cell = el("button", "", "");
    cell.type = "button";
    cell.style.cssText = `
      position:absolute;
      left:0;
      right:0;
      top:${top}px;
      height:${h}px;
      border:0;
      border-bottom:1px solid rgba(255,255,255,.08);
      background:${bg};
      color:#eef3ff;
      text-align:left;
      padding:8px 10px;
      font-weight:1000;
      display:flex;
      align-items:center;
      gap:10px;
    `;

    const bar = el("span", `bar ${color}`);
    bar.style.cssText = `
      width:6px;
      height:calc(100% - 8px);
      min-height:24px;
      border-radius:999px;
      flex-shrink:0;
      opacity:${seg.noClass ? ".45" : "1"};
    `;

    const text = el("span", "", subject);
    text.style.cssText = `
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      opacity:${seg.noClass ? ".75" : "1"};
    `;

    const range = seg.start === seg.end
      ? PERIOD_LABELS[seg.start]
      : `${PERIOD_LABELS[seg.start]}〜${PERIOD_LABELS[seg.end]}`;

    const sub = el("span", "", range);
    sub.style.cssText = `
      margin-left:auto;
      color:rgba(238,243,255,.55);
      font-size:12px;
      flex-shrink:0;
    `;

    cell.appendChild(bar);
    cell.appendChild(text);
    cell.appendChild(sub);

    cell.addEventListener("click", () => openTimetableCellEdit(dateS, seg.start, seg.end));

    right.appendChild(cell);
  });

  wrap.appendChild(left);
  wrap.appendChild(right);
  body.appendChild(wrap);

  openModal("時間割", body, [
    mkBtn("閉じる", "btnPrimary", closeModal)
  ]);
}

function openTimetableCellEdit(dateS, startIdx, endIdx) {
  const life = state.lifeByDate[dateS] =
    normalizeLifeSettings(state.lifeByDate[dateS] || emptyLifeSettings());

  const current = life.timetable[startIdx] || {
    groupKey:"none",
    subject:"",
    noClass:false,
  };

  const body = el("div", "grid1");
  const label = startIdx === endIdx
    ? PERIOD_LABELS[startIdx]
    : `${PERIOD_LABELS[startIdx]}〜${PERIOD_LABELS[endIdx]}`;

  body.appendChild(el("div", "note", `${label} を編集します。`));

  const groupSel = document.createElement("select");
  GROUPS.forEach(g=>{
    const o = document.createElement("option");
    o.value = g.key;
    o.textContent = g.name;
    groupSel.appendChild(o);
  });
  groupSel.value = current.groupKey || "none";

  const subjectArea = el("div", "grid1");
  let subjectSel;
  let subjectFree;

  function renderSubjectArea() {
    subjectArea.innerHTML = "";

    subjectSel = document.createElement("select");

    const addOpt = (v, t = v) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      subjectSel.appendChild(o);
    };

    addOpt("__free__", "—");
    (SUBJECTS_BY_GROUP[groupSel.value] || []).forEach(v => addOpt(v));

    if ((SUBJECTS_BY_GROUP[groupSel.value] || []).includes(current.subject)) {
      subjectSel.value = current.subject;
    } else {
      subjectSel.value = "__free__";
    }

    subjectFree = document.createElement("input");
    subjectFree.type = "text";
    subjectFree.placeholder = "科目名";
    subjectFree.value = subjectSel.value === "__free__" ? (current.subject || "") : "";
    subjectFree.hidden = subjectSel.value !== "__free__";

    subjectSel.addEventListener("change", () => {
      subjectFree.hidden = subjectSel.value !== "__free__";
    });

    subjectArea.appendChild(wrapField("科目", subjectSel));
    subjectArea.appendChild(wrapField("科目名（自由入力）", subjectFree));
  }

  groupSel.addEventListener("change", () => {
    current.subject = "";
    renderSubjectArea();
  });

  renderSubjectArea();

  body.appendChild(wrapField("系", groupSel));
  body.appendChild(subjectArea);

  const noClassBtn = mkBtn("授業なし", "btnSmall", () => {
    for (let i = startIdx; i <= endIdx; i++) {
      life.timetable[i] = {
        groupKey: "none",
        subject: "",
        noClass: true,
      };
    }

    saveState();
    closeModal();
    openTimetable(dateS);
    render();
  });

  const clearBtn = mkBtn("空欄", "btnDanger", () => {
    for (let i = startIdx; i <= endIdx; i++) {
      life.timetable[i] = {
        groupKey:"none",
        subject:"",
        noClass:false,
      };
    }
    saveState();
    closeModal();
    openTimetable(dateS);
    render();
  });

  const saveBtn = mkBtn("保存", "btnPrimary", () => {
    const subject = subjectSel.value === "__free__"
      ? (subjectFree.value || "").trim()
      : subjectSel.value;

    for (let i = startIdx; i <= endIdx; i++) {
      life.timetable[i] = {
        groupKey: groupSel.value,
        subject,
        noClass: false,
      };
    }

    saveState();
    closeModal();
    openTimetable(dateS);
    render();
  });

  openModal("時間割を編集", body, [
    mkBtn("戻る", "btnGhost", () => {
      closeModal();
      openTimetable(dateS);
    }),
    noClassBtn,
    clearBtn,
    saveBtn,
  ]);
         }

/* ===== life edit modal ===== */
function openCustomLifeEdit(dateS, cbId) {
  const found = findCustomBlockById(dateS, cbId);
  if (!found) return;

  const local = deepClone(found.block);
  const body = el("div", "grid1");

  const typeSel = mkSelect(LIFE_TYPE_OPTIONS, local.type || "-", () => {
    renderBody();
  }, false);
  const contentIn = document.createElement("input");
  contentIn.type = "text";
  contentIn.placeholder = "例：病院";
  contentIn.value = local.content || "";

  const modeRow = el("div", "row");
  const r1 = document.createElement("input"); r1.type = "radio"; r1.name = "lifeEditMode";
  const r2 = document.createElement("input"); r2.type = "radio"; r2.name = "lifeEditMode";
  if ((local.mode || "minutes") === "minutes") r1.checked = true;
  else r2.checked = true;

  const l1 = el("label","row","");
  l1.style.gap="8px";
  l1.appendChild(r1);
  l1.appendChild(el("div","", "何分間"));

  const l2 = el("label","row","");
  l2.style.gap="8px";
  l2.appendChild(r2);
  l2.appendChild(el("div","", "時刻"));

  modeRow.appendChild(l1);
  modeRow.appendChild(l2);

  const startTime = mkTimeInput(local.start || "", (v)=>{ local.start = v; }, 60);
  const endTime = mkTimeInput(local.end || "", (v)=>{ local.end = v; }, 60);
  const minIn = document.createElement("input");
  minIn.type = "number";
  minIn.value = String(local.minutes || "");

  const area = el("div", "grid1");

  function renderBody() {
    body.innerHTML = "";
    body.appendChild(wrapField("種類", typeSel));
    body.appendChild(wrapField("内容", contentIn));
    body.appendChild(modeRow);
    area.innerHTML = "";

    if (r1.checked) {
      const g = el("div","grid2");
      g.appendChild(wrapField("開始", startTime));
      g.appendChild(wrapField("分", minIn));
      area.appendChild(g);
    } else {
      const g = el("div","grid2");
      g.appendChild(wrapField("開始", startTime));
      g.appendChild(wrapField("終了", endTime));
      area.appendChild(g);
    }

    body.appendChild(area);
  }

  r1.addEventListener("change", renderBody);
  r2.addEventListener("change", renderBody);
  typeSel.addEventListener("change", () => {
    if (typeSel.value !== "-" && LIFE_AUTO_MIN[typeSel.value] != null && !minIn.value) {
      minIn.value = String(LIFE_AUTO_MIN[typeSel.value]);
    }
  });
  renderBody();

  const saveBtn = mkBtn("保存", "btnPrimary", () => {
    const life = state.lifeByDate[dateS] = normalizeLifeSettings(state.lifeByDate[dateS] || emptyLifeSettings());

    local.type = typeSel.value || "-";
    local.content = (contentIn.value || "").trim();
    local.start = startTime.value || "";
    local.mode = r1.checked ? "minutes" : "clock";

    if (local.mode === "minutes") {
      const mins = parseInt(minIn.value || "0", 10);
      if (!local.start || !Number.isFinite(mins) || mins <= 0) {
        showSimpleAlert("保存できません", "開始時刻と分を正しく入れてください。");
        return;
      }
      local.minutes = mins;
      delete local.end;
    } else {
      local.end = endTime.value || "";
      delete local.minutes;
      if (!local.start || !local.end) {
        showSimpleAlert("保存できません", "開始時刻と終了時刻を入れてください。");
        return;
      }
    }

    const prev = deepClone(life.customBlocks[found.idx]);
    life.customBlocks[found.idx] = deepClone(local);

    const err = validateLifeBlocksOnDemand(dateS, life);
    if (err) {
      life.customBlocks[found.idx] = prev;
      saveState();
      showSimpleAlert("保存できません", err);
      return;
    }

    saveState();
    closeModal();
    render();
  });

  const delBtn = mkBtn("削除", "btnDanger", () => {
    const life = state.lifeByDate[dateS];
    if (!life) return;
    life.customBlocks = (life.customBlocks || []).filter(x => x.id !== cbId);
    saveState();
    closeModal();
    render();
  });

  openModal("生活ブロックを編集", body, [
    mkBtn("閉じる", "btnGhost", closeModal),
    delBtn,
    saveBtn,
  ]);
}

/* ===== render: life ===== */
function renderLife() {
  tabLife.innerHTML = "";

  const card = el("div", "card");
  const topRow = el("div", "row");

  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.value = state.selectedDate;
  dateInput.addEventListener("change", () => {
    state.selectedDate = dateInput.value || todayStr();
    saveState();
    render();
  });

  const tplSel = mkSelect(
    ["（テンプレ）", "月水金", "火木", "休日"],
    "（テンプレ）",
    () => {},
    false
  );

  const btnApplyTpl = mkBtn("適用", "btnPrimary", () => {
    const name = tplSel.value;
    let t;
    if (name === "月水金") t = templateMonWedFri();
    else if (name === "火木") t = templateTueThu();
    else if (name === "休日") t = templateHoliday();
    else t = templateByWeekday(state.selectedDate);

    state.lifeByDate[state.selectedDate] = deepClone(t);
    saveState();
    render();
  });

  topRow.appendChild(wrapField("日付", dateInput));
  topRow.appendChild(wrapField("テンプレ", tplSel));
  topRow.appendChild(btnApplyTpl);
  card.appendChild(topRow);
  tabLife.appendChild(card);

  if (!state.lifeByDate[state.selectedDate]) {
    const empty = el("div", "card");
    empty.appendChild(el("div", "note", "生活設定がまだありません。"));
    tabLife.appendChild(empty);
    state.lifeByDate[state.selectedDate] = emptyLifeSettings();
    saveState();
  }

  state.lifeByDate[state.selectedDate] = normalizeLifeSettings(state.lifeByDate[state.selectedDate]);
  const L = state.lifeByDate[state.selectedDate];

  const settingsCard = el("div", "card");
  settingsCard.appendChild(el("div", "", "生活設定"));

  const g = el("div", "grid2");

  const lessonSel = mkSelect(["あり","なし"], L.lesson || "なし", (v)=>{ L.lesson=v; saveState(); render(); });
  g.appendChild(wrapField("授業", lessonSel));

  const st = mkTimeInput(L.morningMoveStart || "", (v)=>{ L.morningMoveStart=v; saveState(); render(); }, 60);
  const minIn = document.createElement("input");
  minIn.type = "number";
  minIn.value = String(L.morningMoveMin ?? 60);
  minIn.addEventListener("change", ()=>{ L.morningMoveMin = clamp(parseInt(minIn.value||"60",10), 1, 240); saveState(); render(); });
  g.appendChild(wrapField("朝の移動 開始", st));
  g.appendChild(wrapField("朝の移動（分）", minIn));

  if (L.lesson === "あり") {
    const st2 = mkTimeInput(L.lessonStart || "", (v)=>{ L.lessonStart=v; saveState(); render(); }, 60);
    const en2 = mkTimeInput(L.lessonEnd || "", (v)=>{ L.lessonEnd=v; saveState(); render(); }, 60);
    g.appendChild(wrapField("授業 開始", st2));
    g.appendChild(wrapField("授業 終了", en2));
    g.appendChild(wrapField("時間割", mkBtn("時間割を編集", "btnPrimary", () => openTimetable(state.selectedDate))));
  } else {
    g.appendChild(wrapField("授業 開始", mkTimeInput("", ()=>{}, 60, true)));
    g.appendChild(wrapField("授業 終了", mkTimeInput("", ()=>{}, 60, true)));
  }

  const returnSel = mkSelect(
    [
      { value:"60", label:"60分" },
      { value:"30", label:"30分" },
      { value:"30x2", label:"30分×2" },
    ],
    L.returnMoveType || "60",
    (v)=>{
      L.returnMoveType = v;
      if (L.returnMoveType !== "30x2") L.second30Start = "";
      saveState(); render();
    },
    false
  );
  g.appendChild(wrapField("帰りの移動", returnSel));

  const returnBase = mkTimeInput(L.returnMoveBase || "", (v)=>{ L.returnMoveBase=v; saveState(); render(); }, 60);
  g.appendChild(wrapField("帰り移動 開始（空欄なら自動）", returnBase));

  if (L.returnMoveType === "30x2") {
    const st4 = mkSelect(SECOND_MOVE_OPTIONS, L.second30Start || "", (v)=>{ L.second30Start=v; saveState(); render(); }, true);
    g.appendChild(wrapField("2回目移動 開始", st4));
  } else {
    g.appendChild(wrapField("2回目移動 開始", mkSelect([""], "", ()=>{}, true)));
  }

  const studyStart = mkTimeInput(L.studyStart || "", (v)=>{ L.studyStart=v; saveState(); render(); }, 60);
  g.appendChild(wrapField("勉強開始（任意）", studyStart));

  settingsCard.appendChild(g);
  settingsCard.appendChild(el("div", "hr"));

  settingsCard.appendChild(el("div", "", "食事"));
  const gm = el("div", "grid2");

  function mealRow(title, useKey, startKey, minKey) {
    const useSel = mkSelect(["あり","なし"], L[useKey] || "なし", (v)=>{ L[useKey]=v; saveState(); render(); });
    const st = mkTimeInput(L[startKey] || "", (v)=>{ L[startKey]=v; saveState(); render(); }, 60, L[useKey] !== "あり");
    const mins = document.createElement("input");
    mins.type = "number";
    mins.value = String(L[minKey] ?? 30);
    mins.disabled = (L[useKey] !== "あり");
    mins.addEventListener("change", ()=>{ L[minKey] = clamp(parseInt(mins.value||"30",10), 1, 240); saveState(); render(); });

    gm.appendChild(wrapField(`${title} 有無`, useSel));
    gm.appendChild(wrapField(`${title} 開始（空欄なら自動）`, st));
    gm.appendChild(wrapField(`${title}（分）`, mins));
  }

  mealRow("朝食", "breakfastUse", "breakfastStart", "breakfastMin");
  mealRow("昼食", "lunchUse", "lunchStart", "lunchMin");
  mealRow("夕食", "dinnerUse", "dinnerStart", "dinnerMin");

  settingsCard.appendChild(gm);
  settingsCard.appendChild(el("div", "hr"));

  const g2 = el("div", "grid2");

  const bathSel = mkSelect(["あり","なし"], L.bath || "なし", (v)=>{
    L.bath = v;
    saveState();
    render();
  });

  const bathMin = document.createElement("input");
  bathMin.type = "number";
  bathMin.value = String(L.bathMin ?? 60);
  bathMin.disabled = (L.bath !== "あり");
  bathMin.addEventListener("change", ()=>{
    L.bathMin = clamp(parseInt(bathMin.value || "60", 10), 1, 300);
    saveState();
    render();
  });

  const bathStart = mkTimeInput(
    L.bathStart || "",
    (v)=>{
      L.bathStart = v;
      saveState();
      render();
    },
    60,
    L.bath !== "あり"
  );

  g2.appendChild(wrapField("風呂", bathSel));
  g2.appendChild(wrapField("風呂（分）", bathMin));
  g2.appendChild(wrapField("風呂 開始（空欄なら自動）", bathStart));

  const sleepSel = mkSelect(["あり","なし"], L.sleepUse || "なし", (v)=>{ L.sleepUse=v; saveState(); render(); });
  g2.appendChild(wrapField("就寝", sleepSel));

  const bed = mkTimeInput(L.bedTime || "", (v)=>{ L.bedTime=v; saveState(); render(); }, 60);
  const wake = mkTimeInput(L.wakeTime || "", (v)=>{ L.wakeTime=v; saveState(); render(); }, 60);
  g2.appendChild(wrapField("就寝時刻", bed));
  g2.appendChild(wrapField("起床時刻", wake));

  settingsCard.appendChild(g2);

  const errNow = validateLifeBlocksOnDemand(state.selectedDate, L) || (L.__err || "");
  if (errNow) settingsCard.appendChild(el("div", "warn", errNow));

  const row2 = el("div", "row");
  row2.style.justifyContent="space-between";
  row2.appendChild(el("div", "note", "変更は自動で反映されます。"));

  const btnClear = mkBtn("この日の生活を全消去", "btnDanger", () => {
    delete state.lifeByDate[state.selectedDate];
    saveState();
    render();
  });
  row2.appendChild(btnClear);
  settingsCard.appendChild(el("div","hr"));
  settingsCard.appendChild(row2);

  tabLife.appendChild(settingsCard);

  const addCard = el("div","card");
  addCard.appendChild(el("div","", "生活ブロックを追加"));

  const addGrid = el("div","grid2");
  const typeSel = mkSelect(LIFE_TYPE_OPTIONS, "-", ()=>{}, false);
  const contentIn = document.createElement("input");
  contentIn.type="text";
  contentIn.placeholder="例：病院";

  addGrid.appendChild(wrapField("種類", typeSel));
  addGrid.appendChild(wrapField("内容", contentIn));
  addCard.appendChild(addGrid);

  const modeRow = el("div","row");
  const r1 = document.createElement("input"); r1.type="radio"; r1.name="lifeMode"; r1.checked=true;
  const r2 = document.createElement("input"); r2.type="radio"; r2.name="lifeMode";
  const l1 = el("label","row",""); l1.style.gap="8px"; l1.appendChild(r1); l1.appendChild(el("div","", "何分間"));
  const l2 = el("label","row",""); l2.style.gap="8px"; l2.appendChild(r2); l2.appendChild(el("div","", "時刻（開始→終了）"));
  modeRow.appendChild(l1); modeRow.appendChild(l2);
  addCard.appendChild(modeRow);

  const startTime = mkTimeInput("", ()=>{}, 60);
  const endTime = mkTimeInput("", ()=>{}, 60);
  const minIn2 = document.createElement("input");
  minIn2.type="number";
  minIn2.value="";

  const timeArea = el("div","grid1");
  addCard.appendChild(timeArea);

  function renderTimeArea() {
    timeArea.innerHTML="";
    if (r1.checked) {
      const g = el("div","grid2");
      g.appendChild(wrapField("開始", startTime));
      g.appendChild(wrapField("分", minIn2));
      timeArea.appendChild(g);
    } else {
      const g = el("div","grid2");
      g.appendChild(wrapField("開始", startTime));
      g.appendChild(wrapField("終了", endTime));
      timeArea.appendChild(g);
    }
  }
  r1.addEventListener("change", renderTimeArea);
  r2.addEventListener("change", renderTimeArea);

  typeSel.addEventListener("change", () => {
    const t = typeSel.value;
    if (t !== "-" && LIFE_AUTO_MIN[t] != null && !minIn2.value) {
      minIn2.value = String(LIFE_AUTO_MIN[t]);
    }
  });
  renderTimeArea();

  const btnAdd = mkBtn("追加", "btnPrimary", () => {
    const lifeNow = state.lifeByDate[state.selectedDate] =
      normalizeLifeSettings(state.lifeByDate[state.selectedDate] || emptyLifeSettings());

    const type = typeSel.value || "-";
    const content = (contentIn.value || "").trim();

    const newBlock = { id: uid(), type, content };

    if (r1.checked) {
      if (!startTime.value) return;
      const mins = parseInt(minIn2.value || "0", 10);
      if (!Number.isFinite(mins) || mins <= 0) return;

      newBlock.mode = "minutes";
      newBlock.start = startTime.value;
      newBlock.minutes = mins;
    } else {
      if (!startTime.value || !endTime.value) return;
      newBlock.mode = "clock";
      newBlock.start = startTime.value;
      newBlock.end = endTime.value;
    }

    lifeNow.customBlocks.push(newBlock);

    const err = validateLifeBlocksOnDemand(state.selectedDate, lifeNow);
    if (err) {
      lifeNow.customBlocks = lifeNow.customBlocks.filter(x => x.id !== newBlock.id);
      saveState();
      showSimpleAlert("追加できません", err);
      render();
      return;
    }

    startTime.value = "";
    endTime.value = "";
    minIn2.value = "";
    contentIn.value = "";
    typeSel.value = "-";

    saveState();
    render();
  });

  const btnClearCustom = mkBtn("追加した生活ブロックを全消去", "btnDanger", () => {
    const lifeNow = state.lifeByDate[state.selectedDate];
    if (!lifeNow) return;
    lifeNow.customBlocks = [];
    saveState();
    render();
  });

  const addBtns = el("div","row");
  addBtns.style.justifyContent="space-between";
  addBtns.appendChild(btnAdd);
  addBtns.appendChild(btnClearCustom);

  addCard.appendChild(el("div","hr"));
  addCard.appendChild(addBtns);
  tabLife.appendChild(addCard);

  const listCard = el("div","card");
  listCard.appendChild(el("div","", "この日の生活リスト"));

  const allBlocks = buildAllBlocksForWindow();
  const blocks = allBlocks.filter(b => b.kind === "life" && belongsToDateByStart(b, state.selectedDate));

  if (!blocks.length) {
    listCard.appendChild(el("div","note","（生活ブロックはまだありません）"));
  } else {
    const box = el("div","grid1");
    blocks.forEach(b=>{
      const row = el("div","row");
      row.style.justifyContent="space-between";

      const left = el("div","grid1");
      left.style.gap="2px";
      left.appendChild(el("div","", `${b.name}`));
      left.appendChild(el("div","note", fmtRange(b.startMs, b.endMs)));
      row.appendChild(left);

      const btns = el("div","row");
      btns.style.gap = "6px";

      if (b.meta?.source === "custom" && b.meta?.cbId) {
        const edit = mkBtn("編集", "btnSmall", () => openCustomLifeEdit(state.selectedDate, b.meta.cbId));
        btns.appendChild(edit);
      }

      const del = mkBtn("✕", "btnSmall btnDanger smallX", () => {
        const lifeNow = state.lifeByDate[state.selectedDate];
        if (!lifeNow) return;
        const cbId = b.meta?.cbId;
        if (cbId) {
          lifeNow.customBlocks = (lifeNow.customBlocks || []).filter(x => x.id !== cbId);
          saveState();
          render();
        }
      });

      btns.appendChild(del);
      row.appendChild(btns);

      row.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;

        if (b.name === "授業") {
          openTimetable(state.selectedDate);
          return;
        }

        const bd = el("div","grid1");
        bd.appendChild(el("div","", b.name));
        bd.appendChild(el("div","note", fmtRange(b.startMs, b.endMs)));
        if (b.meta?.source === "custom") {
          bd.appendChild(el("div","note", "このブロックは編集できます。"));
        }
        openModal("確認", bd, [mkBtn("OK", "btnPrimary", closeModal)]);
      });

      box.appendChild(row);
      box.appendChild(el("div","hr"));
    });
    listCard.appendChild(box);
  }

  tabLife.appendChild(listCard);
}

/* ===== study add/edit helpers ===== */
function subjectColorFromGroup(groupKey) {
  const g = GROUPS.find(x=>x.key===groupKey);
  return g ? g.color : "gray";
}

function buildSubjectSelectForGroup(groupKey, currentValue, freeValue) {
  const s = document.createElement("select");
  const addOpt = (v, t = v) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    s.appendChild(o);
  };

  addOpt("__free__", "—");
  (SUBJECTS_BY_GROUP[groupKey] || []).forEach(v => addOpt(v));

  if ((SUBJECTS_BY_GROUP[groupKey] || []).includes(currentValue)) s.value = currentValue;
  else if (groupKey === "other" && currentValue === "その他") s.value = "その他";
  else s.value = "__free__";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "科目名";
  input.value = freeValue || (s.value === "__free__" ? (currentValue || "") : "");
  input.hidden = s.value !== "__free__";

  s.addEventListener("change", () => {
    input.hidden = s.value !== "__free__";
  });

  return { select: s, input };
}
function buildTaskTypeSelect(subjectName, currentValue, freeValue) {
  const s = document.createElement("select");
  const addOpt = (v, t = v) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    s.appendChild(o);
  };
  addOpt("__free__", "—");

  const opts = subjectName === "その他" ? TASKTYPE_UNION
            : (TASKTYPE_BY_SUBJECT[subjectName] || ["—"]);
  opts.filter(v => v !== "—").forEach(v => addOpt(v));

  if (opts.includes(currentValue) && currentValue !== "—") s.value = currentValue;
  else s.value = "__free__";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "内容";
  input.value = freeValue || (s.value === "__free__" ? (currentValue || "") : "");
  input.hidden = s.value !== "__free__";

  s.addEventListener("change", () => {
    input.hidden = s.value !== "__free__";
  });

  return { select: s, input };
}

/* ===== study edit ===== */
function openStudyEdit(taskId) {
  const found = findTaskById(taskId);
  if (!found) return;
  const t = found.task;

  const body = el("div","grid1");

  const groupSel = document.createElement("select");
  GROUPS.forEach(g=>{
    const o = document.createElement("option");
    o.value = g.key;
    o.textContent = g.name;
    groupSel.appendChild(o);
  });
  groupSel.value = t.groupKey || "none";

  const subjectWrap = el("div","grid1");
  const taskTypeWrap = el("div","grid1");

  let subjectUI = buildSubjectSelectForGroup(groupSel.value, t.subject || "", t.subject || "");
  let taskTypeUI = buildTaskTypeSelect(
    subjectUI.select.value === "__free__" ? "その他" : (subjectUI.select.value || "その他"),
    t.taskType || "",
    t.taskType || ""
  );

  function rebuildSubjectAndType() {
    const prevSubjectFree = subjectUI.input.value || "";
    const prevTypeFree = taskTypeUI.input.value || "";
    const currentSubjectValue = subjectUI.select.value === "__free__" ? prevSubjectFree : subjectUI.select.value;
    const currentTypeValue = taskTypeUI.select.value === "__free__" ? prevTypeFree : taskTypeUI.select.value;

    subjectUI = buildSubjectSelectForGroup(groupSel.value, currentSubjectValue, prevSubjectFree);
    subjectWrap.innerHTML = "";
    subjectWrap.appendChild(wrapField("科目", subjectUI.select));
    subjectWrap.appendChild(wrapField("科目名（自由入力）", subjectUI.input));

    const subjectNameForType = subjectUI.select.value === "__free__" ? "その他" : subjectUI.select.value;
    taskTypeUI = buildTaskTypeSelect(subjectNameForType, currentTypeValue, prevTypeFree);
    taskTypeWrap.innerHTML = "";
    taskTypeWrap.appendChild(wrapField("内容", taskTypeUI.select));
    taskTypeWrap.appendChild(wrapField("内容（自由入力）", taskTypeUI.input));

    subjectUI.select.addEventListener("change", rebuildSubjectAndType);
  }

  groupSel.addEventListener("change", rebuildSubjectAndType);
  rebuildSubjectAndType();

  const dur = document.createElement("input");
  dur.type="number";
  dur.value=String(t.durationMin || 30);

  const startTime = mkTimeInput(t.startTime || "", (v)=>{ t.startTime = v; }, 60);

  const prm = document.createElement("input");
  prm.type="number";
  prm.placeholder="（任意）";
  prm.value = t.perRangeMin || "";

  body.appendChild(wrapField("系", groupSel));
  body.appendChild(subjectWrap);
  body.appendChild(taskTypeWrap);
  body.appendChild(wrapField("時間（分）", dur));
  body.appendChild(wrapField("開始時刻（任意）", startTime));
  body.appendChild(wrapField("1範囲あたり（分）", prm));

  const rbox = el("div","grid1");
  const localRanges = deepClone(t.ranges || []);
  if (!localRanges.length) localRanges.push({start:"", end:""});

  function renderLocalRanges() {
    rbox.innerHTML="";
    localRanges.forEach((r, idx)=>{
      const box = el("div","card");
      box.style.background="rgba(15,21,38,.6)";
      box.style.borderColor="rgba(255,255,255,.08)";
      box.style.padding="10px";

      const st = document.createElement("input");
      st.type="text"; st.value=r.start||"";
      st.placeholder="開始";
      const en = document.createElement("input");
      en.type="text"; en.value=r.end||"";
      en.placeholder="終了";

      st.addEventListener("input", ()=>{ r.start=st.value; });
      en.addEventListener("input", ()=>{ r.end=en.value; });

      const del = mkBtn("✕", "btnSmall btnDanger smallX", ()=>{
        localRanges.splice(idx,1);
        if (!localRanges.length) localRanges.push({start:"", end:""});
        renderLocalRanges();
      });

      const g = el("div","grid1");
      g.appendChild(wrapField("開始", st));
      g.appendChild(wrapField("終了", en));

      const rr = el("div","row");
      rr.style.justifyContent="space-between";
      rr.appendChild(g);
      rr.appendChild(del);

      box.appendChild(rr);
      rbox.appendChild(box);
    });

    rbox.appendChild(mkBtn("範囲を追加", "btnSmall", ()=>{
      localRanges.push({start:"", end:""});
      renderLocalRanges();
    }));
  }
  renderLocalRanges();

  body.appendChild(el("div","hr"));
  body.appendChild(el("div","", "範囲"));
  body.appendChild(rbox);

  const saveBtn = mkBtn("保存", "btnPrimary", ()=>{
    const subject = subjectUI.select.value === "__free__"
      ? (subjectUI.input.value || "—").trim()
      : subjectUI.select.value;

    const taskType = taskTypeUI.select.value === "__free__"
      ? (taskTypeUI.input.value || "—").trim()
      : taskTypeUI.select.value;

    t.groupKey = groupSel.value;
    t.subject = subject || "—";
    t.subjectColor = subjectColorFromGroup(groupSel.value);
    t.taskType = taskType || "—";
    t.durationMin = clamp(parseInt(dur.value || "30", 10), 1, 2000);
    t.startTime = startTime.value || "";
    t.perRangeMin = prm.value ? clamp(parseInt(prm.value, 10), 1, 300) : "";
    t.ranges = deepClone(localRanges).map(x=>({start:(x.start||"").trim(), end:(x.end||"").trim()}));

    saveState();
    closeModal();
    render();
  });

  const deleteBtn = mkBtn("削除", "btnDanger", ()=>{
    state.studyByDate[found.dateS] = (state.studyByDate[found.dateS] || []).filter(x => x.id !== taskId);
    delete state.progressByTask[taskId];
    saveState();
    closeModal();
    render();
  });

  openModal("勉強タスクを編集", body, [
    mkBtn("閉じる", "btnGhost", closeModal),
    deleteBtn,
    saveBtn,
  ]);
}

/* ===== render: study ===== */
function renderStudy() {
  tabStudy.innerHTML = "";

  const dateCard = el("div","card");
  const row = el("div","row");
  const dateInput = document.createElement("input");
  dateInput.type="date";
  dateInput.value=state.selectedDate;
  dateInput.addEventListener("change", ()=>{
    state.selectedDate = dateInput.value || todayStr();
    saveState();
    render();
  });
  row.appendChild(wrapField("日付", dateInput));
  dateCard.appendChild(row);
  tabStudy.appendChild(dateCard);

  if (!state.studyByDate[state.selectedDate]) state.studyByDate[state.selectedDate] = [];
  const list = state.studyByDate[state.selectedDate];

  const addCard = el("div","card");
  addCard.appendChild(el("div","", "勉強タスクを追加"));

  const groupSel = document.createElement("select");
  GROUPS.forEach(g=>{
    const o = document.createElement("option");
    o.value=g.key;
    o.textContent=g.name;
    groupSel.appendChild(o);
  });
  groupSel.value="none";

  const subjectWrap = el("div","grid1");
  const taskTypeWrap = el("div","grid1");

  let subjectUI = buildSubjectSelectForGroup("none", "", "");
  let taskTypeUI = buildTaskTypeSelect("その他", "", "");

  function rebuildSubjectAndType() {
    const prevSubjectFree = subjectUI.input.value || "";
    const prevTypeFree = taskTypeUI.input.value || "";

    subjectUI = buildSubjectSelectForGroup(groupSel.value, "", prevSubjectFree);
    subjectWrap.innerHTML = "";
    subjectWrap.appendChild(wrapField("科目", subjectUI.select));
    subjectWrap.appendChild(wrapField("科目名（自由入力）", subjectUI.input));

    const subjectNameForType = subjectUI.select.value === "__free__" ? "その他" : subjectUI.select.value;
    taskTypeUI = buildTaskTypeSelect(subjectNameForType, "", prevTypeFree);
    taskTypeWrap.innerHTML = "";
    taskTypeWrap.appendChild(wrapField("内容", taskTypeUI.select));
    taskTypeWrap.appendChild(wrapField("内容（自由入力）", taskTypeUI.input));

    subjectUI.select.addEventListener("change", rebuildTaskTypeOnly);
  }
  function rebuildTaskTypeOnly() {
    const prevTypeFree = taskTypeUI.input.value || "";
    const currentTypeVal = taskTypeUI.select.value === "__free__" ? prevTypeFree : taskTypeUI.select.value;
    const subjectNameForType = subjectUI.select.value === "__free__" ? "その他" : subjectUI.select.value;

    taskTypeUI = buildTaskTypeSelect(subjectNameForType, currentTypeVal, prevTypeFree);
    taskTypeWrap.innerHTML = "";
    taskTypeWrap.appendChild(wrapField("内容", taskTypeUI.select));
    taskTypeWrap.appendChild(wrapField("内容（自由入力）", taskTypeUI.input));
  }
  groupSel.addEventListener("change", rebuildSubjectAndType);
  rebuildSubjectAndType();

  const durIn = document.createElement("input");
  durIn.type="number";
  durIn.value="30";

  const taskStartIn = mkTimeInput("", ()=>{}, 60);

  const perRangeIn = document.createElement("input");
  perRangeIn.type="number";
  perRangeIn.placeholder="（任意）";

  let ranges = [{ start:"", end:"" }];

  function renderRanges(container) {
    container.innerHTML="";
    ranges.forEach((r, idx)=>{
      const wrap = el("div","card");
      wrap.style.background="rgba(15,21,38,.6)";
      wrap.style.borderColor="rgba(255,255,255,.08)";
      wrap.style.padding="10px";

      const st = document.createElement("input");
      st.type="text";
      st.placeholder="開始 例：11(2-3)";
      st.value=r.start||"";

      const en = document.createElement("input");
      en.type="text";
      en.placeholder="終了 例：15(3)";
      en.value=r.end||"";

      st.addEventListener("input", ()=>{ r.start=st.value; });
      en.addEventListener("input", ()=>{ r.end=en.value; });

      const del = mkBtn("✕", "btnSmall btnDanger smallX", ()=>{
        ranges.splice(idx,1);
        if (!ranges.length) ranges.push({start:"", end:""});
        renderRanges(container);
      });

      const g = el("div","grid1");
      g.appendChild(wrapField("開始", st));
      g.appendChild(wrapField("終了", en));

      const rr = el("div","row");
      rr.style.justifyContent="space-between";
      rr.appendChild(g);
      rr.appendChild(del);

      wrap.appendChild(rr);
      container.appendChild(wrap);
    });

    const add = mkBtn("範囲を追加", "btnSmall", ()=>{
      ranges.push({start:"", end:""});
      renderRanges(container);
    });
    container.appendChild(add);
  }

  const formGrid = el("div","grid2");
  formGrid.appendChild(wrapField("系", groupSel));
  formGrid.appendChild(subjectWrap);
  addCard.appendChild(formGrid);
  addCard.appendChild(taskTypeWrap);

  addCard.appendChild(el("div","hr"));
  addCard.appendChild(wrapField("時間（分）", durIn));
  addCard.appendChild(wrapField("開始時刻（任意）", taskStartIn));
  addCard.appendChild(wrapField("1範囲あたり（分）", perRangeIn));

  const rangesBox = el("div","grid1");
  addCard.appendChild(el("div","hr"));
  addCard.appendChild(el("div","", "範囲"));
  addCard.appendChild(rangesBox);
  renderRanges(rangesBox);

  const btnAdd = mkBtn("追加", "btnPrimary", ()=>{
    const subject = subjectUI.select.value === "__free__"
      ? (subjectUI.input.value || "—").trim()
      : subjectUI.select.value;

    const taskType = taskTypeUI.select.value === "__free__"
      ? (taskTypeUI.input.value || "—").trim()
      : taskTypeUI.select.value;

    const task = {
      id: uid(),
      groupKey: groupSel.value,
      subject: subject || "—",
      subjectColor: subjectColorFromGroup(groupSel.value),
      taskType: taskType || "—",
      durationMin: clamp(parseInt(durIn.value||"30",10), 1, 2000),
      startTime: taskStartIn.value || "",
      perRangeMin: (perRangeIn.value ? clamp(parseInt(perRangeIn.value,10), 1, 300) : ""),
      ranges: deepClone(ranges).map(x=>({start:(x.start||"").trim(), end:(x.end||"").trim()})),
    };

    state.studyByDate[state.selectedDate].push(task);
    saveState();

    durIn.value="30";
    taskStartIn.value="";
    perRangeIn.value="";
    ranges = [{start:"", end:""}];
    rebuildSubjectAndType();
    render();
  });

  addCard.appendChild(el("div","hr"));
  addCard.appendChild(btnAdd);

  tabStudy.appendChild(addCard);

  const listCard = el("div","card");
  listCard.appendChild(el("div","", "この日の勉強リスト"));

  const allBlocks = buildAllBlocksForWindow();
  const now = Date.now();

  if (!list.length) {
    listCard.appendChild(el("div","note","（勉強タスクはまだありません）"));
  } else {
    const box = el("div","grid1");
    list.forEach((t, idx)=>{
      const item = el("div","block");
      const bar = el("div", `bar ${t.subjectColor || "gray"}`);
      item.appendChild(bar);

      const top = el("div","blockTop");
      top.appendChild(el("div","blockName", `${t.subject}｜${t.taskType}`));

      const btnRow = el("div","row taskBtns");
      btnRow.style.gap="6px";

      const up = mkBtn("↑", "btnSmall", ()=>{
        if (idx<=0) return;
        const arr = state.studyByDate[state.selectedDate];
        [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]];
        saveState(); render();
      });
      const down = mkBtn("↓", "btnSmall", ()=>{
        const arr = state.studyByDate[state.selectedDate];
        if (idx>=arr.length-1) return;
        [arr[idx+1], arr[idx]] = [arr[idx], arr[idx+1]];
        saveState(); render();
      });
      const del = mkBtn("✕", "btnSmall btnDanger smallX", ()=>{
        state.studyByDate[state.selectedDate] = state.studyByDate[state.selectedDate].filter(x=>x.id!==t.id);
        delete state.progressByTask[t.id];
        saveState(); render();
      });

      btnRow.appendChild(up);
      btnRow.appendChild(down);
      btnRow.appendChild(del);
      top.appendChild(btnRow);
      item.appendChild(top);

      const sec = computeTotalSec(t);
      const estMin = Math.ceil(sec/60);
      const steps = getTaskSteps(t);
      const startLabel = t.startTime ? ` / 開始 ${t.startTime}` : "";
      const tag = hasRealSteps(t)
        ? `範囲 ${steps.length} / 見積 ${estMin}分${startLabel}`
        : `見積 ${estMin}分${startLabel}`;
      item.appendChild(el("div","blockTag", tag));

      const expectedIdx = getExpectedStepIndex(t.id, allBlocks, now);
      if (expectedIdx != null) {
        const guideRow = el("div", "stepGuideRow");
        steps.forEach((_, i) => {
          const g = el("span", `stepGuide mini ${t.subjectColor || "gray"}`, String(i + 1));
          if (i === expectedIdx) g.classList.add("isExpectedPulse");
          guideRow.appendChild(g);
        });
        item.appendChild(guideRow);
      }

      item.addEventListener("click", (e)=>{
        if (e.target.closest("button")) return;
        openStudyEdit(t.id);
      });

      box.appendChild(item);
    });

    listCard.appendChild(box);
  }

  listCard.appendChild(el("div","hr"));
  listCard.appendChild(el("div","note","自動で組み立てはタイムラインに自動反映されます。"));

  tabStudy.appendChild(listCard);
}

/* ===== timeline helpers ===== */
function daySegmentsForDate(blocks, dateS) {
  const dayStart = parseDateStr(dateS).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;

  return (blocks || [])
    .filter(b => b.endMs > dayStart && b.startMs < dayEnd)
    .map(b => {
      const startMs = Math.max(b.startMs, dayStart);
      const endMs = Math.min(b.endMs, dayEnd);
      if (endMs <= startMs) return null;

      // 日付の変わり目も普通の時間の変わり目と同じ扱いにする
      const meta = { ...(b.meta || {}) };

      return { ...b, startMs, endMs, meta };
    })
    .filter(Boolean)
    .sort((a,b)=>a.startMs-b.startMs);
}
function getNowMarkerForDate(dateS, nowMs) {
  const d = new Date(nowMs);
  if (dateStr(d) !== dateS) return null;
  return d.getHours() * 60 + d.getMinutes();
}

/* ===== render: timeline ===== */
function renderTimeline() {
  tabTimeline.innerHTML = "";

  const blocks = buildAllBlocksForWindow();
  const wrap = el("div","timelineWrap");
  const dates = timelineDatesWindow(state.selectedDate);
  const now = Date.now();

  dates.forEach(dateS=>{
    const row = el("div","dayRow");

    const head = el("div","dayHead");
    const d = parseDateStr(dateS);
    head.appendChild(el("div","dayDate", fmtMD(d)));
    head.appendChild(el("div","dayWday", weekdayJa(d)));

    const axis = el("div","timeAxis");
    for (let h=0; h<=23; h++) {
      const tick = el("div","timeTick", `${h}:00`);
      tick.style.top = `${h * 60 * TL_PX_PER_MIN}px`;
      axis.appendChild(tick);
    }

    const track = el("div","dayTrack");

    const nowMin = getNowMarkerForDate(dateS, now);
    if (Number.isFinite(nowMin)) {
      const y = nowMin * TL_PX_PER_MIN;
      const line = el("div","nowLine");
      line.style.top = `${y}px`;

      const badge = el("div","nowBadge","NOW");
      line.appendChild(badge);

      line.id = "nowAnchor";
      track.appendChild(line);
    }

    const dayBlocks = daySegmentsForDate(blocks, dateS);

    if (!dayBlocks.length) {
      const n = el("div","note","（予定なし）");
      n.style.position = "absolute";
      n.style.top = "12px";
      n.style.left = "12px";
      track.appendChild(n);
    } else {
      dayBlocks.forEach(b=>{
        const dayStart = parseDateStr(dateS).getTime();
        const startMin = (b.startMs - dayStart) / 60000;
        const endMin = (b.endMs - dayStart) / 60000;

        const topPx = startMin * TL_PX_PER_MIN;
        const hPx = Math.max(12, (endMin - startMin) * TL_PX_PER_MIN);

        const card = el("div","tBlock");
        card.style.top = `${topPx}px`;
        card.style.height = `${hPx}px`;

        const bar = el("div", `bar ${b.kind==="study" ? (b.meta?.subjectColor || "gray") : "gray"}`);
        card.appendChild(bar);

        const top = el("div","blockTop");
        top.appendChild(el("div","blockName", b.name));
        top.appendChild(el("div","blockTime", fmtRange(b.startMs, b.endMs)));
        card.appendChild(top);

        if (b.kind === "study") {
          const taskId = b.meta?.taskId;
          const done = taskId ? isTaskComplete(taskId) : false;
          const expectedIdx = taskId ? getExpectedStepIndex(taskId, blocks, now) : null;
          const text = done ? "完了" : "勉強";
          card.appendChild(el("div","blockTag", expectedIdx != null ? `${text} / 目安 ${expectedIdx + 1}` : text));
        } else if (b.name === "授業") {
          card.appendChild(el("div","blockTag", "授業 / タップで時間割"));
        } else {
          card.appendChild(el("div","blockTag", "生活"));
        }

        card.addEventListener("click", ()=>{
          if (b.kind === "study") {
            openRunner(b.meta.taskId, b.endMs);
          } else if (b.name === "授業") {
            openTimetable(dateS);
          } else {
            const bd = el("div","grid1");
            bd.appendChild(el("div","", b.name));
            bd.appendChild(el("div","note", fmtRange(b.startMs, b.endMs)));
            openModal("確認", bd, [mkBtn("OK","btnPrimary",closeModal)]);
          }
        });

        track.appendChild(card);
      });
    }

    row.appendChild(head);
    row.appendChild(axis);
    row.appendChild(track);
    wrap.appendChild(row);
  });

  tabTimeline.appendChild(wrap);
  scrollToNow();
}
function scrollToNow() {
  const a = document.getElementById("nowAnchor");
  if (a) a.scrollIntoView({ block:"center", behavior:"auto" });
}
nowBtn.addEventListener("click", ()=>{
  setTab("timeline");
  setTimeout(scrollToNow, 0);
});

/* ===== main render ===== */
function render() {
  const n = new Date();
  nowClock.textContent = `${n.getHours()}:${pad2(n.getMinutes())}`;

  if (state.activeTab === "life") renderLife();
  if (state.activeTab === "study") renderStudy();
  if (state.activeTab === "timeline") renderTimeline();

  syncHeaderHeights();
}

/* ===== loop ===== */
function loop() {
  const blocks = buildAllBlocksForWindow();
  tickRunner(blocks);

  const n = new Date();
  nowClock.textContent = `${n.getHours()}:${pad2(n.getMinutes())}`;
}

/* ===== init ===== */
setTab(state.activeTab || "life");
render();
setInterval(loop, 1000);
setTimeout(syncHeaderHeights, 0);
