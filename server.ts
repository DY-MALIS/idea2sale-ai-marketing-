import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import admin from "firebase-admin";

dotenv.config();

let firestoreDb: admin.firestore.Firestore | null = null;

console.log("Starting server process...");

async function startServer() {
  console.log("--- Starting aime.angkorgate Server ---");
  const app = express();
  const PORT = 3000;

  // Load Firebase Config
  try {
    const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
    const firestoreDatabaseId = process.env.FIREBASE_FIRESTORE_DATABASE_ID || process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;
    if (firebaseProjectId) {
      if (!admin.apps || admin.apps.length === 0) {
        admin.initializeApp({
          projectId: firebaseProjectId,
        });
      }
      firestoreDb = admin.firestore();
      if (firestoreDatabaseId) {
        firestoreDb.settings({ databaseId: firestoreDatabaseId });
      }
      console.log("✅ Firebase Admin synchronized.");
    } else {
      console.warn("Firebase Admin skipped: FIREBASE_PROJECT_ID is not configured.");
    }
  } catch (err) {
    console.error("❌ Firebase setup failed:", err);
  }

  app.use(express.json());
  app.use(cookieParser());
  app.use(cors({
    origin: true,
    credentials: true
  }));

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "alive" });
  });

  // Config check (checks if secrets are set without revealing them)
  app.get("/api/config/check", (req, res) => {
    const redirectUri = getRedirectUri(req);
    res.json({
      tiktok: {
        hasClientKey: !!(process.env.TIKTOK_CLIENT_KEY || process.env.VITE_TIKTOK_CLIENT_KEY),
        hasClientSecret: !!(process.env.TIKTOK_CLIENT_SECRET || process.env.VITE_TIKTOK_CLIENT_SECRET),
        redirectUri: redirectUri,
        configuredUri: process.env.TIKTOK_REDIRECT_URI || process.env.VITE_TIKTOK_REDIRECT_URI || "None"
      },
      firebase: {
        isInitialized: !!firestoreDb
      }
    });
  });

  const getRedirectUri = (req: express.Request) => {
    // Priority 1: Manual override from secrets
    const configUri = process.env.TIKTOK_REDIRECT_URI || process.env.VITE_TIKTOK_REDIRECT_URI;
    const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3000';
    const protocol = req.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');

    if (configUri && configUri.trim().startsWith('http')) {
      const configuredUri = configUri.trim();
      const configuredIsLocal = configuredUri.includes('localhost') || configuredUri.includes('127.0.0.1');
      const requestIsLocal = host.includes('localhost') || host.includes('127.0.0.1');
      if (!configuredIsLocal || requestIsLocal) {
        return configuredUri;
      }
    }

    // Priority 2: Use APP_URL from environment (best for containers)
    if (process.env.APP_URL) {
      return `${process.env.APP_URL.replace(/\/$/, '')}/api/tiktok/callback`;
    }
  
    // Priority 3: Fallback to headers
    return `${protocol}://${host}/api/tiktok/callback`;
  };

  // TikTok OAuth Endpoints
  // NEW: Direct redirect endpoint (more robust for iframes)
  app.get("/api/auth/tiktok/redirect", (req, res) => {
    const clientKey = (process.env.TIKTOK_CLIENT_KEY || process.env.VITE_TIKTOK_CLIENT_KEY || "").trim();
    const redirectUri = getRedirectUri(req);
    
    console.log("TikTok Auth Direct Redirect:");
    console.log(" - Client Key Prefix:", clientKey ? clientKey.substring(0, 5) + "..." : "MISSING");
    console.log(" - Client Key Length:", clientKey.length);
    console.log(" - Redirect URI:", redirectUri);

    if (!clientKey) {
      return res.status(500).send("TIKTOK_CLIENT_KEY not configured in Settings -> Secrets");
    }

    const state = "pulse_sync";
    const scope = "user.info.basic";
    const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=${encodeURIComponent(scope)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
    
    console.log(" - Final Redirect Auth URL:", authUrl);
    res.redirect(authUrl);
  });

  app.get("/api/auth/tiktok", (req, res) => {
    const clientKey = (process.env.TIKTOK_CLIENT_KEY || process.env.VITE_TIKTOK_CLIENT_KEY || "").trim();
    const redirectUri = getRedirectUri(req);
    
    console.log("TikTok Auth JSON Request:");
    console.log(" - Client Key Prefix:", clientKey ? clientKey.substring(0, 5) + "..." : "MISSING");
    console.log(" - Redirect URI:", redirectUri);

    if (!clientKey) {
      return res.status(500).json({ error: "TIKTOK_CLIENT_KEY not configured" });
    }

    const state = "pulse_sync";
    const scope = "user.info.basic";
    const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=${encodeURIComponent(scope)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
    
    console.log(" - Final JSON Auth URL:", authUrl);
    res.json({ url: authUrl, redirectUri }); 
  });

  app.get("/api/tiktok/callback", async (req, res) => {
    const { code } = req.query;
    const clientKey = (process.env.TIKTOK_CLIENT_KEY || process.env.VITE_TIKTOK_CLIENT_KEY || "").trim();
    const clientSecret = (process.env.TIKTOK_CLIENT_SECRET || process.env.VITE_TIKTOK_CLIENT_SECRET || "").trim();
    const redirectUri = getRedirectUri(req);

    if (!code) return res.status(400).send("No code provided");

    try {
      const response = await axios.post(
        "https://open.tiktokapis.com/v2/oauth/token/",
        new URLSearchParams({
          client_key: clientKey!,
          client_secret: clientSecret!,
          code: code as string,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );

      const { access_token, refresh_token, open_id, expires_in, refresh_expires_in } = response.data;

      // Store automation tokens in Firestore
      if (firestoreDb && open_id) {
        await firestoreDb.collection("tiktok_automation_tokens").doc(open_id).set({
          access_token,
          refresh_token,
          open_id,
          expires_at: Date.now() + (expires_in * 1000),
          refresh_expires_at: Date.now() + (refresh_expires_in * 1000),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      res.cookie("tiktok_token", access_token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        maxAge: expires_in * 1000
      });

      res.send(`
        <html><body><script>
          window.opener.postMessage({ type: 'TIKTOK_AUTH_SUCCESS', open_id: '${open_id}' }, '*');
          window.close();
        </script></body></html>
      `);
    } catch (error: any) {
      console.error("TikTok Callback Error:", error.response?.data || error.message);
      res.status(500).send("Failed to exchange code for token");
    }
  });

  app.get("/api/tiktok/me", async (req, res) => {
    const token = req.cookies?.tiktok_token;
    if (!token) return res.status(401).json({ error: "Not connected to TikTok" });

    try {
      const response = await axios.get("https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name", {
        headers: { Authorization: `Bearer ${token}` }
      });
      res.json(response.data.data.user);
    } catch (error: any) {
      console.error("TikTok User Info Error:", error.response?.data || error.message);
      res.status(500).json({ error: "Failed to fetch TikTok user info" });
    }
  });

  app.get("/api/tiktok/public-stats", async (req, res) => {
    const { handle } = req.query;
    if (!handle) return res.status(400).json({ error: "Handle required" });
    
    // Helper to format numbers like 1500 to "1.5K"
    const formatNumber = (num: any) => {
      if (num === undefined || num === null || num === "") return "0";
      let val = num.toString().trim();
      
      // If it already has K/M/B, just sanitize and return
      if (/[KMB]$/i.test(val)) {
        return val.toUpperCase();
      }

      // Remove commas and other noise, keep digits and decimal point
      val = val.replace(/,/g, '').match(/[0-9.]+/)?.[0] || "0";
      const n = parseFloat(val);
      
      if (isNaN(n)) return "0";
      if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
      return Math.floor(n).toString();
    };

    try {
      const url = `https://www.tiktok.com/@${handle}?lang=en`;
      console.log("Fetching TikTok stats from:", url);
      
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': 'https://www.tiktok.com/',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      };

      let response;
      try {
        response = await axios.get(url, {
          timeout: 10000,
          headers
        });
      } catch (axiosError: any) {
        if (axiosError.response?.status === 400 || axiosError.response?.status === 403 || axiosError.response?.status === 404) {
          console.warn(`Initial fetch failed with ${axiosError.response?.status}, retrying with alternative URL...`);
          const altUrl = `https://tiktok.com/@${handle}`; 
          response = await axios.get(altUrl, { timeout: 10000, headers });
        } else {
          throw axiosError;
        }
      }
      
      const html = response.data;
      
      let likes = "0";
      let followers = "0";
      let following = "0";
      let videoCount = "0";

      // 1. Try JSON paths first
      const tryParseStates = (html: string) => {
        const patterns = [
          /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" [^>]*>([\s\S]*?)<\/script>/,
          /<script id="__NEXT_DATA__" [^>]*>([\s\S]*?)<\/script>/,
          /<script id="SIGI_STATE" [^>]*>([\s\S]*?)<\/script>/,
          /window\['SIGI_STATE'\]\s*=\s*([\s\S]*?);/,
          /const\s+TiktokData\s*=\s*([\s\S]*?);/
        ];

        for (const pattern of patterns) {
          const match = html.match(pattern);
          if (match) {
            try {
              const dataStr = match[1].trim();
              const data = JSON.parse(dataStr);
              
              // Path 1 (Universal Data)
              const uStats = data?.__DEFAULT_SCOPE__?.["webapp.user-detail"]?.userInfo?.stats || 
                             data?.__DEFAULT_SCOPE__?.["webapp.user-detail"]?.user?.stats ||
                             data?.userInfo?.stats;
              if (uStats) return uStats;

              // Path 2 (Next Data)
              const nStats = data?.props?.pageProps?.userInfo?.stats || 
                             data?.props?.pageProps?.stats ||
                             data?.query?.userInfo?.stats;
              if (nStats) return nStats;

              // Path 3 (Sigi State)
              const userMap = data?.UserModule?.users || {};
              const firstUser = Object.values(userMap)[0] as any;
              const sStats = data?.UserModule?.stats?.[handle as string] || 
                             data?.UserModule?.users?.[handle as string]?.stats ||
                             firstUser?.stats;
              if (sStats) return sStats;
            } catch (e) {}
          }
        }
        return null;
      };

      const stats = tryParseStates(html);
      if (stats) {
        likes = formatNumber(stats.heartCount || stats.heart || stats.diggCount || stats.digg || 0);
        followers = formatNumber(stats.followerCount || stats.follower || 0);
        following = formatNumber(stats.followingCount || stats.following || 0);
        videoCount = formatNumber(stats.videoCount || stats.video || 0);
      }

      // 2. Fallback to Meta description and OG tags
      const metaDescription = html.match(/<meta name="description" content="([^"]+)"/)?.[1] || "";
      const ogDescription = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1] || "";
      const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/)?.[1] || "";
      const combinedDesc = pageTitle + " | " + metaDescription + " | " + ogDescription;
      
      const extractFromText = (text: string) => {
        if (likes === "0") {
          const m = text.match(/([\d.,KMB]+)\s*Likes/i) || text.match(/Likes\s*:\s*([\d.,KMB]+)/i);
          if (m) likes = formatNumber(m[1]);
        }
        if (followers === "0") {
          const m = text.match(/([\d.,KMB]+)\s*Followers/i) || text.match(/Followers\s*:\s*([\d.,KMB]+)/i);
          if (m) followers = formatNumber(m[1]);
        }
        if (following === "0") {
          const m = text.match(/([\d.,KMB]+)\s*Following/i) || text.match(/Following\s*:\s*([\d.,KMB]+)/i);
          if (m) following = formatNumber(m[1]);
        }
        if (videoCount === "0") {
          const m = text.match(/([\d.,KMB]+)\s*Videos/i) || text.match(/(\d+)\s*Video/i);
          if (m) videoCount = formatNumber(m[1]);
        }
      };

      extractFromText(combinedDesc);

      // 3. Final Brute Force Regex
      if (likes === "0" || followers === "0" || videoCount === "0") {
        console.log("Entering brute force regex mode for:", handle);
        const statsPatterns = {
          followers: [/followerCount":\s*(\d+)/, /follower":\s*(\d+)/, /followers":\s*"([\d.,KMB]+)"/i, /"followerCount":\s*(\d+)/, /data-e2e="followers-count">([^<]+)</i],
          likes: [/heartCount":\s*(\d+)/, /heart":\s*(\d+)/, /diggCount":\s*(\d+)/, /likes":\s*"([\d.,KMB]+)"/i, /"diggCount":\s*(\d+)/, /data-e2e="likes-count">([^<]+)</i],
          following: [/followingCount":\s*(\d+)/, /following":\s*(\d+)/, /following":\s*"([\d.,KMB]+)"/i, /"followingCount":\s*(\d+)/, /data-e2e="following-count">([^<]+)</i],
          video: [/videoCount":\s*(\d+)/, /video":\s*(\d+)/, /videos":\s*"([\d.,KMB]+)"/i, /"videoCount":\s*(\d+)/, /data-e2e="video-count">([^<]+)</i]
        };

        for (const [key, patterns] of Object.entries(statsPatterns)) {
          for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) {
              const val = formatNumber(match[1]);
              if (val !== "0") {
                if (key === 'followers') followers = val;
                if (key === 'likes') likes = val;
                if (key === 'following') following = val;
                if (key === 'video') videoCount = val;
                break;
              }
            }
          }
        }
      }

      console.log(`Final extracted stats for ${handle}: L:${likes} F:${followers} Fl:${following} V:${videoCount}`);

      res.json({
        handle,
        likes,
        followers,
        following,
        videoCount,
        updatedAt: new Date().toISOString()
      });
    } catch (error: any) {
      console.error("Public stats error for handle:", handle);
      if (error.response) {
        console.error(" - Status:", error.response.status);
        console.error(" - Data:", JSON.stringify(error.response.data));
      } else {
        console.error(" - Message:", error.message);
      }
      
      res.status(500).json({ 
        error: "Failed to fetch public stats", 
        details: error.message,
        status: error.response?.status,
        handle 
      });
    }
  });

  app.get("/api/proxy-video", async (req, res) => {
    const videoUrl = req.query.url as string;
    if (!videoUrl) return res.status(400).send("No URL provided");
    try {
      const response = await axios({
        method: 'get',
        url: videoUrl,
        responseType: 'stream',
        headers: {
          'x-goog-api-key': process.env.API_KEY || process.env.GEMINI_API_KEY || ''
        }
      });
      res.setHeader('Content-Type', 'video/mp4');
      response.data.pipe(res);
    } catch (error: any) {
      res.status(500).send("Failed to proxy video");
    }
  });

  // Token Refresh Logic for Automation
  const refreshTikTokToken = async (openId: string) => {
    if (!firestoreDb) throw new Error("Firestore not initialized");
    
    const doc = await firestoreDb.collection("tiktok_automation_tokens").doc(openId).get();
    if (!doc.exists) throw new Error("No automation token found for this user");
    
    const data = doc.data();
    const clientKey = process.env.TIKTOK_CLIENT_KEY || process.env.VITE_TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET || process.env.VITE_TIKTOK_CLIENT_SECRET;

    try {
      const response = await axios.post(
        "https://open.tiktokapis.com/v2/oauth/token/",
        new URLSearchParams({
          client_key: clientKey!,
          client_secret: clientSecret!,
          refresh_token: data?.refresh_token,
          grant_type: "refresh_token",
        }).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );

      const { access_token, refresh_token, expires_in, refresh_expires_in } = response.data;

      await firestoreDb.collection("tiktok_automation_tokens").doc(openId).update({
        access_token,
        refresh_token,
        expires_at: Date.now() + (expires_in * 1000),
        refresh_expires_at: Date.now() + (refresh_expires_in * 1000),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return access_token;
    } catch (error: any) {
      console.error("Token Refresh Failed:", error.response?.data || error.message);
      throw error;
    }
  };

  app.post("/api/tiktok/publish", async (req, res) => {
    const { videoUrl, title, openId } = req.body;
    let token = req.cookies.tiktok_token;

    // If implementing pure automation (background worker), we fetch the valid token from DB
    if (openId && !token) {
      try {
        token = await refreshTikTokToken(openId);
      } catch (err) {
        return res.status(401).json({ error: "Automation token expired or invalid" });
      }
    }

    if (!token) return res.status(401).json({ error: "Not authenticated with TikTok" });

    try {
      const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3000';
      const protocol = req.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
      const proxyUrl = `${protocol}://${host}/api/proxy-video?url=${encodeURIComponent(videoUrl)}`;
      
      const initResponse = await axios.post(
        "https://open.tiktokapis.com/v2/post/publish/video/init/",
        {
          post_info: { 
            title: title || "AI Generated Content", 
            privacy_level: "PUBLIC_TO_EVERYONE",
            disable_comment: false,
            disable_duet: false,
            disable_stitch: false
          },
          source_info: { source: "PULL_FROM_URL", video_url: proxyUrl }
        },
        { headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" } }
      );

      const publishId = initResponse.data.data?.publish_id;
      if (publishId && firestoreDb) {
        await firestoreDb.collection("tiktok_posts").doc(publishId).set({
          videoId: publishId,
          status: "PROCESSING",
          title: title,
          videoUrl: videoUrl,
          openId: openId || "manual_post",
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
      res.json({ success: true, publishId });
    } catch (error: any) {
      const apiError = error.response?.data?.error || {};
      console.error("TikTok Publish Error:", apiError);
      
      // Handle Rate Limiting
      if (error.response?.status === 429) {
        return res.status(429).json({ error: "Rate limit reached. Please wait." });
      }

      res.status(500).json({ error: apiError.message || "Publishing failed" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting Vite in middleware mode...");
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      console.log("Vite middleware created successfully.");
      app.use(vite.middlewares);
    } catch (viteError) {
      console.error("Vite failed to start:", viteError);
    }
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  console.log(`Server attempting to start on 0.0.0.0:${PORT}...`);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Critical: Server failed to start:", err);
  process.exit(1);
});
