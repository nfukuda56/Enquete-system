import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    // 認証ヘッダーを取得
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "認証が必要です" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Supabase クライアントを作成
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // JWTトークンを取得してユーザーを検証
    const token = authHeader.replace("Bearer ", "")
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)

    if (userError || !user) {
      console.error("User auth error:", userError)
      return new Response(
        JSON.stringify({ error: "ユーザー情報の取得に失敗しました", details: userError?.message }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 既存のトークンを無効化
    await supabase
      .from("account_deletion_tokens")
      .update({ used: true })
      .eq("user_id", user.id)
      .eq("used", false)

    // 新しい削除確認トークンを生成
    const { data: tokenData, error: tokenError } = await supabase
      .from("account_deletion_tokens")
      .insert({
        user_id: user.id
      })
      .select("token")
      .single()

    if (tokenError) {
      console.error("Token creation error:", tokenError)
      return new Response(
        JSON.stringify({ error: "トークンの生成に失敗しました" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // メール送信
    const resendApiKey = Deno.env.get("RESEND_API_KEY")
    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: "メールサービスが設定されていません" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const fromEmail = Deno.env.get("EMAIL_FROM") || "onboarding@resend.dev"
    const siteUrl = Deno.env.get("SITE_URL") || "https://example.com"
    const confirmUrl = `${siteUrl}/auth.html?action=delete-account&token=${tokenData.token}`

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #4F46E5; text-align: center;">伝心くん</h1>
        <h2 style="color: #DC2626; text-align: center;">アカウント削除の確認</h2>
        <p>以下のリンクをクリックするとアカウントが削除されます。</p>
        <p style="color: #DC2626; font-weight: bold;">この操作は取り消せません。</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${confirmUrl}"
             style="display: inline-block; background-color: #DC2626; color: white;
                    padding: 12px 24px; text-decoration: none; border-radius: 6px;
                    font-weight: bold;">
            アカウントを削除する
          </a>
        </div>
        <p style="font-size: 14px; color: #6B7280;">
          ※ このリンクは30分間有効です。<br>
          ※ 心当たりがない場合は無視してください。
        </p>
      </div>
    `

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [user.email],
        subject: "アカウント削除の確認",
        html: htmlContent,
      }),
    })

    if (!resendRes.ok) {
      const errText = await resendRes.text()
      console.error("Resend API error:", errText)
      return new Response(
        JSON.stringify({ error: "メールの送信に失敗しました" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    return new Response(
      JSON.stringify({ success: true, message: "確認メールを送信しました" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )

  } catch (err) {
    console.error("Unexpected error:", err)
    return new Response(
      JSON.stringify({ error: "内部エラーが発生しました" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
