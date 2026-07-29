import { AppError } from './errors.js';

const unsafePatterns = [
  /(?:死にたい|自殺|ころす|殺す|しね)/i,
  /(?:裸|ヌード|エッチ|せっくす|sex|nude|porn)/i,
  /(?:血まみれ|拷問|ばらばら|gore)/i,
  /(?:爆弾|銃|拳銃|weapon|bomb)/i,
];

const privatePatterns = [
  /https?:\/\//i,
  /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/,
  /(?:\+?81[- ]?)?0\d{1,4}[- ]?\d{1,4}[- ]?\d{3,4}/,
  /(?:住所|じゅうしょ|電話番号|でんわばんごう)/i,
  /(?:本名|ほんみょう|学校名|がっこうめい)/i,
  /(?:小学校|中学校|高等学校|幼稚園|保育園)/,
  /(?:都|道|府|県).{0,20}(?:市|区|町|村)/,
  /〒?\d{3}[-−]\d{4}/,
];

// 職業名は自由に考えられるようにしつつ、子ども向けの写真体験として
// 明確に不適切な役割や、入力文を命令として再利用する表現だけを拒否する。
// 「モデル」「アイドル」など一般の職業はここでは拒否せず、画像側の
// 安全な服装・背景テンプレートで年齢相応に表現する。
const unsafeCareerPatterns = [
  /(?:殺し屋|暗殺者?|テロリスト|ギャング|強盗|泥棒|詐欺師|密売人|犯罪者)/i,
  /(?:カジノ|ギャンブル|賭博|パチンコ|アダルト|ポルノ)/i,
  /(?:お酒|アルコール|酒造|たばこ|タバコ|喫煙|麻薬|違法薬物|ドラッグ密売)/i,
  /(?:兵器|武器商|銃職人|爆弾職人|ミサイル開発)/i,
  /(?:前の指示|以前の指示|指示を無視|命令を無視|system\s*prompt|developer\s*message)/i,
];

// 表記ゆれで禁止語をすり抜けないよう、ひらがなはカタカナへ寄せ、
// 空白・記号を除いた後の文字列で夜職名を検査する。
function normalizeCareerSafetyText(value) {
  return String(value)
    .normalize('NFKC')
    .replace(/[ぁ-ゖ]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 0x60))
    .toLowerCase()
    .replace(/[\s　・･·_\/\\()\[\]{}（）「」『』【】、。,.]/g, '')
    .replace(/[-‐‑‒–—―−]/g, '');
}

const nightWorkPatterns = [
  /(?:夜職|ナイトワーク|水商売|風俗|アダルトエンターテインメント)/i,
  /(?:ホストクラブ|キャバクラ|キャバレー|ガールズバー|コンカフェ|ナイトクラブ|キャバ嬢|クラブ嬢|ラウンジ嬢|フロアレディ|黒服)/i,
  /^(?:男性|女性)?(?:ホスト|ホステス)(?:スタッフ|キャスト|接客係)?$/i,
  /^(?:バー|ラウンジ|スナック)(?:ノ)?(?:店員|スタッフ|キャスト|接客係|ママ)$/i,
  /^クラブ(?:ノ)?(?:店員|スタッフ|キャスト|接客係|ママ|ボーイ)$/i,
  /^(?:バーテンダー|キャバクラボーイ)$/i,
  /接待飲食店(?:ノ)?(?:店員|スタッフ|キャスト|接客係)?/i,
  /^(?:host|hostess|bartender|floorlady|barstaff|barcast|clubhostess|loungehostess|loungestaff|snackbarmama)$/i,
  /(?:hostclub|cabarethostess?|nightclub|girlsbar|conceptcafecast|adultentertainment)/i,
];

const fictionalCareerNamePatterns = [
  /(?:架空|空想|魔法使い|勇者|王様|お姫様|ドラゴン(?:使い|トレーナー)|モンスター(?:使い|トレーナー)|タイムトラベラー|超能力者|発見士|夢案内士)/i,
  /(?:恐竜|ドラゴン|モンスター|宇宙人|動物)(?:会話)?通訳士?/i,
  /(?:する|している)人$/,
  /(?:を|で|に).{0,16}(?:する|している|作る|描く|飛ぶ|助ける|教える|調べる|守る|運ぶ|直す)人$/,
];

export function assertChildSafe(text) {
  if (unsafePatterns.some((pattern) => pattern.test(text))) {
    throw new AppError('NEEDS_STAFF', 'この内容はスタッフといっしょに確認してください。', 422);
  }
  if (privatePatterns.some((pattern) => pattern.test(text))) {
    throw new AppError('PRIVATE_INFO', '住所・電話・メールは入れないでください。', 422);
  }
  return text;
}

export function assertCareerIdeaSafe(text) {
  assertChildSafe(text);
  const normalizedCareerText = normalizeCareerSafetyText(text);
  if (
    unsafeCareerPatterns.some((pattern) => pattern.test(text))
    || nightWorkPatterns.some((pattern) => pattern.test(normalizedCareerText))
  ) {
    throw new AppError('NEEDS_STAFF', 'この内容は別の仕事のアイデアに言い換えてください。', 422);
  }
  return text;
}

export function assertExistingCareerName(text) {
  assertCareerIdeaSafe(text);
  if (fictionalCareerNamePatterns.some((pattern) => pattern.test(text))) {
    throw new AppError('CAREER_NOT_EXISTING', '実在する一般的な職業名に言い換えてください。', 422);
  }
  return text;
}

export function safePromptFragment(text, max = 120) {
  return String(text).replace(/[{}<>`]/g, '').slice(0, max);
}
