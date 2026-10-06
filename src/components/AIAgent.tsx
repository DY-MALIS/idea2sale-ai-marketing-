import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CalendarClock, Check, ChevronDown, Copy, History, Image as ImageIcon, ImagePlus, Loader2, Mic, MicOff, RefreshCw, Send, Sparkles, Trash2, UserRound, Video, X, Zap } from 'lucide-react';
import Markdown from 'react-markdown';
import { AnimatePresence, motion } from 'motion/react';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, setDoc, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import readXlsxFile from 'read-excel-file/browser';
import { db } from '../lib/firebase';
import { readImagesIntoState } from '../lib/imageUpload';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/useToast';
import { connectGeminiLive, GeminiLiveSession } from '../lib/geminiLiveClient';
import { reportClientError } from '../lib/errorReporting';
import { startVoiceConversationFallback, type VoiceConversationFallback } from '../lib/voiceConversationFallback';
import { getLatestBusinessBranding } from '../lib/businessBranding';
import { CreativeAutomationRequest } from '../types';
import { downloadAgentDocument, isAgentDocumentCommand, type AgentDocument } from '../lib/agentDocument';
import { AgentDocumentCard, AgentDocumentDialog } from './AgentDocumentCard';
import { isContentPlanEditFollowup, isContentPlanEditPronounFollowup, isContentPlanEditRequest } from '../../shared/contentPlanEditIntent.js';
import { isContentPlanCreationRequest, shouldClassifyCreativeMedia } from '../../shared/agentIntent.js';

const DEMO_AGENT_CONVERSATION_STORAGE_KEY = 'demo_agent_conversation';
// Keep recent agent work visible long enough for users to return and reuse it.
const AGENT_MEMORY_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  agentPlan?: boolean;
  modality?: 'text' | 'voice';
  imageDataUrls?: string[];
  document?: AgentDocument;
  audioUrl?: string;
  audioPending?: boolean;
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
  scriptEditedByUser?: boolean;
  performanceStyle?: string;
  aspectRatio?: '9:16' | '16:9' | '1:1' | '3:4';
  selected: boolean;
}

const normalizePlanItems = (value: unknown): PlanItem[] => (Array.isArray(value) ? value : []).map((item: any) => ({
  date: String(item.date || ''),
  type: item.type === 'video' ? 'video' as const : 'image' as const,
  topic: String(item.topic || ''),
  prompt: String(item.prompt || ''),
  headline: String(item.headline || ''),
  cta: String(item.cta || ''),
  voiceGender: item.voiceGender === 'Male' ? 'Male' as const : 'Female' as const,
  voiceOverText: String(item.voiceOverText || ''),
  performanceStyle: String(item.performanceStyle || ''),
  aspectRatio: ['9:16', '16:9', '1:1', '3:4'].includes(item.aspectRatio) ? item.aspectRatio : item.type === 'video' ? '9:16' : '1:1',
  selected: true,
}));

interface SavedPlanItem {
  id: string;
  scheduledDate: string;
  type: 'image' | 'video';
  topic: string;
  prompt: string;
  headline?: string;
  cta?: string;
  voiceGender?: 'Male' | 'Female';
  voiceOverText?: string;
  performanceStyle?: string;
  aspectRatio?: '9:16' | '16:9' | '1:1' | '3:4';
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED' | 'REVIEW' | 'READY';
  errorMessage?: string;
  resultMediaUrl?: string;
  speechVerification?: { passed: boolean; similarity?: number; transcript?: string; expected?: string; unavailable?: boolean };
}

interface AIAgentProps {
  onCreativeAutomation: (request: CreativeAutomationRequest) => void;
}

const MAX_MESSAGES = 40;
const HISTORY_MESSAGES = 20;
const MAX_SESSIONS = 20;
const MAX_IMAGES = 4;
// Matches BusinessProfile.tsx's INTRO_FILE_MAX_BYTES for the same reason: a
// PDF/Word file this size goes to the server as a base64 data URL (~33%
// larger) inside the /api/ai JSON body, and extractDocumentText's own 8MB
// cap means anything larger fails there anyway -- better to say so up front.
const PLAN_FILE_MAX_BYTES = 8 * 1024 * 1024;
const SILENT_WAV_DATA_URL = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

