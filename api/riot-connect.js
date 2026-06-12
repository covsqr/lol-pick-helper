import { analyzeRiotMatchIds, getRiotMatchSeed } from '../lib/riot.js';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readBody(req);
    const data = Array.isArray(body.matchIds)
      ? await analyzeRiotMatchIds({
          puuid: body.puuid,
          platform: body.platform || 'kr',
          matchIds: body.matchIds
        })
      : await getRiotMatchSeed({
          gameName: body.gameName,
          tagLine: body.tagLine,
          platform: body.platform || 'kr',
          count: body.count || 30
        });
    res.setHeader('cache-control', 'no-store');
    res.status(200).json(data);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || 'Unexpected server error'
    });
  }
}
