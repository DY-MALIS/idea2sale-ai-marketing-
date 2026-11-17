import React, { useState } from 'react';
import { Check, ChevronDown, Copy, Loader2, Sparkles, Zap } from 'lucide-react';
import { cn } from '../lib/utils';

// PromptGen-style builder for people who don't know how to write prompts:
// tap choices (category, look, mood, lighting, camera, colors), optionally type
// what you're promoting, press "Create prompt" and a well-written, structured
// prompt is placed in the editable box below. "Create prompt & generate" does
// both in one tap.
//
// The prompt can be written in Khmer or English. Khmer prompts are safe to send
// as-is: the server (normalizeMediaPrompt in api/ai.js) translates Khmer image
// and video prompts into English before calling the generation model.

export type PromptBuilderMode = 'image' | 'poster' | 'video';
type PromptLang = 'km' | 'en';

interface Choice {
  id: string;
  en: string;
  km: string;
  // Text inserted into the prompt, per prompt language.
  text: string;
  textKm: string;
  // Optional video-specific text (used for camera movement).
  videoText?: string;
  videoTextKm?: string;
  tipEn?: string;
  tipKm?: string;
}

interface Category extends Choice {
  icon: string;
  role: string; roleKm: string;
  context: string; contextKm: string;
  subject: string; subjectKm: string;
  action: string; actionKm: string;
  setting: string; settingKm: string;
}

// "Let AI choose": no preset -- the server (action 'promptWrite') picks the
// setting, mood, lighting, camera and colors and writes the prompt itself.
const AI_CATEGORY_ID = 'ai';

