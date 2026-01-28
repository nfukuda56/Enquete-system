// Google Apps Script Web App URL
// google-apps-script/SETUP.md の手順に従ってデプロイし、URLを設定してください
const APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_URL_HERE';

// セッションID（ブラウザごとにユニーク）
function getSessionId() {
    let sessionId = localStorage.getItem('enquete_session_id');
    if (!sessionId) {
        sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('enquete_session_id', sessionId);
    }
    return sessionId;
}

const SESSION_ID = getSessionId();
