// ============================================================
// 伝心くん 件数表示（スライド側で読み込むスクリプト）
//
// スライド内の embed.html（iframe）が送ってくる件数を受け取り、
// data-denshin-count="設問ID" を付けた要素に書き込む。
// Supabase には接続しない。件数は iframe がすでに持っているデータから数えたもの。
//
//   <script src="https://nfukuda56.github.io/Enquete-system/denshin-count.js"></script>
//   <span data-denshin-count="33"></span>                 → 「18 / 40人」
//   <span data-denshin-count="33" data-denshin-hidden="1"></span> → 「18 / 40人（非表示 2件）」
//   <span data-denshin-count="33" data-denshin-field="respondents"></span> → 「18」
//
// data-denshin-field に指定できる値:
//   summary（既定） / respondents / posts / hidden / expected / rate
//
// 書き込んだ要素には次の属性が付く（CSS で見た目を変えたいとき用）:
//   data-denshin-state="ok" | "error"
//   data-denshin-complete   回答者数が参加予定数に達したとき
//
// 独自に表示したい場合は document の 'denshin:counts' イベントを使う:
//   document.addEventListener('denshin:counts', e => console.log(e.detail));
// ============================================================
(function () {
    'use strict';

    // 同じ設問の最新件数。後から追加された要素にも書き込めるよう覚えておく
    const latest = {};

    function num(v) {
        return typeof v === 'number' && Number.isFinite(v) ? v : null;
    }

    function format(d, field, withHidden) {
        const expected = d.expected > 0 ? d.expected : null;
        switch (field) {
            case 'respondents': return String(d.respondents);
            case 'posts':       return String(d.posts);
            case 'hidden':      return String(d.hidden);
            case 'expected':    return expected ? String(expected) : '';
            case 'rate':        return expected ? `${Math.round((d.respondents / expected) * 100)}%` : '';
        }
        let s = expected ? `${d.respondents} / ${expected}人` : `${d.respondents}人`;
        if (d.mode === 'append' && d.posts !== d.respondents) s += `・${d.posts}件`;
        if (withHidden && d.hidden > 0) s += `（非表示 ${d.hidden}件）`;
        return s;
    }

    function apply(qid) {
        const d = latest[qid];
        if (!d) return;
        document.querySelectorAll('[data-denshin-count]').forEach(el => {
            if (el.getAttribute('data-denshin-count').trim() !== qid) return;
            el.setAttribute('data-denshin-state', d.status);
            if (d.status !== 'ok') {
                // 回線が切れたときは最後の数字を残し、状態だけ変える
                return;
            }
            const field = el.getAttribute('data-denshin-field') || 'summary';
            const withHidden = el.getAttribute('data-denshin-hidden') === '1';
            el.textContent = format(d, field, withHidden);
            if (d.expected > 0 && d.respondents >= d.expected) {
                el.setAttribute('data-denshin-complete', '');
            } else {
                el.removeAttribute('data-denshin-complete');
            }
        });
    }

    // このページ内の iframe から来たメッセージだけを受け付ける
    function fromOwnIframe(source) {
        const frames = document.getElementsByTagName('iframe');
        for (let i = 0; i < frames.length; i++) {
            if (frames[i].contentWindow === source) return true;
        }
        return false;
    }

    window.addEventListener('message', (e) => {
        const m = e.data;
        if (!m || m.source !== 'denshinkun' || m.type !== 'counts') return;
        if (!fromOwnIframe(e.source)) return;

        const qid = String(m.qid);
        if (!/^\d+$/.test(qid)) return;

        let d;
        if (m.status === 'ok') {
            const respondents = num(m.respondents), posts = num(m.posts), hidden = num(m.hidden);
            if (respondents === null || posts === null || hidden === null) return;
            d = {
                status: 'ok', qid: Number(qid), respondents, posts, hidden,
                expected: num(m.expected),
                mode: m.mode === 'append' ? 'append' : 'overwrite',
                questionType: typeof m.questionType === 'string' ? m.questionType : null,
                lastAnsweredAt: typeof m.lastAnsweredAt === 'string' ? m.lastAnsweredAt : null
            };
        } else {
            d = Object.assign({}, latest[qid] || { qid: Number(qid) }, { status: 'error' });
        }
        latest[qid] = d;
        apply(qid);
        document.dispatchEvent(new CustomEvent('denshin:counts', { detail: d }));
    });

    // このスクリプトが iframe より後に読み込まれた場合に備えて再送を頼む
    function requestAll() {
        const frames = document.getElementsByTagName('iframe');
        for (let i = 0; i < frames.length; i++) {
            try {
                frames[i].contentWindow &&
                    frames[i].contentWindow.postMessage({ source: 'denshinkun', type: 'requestCounts' }, '*');
            } catch (e) { /* 読み込み前の iframe は無視 */ }
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', requestAll);
    } else {
        requestAll();
    }

    // 手動で書き直したいとき用（reveal.js のスライド遷移後など）
    window.DenshinCount = {
        get: (qid) => latest[String(qid)] || null,
        refresh: () => { Object.keys(latest).forEach(apply); requestAll(); },
        format
    };
})();