const CATEGORIES: Category[] = [
  {
    id: AI_CATEGORY_ID, icon: '✨', en: 'Let AI', km: 'AI ជ្រើស', text: '', textKm: '',
    tipEn: 'Type your idea, AI does the rest', tipKm: 'វាយគំនិត AI ធ្វើនៅសល់',
    role: '', roleKm: '', context: '', contextKm: '', subject: '', subjectKm: '', action: '', actionKm: '', setting: '', settingKm: '',
  },
  {
    id: 'product', icon: '📦', en: 'Product', km: 'ផលិតផល', text: '', textKm: '',
    role: 'professional commercial product photographer', roleKm: 'អ្នកថតរូបផលិតផលអាជីព',
    context: 'a social media ad that makes people want to buy', contextKm: 'ការផ្សាយពាណិជ្ជកម្មលើបណ្ដាញសង្គម ដែលធ្វើឲ្យអ្នកមើលចង់ទិញ',
    subject: 'the product as the clear hero', subjectKm: 'ផលិតផលជាតួឯកច្បាស់លាស់',
    action: 'presented by a hand placing it gently in frame', actionKm: 'មានដៃមួយដាក់ផលិតផលថ្នមៗចូលក្នុងរូប',
    setting: 'on a clean wooden table in a bright, modern Cambodian home', settingKm: 'នៅលើតុឈើស្អាត ក្នុងផ្ទះខ្មែរទំនើប និងភ្លឺស្រឡះ',
  },
  {
    id: 'food', icon: '🍜', en: 'Food', km: 'ម្ហូប', text: '', textKm: '',
    role: 'food photographer for a popular restaurant', roleKm: 'អ្នកថតរូបម្ហូបសម្រាប់ភោជនីយដ្ឋានល្បី',
    context: 'a menu promotion that makes viewers hungry', contextKm: 'ការផ្សព្វផ្សាយមុខម្ហូប ដែលធ្វើឲ្យអ្នកមើលឃ្លាន',
    subject: 'a fresh signature dish or drink', subjectKm: 'ម្ហូប ឬភេសជ្ជៈពិសេសដែលទើបធ្វើរួចថ្មីៗ',
    action: 'with steam rising and sauce or ice glistening', actionKm: 'មានចំហាយហុយឡើង និងទឹកជ្រលក់ ឬទឹកកកភ្លឺរលោង',
    setting: 'on a cozy local restaurant table in Phnom Penh', settingKm: 'នៅលើតុក្នុងភោជនីយដ្ឋានកក់ក្ដៅមួយនៅភ្នំពេញ',
  },
  {
    id: 'cafe', icon: '☕', en: 'Cafe', km: 'កាហ្វេ', text: '', textKm: '',
    role: 'lifestyle photographer for a specialty coffee brand', roleKm: 'អ្នកថតរូបរបៀបរស់នៅសម្រាប់ម៉ាកកាហ្វេពិសេស',
    context: 'a post that invites people to visit the cafe', contextKm: 'ការបង្ហោះដែលអញ្ជើញមនុស្សឲ្យមកលេងហាងកាហ្វេ',
    subject: 'a beautifully made coffee drink', subjectKm: 'កាហ្វេមួយកែវដែលឆុងយ៉ាងស្អាត',
    action: 'being served across the counter by a smiling barista', actionKm: 'បារីស្តាញញឹមកំពុងហុចឲ្យភ្ញៀវនៅតុបញ្ជរ',
    setting: 'inside a stylish modern cafe in Phnom Penh', settingKm: 'នៅក្នុងហាងកាហ្វេទំនើប និងស្អាតមួយនៅភ្នំពេញ',
  },
  {
    id: 'fashion', icon: '👗', en: 'Fashion', km: 'ម៉ូដ', text: '', textKm: '',
    role: 'fashion editorial photographer', roleKm: 'អ្នកថតរូបម៉ូដសម្រាប់ទស្សនាវដ្ដី',
    context: 'a new collection launch for an online shop', contextKm: 'ការដាក់លក់ម៉ូដថ្មីសម្រាប់ហាងអនឡាញ',
    subject: 'a young Cambodian model wearing the outfit or product', subjectKm: 'តារាម៉ូដែលខ្មែរវ័យក្មេងស្លៀកពាក់ ឬប្រើផលិតផល',
    action: 'walking confidently and smiling', actionKm: 'កំពុងដើរដោយទំនុកចិត្ត និងញញឹម',
    setting: 'on a stylish street in Phnom Penh with a softly blurred background', settingKm: 'នៅលើផ្លូវដ៏ស្អាតមួយនៅភ្នំពេញ ផ្ទៃខាងក្រោយព្រិលស្រាលៗ',
  },
  {
    id: 'tech', icon: '🤖', en: 'Tech & AI', km: 'បច្ចេកវិទ្យា', text: '', textKm: '',
    role: 'high-end tech advertising art director', roleKm: 'អ្នកដឹកនាំសិល្បៈពាណិជ្ជកម្មបច្ចេកវិទ្យាកម្រិតខ្ពស់',
    context: 'promoting an AI course or tech service to young professionals', contextKm: 'ការផ្សព្វផ្សាយវគ្គសិក្សា AI ឬសេវាបច្ចេកវិទ្យាដល់យុវជនអ្នកជំនាញ',
    subject: 'two stylish young Cambodian professionals in the foreground', subjectKm: 'យុវជនអ្នកជំនាញខ្មែរពីរនាក់ ស្លៀកពាក់ទាន់សម័យ នៅខាងមុខ',
    action: 'exploring glowing holographic dashboards and charts together', actionKm: 'កំពុងមើលផ្ទាំងទិន្នន័យ និងក្រាហ្វហូឡូក្រាមដែលភ្លឺចែងចាំងជាមួយគ្នា',
    setting: 'in a modern glass office with a city skyline at dusk', settingKm: 'នៅក្នុងការិយាល័យកញ្ចក់ទំនើប មើលឃើញទេសភាពទីក្រុងពេលព្រលប់',
  },
  {
    id: 'education', icon: '🎓', en: 'Class', km: 'ថ្នាក់រៀន', text: '', textKm: '',
    role: 'brand photographer for an education academy', roleKm: 'អ្នកថតរូបម៉ាកយីហោសម្រាប់សាលាបណ្ដុះបណ្ដាល',
    context: 'an enrollment campaign for a new course', contextKm: 'យុទ្ធនាការចុះឈ្មោះចូលរៀនវគ្គថ្មី',
    subject: 'a friendly, elegant teacher with two engaged Cambodian students in the foreground', subjectKm: 'គ្រូរួសរាយ ស្អាតបាត ជាមួយសិស្សខ្មែរពីរនាក់នៅខាងមុខ',
    action: 'discussing ideas with laptops open and hands raised', actionKm: 'កំពុងពិភាក្សា បើកកុំព្យូទ័រយួរដៃ និងលើកដៃសួរ',
    setting: 'in a bright modern classroom', settingKm: 'នៅក្នុងថ្នាក់រៀនទំនើប និងភ្លឺស្រឡះ',
  },
  {
    id: 'event', icon: '🎉', en: 'Event', km: 'ព្រឹត្តិការណ៍', text: '', textKm: '',
    role: 'event marketing photographer', roleKm: 'អ្នកថតរូបទីផ្សារព្រឹត្តិការណ៍',
    context: 'announcing a special sale or grand opening', contextKm: 'ការប្រកាសប្រូម៉ូសិនពិសេស ឬពិធីបើកហាង',
    subject: 'happy customers', subjectKm: 'អតិថិជនសប្បាយរីករាយ',
    action: 'celebrating and shopping together', actionKm: 'កំពុងអបអរ និងទិញឥវ៉ាន់ជាមួយគ្នា',
    setting: 'in front of a decorated Cambodian shop', settingKm: 'នៅមុខហាងខ្មែរដែលតុបតែងយ៉ាងស្អាត',
  },
];

