import * as path from "path";
import hljs from "highlight.js/lib/common";
import MarkdownIt from "markdown-it";
import * as vscode from "vscode";

type MarkdownRenderer = {
  render: (input: string) => string;
};

const markdownRenderer: MarkdownRenderer = createMarkdownRenderer();

type SplitPair = {
  ratio: number;
  leftMarkdown: string;
  rightMarkdown: string;
};

type RenderBlock =
  | {
    kind: "normal";
    markdown: string;
  }
  | {
    kind: "pair";
    pair: SplitPair;
  };

type ParsedContent = {
  hasSplitSyntax: boolean;
  blocks: RenderBlock[];
  warnings: string[];
};

class UiSpecPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly markdownUri: vscode.Uri;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  static create(context: vscode.ExtensionContext, markdownUri: vscode.Uri): UiSpecPanel {
    const panel = vscode.window.createWebviewPanel(
      "uiSpecViewer",
      `UI Spec Viewer: ${path.basename(markdownUri.fsPath)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.dirname(markdownUri.fsPath)),
          vscode.Uri.joinPath(context.extensionUri, "media")
        ]
      }
    );

    return new UiSpecPanel(context, panel, markdownUri);
  }

  private constructor(context: vscode.ExtensionContext, panel: vscode.WebviewPanel, markdownUri: vscode.Uri) {
    this.panel = panel;
    this.markdownUri = markdownUri;
    this.extensionUri = context.extensionUri;

    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose())
    );

    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.toString() === this.markdownUri.toString()) {
          void this.render();
        }
      })
    );

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === this.markdownUri.toString()) {
          void this.render();
        }
      })
    );

    this.disposables.push(
      vscode.workspace.onDidDeleteFiles((e) => {
        if (e.files.some((f) => f.toString() === this.markdownUri.toString())) {
          vscode.window.showWarningMessage("元のMarkdownファイルが削除されたため、UI Spec Viewerを閉じます。");
          this.panel.dispose();
        }
      })
    );

    context.subscriptions.push(this);
    void this.render();
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  private async render(): Promise<void> {
    const markdownText = await this.readMarkdown();
    const parsed = parseSnippetPairs(markdownText);
    this.panel.webview.html = this.getWebviewHtml(parsed);
  }

  private async readMarkdown(): Promise<string> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.markdownUri);
      return Buffer.from(bytes).toString("utf8");
    } catch {
      return "# 読み込みエラー\n\nMarkdownの読み込みに失敗しました。";
    }
  }

  private getWebviewHtml(parsed: ParsedContent): string {
    const nonce = String(Date.now());

    let bodyHtml = "";
    const warningHtml = parsed.warnings
      .map((w) => `<p class="warning">${escapeHtml(w)}</p>`)
      .join("\n");

    const blockHtml = parsed.blocks.map((block) => {
      if (block.kind === "normal") {
        return `<section class="single">${this.rewriteImageSources(markdownRenderer.render(block.markdown))}</section>`;
      }

      const pair = block.pair;
      const left = pair.leftMarkdown.trim()
        ? this.rewriteImageSources(markdownRenderer.render(pair.leftMarkdown))
        : "<p><em>左側の内容が空です。</em></p>";
      const right = pair.rightMarkdown.trim()
        ? this.rewriteImageSources(markdownRenderer.render(pair.rightMarkdown))
        : "<p><em>右側の内容が空です。</em></p>";
      const rightRatio = Math.max(1, 100 - pair.ratio);

      return `<section class="pair" style="grid-template-columns:${pair.ratio}fr ${rightRatio}fr;">`
        + `<article class="pane pane-left">${left}</article>`
        + `<article class="pane pane-right">${right}</article>`
        + "</section>";
    }).join("\n");

    bodyHtml = warningHtml + blockHtml;

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this.panel.webview.cspSource} data:; style-src 'unsafe-inline' ${this.panel.webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>UI Spec Viewer</title>
  <style>
    body {
      margin: 0 auto;
      padding: 0 22px;
      max-width: 980px;
      box-sizing: border-box;
      font-family: var(--vscode-markdown-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--vscode-markdown-font-size, 14px);
      line-height: var(--vscode-markdown-line-height, 1.6);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      overflow: auto;
    }

    main {
      padding: 12px 0 24px;
      display: grid;
      gap: 14px;
    }

    .pair {
      display: grid;
      gap: 0;
      border-top: 1px solid var(--vscode-panel-border);
      padding-top: 10px;
    }

    .pane {
      padding: 0 10px;
      overflow: auto;
    }

    .pane-left {
      border-right: 1px solid var(--vscode-panel-border);
      padding-left: 0;
    }

    .pane-right {
      padding-right: 0;
    }

    .warning {
      margin: 0 0 8px;
      padding: 10px 12px;
      border-radius: 6px;
      border: 1px solid #c98b2a;
      background: rgba(201, 139, 42, 0.12);
      color: #c98b2a;
      font-size: 12px;
    }

    .single {
      padding: 0;
    }

    p,
    ul,
    ol,
    dl,
    table,
    blockquote,
    pre {
      margin-top: 0;
      margin-bottom: 16px;
    }

    ul,
    ol {
      padding-left: 2em;
    }

    li > p {
      margin-bottom: 0;
    }

    h1,
    h2 {
      font-weight: 600;
      padding-bottom: 0.3em;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-top: 24px;
      margin-bottom: 16px;
      line-height: 1.25;
    }

    h1 {
      font-size: 2em;
      margin-top: 0;
    }

    h2 {
      font-size: 1.5em;
    }

    h3,
    h4,
    h5,
    h6 {
      line-height: 1.25;
      margin-top: 24px;
      margin-bottom: 16px;
      font-weight: 600;
    }

    h3 {
      font-size: 1.25em;
    }

    h4 {
      font-size: 1em;
    }

    h5 {
      font-size: 0.875em;
    }

    h6 {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }

    img {
      max-width: 100%;
      height: auto;
    }

    hr {
      border: 0;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin: 24px 0;
    }

    table {
      border-collapse: collapse;
      display: block;
      width: max-content;
      max-width: 100%;
      overflow: auto;
    }

    table th,
    table td {
      border: 1px solid var(--vscode-panel-border);
      padding: 6px 13px;
    }

    table tr {
      border-top: 1px solid var(--vscode-panel-border);
      background-color: transparent;
    }

    :not(pre) > code {
      font-family: var(--vscode-editor-font-family, SFMono-Regular, Menlo, Consolas, monospace);
      font-size: 0.92em;
      color: var(--vscode-textPreformat-foreground, var(--vscode-editor-foreground));
      background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.15));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
      padding: 0.1em 0.35em;
    }

  </style>
</head>
<body>
  <main>
    ${bodyHtml}
  </main>
  <script nonce="${nonce}"></script>
</body>
</html>`;
  }

