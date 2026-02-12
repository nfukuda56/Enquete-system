// moderate-content: OpenAI Moderation API を使用した投稿モデレーション
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
    const { response_id } = await req.json()
    if (!response_id) {
      return new Response(
        JSON.stringify({ error: 'response_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Supabase Service Role クライアント（RLSバイパス）
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 対象レスポンスを取得
    const { data: response, error: fetchError } = await supabaseAdmin
      .from('responses')
      .select('id, answer, question_id')
      .eq('id', response_id)
      .single()

    if (fetchError || !response) {
      return new Response(
        JSON.stringify({ error: 'Response not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 質問タイプを取得
    const { data: question } = await supabaseAdmin
      .from('questions')
      .select('question_type')
      .eq('id', response.question_id)
      .single()

    const questionType = question?.question_type || 'text'

    // OpenAI Moderation API 呼び出し
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      console.error('OPENAI_API_KEY not configured')
      return new Response(
        JSON.stringify({ error: 'Moderation service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // リクエストボディ構築
    let moderationInput: any
    if (questionType === 'image') {
      // 画像: URL を送信
      moderationInput = [
        {
          type: 'image_url',
          image_url: { url: response.answer }
        }
      ]
    } else {
      // テキスト
      moderationInput = [
        {
          type: 'text',
          text: response.answer
        }
      ]
    }

    const moderationRes = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'omni-moderation-latest',
        input: moderationInput,
      }),
    })

    if (!moderationRes.ok) {
      const errText = await moderationRes.text()
      console.error('OpenAI API error:', errText)
      // API エラー時は approved にフォールバック（fail-open）
      await supabaseAdmin
        .from('responses')
        .update({
          moderation_status: 'approved',
          moderation_timestamp: new Date().toISOString(),
        })
        .eq('id', response_id)

      return new Response(
        JSON.stringify({ status: 'approved', reason: 'api_error_fallback' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const moderationData = await moderationRes.json()
    const result = moderationData.results?.[0]

    if (!result) {
      await supabaseAdmin
        .from('responses')
        .update({
          moderation_status: 'approved',
          moderation_timestamp: new Date().toISOString(),
        })
        .eq('id', response_id)

      return new Response(
        JSON.stringify({ status: 'approved', reason: 'no_result' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ブロック判定: violence, hate, sexual のみ自動ブロック
    const categories = result.categories || {}
    const shouldBlock =
      categories.violence ||
      categories.hate ||
      categories.sexual ||
      categories['violence/graphic'] ||
      categories['hate/threatening'] ||
      categories['sexual/minors']

    const newStatus = shouldBlock ? 'blocked' : 'approved'

    // DB 更新
    await supabaseAdmin
      .from('responses')
      .update({
        moderation_status: newStatus,
        moderation_categories: result.categories,
        moderation_timestamp: new Date().toISOString(),
      })
      .eq('id', response_id)

    console.log(`Response ${response_id}: ${newStatus}`, result.categories)

    return new Response(
      JSON.stringify({
        status: newStatus,
        flagged: result.flagged,
        categories: result.categories,
      }),
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
