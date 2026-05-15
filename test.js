const axios = require('axios');

async function test() {
  try {
    const response = await axios.get("https://www.tiktok.com/@ai.cafe4", {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    const html = response.data;
    const metaDescription = html.match(/<meta name="description" content="([^"]+)"/)?.[1] || "";
    console.log(metaDescription);
  } catch (error) {
    console.error(error);
  }
}

test();
