// 管理者用アプリケーション

let events = [];
let questions = [];
let responses = [];
let charts = {};
let realtimeChannel = null;
let selectedEventId = null;
let currentResultIndex = 0;
let currentEvent = null;  // 選択中のイベント情報
let isPresenting = false;  // プレゼンモード状態

// GitHub Pages URL（QRコード用）
const BASE_URL = 'https://nfukuda56.github.io/Enquete-system/';

// 初期化
document.addEventListener('DOMContentLoaded', async () => {
    setupViewNavigation();
    setupEventForms();
    setupQuestionForm();
    await loadEvents();
    startRealtimeSubscription();
});

// ビュー切り替え（SPA ナビゲーション）
function setupViewNavigation() {
    document.querySelectorAll('.sidebar-nav-btn[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            const viewName = btn.getAttribute('data-view');
            switchView(viewName);
        });
    });
}

// ビューを切り替える
function switchView(viewName) {
    // すべてのビューを非表示
    document.querySelectorAll('.view-content').forEach(view => {
        view.style.display = 'none';
        view.classList.remove('active');
    });

    // 対象のビューを表示
    const targetView = document.getElementById(`${viewName}-view`);
    if (targetView) {
        targetView.style.display = 'flex';
        targetView.classList.add('active');
    }

    // ナビボタンのアクティブ状態更新
    document.querySelectorAll('.sidebar-nav-btn[data-view]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-view') === viewName);
    });
}

// 画面上部ヘッダーを更新
function updateTopHeader() {
    const nameEl = document.getElementById('header-event-name');
    const dateEl = document.getElementById('header-event-date');

    if (selectedEventId && currentEvent) {
        nameEl.textContent = currentEvent.name;
        if (currentEvent.event_date) {
            dateEl.textContent = new Date(currentEvent.event_date).toLocaleDateString('ja-JP');
        } else {
            dateEl.textContent = '';
        }
    } else {
        nameEl.textContent = 'イベントを選択してください';
        dateEl.textContent = '';
    }
}

// サイドバーQRコードを更新
function updateSidebarQR() {
    const qrContainer = document.getElementById('sidebar-qr');
    if (!qrContainer) return;

    qrContainer.innerHTML = '';

    if (selectedEventId) {
        const url = `${BASE_URL}?event=${selectedEventId}`;
        new QRCode(qrContainer, {
            text: url,
            width: 100,
            height: 100,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });
    }
}

// ========== イベント関連 ==========

// イベントフォーム設定
function setupEventForms() {
    document.getElementById('add-event-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await addEvent('event-name', 'event-date', 'event-description');
        e.target.reset();
    });
}

// イベント読み込み
async function loadEvents() {
    try {
        const { data, error } = await supabaseClient
            .from('events')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        events = data || [];
        renderEventSelect();
        renderEventsList();
    } catch (error) {
        console.error('イベント読み込みエラー:', error);
    }
}

// イベント選択ドロップダウン描画
function renderEventSelect() {
    const select = document.getElementById('event-select');
    select.innerHTML = '<option value="">-- イベントを選択 --</option>' +
        events.map(e => `
            <option value="${e.id}" ${e.id === selectedEventId ? 'selected' : ''}>
                ${escapeHtml(e.name)}${e.event_date ? ` (${e.event_date})` : ''}
            </option>
        `).join('');
}

// イベント選択
async function selectEvent(eventId) {
    selectedEventId = eventId ? parseInt(eventId) : null;
    currentEvent = selectedEventId ? events.find(e => e.id === selectedEventId) : null;

    // 画面ヘッダーとサイドバーQRを更新
    updateTopHeader();
    updateSidebarQR();

    // QRコードセクション表示/非表示（イベント管理ビュー内）
    const qrSection = document.getElementById('qr-section');
    if (selectedEventId) {
        qrSection.style.display = 'flex';
        generateQRCode();
        generateMaterialQRCode();
        document.getElementById('add-question-btn').disabled = false;
        document.getElementById('question-event-notice').style.display = 'none';
    } else {
        qrSection.style.display = 'none';
        document.getElementById('add-question-btn').disabled = true;
        document.getElementById('question-event-notice').style.display = 'block';
    }

    // 質問と回答を再読み込み
    await loadQuestions();
    await loadResponses();

    // プレゼンモード状態を読み込み
    if (selectedEventId) {
        await loadAdminState();
    } else {
        isPresenting = false;
        updatePresentModeUI();
    }
}

