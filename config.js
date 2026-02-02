// Supabase 設定
const SUPABASE_URL = 'https://fahqkdfrmgkhdcrocllc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhaHFrZGZybWdraGRjcm9jbGxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1ODA1MzIsImV4cCI6MjA4NTE1NjUzMn0.RwCQODHSg7swB5CdqdlW6x1Wu_aeeHHJ7GiMSBvXFfQ';

// Supabase クライアント初期化
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
