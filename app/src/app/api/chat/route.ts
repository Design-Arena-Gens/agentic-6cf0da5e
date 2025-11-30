import { NextResponse } from "next/server";

type ConversationTurn = {
  role: string;
  content: string;
};

type ChatRequest = {
  message?: string;
  modeId?: string;
  systemPrompt?: string;
  conversation?: ConversationTurn[];
};

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
const GEMINI_API_BASE =
  process.env.GEMINI_API_BASE ??
  "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiPart = {
  text?: string;
};

type GeminiContent = {
  parts?: GeminiPart[];
};

type GeminiCandidate = {
  content?: GeminiContent;
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
};

type ParsedGeminiReply = {
  reply?: unknown;
  plan?: unknown;
};

const extractText = (payload: GeminiResponse): string => {
  const [candidate] = payload.candidates ?? [];
  if (!candidate?.content?.parts) {
    return "";
  }
  return candidate.content.parts
    .map((part) => part?.text ?? "")
    .join("");
};

const safeJsonParse = (value: string): ParsedGeminiReply | null => {
  try {
    return JSON.parse(value) as ParsedGeminiReply;
  } catch {
    return null;
  }
};

export async function POST(request: Request) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      {
        error:
          "Missing GEMINI_API_KEY environment variable. Add it to Vercel and local .env to enable live agent calls.",
      },
      { status: 500 },
    );
  }

  const body = (await request.json()) as ChatRequest;
  const { message, conversation = [], systemPrompt, modeId } = body;

  if (!message?.trim()) {
    return NextResponse.json(
      { error: "Message is required." },
      { status: 400 },
    );
  }

  const transcript = conversation
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join("\n");

  const userPrompt = `
You are operating the Gemini Live Agentic console.
Mode ID: ${modeId ?? "unknown"}
System Instructions:
${systemPrompt ?? "Maintain a helpful, agentic tone and expand user ideas."}

Transcript so far:
${transcript}

New live user utterance:
${message}

Respond with strict JSON that matches:
{
  "reply": "string",
  "plan": "optional string describing next agentic actions, formatted in markdown bullet points if present"
}
`.trim();

  const response = await fetch(
    `${GEMINI_API_BASE}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          topP: 0.9,
          topK: 40,
        },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    return NextResponse.json(
      { error: "Gemini API error", detail: error },
      { status: response.status },
    );
  }

  const payload = (await response.json()) as GeminiResponse;
  const rawText = extractText(payload);
  const parsed = safeJsonParse(rawText);

  if (parsed && typeof parsed.reply === "string") {
    return NextResponse.json({
      reply: parsed.reply,
      plan: typeof parsed.plan === "string" ? parsed.plan : undefined,
    });
  }

  return NextResponse.json({
    reply: rawText || "Gemini did not return a message.",
    plan: undefined,
  });
}