// Ids match the style values PosterGen sends, so the choice also drives the
// server-side look (e.g. "Futuristic tech" switches to the hologram template).
const LOOKS: Choice[] = [
  { id: 'Cinematic key visual', en: 'Cinematic ad', km: 'ពាណិជ្ជកម្មបែបភាពយន្ត', text: 'cinematic, award-winning commercial key-visual', textKm: 'បែបពាណិជ្ជកម្មម៉ាកល្បី ស្អាតដូចភាពយន្ត', tipEn: 'Like big-brand ads', tipKm: 'ដូចពាណិជ្ជកម្មម៉ាកធំៗ' },
  { id: 'Natural real photo', en: 'Lifestyle photo', km: 'រូបថតជីវិតពិត', text: 'premium lifestyle editorial photographic', textKm: 'បែបរូបថតជីវិតពិត ស្អាតកក់ក្ដៅ', tipEn: 'People working, cafes, everyday moments', tipKm: 'មនុស្សធ្វើការ ហាងកាហ្វេ ជីវិតប្រចាំថ្ងៃ' },
  { id: 'Clean minimal', en: 'Minimal', km: 'សាមញ្ញ', text: 'clean, minimal', textKm: 'បែបសាមញ្ញ ស្អាត', tipEn: 'Simple and uncluttered', tipKm: 'សាមញ្ញ ស្អាត' },
  { id: 'Bright and cheerful', en: 'Bright & fun', km: 'ភ្លឺ រីករាយ', text: 'bright, cheerful', textKm: 'បែបភ្លឺស្រឡះ និងរីករាយ', tipEn: 'Colorful and happy', tipKm: 'ពណ៌ភ្លឺ សប្បាយ' },
  { id: 'Luxury editorial', en: 'Luxury', km: 'ប្រណីត', text: 'luxury editorial', textKm: 'បែបប្រណីតដូចទស្សនាវដ្ដី', tipEn: 'High-end magazine look', tipKm: 'ដូចទស្សនាវដ្ដីប្រណីត' },
  { id: 'Pop model studio', en: 'Model + product', km: 'តារា + ផលិតផល', text: 'trendy pop-studio model-and-product', textKm: 'បែបតារាកាន់ផលិតផល ផ្ទៃពណ៌ដិតទាន់សម័យ', tipEn: 'Model holding the product on bold color', tipKm: 'តារាកាន់ផលិតផល លើផ្ទៃពណ៌ដិត' },
  { id: '3D cartoon', en: '3D cartoon', km: 'តុក្កតា 3D', text: 'cute polished 3D cartoon', textKm: 'បែបតុក្កតា 3D គួរឲ្យស្រឡាញ់', tipEn: 'Cute 3D characters and robots', tipKm: 'តួអង្គ និងរ៉ូបូត 3D' },
  { id: 'Flat illustration', en: 'Illustration', km: 'គំនូរ', text: 'modern flat vector illustration', textKm: 'បែបគំនូរវ៉ិចទ័រទំនើប', tipEn: 'Clean modern drawing', tipKm: 'គំនូរទំនើប ស្អាត' },
  { id: 'Futuristic tech', en: 'Futuristic', km: 'ទំនើប Futuristic', text: 'futuristic high-tech', textKm: 'បែបបច្ចេកវិទ្យាទំនើបនាពេលអនាគត', tipEn: 'Holograms and neon, like ChatGPT AI ads', tipKm: 'ហូឡូក្រាម និងពន្លឺនីអុង' },
  { id: 'Vintage film', en: 'Vintage', km: 'បុរាណ', text: 'vintage film-style', textKm: 'បែបហ្វីលបុរាណ', tipEn: 'Warm retro film look', tipKm: 'បែបហ្វីលចាស់' },
];

const MOODS: Choice[] = [
  { id: 'premium', en: 'Premium', km: 'ថ្លៃថ្នូរ', text: 'premium, confident and trustworthy', textKm: 'ថ្លៃថ្នូរ មានទំនុកចិត្ត និងគួរឲ្យជឿជាក់' },
  { id: 'fun', en: 'Fun', km: 'សប្បាយ', text: 'fun, energetic and joyful', textKm: 'សប្បាយ ស្វាហាប់ និងរីករាយ' },
  { id: 'warm', en: 'Warm', km: 'កក់ក្ដៅ', text: 'warm, cozy and welcoming', textKm: 'កក់ក្ដៅ ផាសុកភាព និងស្វាគមន៍' },
  { id: 'inspiring', en: 'Inspiring', km: 'លើកទឹកចិត្ត', text: 'inspiring, ambitious and innovative', textKm: 'លើកទឹកចិត្ត មានមហិច្ឆតា និងច្នៃប្រឌិត' },
  { id: 'calm', en: 'Calm', km: 'ស្ងប់', text: 'calm, elegant and relaxing', textKm: 'ស្ងប់ស្ងាត់ ឆើតឆាយ និងសម្រាកចិត្ត' },
];

