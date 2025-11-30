import { NextResponse } from "next/server";

type DesignTurn = {
  role: string;
  content: string;
};

type DesignRequest = {
  modeId?: string;
  notes?: string;
  transcript?: DesignTurn[];
};

const MODEL = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
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

const extractText = (payload: GeminiResponse): string => {
  const [candidate] = payload.candidates ?? [];
  if (!candidate?.content?.parts) {
    return "";
  }
  return candidate.content.parts
    .map((part) => part?.text ?? "")
    .join("");
};

export async function POST(request: Request) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      {
        error:
          "Missing GEMINI_API_KEY environment variable. Add it to use the design autopilot.",
      },
      { status: 500 },
    );
  }

  const { modeId, notes, transcript = [] } =
    (await request.json()) as DesignRequest;

  const summary = transcript
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join("\n");

  const autopilotPrompt = `
You are the autonomous design autopilot for a Gemini Live mobile agent.
Assess the current session for mode "${modeId ?? "unspecified"}".

Context transcript:
${summary || "No conversation captured."}

Additional operator notes:
${notes || "No extra notes."}

Output a crisp roadmap covering:
1. UI/interaction adjustments (max 3 bullets)
2. New or upgraded modes, including names and signature behaviors
3. Integration or MCP connector opportunities with validation steps

Return markdown no longer than 220 words. Lean into agentic, actionable language.
`.trim();

  const response = await fetch(
    `${GEMINI_API_BASE}/${encodeURIComponent(MODEL)}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: autopilotPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.6,
          topP: 0.8,
          topK: 32,
        },
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    return NextResponse.json(
      { error: "Gemini design autopilot error", detail },
      { status: response.status },
    );
  }

  const payload = (await response.json()) as GeminiResponse;

  return NextResponse.json({
    proposal: extractText(payload),
  });
}
