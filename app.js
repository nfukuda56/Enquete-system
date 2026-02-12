// 参加者用アンケートアプリケーション（プレゼンモード専用）

let questions = [];
let currentQuestion = null;  // 現在表示中の質問
let pendingQuestionId = null;  // 次の質問ID（回答入力中に切り替わった場合）
let eventId = null;
let eventInfo = null;
let realtimeChannel = null;
let hasAnsweredCurrentQuestion = false;  // 現在の質問に回答済みかどうか

// 投稿制御
let policyAgreedAt = null;  // ポリシー同意日時
const RATE_LIMIT_WINDOW_MS = 60 * 1000;  // 60秒
const RATE_LIMIT_MAX = 3;                 // 最大3回/分

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

    // admin_state を読み込んでリアルタイム購読開始
    await loadAdminState();
    startRealtimeSubscription();
});

// ページ可視性変更時に状態をリフレッシュ（スリープ復帰対応）
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && eventId) {
        console.log('ページ復帰: admin_state をリフレッシュ');
        await loadAdminState();
    }
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

        // 関連資料URLが設定されている場合は表示
        if (eventInfo.material_url) {
            const container = document.getElementById('material-link-container');
            const link = document.getElementById('material-link');
            link.href = eventInfo.material_url;
            container.style.display = 'block';
        }

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

        // ローディング非表示（admin_stateで表示を制御）
        document.getElementById('loading').style.display = 'none';
    } catch (error) {
        console.error('質問読み込みエラー:', error);
        showError('質問の読み込みに失敗しました。');
    }
}

// admin_state を読み込み
async function loadAdminState() {
    if (!eventId) return;

    try {
        const { data, error } = await supabaseClient
            .from('admin_state')
            .select('*')
            .eq('event_id', eventId)
            .single();

        if (error && error.code !== 'PGRST116') {
            // PGRST116 = not found
            throw error;
        }

        handleAdminState(data);
    } catch (error) {
        console.error('admin_state読み込みエラー:', error);
        showWaitingScreen();
    }
}

// admin_state の変更を処理
function handleAdminState(state) {
    // プレゼン中でない、または質問IDがない場合は待機画面
    if (!state || !state.is_presenting || !state.current_question_id) {
        currentQuestion = null;
        hasAnsweredCurrentQuestion = false;
        showWaitingScreen();
        return;
    }

    const newQuestionId = state.current_question_id;
    const question = questions.find(q => q.id === newQuestionId);

    if (!question) {
        // 質問が見つからない（削除された可能性）
        showWaitingScreen();
        return;
    }

    // 同じ質問の場合は何もしない
    if (currentQuestion && currentQuestion.id === newQuestionId) {
        return;
    }

    // 回答入力中かどうかチェック
    const hasInput = checkUserInput();

    if (hasInput && currentQuestion) {
        // 入力中 → 次の質問IDを保留
        pendingQuestionId = newQuestionId;
        showPendingNotice();
    } else {
        // 入力なし → 即座に切り替え
        showQuestionById(newQuestionId);
    }
}

// ユーザーが入力中かどうかチェック
function checkUserInput() {
    if (!currentQuestion) return false;

    const inputs = document.querySelectorAll('[name="answer"]');

    if (currentQuestion.question_type === 'multiple') {
        return Array.from(inputs).some(input => input.checked);
    } else if (currentQuestion.question_type === 'text') {
        return inputs[0]?.value.trim() !== '';
    } else if (currentQuestion.question_type === 'image') {
        const fileInput = document.querySelector('[name="answer"]');
        return fileInput?.files?.length > 0;
    } else {
        return Array.from(inputs).some(input => input.checked);
    }
}

// 次の質問待機通知を表示
function showPendingNotice() {
    const notice = document.getElementById('pending-notice');
    if (notice) {
        notice.style.display = 'block';
    }
}

// 次の質問待機通知を非表示
function hidePendingNotice() {
    const notice = document.getElementById('pending-notice');
    if (notice) {
        notice.style.display = 'none';
    }
}