  private rewriteImageSources(html: string): string {
    return html.replace(/<img\b([^>]*?)\bsrc=("|')([^"']+)\2([^>]*)>/gi, (_m, before, quote, src, after) => {
      const resolvedSrc = this.toWebviewImageSrc(src);
      return `<img${before}src=${quote}${resolvedSrc}${quote}${after}>`;
    });
  }

  private toWebviewImageSrc(src: string): string {
    const rawSrc = src.trim();
    if (!rawSrc || /^(https?:|data:|vscode-resource:|command:|#)/i.test(rawSrc)) {
      return rawSrc;
    }

    const [basePath, suffix = ""] = rawSrc.split(/([?#].*)/, 2);
    const resolved = path.resolve(path.dirname(this.markdownUri.fsPath), basePath);
    const webviewUri = this.panel.webview.asWebviewUri(vscode.Uri.file(resolved)).toString();
    return webviewUri + suffix;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand("uiSpecViewer.open", async () => {
    const activeEditor = vscode.window.activeTextEditor;
    const targetUri = activeEditor?.document.languageId === "markdown"
      ? activeEditor.document.uri
      : await pickMarkdownFile();

    if (!targetUri) {
      vscode.window.showInformationMessage("Markdownファイルを開いてから実行してください。");
      return;
    }

    UiSpecPanel.create(context, targetUri);
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // no-op
}

async function pickMarkdownFile(): Promise<vscode.Uri | undefined> {
  const selected = await vscode.window.showOpenDialog({
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      Markdown: ["md", "markdown"]
    },
    openLabel: "UI Spec Viewerで開く"
  });

  return selected?.[0];
}

function parseSnippetPairs(markdownText: string): ParsedContent {
  const lines = markdownText.split(/\r?\n/);
  const blocks: RenderBlock[] = [];
  const warnings: string[] = [];
  let hasSplitSyntax = false;

  let state: "outside" | "left" | "right" = "outside";
  let ratio = 50;
  let normalBuffer: string[] = [];
  let leftBuffer: string[] = [];
  let rightBuffer: string[] = [];

  const pushNormalIfAny = () => {
    const markdown = normalBuffer.join("\n").trim();
    if (!markdown) {
      normalBuffer = [];
      return;
    }

    blocks.push({
      kind: "normal",
      markdown
    });
    normalBuffer = [];
  };

  const pushPair = () => {
    const pair: SplitPair = {
      ratio,
      leftMarkdown: leftBuffer.join("\n").trim(),
      rightMarkdown: rightBuffer.join("\n").trim()
    };

    blocks.push({
      kind: "pair",
      pair
    });

    leftBuffer = [];
    rightBuffer = [];
    ratio = 50;
  };

  for (const line of lines) {
    const normalized = normalizeMarkerLine(line).trim();
    const ratioStart = normalized.match(/^--(\d{1,2})$/);
    const splitEnd = normalized === "---";

    if (state === "outside" && splitEnd) {
      hasSplitSyntax = true;
      pushNormalIfAny();
      state = "left";
      continue;
    }

    if (ratioStart && state === "left") {
      hasSplitSyntax = true;
      ratio = clampRatio(Number(ratioStart[1]));
      state = "right";
      continue;
    }

    if (splitEnd && state === "right") {
      pushPair();
      state = "outside";
      continue;
    }

    if (splitEnd && state === "left") {
      // If another separator appears before --NN, treat previous chunk as normal markdown
      // and restart left block from here. This supports patterns like:
      // ---
      // ## title (normal markdown)
      // ---
      // ![image](...)
      // --50
      if (leftBuffer.join("\n").trim()) {
        normalBuffer = normalBuffer.concat(leftBuffer);
        leftBuffer = [];
      }
      continue;
    }

    if (state === "outside") {
      normalBuffer.push(line);
    } else if (state === "right") {
      rightBuffer.push(line);
    } else {
      leftBuffer.push(line);
    }
  }

  if (state === "right") {
    warnings.push("最後の右ブロックが --- で閉じられていないため、自動で閉じました。");
    pushPair();
    state = "outside";
  } else if (state === "left") {
    normalBuffer = normalBuffer.concat(leftBuffer);
    leftBuffer = [];
    state = "outside";
  }

  pushNormalIfAny();

  if (hasSplitSyntax) {
    return {
      hasSplitSyntax: true,
      blocks,
      warnings
    };
  }

  return {
    hasSplitSyntax: false,
    blocks: [
      {
        kind: "normal",
        markdown: markdownText
      }
    ],
    warnings: []
  };
}

function normalizeMarkerLine(input: string): string {
  // Normalize common dash variants to ASCII hyphen so marker parsing is robust.
  return input.replace(/[\u2010-\u2015\u2212\uFF0D]/g, "-");
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 50;
  }

  if (value < 10) {
    return 10;
  }

  if (value > 90) {
    return 90;
  }

  return value;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCodeBlock(code: string, language: string): string {
  const normalizedLang = language.trim().toLowerCase();
  let html = escapeHtml(code);

  try {
    if (normalizedLang && hljs.getLanguage(normalizedLang)) {
      html = hljs.highlight(code, { language: normalizedLang, ignoreIllegals: true }).value;
    } else {
      html = hljs.highlightAuto(code).value;
    }
  } catch {
    html = escapeHtml(code);
  }

  return html;
}

function createMarkdownRenderer(): MarkdownRenderer {
  const renderer = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    highlight: (code: string, language: string) => renderCodeBlock(code, language)
  });

  return {
    render: (input: string) => renderer.render(input)
  };
}

function renderFallbackMarkdown(input: string): string {
  const lines = input.split(/\r?\n/);
  const out: string[] = [];
  type ListContext = {
    indent: number;
    tag: "ul" | "ol";
    typeAttr: string;
    liOpen: boolean;
  };

  const listStack: ListContext[] = [];

  const closeOneList = () => {
    const top = listStack.pop();
    if (!top) {
      return;
    }

    if (top.liOpen) {
      out.push("</li>");
    }
    out.push(`</${top.tag}>`);
  };

  const closeListsUntilIndent = (targetIndent: number) => {
    while (listStack.length > 0 && listStack[listStack.length - 1].indent > targetIndent) {
      closeOneList();
    }
  };

  const closeAllLists = () => {
    while (listStack.length > 0) {
      closeOneList();
    }
  };

  const ensureListLevel = (indent: number, tag: "ul" | "ol", typeAttr: string) => {
    if (listStack.length === 0) {
      out.push(`<${tag}${typeAttr}>`);
      listStack.push({ indent, tag, typeAttr, liOpen: false });
      return;
    }

    const top = listStack[listStack.length - 1];

    if (indent > top.indent) {
      out.push(`<${tag}${typeAttr}>`);
      listStack.push({ indent, tag, typeAttr, liOpen: false });
      return;
    }

    closeListsUntilIndent(indent);

    const current = listStack[listStack.length - 1];
    if (!current || current.indent < indent) {
      out.push(`<${tag}${typeAttr}>`);
      listStack.push({ indent, tag, typeAttr, liOpen: false });
      return;
    }

    if (current.tag !== tag || current.typeAttr !== typeAttr) {
      closeOneList();
      out.push(`<${tag}${typeAttr}>`);
      listStack.push({ indent, tag, typeAttr, liOpen: false });
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      closeAllLists();
      i += 1;
      continue;
    }

    // Code block support (``` with optional language)
    if (/^```/.test(trimmed)) {
      closeAllLists();
      const codeContent: string[] = [];
      const langMatch = trimmed.match(/^```\s*([a-zA-Z0-9_+-]*)/);
      const language = langMatch?.[1] ?? "";
      i += 1;

      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeContent.push(lines[i]);
        i += 1;
      }

      out.push(renderCodeBlock(codeContent.join("\n"), language));
      if (i < lines.length && /^```/.test(lines[i].trim())) {
        i += 1;
      }
      continue;
    }

    // Block quote support (> lines)
    if (/^\s*>/.test(line)) {
      closeAllLists();
      const quoteLines: string[] = [];

      while (i < lines.length && /^\s*>/.test(lines[i])) {
        const quoteLine = lines[i].replace(/^\s*>\s?/, "");
        quoteLines.push(quoteLine);
        i += 1;
      }

      const quoteContent = renderFallbackMarkdown(quoteLines.join("\n"));
      out.push(`<blockquote>${quoteContent}</blockquote>`);
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      closeAllLists();
      const header = parseTableCells(line);
      const rows: string[][] = [];
      i += 2;

      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(parseTableCells(lines[i]));
        i += 1;
      }

      out.push(renderTableHtml(header, rows));
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeAllLists();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      closeAllLists();
      out.push("<hr />");
      i += 1;
      continue;
    }

    const list = parseListItem(line);
    if (list) {
      ensureListLevel(list.indent, list.tag, list.typeAttr);
      const top = listStack[listStack.length - 1];
      if (top.liOpen) {
        out.push("</li>");
      }
      const checkbox = list.checkbox ? `<input type="checkbox"${list.checkbox === "checked" ? " checked" : ""} disabled /> ` : "";
      out.push(`<li>${checkbox}${renderInlineMarkdown(list.itemText)}`);
      top.liOpen = true;
      i += 1;
      continue;
    }

    closeAllLists();
    out.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
    i += 1;
  }

  closeAllLists();
  return out.join("\n");
}

function renderInlineMarkdown(input: string): string {
  let text = escapeHtml(input);

  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) => {
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`;
  });

  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  });

  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");

  return text;
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return /^\|(.+\|)+\s*$/.test(trimmed);
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed);
}