const LIGHTING: Choice[] = [
  { id: 'daylight', en: 'Daylight', km: 'ពន្លឺថ្ងៃ', text: 'soft natural daylight from a window, with gentle shadows', textKm: 'ពន្លឺថ្ងៃធម្មជាតិទន់ៗពីបង្អួច មានស្រមោលស្រាលៗ' },
  { id: 'golden', en: 'Golden hour', km: 'ថ្ងៃលិច', text: 'warm golden-hour sunlight with a soft glow', textKm: 'ពន្លឺថ្ងៃលិចពណ៌មាសកក់ក្ដៅ ភ្លឺទន់ៗ' },
  { id: 'studio', en: 'Studio', km: 'ស្ទូឌីយោ', text: 'bright, even professional studio lighting', textKm: 'ពន្លឺស្ទូឌីយោអាជីព ភ្លឺស្មើល្អ' },
  { id: 'cinematic', en: 'Cinematic', km: 'បែបភាពយន្ត', text: 'dramatic cinematic teal-and-orange lighting with neon accents', textKm: 'ពន្លឺបែបភាពយន្តពណ៌ខៀវបៃតង និងទឹកក្រូច មានពន្លឺនីអុងបន្តិច' },
];

const CAMERA: Choice[] = [
  { id: 'closeup', en: 'Close-up', km: 'ថតជិត', text: 'a close-up at eye level with a shallow depth of field', textKm: 'ថតជិតកម្រិតភ្នែក ផ្ទៃខាងក្រោយព្រិល', videoText: 'a slow push-in from a medium shot to a close-up', videoTextKm: 'កាមេរ៉ារំកិលចូលយឺតៗ ពីថតកណ្ដាលទៅថតជិត' },
  { id: 'wide', en: 'Wide shot', km: 'ថតឆ្ងាយ', text: 'a medium-wide shot that shows the setting while the main people stay large and clearly visible', textKm: 'ថតឆ្ងាយឃើញទិដ្ឋភាពទាំងមូល', videoText: 'a slow, smooth dolly across the whole scene', videoTextKm: 'កាមេរ៉ារំកិលរលូនយឺតៗ កាត់ទិដ្ឋភាពទាំងមូល' },
  { id: 'topdown', en: 'Top-down', km: 'ពីលើចុះ', text: 'a top-down flat-lay view', textKm: 'ថតពីលើចុះក្រោមត្រង់', videoText: 'a top-down shot slowly rotating over the subject', videoTextKm: 'ថតពីលើចុះក្រោម ហើយបង្វិលយឺតៗពីលើប្រធានបទ' },
  { id: 'hero', en: 'Low angle', km: 'ពីក្រោមឡើង', text: 'a low-angle hero shot that makes the subject look powerful', textKm: 'ថតពីក្រោមឡើង ធ្វើឲ្យប្រធានបទមើលទៅខ្លាំងក្លា', videoText: 'a low-angle orbit around the subject', videoTextKm: 'ថតពីក្រោមឡើង ហើយវិលជុំវិញប្រធានបទ' },
  { id: 'tracking', en: 'Following', km: 'តាមដាន', text: 'a candid, documentary-style angle', textKm: 'មុំថតធម្មជាតិ បែបឯកសារ', videoText: 'a smooth tracking shot following the subject', videoTextKm: 'កាមេរ៉ាដើរតាមប្រធានបទយ៉ាងរលូន' },
];

const COLORS: Choice[] = [
  { id: 'natural', en: 'Natural', km: 'ធម្មជាតិ', text: 'natural, true-to-life colors', textKm: 'ពណ៌ធម្មជាតិ ដូចពិត' },
  { id: 'soft', en: 'Soft pastel', km: 'ពណ៌ស្រាល', text: 'a soft pastel palette', textKm: 'ពណ៌ស្រាលៗ បែប pastel' },
  { id: 'vibrant', en: 'Vibrant', km: 'ពណ៌ឆ្អៅ', text: 'vibrant, saturated colors', textKm: 'ពណ៌ឆ្អៅ រស់រវើក' },
  { id: 'dark', en: 'Dark & moody', km: 'ងងឹត ទាក់ទាញ', text: 'a dark, moody palette with rich contrast', textKm: 'ពណ៌ងងឹត ទាក់ទាញ មានកម្រិតពន្លឺផ្ទុយគ្នាខ្លាំង' },
  { id: 'brand', en: 'Navy & orange', km: 'ខៀវចាស់ និងទឹកក្រូច', text: 'deep navy blue with warm orange accents', textKm: 'ពណ៌ខៀវចាស់ លាយពណ៌ទឹកក្រូចកក់ក្ដៅ' },
];

const TYPE_NOUN: Record<PromptLang, Record<PromptBuilderMode, string>> = {
  en: { poster: 'marketing poster photo', image: 'advertising image', video: 'short advertising video' },
  km: { poster: 'រូបថតសម្រាប់ Poster ផ្សព្វផ្សាយ', image: 'រូបភាពផ្សព្វផ្សាយ', video: 'វីដេអូផ្សព្វផ្សាយខ្លី' },
};