// QRコード生成
let qrCodeInstance = null;

function generateQRCode() {
    const url = `${BASE_URL}?event=${selectedEventId}`;
    const qrContainer = document.getElementById('qr-code');
    const qrUrlElement = document.getElementById('qr-url');

    // 既存のQRコードをクリア
    qrContainer.innerHTML = '';

    // 新しいQRコードを生成
    qrCodeInstance = new QRCode(qrContainer, {
        text: url,
        width: 150,
        height: 150,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
    });

    qrUrlElement.textContent = url;
}

// URLコピー
function copyEventUrl() {
    const url = `${BASE_URL}?event=${selectedEventId}`;
    navigator.clipboard.writeText(url).then(() => {
        alert('URLをコピーしました');
    }).catch(err => {
        console.error('コピーエラー:', err);
        prompt('URLをコピーしてください:', url);
    });
}

// 関連資料QRコード生成
let materialQrCodeInstance = null;

function generateMaterialQRCode() {
    const materialQrGroup = document.getElementById('material-qr-group');
    const materialUrl = currentEvent?.material_url;

    if (!materialUrl) {
        materialQrGroup.style.display = 'none';
        return;
    }

    const qrContainer = document.getElementById('material-qr-code');
    const qrUrlElement = document.getElementById('material-qr-url');

    // 既存のQRコードをクリア
    qrContainer.innerHTML = '';

    // 新しいQRコードを生成
    materialQrCodeInstance = new QRCode(qrContainer, {
        text: materialUrl,
        width: 150,
        height: 150,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
    });

    qrUrlElement.textContent = materialUrl;
    materialQrGroup.style.display = 'flex';
}

// 関連資料URLコピー
function copyMaterialUrl() {
    const url = currentEvent?.material_url;
    if (!url) return;

    navigator.clipboard.writeText(url).then(() => {
        alert('関連資料URLをコピーしました');
    }).catch(err => {
        console.error('コピーエラー:', err);
        prompt('URLをコピーしてください:', url);
    });
}

// イベント追加
async function addEvent(nameId, dateId, descId) {
    const name = document.getElementById(nameId).value.trim();
    const date = document.getElementById(dateId).value || null;
    const description = document.getElementById(descId).value.trim() || null;
    const participants = document.getElementById('event-participants').value;
    const materialUrl = document.getElementById('event-material-url').value.trim() || null;

    if (!name) {
        alert('イベント名を入力してください。');
        return;
    }

    try {
        const { data, error } = await supabaseClient
            .from('events')
            .insert([{
                name,
                event_date: date,
                description,
                expected_participants: participants ? parseInt(participants) : null,
                material_url: materialUrl
            }])
            .select()
            .single();

        if (error) throw error;

        events.unshift(data);
        renderEventSelect();
        renderEventsList();

        // 新しいイベントを選択
        document.getElementById('event-select').value = data.id;
        await selectEvent(data.id);

        // フォームリセット
        document.getElementById('add-event-form').reset();

        alert('イベントを作成しました。');
    } catch (error) {
        console.error('イベント追加エラー:', error);
        alert('イベントの追加に失敗しました。');
    }
}

