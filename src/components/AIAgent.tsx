import React, { useMemo, useState } from 'react';
import { Bot, Copy, Loader2, Send, Sparkles, Wand2 } from 'lucide-react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useLanguage } from '../contexts/LanguageContext';

type Platform = 'All' | 'TikTok' | 'Facebook' | 'X';
type AgentMode = 'chat' | 'content' | 'hooks' | 'calendar';

interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

const quickModes: Array<{ id: AgentMode; en: string; km: string }> = [
  { id: 'chat', en: 'Ask Anything', km: 'សួរបញ្ហា' },
  { id: 'content', en: 'Viral Ideas', km: 'គំនិតពេញនិយម' },
  { id: 'hooks', en: 'Hooks & Captions', km: 'Hook និង Caption' },
  { id: 'calendar', en: 'Content Plan', km: 'ផែនការ Content' },
];

const platforms: Platform[] = ['All', 'TikTok', 'Facebook', 'X'];

const samples = {
  en: [
    'Create 10 TikTok content ideas for a beauty product that can go viral.',
    'Why is my TikTok post not getting views? Give me a step-by-step fix.',
    'Write hooks and captions for a Facebook campaign selling an online course.',
  ],
  km: [
    'បង្កើតគំនិត content TikTok 10 ចំណុច សម្រាប់ផលិតផលថែរក្សាសម្រស់។',
    'ហេតុអ្វី post TikTok របស់ខ្ញុំមិនសូវមានអ្នកមើល? សូមប្រាប់វិធីកែ។',
    'សរសេរ hooks និង captions សម្រាប់ campaign Facebook លក់វគ្គសិក្សា online។',
  ],
};

