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
    const { email, code, mode } = await req.json()

    if (!email || !code) {
      return new Response(
        JSON.stringify({ error: "email and code are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY")
    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const fromEmail = Deno.env.get("EMAIL_FROM") || "onboarding@resend.dev"
    const isRegister = mode === "register"
    const subject = isRegister ? "登録確認コード" : "認証確認コード"

    const htmlContent = "<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px'>" +
      "<h1 style='color:#4F46E5;text-align:center'>セミナーアンケート</h1>" +
      "<p>" + (isRegister ? "アカウント登録" : "認証情報の変更") + "のための確認コードです。</p>" +
      "<div style='background:#F3F4F6;border-radius:8px;padding:20px;text-align:center;margin:20px 0'>" +
      "<span style='font-size:32px;font-weight:bold;letter-spacing:8px;color:#4F46E5'>" + code + "</span>" +
      "</div>" +
      "<p>このコードを画面に入力してください。</p>" +
      "<p style='font-size:14px;color:#6B7280'>このコードは10分間有効です。</p>" +
      "</div>"

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + resendApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: subject,
        html: htmlContent,
      }),
    })

    if (!resendRes.ok) {
      const errText = await resendRes.text()
      console.error("Resend API error:", errText)
      return new Response(
        JSON.stringify({ error: "Failed to send email" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const resendData = await resendRes.json()
    return new Response(
      JSON.stringify({ success: true, messageId: resendData.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )

  } catch (err) {
    console.error("Unexpected error:", err)
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
