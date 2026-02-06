# 2048 AI — N-tuple Network + TD Learning

5×5 ボード 2048 向けの強化学習 AI。N-tuple ネットワークと TD(0) afterstate 学習で評価関数を自動獲得する。

## 結果

100,000 エピソード学習後、1,000 ゲーム評価:

| 指標 | 値 |
|------|-----|
| 平均スコア | **166,835** |
| 中央値スコア | **168,064** |
| 2048 到達率 | **100%** |
| 4096 到達率 | **97.5%** |
| 8192 到達率 | **76.3%** |
| 16384 到達率 | **22.7%** |
| 32768 到達 | **2 回** |

### タイル分布 (1,000 ゲーム)

```
32768:    2  ( 0.2%)
16384:  225  (22.5%)
 8192:  536  (53.6%)
 4096:  212  (21.2%)
 2048:   25  ( 2.5%)
```

### 学習曲線

```
Episode   Avg Score   Max Tile
 10,000   117,867     16384
 20,000   126,984     16384
 30,000   132,890     16384
 50,000   145,464     16384
 80,000   154,621     16384
100,000   163,429     32768
```

学習時間: 約75分 (M-series Mac, 1-ply greedy, ~20 ep/s)

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

- 学習率 α = 0.0025
- 割引率 γ = 1.0 (undiscounted episodic)

### N-tuple ネットワーク

価値関数 V(s) をルックアップテーブル (LUT) の線形和で近似する。

```
V(s) = Σ_i Σ_j  w_i[ φ_i,j(s) ]
```

- `i`: 各ベースパターン（12種）
- `j`: 各パターンの対称変換（最大8変形、重複除去後合計96変形）
- `φ_i,j(s)`: パターン j がボード s から抽出するタイル値の組 → LUT インデックス
- `w_i`: パターン i の LUT（対称変形間で共有）

**パターン構成**:

| タイプ | パターン数 | LUT サイズ | 説明 |
|--------|-----------|------------|------|
| 6-tuple | 2 | 16^6 = 16.7M entries (64MB) | コーナー三角形、2×3 矩形 |
| 5-tuple | 5 | 16^5 = 1.0M entries (4MB) | 行全体、列全体、十字、階段、T字 |
| 4-tuple | 5 | 16^4 = 65K entries (256KB) | 2×2正方形、直線、L字 |

合計: 12 パターン × 8 対称性 → 96 変形、約 149MB

### ボード表現

```
Uint8Array(25) — log2 エンコード
0 = 空, 1 = 2, 2 = 4, 3 = 8, ..., 14 = 16384, 15 = 32768
```

5×5 = 25 セル、各セル 0-15 の値。配列アクセスのみで高速演算。

### 8重対称性

5×5 ボードの二面体群 D4 (4 回転 × 2 反転 = 8 変換) を利用。
各パターンの対称変形すべてが同一の LUT を共有することで、
学習データを8倍に水増しし、汎化性能を向上させる。

---

## プロジェクト構成

```
2048-ai/
├── package.json
├── src/
│   ├── game/
│   │   └── engine.js          # ヘッドレスゲームエンジン (Uint8Array, log2)
│   ├── network/
│   │   ├── ntuple.js          # N-tuple ネットワーク (evaluate/update/save/load)
│   │   ├── patterns.js        # 5×5 ボード用 tuple パターン定義
│   │   └── symmetry.js        # 8重対称性変換
│   ├── training/
│   │   ├── td-learning.js     # TD(0) afterstate 学習コア
│   │   └── trainer.js         # 学習オーケストレータ
│   └── player/
│       ├── greedy-player.js   # 1-ply 貪欲プレイヤー
│       ├── expectimax-player.js # N-ply 探索 + 学習済みネットワーク
│       └── browser-player.js  # Playwright 連携プレイヤー
├── scripts/
│   ├── train.js               # 学習実行
│   ├── benchmark.js           # ベンチマーク
│   └── play-browser.js        # ブラウザ自動プレイ
└── weights/                   # 学習済み重み (Git 管理外)
```

---

## 使い方

### 学習

```bash
# 100,000 エピソード (約75分)
node --max-old-space-size=512 scripts/train.js --episodes 100000

# オプション付き
node --max-old-space-size=512 scripts/train.js \
  --episodes 500000 \
  --lr 0.001 \
  --eval-interval 10000 \
  --checkpoint-interval 100000

# チェックポイントから再開
node --max-old-space-size=512 scripts/train.js \
  --episodes 200000 \
  --resume weights/checkpoint-100000.bin
```

| オプション | デフォルト | 説明 |
|-----------|-----------|------|
| `--episodes` | 100000 | 総エピソード数 |
| `--lr` | 0.0025 | 学習率 |
| `--eval-interval` | 10000 | 進捗報告間隔 |
| `--checkpoint-interval` | 50000 | チェックポイント保存間隔 |
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
