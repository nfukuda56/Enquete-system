// 参加者用アンケートアプリケーション

let questions = [];

// 初期化
document.addEventListener('DOMContentLoaded', async () => {
    await checkIfAlreadySubmitted();
    await loadQuestions();
    setupFormSubmission();
});

// 既に回答済みかチェック
async function checkIfAlreadySubmitted() {
    try {
        const response = await fetch(`${APPS_SCRIPT_URL}?action=getResponses`);
        if (!response.ok) throw new Error('Failed to fetch responses');

        const data = await response.json();
        const userResponses = data.filter(r => r.session_id === SESSION_ID);

        if (userResponses.length > 0) {
            showAlreadySubmitted();
            return true;
        }
        return false;
    } catch (error) {
        console.error('回答チェックエラー:', error);
        return false;
    }
}

// 質問を読み込む
async function loadQuestions() {
    try {
        const response = await fetch(`${APPS_SCRIPT_URL}?action=getQuestions`);
        if (!response.ok) throw new Error('Failed to fetch questions');

        const data = await response.json();
        questions = data
            .filter(q => q.is_active)
            .sort((a, b) => a.sort_order - b.sort_order);

        renderQuestions();
    } catch (error) {
        console.error('質問読み込みエラー:', error);
        showError('質問の読み込みに失敗しました。ページを再読み込みしてください。');
    }
}

// 質問を表示
function renderQuestions() {
    const container = document.getElementById('questions-container');
    const loading = document.getElementById('loading');
    const form = document.getElementById('survey-form');

    if (questions.length === 0) {
        container.innerHTML = '<p class="no-questions">現在、回答可能なアンケートはありません。</p>';
        loading.style.display = 'none';
        form.style.display = 'block';
        document.getElementById('submit-btn').style.display = 'none';
        return;
    }

    container.innerHTML = questions.map((q, index) => generateQuestionHTML(q, index)).join('');
    loading.style.display = 'none';
    form.style.display = 'block';
}

// 質問のHTML生成
function generateQuestionHTML(question, index) {
    const requiredMark = question.is_required ? '<span class="required">*</span>' : '';
    const requiredAttr = question.is_required ? 'required' : '';

    let inputHTML = '';

    switch (question.question_type) {
        case 'single':
            inputHTML = generateSingleChoiceHTML(question);
            break;
        case 'multiple':
            inputHTML = generateMultipleChoiceHTML(question);
            break;
        case 'text':
            inputHTML = generateTextInputHTML(question, requiredAttr);
            break;
        case 'rating':
            inputHTML = generateRatingHTML(question);
            break;
        default:
            inputHTML = '<p>不明な質問タイプです</p>';
    }

    return `
        <div class="question-card" data-question-id="${question.id}">
            <div class="question-number">Q${index + 1}</div>
            <div class="question-text">${escapeHtml(question.question_text)}${requiredMark}</div>
            <div class="question-input">
                ${inputHTML}
            </div>
        </div>
    `;
}

// 単一選択
function generateSingleChoiceHTML(question) {
    const options = question.options || [];
    return options.map((option, i) => `
        <label class="radio-label">
            <input type="radio" name="q_${question.id}" value="${escapeHtml(option)}"
                   ${question.is_required && i === 0 ? '' : ''}>
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
            <input type="checkbox" name="q_${question.id}" value="${escapeHtml(option)}">
            <span class="checkbox-custom"></span>
            ${escapeHtml(option)}
        </label>
    `).join('');
}

// 自由記述
function generateTextInputHTML(question, requiredAttr) {
    return `
        <textarea name="q_${question.id}" rows="4"
                  placeholder="ご意見・ご感想をお書きください" ${requiredAttr}></textarea>
    `;
}

// 5段階評価
function generateRatingHTML(question) {
    const labels = ['とても不満', '不満', '普通', '満足', 'とても満足'];
    return `
        <div class="rating-container">
            ${[1, 2, 3, 4, 5].map(value => `
                <label class="rating-label">
                    <input type="radio" name="q_${question.id}" value="${value}">
                    <span class="rating-star" data-value="${value}">${value}</span>
                    <span class="rating-text">${labels[value - 1]}</span>
                </label>
            `).join('')}
        </div>
    `;
}

// フォーム送信設定
function setupFormSubmission() {
    const form = document.getElementById('survey-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitSurvey();
    });
}

// アンケート送信
async function submitSurvey() {
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = '送信中...';

    try {
        // バリデーション
        if (!validateForm()) {
            submitBtn.disabled = false;
            submitBtn.textContent = '回答を送信';
            return;
        }

        // 回答データ収集
        const responses = collectResponses();

        // Apps Scriptに送信
        const response = await fetch(`${APPS_SCRIPT_URL}?action=addResponse`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(responses)
        });

        if (!response.ok) throw new Error('Failed to submit responses');

        showThankYou();
    } catch (error) {
        console.error('送信エラー:', error);
        showError('送信に失敗しました。もう一度お試しください。');
        submitBtn.disabled = false;
        submitBtn.textContent = '回答を送信';
    }
}

// フォームバリデーション
function validateForm() {
    let isValid = true;

    questions.forEach(question => {
        if (question.is_required) {
            const card = document.querySelector(`[data-question-id="${question.id}"]`);
            const inputs = card.querySelectorAll(`[name="q_${question.id}"]`);

            let hasValue = false;
            inputs.forEach(input => {
                if (input.type === 'radio' || input.type === 'checkbox') {
                    if (input.checked) hasValue = true;
                } else if (input.value.trim()) {
                    hasValue = true;
                }
            });

            if (!hasValue) {
                card.classList.add('error');
                isValid = false;
            } else {
                card.classList.remove('error');
            }
        }
    });

    if (!isValid) {
        alert('必須項目にご回答ください。');
    }

    return isValid;
}

// 回答データ収集
function collectResponses() {
    const responses = [];

    questions.forEach(question => {
        const inputs = document.querySelectorAll(`[name="q_${question.id}"]`);
        let answer = null;

        if (question.question_type === 'multiple') {
            const selected = [];
            inputs.forEach(input => {
                if (input.checked) selected.push(input.value);
            });
            answer = selected.length > 0 ? selected : null;
        } else if (question.question_type === 'text') {
            answer = inputs[0]?.value.trim() || null;
        } else {
            inputs.forEach(input => {
                if (input.checked) answer = input.value;
            });
        }

        if (answer !== null) {
            responses.push({
                question_id: question.id,
                session_id: SESSION_ID,
                answer: typeof answer === 'object' ? JSON.stringify(answer) : answer,
                created_at: new Date().toISOString()
            });
        }
    });

    return responses;
}

// 画面表示ヘルパー
function showThankYou() {
    document.getElementById('survey-form').style.display = 'none';
    document.getElementById('thank-you').style.display = 'block';
}

function showAlreadySubmitted() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('already-submitted').style.display = 'block';
}

function showError(message) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('survey-form').style.display = 'none';
    document.getElementById('error-message').style.display = 'block';
    document.getElementById('error-text').textContent = message;
}

// 再回答
function resetAndResubmit() {
    localStorage.removeItem('enquete_session_id');
    location.reload();
}

// HTMLエスケープ
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
