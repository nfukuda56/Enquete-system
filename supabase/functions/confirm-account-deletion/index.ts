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
    const { token } = await req.json()

    if (!token) {
      return new Response(
        JSON.stringify({ error: "トークンが必要です" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Service Role でクライアントを作成（管理者権限）
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // トークンを検証
    const { data: tokenData, error: tokenError } = await supabase
      .from("account_deletion_tokens")
      .select("*")
      .eq("token", token)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .single()

    if (tokenError || !tokenData) {
      return new Response(
        JSON.stringify({ error: "無効または期限切れのトークンです" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const userId = tokenData.user_id

    // ユーザー情報を取得
    const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(userId)

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "ユーザーが見つかりません" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const userEmail = user.email

    // トランザクション的に処理を実行
    // 1. トークンを使用済みにする
    const { error: updateTokenError } = await supabase
      .from("account_deletion_tokens")
      .update({ used: true })
      .eq("id", tokenData.id)

    if (updateTokenError) {
      console.error("Token update error:", updateTokenError)
      return new Response(
        JSON.stringify({ error: "処理中にエラーが発生しました" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 2. user_profiles を更新（email保存、deleted_at設定、user_id をNULLに）
    const { error: profileError } = await supabase
      .from("user_profiles")
      .update({
        email: userEmail,
        deleted_at: new Date().toISOString(),
        user_id: null
      })
      .eq("user_id", userId)

    if (profileError) {
      console.error("Profile update error:", profileError)
      // エラーでも削除は続行（user_profilesがない場合もある）
    }

    // 3. auth.users を物理削除（user_oauth_providers, user_passkeys は CASCADE で自動削除）
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId)

    if (deleteError) {
      console.error("User deletion error:", deleteError)
      return new Response(
        JSON.stringify({ error: "アカウントの削除に失敗しました" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "アカウントが削除されました"
      }),
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