// Realtime購読開始
function startRealtimeSubscription() {
    if (!eventId) return;

    realtimeChannel = supabaseClient
        .channel(`admin-state-${eventId}`)
        .on('postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'admin_state',
                filter: `event_id=eq.${eventId}`
            },
            (payload) => {
                console.log('admin_state変更:', payload);
                handleAdminState(payload.new);
            }
        )
        .subscribe((status) => {
            console.log('Realtime購読ステータス:', status);
        });
}

// Realtime購読停止
function stopRealtimeSubscription() {
    if (realtimeChannel) {
        supabaseClient.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }
}

// 質問をIDで表示
function showQuestionById(questionId) {
    const question = questions.find(q => q.id === questionId);
    if (!question) {
        showWaitingScreen();
        return;
    }

    currentQuestion = question;
    hasAnsweredCurrentQuestion = false;
    pendingQuestionId = null;
    hidePendingNotice();

    // 全エリアを非表示
    hideAllAreas();

    // text/image 質問でポリシー未同意の場合、同意画面を表示
    if ((question.question_type === 'text' || question.question_type === 'image') && !policyAgreedAt) {
        // sessionStorage から復元を試みる
        const stored = sessionStorage.getItem('policy_agreed_at');
        if (stored) {
            policyAgreedAt = stored;
        } else {
            document.getElementById('policy-agreement-area').style.display = 'block';
            return;
        }
    }

    // 質問エリアを表示
    document.getElementById('question-area').style.display = 'block';

    // 質問HTML生成
    const html = generateQuestionHTML(question);
    document.getElementById('current-question').innerHTML = html;

    // ボタンを有効化
    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '回答を送信';
    }
}

// 全エリアを非表示
function hideAllAreas() {
    const areas = ['loading', 'waiting-area', 'question-area', 'answered-area', 'complete', 'no-questions', 'no-event', 'event-not-found', 'error-message', 'policy-agreement-area'];
    areas.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

// ポリシーに同意して質問を表示
function agreeToPolicyAndShow() {
    policyAgreedAt = new Date().toISOString();
    sessionStorage.setItem('policy_agreed_at', policyAgreedAt);
    if (currentQuestion) {
        showQuestionById(currentQuestion.id);
    }
}

// レート制限チェック
async function checkRateLimit() {
    if (!currentQuestion || !eventId) return true;
    const type = currentQuestion.question_type;
    if (type !== 'text' && type !== 'image') return true;

    try {
        const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
        const { data, error } = await supabaseClient
            .from('rate_limits')
            .select('id')
            .eq('session_id', SESSION_ID)
            .eq('event_id', eventId)
            .gte('submitted_at', windowStart);

        if (error) return true; // fail-open
        return (data || []).length < RATE_LIMIT_MAX;
    } catch {
        return true;
    }
}

// レート制限レコードを記録
async function recordRateLimit() {
    if (!currentQuestion || !eventId) return;
    const type = currentQuestion.question_type;
    if (type !== 'text' && type !== 'image') return;

    await supabaseClient.from('rate_limits').insert([{
        session_id: SESSION_ID,
        event_id: eventId,
        question_type: type
    }]).catch(() => {});
}

// 待機画面を表示
function showWaitingScreen() {
    hideAllAreas();
    document.getElementById('waiting-area').style.display = 'block';
}

// 回答送信済み画面を表示
function showAnsweredScreen() {
    hideAllAreas();
    document.getElementById('answered-area').style.display = 'block';
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
        case 'image':
            inputHTML = generateImageUploadHTML(question);
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

// 画像アップロード設定
const IMAGE_CONFIG = {
    maxFileSize: 20 * 1024 * 1024,  // 元ファイルの最大サイズ: 20MB
    maxWidth: 800,
    maxHeight: 800,
    quality: 0.8,
    outputMaxSize: 5 * 1024 * 1024  // 出力最大サイズ: 5MB（Supabase制限）
};

// 画像アップロード
function generateImageUploadHTML(question) {
    return `
        <div class="post-warning image-warning">
            <strong>注意:</strong> 投稿された画像は他の参加者に公開される場合があります。不適切な画像は表示されません。
        </div>
        <div class="image-upload-container">
            <input type="file"
                   name="answer"
                   id="image-input"
                   accept="image/*"
                   onchange="previewImage(this)">
            <label for="image-input" class="image-upload-label">
                <span class="upload-icon">📷</span>
                <span>タップして画像を選択</span>
            </label>
            <div id="image-preview" class="image-preview"></div>
            <div id="image-error" class="image-error"></div>
        </div>
    `;
}

// 画像プレビュー表示
function previewImage(input) {
    const preview = document.getElementById('image-preview');
    const errorDiv = document.getElementById('image-error');
    errorDiv.textContent = '';
    preview.innerHTML = '';

    if (!input.files || !input.files[0]) {
        return;
    }

    const file = input.files[0];

    // ファイルサイズチェック
    if (file.size > IMAGE_CONFIG.maxFileSize) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        errorDiv.textContent = `ファイルサイズが大きすぎます（${sizeMB}MB）。20MB以下の画像を選択してください。`;
        input.value = '';
        return;
    }

    // プレビュー表示
    const objectUrl = URL.createObjectURL(file);
    const img = document.createElement('img');
    img.alt = 'プレビュー';
    img.onload = () => {
        URL.revokeObjectURL(objectUrl);
    };
    img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        errorDiv.textContent = 'この画像形式には対応していません。別の画像を選択してください。';
        input.value = '';
    };
    img.src = objectUrl;
    preview.appendChild(img);
}

