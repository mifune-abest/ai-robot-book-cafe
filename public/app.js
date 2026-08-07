import { refreshFurigana, startFurigana } from './furigana.js';

startFurigana();

const app = document.querySelector("#app");
const routeName = document.querySelector("#route-name");
const restartButton = document.querySelector("#restart-button");
const toast = document.querySelector("#toast");
const testModeBadge = document.querySelector("#test-mode-badge");

const ROUTES = {
  "/": { key: "home", label: "スタート" },
  "/career": { key: "career", label: "しごとに へんしん" },
  "/craft": { key: "craft", label: "デニムこうさく" },
  "/dream": { key: "dream", label: "りそうの ○○" },
  "/memory": { key: "memory", label: "きょうの おもいで" },
  "/host": { key: "host", label: "ホスト管理" },
};

const CAREER_KIND_META = {
  existing: { label: "じっさいに ある しごと" },
};

const CAREER_TOTAL_STEPS = 4;
const CAREER_IMAGE_ESTIMATE_MS = 180_000;
const DREAM_TOTAL_QUESTIONS = 5;

const DEFAULT_CONFIG = {
  craft: {
    styles: [
      { value: "かっこいい", label: "かっこいい", icon: "★" },
      { value: "かわいい", label: "かわいい", icon: "花" },
      { value: "おまかせ", label: "おまかせ", icon: "◎" },
    ],
    materials: [],
  },
  dream: {
    genres: [
      { id: "house", label: "いえ", icon: "家", enabled: true },
      { id: "food", label: "たべもの", icon: "食", enabled: true },
      { id: "room", label: "へや", icon: "室", enabled: true },
      { id: "cafe", label: "カフェ", icon: "店", enabled: true },
    ],
    freeModeEnabled: true,
  },
  memory: {
    tables: [],
  },
};

const state = {
  route: null,
  config: DEFAULT_CONFIG,
  healthy: null,
  hasProgress: false,
  cameraStream: null,
  cameraRequestId: 0,
  routeTimer: null,
  pollTimer: null,
  careerImageProgressTimer: null,
  toastTimer: null,
  career: null,
  craft: null,
  dream: null,
  memory: null,
  host: null,
};

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function apiRequest(path, options) {
  const requestOptions = Object.assign(
    {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: {},
    },
    options || {},
  );

  if (requestOptions.body) {
    requestOptions.headers = Object.assign(
      { "Content-Type": "application/json" },
      requestOptions.headers,
    );
    if (typeof requestOptions.body !== "string") {
      requestOptions.body = JSON.stringify(requestOptions.body);
    }
  }

  let response;
  try {
    response = await fetch(path, requestOptions);
  } catch (error) {
    throw new ApiError("サーバーに つながりませんでした", 0, null);
  }

  const contentType = response.headers.get("content-type") || "";
  let data = null;
  if (response.status !== 204) {
    try {
      data = contentType.includes("application/json")
        ? await response.json()
        : await response.text();
    } catch (error) {
      data = null;
    }
  }

  if (!response.ok) {
    const message =
      (data &&
        typeof data === "object" &&
        (data.message ||
          (data.error && typeof data.error === "object" && data.error.message) ||
          (typeof data.error === "string" && data.error))) ||
      "うまく できませんでした";
    throw new ApiError(String(message), response.status, data);
  }

  return data || {};
}

function apiGet(path) {
  return apiRequest(path);
}

function apiPost(path, body) {
  return apiRequest(path, { method: "POST", body: body || {} });
}

function cleanPathname(pathname) {
  const clean = pathname.replace(/\/+$/, "");
  return clean || "/";
}

function getRoute() {
  return ROUTES[cleanPathname(window.location.pathname)] || null;
}

function unwrapData(value) {
  if (!value || typeof value !== "object") return value;
  return value.data || value.result || value.config || value;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeImageUrl(value) {
  if (!value || typeof value !== "string") return "";
  const url = value.trim();
  if (
    /^https?:\/\//i.test(url) ||
    /^blob:/i.test(url) ||
    /^data:image\/(png|jpe?g|webp);base64,/i.test(url) ||
    /^\/(?!\/)/.test(url) ||
    /^\.\.?\//.test(url)
  ) {
    return url;
  }
  return "";
}

function extractImageUrl(value) {
  if (typeof value === "string") return safeImageUrl(value);
  if (!value || typeof value !== "object") return "";
  const direct =
    value.imageUrl ||
    value.imageURL ||
    value.dataUrl ||
    value.dataURL ||
    value.url ||
    value.outputUrl ||
    value.resultUrl ||
    (value.image && (value.image.url || value.image.dataUrl)) ||
    (value.result && extractImageUrl(value.result)) ||
    (value.data && extractImageUrl(value.data));
  if (direct) return safeImageUrl(direct);
  const base64 = value.imageBase64 || value.base64;
  if (typeof base64 === "string" && base64.length > 100) {
    return "data:image/png;base64," + base64;
  }
  return "";
}

function normalizeOption(option, index) {
  if (typeof option === "string") {
    return { value: option, label: option, icon: String(index + 1) };
  }
  const value = option.value || option.id || option.label || option.name || String(index + 1);
  return {
    value: String(value),
    label: String(option.label || option.name || option.text || value),
    icon: String(option.icon || option.symbol || index + 1),
    note: String(option.note || option.description || ""),
  };
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

function joinClass() {
  return Array.from(arguments).filter(Boolean).join(" ");
}

function setView(markup, options) {
  const settings = options || {};
  app.className = joinClass("app-main", settings.className || "");
  app.innerHTML = markup;
  refreshFurigana(app);
  window.scrollTo({ top: 0, behavior: "auto" });
  window.setTimeout(function () {
    const target = app.querySelector("[data-autofocus]") || app;
    if (target && typeof target.focus === "function") {
      target.focus({ preventScroll: true });
    }
  }, 0);
}

function showToast(message, duration) {
  window.clearTimeout(state.toastTimer);
  toast.textContent = message;
  refreshFurigana(toast);
  toast.hidden = false;
  state.toastTimer = window.setTimeout(function () {
    toast.hidden = true;
  }, duration || 3500);
}

function clearTransientState() {
  window.clearTimeout(state.routeTimer);
  window.clearInterval(state.pollTimer);
  window.clearInterval(state.careerImageProgressTimer);
  window.clearTimeout(state.toastTimer);
  state.routeTimer = null;
  state.pollTimer = null;
  state.careerImageProgressTimer = null;
  toast.hidden = true;
  stopCamera();
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function stopCamera() {
  state.cameraRequestId += 1;
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(function (track) {
      track.stop();
    });
    state.cameraStream = null;
  }
}

function progressDots(current, total) {
  let dots = "";
  for (let index = 1; index <= total; index += 1) {
    const className =
      index < current ? "is-done" : index === current ? "is-current" : "";
    dots +=
      '<span class="progress-dot ' +
      className +
      '" aria-hidden="true"></span>';
  }
  return (
    '<div class="progress-dots" aria-label="' +
    total +
    "こ中 " +
    current +
    'こめ">' +
    dots +
    "</div>"
  );
}

function loadingScreen(title, lead) {
  setView(
    '<section class="screen screen--center">' +
      '<div class="loader" aria-hidden="true"><span></span><span></span><span></span></div>' +
      "<h1>" +
      escapeHtml(title) +
      "</h1>" +
      (lead ? '<p class="lead">' + escapeHtml(lead) + "</p>" : "") +
      "</section>",
  );
}

function stopCareerImageProgress() {
  window.clearInterval(state.careerImageProgressTimer);
  state.careerImageProgressTimer = null;
}

function careerImageTimeLabel(remainingMs) {
  if (remainingMs <= 0) return "もうすぐ できあがるよ";
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return "あと 約" + minutes + "分";
}

function careerImageLoadingScreen(job) {
  stopCareerImageProgress();
  setView(
    '<section class="screen screen--center screen--narrow">' +
      "<h1>" +
      escapeHtml(job) +
      "に へんしん中！</h1>" +
      '<p class="lead">すてきな しゃしんを つくっているよ</p>' +
      '<div class="generation-progress">' +
      '<div class="generation-progress__labels"><span>できあがりまでの めやす</span>' +
      '<strong id="career-image-time" aria-live="polite">あと 約3分</strong></div>' +
      '<div class="generation-progress__track" id="career-image-progress" role="progressbar" aria-label="画像をつくっています" aria-valuemin="0" aria-valuemax="100" aria-valuenow="4" aria-valuetext="あと 約3分">' +
      '<span class="generation-progress__fill" id="career-image-progress-fill"></span>' +
      "</div></div></section>",
  );

  const startedAt = Date.now();
  const time = document.querySelector("#career-image-time");
  const progress = document.querySelector("#career-image-progress");
  const fill = document.querySelector("#career-image-progress-fill");
  const update = function () {
    if (!time || !progress || !fill || !document.body.contains(progress)) {
      stopCareerImageProgress();
      return;
    }
    const elapsed = Date.now() - startedAt;
    const remaining = CAREER_IMAGE_ESTIMATE_MS - elapsed;
    const percent = Math.min(
      94,
      Math.max(4, Math.round(4 + (elapsed / CAREER_IMAGE_ESTIMATE_MS) * 90)),
    );
    const label = careerImageTimeLabel(remaining);
    fill.style.width = percent + "%";
    if (time.textContent !== label) time.textContent = label;
    progress.setAttribute("aria-valuenow", String(percent));
    progress.setAttribute("aria-valuetext", label);
  };
  update();
  state.careerImageProgressTimer = window.setInterval(update, 1_000);
}

function errorScreen(options) {
  const settings = options || {};
  setView(
    '<section class="screen screen--center screen--narrow">' +
      '<div class="status-icon status-icon--error" aria-hidden="true">!</div>' +
      "<h1>" +
      escapeHtml(settings.title || "うまく できなかったよ") +
      "</h1>" +
      (settings.message
        ? '<p class="lead">' + escapeHtml(settings.message) + "</p>"
        : "") +
      '<div class="actions">' +
      (settings.retry
        ? '<button class="button" id="error-retry" type="button">' +
          escapeHtml(settings.retryLabel || "もういちど") +
          "</button>"
        : "") +
      (settings.back
        ? '<button class="button button--secondary" id="error-back" type="button">' +
          escapeHtml(settings.backLabel || "もどる") +
          "</button>"
        : "") +
      "</div>" +
      "</section>",
  );
  const retry = document.querySelector("#error-retry");
  const back = document.querySelector("#error-back");
  if (retry) retry.addEventListener("click", settings.retry);
  if (back) back.addEventListener("click", settings.back);
}

function renderUnavailable(retry) {
  errorScreen({
    title: "まだ じゅんびが できていません",
    message: "スタッフを よんでね",
    retry: retry,
    retryLabel: "もういちど つなぐ",
  });
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = 0.88;
  window.speechSynthesis.speak(utterance);
}

function renderQuestion(options) {
  const settings = options || {};
  const questionOptions = normalizeList(settings.options).map(normalizeOption);
  const gridClass = questionOptions.length === 3 ? "choice-grid--three" : "";
  let choices = "";

  questionOptions.forEach(function (option, index) {
    choices +=
      '<button class="choice-button" type="button" data-answer-index="' +
      index +
      '">' +
      '<span class="choice-icon" aria-hidden="true">' +
      escapeHtml(option.icon) +
      "</span>" +
      '<span class="choice-copy"><span>' +
      escapeHtml(option.label) +
      "</span>" +
      (option.note
        ? '<span class="choice-note">' + escapeHtml(option.note) + "</span>"
        : "") +
      "</span></button>";
  });

  if (settings.allowCustom !== false) {
    choices +=
      '<button class="choice-button" id="custom-answer" type="button">' +
      '<span class="choice-icon" aria-hidden="true">…</span>' +
      '<span class="choice-copy"><span>じぶんで こたえる</span></span>' +
      "</button>";
  }

  setView(
    '<section class="screen">' +
      '<div class="screen-heading">' +
      (settings.current && settings.total
        ? progressDots(settings.current, settings.total) +
          '<p class="step-label">' +
          settings.current +
          " / " +
          settings.total +
          "</p>"
        : settings.eyebrow
          ? '<p class="eyebrow">' + escapeHtml(settings.eyebrow) + "</p>"
          : "") +
      '<div class="question-title-row">' +
      '<h1 data-autofocus tabindex="-1">' +
      escapeHtml(settings.question) +
      "</h1>" +
      '<button class="speak-button" id="speak-question" type="button" aria-label="しつもんを もういちど きく">きく</button>' +
      "</div></div>" +
      '<div class="choice-grid ' +
      gridClass +
      '">' +
      choices +
      "</div>" +
      "</section>",
  );

  document.querySelectorAll("[data-answer-index]").forEach(function (button) {
    button.addEventListener("click", function () {
      const option = questionOptions[Number(button.dataset.answerIndex)];
      settings.onAnswer(option.value, option.label);
    });
  });

  const custom = document.querySelector("#custom-answer");
  if (custom && settings.onCustom) custom.addEventListener("click", settings.onCustom);
  const speakButton = document.querySelector("#speak-question");
  if (!("speechSynthesis" in window)) {
    speakButton.hidden = true;
  } else {
    speakButton.addEventListener("click", function () {
      speak(settings.question);
    });
  }
}

function renderTextInputScreen(options) {
  const settings = options || {};
  const multiline = settings.multiline !== false;
  const inputMarkup = multiline
    ? '<textarea class="text-area" id="answer-input" maxlength="' +
      (settings.maxLength || 40) +
      '" placeholder="' +
      escapeHtml(settings.placeholder || "") +
      '" data-autofocus></textarea>'
    : '<input class="text-input" id="answer-input" type="text" maxlength="' +
      (settings.maxLength || 30) +
      '" placeholder="' +
      escapeHtml(settings.placeholder || "") +
      '" data-autofocus />';

  setView(
    '<section class="screen screen--narrow">' +
      '<div class="screen-heading">' +
      (settings.eyebrow
        ? '<p class="eyebrow">' + escapeHtml(settings.eyebrow) + "</p>"
        : "") +
      "<h1>" +
      escapeHtml(settings.title) +
      "</h1>" +
      "</div>" +
      '<form class="form-card" id="text-answer-form">' +
      '<div class="field"><label class="field-label" for="answer-input">' +
      escapeHtml(settings.label || "ことばを いれてね") +
      "</label>" +
      inputMarkup +
      '<p class="field-message" id="text-message" aria-live="polite"></p></div>' +
      '<div class="actions">' +
      '<button class="button" id="text-submit" type="submit" disabled>' +
      escapeHtml(settings.submitLabel || "このこたえで おくる") +
      "</button>" +
      (settings.onBack
        ? '<button class="button button--secondary" id="text-back" type="button">' +
          escapeHtml(settings.backLabel || "えらびなおす") +
          "</button>"
        : "") +
      "</div></form></section>",
  );

  const form = document.querySelector("#text-answer-form");
  const input = document.querySelector("#answer-input");
  const submit = document.querySelector("#text-submit");
  input.value = settings.initialValue || "";

  function updateSubmit() {
    submit.disabled = input.value.trim().length === 0;
  }

  input.addEventListener("input", updateSubmit);
  updateSubmit();

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    settings.onSubmit(value);
  });

  const back = document.querySelector("#text-back");
  if (back) back.addEventListener("click", settings.onBack);
}

