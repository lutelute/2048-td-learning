# 2048 AI — N-tuple Network + TD(0) Afterstate Learning

強化学習による 2048 AI。N-tuple ネットワークと TD(0) afterstate 学習で評価関数を自動獲得する。
4×4（標準）と 5×5 の両ボードサイズに対応。

## 結果

### 4×4 ボード

100,000 エピソード学習後、1,000 ゲーム評価（学習時間: 約16分）:

| 指標 | 値 |
|------|-----|
| 平均スコア | **54,724** |
| 中央値スコア | **60,324** |
| 2048 到達率 | **90.9%** |
| 4096 到達率 | **65.1%** |
| 8192 到達率 | **1.0%** |

タイル分布 (1,000 ゲーム):

```
 8192:   10  ( 1.0%)
 4096:  641  (64.1%)
 2048:  258  (25.8%)
 1024:   72  ( 7.2%)
  512:   17  ( 1.7%)
  256:    2  ( 0.2%)
```

### 5×5 ボード

100,000 エピソード学習後、1,000 ゲーム評価（学習時間: 約75分）:

| 指標 | 値 |
|------|-----|
| 平均スコア | **166,835** |
| 中央値スコア | **168,064** |
| 2048 到達率 | **100%** |
| 4096 到達率 | **97.5%** |
| 8192 到達率 | **76.3%** |
| 16384 到達率 | **22.7%** |
| 32768 到達 | **2 回** |

タイル分布 (1,000 ゲーム):

```
32768:    2  ( 0.2%)
16384:  225  (22.5%)
 8192:  536  (53.6%)
 4096:  212  (21.2%)
 2048:   25  ( 2.5%)
```

### 学習曲線

**4×4 ボード** (100,000 エピソード, ~81 ep/s):

```
Episode   Avg Score   2048到達率   4096到達率
 25,000    32,437      74.0%       11.0%
 50,000    39,455      78.0%       32.0%
 75,000    44,569      86.0%       43.0%
100,000    54,724      90.9%       65.1%
```

**5×5 ボード** (100,000 エピソード, ~20 ep/s):

```
Episode   Avg Score   Max Tile
 10,000   117,867     16384
 20,000   126,984     16384
 50,000   145,464     16384
100,000   163,429     32768
```

---

## アルゴリズム

### 定式化

2048 を **afterstate ベースのマルコフ決定過程 (MDP)** として定式化する。

```
状態 s:   ボード上のタイル配置
行動 a:   上下左右の4方向
afterstate s' = f(s, a):  スライド・マージ後、ランダムタイル出現前の盤面
報酬 r:   マージで生成されたタイルの合計値
```