const AIAgent: React.FC = () => {
  const { language } = useLanguage();
  const [platform, setPlatform] = useState<Platform>('All');
  const [mode, setMode] = useState<AgentMode>('content');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>(() => {
    const stored = localStorage.getItem('ai_agent_messages');
    if (!stored) return [];
    try {
      return JSON.parse(stored);
    } catch {
      return [];
    }
  });

  const text = useMemo(() => ({
    title: language === 'km' ? 'AI Agent សួរ-ឆ្លើយ និង Content Trend' : 'AI Agent for Q&A and Trend Content',
    subtitle: language === 'km'
      ? 'សួរបញ្ហា បង្កើតមាតិកាពេញនិយម និងរៀបចំ idea សម្រាប់ TikTok, Facebook និង X។'
      : 'Ask problems, create trend-style content, and plan ideas for TikTok, Facebook, and X.',
    platform: language === 'km' ? 'Platform' : 'Platform',
    prompt: language === 'km' ? 'សំណួរ ឬ Content ដែលចង់បង្កើត' : 'Question or content request',
    placeholder: language === 'km'
      ? 'ឧ. បង្កើត content ពេញនិយមសម្រាប់ TikTok លក់ផលិតផល...'
      : 'e.g. Create viral TikTok content for selling this product...',
    generate: language === 'km' ? 'សួរ AI Agent' : 'Ask AI Agent',
    thinking: language === 'km' ? 'កំពុងគិត...' : 'Thinking...',
    result: language === 'km' ? 'ចម្លើយពី AI Agent' : 'AI Agent Answer',
    empty: language === 'km' ? 'ចម្លើយ និង content idea នឹងបង្ហាញនៅទីនេះ។' : 'Answers and content ideas will appear here.',
    copy: language === 'km' ? 'ចម្លងចម្លើយ' : 'Copy answer',
  }), [language]);

  const persistMessages = (nextMessages: AgentMessage[]) => {
    setMessages(nextMessages);
    localStorage.setItem('ai_agent_messages', JSON.stringify(nextMessages.slice(-12)));
  };

  const askAgent = async (overridePrompt?: string) => {
    const message = (overridePrompt || input).trim();
    if (!message) return;

    const userMessage: AgentMessage = { role: 'user', content: message };
    const nextMessages = [...messages, userMessage];
    persistMessages(nextMessages);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'socialAgent',
          message,
          platform,
          mode,
          language,
          history: messages,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'AI Agent failed.');
      persistMessages([...nextMessages, { role: 'assistant', content: data.text || 'No response generated.' }]);
    } catch (error: any) {
      persistMessages([...nextMessages, { role: 'assistant', content: error.message || 'AI Agent error.' }]);
    } finally {
      setLoading(false);
    }
  };

  const latestAnswer = [...messages].reverse().find((message) => message.role === 'assistant')?.content || '';

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <header className="flex flex-col gap-2">
        <h2 className="text-4xl font-display font-bold text-brand-700 tracking-tight flex items-center gap-3">
          {text.title}
          <Bot className="text-brand-500" size={34} />
        </h2>
        <p className="text-slate-500 text-lg max-w-3xl">{text.subtitle}</p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        <section className="xl:col-span-5 glass rounded-[2.5rem] p-8 space-y-6">
          <div className="space-y-3">
            <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{text.platform}</label>
            <div className="grid grid-cols-4 gap-2">
              {platforms.map((item) => (
                <button
                  key={item}
                  onClick={() => setPlatform(item)}
                  className={cn(
                    'px-3 py-3 rounded-xl text-xs font-bold border transition-all',
                    platform === item
                      ? 'bg-brand-700 text-white border-brand-700 shadow-md'
                      : 'bg-brand-50 text-brand-600 border-brand-100 hover:border-brand-300'
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {quickModes.map((item) => (
              <button
                key={item.id}
                onClick={() => setMode(item.id)}
                className={cn(
                  'px-4 py-3 rounded-xl text-xs font-bold border transition-all',
                  mode === item.id
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white/60 text-brand-600 border-brand-100 hover:border-brand-300'
                )}
              >
                {language === 'km' ? item.km : item.en}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{text.prompt}</label>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={text.placeholder}
              className="w-full h-56 p-5 rounded-2xl bg-brand-50 border border-brand-200 focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none transition-all resize-none font-medium"
            />
          </div>

          <button
            onClick={() => askAgent()}
            disabled={loading || !input.trim()}
            className="w-full bg-gradient-to-r from-brand-600 to-crab-shell hover:from-brand-700 hover:to-crab-shell/90 disabled:from-brand-200 disabled:to-brand-300 text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-3 transition-all shadow-xl shadow-brand-500/20"
          >
            {loading ? <Loader2 className="animate-spin" /> : <Send size={20} />}
            <span>{loading ? text.thinking : text.generate}</span>
          </button>

          <div className="space-y-3 rounded-3xl border border-brand-100 bg-brand-50/50 p-5">
            <div className="flex items-center gap-2 text-sm font-bold text-brand-700">
              <Wand2 size={16} />
              {language === 'km' ? 'ឧទាហរណ៍ងាយប្រើ' : 'Quick examples'}
            </div>
            {(language === 'km' ? samples.km : samples.en).map((sample) => (
              <button
                key={sample}
                onClick={() => {
                  setInput(sample);
                  setMode(sample.includes('hook') || sample.includes('hooks') ? 'hooks' : 'content');
                }}
                className="block w-full rounded-2xl border border-brand-100 bg-white/70 p-3 text-left text-sm text-slate-600 hover:border-brand-300 hover:text-brand-700 transition-all"
              >
                {sample}
              </button>
            ))}
          </div>
        </section>

        <section className="xl:col-span-7 glass rounded-[2.5rem] p-8 min-h-[680px] flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-brand-700 flex items-center gap-2">
              <div className="w-2 h-6 bg-brand-500 rounded-full" />
              {text.result}
            </h3>
            {latestAnswer && (
              <button
                onClick={() => navigator.clipboard.writeText(latestAnswer)}
                className="p-3 bg-brand-50 text-brand-500 hover:bg-brand-100 rounded-xl transition-all border border-brand-200"
                title={text.copy}
              >
                <Copy size={20} />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto pr-2 space-y-4">
            {!messages.length && !loading && (
              <div className="h-full min-h-[480px] flex flex-col items-center justify-center text-center text-brand-400">
                <div className="w-24 h-24 bg-brand-50 rounded-[2rem] flex items-center justify-center border border-brand-100 shadow-inner mb-5">
                  <Sparkles size={40} className="text-brand-200" />
                </div>
                <p className="text-lg font-medium text-brand-600">{text.empty}</p>
              </div>
            )}

            <AnimatePresence>
              {messages.map((message, index) => (
                <motion.div
                  key={`${message.role}-${index}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    'rounded-3xl border p-5',
                    message.role === 'user'
                      ? 'ml-auto max-w-[85%] bg-brand-700 text-white border-brand-700'
                      : 'mr-auto max-w-full bg-brand-50/60 text-slate-700 border-brand-100'
                  )}
                >
                  {message.role === 'assistant' ? (
                    <div className="prose prose-brand max-w-none">
                      <Markdown>{message.content}</Markdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap font-medium">{message.content}</p>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {loading && (
              <div className="mr-auto max-w-[80%] rounded-3xl border border-brand-100 bg-brand-50/60 p-5 text-brand-600 flex items-center gap-3">
                <Loader2 className="animate-spin" size={18} />
                <span className="font-medium">{text.thinking}</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default AIAgent;