function formatChildError(error) {
  if (error && error.status === 400) {
    return "そのことばでは つくれないよ。べつのことばに してね";
  }
  if (error && (error.status === 0 || error.status >= 500)) {
    return "つながらなかったよ。もういちど おしてね";
  }
  return "うまく できなかったよ。もういちど おしてね";
}

async function loadPublicConfig() {
  try {
    const response = await apiGet("/api/public-config");
    state.config = unwrapData(response) || DEFAULT_CONFIG;
  } catch (error) {
    state.config = DEFAULT_CONFIG;
  }
  testModeBadge.hidden = state.config.audienceMode !== "adult-test";
}

async function checkHealth() {
  try {
    const response = await apiGet("/api/health");
    const value = unwrapData(response);
    state.healthy = !(
      value &&
      typeof value === "object" &&
      (value.ok === false ||
        value.healthy === false ||
        value.status === "error" ||
        (value.textAi && value.textAi.ok === false) ||
        (value.image && value.image.ready === false))
    );
  } catch (error) {
    state.healthy = false;
  }
  return state.healthy;
}

function craftMaterials() {
  const config = state.config || {};
  return normalizeList(
    (config.craft && config.craft.materials) || config.materials || [],
  ).filter(function (material) {
    return material && material.enabled !== false && material.active !== false;
  });
}

function craftStyles() {
  const config = state.config || {};
  const styles = normalizeList(
    (config.craft && config.craft.styles) || config.craftStyles,
  );
  return styles.length ? styles : DEFAULT_CONFIG.craft.styles;
}

function dreamGenres() {
  const config = state.config || {};
  const genres = normalizeList(
    (config.dream && config.dream.genres) || config.dreamGenres || config.genres,
  ).filter(function (genre) {
    return genre && genre.enabled !== false && genre.visible !== false;
  });
  return genres.length ? genres : DEFAULT_CONFIG.dream.genres;
}

function dreamFreeModeEnabled() {
  const config = state.config || {};
  if (config.dream && typeof config.dream.freeModeEnabled === "boolean") {
    return config.dream.freeModeEnabled;
  }
  if (typeof config.freeModeEnabled === "boolean") return config.freeModeEnabled;
  return true;
}

function memoryConfigTables() {
  const config = state.config || {};
  return normalizeTables(
    (config.memory && config.memory.tables) || config.memoryTables || config.tables || [],
  );
}

function renderHome() {
  restartButton.hidden = true;
  setView(
    '<section class="screen">' +
      '<div class="screen-heading"><p class="eyebrow">スタッフ用 スタート</p>' +
      '<h1 data-autofocus tabindex="-1">ひらく アプリを えらぶ</h1></div>' +
      '<nav class="home-grid" aria-label="アプリ一覧">' +
      '<a class="route-card" href="/career"><span class="route-card__number">1</span><span>しごとに へんしん</span></a>' +
      '<a class="route-card" href="/craft"><span class="route-card__number">2</span><span>デニムこうさく</span></a>' +
      '<a class="route-card" href="/dream"><span class="route-card__number">3</span><span>りそうの ○○</span></a>' +
      '<a class="route-card" href="/memory"><span class="route-card__number">4</span><span>きょうの おもいで</span></a>' +
      "</nav></section>",
  );
}

function initCareer() {
  state.career = {
    sessionId: "",
    step: 1,
    total: CAREER_TOTAL_STEPS,
    question: null,
    recommendations: [],
    selectedCareer: null,
    photoDataUrl: "",
    resultImageUrl: "",
  };
  state.hasProgress = false;
  startCareerInterview();
}

function normalizeCareerInterviewQuestion(response) {
  const value = unwrapData(response) || {};
  let question = value.question || value.nextQuestion || value.prompt;
  let options = value.options || value.choices;
  if (question && typeof question === "object") {
    options = question.options || question.choices || options;
    question = question.text || question.question || question.prompt;
  }
  const text = String(question || "").trim();
  const choices = normalizeList(options);
  const questionId = String(value.questionId || value.questionID || "").trim();
  if (!text || choices.length !== 4 || !questionId) {
    throw new ApiError("しつもんがありません", 502, response);
  }
  return {
    id: questionId,
    text: text,
    options: choices,
    step: Number(value.step) || 1,
    total: Number(value.total) || CAREER_TOTAL_STEPS,
  };
}

async function startCareerInterview() {
  state.hasProgress = true;
  loadingScreen("しつもんを かんがえ中", "きみに あった しつもんを つくっているよ");
  try {
    const response = await apiPost("/api/career/start", {});
    const value = unwrapData(response) || {};
    const sessionId = String(value.sessionId || value.sessionID || "").trim();
    if (!sessionId) throw new ApiError("セッションがありません", 502, response);
    state.career.sessionId = sessionId;
    state.career.question = normalizeCareerInterviewQuestion(response);
    state.career.step = state.career.question.step;
    state.career.total = state.career.question.total;
    renderCareerQuestion();
  } catch (error) {
    errorScreen({
      title: "しつもんを はじめられなかったよ",
      message: formatChildError(error),
      retry: startCareerInterview,
      retryLabel: "もういちど はじめる",
    });
  }
}

function renderCareerQuestion() {
  const career = state.career;
  const question = career.question;
  if (!question) {
    startCareerInterview();
    return;
  }

  renderQuestion({
    current: career.step,
    total: career.total,
    question: question.text,
    options: question.options,
    onAnswer: function (value) {
      submitCareerAnswer(value);
    },
    onCustom: function () {
      renderTextInputScreen({
        eyebrow: career.step + " / " + career.total,
        title: question.text,
        label: "じぶんの ことばで こたえてね",
        placeholder: "れい：えを かくのが すき",
        maxLength: 40,
        submitLabel: career.step === career.total ? "こたえて しごとをさがす" : "このこたえで おくる",
        onSubmit: submitCareerAnswer,
        onBack: renderCareerQuestion,
      });
    },
  });
}

async function submitCareerAnswer(answer) {
  const question = state.career.question;
  if (!question) return;
  loadingScreen(
    state.career.step === state.career.total ? "こたえを まとめ中" : "つぎの しつもんを かんがえ中",
  );
  try {
    const response = await apiPost("/api/career/answer", {
      sessionId: state.career.sessionId,
      questionId: question.id,
      answer: answer,
    });
    const value = unwrapData(response) || {};
    if (value.ready === true) {
      state.career.question = null;
      await requestCareerRecommendations();
      return;
    }
    state.career.question = normalizeCareerInterviewQuestion(response);
    state.career.step = state.career.question.step;
    state.career.total = state.career.question.total;
    renderCareerQuestion();
  } catch (error) {
    errorScreen({
      title: "こたえを おくれなかったよ",
      message: formatChildError(error),
      retry: function () {
        submitCareerAnswer(answer);
      },
      retryLabel: "もういちど おくる",
      back: renderCareerQuestion,
      backLabel: "こたえを えらびなおす",
    });
  }
}

function normalizeCareers(response) {
  const value = unwrapData(response) || {};
  let list =
    value.careers ||
    value.recommendations ||
    value.jobs ||
    (value.career ? [value.career] : []) ||
    [];
  if (!normalizeList(list).length && (value.careerId || value.job)) {
    list = [value];
  }
  list = normalizeList(list).slice(0, 3);
  return list.map(function (career, index) {
    if (typeof career === "string") {
      return {
        id: career,
        name: career,
        reason: "きみの こたえから みつけた しごとだよ",
        kind: "",
        kindLabel: "しごとの アイデア",
        icon: String(index + 1),
      };
    }
    const kind = String(career.kind || career.type || "");
    const kindMeta = CAREER_KIND_META[kind] || {};
    return {
      id: String(career.id || career.careerId || career.slug || "career-" + index),
      name: String(career.name || career.job || career.label || career.title || "しごと"),
      reason: Array.isArray(career.reasons)
        ? career.reasons.join("。")
        : String(
            career.reason ||
              career.reasons ||
              career.description ||
              "きみの こたえから みつけた しごとだよ",
          ),
      kind: kind,
      kindLabel: String(career.kindLabel || kindMeta.label || "しごとの アイデア"),
      icon: String(career.icon || career.symbol || kindMeta.icon || index + 1),
    };
  });
}

