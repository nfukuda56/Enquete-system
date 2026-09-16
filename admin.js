// 管理者用アプリケーション

// URLトークン生成（crypto.getRandomValues使用、NanoID互換12文字）
function generatePublicToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    const array = new Uint8Array(12);
    crypto.getRandomValues(array);
    return Array.from(array, b => chars[b % chars.length]).join('');
}

// 現在のユーザー情報
let currentUser = null;
let userProfile = null;

// 認証チェック関数
async function checkAuth() {
    const { data: { session }, error } = await supabaseClient.auth.getSession();

    if (!session || !session.user) {
        window.location.href = 'auth.html';
        return false;
    }

    currentUser = session.user;

    // ユーザープロファイルを取得（エラー時はスキップして続行）
    try {
        const { data: profile, error: profileError } = await supabaseClient
            .from('user_profiles')
            .select('*')
            .eq('user_id', currentUser.id)
            .single();

        if (profileError || !profile) {
            // プロファイルがない場合は作成を試みる
            const { data: newProfile, error: insertError } = await supabaseClient
                .from('user_profiles')
                .insert([{ user_id: currentUser.id, role: 'event_admin' }])
                .select()
                .single();

            if (insertError) {
                console.warn('プロファイル作成スキップ:', insertError.message);
                userProfile = { role: 'event_admin' };
            } else {
                userProfile = newProfile;
            }
        } else {
            userProfile = profile;
        }
    } catch (e) {
        console.warn('プロファイル取得スキップ:', e.message);
        userProfile = { role: 'event_admin' };
    }

    return true;
}

// システムオーナー判定
function isSystemOwner() {
    return userProfile?.role === 'system_owner';
}

// ロール表示名取得
function getRoleDisplayName() {
    if (userProfile?.role === 'system_owner') {
        return 'システムオーナー';
    }
    return 'イベント管理者';
}

// イベント編集権限チェック
function canEditEvent(event) {
    if (!event || !currentUser) return false;
    if (isSystemOwner()) return true;
    return event.owner_id === currentUser.id;
}

// イベント削除権限チェック
function canDeleteEvent(event) {
    return canEditEvent(event);
}

// ユーザー情報表示
function updateUserInfo() {
    const userInfoEl = document.getElementById('user-info');
    if (userInfoEl && currentUser) {
        userInfoEl.textContent = currentUser.email;
    }

    // ロールバッジを更新
    const roleBadgeEl = document.getElementById('role-badge');
    if (roleBadgeEl && userProfile) {
        roleBadgeEl.textContent = getRoleDisplayName();
        roleBadgeEl.className = 'role-badge ' +
            (userProfile.role === 'system_owner' ? 'system-owner' : 'event-admin');
    }
}

// ログアウト関数
async function logout() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
        alert('ログアウトに失敗しました');
        return;
    }
    currentUser = null;
    window.location.href = 'auth.html';
}

// アカウントページへ遷移
function openAccountPage() {
    window.location.href = 'auth.html';
}

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
    // 認証チェック（未ログインならリダイレクト）
    const isAuthenticated = await checkAuth();
    if (!isAuthenticated) return;

    // ユーザー情報をUIに反映
    updateUserInfo();

    // 既存の初期化処理
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

    const displayToolbar = document.getElementById('display-control-toolbar');

    if (selectedEventId && currentEvent) {
        nameEl.textContent = currentEvent.name;
        if (currentEvent.event_date) {
            dateEl.textContent = new Date(currentEvent.event_date).toLocaleDateString('ja-JP');
        } else {
            dateEl.textContent = '';
        }
        if (displayToolbar) displayToolbar.style.display = 'flex';
        updateDisplayControlUI();
    } else {
        nameEl.textContent = 'イベント管理からイベントを作成、選択してください';
        dateEl.textContent = '';
        if (displayToolbar) displayToolbar.style.display = 'none';
    }
}

// 表示制御UIを更新
function updateDisplayControlUI() {
    const textBtn = document.getElementById('text-display-toggle');
    const imageBtn = document.getElementById('image-display-toggle');
    if (!currentEvent) return;

    if (textBtn) {
        textBtn.textContent = currentEvent.text_display_enabled ? 'ON' : 'OFF';
        textBtn.className = currentEvent.text_display_enabled
            ? 'btn btn-sm toggle-on' : 'btn btn-sm toggle-off';
    }
    if (imageBtn) {
        imageBtn.textContent = currentEvent.image_display_enabled ? 'ON' : 'OFF';
        imageBtn.className = currentEvent.image_display_enabled
            ? 'btn btn-sm toggle-on' : 'btn btn-sm toggle-off';
    }
}

