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

    // プレビュー表示（createObjectURLを使用してメモリ効率を改善）
    const objectUrl = URL.createObjectURL(file);
    const img = document.createElement('img');
    img.alt = 'プレビュー';
    img.onload = () => {
        URL.revokeObjectURL(objectUrl);  // メモリ解放
    };
    img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        errorDiv.textContent = 'この画像形式には対応していません。別の画像を選択してください。';
        input.value = '';
    };
    img.src = objectUrl;
    preview.appendChild(img);
}

// 画像リサイズ（送信前に実行）
async function resizeImage(file, maxWidth = 800, maxHeight = 800, quality = 0.8) {
    return new Promise((resolve, reject) => {
        // ファイルサイズの事前チェック
        if (file.size > IMAGE_CONFIG.maxFileSize) {
            reject(new Error('ファイルサイズが大きすぎます。20MB以下の画像を選択してください。'));
            return;
        }

        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);  // メモリ解放

            try {
                let width = img.width;
                let height = img.height;

                // 画像サイズが大きすぎる場合の警告（Canvasの制限対策）
                const maxCanvasSize = 4096;  // 多くのモバイルブラウザの制限
                if (width > maxCanvasSize || height > maxCanvasSize) {
                    const canvasRatio = Math.min(maxCanvasSize / width, maxCanvasSize / height);
                    width = Math.round(width * canvasRatio);
                    height = Math.round(height * canvasRatio);
                }

                // リサイズ比率計算
                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }

                // Canvas でリサイズ
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');

                if (!ctx) {
                    reject(new Error('画像の処理に失敗しました。別の画像をお試しください。'));
                    return;
                }

                ctx.drawImage(img, 0, 0, width, height);

                // Blob に変換（toBlob対応チェック付き）
                if (canvas.toBlob) {
                    canvas.toBlob((blob) => {
                        if (blob) {
                            // 出力サイズチェック
                            if (blob.size > IMAGE_CONFIG.outputMaxSize) {
                                // 品質を下げて再試行
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
                            reject(new Error('画像の変換に失敗しました。別の画像をお試しください。'));
                        }
                    }, 'image/jpeg', quality);
                } else {
                    // toBlob非対応ブラウザ用フォールバック
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
            reject(new Error('画像の読み込みに失敗しました。対応していない形式の可能性があります。'));
        };

        img.src = objectUrl;
    });
}

// DataURL を Blob に変換（toBlob非対応ブラウザ用）
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
    const question = questions[currentQuestionIndex];
    let answer = collectAnswer(question);

    if (answer === null) {
        alert('回答を選択してください。');
        return;
    }

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = '送信中...';

    try {
        // 画像の場合はリサイズしてStorageにアップロード
        if (question.question_type === 'image' && answer instanceof File) {
            submitBtn.textContent = '画像を処理中...';

            let resizedBlob;
            try {
                // リサイズ処理（最大800x800、JPEG品質80%）
                resizedBlob = await resizeImage(answer, IMAGE_CONFIG.maxWidth, IMAGE_CONFIG.maxHeight, IMAGE_CONFIG.quality);
            } catch (resizeError) {
                throw new Error(resizeError.message || '画像の処理に失敗しました。');
            }

            if (!resizedBlob) {
                throw new Error('画像の処理に失敗しました。別の画像をお試しください。');
            }

            const fileName = `${eventId}/${question.id}/${SESSION_ID}.jpg`;

            submitBtn.textContent = 'アップロード中...';

            // アップロード（upsert: trueで上書き）
            const { data, error } = await supabaseClient.storage
                .from('survey-images')
                .upload(fileName, resizedBlob, {
                    contentType: 'image/jpeg',
                    upsert: true
                });

            if (error) {
                // より詳細なエラーメッセージ
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

            // 公開URLを取得（キャッシュ回避のためタイムスタンプ付与）
            const { data: urlData } = supabaseClient.storage
                .from('survey-images')
                .getPublicUrl(fileName);

            answer = urlData.publicUrl + '?t=' + Date.now();
        }

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
        alert('送信に失敗しました。\n' + (error.message || error));
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
    } else if (question.question_type === 'image') {
        const fileInput = document.querySelector('[name="answer"]');
        if (fileInput && fileInput.files && fileInput.files[0]) {
            return fileInput.files[0]; // Fileオブジェクトを返す
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
