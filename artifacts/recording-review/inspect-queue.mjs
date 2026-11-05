import 'dotenv/config';
import { Client } from '@upstash/qstash';

const client = new Client({ token: process.env.QSTASH_TOKEN, baseUrl: process.env.QSTASH_URL });
const ids = ['naFOyd2KeoUSPVaZIpa6', '5HLgeDzOMGw0riXZiiyL', 'vHQy49Jd9SZgBKd662An'];
const result = await client.logs({ count: 100 });
console.log(JSON.stringify({ count: result.logs.length, recent: result.logs.slice(0, 8).map(log => ({
  at: new Date(log.time).toISOString(), state: log.state,
  action: new URL(log.url).searchParams.get('action') || 'telegramDeliver',
  hasBody: Boolean(log.body),
  next: log.nextDeliveryTime ? new Date(log.nextDeliveryTime).toISOString() : null,
})) }));
for (const log of result.logs) {
  if (!ids.some(id => log.body?.includes(id))) continue;
  console.log(JSON.stringify({
    at: new Date(log.time).toISOString(), state: log.state,
    action: new URL(log.url).searchParams.get('action') || 'telegramDeliver',
    next: log.nextDeliveryTime ? new Date(log.nextDeliveryTime).toISOString() : null,
    error: log.error || null,
  }));
}