// イベント削除
async function deleteEvent(id) {
    if (!confirm('このイベントを削除しますか？関連する質問と回答もすべて削除されます。')) return;

    try {
        const { error } = await supabaseClient
            .from('events')
            .delete()
            .eq('id', id);

        if (error) throw error;

        events = events.filter(e => e.id !== id);
        renderEventSelect();
        renderEventsList();

        // 削除されたイベントが選択中だった場合
        if (selectedEventId === id) {
            selectedEventId = null;
            document.getElementById('event-select').value = '';
            await selectEvent(null);
        }

        alert('イベントを削除しました。');
    } catch (error) {
        console.error('イベント削除エラー:', error);
        alert('削除に失敗しました。');
    }
}

// イベントリスト描画
function renderEventsList() {
    const container = document.getElementById('events-list');

    if (events.length === 0) {
        container.innerHTML = '<p class="no-data">イベントがありません</p>';
        return;
    }

    container.innerHTML = events.map(e => `
        <div class="event-list-item">
            <div class="event-info">
                <span class="event-name">${escapeHtml(e.name)}</span>
                ${e.event_date ? `<span class="event-date">${e.event_date}</span>` : ''}
                ${e.expected_participants ? `<span class="event-participants-badge">参加予定: ${e.expected_participants}名</span>` : ''}
                ${e.description ? `<p class="event-description">${escapeHtml(e.description)}</p>` : ''}
                ${e.material_url ? `<p class="event-material"><a href="${escapeHtml(e.material_url)}" target="_blank" rel="noopener">関連資料</a></p>` : ''}
            </div>
            <div class="event-actions">
                <button class="btn btn-sm btn-secondary" onclick="editEvent(${e.id})">編集</button>
                <button class="btn btn-sm btn-danger" onclick="deleteEvent(${e.id})">削除</button>
            </div>
        </div>
    `).join('');
}

// ========== イベント編集 ==========

// イベント編集モーダル表示
function editEvent(id) {
    const event = events.find(e => e.id === id);
    if (!event) return;

    document.getElementById('edit-event-id').value = event.id;
    document.getElementById('edit-event-name').value = event.name;
    document.getElementById('edit-event-date').value = event.event_date || '';
    document.getElementById('edit-event-description').value = event.description || '';
    document.getElementById('edit-event-participants').value = event.expected_participants || '';
    document.getElementById('edit-event-material-url').value = event.material_url || '';

    document.getElementById('edit-event-modal').style.display = 'flex';
}

// イベント編集モーダル非表示
function hideEditEventModal() {
    document.getElementById('edit-event-modal').style.display = 'none';
}

// イベント編集を保存
async function saveEventEdit() {
    const id = parseInt(document.getElementById('edit-event-id').value);
    const name = document.getElementById('edit-event-name').value.trim();
    const date = document.getElementById('edit-event-date').value || null;
    const description = document.getElementById('edit-event-description').value.trim() || null;
    const participants = document.getElementById('edit-event-participants').value;
    const materialUrl = document.getElementById('edit-event-material-url').value.trim() || null;

    if (!name) {
        alert('イベント名を入力してください。');
        return;
    }

    try {
        const { error } = await supabaseClient
            .from('events')
            .update({
                name,
                event_date: date,
                description,
                expected_participants: participants ? parseInt(participants) : null,
                material_url: materialUrl
            })
            .eq('id', id);

        if (error) throw error;

        // ローカル配列を更新
        const event = events.find(e => e.id === id);
        if (event) {
            event.name = name;
            event.event_date = date;
            event.description = description;
            event.expected_participants = participants ? parseInt(participants) : null;
            event.material_url = materialUrl;
        }

        // currentEventも更新
        if (currentEvent && currentEvent.id === id) {
            currentEvent = event;
            generateMaterialQRCode(); // 関連資料QRコードを更新
            updateTopHeader(); // ヘッダーを更新
        }

        renderEventSelect();
        renderEventsList();
        hideEditEventModal();
        updateTotalCount(); // 回答率表示の更新

        alert('イベントを更新しました。');
    } catch (error) {
        console.error('更新エラー:', error);
        alert('イベントの更新に失敗しました。');
    }
}

// ========== 質問関連 ==========