const QUALITY: Record<PromptLang, Record<PromptBuilderMode, string>> = {
  en: {
    poster: 'The result is polished and ultra-detailed, with sharp focus, professional color grading and one clear focal point. People look like real Cambodians with natural faces and hands. Leave the image free of any written text.',
    image: 'The result is polished and ultra-detailed, with sharp focus and professional color grading. People look like real Cambodians with natural faces and hands. Leave the image free of any written text.',
    video: 'The motion is smooth and cinematic with a stable camera, and the subject, clothing and lighting stay consistent in every frame. People look like real Cambodians and move naturally.',
  },
  km: {
    poster: 'លទ្ធផលត្រូវស្អាត លម្អិតខ្ពស់ ច្បាស់ ពណ៌កែតម្រូវបែបអាជីព និងមានចំណុចផ្ដោតច្បាស់តែមួយ។ មនុស្សមើលទៅជាជនជាតិខ្មែរពិតប្រាកដ មុខ និងដៃធម្មជាតិ។ កុំដាក់អក្សរណាមួយនៅក្នុងរូប។',
    image: 'លទ្ធផលត្រូវស្អាត លម្អិតខ្ពស់ ច្បាស់ និងពណ៌កែតម្រូវបែបអាជីព។ មនុស្សមើលទៅជាជនជាតិខ្មែរពិតប្រាកដ មុខ និងដៃធម្មជាតិ។ កុំដាក់អក្សរណាមួយនៅក្នុងរូប។',
    video: 'ចលនារលូនបែបភាពយន្ត កាមេរ៉ាមិនញ័រ ហើយប្រធានបទ សម្លៀកបំពាក់ និងពន្លឺដូចគ្នាគ្រប់ស៊ីន។ មនុស្សមើលទៅជាជនជាតិខ្មែរពិតប្រាកដ និងធ្វើចលនាធម្មជាតិ។',
  },
};

const findChoice = <T extends Choice>(list: T[], id: string) => list.find((item) => item.id === id) || list[0];
// Local (non-AI) composition falls back to the first real preset.
const findCategory = (id: string) => CATEGORIES.find((item) => item.id === id && item.id !== AI_CATEGORY_ID) || CATEGORIES[1];

interface Selection {
  category: string;
  look: string;
  mood: string;
  lighting: string;
  camera: string;
  colors: string;
  subject: string;
  details: string;
}

export const composePrompt = (s: Selection, mode: PromptBuilderMode, lang: PromptLang = 'en') => {
  const category = findCategory(s.category);
  const look = findChoice(LOOKS, s.look);
  const mood = findChoice(MOODS, s.mood);
  const lighting = findChoice(LIGHTING, s.lighting);
  const camera = findChoice(CAMERA, s.camera);
  const colors = findChoice(COLORS, s.colors);
  const details = s.details.trim();

  if (lang === 'km') {
    const subject = s.subject.trim() ? `${s.subject.trim()} ជាតួឯកច្បាស់លាស់` : category.subjectKm;
    const cameraText = mode === 'video' ? camera.videoTextKm || camera.textKm : camera.textKm;
    const p1 = `${TYPE_NOUN.km[mode]} ${look.textKm} សម្រាប់${category.contextKm} ដោយមើលតាមភ្នែករបស់${category.roleKm}។ បង្ហាញ${subject} ${category.actionKm} ${category.settingKm}។`;
    const p2 = `អារម្មណ៍៖ ${mood.textKm}។ ពន្លឺ៖ ${lighting.textKm}។ ${mode === 'video' ? 'ចលនាកាមេរ៉ា' : 'មុំថត'}៖ ${cameraText}។ ពណ៌៖ ${colors.textKm}។`;
    const p3 = details ? `ព័ត៌មានបន្ថែម៖ ${details}។` : '';
    return [p1, p2, p3, QUALITY.km[mode]].filter(Boolean).join('\n\n');
  }

  const subject = s.subject.trim() ? `${s.subject.trim()}, featured as the clear hero` : category.subject;
  const cameraText = mode === 'video' ? camera.videoText || camera.text : camera.text;
  const p1 = `A ${look.text} ${TYPE_NOUN.en[mode]} for ${category.context}, created with the eye of a ${category.role}. It shows ${subject}, ${category.action}, ${category.setting}.`;
  const p2 = `The mood is ${mood.text}. The scene is lit with ${lighting.text}. ${mode === 'video' ? 'The camera moves with' : 'It is framed as'} ${cameraText}. The color palette uses ${colors.text}.`;
  const p3 = details ? `Extra details: ${details}.` : '';
  return [p1, p2, p3, QUALITY.en[mode]].filter(Boolean).join('\n\n');
};

interface ChipGroupProps {
  label: string;
  options: Choice[];
  value: string;
  onChange: (id: string) => void;
  km: boolean;
}

// Compact single-line pills; the tip moves to a tooltip to keep rows tidy.
const ChipGroup: React.FC<ChipGroupProps> = ({ label, options, value, onChange, km }) => (
  <div className="space-y-2">
    {label && <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</p>}
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label || undefined}>
      {options.map((option) => {
        const selected = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            title={km ? option.tipKm : option.tipEn}
            onClick={() => onChange(option.id)}
            className={cn(
              'min-h-[36px] whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors',
              selected
                ? 'border-brand-500 bg-brand-500 text-white shadow-sm'
                : 'border-brand-200 bg-brand-50 text-slate-700 hover:border-brand-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
            )}
          >
            {km ? option.km : option.en}
          </button>
        );
      })}
    </div>
  </div>
);

