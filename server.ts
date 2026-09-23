import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import runScheduledHandler from "./api/telegram/run-scheduled.js";
import telegramWebhookHandler from "./api/telegram/webhook.js";
import telegramDeliverHandler from "./api/telegram/deliver.js";
import aiHandler from "./api/ai.js";
import publishPhotoHandler from "./api/tiktok/publish-photo.js";
import configCheckHandler from "./api/config/check.js";
import tiktokAuthHandler from "./api/auth/tiktok.js";
import tiktokAuthRedirectHandler from "./api/auth/tiktok/redirect.js";
import tiktokCallbackHandler from "./api/tiktok/callback.js";
import tiktokMeHandler from "./api/tiktok/me.js";
import tiktokStatsHandler from "./api/tiktok/stats.js";
import tiktokPublishHandler from "./api/tiktok/publish.js";

dotenv.config();

let firestoreDb: Firestore | null = null;

const safeError = (res: express.Response, status: number, message: string) => {
  res.status(status).json({ error: message });
};

const requireFirebaseSession = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!token) {
    return safeError(res, 401, "Authentication required");
  }

  try {
    const decoded = await getAuth().verifyIdToken(token, true);
    const disabledUser = await getAuth().getUser(decoded.uid);
    if (disabledUser.disabled) {
      return safeError(res, 403, "Account is deactivated");
    }
    (req as any).user = decoded;
    next();
  } catch (error) {
    return safeError(res, 401, "Invalid or expired session");
  }
};

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
      if (getApps().length === 0) {
        initializeApp({
          projectId: firebaseProjectId,
        });
      }
      firestoreDb = getFirestore();
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

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
    next();
  });
  app.use(express.json({
    limit: "25mb",
    verify(req, _res, buffer) {
      (req as any).rawBody = buffer.toString('utf8');
    },
  }));
  app.use(cookieParser());
  const configuredAppOrigin = (() => {
    try { return process.env.APP_URL ? new URL(process.env.APP_URL).origin : ''; } catch { return ''; }
  })();
  app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      try {
        const parsed = new URL(origin);
        const local = ['localhost', '127.0.0.1'].includes(parsed.hostname);
        if (local || (configuredAppOrigin && parsed.origin === configuredAppOrigin)) return callback(null, true);
      } catch {
        // Invalid Origin headers are rejected below.
      }
      return callback(new Error('Origin is not allowed.'));
    },
    credentials: true
  }));

  // Development uses the exact same hardened handlers as Vercel production.
  // Keep these registrations before the legacy compatibility routes below so
  // OAuth CSRF checks, Firebase auth, validation, and audit behavior cannot drift.
  app.all("/api/config/check", async (req, res) => { await configCheckHandler(req, res); });
  app.all("/api/auth/tiktok", async (req, res) => { await tiktokAuthHandler(req, res); });
  app.all("/api/auth/tiktok/redirect", async (req, res) => { await tiktokAuthRedirectHandler(req, res); });
  app.all("/api/tiktok/callback", async (req, res) => { await tiktokCallbackHandler(req, res); });
  app.all("/api/tiktok/me", async (req, res) => { await tiktokMeHandler(req, res); });
  app.all("/api/tiktok/stats", async (req, res) => { await tiktokStatsHandler(req, res); });
  app.all("/api/tiktok/publish", async (req, res) => { await tiktokPublishHandler(req, res); });
  app.all("/api/telegram/webhook", async (req, res) => { await telegramWebhookHandler(req, res); });
  app.all("/api/telegram/deliver", async (req, res) => { await telegramDeliverHandler(req, res); });

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

  app.all("/api/telegram/run-scheduled", async (req, res) => {
    await runScheduledHandler(req, res);
  });
  app.all("/api/ai", async (req, res) => { await aiHandler(req, res); });

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
    const scope = (process.env.TIKTOK_SCOPES || "user.info.basic").trim();
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
    const scope = (process.env.TIKTOK_SCOPES || "user.info.basic").trim();
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
          updatedAt: FieldValue.serverTimestamp()
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

  app.get("/api/tiktok/stats", async (req, res) => {
    const token = req.cookies?.tiktok_token;
    if (!token) return res.status(401).json({ error: "Connect your TikTok account first.", code: "not_connected" });
    const fields = "open_id,avatar_url,display_name,username,follower_count,following_count,likes_count,video_count";
    try {
      const response = await axios.get(`https://open.tiktokapis.com/v2/user/info/?fields=${fields}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const user = response.data?.data?.user || {};
      res.json({
        handle: user.username || user.display_name || "", displayName: user.display_name || "", avatarUrl: user.avatar_url || "",
        followers: user.follower_count ?? null, following: user.following_count ?? null, likes: user.likes_count ?? null,
        videoCount: user.video_count ?? null, updatedAt: new Date().toISOString(), source: "tiktok_official_api"
      });
    } catch (error: any) {
      const detail = error.response?.data?.error;
      const needsStats = /scope|permission|access/i.test(`${detail?.code || ""} ${detail?.message || ""}`);
      res.status(error.response?.status || 500).json({
        error: needsStats ? "TikTok must approve user.info.stats, then reconnect the account." : (detail?.message || "TikTok could not return account statistics."),
        code: detail?.code || "tiktok_error"
      });
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

  // Reuses the exact production handler (api/tiktok/publish-photo.js) instead of a separate
  // reimplementation, so this route can't drift from what Vercel actually serves.
  app.post("/api/tiktok/publish-photo", async (req, res) => {
    await publishPhotoHandler(req, res);
  });

  // Convert middleware failures (notably rejected CORS origins) into a stable,
  // non-leaking API response instead of Express's development stack trace.
  app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error?.message === 'Origin is not allowed.') {
      return res.status(403).json({ error: 'Origin is not allowed.' });
    }
    if (req.path.startsWith('/api/')) {
      console.error('Unhandled API middleware error:', error?.message || error);
      return res.status(500).json({ error: 'Internal server error.' });
    }
    return next(error);
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