async function requestCareerRecommendations() {
  loadingScreen("しごとを さがしているよ", "どんなしごとが たのしそうかな？");
  try {
    const response = await apiPost("/api/career/recommend", {
      sessionId: state.career.sessionId,
    });
    const careers = normalizeCareers(response);
    if (!careers.length) throw new ApiError("候補がありません", 502, response);
    state.career.recommendations = careers;
    renderCareerRecommendations();
  } catch (error) {
    errorScreen({
      title: "しごとを みつけられなかったよ",
      message: formatChildError(error),
      retry: requestCareerRecommendations,
      retryLabel: "もういちど さがす",
      back: initCareer,
      backLabel: "はじめから やりなおす",
    });
  }
}

function renderCareerRecommendations() {
  let cards = "";
  state.career.recommendations.forEach(function (career, index) {
    cards +=
      '<article class="recommendation-card">' +
      '<div class="recommendation-card__icon" aria-hidden="true">' +
      escapeHtml(career.icon) +
      "</div>" +
      '<span class="recommendation-card__kind">' +
      escapeHtml(career.kindLabel) +
      "</span>" +
      "<h2>" +
      escapeHtml(career.name) +
      "</h2>" +
      "<p>" +
      escapeHtml(career.reason) +
      "</p>" +
      '<button class="button" type="button" data-career-index="' +
      index +
      '">このしごとに なる！</button></article>';
  });

  setView(
    '<section class="screen"><div class="screen-heading">' +
      '<p class="eyebrow">きみの こたえから</p>' +
      '<h1 data-autofocus tabindex="-1">こんなしごと、たのしそう！</h1>' +
      "</div>" +
      '<div class="recommendation-grid">' +
      cards +
      "</div></section>",
  );

  document.querySelectorAll("[data-career-index]").forEach(function (button) {
    button.addEventListener("click", function () {
      state.career.selectedCareer =
        state.career.recommendations[Number(button.dataset.careerIndex)];
      renderCareerCamera();
      beginCamera();
    });
  });
}

function renderCareerCamera(cameraError) {
  const selected = state.career.selectedCareer;
  const privatePhotoReady = window.isSecureContext || isLoopbackHost();
  if (!privatePhotoReady) {
    stopCamera();
    setView(
      '<section class="screen screen--center screen--narrow"><div class="status-icon status-icon--error" aria-hidden="true">鍵</div>' +
        '<h1>HTTPSの じゅんびが ひつようです</h1>' +
        '<p class="lead">しゃしんは おくらず、スタッフを よんでね</p>' +
        '<div class="actions"><button class="button button--secondary" id="back-to-careers" type="button">しごとを えらびなおす</button></div></section>',
    );
    document.querySelector("#back-to-careers").addEventListener("click", renderCareerRecommendations);
    return;
  }
  const hasStream = Boolean(state.cameraStream);
  setView(
    '<section class="screen"><div class="camera-layout">' +
      '<div class="camera-frame">' +
      (hasStream
        ? '<video id="camera-video" autoplay playsinline muted></video><div class="face-guide" aria-hidden="true"></div>'
        : '<div class="camera-placeholder">' +
          escapeHtml(cameraError || "カメラを じゅんびしているよ") +
          "</div>") +
      "</div>" +
      '<div class="camera-copy"><p class="eyebrow">' +
      escapeHtml(selected.name) +
      "</p>" +
      "<h1>かおを わくに あわせてね</h1>" +
      '<p class="lead">まえを むいて にっこり！</p>' +
      '<div class="actions">' +
      (hasStream
        ? '<button class="button" id="take-photo" type="button">しゃしんを とる</button>'
        : '<button class="button" id="retry-camera" type="button">カメラを つかう</button>') +
      '<button class="button button--secondary" id="choose-photo" type="button">しゃしんを えらぶ</button>' +
      '<input class="visually-hidden" id="career-photo-file" type="file" accept="image/jpeg,image/png,image/webp" />' +
      '<button class="button button--secondary" id="back-to-careers" type="button">しごとを えらびなおす</button>' +
      "</div></div></div></section>",
  );

  if (hasStream) {
    const video = document.querySelector("#camera-video");
    video.srcObject = state.cameraStream;
    document.querySelector("#take-photo").addEventListener("click", capturePhoto);
  } else {
    document.querySelector("#retry-camera").addEventListener("click", beginCamera);
  }
  const fileInput = document.querySelector("#career-photo-file");
  document.querySelector("#choose-photo").addEventListener("click", function () {
    fileInput.click();
  });
  fileInput.addEventListener("change", function () {
    const file = fileInput.files && fileInput.files[0];
    if (file) useCareerPhotoFile(file);
  });
  document.querySelector("#back-to-careers").addEventListener("click", function () {
    stopCamera();
    renderCareerRecommendations();
  });
}

async function beginCamera() {
  stopCamera();
  const requestId = state.cameraRequestId;
  if (!(window.isSecureContext || isLoopbackHost())) {
    renderCareerCamera();
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    renderCareerCamera("カメラが つかえないよ。スタッフを よんでね");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    if (requestId !== state.cameraRequestId) {
      stream.getTracks().forEach(function (track) {
        track.stop();
      });
      return;
    }
    state.cameraStream = stream;
    renderCareerCamera();
  } catch (error) {
    if (requestId !== state.cameraRequestId) return;
    renderCareerCamera("カメラが つかえないよ。スタッフを よんでね");
  }
}

function readFileAsDataUrl(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.addEventListener("load", function () {
      resolve(String(reader.result || ""));
    });
    reader.addEventListener("error", function () {
      reject(new Error("ファイルを読み込めませんでした"));
    });
    reader.readAsDataURL(file);
  });
}

function resizePhotoDataUrl(dataUrl) {
  return new Promise(function (resolve, reject) {
    const image = new Image();
    image.addEventListener("load", function () {
      const maxSide = 1280;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.88));
    });
    image.addEventListener("error", function () {
      reject(new Error("画像を開けませんでした"));
    });
    image.src = dataUrl;
  });
}

async function useCareerPhotoFile(file) {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    showToast("JPEG・PNG・WebPの しゃしんを えらんでね");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast("10MBより ちいさい しゃしんを えらんでね");
    return;
  }
  loadingScreen("しゃしんを よみこみ中");
  try {
    const dataUrl = await readFileAsDataUrl(file);
    state.career.photoDataUrl = await resizePhotoDataUrl(dataUrl);
    stopCamera();
    renderCareerPhotoReview();
  } catch (error) {
    renderCareerCamera("しゃしんを よみこめなかったよ");
  }
}

function capturePhoto() {
  const video = document.querySelector("#camera-video");
  if (!video || !video.videoWidth || !video.videoHeight) {
    showToast("カメラを もういちど ためしてね");
    return;
  }
  const maxWidth = 1280;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.translate(width, 0);
  context.scale(-1, 1);
  context.drawImage(video, 0, 0, width, height);
  state.career.photoDataUrl = canvas.toDataURL("image/jpeg", 0.88);
  stopCamera();
  renderCareerPhotoReview();
}

function renderCareerPhotoReview() {
  setView(
    '<section class="screen"><div class="camera-layout">' +
      '<div class="camera-frame"><img class="photo-preview" src="' +
      escapeHtml(state.career.photoDataUrl) +
      '" alt="とった しゃしん" /></div>' +
      '<div class="camera-copy"><p class="eyebrow">' +
      escapeHtml(state.career.selectedCareer.name) +
      "</p>" +
      "<h1>このしゃしんで いい？</h1>" +
      '<div class="actions">' +
      '<button class="button" id="generate-career" type="button">このしゃしんで つくる</button>' +
      '<button class="button button--secondary" id="retake-photo" type="button">とりなおす</button>' +
      "</div></div></div></section>",
  );
  document.querySelector("#generate-career").addEventListener("click", generateCareerImage);
  document.querySelector("#retake-photo").addEventListener("click", function () {
    state.career.photoDataUrl = "";
    renderCareerCamera();
    beginCamera();
  });
}

async function generateCareerImage() {
  careerImageLoadingScreen(state.career.selectedCareer.name);
  try {
    const response = await apiPost("/api/career/generate", {
      careerId: state.career.selectedCareer.id,
      photoDataUrl: state.career.photoDataUrl,
    });
    const imageUrl = extractImageUrl(response);
    if (!imageUrl) throw new ApiError("画像がありません", 502, response);
    stopCareerImageProgress();
    state.career.resultImageUrl = imageUrl;
    state.career.photoDataUrl = "";
    renderCareerResult();
  } catch (error) {
    stopCareerImageProgress();
    errorScreen({
      title: "へんしん できなかったよ",
      message: formatChildError(error),
      retry: generateCareerImage,
      retryLabel: "もういちど つくる",
      back: renderCareerPhotoReview,
      backLabel: "しゃしんを かくにん",
    });
  }
}

function renderCareerResult() {
  setView(
    '<section class="screen print-area"><div class="result-layout">' +
      '<div class="result-image-frame result-image-frame--portrait">' +
      '<img class="result-image" src="' +
      escapeHtml(state.career.resultImageUrl) +
      '" alt="' +
      escapeHtml(state.career.selectedCareer.name) +
      'に なりきった しゃしん" /><p class="career-print-label">AIでつくった未来のわたし：' +
      escapeHtml(state.career.selectedCareer.name) +
      '</p></div>' +
      '<div class="result-copy no-print"><p class="eyebrow">できあがり！</p>' +
      '<h1><span class="career-result-job">' +
      escapeHtml(state.career.selectedCareer.name) +
      '</span><span class="career-result-suffix">に へんしん！</span></h1>' +
      '<p class="lead">スタッフを よんでね</p>' +
      '<div class="actions">' +
      '<button class="button" id="print-career" type="button">スタッフが いんさつ</button>' +
      '<button class="button button--secondary" id="career-again" type="button">つぎの人に かわる</button>' +
      "</div></div></div></section>",
  );
  document.querySelector("#print-career").addEventListener("click", function () {
    window.print();
  });
  document.querySelector("#career-again").addEventListener("click", function () {
    if (window.confirm("写真の紙が出たことをスタッフが確認しましたか？ 次へ進むとこの画面には戻れません。")) {
      initCareer();
    }
  });
}

function initCraft() {
  state.craft = {
    mode: "",
    style: "",
    idea: "",
    resultImageUrl: "",
  };
  state.hasProgress = false;
  renderCraftStart();
}

function materialImage(material) {
  if (typeof material === "string") return safeImageUrl(material);
  return safeImageUrl(
    material.imageUrl || material.imageURL || material.url || material.thumbnailUrl || "",
  );
}

function materialName(material, index) {
  if (typeof material === "string") return "そざい " + (index + 1);
  return String(material.name || material.label || "そざい " + (index + 1));
}

function renderMaterialsStrip(materials) {
  let thumbs = '<span class="materials-label">きょう つかうもの</span>';
  materials.slice(0, 8).forEach(function (material, index) {
    const imageUrl = materialImage(material);
    if (!imageUrl) return;
    thumbs +=
      '<div class="material-thumb"><img src="' +
      escapeHtml(imageUrl) +
      '" alt="' +
      escapeHtml(materialName(material, index)) +
      '" /></div>';
  });
  return '<div class="materials-strip">' + thumbs + "</div>";
}

