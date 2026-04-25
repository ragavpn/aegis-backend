import { getSession } from '../db/neo4jClient.js';
import logger from '../utils/logger.js';

// Lookup map for entity normalization
const ENTITY_MAP = {
  "the russian federation": "Russia",
  "russian government": "Russia",
  "kremlin": "Russia",
  "moscow": "Russia",
  "the united states": "USA",
  "us": "USA",
  "united states": "USA",
  "washington": "USA",
  "us government": "USA",
  "people's republic of china": "China",
  "prc": "China",
  "beijing": "China",
  "uk": "United Kingdom",
  "great britain": "United Kingdom",
  "london": "United Kingdom"
};

export const normaliseEntities = (edges) => {
  return edges.map(edge => {
    let source = edge.source.trim().toLowerCase();
    let target = edge.target.trim().toLowerCase();

    // Map if exists in lookup, otherwise keep original but capitalized
    source = ENTITY_MAP[source] || edge.source.trim();
    target = ENTITY_MAP[target] || edge.target.trim();

    return {
      ...edge,
      source,
      target
    };
  });
};

export const storeEdges = async (edges, articleId) => {
  if (!edges || edges.length === 0) return;

  const normalisedEdges = normaliseEntities(edges);
  const session = getSession();

  try {
    for (const edge of normalisedEdges) {
      await session.run(`
        MERGE (a:Entity {name: $source})
        MERGE (b:Entity {name: $target})
        MERGE (a)-[r:RELATES {type: $relationship}]->(b)
        ON CREATE SET r.confidence = $confidence,
                      r.firstSeen = datetime(),
                      r.articleId = $articleId
        ON MATCH SET  r.lastSeen = datetime(),
                      r.count = coalesce(r.count, 1) + 1,
                      r.confidence = (r.confidence + $confidence) / 2.0
      `, { ...edge, articleId });
    }
    logger.info(`Stored ${normalisedEdges.length} edges in Neo4j for article ${articleId}`);
  } catch (error) {
    logger.error({ err: error }, 'Failed to store edges in Neo4j');
  } finally {
    await session.close();
  }
};

export const getGraphContext = async (entityNames) => {
  if (!entityNames || entityNames.length === 0) return "";
  
  const session = getSession();
  try {
    // Case-insensitive 2-hop retrieval
    const result = await session.run(`
      MATCH (n:Entity)-[r*1..2]-(m:Entity)
      WHERE toLower(n.name) IN $entityNames
      RETURN n.name AS source, [rel IN r | rel.type] AS relationships, m.name AS target
      LIMIT 20
    `, { entityNames: entityNames.map(e => e.toLowerCase()) });

    if (result.records.length === 0) return "No relevant graph context found.";

    let context = "Relevant graph context (causal chains):\n";
    result.records.forEach(record => {
      const source = record.get('source');
      const target = record.get('target');
      const rels = record.get('relationships').join(' -> ');
      context += `- ${source} -> ${rels} -> ${target}\n`;
    });
    
    return context;
  } catch (error) {
    logger.error({ err: error }, 'Failed to retrieve graph context');
    return "";
  } finally {
    await session.close();
  }
};
