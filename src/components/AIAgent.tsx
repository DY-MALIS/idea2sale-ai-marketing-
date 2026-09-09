import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CalendarClock, Check, ChevronDown, Copy, History, Image as ImageIcon, ImagePlus, Loader2, Mic, MicOff, RefreshCw, Send, Sparkles, Trash2, UserRound, Video, X, Zap } from 'lucide-react';
import Markdown from 'react-markdown';
import { AnimatePresence, motion } from 'motion/react';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, setDoc, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import readXlsxFile from 'read-excel-file/browser';
import { db } from '../lib/firebase';
import { uint8ArrayToBase64 } from '../lib/base64';
import { readImagesIntoState } from '../lib/imageUpload';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/useToast';
import { BusinessProfileData, CreativeAutomationRequest } from '../types';

const DEMO_BUSINESS_PROFILE_STORAGE_KEY = 'demo_business_profile';
const DEMO_AGENT_CONVERSATION_STORAGE_KEY = 'demo_agent_conversation';
// Keep recent agent work visible long enough for users to return and reuse it.
const AGENT_MEMORY_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  imageDataUrls?: string[];
}

interface AgentConversationSession {
  id: string;
  title: string;
  messages: AgentMessage[];
  updatedAt: number;
}

interface AttachedImage {
  base64: string;
  mimeType: string;
}

interface PlanItem {
  date: string;
  type: 'image' | 'video';
  topic: string;
  prompt: string;
  headline?: string;
  cta?: string;
  voiceGender?: 'Male' | 'Female';
  voiceOverText?: string;
  performanceStyle?: string;
  selected: boolean;
}

interface SavedPlanItem {
  id: string;
  scheduledDate: string;
  type: 'image' | 'video';
  topic: string;
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';
  errorMessage?: string;
  resultMediaUrl?: string;
  speechVerification?: { passed: boolean; similarity: number; transcript?: string; expected?: string };
}

interface AIAgentProps {
  onCreativeAutomation: (request: CreativeAutomationRequest) => void;
}

const MAX_MESSAGES = 40;
const HISTORY_MESSAGES = 20;
const MAX_SESSIONS = 20;
const MAX_IMAGES = 4;

// A plain `session-${Date.now()}` id collides whenever two sessions are created
// within the same millisecond (e.g. a fast click, or automation firing right after
// "New chat") -- upsertSession then silently merges the two into one, which looks
// like a story going missing. The random suffix makes that practically impossible.
const newSessionId = () => `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const detectMessageLanguage = (message: string) => (
  /[\u1780-\u17FF]/.test(message) ? 'km' : 'en'
);

const sessionTitleFromMessages = (messages: AgentMessage[]) => (
  messages.find((message) => message.role === 'user' && message.content.trim())?.content.trim().slice(0, 80)
  || messages[0]?.content.trim().slice(0, 80)
  || 'Conversation'
);

const buildSession = (messages: AgentMessage[], existingId?: string): AgentConversationSession | null => {
  const textOnly = messages
    .map(({ role, content }) => ({ role, content }))
    .filter((message) => message.content.trim());
  if (!textOnly.length) return null;
  return {
    id: existingId || newSessionId(),
    title: sessionTitleFromMessages(textOnly),
    messages: textOnly.slice(-MAX_MESSAGES),
    updatedAt: Date.now(),
  };
};

const upsertSession = (sessions: AgentConversationSession[], session: AgentConversationSession | null) => (
  session
    ? [session, ...sessions.filter((item) => item.id !== session.id)].slice(0, MAX_SESSIONS)
    : sessions.slice(0, MAX_SESSIONS)
);

const normalizeSessions = (value: unknown): AgentConversationSession[] => (
  Array.isArray(value) ? value : []
).map((session: any) => ({
  id: String(session?.id || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`),
  title: String(session?.title || sessionTitleFromMessages(Array.isArray(session?.messages) ? session.messages : [])),
  messages: Array.isArray(session?.messages) ? session.messages.slice(-MAX_MESSAGES) : [],
  updatedAt: Number(session?.updatedAt || Date.now()),
})).filter((session) => session.messages.length);

interface AgentBusinessContext {
  businessName: string;
  directory: { name: string; type: string }[];
}

