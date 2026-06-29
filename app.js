/* =========================================================
   IRIS · NTIS 공고 추적 — vanilla JS, 의존성 없음
   ./data/announcements.json 을 불러와 렌더링한다.
   ========================================================= */

"use strict";

const state = {
  all: [],
  keywords: [],
  src: "all",        // all | IRIS | NTIS
  kw: new Set(),     // 다중 선택 키워드 (빈 Set = 전체)
  q: "",
  sort: "deadline",  // deadline | latest
};

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------- 유틸 ---------- */

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function today0() {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

function parseDot(str) {
  const m = /(\d{4})\.(\d{1,2})\.(\d{1,2})/.exec(str || "");
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

/* ---------- 항목별 1회 사전 계산 (precompute-once) ----------
   매 렌더/정렬마다 isClosed·daysLeft 를 다시 계산하지 않도록
   _d(남은일수) / _closed / _key(정렬키) / _new / _seen 을 캐시한다. */

function precompute(a, now0, nowMs) {
  const end = parseDot(a.receipt_end);
  const days = end ? Math.round((end - now0) / 86400000) : null;
  const closedFlag =
    (a.status || "").includes("마감") ||
    a.d_day === "마감" ||
    (days != null && days < 0);
  const key = end
    ? end.getFullYear() * 10000 + (end.getMonth() + 1) * 100 + end.getDate()
    : Number.POSITIVE_INFINITY;
  const seenMs = a.first_seen ? Date.parse(a.first_seen.replace(" ", "T")) : NaN;
  const isNew = !isNaN(seenMs) && (nowMs - seenMs) / 86400000 <= 2;

  a._d = days;
  a._closed = closedFlag;
  a._key = key;
  a._new = isNew;
  a._seen = a.first_seen || "";
  return a;
}

function ddayInfo(a) {
  if (a._closed) return { kind: "closed", text: "마감" };
  const dl = a._d;
  if (dl == null) {
    if (a.d_day && a.d_day !== "마감") return { kind: "soft", text: a.d_day };
    return null;
  }
  const text = dl === 0 ? "D-DAY" : "D-" + dl;
  let kind = "soft";
  if (dl <= 3) kind = "urgent";        // D0–3  빨강(점멸)
  else if (dl <= 7) kind = "soon";     // D4–7  주황
  else if (dl <= 14) kind = "warn";    // D8–14 앰버
  return { kind, text };
}

/* ---------- 데이터 로드 ---------- */

async function load() {
  try {
    const res = await fetch("./data/announcements.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();

    const list = Array.isArray(data.announcements) ? data.announcements : [];
    const now0 = today0();
    const nowMs = Date.now();
    list.forEach((a) => precompute(a, now0, nowMs));

    state.all = list;
    state.keywords = Array.isArray(data.keywords) ? data.keywords : [];

    renderHero(data);
    buildKwChips();
    buildKwFilter();
    bindControls();
    render();
  } catch (err) {
    console.error(err);
    $("#updatedPill").textContent = "데이터 로드 실패";
    $("#grid").innerHTML =
      '<div class="empty" style="grid-column:1/-1">' +
      '<div class="empty__mark">!</div>' +
      '<h2 class="empty__title">데이터를 불러오지 못했습니다</h2>' +
      '<p class="empty__text">data/announcements.json 경로를 확인해 주세요.</p></div>';
  }
}

/* ---------- 헤더 ---------- */

function renderHero(data) {
  const total = data.count != null ? data.count : state.all.length;
  $("#statTotal").textContent = total;

  const open = state.all.filter((a) => !a._closed).length;
  $("#statOpen").textContent = open;

  const urgent = state.all.filter(
    (a) => !a._closed && a._d != null && a._d >= 0 && a._d <= 7
  ).length;
  $("#statUrgent").textContent = urgent;

  $("#updatedPill").textContent = data.updated_at
    ? data.updated_at.slice(0, 16) + " 기준"
    : "업데이트 시간 미상";
}

function buildKwChips() {
  $("#kwChips").innerHTML = state.keywords
    .map((k) => `<span class="chip">${esc(k)}</span>`)
    .join("");
}

/* ---------- 키워드 필터 (다중 선택) ---------- */

function buildKwFilter() {
  const box = $("#kwFilter");
  box.innerHTML =
    `<button class="kw is-active" data-all type="button" aria-pressed="true">전체</button>` +
    state.keywords
      .map(
        (k) =>
          `<button class="kw" data-kw="${esc(k)}" type="button" aria-pressed="false">` +
          `<span class="kw__chk" aria-hidden="true">✓</span>${esc(k)}</button>`
      )
      .join("");
}

function syncKwUI() {
  const allBtn = $("#kwFilter [data-all]");
  const none = state.kw.size === 0;
  allBtn.classList.toggle("is-active", none);
  allBtn.setAttribute("aria-pressed", none ? "true" : "false");
  $$("#kwFilter .kw[data-kw]").forEach((b) => {
    const on = state.kw.has(b.dataset.kw);
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

/* ---------- 필터 + 정렬 ---------- */

function filtered() {
  let list = state.all.slice();

  if (state.src !== "all") {
    list = list.filter((a) => a.source === state.src);
  }
  if (state.kw.size > 0) {
    list = list.filter((a) => {
      const mk = a.matched_keywords || [];
      for (const k of state.kw) if (mk.includes(k)) return true;
      return false;
    });
  }
  if (state.q) {
    const q = state.q.toLowerCase();
    list = list.filter((a) =>
      [a.title, a.agency, a.org, (a.matched_keywords || []).join(" "), a.ancm_no]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }

  if (state.sort === "deadline") {
    list.sort((a, b) => {
      if (a._closed !== b._closed) return a._closed ? 1 : -1; // 마감은 뒤로
      const dk = a._key - b._key;                              // 임박한 순
      if (dk !== 0) return dk;
      return (b._seen || "").localeCompare(a._seen || "");
    });
  } else {
    list.sort((a, b) => (b._seen || "").localeCompare(a._seen || ""));
  }

  return list;
}

/* ---------- 카드 ---------- */

function cardHTML(a, idx) {
  const closed = a._closed;
  const src = a.source === "NTIS" ? "NTIS" : "IRIS";
  const srcClass = src === "NTIS" ? "badge--ntis" : "badge--iris";

  const newBadge = a._new ? `<span class="badge badge--new">NEW</span>` : "";

  const dd = ddayInfo(a);
  let ddBadge = "";
  if (dd) {
    if (dd.kind === "closed") {
      ddBadge = `<span class="badge badge--closed">${esc(dd.text)}</span>`;
    } else {
      const mod =
        dd.kind === "urgent" ? "is-urgent" :
        dd.kind === "soon"   ? "is-soon"   :
        dd.kind === "warn"   ? "is-warn"   : "";
      ddBadge = `<span class="badge badge--dday ${mod}">${esc(dd.text)}</span>`;
    }
  }

  const tags = (a.matched_keywords || [])
    .map((k) => `<span class="tag ${state.kw.has(k) ? "is-on" : ""}">${esc(k)}</span>`)
    .join("");

  const orgParts = [];
  if (a.agency) orgParts.push(`<span class="org-agency">${esc(a.agency)}</span>`);
  if (a.org) orgParts.push(`<span class="org-org">${esc(a.org)}</span>`);
  const orgLine = orgParts.length
    ? `<div class="card__org">${orgParts.join('<span class="dot">·</span>')}</div>`
    : "";

  let period = "";
  if (a.receipt_start || a.receipt_end) {
    period =
      `<div class="card__period">` +
      `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" stroke-width="1.8"/><line x1="8" y1="2.5" x2="8" y2="6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="16" y1="2.5" x2="16" y2="6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>` +
      `<span>${esc(a.receipt_start || "미정")}</span>` +
      `<span class="tilde">~</span>` +
      `<span>${esc(a.receipt_end || "미정")}</span>` +
      `</div>`;
  }

  const reasons = (a.reasons || []).filter(Boolean);
  let reasonsBlock = "";
  if (reasons.length) {
    const shown = reasons.slice(0, 2);
    const hidden = reasons.slice(2);
    const shownLi = shown.map((r) => `<li>${esc(r)}</li>`).join("");
    const hiddenLi = hidden
      .map((r) => `<li class="reason-extra" hidden>${esc(r)}</li>`)
      .join("");
    const moreBtn = hidden.length
      ? `<button class="reasons__more" type="button" data-more="${idx}">+${hidden.length}개 더 보기</button>`
      : "";
    reasonsBlock =
      `<ul class="reasons" data-card="${idx}">` +
      `<li class="reasons__h" style="list-style:none">지원하면 좋은 이유</li>` +
      shownLi + hiddenLi +
      `</ul>${moreBtn}`;
  }

  const metaBits = [];
  if (a.summary && a.summary !== "미등록")
    metaBits.push(`<span class="tag tag--meta">${esc(a.summary)}</span>`);
  if (a.support_scale && a.support_scale !== "미등록")
    metaBits.push(`<span class="tag tag--meta">${esc(a.support_scale)}</span>`);
  const meta = metaBits.join("");

  const url = a.url || "#";
  const safeUrl = /^https?:\/\//i.test(url) ? esc(url) : "#";

  const urgentCls = !closed && dd && dd.kind === "urgent" ? " is-urgent" : "";

  return (
    `<article class="card ${closed ? "is-closed" : ""}${urgentCls}" style="animation-delay:${Math.min(idx, 12) * 24}ms">` +
      `<div class="card__top">` +
        `<span class="badge ${srcClass}">${esc(src)}</span>` +
        newBadge + ddBadge +
      `</div>` +
      `<h3 class="card__title"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a></h3>` +
      orgLine +
      period +
      `<div class="tags">${tags}${meta}</div>` +
      reasonsBlock +
      `<div class="card__cta">` +
        `<a class="btn" href="${safeUrl}" target="_blank" rel="noopener noreferrer">원문 공고 보기 <span class="arrow" aria-hidden="true">↗</span></a>` +
      `</div>` +
    `</article>`
  );
}

/* ---------- 렌더 ---------- */

function render() {
  const list = filtered();
  const grid = $("#grid");
  const empty = $("#empty");

  if (list.length === 0) {
    grid.innerHTML = "";
    empty.hidden = false;
  } else {
    empty.hidden = true;
    grid.innerHTML = list.map((a, i) => cardHTML(a, i)).join("");
  }

  const total = state.all.length;
  $("#resultCount").innerHTML =
    list.length === total
      ? `전체 <strong>${total}</strong>건`
      : `<strong>${list.length}</strong>건 표시 <span style="color:var(--gray-400)">/ 전체 ${total}건</span>`;

  const active =
    state.src !== "all" || state.kw.size > 0 || state.q !== "" || state.sort !== "deadline";
  $("#resetBtn").hidden = !active;

  $$(".reasons__more").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-more");
      const ul = $(`.reasons[data-card="${id}"]`);
      if (!ul) return;
      const extras = $$(".reason-extra", ul);
      const opening = extras[0] && extras[0].hidden;
      extras.forEach((li) => (li.hidden = !opening));
      btn.textContent = opening ? "간략히 보기" : `+${extras.length}개 더 보기`;
    });
  });
}

/* ---------- 컨트롤 바인딩 ---------- */

function setSeg(segSel, attr, val, stateKey) {
  $$(`${segSel} .seg__btn`).forEach((b) => {
    const on = b.getAttribute(attr) === val;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  state[stateKey] = val;
  render();
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function applyQuery(val) {
  state.q = val.trim();
  $("#searchClear").hidden = state.q === "";
  $("#searchKbd").style.opacity = val ? "0" : "";
  render();
}
const applyQueryDebounced = debounce(applyQuery, 120);

function bindControls() {
  const search = $("#search");

  search.addEventListener("input", (e) => applyQueryDebounced(e.target.value));

  $("#searchClear").addEventListener("click", () => {
    search.value = "";
    applyQuery("");
    search.focus();
  });

  $$("#srcSeg .seg__btn").forEach((b) =>
    b.addEventListener("click", () => setSeg("#srcSeg", "data-src", b.dataset.src, "src"))
  );
  $$("#sortSeg .seg__btn").forEach((b) =>
    b.addEventListener("click", () => setSeg("#sortSeg", "data-sort", b.dataset.sort, "sort"))
  );

  $("#kwFilter").addEventListener("click", (e) => {
    const btn = e.target.closest(".kw");
    if (!btn) return;
    if (btn.hasAttribute("data-all")) {
      state.kw.clear();
    } else {
      const k = btn.dataset.kw;
      if (state.kw.has(k)) state.kw.delete(k);
      else state.kw.add(k);
    }
    syncKwUI();
    render();
  });

  const reset = () => {
    state.src = "all"; state.kw.clear(); state.q = ""; state.sort = "deadline";
    search.value = "";
    $("#searchClear").hidden = true;
    $("#searchKbd").style.opacity = "";
    setSeg("#srcSeg", "data-src", "all", "src");
    setSeg("#sortSeg", "data-sort", "deadline", "sort");
    syncKwUI();
    render();
  };
  $("#resetBtn").addEventListener("click", reset);
  $("#emptyReset").addEventListener("click", reset);

  // 키보드: '/' 로 검색 포커스, Esc 로 해제 (keyboard-app feel)
  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    const typing = tag === "input" || tag === "textarea" || e.target.isContentEditable;
    if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      search.focus();
      search.select();
    } else if (e.key === "Escape" && document.activeElement === search) {
      if (search.value) { search.value = ""; applyQuery(""); }
      search.blur();
    }
  });
}

load();
