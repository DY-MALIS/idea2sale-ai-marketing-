import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, Bot, Zap, Plus, Sparkles, Clock, X, Send, Instagram, Twitter, Share2, Loader2, AlertCircle } from 'lucide-react';
import AITrainer from './AITrainer';
import Suggestions from './Suggestions';
import Scheduler from './Scheduler';
import ActivityPulse from './ActivityPulse';
import { db, storage } from '../lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useLanguage } from '../contexts/LanguageContext';

import { useAuth } from '../contexts/AuthContext';

const SchedulerHub: React.FC = () => {
  const { t } = useLanguage();
  const { user, isDemoMode } = useAuth();
  const [activityVersion, setActivityVersion] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Helper for local datetime string
  const getLocalISOString = (date: Date) => {
    const tzOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime( ) - tzOffset).toISOString().slice(0, 16);
  };
  
  // Form state
  const [content, setContent] = useState('');
  const [platform, setPlatform] = useState<'TIKTOK' | 'INSTAGRAM' | 'TWITTER' | 'TELEGRAM'>('TIKTOK');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [scheduledTime, setScheduledTime] = useState(() => {
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1);
    nextHour.setMinutes(0);
    return getLocalISOString(nextHour);
  });

  const handleTrainingComplete = () => {
    setActivityVersion(v => v + 1);
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const userToUse = user || (isDemoMode ? { uid: 'demo-user' } : null);

    if (!content.trim() || !scheduledTime || !userToUse || (platform === 'TIKTOK' && !videoFile)) {
      setFormError(t('fillAllFieldsErr'));
      return;
    }

    const scheduledDate = new Date(scheduledTime);
    if (scheduledDate < new Date()) {
      setFormError(t('futureTimeErr'));
      return;
    }

    setIsSubmitting(true);

    if (isDemoMode) {
      setTimeout(() => {
        const post = {
          id: Date.now().toString(),
          content: content.trim(),
          platform,
          scheduledTime: scheduledDate.toISOString(),
          status: 'PENDING',
          userId: 'demo-user',
          aiSuggested: false,
          videoName: videoFile?.name || null,
          createdAt: new Date().toISOString()
        };
        const savedPosts = JSON.parse(localStorage.getItem('demo_scheduled_posts') || '[]');
        localStorage.setItem('demo_scheduled_posts', JSON.stringify([post, ...savedPosts]));
        window.dispatchEvent(new Event('demo-scheduled-posts-updated'));
        setIsSubmitting(false);
        setIsModalOpen(false);
        setContent('');
        setVideoFile(null);
      }, 800);
      return;
    }

    try {
      let videoUrl = '';
      if (platform === 'TIKTOK' && videoFile) {
        const safeName = videoFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storageRef = ref(storage, `scheduled-videos/${userToUse.uid}/${Date.now()}-${safeName}`);
        await uploadBytes(storageRef, videoFile, { contentType: videoFile.type });
        videoUrl = await getDownloadURL(storageRef);
      }
      await addDoc(collection(db, 'scheduled_posts'), {
        content: content.trim(),
        platform,
        scheduledTime: scheduledDate.toISOString(),
        status: 'PENDING',
        userId: userToUse.uid,
        aiSuggested: false,
        videoUrl,
        videoName: videoFile?.name || null,
        publishMode: platform === 'TIKTOK' ? 'TIKTOK_DIRECT_POST' : platform === 'TELEGRAM' ? 'TELEGRAM_AUTO_POST' : 'PLANNED_ONLY',
        createdAt: serverTimestamp()
      });
      setIsModalOpen(false);
      setContent('');
      setVideoFile(null);
      
      const nextHour = new Date();
      nextHour.setHours(nextHour.getHours() + 1);
      nextHour.setMinutes(0);
      setScheduledTime(getLocalISOString(nextHour));
    } catch (err) {
      console.error('Error creating post:', err);
      setFormError(t('failedSavePostErr'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setFormError(null);
  };

  return (
    <div className="space-y-8 pb-20">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2 text-purple-400">
            <Sparkles size={16} />
            <span className="text-[10px] uppercase font-bold tracking-[0.2em]">{t('intelligentEngine')}</span>
          </div>
          <h1 className="text-4xl font-display font-bold text-white tracking-tight">{t('smartScheduler')}</h1>
          <p className="text-brand-300/70 mt-1 max-w-xl">{t('contentOrchestrationDesc')}</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="text-right">
             <p className="text-[10px] text-brand-300 font-bold uppercase tracking-widest">{t('activeModel')}</p>
             <p className="text-sm text-white font-mono flex items-center gap-2">
               <Bot size={14} className="text-purple-500" />
               OpenRouter
             </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsModalOpen(true)}
            className="px-6 py-3 bg-white text-brand-700 rounded-2xl font-bold text-sm shadow-xl flex items-center gap-2 transition-transform"
          >
            <Plus size={18} />
            {t('scheduleBtn')}
          </motion.button>
        </div>
      </header>

      <div className="rounded-2xl border border-purple-500/20 bg-purple-500/10 px-5 py-4 text-sm text-brand-200">
        <strong className="text-white">
          {t('smartScheduler')}
        </strong>
        <span className="ml-2">
          {t('schedulerRoleDesc')}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Training & Suggestions */}
        <div className="lg:col-span-4 space-y-8">
           <AITrainer onTrainingComplete={handleTrainingComplete} />
           
           <div className="bg-[#151619] border border-[#2A2B2F] rounded-xl p-6 shadow-2xl">
             <Suggestions activityVersion={activityVersion} />
           </div>
        </div>

        {/* Right: The Timeline & Pulse */}
        <div className="lg:col-span-8 space-y-8">
           <ActivityPulse version={activityVersion} />
           <Scheduler />
        </div>
      </div>

      {/* Manual Schedule Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeModal}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-[#151619] border border-[#2A2B2F] rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-[#2A2B2F] flex justify-between items-center bg-[#1A1B1E]">
                <div>
                  <h3 className="text-xl font-bold text-white tracking-tight">{t('manualSchedule')}</h3>
                  <p className="text-[#8E9299] text-xs mt-1">{t('bypassAiDesc')}</p>
                </div>
                <button onClick={closeModal} className="p-2 hover:bg-[#2A2B2F] rounded-xl transition-all">
                  <X size={20} className="text-[#8E9299]" />
                </button>
              </div>

              <form onSubmit={handleCreatePost} className="p-8 space-y-6">
                {formError && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-500 text-xs"
                  >
                    <AlertCircle size={14} />
                    {formError}
                  </motion.div>
                )}
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-[#4A4B4F] uppercase tracking-widest mb-2">{t('contentDraft')}</label>
                    <textarea 
                      required
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder={t('contentPlaceholder')}
                      className="w-full h-32 bg-[#0A0A0B] border border-[#2A2B2F] rounded-xl p-4 text-white text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none transition-all resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-[#4A4B4F] uppercase tracking-widest mb-2">{t('platform')}</label>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { id: 'TIKTOK', icon: Share2 },
                          { id: 'INSTAGRAM', icon: Instagram },
                          { id: 'TWITTER', icon: Twitter },
                          { id: 'TELEGRAM', icon: Send }
                        ].map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setPlatform(p.id as any)}
                            className={`p-3 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                              platform === p.id 
                                ? 'bg-purple-500/10 border-purple-500 text-purple-400' 
                                : 'bg-[#0A0A0B] border-[#2A2B2F] text-[#4A4B4F] hover:border-[#4A4B4F]'
                            }`}
                          >
                            <p.icon size={16} />
                            <span className="text-[8px] font-bold">{p.id.charAt(0) + p.id.slice(1).toLowerCase()}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-[#4A4B4F] uppercase tracking-widest mb-2">{t('publishTime')}</label>
                      <input 
                        required
                        type="datetime-local"
                        value={scheduledTime}
                        onChange={(e) => setScheduledTime(e.target.value)}
                        className="w-full p-3 bg-[#0A0A0B] border border-[#2A2B2F] rounded-xl text-white text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none transition-all"
                      />
                    </div>
                  </div>

                  {platform === 'TIKTOK' && (
                    <div>
                      <label className="block text-[10px] font-bold text-[#4A4B4F] uppercase tracking-widest mb-2">TikTok video</label>
                      <input
                        required
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm"
                        onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                        className="w-full p-3 bg-[#0A0A0B] border border-[#2A2B2F] rounded-xl text-white text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-purple-500 file:px-3 file:py-2 file:font-bold file:text-white"
                      />
                      <p className="mt-2 text-xs text-[#8E9299]">MP4, MOV, or WebM. Auto-post starts only after TikTok approves video.publish.</p>
                    </div>
                  )}
                  {platform === 'TELEGRAM' && (
                    <div className="p-3 bg-sky-500/10 border border-sky-500/20 rounded-xl flex items-start gap-2 text-sky-300 text-xs">
                      <Send size={14} className="mt-0.5 shrink-0" />
                      <p>Telegram auto-post will send this text to the configured channel when the scheduled time arrives.</p>
                    </div>
                  )}
                </div>

                <div className="flex gap-4 pt-4">
                  <button 
                    type="button"
                    onClick={closeModal}
                    className="flex-1 py-4 bg-[#2A2B2F] text-white font-bold rounded-2xl hover:bg-[#3A3B3F] transition-all"
                  >
                    {t('discard')}
                  </button>
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 py-4 bg-white text-brand-700 font-bold rounded-2xl hover:bg-slate-100 transition-all flex items-center justify-center gap-2 shadow-xl shadow-white/5"
                  >
                    {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : (
                      <>
                        <Clock size={18} />
                        {t('scheduleBtn')}
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SchedulerHub;
