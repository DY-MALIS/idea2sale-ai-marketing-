import React, { useState } from 'react';
import { 
  Sparkles, 
  Video as VideoIcon, 
  Mic, 
  Download,
  Loader2,
  RefreshCw,
  Volume2,
  Lock,
  Image as ImageIcon,
  Calendar
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';

type ToolType = 'video' | 'voice';

const VideoVoice: React.FC = () => {
  const { t, language } = useLanguage();
  const [activeTool, setActiveTool] = useState<ToolType>('video');
  const [videoPrompt, setVideoPrompt] = useState('A realistic 8-second TikTok product ad: close-up product reveal on a real table, warm natural light, slow camera push-in, hand places the product naturally, detailed texture, cinematic depth of field, clean premium brand feeling');
  const [videoLanguage, setVideoLanguage] = useState<'Khmer' | 'English'>('Khmer');
  const [voiceLanguage, setVoiceLanguage] = useState<'Khmer' | 'English'>('Khmer');
  const [loading, setLoading] = useState(false);
  const [generatedVideo, setGeneratedVideo] = useState<string | null>(null);
  const [ttsText, setTtsText] = useState('');
  const [targetDuration, setTargetDuration] = useState<number>(1);
  const [generatedAudio, setGeneratedAudio] = useState<string | null>(null);
  const [voiceFallbackMessage, setVoiceFallbackMessage] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [needsApiKey, setNeedsApiKey] = useState(false);
  const [videoImage, setVideoImage] = useState<string | null>(null);
  const [videoImageMimeType, setVideoImageMimeType] = useState<string | null>(null);

  const [aiCaption, setAiCaption] = useState('');
  const [captionLanguage, setCaptionLanguage] = useState<'Khmer' | 'English'>('Khmer');
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);
  const [isPostingTikTok, setIsPostingTikTok] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [tiktokUser, setTiktokUser] = useState<any>(null);

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'TIKTOK_AUTH_SUCCESS') {
        setIsAuthenticating(false);
        fetch('/api/tiktok/me')
          .then(res => res.json())
          .then(data => setTiktokUser(data))
          .catch(err => console.error("Failed to fetch user after auth", err));
      }
    };
    window.addEventListener('message', handleMessage);
    
    // Initial check
    fetch('/api/tiktok/me')
      .then(res => res.json())
      .then(data => {
        if (!data.error) setTiktokUser(data);
      })
      .catch(() => {});

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleGenerateCaption = async () => {
    if (!videoPrompt) return;
    setIsGeneratingCaption(true);
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'videoCaption', prompt: videoPrompt, language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to generate caption.');
      setAiCaption(data.text || '');
    } catch (error) {
      console.error("Caption error:", error);
      alert("Failed to generate caption.");
    } finally {
      setIsGeneratingCaption(false);
    }
  };

  const handleTikTokAuth = async () => {
    if (isAuthenticating) {
      setIsAuthenticating(false);
      return;
    }
    
    setIsAuthenticating(true);
    const timeout = setTimeout(() => setIsAuthenticating(false), 10000);

    try {
      const res = await fetch('/api/auth/tiktok');
      const data = await res.json();
      if (data.url) {
        const width = 600, height = 700;
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;
        const popup = window.open(
          data.url, 
          'tiktokAuth', 
          `width=${width},height=${height},top=${top},left=${left}`
        );
        if (!popup) {
          alert(t('allowPopups'));
          clearTimeout(timeout);
          setIsAuthenticating(false);
        }
      } else {
        alert("Failed to get auth URL");
        clearTimeout(timeout);
        setIsAuthenticating(false);
      }
    } catch (err) {
      console.error("Auth error", err);
      alert(t('authError'));
      clearTimeout(timeout);
      setIsAuthenticating(false);
    }
  };

  const handlePostToTikTok = async (videoUrl: string) => {
    if (!aiCaption) {
      alert("Please generate or write a caption first.");
      return;
    }
    setIsPostingTikTok(true);
    try {
      const res = await fetch('/api/tiktok/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl, title: aiCaption })
      });
      const data = await res.json();
      if (res.ok) {
        alert(t('postedToTiktok'));
      } else {
        throw new Error(data.error?.message || "Publishing failed");
      }
    } catch (error: any) {
      alert(t('postFailed') + ": " + error.message);
    } finally {
      setIsPostingTikTok(false);
    }
  };

  const handleOpenKeySelector = async () => {
    if (typeof window !== 'undefined' && (window as any).aistudio) {
      await (window as any).aistudio.openSelectKey();
      setNeedsApiKey(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!videoPrompt && !videoImage) return;

    setLoading(true);
    setGeneratedVideo(null);
    try {
      const prompt = `${videoLanguage === 'Khmer' ? 'Khmer/Cambodian context. ' : ''}${videoPrompt || 'Create a realistic short marketing video from the uploaded reference image.'}`;
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'videoGenerate',
          prompt,
          imageBase64: videoImage,
          imageMimeType: videoImageMimeType,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Video generation failed.');
      let jobId = data.jobId;
      for (let attempt = 0; attempt < 48 && jobId; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const statusResponse = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'videoStatus', jobId }),
        });
        const statusData = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(statusData.error || 'Video generation failed.');
        if (statusData.videoUrl) {
          setGeneratedVideo(statusData.videoUrl);
          return;
        }
      }
      throw new Error('Video is still processing. Please try again shortly.');
    } catch (error: any) {
      console.error(error);
      if (/OPEN_ROUTER_API_KEY|api key/i.test(error.message || '')) setNeedsApiKey(true);
      alert(error.message || 'Error generating video. Please check your OpenRouter API key and credits.');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateAudio = async () => {
    if (!ttsText) return;

    setAudioLoading(true);
    setGeneratedAudio(null);
    setVoiceFallbackMessage(null);
    try {
      const timedPrompt = `Read this text in ${voiceLanguage}. Aim for about ${targetDuration} minute(s): ${ttsText}`;
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ttsGenerate', input: timedPrompt }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Audio generation failed.');
      setGeneratedAudio(data.audioUrl);
    } catch (error: any) {
      console.error(error);
      if (/OPEN_ROUTER_API_KEY|api key/i.test(error.message || '')) setNeedsApiKey(true);
      const rawMessage = error.message || '';
      const friendlyMessage = /model .*does not exist|no endpoints found|unsupported model/i.test(rawMessage)
        ? (language === 'km'
          ? 'ម៉ូដែលបង្កើតសំឡេងដែលបានកំណត់ក្នុង Vercel មិនត្រឹមត្រូវទេ។ សូមដាក់ OPEN_ROUTER_TTS_MODEL=openai/gpt-audio-mini ហើយ redeploy។'
          : 'The configured TTS model is not available. Set OPEN_ROUTER_TTS_MODEL=openai/gpt-audio-mini in Vercel and redeploy.')
        : rawMessage;
      if ('speechSynthesis' in window) {
        speakWithBrowserVoice();
        setVoiceFallbackMessage(language === 'km'
          ? 'សំឡេង Browser កំពុងដំណើរការ។ OpenRouter audio provider មិនអាចបង្កើតឯកសារ MP3 បាននៅពេលនេះ។'
          : 'Browser voice is active. The OpenRouter audio provider could not create an MP3 file right now.');
      } else {
        alert(friendlyMessage || 'Error generating audio. Please check your OpenRouter API key and credits.');
      }
    } finally {
      setAudioLoading(false);
    }
  };

  const speakWithBrowserVoice = () => {
    if (!('speechSynthesis' in window) || !ttsText.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(ttsText);
    utterance.lang = voiceLanguage === 'Khmer' ? 'km-KH' : 'en-US';
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  };

  const stopBrowserVoice = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const handleDownload = () => {
    if (activeTool === 'video' && generatedVideo) {
      const link = document.createElement('a');
      link.href = generatedVideo;
      link.download = `idea2sale-video-${Date.now()}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (activeTool === 'voice' && generatedAudio) {
      const link = document.createElement('a');
      link.href = generatedAudio;
      link.download = `idea2sale-audio-${Date.now()}.mp3`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-10">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-4xl font-display font-bold text-brand-700 tracking-tight flex items-center gap-3">
            {t('videoVoiceTitle')}
            <VideoIcon className="text-brand-500" size={32} />
          </h2>
          <p className="text-slate-500 mt-1 text-lg">{t('videoVoiceSubtitle')}</p>
        </div>
        <div className="flex flex-col items-end gap-3">
          {needsApiKey && (
            <button 
              onClick={handleOpenKeySelector}
              className="text-xs bg-crab-shell text-white px-6 py-3 rounded-full font-bold hover:bg-crab-shell/90 transition-all flex items-center gap-2 shadow-lg animate-bounce"
            >
              <Lock size={14} />
              {t('unlockPremiumAi')}
            </button>
          )}
          <div className="flex bg-brand-100/50 p-1.5 rounded-2xl border border-brand-200 backdrop-blur-sm">
            {[
              { id: 'video', label: t('videoCreator'), icon: VideoIcon },
              { id: 'voice', label: t('aiVoice'), icon: Mic },
            ].map((tool) => (
              <button 
                key={tool.id}
                onClick={() => setActiveTool(tool.id as ToolType)}
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 whitespace-nowrap",
                  activeTool === tool.id 
                    ? "bg-white text-brand-700 shadow-md scale-105" 
                    : "text-brand-500 hover:text-brand-800"
                )}
              >
                <tool.icon size={18} />
                {tool.label}
              </button>
            ))}
          </div>
          <button 
            onClick={handleTikTokAuth}
            disabled={isAuthenticating}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 bg-black text-white rounded-xl text-sm font-bold hover:bg-slate-900 transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed",
              isAuthenticating && "animate-pulse"
            )}
          >
            {isAuthenticating ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white" xmlns="http://www.w3.org/2000/svg">
                <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.06 3.42-.01 6.83-.02 10.25-.17 4.14-4.23 7.25-8.26 6.5-3.94-.73-6.47-5.11-4.67-8.73 1.14-2.2 3.86-3.54 6.32-3.14.05 1.58 0 3.16 0 4.74-1.57-.14-3.29.35-4.23 1.71-.96 1.39-.64 3.55.75 4.53 1.38.97 3.56.64 4.53-.75.28-.38.39-.84.41-1.3.02-3.58 0-7.17.01-10.75 0-2.87 0-5.74 0-8.61z"/>
              </svg>
            )}
            {tiktokUser ? `Connected: ${tiktokUser.display_name}` : (isAuthenticating ? t('connecting') : t('connectTiktok'))}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-5 space-y-8">
          <div className="glass p-8 rounded-[2.5rem] space-y-6 relative overflow-hidden">
            {activeTool === 'video' ? (
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('startingImageLabel')}</label>
                  <label className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-brand-200 rounded-2xl bg-brand-50 hover:bg-brand-100 transition-all cursor-pointer">
                    {videoImage ? (
                      <img src={`data:${videoImageMimeType};base64,${videoImage}`} alt="Preview" className="w-full h-full object-cover rounded-xl" />
                    ) : (
                      <ImageIcon className="text-brand-300" size={32} />
                    )}
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setVideoImage((reader.result as string).split(',')[1]);
                          setVideoImageMimeType(file.type);
                        };
                        reader.readAsDataURL(file);
                      }
                    }} />
                  </label>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('sceneDescriptionLabel')}</label>
                    <div className="flex bg-brand-50 p-1 rounded-xl border border-brand-100">
                      {['Khmer', 'English'].map(lang => (
                        <button key={lang} onClick={() => setVideoLanguage(lang as any)} className={cn("px-3 py-1 rounded-lg text-[10px] font-black", videoLanguage === lang ? "bg-white text-brand-700 shadow-sm" : "text-brand-400")}>{lang}</button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    value={videoPrompt}
                    onChange={(e) => setVideoPrompt(e.target.value)}
                    placeholder="Describe a realistic TikTok ad: product, location, camera movement, action, lighting, mood..."
                    className="w-full h-32 p-5 rounded-2xl bg-brand-50 border border-brand-200 outline-none transition-all resize-none shadow-inner"
                  />
                </div>

                {/* AI Caption Generator Section */}
                <div className="space-y-4 pt-4 border-t border-brand-100">
                  <div className="flex justify-between items-center">
                    <h4 className="text-sm font-bold text-brand-700 flex items-center gap-2">
                      <Sparkles size={16} className="text-brand-500" />
                      {t('aiCaptionGenerator')}
                    </h4>
                    <div className="flex bg-brand-50 p-1 rounded-xl border border-brand-100">
                      {['Khmer', 'English'].map(lang => (
                        <button key={lang} onClick={() => setCaptionLanguage(lang as any)} className={cn("px-3 py-1 rounded-lg text-[10px] font-black", captionLanguage === lang ? "bg-white text-brand-700 shadow-sm" : "text-brand-400")}>{lang}</button>
                      ))}
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <textarea 
                      value={aiCaption} 
                      onChange={(e) => setAiCaption(e.target.value)} 
                      placeholder={t('captionPlaceholderVideoVoice')}
                      className="w-full h-24 p-4 rounded-xl bg-brand-50/50 border border-brand-100 outline-none text-sm resize-none italic text-brand-600"
                    />
                    <button 
                      onClick={handleGenerateCaption}
                      disabled={!videoPrompt || isGeneratingCaption}
                      className="w-full py-2.5 bg-brand-100 text-brand-700 rounded-xl text-xs font-bold hover:bg-brand-200 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isGeneratingCaption ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      {t('generateCaptionBtn')}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex justify-between items-end">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('scriptTextLabel')}</label>
                  <div className="flex bg-brand-50 p-1 rounded-xl border border-brand-100">
                    {['Khmer', 'English'].map(lang => (
                      <button key={lang} onClick={() => setVoiceLanguage(lang as any)} className={cn("px-3 py-1 rounded-lg text-[10px] font-black", voiceLanguage === lang ? "bg-white text-brand-700 shadow-sm" : "text-brand-400")}>{lang}</button>
                    ))}
                  </div>
                </div>
                <textarea value={ttsText} onChange={(e) => setTtsText(e.target.value)} className="w-full h-48 p-4 rounded-2xl bg-brand-50 border border-brand-200 outline-none transition-all resize-none" />
              </div>
            )}
            <button onClick={activeTool === 'video' ? handleGenerateVideo : handleGenerateAudio} className="w-full bg-gradient-to-r from-brand-600 to-crab-shell text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-3 shadow-xl">
              {loading || audioLoading ? <Loader2 className="animate-spin" /> : <Sparkles size={22} />}
              <span className="text-lg">{loading || audioLoading ? t('generating') : t('generateWithAi')}</span>
            </button>
          </div>
        </div>

        <div className="lg:col-span-7">
          <div className="glass p-8 rounded-[2.5rem] min-h-[600px] flex flex-col relative overflow-hidden">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-xl font-bold text-brand-700 flex items-center gap-2">
                <div className="w-2 h-6 bg-brand-500 rounded-full" />
                {t('aiGenerationResult')}
              </h3>
              {(generatedVideo || generatedAudio) && (
                <button onClick={handleDownload} className="p-3 bg-brand-50 text-brand-500 hover:bg-brand-100 rounded-xl transition-all border border-brand-200">
                  <Download size={20} />
                </button>
              )}
            </div>
            <div className="flex-1 flex flex-col items-center justify-center">
              {loading || audioLoading ? (
                <div className="text-center space-y-4">
                  <Loader2 className="w-12 h-12 animate-spin text-brand-600 mx-auto" />
                  <p className="text-brand-700 font-bold">{t('craftingContent')}</p>
                </div>
              ) : activeTool === 'video' && generatedVideo ? (
                <div className="w-full space-y-6">
                  <video src={generatedVideo} controls className="w-full rounded-3xl shadow-2xl" />
                  <div className="flex gap-4">
                    {tiktokUser ? (
                      <button 
                        onClick={() => handlePostToTikTok(generatedVideo!)}
                        disabled={isPostingTikTok}
                        className="flex-1 bg-black text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-3 shadow-xl hover:bg-slate-900 transition-all disabled:opacity-50"
                      >
                        {isPostingTikTok ? <Loader2 size={20} className="animate-spin" /> : (
                          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.06 3.42-.01 6.83-.02 10.25-.17 4.14-4.23 7.25-8.26 6.5-3.94-.73-6.47-5.11-4.67-8.73 1.14-2.2 3.86-3.54 6.32-3.14.05 1.58 0 3.16 0 4.74-1.57-.14-3.29.35-4.23 1.71-.96 1.39-.64 3.55.75 4.53 1.38.97 3.56.64 4.53-.75.28-.38.39-.84.41-1.3.02-3.58 0-7.17.01-10.75 0-2.87 0-5.74 0-8.61z"/>
                          </svg>
                        )}
                        {t('postToTiktok')} {tiktokUser ? `(@${tiktokUser.display_name})` : ''}
                      </button>
                    ) : (
                      <button 
                        onClick={handleTikTokAuth}
                        disabled={isAuthenticating}
                        className="flex-1 bg-brand-600 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-3 shadow-xl hover:bg-brand-700 transition-all disabled:opacity-50"
                      >
                        {isAuthenticating ? <Loader2 size={20} className="animate-spin" /> : (
                          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.06 3.42-.01 6.83-.02 10.25-.17 4.14-4.23 7.25-8.26 6.5-3.94-.73-6.47-5.11-4.67-8.73 1.14-2.2 3.86-3.54 6.32-3.14.05 1.58 0 3.16 0 4.74-1.57-.14-3.29.35-4.23 1.71-.96 1.39-.64 3.55.75 4.53 1.38.97 3.56.64 4.53-.75.28-.38.39-.84.41-1.3.02-3.58 0-7.17.01-10.75 0-2.87 0-5.74 0-8.61z"/>
                          </svg>
                        )}
                        {t('connectTiktok')}
                      </button>
                    )}
                    <button 
                      onClick={() => alert('Use Smart Scheduler to schedule this video for later. Direct TikTok auto-post requires TikTok Content Posting approval.')}
                      className="p-4 bg-brand-100 text-brand-700 rounded-2xl hover:bg-brand-200 transition-all border border-brand-200"
                      title="Schedule for later"
                    >
                      <Calendar size={24} />
                    </button>
                  </div>
                </div>
              ) : activeTool === 'voice' && (generatedAudio || voiceFallbackMessage) ? (
                <div className="text-center space-y-6">
                  <Volume2 size={64} className="text-brand-600 mx-auto" />
                  {generatedAudio ? (
                    <audio src={generatedAudio} controls className="w-full" />
                  ) : (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-800 space-y-4">
                      <p>{voiceFallbackMessage}</p>
                      <div className="flex flex-wrap justify-center gap-3">
                        <button
                          type="button"
                          onClick={speakWithBrowserVoice}
                          className="rounded-xl bg-brand-700 px-4 py-2 text-white hover:bg-brand-800 transition-all"
                        >
                          {language === 'km' ? 'ចាក់សំឡេងម្ដងទៀត' : 'Play again'}
                        </button>
                        <button
                          type="button"
                          onClick={stopBrowserVoice}
                          className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-amber-800 hover:bg-amber-100 transition-all"
                        >
                          {language === 'km' ? 'បញ្ឈប់សំឡេង' : 'Stop voice'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center text-brand-300 space-y-4">
                  <Sparkles size={48} className="mx-auto" />
                  <p>{t('yourAiContentWillAppear')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoVoice;
