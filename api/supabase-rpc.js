import { callSupabaseRpc } from '../lib/supabase-rpc.js';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ data: null, error: { message: 'Method not allowed' } });
    return;
  }

  try {
    const body = await readBody(req);
    const result = await callSupabaseRpc(body.fn, body.params || {});
    res.setHeader('cache-control', 'no-store');
    res.status(200).json(result);
  } catch (error) {
    res.status(200).json({
      data: null,
      error: {
        message: error.message || 'Unexpected Supabase RPC error'
      }
    });
  }
}