// 質問を読み込む（イベントフィルタ）
async function loadQuestions() {
    try {
        let query = supabaseClient
            .from('questions')
            .select('*')
            .order('sort_order', { ascending: true });

        if (selectedEventId) {
            query = query.eq('event_id', selectedEventId);
        } else {
            // イベント未選択時は空
            questions = [];
            renderQuestionsList();
            return;
        }

        const { data, error } = await query;

        if (error) throw error;

        questions = data || [];
        renderQuestionsList();
    } catch (error) {
        console.error('質問読み込みエラー:', error);
    }
}

// 回答を読み込む（イベントの質問に紐づく回答のみ）
async function loadResponses() {
    try {
        if (!selectedEventId || questions.length === 0) {
            responses = [];
            renderResults();
            updateTotalCount();
            return;
        }

        const questionIds = questions.map(q => q.id);

        const { data, error } = await supabaseClient
            .from('responses')
            .select('*')
            .in('question_id', questionIds)
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
                // 選択中イベントの質問への回答のみ処理
                const questionIds = questions.map(q => q.id);
                if (questionIds.includes(payload.new.question_id)) {
                    responses.push(payload.new);
                    renderResults();
                    updateTotalCount();
                    highlightNewResponse();
                }
            }
        )
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'questions' },
            async (payload) => {
                // 選択中イベントの質問変更のみ処理
                if (payload.new?.event_id === selectedEventId || payload.old?.event_id === selectedEventId) {
                    await loadQuestions();
                    await loadResponses();
                }
            }
        )
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'events' },
            async () => {
                await loadEvents();
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

// 総回答数更新（回答率に基づく表示）
function updateTotalCount() {
    const uniqueSessions = new Set(responses.map(r => r.session_id));
    const responseCount = uniqueSessions.size;
    const expectedParticipants = currentEvent?.expected_participants || 0;

    const statValue = document.getElementById('total-responses');
    const sidebarStats = document.querySelector('.sidebar-stats');

    if (expectedParticipants > 0) {
        // 「回答者数/参加者数」形式で表示
        statValue.textContent = `${responseCount}/${expectedParticipants}`;

        // 回答率計算
        const responseRate = (responseCount / expectedParticipants) * 100;

        // 背景色の設定（サイドバー用）
        if (sidebarStats) {
            sidebarStats.classList.remove('response-rate-low', 'response-rate-high');
            if (responseRate <= 30) {
                sidebarStats.classList.add('response-rate-low');
            } else {
                sidebarStats.classList.add('response-rate-high');
            }
        }
    } else {
        // 参加者数未設定の場合は従来通り
        statValue.textContent = responseCount;
        if (sidebarStats) {
            sidebarStats.classList.remove('response-rate-low', 'response-rate-high');
        }
    }
}

// グラフ表示判定（回答率30%超過時のみ表示）
function calculateShouldShowChart() {
    const expectedParticipants = currentEvent?.expected_participants || 0;
    if (expectedParticipants === 0) {
        return true; // 参加者数未設定時は常にグラフ表示
    }

    const uniqueSessions = new Set(responses.map(r => r.session_id));
    const responseCount = uniqueSessions.size;
    const responseRate = (responseCount / expectedParticipants) * 100;

    return responseRate > 30;
}

// 結果を表示（1問ずつ表示）
function renderResults() {
    const container = document.getElementById('results-container');
    const loading = document.getElementById('loading');
    const presentControls = document.getElementById('present-mode-controls');

    if (!selectedEventId) {
        container.innerHTML = '<p class="no-data">イベント管理でイベントを選択してください。</p>';
        loading.style.display = 'none';
        container.style.display = 'block';
        presentControls.style.display = 'none';
        return;
    }

    const activeQuestions = questions.filter(q => q.is_active);

    if (activeQuestions.length === 0) {
        container.innerHTML = '<p class="no-data">まだ質問が登録されていません。</p>';
        loading.style.display = 'none';
        container.style.display = 'block';
        presentControls.style.display = 'none';
        return;
    }

    // プレゼンモードコントロールを表示
    presentControls.style.display = 'flex';

    // インデックスの範囲チェック
    if (currentResultIndex >= activeQuestions.length) {
        currentResultIndex = activeQuestions.length - 1;
    }
    if (currentResultIndex < 0) {
        currentResultIndex = 0;
    }

    const question = activeQuestions[currentResultIndex];
    const questionResponses = responses.filter(r => r.question_id === question.id);

    // 回答率に基づくグラフ表示判定
    const shouldShowChart = calculateShouldShowChart();

    const html = generateResultCard(question, questionResponses, currentResultIndex, activeQuestions.length, shouldShowChart);

    container.innerHTML = html;
    loading.style.display = 'none';
    container.style.display = 'block';

    // グラフを描画（text/image以外、かつ回答率30%超過時のみ）
    if (question.question_type !== 'text' && question.question_type !== 'image' && shouldShowChart) {
        renderChart(question);
    }
}

// 前の質問へ
async function prevResult() {
    const activeQuestions = questions.filter(q => q.is_active);
    if (currentResultIndex > 0) {
        currentResultIndex--;
        renderResults();
        // プレゼンモード中は参加者画面に同期
        if (isPresenting) {
            await syncAdminState();
        }
    }
}

// 次の質問へ
async function nextResult() {
    const activeQuestions = questions.filter(q => q.is_active);
    if (currentResultIndex < activeQuestions.length - 1) {
        currentResultIndex++;
        renderResults();
        // プレゼンモード中は参加者画面に同期
        if (isPresenting) {
            await syncAdminState();
        }
    }
}

// 結果カード生成
function generateResultCard(question, questionResponses, index, totalQuestions, shouldShowChart = true) {
    const responseCount = questionResponses.length;

    let contentHTML = '';
    if (question.question_type === 'text') {
        contentHTML = generateTextResponses(questionResponses);
    } else if (question.question_type === 'image') {
        contentHTML = generateImageGallery(questionResponses);
    } else if (shouldShowChart) {
        // 回答率30%超過: グラフ表示
        contentHTML = `
            <div class="chart-container chart-container-large">
                <canvas id="chart-${question.id}"></canvas>
            </div>
            ${generateStatsSummary(question, questionResponses)}
        `;
    } else {
        // 回答率30%以下: メッセージ表示（統計サマリーは表示）
        contentHTML = `
            <div class="low-response-notice">
                <p>回答率が30%を超えるとグラフが表示されます</p>
            </div>
            ${generateStatsSummary(question, questionResponses)}
        `;
    }

    const prevDisabled = index === 0 ? 'disabled' : '';
    const nextDisabled = index === totalQuestions - 1 ? 'disabled' : '';

    return `
        <div class="result-card result-card-fullscreen">
            <div class="result-nav">
                <button class="btn btn-secondary result-nav-btn" onclick="prevResult()" ${prevDisabled}>
                    ← 前の質問
                </button>
                <span class="result-nav-indicator">${index + 1} / ${totalQuestions}</span>
                <button class="btn btn-secondary result-nav-btn" onclick="nextResult()" ${nextDisabled}>
                    次の質問 →
                </button>
            </div>
            <div class="result-header">
                <span class="question-number">Q${index + 1}</span>
                <span class="question-text-large">${escapeHtml(question.question_text)}</span>
            </div>
            <div class="result-response-count">${responseCount}件の回答</div>
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

// 画像ギャラリー表示
function generateImageGallery(questionResponses) {
    if (questionResponses.length === 0) {
        return '<p class="no-responses">まだ回答がありません</p>';
    }

    return `
        <div class="image-gallery">
            ${questionResponses.map(r => `
                <div class="image-tile">
                    <img src="${escapeHtml(r.answer)}"
                         alt="投稿画像"
                         loading="lazy"
                         onclick="openImageModal('${escapeHtml(r.answer)}')">
                </div>
            `).join('')}
        </div>
    `;
}

// 画像拡大モーダル
function openImageModal(src) {
    // シンプルな拡大表示（新しいタブで開く）
    window.open(src, '_blank');
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
    if (!selectedEventId) {
        alert('先にイベントを選択してください。');
        return;
    }

    const text = document.getElementById('question-text').value.trim();
    const type = document.getElementById('question-type').value;
    const optionsText = document.getElementById('question-options').value;
    const isRequired = document.getElementById('question-required').checked;

    if (!text) {
        alert('質問文を入力してください。');
        return;
    }

    let options = null;
    if (type === 'single' || type === 'multiple') {
        options = optionsText.split('\n').map(o => o.trim()).filter(o => o);
        if (options.length < 2) {
            alert('選択肢は2つ以上入力してください。');
            return;
        }
    }

    const maxOrder = questions.length > 0 ? Math.max(...questions.map(q => q.sort_order)) + 1 : 1;

    try {
        const questionData = {
            event_id: selectedEventId,
            question_text: text,
            question_type: type,
            options: options,
            is_required: isRequired,
            is_active: true,
            sort_order: maxOrder
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
        alert('質問の追加に失敗しました。\nエラー: ' + (error.message || error));
    }
}

// 質問リスト表示
function renderQuestionsList() {
    const container = document.getElementById('questions-list');

    if (!selectedEventId) {
        container.innerHTML = '<p class="no-data">イベントを選択してください</p>';
        return;
    }

    if (questions.length === 0) {
        container.innerHTML = '<p class="no-data">登録された質問がありません</p>';
        return;
    }

    container.innerHTML = questions.map((q, index) => `
        <div class="question-list-item ${q.is_active ? '' : 'inactive'}">
            <div class="question-order-controls">
                <button class="btn-icon" onclick="moveQuestionUp(${q.id})" ${index === 0 ? 'disabled' : ''} title="上へ移動">▲</button>
                <span class="question-order">Q${index + 1}</span>
                <button class="btn-icon" onclick="moveQuestionDown(${q.id})" ${index === questions.length - 1 ? 'disabled' : ''} title="下へ移動">▼</button>
            </div>
            <div class="question-info">
                <span class="question-type-badge">${getTypeLabel(q.question_type)}</span>
                <span class="question-text">${escapeHtml(q.question_text)}</span>
                ${q.is_required ? '<span class="required-badge">必須</span>' : ''}
            </div>
            <div class="question-actions">
                <button class="btn btn-sm btn-secondary" onclick="editQuestion(${q.id})">
                    編集
                </button>
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
        'rating': '5段階評価',
        'image': '画像'
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

// ========== 質問順序変更 ==========

// 質問を上に移動
async function moveQuestionUp(id) {
    const index = questions.findIndex(q => q.id === id);
    if (index <= 0) return;

    const currentQuestion = questions[index];
    const prevQuestion = questions[index - 1];

    try {
        // sort_orderを入れ替え
        const currentOrder = currentQuestion.sort_order;
        const prevOrder = prevQuestion.sort_order;

        await Promise.all([
            supabaseClient.from('questions').update({ sort_order: prevOrder }).eq('id', currentQuestion.id),
            supabaseClient.from('questions').update({ sort_order: currentOrder }).eq('id', prevQuestion.id)
        ]);

        // ローカル配列を更新
        currentQuestion.sort_order = prevOrder;
        prevQuestion.sort_order = currentOrder;
        questions.sort((a, b) => a.sort_order - b.sort_order);

        renderQuestionsList();
    } catch (error) {
        console.error('順序変更エラー:', error);
        alert('順序の変更に失敗しました。');
    }
}

// 質問を下に移動
async function moveQuestionDown(id) {
    const index = questions.findIndex(q => q.id === id);
    if (index < 0 || index >= questions.length - 1) return;

    const currentQuestion = questions[index];
    const nextQuestion = questions[index + 1];

    try {
        // sort_orderを入れ替え
        const currentOrder = currentQuestion.sort_order;
        const nextOrder = nextQuestion.sort_order;

        await Promise.all([
            supabaseClient.from('questions').update({ sort_order: nextOrder }).eq('id', currentQuestion.id),
            supabaseClient.from('questions').update({ sort_order: currentOrder }).eq('id', nextQuestion.id)
        ]);

        // ローカル配列を更新
        currentQuestion.sort_order = nextOrder;
        nextQuestion.sort_order = currentOrder;
        questions.sort((a, b) => a.sort_order - b.sort_order);

        renderQuestionsList();
    } catch (error) {
        console.error('順序変更エラー:', error);
        alert('順序の変更に失敗しました。');
    }
}

// ========== 質問編集 ==========

// 編集モーダルを表示
function editQuestion(id) {
    const question = questions.find(q => q.id === id);
    if (!question) return;

    // フォームに値をセット
    document.getElementById('edit-question-id').value = question.id;
    document.getElementById('edit-question-text').value = question.question_text;
    document.getElementById('edit-question-type').value = question.question_type;
    document.getElementById('edit-question-required').checked = question.is_required;

    // 選択肢をセット
    if (question.options && question.options.length > 0) {
        document.getElementById('edit-question-options').value = question.options.join('\n');
    } else {
        document.getElementById('edit-question-options').value = '';
    }

    // 選択肢入力欄の表示/非表示
    toggleEditOptionsInput();

    // モーダルを表示
    document.getElementById('edit-question-modal').style.display = 'flex';
}

// 編集モーダルを非表示
function hideEditQuestionModal() {
    document.getElementById('edit-question-modal').style.display = 'none';
}

// 編集モーダルの選択肢入力切り替え
function toggleEditOptionsInput() {
    const type = document.getElementById('edit-question-type').value;
    const optionsGroup = document.getElementById('edit-options-group');
    optionsGroup.style.display = (type === 'single' || type === 'multiple') ? 'block' : 'none';
}

// 編集フォーム送信処理
document.addEventListener('DOMContentLoaded', () => {
    // 質問編集フォーム
    const editQuestionForm = document.getElementById('edit-question-form');
    if (editQuestionForm) {
        editQuestionForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveQuestionEdit();
        });
    }

    // イベント編集フォーム
    const editEventForm = document.getElementById('edit-event-form');
    if (editEventForm) {
        editEventForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveEventEdit();
        });
    }
});

