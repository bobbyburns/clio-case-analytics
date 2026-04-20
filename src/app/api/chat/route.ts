import { NextRequest } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"

const SYSTEM_PROMPT = `You are a law firm analytics consultant helping users understand their case data and statistics. You are embedded in the Clio Case Analytics dashboard.

Your role:
- Explain statistical measures (percentiles, standard deviation, distributions, medians, means) in plain, accessible English
- Help interpret patterns in the data (e.g., "why is the median so much lower than the mean?" suggests right-skewed data with some very expensive cases)
- Relate data insights to practical law firm decisions — staffing, pricing, case selection, resource allocation
- Be concise: 2-3 short paragraphs maximum per response
- Never give legal advice. Always frame your answers as data analysis and business insights.
- Reference the specific numbers from the current page context when relevant
- If asked about data not on the current page, explain what page would have that information

Current page context (the data and stats the user is looking at right now):
`

export async function POST(request: NextRequest) {
  // Check auth
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Parse request body
  let body: { message: string; pageContext: string; history?: { role: string; content: string }[] }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const { message, pageContext, history = [] } = body

  if (!message || typeof message !== "string") {
    return new Response(JSON.stringify({ error: "Message is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API key not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  const client = new Anthropic({ apiKey })

  // Build messages array from history + current message
  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: message },
  ]

  // Stream the response
  const stream = await client.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: SYSTEM_PROMPT + pageContext,
    messages,
  })

  // Create a ReadableStream that emits SSE
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const data = JSON.stringify({ text: event.delta.text })
            controller.enqueue(encoder.encode(`data: ${data}\n\n`))
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      } catch (error) {
        const errMsg =
          error instanceof Error ? error.message : "Stream error"
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: errMsg })}\n\n`
          )
        )
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