// Topic picker: even 4-column icon tiles with short one-line labels.
const CategoryTiles: React.FC<{ value: string; onChange: (id: string) => void; km: boolean; label: string }> = ({ value, onChange, km, label }) => (
  <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={label}>
    {CATEGORIES.map((category) => {
      const selected = value === category.id;
      return (
        <button
          key={category.id}
          type="button"
          role="radio"
          aria-checked={selected}
          title={km ? category.tipKm : category.tipEn}
          onClick={() => onChange(category.id)}
          className={cn(
            'flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 transition-colors',
            selected
              ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500'
              : 'border-brand-200 bg-brand-50 hover:border-brand-400 dark:border-slate-600 dark:bg-slate-800',
          )}
        >
          <span className="text-xl leading-none" aria-hidden="true">{category.icon}</span>
          <span className={cn('w-full truncate text-center text-[11px] font-semibold', selected ? 'text-brand-700 dark:text-brand-300' : 'text-slate-600 dark:text-slate-300')}>
            {km ? category.km : category.en}
          </span>
        </button>
      );
    })}
  </div>
);

interface PromptBuilderProps {
  mode: PromptBuilderMode;
  language: string;
  onPromptChange: (prompt: string) => void;
  /** Create the prompt and immediately start generation with it. */
  onGenerate?: (prompt: string) => void;
  /** Controlled look, so the form's style (and server template) follows the chip. */
  look?: string;
  onLookChange?: (look: string) => void;
  busy?: boolean;
  /**
   * Poster form: show only topic, product, photo style and language. Mood,
   * lighting, camera and colors still apply, chosen automatically per topic.
   */
  compact?: boolean;
}

