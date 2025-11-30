'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SpeechRecognitionAlternative = {
  transcript: string;
};

type SpeechRecognitionResultEntry = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: SpeechRecognitionResultEntry[];
};

interface RecognitionEngine {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

type RecognitionFactory = new () => RecognitionEngine;

type SpeechRecognitionGlobal = {
  SpeechRecognition?: RecognitionFactory;
  webkitSpeechRecognition?: RecognitionFactory;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  modeId: string;
};

type ModeCapability = {
  id: string;
  label: string;
  detail: string;
};

type Mode = {
  id: string;
  name: string;
  accent: string;
  description: string;
  systemPrompt: string;
  capabilities: ModeCapability[];
  voice: SpeechSynthesisVoice | null;
};

type Integration = {
  id: string;
  name: string;
  endpoint: string;
  description: string;
  status: "draft" | "ready" | "error";
  notes?: string;
};

const buildId = () => crypto.randomUUID();

const defaultModes: Mode[] = [
  {
    id: "research-navigator",
    name: "Research Navigator",
    accent: "from-emerald-400 to-cyan-500",
    description:
      "Synthesizes live research, MCP knowledge bases, and streaming docs to answer with citations and action items.",
    systemPrompt:
      "You are Research Navigator, an always-on research lieutenant. Maintain accurate citations, cite sources inline when possible, and surface unknowns that need human validation. Ask clarifying questions if scope is ambiguous.",
    capabilities: [
      {
        id: "live-research",
        label: "Live Research",
        detail: "Streams in-progress findings and linkouts.",
      },
      {
        id: "citation-guard",
        label: "Citation Guard",
        detail: "Auto-cites MCP evidence and flags low-confidence claims.",
      },
      {
        id: "huddle-sync",
        label: "Huddle Sync",
        detail: "Summarizes team huddles into MCP knowledge updates.",
      },
    ],
    voice: null,
  },
  {
    id: "creative-director",
    name: "Creative Director",
    accent: "from-fuchsia-400 to-violet-500",
    description:
      "Co-designs visuals, voiceovers, and layout updates in real time with Gemini multimodal responses.",
    systemPrompt:
      "You are Creative Director Mode. Lead with bold creative direction, propose high-impact campaigns, and provide quick mood-board descriptions. Suggest UI rewrites that keep the agentic design cohesive.",
    capabilities: [
      {
        id: "layout-shaper",
        label: "Layout Sculptor",
        detail: "Suggests responsive layout changes and component swaps.",
      },
      {
        id: "palette-propulsion",
        label: "Palette Propulsion",
        detail: "Explores gradients, depth lighting, and glassmorphism.",
      },
      {
        id: "voiceover-lab",
        label: "Voiceover Lab",
        detail: "Drafts scripts and performance notes for speech playback.",
      },
    ],
    voice: null,
  },
  {
    id: "flow-coach",
    name: "Flow Coach",
    accent: "from-amber-400 to-rose-500",
    description:
      "Guides rituals, habits, and operational handoffs with multi-turn planning and gentle accountability.",
    systemPrompt:
      "You are Flow Coach Mode. Coach with empathy, structure action plans, offer check-ins, and adapt cadence per user energy. Sustain agentic tone and suggest automations when a task repeats.",
    capabilities: [
      {
        id: "tempo-scan",
        label: "Tempo Scan",
        detail: "Reads user sentiment and adjusts coaching cadence.",
      },
      {
        id: "ritual-builder",
        label: "Ritual Builder",
        detail: "Designs recurring flows with MCP automations.",
      },
      {
        id: "handoff-protocol",
        label: "Handoff Protocol",
        detail: "Drafts MCP-ready SOPs for delegation.",
      },
    ],
    voice: null,
  },
];

const defaultIntegrations: Integration[] = [
  {
    id: "mcp-research-graph",
    name: "MCP Research Graph",
    endpoint: "https://mcp.example.com/research",
    description:
      "Streams live citations, topic graphs, and evidence snapshots into the Research Navigator mode.",
    status: "ready",
    notes: "Auto-provisions analytic backlinks for each insight.",
  },
  {
    id: "workflow-orchestrator",
    name: "Workflow Orchestrator API",
    endpoint: "https://api.ops.orbit/v1/flows",
    description:
      "Turns Flow Coach playbooks into executable automations and multi-agent rituals.",
    status: "ready",
    notes: "Supports step templating and adaptive triggers.",
  },
];

const synthVoices = () =>
  typeof window !== "undefined" ? window.speechSynthesis.getVoices() : [];

const awesomeGradients: Record<string, string> = {
  ready:
    "bg-[radial-gradient(circle_at_top_left,_var(--tw-gradient-stops))]",
  draft:
    "bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))]",
  error:
    "bg-[radial-gradient(circle_at_bottom_right,_var(--tw-gradient-stops))]",
};

const shortTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

export default function Home() {
  const [modes, setModes] = useState<Mode[]>(defaultModes);
  const [currentModeId, setCurrentModeId] = useState<string>(
    defaultModes[0].id,
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingInput, setPendingInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeechReady, setIsSpeechReady] = useState(false);
  const [integrations, setIntegrations] =
    useState<Integration[]>(defaultIntegrations);
  const [designNotes, setDesignNotes] = useState("");
  const [designOutput, setDesignOutput] = useState<string | null>(null);
  const recognitionRef = useRef<RecognitionEngine | null>(null);
  const recorderAbortRef = useRef<AbortController | null>(null);
  const [designLoading, setDesignLoading] = useState(false);
  const handleSubmitRef = useRef<((payload: string) => void) | null>(null);

  const currentMode = useMemo(
    () => modes.find((mode) => mode.id === currentModeId) ?? modes[0],
    [modes, currentModeId],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const globalWindow = window as unknown as SpeechRecognitionGlobal;
    const SpeechRecognitionImpl =
      globalWindow.SpeechRecognition || globalWindow.webkitSpeechRecognition;
    if (!SpeechRecognitionImpl) return;

    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setIsListening(true);
      setPendingInput("");
    };

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          final += transcript + " ";
        } else {
          interim += transcript;
        }
      }

      setPendingInput((prev) => {
        if (final.trim()) {
          return "";
        }
        return interim || prev;
      });

      if (final.trim()) {
        recognition.stop();
        handleSubmitRef.current?.(final.trim());
      }
    };

    recognition.onerror = () => {
      recognition.stop();
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    setIsSpeechReady(true);

    const synthesis = window.speechSynthesis;
    const handleVoices = () => {
      const available = synthVoices();
      setModes((prev) =>
        prev.map((mode) => ({
          ...mode,
          voice:
            mode.voice ??
            available.find((voice) =>
              voice.name.toLowerCase().includes("female"),
            ) ??
            available[0] ??
            null,
        })),
      );
    };

    if (synthesis) {
      handleVoices();
      const previous = synthesis.onvoiceschanged;
      synthesis.onvoiceschanged = handleVoices;
      return () => {
        recognition.stop();
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null;
        }
        synthesis.onvoiceschanged = previous ?? null;
      };
    }

    return () => {
      recognition.stop();
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
    };
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === "undefined") return;
      const { speechSynthesis } = window;
      if (!speechSynthesis) return;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;
      if (currentMode.voice) {
        utterance.voice = currentMode.voice;
      }
      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
    },
    [currentMode.voice],
  );

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      return;
    }
    recognitionRef.current.start();
  };

  const handleSubmit = useCallback(
    async (contentOverride?: string) => {
      const content = (contentOverride ?? pendingInput).trim();
      if (!content) return;

      const newMessage: Message = {
        id: buildId(),
        role: "user",
        content,
        createdAt: Date.now(),
        modeId: currentModeId,
      };

      setMessages((prev) => [...prev, newMessage]);
      setPendingInput("");
      setIsStreaming(true);

      try {
        if (recorderAbortRef.current) {
          recorderAbortRef.current.abort();
        }
        const controller = new AbortController();
        recorderAbortRef.current = controller;
        const payload = {
          message: content,
          modeId: currentModeId,
          systemPrompt: currentMode.systemPrompt,
          conversation: [...messages, newMessage].map((entry) => ({
            role: entry.role,
            content: entry.content,
          })),
        };

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(
            `Gemini Live request failed: ${response.statusText}`,
          );
        }

        const { reply, plan } = (await response.json()) as {
          reply: string;
          plan?: string;
        };

        const assistantMessage: Message = {
          id: buildId(),
          role: "assistant",
          content: reply,
          createdAt: Date.now(),
          modeId: currentModeId,
        };

        setMessages((prev) => {
          const withAssistant = [...prev, assistantMessage];
          if (plan) {
            return [
              ...withAssistant,
              {
                id: buildId(),
                role: "system",
                content: plan,
                createdAt: Date.now(),
                modeId: currentModeId,
              },
            ];
          }
          return withAssistant;
        });
        speak(reply);
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            id: buildId(),
            role: "system",
            content:
              error instanceof Error
                ? `Gemini live agent error: ${error.message}`
                : "Gemini live agent error: unknown",
            createdAt: Date.now(),
            modeId: currentModeId,
          },
        ]);
      } finally {
        setIsStreaming(false);
      }
    },
    [pendingInput, currentModeId, currentMode.systemPrompt, messages, speak],
  );

  useEffect(() => {
    handleSubmitRef.current = (value: string) => {
      void handleSubmit(value);
    };
  }, [handleSubmit]);

  const handleDesignSynthesis = useCallback(async () => {
    const scratch = designNotes.trim();
    if (!scratch && messages.length === 0) return;
    setDesignLoading(true);
    try {
      const response = await fetch("/api/design", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          modeId: currentModeId,
          notes: scratch,
          transcript: messages.slice(-6).map((entry) => ({
            role: entry.role,
            content: entry.content,
          })),
        }),
      });
      if (!response.ok) {
        throw new Error(`Design call failed: ${response.statusText}`);
      }
      const { proposal } = (await response.json()) as { proposal: string };
      setDesignOutput(proposal);
    } catch (error) {
      setDesignOutput(
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setDesignLoading(false);
    }
  }, [designNotes, messages, currentModeId]);

  const addMode = useCallback(() => {
    const basis = designOutput ?? designNotes;
    const id = buildId();
    const accentSeed = [
      "from-sky-400 to-indigo-500",
      "from-lime-400 to-emerald-500",
      "from-rose-400 to-purple-500",
    ];
    const accent = accentSeed[modes.length % accentSeed.length];
    const summary =
      basis ||
      "Autonomous mode generated without explicit description. Keep prompts concise.";

    const newMode: Mode = {
      id,
      name: `Custom Mode ${modes.length + 1}`,
      accent,
      description: summary.slice(0, 220),
      systemPrompt: `You are ${id}. ${summary}`,
      capabilities: [
        {
          id: `cap-${buildId()}`,
          label: "Adaptive Expansion",
          detail: "Learns from design synthesis and extends agentic scope.",
        },
      ],
      voice: currentMode.voice,
    };

    setModes((prev) => [...prev, newMode]);
    setCurrentModeId(id);
    setDesignOutput(null);
    setDesignNotes("");
  }, [designNotes, designOutput, modes.length, currentMode.voice]);

  const addIntegration = useCallback(() => {
    if (!designNotes.trim()) return;
    const id = buildId();
    const draft: Integration = {
      id,
      name: `Custom Connector ${integrations.length + 1}`,
      endpoint: "https://api.placeholder.dev/endpoint",
      description: designNotes.trim(),
      status: "draft",
      notes:
        "Review this connector spec, map credentials, and upgrade status once validated.",
    };
    setIntegrations((prev) => [draft, ...prev]);
    setDesignNotes("");
  }, [designNotes, integrations.length]);

  const modeMessages = useMemo(
    () => messages.filter((message) => message.modeId === currentModeId),
    [messages, currentModeId],
  );

  return (
    <div className="min-h-screen bg-slate-950 pb-10 font-sans text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-8">
        <header className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.38em] text-slate-400">
                Gemini Live Agentic Mobile
              </p>
              <h1 className="text-4xl font-semibold text-white">
                Agentic Voice Studio
              </h1>
            </div>
            <button
              type="button"
              onClick={handleDesignSynthesis}
              disabled={designLoading}
              className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 shadow-[0_0_25px_rgba(56,189,248,0.4)] transition hover:border-slate-500 hover:text-white"
            >
              {designLoading ? "Synthesizing…" : "Design Autopilot"}
            </button>
          </div>
          <p className="text-sm text-slate-400">
            Multi-modal voice assistant built on Gemini Live. Switch modes,
            sculpt new experiences, and deploy fresh MCP connectors in one tap.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-[280px_1fr] md:items-start">
          <aside className="sticky top-6 flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/60 p-4 shadow-[0_0_35px_rgba(15,23,42,0.6)] backdrop-blur">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Modes</h2>
              <button
                type="button"
                onClick={addMode}
                className="rounded-full bg-sky-500/20 px-3 py-1 text-xs font-semibold text-sky-200 transition hover:bg-sky-500/40"
              >
                Auto-Spawn
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {modes.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setCurrentModeId(mode.id)}
                  className={`group rounded-2xl border px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-sky-400 ${
                    currentModeId === mode.id
                      ? "border-sky-400/80 bg-slate-800/80 shadow-[0_0_25px_rgba(56,189,248,0.3)]"
                      : "border-transparent bg-slate-800/30 hover:border-slate-700 hover:bg-slate-800/50"
                  }`}
                >
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-white">
                    <span
                      className={`h-2 w-2 rounded-full bg-gradient-to-r ${mode.accent}`}
                    />
                    {mode.name}
                  </span>
                  <p className="mt-2 line-clamp-3 text-xs text-slate-400">
                    {mode.description}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {mode.capabilities.slice(0, 2).map((capability) => (
                      <span
                        key={capability.id}
                        className="rounded-full border border-slate-700/60 bg-slate-800/60 px-2 py-1 text-[10px] uppercase tracking-wider text-slate-300"
                      >
                        {capability.label}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                Agentic Design Console
              </p>
              <textarea
                value={designNotes}
                onChange={(event) => setDesignNotes(event.target.value)}
                placeholder="Log new rituals, APIs, or UI tweaks. Design Autopilot will optimize it."
                className="mt-3 h-28 w-full rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
              />
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={addIntegration}
                  className="rounded-full bg-emerald-500/20 px-3 py-1 font-semibold text-emerald-200 hover:bg-emerald-500/40"
                >
                  Launch Connector Draft
                </button>
                <button
                  type="button"
                  onClick={handleDesignSynthesis}
                  className="rounded-full bg-violet-500/20 px-3 py-1 font-semibold text-violet-200 hover:bg-violet-500/40"
                >
                  Improve Layout & Modes
                </button>
              </div>
              {designOutput && (
                <p className="mt-3 text-xs text-slate-300">
                  {designOutput.slice(0, 300)}
                  {designOutput.length > 300 ? "…" : ""}
                </p>
              )}
            </div>
          </aside>
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 shadow-[0_0_35px_rgba(56,189,248,0.15)]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
                      In-session
                    </p>
                    <h2 className="text-2xl font-semibold text-white">
                      {currentMode.name}
                    </h2>
                  </div>
                  <span
                    className={`hidden rounded-full bg-gradient-to-r px-3 py-1 text-xs font-semibold text-slate-900 md:inline-flex ${currentMode.accent}`}
                  >
                    Live
                  </span>
                </div>

                <div className="mt-6 flex flex-col gap-3">
                  {modeMessages.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-800/80 bg-slate-950/40 p-6 text-center text-sm text-slate-400">
                      Start a live brief, or toggle voice capture to drop into a
                      conversation. Gemini Live will surface ritual-ready
                      actions.
                    </div>
                  ) : (
                    modeMessages.map((message) => (
                      <div
                        key={message.id}
                        className={`rounded-2xl border border-slate-800/70 p-4 ${
                          message.role === "assistant"
                            ? "bg-slate-950/50"
                            : message.role === "system"
                              ? "bg-slate-900/50"
                              : "bg-slate-950/80"
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span className="uppercase tracking-[0.35em]">
                            {message.role}
                          </span>
                          <span>{shortTime(message.createdAt)}</span>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-slate-100">
                          {message.content}
                        </p>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-6 rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4">
                  <div className="flex flex-col gap-3">
                    <textarea
                      value={pendingInput}
                      onChange={(event) => setPendingInput(event.target.value)}
                      placeholder="Script a request, stack tasks, or dictate updates…"
                      className="h-28 w-full rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void handleSubmit()}
                        disabled={!pendingInput.trim() || isStreaming}
                        className="inline-flex items-center justify-center rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                      >
                        {isStreaming ? "Streaming…" : "Send"}
                      </button>
                      <button
                        type="button"
                        onClick={toggleListening}
                        disabled={!isSpeechReady}
                        className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition ${
                          isListening
                            ? "bg-rose-500 text-rose-50"
                            : "bg-slate-800 text-slate-200"
                        } disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500`}
                      >
                        {isListening ? "Listening…" : "Live Voice"}
                      </button>
                      <span className="text-xs text-slate-400">
                        {isSpeechReady
                          ? "Speech recognition active."
                          : "Speech recognition unavailable."}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="rounded-3xl border border-slate-800 bg-slate-900/50 p-5 shadow-[0_0_25px_rgba(244,114,182,0.2)]">
                  <h3 className="text-lg font-semibold text-white">
                    Capability Deck
                  </h3>
                  <div className="mt-3 flex flex-col gap-3">
                    {currentMode.capabilities.map((capability) => (
                      <div
                        key={capability.id}
                        className="rounded-2xl border border-slate-800/70 bg-slate-950/50 p-3"
                      >
                        <p className="text-xs uppercase tracking-[0.35em] text-slate-400">
                          {capability.label}
                        </p>
                        <p className="mt-2 text-sm text-slate-200">
                          {capability.detail}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-3xl border border-slate-800 bg-slate-900/50 p-5 shadow-[0_0_25px_rgba(56,189,248,0.2)]">
                  <h3 className="text-lg font-semibold text-white">
                    Integration Hub
                  </h3>
                  <div className="mt-3 flex flex-col gap-3">
                    {integrations.map((integration) => (
                      <div
                        key={integration.id}
                        className={`rounded-2xl border bg-slate-950/40 p-3 text-sm transition ${
                          integration.status === "ready"
                            ? `border-emerald-500/50 ${awesomeGradients.ready} from-emerald-500/20 to-emerald-700/30`
                            : integration.status === "error"
                              ? `border-rose-500/50 ${awesomeGradients.error} from-rose-500/20 to-red-800/30`
                              : `border-violet-500/50 ${awesomeGradients.draft} from-violet-500/20 to-indigo-700/30`
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs uppercase tracking-[0.35em] text-slate-200">
                              {integration.name}
                            </p>
                            <p className="mt-1 text-xs text-slate-300">
                              {integration.endpoint}
                            </p>
                          </div>
                          <span className="rounded-full bg-slate-900/50 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-200">
                            {integration.status}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-slate-100">
                          {integration.description}
                        </p>
                        {integration.notes && (
                          <p className="mt-1 text-xs text-slate-200/80">
                            {integration.notes}
                          </p>
                        )}
                      </div>
                    ))}
                    {integrations.length === 0 && (
                      <p className="text-sm text-slate-400">
                        Launch connectors from the console to draft new MCP or
                        API integrations.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