// 質問編集を保存
async function saveQuestionEdit() {
    const id = parseInt(document.getElementById('edit-question-id').value);
    const text = document.getElementById('edit-question-text').value.trim();
    const type = document.getElementById('edit-question-type').value;
    const optionsText = document.getElementById('edit-question-options').value;
    const isRequired = document.getElementById('edit-question-required').checked;

    if (!text) {
        alert('質問文を入力してください。');
        return;
    }

    let options = null;
    if (type === 'single' || type === 'multiple') {
        options = optionsText.split('\n').map(o => o.trim()).filter(o => o);
        if (options.length < 2) {
            alert('選択肢は2つ以上入力してください。');
            return;
        }
    }

    try {
        const { error } = await supabaseClient
            .from('questions')
            .update({
                question_text: text,
                question_type: type,
                options: options,
                is_required: isRequired
            })
            .eq('id', id);

        if (error) throw error;

        // ローカル配列を更新
        const question = questions.find(q => q.id === id);
        if (question) {
            question.question_text = text;
            question.question_type = type;
            question.options = options;
            question.is_required = isRequired;
        }

        renderQuestionsList();
        renderResults();
        hideEditQuestionModal();
        alert('質問を更新しました。');
    } catch (error) {
        console.error('更新エラー:', error);
        alert('質問の更新に失敗しました。');
    }
}