function parseTableCells(line: string): string[] {
  const normalized = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return normalized.split("|").map((cell) => cell.trim());
}

function renderTableHtml(header: string[], rows: string[][]): string {
  const headerHtml = header
    .map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`)
    .join("");
  const rowsHtml = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`)
    .join("");

  return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

function parseListItem(line: string): { indent: number; tag: "ul" | "ol"; typeAttr: string; itemText: string; checkbox?: "checked" | "unchecked" } | null {
  // Match checkbox pattern: - [ ] text or - [x] text or - [ ] [ ] text (nested)
  const checkboxMatch = line.match(/^(\s*)([-*]|\d+\.|[a-zA-Z]\.)\s+(\[[ xX]\])\s+(.*)$/);
  if (checkboxMatch) {
    const indent = computeIndentWidth(checkboxMatch[1]);
    const marker = checkboxMatch[2];
    const checkboxState = checkboxMatch[3];
    const itemText = checkboxMatch[4];
    const isChecked = checkboxState === "[x]" || checkboxState === "[X]" ? "checked" : "unchecked";

    return {
      indent,
      tag: "ul",
      typeAttr: "",
      itemText,
      checkbox: isChecked
    };
  }

  const match = line.match(/^(\s*)([-*]|\d+\.|[a-zA-Z]\.)\s+(.*)$/);
  if (!match) {
    return null;
  }

  const indent = computeIndentWidth(match[1]);
  const marker = match[2];
  const itemText = match[3];

  if (marker === "-" || marker === "*") {
    return { indent, tag: "ul", typeAttr: "", itemText };
  }

  if (/^\d+\.$/.test(marker)) {
    return { indent, tag: "ol", typeAttr: "", itemText };
  }

  const type = marker[0] >= "A" && marker[0] <= "Z" ? "A" : "a";
  return { indent, tag: "ol", typeAttr: ` type="${type}"`, itemText };
}

function computeIndentWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += ch === "\t" ? 4 : 1;
  }
  return width;
}