// 管理者ポリシー確認モーダル
let adminPolicyResolve = null;

function showAdminPolicyModal(icon, title, bodyHTML, confirmLabel) {
    document.getElementById('admin-policy-icon').textContent = icon;
    document.getElementById('admin-policy-title').textContent = title;
    document.getElementById('admin-policy-body').innerHTML = bodyHTML;
    document.getElementById('admin-policy-confirm-btn').textContent = confirmLabel || '同意してONにする';
    document.getElementById('admin-policy-modal').classList.add('active');
    return new Promise(resolve => { adminPolicyResolve = resolve; });
}

function closeAdminPolicyModal(result) {
    document.getElementById('admin-policy-modal').classList.remove('active');
    if (adminPolicyResolve) {
        adminPolicyResolve(result);
        adminPolicyResolve = null;
    }
}

// 自由記述の表示切り替え
async function toggleTextDisplay() {
    if (!selectedEventId || !currentEvent) return;
    const newValue = !currentEvent.text_display_enabled;

    if (newValue) {
        const agreed = await showAdminPolicyModal(
            '📝',
            '自由記述の表示をONにします',
            '<ul>' +
            '<li>参加者の自由記述が画面に表示されます</li>' +
            '<li>表示は場の責任を伴います</li>' +
            '<li>荒れた場合はいつでも停止できます</li>' +
            '</ul>',
            '同意してONにする'
        );
        if (!agreed) return;
    }

    const { error } = await supabaseClient
        .from('events').update({ text_display_enabled: newValue }).eq('id', selectedEventId);
    if (error) { alert('設定の変更に失敗しました。'); return; }

    currentEvent.text_display_enabled = newValue;
    const ev = events.find(e => e.id === selectedEventId);
    if (ev) ev.text_display_enabled = newValue;
    updateDisplayControlUI();
    renderResults();
}

// 画像の表示切り替え
async function toggleImageDisplay() {
    if (!selectedEventId || !currentEvent) return;
    const newValue = !currentEvent.image_display_enabled;

    if (newValue) {
        const agreed = await showAdminPolicyModal(
            '🖼️',
            '画像投稿の表示をONにします',
            '<ul>' +
            '<li>参加者の画像投稿が画面に表示されます</li>' +
            '<li>画像には直接的・法的リスクがあります</li>' +
            '<li>不適切な投稿があった場合は即時停止してください</li>' +
            '</ul>',
            '同意してONにする'
        );
        if (!agreed) return;
    }

    const { error } = await supabaseClient
        .from('events').update({ image_display_enabled: newValue }).eq('id', selectedEventId);
    if (error) { alert('設定の変更に失敗しました。'); return; }

    currentEvent.image_display_enabled = newValue;
    const ev = events.find(e => e.id === selectedEventId);
    if (ev) ev.image_display_enabled = newValue;
    updateDisplayControlUI();
    renderResults();
}

// 緊急停止（確認なし即時実行）
async function emergencyStopDisplay() {
    if (!selectedEventId) return;

    const { error } = await supabaseClient
        .from('events')
        .update({ text_display_enabled: false, image_display_enabled: false })
        .eq('id', selectedEventId);
    if (error) { alert('緊急停止に失敗しました。'); return; }

    currentEvent.text_display_enabled = false;
    currentEvent.image_display_enabled = false;
    const ev = events.find(e => e.id === selectedEventId);
    if (ev) { ev.text_display_enabled = false; ev.image_display_enabled = false; }
    updateDisplayControlUI();
    renderResults();
}

// 個別回答をブロック
async function blockResponse(responseId) {
    if (!confirm('この投稿を非表示にしますか？')) return;

    const { error } = await supabaseClient
        .from('responses')
        .update({
            moderation_status: 'blocked',
            moderation_timestamp: new Date().toISOString()
        })
        .eq('id', responseId);

    if (error) { alert('操作に失敗しました。'); return; }

    const response = responses.find(r => r.id === responseId);
    if (response) {
        response.moderation_status = 'blocked';
    }
    renderResults();
}

// モデレーションステータスラベル
function getModerationLabel(status) {
    const labels = { none: '', pending: '審査待ち', approved: '承認', blocked: 'ブロック' };
    return labels[status] || '';
}

// サイドバーQRコードを更新
function updateSidebarQR() {
    const qrContainer = document.getElementById('sidebar-qr');
    if (!qrContainer) return;

    qrContainer.innerHTML = '';

    if (selectedEventId && currentEvent?.public_token) {
        const url = `${BASE_URL}?token=${currentEvent.public_token}`;
        new QRCode(qrContainer, {
            text: url,
            width: 100,
            height: 100,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });
        qrContainer.style.cursor = 'pointer';
        qrContainer.onclick = () => openQRModal(url);
    }
}

