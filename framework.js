/* =====================================================================
   framework.js — SWOT · 3C · 5 Forces · BCG 공통 동작
   ---------------------------------------------------------------------
   - 편집 가능한 목록: 항목 클릭해 수정 · 추가 · 삭제 · 근거(데이터/가정) 전환
   - 메모(한 문단), 강도 평가(1~5)
   - 브라우저에 자동 저장 (localStorage), 초기화, 마크다운 복사
   페이지는 FW.init({ key, defaults, render, toMarkdown }) 만 호출하면 된다.
   state 구조: { lists: { id: [{ t, src }] }, notes: { id: '' }, ratings: { id: n }, ...페이지 전용 }
   ===================================================================== */
(function () {
    const FW = {};
    let cfg = null;
    let saveTimer = null;

    FW.esc = str => String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    const clone = obj => JSON.parse(JSON.stringify(obj));

    /* ---------- 저장 ---------- */
    function load() {
        try {
            const raw = localStorage.getItem(cfg.key);
            if (raw) return { ...clone(cfg.defaults), ...JSON.parse(raw) };
        } catch (e) {}
        return clone(cfg.defaults);
    }
    FW.save = function () {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            let ok = true;
            try { localStorage.setItem(cfg.key, JSON.stringify(FW.state)); } catch (e) { ok = false; }
            const el = document.getElementById('saveStatus');
            if (el) el.innerHTML = ok
                ? `<i class="fa-solid fa-circle-check"></i>${new Date().toTimeString().slice(0, 5)} 저장됨`
                : '<i class="fa-solid fa-circle-exclamation"></i>이 브라우저에서는 저장 안 됨';
        }, 300);
    };
    FW.reset = function () {
        if (!confirm('작성한 내용을 지우고 처음 초안으로 되돌릴까요?')) return;
        try { localStorage.removeItem(cfg.key); } catch (e) {}
        FW.state = clone(cfg.defaults);
        FW.render();
        FW.toast('초안으로 되돌렸어요');
        const el = document.getElementById('saveStatus');
        if (el) el.textContent = '초안 상태';
    };

    /* ---------- 렌더 도우미 ---------- */
    FW.render = () => cfg.render(FW.state);

    // 목록 HTML: placeholder = 빈 항목 안내문
    FW.list = function (id, placeholder = '내용 입력') {
        const items = FW.state.lists[id] || (FW.state.lists[id] = []);
        return `
            <ul class="fw-list">${items.map((it, i) => `
                <li class="fw-item">
                    <span class="fw-item__text" contenteditable="plaintext-only" spellcheck="false"
                          data-fw-item="${id}:${i}" data-placeholder="${FW.esc(placeholder)}">${FW.esc(it.t)}</span>
                    <button class="src-tag src-tag--${it.src === 'data' ? 'data' : 'assume'}" data-fw-src="${id}:${i}"
                            title="근거 전환: 데이터 ↔ 가정">${it.src === 'data' ? '데이터' : '가정'}</button>
                    <button class="fw-item__del" data-fw-del="${id}:${i}" aria-label="항목 삭제" title="삭제"><i class="fa-solid fa-xmark"></i></button>
                </li>`).join('')}
            </ul>
            <button class="fw-add" data-fw-add="${id}"><i class="fa-solid fa-plus"></i>항목 추가</button>`;
    };

    FW.note = function (id, placeholder = '내용 입력') {
        return `<div class="fw-note" contenteditable="plaintext-only" spellcheck="false" data-fw-note="${id}"
                     data-placeholder="${FW.esc(placeholder)}">${FW.esc(FW.state.notes?.[id] ?? '')}</div>`;
    };

    FW.rating = function (id, labels) {
        const v = FW.state.ratings?.[id] ?? 3;
        return `<span class="rating" role="radiogroup" aria-label="강도">${[1, 2, 3, 4, 5].map(n => `
            <button class="rating__btn${n <= v ? ' is-on' : ''}" data-fw-rate="${id}:${n}" role="radio"
                    aria-checked="${n === v}" title="${labels[n - 1]}">${n}</button>`).join('')}
            <span class="rating__label">${labels[v - 1]}</span></span>`;
    };

    const split = s => { const i = s.lastIndexOf(':'); return [s.slice(0, i), Number(s.slice(i + 1))]; };

    /* ---------- 이벤트 (문서 전체에 위임) ---------- */
    document.addEventListener('input', e => {
        const t = e.target;
        if (t.dataset.fwItem) {
            const [id, i] = split(t.dataset.fwItem);
            FW.state.lists[id][i].t = t.textContent;
            FW.save();
        } else if (t.dataset.fwNote) {
            (FW.state.notes ||= {})[t.dataset.fwNote] = t.textContent;
            FW.save();
        }
    });

    // 비운 채로 벗어나면 항목 삭제
    document.addEventListener('focusout', e => {
        const t = e.target;
        if (!t.dataset || !t.dataset.fwItem) return;
        if (t.textContent.trim() === '') {
            const [id, i] = split(t.dataset.fwItem);
            FW.state.lists[id].splice(i, 1);
            FW.save();
            setTimeout(FW.render, 0);
        } else if (cfg.onChange) {
            cfg.onChange();
        }
    });

    // Enter = 다음 항목 추가, Esc = 편집 끝
    document.addEventListener('keydown', e => {
        const t = e.target;
        if (!t.dataset || !t.dataset.fwItem) return;
        if (e.key === 'Escape') { t.blur(); return; }
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            const [id, i] = split(t.dataset.fwItem);
            if (t.textContent.trim() === '') { t.blur(); return; }
            FW.state.lists[id].splice(i + 1, 0, { t: '', src: 'assume' });
            FW.save();
            FW.render();
            focusItem(id, i + 1);
        }
    });

    document.addEventListener('click', e => {
        const b = e.target.closest('[data-fw-add],[data-fw-del],[data-fw-src],[data-fw-rate]');
        if (!b) return;
        if (b.dataset.fwAdd) {
            const id = b.dataset.fwAdd;
            FW.state.lists[id].push({ t: '', src: 'assume' });
            FW.render();
            focusItem(id, FW.state.lists[id].length - 1);
        } else if (b.dataset.fwDel) {
            const [id, i] = split(b.dataset.fwDel);
            FW.state.lists[id].splice(i, 1);
            FW.save(); FW.render();
        } else if (b.dataset.fwSrc) {
            const [id, i] = split(b.dataset.fwSrc);
            const it = FW.state.lists[id][i];
            it.src = it.src === 'data' ? 'assume' : 'data';
            FW.save(); FW.render();
        } else if (b.dataset.fwRate) {
            const [id, n] = split(b.dataset.fwRate);
            (FW.state.ratings ||= {})[id] = n;
            FW.save(); FW.render();
        }
    });

    function focusItem(id, i) {
        const el = document.querySelector(`[data-fw-item="${id}:${i}"]`);
        if (!el) return;
        el.focus();
        const r = document.createRange();
        r.selectNodeContents(el); r.collapse(false);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }

    /* ---------- 내보내기 ---------- */
    FW.mdList = id => (FW.state.lists[id] || []).filter(x => x.t.trim())
        .map(x => `- ${x.t.trim()}${x.src === 'data' ? '' : ' _(가정)_'}`).join('\n');

    FW.copyMarkdown = async function () {
        const md = cfg.toMarkdown(FW.state);
        try {
            await navigator.clipboard.writeText(md);
        } catch (e) {
            const ta = document.createElement('textarea');
            ta.value = md; document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); } catch (err) {}
            ta.remove();
        }
        FW.toast('마크다운으로 복사했어요');
    };

    FW.toast = function (msg) {
        let el = document.getElementById('fwToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'fwToast'; el.className = 'fw-toast'; el.setAttribute('role', 'status');
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.add('is-visible');
        clearTimeout(FW.toast.t);
        FW.toast.t = setTimeout(() => el.classList.remove('is-visible'), 2200);
    };

    /* ---------- 테마 ---------- */
    FW.toggleTheme = function () {
        const dark = document.documentElement.classList.toggle('dark');
        try { localStorage.setItem(cfg.themeKey, dark ? 'dark' : 'light'); } catch (e) {}
    };

    FW.init = function (options) {
        cfg = options;
        FW.state = load();
        let stored = false;
        try { stored = !!localStorage.getItem(cfg.key); } catch (e) {}
        const el = document.getElementById('saveStatus');
        if (el) el.textContent = stored ? '저장된 내용 불러옴' : '초안 상태';
        FW.render();
    };

    window.FW = FW;
})();
