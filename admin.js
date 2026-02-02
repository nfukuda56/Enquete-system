// 管理者用アプリケーション

let questions = [];
let responses = [];
let charts = {};
let realtimeChannel = null;

// 初期化
document.addEventListener('DOMContentLoaded', async () => {
    setupTabs();
    await loadQuestions();
    await loadResponses();
    startRealtimeSubscription();
    setupQuestionForm();
});

// タブ切り替え
function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(content => {
                content.style.display = 'none';
                content.classList.remove('active');
            });

            const targetTab = document.getElementById(`${tabId}-tab`);
            targetTab.style.display = 'block';
            targetTab.classList.add('active');
        });
    });
}

// 質問を読み込む
async function loadQuestions() {
    try {
        const { data, error } = await supabaseClient
            .from('questions')
            .select('*')
            .order('sort_order', { ascending: true });

        if (error) throw error;

        questions = data || [];
        renderQuestionsList();
    } catch (error) {
        console.error('質問読み込みエラー:', error);
    }
}

// 回答を読み込む
async function loadResponses() {
    try {
        const { data, error } = await supabaseClient
            .from('responses')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) throw error;

        responses = data || [];
        renderResults();
        updateTotalCount();
    } catch (error) {
        console.error('回答読み込みエラー:', error);
    }
}

// Realtime購読開始
function startRealtimeSubscription() {
    realtimeChannel = supabaseClient
        .channel('db-changes')
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'responses' },
            (payload) => {
                // 新しい回答を追加
                responses.push(payload.new);
                renderResults();
                updateTotalCount();
                highlightNewResponse();
            }
        )
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'questions' },
            async () => {
                // 質問が変更されたら再読み込み
                await loadQuestions();
                renderResults();
            }
        )
        .subscribe();
}

// Realtime購読停止
function stopRealtimeSubscription() {
    if (realtimeChannel) {
        supabaseClient.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }
}

// 新しい回答のハイライト
function highlightNewResponse() {
    const indicator = document.querySelector('.live-dot');
    indicator.classList.add('pulse');
    setTimeout(() => indicator.classList.remove('pulse'), 1000);
}

// 総回答数更新
function updateTotalCount() {
    const uniqueSessions = new Set(responses.map(r => r.session_id));
    document.getElementById('total-responses').textContent = uniqueSessions.size;
}

// 結果を表示
function renderResults() {
    const container = document.getElementById('results-container');
    const loading = document.getElementById('loading');

    if (questions.length === 0) {
        container.innerHTML = '<p class="no-data">まだ質問が登録されていません。</p>';
        loading.style.display = 'none';
        container.style.display = 'block';
        return;
    }

    let html = '';
    questions.filter(q => q.is_active).forEach((question, index) => {
        const questionResponses = responses.filter(r => r.question_id === question.id);
        html += generateResultCard(question, questionResponses, index);
    });

    container.innerHTML = html;
    loading.style.display = 'none';
    container.style.display = 'block';

    // グラフを描画
    questions.filter(q => q.is_active).forEach(question => {
        if (question.question_type !== 'text') {
            renderChart(question);
        }
    });
}

// 結果カード生成
function generateResultCard(question, questionResponses, index) {
    const responseCount = questionResponses.length;

    let contentHTML = '';
    if (question.question_type === 'text') {
        contentHTML = generateTextResponses(questionResponses);
    } else {
        contentHTML = `
            <div class="chart-container">
                <canvas id="chart-${question.id}"></canvas>
            </div>
            ${generateStatsSummary(question, questionResponses)}
        `;
    }

    return `
        <div class="result-card">
            <div class="result-header">
                <span class="question-number">Q${index + 1}</span>
                <span class="question-text">${escapeHtml(question.question_text)}</span>
                <span class="response-count">${responseCount}件の回答</span>
            </div>
            <div class="result-content">
                ${contentHTML}
            </div>
        </div>
    `;
}

// テキスト回答一覧
function generateTextResponses(questionResponses) {
    if (questionResponses.length === 0) {
        return '<p class="no-responses">まだ回答がありません</p>';
    }

    return `
        <div class="text-responses">
            ${questionResponses.map(r => `
                <div class="text-response-item">
                    <span class="response-time">${formatTime(r.created_at)}</span>
                    <p>${escapeHtml(r.answer)}</p>
                </div>
            `).join('')}
        </div>
    `;
}

// 統計サマリー生成
function generateStatsSummary(question, questionResponses) {
    const stats = calculateStats(question, questionResponses);

    return `
        <div class="stats-summary">
            ${stats.map(s => `
                <div class="stat-item">
                    <span class="stat-label">${escapeHtml(s.label)}</span>
                    <div class="stat-bar-container">
                        <div class="stat-bar" style="width: ${s.percentage}%"></div>
                    </div>
                    <span class="stat-value">${s.count}件 (${s.percentage.toFixed(1)}%)</span>
                </div>
            `).join('')}
        </div>
    `;
}

// 統計計算
function calculateStats(question, questionResponses) {
    const counts = {};

    if (question.question_type === 'rating') {
        [1, 2, 3, 4, 5].forEach(v => counts[v] = 0);
    } else if (question.options) {
        question.options.forEach(opt => counts[opt] = 0);
    }

    questionResponses.forEach(r => {
        let answer = r.answer;

        // 複数選択の場合
        if (question.question_type === 'multiple') {
            try {
                const answers = JSON.parse(answer);
                answers.forEach(a => {
                    if (counts[a] !== undefined) counts[a]++;
                });
            } catch {
                if (counts[answer] !== undefined) counts[answer]++;
            }
        } else {
            if (counts[answer] !== undefined) counts[answer]++;
        }
    });

    const total = questionResponses.length || 1;
    return Object.entries(counts).map(([label, count]) => ({
        label: question.question_type === 'rating' ? getRatingLabel(label) : label,
        count,
        percentage: (count / total) * 100
    }));
}

