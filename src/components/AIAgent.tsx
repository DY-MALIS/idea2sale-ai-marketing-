import React, { useMemo, useState } from 'react';
import { Copy, Loader2, RefreshCw, Send, Sparkles } from 'lucide-react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';

interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

const AIAgent: React.FC = () => {
  const { language } = useLanguage();
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
    title: language === 'km' ? 'AI Agent បង្កើត Content' : 'AI Content Agent',
    subtitle: language === 'km'
      ? 'សរសេរថាអ្នកចង់បង្កើត content អំពីអ្វី។ Agent នឹងរៀបចំឲ្យសម្រាប់ TikTok, Facebook ឬ X តាមអ្វីដែលអ្នកបានប្រាប់។'
      : 'Tell the agent what content you want. It will prepare the right TikTok, Facebook, or X content from your request.',
    prompt: language === 'km' ? 'អ្នកចង់បង្កើត Content អំពីអ្វី?' : 'What content do you want to create?',
    placeholder: language === 'km'
      ? 'ឧ. ខ្ញុំចង់បង្កើត content TikTok សម្រាប់លក់ផលិតផលថែរក្សាសម្រស់ ឲ្យមើលទៅពេញនិយម និងមាន caption...'
      : 'e.g. I want TikTok content for selling a beauty product with viral hooks and captions...',
    generate: language === 'km' ? 'បង្កើត Content' : 'Create Content',
    thinking: language === 'km' ? 'កំពុងគិត...' : 'Thinking...',
    result: language === 'km' ? 'Content ដែលបានបង្កើត' : 'Generated Content',
    empty: language === 'km' ? 'Content ដែលបានបង្កើតនឹងបង្ហាញនៅទីនេះ។' : 'Generated content will appear here.',
    copy: language === 'km' ? 'ចម្លងចម្លើយ' : 'Copy answer',
    clear: language === 'km' ? 'Chat ថ្មី' : 'New chat',
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
          platform: 'Auto',
          mode: 'auto',
          language,
          history: nextMessages.slice(-8),
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
          <Sparkles className="text-brand-500" size={34} />
        </h2>
        <p className="text-slate-500 text-lg max-w-3xl">{text.subtitle}</p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        <section className="xl:col-span-4 glass rounded-[2.5rem] p-8 space-y-6 self-start">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{text.prompt}</label>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={text.placeholder}
              className="w-full h-72 p-5 rounded-2xl bg-brand-50 border border-brand-200 focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none transition-all resize-none font-medium"
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
        </section>

        <section className="xl:col-span-8 glass rounded-[2.5rem] p-8 min-h-[620px] flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-brand-700 flex items-center gap-2">
              <div className="w-2 h-6 bg-brand-500 rounded-full" />
              {text.result}
            </h3>
            <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={() => persistMessages([])}
                className="px-4 py-3 bg-white/70 text-brand-600 hover:bg-brand-50 rounded-xl transition-all border border-brand-200 flex items-center gap-2 text-sm font-bold"
                title={text.clear}
              >
                <RefreshCw size={16} />
                {text.clear}
              </button>
            )}
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
                  className={`rounded-3xl border p-5 ${
                    message.role === 'user'
                      ? 'ml-auto max-w-[85%] bg-brand-700 text-white border-brand-700'
                      : 'mr-auto max-w-full bg-brand-50/60 text-slate-700 border-brand-100'
                  }`}
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
