// Parses the deliberately limited Markdown used by docs/USER_GUIDE.md.
// React renders the resulting blocks as text/elements; no HTML is injected.
export type GuideBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: 3 | 4; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; language: string; text: string }
  | { kind: "table"; headers: string[]; rows: string[][] };

export interface GuideSection {
  id: string;
  title: string;
  blocks: GuideBlock[];
  searchText: string;
}

export interface GuideDocument {
  title: string;
  introduction: GuideBlock[];
  sections: GuideSection[];
}

function headingId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function startsBlock(line: string): boolean {
  return /^(?:#{3,4} |\x60{3}|[-*] |\d+\. |\|)/.test(line);
}

export function parseGuideBlocks(lines: string[]): GuideBlock[] {
  const blocks: GuideBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index++;
      continue;
    }

    if (line.startsWith("\x60\x60\x60")) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith("\x60\x60\x60")) {
        code.push(lines[index++]);
      }
      if (index < lines.length) index++;
      blocks.push({ kind: "code", language, text: code.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{3,4}) (.+)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length as 3 | 4, text: heading[2] });
      index++;
      continue;
    }

    if (line.startsWith("|") && /^\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[index + 1] ?? "")) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(tableCells(lines[index++]));
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    const list = line.match(/^([-*] |\d+\. )(.+)$/);
    if (list) {
      const ordered = /^\d/.test(list[1]);
      const pattern = ordered ? /^\d+\. (.+)$/ : /^[-*] (.+)$/;
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].trim().match(pattern);
        if (!item) break;
        items.push(item[1]);
        index++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraph = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index].trim())) {
      paragraph.push(lines[index++].trim());
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

export function parseGuide(source: string): GuideDocument {
  const lines = source.replace(/\r\n?/g, "\n").trim().split("\n");
  const title = lines[0].match(/^# (.+)$/)?.[1] ?? "StockCast User Guide";
  const introduction: string[] = [];
  const rawSections: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | undefined;
  let inCode = false;

  for (const line of lines.slice(1)) {
    if (line.trim().startsWith("\x60\x60\x60")) inCode = !inCode;
    const heading = !inCode ? line.match(/^## (.+)$/) : null;
    if (heading) {
      current = { title: heading[1], lines: [] };
      rawSections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      introduction.push(line);
    }
  }

  return {
    title,
    introduction: parseGuideBlocks(introduction),
    sections: rawSections.map((section) => ({
      id: headingId(section.title),
      title: section.title,
      blocks: parseGuideBlocks(section.lines),
      searchText: [section.title, ...section.lines].join(" ").toLowerCase(),
    })),
  };
}

export function searchGuide(sections: GuideSection[], query: string): GuideSection[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return sections.filter((section) => terms.every((term) => section.searchText.includes(term)));
}
