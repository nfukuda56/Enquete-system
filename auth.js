// 認証管理アプリケーション

// 状態管理
let authMode = 'register'; // 'register', 'login', 'edit'
let verifiedEmail = null;
let verificationCode = null;
let currentUser = null;

// 一時的な認証データ（登録完了前）
let pendingGoogleAccount = null;
let pendingPasskey = null;

// ========== 初期化 ==========

document.addEventListener('DOMContentLoaded', async () => {
    // URLパラメータをチェック（OAuth コールバック対応）
    await handleAuthCallback();

    // 既存のセッションをチェック
    await checkExistingSession();
});

// OAuth コールバック処理
async function handleAuthCallback() {
    // アカウント削除確認のチェック
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    const token = urlParams.get('token');

    if (action === 'delete-account' && token) {
        // URLをクリーンアップ
        window.history.replaceState({}, document.title, window.location.pathname);
        // 削除確認を実行
        await confirmAccountDeletion(token);
        return;
    }

    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = hashParams.get('access_token');

    if (accessToken) {
        // OAuth からのリダイレクト
        try {
            const { data: { user }, error } = await supabaseClient.auth.getUser();
            if (user && !error) {
                currentUser = user;

                // Google OAuth連携情報をDBに保存
                await saveOAuthProviderInfo(user);

                // URLをクリーンアップ
                window.history.replaceState({}, document.title, window.location.pathname);
                showLoginSuccess();
            }
        } catch (error) {
            console.error('OAuth callback error:', error);
        }
    }
}

// OAuth プロバイダー情報をDBに保存
async function saveOAuthProviderInfo(user) {
    if (!user || !user.identities) return;

    for (const identity of user.identities) {
        if (identity.provider === 'google') {
            try {
                const { error } = await supabaseClient
                    .from('user_oauth_providers')
                    .upsert({
                        user_id: user.id,
                        provider: 'google',
                        provider_user_id: identity.id,
                        provider_email: identity.identity_data?.email || user.email
                    }, {
                        onConflict: 'user_id,provider'
                    });

                if (error) {
                    console.error('OAuth provider save error:', error);
                }
            } catch (err) {
                console.error('OAuth provider save error:', err);
            }
        }
    }
}

// 既存セッションのチェック
async function checkExistingSession() {
    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();

        if (session && session.user) {
            currentUser = session.user;
            showLoginSuccess();
        }
    } catch (error) {
        console.error('セッションチェックエラー:', error);
    }
}

// ========== 画面表示制御 ==========

function hideAllAreas() {
    const areas = [
        'email-verification-area',
        'registration-area',
        'login-area',
        'login-success-area',
        'password-reset-area',
        'error-area',
        'loading',
        'delete-email-sent-area',
        'delete-complete-area'
    ];
    areas.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    // モーダルも閉じる
    closeDeleteAccountModal();
}

function showArea(areaId) {
    hideAllAreas();
    const el = document.getElementById(areaId);
    if (el) el.style.display = 'block';
}

function showLoading(message = '処理中...') {
    document.getElementById('loading-text').textContent = message;
    document.getElementById('loading').style.display = 'block';
}

function hideLoading() {
    document.getElementById('loading').style.display = 'none';
}

function showError(message) {
    document.getElementById('error-message').textContent = message;
    showArea('error-area');
}

function hideError() {
    // 前の画面に戻る
    if (authMode === 'register') {
        showArea('email-verification-area');
    } else if (authMode === 'login') {
        showArea('login-area');
    } else {
        showArea('login-success-area');
    }
}

// ========== モード切り替え ==========

function toggleAuthMode(event) {
    event.preventDefault();

    if (authMode === 'register') {
        showLoginMode();
    } else {
        showRegistrationMode();
    }
}

function showLoginMode(event) {
    if (event) event.preventDefault();
    authMode = 'login';
    showArea('login-area');
}

function showRegistrationMode(event) {
    if (event) event.preventDefault();
    authMode = 'register';

    // 新規登録モードのUI更新
    document.getElementById('auth-title').textContent = '新規登録';
    document.getElementById('auth-description').innerHTML =
        '新規登録キーを送付します。<br>メールに記載のキーNoを入力してください。';
    document.getElementById('mode-switch-text').textContent = 'アカウントをお持ちの方は';
    document.getElementById('mode-switch-link').textContent = 'ログイン';

    // フォームリセット
    document.getElementById('email-input').value = '';
    document.getElementById('key-input-area').style.display = 'none';
    document.getElementById('send-key-btn').textContent = 'メール送信';
    document.getElementById('send-key-btn').disabled = false;

    showArea('email-verification-area');
}

