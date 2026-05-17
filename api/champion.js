import { getChampionData } from '../server.js';

export default async function handler(req, res) {
  try {
    const data = await getChampionData({
      champion: req.query.champion || req.query.id,
      lane: req.query.lane,
      region: req.query.region,
      tier: req.query.tier,
      version: req.query.version || 'latest'
    });
    res.setHeader('cache-control', 'no-store');
    res.status(200).json(data);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || 'Unexpected server error'
    });
  }
}
