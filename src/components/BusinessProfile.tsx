import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Upload, FileText, Building2, User, Plus, Trash2, Save, CheckCircle2, Loader2, Send, Bot, ArrowRight, Image as ImageIcon } from 'lucide-react';
import { doc, getDocFromServer, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cn } from '../lib/utils';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { BusinessDirectoryEntry, BusinessProductImage, BusinessProfileData } from '../types';
import { recordAuditEvent } from '../lib/auditClient';
import { withUploadTimeout } from '../lib/withUploadTimeout';
import { notifyBusinessProfileUpdated } from '../lib/businessBranding';
import { channelUsernameFromProfile } from '../../shared/telegramDestination.js';

const DEMO_STORAGE_KEY = 'demo_business_profile';
const LOGO_MAX_DIMENSION = 256;
// Matches the fidelity bar VideoVoice.tsx already uses for its own
// (non-persistent) starting-image reference feature.
const PRODUCT_IMAGE_MAX_DIMENSION = 1280;
const MAX_PRODUCT_IMAGES = 12;

const validHttpUrl = (value: string, allowedHosts?: string[]): boolean => {
  try {
    if (value.length > 300 || /\s/.test(value)) return false;
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol)
      && Boolean(parsed.hostname)
      && !parsed.username && !parsed.password
      && (!allowedHosts || (parsed.protocol === 'https:' && allowedHosts.includes(parsed.hostname.toLowerCase())));
  } catch {
    return false;
  }
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
};

const getLocalProfile = (): BusinessProfileData => {
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY) || 'null');
    if (saved) return saved;
  } catch {
    // fall through to default
  }
  return { businessName: '', logoDataUrl: '', directory: [], productImages: [], telegramBotToken: '', telegramChatId: '' };
};

const resizeImageToDataUrl = (file: File, maxDimension: number = LOGO_MAX_DIMENSION): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read this image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not load this image file.'));
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not process this image file.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });

const INTRO_FILE_MAX_BYTES = 8 * 1024 * 1024;

interface BusinessProfileProps {
  onClose: () => void;
}