// A plain `session-${Date.now()}` id collides whenever two sessions are created
// within the same millisecond (e.g. a fast click, or automation firing right after
// "New chat") -- upsertSession then silently merges the two into one, which looks
// like a story going missing. The random suffix makes that practically impossible.
const newSessionId = () => `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const detectMessageLanguage = (message: string) => (
  /[\u1780-\u17FF]/.test(message) ? 'km' : 'en'
);

const sessionTitleFromMessages = (messages: AgentMessage[]) => (
  messages.find((message) => message.role === 'user' && message.content.trim() && message.modality !== 'voice')?.content.trim().slice(0, 80)
  || (messages.some((message) => message.modality === 'voice') ? 'Voice conversation' : '')
  || messages[0]?.content.trim().slice(0, 80)
  || 'Conversation'
);

const buildSession = (messages: AgentMessage[], existingId?: string): AgentConversationSession | null => {
  const textOnly = messages
    .map(({ role, content, modality, document, agentPlan }) => ({ role, content, ...(modality ? { modality } : {}), ...(document ? { document } : {}), ...(agentPlan ? { agentPlan } : {}) }))
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
  businessDescription: string;
  directory: { name: string; type: string }[];
  tiktokHandle: string;
  facebookPageUrl: string;
  websiteUrl: string;
  linkedinUrl: string;
  telegramChannelUrl: string;
}

const AIAgent: React.FC<AIAgentProps> = ({ onCreativeAutomation }) => {
  const { language } = useLanguage();
  const { user, isDemoMode } = useAuth();
  const { notify, ToastHost } = useToast();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoCreateEnabled, setAutoCreateEnabled] = useState(true);
  const autoCreateEnabledRef = useRef(autoCreateEnabled);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [conversationSessions, setConversationSessions] = useState<AgentConversationSession[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => newSessionId());
  const messagesRef = useRef(messages);
  const conversationSessionsRef = useRef(conversationSessions);
  const activeSessionIdRef = useRef(activeSessionId);
  useEffect(() => {
    messagesRef.current = messages;
    conversationSessionsRef.current = conversationSessions;
    activeSessionIdRef.current = activeSessionId;
  }, [messages, conversationSessions, activeSessionId]);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const attachedImagesRef = useRef(attachedImages);
  useEffect(() => { attachedImagesRef.current = attachedImages; }, [attachedImages]);
  const [liveVoiceEnabled, setLiveVoiceEnabled] = useState(false);
  const liveVoiceEnabledRef = useRef(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceConnecting, setVoiceConnecting] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  // The voice orb UI replaces the chat transcript while a call is active, so
  // without this the user never sees what was just said or created -- only
  // hears it. Holds the latest reply text (and, when a content/plan/video
  // request fires, the brief) to caption on screen during the call.
  const [voiceCaption, setVoiceCaption] = useState('');
  const [voiceDocument, setVoiceDocument] = useState<AgentDocument | null>(null);
  const [documentDialog, setDocumentDialog] = useState<AgentDocument | null>(null);
  const [voiceRetryAt, setVoiceRetryAt] = useState(0);
  const voiceRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceActiveRef = useRef(false);
  // Both voice buttons control the same continuing conversation.
  const geminiLiveSessionRef = useRef<GeminiLiveSession | null>(null);
  const geminiLiveActiveRef = useRef(false);
  const liveConnectionControllerRef = useRef<AbortController | null>(null);
  const fallbackSessionRef = useRef<VoiceConversationFallback | null>(null);
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null);

  const handleDocumentDownload = (document: AgentDocument) => {
    try {
      downloadAgentDocument(document);
    } catch (error) {
      console.error('Document download failed:', error);
      notify(language === 'km' ? 'មិនអាចទាញយកឯកសារបានទេ។ សូមចុចប៊ូតុងម្ដងទៀត។' : 'Could not download the document. Please try the button again.', 'error');
    }
  };

  // Shared by both the text-chat flow (askAgent) and the Live Voice realtime
  // path below -- whichever one detected a complete "create a video/plan"
  // brief, this is the one place that turns it into an actual generator
  // request and sanitizes its fields. Returns the sanitized request so a
  // caller can also use it to caption on screen what's being created.
  const triggerCreativeAutomation = (automation: any, detectedLanguage: 'km' | 'en'): CreativeAutomationRequest => {
    const kind = automation.kind === 'video' ? 'video' : 'image';
    const request: CreativeAutomationRequest = {
      id: `${Date.now()}-${kind}`,
      kind,
      imageMode: kind === 'image' && automation.imageMode === 'poster' ? 'poster' : 'visual',
      prompt: String(automation.prompt || '').trim(),
      platform: ['TikTok', 'Facebook', 'X', 'Telegram'].includes(automation.platform)
        ? automation.platform
        : 'General',
      aspectRatio: ['1:1', '9:16', '16:9', '4:5', '3:4'].includes(automation.aspectRatio)
        ? automation.aspectRatio
        : (kind === 'video' ? '9:16' : '1:1'),
      language: detectedLanguage,
      voiceOverText: kind === 'video' ? String(automation.voiceOverText || '').trim() : undefined,
      headline: kind === 'image' ? String(automation.headline || '').trim() : undefined,
      cta: kind === 'image' ? String(automation.cta || '').trim() : undefined,
      posterStyle: kind === 'image' ? String(automation.posterStyle || 'Modern').trim() : undefined,
      duration: kind === 'video' && [4, 6, 8].includes(Number(automation.duration))
        ? Number(automation.duration)
        : undefined,
      voiceGender: kind === 'video' && ['Male', 'Female'].includes(automation.voiceGender)
        ? automation.voiceGender
        : undefined,
      performanceStyle: kind === 'video' ? String(automation.performanceStyle || '').trim() || undefined : undefined,
      allowScriptShortening: kind === 'video',
    };
    onCreativeAutomation(request);
    return request;
  };

  // "Create a video/plan" needs a visible brief, not just the orb's spoken
  // audio -- builds the same on-screen caption from a triggered request's
  // sanitized fields, whichever voice path (fast Live or fallback) produced it.
  const automationCaption = (request: CreativeAutomationRequest): string => {
    const km = language === 'km';
    const headline = request.kind === 'video'
      ? (km ? `កំពុងបង្កើតវីដេអូ (${request.platform} • ${request.aspectRatio} • ${request.duration || 8}s)` : `Creating a video (${request.platform} • ${request.aspectRatio} • ${request.duration || 8}s)`)
      : (km ? `កំពុងបង្កើតរូបភាព (${request.platform} • ${request.aspectRatio})` : `Creating an image (${request.platform} • ${request.aspectRatio})`);
    return [headline, request.headline, request.voiceOverText, request.cta].filter((part) => part && part.trim()).join('\n\n');
  };

  const startFallbackVoice = (session: number) => {
    if (session !== voiceSessionRef.current || !voiceActiveRef.current) return;
    if (fallbackSessionRef.current) return;
    geminiLiveActiveRef.current = false;
    geminiLiveSessionRef.current = null;
    const audioElement = fallbackAudioRef.current || new Audio();
    fallbackAudioRef.current = audioElement;
    fallbackSessionRef.current = startVoiceConversationFallback({
      audioElement,
      languageHint: () => voiceInputLanguageRef.current,
      voiceGenderHint: () => voiceGenderRef.current,
      onListening: () => { setVoiceConnecting(false); setVoiceProcessing(false); setIsSpeaking(false); },
      onThinking: () => setVoiceProcessing(true),
      onSpeaking: () => { setVoiceProcessing(false); setIsSpeaking(true); },
      onReplyComplete: () => setIsSpeaking(false),
      onTranscript: async (transcript) => {
        const answer = await askAgent(transcript, true);
        if (answer && session === voiceSessionRef.current) setVoiceCaption(answer);
        return answer;
      },
      onError: (error) => {
        if (session !== voiceSessionRef.current || !voiceActiveRef.current) return;
        stopLiveVoice();
        notify(error.message, 'error');
      },
    });
  };

  // Gemini Live returns audio directly, while its user transcript lets this
  // app handle document and Content Plan commands. Those turns stay silent
  // until the corresponding on-screen result or error is available.
  const handleLiveUserTurn = (session: number, transcript: string) => {
    const planEditCommand = isPlanEditMessage(transcript);
    const agentPlanCommand = isAgentPlanMessage(transcript);
    const documentCommand = isAgentDocumentCommand(transcript);
    const mediaCommand = shouldClassifyCreativeMedia(transcript, messagesRef.current
      .slice(-4).map((item) => `${item.role === 'assistant' ? 'Assistant' : 'User'}: ${item.content}`).join('\n'));
    const handledCommand = planEditCommand || agentPlanCommand || documentCommand;
    if (session !== voiceSessionRef.current || !voiceActiveRef.current) return handledCommand;
    if (handledCommand) {
      setVoiceProcessing(true);
      setVoiceCaption(planEditCommand || agentPlanCommand
        ? (language === 'km' ? 'កំពុងកែ Content Plan...' : 'Updating Content Plan...')
        : (language === 'km' ? 'កំពុងបង្កើតផែនការ និងឯកសារ...' : 'Creating your plan and document...'));
    }
    void (async () => {
      try {
        if (agentPlanCommand) {
          const answer = await askAgent(transcript, true);
          if (session === voiceSessionRef.current && voiceActiveRef.current) setVoiceCaption(answer);
          return;
        }
        if (planEditCommand) {
          const answer = await editContentPlan(transcript);
          if (session === voiceSessionRef.current && voiceActiveRef.current) setVoiceCaption(answer);
          updateMessages([
            ...messagesRef.current,
            { role: 'user', content: transcript, modality: 'voice' },
            { role: 'assistant', content: answer, modality: 'voice' },
          ]);
          return;
        }
        const detectedLanguage = detectMessageLanguage(transcript);
        const response = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'voiceAutomationCheck',
            message: transcript,
            history: messagesRef.current.slice(-HISTORY_MESSAGES),
            detectedLanguage,
            businessContext: businessContext || undefined,
            contentPlan: contentPlanForAgent(),
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if ((documentCommand || mediaCommand) && session === voiceSessionRef.current) {
            const error = String(data.error || (language === 'km' ? 'មិនអាចចាប់ផ្ដើមការបង្កើតបានទេ។' : 'Could not start generation.'));
            setVoiceCaption(error);
            notify(error, 'error');
          }
          return;
        }
        if (!documentCommand && (session !== voiceSessionRef.current || !voiceActiveRef.current)) return;
        if (data.document) {
          const document = data.document as AgentDocument;
          const caption = language === 'km' ? `ឯកសារ ${document.format.toUpperCase()} រួចរាល់៖ ${document.title}` : `${document.format.toUpperCase()} ready: ${document.title}`;
          if (session === voiceSessionRef.current && voiceActiveRef.current) setVoiceDocument(document);
          setDocumentDialog(document);
          if (session === voiceSessionRef.current && voiceActiveRef.current) setVoiceCaption(caption);
          updateMessages([
            ...messagesRef.current,
            { role: 'user', content: transcript, modality: 'voice' },
            { role: 'assistant', content: caption, modality: 'voice', document },
          ]);
          return;
        }
        if (!data.automation?.ready || !autoCreateEnabledRef.current) {
          if (mediaCommand && session === voiceSessionRef.current) {
            setVoiceCaption(!autoCreateEnabledRef.current
              ? (language === 'km' ? 'សូមបើកការបង្កើតរូប/វីដេអូស្វ័យប្រវត្តិ រួចបញ្ជាម្ដងទៀត។' : 'Turn on automatic image/video creation, then ask again.')
              : String(data.automation?.missing || (language === 'km'
                ? 'មិនទាន់ចាប់ផ្ដើមបង្កើតទេ។ សូមបញ្ជាក់ប្រធានបទ និងសំឡេងដែលចង់បាន។'
                : 'Creation has not started. Please clarify the subject and narration.')));
          }
          return;
        }
        const request = triggerCreativeAutomation(data.automation, detectedLanguage);
        const caption = automationCaption(request);
        setVoiceCaption(caption);
        updateMessages([
          ...messagesRef.current,
          { role: 'user', content: transcript, modality: 'voice' },
          { role: 'assistant', content: caption, modality: 'voice' },
        ]);
      } catch (error) {
        console.error('Live Voice automation check failed:', error);
        if (handledCommand || mediaCommand) {
          const message = error instanceof Error ? error.message : (language === 'km' ? 'មិនអាចដំណើរការបញ្ជានេះបានទេ។' : 'Could not process this command.');
          if (session === voiceSessionRef.current && voiceActiveRef.current) setVoiceCaption(message);
          notify(message, 'error');
        }
      } finally {
        if (handledCommand && session === voiceSessionRef.current) setVoiceProcessing(false);
      }
    })();
    return handledCommand;
  };

  const startGeminiLive = async (session: number, playbackContext: AudioContext): Promise<boolean> => {
    const controller = new AbortController();
    liveConnectionControllerRef.current = controller;
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          businessContext: businessContext || undefined,
          voiceLanguage: voiceInputLanguageRef.current,
          voiceName: voiceGenderRef.current === 'Male' ? 'Achird' : undefined,
          action: 'geminiLiveToken',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 429) {
        const seconds = Math.min(3600, Math.max(1, Number(data.retryAfterSeconds || response.headers.get('Retry-After')) || 60));
        setVoiceRetryAt(Date.now() + seconds * 1000);
        if (voiceRetryTimerRef.current) clearTimeout(voiceRetryTimerRef.current);
        voiceRetryTimerRef.current = setTimeout(() => setVoiceRetryAt(0), seconds * 1000);
      }
      if (!response.ok || !data.token) throw new Error(data.error || 'Gemini Live is unavailable.');
      if (session !== voiceSessionRef.current || !voiceActiveRef.current) {
        void playbackContext.close().catch(() => {});
        return false;
      }

      const geminiSession = await connectGeminiLive(data.token, data.model, playbackContext, {
        onAudioStart: () => setIsSpeaking(true),
        onInterrupted: () => setIsSpeaking(false),
        onPlaybackComplete: () => {
          setIsSpeaking(false);
        },
        onUserTurnText: (text) => handleLiveUserTurn(session, text),
        onUserTranscription: (text) => isAgentDocumentCommand(text) || isAgentPlanMessage(text) || isPlanEditMessage(text),
        // Every drop to the slow fallback path previously left no trace of
        // why -- reporting here is the only way to learn whether real users'
        // Gemini Live connections are failing at all, and if so why, without
        // asking them to open devtools.
        onError: (error) => { reportClientError('geminiLive.onError', error); startFallbackVoice(session); },
        onClose: () => { reportClientError('geminiLive.onClose', new Error('Gemini Live closed unexpectedly')); startFallbackVoice(session); },
      }, { voiceName: data.voiceName, systemInstruction: data.systemInstruction }, controller.signal);

      if (session !== voiceSessionRef.current || !voiceActiveRef.current) {
        geminiSession.close();
        return false;
      }
      geminiLiveActiveRef.current = true;
      geminiLiveSessionRef.current = geminiSession;
      setVoiceConnecting(false);
      return true;
    } catch (error) {
      void playbackContext.close().catch(() => {});
      if (session === voiceSessionRef.current && voiceActiveRef.current && !controller.signal.aborted) {
        reportClientError('geminiLive.connect', error);
        startFallbackVoice(session);
      }
      return false;
    } finally {
      if (liveConnectionControllerRef.current === controller && controller.signal.aborted) {
        liveConnectionControllerRef.current = null;
      }
    }
  };
  const voiceSessionRef = useRef(0);
  const [businessContext, setBusinessContext] = useState<AgentBusinessContext | null>(null);
  // Speech language is independent of the UI language. Auto allows Khmer,
  // English, and mixed turns; explicit choices guide the live audio model.
  const [voiceInputLanguage, setVoiceInputLanguage] = useState<'auto' | 'km' | 'en'>('auto');
  const voiceInputLanguageRef = useRef(voiceInputLanguage);
  // Picks both which Gemini voice speaks (Achird/Aoede) and the gendered
  // delivery style sent alongside it (firm for male, gentle for female) --
  // see the geminiLiveToken and ttsGenerate handlers in api/ai.js.
  const [voiceGender, setVoiceGender] = useState<'Female' | 'Male'>('Female');
  const voiceGenderRef = useRef(voiceGender);
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const audioControllersRef = useRef<Set<AbortController>>(new Set());
  const agentRequestActiveRef = useRef(false);

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
  const [planEditNotice, setPlanEditNotice] = useState<string | null>(null);
  const [planSavedCount, setPlanSavedCount] = useState<number | null>(null);
  const [savedPlanItems, setSavedPlanItems] = useState<SavedPlanItem[]>([]);
  const planFileInputRef = useRef<HTMLInputElement>(null);
  const planSectionRef = useRef<HTMLElement>(null);

  function contentPlanForAgent() {
    return (planItems.length ? planItems.filter((item) => item.selected) : savedPlanItems).slice(0, 60).map((item) => ({
      date: 'date' in item ? item.date : item.scheduledDate,
      type: item.type,
      topic: item.topic,
      prompt: item.prompt,
      voiceOverText: item.voiceOverText || '',
    }));
  }

  const isPlanEditMessage = (message: string) => {
    const conversation = messagesRef.current;
    const latestAgentPlan = [...conversation].reverse().find((item) => item.role === 'assistant' && item.agentPlan);
    const last = conversation.at(-1);
    const previousAssistant = last?.role === 'assistant' ? last : conversation.at(-2);
    if (latestAgentPlan && (isContentPlanEditRequest(message)
      || (previousAssistant?.agentPlan && isContentPlanEditFollowup(message)))) return false;
    if (!(planItems.length > 0 || savedPlanItems.length > 0)) return false;
    if (isContentPlanEditRequest(message)) return true;
    // Only trust a bare pronoun reference ("change it...") with no assistant
    // context at all as the session's very first turn -- the plan card is the
    // only thing "it" could mean then. Once there's any conversation history,
    // require the previous assistant turn to have actually mentioned the plan,
    // or an unrelated "update it"/"change it" elsewhere in the chat would get
    // misrouted into a plan edit just because a saved plan happens to exist.
    if (!conversation.length && isContentPlanEditPronounFollowup(message)) return true;
    return previousAssistant?.role === 'assistant'
      && /content\s*plan|ផែនការ/iu.test(previousAssistant.content)
      && isContentPlanEditFollowup(message);
  };

  const isAgentPlanMessage = (message: string) => {
    if (isContentPlanCreationRequest(message)) return true;
    const conversation = messagesRef.current;
    const latestAgentPlan = [...conversation].reverse().find((item) => item.role === 'assistant' && item.agentPlan);
    if (!latestAgentPlan) return false;
    const last = conversation.at(-1);
    const previousAssistant = last?.role === 'assistant' ? last : conversation.at(-2);
    return isContentPlanEditRequest(message)
      || Boolean(previousAssistant?.agentPlan && isContentPlanEditFollowup(message));
  };

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
              prompt: String(data.prompt || ''),
              headline: String(data.headline || ''),
              cta: String(data.cta || ''),
              voiceGender: data.voiceGender === 'Male' ? 'Male' : 'Female',
              voiceOverText: String(data.voiceOverText || ''),
              performanceStyle: String(data.performanceStyle || ''),
              aspectRatio: ['9:16', '16:9', '1:1', '3:4'].includes(data.aspectRatio) ? data.aspectRatio : data.type === 'video' ? '9:16' : '1:1',
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
  // Guards against overwriting the just-loaded saved conversation with an empty
  // autosave that could otherwise fire before the initial load resolves.
  const memoryLoadedRef = useRef(false);
  const micSupported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  useEffect(() => () => {
    requestControllerRef.current?.abort();
    audioControllersRef.current.forEach((controller) => controller.abort());
  }, []);
  // Long-term memory: reload the saved conversation so the agent keeps context
  // across page reloads and sessions instead of forgetting everything the
  // moment the tab closes.
  useEffect(() => {
    let cancelled = false;
    memoryLoadedRef.current = false;
    // Reset immediately, before the async load resolves — this is an SPA where
    // logging out or switching accounts doesn't reload the page, so without this
    // the previous user's conversation would stay visible (or race with and get
    // clobbered onto) the newly-signed-in user's data.
    setMessages([]);
    setConversationSessions([]);
    setActiveSessionId(newSessionId());
    setDocumentDialog(null);

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
        } else {
          const conversationSnap = await getDoc(doc(db, 'agent_conversations', user.uid));
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

  // Business Profile stays mounted alongside AI Agent in this SPA, so a save
  // there must refresh this tab's cached context too -- otherwise chat, plan
  // generation, and Live Voice keep using whatever was loaded at mount.
  // getLatestBusinessBranding (the same helper every other generation surface
  // uses) carries the full saved profile, not just the name/directory this
  // used to fetch by hand -- Live Voice and content-plan prompts also fold in
  // businessDescription and the saved social channels (businessContentInstruction
  // in api/ai.js), so a partial context silently under-used what was saved.
  useEffect(() => {
    let cancelled = false;
    // Reset synchronously, before the async load resolves -- this is an SPA
    // where switching accounts or toggling demo mode doesn't reload the page,
    // so without this a message sent in that gap would still be grounded in
    // the previous account's business name, description, and social channels.
    setBusinessContext(null);
    const loadBusinessContext = () => getLatestBusinessBranding(user, isDemoMode).then((branding) => {
      if (cancelled) return;
      setBusinessContext({
        businessName: branding.businessName,
        businessDescription: branding.businessDescription,
        directory: branding.directory,
        tiktokHandle: branding.tiktokHandle,
        facebookPageUrl: branding.facebookPageUrl,
        websiteUrl: branding.websiteUrl,
        linkedinUrl: branding.linkedinUrl,
        telegramChannelUrl: branding.telegramChannelUrl,
      });
    });
    void loadBusinessContext();
    window.addEventListener('business-profile-updated', loadBusinessContext);
    return () => {
      cancelled = true;
      window.removeEventListener('business-profile-updated', loadBusinessContext);
    };
  }, [user, isDemoMode]);

  // Only the text survives into persisted memory — attached image previews are
  // base64 data URLs that would blow past Firestore's 1MB document limit and
  // add real storage cost within a handful of exchanges, so they stay session-only.
  const persistConversation = (nextMessages: AgentMessage[], sessionsOverride = conversationSessions, sessionId = activeSessionId) => {
    if (!memoryLoadedRef.current) return;
    const textOnly = nextMessages.map(({ role, content, modality, document, agentPlan }) => ({ role, content, ...(modality ? { modality } : {}), ...(document ? { document } : {}), ...(agentPlan ? { agentPlan } : {}) }));
    const currentSession = buildSession(textOnly, sessionId);
    const sessions = currentSession
      ? [
          currentSession,
          ...sessionsOverride.filter((session) => session.id !== currentSession.id),
        ].slice(0, MAX_SESSIONS)
      : sessionsOverride.slice(0, MAX_SESSIONS);
    // The active chat is already stored in `messages`; storing it again in
    // `sessions` doubles large document previews. Keep older sessions within
    // Firestore's document limit and discard oldest history only if needed.
    let storedMessages = textOnly;
    const storedSessions = sessions.filter((session) => session.id !== sessionId);
    const encoder = new TextEncoder();
    const savedBytes = () => encoder.encode(JSON.stringify({ messages: storedMessages, sessions: storedSessions })).length;
    while (storedSessions.length && savedBytes() > 700_000) storedSessions.pop();
    while (storedMessages.length > 1 && savedBytes() > 700_000) storedMessages = storedMessages.slice(1);
    try {
      if (isDemoMode || !user) {
        localStorage.setItem(DEMO_AGENT_CONVERSATION_STORAGE_KEY, JSON.stringify({
          messages: storedMessages,
          sessions: storedSessions,
          activeSessionId: sessionId,
          updatedAt: Date.now(),
        }));
      } else {
        void setDoc(doc(db, 'agent_conversations', user.uid), {
          messages: storedMessages,
          sessions: storedSessions,
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
    voiceInput: language === 'km' ? 'សន្ទនាសំឡេង' : 'Voice conversation',
    listening: language === 'km' ? 'កំពុងស្តាប់...' : 'Listening...',
  }), [language]);

  const updateMessages = (nextMessages: AgentMessage[]) => {
    const trimmed = nextMessages.slice(-MAX_MESSAGES);
    const currentSession = buildSession(trimmed, activeSessionIdRef.current);
    const nextSessions = upsertSession(conversationSessionsRef.current, currentSession);
    messagesRef.current = trimmed;
    conversationSessionsRef.current = nextSessions;
    setConversationSessions(nextSessions);
    setMessages(trimmed);
    persistConversation(trimmed, nextSessions);
  };

  const startNewChat = () => {
    requestControllerRef.current?.abort();
    const nextSessionId = newSessionId();
    const nextSessions = upsertSession(conversationSessions, buildSession(messages, activeSessionId));
    setMessages([]);
    setDocumentDialog(null);
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

  const runPlanExtraction = async (body: { planText?: string; planUrl?: string; fileDataUrl?: string; fileName?: string }) => {
    setPlanExtracting(true);
    setPlanError(null);
    setPlanSavedCount(null);
    setPlanEditNotice(null);
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extractContentPlan', language, businessContext: businessContext || undefined, ...body }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not read this content plan.');
      const items = normalizePlanItems(data.items);
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

    // Plain text/CSV can be read directly; anything else (PDF, Word, or any
    // other file type the picker no longer blocks) is handed to the server
    // as a data URL -- extractDocumentText there does the real parsing (or
    // returns a clear "unsupported file type" error for something it
    // genuinely can't read, e.g. an image), rather than this reading raw
    // binary bytes as mangled "text".
    const isPlainText = /\.(csv|txt)$/i.test(file.name) || file.type === 'text/csv' || file.type === 'text/plain';
    if (!isPlainText && file.size > PLAN_FILE_MAX_BYTES) {
      setPlanError(language === 'km' ? 'ឯកសារនេះធំពេក (កំណត់ត្រឹម ៨MB)។' : 'That file is too large (8 MB limit).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => void runPlanExtraction(isPlainText
      ? { planText: String(reader.result || '') }
      : { fileDataUrl: String(reader.result || ''), fileName: file.name });
    reader.onerror = () => setPlanError(language === 'km' ? 'មិនអាចអានឯកសារនេះបានទេ។' : 'Could not read this file.');
    if (isPlainText) reader.readAsText(file);
    else reader.readAsDataURL(file);
  };

  const handlePlanLinkSubmit = () => {
    const url = planLink.trim();
    if (!url) return;
    void runPlanExtraction({ planUrl: url });
  };

  const togglePlanItem = (index: number) => {
    setPlanItems((items) => items.map((item, i) => (i === index ? { ...item, selected: !item.selected } : item)));
  };

  const updatePlanNarration = (index: number, voiceOverText: string) => {
    setPlanItems((items) => items.map((item, i) => (i === index ? { ...item, voiceOverText, scriptEditedByUser: true } : item)));
  };

  const handleSavePlan = async () => {
    if (!user || isDemoMode) return;
    const selectedItems = planItems.filter((item) => item.selected);
    if (!selectedItems.length) return;
    if (selectedItems.some((item) => item.type === 'video' && !/[\u1780-\u17ff]/u.test(item.voiceOverText || ''))) {
      setPlanError(language === 'km' ? 'សូមដាក់អត្ថបទនិយាយជាភាសាខ្មែរសម្រាប់វីដេអូ ៨ វិនាទី។' : 'Add Khmer narration for each 8-second video before saving.');
      return;
    }
    setPlanSaving(true);
    setPlanError(null);
    setPlanEditNotice(null);
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
          businessName: businessContext?.businessName || '',
          ...(item.type === 'image'
            ? { headline: item.headline || '', cta: item.cta || '', aspectRatio: item.aspectRatio || '1:1' }
            : { voiceGender: item.voiceGender || 'Female', voiceOverText: item.voiceOverText || '', scriptEditedByUser: item.scriptEditedByUser === true, duration: 8, performanceStyle: item.performanceStyle || '', aspectRatio: item.aspectRatio || '9:16', voiceOverWanted: true, voiceOverMode: 'edge-seedance' }),
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

  const editContentPlan = async (message: string, signal?: AbortSignal, priorMessages: AgentMessage[] = messagesRef.current): Promise<string> => {
    const target = planItems.length ? 'draft' : 'saved';
    const items = target === 'draft' ? planItems : savedPlanItems;
    if (!items.length) return language === 'km'
      ? 'មិនទាន់មាន Content Plan នៅក្នុងកាតសម្រាប់កែទេ។ សូមបញ្ចូល ឬរក្សាទុកផែនការជាមុន។'
      : 'There is no Content Plan in the card to edit yet. Add or save a plan first.';
    const response = await fetch('/api/ai', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(target === 'saved' && user ? { Authorization: `Bearer ${await user.getIdToken()}` } : {}),
      },
      body: JSON.stringify({
        action: 'editContentPlan',
        message,
        planContext: priorMessages.slice(-4).map(({ role, content }) => ({ role, content: content.slice(0, 1000) })),
        target,
        businessName: businessContext?.businessName || '',
        items: items.map((item) => ({
          ...item,
          date: 'date' in item ? item.date : item.scheduledDate,
          status: 'status' in item ? item.status : 'DRAFT',
        })),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not update the Content Plan.');
    const patches = (Array.isArray(data.patches) ? data.patches : []) as { index: number; changes: Partial<PlanItem> }[];
    const removals = (Array.isArray(data.removals) ? data.removals : []) as number[];
    const additions = (Array.isArray(data.additions) ? data.additions : []) as SavedPlanItem[];
    const totalChanges = patches.length + removals.length + additions.length;
    if (!totalChanges) return language === 'km'
      ? 'ខ្ញុំមិនអាចកំណត់ជួរណា ឬអ្វីដែលត្រូវកែបានច្បាស់ទេ។ សូមបញ្ជាក់ថ្ងៃ ឬចំណងជើងក្នុង Content Plan។'
      : 'I could not identify which plan row to change. Specify its date or topic.';
    if (target === 'saved' && data.applied !== true) throw new Error('The Content Plan update was not saved.');
    if (target === 'draft') {
      const removedIndexes = new Set(removals);
      setPlanItems((current) => [...current.map((item, index) => {
        const patch = patches.find((entry) => entry.index === index + 1);
        return patch ? { ...item, ...patch.changes } : item;
      }).filter((_, index) => !removedIndexes.has(index + 1)), ...additions.map((item) => ({
        ...item,
        date: item.scheduledDate,
        selected: true,
      }))]);
    } else {
      const changesById = new Map(patches.map((entry) => [savedPlanItems[entry.index - 1]?.id, entry.changes]));
      const removedIds = new Set(removals.map((index) => savedPlanItems[index - 1]?.id));
      setSavedPlanItems((current) => [...current.filter((item) => !removedIds.has(item.id)).map((item) => {
        const changes = changesById.get(item.id);
        if (!changes) return item;
        const { date, ...fields } = changes;
        return { ...item, ...fields, ...(date ? { scheduledDate: date } : {}) } as SavedPlanItem;
      }), ...additions].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)));
    }
    setPlanOpen(true);
    setPlanError(null);
    setPlanSavedCount(null);
    const editedTopics = [
      ...patches.map(({ index, changes }) => changes.topic || items[index - 1]?.topic),
      ...additions.map((item) => item.topic),
      ...removals.map((index) => items[index - 1]?.topic),
    ].filter(Boolean).slice(0, 3).join(' · ');
    const summary = language === 'km'
      ? [patches.length && `កែ ${patches.length}`, additions.length && `បន្ថែម ${additions.length}`, removals.length && `លុប ${removals.length}`].filter(Boolean).join(' · ')
      : [patches.length && `edited ${patches.length}`, additions.length && `added ${additions.length}`, removals.length && `removed ${removals.length}`].filter(Boolean).join(' · ');
    setPlanEditNotice(`${summary}: ${editedTopics}`);
    window.requestAnimationFrame(() => planSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    return language === 'km'
      ? `Content Plan៖ ${summary}${target === 'draft' ? ' ក្នុងសេចក្តីព្រាង។ សូមចុច «រក្សាទុកផែនការ» ដើម្បីរក្សាទុកជាផ្លូវការ។' : ' និងរក្សាទុករួច។'} សូមមើលកាតខាងលើ។`
      : `Content Plan: ${summary}${target === 'draft' ? ' in the draft. Click Save Plan to schedule them.' : ' and saved.'} Review the card above.`;
  };

  const handleReviewPlanItem = async (itemId: string, action: 'approve' | 'retry', mediaUrl?: string) => {
    try {
      if (!user) throw new Error('Please sign in.');
      const response = await fetch('/api/telegram/run-scheduled?action=review-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await user.getIdToken() },
        body: JSON.stringify({ itemId, action, mediaUrl }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update video.');
      if (action === 'approve') notify(language === 'km' ? 'បានដាក់ក្នុងជួរបញ្ជូន Telegram។' : 'Queued for Telegram delivery.', 'success');
    } catch (error: any) {
      notify(error.message || 'Could not update video.', 'error');
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

  const stopLiveVoice = () => {
    voiceSessionRef.current += 1;
    voiceActiveRef.current = false;
    liveVoiceEnabledRef.current = false;
    setLiveVoiceEnabled(false);
    setVoiceConnecting(false);
    setVoiceProcessing(false);
    liveConnectionControllerRef.current?.abort();
    liveConnectionControllerRef.current = null;
    fallbackSessionRef.current?.close();
    fallbackSessionRef.current = null;
    if (fallbackAudioRef.current) {
      fallbackAudioRef.current.pause();
      fallbackAudioRef.current.src = '';
    }
    requestControllerRef.current?.abort();
    // Clear the active flag before close() so the session's own onClose handler
    // (which also runs for this intentional close, not just a dropped
    // connection) sees Live Voice is already off.
    if (geminiLiveActiveRef.current) {
      geminiLiveActiveRef.current = false;
      geminiLiveSessionRef.current?.close();
      geminiLiveSessionRef.current = null;
    }
    setIsSpeaking(false);
    setVoiceCaption('');
    setVoiceDocument(null);
  };

  const startVoice = () => {
    if (voiceActiveRef.current) {
      stopLiveVoice();
      return;
    }
    voiceSessionRef.current += 1;
    const session = voiceSessionRef.current;
    voiceActiveRef.current = true;
    liveVoiceEnabledRef.current = true;
    setLiveVoiceEnabled(true);
    setVoiceConnecting(true);
    setVoiceProcessing(false);
    setIsSpeaking(false);
    setVoiceCaption('');
    setVoiceDocument(null);
    try {
      // Unlock this exact element during the click so fallback speech can play
      // after async transcription, including on browsers with strict autoplay.
      const fallbackAudio = fallbackAudioRef.current || new Audio();
      fallbackAudioRef.current = fallbackAudio;
      fallbackAudio.src = SILENT_WAV_DATA_URL;
      void fallbackAudio.play().catch(() => {});
      if (Date.now() < voiceRetryAt) {
        startFallbackVoice(session);
        return;
      }
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) throw new Error('Live audio is not supported by this browser.');
      const playbackContext: AudioContext = new AudioContextCtor({ sampleRate: 24000 });
      void playbackContext.resume().catch(() => {});
      void startGeminiLive(session, playbackContext);
    } catch (error) {
      stopLiveVoice();
      notify(error instanceof Error ? error.message : 'Live audio is unavailable.', 'error');
    }
  };

  useEffect(() => () => {
    voiceSessionRef.current += 1;
    voiceActiveRef.current = false;
    liveConnectionControllerRef.current?.abort();
    geminiLiveSessionRef.current?.close();
    fallbackSessionRef.current?.close();
    if (voiceRetryTimerRef.current) clearTimeout(voiceRetryTimerRef.current);
  }, []);

  const askAgent = async (messageOverride?: string, spoken = false): Promise<string> => {
    if (voiceActiveRef.current && !spoken) return '';
    const message = (messageOverride ?? input).trim();
    const imagesForRequest = spoken ? [] : attachedImagesRef.current;
    if ((!message && !imagesForRequest.length) || agentRequestActiveRef.current) return '';
    agentRequestActiveRef.current = true;

    const history = messagesRef.current.slice(-HISTORY_MESSAGES);
    const latestAgentPlan = [...messagesRef.current].reverse().find((item) => item.role === 'assistant' && item.agentPlan);
    const previousAssistant = history.at(-1)?.role === 'assistant' ? history.at(-1) : history.at(-2);
    const agentPlanText = latestAgentPlan && (isContentPlanEditRequest(message)
      || (previousAssistant?.agentPlan && isContentPlanEditFollowup(message)))
      ? latestAgentPlan.content : undefined;
    // Must run before updateMessages mutates messagesRef.current below --
    // isPlanEditMessage's first-turn pronoun check depends on the message
    // list still being empty for a session's very first message, and
    // updateMessages immediately appends this user message into that ref.
    const planEditCommand = isPlanEditMessage(message);
    const autoCreateRequested = autoCreateEnabledRef.current;
    const userMessage: AgentMessage = {
      role: 'user',
      content: message || (language === 'km' ? '(រូបភាពភ្ជាប់)' : '(Attached image)'),
      modality: spoken ? 'voice' : 'text',
      imageDataUrls: imagesForRequest.length
        ? imagesForRequest.map((image) => `data:${image.mimeType};base64,${image.base64}`)
        : undefined,
    };
    const pendingMessages = [...messagesRef.current, userMessage].slice(-MAX_MESSAGES);
    updateMessages(pendingMessages);
    if (!spoken) {
      setInput('');
      setAttachedImages([]);
      attachedImagesRef.current = [];
    }
    setLoading(true);

    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;

    try {
      if (planEditCommand) {
        const answer = await editContentPlan(message, controller.signal, history);
        updateMessages([...pendingMessages, { role: 'assistant', content: answer, modality: spoken ? 'voice' : 'text' }]);
        if (spoken) setVoiceCaption(answer);
        return spoken ? '' : answer;
      }
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          action: 'socialAgent',
          message,
          platform: 'Auto',
          mode: 'auto',
          liveVoice: spoken,
          language,
          detectedLanguage: message ? detectMessageLanguage(message) : language,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          history,
          agentPlanText,
          images: imagesForRequest.map((image) => ({ base64: image.base64, mimeType: image.mimeType })),
          businessContext: businessContext || undefined,
          contentPlan: contentPlanForAgent(),
          autoCreateEnabled: autoCreateRequested,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'AI Agent failed.');
      const document = data.document as AgentDocument | undefined;
      const answer = document
        ? (language === 'km' ? `ឯកសារ ${document.format.toUpperCase()} រួចរាល់៖ ${document.title}` : `${document.format.toUpperCase()} ready: ${document.title}`)
        : String(data.text || 'No response generated.').trim();

      const assistantMessage: AgentMessage = { role: 'assistant', content: answer, modality: spoken ? 'voice' : 'text', ...(document ? { document } : {}), ...(data.agentPlan ? { agentPlan: true } : {}), ...(data.audioScript ? { audioPending: true } : {}) };
      updateMessages([...pendingMessages, assistantMessage]);

      if (data.audioScript) {
        const audioController = new AbortController();
        audioControllersRef.current.add(audioController);
        void (async () => {
          try {
            const audioResponse = await fetch('/api/ai', {
              method: 'POST', signal: audioController.signal,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'ttsGenerate', input: String(data.audioScript).slice(0, 500), voice: voiceGenderRef.current === 'Male' ? 'onyx' : 'alloy', languageHint: message ? detectMessageLanguage(message) : language }),
            });
            const audioData = await audioResponse.json();
            if (!audioResponse.ok || !audioData.audioUrl) throw new Error(audioData.error || 'Audio generation failed.');
            if (messagesRef.current.includes(assistantMessage)) {
              updateMessages(messagesRef.current.map((item) => item === assistantMessage ? { ...item, audioPending: false, audioUrl: audioData.audioUrl } : item));
            }
          } catch (audioError: any) {
            if (audioError?.name !== 'AbortError' && messagesRef.current.includes(assistantMessage)) {
              updateMessages(messagesRef.current.map((item) => item === assistantMessage ? { ...item, audioPending: false, content: `${answer}\n\n${language === 'km' ? 'បង្កើតសំឡេងមិនបាន៖' : 'Could not create audio:'} ${audioError?.message || 'Please try again.'}` } : item));
            }
          } finally {
            audioControllersRef.current.delete(audioController);
          }
        })();
      }

      if (document) {
        setDocumentDialog(document);
        if (spoken) {
          setVoiceDocument(document);
          setVoiceCaption(answer);
        }
        return '';
      }

      if (autoCreateRequested && data.automation?.ready) {
        const request = triggerCreativeAutomation(data.automation, message ? detectMessageLanguage(message) : language);
        if (spoken) setVoiceCaption(automationCaption(request));
      }
      return answer;
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        const errorMessage = error?.message || (language === 'km' ? 'Agent មិនអាចឆ្លើយបាននៅពេលនេះ។' : 'The agent could not respond right now.');
        if (spoken) notify(errorMessage, 'error');
        else updateMessages([...pendingMessages, { role: 'assistant', content: errorMessage, modality: 'text' }]);
      }
      return '';
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        agentRequestActiveRef.current = false;
        setLoading(false);
      }
    }
  };

  const latestAnswer = [...messages].reverse().find((message) => message.role === 'assistant' && message.modality !== 'voice')?.content || '';
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
      {documentDialog && <AgentDocumentDialog document={documentDialog} language={language} onDownload={handleDocumentDownload} onClose={() => setDocumentDialog(null)} />}
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

      <section ref={planSectionRef} className="glass rounded-2xl p-5">
        <button
          type="button"
          onClick={() => setPlanOpen((open) => !open)}
          className="flex items-center gap-2 text-lg font-bold text-brand-700 dark:text-brand-300"
        >
          <CalendarClock size={20} />
          <span>{language === 'km' ? 'ផែនការដែលបានអាប់ឡូត (Uploaded Content Plan)' : 'Uploaded Content Plan'}</span>
          <motion.span animate={{ rotate: planOpen ? 180 : 0 }} className="text-brand-400">
            <ChevronDown size={18} />
          </motion.span>
        </button>

        {planOpen && (
          <div className="mt-4 space-y-4">
            <>
              {(isDemoMode || !user) && <p className="text-sm text-slate-500 dark:text-slate-400">
                {language === 'km'
                  ? 'ត្រូវការគណនីពិត (មិនមែន demo) ដើម្បីប្រើមុខងារនេះ ព្រោះវាបង្កើតខ្លឹមសារនៅផ្ទៃខាងក្រោយដោយស្វ័យប្រវត្តិ។'
                  : 'This needs a real (non-demo) account, since it generates content automatically in the background.'}
              </p>}
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {language === 'km'
                    ? 'អាប់ឡូតឯកសារ Excel/CSV/PDF/Word/text ឬបិទភ្ជាប់ link Google Sheet ដែលមានកាលបរិច្ឆេទ + សំណើបង្កើតរូបភាព/វីដេអូ។ AI នឹងស្រង់ចេញជា prompt ត្រៀមរួច ហើយបង្កើតឲ្យស្វ័យប្រវត្តិនៅថ្ងៃដល់កំណត់ រួចផ្ញើទៅ Telegram Channel/Bot ដែលអ្នកបានភ្ជាប់។'
                    : 'Upload an Excel/CSV/PDF/Word/text file or paste a Google Sheet link with dates + image/video requests. The AI extracts ready-to-use prompts and generates each one automatically on its scheduled date, delivered to your connected Telegram Channel/Bot.'}
                </p>

                <div className="flex flex-wrap items-center gap-3">
                  <input ref={planFileInputRef} type="file" className="hidden" onChange={handlePlanFileSelect} />
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
                {planEditNotice && !planError && (
                  <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                    {planEditNotice}
                  </p>
                )}
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
                        <div
                          key={`${item.date}-${index}`}
                          className="flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50/50 p-3 dark:border-slate-700 dark:bg-slate-800/50"
                        >
                          <input
                            type="checkbox"
                            checked={item.selected}
                            onChange={() => togglePlanItem(index)}
                            aria-label={`${item.date} ${item.topic}`}
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
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {language === 'km' ? 'សមាមាត្រ' : 'Aspect ratio'}: {item.aspectRatio || (item.type === 'video' ? '9:16' : '1:1')}
                              {item.type === 'video' && ` · ${language === 'km' ? 'សំឡេង' : 'Voice'}: ${item.voiceGender || 'Female'}`}
                            </p>
                            {item.prompt && <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{item.prompt}</p>}
                            {item.type === 'video' && item.performanceStyle && <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{item.performanceStyle}</p>}
                            {item.type === 'image' && (item.headline || item.cta) && (
                              <p className="mt-1 text-xs text-brand-600 dark:text-brand-300">{[item.headline, item.cta].filter(Boolean).join(' · ')}</p>
                            )}
                            {item.type === 'video' && (
                              <div className="mt-2 space-y-1">
                                <label htmlFor={`plan-narration-${index}`} className="text-xs font-bold text-brand-600 dark:text-brand-300">
                                  {language === 'km' ? 'ពាក្យនិយាយក្នុងវីដេអូ ៨ វិនាទី' : 'Spoken words for the 8-second video'}
                                </label>
                                <textarea
                                  id={`plan-narration-${index}`}
                                  value={item.voiceOverText || ''}
                                  onChange={(event) => updatePlanNarration(index, event.target.value)}
                                  rows={2}
                                  maxLength={500}
                                  className="w-full rounded-lg border border-brand-200 bg-white p-2 text-sm text-brand-800 outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                                />
                              </div>
                            )}
                          </div>
                        </div>
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
                      disabled={planSaving || isDemoMode || !user || !planItems.some((item) => item.selected)}
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
                        const isLegacyAudioReview = item.status === 'FAILED'
                          && item.type === 'video'
                          && Boolean(item.resultMediaUrl)
                          && /Could not extract video audio for verification|Invalid verification audio size/i.test(item.errorMessage || '');
                        const displayedStatus: SavedPlanItem['status'] = isLegacyAudioReview ? 'REVIEW' : item.status;
                        const statusStyle: Record<SavedPlanItem['status'], string> = {
                          PENDING: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                          PROCESSING: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
                          DONE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
                          REVIEW: 'bg-amber-100 text-amber-800',
                          READY: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
                          FAILED: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
                        };
                        const statusLabel: Record<SavedPlanItem['status'], string> = {
                          PENDING: language === 'km' ? 'រង់ចាំ' : 'Pending',
                          PROCESSING: language === 'km' ? 'កំពុងបង្កើត' : 'Generating',
                          DONE: language === 'km' ? 'រួចរាល់' : 'Done',
                          REVIEW: language === 'km' ? 'រង់ចាំពិនិត្យ' : 'Needs review',
                          READY: language === 'km' ? 'វីដេអូរួចរាល់' : 'Video ready',
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
                                <span className={`rounded-full px-2 py-0.5 text-[10px] ${statusStyle[displayedStatus]}`}>
                                  {statusLabel[displayedStatus]}
                                </span>
                              </div>
                              <p className="mt-1 truncate text-sm font-bold text-brand-700 dark:text-brand-300">{item.topic}</p>
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {language === 'km' ? 'សមាមាត្រ' : 'Aspect ratio'}: {item.aspectRatio || (item.type === 'video' ? '9:16' : '1:1')}
                                {item.type === 'video' && ` · ${language === 'km' ? 'សំឡេង' : 'Voice'}: ${item.voiceGender || 'Female'}`}
                              </p>
                              {item.prompt && <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{item.prompt}</p>}
                              {item.type === 'video' && item.performanceStyle && <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{item.performanceStyle}</p>}
                              {item.type === 'video' && item.voiceOverText && <p className="mt-1 text-xs text-brand-600 dark:text-brand-300">{item.voiceOverText}</p>}
                              {item.type === 'image' && (item.headline || item.cta) && (
                                <p className="mt-1 text-xs text-brand-600 dark:text-brand-300">{[item.headline, item.cta].filter(Boolean).join(' · ')}</p>
                              )}
                              {['FAILED', 'READY'].includes(item.status) && item.errorMessage && (
                                <p className={`mt-1 break-words text-xs ${item.status === 'READY' ? 'text-amber-700 dark:text-amber-300' : 'text-rose-500'}`}>{item.errorMessage}</p>
                              )}
                              {['FAILED', 'REVIEW', 'READY'].includes(item.status) && item.resultMediaUrl && (
                                <div className="mt-2 space-y-1">
                                  {item.type === 'video' ? (
                                    <video src={item.resultMediaUrl} controls className="w-full max-w-xs rounded-lg" />
                                  ) : (
                                    <img src={item.resultMediaUrl} alt={item.topic} className="w-full max-w-xs rounded-lg" />
                                  )}
                                  <a href={item.resultMediaUrl} download className="text-[10px] font-bold text-brand-600 underline dark:text-brand-400">
                                    {item.type === 'video'
                                      ? (language === 'km' ? 'ទាញយកវីដេអូនេះមកពិនិត្យ' : 'Download this video to review')
                                      : (language === 'km' ? 'ទាញយករូបភាពនេះមកពិនិត្យ' : 'Download this image to review')}
                                  </a>
                                </div>
                              )}
                              {['FAILED', 'REVIEW', 'READY'].includes(item.status) && item.speechVerification && (
                                <div className="mt-1 space-y-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                                  {item.speechVerification.unavailable && (
                                    <p className="font-bold text-amber-600 dark:text-amber-300">
                                      {language === 'km'
                                        ? 'ប្រព័ន្ធផ្ទៀងផ្ទាត់សំឡេងមិនអាចប្រើបាន។ សូមមើល និងស្តាប់វីដេអូដោយផ្ទាល់មុនអនុម័ត។'
                                        : 'Automatic speech verification was unavailable. Watch and listen to the video before approving it.'}
                                    </p>
                                  )}
                                  <p>
                                    {language === 'km' ? 'ត្រូវការនិយាយ' : 'Expected'}: {item.speechVerification.expected || '—'}
                                  </p>
                                  <p>
                                    {language === 'km' ? 'ស្តាប់បាន' : 'Heard'}: {item.speechVerification.transcript || '—'}
                                    {' '}({Math.round((item.speechVerification.similarity || 0) * 100)}%)
                                  </p>
                                </div>
                              )}
                              {isLegacyAudioReview && (
                                <p className="mt-1 text-[10px] font-bold text-amber-600 dark:text-amber-300">
                                  {language === 'km'
                                    ? 'វីដេអូត្រូវបានរក្សាទុក ប៉ុន្តែការផ្ទៀងផ្ទាត់សំឡេងមិនបានបញ្ចប់។ សូមមើល និងស្តាប់មុនអនុម័ត។'
                                    : 'The video was retained, but audio verification did not finish. Watch and listen before approving.'}
                                </p>
                              )}
                              {(item.status === 'REVIEW' || item.status === 'READY' || isLegacyAudioReview) && (
                                <button type="button" onClick={() => handleReviewPlanItem(item.id, 'approve', item.resultMediaUrl)} className="mt-2 rounded-lg bg-brand-600 p-2 text-xs text-white">
                                  {item.status === 'READY'
                                    ? (language === 'km' ? 'បញ្ជូនវីដេអូទៅ Telegram' : 'Send video to Telegram')
                                    : (language === 'km' ? 'បានមើល និងស្តាប់៖ ពាក្យ ល្បឿន មាត់ និងកាយវិការត្រឹមត្រូវ — ដាក់ក្នុងជួរបញ្ជូន Telegram' : 'Reviewed pronunciation, pace, lips and gestures — queue for Telegram')}
                                </button>
                              )}
                              {['FAILED', 'REVIEW'].includes(item.status) && (
                                <button
                                  type="button"
                                  onClick={() => handleReviewPlanItem(item.id, 'retry')}
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
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        <section className="xl:col-span-4 glass rounded-[2rem] p-7 space-y-5 self-start">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-brand-700 dark:text-brand-300 uppercase tracking-widest">{text.prompt}</label>
            <textarea
              disabled={liveVoiceEnabled}
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

            <div className="flex flex-wrap items-center gap-2">
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
                  onClick={startVoice}
                  disabled={!liveVoiceEnabled && loading}
                  aria-pressed={liveVoiceEnabled}
                  title={liveVoiceEnabled ? text.listening : text.voiceInput}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-all disabled:opacity-60 ${liveVoiceEnabled ? 'bg-red-500 border-red-500 text-white animate-pulse' : 'bg-white/70 dark:bg-slate-800/70 border-brand-200 text-brand-600 hover:bg-brand-50 dark:hover:bg-slate-700'}`}
                >
                  {(voiceConnecting || voiceProcessing) && liveVoiceEnabled ? <Loader2 size={16} className="animate-spin" /> : liveVoiceEnabled ? <MicOff size={16} /> : <Mic size={16} />}
                  {liveVoiceEnabled ? (isSpeaking ? (language === 'km' ? 'កំពុងឆ្លើយ...' : 'Speaking...') : text.listening) : text.voiceInput}
                </button>
              )}

              {micSupported && (
                <button
                  type="button"
                  onClick={startVoice}
                  aria-pressed={liveVoiceEnabled}
                  disabled={!liveVoiceEnabled && loading}
                  className={`px-3 py-2 rounded-xl border text-xs font-bold disabled:opacity-50 ${liveVoiceEnabled ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white/70 dark:bg-slate-800/70 border-brand-200 text-brand-600'}`}
                >
                  {language === 'km' ? 'សន្ទនាសំឡេងផ្ទាល់' : 'Live Voice'} {liveVoiceEnabled ? (language === 'km' ? 'បើក' : 'On') : (language === 'km' ? 'បិទ' : 'Off')}
                </button>
              )}
              {micSupported && (
                <div className="flex bg-brand-50 dark:bg-slate-800/70 p-1 rounded-xl border border-brand-200">
                  {(['auto', 'km', 'en'] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      disabled={voiceActiveRef.current}
                      onClick={() => { voiceInputLanguageRef.current = lang; setVoiceInputLanguage(lang); }}
                      title={language === 'km' ? 'ភាសាដែលអ្នកនឹងនិយាយ' : 'Language you will speak'}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all disabled:opacity-50 ${
                        voiceInputLanguage === lang
                          ? 'bg-white dark:bg-slate-700 text-brand-700 shadow-sm'
                          : 'text-brand-400 hover:text-brand-700'
                      }`}
                    >
                      {lang === 'auto' ? (language === 'km' ? 'ស្វ័យប្រវត្តិ' : 'Auto') : lang === 'km' ? 'ខ្មែរ' : 'English'}
                    </button>
                  ))}
                </div>
              )}
              {micSupported && (
                <div className="flex bg-brand-50 dark:bg-slate-800/70 p-1 rounded-xl border border-brand-200">
                  {(['Female', 'Male'] as const).map((gender) => (
                    <button
                      key={gender}
                      type="button"
                      disabled={voiceActiveRef.current}
                      onClick={() => { voiceGenderRef.current = gender; setVoiceGender(gender); }}
                      title={language === 'km' ? 'ភេទសំឡេង' : 'Voice gender'}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all disabled:opacity-50 ${
                        voiceGender === gender
                          ? 'bg-white dark:bg-slate-700 text-brand-700 shadow-sm'
                          : 'text-brand-400 hover:text-brand-700'
                      }`}
                    >
                      {gender === 'Female' ? (language === 'km' ? 'ស្រី' : 'Female') : (language === 'km' ? 'ប្រុស' : 'Male')}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {liveVoiceEnabled && (
              <p className="text-xs font-medium text-brand-600 dark:text-brand-300" role="status">
                {language === 'km'
                  ? 'សន្ទនាសំឡេងផ្ទាល់កំពុងដំណើរការ។ ចុចម្តងទៀតដើម្បីបញ្ចប់ការហៅ។'
                  : 'Live audio call is active. Press Live Voice again to end the call.'}
              </p>
            )}
            {voiceRetryAt > Date.now() && (
              <p className="text-xs font-medium text-red-600" role="status">
                {language === 'km'
                  ? 'ការភ្ជាប់សំឡេងផ្ទាល់មិនទាន់អាចប្រើបាន។ អ្នកនៅតែអាចបន្តសន្ទនាសំឡេងតាមផ្លូវបម្រុង។'
                  : 'Realtime voice is temporarily unavailable. You can continue the voice conversation using the fallback.'}
              </p>
            )}
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
              onClick={() => { autoCreateEnabledRef.current = !autoCreateEnabledRef.current; setAutoCreateEnabled(autoCreateEnabledRef.current); }}
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
            disabled={loading || liveVoiceEnabled || (!input.trim() && !attachedImages.length)}
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
              {liveVoiceEnabled ? (language === 'km' ? 'សន្ទនាសំឡេង' : 'Voice conversation') : text.result}
            </h3>
            <div className="flex items-center gap-2">
              {!liveVoiceEnabled && <>
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
              </>}
            </div>
          </div>

          <div className="flex-1 max-h-[720px] overflow-y-auto pr-2 space-y-4">
            {liveVoiceEnabled ? (
              <div className={`h-full min-h-[500px] flex flex-col items-center text-center ${voiceDocument ? 'justify-start pt-3' : 'justify-center'}`} role={voiceDocument ? undefined : 'status'} aria-live={voiceDocument ? 'off' : 'polite'}>
                {!voiceDocument && <>
                <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-5 ${isSpeaking ? 'bg-brand-600 text-white animate-pulse' : 'bg-brand-50 text-brand-600'}`}>
                  {voiceConnecting || voiceProcessing ? <Loader2 size={42} className="animate-spin" /> : isSpeaking ? <Bot size={42} /> : <Mic size={42} />}
                </div>
                <p className="text-xl font-bold text-brand-700 dark:text-brand-300">
                  {voiceConnecting
                    ? (language === 'km' ? 'កំពុងភ្ជាប់សំឡេង...' : 'Connecting voice...')
                    : voiceProcessing
                      ? (language === 'km' ? 'កំពុងរៀបចំចម្លើយ...' : 'Preparing reply...')
                    : isSpeaking
                      ? (language === 'km' ? 'Agent កំពុងឆ្លើយជាសំឡេង...' : 'Agent is speaking...')
                      : (language === 'km' ? 'កំពុងស្តាប់អ្នក...' : 'Listening to you...')}
                </p>
                <p className="mt-2 text-slate-500 dark:text-slate-400">
                  {language === 'km' ? 'ការសន្ទនានេះជាសំឡេងផ្ទាល់។' : 'This conversation is live audio.'}
                </p>
                {voiceCaption && (
                  <div className="mt-5 max-w-lg max-h-48 overflow-y-auto rounded-xl border border-brand-100 bg-white/70 dark:bg-slate-800/70 px-4 py-3 text-sm text-left text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
                    {voiceCaption}
                  </div>
                )}
                </>}
                {voiceDocument && (
                  <div className="mt-5 w-full max-w-2xl rounded-2xl border border-brand-200 bg-brand-50/70 p-4 dark:border-slate-600 dark:bg-slate-800/95">
                    <AgentDocumentCard document={voiceDocument} language={language} onDownload={handleDocumentDownload} />
                  </div>
                )}
                <button type="button" onClick={stopLiveVoice} className="mt-8 px-5 py-3 rounded-xl border border-red-200 bg-red-50 text-red-600 font-bold">
                  {language === 'km' ? 'បញ្ចប់ការហៅ' : 'End call'}
                </button>
              </div>
            ) : <>
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
                          <p className="whitespace-pre-wrap leading-relaxed">{message.modality === 'voice' ? (language === 'km' ? 'សំណួរជាសំឡេង' : 'Voice message') : message.content}</p>
                        </>
                      ) : message.document ? (
                        <AgentDocumentCard document={message.document} language={language} onDownload={handleDocumentDownload} />
                      ) : message.modality === 'voice'
                        ? <p className="leading-relaxed">{language === 'km' ? 'ចម្លើយជាសំឡេង' : 'Voice reply'}</p>
                        : <div className="space-y-3">
                            <div className="prose prose-brand max-w-none"><Markdown>{message.content}</Markdown></div>
                            {message.audioPending && <p role="status" className="flex items-center gap-2 text-xs text-brand-600"><Loader2 size={14} className="animate-spin" />{language === 'km' ? 'កំពុងបង្កើតសំឡេង...' : 'Creating audio...'}</p>}
                            {message.audioUrl && <div className="space-y-2"><audio controls src={message.audioUrl} className="w-full" /><a href={message.audioUrl} download={`agent-audio.${message.audioUrl.startsWith('data:audio/wav') ? 'wav' : 'mp3'}`} className="text-xs font-semibold text-brand-600 underline">{language === 'km' ? 'ទាញយកសំឡេង' : 'Download audio'}</a></div>}
                          </div>}
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
            </>}
          </div>
        </section>
      </div>
    </div>
  );
};

export default AIAgent;
