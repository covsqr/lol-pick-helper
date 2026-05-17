import { DEFAULT_TIER, REGION_KR, getMeta } from '../server.js';

export default async function handler(req, res) {
  try {
    const meta = await getMeta();
    res.setHeader('cache-control', 'no-store');
    res.status(200).json({
      ...meta,
      lanes: [
        { id: 0, key: 'top', label: '탑' },
        { id: 1, key: 'jungle', label: '정글' },
        { id: 2, key: 'mid', label: '미드' },
        { id: 3, key: 'adc', label: '원딜' },
        { id: 4, key: 'support', label: '서폿' }
      ],
      defaults: { region: REGION_KR, tier: DEFAULT_TIER }
    });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || 'Unexpected server error'
    });
  }
}
