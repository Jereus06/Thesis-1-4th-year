import { BookOpen, ChevronDown, Download, Search } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseGuide, searchGuide, type GuideBlock, type GuideSection } from "@/lib/user-guide";
import guideSource from "../../docs/USER_GUIDE.md?raw";
import guideDownload from "../../docs/USER_GUIDE.md?url";

const guide = parseGuide(guideSource);
const quickTasks = [
  { id: "getting-started", label: "Start here" },
  { id: "record-a-sale", label: "Record a sale" },
  { id: "record-a-delivery", label: "Record a delivery" },
  { id: "correct-a-stock-count", label: "Correct a stock count" },
  { id: "import-past-sales", label: "Import past sales" },
  { id: "read-and-refresh-forecasts", label: "Read forecasts" },
];

export function UserGuide() {
  const [query, setQuery] = useState("");
  const pendingTopic = useRef<string | null>(null);
  const sections = useMemo(() => searchGuide(guide.sections, query), [query]);
  const searching = query.trim().length > 0;

  useEffect(() => {
    const openHash = () => {
      const id = window.location.hash.slice(1);
      if (!guide.sections.some((section) => section.id === id)) return;
      const target = document.getElementById(id);
      if (target instanceof HTMLDetailsElement) {
        target.open = true;
        target.scrollIntoView();
      }
    };
    openHash();
    window.addEventListener("hashchange", openHash);
    return () => window.removeEventListener("hashchange", openHash);
  }, []);

  useEffect(() => {
    const id = pendingTopic.current;
    if (!id) return;
    pendingTopic.current = null;
    const target = document.getElementById(id);
    if (target instanceof HTMLDetailsElement) {
      target.open = true;
      target.scrollIntoView();
    }
  }, [query]);

  function openTask(id: string) {
    if (query) {
      pendingTopic.current = id;
      setQuery("");
    } else {
      const target = document.getElementById(id);
      if (target instanceof HTMLDetailsElement) target.open = true;
    }
  }

  function expandAll(open: boolean) {
    document.querySelectorAll<HTMLDetailsElement>("#guide-sections details").forEach((item) => {
      item.open = open;
    });
  }

  return (
    <section aria-labelledby="user-guide-title">
      <div className="mb-8 max-w-3xl">
        <p className="mb-3 flex items-center gap-2 text-xs font-medium tracking-wide text-primary uppercase">
          <BookOpen className="size-4" aria-hidden="true" />
          Everyday help for owners and staff
        </p>
        <h2 id="user-guide-title" className="font-display text-3xl font-medium tracking-tight">
          {guide.title}
        </h2>
        <div className="mt-5 space-y-3 text-sm text-muted">
          {guide.introduction.map((block, index) => (
            <GuideBlockView key={index} block={block} />
          ))}
        </div>
      </div>

      <div className="mb-8 grid gap-4 rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="grid flex-1 gap-2">
            <Label htmlFor="guide-search">Search the guide</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted"
                aria-hidden="true"
              />
              <Input
                id="guide-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Try record a sale, delivery, or stock count"
                className="pl-10"
                aria-describedby="guide-results"
              />
            </div>
          </div>
          <Button variant="outline" asChild>
            <a href={guideDownload} download="StockCast-User-Guide.md">
              <Download className="size-4" aria-hidden="true" />
              Download manual
            </a>
          </Button>
        </div>
        <nav aria-label="Common tasks">
          <p className="mb-2 text-xs font-medium text-muted">What would you like to do?</p>
          <div className="flex flex-wrap gap-2">
            {quickTasks.map((task) => (
              <a
                key={task.id}
                href={"#" + task.id}
                onClick={() => openTask(task.id)}
                className="rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:border-primary hover:text-primary focus-visible:outline-primary"
              >
                {task.label}
              </a>
            ))}
          </div>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p id="guide-results" role="status" className="text-sm text-muted">
            {sections.length} of {guide.sections.length} topics
            {searching ? " match your search" : " available"}
          </p>
          <div className="flex flex-wrap gap-3 text-xs font-medium text-primary">
            {query && (
              <button type="button" onClick={() => setQuery("")} className="hover:underline">
                Clear search
              </button>
            )}
            <button type="button" onClick={() => expandAll(true)} className="hover:underline">
              Expand all
            </button>
            <button type="button" onClick={() => expandAll(false)} className="hover:underline">
              Collapse all
            </button>
          </div>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[15rem_1fr]">
        <nav aria-label="Guide topics" className="hidden lg:sticky lg:top-24 lg:block">
          <p className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">
            Browse topics
          </p>
          <div className="max-h-[75vh] overflow-y-auto pr-2">
            <TopicLinks sections={sections} />
          </div>
        </nav>
        <div className="min-w-0">
          <details className="mb-5 rounded-xl border border-border bg-surface p-4 lg:hidden">
            <summary className="cursor-pointer text-sm font-medium">Browse topics</summary>
            <div className="mt-3">
              <TopicLinks sections={sections} />
            </div>
          </details>
          <div id="guide-sections" className="space-y-4">
            {sections.map((section, index) => (
              <details
                id={section.id}
                key={query + section.id}
                open={searching || index === 0}
                className="group scroll-mt-24 rounded-2xl border border-border bg-surface"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 focus-visible:rounded-2xl focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
                  <h3 className="font-display text-xl font-medium sm:text-2xl">{section.title}</h3>
                  <ChevronDown
                    className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <div className="space-y-4 border-t border-border p-5 text-sm leading-7">
                  {section.blocks.map((block, blockIndex) => (
                    <GuideBlockView key={blockIndex} block={block} />
                  ))}
                </div>
              </details>
            ))}
            {sections.length === 0 && (
              <div className="rounded-2xl border border-border bg-surface p-6">
                <h3 className="font-display text-xl">No matching topics</h3>
                <p className="mt-2 text-sm text-muted">
                  Try fewer words, such as sale, delivery, stock, or staff.
                </p>
                <Button className="mt-4" variant="outline" onClick={() => setQuery("")}>
                  Show all topics
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function TopicLinks({ sections }: { sections: GuideSection[] }) {
  return (
    <ul className="space-y-1">
      {sections.map((section) => (
        <li key={section.id}>
          <a
            href={"#" + section.id}
            onClick={() => {
              const target = document.getElementById(section.id);
              if (target instanceof HTMLDetailsElement) target.open = true;
            }}
            className="block rounded-lg px-2 py-2 text-sm text-muted hover:bg-surface-2 hover:text-primary focus-visible:outline-primary"
          >
            {section.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

function GuideBlockView({ block }: { block: GuideBlock }) {
  switch (block.kind) {
    case "paragraph":
      return (
        <p>
          <InlineText text={block.text} />
        </p>
      );
    case "heading":
      return block.level === 3 ? (
        <h4 className="pt-3 font-display text-lg font-medium">
          <InlineText text={block.text} />
        </h4>
      ) : (
        <h5 className="pt-2 font-semibold">
          <InlineText text={block.text} />
        </h5>
      );
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index}>
          <InlineText text={item} />
        </li>
      ));
      return block.ordered ? (
        <ol className="list-decimal space-y-2 pl-6">{items}</ol>
      ) : (
        <ul className="list-disc space-y-2 pl-6">{items}</ul>
      );
    }
    case "code":
      return (
        <pre className="overflow-x-auto rounded-xl bg-surface-2 p-4 text-xs leading-6">
          <code>{block.text}</code>
        </pre>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[30rem] text-left text-xs leading-6">
            <thead className="bg-surface-2">
              <tr>
                {block.headers.map((header, index) => (
                  <th key={index} scope="col" className="px-3 py-2 font-semibold">
                    <InlineText text={header} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index} className="border-t border-border">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-3 py-2 align-top">
                      <InlineText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\x60[^\x60]+\x60|\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**"))
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("\x60") && part.endsWith("\x60")) {
          return (
            <code
              key={index}
              className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.9em] [overflow-wrap:anywhere]"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
        if (link)
          return (
            <a
              key={index}
              href={link[2]}
              className="font-medium text-primary underline underline-offset-4"
            >
              {link[1]}
            </a>
          );
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}
