import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  THESIS_INTRO_NOTE,
  THESIS_SECTIONS,
  thesisAsMarkdown,
  thesisAsPlainText,
} from "@/lib/thesis/two-strategies";

export function ThesisPanel() {
  const [openId, setOpenId] = useState<string | null>(THESIS_SECTIONS[0]?.id ?? null);

  async function copy(text: string, ok: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(ok);
    } catch {
      toast.error("Clipboard is blocked in this preview. Use the download instead.");
    }
  }

  function download(filename: string, contents: string, type: string) {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Paste-ready Chapter 3 insert</CardTitle>
          <CardDescription>{THESIS_INTRO_NOTE}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            This is academic text, not dashboard copy. Paste it into the methodology chapter so the
            thesis and the running system describe the same two strategies.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => copy(thesisAsPlainText(), "Copied the full Chapter 3 insert.")}>
              Copy all text
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                download(
                  "Chapter_3_Two_Strategies.md",
                  thesisAsMarkdown(),
                  "text/markdown;charset=utf-8",
                )
              }
            >
              Download Markdown
            </Button>
            <Button variant="outline" asChild>
              <a href="/thesis/Chapter_3_Two_Strategies.docx" download>
                Download Word
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {THESIS_SECTIONS.map((section) => {
        const open = openId === section.id;
        return (
          <Card key={section.id}>
            <CardHeader>
              <button
                type="button"
                className="flex w-full items-start justify-between gap-3 text-left"
                onClick={() => setOpenId(open ? null : section.id)}
              >
                <div>
                  <p className="font-mono text-xs tracking-wide text-muted uppercase">
                    {section.placement}
                  </p>
                  <CardTitle className="mt-1">{section.heading}</CardTitle>
                </div>
                <span className="mt-1 text-sm text-muted">{open ? "Hide" : "Show"}</span>
              </button>
            </CardHeader>
            {open && (
              <CardContent className="space-y-3">
                {section.paragraphs.map((p) => (
                  <p key={p.slice(0, 48)} className="text-sm leading-relaxed">
                    {p}
                  </p>
                ))}
                {section.formula && (
                  <p className="rounded-xl bg-surface-2 px-3 py-2 font-mono text-xs">{section.formula}</p>
                )}
                {section.bullets && (
                  <ul className="grid gap-1.5 text-sm text-muted">
                    {section.bullets.map((b) => (
                      <li key={b}>— {b}</li>
                    ))}
                  </ul>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    copy(
                      [section.heading, "", ...section.paragraphs, section.formula, ...(section.bullets ?? []).map((b) => `• ${b}`)]
                        .filter(Boolean)
                        .join("\n\n"),
                      `Copied “${section.heading}.”`,
                    )
                  }
                >
                  Copy this section
                </Button>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
