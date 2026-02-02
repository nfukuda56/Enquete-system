// 参加者用アンケートアプリケーション（一問一答形式）

let questions = [];
let currentQuestionIndex = 0;
let eventId = null;
let eventInfo = null;

// URLパラメータからイベントID取得
function getEventIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('event');
    return id ? parseInt(id) : null;
}

// 初期化
document.addEventListener('DOMContentLoaded', async () => {
    eventId = getEventIdFromUrl();

    if (!eventId) {
        showNoEvent();
        return;
    }

    // イベント情報を取得
    const eventExists = await loadEventInfo();
    if (!eventExists) {
        showEventNotFound();
        return;
    }

    // 質問読み込み
    await loadQuestions();
});

// イベント情報を読み込む
async function loadEventInfo() {
    try {
        const { data, error } = await supabaseClient
            .from('events')
            .select('*')
            .eq('id', eventId)
            .eq('is_active', true)
            .single();

        if (error || !data) {
            return false;
        }

        eventInfo = data;
        document.getElementById('event-name').textContent = eventInfo.name;
        return true;
    } catch (error) {
        console.error('イベント読み込みエラー:', error);
        return false;
    }
}

// 質問を読み込む
async function loadQuestions() {
    try {
        const { data, error } = await supabaseClient
            .from('questions')
            .select('*')
            .eq('event_id', eventId)
            .eq('is_active', true)
            .order('sort_order', { ascending: true });

        if (error) throw error;

        questions = data || [];

        if (questions.length === 0) {
            showNoQuestions();
            return;
        }

        // 質問表示開始
        document.getElementById('loading').style.display = 'none';
        document.getElementById('question-area').style.display = 'block';
        showQuestion(0);
    } catch (error) {
        console.error('質問読み込みエラー:', error);
        showError('質問の読み込みに失敗しました。');
    }
}

// 質問を表示
function showQuestion(index) {
    if (index >= questions.length) {
        showComplete();
        return;
    }

    currentQuestionIndex = index;
    const question = questions[index];

    // プログレス更新
    document.getElementById('progress-text').textContent = `質問 ${index + 1} / ${questions.length}`;
    document.getElementById('progress-fill').style.width = `${((index + 1) / questions.length) * 100}%`;

    // 質問HTML生成
    const html = generateQuestionHTML(question);
    document.getElementById('current-question').innerHTML = html;
}

// 質問のHTML生成
function generateQuestionHTML(question) {
    let inputHTML = '';

    switch (question.question_type) {
        case 'single':
            inputHTML = generateSingleChoiceHTML(question);
            break;
        case 'multiple':
            inputHTML = generateMultipleChoiceHTML(question);
            break;
        case 'text':
            inputHTML = generateTextInputHTML(question);
            break;
        case 'rating':
            inputHTML = generateRatingHTML(question);
            break;
        default:
            inputHTML = '<p>不明な質問タイプです</p>';
    }

    return `
        <div class="question-card" data-question-id="${question.id}">
            <div class="question-text">${escapeHtml(question.question_text)}</div>
            <div class="question-input">
                ${inputHTML}
            </div>
        </div>
    `;
}

// 単一選択
function generateSingleChoiceHTML(question) {
    const options = question.options || [];
    return options.map(option => `
        <label class="radio-label">
            <input type="radio" name="answer" value="${escapeHtml(option)}">
            <span class="radio-custom"></span>
            ${escapeHtml(option)}
        </label>
    `).join('');
}

// 複数選択
function generateMultipleChoiceHTML(question) {
    const options = question.options || [];
    return options.map(option => `
        <label class="checkbox-label">
            <input type="checkbox" name="answer" value="${escapeHtml(option)}">
            <span class="checkbox-custom"></span>
            ${escapeHtml(option)}
        </label>
    `).join('');
}

// 自由記述
function generateTextInputHTML(question) {
    return `
        <textarea name="answer" rows="4" placeholder="ご意見・ご感想をお書きください"></textarea>
    `;
}

// 5段階評価
function generateRatingHTML(question) {
    const labels = ['とても不満', '不満', '普通', '満足', 'とても満足'];
    return `
        <div class="rating-container">
            ${[1, 2, 3, 4, 5].map(value => `
                <label class="rating-label">
                    <input type="radio" name="answer" value="${value}">
                    <span class="rating-star" data-value="${value}">${value}</span>
                    <span class="rating-text">${labels[value - 1]}</span>
                </label>
            `).join('')}
        </div>
    `;
}

// 回答を送信
async function submitAnswer() {
    const question = questions[currentQuestionIndex];
    const answer = collectAnswer(question);

    if (answer === null) {
        alert('回答を選択してください。');
        return;
    }

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = '送信中...';

    try {
        // 既存の回答を確認して更新または挿入（upsert）
        const { data: existing } = await supabaseClient
            .from('responses')
            .select('id')
            .eq('question_id', question.id)
            .eq('session_id', SESSION_ID)
            .single();

        if (existing) {
            // 更新
            await supabaseClient
                .from('responses')
                .update({ answer: answer })
                .eq('id', existing.id);
        } else {
            // 挿入
            await supabaseClient
                .from('responses')
                .insert([{
                    question_id: question.id,
                    session_id: SESSION_ID,
                    answer: answer
                }]);
        }

        // 次の質問へ
        showQuestion(currentQuestionIndex + 1);
    } catch (error) {
        console.error('送信エラー:', error);
        alert('送信に失敗しました。もう一度お試しください。');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '回答を送信';
    }
}

// 回答を収集
function collectAnswer(question) {
    const inputs = document.querySelectorAll('[name="answer"]');

    if (question.question_type === 'multiple') {
        const selected = [];
        inputs.forEach(input => {
            if (input.checked) selected.push(input.value);
        });
        return selected.length > 0 ? JSON.stringify(selected) : null;
    } else if (question.question_type === 'text') {
        const value = inputs[0]?.value.trim();
        return value || null;
    } else {
        let answer = null;
        inputs.forEach(input => {
            if (input.checked) answer = input.value;
        });
        return answer;
    }
}

// スキップ
function skipQuestion() {
    showQuestion(currentQuestionIndex + 1);
}

// 最初から回答
function restartSurvey() {
    currentQuestionIndex = 0;
    document.getElementById('complete').style.display = 'none';
    document.getElementById('question-area').style.display = 'block';
    showQuestion(0);
}

// 画面表示ヘルパー
function showComplete() {
    document.getElementById('question-area').style.display = 'none';
    document.getElementById('complete').style.display = 'block';
}

function showNoQuestions() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('no-questions').style.display = 'block';
}

function showNoEvent() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('no-event').style.display = 'block';
}

function showEventNotFound() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('event-not-found').style.display = 'block';
}

function showError(message) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error-message').style.display = 'block';
    document.getElementById('error-text').textContent = message;
}

// HTMLエスケープ
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