function showPasswordReset(event) {
    if (event) event.preventDefault();
    showArea('password-reset-area');
}

function showAuthEdit() {
    authMode = 'edit';

    // 編集モードのUI設定
    document.getElementById('form-title').textContent = '認証方法の編集';
    document.getElementById('submit-btn').textContent = '保存';

    // パスワードセクションを編集モードに
    document.getElementById('password-section').style.display = 'none';
    document.getElementById('password-change-section').style.display = 'block';

    // 現在のメールアドレスを表示
    if (currentUser) {
        document.getElementById('verified-email').textContent = currentUser.email;
        verifiedEmail = currentUser.email;
    }

    // 現在の認証方法を読み込む
    loadCurrentAuthMethods();

    showArea('registration-area');
}

function showLoginSuccess() {
    if (currentUser) {
        document.getElementById('logged-in-email').textContent = currentUser.email;
    }
    showArea('login-success-area');
}

// ========== メール確認フロー ==========

// 6桁の確認コードを生成
function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// 登録キー送信
async function sendVerificationKey() {
    const email = document.getElementById('email-input').value.trim();

    if (!email) {
        alert('メールアドレスを入力してください。');
        return;
    }

    if (!isValidEmail(email)) {
        alert('有効なメールアドレスを入力してください。');
        return;
    }

    const btn = document.getElementById('send-key-btn');
    btn.disabled = true;
    btn.textContent = '送信中...';

    try {
        // 6桁のランダムコードを生成
        verificationCode = generateVerificationCode();
        verifiedEmail = email;

        // Supabase Edge Functionでメール送信
        const { data, error } = await supabaseClient.functions.invoke('send-verification-email', {
            body: {
                email: email,
                code: verificationCode,
                mode: authMode
            }
        });

        if (error) {
            throw error;
        }

        // キー入力エリアを表示
        document.getElementById('key-input-area').style.display = 'block';
        btn.textContent = 'キーを再送信';
        btn.disabled = false;

        alert('登録キーをメールで送信しました。');

    } catch (error) {
        console.error('送信エラー:', error);
        btn.textContent = 'メール送信';
        btn.disabled = false;
        alert('メールの送信に失敗しました。しばらくしてから再度お試しください。');
    }
}

// キー再送信
async function resendVerificationKey() {
    verificationCode = generateVerificationCode();

    const btn = document.getElementById('send-key-btn');
    btn.disabled = true;
    btn.textContent = '送信中...';

    try {
        const { data, error } = await supabaseClient.functions.invoke('send-verification-email', {
            body: {
                email: verifiedEmail,
                code: verificationCode,
                mode: authMode
            }
        });

        if (error) throw error;

        btn.textContent = 'キーを再送信';
        btn.disabled = false;
        alert('新しい登録キーを送信しました。');

    } catch (error) {
        console.error('再送信エラー:', error);
        btn.textContent = 'キーを再送信';
        btn.disabled = false;
        alert('再送信に失敗しました。');
    }
}

// キー確認
function verifyKey() {
    const inputKey = document.getElementById('verification-key').value.trim();

    if (!inputKey) {
        alert('登録キーを入力してください。');
        return;
    }

    // コード一致チェック
    if (inputKey === verificationCode) {
        // 登録フォームを表示
        showRegistrationForm();
    } else {
        alert('登録キーが一致しません。');
    }
}

// 登録フォーム表示
function showRegistrationForm() {
    // タイトル設定
    document.getElementById('form-title').textContent =
        authMode === 'edit' ? '認証方法の編集' : 'アカウント登録';
    document.getElementById('submit-btn').textContent =
        authMode === 'edit' ? '保存' : '登録';

    // メールアドレス表示
    document.getElementById('verified-email').textContent = verifiedEmail;

    // 新規登録モードではパスワード入力を表示
    if (authMode === 'register') {
        document.getElementById('password-section').style.display = 'block';
        document.getElementById('password-change-section').style.display = 'none';
    }

    // 認証方法をリセット
    resetAuthMethods();

    showArea('registration-area');
}

// ========== パスワード認証 ==========

// パスワード表示切り替え
function togglePasswordVisibility(inputId, button) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
        button.textContent = '隠す';
    } else {
        input.type = 'password';
        button.textContent = '表示';
    }
}

// パスワード変更フォーム表示
function showPasswordChangeForm() {
    document.getElementById('password-section').style.display = 'block';
    document.getElementById('password-change-section').style.display = 'none';

    // 入力欄をクリア
    document.getElementById('password-input').value = '';
    document.getElementById('password-confirm').value = '';
}

