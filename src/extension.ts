import * as path from "path";
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
          vscode.Uri.file(path.dirname(markdownUri.fsPath))
        ]
      }
    );

    return new UiSpecPanel(context, panel, markdownUri);
  }

  private constructor(context: vscode.ExtensionContext, panel: vscode.WebviewPanel, markdownUri: vscode.Uri) {
    this.panel = panel;
    this.markdownUri = markdownUri;

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
        return `<section class="single">${markdownRenderer.render(block.markdown)}</section>`;
      }

      const pair = block.pair;
      const left = pair.leftMarkdown.trim()
        ? markdownRenderer.render(pair.leftMarkdown)
        : "<p><em>左側の内容が空です。</em></p>";
      const right = pair.rightMarkdown.trim()
        ? markdownRenderer.render(pair.rightMarkdown)
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this.panel.webview.cspSource} data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>UI Spec Viewer</title>
  <style>
    :root {
      color-scheme: light dark;
    }

    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.6;
      overflow: auto;
    }

    main {
      padding: 16px;
      display: grid;
      gap: 16px;
    }

    .pair {
      display: grid;
      border: 1px solid rgba(128, 128, 128, 0.35);
      border-radius: 8px;
      overflow: hidden;
      min-height: 220px;
      background: rgba(128, 128, 128, 0.06);
    }

    .pane {
      padding: 16px;
      overflow: auto;
    }

    .pane-left {
      border-right: 1px solid rgba(128, 128, 128, 0.35);
      background: rgba(100, 120, 180, 0.07);
    }

    .pane-right {
      background: rgba(70, 170, 120, 0.07);
    }

    .warning {
      margin: 0;
      padding: 10px 12px;
      border-radius: 6px;
      border: 1px solid #c98b2a;
      background: rgba(201, 139, 42, 0.12);
      color: #c98b2a;
      font-size: 12px;
    }

    .single {
      border: 1px solid rgba(128, 128, 128, 0.35);
      border-radius: 8px;
      padding: 16px;
    }

    img {
      max-width: 100%;
      height: auto;
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
      warnings.push("左ブロック開始後に --NN が無いため、左ブロックを通常Markdownとして扱いました。");
      normalBuffer = normalBuffer.concat(leftBuffer);
      leftBuffer = [];
      state = "outside";
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
    warnings.push("最後の左ブロックに対応する --NN が見つからないため、通常Markdownとして扱いました。");
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

function createMarkdownRenderer(): MarkdownRenderer {
  try {
    const MarkdownItCtor = require("markdown-it") as new (options: Record<string, unknown>) => MarkdownRenderer;
    return new MarkdownItCtor({
      html: false,
      linkify: true,
      typographer: true
    });
  } catch {
    return {
      render: renderFallbackMarkdown
    };
  }
}

function renderFallbackMarkdown(input: string): string {
  const lines = input.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;

  const closeListIfNeeded = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeListIfNeeded();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeListIfNeeded();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const list = line.match(/^[-*]\s+(.*)$/);
    if (list) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${renderInlineMarkdown(list[1])}</li>`);
      continue;
    }

    closeListIfNeeded();
    out.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  closeListIfNeeded();
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

  return text;
}