import React, { useState, useEffect } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus,
  Facebook,
  Video,
  Send,
  Sparkles,
  MoreHorizontal,
  Calendar as CalendarIcon,
  Clock,
  Edit2,
  Trash2,
  ExternalLink,
  CheckCircle2,
  Loader2,
  BrainCircuit,
  AlertCircle
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, parseISO } from 'date-fns';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp,
  getDocs
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';

const Planner: React.FC = () => {
  const { user, isDemoMode } = useAuth();
  const { t, language } = useLanguage();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, post?: any, type: 'post' | 'general' } | null>(null);
  const [showFullList, setShowFullList] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isAutoPlanning, setIsAutoPlanning] = useState(false);
  const [editingPost, setEditingPost] = useState<any | null>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [newPost, setNewPost] = useState({
    title: '',
    platform: 'Facebook',
    date: format(new Date(), 'yyyy-MM-dd'),
    time: '12:00'
  });

  useEffect(() => {
    let unsubscribe: () => void = () => {};

    const loadPosts = async () => {
      const userToUse = user || (isDemoMode ? { uid: 'demo-user' } : null);
      if (!userToUse) {
        setLoading(false);
        return;
      }

      if (isDemoMode) {
        const savedPosts = localStorage.getItem('demo_planner_posts');
        if (savedPosts) {
          const parsed = JSON.parse(savedPosts).map((p: any) => ({
            ...p,
            date: new Date(p.date)
          }));
          setPosts(parsed);
        } else {
          setPosts([
            { id: '1', date: new Date(2026, 3, 10), platform: 'Facebook', title: 'New Product Launch', time: '10:00 AM' },
            { id: '2', date: new Date(2026, 3, 15), platform: 'TikTok', title: 'Behind the Scenes', time: '02:30 PM' },
          ]);
        }
        setLoading(false);
      } else {
        const q = query(
          collection(db, 'planner_posts'),
          where('userId', '==', userToUse.uid)
        );

        unsubscribe = onSnapshot(q, (snapshot) => {
          const fetchedPosts = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
              id: doc.id,
              ...data,
              date: data.date?.toDate ? data.date.toDate() : new Date(data.date)
            };
          });
          setPosts(fetchedPosts);
          setLoading(false);
        }, (err) => {
          console.error("Planner Snapshot Error:", err);
          setLoading(false);
        });
      }
    };

    loadPosts();
    return () => unsubscribe();
  }, [user, isDemoMode]);

  useEffect(() => {
    if (isDemoMode) {
      localStorage.setItem('demo_planner_posts', JSON.stringify(posts));
    }
  }, [posts, isDemoMode]);

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'Facebook': return <Facebook size={12} className="text-blue-600" />;
      case 'TikTok': return <Video size={12} className="text-slate-900" />;
      case 'Telegram': return <Send size={12} className="text-sky-500" />;
      default: return null;
    }
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPost.title) return;

    const userToUse = user || (isDemoMode ? { uid: 'demo-user' } : null);
    if (!userToUse) return;

    const [year, month, day] = newPost.date.split('-').map(Number);
    const [hours, minutes] = newPost.time.split(':').map(Number);
    
    const postDate = new Date(year, month - 1, day);
    const timeString = format(new Date().setHours(hours, minutes), 'hh:mm a');

    const postData = {
      title: newPost.title,
      platform: newPost.platform,
      date: postDate,
      time: timeString,
      userId: userToUse.uid,
      createdAt: serverTimestamp()
    };

    if (isDemoMode) {
      setPosts(prev => [...prev, { id: Date.now().toString(), ...postData }]);
    } else {
      try {
        await addDoc(collection(db, 'planner_posts'), postData);
      } catch (err) {
        console.error("Error creating post:", err);
      }
    }

    setIsCreateModalOpen(false);
    setEditingPost(null);
    setNewPost({
      title: '',
      platform: 'Facebook',
      date: format(new Date(), 'yyyy-MM-dd'),
      time: '12:00'
    });
  };

  const handleUpdatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPost.title || !editingPost) return;

    const [year, month, day] = newPost.date.split('-').map(Number);
    const [hours, minutes] = newPost.time.split(':').map(Number);
    
    const postDate = new Date(year, month - 1, day);
    const timeString = format(new Date().setHours(hours, minutes), 'hh:mm a');

    const updateData = {
      title: newPost.title,
      platform: newPost.platform,
      date: postDate,
      time: timeString,
      updatedAt: serverTimestamp()
    };

    if (isDemoMode) {
      setPosts(prev => prev.map(post => 
        post.id === editingPost.id 
          ? { ...post, ...updateData }
          : post
      ));
    } else {
      try {
        await updateDoc(doc(db, 'planner_posts', editingPost.id), updateData);
      } catch (err) {
        console.error("Error updating post:", err);
      }
    }

    setIsCreateModalOpen(false);
    setEditingPost(null);
    setNewPost({
      title: '',
      platform: 'Facebook',
      date: format(new Date(), 'yyyy-MM-dd'),
      time: '12:00'
    });
  };

  const startEditing = (post: any) => {
    setEditingPost(post);
    // Convert "10:00 AM" to "10:00"
    let [time, modifier] = post.time.split(' ');
    let [hours, minutes] = time.split(':');
    if (hours === '12') hours = '00';
    if (modifier === 'PM') hours = parseInt(hours, 10) + 12;
    const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes}`;

    setNewPost({
      title: post.title,
      platform: post.platform,
      date: format(post.date, 'yyyy-MM-dd'),
      time: formattedTime
    });
    setIsCreateModalOpen(true);
    setContextMenu(null);
  };

  const handleAutoPlan = async () => {
    const userToUse = user || (isDemoMode ? { uid: 'demo-user' } : null);
    if (!userToUse) return;

    setIsAutoPlanning(true);
    try {
      const response = await fetch('/api/planner-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: format(currentDate, 'MMMM yyyy'), language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to generate content strategy.');

      const generatedData = data.posts || [];
      
      const newPostsData = generatedData.map((p: any) => {
        const [year, month, day] = p.date.split('-').map(Number);
        const [hours, minutes] = p.time.split(':').map(Number);
        return {
          title: p.title,
          platform: p.platform,
          date: new Date(year, month - 1, day),
          time: format(new Date().setHours(hours, minutes), 'hh:mm a'),
          userId: userToUse.uid,
          createdAt: new Date()
        };
      });

      if (isDemoMode) {
        const withIds = newPostsData.map(p => ({ ...p, id: Math.random().toString(36).substr(2, 9) }));
        setPosts(prev => [...prev, ...withIds]);
      } else {
        // We could use a batch write here for efficiency
        for (const post of newPostsData) {
          await addDoc(collection(db, 'planner_posts'), {
            ...post,
            createdAt: serverTimestamp()
          });
        }
      }

      alert('AI has successfully generated your content strategy!');
    } catch (error) {
      console.error("AI Auto-Plan failed:", error);
      alert('Failed to generate content strategy. Please try again.');
    } finally {
      setIsAutoPlanning(false);
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!confirm('Are you sure you want to delete this post?')) return;
    
    if (isDemoMode) {
      setPosts(prev => prev.filter(post => post.id !== postId));
    } else {
      try {
        await deleteDoc(doc(db, 'planner_posts', postId));
      } catch (err) {
        console.error("Error deleting post:", err);
      }
    }
    
    if (contextMenu?.post?.id === postId) {
      setContextMenu(null);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, post?: any) => {
    e.preventDefault();
    setContextMenu({ 
      x: e.clientX, 
      y: e.clientY, 
      post, 
      type: post ? 'post' : 'general' 
    });
  };

  const closeContextMenu = () => setContextMenu(null);

  React.useEffect(() => {
    window.addEventListener('click', closeContextMenu);
    return () => window.removeEventListener('click', closeContextMenu);
  }, []);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const calendarDays = eachDayOfInterval({
    start: startDate,
    end: endDate,
  });

  return (
    <div className="max-w-6xl mx-auto space-y-10 relative">
      <AnimatePresence>
        {isAutoPlanning && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-brand-900/60 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative bg-white rounded-[3rem] p-12 shadow-2xl text-center max-w-sm"
            >
              <div className="relative w-24 h-24 mx-auto mb-8">
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 rounded-full border-4 border-brand-100 border-t-brand-600"
                />
                <div className="absolute inset-0 flex items-center justify-center text-brand-600">
                  <BrainCircuit size={40} />
                </div>
              </div>
              <h3 className="text-2xl font-display font-bold text-brand-700 mb-3">AI is Strategizing</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                Analyzing market trends and generating your optimized content calendar...
              </p>
              <div className="mt-8 flex justify-center gap-1">
                {[0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                    className="w-2 h-2 rounded-full bg-brand-600"
                  />
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCreateModalOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setIsCreateModalOpen(false);
                setEditingPost(null);
              }}
              className="absolute inset-0 bg-brand-900/40 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[3rem] shadow-2xl overflow-hidden"
            >
              <form onSubmit={editingPost ? handleUpdatePost : handleCreatePost} className="p-10 space-y-8">
                <div>
                  <h3 className="text-3xl font-display font-bold text-brand-700">
                    {editingPost ? 'Edit Post' : 'Create New Post'}
                  </h3>
                  <p className="text-slate-500">
                    {editingPost ? 'Update your scheduled content.' : 'Schedule your next big announcement.'}
                  </p>
                </div>

                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-black text-brand-400 uppercase tracking-widest">Post Title</label>
                    <input 
                      type="text"
                      required
                      placeholder="e.g., Summer Collection Reveal"
                      value={newPost.title}
                      onChange={e => setNewPost(prev => ({ ...prev, title: e.target.value }))}
                      className="w-full px-6 py-4 bg-brand-50 border border-brand-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all font-medium"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-brand-400 uppercase tracking-widest">Platform</label>
                      <select 
                        value={newPost.platform}
                        onChange={e => setNewPost(prev => ({ ...prev, platform: e.target.value }))}
                        className="w-full px-6 py-4 bg-brand-50 border border-brand-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all font-medium appearance-none"
                      >
                        <option value="Facebook">Facebook</option>
                        <option value="TikTok">TikTok</option>
                        <option value="Telegram">Telegram</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black text-brand-400 uppercase tracking-widest">Time</label>
                      <input 
                        type="time"
                        required
                        value={newPost.time}
                        onChange={e => setNewPost(prev => ({ ...prev, time: e.target.value }))}
                        className="w-full px-6 py-4 bg-brand-50 border border-brand-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all font-medium"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-black text-brand-400 uppercase tracking-widest">Date</label>
                    <input 
                      type="date"
                      required
                      value={newPost.date}
                      onChange={e => setNewPost(prev => ({ ...prev, date: e.target.value }))}
                      className="w-full px-6 py-4 bg-brand-50 border border-brand-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all font-medium"
                    />
                  </div>
                </div>

                <div className="flex gap-4">
                  <button 
                    type="button"
                    onClick={() => {
                      setIsCreateModalOpen(false);
                      setEditingPost(null);
                    }}
                    className="flex-1 py-5 bg-brand-50 text-brand-600 font-bold rounded-2xl hover:bg-brand-100 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-5 bg-brand-700 text-white font-bold rounded-2xl hover:bg-brand-800 transition-all shadow-xl shadow-brand-700/20"
                  >
                    {editingPost ? 'Save Changes' : 'Schedule Post'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            style={{ top: contextMenu.y, left: contextMenu.x }}
            className="fixed z-[100] w-56 bg-white rounded-2xl shadow-2xl border border-brand-100 p-2 overflow-hidden"
          >
            {contextMenu.type === 'post' ? (
              <>
                <div className="px-4 py-3 border-b border-brand-50 mb-1">
                  <p className="text-[10px] font-black text-brand-400 uppercase tracking-widest">Post Actions</p>
                  <p className="text-sm font-bold text-brand-700 truncate">{contextMenu.post.title}</p>
                </div>
                <button 
                  onClick={() => startEditing(contextMenu.post)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-brand-50 hover:text-brand-600 rounded-xl transition-all"
                >
                  <Edit2 size={16} /> Edit Post
                </button>
                <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-brand-50 hover:text-brand-600 rounded-xl transition-all">
                  <Clock size={16} /> Reschedule
                </button>
                <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-brand-50 hover:text-brand-600 rounded-xl transition-all">
                  <ExternalLink size={16} /> Preview
                </button>
                <div className="h-px bg-brand-50 my-1" />
                <button 
                  onClick={() => handleDeletePost(contextMenu.post.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                >
                  <Trash2 size={16} /> Delete Post
                </button>
              </>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-brand-50 mb-1">
                  <p className="text-[10px] font-black text-brand-400 uppercase tracking-widest">Planner Actions</p>
                  <p className="text-sm font-bold text-brand-700">General Menu</p>
                </div>
                <button 
                  onClick={() => window.location.reload()}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-brand-50 hover:text-brand-600 rounded-xl transition-all"
                >
                  <Sparkles size={16} /> Refresh Schedule
                </button>
                <button 
                  onClick={() => setShowFullList(true)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-brand-50 hover:text-brand-600 rounded-xl transition-all"
                >
                  <CalendarIcon size={16} /> View Full List
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showFullList && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowFullList(false)}
              className="absolute inset-0 bg-brand-900/40 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-[3rem] shadow-2xl overflow-hidden"
            >
              <div className="p-10">
                <div className="flex justify-between items-center mb-8">
                  <div>
                    <h3 className="text-3xl font-display font-bold text-brand-700">Full Content Schedule</h3>
                    <p className="text-slate-500">All your planned posts in one place.</p>
                  </div>
                  <button 
                    onClick={() => setShowFullList(false)}
                    className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-400 flex items-center justify-center hover:bg-brand-100 transition-all"
                  >
                    <Plus size={24} className="rotate-45" />
                  </button>
                </div>

                <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-4 custom-scrollbar">
                  {posts.map((post, i) => (
                    <div 
                      key={i} 
                      onContextMenu={(e) => handleContextMenu(e, post)}
                      onClick={(e) => handleContextMenu(e, post)}
                      className="flex items-center justify-between p-6 bg-brand-50/50 rounded-[2rem] border border-brand-100 hover:border-brand-300 transition-all group cursor-pointer hover:bg-white shadow-sm hover:shadow-md"
                    >
                      <div className="flex items-center gap-5">
                        <div className="w-14 h-14 bg-white rounded-2xl shadow-sm flex items-center justify-center border border-brand-100">
                          {getPlatformIcon(post.platform)}
                        </div>
                        <div>
                          <h4 className="font-bold text-brand-700">{post.title}</h4>
                          <p className="text-xs text-slate-500 font-medium">{format(post.date, 'EEEE, MMMM do')} • {post.time}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 transition-all">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleContextMenu(e, post);
                          }}
                          className="p-3 bg-white text-brand-400 hover:text-brand-600 rounded-xl shadow-sm border border-brand-100 transition-all active:scale-95"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePost(post.id);
                          }}
                          className="p-3 bg-white text-rose-400 hover:text-rose-600 rounded-xl shadow-sm border border-brand-100 transition-all active:scale-95"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <button 
                  onClick={() => setShowFullList(false)}
                  className="w-full mt-10 py-5 bg-brand-700 text-white font-bold rounded-2xl hover:bg-brand-800 transition-all shadow-xl shadow-brand-700/20"
                >
                  Close Schedule
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-4xl font-display font-bold text-brand-700 tracking-tight flex items-center gap-3">
            Sales Planner
            <Sparkles className="text-brand-500" size={28} />
          </h2>
          <p className="text-slate-500 mt-1 text-lg">Plan and schedule your content across all platforms.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsCreateModalOpen(true)}
            className="bg-brand-700 hover:bg-brand-800 text-white px-6 py-3 rounded-2xl flex items-center gap-2 transition-all shadow-xl shadow-brand-700/20 font-bold"
          >
            <Plus size={20} />
            Create Post
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-9">
          <div className="glass rounded-[2.5rem] border border-white/50 shadow-sm overflow-hidden">
            <div className="p-8 border-b border-brand-100 flex items-center justify-between bg-white/30 backdrop-blur-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-brand-50 text-brand-600 rounded-2xl flex items-center justify-center shadow-inner border border-brand-100">
                  <CalendarIcon size={24} />
                </div>
                <div>
                  <h3 className="text-2xl font-display font-bold text-brand-700">
                    {format(currentDate, 'MMMM yyyy')}
                  </h3>
                  <p className="text-xs font-bold text-brand-400 uppercase tracking-widest">Monthly Schedule</p>
                </div>
              </div>
              <div className="flex gap-3 bg-brand-50 p-1.5 rounded-2xl border border-brand-100">
                <button 
                  onClick={() => setCurrentDate(subMonths(currentDate, 1))}
                  className="p-2.5 hover:bg-white hover:text-brand-600 rounded-xl transition-all text-brand-400"
                >
                  <ChevronLeft size={20} />
                </button>
                <button 
                  onClick={() => setCurrentDate(new Date())}
                  className="px-5 py-2.5 text-sm font-bold bg-white text-brand-700 rounded-xl shadow-sm border border-brand-100"
                >
                  Today
                </button>
                <button 
                  onClick={() => setCurrentDate(addMonths(currentDate, 1))}
                  className="p-2.5 hover:bg-white hover:text-brand-600 rounded-xl transition-all text-brand-400"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 bg-brand-50/50 border-b border-brand-100">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="px-4 py-4 text-center text-[10px] font-black text-brand-400 uppercase tracking-[0.2em]">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {calendarDays.map((day, i) => {
                const dayPosts = posts.filter(p => isSameDay(p.date, day));
                const isToday = isSameDay(day, new Date());
                const isCurrentMonth = isSameMonth(day, monthStart);
                
                return (
                  <motion.div 
                    key={i} 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.01 }}
                    className={cn(
                      "min-h-[140px] p-4 border-r border-b border-brand-100 transition-all group relative",
                      !isCurrentMonth && "bg-brand-50/30",
                      isToday && "bg-brand-100/20"
                    )}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <span className={cn(
                        "text-sm font-bold w-8 h-8 flex items-center justify-center rounded-xl transition-all",
                        isToday 
                          ? "bg-brand-600 text-white shadow-lg shadow-brand-200 scale-110" 
                          : isCurrentMonth ? "text-brand-600 group-hover:bg-brand-50" : "text-brand-300"
                      )}>
                        {format(day, 'd')}
                      </span>
                      {isCurrentMonth && (
                        <button 
                          onClick={() => {
                            setNewPost(prev => ({ ...prev, date: format(day, 'yyyy-MM-dd') }));
                            setIsCreateModalOpen(true);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-brand-400 hover:text-brand-600 transition-all"
                        >
                          <Plus size={16} />
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {dayPosts.map((post, idx) => (
                        <div 
                          key={idx} 
                          onContextMenu={(e) => handleContextMenu(e, post)}
                          onClick={(e) => handleContextMenu(e, post)}
                          className="bg-white border border-brand-100 p-2 rounded-xl shadow-sm flex flex-col gap-1.5 cursor-pointer hover:border-brand-300 hover:shadow-md transition-all group/post active:scale-95"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              {getPlatformIcon(post.platform)}
                              <span className="text-[9px] font-black uppercase tracking-wider text-brand-400">{post.platform}</span>
                            </div>
                            <Clock size={10} className="text-brand-300" />
                          </div>
                          <span className="text-[11px] font-bold text-brand-700 truncate leading-tight">{post.title}</span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 space-y-8">
          <div className="glass p-8 rounded-[2.5rem] border border-white/50 shadow-sm">
            <h3 
              onContextMenu={(e) => handleContextMenu(e)}
              className="text-xl font-bold text-brand-700 mb-6 flex items-center gap-2 cursor-context-menu"
            >
              <Clock size={20} className="text-crab-shell" />
              Upcoming
            </h3>
            <div className="space-y-6">
              {posts.map((post, i) => (
                <div 
                  key={i} 
                  onContextMenu={(e) => handleContextMenu(e, post)}
                  onClick={(e) => handleContextMenu(e, post)}
                  className="relative pl-6 border-l-2 border-brand-100 pb-6 last:pb-0 cursor-pointer group/upcoming active:opacity-70 transition-all"
                >
                  <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-white border-2 border-brand-500 group-hover/upcoming:scale-125 transition-all" />
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-brand-600 uppercase tracking-wider">{format(post.date, 'MMM d')} • {post.time}</p>
                    <h4 className="font-bold text-brand-700 text-sm">{post.title}</h4>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="px-2 py-0.5 rounded-md bg-brand-50 text-[9px] font-bold text-brand-500 uppercase tracking-wider">
                        {post.platform}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button 
              onClick={() => setShowFullList(true)}
              onContextMenu={(e) => handleContextMenu(e)}
              className="w-full mt-8 py-4 rounded-2xl bg-brand-50 text-brand-600 font-bold text-sm hover:bg-brand-100 transition-all"
            >
              View Full List
            </button>
          </div>

          <div className="bg-gradient-to-br from-brand-600 to-crab-shell p-8 rounded-[2.5rem] text-white shadow-xl shadow-brand-500/10 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl group-hover:scale-150 transition-transform duration-700" />
            <h3 className="text-xl font-bold mb-2 relative z-10">AI Auto-Planner</h3>
            <p className="text-brand-100 text-sm mb-6 relative z-10 leading-relaxed">Let AI generate your entire month's content strategy based on your goals.</p>
            <button 
              onClick={handleAutoPlan}
              disabled={isAutoPlanning}
              className="w-full py-4 bg-white text-brand-600 font-bold rounded-2xl hover:bg-brand-50 transition-all shadow-lg relative z-10 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isAutoPlanning ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  Generating...
                </>
              ) : (
                'Try Auto-Plan'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Planner;