// ========== プレゼンモード ==========

// admin_state を読み込み
async function loadAdminState() {
    if (!selectedEventId) return;

    try {
        const { data, error } = await supabaseClient
            .from('admin_state')
            .select('*')
            .eq('event_id', selectedEventId)
            .single();

        if (error && error.code !== 'PGRST116') {
            // PGRST116 = not found (初回アクセス時)
            throw error;
        }

        if (data) {
            isPresenting = data.is_presenting;
            // current_question_id から currentResultIndex を復元
            if (data.current_question_id) {
                const activeQuestions = questions.filter(q => q.is_active);
                const index = activeQuestions.findIndex(q => q.id === data.current_question_id);
                if (index >= 0) {
                    currentResultIndex = index;
                }
            }
        } else {
            isPresenting = false;
        }

        updatePresentModeUI();
        renderResults();
    } catch (error) {
        console.error('admin_state読み込みエラー:', error);
        isPresenting = false;
        updatePresentModeUI();
    }
}

// プレゼンモード切り替え
async function togglePresentMode() {
    if (!selectedEventId) {
        alert('イベントを選択してください。');
        return;
    }

    const activeQuestions = questions.filter(q => q.is_active);
    if (activeQuestions.length === 0) {
        alert('表示する質問がありません。');
        return;
    }

    isPresenting = !isPresenting;
    updatePresentModeUI();
    await syncAdminState();
}