// 画像リサイズ
async function resizeImage(file, maxWidth = 800, maxHeight = 800, quality = 0.8) {
    return new Promise((resolve, reject) => {
        if (file.size > IMAGE_CONFIG.maxFileSize) {
            reject(new Error('ファイルサイズが大きすぎます。20MB以下の画像を選択してください。'));
            return;
        }

        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);

            try {
                let width = img.width;
                let height = img.height;

                const maxCanvasSize = 4096;
                if (width > maxCanvasSize || height > maxCanvasSize) {
                    const canvasRatio = Math.min(maxCanvasSize / width, maxCanvasSize / height);
                    width = Math.round(width * canvasRatio);
                    height = Math.round(height * canvasRatio);
                }

                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');

                if (!ctx) {
                    reject(new Error('画像の処理に失敗しました。'));
                    return;
                }

                ctx.drawImage(img, 0, 0, width, height);

                if (canvas.toBlob) {
                    canvas.toBlob((blob) => {
                        if (blob) {
                            if (blob.size > IMAGE_CONFIG.outputMaxSize) {
                                canvas.toBlob((retryBlob) => {
                                    if (retryBlob) {
                                        resolve(retryBlob);
                                    } else {
                                        reject(new Error('画像の圧縮に失敗しました。'));
                                    }
                                }, 'image/jpeg', 0.5);
                            } else {
                                resolve(blob);
                            }
                        } else {
                            reject(new Error('画像の変換に失敗しました。'));
                        }
                    }, 'image/jpeg', quality);
                } else {
                    try {
                        const dataUrl = canvas.toDataURL('image/jpeg', quality);
                        const blob = dataURLtoBlob(dataUrl);
                        resolve(blob);
                    } catch (e) {
                        reject(new Error('お使いのブラウザでは画像処理がサポートされていません。'));
                    }
                }
            } catch (e) {
                reject(new Error('画像の処理中にエラーが発生しました: ' + e.message));
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('画像の読み込みに失敗しました。'));
        };

        img.src = objectUrl;
    });
}

// DataURL を Blob に変換
function dataURLtoBlob(dataUrl) {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
}

