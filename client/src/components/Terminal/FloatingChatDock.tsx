"use client";

import { FormEvent, useState } from "react";

interface FloatingChatDockProps {
  onSendMessage: (message: string) => Promise<void>;
  sending: boolean;
  disabled?: boolean;
}

export function FloatingChatDock({
  onSendMessage,
  sending,
  disabled = false,
}: FloatingChatDockProps) {
  const [draft, setDraft] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const message = draft.trim();
    if (!message || sending || disabled) return;
    await onSendMessage(message);
    setDraft("");
  }

  const sendDisabled = sending || disabled || !draft.trim();

  return (
    <form
      onSubmit={handleSubmit}
      className="pointer-events-auto glass-chat-dock rounded-full border border-cyan/35 bg-surface/60 backdrop-blur-xl px-2 py-2 transition-all duration-500"
    >
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            disabled ? "Session not accepting messages" : "Continue swarm..."
          }
          className="flex-1 bg-transparent outline-none text-[10px] text-primary placeholder:text-muted px-2"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
          }}
          disabled={disabled || sending}
        />

        <button
          type="submit"
          disabled={sendDisabled}
          aria-label="Send"
          className="w-7 h-7 shrink-0 rounded-full text-[12px] font-bold transition-all disabled:opacity-40"
          style={{
            color: "#051a24",
            background: "linear-gradient(180deg, #a8fbff, #00f5ff)",
            boxShadow: sendDisabled ? "none" : "0 0 10px rgba(0,245,255,0.35)",
          }}
        >
          ↑
        </button>
      </div>
    </form>
  );
}
