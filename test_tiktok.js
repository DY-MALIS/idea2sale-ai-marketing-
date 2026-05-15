const axios = require('axios');

async function check() {
  try {
    const url = 'https://www.tiktok.com/@ai.cafe4';
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });

    const html = response.data;
    
    // Check for standard meta description
    const metaMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i);
    console.log("META:", metaMatch ? metaMatch[1] : "NOT FOUND");
    
    // Extract universal data script
    const universalDataMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" [^>]*>([\s\S]*?)<\/script>/);
    if (universalDataMatch) {
      console.log("Found __UNIVERSAL_DATA_FOR_REHYDRATION__");
      try {
        const data = JSON.parse(universalDataMatch[1]);
        const stats = data?.__DEFAULT_SCOPE__?.["webapp.user-detail"]?.userInfo?.stats;
        console.log("STATS:", stats);
      } catch (e) {
        console.log("Error parsing universe data");
      }
    }
  } catch (err) {
    console.error(err.message);
  }
}
check();
