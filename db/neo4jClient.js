import neo4j from 'neo4j-driver';
import logger from '../utils/logger.js';

let driver;

export const initNeo4j = () => {
  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USERNAME;
  const password = process.env.NEO4J_PASSWORD;

  if (!uri || !user || !password) {
    logger.warn('Neo4j credentials not fully provided. Skipping Neo4j initialization.');
    return;
  }

  driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
};

export const verifyConnectivity = async () => {
  if (!driver) {
      logger.warn('Skipping Neo4j connectivity verification (no driver).');
      return;
  }
  try {
    const serverInfo = await driver.getServerInfo();
    logger.info('Neo4j connection verified');
  } catch (error) {
    logger.error(`Neo4j connection failed: ${error.message}`);
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
  }
};

export const getSession = () => {
  if (!driver) {
    throw new Error('Neo4j driver not initialized');
  }
  return driver.session();
};

export const closeNeo4j = async () => {
  if (driver) {
    await driver.close();
  }
};