// ========== Google OAuth ==========

async function linkGoogleAccount() {
    try {
        showLoading('Googleアカウントに接続中...');

        const { data, error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin + window.location.pathname,
                scopes: 'email profile'
            }
        });

        if (error) throw error;

    } catch (error) {
        hideLoading();
        console.error('Google連携エラー:', error);
        alert('Googleアカウントの連携に失敗しました。');
    }
}

async function unlinkGoogleAccount() {
    if (!confirm('Googleアカウントの連携を解除しますか？')) return;

    try {
        showLoading('連携を解除中...');

        const { error } = await supabaseClient
            .from('user_oauth_providers')
            .delete()
            .eq('user_id', currentUser.id)
            .eq('provider', 'google');

        if (error) throw error;

        hideLoading();
        pendingGoogleAccount = null;
        updateGoogleMethodUI(null);
        alert('Googleアカウントの連携を解除しました。');

    } catch (error) {
        hideLoading();
        console.error('Google連携解除エラー:', error);
        alert('連携の解除に失敗しました。');
    }
}

function updateGoogleMethodUI(account) {
    const actionsEl = document.getElementById('google-actions');
    const connectedEl = document.getElementById('google-connected');
    const statusEl = document.getElementById('google-status');

    if (account) {
        actionsEl.style.display = 'none';
        connectedEl.style.display = 'flex';
        document.getElementById('google-account').textContent = account;
        statusEl.textContent = '連携済み';
        statusEl.classList.add('connected');
    } else {
        actionsEl.style.display = 'block';
        connectedEl.style.display = 'none';
        statusEl.textContent = '未連携';
        statusEl.classList.remove('connected');
    }
}

// ========== パスキー認証 ==========

async function registerPasskey() {
    if (!window.PublicKeyCredential) {
        alert('このブラウザはパスキーに対応していません。');
        return;
    }

    try {
        showLoading('パスキーを登録中...');

        const credential = await navigator.credentials.create({
            publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)),
                rp: {
                    name: '伝心くん',
                    id: window.location.hostname
                },
                user: {
                    id: new TextEncoder().encode(verifiedEmail || currentUser?.email || 'user'),
                    name: verifiedEmail || currentUser?.email || 'user',
                    displayName: verifiedEmail || currentUser?.email || 'User'
                },
                pubKeyCredParams: [
                    { type: 'public-key', alg: -7 },
                    { type: 'public-key', alg: -257 }
                ],
                authenticatorSelection: {
                    authenticatorAttachment: 'platform',
                    userVerification: 'required',
                    residentKey: 'preferred'
                },
                timeout: 60000
            }
        });

        if (credential) {
            const deviceName = getDeviceName();

            pendingPasskey = {
                credentialId: arrayBufferToBase64(credential.rawId),
                publicKey: credential.response.getPublicKey ?
                    arrayBufferToBase64(credential.response.getPublicKey()) : null,
                deviceName: deviceName
            };

            hideLoading();
            updatePasskeyMethodUI(deviceName);
            alert('パスキーを登録しました。');
        }

    } catch (error) {
        hideLoading();
        console.error('パスキー登録エラー:', error);

        if (error.name === 'NotAllowedError') {
            alert('パスキーの登録がキャンセルされました。');
        } else if (error.name === 'SecurityError') {
            alert('セキュリティエラー: HTTPSでアクセスしてください。');
        } else {
            alert('パスキーの登録に失敗しました: ' + error.message);
        }
    }
}

async function removePasskey() {
    if (!confirm('パスキーを削除しますか？')) return;

    try {
        if (currentUser) {
            showLoading('パスキーを削除中...');

            const { error } = await supabaseClient
                .from('user_passkeys')
                .delete()
                .eq('user_id', currentUser.id);

            if (error) throw error;
            hideLoading();
        }

        pendingPasskey = null;
        updatePasskeyMethodUI(null);
        alert('パスキーを削除しました。');

    } catch (error) {
        hideLoading();
        console.error('パスキー削除エラー:', error);
        alert('パスキーの削除に失敗しました。');
    }
}

function updatePasskeyMethodUI(deviceName) {
    const actionsEl = document.getElementById('passkey-actions');
    const connectedEl = document.getElementById('passkey-connected');
    const statusEl = document.getElementById('passkey-status');

    if (deviceName) {
        actionsEl.style.display = 'none';
        connectedEl.style.display = 'flex';
        document.getElementById('passkey-device').textContent = deviceName;
        statusEl.textContent = '登録済み';
        statusEl.classList.add('connected');
    } else {
        actionsEl.style.display = 'block';
        connectedEl.style.display = 'none';
        statusEl.textContent = '未登録';
        statusEl.classList.remove('connected');
    }
}

