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
    // 既存のセッションをチェック
    await checkExistingSession();
});

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
        'loading'
    ];
    areas.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
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

    showLoading('登録キーを送信中...');

    try {
        // 6桁のランダムコードを生成
        verificationCode = generateVerificationCode();
        verifiedEmail = email;

        // Supabase Edge Functionで送信（または直接メール送信）
        const { error } = await supabaseClient.functions.invoke('send-verification-email', {
            body: {
                email: email,
                code: verificationCode,
                mode: authMode
            }
        });

        if (error) {
            // Edge Functionがない場合のフォールバック
            console.warn('Edge Function未設定。開発モードでコードをコンソールに表示:', verificationCode);
            alert(`開発モード: 登録キーは ${verificationCode} です`);
        }

        hideLoading();

        // キー入力エリアを表示
        document.getElementById('key-input-area').style.display = 'block';
        document.getElementById('send-key-btn').textContent = 'キーを再送信';

        alert('登録キーをメールで送信しました。');

    } catch (error) {
        hideLoading();
        console.error('送信エラー:', error);

        // 開発モード: コンソールにコード表示
        console.log('開発モード - 登録キー:', verificationCode);
        alert(`開発モード: 登録キーは ${verificationCode} です`);

        document.getElementById('key-input-area').style.display = 'block';
    }
}

// キー再送信
async function resendVerificationKey() {
    verificationCode = generateVerificationCode();

    try {
        await supabaseClient.functions.invoke('send-verification-email', {
            body: {
                email: verifiedEmail,
                code: verificationCode,
                mode: authMode
            }
        });
    } catch (error) {
        console.log('開発モード - 新しい登録キー:', verificationCode);
    }

    alert(`開発モード: 新しい登録キーは ${verificationCode} です`);
}

// キー確認
function verifyKey() {
    const inputKey = document.getElementById('verification-key').value.trim();

    if (!inputKey) {
        alert('登録キーを入力してください。');
        return;
    }

    // 先頭N桁の一致チェック（計画では先頭N桁、ここでは全桁一致）
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
                redirectTo: window.location.href,
                scopes: 'email profile'
            }
        });

        if (error) throw error;

        // リダイレクトされるので、戻ってきたときにセッションをチェック

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

        // user_oauth_providers から削除
        const { error } = await supabaseClient
            .from('user_oauth_providers')
            .delete()
            .eq('user_id', currentUser.id)
            .eq('provider', 'google');

        if (error) throw error;

        hideLoading();

        // UI更新
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

        // パスキー登録のチャレンジを取得
        const { data: challenge, error: challengeError } = await supabaseClient
            .functions.invoke('passkey-register-challenge', {
                body: { email: verifiedEmail }
            });

        if (challengeError) {
            // 開発モード: ダミーチャレンジを使用
            console.warn('パスキーチャレンジ取得失敗。開発モードで続行。');
        }

        // WebAuthn登録
        const credential = await navigator.credentials.create({
            publicKey: {
                challenge: challenge?.challenge || new Uint8Array(32),
                rp: {
                    name: 'セミナーアンケート',
                    id: window.location.hostname
                },
                user: {
                    id: new TextEncoder().encode(verifiedEmail),
                    name: verifiedEmail,
                    displayName: verifiedEmail
                },
                pubKeyCredParams: [
                    { type: 'public-key', alg: -7 },  // ES256
                    { type: 'public-key', alg: -257 } // RS256
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
            // デバイス名を取得
            const deviceName = getDeviceName();

            pendingPasskey = {
                credentialId: arrayBufferToBase64(credential.rawId),
                publicKey: arrayBufferToBase64(credential.response.getPublicKey()),
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
        } else {
            alert('パスキーの登録に失敗しました。');
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
                redirectTo: window.location.href
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

        // パスキー認証のチャレンジを取得
        const { data: challenge, error: challengeError } = await supabaseClient
            .functions.invoke('passkey-auth-challenge');

        // WebAuthn認証
        const credential = await navigator.credentials.get({
            publicKey: {
                challenge: challenge?.challenge || new Uint8Array(32),
                rpId: window.location.hostname,
                userVerification: 'required',
                timeout: 60000
            }
        });

        if (credential) {
            // サーバーで検証してセッション発行
            const { data: authResult, error: authError } = await supabaseClient
                .functions.invoke('passkey-verify', {
                    body: {
                        credentialId: arrayBufferToBase64(credential.rawId),
                        authenticatorData: arrayBufferToBase64(credential.response.authenticatorData),
                        clientDataJSON: arrayBufferToBase64(credential.response.clientDataJSON),
                        signature: arrayBufferToBase64(credential.response.signature)
                    }
                });

            if (authError) throw authError;

            // カスタムトークンでセッション確立
            if (authResult?.accessToken) {
                const { data, error } = await supabaseClient.auth.setSession({
                    access_token: authResult.accessToken,
                    refresh_token: authResult.refreshToken
                });

                if (error) throw error;
                currentUser = data.user;
            }

            hideLoading();
            showLoginSuccess();
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

    // 新規登録モードではパスワード必須
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
            // 新規ユーザー作成
            const { data, error } = await supabaseClient.auth.signUp({
                email: verifiedEmail,
                password: password,
                options: {
                    emailRedirectTo: window.location.origin + '/auth.html'
                }
            });

            if (error) throw error;

            currentUser = data.user;

            // 追加の認証方法を保存
            await saveAdditionalAuthMethods();

            hideLoading();

            alert('アカウントを作成しました。');
            showLoginSuccess();

        } else if (authMode === 'edit') {
            // パスワード変更（入力がある場合のみ）
            if (password && password.length >= 8) {
                const { error } = await supabaseClient.auth.updateUser({
                    password: password
                });

                if (error) throw error;
            }

            // 追加の認証方法を保存
            await saveAdditionalAuthMethods();

            hideLoading();

            alert('認証方法を更新しました。');
            showLoginSuccess();
        }

    } catch (error) {
        hideLoading();
        console.error('登録エラー:', error);

        if (error.message.includes('already registered')) {
            alert('このメールアドレスは既に登録されています。');
        } else {
            alert('登録に失敗しました: ' + error.message);
        }
    }
}

async function saveAdditionalAuthMethods() {
    if (!currentUser) return;

    // Google OAuth連携を保存
    if (pendingGoogleAccount) {
        await supabaseClient
            .from('user_oauth_providers')
            .upsert({
                user_id: currentUser.id,
                provider: 'google',
                provider_user_id: pendingGoogleAccount.providerId,
                provider_email: pendingGoogleAccount.email
            }, {
                onConflict: 'user_id,provider'
            });
    }

    // パスキーを保存
    if (pendingPasskey) {
        await supabaseClient
            .from('user_passkeys')
            .upsert({
                user_id: currentUser.id,
                credential_id: pendingPasskey.credentialId,
                public_key: pendingPasskey.publicKey,
                device_name: pendingPasskey.deviceName
            }, {
                onConflict: 'user_id'
            });
    }
}

function cancelRegistration() {
    // 状態をリセット
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
            redirectTo: window.location.origin + '/auth.html?mode=reset'
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
        // Google OAuth連携を確認
        const { data: oauth } = await supabaseClient
            .from('user_oauth_providers')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('provider', 'google')
            .single();

        if (oauth) {
            updateGoogleMethodUI(oauth.provider_email);
        }

        // パスキーを確認
        const { data: passkey } = await supabaseClient
            .from('user_passkeys')
            .select('*')
            .eq('user_id', currentUser.id)
            .single();

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

function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
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