// QRコードモーダル表示
function openQRModal(url) {
    const modal = document.getElementById('qr-modal');
    const codeContainer = document.getElementById('qr-modal-code');
    const urlElement = document.getElementById('qr-modal-url');
    codeContainer.innerHTML = '';
    new QRCode(codeContainer, {
        text: url,
        width: 300,
        height: 300,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
    });
    if (urlElement) {
        urlElement.textContent = url;
    }
    modal.classList.add('active');
}

// QRコードモーダル閉じる
function closeQRModal(event) {
    const modal = document.getElementById('qr-modal');
    // モーダルコンテンツ外（オーバーレイ）クリック時のみ閉じる
    if (event.target === modal) {
        modal.classList.remove('active');
    }
}

// ========== イベント関連 ==========

// イベントフォーム設定
function setupEventForms() {
    document.getElementById('add-event-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await addEvent('event-name', 'event-date', 'event-description');
        e.target.reset();
        closeAddEventModal();
    });
}

// 新規イベント作成モーダル
function openAddEventModal() {
    document.getElementById('add-event-modal').style.display = 'flex';
}

function closeAddEventModal() {
    document.getElementById('add-event-modal').style.display = 'none';
}

// イベント読み込み
async function loadEvents() {
    try {
        let query = supabaseClient
            .from('events')
            .select('*')
            .order('created_at', { ascending: false });

        // システムオーナー以外は自分が作成したイベントのみ表示
        if (!isSystemOwner() && currentUser) {
            query = query.eq('owner_id', currentUser.id);
        }

        const { data, error } = await query;

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
    const sorted = [...events].sort((a, b) => {
        if (!a.event_date && !b.event_date) return 0;
        if (!a.event_date) return 1;
        if (!b.event_date) return -1;
        return b.event_date.localeCompare(a.event_date);
    });
    select.innerHTML = '<option value="">-- イベントを選択 --</option>' +
        sorted.map(e => `
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
    const addQuestionModalBtn = document.getElementById('open-add-question-modal-btn');
    if (selectedEventId) {
        qrSection.style.display = 'flex';
        generateQRCode();
        generateMaterialQRCode();
        if (addQuestionModalBtn) addQuestionModalBtn.disabled = false;
        document.getElementById('question-event-notice').style.display = 'none';
    } else {
        qrSection.style.display = 'none';
        if (addQuestionModalBtn) addQuestionModalBtn.disabled = true;
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
    const url = `${BASE_URL}?token=${currentEvent.public_token}`;
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
    const url = `${BASE_URL}?token=${currentEvent.public_token}`;
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
        const publicToken = generatePublicToken();
        const { data, error } = await supabaseClient
            .from('events')
            .insert([{
                name,
                event_date: date,
                description,
                expected_participants: participants ? parseInt(participants) : null,
                material_url: materialUrl,
                owner_id: currentUser.id,  // イベント所有者を設定
                public_token: publicToken
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
    // 権限チェック
    const event = events.find(e => e.id === id);
    if (!canDeleteEvent(event)) {
        alert('このイベントを削除する権限がありません。');
        return;
    }

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

    const sortedEvents = [...events].sort((a, b) => {
        if (!a.event_date && !b.event_date) return 0;
        if (!a.event_date) return 1;
        if (!b.event_date) return -1;
        return b.event_date.localeCompare(a.event_date);
    });

    container.innerHTML = sortedEvents.map(e => {
        const canEdit = canEditEvent(e);
        const canDelete = canDeleteEvent(e);

        return `
        <div class="event-list-item ${e.is_active ? '' : 'event-inactive'}">
            <div class="event-info">
                <span class="event-name">${escapeHtml(e.name)}</span>
                <span class="event-status-badge ${e.is_active ? 'active' : 'inactive'}">${e.is_active ? '公開中' : '非公開'}</span>
                ${e.event_date ? `<span class="event-date">${e.event_date}</span>` : ''}
                ${e.expected_participants ? `<span class="event-participants-badge">参加予定: ${e.expected_participants}名</span>` : ''}
                ${e.material_url ? `<a class="event-material-link" href="${escapeHtml(e.material_url)}" target="_blank" rel="noopener">関連資料</a>` : ''}
                ${e.description ? `<p class="event-description">${escapeHtml(e.description)}</p>` : ''}
            </div>
            <div class="event-actions">
                ${canEdit ? `<button class="btn btn-sm btn-warning" onclick="clearEventResponses(${e.id})">回答クリア</button>` : ''}
                ${canEdit ? `<button class="btn btn-sm ${e.is_active ? 'btn-warning' : 'btn-success'}" onclick="toggleEventActive(${e.id}, ${!e.is_active})">${e.is_active ? '非公開にする' : '公開する'}</button>` : ''}
                ${canEdit ? `<button class="btn btn-sm btn-secondary" onclick="editEvent(${e.id})">編集</button>` : ''}
                ${canDelete ? `<button class="btn btn-sm btn-danger" onclick="deleteEvent(${e.id})">削除</button>` : ''}
            </div>
        </div>
    `}).join('');
}

// イベントごとの回答クリア
// イベント公開/非公開切り替え
async function toggleEventActive(id, isActive) {
    const event = events.find(e => e.id === id);
    if (!canEditEvent(event)) {
        alert('このイベントを変更する権限がありません。');
        return;
    }

    try {
        const { error } = await supabaseClient
            .from('events')
            .update({ is_active: isActive })
            .eq('id', id);

        if (error) throw error;

        event.is_active = isActive;
        renderEventsList();
    } catch (error) {
        console.error('イベント公開状態の更新エラー:', error);
        alert('更新に失敗しました。');
    }
}

async function clearEventResponses(eventId) {
    // 権限チェック
    const event = events.find(e => e.id === eventId);
    if (!canEditEvent(event)) {
        alert('このイベントの回答をクリアする権限がありません。');
        return;
    }

    if (!confirm('このイベントの回答をすべて削除しますか？\nこの操作は取り消せません。')) {
        return;
    }

    try {
        // まずイベントに紐づく質問IDを取得
        const { data: eventQuestions, error: qError } = await supabaseClient
            .from('questions')
            .select('id')
            .eq('event_id', eventId);

        if (qError) throw qError;

        if (!eventQuestions || eventQuestions.length === 0) {
            alert('このイベントには質問がありません。');
            return;
        }

        const questionIds = eventQuestions.map(q => q.id);

        const { error } = await supabaseClient
            .from('responses')
            .delete()
            .in('question_id', questionIds);

        if (error) throw error;

        // 選択中のイベントの場合はローカル配列も更新
        if (eventId === selectedEventId) {
            responses = [];
            renderResults();
            updateTotalCount();
        }

        alert('回答を削除しました。');
    } catch (error) {
        console.error('回答クリアエラー:', error);
        alert('回答の削除に失敗しました。');
    }
}

// ========== イベント編集 ==========

// イベント編集モーダル表示
function editEvent(id) {
    const event = events.find(e => e.id === id);
    if (!event) return;

    // 権限チェック
    if (!canEditEvent(event)) {
        alert('このイベントを編集する権限がありません。');
        return;
    }

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

// 回答一括クリア
async function clearAllResponses() {
    if (!selectedEventId || questions.length === 0) {
        alert('イベントと質問が必要です。');
        return;
    }

    if (!confirm('このイベントのすべての回答を削除しますか？\nこの操作は取り消せません。')) {
        return;
    }

    try {
        const questionIds = questions.map(q => q.id);

        const { error } = await supabaseClient
            .from('responses')
            .delete()
            .in('question_id', questionIds);

        if (error) throw error;

        responses = [];
        renderResults();
        updateTotalCount();
        alert('すべての回答を削除しました。');
    } catch (error) {
        console.error('回答クリアエラー:', error);
        alert('回答の削除に失敗しました。');
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
                    // 重複チェック: 同じIDの回答が既に存在しないか確認
                    const existingIdx = responses.findIndex(r => r.id === payload.new.id);
                    if (existingIdx < 0) {
                        responses.push(payload.new);
                    } else {
                        // 既に存在する場合は更新
                        responses[existingIdx] = payload.new;
                    }
                    renderResults();
                    updateTotalCount();
                    highlightNewResponse();
                }
            }
        )
        .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'responses' },
            (payload) => {
                // moderation_status 変更等をリアルタイム反映
                const idx = responses.findIndex(r => r.id === payload.new.id);
                if (idx >= 0) {
                    responses[idx] = payload.new;
                    renderResults();
                }
            }
        )
        .on('postgres_changes',
            { event: 'DELETE', schema: 'public', table: 'responses' },
            (payload) => {
                // 削除された回答をローカル配列から除去
                const idx = responses.findIndex(r => r.id === payload.old.id);
                if (idx >= 0) {
                    responses.splice(idx, 1);
                    renderResults();
                    updateTotalCount();
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
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'admin_state' },
            async (payload) => {
                // 外部からの admin_state 変更（trigger.html等）を検知して同期
                if (payload.new?.event_id === selectedEventId) {
                    await loadAdminState();
                }
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

    if (!selectedEventId) {
        container.innerHTML = '<p class="no-data">イベント管理からイベントを作成、選択してください。</p>';
        loading.style.display = 'none';
        container.style.display = 'block';
        updateModerationStatsToolbar(null, []);
        return;
    }

    const activeQuestions = questions.filter(q => q.is_active);

    if (activeQuestions.length === 0) {
        container.innerHTML = '<p class="no-data">まだ質問が登録されていません。</p>';
        loading.style.display = 'none';
        container.style.display = 'block';
        updateModerationStatsToolbar(null, []);
        return;
    }

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

    // モデレーション統計をヘッダーに反映（自由記述・画像のときのみ表示）
    updateModerationStatsToolbar(question, questionResponses);

    // グラフを描画（text/image以外、かつ回答率30%超過時のみ）
    if (question.question_type !== 'text' && question.question_type !== 'image' && shouldShowChart) {
        renderChart(question);
    }

    // 自由記述カードのドラッグ＆ドロップ並べ替えを有効化し、
    // モデレーション未処理の回答があれば自動で送信する
    if (question.question_type === 'text') {
        initTextResponseDnd(question.id);
        requestModerationForUnprocessed(questionResponses);
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
        contentHTML = generateTextResponses(question, questionResponses);
    } else if (question.question_type === 'image') {
        contentHTML = generateImageGallery(questionResponses);
    } else if (shouldShowChart) {
        // 回答率30%超過: グラフ表示
        if (question.question_type === 'rating') {
            // 棒グラフ: 従来通り縦並び
            contentHTML = `
                <div class="chart-container chart-container-large">
                    <canvas id="chart-${question.id}"></canvas>
                </div>
                ${generateStatsSummary(question, questionResponses)}
            `;
        } else {
            // 円グラフ: 左に円グラフ、右にバーチャート（2:1）
            contentHTML = `
                <div class="chart-layout-horizontal">
                    <div class="chart-container-left">
                        <canvas id="chart-${question.id}"></canvas>
                    </div>
                    <div class="chart-container-right">
                        ${generateStatsSummary(question, questionResponses)}
                    </div>
                </div>
            `;
        }
    } else {
        // 回答率30%以下: メッセージのみ表示（グラフ・統計バー非表示）
        contentHTML = `
            <div class="low-response-notice">
                <p>回答率が30%を超えるとグラフが表示されます</p>
            </div>
        `;
    }

    const prevDisabled = index === 0 ? 'disabled' : '';
    const nextDisabled = index === totalQuestions - 1 ? 'disabled' : '';

    return `
        <div class="result-card result-card-fullscreen">
            <div class="result-toolbar">
                <button class="btn btn-secondary result-nav-btn" onclick="prevResult()" ${prevDisabled}>
                    ← 前の質問
                </button>
                <span class="question-number">Q${index + 1}</span>
                <span class="question-text-large">${escapeHtml(question.question_text)}</span>
                <span class="toolbar-spacer"></span>
                <span class="result-response-count">${responseCount}件の回答</span>
                <button class="btn btn-secondary result-nav-btn" onclick="nextResult()" ${nextDisabled}>
                    次の質問 →
                </button>
            </div>
            <div class="result-content">
                ${contentHTML}
            </div>
        </div>
    `;
}

// モデレーション統計を計算
function calculateModerationStats(questionResponses) {
    const blocked = questionResponses.filter(r => r.moderation_status === 'blocked').length;

    // 全回答のmoderation_categoriesから最高スコアを取得
    let maxScore = 0;
    questionResponses.forEach(r => {
        if (r.moderation_categories && typeof r.moderation_categories === 'object') {
            Object.values(r.moderation_categories).forEach(score => {
                if (typeof score === 'number' && score > maxScore) {
                    maxScore = score;
                }
            });
        }
    });

    return { blocked, maxScore };
}

// モデレーション統計をヘッダーツールバーに反映
// 自由記述・画像の質問を表示中のみ表示し、それ以外では非表示にする
function updateModerationStatsToolbar(question, questionResponses) {
    const el = document.getElementById('moderation-stats');
    if (!el) return;

    const isModeratedType = question
        && (question.question_type === 'text' || question.question_type === 'image');

    if (!isModeratedType) {
        el.style.display = 'none';
        el.textContent = '';
        return;
    }

    const stats = calculateModerationStats(questionResponses);
    const scoreDisplay = stats.maxScore > 0 ? stats.maxScore.toFixed(2) : '-';
    el.textContent = `🚫 ブロック: ${stats.blocked}件 | 最高スコア: ${scoreDisplay}`;
    el.style.display = 'inline-flex';
}

// 自動モデレーション: 既に送信した回答ID（同一セッション内での重複送信を防ぐ）
const moderationRequestedIds = new Set();
// 1回の描画で送信する上限（OpenAI Moderation API のコスト抑制）
const MODERATION_AUTO_LIMIT = 20;

// 未処理の回答をモデレーションに送る（fire-and-forget）
// 完了すると responses の UPDATE が Realtime で届き、再描画で背景色が白に変わる
function requestModerationForUnprocessed(questionResponses) {
    const targets = questionResponses
        .filter(r => isModerationUnprocessed(r) && !moderationRequestedIds.has(r.id))
        .slice(0, MODERATION_AUTO_LIMIT);

    if (targets.length === 0) return;

    console.log(`未処理の回答 ${targets.length} 件をモデレーションに送信します`);

    targets.forEach(r => {
        moderationRequestedIds.add(r.id);
        fetch(`${SUPABASE_URL}/functions/v1/moderate-content`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({ response_id: r.id }),
        })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
            })
            .catch(err => {
                console.warn(`モデレーション要求に失敗しました (id=${r.id}):`, err);
                // 次回の描画で再試行できるように記録を戻す
                moderationRequestedIds.delete(r.id);
            });
    });
}

// テキスト回答の並び順（ブラウザローカルに保存）
function getTextOrderKey(questionId) {
    return `enquete:textOrder:${selectedEventId}:${questionId}`;
}

function loadTextOrder(questionId) {
    try {
        const raw = localStorage.getItem(getTextOrderKey(questionId));
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function saveTextOrder(questionId, ids) {
    try {
        localStorage.setItem(getTextOrderKey(questionId), JSON.stringify(ids));
    } catch (e) {
        console.warn('並び順の保存に失敗しました:', e);
    }
}

// 保存済みの並び順を適用（未知の新着回答は末尾に元の順序で残す）
function applyTextOrder(questionId, items) {
    const order = loadTextOrder(questionId);
    if (order.length === 0) return items;

    const rank = new Map(order.map((id, i) => [String(id), i]));
    const known = [];
    const unknown = [];
    items.forEach(item => {
        if (rank.has(String(item.id))) {
            known.push(item);
        } else {
            unknown.push(item);
        }
    });
    known.sort((a, b) => rank.get(String(a.id)) - rank.get(String(b.id)));
    return known.concat(unknown);
}

// モデレーション未処理かどうか
// DBへ直接投入された回答など、Edge Function を通っていない行は
// moderation_timestamp が null のままになる
function isModerationUnprocessed(response) {
    return !response.moderation_timestamp;
}

// テキスト回答一覧（カード表示）
function generateTextResponses(question, questionResponses) {
    const visible = questionResponses.filter(r => r.moderation_status !== 'blocked');
    if (visible.length === 0) {
        return `<p class="no-responses">まだ回答がありません</p>`;
    }

    const ordered = applyTextOrder(question.id, visible);

    return `
        <div class="text-responses-grid" id="text-responses-grid">
            ${ordered.map(r => `
                <div class="text-response-card ${isModerationUnprocessed(r) ? 'moderation-unprocessed' : ''}"
                     draggable="true" data-response-id="${r.id}">
                    <div class="text-response-content">${escapeHtml(r.answer)}</div>
                    <button class="btn-block-response" onclick="blockResponse(${r.id})">非表示</button>
                </div>
            `).join('')}
        </div>
    `;
}

// 画像ギャラリー表示
function generateImageGallery(questionResponses) {
    const visible = questionResponses.filter(r => r.moderation_status !== 'blocked');
    if (visible.length === 0) {
        return `<p class="no-responses">まだ回答がありません</p>`;
    }

    return `
        <div class="image-gallery">
            ${visible.map(r => `
                <div class="image-tile">
                    <img src="${escapeHtml(r.answer)}"
                         alt="投稿画像"
                         loading="lazy"
                         onclick="openImageModal('${escapeHtml(r.answer)}')">
                    <button class="btn-block-image" onclick="event.stopPropagation();blockResponse(${r.id})">非表示</button>
                </div>
            `).join('')}
        </div>
    `;
}

// テキスト回答カードのドラッグ＆ドロップ並べ替えを有効化
function initTextResponseDnd(questionId) {
    const grid = document.getElementById('text-responses-grid');
    if (!grid) return;

    let dragged = null;

    grid.querySelectorAll('.text-response-card').forEach(card => {
        card.addEventListener('dragstart', (e) => {
            dragged = card;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.dataset.responseId);
        });
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            dragged = null;
            persistTextOrder(questionId);
        });
    });

    grid.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!dragged) return;
        e.dataTransfer.dropEffect = 'move';
        const target = getDragTargetCard(grid, e.clientX, e.clientY);
        if (target === null) {
            grid.appendChild(dragged);
        } else if (target !== dragged) {
            grid.insertBefore(dragged, target);
        }
    });

    grid.addEventListener('drop', (e) => e.preventDefault());
}

// ポインタ位置から「この直前に挿入すべきカード」を求める（null は末尾）
function getDragTargetCard(grid, x, y) {
    const cards = Array.from(grid.querySelectorAll('.text-response-card:not(.dragging)'));
    return cards.find(card => {
        const box = card.getBoundingClientRect();
        // 同じ行にいる場合は、カード中心より左なら手前に挿入
        if (y >= box.top && y <= box.bottom) {
            return x < box.left + box.width / 2;
        }
        // カードの行より上にいる場合は、その手前に挿入
        return y < box.top;
    }) || null;
}

// 現在のDOM順を並び順として保存
function persistTextOrder(questionId) {
    const grid = document.getElementById('text-responses-grid');
    if (!grid) return;
    const ids = Array.from(grid.querySelectorAll('.text-response-card'))
        .map(card => card.dataset.responseId);
    saveTextOrder(questionId, ids);
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
        // ratingタイプ: 1-5の数値をキーとして使用
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
        label: question.question_type === 'rating' ? getRatingLabel(label, question.options) : label,
        count,
        percentage: (count / total) * 100
    }));
}

// 評価ラベル取得（optionsがあればそれを使用）
function getRatingLabel(value, options) {
    const idx = parseInt(value) - 1;
    if (options && options[idx]) {
        return options[idx];
    }
    // デフォルトラベル
    const defaultLabels = { '1': 'とても不満', '2': '不満', '3': '普通', '4': '満足', '5': 'とても満足' };
    return defaultLabels[value] || value;
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
    const isBarChart = question.question_type === 'rating';

    if (isBarChart) {
        // 棒グラフ: 凡例非表示、X軸にラベル表示
        charts[question.id] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: stats.map(s => s.label),
                datasets: [{
                    data: stats.map(s => s.count),
                    backgroundColor: [
                        '#EF4444', '#F59E0B', '#6B7280', '#10B981', '#4F46E5'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false  // 凡例非表示
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            font: { size: 24 }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    }
                }
            }
        });
    } else {
        // 円グラフ: 凡例非表示、データラベル表示
        charts[question.id] = new Chart(ctx, {
            type: 'doughnut',
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
            plugins: [ChartDataLabels],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        enabled: false
                    },
                    datalabels: {
                        color: '#000',
                        font: {
                            weight: 'bold',
                            size: 28
                        },
                        formatter: function(value, context) {
                            const label = context.chart.data.labels[context.dataIndex];
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(0) : 0;
                            if (value === 0) return '';
                            return `${label}\n${percentage}%`;
                        },
                        textAlign: 'center'
                    }
                }
            }
        });
    }
}

// 質問フォーム設定
function setupQuestionForm() {
    const form = document.getElementById('add-question-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await addQuestion();
        closeAddQuestionModal();
    });
}

// 新規質問追加モーダル
function openAddQuestionModal() {
    if (!selectedEventId) {
        alert('先にイベントを選択してください。');
        return;
    }
    document.getElementById('add-question-modal').style.display = 'flex';
}

function closeAddQuestionModal() {
    document.getElementById('add-question-modal').style.display = 'none';
}

// 選択肢入力の表示切り替え
function toggleOptionsInput() {
    const type = document.getElementById('question-type').value;
    const optionsGroup = document.getElementById('options-group');
    const optionsTextarea = document.getElementById('question-options');

    if (type === 'single' || type === 'multiple') {
        optionsGroup.style.display = 'block';
        optionsTextarea.placeholder = 'とても満足\n満足\n普通\n不満\nとても不満';
    } else if (type === 'rating') {
        optionsGroup.style.display = 'block';
        optionsTextarea.placeholder = 'とても不満\n不満\n普通\n満足\nとても満足';
        // デフォルト値をセット（空の場合のみ）
        if (!optionsTextarea.value.trim()) {
            optionsTextarea.value = 'とても不満\n不満\n普通\n満足\nとても満足';
        }
    } else {
        optionsGroup.style.display = 'none';
    }
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
    const duplicateMode = document.querySelector('input[name="duplicate-mode"]:checked').value;

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
    } else if (type === 'rating') {
        options = optionsText.split('\n').map(o => o.trim()).filter(o => o);
        if (options.length !== 5) {
            alert('5段階評価は5つの選択肢を入力してください。');
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
            is_required: false,  // 常にfalse（互換性維持）
            is_active: true,
            sort_order: maxOrder,
            duplicate_mode: duplicateMode
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
                <button class="btn-icon" onclick="moveQuestionDown(${q.id})" ${index === questions.length - 1 ? 'disabled' : ''} title="下へ移動">▼</button>
            </div>
            <span class="question-order">Q${index + 1}</span>
            <div class="question-badges-stack">
                <span class="question-type-badge">${getTypeLabel(q.question_type)}</span>
                <span class="duplicate-mode-badge ${q.duplicate_mode === 'append' ? 'append' : 'overwrite'}">
                    ${q.duplicate_mode === 'append' ? '重複回答可' : '回答更新'}
                </span>
            </div>
            <div class="question-info">
                <span class="question-text">${escapeHtml(q.question_text)}</span>
            </div>
            <div class="question-actions">
                <button class="btn btn-sm btn-warning" onclick="clearQuestionResponses(${q.id})">
                    回答クリア
                </button>
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

// 質問ごとの回答クリア
async function clearQuestionResponses(questionId) {
    if (!confirm('この質問の回答をすべて削除しますか？\nこの操作は取り消せません。')) {
        return;
    }

    try {
        const { error } = await supabaseClient
            .from('responses')
            .delete()
            .eq('question_id', questionId);

        if (error) throw error;

        // ローカル配列も更新
        responses = responses.filter(r => r.question_id !== questionId);
        renderResults();
        updateTotalCount();
        alert('回答を削除しました。');
    } catch (error) {
        console.error('回答クリアエラー:', error);
        alert('回答の削除に失敗しました。');
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

    // 重複送信モードをセット
    if (question.duplicate_mode === 'append') {
        document.getElementById('edit-duplicate-append').checked = true;
    } else {
        document.getElementById('edit-duplicate-overwrite').checked = true;
    }

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

    if (type === 'single' || type === 'multiple' || type === 'rating') {
        optionsGroup.style.display = 'block';
    } else {
        optionsGroup.style.display = 'none';
    }
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
    const duplicateMode = document.querySelector('input[name="edit-duplicate-mode"]:checked').value;

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
    } else if (type === 'rating') {
        options = optionsText.split('\n').map(o => o.trim()).filter(o => o);
        if (options.length !== 5) {
            alert('5段階評価は5つの選択肢を入力してください。');
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
                is_required: false,  // 常にfalse
                duplicate_mode: duplicateMode
            })
            .eq('id', id);

        if (error) throw error;

        // ローカル配列を更新
        const question = questions.find(q => q.id === id);
        if (question) {
            question.question_text = text;
            question.question_type = type;
            question.options = options;
            question.is_required = false;
            question.duplicate_mode = duplicateMode;
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
            .maybeSingle();

        if (error) {
            console.warn('admin_state読み込みエラー:', error);
            // エラーでもデフォルト状態で続行
            isPresenting = false;
            updatePresentModeUI();
            return;
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

    // ハートビート制御
    if (isPresenting) {
        startHeartbeat();
    } else {
        stopHeartbeat();
    }
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
            sidebarBtn.textContent = 'プレゼン中';
            sidebarBtn.classList.add('presenting');
        } else {
            sidebarBtn.textContent = '待機中';
            sidebarBtn.classList.remove('presenting');
        }
    }
}

// ハートビート: プレゼン中は30秒ごとに updated_at を更新
let heartbeatInterval = null;

function startHeartbeat() {
    stopHeartbeat();
    heartbeatInterval = setInterval(async () => {
        if (isPresenting && selectedEventId) {
            await supabaseClient
                .from('admin_state')
                .update({ updated_at: new Date().toISOString() })
                .eq('event_id', selectedEventId);
        }
    }, 30000); // 30秒間隔
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

// ページ離脱時のクリーンアップ（fetch + keepalive で確実に送信）
window.addEventListener('beforeunload', () => {
    stopHeartbeat();
    if (isPresenting && selectedEventId) {
        // fetch + keepalive: ページ閉じても送信が継続される
        fetch(`${SUPABASE_URL}/rest/v1/admin_state?event_id=eq.${selectedEventId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                is_presenting: false,
                current_question_id: null,
                updated_at: new Date().toISOString()
            }),
            keepalive: true
        }).catch(() => {});
    }
    stopRealtimeSubscription();
});