// ========== ログイン ==========

async function loginWithPassword() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        alert('メールアドレスとパスワードを入力してください。');
        return;
    }

    showLoading('ログイン中...');

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        currentUser = data.user;
        hideLoading();
        showLoginSuccess();

    } catch (error) {
        hideLoading();
        console.error('ログインエラー:', error);
        alert('ログインに失敗しました。メールアドレスまたはパスワードが正しくありません。');
    }
}

async function loginWithGoogle() {
    try {
        showLoading('Googleでログイン中...');

        const { data, error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin + window.location.pathname
            }
        });

        if (error) throw error;

    } catch (error) {
        hideLoading();
        console.error('Googleログインエラー:', error);
        alert('Googleでのログインに失敗しました。');
    }
}

async function loginWithPasskey() {
    if (!window.PublicKeyCredential) {
        alert('このブラウザはパスキーに対応していません。');
        return;
    }

    try {
        showLoading('パスキーで認証中...');

        const credential = await navigator.credentials.get({
            publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)),
                rpId: window.location.hostname,
                userVerification: 'required',
                timeout: 60000
            }
        });

        if (credential) {
            hideLoading();
            alert('パスキー認証は現在開発中です。メールアドレスとパスワード、またはGoogleでログインしてください。');
        }

    } catch (error) {
        hideLoading();
        console.error('パスキー認証エラー:', error);

        if (error.name === 'NotAllowedError') {
            alert('パスキー認証がキャンセルされました。');
        } else {
            alert('パスキーでのログインに失敗しました。');
        }
    }
}

// ========== 登録処理 ==========

async function submitRegistration() {
    const password = document.getElementById('password-input').value;
    const passwordConfirm = document.getElementById('password-confirm').value;

    if (authMode === 'register') {
        if (!password) {
            alert('パスワードを入力してください。');
            return;
        }

        if (password.length < 8) {
            alert('パスワードは8文字以上で入力してください。');
            return;
        }

        if (password !== passwordConfirm) {
            alert('パスワードが一致しません。');
            return;
        }
    }

    showLoading(authMode === 'register' ? 'アカウントを作成中...' : '保存中...');

    try {
        if (authMode === 'register') {
            const { data, error } = await supabaseClient.auth.signUp({
                email: verifiedEmail,
                password: password,
                options: {
                    emailRedirectTo: window.location.origin + window.location.pathname
                }
            });

            if (error) throw error;

            currentUser = data.user;

            if (currentUser) {
                await saveAdditionalAuthMethods();
            }

            hideLoading();

            if (data.user && !data.session) {
                alert('確認メールを送信しました。メール内のリンクをクリックして登録を完了してください。');
                showLoginMode();
            } else {
                alert('アカウントを作成しました。');
                showLoginSuccess();
            }

        } else if (authMode === 'edit') {
            if (password && password.length >= 8) {
                const { error } = await supabaseClient.auth.updateUser({
                    password: password
                });

                if (error) throw error;
            }

            await saveAdditionalAuthMethods();

            hideLoading();
            alert('認証方法を更新しました。');
            showLoginSuccess();
        }

    } catch (error) {
        hideLoading();
        console.error('登録エラー:', error);

        if (error.message.includes('already registered') || error.message.includes('already exists')) {
            alert('このメールアドレスは既に登録されています。ログインしてください。');
        } else {
            alert('登録に失敗しました: ' + error.message);
        }
    }
}

async function saveAdditionalAuthMethods() {
    if (!currentUser) return;

    if (pendingPasskey) {
        try {
            await supabaseClient
                .from('user_passkeys')
                .upsert({
                    user_id: currentUser.id,
                    credential_id: pendingPasskey.credentialId,
                    public_key: pendingPasskey.publicKey || '',
                    device_name: pendingPasskey.deviceName
                }, {
                    onConflict: 'user_id'
                });
        } catch (error) {
            console.error('パスキー保存エラー:', error);
        }
    }
}

function cancelRegistration() {
    pendingGoogleAccount = null;
    pendingPasskey = null;

    if (authMode === 'edit') {
        showLoginSuccess();
    } else {
        showRegistrationMode();
    }
}

// ========== パスワードリセット ==========