function renderCraftStart() {
  const materials = craftMaterials();
  if (!materials.length) {
    errorScreen({
      title: "そざいを じゅんび中です",
      message: "スタッフを よんでね",
      retry: async function () {
        await loadPublicConfig();
        renderCraftStart();
      },
      retryLabel: "もういちど かくにん",
    });
    return;
  }

  setView(
    '<section class="screen"><div class="screen-heading">' +
      renderMaterialsStrip(materials) +
      '<h1 data-autofocus tabindex="-1">つくりかたを えらぶ</h1></div>' +
      '<div class="choice-grid">' +
      '<button class="choice-button" type="button" data-craft-mode="easy">' +
      '<span class="choice-icon" aria-hidden="true">○</span>' +
      '<span class="choice-copy"><span>かんたん</span>' +
      '<span class="choice-note">デニムは ひとつだけ・かたちは そのまま</span></span></button>' +
      '<button class="choice-button" type="button" data-craft-mode="hard">' +
      '<span class="choice-icon" aria-hidden="true">★</span>' +
      '<span class="choice-copy"><span>むずかしい</span>' +
      '<span class="choice-note">デニムを きったり まげたり</span></span></button>' +
      "</div></section>",
  );

  document.querySelectorAll("[data-craft-mode]").forEach(function (button) {
    button.addEventListener("click", function () {
      state.craft.mode = button.dataset.craftMode;
      renderCraftStyles();
    });
  });
}

function renderCraftStyles() {
  const materials = craftMaterials();
  if (!materials.length) {
    renderCraftStart();
    return;
  }

  const styles = craftStyles().map(normalizeOption);
  let choices = "";
  styles.forEach(function (style, index) {
    choices +=
      '<button class="choice-button" type="button" data-craft-style="' +
      index +
      '">' +
      '<span class="choice-icon" aria-hidden="true">' +
      escapeHtml(style.icon) +
      '</span><span class="choice-copy"><span>' +
      escapeHtml(style.label) +
      " みほんを つくる</span></span></button>";
  });
  choices +=
    '<button class="choice-button" id="craft-custom" type="button">' +
    '<span class="choice-icon" aria-hidden="true">…</span>' +
    '<span class="choice-copy"><span>じぶんで いう</span></span></button>';

  setView(
    '<section class="screen"><div class="screen-heading">' +
      renderMaterialsStrip(materials) +
      '<p class="eyebrow">' +
      (state.craft.mode === "easy" ? "かんたんな つくりかた" : "むずかしい つくりかた") +
      "</p>" +
      '<h1 data-autofocus tabindex="-1">どんなのを つくる？</h1></div>' +
      '<div class="choice-grid">' +
      choices +
      '</div><div class="actions"><button class="button button--secondary" id="craft-change-mode" type="button">つくりかたを かえる</button></div></section>',
  );

  document.querySelectorAll("[data-craft-style]").forEach(function (button) {
    button.addEventListener("click", function () {
      const style = styles[Number(button.dataset.craftStyle)];
      state.craft.style = style.value;
      state.craft.idea = "";
      state.hasProgress = true;
      generateCraftImage();
    });
  });
  document.querySelector("#craft-custom").addEventListener("click", renderCraftCustom);
  document.querySelector("#craft-change-mode").addEventListener("click", renderCraftStart);
}

function renderCraftCustom() {
  renderTextInputScreen({
    title: "どんな かんじが いい？",
    label: "ひとことで おしえてね",
    placeholder: "れい：うちゅうっぽい",
    maxLength: 30,
    submitLabel: "このことばで みほんを つくる",
    onSubmit: function (value) {
      state.craft.style = "おまかせ";
      state.craft.idea = value;
      state.hasProgress = true;
      generateCraftImage();
    },
    onBack: renderCraftStyles,
  });
}

async function generateCraftImage() {
  loadingScreen(
    "みほんを つくっているよ",
    state.craft.mode === "easy"
      ? "デニムは ひとつだけ・かたちは そのまま つかうよ"
      : "デニムが どんなかたちに なるかな？",
  );
  try {
    const response = await apiPost("/api/craft/generate", {
      mode: state.craft.mode,
      style: state.craft.style,
      idea: state.craft.idea,
    });
    const imageUrl = extractImageUrl(response);
    if (!imageUrl) throw new ApiError("画像がありません", 502, response);
    state.craft.resultImageUrl = imageUrl;
    renderCraftResult();
  } catch (error) {
    errorScreen({
      title: "みほんを つくれなかったよ",
      message: formatChildError(error),
      retry: generateCraftImage,
      retryLabel: "もういちど つくる",
      back: state.craft.style === "おまかせ" ? renderCraftCustom : renderCraftStyles,
      backLabel: state.craft.style === "おまかせ" ? "ことばを えらびなおす" : "みほんを えらびなおす",
    });
  }
}

function renderCraftResult() {
  setView(
    '<section class="screen print-area"><div class="result-layout">' +
      '<div class="result-image-frame result-image-frame--landscape">' +
      '<img class="result-image" src="' +
      escapeHtml(state.craft.resultImageUrl) +
      '" alt="デニムこうさくの できあがり みほん" /></div>' +
      '<div class="result-copy no-print"><p class="eyebrow">できあがり！</p>' +
      "<h1>このみほんを みて つくろう</h1>" +
      '<div class="actions"><button class="button" id="craft-fullscreen" type="button">おおきく みる</button>' +
      '<button class="button button--secondary" id="craft-again" type="button">さいしょから つくる</button>' +
      "</div></div></div></section>",
  );
  document.querySelector("#craft-fullscreen").addEventListener("click", function () {
    const frame = document.querySelector(".result-image-frame");
    if (frame.requestFullscreen) {
      frame.requestFullscreen().catch(function () {
        showToast("おおきく できませんでした");
      });
    }
  });
  document.querySelector("#craft-again").addEventListener("click", initCraft);
}

function initDream() {
  state.dream = {
    genre: "",
    sessionId: "",
    step: 1,
    total: DREAM_TOTAL_QUESTIONS,
    question: null,
    resultImageUrl: "",
  };
  state.hasProgress = false;
  renderDreamGenres();
}

function renderDreamGenres() {
  const genres = dreamGenres().map(normalizeOption);
  let choices = "";
  genres.slice(0, 6).forEach(function (genre, index) {
    choices +=
      '<button class="choice-button" type="button" data-dream-genre="' +
      index +
      '">' +
      '<span class="choice-icon" aria-hidden="true">' +
      escapeHtml(genre.icon) +
      '</span><span class="choice-copy"><span>' +
      escapeHtml(genre.label) +
      "</span></span></button>";
  });
  if (dreamFreeModeEnabled()) {
    choices +=
      '<button class="choice-button" id="dream-free" type="button">' +
      '<span class="choice-icon" aria-hidden="true">…</span>' +
      '<span class="choice-copy"><span>じぶんで きめる</span></span></button>';
  }

  setView(
    '<section class="screen"><div class="screen-heading">' +
      '<p class="eyebrow">りそうの ○○を つくろう</p>' +
      '<h1 data-autofocus tabindex="-1">なにを つくる？</h1></div>' +
      '<div class="choice-grid">' +
      choices +
      "</div></section>",
  );

  document.querySelectorAll("[data-dream-genre]").forEach(function (button) {
    button.addEventListener("click", function () {
      const genre = genres[Number(button.dataset.dreamGenre)];
      startDream(genre.value);
    });
  });
  const free = document.querySelector("#dream-free");
  if (free) free.addEventListener("click", renderDreamFreeGenre);
}

function renderDreamFreeGenre() {
  renderTextInputScreen({
    title: "なにを つくりたい？",
    label: "つくりたいものを おしえてね",
    placeholder: "れい：ゆめの がっこう",
    maxLength: 24,
    multiline: false,
    submitLabel: "これを つくる",
    onSubmit: startDream,
    onBack: renderDreamGenres,
  });
}

function normalizeDreamQuestion(response) {
  const value = unwrapData(response) || {};
  let question = value.question || value.nextQuestion || value.prompt;
  let options = value.options || value.choices;
  if (question && typeof question === "object") {
    options = question.options || question.choices || options;
    question = question.text || question.question || question.prompt;
  }
  const text = String(question || "").trim();
  const choices = normalizeList(options);
  const questionId = String(value.questionId || value.questionID || "").trim();
  if (!text || choices.length !== 4 || !questionId) {
    throw new ApiError("しつもんがありません", 502, response);
  }
  return {
    id: questionId,
    text: text,
    options: choices,
    step: Number(value.step) || 1,
    total: Number(value.total) || DREAM_TOTAL_QUESTIONS,
  };
}

async function startDream(genre) {
  state.hasProgress = true;
  state.dream.genre = genre;
  loadingScreen("しつもんを かんがえているよ", "どんな りそうに なるかな？");
  try {
    const response = await apiPost("/api/dream/start", { genre: genre });
    const value = unwrapData(response) || {};
    state.dream.sessionId = String(
      value.sessionId || value.sessionID || value.id || response.sessionId || "",
    );
    if (!state.dream.sessionId) {
      throw new ApiError("セッションがありません", 502, response);
    }
    state.dream.question = normalizeDreamQuestion(response);
    state.dream.step = state.dream.question.step;
    state.dream.total = state.dream.question.total;
    renderDreamQuestion();
  } catch (error) {
    errorScreen({
      title: "しつもんを はじめられなかったよ",
      message: formatChildError(error),
      retry: function () {
        startDream(genre);
      },
      retryLabel: "もういちど はじめる",
      back: renderDreamGenres,
      backLabel: "つくるものを えらびなおす",
    });
  }
}

function renderDreamQuestion() {
  const dream = state.dream;
  const question = dream.question;
  if (!question) {
    renderDreamGenres();
    return;
  }
  renderQuestion({
    current: question.step,
    total: question.total,
    question: question.text,
    options: question.options,
    onAnswer: function (value) {
      submitDreamAnswer(value);
    },
    onCustom: function () {
      renderTextInputScreen({
        eyebrow: question.step + " / " + question.total,
        title: question.text,
        label: "じぶんの ことばで こたえてね",
        placeholder: "ひとことで こたえてね",
        maxLength: 40,
        submitLabel: question.step === question.total ? "こたえて えをつくる" : "このこたえで おくる",
        onSubmit: submitDreamAnswer,
        onBack: renderDreamQuestion,
      });
    },
  });
}

async function submitDreamAnswer(answer) {
  const question = state.dream.question;
  if (!question) return;
  loadingScreen(
    question.step === question.total ? "えを つくる じゅんび中" : "つぎの しつもんを かんがえ中",
  );
  try {
    const response = await apiPost("/api/dream/answer", {
      sessionId: state.dream.sessionId,
      questionId: question.id,
      answer: answer,
    });
    const value = unwrapData(response) || {};
    if (value.ready === true) {
      state.dream.step = Number(value.step) || DREAM_TOTAL_QUESTIONS;
      state.dream.total = Number(value.total) || DREAM_TOTAL_QUESTIONS;
      state.dream.question = null;
      await generateDreamImage();
      return;
    }
    state.dream.question = normalizeDreamQuestion(response);
    state.dream.step = state.dream.question.step;
    state.dream.total = state.dream.question.total;
    renderDreamQuestion();
  } catch (error) {
    errorScreen({
      title: "こたえを おくれなかったよ",
      message: formatChildError(error),
      retry: function () {
        submitDreamAnswer(answer);
      },
      retryLabel: "もういちど おくる",
      back: renderDreamQuestion,
      backLabel: "こたえを えらびなおす",
    });
  }
}

async function generateDreamImage() {
  loadingScreen("りそうの えを つくっているよ", "5この こたえを えにしているよ");
  try {
    const response = await apiPost("/api/dream/generate", {
      sessionId: state.dream.sessionId,
    });
    const imageUrl = extractImageUrl(response);
    if (!imageUrl) throw new ApiError("画像がありません", 502, response);
    state.dream.resultImageUrl = imageUrl;
    renderDreamResult();
  } catch (error) {
    errorScreen({
      title: "えを つくれなかったよ",
      message: formatChildError(error),
      retry: generateDreamImage,
      retryLabel: "もういちど つくる",
      back: initDream,
      backLabel: "さいしょから つくる",
    });
  }
}

