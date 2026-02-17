// send-verification-email: Resend API を使用したメール送信
// Supabase Edge Function (Deno)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { email, code, mode } = await req.json()

    if (!email || !code) {
      return new Response(
        JSON.stringify({ error: 'email and code are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Resend API Key
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      console.error('RESEND_API_KEY not configured')
      return new Response(
        JSON.stringify({ error: 'Email service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 送信元メールアドレス（Resendで設定したドメイン）
    const fromEmail = Deno.env.get('EMAIL_FROM') || 'noreply@resend.dev'

    // メール件名と本文
    const isRegister = mode === 'register'
    const subject = isRegister
      ? 'セミナーアンケート - 登録確認コード'
      : 'セミナーアンケート - 認証確認コード'

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Hiragino Sans', 'Noto Sans JP', sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; padding: 20px 0; border-bottom: 2px solid #4F46E5; }
    .header h1 { color: #4F46E5; font-size: 24px; margin: 0; }
    .content { padding: 30px 0; }
    .code-box {
      background: #F3F4F6;
      border-radius: 8px;
      padding: 20px;
      text-align: center;
      margin: 20px 0;
    }
    .code {
      font-size: 32px;
      font-weight: bold;
      letter-spacing: 8px;
      color: #4F46E5;
    }
    .note {
      font-size: 14px;
      color: #6B7280;
      margin-top: 20px;
    }
    .footer {
      text-align: center;
      padding: 20px 0;
      border-top: 1px solid #E5E7EB;
      font-size: 12px;
      color: #9CA3AF;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>セミナーアンケート</h1>
    </div>
    <div class="content">
      <p>${isRegister ? 'アカウント登録' : '認証情報の変更'}のための確認コードです。</p>
      <div class="code-box">
        <div class="code">${code}</div>
      </div>
      <p>このコードを画面に入力してください。</p>
      <p class="note">
        このコードは10分間有効です。<br>
        心当たりがない場合は、このメールを無視してください。
      </p>
    </div>
    <div class="footer">
      <p>セミナーアンケートシステム</p>
    </div>
  </div>
</body>
</html>
`

    const textContent = `
セミナーアンケート - ${isRegister ? '登録' : '認証'}確認コード

${isRegister ? 'アカウント登録' : '認証情報の変更'}のための確認コードです。

確認コード: ${code}

このコードを画面に入力してください。
コードは10分間有効です。

心当たりがない場合は、このメールを無視してください。

---
セミナーアンケートシステム
`

    // Resend API でメール送信
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: subject,
        html: htmlContent,
        text: textContent,
      }),
    })

    if (!resendRes.ok) {
      const errText = await resendRes.text()
      console.error('Resend API error:', errText)
      return new Response(
        JSON.stringify({ error: 'Failed to send email', details: errText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const resendData = await resendRes.json()
    console.log(`Email sent to ${email}, ID: ${resendData.id}`)

    // 確認コードをDBに保存（オプション：後で検証用）
    try {
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )

      await supabaseAdmin
        .from('email_verification_codes')
        .insert({
          email: email,
          code: code,
          purpose: mode || 'register',
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10分後
        })
    } catch (dbError) {
      // DB保存失敗はログのみ（メール送信は成功している）
      console.warn('Failed to save verification code to DB:', dbError)
    }

    return new Response(
      JSON.stringify({ success: true, messageId: resendData.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
