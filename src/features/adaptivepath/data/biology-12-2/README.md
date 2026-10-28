# Biology 2e 12.2 内容库与题库

本目录是可随 Git 版本管理的静态数据库，不依赖服务器、云数据库或 API 密钥。数据来自用户提供的 `Biology_2e_Section_12_2.pdf`；原文、教学概念和原创题目分别保存，通过稳定 ID 关联。

## 数据规模

- 10 个知识概念，每个概念 10 道简单、10 道中等、10 道困难选择题，共 300 道。
- 5 组不同的三概念组合，每组 2 道中等、2 道困难串联选择题，共 20 道。
- 73 个文本块，保留章节标题、目标、正文、原有练习、图注、表格、扩展内容和脚注。
- 11 幅图、1 张表、12 张 144 DPI 页面图像，以及原始 PDF。
- 题目、解析与原文为英文；概念同时提供英文、中文名称。

`catalog.json` 是入口，记录集合路径、数量、难度定义和文件 SHA-256。`schema.json` 定义 JSON Schema Draft 2020-12 数据契约；`retrieval-index.json` 提供概念 → 文本块、概念 → 题目、文本块 → 题目、图表 → 文本块的查找表。

## 文件关系

| 文件 | 内容 |
| --- | --- |
| `source.json` | 来源、文件指纹、页面尺寸、坐标约定、排除内容、来源说明 |
| `concepts.json` | 10 个概念、学习目标、先修关系、现有 7 个大主题的映射 |
| `chunks.json` | 原文、归一化文本、页码、逐行矩形、概念和图表关联 |
| `figures.json` | 图表页码、裁剪位置、图注、署名、图片路径、反向引用 |
| `combinations.json` | 5 组串联组合与对应题目 ID |
| `questions/concepts-01-03.json` | 基因/等位基因/倍性，基因型/表型/完全显性，单因子杂交 |
| `questions/concepts-04-06.json` | 测交，隐性遗传家系，不完全显性 |
| `questions/concepts-07-10.json` | 共显性，复等位基因，X 连锁，致死等位基因 |
| `questions/integrated.json` | 20 道三概念串联题 |
| `assets/` | 原始 PDF、完整页面渲染和单独的图表裁剪 |
| `validation-report.json` | 最近一次完整校验结果 |

数组本身是记录集合，没有在每条记录中重复整个数据库。`source_id`、`concept_ids`、`chunk_ids`、`figure_ids`、`combination_id` 是外键。ID 不依赖题目排序，既有 ID 的语义改变时应明确迁移，避免破坏学生学习记录。

## 坐标和提取边界

- `page` 是**所提供的 12 页 PDF 内、从 1 开始的页码**，不是整本书的 PDF 索引。`printed_page` 为书页 316–327；不推测整本 PDF 的页码。
- 所有 `bbox` 为 **144 DPI**、左上角原点、`[x0, y0, x1, y1]` 的像素坐标。PNG 在 `source.json.pages[].image_path`，每页宽高也在那里。
- `bbox_points` 保存 PDF 点坐标；本文件 72 点对应 144 像素，因此比例为 2。左上向下取整，右下向上取整。
- 每个 `regions` 元素对应 `raw_text` 中一行。`bbox` 是逐行矩形的包围框；高亮正文时优先使用 `regions`，以免圈入段落间的空白。
- 图表 `bbox` 对应页面中的图像区域，`image_width` / `image_height` 对应单独裁剪 PNG；不是原图 XObject 的原生像素大小。
- `raw_text` 保留 PDF 原生文本提取的换行、断词和上标线性化等结果。`normalized_text` 只合并空白，便于检索和验证引用。图内标记保留在图片中，不把未经核对的 OCR 当成正文。
- PDF 首尾夹带了相邻章节。入库从第一页的 12.2 标题开始，到第十二页 12.3 标题之前结束；页眉页脚也不作为知识块。所有被排除的行及原因保存在 `source.json.extraction.excluded_lines` 中。原始 PDF 和整页图像保留完整页面。
- 跨页段落不合并成伪造的单页矩形；用 `continuation_of` 和前后块 ID 连接。扩展检索上下文时可沿这些链接读取。

## 题目契约

每题有四个唯一选项，`correct_answer` 是选项 ID（A/B/C/D），不是数组序号。`explanation` 是完整推导；`option_explanations` 对每个选项给出对应理由。`evidence[].quote` 必须是所指文本块 `normalized_text` 的**原样子串**，假设情境与推导结论不能伪装成课本引文。

