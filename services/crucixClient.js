import logger from '../utils/logger.js';

const getBaseUrl = () => process.env.CRUCIX_BASE_URL;
const getSecret = () => process.env.CRUCIX_SECRET;

export const getCrucixLatest = async () => {
  const res = await fetch(`${getBaseUrl()}/api/aegis/latest`, {
    headers: {
      'X-Aegis-Secret': getSecret()
    }
  });
  if (!res.ok) {
    throw new Error(`Crucix latest failed: ${res.statusText}`);
  }
  return res.json();
};

export const getCrucixHealth = async () => {
  const res = await fetch(`${getBaseUrl()}/api/aegis/health`, {
    headers: {
      'X-Aegis-Secret': getSecret()
    }
  });
  if (!res.ok) {
    throw new Error(`Crucix health failed: ${res.statusText}`);
  }
  return res.json();
};