function renderDreamResult() {
  setView(
    '<section class="screen print-area"><div class="result-layout">' +
      '<div class="result-image-frame result-image-frame--landscape">' +
      '<img class="result-image" src="' +
      escapeHtml(state.dream.resultImageUrl) +
      '" alt="りそうの ' +
      escapeHtml(state.dream.genre) +
      'の イラスト" /></div>' +
      '<div class="result-copy no-print"><p class="eyebrow">できあがり！</p>' +
      "<h1>りそうの " +
      escapeHtml(state.dream.genre) +
      "</h1>" +
      '<div class="actions"><button class="button" id="dream-fullscreen" type="button">おおきく みる</button>' +
      '<button class="button button--secondary" id="dream-again" type="button">さいしょから つくる</button>' +
      "</div></div></div></section>",
  );
  document.querySelector("#dream-fullscreen").addEventListener("click", function () {
    const frame = document.querySelector(".result-image-frame");
    if (frame.requestFullscreen) {
      frame.requestFullscreen().catch(function () {
        showToast("おおきく できませんでした");
      });
    }
  });
  document.querySelector("#dream-again").addEventListener("click", initDream);
}

function normalizeTables(tables) {
  return normalizeList(tables).map(function (table, index) {
    if (typeof table === "string") {
      return {
        id: table,
        name: table,
        expected: 0,
        received: 0,
      };
    }
    return {
      id: String(table.id || table.tableId || table.value || "table-" + (index + 1)),
      name: String(table.name || table.label || table.title || "テーブル " + (index + 1)),
      expected: Number(table.expected || table.expectedCount || table.total || 0),
      received: Number(table.received || table.receivedCount || table.count || 0),
    };
  });
}

function normalizeMemoryStatus(response) {
  const outer = unwrapData(response) || {};
  const value = outer.memory || outer;
  const statusText = String(value.status || value.phase || "").toLowerCase();
  const tables = normalizeTables(
    value.tables || (state.config.memory && state.config.memory.tables) || [],
  );
  const expected =
    Number(value.expected || value.expectedCount || value.total || 0) ||
    tables.reduce(function (sum, table) {
      return sum + table.expected;
    }, 0);
  const received =
    Number(value.received || value.receivedCount || value.count || 0) ||
    tables.reduce(function (sum, table) {
      return sum + table.received;
    }, 0);
  const published =
    Boolean(value.published || value.isPublished) ||
    statusText === "published" ||
    statusText === "public";
  const open =
    typeof value.open === "boolean"
      ? value.open
      : typeof value.isOpen === "boolean"
        ? value.isOpen
        : statusText === "open" || statusText === "collecting";
  return {
    raw: value,
    open: open,
    published: published,
    generating: statusText === "generating" || Boolean(value.generating),
    complete:
      Boolean(value.complete || value.allReceived) ||
      (expected > 0 && received >= expected),
    imageUrl: extractImageUrl(value.publishedImage || value.finalImage || value),
    expected: expected,
    received: received,
    tables: tables.length ? tables : memoryConfigTables(),
    eventName: String(value.eventName || value.title || "きょうの おもいで"),
  };
}

function initMemory() {
  const query = new URLSearchParams(window.location.search);
  state.memory = {
    status: null,
    tableId: query.get("table") || "",
    nickname: "",
    prompt: "",
    submitting: false,
  };
  state.hasProgress = false;
  loadMemoryStatus(true);
}

async function loadMemoryStatus(showLoading) {
  if (showLoading) loadingScreen("おもいでを かくにん中");
  try {
    const response = await apiGet("/api/memory/status");
    state.memory.status = normalizeMemoryStatus(response);
    renderMemoryStatus();
    startMemoryPolling();
  } catch (error) {
    errorScreen({
      title: "まだ じゅんびが できていません",
      message: "スタッフを よんでね",
      retry: function () {
        loadMemoryStatus(true);
      },
      retryLabel: "もういちど つなぐ",
    });
  }
}

function startMemoryPolling() {
  window.clearInterval(state.pollTimer);
  state.pollTimer = window.setInterval(refreshMemoryStatus, 5000);
}

async function refreshMemoryStatus() {
  if (!state.memory || state.memory.submitting) return;
  try {
    const response = await apiGet("/api/memory/status");
    const next = normalizeMemoryStatus(response);
    const previous = state.memory.status;
    state.memory.status = next;
    if (
      !previous ||
      next.published !== previous.published ||
      next.open !== previous.open ||
      next.complete !== previous.complete ||
      next.imageUrl !== previous.imageUrl
    ) {
      renderMemoryStatus();
      return;
    }
    const progress = document.querySelector("#memory-progress-count");
    if (progress) {
      progress.textContent =
        next.expected > 0 ? next.received + " / " + next.expected + " にん" : next.received + " にん";
    }
  } catch (error) {
    // 入力中の画面を消さず、次回の確認で復旧させる。
  }
}

function renderMemoryStatus() {
  const memory = state.memory.status;
  if (memory.published && memory.imageUrl) {
    renderMemoryPublished();
    return;
  }
  if (memory.generating || (!memory.open && memory.complete)) {
    renderMemoryWaiting();
    return;
  }
  if (!memory.open) {
    setView(
      '<section class="screen screen--center"><div class="status-icon" aria-hidden="true">待</div>' +
        "<h1>まだ はじまっていません</h1>" +
        '<p class="lead">スタッフが あけるまで まってね</p>' +
        '<div class="actions"><button class="button button--secondary" id="memory-refresh" type="button">もういちど かくにん</button></div>' +
        "</section>",
    );
    document.querySelector("#memory-refresh").addEventListener("click", function () {
      loadMemoryStatus(true);
    });
    return;
  }
  renderMemoryForm();
}

function renderMemoryWaiting() {
  const memory = state.memory.status;
  setView(
    '<section class="screen screen--center"><div class="status-icon status-icon--success" aria-hidden="true">✓</div>' +
      "<h1>みんな そろった！</h1>" +
      '<p class="lead">みんなの えを じゅんび中！</p>' +
      '<div class="memory-progress"><span id="memory-progress-count">' +
      (memory.expected > 0
        ? memory.received + " / " + memory.expected + " にん"
        : memory.received + " にん") +
      "</span></div>" +
      "</section>",
  );
}

function renderMemoryPublished() {
  const memory = state.memory.status;
  setView(
    '<section class="screen print-area"><div class="result-layout">' +
      '<div class="result-image-frame result-image-frame--landscape">' +
      '<img class="result-image" src="' +
      escapeHtml(memory.imageUrl) +
      '" alt="みんなの おもいでの イラスト" /></div>' +
      '<div class="result-copy no-print"><p class="eyebrow">できあがり！</p>' +
      "<h1>" +
      escapeHtml(memory.eventName) +
      "</h1>" +
      '<div class="actions"><button class="button" id="memory-fullscreen" type="button">おおきく みる</button></div>' +
      "</div></div></section>",
  );
  document.querySelector("#memory-fullscreen").addEventListener("click", function () {
    const frame = document.querySelector(".result-image-frame");
    if (frame.requestFullscreen) {
      frame.requestFullscreen().catch(function () {
        showToast("おおきく できませんでした");
      });
    }
  });
}

function renderMemoryForm() {
  const memory = state.memory.status;
  const queryTable = memory.tables.find(function (table) {
    return table.id === state.memory.tableId;
  });
  let tableField = "";
  if (queryTable) {
    tableField =
      '<div class="field"><span class="field-label">テーブル</span>' +
      '<div class="text-input" aria-label="テーブル">' +
      escapeHtml(queryTable.name) +
      "</div></div>";
  } else {
    let options = '<option value="">テーブルを えらんでね</option>';
    memory.tables.forEach(function (table) {
      options +=
        '<option value="' +
        escapeHtml(table.id) +
        '">' +
        escapeHtml(table.name) +
        "</option>";
    });
    tableField =
      '<div class="field"><label class="field-label" for="memory-table">どの テーブル？</label>' +
      '<select class="big-select" id="memory-table">' +
      options +
      "</select></div>";
  }

  if (!memory.tables.length) {
    errorScreen({
      title: "テーブルを じゅんび中です",
      message: "スタッフを よんでね",
      retry: function () {
        loadMemoryStatus(true);
      },
      retryLabel: "もういちど かくにん",
    });
    return;
  }

  setView(
    '<section class="screen screen--narrow"><div class="screen-heading">' +
      '<p class="eyebrow">きょうの おもいで</p>' +
      '<h1>おもいでを ひとこと！</h1>' +
      '<div class="memory-progress"><span id="memory-progress-count">' +
      (memory.expected > 0
        ? memory.received + " / " + memory.expected + " にん"
        : memory.received + " にん") +
      "</span></div></div>" +
      '<form class="form-card" id="memory-form">' +
      tableField +
      '<div class="field"><label class="field-label" for="memory-nickname">ニックネーム（ほんみょうは いれない）</label>' +
      '<input class="text-input" id="memory-nickname" type="text" maxlength="10" placeholder="れい：ひな" autocomplete="off" /></div>' +
      '<div class="field"><label class="field-label" for="memory-prompt">きょう たのしかったこと</label>' +
      '<textarea class="text-area" id="memory-prompt" maxlength="40" placeholder="ひとことで おしえてね"></textarea>' +
      '<p class="field-message" id="memory-message" aria-live="polite"></p></div>' +
      '<div class="actions"><button class="button" id="memory-submit" type="submit" disabled>このひとことで おくる</button></div>' +
      "</form></section>",
  );

  const form = document.querySelector("#memory-form");
  const table = document.querySelector("#memory-table");
  const nickname = document.querySelector("#memory-nickname");
  const prompt = document.querySelector("#memory-prompt");
  const submit = document.querySelector("#memory-submit");
  nickname.value = state.memory.nickname;
  prompt.value = state.memory.prompt;
  if (table) table.value = state.memory.tableId;

  function updateMemorySubmit() {
    state.memory.tableId = queryTable ? queryTable.id : table.value;
    state.memory.nickname = nickname.value;
    state.memory.prompt = prompt.value;
    state.hasProgress = Boolean(
      state.memory.tableId || state.memory.nickname.trim() || state.memory.prompt.trim(),
    );
    submit.disabled = !(
      state.memory.tableId &&
      state.memory.nickname.trim() &&
      state.memory.prompt.trim()
    );
  }

  [table, nickname, prompt].filter(Boolean).forEach(function (field) {
    field.addEventListener("input", updateMemorySubmit);
    field.addEventListener("change", updateMemorySubmit);
  });
  updateMemorySubmit();
  nickname.focus({ preventScroll: true });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    updateMemorySubmit();
    if (submit.disabled) return;
    submitMemoryEntry();
  });
}

async function submitMemoryEntry() {
  state.memory.submitting = true;
  loadingScreen("ことばを おくっているよ");
  try {
    const response = await apiPost("/api/memory/entries", {
      tableId: state.memory.tableId,
      nickname: state.memory.nickname.trim(),
      prompt: state.memory.prompt.trim(),
    });
    const value = unwrapData(response) || {};
    const marker = String(value.marker || value.symbol || "✓");
    const nickname = state.memory.nickname.trim();
    state.memory.nickname = "";
    state.memory.prompt = "";
    state.memory.submitting = false;
    state.hasProgress = false;
    renderMemoryThanks(marker, nickname);
  } catch (error) {
    state.memory.submitting = false;
    errorScreen({
      title: "ことばを おくれなかったよ",
      message: formatChildError(error),
      retry: submitMemoryEntry,
      retryLabel: "もういちど おくる",
      back: renderMemoryForm,
      backLabel: "ことばを なおす",
    });
  }
}