`assumptions` 是题目的一部分，后续界面应与题干一起展示；例如随机受精、完全外显、无新突变、按亲本基因型条件独立等假设。仅展示 `question` 而忽略这些条件，可能改变概率题的含义。

单概念题的 `concept_ids` 只标记本题主要考查的一个概念，先修概念由 `concepts.json.prerequisite_ids` 表达。串联题恰有三个概念，`concept_steps` 明确说明三个概念如何参与解题；不能仅靠题干提及三个术语充数。

`figure_ids` 是题目图表关联，`requires_figure` 表示是否必须展示图才能答题。当前题目都可独立阅读，课本的图文证据仍可从 `chunk_ids` 追溯。今后若编写看图题，应设 `requires_figure: true` 并提供图表 ID。

简单题关注辨认和直接理解；中等题关注情境应用；困难题关注多步推导、条件概率、抽样不确定性、实验设计或模型诊断。难度是教学设计标签，尚未经过学生答题数据校准。自动校验验证结构与出处，不能替代学科内容评审；题目经过出题 agent 自检与交叉复核。

特别保留的来源细节见 `source.json.content_notes`：不将原文黄色豆荚的表述作为考核事实，不把兔的 chinchilla 不完全显性改成完全显性，也不把简化人类遗传模型当作临床规则。

## 在项目中使用

本次交付建立数据层，保留现有 UI、旧 TypeScript 提取文本、旧 chunk ID 和旧题库的行为。`legacy_topic` 可供未来适配器连接现有 7 个主题。新旧 chunk ID 属于不同命名空间，不能直接互换。

例如，在支持 JSON import 的 TypeScript 项目中：

```ts
import concepts from './concepts.json';
import chunks from './chunks.json';
import foundationQuestions from './questions/concepts-01-03.json';
import index from './retrieval-index.json';

const concept = concepts.find(c => c.slug === 'monohybrid-punnett')!;
const candidateIds = new Set(index.concept_to_chunk_ids[concept.id as keyof typeof index.concept_to_chunk_ids]);
const context = chunks.filter(c => candidateIds.has(c.id));
const practice = foundationQuestions.filter(q =>
  q.primary_concept_id === concept.id && q.difficulty === 'medium'
);
const evidence = chunks.filter(c => practice[0].chunk_ids.includes(c.id));
```

概念过滤和原文检索已经可以在本地完成。本交付没有声称生成 embedding 或实现向量检索；以后可以在不改变 chunk ID 的情况下添加向量索引。大量页面图像和答案不应随意全量塞进客户端首屏；未来页面适配器应按需读取，并在测验展示时隐藏答案字段。

## 重建和检查

从本目录执行，使用 Python 3.11 或更新版本：

```sh
python -m pip install -r tools/requirements.txt
python tools/ingest.py assets/Biology_2e_Section_12_2.pdf
python tools/refresh_catalog.py
python tools/validate.py --check-pdf --report validation-report.json
```

`ingest.py` 只重建来源、概念、文本块和图表，**不覆盖题库**。它针对这份 PDF 的布局和章节边界编写，不是任意课本通用的自动切章器。替换 PDF 后必须重新核对概念和题目证据。

校验包括 JSON Schema、320 题配额、各 ID 与外键、所有证据原文子串、选项及答案、串联关系、坐标范围、PDF 文件指纹、每一行的入库/排除覆盖，以及重新渲染后逐像素核对页面和图表。先修改数据，再刷新 catalog，最后校验；不要通过刷新 hash 来掩盖未经评审的来源替换。

## 来源与署名

Mary Ann Clark, Matthew Douglas, Jung Choi. *Biology 2e*. OpenStax. Section 12.2, “Characteristics and Traits.” Access for free at <https://openstax.org/books/biology-2e/pages/12-2-characteristics-and-traits>.

本目录保留 OpenStax 来源署名、图注中的第三方署名及 CC BY-NC-SA 4.0 元数据。来源内容和本目录衍生教学数据按 CC BY-NC-SA 4.0 提供：<https://creativecommons.org/licenses/by-nc-sa/4.0/>。来源页面的当前完整使用条件仍适用，第三方图片的单独权利以各自署名/来源为准。这里没有替项目其余代码重新授权。
