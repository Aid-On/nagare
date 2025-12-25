# @aid-on/nagare

<div align="center">

[![npm version](https://img.shields.io/npm/v/@aid-on/nagare.svg?style=flat-square&color=00DC82)](https://www.npmjs.com/package/@aid-on/nagare)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@aid-on/nagare?style=flat-square&color=FF6B6B)](https://bundlephobia.com/package/@aid-on/nagare)

<br />

<h3>
<b>nagare</b> (流れ) - エッジコンピューティングのための究極のストリーミング基盤
</h3>

<p align="center">
<b>ただのストリーミングライブラリではありません。</b><br/>
ReadableStreamを真の第一級市民として扱う<i>唯一</i>のリアクティブ拡張ライブラリ
</p>

<br/>

**日本語** | [**English**](./README.md)

<br/>

</div>

## nagareが特別な理由

### 🎯 **他にはない、唯一の特徴**

#### **1. ReadableStream<T>そのものがインターフェース**
```typescript
// ❌ 他のライブラリ: ストリームを独自オブジェクトでラップ
const rxjsStream = from(readableStream); // Observable でラップ
const mostStream = fromReadable(readableStream); // Most.js でラップ

// ✅ nagare: Stream<T>はReadableStream<T> + メソッド
const nagareStream = stream.from(readableStream); // オーバーヘッドゼロ
nagareStream instanceof ReadableStream; // true! 
```

#### **2. ゼロコストリアクティブプログラミング**
```typescript
// ❌ RxJS: 基本的なストリーミングで100KB以上
import { Observable, from, map, filter } from 'rxjs';

// ✅ nagare: 合計10KB、tree-shake可能
import { stream } from '@aid-on/nagare';
// ネイティブパフォーマンス、ラッパーオブジェクトなし
```

#### **3. エッジファースト設計**
```typescript
// ❌ Node.js streams: エッジでpolyfillが必要
// ❌ RxJS: ブラウザ向け設計、エッジワーカー非対応

// ✅ nagare: ネイティブエッジランタイムサポート
export default {
  async fetch(request) {
    return stream
      .fromSSE('/api/chat')
      .mapAsync(processWithAI)
      .toResponse(); // 直接Responseオブジェクトに！
  }
}
```

## 他では見つからないユニーク機能

### 🚀 **順序保証付き並行処理**
```typescript
// 10個を並行処理しても順序は保証！
const results = await stream
  .array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  .mapAsync(async (n) => {
    await delay(Math.random() * 1000); // ランダムな遅延
    return n * 2;
  }, 10) // 並行度: 10
  .collect();

console.log(results); // 必ず [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
// 並行実行でも順序は完璧に保持！
```

### 💫 **自動バックプレッシャー制御**
```typescript
// コンシューマーが遅い時、ストリームが自動的に一時停止
stream.subscribe({
  next: async (value) => {
    await heavyProcessing(value); // ストリームが待機！
    // メモリオーバーフローなし、データロスなし
  }
});
```

### 🔄 **クロスプラットフォーム対応SSE**
```typescript
// どんなサーバーでも動作（Windows、Unix、Mac）
const events = await stream.fromSSE('/api/events');
// \r\n、\n、\r すべての改行コードを自動処理
```

### 🎭 **デュアルインターフェース: リアクティブ + 命令型**
```typescript
// お好みのスタイルで！

// リアクティブ（プル型）
const s1 = stream.from(source)
  .map(x => x * 2)
  .filter(x => x > 10);

// 命令型（プッシュ型）
const s2 = stream.create((controller) => {
  controller.next(1);
  controller.next(2);
  controller.complete();
});
```

## パフォーマンス比較

| 機能 | **nagare** | RxJS | Node Streams | Most.js |
|------|------------|------|--------------|---------|
| バンドルサイズ | **10KB** | 100KB+ | N/A (Node) | 40KB |
| エッジサポート | **ネイティブ** | Polyfill | Polyfill | Polyfill |
| バックプレッシャー | **自動** | 手動 | あり | 手動 |
| 順序保証並行処理 | **あり** | なし | なし | なし |
| 直接Response変換 | **あり** | なし | なし | なし |
| Tree-shake可能 | **完全対応** | 部分的 | なし | あり |
| ゼロ依存 | **はい** | いいえ | いいえ | いいえ |

## 実世界のエッジ環境での使用例

### AIストリーミングレスポンス（Cloudflare Workers）
```typescript
export default {
  async fetch(request: Request) {
    const aiStream = stream.create<string>((controller) => {
      // AI応答を生成しながらストリーミング
      const response = await ai.complete(prompt, {
        stream: true,
        onToken: (token) => controller.next(token)
      });
    });

    return aiStream
      .tap(token => metrics.record(token))
      .throttle(50) // クライアントのオーバーフロー防止
      .toSSE()
      .toResponse({
        headers: { 
          'Content-Type': 'text/event-stream',
          'X-Powered-By': 'nagare'
        }
      });
  }
};
```

### リアルタイムデータパイプライン
```typescript
const pipeline = stream
  .fromSSE('/api/market-data')
  .mapAsync(async data => {
    // 順序保証付き並列エンリッチメント
    const [analysis, prediction] = await Promise.all([
      analyzeMarket(data),
      predictTrend(data)
    ]);
    return { ...data, analysis, prediction };
  }, 5) // 5並行処理
  .buffer(10) // 効率化のためバッチ処理
  .tap(batch => database.insert(batch))
  .debounce(100); // UI過負荷防止
```

## インストール

```bash
npm install @aid-on/nagare
```

## クイックスタート

```typescript
import { stream } from '@aid-on/nagare';

// 最初のnagareストリーム
const result = await stream
  .array([1, 2, 3, 4, 5])
  .map(x => x * 2)
  .filter(x => x > 5)
  .collect();

console.log(result); // [6, 8, 10]
```

## nagareの設計哲学

1. **ストリームがプリミティブ** - ObservableでもPromiseでもない
2. **エッジファースト** - Cloudflare、Deno、Bunを最初から想定
3. **魔法なし** - 見たままが実行される
4. **型安全性** - 妥協のないTypeScript
5. **Web標準** - ReadableStreamが基盤

## nagareを使うべき人

- 🏢 **エッジアプリケーション開発者** - 第一級エッジランタイムサポート
- 🚀 **パフォーマンス重視の開発者** - 最小オーバーヘッド、最大スループット
- 🎯 **型安全性支持者** - 厳密な型付きTypeScript
- 🌊 **ストリーム処理のエキスパート** - バックプレッシャー付き高度オペレーター
- 🤖 **AI/MLエンジニア** - LLMレスポンスのストリーミングに最適

## コントリビューション

コントリビューションを歓迎します！詳細は[CONTRIBUTING.md](CONTRIBUTING.md)をご覧ください。

## ライセンス

MIT © Aid-On

---

<div align="center">

**エッジのために作られ、開発者のために設計され、本番環境で実証済み。**

<br/>

[NPM](https://www.npmjs.com/package/@aid-on/nagare) • 
[GitHub](https://github.com/Aid-On/nagare) • 
[ドキュメント](https://github.com/Aid-On/nagare#readme)

</div>