// 評価ラベル取得
function getRatingLabel(value) {
    const labels = { '1': '1 (とても不満)', '2': '2 (不満)', '3': '3 (普通)', '4': '4 (満足)', '5': '5 (とても満足)' };
    return labels[value] || value;
}

// グラフ描画
function renderChart(question) {
    const canvas = document.getElementById(`chart-${question.id}`);
    if (!canvas) return;

    const questionResponses = responses.filter(r => r.question_id === question.id);
    const stats = calculateStats(question, questionResponses);

    // 既存のチャートを破棄
    if (charts[question.id]) {
        charts[question.id].destroy();
    }

    const ctx = canvas.getContext('2d');
    charts[question.id] = new Chart(ctx, {
        type: question.question_type === 'rating' ? 'bar' : 'doughnut',
        data: {
            labels: stats.map(s => s.label),
            datasets: [{
                data: stats.map(s => s.count),
                backgroundColor: [
                    '#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
                    '#EC4899', '#06B6D4', '#84CC16'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: question.question_type === 'rating' ? 'top' : 'right'
                }
            }
        }
    });
}

// 質問フォーム設定
function setupQuestionForm() {
    const form = document.getElementById('add-question-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await addQuestion();
    });
}

// 選択肢入力の表示切り替え
function toggleOptionsInput() {
    const type = document.getElementById('question-type').value;
    const optionsGroup = document.getElementById('options-group');
    optionsGroup.style.display = (type === 'single' || type === 'multiple') ? 'block' : 'none';
}

// 質問追加
async function addQuestion() {
    const text = document.getElementById('question-text').value.trim();
    const type = document.getElementById('question-type').value;
    const optionsText = document.getElementById('question-options').value;
    const isRequired = document.getElementById('question-required').checked;

    let options = null;
    if (type === 'single' || type === 'multiple') {
        options = optionsText.split('\n').map(o => o.trim()).filter(o => o);
        if (options.length < 2) {
            alert('選択肢は2つ以上入力してください。');
            return;
        }
    }

    const maxOrder = Math.max(...questions.map(q => q.sort_order), 0);

    try {
        const questionData = {
            question_text: text,
            question_type: type,
            options: options,
            is_required: isRequired,
            is_active: true,
            sort_order: maxOrder + 1
        };

        const { data, error } = await supabaseClient
            .from('questions')
            .insert([questionData])
            .select()
            .single();

        if (error) throw error;

        questions.push(data);
        renderQuestionsList();
        renderResults();

        // フォームリセット
        document.getElementById('add-question-form').reset();
        toggleOptionsInput();

        alert('質問を追加しました。');
    } catch (error) {
        console.error('質問追加エラー:', error);
        alert('質問の追加に失敗しました。');
    }
}

// 質問リスト表示
function renderQuestionsList() {
    const container = document.getElementById('questions-list');

    if (questions.length === 0) {
        container.innerHTML = '<p class="no-questions">登録された質問がありません</p>';
        return;
    }

    container.innerHTML = questions.map((q, index) => `
        <div class="question-list-item ${q.is_active ? '' : 'inactive'}">
            <div class="question-info">
                <span class="question-order">Q${index + 1}</span>
                <span class="question-type-badge">${getTypeLabel(q.question_type)}</span>
                <span class="question-text">${escapeHtml(q.question_text)}</span>
                ${q.is_required ? '<span class="required-badge">必須</span>' : ''}
            </div>
            <div class="question-actions">
                <button class="btn btn-sm ${q.is_active ? 'btn-warning' : 'btn-success'}"
                        onclick="toggleQuestionActive(${q.id}, ${!q.is_active})">
                    ${q.is_active ? '非表示' : '表示'}
                </button>
                <button class="btn btn-sm btn-danger" onclick="deleteQuestion(${q.id})">
                    削除
                </button>
            </div>
        </div>
    `).join('');
}

// タイプラベル取得
function getTypeLabel(type) {
    const labels = {
        'single': '単一選択',
        'multiple': '複数選択',
        'text': '自由記述',
        'rating': '5段階評価'
    };
    return labels[type] || type;
}

// 質問の有効/無効切り替え
async function toggleQuestionActive(id, isActive) {
    try {
        const { error } = await supabaseClient
            .from('questions')
            .update({ is_active: isActive })
            .eq('id', id);

        if (error) throw error;

        const question = questions.find(q => q.id === id);
        if (question) question.is_active = isActive;

        renderQuestionsList();
        renderResults();
    } catch (error) {
        console.error('更新エラー:', error);
        alert('更新に失敗しました。');
    }
}

// 質問削除
async function deleteQuestion(id) {
    if (!confirm('この質問を削除しますか？関連する回答も削除されます。')) return;

    try {
        // ON DELETE CASCADE により関連する回答も自動削除される
        const { error } = await supabaseClient
            .from('questions')
            .delete()
            .eq('id', id);

        if (error) throw error;

        questions = questions.filter(q => q.id !== id);
        responses = responses.filter(r => r.question_id !== id);

        renderQuestionsList();
        renderResults();
        updateTotalCount();
    } catch (error) {
        console.error('削除エラー:', error);
        alert('削除に失敗しました。');
    }
}

// 時刻フォーマット
function formatTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleString('ja-JP', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// HTMLエスケープ
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ページ離脱時のクリーンアップ
window.addEventListener('beforeunload', () => {
    stopRealtimeSubscription();
});