// admin_state をDBに同期
async function syncAdminState() {
    if (!selectedEventId) return;

    const activeQuestions = questions.filter(q => q.is_active);
    const currentQuestionId = activeQuestions[currentResultIndex]?.id || null;

    try {
        // maybeSingle()を使用：レコードがない場合はnullを返す（エラーにならない）
        const { data: existing, error: selectError } = await supabaseClient
            .from('admin_state')
            .select('id')
            .eq('event_id', selectedEventId)
            .maybeSingle();

        if (selectError) {
            console.error('admin_state検索エラー:', selectError);
            return;
        }

        if (existing) {
            // 更新
            const { error: updateError } = await supabaseClient
                .from('admin_state')
                .update({
                    current_question_id: currentQuestionId,
                    is_presenting: isPresenting,
                    updated_at: new Date().toISOString()
                })
                .eq('event_id', selectedEventId);

            if (updateError) {
                console.error('admin_state更新エラー:', updateError);
            }
        } else {
            // 挿入
            const { error: insertError } = await supabaseClient
                .from('admin_state')
                .insert([{
                    event_id: selectedEventId,
                    current_question_id: currentQuestionId,
                    is_presenting: isPresenting,
                    updated_at: new Date().toISOString()
                }]);

            if (insertError) {
                console.error('admin_state挿入エラー:', insertError);
            }
        }
    } catch (error) {
        console.error('admin_state同期エラー:', error);
    }
}