const PromptBuilder: React.FC<PromptBuilderProps> = ({ mode, language, onPromptChange, onGenerate, look, onLookChange, busy, compact }) => {
  const km = language === 'km';
  const [promptLang, setPromptLang] = useState<PromptLang>(km ? 'km' : 'en');
  const [selection, setSelection] = useState<Selection>({
    category: 'product',
    look: 'Cinematic key visual',
    mood: 'premium',
    lighting: 'daylight',
    camera: 'closeup',
    colors: 'natural',
    subject: '',
    details: '',
  });
  const [copied, setCopied] = useState(false);
  const [lastPrompt, setLastPrompt] = useState('');

  const currentLook = look && LOOKS.some((item) => item.id === look) ? look : selection.look;
  const update = (patch: Partial<Selection>) => setSelection((prev) => ({ ...prev, ...patch }));

  const chooseCategory = (id: string) => {
    // Sensible defaults per category so one tap already gives a good result.
    const presets: Record<string, Partial<Selection>> = {
      tech: { look: 'Futuristic tech', mood: 'inspiring', lighting: 'cinematic', camera: 'closeup', colors: 'brand' },
      // Every topic except Tech keeps the beautiful Cinematic look; the plainer
      // looks produced dull results when a topic switched to them silently.
      food: { look: 'Cinematic key visual', mood: 'warm', lighting: 'golden', camera: 'closeup', colors: 'vibrant' },
      cafe: { look: 'Cinematic key visual', mood: 'warm', lighting: 'golden', camera: 'closeup', colors: 'vibrant' },
      fashion: { look: 'Cinematic key visual', mood: 'premium', lighting: 'golden', camera: 'hero', colors: 'soft' },
      education: { look: 'Cinematic key visual', mood: 'inspiring', lighting: 'golden', camera: 'closeup', colors: 'brand' },
      event: { look: 'Cinematic key visual', mood: 'fun', lighting: 'cinematic', camera: 'wide', colors: 'vibrant' },
      ai: { look: 'Cinematic key visual' },
      product: { look: 'Cinematic key visual', mood: 'premium', lighting: 'golden', camera: 'hero', colors: 'vibrant' },
    };
    const preset = presets[id] || {};
    update({ category: id, ...preset });
    if (preset.look) onLookChange?.(preset.look);
  };

  const chooseLook = (id: string) => {
    update({ look: id });
    onLookChange?.(id);
  };

  // Video prompts must stay English: the server keeps Khmer text in a video
  // prompt untranslated on purpose (it is treated as spoken dialogue -- see
  // preserveKhmerDuringTranslation in shared/videoSpeech.js). So for video the
  // editable box gets English and a read-only Khmer meaning is shown below.
  const isVideo = mode === 'video';
  const [khmerMeaning, setKhmerMeaning] = useState('');

  const build = (lang: PromptLang = promptLang) => {
    const finalSelection = { ...selection, look: currentLook };
    const prompt = composePrompt(finalSelection, mode, isVideo ? 'en' : lang);
    setKhmerMeaning(isVideo ? composePrompt(finalSelection, mode, 'km') : '');
    setLastPrompt(prompt);
    onPromptChange(prompt);
    return prompt;
  };

  const aiMode = selection.category === AI_CATEGORY_ID;
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');

  // AI writes the whole prompt from the user's idea (server action promptWrite).
  const buildWithAi = async (lang: PromptLang = promptLang): Promise<string | null> => {
    // An empty idea is fine: the server lets AI choose an appealing subject.
    setAiBusy(true);
    setAiError('');
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'promptWrite',
          mode,
          subject: selection.subject,
          details: selection.details,
          look: findChoice(LOOKS, currentLook).text,
          language: lang,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.text) throw new Error(data.error || 'AI could not write the prompt.');
      const prompt = String(data.text);
      setKhmerMeaning('');
      setLastPrompt(prompt);
      onPromptChange(prompt);
      return prompt;
    } catch (error) {
      console.error('AI prompt writing failed:', error);
      setAiError(km ? 'AI មិនអាចសរសេរ prompt បានទេ។ សូមសាកម្ដងទៀត ឬជ្រើសប្រធានបទផ្សេង។' : 'AI could not write the prompt. Try again, or pick a topic instead.');
      return null;
    } finally {
      setAiBusy(false);
    }
  };

  const create = async (lang: PromptLang = promptLang): Promise<string | null> => (aiMode ? buildWithAi(lang) : build(lang));

  const choosePromptLang = (lang: PromptLang) => {
    setPromptLang(lang);
    // Re-write an already-created local prompt in the newly chosen language.
    // (AI mode applies the language to the next "Create prompt" instead of
    // silently making another AI call.)
    if (lastPrompt && !aiMode) build(lang);
  };

  const copy = async () => {
    const prompt = lastPrompt || await create();
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (http, permissions); the prompt is still in the box.
    }
  };

  const inputClass = 'w-full rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm outline-none transition-all focus:ring-2 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

  const sectionLabel = 'text-[11px] font-bold uppercase tracking-wider text-brand-500 dark:text-brand-400';

  return (
    <div className="space-y-5 rounded-2xl border border-brand-200 bg-white/60 p-4 sm:p-5 dark:border-slate-600 dark:bg-slate-900/40">
      <div>
        <p className="text-base font-bold text-brand-700 dark:text-brand-300">
          {compact
            ? (km ? '③ រូបថតសម្រាប់ Poster' : '③ Poster photo')
            : (km ? 'បង្កើត Prompt ដោយមិនចាំបាច់សរសេរ' : 'Create your prompt — no writing needed')}
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
          {km ? 'ជ្រើសប្រធានបទ និងរចនាប័ទ្ម រួចចុចបង្កើត។' : 'Pick a topic and a style, then press create.'}
        </p>
      </div>

      {/* Topic + product */}
      <div className="space-y-3">
        <p className={sectionLabel}>
          {compact
            ? (km ? 'Poster និយាយពីអ្វី?' : 'What is it about?')
            : (km ? '១. ផ្សព្វផ្សាយអ្វី?' : '1. What are you promoting?')}
        </p>
        <CategoryTiles value={selection.category} onChange={chooseCategory} km={km} label={km ? 'ប្រធានបទ' : 'Topic'} />
        <input
          type="text"
          value={selection.subject}
          onChange={(event) => update({ subject: event.target.value })}
          placeholder={aiMode
            ? (km ? 'ផលិតផល ឬគំនិត (មិនចាំបាច់ — ទុកទទេ AI ជ្រើសឲ្យ)' : 'Product or idea (optional — leave empty and AI picks)')
            : (km ? 'ឈ្មោះផលិតផល (មិនចាំបាច់)' : 'Product name (optional)')}
          className={cn(inputClass, aiMode && 'border-brand-500 ring-1 ring-brand-500')}
        />
        {aiMode && (
          <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">
            {km ? '✨ AI ជ្រើសអ្វីៗដែលល្អបំផុត ហើយសរសេរ prompt ពេញលេញឲ្យ។' : '✨ AI picks the best options and writes the full prompt.'}
          </p>
        )}
      </div>

      {/* Style */}
      <div className="space-y-3">
        <p className={sectionLabel}>
          {compact ? (km ? 'រចនាប័ទ្មរូបថត' : 'Photo style') : (km ? '២. រចនាប័ទ្ម' : '2. Style')}
        </p>
        <ChipGroup label="" options={LOOKS} value={currentLook} onChange={chooseLook} km={km} />
      </div>

      {/* Optional fine-tuning, closed by default to keep the form calm */}
      <details className="group rounded-xl border border-brand-100 dark:border-slate-700">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between px-3 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <span>
            {km ? 'ជម្រើសបន្ថែម' : 'More options'}
            <span className="ml-1 font-normal text-slate-400">
              {compact || aiMode
                ? (km ? '(ព័ត៌មានបន្ថែម)' : '(extra details)')
                : (km ? '(អារម្មណ៍ ពន្លឺ មុំថត ពណ៌)' : '(mood, light, camera, color)')}
            </span>
          </span>
          <ChevronDown size={16} className="text-slate-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-4 border-t border-brand-100 p-3 dark:border-slate-700">
          {!compact && !aiMode && (
            <>
              <ChipGroup label={km ? 'អារម្មណ៍' : 'Mood'} options={MOODS} value={selection.mood} onChange={(id) => update({ mood: id })} km={km} />
              <ChipGroup label={km ? 'ពន្លឺ' : 'Lighting'} options={LIGHTING} value={selection.lighting} onChange={(id) => update({ lighting: id })} km={km} />
              <ChipGroup label={mode === 'video' ? (km ? 'ចលនាកាមេរ៉ា' : 'Camera movement') : (km ? 'មុំថត' : 'Camera angle')} options={CAMERA} value={selection.camera} onChange={(id) => update({ camera: id })} km={km} />
              <ChipGroup label={km ? 'ពណ៌' : 'Color tone'} options={COLORS} value={selection.colors} onChange={(id) => update({ colors: id })} km={km} />
            </>
          )}
          <input
            type="text"
            value={selection.details}
            onChange={(event) => update({ details: event.target.value })}
            placeholder={km ? 'ព័ត៌មានបន្ថែម ឧ. មានស្លឹកឈើនៅខាងក្រោយ' : 'Extra details, e.g. green leaves in the background'}
            className={inputClass}
          />
        </div>
      </details>

      {/* Actions */}
      <div className="space-y-3 border-t border-brand-100 pt-4 dark:border-slate-700">
        {!isVideo && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {km ? 'ភាសា Prompt' : 'Prompt language'}
            </span>
            <div className="flex rounded-full border border-brand-200 bg-brand-50 p-0.5 dark:border-slate-600 dark:bg-slate-800" role="radiogroup" aria-label={km ? 'ភាសា Prompt' : 'Prompt language'}>
              {([
                { id: 'km', label: 'ខ្មែរ' },
                { id: 'en', label: 'EN' },
              ] as { id: PromptLang; label: string }[]).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={promptLang === option.id}
                  onClick={() => choosePromptLang(option.id)}
                  className={cn(
                    'min-h-[32px] min-w-[56px] rounded-full px-3 text-xs font-bold transition-colors',
                    promptLang === option.id ? 'bg-brand-500 text-white shadow-sm' : 'text-slate-600 dark:text-slate-300',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={aiBusy}
            onClick={() => void create()}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-brand-500 bg-brand-50 px-4 text-sm font-bold text-brand-700 transition-colors hover:bg-brand-100 disabled:opacity-60 dark:bg-slate-800 dark:text-brand-300"
          >
            {aiBusy ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            {aiBusy
              ? (km ? 'AI កំពុងសរសេរ...' : 'AI is writing...')
              : aiMode
                ? (km ? 'ឲ្យ AI សរសេរ Prompt' : 'AI writes the prompt')
                : (km ? 'បង្កើត Prompt' : 'Create prompt')}
          </button>
          {onGenerate && (
            <button
              type="button"
              disabled={busy || aiBusy}
              onClick={async () => {
                const prompt = await create();
                if (prompt) onGenerate(prompt);
              }}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#f88b3e] to-[#e65d28] px-4 text-sm font-bold text-white shadow-md transition-opacity disabled:opacity-60"
            >
              <Sparkles size={16} />
              {mode === 'video'
                ? (km ? 'Prompt + វីដេអូ' : 'Prompt + video')
                : (km ? 'Prompt + រូបភាព' : 'Prompt + image')}
            </button>
          )}
        </div>
        {aiError && (
          <p role="alert" className="text-xs font-semibold text-red-500">{aiError}</p>
        )}
        {lastPrompt && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {km ? 'Prompt នៅប្រអប់ខាងក្រោម — អាចកែបាន។' : 'Your prompt is in the box below — edit if you like.'}
            </p>
            <button
              type="button"
              onClick={copy}
              className="flex min-h-[32px] shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand-600 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-slate-800"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? (km ? 'បានចម្លង' : 'Copied') : (km ? 'ចម្លង' : 'Copy')}
            </button>
          </div>
        )}
        {isVideo && khmerMeaning && (
          <div className="rounded-xl border border-brand-100 bg-brand-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/70">
            <p className={sectionLabel}>{km ? 'អត្ថន័យជាភាសាខ្មែរ' : 'Meaning in Khmer'}</p>
            <p className="mt-1 whitespace-pre-line text-xs leading-6 text-slate-600 dark:text-slate-300">{khmerMeaning}</p>
            <p className="mt-2 text-[11px] text-slate-400">
              {km
                ? 'Prompt វីដេអូត្រូវតែជាអង់គ្លេស ដើម្បីកុំឲ្យ AI យល់ច្រឡំថាជាពាក្យនិយាយ។'
                : 'Video prompts stay in English so the AI does not mistake Khmer text for spoken lines.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PromptBuilder;
