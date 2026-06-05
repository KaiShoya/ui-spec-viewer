## Overview
UI仕様書を人間とAIの双方が読み取りやすい形式で扱うため、Markdownを左右50:50で分割表示するVS Code拡張のMVPを実装する。
左に画面画像、右に説明Markdownを表示し、通常のMarkdown機能は既存仕様を活用する。

## User Story
As an エンジニア
I want 画面画像と説明を並べて同時に確認できるMarkdownビュー
So that 人間にもAIにも理解しやすい共通の画面設計書を作成できる

## Context
- Why is this needed? UI仕様の共有フォーマットが統一されておらず、理解コストが高い
- Current workflow: 画像と説明を別々に開いて突き合わせる
- Pain point: 仕様理解・レビュー時に文脈対応が取りづらく、認識齟齬が発生しやすい
- Success metric: （要確定）例: 仕様理解時間30%短縮 or AI抽出正解率90%以上
- Reference: READMEのコンセプトに準拠

## Acceptance Criteria
- [ ] ユーザーはMarkdownドキュメントを左右50:50で表示できる
- [ ] 左ペインに画像、右ペインに説明Markdownが表示される
- [ ] 右ペインのスクロールに応じて左ペインが同期（セクション単位でも可）
- [ ] Markdownまたは画像更新時にビューが自動更新される（ホットリロード）
- [ ] 画像パス不正・読み込み失敗時に原因が分かるエラーメッセージを表示する
- [ ] Success = 確定した成功指標を満たすこと

## Technical Requirements
- Technology/framework: VS Code Extension API + Markdownレンダリング
- Performance: 通常サイズの仕様書で初期表示2秒以内を目標
- Security: 外部送信なし、ローカルファイルのみ参照
- Accessibility: キーボード操作可能、基本的な可読性確保

## Definition of Done
- [ ] 実装がプロジェクト規約に準拠している
- [ ] Unit tests written with ≥85% coverage
- [ ] Integration tests pass
- [ ] Documentation updated (README, API docs, inline comments)
- [ ] Code reviewed and approved by 1+ reviewer
- [ ] All acceptance criteria met and verified
- [ ] PR merged to main branch

## Dependencies
- Blocked by: なし
- Blocks: 後続の拡大縮小機能、レイアウト切替機能
- Related to: UI仕様標準化の取り組み全般

## Estimated Effort
5 days - 複数機能（分割表示、同期、更新監視、エラー処理）を含むため

## Related Documentation
- Product spec: docs/product/ui-spec-viewer-requirements.md
- Design: docs/product/ui-spec-viewer-journey.md