// プレゼンモードUI更新
function updatePresentModeUI() {
    const btn = document.getElementById('present-mode-btn');
    const status = document.getElementById('present-status');
    const statusText = document.getElementById('present-status-text');
    const sidebarBtn = document.getElementById('sidebar-present-btn');

    if (btn && status && statusText) {
        if (isPresenting) {
            btn.textContent = 'プレゼンモード終了';
            btn.classList.add('btn-presenting');
            status.classList.add('active');
            statusText.textContent = '配信中';
        } else {
            btn.textContent = 'プレゼンモード開始';
            btn.classList.remove('btn-presenting');
            status.classList.remove('active');
            statusText.textContent = '停止中';
        }
    }

    // サイドバーのプレゼンボタンも更新
    if (sidebarBtn) {
        if (isPresenting) {
            sidebarBtn.textContent = 'プレゼン終了';
            sidebarBtn.classList.add('active');
        } else {
            sidebarBtn.textContent = 'プレゼン開始';
            sidebarBtn.classList.remove('active');
        }
    }
}

// ページ離脱時のクリーンアップ
window.addEventListener('beforeunload', async () => {
    // プレゼンモード中ならページ離脱時に終了
    if (isPresenting && selectedEventId) {
        isPresenting = false;
        await syncAdminState();
    }
    stopRealtimeSubscription();
});