function renderMemoryThanks(marker, nickname) {
  setView(
    '<section class="screen screen--center"><div class="marker" aria-hidden="true">' +
      escapeHtml(marker) +
      "</div>" +
      "<h1>ありがとう、" +
      escapeHtml(nickname) +
      "！</h1>" +
      '<p class="lead">つぎの人に かわってね</p>' +
      '<div class="actions"><button class="button" id="memory-next" type="button">つぎの人に かわる</button></div>' +
      "</section>",
  );
  const next = function () {
    window.clearTimeout(state.routeTimer);
    loadMemoryStatus(true);
  };
  document.querySelector("#memory-next").addEventListener("click", next);
  state.routeTimer = window.setTimeout(next, 7000);
}

function hostRoot(response) {
  const value = unwrapData(response) || {};
  return value.state || value;
}

function hostMemory(data) {
  const settings = data.settings || {};
  const raw = data.memory || {};
  const progress = data.progress || {};
  const tables = normalizeTables(progress.tables || settings.tables || []);
  const status = normalizeMemoryStatus(
    Object.assign({}, raw, {
      tables: tables,
      expected: Number(progress.expected || 0),
      received: Number(progress.received || 0),
      complete: Boolean(progress.complete),
      eventName: settings.eventName,
      status: raw.phase || raw.status,
      imageUrl: raw.resultUrl,
    }),
  );
  status.entries = normalizeList(raw.entries || data.entries);
  status.readyForGeneration = Boolean(data.canGenerate);
  status.statusText = String(raw.phase || raw.status || "");
  status.renderedCount = Number(raw.renderedCount || 0);
  return status;
}

function hostGenres(data) {
  const settings = data.settings || {};
  const list =
    (settings.dream && settings.dream.genres) ||
    settings.genres ||
    data.genres ||
    dreamGenres();
  return normalizeList(list).map(function (genre, index) {
    const item = normalizeOption(genre, index);
    item.id = String(
      (genre && typeof genre === "object" && (genre.id || genre.value)) ||
        item.value ||
        "genre-" + (index + 1),
    );
    item.enabled =
      !genre || typeof genre !== "object"
        ? true
        : genre.enabled !== false && genre.visible !== false;
    return item;
  });
}

function hostMaterials(data) {
  const settings = data.settings || {};
  return normalizeList(
    data.materials ||
      (data.craft && data.craft.materials) ||
      (settings.craft && settings.craft.materials) ||
      craftMaterials(),
  );
}

function initHost() {
  state.hasProgress = false;
  state.host = {
    tab: "memory",
    data: null,
    busy: false,
    message: null,
    messageType: "success",
    genreDraft: null,
    tableDraft: null,
    eventName: "",
    freeModeEnabled: true,
    reviewChecks: { people: false, bright: false },
    reviewedImageUrl: "",
    selectedFiles: [],
  };
  fetchHostState(true, true);
}

async function fetchHostState(showLoading, resetDrafts) {
  if (showLoading) loadingScreen("ホスト画面を読み込み中");
  try {
    const response = await apiGet("/api/host/state");
    const data = hostRoot(response);
    testModeBadge.hidden = !(data.image && data.image.adultTestMode === true);
    const oldImage = state.host.data ? hostMemory(state.host.data).imageUrl : "";
    state.host.data = data;
    const newMemory = hostMemory(data);
    if (newMemory.imageUrl !== oldImage) {
      state.host.reviewChecks = { people: false, bright: false };
      state.host.reviewedImageUrl = newMemory.imageUrl;
    }
    if (resetDrafts || !state.host.genreDraft) {
      state.host.genreDraft = hostGenres(data);
      const settings = data.settings || {};
      state.host.freeModeEnabled =
        settings.dream && typeof settings.dream.freeModeEnabled === "boolean"
          ? settings.dream.freeModeEnabled
          : typeof settings.freeModeEnabled === "boolean"
            ? settings.freeModeEnabled
            : dreamFreeModeEnabled();
    }
    if (resetDrafts || !state.host.tableDraft) {
      state.host.tableDraft = newMemory.tables.map(function (table) {
        return Object.assign({}, table);
      });
      state.host.eventName = newMemory.eventName;
    }
    renderHost();
    startHostPolling();
  } catch (error) {
    errorScreen({
      title: "ホスト画面を開けません",
      message: error && error.message ? error.message : "サーバーへ接続できません",
      retry: function () {
        fetchHostState(true, true);
      },
      retryLabel: "再読み込み",
    });
  }
}

function startHostPolling() {
  window.clearInterval(state.pollTimer);
  state.pollTimer = window.setInterval(async function () {
    if (
      !state.host ||
      state.host.busy ||
      state.host.tab !== "memory" ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)
    ) {
      return;
    }
    try {
      const response = await apiGet("/api/host/state");
      const nextData = hostRoot(response);
      const previousMemory = hostMemory(state.host.data);
      const nextMemory = hostMemory(nextData);
      const previousSignature = JSON.stringify({
        open: previousMemory.open,
        published: previousMemory.published,
        generating: previousMemory.generating,
        received: previousMemory.received,
        expected: previousMemory.expected,
        imageUrl: previousMemory.imageUrl,
        tables: previousMemory.tables,
        queues: state.host.data && state.host.data.queues,
      });
      const nextSignature = JSON.stringify({
        open: nextMemory.open,
        published: nextMemory.published,
        generating: nextMemory.generating,
        received: nextMemory.received,
        expected: nextMemory.expected,
        imageUrl: nextMemory.imageUrl,
        tables: nextMemory.tables,
        queues: nextData.queues,
      });
      state.host.data = nextData;
      if (previousSignature !== nextSignature) {
        if (previousMemory.imageUrl !== nextMemory.imageUrl) {
          state.host.reviewChecks = { people: false, bright: false };
        }
        renderHost();
      }
    } catch (error) {
      // 一時的な通信失敗では操作中の画面を維持する。
    }
  }, 5000);
}

function hostMessageMarkup() {
  if (!state.host.message) return "";
  return (
    '<div class="host-alert ' +
    (state.host.messageType === "success" ? "host-alert--success" : "") +
    '" role="status">' +
    escapeHtml(state.host.message) +
    "</div>"
  );
}

function renderHost() {
  const tabs = [
    { id: "memory", label: "思い出" },
    { id: "genres", label: "ジャンル" },
    { id: "materials", label: "素材" },
  ];
  let tabsMarkup = "";
  tabs.forEach(function (tab) {
    tabsMarkup +=
      '<button class="host-tab" type="button" data-host-tab="' +
      tab.id +
      '" aria-selected="' +
      (state.host.tab === tab.id ? "true" : "false") +
      '">' +
      escapeHtml(tab.label) +
      "</button>";
  });
  const content =
    state.host.tab === "genres"
      ? hostGenresMarkup()
      : state.host.tab === "materials"
        ? hostMaterialsMarkup()
        : hostMemoryMarkup();
  setView(
    '<section class="host-main"><div class="host-topline">' +
      '<div><p class="eyebrow">このPCのみ</p><h1 data-autofocus tabindex="-1">ホスト管理</h1></div>' +
      '<p class="host-updated">自動更新：5秒ごと</p></div>' +
      '<nav class="host-tabs" aria-label="ホスト管理メニュー">' +
      tabsMarkup +
      "</nav>" +
      hostMessageMarkup() +
      content +
      "</section>",
    { className: "app-main--host" },
  );
  bindHostTabs();
  if (state.host.tab === "genres") bindHostGenres();
  else if (state.host.tab === "materials") bindHostMaterials();
  else bindHostMemory();
  if (state.host.busy) {
    app.querySelectorAll("button, input, textarea, select").forEach(function (control) {
      control.disabled = true;
    });
  }
}

function bindHostTabs() {
  document.querySelectorAll("[data-host-tab]").forEach(function (button) {
    button.addEventListener("click", function () {
      state.host.tab = button.dataset.hostTab;
      state.host.message = null;
      renderHost();
    });
  });
}

function hostStatusInfo(memory) {
  if (memory.published) {
    return { label: "公開中", className: "status-badge--success" };
  }
  if (memory.generating) {
    return { label: "生成中", className: "status-badge--warning" };
  }
  if (memory.open) {
    return { label: "受付中", className: "status-badge--success" };
  }
  if (memory.imageUrl) {
    return { label: "公開前", className: "status-badge--warning" };
  }
  return { label: "受付停止", className: "" };
}

