// ============================================================
// 伝心くん 回答件数の集計（admin.js と embed.html で共用）
//
// 数え方:
//   respondents  回答者数。blocked を除いた回答の session_id を重複なしで数える
//   posts        投稿数。blocked を除いた行数（append の設問で回答者数と差が出る）
//   hidden       非表示件数（moderation_status = 'blocked'）
//
// 管理画面とスライドで数字が食い違わないよう、件数はこの関数だけで数えること。
// ============================================================

function countResponses(question, qResponses) {
    const list = qResponses || [];
    const visible = list.filter(r => r.moderation_status !== 'blocked');

    let lastAnsweredAt = null;
    visible.forEach(r => {
        if (r.created_at && (!lastAnsweredAt || r.created_at > lastAnsweredAt)) {
            lastAnsweredAt = r.created_at;
        }
    });

    return {
        respondents: new Set(visible.map(r => r.session_id)).size,
        posts: visible.length,
        hidden: list.length - visible.length,
        mode: question?.duplicate_mode || 'overwrite',
        lastAnsweredAt
    };
}

// 「18人」「18人・27件」の形に整える（append で投稿数が回答者数と違うときだけ件数を併記）
function formatRespondents(counts) {
    let s = `${counts.respondents}人`;
    if (counts.mode === 'append' && counts.posts !== counts.respondents) {
        s += `・${counts.posts}件`;
    }
    return s;
}