const AIAgent: React.FC<AIAgentProps> = ({ onCreativeAutomation }) => {
  const { language } = useLanguage();
  const { user, isDemoMode } = useAuth();
  const { notify, ToastHost } = useToast();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoCreateEnabled, setAutoCreateEnabled] = useState(true);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [conversationSessions, setConversationSessions] = useState<AgentConversationSession[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => newSessionId());
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [businessContext, setBusinessContext] = useState<AgentBusinessContext | null>(null);
  // Which language the user is about to speak for voice input. Independent from the
  // UI display language, since people often keep the interface in one language while
  // speaking another (e.g. English UI, Khmer speech) — tying recognition to the UI
  // language made the recognizer use the wrong locale and mangle the transcript.
  // Defaults to Khmer regardless of UI language, since this app's users speak Khmer
  // far more often than the UI happens to be set to Khmer (the toggle still lets
  // anyone switch to English before recording).
  const [voiceInputLanguage, setVoiceInputLanguage] = useState<'km' | 'en'>('km');
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const requestControllerRef = useRef<AbortController | null>(null);

  // Content Plan: upload a CSV/Google Sheet content calendar, let the AI turn
  // each dated row into a ready generation prompt, then save the confirmed
  // items so the daily cron (api/telegram/run-scheduled.js) can generate and
  // deliver each one automatically on its own date with no further action
  // from the user.
  const [planOpen, setPlanOpen] = useState(false);
  const [planLink, setPlanLink] = useState('');
  const [planExtracting, setPlanExtracting] = useState(false);
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [replaceOldPlan, setReplaceOldPlan] = useState(true);
  const [planSaving, setPlanSaving] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planSavedCount, setPlanSavedCount] = useState<number | null>(null);
  const [savedPlanItems, setSavedPlanItems] = useState<SavedPlanItem[]>([]);
  const planFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isDemoMode || !user) return;
    const q = query(collection(db, 'content_plan_items'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rows = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              scheduledDate: String(data.scheduledDate || ''),
              type: data.type === 'video' ? 'video' : 'image',
              topic: String(data.topic || ''),
              status: data.status || 'PENDING',
              errorMessage: data.errorMessage || undefined,
              resultMediaUrl: data.resultMediaUrl || undefined,
              speechVerification: data.speechVerification || undefined,
            } as SavedPlanItem;
          })
          .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
        setSavedPlanItems(rows);
      },
      (error) => console.error('Content plan status listener failed:', error),
    );
    return () => unsubscribe();
  }, [user, isDemoMode]);
  // Holds the live mic recording session (not the browser's SpeechRecognition —
  // see toggleVoiceInput for why). 'compressed' (MediaRecorder producing webm/opus
  // or similar) is used whenever the browser supports it, since compressed audio
  // is roughly 10x smaller per second than raw PCM for the same speech clarity —
  // 'raw' (manual PCM capture via ScriptProcessorNode, wrapped in a WAV container)
  // is the fallback for browsers without usable MediaRecorder audio support.
  const recordingRef = useRef<
    | { kind: 'compressed'; mediaRecorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; mimeType: string; startedAt: number }
    | { kind: 'raw'; audioContext: AudioContext; processor: ScriptProcessorNode; source: MediaStreamAudioSourceNode; stream: MediaStream; chunks: Float32Array[] }
    | null
  >(null);
  // Guards against overwriting the just-loaded saved conversation with an empty
  // autosave that could otherwise fire before the initial load resolves.
  const memoryLoadedRef = useRef(false);
  // The voice-transcription fetch (stopRecordingAndTranscribe) can take up to
  // 180s and isn't tied to requestControllerRef's unmount-abort above -- without
  // this, a user who navigates away mid-transcription gets state updates (and an
  // unexpected new askAgent() chat request) fired against an unmounted component
  // once that fetch eventually resolves.
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);
  // Auto-stops a forgotten-open recording (e.g. the mic stays on because the user
  // didn't realize it was still listening) — without this, the buffer keeps growing
  // indefinitely, and a many-minutes-long recording becomes an upload that can stall
  // well past Vercel's fixed 4.5MB request body limit, leaving the UI stuck on
  // "Transcribing..." with no error ever surfacing. Compressed audio (~32kbps opus)
  // fits 10 minutes in well under that limit; the raw-PCM fallback path cannot
  // safely go nearly that long even downsampled to 16kHz, so it gets a shorter cap.
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_RECORDING_MS_COMPRESSED = 600000;
  const MAX_RECORDING_MS_RAW = 60000;

  const micSupported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  useEffect(() => () => requestControllerRef.current?.abort(), []);
  useEffect(() => () => {
    const recording = recordingRef.current;
    if (!recording) return;
    recording.stream.getTracks().forEach((track) => track.stop());
    if (recording.kind === 'compressed') {
      if (recording.mediaRecorder.state !== 'inactive') recording.mediaRecorder.stop();
    } else {
      recording.processor.disconnect();
      recording.source.disconnect();
      void recording.audioContext.close();
    }
  }, []);

  // Long-term memory: reload the saved conversation and business profile so the
  // agent keeps context across page reloads and sessions instead of forgetting
  // everything the moment the tab closes.
  useEffect(() => {
    let cancelled = false;
    memoryLoadedRef.current = false;
    // Reset immediately, before the async load resolves — this is an SPA where
    // logging out or switching accounts doesn't reload the page, so without this
    // the previous user's conversation/profile would stay visible (or race with
    // and get clobbered onto) the newly-signed-in user's data.
    setMessages([]);
    setConversationSessions([]);
    setActiveSessionId(newSessionId());
    setBusinessContext(null);

    const loadMemory = async () => {
      try {
        if (isDemoMode || !user) {
          const saved = JSON.parse(localStorage.getItem(DEMO_AGENT_CONVERSATION_STORAGE_KEY) || 'null');
          const savedMessages = Array.isArray(saved) ? saved : saved?.messages;
          const savedSessions = normalizeSessions(saved?.sessions);
          const savedAt = Array.isArray(saved) ? null : saved?.updatedAt;
          const isFresh = typeof savedAt === 'number' && Date.now() - savedAt < AGENT_MEMORY_EXPIRY_MS;
          if (cancelled) return;
          setConversationSessions(savedSessions.slice(0, MAX_SESSIONS));
          if (Array.isArray(savedMessages) && savedMessages.length && isFresh) {
            setMessages(savedMessages.slice(-MAX_MESSAGES));
            setActiveSessionId(String(saved?.activeSessionId || newSessionId()));
          } else if (savedMessages?.length) {
            localStorage.removeItem(DEMO_AGENT_CONVERSATION_STORAGE_KEY);
          }
          const savedProfile = JSON.parse(localStorage.getItem(DEMO_BUSINESS_PROFILE_STORAGE_KEY) || 'null');
          if (savedProfile && !cancelled) {
            setBusinessContext({ businessName: savedProfile.businessName || '', directory: savedProfile.directory || [] });
          }
        } else {
          const [conversationSnap, profileSnap] = await Promise.all([
            getDoc(doc(db, 'agent_conversations', user.uid)),
            getDoc(doc(db, 'business_profiles', user.uid)),
          ]);
          if (cancelled) return;
          if (conversationSnap.exists()) {
            const data = conversationSnap.data();
            const saved = data?.messages;
            const savedSessions = normalizeSessions(data?.sessions);
            const updatedAtMs = data?.updatedAt?.toMillis?.() ?? null;
            const isFresh = typeof updatedAtMs === 'number' && Date.now() - updatedAtMs < AGENT_MEMORY_EXPIRY_MS;
            setConversationSessions(savedSessions.slice(0, MAX_SESSIONS));
            if (Array.isArray(saved) && saved.length && isFresh) {
              setMessages(saved.slice(-MAX_MESSAGES));
              setActiveSessionId(String(data?.activeSessionId || newSessionId()));
            }
          }
          if (profileSnap.exists()) {
            const data = profileSnap.data() as BusinessProfileData;
            setBusinessContext({ businessName: data.businessName || '', directory: data.directory || [] });
          }
        }
      } catch (error) {
        console.error('Failed to load agent memory:', error);
      } finally {
        if (!cancelled) memoryLoadedRef.current = true;
      }
    };
    void loadMemory();

    return () => {
      cancelled = true;
    };
  }, [user, isDemoMode]);

  // Only the text survives into persisted memory — attached image previews are
  // base64 data URLs that would blow past Firestore's 1MB document limit and
  // add real storage cost within a handful of exchanges, so they stay session-only.
  const persistConversation = (nextMessages: AgentMessage[], sessionsOverride = conversationSessions, sessionId = activeSessionId) => {
    if (!memoryLoadedRef.current) return;
    const textOnly = nextMessages.map(({ role, content }) => ({ role, content }));
    const currentSession = buildSession(textOnly, sessionId);
    const sessions = currentSession
      ? [
          currentSession,
          ...sessionsOverride.filter((session) => session.id !== currentSession.id),
        ].slice(0, MAX_SESSIONS)
      : sessionsOverride.slice(0, MAX_SESSIONS);
    try {
      if (isDemoMode || !user) {
        localStorage.setItem(DEMO_AGENT_CONVERSATION_STORAGE_KEY, JSON.stringify({
          messages: textOnly,
          sessions,
          activeSessionId: sessionId,
          updatedAt: Date.now(),
        }));
      } else {
        void setDoc(doc(db, 'agent_conversations', user.uid), {
          messages: textOnly,
          sessions,
          activeSessionId: sessionId,
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
    historyTitle: language === 'km' ? 'Story / ប្រវត្តិសន្ទនា' : 'Story / History',
    historyEmpty: language === 'km' ? 'នៅមិនទាន់មាន story ទេ។ សួរ Agent ម្តង រួច conversation នឹងរក្សាទុកនៅទីនេះ។' : 'No story yet. Ask the agent once and the conversation will be saved here.',
    reusePrompt: language === 'km' ? 'ចុចដើម្បីបើក story នេះ' : 'Open this story',
    currentStory: language === 'km' ? 'កំពុងបើក' : 'Current',
    openStory: language === 'km' ? 'បើកមើល' : 'Open',
    historyDelete: language === 'km' ? 'លុប story នេះ' : 'Delete this story',
    restoreHistory: language === 'km' ? 'ស្ដារ History ចាស់' : 'Restore old history',
    restoredHistory: language === 'km' ? 'រកឃើញ history ចាស់ ហើយបើកជូនរួច។' : 'Old history was found and opened.',
    alreadyRestored: language === 'km' ? 'Story នេះធ្លាប់ restore រួចហើយ បើកជូនវិញ។' : 'This was already restored -- opened it again.',
    noOldHistory: language === 'km' ? 'រកមិនឃើញ history ចាស់នៅក្នុង storage ទេ។' : 'No old history was found in storage.',
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
    transcribing: language === 'km' ? 'កំពុងបំលែងជាអត្ថបទ...' : 'Transcribing...',
  }), [language]);

  const updateMessages = (nextMessages: AgentMessage[]) => {
    const trimmed = nextMessages.slice(-MAX_MESSAGES);
    const currentSession = buildSession(trimmed, activeSessionId);
    const nextSessions = upsertSession(conversationSessions, currentSession);
    setConversationSessions(nextSessions);
    setMessages(trimmed);
    persistConversation(trimmed, nextSessions);
  };

  const startNewChat = () => {
    requestControllerRef.current?.abort();
    const nextSessionId = newSessionId();
    const nextSessions = upsertSession(conversationSessions, buildSession(messages, activeSessionId));
    setMessages([]);
    setInput('');
    setLoading(false);
    setConversationSessions(nextSessions);
    setActiveSessionId(nextSessionId);
    persistConversation([], nextSessions, nextSessionId);
  };

  const openConversationSession = (session: AgentConversationSession) => {
    requestControllerRef.current?.abort();
    const openedMessages = session.messages.slice(-MAX_MESSAGES);
    const nextSessions = upsertSession(conversationSessions, { ...session, messages: openedMessages, updatedAt: Date.now() });
    setConversationSessions(nextSessions);
    setActiveSessionId(session.id);
    setMessages(openedMessages);
    setInput('');
    setAttachedImages([]);
    setLoading(false);
    persistConversation(openedMessages, nextSessions, session.id);
  };

  const deleteConversationSession = (sessionId: string) => {
    const nextSessions = conversationSessions.filter((session) => session.id !== sessionId);
    setConversationSessions(nextSessions);

    if (sessionId === activeSessionId) {
      // Deleting the session currently on screen -- there's nothing left to
      // show, so start a fresh chat rather than leaving stale messages
      // visible for a session that no longer exists in history.
      requestControllerRef.current?.abort();
      const nextSessionId = newSessionId();
      setMessages([]);
      setInput('');
      setLoading(false);
      setActiveSessionId(nextSessionId);
      persistConversation([], nextSessions, nextSessionId);
    } else {
      persistConversation(messages, nextSessions, activeSessionId);
    }
  };

  // Compares only role+content (ignoring id/title/updatedAt) so a restore is
  // recognized as "the same one already restored" even though buildSession
  // stamps a fresh id/timestamp on it every time this runs.
  const sameMessageContent = (a: AgentMessage[], b: AgentMessage[]) => (
    a.length === b.length && a.every((message, index) => (
      message.role === b[index].role && message.content === b[index].content
    ))
  );

  const restoreOldHistory = async () => {
    try {
      let legacyMessages: AgentMessage[] = [];
      if (isDemoMode || !user) {
        const saved = JSON.parse(localStorage.getItem(DEMO_AGENT_CONVERSATION_STORAGE_KEY) || 'null');
        legacyMessages = Array.isArray(saved) ? saved : Array.isArray(saved?.messages) ? saved.messages : [];
      } else {
        const conversationSnap = await getDoc(doc(db, 'agent_conversations', user.uid));
        const data = conversationSnap.exists() ? conversationSnap.data() : null;
        legacyMessages = Array.isArray(data?.messages) ? data.messages : [];
      }

      const restoredSession = buildSession(legacyMessages, `restored-${Date.now()}`);
      if (!restoredSession) {
        notify(text.noOldHistory, 'error');
        return;
      }

      // This reads the same live "current conversation" doc every time it's
      // called (there's no separate "legacy-only" store), so clicking Restore
      // more than once created a fresh duplicate story with identical content
      // each time. Re-open the existing one instead of adding another copy.
      const alreadyRestored = conversationHistory.find((session) => sameMessageContent(session.messages, restoredSession.messages));
      if (alreadyRestored) {
        openConversationSession(alreadyRestored);
        notify(text.alreadyRestored, 'success');
        return;
      }

      const nextSessions = upsertSession(conversationSessions, {
        ...restoredSession,
        title: `${text.historyTitle}: ${restoredSession.title}`,
      });
      setConversationSessions(nextSessions);
      setActiveSessionId(restoredSession.id);
      setMessages(restoredSession.messages);
      setInput('');
      setAttachedImages([]);
      setLoading(false);
      persistConversation(restoredSession.messages, nextSessions, restoredSession.id);
      notify(text.restoredHistory, 'success');
    } catch (error) {
      console.error('Failed to restore old agent history:', error);
      notify(language === 'km' ? 'Restore old history បរាជ័យ។' : 'Restore old history failed.', 'error');
    }
  };

  const runPlanExtraction = async (body: { planText?: string; planUrl?: string }) => {
    setPlanExtracting(true);
    setPlanError(null);
    setPlanSavedCount(null);
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extractContentPlan', language, ...body }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not read this content plan.');
      const items: PlanItem[] = (Array.isArray(data.items) ? data.items : []).map((item: any) => ({
        date: item.date,
        type: item.type === 'video' ? 'video' : 'image',
        topic: item.topic || '',
        prompt: item.prompt || '',
        headline: item.headline || '',
        cta: item.cta || '',
        voiceGender: item.voiceGender === 'Male' ? 'Male' : 'Female',
        voiceOverText: item.voiceOverText || '',
        performanceStyle: item.performanceStyle || '',
        selected: true,
      }));
      if (!items.length) {
        setPlanError(language === 'km'
          ? 'រកមិនឃើញកាលបរិច្ឆេទ ឬសំណើបង្កើតរូបភាព/វីដេអូច្បាស់លាស់ក្នុងឯកសារនេះទេ។'
          : 'Could not find any clear dated image/video requests in this plan.');
      }
      setPlanItems(items);
    } catch (error: any) {
      setPlanError(error.message || (language === 'km' ? 'មិនអាចអានផែនការនេះបានទេ។' : 'Could not read this content plan.'));
    } finally {
      setPlanExtracting(false);
    }
  };

  const handlePlanFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const isExcel = /\.xlsx?$/i.test(file.name);
    if (isExcel) {
      setPlanExtracting(true);
      setPlanError(null);
      try {
        // Workbooks often spread the actual calendar across several tabs
        // (e.g. a "Start Here" summary tab plus a "Master Calendar" tab with
        // the real dated rows) -- read every sheet, not just the first one,
        // or dated rows on later tabs are silently missed.
        const sheets = await readXlsxFile(file);
        // A plain comma join is enough here -- this text is only ever read by
        // the AI extraction prompt, not parsed as strict RFC CSV, so it
        // doesn't need quoting/escaping for cells containing commas.
        const planText = sheets
          .map(({ sheet, data }) => `--- Sheet: ${sheet} ---\n${data.map((row) => row.map((cell) => String(cell ?? '')).join(',')).join('\n')}`)
          .join('\n\n');
        await runPlanExtraction({ planText });
      } catch (error: any) {
        setPlanExtracting(false);
        setPlanError(error.message || (language === 'km' ? 'មិនអាចអានឯកសារ Excel នេះបានទេ។' : 'Could not read this Excel file.'));
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = () => void runPlanExtraction({ planText: String(reader.result || '') });
    reader.onerror = () => setPlanError(language === 'km' ? 'មិនអាចអានឯកសារនេះបានទេ។' : 'Could not read this file.');
    reader.readAsText(file);
  };

  const handlePlanLinkSubmit = () => {
    const url = planLink.trim();
    if (!url) return;
    void runPlanExtraction({ planUrl: url });
  };

  const togglePlanItem = (index: number) => {
    setPlanItems((items) => items.map((item, i) => (i === index ? { ...item, selected: !item.selected } : item)));
  };

  const handleSavePlan = async () => {
    if (!user || isDemoMode) return;
    const selectedItems = planItems.filter((item) => item.selected);
    if (!selectedItems.length) return;
    setPlanSaving(true);
    setPlanError(null);
    if (replaceOldPlan) {
      // Only PENDING items are cleared -- DONE items are already-published
      // history and PROCESSING items are mid-generation (a video job may
      // already be running), neither should be touched by uploading a new plan.
      try {
        const oldSnapshot = await getDocs(
          query(collection(db, 'content_plan_items'), where('userId', '==', user.uid), where('status', '==', 'PENDING')),
        );
        await Promise.all(oldSnapshot.docs.map((docSnap) => deleteDoc(docSnap.ref)));
      } catch (error) {
        console.error('Failed to clear old content plan items:', error);
        setPlanError(language === 'km' ? 'មិនអាចលុបផែនការចាស់បានទេ។' : 'Could not clear the old plan.');
        setPlanSaving(false);
        return;
      }
    }
    // Each item is saved independently (not aborted on the first failure) and
    // only the ones that actually succeeded are removed from the list --
    // otherwise a failure partway through (e.g. item 4 of 10) would leave
    // items 1-3 already persisted in Firestore while the UI still shows all
    // 10 as unsaved, and pressing Save again would create duplicate
    // content_plan_items docs (and later, duplicate generated posts) for
    // the ones that already went through.
    const failedIndexes = new Set<number>();
    let savedCount = 0;
    for (let i = 0; i < selectedItems.length; i++) {
      const item = selectedItems[i];
      try {
        await addDoc(collection(db, 'content_plan_items'), {
          userId: user.uid,
          scheduledDate: item.date,
          type: item.type,
          topic: item.topic,
          prompt: item.prompt,
          ...(item.type === 'image'
            ? { headline: item.headline || '', cta: item.cta || '' }
            : { voiceGender: item.voiceGender || 'Female', voiceOverText: item.voiceOverText || '', performanceStyle: item.performanceStyle || '', voiceOverWanted: true, voiceOverMode: 'edge-seedance' }),
          status: 'PENDING',
          createdAt: serverTimestamp(),
        });
        savedCount += 1;
      } catch (error) {
        console.error('Failed to save content plan item:', error);
        failedIndexes.add(i);
      }
    }

    if (failedIndexes.size > 0) {
      setPlanItems(selectedItems.filter((_, i) => failedIndexes.has(i)));
      setPlanError(language === 'km'
        ? `រក្សាទុកបានជោគជ័យ ${savedCount} ចំណុច ប៉ុន្តែ ${failedIndexes.size} ចំណុចបរាជ័យ (នៅសល់ខាងក្រោម សូមព្យាយាមម្តងទៀត)។`
        : `Saved ${savedCount} item(s), but ${failedIndexes.size} failed (left below -- try again).`);
    } else {
      setPlanItems([]);
      setPlanLink('');
    }
    setPlanSavedCount(savedCount > 0 ? savedCount : null);
    setPlanSaving(false);
  };

  const handleRetryPlanItem = async (itemId: string) => {
    try {
      await updateDoc(doc(db, 'content_plan_items', itemId), {
        status: 'PENDING',
        errorMessage: null,
        resultMediaUrl: null,
        speechVerification: null,
      });
    } catch (error) {
      console.error('Failed to retry content plan item:', error);
    }
  };

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    readImagesIntoState(files, MAX_IMAGES, attachedImages.length, setAttachedImages);
  };

  const handleRemoveImage = (index: number) => {
    setAttachedImages((current) => current.filter((_, i) => i !== index));
  };

  // Voice input records raw audio and sends it to an AI model for transcription,
  // instead of using the browser's built-in Web Speech API — that API's Khmer
  // support is patchy-to-nonexistent across browsers (it would silently "hear
  // nothing" for Khmer speech with no useful error), while a general multimodal
  // model transcribes Khmer reliably. Audio is captured as raw PCM and wrapped
  // in a WAV container client-side, since WAV is a format OpenRouter's audio
  // input is guaranteed to accept (unlike MediaRecorder's default webm/opus).
  // Speech models (Whisper, Chirp) resample everything to 16kHz internally regardless
  // of what's sent, so recording at the mic's native rate (typically 44.1/48kHz) and
  // sending that wastes payload size for no transcription-quality benefit — it just
  // eats into Vercel's fixed 4.5MB request body limit, capping how long a recording
  // can be. Downsampling here first roughly triples the seconds of audio that fit in
  // the same size budget.
  const TARGET_SAMPLE_RATE = 16000;
  const downsampleTo16kHz = (input: Float32Array, inputSampleRate: number): { samples: Float32Array; sampleRate: number } => {
    if (inputSampleRate <= TARGET_SAMPLE_RATE) return { samples: input, sampleRate: inputSampleRate };
    const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i += 1) {
      output[i] = input[Math.floor(i * ratio)];
    }
    return { samples: output, sampleRate: TARGET_SAMPLE_RATE };
  };

  const floatTo16BitPcm = (input: Float32Array): Int16Array => {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return output;
  };

  const buildWavBase64 = (samples: Int16Array, sampleRate: number): string => {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeString = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i += 1, offset += 2) {
      view.setInt16(offset, samples[i], true);
    }
    return uint8ArrayToBase64(new Uint8Array(buffer));
  };

  const getSupportedRecorderMimeType = (): string | null => {
    if (typeof MediaRecorder === 'undefined') return null;
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || null;
  };

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      const mimeType = getSupportedRecorderMimeType();
      if (mimeType) {
        const mediaRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 });
        const chunks: Blob[] = [];
        mediaRecorder.ondataavailable = (event: BlobEvent) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        mediaRecorder.start();
        recordingRef.current = { kind: 'compressed', mediaRecorder, stream, chunks, mimeType, startedAt: Date.now() };
      } else {
        const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
        const audioContext: AudioContext = new AudioContextCtor();
        const source = audioContext.createMediaStreamSource(stream);
        // ScriptProcessorNode is deprecated in favor of AudioWorklet, but remains
        // universally supported and is far simpler for a short-lived capture like this.
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        const chunks: Float32Array[] = [];
        processor.onaudioprocess = (event: AudioProcessingEvent) => {
          chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
        };
        source.connect(processor);
        processor.connect(audioContext.destination);
        recordingRef.current = { kind: 'raw', audioContext, processor, source, stream, chunks };
      }
      recordingTimeoutRef.current = setTimeout(() => {
        setIsListening(false);
        void stopRecordingAndTranscribe();
      }, mimeType ? MAX_RECORDING_MS_COMPRESSED : MAX_RECORDING_MS_RAW);
    } catch (error) {
      // getUserMedia already succeeded by this point — if any later setup step
      // throws (AudioContext/MediaRecorder construction, node creation), the live
      // mic track must still be released here, otherwise the browser's mic
      // indicator stays on indefinitely with no way to stop it short of a page reload.
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
  };

  const stopRecordingAndTranscribe = async () => {
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (!recording) return;

    const noSpeechMessage = language === 'km' ? 'មិនបានលឺសំឡេងអ្វីទេ។' : 'No speech was detected.';
    const speakClearlyMessage = language === 'km'
      ? 'មិនបានលឺសំឡេងអ្វីទេ។ សូមនិយាយឲ្យបានច្បាស់ជិតមីក្រូហ្វូន។'
      : 'No speech was detected. Please speak clearly, close to the microphone.';

    let audioBase64: string;
    let format: string;
    let recordedSeconds = 0;

    if (recording.kind === 'compressed') {
      const { mediaRecorder, stream, chunks, mimeType, startedAt } = recording;
      const durationSeconds = (Date.now() - startedAt) / 1000;
      recordedSeconds = durationSeconds;
      const stopped = new Promise<void>((resolve) => { mediaRecorder.onstop = () => resolve(); });
      if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());

      const blob = new Blob(chunks, { type: mimeType });
      // Speech models (Whisper/Chirp included) are known to hallucinate plausible-sounding
      // but entirely made-up sentences when fed audio that's mostly silence or background
      // noise, instead of reporting "no speech" — e.g. a tap that stops recording almost
      // immediately, or a pause with only room noise. Reject that locally before sending
      // it anywhere, rather than showing the user a confident but fabricated transcript.
      // Raw sample amplitude isn't available for compressed audio without decoding it, so
      // bytes-per-second of the encoded blob is used instead: opus's VBR encoding produces
      // very few bytes for near-silence versus real speech at the ~32kbps target bitrate.
      const MIN_DURATION_SECONDS = 0.5;
      const MIN_BYTES_PER_SECOND = 300;
      if (blob.size === 0 || durationSeconds < MIN_DURATION_SECONDS) {
        notify(noSpeechMessage, 'error');
        return;
      }
      if (blob.size / durationSeconds < MIN_BYTES_PER_SECOND) {
        notify(speakClearlyMessage, 'error');
        return;
      }

      audioBase64 = uint8ArrayToBase64(new Uint8Array(await blob.arrayBuffer()));
      format = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    } else {
      recording.processor.disconnect();
      recording.source.disconnect();
      recording.stream.getTracks().forEach((track) => track.stop());
      const sampleRate = recording.audioContext.sampleRate;
      await recording.audioContext.close();

      const totalLength = recording.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      if (totalLength === 0) {
        notify(noSpeechMessage, 'error');
        return;
      }

      const merged = new Float32Array(totalLength);
      let mergeOffset = 0;
      for (const chunk of recording.chunks) {
        merged.set(chunk, mergeOffset);
        mergeOffset += chunk.length;
      }

      const durationSeconds = merged.length / sampleRate;
      recordedSeconds = durationSeconds;
      let sumSquares = 0;
      for (let i = 0; i < merged.length; i += 1) sumSquares += merged[i] * merged[i];
      const rms = Math.sqrt(sumSquares / merged.length);
      const MIN_DURATION_SECONDS = 0.5;
      const MIN_RMS = 0.01;
      if (durationSeconds < MIN_DURATION_SECONDS || rms < MIN_RMS) {
        notify(speakClearlyMessage, 'error');
        return;
      }

      const downsampled = downsampleTo16kHz(merged, sampleRate);
      audioBase64 = buildWavBase64(floatTo16BitPcm(downsampled.samples), downsampled.sampleRate);
      format = 'wav';
    }

    setIsTranscribing(true);
    // Without a client-side timeout, a stalled request (slow upload, a hung provider
    // call server-side) leaves "Transcribing..." spinning forever with no way out
    // short of reloading the page, since fetch() itself never times out on its own.
    // Scales with recording length since a 10-minute clip genuinely needs more upload
    // and processing time than a 5-second one — a fixed short timeout would wrongly
    // abort long-but-healthy transcriptions before they finish.
    const timeoutMs = Math.min(180000, Math.max(30000, 20000 + recordedSeconds * 1500));
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: timeoutController.signal,
        body: JSON.stringify({
          action: 'sttTranscribe',
          audioBase64,
          format,
          languageHint: voiceInputLanguage === 'km' ? 'Khmer' : 'English',
        }),
      });
      const data = await response.json();
      if (!isMountedRef.current) return;
      if (!response.ok) throw new Error(data.error || 'Transcription failed.');
      const transcript = String(data.transcript || '').trim();
      // Speech models occasionally hallucinate a short, fluent-sounding but completely
      // fabricated sentence in the WRONG script even on real, audible speech (observed
      // live: "Oh, no.", "John, I'm going to.", "I'm telling you." for actual Khmer
      // input) — not caught by the earlier silence/duration check since the audio
      // itself was real. When Khmer was requested but the result has no Khmer script
      // at all, that mismatch itself is the strongest available signal of a bad
      // transcription, so refuse to auto-send it rather than act on fabricated text.
      const looksLikeMismatchedHallucination = voiceInputLanguage === 'km' && transcript && !/[ក-៿]/.test(transcript);
      if (transcript && !looksLikeMismatchedHallucination) {
        // Auto-send right after a successful transcription, like a real voice
        // assistant — requiring a manual click on top of speaking made voice
        // input feel like dictation rather than an actual voice command.
        const combinedMessage = input.trim() ? `${input.trim()} ${transcript}` : transcript;
        setInput(combinedMessage);
        void askAgent(combinedMessage);
      } else {
        notify(language === 'km' ? 'មិនបានលឺសំឡេងអ្វីទេ។ សូមសាកល្បងម្តងទៀត។' : 'No speech was detected. Please try again.', 'error');
      }
    } catch (error: any) {
      const message = error?.name === 'AbortError'
        ? (language === 'km' ? 'ការបំលែងសំឡេងចំណាយពេលយូរពេក។ សូមសាកល្បងម្តងទៀតជាមួយសំឡេងខ្លីជាងនេះ។' : 'Transcription took too long. Please try again with a shorter recording.')
        : (error?.message || (language === 'km' ? 'ការបំលែងសំឡេងទៅជាអត្ថបទបរាជ័យ។' : 'Voice transcription failed.'));
      notify(message, 'error');
    } finally {
      clearTimeout(timeoutId);
      setIsTranscribing(false);
    }
  };

  const toggleVoiceInput = () => {
    if (isListening) {
      setIsListening(false);
      void stopRecordingAndTranscribe();
      return;
    }

    void (async () => {
      try {
        await startRecording();
        setIsListening(true);
      } catch (error: any) {
        notify(
          error?.name === 'NotAllowedError'
            ? (language === 'km'
              ? 'សូមអនុញ្ញាតការប្រើប្រាស់មីក្រូហ្វូនសម្រាប់គេហទំព័រនេះ (ចុច icon 🔒/mic ក្នុងប្រអប់អាសយដ្ឋាន browser)។'
              : "Microphone access was blocked. Click the 🔒/mic icon in your browser's address bar and allow it for this site.")
            : (language === 'km' ? 'មិនអាចចាប់ផ្តើមថតសំឡេងបានទេ។ សូមពិនិត្យមើលមីក្រូហ្វូនរបស់អ្នក។' : 'Could not start recording. Please check your microphone.'),
          'error',
        );
      }
    })();
  };

  const askAgent = async (messageOverride?: string) => {
    const message = (typeof messageOverride === 'string' ? messageOverride : input).trim();
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
          duration: kind === 'video' && [4, 6, 8, 16, 24].includes(Number(data.automation.duration))
            ? Number(data.automation.duration)
            : undefined,
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
  const conversationHistory = useMemo(() => {
    const currentSession = buildSession(messages, activeSessionId);
    return [
      ...(currentSession ? [currentSession] : []),
      ...conversationSessions.filter((session) => session.id !== activeSessionId),
    ].slice(0, MAX_SESSIONS);
  }, [activeSessionId, conversationSessions, messages]);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <ToastHost />
      <header className="flex flex-col gap-2">
        <h2 className="text-4xl font-display font-bold text-brand-700 dark:text-brand-300 tracking-tight flex items-center gap-3">
          {text.title}
          <Sparkles className="text-brand-500" size={34} />
        </h2>
        <p className="text-slate-500 dark:text-slate-400 text-lg max-w-4xl">{text.subtitle}</p>
      </header>

      <section className="glass rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setHistoryOpen((open) => !open)}
            className="flex items-center gap-2 text-lg font-bold text-brand-700 dark:text-brand-300"
          >
            <History size={20} />
            <span>{text.historyTitle}</span>
            {conversationHistory.length > 0 && (
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-black text-brand-600 dark:bg-slate-700 dark:text-brand-400">
                {conversationHistory.length}
              </span>
            )}
            <motion.span animate={{ rotate: historyOpen ? 180 : 0 }} className="text-brand-400">
              <ChevronDown size={18} />
            </motion.span>
          </button>
          {historyOpen && (
            <button
              type="button"
              onClick={() => void restoreOldHistory()}
              className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-bold text-brand-700 transition hover:border-brand-300 hover:bg-white"
              title={text.restoreHistory}
            >
              <RefreshCw size={15} />
              {text.restoreHistory}
            </button>
          )}
        </div>
        {!historyOpen ? null : conversationHistory.length ? (
          <div className="mt-4 max-h-96 space-y-1 overflow-y-auto pr-1">
            {conversationHistory.map((session) => (
              <div
                key={`top-${session.id}`}
                role="button"
                tabIndex={0}
                onClick={() => openConversationSession(session)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openConversationSession(session);
                  }
                }}
                title={text.reusePrompt}
                className={`group flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition cursor-pointer ${
                  session.id === activeSessionId
                    ? 'bg-brand-50 font-bold text-brand-700 dark:bg-slate-700 dark:text-brand-400'
                    : 'text-slate-600 hover:bg-brand-50/60 dark:text-slate-300 dark:hover:bg-slate-700/60'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
                {session.id === activeSessionId && (
                  <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-brand-500">
                    {text.currentStory}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteConversationSession(session.id);
                  }}
                  title={text.historyDelete}
                  className="shrink-0 rounded-md p-1 text-red-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-slate-600">{text.historyEmpty}</p>
        )}
      </section>

      <section className="glass rounded-2xl p-5">
        <button
          type="button"
          onClick={() => setPlanOpen((open) => !open)}
          className="flex items-center gap-2 text-lg font-bold text-brand-700 dark:text-brand-300"
        >
          <CalendarClock size={20} />
          <span>{language === 'km' ? 'ផែនការខ្លឹមសារ (Content Plan)' : 'Content Plan'}</span>
          <motion.span animate={{ rotate: planOpen ? 180 : 0 }} className="text-brand-400">
            <ChevronDown size={18} />
          </motion.span>
        </button>

        {planOpen && (
          <div className="mt-4 space-y-4">
            {isDemoMode || !user ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {language === 'km'
                  ? 'ត្រូវការគណនីពិត (មិនមែន demo) ដើម្បីប្រើមុខងារនេះ ព្រោះវាបង្កើតខ្លឹមសារនៅផ្ទៃខាងក្រោយដោយស្វ័យប្រវត្តិ។'
                  : 'This needs a real (non-demo) account, since it generates content automatically in the background.'}
              </p>
            ) : (
              <>
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {language === 'km'
                    ? 'អាប់ឡូតឯកសារ Excel/CSV ឬបិទភ្ជាប់ link Google Sheet ដែលមានកាលបរិច្ឆេទ + សំណើបង្កើតរូបភាព/វីដេអូ។ AI នឹងស្រង់ចេញជា prompt ត្រៀមរួច ហើយបង្កើតឲ្យស្វ័យប្រវត្តិនៅថ្ងៃដល់កំណត់ រួចផ្ញើទៅ Telegram Channel/Bot ដែលអ្នកបានភ្ជាប់។'
                    : 'Upload an Excel/CSV file or paste a Google Sheet link with dates + image/video requests. The AI extracts ready-to-use prompts and generates each one automatically on its scheduled date, delivered to your connected Telegram Channel/Bot.'}
                </p>

                <div className="flex flex-wrap items-center gap-3">
                  <input ref={planFileInputRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={handlePlanFileSelect} />
                  <button
                    type="button"
                    onClick={() => planFileInputRef.current?.click()}
                    disabled={planExtracting}
                    className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm font-bold text-brand-700 transition hover:border-brand-300 hover:bg-white disabled:opacity-50"
                  >
                    <ImagePlus size={16} />
                    {language === 'km' ? 'អាប់ឡូត Excel/CSV' : 'Upload Excel/CSV'}
                  </button>
                  <div className="flex flex-1 min-w-[240px] items-center gap-2">
                    <input
                      type="text"
                      value={planLink}
                      onChange={(event) => setPlanLink(event.target.value)}
                      onKeyDown={(event) => event.key === 'Enter' && handlePlanLinkSubmit()}
                      placeholder={language === 'km' ? 'ឬបិទភ្ជាប់ Google Sheet link...' : 'or paste a Google Sheet link...'}
                      className="flex-1 rounded-xl border border-brand-100 bg-white px-3 py-2.5 text-sm text-brand-800 outline-none focus:ring-2 ring-brand-500/20 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={handlePlanLinkSubmit}
                      disabled={planExtracting || !planLink.trim()}
                      className="rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-800 disabled:opacity-40"
                    >
                      {planExtracting ? <Loader2 size={16} className="animate-spin" /> : (language === 'km' ? 'អាន' : 'Read')}
                    </button>
                  </div>
                </div>

                {planError && <p className="text-sm text-rose-500">{planError}</p>}
                {planSavedCount !== null && !planError && (
                  <p className="flex items-center gap-2 text-sm font-bold text-emerald-600">
                    <Check size={16} />
                    {language === 'km' ? `បានរក្សាទុក ${planSavedCount} ចំណុចជោគជ័យ!` : `Saved ${planSavedCount} item(s) successfully!`}
                  </p>
                )}

                {planItems.length > 0 && (
                  <div className="space-y-3">
                    <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                      {planItems.map((item, index) => (
                        <label
                          key={`${item.date}-${index}`}
                          className="flex cursor-pointer items-start gap-3 rounded-xl border border-brand-100 bg-brand-50/50 p-3 dark:border-slate-700 dark:bg-slate-800/50"
                        >
                          <input
                            type="checkbox"
                            checked={item.selected}
                            onChange={() => togglePlanItem(index)}
                            className="mt-1 h-4 w-4 accent-brand-600"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-brand-500">
                              <span>{item.date}</span>
                              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] dark:bg-slate-700">
                                {item.type === 'video' ? (language === 'km' ? 'វីដេអូ' : 'Video') : (language === 'km' ? 'រូបភាព' : 'Image')}
                              </span>
                            </div>
                            <p className="mt-1 truncate text-sm font-bold text-brand-700 dark:text-brand-300">{item.topic}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-brand-600 dark:text-brand-300">
                      <input
                        type="checkbox"
                        checked={replaceOldPlan}
                        onChange={(event) => setReplaceOldPlan(event.target.checked)}
                        className="h-4 w-4 accent-brand-600"
                      />
                      {language === 'km'
                        ? 'ជំនួសផែនការចាស់ (លុប item ដែលនៅរង់ចាំចាស់ៗចោល)'
                        : 'Replace old plan (delete previous not-yet-generated items)'}
                    </label>
                    <button
                      type="button"
                      onClick={handleSavePlan}
                      disabled={planSaving || !planItems.some((item) => item.selected)}
                      className="flex items-center gap-2 rounded-xl bg-brand-700 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-800 disabled:opacity-40"
                    >
                      {planSaving ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />}
                      {language === 'km' ? 'រក្សាទុកផែនការ' : 'Save Plan'}
                    </button>
                  </div>
                )}

                {savedPlanItems.length > 0 && (
                  <div className="space-y-2 border-t border-brand-100 pt-4 dark:border-slate-700">
                    <p className="text-xs font-black uppercase tracking-widest text-brand-500">
                      {language === 'km' ? `ស្ថានភាពផែនការ (${savedPlanItems.length})` : `Plan Status (${savedPlanItems.length})`}
                    </p>
                    <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                      {savedPlanItems.map((item) => {
                        const statusStyle: Record<SavedPlanItem['status'], string> = {
                          PENDING: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                          PROCESSING: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
                          DONE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
                          FAILED: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
                        };
                        const statusLabel: Record<SavedPlanItem['status'], string> = {
                          PENDING: language === 'km' ? 'រង់ចាំ' : 'Pending',
                          PROCESSING: language === 'km' ? 'កំពុងបង្កើត' : 'Generating',
                          DONE: language === 'km' ? 'រួចរាល់' : 'Done',
                          FAILED: language === 'km' ? 'បរាជ័យ' : 'Failed',
                        };
                        return (
                          <div
                            key={item.id}
                            className="flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50/50 p-3 dark:border-slate-700 dark:bg-slate-800/50"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-brand-500">
                                <span>{item.scheduledDate}</span>
                                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] dark:bg-slate-700">
                                  {item.type === 'video' ? (language === 'km' ? 'វីដេអូ' : 'Video') : (language === 'km' ? 'រូបភាព' : 'Image')}
                                </span>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] ${statusStyle[item.status]}`}>
                                  {statusLabel[item.status]}
                                </span>
                              </div>
                              <p className="mt-1 truncate text-sm font-bold text-brand-700 dark:text-brand-300">{item.topic}</p>
                              {item.status === 'FAILED' && item.errorMessage && (
                                <p className="mt-1 break-words text-xs text-rose-500">{item.errorMessage}</p>
                              )}
                              {item.status === 'FAILED' && item.resultMediaUrl && (
                                <div className="mt-2 space-y-1">
                                  <video src={item.resultMediaUrl} controls className="w-full max-w-xs rounded-lg" />
                                  <a href={item.resultMediaUrl} download className="text-[10px] font-bold text-brand-600 underline dark:text-brand-400">
                                    {language === 'km' ? 'ទាញយកវីដេអូនេះមកពិនិត្យ' : 'Download this video to review'}
                                  </a>
                                </div>
                              )}
                              {item.status === 'FAILED' && item.speechVerification && (
                                <div className="mt-1 space-y-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                                  <p>
                                    {language === 'km' ? 'ត្រូវការនិយាយ' : 'Expected'}: {item.speechVerification.expected || '—'}
                                  </p>
                                  <p>
                                    {language === 'km' ? 'ស្តាប់បាន' : 'Heard'}: {item.speechVerification.transcript || '—'}
                                    {' '}({Math.round((item.speechVerification.similarity || 0) * 100)}%)
                                  </p>
                                </div>
                              )}
                              {item.status === 'FAILED' && (
                                <button
                                  type="button"
                                  onClick={() => handleRetryPlanItem(item.id)}
                                  className="mt-2 inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:bg-slate-800 dark:text-rose-300 dark:hover:bg-rose-900/30"
                                >
                                  <RefreshCw size={10} />
                                  {language === 'km' ? 'ព្យាយាមម្តងទៀត' : 'Retry'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        <section className="xl:col-span-4 glass rounded-[2rem] p-7 space-y-5 self-start">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-brand-700 dark:text-brand-300 uppercase tracking-widest">{text.prompt}</label>
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
              className="w-full min-h-60 p-5 rounded-2xl bg-brand-50 border border-brand-200 focus:ring-2 focus:ring-brand-500 focus:bg-white dark:bg-slate-900/80 dark:text-slate-50 dark:border-brand-400/40 dark:placeholder:text-slate-300 dark:focus:bg-slate-800 outline-none transition-all resize-y font-medium"
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

              {micSupported && (
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  disabled={isTranscribing}
                  title={isListening ? text.listening : isTranscribing ? text.transcribing : text.voiceInput}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-all disabled:opacity-60 ${
                    isListening
                      ? 'bg-red-500 border-red-500 text-white animate-pulse'
                      : 'bg-white/70 dark:bg-slate-800/70 border-brand-200 text-brand-600 hover:bg-brand-50 dark:hover:bg-slate-700'
                  }`}
                >
                  {isTranscribing ? <Loader2 size={16} className="animate-spin" /> : isListening ? <MicOff size={16} /> : <Mic size={16} />}
                  {isListening ? text.listening : isTranscribing ? text.transcribing : text.voiceInput}
                </button>
              )}

              {micSupported && (
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
                <p className="text-sm font-bold text-brand-700 dark:text-brand-300">{text.autoCreate}</p>
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
            <h3 className="text-xl font-bold text-brand-700 dark:text-brand-300 flex items-center gap-2">
              <span className="w-2 h-6 bg-brand-500 rounded-full" />
              {text.result}
            </h3>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <button
                  onClick={startNewChat}
                  disabled={loading}
                  className="px-4 py-3 bg-white/70 dark:bg-slate-800/70 text-brand-600 hover:bg-brand-50 dark:hover:bg-slate-700 rounded-xl transition-all border border-brand-200 flex items-center gap-2 text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
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
                <p className="text-lg font-bold text-brand-700 dark:text-brand-300">{text.emptyTitle}</p>
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
                          : 'border border-brand-100 bg-brand-50/70 text-slate-700 dark:bg-slate-800/95 dark:border-slate-600 dark:text-slate-100 rounded-bl-md shadow-sm dark:shadow-black/20'
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
                <div className="rounded-2xl rounded-bl-md border border-brand-100 bg-brand-50/70 px-5 py-4 text-brand-600 dark:bg-slate-800/95 dark:border-slate-600 dark:text-brand-300 flex items-center gap-3">
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