function hostMemoryMarkup() {
  const memory = hostMemory(state.host.data);
  const statusInfo = hostStatusInfo(memory);
  const queues = (state.host.data && state.host.data.queues) || {};
  const textQueue = queues.text || {};
  const imageQueue = queues.image || {};
  const activeJobs = Number(textQueue.active || 0) + Number(imageQueue.active || 0);
  const waitingJobs = Number(textQueue.waiting || 0) + Number(imageQueue.waiting || 0);
  const queueLabel = activeJobs || waitingJobs
    ? `AI処理中：実行 ${activeJobs}件・待ち ${waitingJobs}件`
    : `AI処理：なし（安全に停止できます）`;
  let progress = "";
  memory.tables.forEach(function (table) {
    progress +=
      '<div class="table-progress-item"><span class="table-progress-name">' +
      escapeHtml(table.name) +
      '</span><progress class="progress-track" max="' +
      Math.max(1, table.expected) +
      '" value="' +
      Math.min(table.received, Math.max(1, table.expected)) +
      '" aria-label="' +
      escapeHtml(table.name) +
      " " +
      table.received +
      " / " +
      table.expected +
      '"></progress><strong>' +
      table.received +
      " / " +
      table.expected +
      "</strong></div>";
  });
  if (!progress) {
    progress = '<div class="empty-box">テーブルが未設定です</div>';
  }

  let actions = "";
  if (memory.open) {
    actions +=
      '<button class="host-button host-button--danger" id="host-memory-close" type="button">思い出の受付を締め切る</button>';
  } else if (!memory.generating && !memory.published) {
    actions +=
      '<button class="host-button" id="host-memory-open" type="button">思い出の受付を始める</button>';
  }
  if (!memory.open && !memory.generating && !memory.published) {
    actions +=
      '<button class="host-button" id="host-memory-generate" type="button" ' +
      (memory.readyForGeneration ? "" : "disabled") +
      ">" +
      (memory.imageUrl ? "全員の絵を作り直す" : "全員の絵を生成する") +
      "</button>";
  }
  if (memory.published) {
    actions +=
      '<button class="host-button host-button--danger" id="host-memory-unpublish" type="button">公開を取りやめる</button>';
  }
  if (!memory.generating && (memory.entries.length || memory.imageUrl || memory.statusText !== "setup")) {
    actions +=
      '<button class="host-button host-button--secondary" id="host-memory-reset" type="button">新しいイベントを準備</button>';
  }

  let preview = "";
  if (memory.generating) {
    preview =
      '<div class="host-panel"><div class="loader" aria-hidden="true"><span></span><span></span><span></span></div>' +
      "<h2>全員の絵を生成しています</h2><p>完了すると自動でプレビューへ切り替わります。</p></div>";
  } else if (memory.imageUrl) {
    preview =
      '<div class="host-panel"><div class="host-panel__head"><div><h2>完成画像プレビュー</h2>' +
      "<p>公開前に人数と雰囲気を目視で確認してください。</p></div></div>" +
      '<img class="host-image" src="' +
      escapeHtml(memory.imageUrl) +
      '" alt="公開前の思い出イラスト" />' +
      (memory.renderedCount > 0
        ? '<p class="small-note"><strong>画像生成に渡した人数：</strong>' +
          memory.renderedCount +
          " / " +
          memory.expected +
          "人</p>"
        : "") +
      (memory.published
        ? '<div class="host-alert host-alert--success">この画像を公開しています。</div>'
        : '<label class="host-check"><input id="check-people" type="checkbox" ' +
          (state.host.reviewChecks.people ? "checked" : "") +
          " />予定人数 " +
          memory.expected +
          "人が全員いる</label>" +
          '<label class="host-check"><input id="check-bright" type="checkbox" ' +
          (state.host.reviewChecks.bright ? "checked" : "") +
          " />明るい雰囲気になっている</label>" +
          '<div class="host-actions"><button class="host-button" id="host-memory-publish" type="button" disabled>この絵を公開する</button></div>') +
      "</div>";
  }

  let entries = "";
  if (memory.entries.length) {
    let rows = "";
    const canRemoveEntries = ["collecting", "locked", "review"].includes(memory.statusText);
    memory.entries.forEach(function (entry, index) {
      const table = memory.tables.find(function (item) {
        return item.id === String(entry.tableId || entry.table || "");
      });
      rows +=
        "<tr><td>" +
        escapeHtml(table ? table.name : entry.tableName || entry.tableId || "-") +
        "</td><td>" +
        escapeHtml(entry.nickname || entry.name || "参加者 " + (index + 1)) +
        "</td><td>" +
        escapeHtml(entry.prompt || entry.text || "") +
        "</td><td>" +
        (canRemoveEntries
          ? '<button class="host-button host-button--secondary host-button--small" data-remove-entry="' +
            escapeHtml(entry.id || "") +
            '" type="button">削除</button>'
          : "") +
        "</td></tr>";
    });
    entries =
      '<div class="host-panel"><div class="host-panel__head"><div><h2>集まった一言</h2>' +
      "<p>不適切な内容がないか、生成前に確認してください。</p></div></div>" +
      '<div class="host-table-wrap"><table class="host-table"><thead><tr><th>テーブル</th><th>名前</th><th>一言</th><th>修正</th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div></div>";
  }

  return (
    '<div class="host-grid">' +
    '<div class="host-panel host-panel--half"><div class="host-panel__head"><div><h2>' +
    escapeHtml(memory.eventName) +
    '</h2><p>受付・生成・公開をここで操作します。</p></div><span class="status-badge ' +
    statusInfo.className +
    '">' +
    statusInfo.label +
    "</span></div>" +
    '<dl class="metric-row"><div class="metric"><dt>受付済み</dt><dd>' +
    memory.received +
    '人</dd></div><div class="metric"><dt>予定</dt><dd>' +
    memory.expected +
    '人</dd></div><div class="metric"><dt>残り</dt><dd>' +
    Math.max(0, memory.expected - memory.received) +
    "人</dd></div></dl>" +
    '<p class="small-note"><strong>' + escapeHtml(queueLabel) + "</strong></p>" +
    '<div class="host-actions">' +
    actions +
    "</div>" +
    (!memory.readyForGeneration && !memory.open && !memory.imageUrl
      ? '<p class="small-note">全員分がそろうと生成できます。</p>'
      : "") +
    "</div>" +
    '<div class="host-panel host-panel--half"><div class="host-panel__head"><div><h2>テーブル別の進捗</h2></div></div>' +
    '<div class="table-progress-list">' +
    progress +
    "</div></div>" +
    preview +
    entries +
    hostTableSettingsMarkup() +
    "</div>"
  );
}

function hostTableSettingsMarkup() {
  let rows = "";
  state.host.tableDraft.forEach(function (table, index) {
    rows +=
      '<div class="editor-row editor-row--table" data-table-row="' +
      index +
      '"><strong>テーブル ' +
      (index + 1) +
      '</strong><input class="host-input" data-table-name type="text" maxlength="16" value="' +
      escapeHtml(table.name) +
      '" aria-label="テーブル名" />' +
      '<input class="host-input" data-table-expected type="number" min="1" max="12" value="' +
      escapeHtml(table.expected || 1) +
      '" aria-label="予定人数" />' +
      '<button class="host-button host-button--secondary host-button--small" data-remove-table type="button">削除</button></div>';
  });
  return (
    '<div class="host-panel"><div class="host-panel__head"><div><h2>テーブルと人数</h2>' +
    "<p>欠席時は受付済み人数より少なくならない範囲で予定人数を修正できます。</p></div></div>" +
    '<div class="host-field"><label for="host-event-name">イベント名</label>' +
    '<input class="host-input" id="host-event-name" type="text" maxlength="40" value="' +
    escapeHtml(state.host.eventName) +
    '" /></div>' +
    '<div class="editor-list" id="table-editor">' +
    rows +
    "</div>" +
    '<div class="host-actions host-actions--spaced">' +
    '<button class="host-button host-button--secondary" id="add-table" type="button">テーブルを追加</button>' +
    '<button class="host-button" id="save-tables" type="button">テーブル設定を保存</button>' +
    "</div></div>"
  );
}

function bindHostMemory() {
  const open = document.querySelector("#host-memory-open");
  const close = document.querySelector("#host-memory-close");
  const generate = document.querySelector("#host-memory-generate");
  const publish = document.querySelector("#host-memory-publish");
  const unpublish = document.querySelector("#host-memory-unpublish");
  const reset = document.querySelector("#host-memory-reset");
  if (open) {
    open.addEventListener("click", function () {
      runHostAction("/api/host/memory/open", null, "受付を開始しました");
    });
  }
  if (close) {
    close.addEventListener("click", function () {
      runHostAction(
        "/api/host/memory/close",
        "思い出の受付を締め切りますか？",
        "受付を締め切りました",
      );
    });
  }
  if (generate) {
    generate.addEventListener("click", function () {
      runHostAction(
        "/api/host/memory/generate",
        "入力を固定して、全員分の絵を生成しますか？",
        "画像生成を開始しました",
      );
    });
  }
  if (unpublish) {
    unpublish.addEventListener("click", function () {
      runHostAction(
        "/api/host/memory/unpublish",
        "公開を取りやめますか？ 子ども画面は待機表示に戻ります。",
        "公開を取りやめました",
      );
    });
  }
  if (reset) {
    reset.addEventListener("click", function () {
      runHostAction(
        "/api/host/memory/reset",
        "④の受付内容と完成画像を削除し、新しいイベントを準備しますか？ 素材と設定は残ります。",
        "新しいイベントの準備ができました",
      );
    });
  }
  document.querySelectorAll("[data-remove-entry]").forEach(function (button) {
    button.addEventListener("click", function () {
      runHostAction(
        "/api/host/memory/entries/" + encodeURIComponent(button.dataset.removeEntry) + "/remove",
        "この人の受付内容を削除しますか？",
        "受付内容を削除しました",
      );
    });
  });
  const people = document.querySelector("#check-people");
  const bright = document.querySelector("#check-bright");
  function updatePublish() {
    if (!publish) return;
    state.host.reviewChecks.people = people.checked;
    state.host.reviewChecks.bright = bright.checked;
    publish.disabled = !(people.checked && bright.checked);
  }
  if (people && bright && publish) {
    people.addEventListener("change", updatePublish);
    bright.addEventListener("change", updatePublish);
    updatePublish();
    publish.addEventListener("click", function () {
      runHostAction(
        "/api/host/memory/publish",
        "この画像を子ども画面へ公開しますか？",
        "画像を公開しました",
      );
    });
  }

  document.querySelectorAll("[data-table-row]").forEach(function (row) {
    const index = Number(row.dataset.tableRow);
    const name = row.querySelector("[data-table-name]");
    const expected = row.querySelector("[data-table-expected]");
    name.addEventListener("input", function () {
      state.host.tableDraft[index].name = name.value;
    });
    expected.addEventListener("input", function () {
      state.host.tableDraft[index].expected = Number(expected.value || 0);
    });
    row.querySelector("[data-remove-table]").addEventListener("click", function () {
      state.host.tableDraft.splice(index, 1);
      renderHost();
    });
  });
  const eventName = document.querySelector("#host-event-name");
  if (eventName) {
    eventName.addEventListener("input", function () {
      state.host.eventName = eventName.value;
    });
  }
  const addTable = document.querySelector("#add-table");
  if (addTable) {
    addTable.addEventListener("click", function () {
      state.host.tableDraft.push({
        id: "table-" + Date.now(),
        name: "テーブル " + (state.host.tableDraft.length + 1),
        expected: 1,
        received: 0,
      });
      renderHost();
    });
  }
  const saveTables = document.querySelector("#save-tables");
  if (saveTables) saveTables.addEventListener("click", saveHostTables);
}

async function runHostAction(path, confirmation, successMessage) {
  if (confirmation && !window.confirm(confirmation)) return;
  state.host.busy = true;
  state.host.message = "処理中です…";
  state.host.messageType = "success";
  renderHost();
  try {
    await apiPost(path, {});
    state.host.message = successMessage;
    state.host.messageType = "success";
    state.host.busy = false;
    await fetchHostState(false, false);
  } catch (error) {
    state.host.busy = false;
    state.host.message = error && error.message ? error.message : "操作に失敗しました";
    state.host.messageType = "error";
    renderHost();
  }
}

function hostSettingsPayload(overrides) {
  const genres = state.host.genreDraft
    .filter(function (genre) {
      return genre.label.trim();
    })
    .map(function (genre) {
      return genre.label.trim();
    });
  const tables = state.host.tableDraft.map(function (table) {
    return {
      id: table.id,
      name: table.name.trim(),
      expected: Number(table.expected),
    };
  });
  return Object.assign(
    {
      eventName: state.host.eventName.trim(),
      genres: genres,
      freeModeEnabled: state.host.freeModeEnabled,
      tables: tables,
    },
    overrides || {},
  );
}

function hostTableValidationMessage(tables) {
  if (!tables.length) return "1つ以上のテーブルを入力してください";
  const invalid = tables.find(function (table) {
    return (
      !table.name.trim() ||
      !Number.isInteger(table.expected) ||
      table.expected < 1 ||
      table.expected > 12
    );
  });
  if (invalid) return "各テーブルの予定人数は1〜12人で入力してください";
  const total = tables.reduce(function (sum, table) {
    return sum + table.expected;
  }, 0);
  if (total > 48) return "予定人数の合計は48人までです";
  return "";
}

async function saveHostTables() {
  const tables = state.host.tableDraft.map(function (table) {
    return {
      id: table.id,
      name: table.name.trim(),
      expected: Number(table.expected),
    };
  });
  const validationMessage = hostTableValidationMessage(tables);
  if (validationMessage) {
    state.host.message = validationMessage;
    state.host.messageType = "error";
    renderHost();
    return;
  }
  state.host.busy = true;
  state.host.message = "設定を保存中です…";
  renderHost();
  try {
    await apiPost("/api/host/settings", hostSettingsPayload({ tables: tables }));
    state.host.busy = false;
    state.host.message = "テーブル設定を保存しました";
    state.host.messageType = "success";
    await fetchHostState(false, true);
  } catch (error) {
    state.host.busy = false;
    state.host.message = error && error.message ? error.message : "保存に失敗しました";
    state.host.messageType = "error";
    renderHost();
  }
}