const BusinessProfile: React.FC<BusinessProfileProps> = ({ onClose }) => {
  const { t, language } = useLanguage();
  const { user, isDemoMode, loading: authLoading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const introFileInputRef = useRef<HTMLInputElement>(null);
  const businessNameInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [introUploading, setIntroUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [telegramBotActive, setTelegramBotActive] = useState(false);
  const [activatingBot, setActivatingBot] = useState(false);
  const [botStatusMessage, setBotStatusMessage] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState('');
  const [savedBusinessName, setSavedBusinessName] = useState('');
  const [businessDescription, setBusinessDescription] = useState('');
  const [logoDataUrl, setLogoDataUrl] = useState('');
  const [directory, setDirectory] = useState<BusinessDirectoryEntry[]>([]);
  const [productImages, setProductImages] = useState<BusinessProductImage[]>([]);
  const [productImageUploading, setProductImageUploading] = useState(false);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [savedTelegramBotToken, setSavedTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramChannelUrl, setTelegramChannelUrl] = useState('');
  const [tiktokHandle, setTiktokHandle] = useState('');
  const [facebookPageUrl, setFacebookPageUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  // AI-distilled knowledge read automatically from the links above (see
  // refreshBusinessKnowledgeIfNeeded) -- not an editable field, just a status
  // the owner can see and force-refresh.
  const [businessKnowledgeBase, setBusinessKnowledgeBase] = useState('');
  const [businessKnowledgeBaseSources, setBusinessKnowledgeBaseSources] = useState<string[]>([]);
  const [businessKnowledgeBaseUpdatedAt, setBusinessKnowledgeBaseUpdatedAt] = useState(0);
  const [knowledgeRefreshing, setKnowledgeRefreshing] = useState(false);
  const [knowledgeRefreshError, setKnowledgeRefreshError] = useState<string | null>(null);
  // Detailed companion to businessDescription, filled by the same
  // extractBusinessIntro call (uploaded file, or the "Fetch intro" website
  // paste) -- persisted on the next normal Save Profile, same as
  // businessDescription itself.
  const [businessDocumentKnowledge, setBusinessDocumentKnowledge] = useState('');
  const [profileFiles, setProfileFiles] = useState<Array<{ id: string; name: string; size: number; createdAt: string }>>([]);
  const [fileStatus, setFileStatus] = useState<string | null>(null);

  const [entryName, setEntryName] = useState('');
  const [entryType, setEntryType] = useState<'COMPANY' | 'INDIVIDUAL'>('COMPANY');
  const channelPreviewUsername = channelUsernameFromProfile(telegramChannelUrl.trim());

  useEffect(() => {
    // Waiting for Firebase auth to actually settle avoids a load-then-reload: this
    // modal can open before auth resolves, so `user` reads null for a moment even
    // for a signed-in visitor. Loading the demo/local profile during that window,
    // then re-loading real Firestore data once auth resolves a beat later, would
    // silently discard anything the user typed in between.
    if (authLoading) return;

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setBusinessName(''); setBusinessDescription(''); setLogoDataUrl(''); setDirectory([]); setProductImages([]);
      setSavedBusinessName('');
      setTelegramBotToken(''); setTelegramChatId(''); setTelegramChannelUrl('');
      setSavedTelegramBotToken('');
      setTiktokHandle(''); setFacebookPageUrl(''); setWebsiteUrl(''); setLinkedinUrl(''); setTelegramBotActive(false);
      setBusinessKnowledgeBase(''); setBusinessKnowledgeBaseSources([]); setBusinessKnowledgeBaseUpdatedAt(0); setKnowledgeRefreshError(null);
      setBusinessDocumentKnowledge('');
      setProfileFiles([]);
      try {
        if (isDemoMode || !user) {
          const local = getLocalProfile();
          if (cancelled) return;
          setBusinessName(local.businessName);
          setBusinessDescription(local.businessDescription || '');
          setLogoDataUrl(local.logoDataUrl);
          setDirectory(local.directory || []);
          setProductImages(local.productImages || []);
          setTelegramBotToken(local.telegramBotToken || '');
          setSavedTelegramBotToken(local.telegramBotToken || '');
          setTelegramChatId(local.telegramChatId || '');
          setTelegramChannelUrl(channelUsernameFromProfile(local.telegramChannelUrl) || local.telegramChannelUrl || '');
          setTiktokHandle(local.tiktokHandle || '');
          setFacebookPageUrl(local.facebookPageUrl || '');
          setWebsiteUrl(local.websiteUrl || '');
          setLinkedinUrl(local.linkedinUrl || '');
          setBusinessKnowledgeBase(local.businessKnowledgeBase || '');
          setBusinessKnowledgeBaseSources(local.businessKnowledgeBaseSources || []);
          setBusinessKnowledgeBaseUpdatedAt(local.businessKnowledgeBaseUpdatedAt || 0);
          setBusinessDocumentKnowledge(local.businessDocumentKnowledge || '');
        } else {
          const idToken = await user.getIdToken();
          const filesResponse = await fetch('/api/ai?profileFiles=1', { headers: { Authorization: `Bearer ${idToken}` } });
          if (filesResponse.ok) {
            const listed = await filesResponse.json();
            if (!cancelled) setProfileFiles(Array.isArray(listed.files) ? listed.files : []);
          }
          // Reopening the editor must show the committed server value, not an
          // older local snapshot that can make a successful edit look lost.
          const snap = await getDocFromServer(doc(db, 'business_profiles', user.uid));
          if (cancelled) return;
          if (snap.exists()) {
            const data = snap.data() as BusinessProfileData & { telegramBotActive?: boolean };
            setBusinessName(data.businessName || '');
            setSavedBusinessName(data.businessName || '');
            setBusinessDescription(data.businessDescription || '');
            setLogoDataUrl(data.logoDataUrl || '');
            setDirectory(data.directory || []);
            setProductImages(Array.isArray(data.productImages) ? data.productImages : []);
            setTelegramBotToken(data.telegramBotToken || '');
            setSavedTelegramBotToken(data.telegramBotToken || '');
            setTelegramChatId(data.telegramChatId || '');
            setTelegramChannelUrl(channelUsernameFromProfile(data.telegramChannelUrl) || data.telegramChannelUrl || '');
            setTiktokHandle(data.tiktokHandle || '');
            setFacebookPageUrl(data.facebookPageUrl || '');
            setWebsiteUrl(data.websiteUrl || '');
            setLinkedinUrl(data.linkedinUrl || '');
            setTelegramBotActive(Boolean(data.telegramBotActive));
            setBusinessKnowledgeBase(data.businessKnowledgeBase || '');
            setBusinessKnowledgeBaseSources(Array.isArray(data.businessKnowledgeBaseSources) ? data.businessKnowledgeBaseSources : []);
            setBusinessKnowledgeBaseUpdatedAt(data.businessKnowledgeBaseUpdatedAt || 0);
            setBusinessDocumentKnowledge(data.businessDocumentKnowledge || '');
          } else {
            setBusinessName(''); setBusinessDescription(''); setLogoDataUrl(''); setDirectory([]); setProductImages([]);
            setTelegramBotToken(''); setTelegramChatId(''); setTelegramChannelUrl('');
            setSavedTelegramBotToken('');
            setTiktokHandle(''); setFacebookPageUrl(''); setWebsiteUrl(''); setLinkedinUrl(''); setTelegramBotActive(false);
          }
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load business profile:', err);
        setError(t('businessProfileLoadError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [user, isDemoMode, authLoading]);

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setLogoDataUrl(dataUrl);
    } catch (err: any) {
      setError(err.message || t('businessProfileLoadError'));
    }
  };

  const uploadOneProductImage = async (file: File) => {
    const dataUrl = await resizeImageToDataUrl(file, PRODUCT_IMAGE_MAX_DIMENSION);
    const defaultLabel = file.name.replace(/\.[^.]+$/, '').slice(0, 60);
    if (isDemoMode || !user) {
      // Demo profiles are persisted whole to localStorage, so a plain data
      // URL is fine here -- unlike the real Firestore doc, there is no
      // 1MB/doc limit forcing an ImageKit upload for this mode.
      setProductImages((current) => [
        ...current,
        { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, label: defaultLabel, imageUrl: dataUrl, fileId: '', filePath: '' },
      ]);
      return;
    }
    const idToken = await user.getIdToken();
    const response = await withUploadTimeout(fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ action: 'uploadProductImage', imageDataUrl: dataUrl }),
    }));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not upload this product photo.');
    setProductImages((current) => [
      ...current,
      { id: data.fileId || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, label: defaultLabel, imageUrl: data.imageUrl, fileId: data.fileId || '', filePath: data.filePath || '' },
    ]);
  };

  const handleProductImagesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const remainingSlots = Math.max(MAX_PRODUCT_IMAGES - productImages.length, 0);
    const selected = files.slice(0, remainingSlots);
    if (!selected.length) return;
    setProductImageUploading(true);
    try {
      // Independent uploads -- run them in parallel rather than waiting for
      // each full resize+upload round trip before starting the next.
      await Promise.all(selected.map((file) => uploadOneProductImage(file).catch((err: any) => {
        setError(err.message || t('businessProfileLoadError'));
      })));
    } finally {
      setProductImageUploading(false);
    }
  };

  const handleRemoveProductImage = (id: string) => {
    // No ImageKit deletion here -- consistent with every other image in this
    // app (logo replace, generation history, etc.): only the reference is
    // dropped, leaving the file in storage.
    setProductImages((current) => current.filter((image) => image.id !== id));
  };

  const handleProductImageLabelChange = (id: string, label: string) => {
    setProductImages((current) => current.map((image) => (image.id === id ? { ...image, label: label.slice(0, 60) } : image)));
  };

  const handleIntroFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > INTRO_FILE_MAX_BYTES) {
      setError(language === 'km' ? 'ឯកសារនេះធំពេក (កំណត់ត្រឹម ៨MB)។' : 'That file is too large (8 MB limit).');
      return;
    }
    if (isDemoMode || !user) {
      setError(language === 'km' ? 'សូមចូលគណនី ដើម្បីរក្សាទុក file ដើម។' : 'Sign in to save the original file.');
      return;
    }
    setIntroUploading(true);
    setError(null);
    setFileStatus(null);
    try {
      {
        const idToken = await user.getIdToken();
        const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` };
        const authResponse = await fetch('/api/ai?profileFiles=1&action=auth', { method: 'POST', headers });
        const auth = await authResponse.json().catch(() => ({}));
        if (!authResponse.ok) throw new Error(auth.error || 'Could not prepare file storage.');
        const form = new FormData();
        form.set('file', file);
        form.set('fileName', file.name);
        form.set('publicKey', auth.publicKey);
        form.set('token', auth.token);
        form.set('expire', String(auth.expire));
        form.set('signature', auth.signature);
        form.set('folder', auth.folder);
        form.set('isPrivateFile', 'true');
        form.set('useUniqueFileName', 'true');
        const uploadedResponse = await withUploadTimeout(fetch(auth.uploadUrl, { method: 'POST', body: form }));
        const uploaded = await uploadedResponse.json().catch(() => ({}));
        if (!uploadedResponse.ok || !uploaded.fileId) throw new Error(uploaded.message || 'Could not upload file.');
        const finalizedResponse = await fetch('/api/ai?profileFiles=1&action=finalize', {
          method: 'POST', headers, body: JSON.stringify({ fileId: uploaded.fileId, name: file.name }),
        });
        const finalized = await finalizedResponse.json().catch(() => ({}));
        if (!finalizedResponse.ok) throw new Error(finalized.error || 'Could not save file to this profile.');
        setProfileFiles((current) => [finalized.file, ...current.filter((item) => item.id !== finalized.file.id)]);
        setFileStatus(language === 'km' ? 'បានរក្សាទុក file ដើមជាឯកជនក្នុងគណនីនេះ។' : 'Original file saved privately to this account.');
        const extractResponse = await fetch('/api/ai?profileFiles=1&action=extract', {
          method: 'POST', headers, body: JSON.stringify({ fileId: uploaded.fileId }),
        });
        const extracted = await extractResponse.json().catch(() => ({}));
        if (extractResponse.ok) {
          setBusinessDocumentKnowledge(String(extracted.businessDocumentKnowledge || ''));
          setFileStatus(language === 'km' ? 'បានរក្សាទុក file ដើម និងខ្លឹមសារសម្រាប់ Agent។' : 'Original file and Agent knowledge saved.');
          notifyBusinessProfileUpdated(user.uid);
        } else {
          setFileStatus(language === 'km'
            ? 'បានរក្សាទុក file ដើម។ មិនអាចអានខ្លឹមសារសម្រាប់ Agent បាន៖ ' + (extracted.error || '')
            : 'Original file saved. Agent could not read its contents: ' + (extracted.error || 'Unsupported file.'));
        }
      }
    } catch (err: any) {
      setError(err.message || t('businessProfileLoadError'));
    } finally {
      setIntroUploading(false);
    }
  };

  const downloadProfileFile = async (fileId: string) => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/ai?profileFiles=1&action=download&fileId=${encodeURIComponent(fileId)}`, { headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not download file.');
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (err: any) { setError(err.message || 'Could not download file.'); }
  };

  const deleteProfileFile = async (fileId: string) => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/ai?profileFiles=1&action=delete&fileId=${encodeURIComponent(fileId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not delete file.');
      setProfileFiles((current) => current.filter((item) => item.id !== fileId));
    } catch (err: any) { setError(err.message || 'Could not delete file.'); }
  };

  const handleWebsiteIntroSubmit = async () => {
    const url = websiteUrl.trim();
    if (!url) return;
    if (!validHttpUrl(url)) {
      setError(language === 'km' ? 'សូមបញ្ចូល link ដែលចាប់ផ្តើមដោយ http:// ឬ https://' : 'Enter a link starting with http:// or https://');
      return;
    }
    setIntroUploading(true);
    setError(null);
    try {
      const response = await withUploadTimeout(fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extractBusinessIntro', websiteUrl: url, language }),
      }));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not read this website.');
      setBusinessDescription(String(data.businessDescription || ''));
      setBusinessDocumentKnowledge(String(data.businessDocumentKnowledge || ''));
    } catch (err: any) {
      setError(err.message || t('businessProfileLoadError'));
    } finally {
      setIntroUploading(false);
    }
  };

  // Reads the saved Website/Facebook/LinkedIn links and distills a detailed
  // knowledge base so the AI Agent (chat and Live Voice) can answer specific
  // questions about what the business actually does -- previously it only
  // knew the short, owner-typed businessDescription field. Runs
  // automatically after Save Profile when a saved link is new or changed
  // (force bypasses that check for the manual "Refresh now" button). A link
  // that fails to fetch is not recorded as attempted, so it retries on the
  // next save instead of silently giving up forever.
  const refreshBusinessKnowledgeIfNeeded = async (links: string[], { force = false } = {}) => {
    if (!links.length) return;
    const unchanged = !force && links.length === businessKnowledgeBaseSources.length
      && links.every((url) => businessKnowledgeBaseSources.includes(url));
    if (unchanged) return;
    setKnowledgeRefreshing(true);
    setKnowledgeRefreshError(null);
    try {
      const idToken = user && !isDemoMode ? await user.getIdToken() : '';
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify({ action: 'refreshBusinessKnowledge', websiteUrl, facebookPageUrl, linkedinUrl, language }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not read the saved links.');
      const knowledgeBase = String(data.businessKnowledgeBase || '');
      const updatedAt = Date.now();
      setBusinessKnowledgeBase(knowledgeBase);
      setBusinessKnowledgeBaseSources(links);
      setBusinessKnowledgeBaseUpdatedAt(updatedAt);
      const persisted = { businessKnowledgeBase: knowledgeBase, businessKnowledgeBaseSources: links, businessKnowledgeBaseUpdatedAt: updatedAt };
      if (isDemoMode || !user) {
        localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ ...getLocalProfile(), ...persisted }));
      } else {
        await setDoc(doc(db, 'business_profiles', user.uid), persisted, { merge: true });
      }
      notifyBusinessProfileUpdated(user?.uid || 'demo');
    } catch (err: any) {
      setKnowledgeRefreshError(err.message || 'Could not read the saved links.');
    } finally {
      setKnowledgeRefreshing(false);
    }
  };

  const handleAddEntry = () => {
    const name = entryName.trim();
    if (!name) return;
    setDirectory((prev) => [
      ...prev,
      { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name, type: entryType }
    ]);
    setEntryName('');
  };

  const handleRemoveEntry = (id: string) => {
    setDirectory((prev) => prev.filter((entry) => entry.id !== id));
  };

  const handleUpdateEntry = (id: string, changes: Partial<Pick<BusinessDirectoryEntry, 'name' | 'type'>>) => {
    setDirectory((prev) => prev.map((entry) => entry.id === id ? { ...entry, ...changes } : entry));
  };

  const handleSave = async () => {
    // Read the field itself at Save time. Keeping the name input uncontrolled
    // prevents an unrelated profile render from replacing text while it is
    // being edited (notably with browser translation/input helpers).
    const editedBusinessName = businessNameInputRef.current?.value ?? businessName;
    if (savedBusinessName && !editedBusinessName.trim()) {
      setError(language === 'km' ? 'សូមបញ្ចូលឈ្មោះអាជីវកម្ម មុនពេលរក្សាទុក។' : 'Enter a business name before saving.');
      return;
    }
    if (directory.some((entry) => !entry.name.trim())) {
      setError(language === 'km' ? 'សូមបញ្ចូលឈ្មោះសម្រាប់គ្រប់ជួរក្នុងបញ្ជី។' : 'Enter a name for every directory entry.');
      return;
    }
    const channelInput = telegramChannelUrl.trim();
    const channelUsername = channelUsernameFromProfile(channelInput);
    if (channelInput && !channelUsername) {
      setError('Enter a public Telegram channel username such as @mycompany or https://t.me/mycompany.');
      return;
    }
    const pageUrl = facebookPageUrl.trim();
    if (pageUrl && !validHttpUrl(pageUrl, ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.com', 'www.fb.com'])) {
      setError('Enter a Facebook Page URL beginning with https://facebook.com/');
      return;
    }
    const siteUrl = websiteUrl.trim();
    if (siteUrl && !validHttpUrl(siteUrl)) {
      setError(language === 'km' ? 'សូមបញ្ចូល Website link ត្រឹមត្រូវ ដែលចាប់ផ្តើមដោយ https:// ឬ http://' : 'Enter a valid website URL starting with https:// or http:// (up to 300 characters).');
      return;
    }
    const linkedInPageUrl = linkedinUrl.trim();
    if (linkedInPageUrl && !validHttpUrl(linkedInPageUrl, ['linkedin.com', 'www.linkedin.com'])) {
      setError(language === 'km' ? 'សូមបញ្ចូល LinkedIn link ត្រឹមត្រូវ ដែលចាប់ផ្តើមដោយ https://linkedin.com/' : 'Enter a LinkedIn URL beginning with https://linkedin.com/ (up to 300 characters).');
      return;
    }
    if (tiktokHandle.trim() && !/^@?[A-Za-z0-9._]{1,100}$/.test(tiktokHandle.trim())) {
      setError('Enter only your TikTok username, such as @mycompany.');
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    const profile: BusinessProfileData = {
      businessName: editedBusinessName.trim(),
      businessDescription: businessDescription.trim().slice(0, 1000),
      businessDocumentKnowledge: businessDocumentKnowledge.slice(0, 4000),
      // Carried through from current state (set by extraction, or by a
      // prior automatic link refresh) so a normal Save Profile never wipes
      // them out -- the demo-mode branch below replaces the whole stored
      // object rather than merging it.
      businessKnowledgeBase,
      businessKnowledgeBaseSources,
      businessKnowledgeBaseUpdatedAt,
      logoDataUrl,
      directory: directory.map((entry) => ({ ...entry, name: entry.name.trim() })),
      productImages: productImages.map((image) => ({ ...image, label: image.label.trim().slice(0, 60) })),
      telegramBotToken: telegramBotToken.trim(),
      telegramChatId: telegramChatId.trim(),
      // Keep the legacy field key for stored profiles, but persist Telegram's
      // actual chat_id format so the UI and publisher agree on @username.
      telegramChannelUrl: channelUsername,
      tiktokHandle: tiktokHandle.trim().replace(/^@/, ''),
      facebookPageUrl: facebookPageUrl.trim(),
      websiteUrl: siteUrl,
      linkedinUrl: linkedInPageUrl,
    };
    try {
      if (isDemoMode || !user) {
        localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(profile));
      } else {
        if (telegramBotActive && profile.telegramBotToken !== savedTelegramBotToken) {
          const idToken = await user.getIdToken();
          const response = await fetch('/api/telegram/webhook?action=activate-bot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ deactivate: true }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.ok) throw new Error(data.error || 'Could not disconnect the previous Telegram bot.');
          setTelegramBotActive(false);
        }
        // merge: true -- a plain overwrite here would wipe out telegramBotActive,
        // which the server sets independently (see activateOwnBot in
        // api/telegram/webhook.js) whenever the user activates/deactivates their
        // own bot, not through this form.
        const profileRef = doc(db, 'business_profiles', user.uid);
        await setDoc(profileRef, {
          ...profile,
          userId: user.uid,
          updatedAt: serverTimestamp()
        }, { merge: true });
        // Confirm the actual stored values before displaying "Saved". This
        // catches a second tab or server writer replacing an edit immediately.
        let confirmed;
        try {
          confirmed = await getDocFromServer(profileRef);
        } catch {
          throw new Error(language === 'km'
            ? 'ការរក្សាទុកបានផ្ញើទៅម៉ាស៊ីនមេ ប៉ុន្តែមិនអាចផ្ទៀងផ្ទាត់វិញបាន។ សូមបើកព័ត៌មានអាជីវកម្មឡើងវិញដើម្បីពិនិត្យ។'
            : 'The save was sent to the server, but its result could not be verified. Reopen Business Profile to check.');
        }
        const stored = confirmed.data() as Partial<BusinessProfileData> | undefined;
        const fieldsToConfirm: (keyof BusinessProfileData)[] = [
          'businessName', 'businessDescription', 'businessDocumentKnowledge',
          'logoDataUrl', 'directory', 'productImages', 'telegramBotToken',
          'telegramChatId', 'telegramChannelUrl', 'tiktokHandle',
          'facebookPageUrl', 'websiteUrl', 'linkedinUrl',
        ];
        if (!stored || fieldsToConfirm.some((field) => JSON.stringify(stableValue(stored[field])) !== JSON.stringify(stableValue(profile[field])))) {
          throw new Error(language === 'km'
            ? 'ការកែប្រែមិនត្រូវគ្នានឹងទិន្នន័យលើម៉ាស៊ីនមេ។ សូមបើកព័ត៌មានអាជីវកម្មឡើងវិញ ហើយព្យាយាមម្ដងទៀត។'
            : 'The saved values do not match the server. Reopen Business Profile and try again.');
        }
        void recordAuditEvent('business_profile_updated', {
          businessName: profile.businessName,
          directoryEntries: profile.directory.length,
          hasLogo: Boolean(profile.logoDataUrl),
        });
      }
      setSavedTelegramBotToken(profile.telegramBotToken);
      setBusinessName(profile.businessName);
      setTelegramChannelUrl(channelUsername);
      if (user && !isDemoMode) setSavedBusinessName(profile.businessName);
      setSaved(true);
      notifyBusinessProfileUpdated(user?.uid || 'demo');
      setTimeout(() => setSaved(false), 3000);
      // Fire-and-forget: Save Profile itself is already done, so a slow or
      // unreachable link reads this knowledge base in the background rather
      // than holding up the Save button or its confirmation.
      void refreshBusinessKnowledgeIfNeeded([siteUrl, pageUrl, linkedInPageUrl].filter(Boolean));
    } catch (err: any) {
      console.error('Failed to save business profile:', err);
      setError(err.message || t('businessProfileSaveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleBotActive = async () => {
    if (!user || isDemoMode) return;
    if (telegramBotToken.trim() !== savedTelegramBotToken) {
      setBotStatusMessage('Save the changed Bot Token before activating or deactivating the bot.');
      return;
    }
    setActivatingBot(true);
    setBotStatusMessage(null);
    const deactivate = telegramBotActive;
    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/telegram/webhook?action=activate-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ deactivate }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Could not update your bot.');
      }
      setTelegramBotActive(Boolean(data.active));
      setBotStatusMessage(data.message || null);
    } catch (err: any) {
      setBotStatusMessage(err.message || 'Could not update your bot.');
    } finally {
      setActivatingBot(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        onClick={(e) => e.stopPropagation()}
        className="glass w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-[2rem] border border-white/50 shadow-2xl p-8"
      >
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-2xl font-display font-bold text-brand-700 dark:text-brand-400 tracking-tight">
              {t('businessProfileTitle')}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('businessProfileDesc')}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-brand-50 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center p-10">
            <Loader2 className="animate-spin text-brand-300" size={28} />
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex items-center gap-5">
              <div className="w-20 h-20 rounded-2xl bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 overflow-hidden flex items-center justify-center shrink-0">
                {logoDataUrl ? (
                  <img src={logoDataUrl} alt="Logo" className="w-full h-full object-cover" />
                ) : (
                  <Building2 className="text-brand-300" size={28} />
                )}
              </div>
              <div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 bg-brand-50 hover:bg-brand-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-brand-600 dark:text-brand-400 rounded-xl text-sm font-bold transition-colors"
                >
                  <Upload size={16} />
                  {logoDataUrl ? t('changeLogo') : t('uploadLogo')}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="business-name" className="text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2 block">
                {t('businessName')}
              </label>
              <input
                id="business-name"
                ref={businessNameInputRef}
                type="text"
                defaultValue={businessName}
                maxLength={200}
                placeholder={t('businessNamePlaceholder')}
                className="w-full px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
              />
              {user && !isDemoMode && savedBusinessName && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {language === 'km'
                    ? 'អ្នកអាចកែឈ្មោះក្រុមហ៊ុននេះបាន។ កំណត់ត្រាដែលបានបង្កើតរួចនៅតែភ្ជាប់នឹងគណនីនេះ។'
                    : 'You can edit this company name. Existing records remain linked to this account.'}
                </p>
              )}
            </div>

            <div>
              <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2 block" htmlFor="business-description">
                {language === 'km' ? 'អាជីវកម្មរបស់អ្នកលក់អ្វី?' : 'What does your business sell?'}
              </label>
              <textarea
                id="business-description"
                value={businessDescription}
                onChange={(event) => setBusinessDescription(event.target.value)}
                maxLength={1000}
                rows={3}
                placeholder={language === 'km' ? 'ឧទាហរណ៍៖ ហាងកាហ្វេ និងម៉ាត លក់ភេសជ្ជៈ និងទំនិញប្រចាំថ្ងៃ' : 'For example: a cafe and mini mart selling drinks and everyday goods'}
                className="w-full px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
              />
              <input ref={introFileInputRef} type="file" className="hidden" onChange={handleIntroFileChange} />
              <button
                type="button"
                onClick={() => introFileInputRef.current?.click()}
                disabled={introUploading}
                className="mt-2 flex items-center gap-2 px-3 py-1.5 bg-brand-50 hover:bg-brand-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-brand-600 dark:text-brand-400 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {introUploading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                {introUploading
                  ? (language === 'km' ? 'កំពុងអាន...' : 'Reading file...')
                  : (language === 'km' ? 'ឬ Upload ឯកសារណែនាំក្រុមហ៊ុន (.txt, .pdf, .docx, .xlsx, .csv...)' : 'Or upload a company intro file (.txt, .pdf, .docx, .xlsx, .csv...)')}
              </button>
              {fileStatus && <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{fileStatus}</p>}
              {profileFiles.length > 0 && (
                <div className="mt-3 space-y-2" aria-label="Saved business files">
                  <p className="text-xs font-bold text-brand-700 dark:text-slate-200">{language === 'km' ? 'ឯកសារដើមដែលបានរក្សាទុក' : 'Saved original files'}</p>
                  {profileFiles.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 rounded-xl bg-brand-50 dark:bg-slate-800 px-3 py-2 text-xs">
                      <FileText size={14} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate" title={item.name}>{item.name} ({Math.ceil(item.size / 1024)} KB)</span>
                      <button type="button" onClick={() => downloadProfileFile(item.id)} className="font-bold text-brand-700 dark:text-brand-300">{language === 'km' ? 'ទាញយក' : 'Download'}</button>
                      <button type="button" onClick={() => deleteProfileFile(item.id)} aria-label={`Delete ${item.name}`} className="text-red-600"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
              {businessDocumentKnowledge && !introUploading && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={13} />
                  {language === 'km' ? 'Agent បានរក្សាទុកខ្លឹមសារពីឯកសារនេះ។' : 'Agent knowledge from this file is saved.'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest block">
                {language === 'km' ? 'រូបភាពផលិតផល (ជាជម្រើស)' : 'Product Images (optional)'}
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {language === 'km'
                  ? 'Upload រូបភាពផលិតផលពិតប្រាកដ (ឧទាហរណ៍ ផលិតផល skincare ឬភេសជ្ជៈ) ដើម្បីឲ្យវីដេអូ AI បង្ហាញផលិតផលនេះពិតប្រាកដ។'
                  : 'Upload real photos of your products (e.g. a skincare item or drink) so generated videos can show the actual product.'}
              </p>
              <div className="flex flex-wrap gap-3">
                {productImages.map((image) => (
                  <div key={image.id} className="w-24 shrink-0 space-y-1">
                    <div className="relative h-24 w-24">
                      <img src={image.imageUrl} alt={image.label || 'Product'} className="h-full w-full object-cover rounded-xl" />
                      <button
                        type="button"
                        onClick={() => handleRemoveProductImage(image.id)}
                        className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/80 text-white text-xs font-bold hover:bg-red-500 transition-colors"
                      >
                        ×
                      </button>
                    </div>
                    <input
                      type="text"
                      value={image.label}
                      onChange={(e) => handleProductImageLabelChange(image.id, e.target.value)}
                      maxLength={60}
                      placeholder={language === 'km' ? 'ឈ្មោះផលិតផល' : 'Product name'}
                      className="w-full px-2 py-1 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-lg text-[11px] text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
                    />
                  </div>
                ))}
                {productImages.length < MAX_PRODUCT_IMAGES && (
                  <label className="flex h-24 w-24 shrink-0 flex-col items-center justify-center border-2 border-dashed border-brand-200 rounded-2xl bg-brand-50 hover:bg-brand-100 transition-all cursor-pointer">
                    {productImageUploading ? <Loader2 className="animate-spin text-brand-300" size={28} /> : <ImageIcon className="text-brand-300" size={28} />}
                    <input type="file" accept="image/*" multiple className="hidden" onChange={handleProductImagesSelected} disabled={productImageUploading} />
                  </label>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2 block">
                  {language === 'km' ? 'តំណភ្ជាប់អាជីវកម្ម (ជាជម្រើស)' : 'Business links (optional)'}
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {language === 'km' ? 'បញ្ចូលតំណភ្ជាប់ ហើយចុច រក្សាទុកព័ត៌មាន ខាងក្រោម ដើម្បីរក្សាទុកទាំង ៣។' : 'Enter your links, then click Save Profile below to keep them.'}
                </p>
              </div>
              <div>
                <label htmlFor="business-facebook-url" className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Facebook</label>
                <input id="business-facebook-url" type="url" inputMode="url" value={facebookPageUrl}
                  onChange={(e) => setFacebookPageUrl(e.target.value)} placeholder="https://www.facebook.com/mycompany"
                  className="w-full px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20" />
              </div>
              <div>
                <label htmlFor="business-website-url" className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Website</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input id="business-website-url" type="url" inputMode="url" value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://your-website.com"
                    className="min-w-0 flex-1 px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20" />
                  <button type="button" onClick={() => void handleWebsiteIntroSubmit()} disabled={introUploading || !websiteUrl.trim()}
                    className="flex items-center justify-center gap-1.5 px-4 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-2xl text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    {introUploading ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                    {language === 'km' ? 'ទាញយកព័ត៌មាន' : 'Fetch intro'}
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {language === 'km' ? 'ទាញយកព័ត៌មាន បំពេញការណែនាំខាងលើ។ តំណភ្ជាប់ត្រូវរក្សាទុកពេលចុច រក្សាទុកព័ត៌មាន។' : 'Fetch intro fills the description above. Save Profile stores the link.'}
                </p>
              </div>
              <div>
                <label htmlFor="business-linkedin-url" className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">LinkedIn</label>
                <input id="business-linkedin-url" type="url" inputMode="url" value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://www.linkedin.com/company/mycompany"
                  className="w-full px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20" />
              </div>
              {(websiteUrl.trim() || facebookPageUrl.trim() || linkedinUrl.trim()) && (
                <div className="rounded-2xl bg-brand-50 dark:bg-slate-800 px-4 py-3 text-xs">
                  {knowledgeRefreshing ? (
                    <span className="flex items-center gap-1.5 text-brand-600 dark:text-brand-300">
                      <Loader2 size={13} className="animate-spin" />
                      {language === 'km' ? 'កំពុងអានតំណភ្ជាប់ដើម្បីស្គាល់អាជីវកម្មរបស់អ្នក...' : 'Reading your links to learn your business...'}
                    </span>
                  ) : knowledgeRefreshError ? (
                    <span className="text-red-600 dark:text-red-400">{knowledgeRefreshError}</span>
                  ) : businessKnowledgeBase ? (
                    <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 size={13} />
                      {language === 'km'
                        ? `Agent បានស្គាល់ពីអាជីវកម្មរបស់អ្នកពីតំណភ្ជាប់ ${businessKnowledgeBaseSources.length} (${new Date(businessKnowledgeBaseUpdatedAt).toLocaleDateString()})`
                        : `Agent has learned your business from ${businessKnowledgeBaseSources.length} link(s) (${new Date(businessKnowledgeBaseUpdatedAt).toLocaleDateString()})`}
                    </span>
                  ) : (
                    <span className="text-slate-500 dark:text-slate-400">
                      {language === 'km' ? 'រក្សាទុកព័ត៌មានដើម្បីឲ្យ Agent អានតំណភ្ជាប់ទាំងនេះដោយស្វ័យប្រវត្តិ' : 'Save Profile to let the Agent automatically read these links'}
                    </span>
                  )}
                  {!knowledgeRefreshing && (
                    <button type="button"
                      onClick={() => void refreshBusinessKnowledgeIfNeeded([websiteUrl.trim(), facebookPageUrl.trim(), linkedinUrl.trim()].filter(Boolean), { force: true })}
                      className="ml-2 font-bold text-brand-600 dark:text-brand-300 hover:underline">
                      {language === 'km' ? 'អានឡើងវិញ' : 'Refresh now'}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2 block">
                {t('directoryTitle')}
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{t('directoryDesc')}</p>

              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={entryName}
                  onChange={(e) => setEntryName(e.target.value)}
                  maxLength={200}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddEntry()}
                  placeholder={t('entryNamePlaceholder')}
                  className="flex-1 px-4 py-2.5 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
                />
                <select
                  value={entryType}
                  onChange={(e) => setEntryType(e.target.value as 'COMPANY' | 'INDIVIDUAL')}
                  className="px-3 py-2.5 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
                >
                  <option value="COMPANY">{t('entryTypeCompany')}</option>
                  <option value="INDIVIDUAL">{t('entryTypeIndividual')}</option>
                </select>
                <button
                  onClick={handleAddEntry}
                  disabled={!entryName.trim()}
                  className="p-2.5 bg-brand-700 hover:bg-brand-800 text-white rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Plus size={18} />
                </button>
              </div>

              <div className="space-y-2">
                {directory.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">{t('noDirectoryEntries')}</p>
                ) : (
                  directory.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-3 px-4 py-3 bg-brand-50/50 dark:bg-slate-800/50 border border-brand-100 dark:border-slate-700 rounded-xl"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 rounded-lg bg-white dark:bg-slate-900 text-brand-500 shrink-0">
                          {entry.type === 'COMPANY' ? <Building2 size={16} /> : <User size={16} />}
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <input
                            type="text"
                            value={entry.name}
                            onChange={(event) => handleUpdateEntry(entry.id, { name: event.target.value })}
                            maxLength={200}
                            aria-label={language === 'km' ? 'កែឈ្មោះក្នុងបញ្ជី' : 'Edit directory name'}
                            className="w-full rounded-lg border border-brand-100 bg-white px-2 py-1 text-sm font-medium text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          />
                          <select
                            value={entry.type}
                            onChange={(event) => handleUpdateEntry(entry.id, { type: event.target.value as BusinessDirectoryEntry['type'] })}
                            aria-label={language === 'km' ? 'កែប្រភេទក្នុងបញ្ជី' : 'Edit directory type'}
                            className="w-full rounded-lg border border-brand-100 bg-white px-2 py-1 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                          >
                            <option value="COMPANY">{t('entryTypeCompany')}</option>
                            <option value="INDIVIDUAL">{t('entryTypeIndividual')}</option>
                          </select>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveEntry(entry.id)}
                        className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors shrink-0"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest block">
                {language === 'km' ? 'ព័ត៌មាន TikTok (ជាជម្រើស)' : 'TikTok details (optional)'}
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {language === 'km'
                  ? 'បើអ្នកបានភ្ជាប់ TikTok តាម TikTok Activity រួច អ្នកមិនចាំបាច់បញ្ចូលឈ្មោះគណនីនៅទីនេះទៀតទេ។ ប្រអប់នេះប្រើសម្រាប់បរិបទ AI ប៉ុណ្ណោះ មិនមែនសម្រាប់អនុញ្ញាតបង្ហោះទេ។'
                  : 'If you connected TikTok in TikTok Activity, you do not need to enter it again here. This optional handle only gives the AI business context; it does not authorize publishing.'}
              </p>
              <input
                type="text"
                value={tiktokHandle}
                onChange={(e) => setTiktokHandle(e.target.value)}
                aria-label={language === 'km' ? 'ឈ្មោះ TikTok សម្រាប់បរិបទ AI (ជាជម្រើស)' : 'TikTok handle for AI context (optional)'}
                placeholder={language === 'km' ? 'ឈ្មោះ TikTok (ជាជម្រើស)' : 'TikTok handle (optional), e.g. @mycompany'}
                className="w-full px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <Send size={12} />
                {t('myTelegramChannelTitle')}
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{t('myTelegramChannelDesc')}</p>
              <div className="space-y-3">
                <div>
                  <label htmlFor="telegram-bot-token" className="mb-1 block text-[10px] font-bold text-slate-500 dark:text-slate-400">{t('telegramBotTokenLabel')}</label>
                  <input
                    id="telegram-bot-token"
                    type="password"
                    value={telegramBotToken}
                    onChange={(e) => setTelegramBotToken(e.target.value)}
                    placeholder={t('telegramBotTokenPlaceholder')}
                    autoComplete="off"
                    className="w-full px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
                  />
                </div>
                <div>
                  {/* This is the field the Sidebar's "Open Telegram Channel"
                      link and publishing destination actually read -- placed
                      and labeled ahead of the legacy Chat ID field below so
                      it isn't mistaken for it (see telegramChatId's own label:
                      the two were previously indistinguishable once typed,
                      since only placeholder text -- which disappears on input
                      -- told them apart). */}
                  <label htmlFor="telegram-channel-username" className="mb-1 block text-[10px] font-bold text-slate-500 dark:text-slate-400">{t('telegramChannelUsernameLabel')}</label>
                  <input
                    id="telegram-channel-username"
                    type="text"
                    value={telegramChannelUrl}
                    onChange={(e) => setTelegramChannelUrl(e.target.value)}
                    placeholder={t('telegramChannelUsernamePlaceholder')}
                    className="w-full px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
                  />
                  {channelPreviewUsername && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {language === 'km'
                        ? `រក្សាទុកជា ${channelPreviewUsername} សម្រាប់ផ្ញើតាម Telegram។`
                        : `Saved as ${channelPreviewUsername} for Telegram publishing.`}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="telegram-chat-id" className="mb-1 block text-[10px] font-bold text-slate-500 dark:text-slate-400">{t('telegramChatIdLabel')}</label>
                  <input
                    id="telegram-chat-id"
                    type="text"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    placeholder={t('telegramChatIdPlaceholder')}
                    className="w-full px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
                  />
                </div>
              </div>
            </div>

            {!isDemoMode && user && (
              <div>
                <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <Bot size={12} />
                  {t('myTelegramBotTitle')}
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{t('myTelegramBotDesc')}</p>
                <div className="flex items-center gap-3">
                  <span className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold',
                    telegramBotActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  )}>
                    <span className={cn('w-2 h-2 rounded-full', telegramBotActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400')} />
                    {telegramBotActive ? t('botActiveStatus') : t('botInactiveStatus')}
                  </span>
                  <button
                    onClick={handleToggleBotActive}
                    disabled={activatingBot || !savedTelegramBotToken || telegramBotToken.trim() !== savedTelegramBotToken}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                      telegramBotActive
                        ? 'bg-rose-50 hover:bg-rose-100 text-rose-600'
                        : 'bg-brand-50 hover:bg-brand-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-brand-600 dark:text-brand-400'
                    )}
                  >
                    {activatingBot ? <Loader2 size={16} className="animate-spin" /> : null}
                    {telegramBotActive ? t('deactivateMyBot') : t('activateMyBot')}
                  </button>
                </div>
                {(!savedTelegramBotToken || telegramBotToken.trim() !== savedTelegramBotToken) && (
                  <p className="text-[11px] text-amber-600 mt-2">{t('saveBotTokenFirst')}</p>
                )}
                {botStatusMessage && <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">{botStatusMessage}</p>}
              </div>
            )}

            {error && <p className="text-sm text-rose-500">{error}</p>}

            <div className="flex items-center justify-end gap-3 pt-2">
              <AnimatePresence>
                {saved && (
                  <motion.span
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium"
                  >
                    <CheckCircle2 size={16} />
                    {t('savedSuccessfully')}
                  </motion.span>
                )}
              </AnimatePresence>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-3 bg-brand-700 hover:bg-brand-800 text-white rounded-2xl font-bold text-sm shadow-lg shadow-brand-700/20 disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {t('saveProfile')}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

export default BusinessProfile;
