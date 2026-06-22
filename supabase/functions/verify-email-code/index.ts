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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const purpose = mode === "edit" ? "edit" : "register"

    // DBで照合（有効期限内・未使用・メール・コード・用途が一致するレコードを検索）
    const { data, error } = await supabase
      .from("email_verification_codes")
      .select("id, expires_at")
      .eq("email", email)
      .eq("code", code)
      .eq("purpose", purpose)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error("DB query error:", error)
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    if (!data) {
      // コード不一致・期限切れ・使用済みのいずれか（理由は区別しない）
      return new Response(
        JSON.stringify({ valid: false, error: "登録キーが一致しないか、期限切れです。" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 使用済みにマーク
    const { error: updateError } = await supabase
      .from("email_verification_codes")
      .update({ used: true })
      .eq("id", data.id)

    if (updateError) {
      console.error("DB update error:", updateError)
      // 更新失敗でも照合は成功しているので通す（二重送信リスクは有効期限で制御）
    }

    return new Response(
      JSON.stringify({ valid: true }),
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