**目的**: 各 afterstate の価値関数 V(s') を学習し、ゲーム終了までの累積報酬期待値を最大化する。

### TD(0) Afterstate Learning

各エピソード（1ゲーム）で以下を繰り返す:

```
1. 各方向 a に対して afterstate s'_a = f(s, a) を計算
2. 最良手を選択: a* = argmax_a [r(s,a) + V(s'_a)]
3. 前回の afterstate s'_prev を TD 更新:
     δ = r + V(s'_new) - V(s'_prev)
     w ← w + α × δ    (全関連 LUT エントリ)
4. ゲーム終了時: δ = 0 - V(s'_last)
```

- 学習率 α = 0.0025 (5×5), 0.001 (4×4)
- 割引率 γ = 1.0 (undiscounted episodic)

### N-tuple ネットワーク

価値関数 V(s) をルックアップテーブル (LUT) の線形和で近似する。

```
V(s) = Σ_i Σ_j  w_i[ φ_i,j(s) ]
```

- `i`: 各ベースパターン
- `j`: 各パターンの対称変換（最大8変形、重複除去）
- `φ_i,j(s)`: パターン j がボード s から抽出するタイル値の組 → LUT インデックス
- `w_i`: パターン i の LUT（対称変形間で共有）

**パターン構成 (5×5)** — 12 パターン × 8 対称性 → 96 変形、約 149MB:

| タイプ | パターン数 | LUT サイズ | 説明 |
|--------|-----------|------------|------|
| 6-tuple | 2 | 16^6 = 16.7M entries (64MB) | コーナー三角形、2×3 矩形 |
| 5-tuple | 5 | 16^5 = 1.0M entries (4MB) | 行全体、列全体、十字、階段、T字 |
| 4-tuple | 5 | 16^4 = 65K entries (256KB) | 2×2正方形、直線、L字 |

**パターン構成 (4×4)** — 7 パターン × 8 対称性 → 56 変形、約 193MB:

| タイプ | パターン数 | LUT サイズ | 説明 |
|--------|-----------|------------|------|
| 6-tuple | 3 | 16^6 = 16.7M entries (64MB) | 2×3矩形、3×2矩形、コーナーL字 |
| 4-tuple | 4 | 16^4 = 65K entries (256KB) | 行全体、2×2正方形、階段、L字 |

### ボード表現

```
Uint8Array(N) — log2 エンコード
0 = 空, 1 = 2, 2 = 4, 3 = 8, ..., 14 = 16384, 15 = 32768
```

配列アクセスのみで高速演算。

### 8重対称性

ボードの二面体群 D4 (4 回転 × 2 反転 = 8 変換) を利用。
各パターンの対称変形すべてが同一の LUT を共有することで、
学習データを8倍に水増しし、汎化性能を向上させる。

---

## プロジェクト構成

```
2048-ai/
├── package.json
├── src/
│   ├── game/
│   │   ├── engine.js              # 5×5 ゲームエンジン
│   │   └── engine4x4.js           # 4×4 ゲームエンジン
│   ├── network/
│   │   ├── ntuple.js              # 5×5 N-tuple ネットワーク
│   │   ├── ntuple4x4.js           # 4×4 N-tuple ネットワーク
│   │   ├── patterns.js            # 5×5 パターン定義 (12種)
│   │   ├── patterns4x4.js         # 4×4 パターン定義 (7種)
│   │   ├── symmetry.js            # 5×5 対称性変換
│   │   └── symmetry4x4.js         # 4×4 対称性変換
│   ├── training/
│   │   ├── td-learning.js         # 5×5 TD(0) 学習コア
│   │   ├── td-learning4x4.js      # 4×4 TD(0) 学習コア
│   │   ├── trainer.js             # 5×5 学習オーケストレータ
│   │   └── trainer4x4.js          # 4×4 学習オーケストレータ
│   ├── player/
│   │   ├── greedy-player.js       # 5×5 1-ply 貪欲プレイヤー
│   │   ├── greedy-player4x4.js    # 4×4 1-ply 貪欲プレイヤー
│   │   ├── expectimax-player.js   # N-ply 探索プレイヤー
│   │   └── browser-player.js      # Playwright 連携プレイヤー
│   └── gif/
│       ├── encoder.js             # GIF89a エンコーダ (LZW圧縮)
│       └── board-renderer.js      # ボード→ピクセル変換
├── scripts/
│   ├── train.js                   # 5×5 学習実行
│   ├── train4x4.js                # 4×4 学習実行 (GIF記録付き)
│   ├── benchmark.js               # ベンチマーク
│   ├── play-browser.js            # ブラウザ自動プレイ
│   └── dashboard.js               # Web ダッシュボード
├── weights/                       # 5×5 学習済み重み (Git 管理外)
├── weights4x4/                    # 4×4 学習済み重み (Git 管理外)
└── gifs/                          # 記録 GIF (Git 管理外)
```

---

## 使い方

### 学習

```bash
# 4×4 ボード (約16分)
node --max-old-space-size=512 scripts/train4x4.js --episodes 100000

# 5×5 ボード (約75分)
node --max-old-space-size=512 scripts/train.js --episodes 100000

# チェックポイントから再開
node --max-old-space-size=512 scripts/train4x4.js \
  --episodes 200000 \
  --resume weights4x4/checkpoint-100000.bin
```

| オプション | デフォルト | 説明 |
|-----------|-----------|------|
| `--episodes` | 100000 | 総エピソード数 |
| `--lr` | 0.0025 / 0.001 | 学習率 (5×5 / 4×4) |
| `--eval-interval` | 10000 / 25000 | 進捗報告間隔 |
| `--checkpoint-interval` | 50000 / 25000 | チェックポイント保存間隔 |
| `--lr-decay-interval` | 0 (無効) | 学習率減衰間隔 |
| `--lr-decay-factor` | 0.5 | 減衰係数 |
| `--resume` | - | 再開用チェックポイントパス |

### ベンチマーク

```bash
# 1,000 ゲーム評価
node --max-old-space-size=512 scripts/benchmark.js --games 1000

# Expectimax プレイヤー (depth=2) で評価
node --max-old-space-size=512 scripts/benchmark.js --games 100 --expectimax --depth 2
```

### ダッシュボード

学習結果の可視化・ゲームリプレイ・GIFギャラリーを提供する Web UI。

```bash
node --max-old-space-size=512 scripts/dashboard.js
# http://localhost:3000 でアクセス
```

機能:
- 重みファイルのロードと評価（4×4 / 5×5 切り替え対応）
- ゲームリプレイ（ステップ送り・自動再生・V値表示）
- GIF ギャラリー
- 学習ログの可視化（スコア推移・到達率グラフ）

### GIF 記録

4×4 の学習中にマイルストーン・ベスト更新時のゲームを自動で GIF 記録する。
純 JavaScript の GIF89a エンコーダ（LZW 圧縮）で外部依存なし。

```
出力: gifs/ ディレクトリ
サイズ: 100×112 px, 32色パレット
フレーム: 最大200フレーム, 150ms/フレーム
```

### ブラウザ自動プレイ

```bash
npm install
npx playwright install chromium

node scripts/play-browser.js --url http://localhost:5173/2048_project/
node scripts/play-browser.js --games 5 --expectimax --depth 2
```

---

## 参考文献

- Szubert, M. & Jaśkowski, W. (2014). *Temporal Difference Learning of N-Tuple Networks for the Game 2048*. IEEE CIG.
- Yeh, K.-H. et al. (2016). *Multi-Stage Temporal Difference Learning for 2048-like Games*. IEEE TCIAIG.
