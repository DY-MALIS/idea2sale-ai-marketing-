import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Copy, Image as ImageIcon, ImagePlus, Loader2, Mic, MicOff, RefreshCw, Send, Sparkles, UserRound, Video, X, Zap } from 'lucide-react';
import Markdown from 'react-markdown';
import { AnimatePresence, motion } from 'motion/react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { BusinessProfileData, CreativeAutomationRequest } from '../types';

const DEMO_BUSINESS_PROFILE_STORAGE_KEY = 'demo_business_profile';
const DEMO_AGENT_CONVERSATION_STORAGE_KEY = 'demo_agent_conversation';

interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  imageDataUrls?: string[];
}

interface AttachedImage {
  base64: string;
  mimeType: string;
}

interface AIAgentProps {
  onCreativeAutomation: (request: CreativeAutomationRequest) => void;
}

const MAX_MESSAGES = 40;
const HISTORY_MESSAGES = 20;
const MAX_IMAGES = 4;

const detectMessageLanguage = (message: string) => (
  /[\u1780-\u17FF]/.test(message) ? 'km' : 'en'
);

interface AgentBusinessContext {
  businessName: string;
  directory: { name: string; type: string }[];
}

const AIAgent: React.FC<AIAgentProps> = ({ onCreativeAutomation }) => {
  const { language } = useLanguage();
  const { user, isDemoMode } = useAuth();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoCreateEnabled, setAutoCreateEnabled] = useState(true);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [businessContext, setBusinessContext] = useState<AgentBusinessContext | null>(null);
  // Which language the user is about to speak for voice input. Independent from the
  // UI display language, since people often keep the interface in one language while
  // speaking another (e.g. English UI, Khmer speech) — tying recognition to the UI
  // language made the recognizer use the wrong locale and mangle the transcript.
  const [voiceInputLanguage, setVoiceInputLanguage] = useState<'km' | 'en'>(language === 'km' ? 'km' : 'en');
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<any>(null);
  // Guards against overwriting the just-loaded saved conversation with an empty
  // autosave that could otherwise fire before the initial load resolves.
  const memoryLoadedRef = useRef(false);

  const speechRecognitionSupported = typeof window !== 'undefined'
    && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  useEffect(() => () => requestControllerRef.current?.abort(), []);
  useEffect(() => () => recognitionRef.current?.stop(), []);

  // Long-term memory: reload the saved conversation and business profile so the
  // agent keeps context across page reloads and sessions instead of forgetting
  // everything the moment the tab closes.
  useEffect(() => {
    memoryLoadedRef.current = false;
    const loadMemory = async () => {
      try {
        if (isDemoMode || !user) {
          const savedConversation = JSON.parse(localStorage.getItem(DEMO_AGENT_CONVERSATION_STORAGE_KEY) || 'null');
          if (Array.isArray(savedConversation) && savedConversation.length) {
            setMessages(savedConversation.slice(-MAX_MESSAGES));
          }
          const savedProfile = JSON.parse(localStorage.getItem(DEMO_BUSINESS_PROFILE_STORAGE_KEY) || 'null');
          if (savedProfile) {
            setBusinessContext({ businessName: savedProfile.businessName || '', directory: savedProfile.directory || [] });
          }
        } else {
          const [conversationSnap, profileSnap] = await Promise.all([
            getDoc(doc(db, 'agent_conversations', user.uid)),
            getDoc(doc(db, 'business_profiles', user.uid)),
          ]);
          if (conversationSnap.exists()) {
            const saved = conversationSnap.data()?.messages;
            if (Array.isArray(saved) && saved.length) setMessages(saved.slice(-MAX_MESSAGES));
          }
          if (profileSnap.exists()) {
            const data = profileSnap.data() as BusinessProfileData;
            setBusinessContext({ businessName: data.businessName || '', directory: data.directory || [] });
          }
        }
      } catch (error) {
        console.error('Failed to load agent memory:', error);
      } finally {
        memoryLoadedRef.current = true;
      }
    };
    void loadMemory();
  }, [user, isDemoMode]);

  // Only the text survives into persisted memory — attached image previews are
  // base64 data URLs that would blow past Firestore's 1MB document limit and
  // add real storage cost within a handful of exchanges, so they stay session-only.
  const persistConversation = (nextMessages: AgentMessage[]) => {
    if (!memoryLoadedRef.current) return;
    const textOnly = nextMessages.map(({ role, content }) => ({ role, content }));
    try {
      if (isDemoMode || !user) {
        localStorage.setItem(DEMO_AGENT_CONVERSATION_STORAGE_KEY, JSON.stringify(textOnly));
      } else {
        void setDoc(doc(db, 'agent_conversations', user.uid), {
          messages: textOnly,
          userId: user.uid,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      console.error('Failed to save agent memory:', error);
    }
  };

  const text = useMemo(() => ({
    title: language === 'km' ? 'AI Agent ឆ្លាតវៃ' : 'Intelligent AI Agent',
    subtitle: language === 'km'
      ? 'សួរអ្វីក៏បាន ឬប្រាប់ Agent ឲ្យបង្កើត Content, ដោះស្រាយបញ្ហា និងរៀបចំផែនការសម្រាប់ TikTok, Facebook, X ឬ Telegram។'
      : 'Ask anything, create content, troubleshoot problems, or plan work for TikTok, Facebook, X, and Telegram.',
    prompt: language === 'km' ? 'តើអ្នកចង់សួរ ឬឲ្យ Agent ធ្វើអ្វី?' : 'What would you like the agent to help with?',
    placeholder: language === 'km'
      ? 'សរសេរសំណួរ ឬការងាររបស់អ្នកនៅទីនេះ...'
      : 'Ask a question or describe what you want to create...',
    send: language === 'km' ? 'ផ្ញើទៅ Agent' : 'Ask Agent',
    thinking: language === 'km' ? 'កំពុងគិត និងវិភាគ...' : 'Thinking and analyzing...',
    result: language === 'km' ? 'ការសន្ទនាជាមួយ Agent' : 'Agent Conversation',
    emptyTitle: language === 'km' ? 'Agent រួចរាល់សម្រាប់ជួយអ្នក' : 'Your agent is ready',
    empty: language === 'km'
      ? 'សួរសំណួរ បង្កើត Content ឬពិពណ៌នាបញ្ហាដែលអ្នកចង់ដោះស្រាយ។'
      : 'Ask a question, request content, or describe a problem you want to solve.',
    copy: language === 'km' ? 'ចម្លងចម្លើយចុងក្រោយ' : 'Copy latest answer',
    clear: language === 'km' ? 'សន្ទនាថ្មី' : 'New chat',
    user: language === 'km' ? 'អ្នក' : 'You',
    agent: language === 'km' ? 'AI Agent' : 'AI Agent',
    inputHint: language === 'km' ? 'ចុច Enter ដើម្បីផ្ញើ · Shift + Enter ដើម្បីចុះបន្ទាត់' : 'Enter to send · Shift + Enter for a new line',
    autoCreate: language === 'km' ? 'បង្កើតរូប/វីដេអូស្វ័យប្រវត្តិ' : 'Automatic image/video creation',
    autoCreateHelp: language === 'km'
      ? 'ពេលព័ត៌មានគ្រប់ Agent នឹងបើក generator និងចាប់ផ្តើមបង្កើតភ្លាម។'
      : 'When the brief is complete, the agent opens the right generator and starts creating.',
    attachImage: language === 'km' ? 'ភ្ជាប់រូបភាព' : 'Attach image',
    removeImage: language === 'km' ? 'ដកចេញ' : 'Remove',
    voiceInput: language === 'km' ? 'និយាយសំណួរ' : 'Voice input',
    listening: language === 'km' ? 'កំពុងស្តាប់...' : 'Listening...',
  }), [language]);

  const updateMessages = (nextMessages: AgentMessage[]) => {
    const trimmed = nextMessages.slice(-MAX_MESSAGES);
    setMessages(trimmed);
    persistConversation(trimmed);
  };

  const startNewChat = () => {
    requestControllerRef.current?.abort();
    setMessages([]);
    setInput('');
    setLoading(false);
    persistConversation([]);
  };

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    const remainingSlots = MAX_IMAGES - attachedImages.length;
    files.slice(0, Math.max(remainingSlots, 0)).forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        if (base64) {
          setAttachedImages((current) => (
            current.length >= MAX_IMAGES ? current : [...current, { base64, mimeType: file.type }]
          ));
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleRemoveImage = (index: number) => {
    setAttachedImages((current) => current.filter((_, i) => i !== index));
  };

  const toggleVoiceInput = () => {
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = voiceInputLanguage === 'km' ? 'km-KH' : 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results as ArrayLike<any>)
        .map((result: any) => result?.[0]?.transcript || '')
        .join(' ')
        .trim();
      if (transcript) {
        setInput((current) => (current ? `${current} ${transcript}` : transcript));
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const askAgent = async () => {
    const message = input.trim();
    if ((!message && !attachedImages.length) || loading) return;

    const history = messages.slice(-HISTORY_MESSAGES);
    const userMessage: AgentMessage = {
      role: 'user',
      content: message || (language === 'km' ? '(រូបភាពភ្ជាប់)' : '(Attached image)'),
      imageDataUrls: attachedImages.length
        ? attachedImages.map((image) => `data:${image.mimeType};base64,${image.base64}`)
        : undefined,
    };
    const pendingMessages = [...messages, userMessage].slice(-MAX_MESSAGES);
    const imagesForRequest = attachedImages;
    updateMessages(pendingMessages);
    setInput('');
    setAttachedImages([]);
    setLoading(true);

    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;

    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          action: 'socialAgent',
          message,
          platform: 'Auto',
          mode: 'auto',
          language,
          detectedLanguage: message ? detectMessageLanguage(message) : language,
          history,
          images: imagesForRequest.map((image) => ({ base64: image.base64, mimeType: image.mimeType })),
          businessContext: businessContext || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'AI Agent failed.');

      updateMessages([
        ...pendingMessages,
        { role: 'assistant', content: String(data.text || 'No response generated.').trim() },
      ]);

      if (autoCreateEnabled && data.automation?.ready) {
        const kind = data.automation.kind === 'video' ? 'video' : 'image';
        onCreativeAutomation({
          id: `${Date.now()}-${kind}`,
          kind,
          prompt: String(data.automation.prompt || '').trim(),
          platform: ['TikTok', 'Facebook', 'X', 'Telegram'].includes(data.automation.platform)
            ? data.automation.platform
            : 'General',
          aspectRatio: ['1:1', '9:16', '16:9', '4:5', '3:4'].includes(data.automation.aspectRatio)
            ? data.automation.aspectRatio
            : (kind === 'video' ? '9:16' : '1:1'),
          language: message ? detectMessageLanguage(message) : language,
          voiceOverText: kind === 'video' ? String(data.automation.voiceOverText || '').trim() : undefined,
        });
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        updateMessages([
          ...pendingMessages,
          {
            role: 'assistant',
            content: error?.message || (language === 'km' ? 'Agent មិនអាចឆ្លើយបាននៅពេលនេះ។' : 'The agent could not respond right now.'),
          },
        ]);
      }
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setLoading(false);
      }
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
        <p className="text-slate-500 dark:text-slate-400 text-lg max-w-4xl">{text.subtitle}</p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        <section className="xl:col-span-4 glass rounded-[2rem] p-7 space-y-5 self-start">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-brand-700 uppercase tracking-widest">{text.prompt}</label>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void askAgent();
                }
              }}
              placeholder={text.placeholder}
              className="w-full min-h-60 p-5 rounded-2xl bg-brand-50 border border-brand-200 focus:ring-2 focus:ring-brand-500 focus:bg-white dark:focus:bg-slate-800 outline-none transition-all resize-y font-medium"
            />
            <p className="text-xs text-slate-400 dark:text-slate-400">{text.inputHint}</p>

            <div className="flex items-center gap-2">
              <label
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/70 dark:bg-slate-800/70 border border-brand-200 text-brand-600 hover:bg-brand-50 dark:hover:bg-slate-700 cursor-pointer transition-all text-xs font-bold"
                title={text.attachImage}
              >
                <ImagePlus size={16} />
                {text.attachImage}
                <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageSelect} />
              </label>

              {speechRecognitionSupported && (
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  title={isListening ? text.listening : text.voiceInput}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-all ${
                    isListening
                      ? 'bg-red-500 border-red-500 text-white animate-pulse'
                      : 'bg-white/70 dark:bg-slate-800/70 border-brand-200 text-brand-600 hover:bg-brand-50 dark:hover:bg-slate-700'
                  }`}
                >
                  {isListening ? <MicOff size={16} /> : <Mic size={16} />}
                  {isListening ? text.listening : text.voiceInput}
                </button>
              )}

              {speechRecognitionSupported && (
                <div className="flex bg-brand-50 dark:bg-slate-800/70 p-1 rounded-xl border border-brand-200">
                  {(['km', 'en'] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      disabled={isListening}
                      onClick={() => setVoiceInputLanguage(lang)}
                      title={language === 'km' ? 'ភាសាដែលអ្នកនឹងនិយាយ' : 'Language you will speak'}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all disabled:opacity-50 ${
                        voiceInputLanguage === lang
                          ? 'bg-white dark:bg-slate-700 text-brand-700 shadow-sm'
                          : 'text-brand-400 hover:text-brand-700'
                      }`}
                    >
                      {lang === 'km' ? 'ខ្មែរ' : 'English'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {attachedImages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachedImages.map((image, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 p-2 rounded-2xl bg-brand-50 border border-brand-100"
                  >
                    <img
                      src={`data:${image.mimeType};base64,${image.base64}`}
                      className="w-10 h-10 rounded-xl object-cover"
                      alt="Attached"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(index)}
                      title={text.removeImage}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-4 rounded-2xl border border-brand-200 bg-white/70 dark:bg-slate-800/70 p-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <Zap size={18} />
              </span>
              <div>
                <p className="text-sm font-bold text-brand-700">{text.autoCreate}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{text.autoCreateHelp}</p>
                <div className="mt-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-brand-400">
                  <ImageIcon size={13} />
                  <span>Image</span>
                  <Video size={13} className="ml-1" />
                  <span>Video</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoCreateEnabled}
              onClick={() => setAutoCreateEnabled((enabled) => !enabled)}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                autoCreateEnabled ? 'bg-emerald-500' : 'bg-slate-300'
              }`}
              title={text.autoCreate}
            >
              <span
                className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  autoCreateEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <button
            onClick={() => void askAgent()}
            disabled={loading || (!input.trim() && !attachedImages.length)}
            className="w-full bg-gradient-to-r from-brand-600 to-crab-shell hover:from-brand-700 hover:to-crab-shell/90 disabled:from-brand-200 disabled:to-brand-300 text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-3 transition-all shadow-xl shadow-brand-500/20"
          >
            {loading ? <Loader2 className="animate-spin" /> : <Send size={20} />}
            <span>{loading ? text.thinking : text.send}</span>
          </button>
        </section>

        <section className="xl:col-span-8 glass rounded-[2rem] p-7 min-h-[650px] flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <h3 className="text-xl font-bold text-brand-700 flex items-center gap-2">
              <span className="w-2 h-6 bg-brand-500 rounded-full" />
              {text.result}
            </h3>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <button
                  onClick={startNewChat}
                  className="px-4 py-3 bg-white/70 dark:bg-slate-800/70 text-brand-600 hover:bg-brand-50 dark:hover:bg-slate-700 rounded-xl transition-all border border-brand-200 flex items-center gap-2 text-sm font-bold"
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

          <div className="flex-1 max-h-[720px] overflow-y-auto pr-2 space-y-4">
            {!messages.length && !loading && (
              <div className="h-full min-h-[500px] flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 bg-brand-50 rounded-3xl flex items-center justify-center border border-brand-100 shadow-inner mb-5">
                  <Bot size={38} className="text-brand-400" />
                </div>
                <p className="text-lg font-bold text-brand-700">{text.emptyTitle}</p>
                <p className="mt-2 max-w-md text-slate-500 dark:text-slate-400">{text.empty}</p>
              </div>
            )}

            <AnimatePresence initial={false}>
              {messages.map((message, index) => {
                const isUser = message.role === 'user';
                return (
                  <motion.article
                    key={`${message.role}-${index}-${message.content.slice(0, 20)}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    {!isUser && (
                      <div className="mt-1 h-9 w-9 shrink-0 rounded-xl bg-brand-600 text-white flex items-center justify-center">
                        <Bot size={18} />
                      </div>
                    )}
                    <div
                      className={`max-w-[88%] rounded-2xl px-5 py-4 ${
                        isUser
                          ? 'bg-brand-600 text-white rounded-br-md'
                          : 'border border-brand-100 bg-brand-50/70 text-slate-700 dark:text-slate-300 rounded-bl-md'
                      }`}
                    >
                      <p className={`mb-2 text-[10px] font-bold uppercase tracking-widest ${isUser ? 'text-white/70' : 'text-brand-500'}`}>
                        {isUser ? text.user : text.agent}
                      </p>
                      {isUser ? (
                        <>
                          {!!message.imageDataUrls?.length && (
                            <div className="mb-2 flex flex-wrap gap-2">
                              {message.imageDataUrls.map((url, index) => (
                                <img
                                  key={index}
                                  src={url}
                                  alt="Attached"
                                  className="max-h-48 rounded-xl object-cover"
                                />
                              ))}
                            </div>
                          )}
                          <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                        </>
                      ) : (
                        <div className="prose prose-brand max-w-none">
                          <Markdown>{message.content}</Markdown>
                        </div>
                      )}
                    </div>
                    {isUser && (
                      <div className="mt-1 h-9 w-9 shrink-0 rounded-xl bg-white dark:bg-slate-800 border border-brand-200 text-brand-600 flex items-center justify-center">
                        <UserRound size={18} />
                      </div>
                    )}
                  </motion.article>
                );
              })}
            </AnimatePresence>

            {loading && (
              <div className="flex items-start gap-3">
                <div className="mt-1 h-9 w-9 shrink-0 rounded-xl bg-brand-600 text-white flex items-center justify-center">
                  <Bot size={18} />
                </div>
                <div className="rounded-2xl rounded-bl-md border border-brand-100 bg-brand-50/70 px-5 py-4 text-brand-600 flex items-center gap-3">
                  <Loader2 className="animate-spin" size={18} />
                  <span className="font-medium">{text.thinking}</span>
                </div>
              </div>
            )}
            <div ref={conversationEndRef} />
          </div>
        </section>
      </div>
    </div>
  );
};

export default AIAgent;
