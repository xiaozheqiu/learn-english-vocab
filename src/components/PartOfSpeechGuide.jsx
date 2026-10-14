import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const PARTS_OF_SPEECH = [
  ["n.", "noun", "名词", "给人、东西、地方或想法命名。", "I put the money in the bank.", "我把钱存进银行。"],
  ["v.", "verb", "动词", "表示动作或状态。", "I run three times a week.", "我一周跑三次。"],
  ["adj.", "adjective", "形容词", "描述人或事物的特征，修饰名词。", "I have some free time.", "我有一些空闲时间。"],
  ["adv.", "adverb", "副词", "说明动作的方式、频率或程度。", "I often work late.", "我经常工作到很晚。"],
  ["prep.", "preposition", "介词", "表示位置、时间、方式等关系。", "Let's talk about the plan.", "我们谈谈这个计划。"],
  ["pron.", "pronoun", "代词", "代替名词，避免重复。", "Does anyone know the answer?", "有人知道答案吗？"],
  ["conj.", "conjunction", "连词", "连接词、短语或句子。", "Although it was late, we kept working.", "虽然很晚了，我们还在工作。"],
  ["number", "number", "数词", "表示数目或顺序。", "There are eighteen people in the room.", "房间里有十八个人。"],
  ["det.", "determiner", "限定词", "限定名词的范围、数量或所属。", "Can I have another copy?", "能再给我一份吗？"],
  ["article", "article", "冠词", "限定词的一种，区分特指和泛指。", "I saw a dog. The dog was huge.", "我看到一只狗。那只狗很大。"],
  ["modal v.", "modal verb", "情态动词", "表示能力、可能、许可或必须，后接动词原形。", "Could you send me the file?", "你能把文件发给我吗？"],
  ["auxiliary v.", "auxiliary verb", "助动词", "帮助构成时态、否定和疑问。", "Do you know him?", "你认识他吗？"],
  ["infinitive marker", "infinitive marker", "不定式标记", "to + 动词原形，表示不定式。", "I want to leave early.", "我想早点走。"],
  ["exclam.", "exclamation", "感叹词", "表达情绪、招呼或回应，常可单独成句。", "Bye! See you tomorrow.", "再见！明天见。"],
];

function PartRow({ item }) {
  const [short, english, chinese, description, example, translation] = item;
  return <article className="grid gap-2 border-b border-border/70 px-4 py-4 last:border-b-0 transition-colors hover:bg-accent/25 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(17rem,0.95fr)] sm:items-start sm:gap-5 sm:px-5">
    <div className="flex items-baseline gap-2"><span className="font-semibold text-primary">{short}</span><span className="text-xs text-muted-foreground">{english}</span></div>
    <div className="min-w-0"><div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><h2 className="text-sm font-semibold text-foreground">{chinese}</h2><span className="text-sm text-muted-foreground">{description}</span></div></div>
    <div className="border-l-2 border-accent px-3 text-sm leading-6 text-foreground sm:pl-4"><p className="font-medium">{example}</p><p className="text-xs text-muted-foreground">{translation}</p></div>
  </article>;
}

export default function PartOfSpeechGuide({ onBack }) {
  return <section aria-labelledby="part-of-speech-title">
    <header className="flex items-center justify-between border-b border-border pb-3">
      <h1 id="part-of-speech-title" className="text-lg font-semibold tracking-tight text-foreground">词性对照表</h1>
      <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onBack}><ArrowLeft className="h-4 w-4" />返回词表</Button>
    </header>
    <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-soft">
      <div className="hidden border-b border-border bg-accent/65 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-foreground sm:grid sm:grid-cols-[7rem_minmax(0,1fr)_minmax(17rem,0.95fr)] sm:gap-5"><span>词性</span><span>中文含义</span><span>例句</span></div>
      <div>{PARTS_OF_SPEECH.map((item) => <PartRow key={item[0]} item={item} />)}</div>
    </div>
    <p className="mt-3 text-xs leading-5 text-muted-foreground">组合标记按原词表顺序理解，例如 `n., v.` 表示名词和动词两种用法，`prep., adv.` 表示介词和副词两种用法。</p>
  </section>;
}
