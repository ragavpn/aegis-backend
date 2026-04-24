import dotenv from 'dotenv';
dotenv.config();

const requiredEnvVars = [
  'PORT',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'NEO4J_URI',
  'NEO4J_USERNAME',
  'NEO4J_PASSWORD',
  'CRUCIX_BASE_URL',
  'CRUCIX_SECRET'
];

export const validateEnv = () => {
  const missing = requiredEnvVars.filter((envVar) => !process.env[envVar]);
  if (missing.length > 0) {
    // For local development, we might not have all env vars yet.
    // We log a warning instead of crashing if NODE_ENV !== 'production'
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    } else {
      console.warn(`[WARNING] Missing required environment variables: ${missing.join(', ')}`);
    }
  }
};
