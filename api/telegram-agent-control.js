// Telegram to GitHub command gateway. Requires deployment and environment secrets.
const REPO = 'DY-MALIS/idea2sale-ai-marketing-';
async function send(chat, text) {
  const url = 'https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/sendMessage';
  await fetch(url, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chat,text})});
}
async function github(path, method='GET', body) {
  const response = await fetch('https://api.github.com/repos/' + REPO + path, {
    method, headers:{Authorization:'Bearer ' + process.env.GITHUB_CONTROL_TOKEN,Accept:'application/vnd.github+json','content-type':'application/json'},
    body:body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw new Error('GitHub status ' + response.status);
  return response.json();
}
export default async function handler(req,res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || req.headers['x-telegram-bot-api-secret-token'] !== process.env.TELEGRAM_WEBHOOK_SECRET) return res.status(403).end();
  const message=req.body?.message;
  const chat=String(message?.chat?.id || '');
  if (!chat || chat !== String(process.env.TELEGRAM_CHAT_ID || '')) return res.status(200).json({ok:true});
  const input=String(message?.text || '').trim();
  try {
    if (/^(\/status|ស្ថានភាព)/i.test(input)) {
      const issues=await github('/issues?state=open&labels=agent-task&per_page=10');
      await send(chat,'Agent queue: '+(issues.map(x=>'#'+x.number+' '+x.title).join('; ') || 'empty'));
    } else if (/^(\/inspect|ពិនិត្យ)/i.test(input)) {
      const hours=/24|២៤/.test(input)?24:12;
      const issue=await github('/issues','POST',{title:'Telegram inspection request',body:'Inspection only. No code changes until explicit approval.\nRequest: '+input.slice(0,1500),labels:['agent-inspect',hours===24?'agent-24h':'agent-12h']});
      await send(chat,'បានទទួលសំណើពិនិត្យ #'+issue.number+'\n'+issue.html_url+'\nរង់ចាំ Inspector Runner។');
    } else {
      await send(chat,'បញ្ជាដែលអាចប្រើ៖ /status ឬ ស្ថានភាព, /inspect ឬ ពិនិត្យ App 12/24 ម៉ោង។ មុខងារ Approve ត្រូវការការផ្ទៀងផ្ទាត់បន្ថែម។');
    }
    return res.status(200).json({ok:true});
  } catch(e) {
    console.error('Gateway error',e.message);
    return res.status(500).json({error:'Gateway error'});
  }
}