async function sendPasswordResetEmail() {
    const email = document.getElementById('reset-email').value.trim();

    if (!email) {
        alert('メールアドレスを入力してください。');
        return;
    }

    showLoading('リセットメールを送信中...');

    try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + window.location.pathname + '?mode=reset'
        });

        if (error) throw error;

        hideLoading();
        alert('パスワードリセット用のメールを送信しました。');
        showLoginMode();

    } catch (error) {
        hideLoading();
        console.error('リセットメール送信エラー:', error);
        alert('リセットメールの送信に失敗しました。');
    }
}

// ========== ログアウト ==========

async function logout() {
    try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;

        currentUser = null;
        showLoginMode();

    } catch (error) {
        console.error('ログアウトエラー:', error);
        alert('ログアウトに失敗しました。');
    }
}

// ========== 管理画面への遷移 ==========

function goToAdmin() {
    window.location.href = 'admin.html';
}

// ========== 現在の認証方法読み込み ==========

async function loadCurrentAuthMethods() {
    if (!currentUser) return;

    try {
        // まずDBから確認
        const { data: oauth } = await supabaseClient
            .from('user_oauth_providers')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('provider', 'google')
            .maybeSingle();

        if (oauth) {
            updateGoogleMethodUI(oauth.provider_email);
        } else {
            // DBになければ、user.identitiesから確認
            const googleIdentity = currentUser.identities?.find(i => i.provider === 'google');
            if (googleIdentity) {
                const email = googleIdentity.identity_data?.email || currentUser.email;
                updateGoogleMethodUI(email);
                // DBにも保存
                await saveOAuthProviderInfo(currentUser);
            }
        }

        const { data: passkey } = await supabaseClient
            .from('user_passkeys')
            .select('*')
            .eq('user_id', currentUser.id)
            .maybeSingle();

        if (passkey) {
            updatePasskeyMethodUI(passkey.device_name);
        }

    } catch (error) {
        console.error('認証方法読み込みエラー:', error);
    }
}

function resetAuthMethods() {
    pendingGoogleAccount = null;
    pendingPasskey = null;
    updateGoogleMethodUI(null);
    updatePasskeyMethodUI(null);
}

// ========== ユーティリティ関数 ==========

function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function getDeviceName() {
    const ua = navigator.userAgent;

    if (/iPhone/.test(ua)) return 'iPhone (Face ID/Touch ID)';
    if (/iPad/.test(ua)) return 'iPad (Face ID/Touch ID)';
    if (/Android/.test(ua)) return 'Android デバイス';
    if (/Mac/.test(ua)) return 'Mac (Touch ID)';
    if (/Windows/.test(ua)) return 'Windows PC';

    return 'デバイス';
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

// ========== アカウント削除 ==========

// 削除確認モーダルを開く
function openDeleteAccountModal() {
    const modal = document.getElementById('delete-account-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

// 削除確認モーダルを閉じる
function closeDeleteAccountModal() {
    const modal = document.getElementById('delete-account-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 削除確認メール送信リクエスト
async function requestAccountDeletion() {
    const btn = document.getElementById('send-delete-email-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '送信中...';
    }

    try {
        const { data, error } = await supabaseClient.functions.invoke('request-account-deletion');

        if (error) {
            throw error;
        }

        // 成功時：メール送信完了画面を表示
        closeDeleteAccountModal();
        document.getElementById('delete-email-address').textContent = currentUser?.email || '';
        showArea('delete-email-sent-area');

    } catch (error) {
        console.error('削除リクエストエラー:', error);
        alert('確認メールの送信に失敗しました。しばらくしてから再度お試しください。');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '確認メールを送信';
        }
    }
}

// アカウント削除の実行（メールリンクから呼ばれる）
async function confirmAccountDeletion(token) {
    showLoading('アカウントを削除中...');

    try {
        const { data, error } = await supabaseClient.functions.invoke('confirm-account-deletion', {
            body: { token: token }
        });

        if (error) {
            throw error;
        }

        // ローカルセッションをクリア
        await supabaseClient.auth.signOut();
        currentUser = null;

        hideLoading();

        // 削除完了画面を表示
        showArea('delete-complete-area');

    } catch (error) {
        hideLoading();
        console.error('アカウント削除エラー:', error);

        if (error.message?.includes('無効') || error.message?.includes('期限切れ')) {
            alert('削除リンクが無効または期限切れです。再度お試しください。');
        } else {
            alert('アカウントの削除に失敗しました: ' + (error.message || '不明なエラー'));
        }

        // ログイン画面に戻る
        showLoginMode();
    }
}