function hostGenresMarkup() {
  let rows = "";
  state.host.genreDraft.forEach(function (genre, index) {
    rows +=
      '<div class="editor-row editor-row--genre" data-genre-row="' +
      index +
      '">' +
      '<input class="host-input" data-genre-label type="text" maxlength="12" value="' +
      escapeHtml(genre.label) +
      '" aria-label="ジャンル名" />' +
      '<div class="editor-controls"><button class="icon-button" data-genre-up type="button" aria-label="上へ移動">↑</button>' +
      '<button class="icon-button" data-genre-down type="button" aria-label="下へ移動">↓</button></div>' +
      '<button class="host-button host-button--secondary host-button--small" data-genre-remove type="button">削除</button>' +
      "</div>";
  });
  return (
    '<div class="host-grid"><div class="host-panel"><div class="host-panel__head"><div><h2>「りそうの○○」ジャンル</h2>' +
    "<p>子ども画面には上から最大6件を表示します。</p></div></div>" +
    '<div class="editor-list">' +
    rows +
    "</div>" +
    '<label class="host-check"><input id="free-mode-enabled" type="checkbox" ' +
    (state.host.freeModeEnabled ? "checked" : "") +
    " />「じぶんで きめる」を表示する</label>" +
    '<div class="host-actions"><button class="host-button host-button--secondary" id="add-genre" type="button">ジャンルを追加</button>' +
    '<button class="host-button" id="save-genres" type="button">ジャンル設定を保存</button></div>' +
    "</div></div>"
  );
}

function bindHostGenres() {
  document.querySelectorAll("[data-genre-row]").forEach(function (row) {
    const index = Number(row.dataset.genreRow);
    const item = state.host.genreDraft[index];
    const label = row.querySelector("[data-genre-label]");
    label.addEventListener("input", function () {
      item.label = label.value;
      item.value = item.id;
    });
    row.querySelector("[data-genre-up]").addEventListener("click", function () {
      if (index === 0) return;
      const moved = state.host.genreDraft.splice(index, 1)[0];
      state.host.genreDraft.splice(index - 1, 0, moved);
      renderHost();
    });
    row.querySelector("[data-genre-down]").addEventListener("click", function () {
      if (index >= state.host.genreDraft.length - 1) return;
      const moved = state.host.genreDraft.splice(index, 1)[0];
      state.host.genreDraft.splice(index + 1, 0, moved);
      renderHost();
    });
    row.querySelector("[data-genre-remove]").addEventListener("click", function () {
      state.host.genreDraft.splice(index, 1);
      renderHost();
    });
  });
  const freeMode = document.querySelector("#free-mode-enabled");
  freeMode.addEventListener("change", function () {
    state.host.freeModeEnabled = freeMode.checked;
  });
  document.querySelector("#add-genre").addEventListener("click", function () {
    state.host.genreDraft.push({
      id: "genre-" + Date.now(),
      value: "genre-" + Date.now(),
      label: "あたらしい ジャンル",
      icon: "",
      enabled: true,
    });
    renderHost();
  });
  document.querySelector("#save-genres").addEventListener("click", saveHostGenres);
}

async function saveHostGenres() {
  const genres = state.host.genreDraft
    .filter(function (genre) {
      return genre.label.trim();
    })
    .map(function (genre) {
      return {
        id: genre.id,
        value: genre.id,
        label: genre.label.trim(),
        icon: genre.icon.trim() || "○",
        enabled: Boolean(genre.enabled),
      };
    });
  if (!genres.length) {
    state.host.message = "1つ以上のジャンルを登録してください";
    state.host.messageType = "error";
    renderHost();
    return;
  }
  const currentTables = state.host.tableDraft.map(function (table) {
    return {
      id: table.id,
      name: table.name.trim(),
      expected: Number(table.expected),
    };
  });
  const tableValidationMessage = hostTableValidationMessage(currentTables);
  if (tableValidationMessage) {
    state.host.message = tableValidationMessage;
    state.host.messageType = "error";
    renderHost();
    return;
  }
  state.host.busy = true;
  state.host.message = "ジャンル設定を保存中です…";
  renderHost();
  try {
    await apiPost(
      "/api/host/settings",
      hostSettingsPayload({
        genres: genres
          .map(function (genre) {
            return genre.label;
          }),
        freeModeEnabled: state.host.freeModeEnabled,
      }),
    );
    state.host.busy = false;
    state.host.message = "ジャンル設定を保存しました";
    state.host.messageType = "success";
    await fetchHostState(false, true);
  } catch (error) {
    state.host.busy = false;
    state.host.message = error && error.message ? error.message : "保存に失敗しました";
    state.host.messageType = "error";
    renderHost();
  }
}

function hostMaterialsMarkup() {
  const materials = hostMaterials(state.host.data);
  let cards = "";
  materials.forEach(function (material, index) {
    const imageUrl = materialImage(material);
    cards +=
      '<article class="material-card">' +
      (imageUrl
        ? '<img src="' +
          escapeHtml(imageUrl) +
          '" alt="' +
          escapeHtml(materialName(material, index)) +
          '" />'
        : '<div class="material-card__placeholder">画像なし</div>') +
      "<p>" +
      escapeHtml(materialName(material, index)) +
      "</p></article>";
  });
  if (!cards) cards = '<div class="empty-box">素材はまだ登録されていません</div>';
  return (
    '<div class="host-grid"><div class="host-panel host-panel--half"><div class="host-panel__head"><div><h2>登録済みの素材</h2>' +
    "<p>子ども画面と画像生成で使う実物素材です。</p></div></div>" +
    '<div class="material-list">' +
    cards +
    "</div></div>" +
    '<div class="host-panel host-panel--half"><div class="host-panel__head"><div><h2>素材を登録</h2>' +
    "<p>正面から明るく撮った写真を使用してください。</p></div></div>" +
    '<form id="material-form"><div class="host-field"><label for="material-name">素材セット名</label>' +
    '<input class="host-input" id="material-name" type="text" maxlength="24" placeholder="例：デニム工作セットA" /></div>' +
    '<div class="host-field"><label for="material-files">素材の写真</label>' +
    '<input class="host-input" id="material-files" type="file" accept="image/png,image/jpeg,image/webp" />' +
    '<p class="small-note">JPEG・PNG・WebP、6MB以下</p></div>' +
    '<div class="file-preview" id="material-preview"></div>' +
    '<div class="host-actions host-actions--spaced"><button class="host-button" id="upload-materials" type="submit" disabled>素材を登録する</button></div>' +
    "</form></div></div>"
  );
}

function bindHostMaterials() {
  const form = document.querySelector("#material-form");
  const name = document.querySelector("#material-name");
  const files = document.querySelector("#material-files");
  const preview = document.querySelector("#material-preview");
  const submit = document.querySelector("#upload-materials");

  function updateMaterialForm() {
    state.host.selectedFiles = Array.from(files.files || []);
    submit.disabled = !(name.value.trim() && state.host.selectedFiles.length);
    preview.innerHTML = "";
    state.host.selectedFiles.forEach(function (file) {
      const item = document.createElement("div");
      item.className = "file-preview__item";
      const image = document.createElement("img");
      image.alt = "";
      image.src = URL.createObjectURL(file);
      image.addEventListener(
        "load",
        function () {
          URL.revokeObjectURL(image.src);
        },
        { once: true },
      );
      const label = document.createElement("span");
      label.textContent = file.name;
      item.append(image, label);
      preview.append(item);
    });
  }

  files.addEventListener("change", updateMaterialForm);
  name.addEventListener("input", updateMaterialForm);
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    updateMaterialForm();
    if (submit.disabled) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    const wrongType = state.host.selectedFiles.find(function (file) {
      return !allowedTypes.includes(file.type);
    });
    if (wrongType) {
      state.host.message = "JPEG・PNG・WebPの画像を選んでください";
      state.host.messageType = "error";
      renderHost();
      return;
    }
    const tooLarge = state.host.selectedFiles.find(function (file) {
      return file.size > 6 * 1024 * 1024;
    });
    if (tooLarge) {
      state.host.message = "6MB以下の画像を選んでください";
      state.host.messageType = "error";
      renderHost();
      return;
    }
    const file = state.host.selectedFiles[0];
    state.host.busy = true;
    state.host.message = "素材を登録中です…";
    renderHost();
    try {
      const photoDataUrl = await readFileAsDataUrl(file);
      await apiPost("/api/host/materials", {
        name: name.value.trim(),
        photoDataUrl: photoDataUrl,
      });
      state.host.busy = false;
      state.host.selectedFiles = [];
      state.host.message = "素材を登録しました";
      state.host.messageType = "success";
      await fetchHostState(false, false);
    } catch (error) {
      state.host.busy = false;
      state.host.message = error && error.message ? error.message : "登録に失敗しました";
      state.host.messageType = "error";
      renderHost();
    }
  });
}

function renderNotFound() {
  restartButton.hidden = true;
  setView(
    '<section class="screen screen--center"><div class="status-icon status-icon--error" aria-hidden="true">?</div>' +
      "<h1>このページは ありません</h1>" +
      '<div class="actions"><a class="button" href="/">スタートへ もどる</a></div></section>',
  );
}

function isLoopbackHost() {
  const hostname = window.location.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function renderHostDenied() {
  restartButton.hidden = true;
  setView(
    '<section class="screen screen--center"><div class="status-icon status-icon--error" aria-hidden="true">鍵</div>' +
      "<h1>このページは ホストPCだけで ひらけます</h1>" +
      '<p class="lead">ホストPCで localhost を使って開いてください。</p></section>',
  );
}

function renderServerRequired() {
  restartButton.hidden = true;
  document.body.dataset.route = "home";
  routeName.textContent = "";
  setView(
    '<section class="screen screen--center"><div class="status-icon status-icon--error" aria-hidden="true">!</div>' +
      "<h1>アプリの ひらきかたが ちがいます</h1>" +
      '<p class="lead">スタッフに アプリを きどうしてもらってね</p>' +
      '<div class="actions"><a class="button" href="http://127.0.0.1:4310/">きどうした アプリを ひらく</a></div></section>',
  );
}

function startCurrentRoute() {
  clearTransientState();
  const route = getRoute();
  state.route = route;
  if (!route) {
    document.body.dataset.route = "home";
    routeName.textContent = "";
    renderNotFound();
    return;
  }
  document.body.dataset.route = route.key;
  routeName.textContent = route.label;
  restartButton.hidden = route.key === "home" || route.key === "host";

  if (route.key === "home") renderHome();
  else if (route.key === "career") initCareer();
  else if (route.key === "craft") initCraft();
  else if (route.key === "dream") initDream();
  else if (route.key === "memory") initMemory();
  else if (route.key === "host") {
    if (isLoopbackHost()) initHost();
    else renderHostDenied();
  }
}

async function boot() {
  if (window.location.protocol === "file:") {
    renderServerRequired();
    return;
  }
  const route = getRoute();
  state.route = route;
  document.body.dataset.route = route ? route.key : "home";
  routeName.textContent = route ? route.label : "";
  restartButton.hidden = !route || route.key === "home" || route.key === "host";

  if (!route || route.key === "home") {
    renderHome();
    loadPublicConfig();
    checkHealth();
    return;
  }

  if (route.key === "host") {
    if (isLoopbackHost()) initHost();
    else renderHostDenied();
    return;
  }

  loadingScreen("じゅんび中…");
  await Promise.all([loadPublicConfig(), checkHealth()]);
  if (!state.healthy) {
    const retryHealth = async function () {
      loadingScreen("もういちど つないでいるよ");
      await Promise.all([loadPublicConfig(), checkHealth()]);
      if (state.healthy) startCurrentRoute();
      else renderUnavailable(retryHealth);
    };
    renderUnavailable(retryHealth);
    return;
  }
  startCurrentRoute();
}

restartButton.addEventListener("click", function () {
  if (
    state.hasProgress &&
    !window.confirm("いまの こたえを けして、はじめから もどりますか？")
  ) {
    return;
  }
  startCurrentRoute();
});

window.addEventListener("popstate", boot);
window.addEventListener("beforeunload", clearTransientState);
window.addEventListener("offline", function () {
  showToast("ネットワークに つながっていません", 5000);
});
window.addEventListener("online", function () {
  showToast("ネットワークに つながりました");
});

boot();