// 回答を送信
async function submitAnswer() {
    if (!currentQuestion) {
        alert('質問が表示されていません。');
        return;
    }

    const question = currentQuestion;
    let answer = collectAnswer(question);

    if (answer === null) {
        alert('回答を選択してください。');
        return;
    }

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = '送信中...';

    try {
        // text/image のレート制限チェック
        if (question.question_type === 'text' || question.question_type === 'image') {
            const allowed = await checkRateLimit();
            if (!allowed) {
                alert('投稿が多すぎます。しばらくお待ちください。');
                submitBtn.disabled = false;
                submitBtn.textContent = '回答を送信';
                return;
            }
        }
        // 画像の場合はリサイズしてStorageにアップロード
        if (question.question_type === 'image' && answer instanceof File) {
            submitBtn.textContent = '画像を処理中...';

            let resizedBlob;
            try {
                resizedBlob = await resizeImage(answer, IMAGE_CONFIG.maxWidth, IMAGE_CONFIG.maxHeight, IMAGE_CONFIG.quality);
            } catch (resizeError) {
                throw new Error(resizeError.message || '画像の処理に失敗しました。');
            }

            if (!resizedBlob) {
                throw new Error('画像の処理に失敗しました。');
            }

            const fileName = `${eventId}/${question.id}/${SESSION_ID}.jpg`;

            submitBtn.textContent = 'アップロード中...';

            const { data, error } = await supabaseClient.storage
                .from('survey-images')
                .upload(fileName, resizedBlob, {
                    contentType: 'image/jpeg',
                    upsert: true
                });

            if (error) {
                let errorMsg = '画像のアップロードに失敗しました。';
                if (error.message.includes('Payload too large')) {
                    errorMsg += 'ファイルサイズが大きすぎます。';
                } else if (error.message.includes('network')) {
                    errorMsg += 'ネットワーク接続を確認してください。';
                } else {
                    errorMsg += error.message;
                }
                throw new Error(errorMsg);
            }

            const { data: urlData } = supabaseClient.storage
                .from('survey-images')
                .getPublicUrl(fileName);

            answer = urlData.publicUrl + '?t=' + Date.now();
        }

        // 既存の回答を確認して更新または挿入
        const { data: existing } = await supabaseClient
            .from('responses')
            .select('id')
            .eq('question_id', question.id)
            .eq('session_id', SESSION_ID)
            .single();

        const needsModeration = question.question_type === 'text' || question.question_type === 'image';
        const moderationStatus = needsModeration ? 'pending' : 'none';

        if (existing) {
            const updateData = { answer: answer };
            if (needsModeration) {
                updateData.moderation_status = 'pending';
                updateData.moderation_categories = null;
                updateData.moderation_timestamp = null;
                updateData.policy_agreed_at = policyAgreedAt;
            }
            await supabaseClient
                .from('responses')
                .update(updateData)
                .eq('id', existing.id);
        } else {
            await supabaseClient
                .from('responses')
                .insert([{
                    question_id: question.id,
                    session_id: SESSION_ID,
                    answer: answer,
                    moderation_status: moderationStatus,
                    policy_agreed_at: needsModeration ? policyAgreedAt : null
                }]);
        }

        // レート制限レコード記録
        if (needsModeration) {
            await recordRateLimit();
        }

        hasAnsweredCurrentQuestion = true;

        // 保留中の質問があれば表示、なければ送信済み画面
        if (pendingQuestionId) {
            showQuestionById(pendingQuestionId);
        } else {
            showAnsweredScreen();
        }
    } catch (error) {
        console.error('送信エラー:', error);
        alert('送信に失敗しました。\n' + (error.message || error));
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
    } else if (question.question_type === 'image') {
        const fileInput = document.querySelector('[name="answer"]');
        if (fileInput && fileInput.files && fileInput.files[0]) {
            return fileInput.files[0];
        }
        return null;
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
    hasAnsweredCurrentQuestion = true;

    // 保留中の質問があれば表示、なければ送信済み画面
    if (pendingQuestionId) {
        showQuestionById(pendingQuestionId);
    } else {
        showAnsweredScreen();
    }
}

// 最初から回答（使用しない - プレゼンモードでは管理者が制御）
function restartSurvey() {
    location.reload();
}

// 画面表示ヘルパー
function showComplete() {
    hideAllAreas();
    document.getElementById('complete').style.display = 'block';
}

function showNoQuestions() {
    hideAllAreas();
    document.getElementById('no-questions').style.display = 'block';
}

function showNoEvent() {
    hideAllAreas();
    document.getElementById('no-event').style.display = 'block';
}

function showEventNotFound() {
    hideAllAreas();
    document.getElementById('event-not-found').style.display = 'block';
}

function showError(message) {
    hideAllAreas();
    document.getElementById('error-message').style.display = 'block';
    document.getElementById('error-text').textContent = message;
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
