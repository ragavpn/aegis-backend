import logger from '../utils/logger.js';

// ─── GitHub Models Fallback Chain ────────────────────────────────────────────
// These are curated high-quality models available on GitHub Marketplace.
// When a 429 rate-limit is hit on the primary model, the next one is tried.
const GITHUB_MODELS_FALLBACK_CHAIN = [
  'gpt-4o',
  'gpt-4o-mini',
  'o1-mini',
  'Meta-Llama-3.3-70B-Instruct',
  'Mistral-Large-2411',
  'Phi-4',
  'Cohere-command-r-plus-08-2024',
  'AI21-Jamba-1.5-Large',
  'Meta-Llama-3.1-405B-Instruct',
];

const GITHUB_MODELS_BASE_URL = 'https://models.inference.ai.azure.com/chat/completions';

const getBaseUrl = () => process.env.LLM_BASE_URL || GITHUB_MODELS_BASE_URL;
const getPrimaryModel = () => process.env.LLM_MODEL || 'gpt-4o';
const isGithubModels = () => getBaseUrl() === GITHUB_MODELS_BASE_URL;

const buildHeaders = () => {
  if (!process.env.LLM_API_KEY) {
    throw new Error('LLM_API_KEY is missing from environment variables');
  }
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.LLM_API_KEY}`,
    'HTTP-Referer': 'https://github.com/ragavpn/aegis-backend',
    'X-Title': 'Aegis Backend',
  };
};

// ─── Core LLM Caller with GitHub Models Rate-Limit Fallback ──────────────────
/**
 * Central function for all LLM calls.
 * - If using GitHub Models and a 429 is hit, automatically falls back through
 *   GITHUB_MODELS_FALLBACK_CHAIN until a model succeeds or all are exhausted.
 * - For all other providers, throws immediately on error.
 *
 * @param {Array} messages - OpenAI-style messages array
 * @param {Object} [extra={}] - Extra body params (e.g. response_format)
 * @returns {Promise<string>} - The model's text response content
 */
const callLLM = async (messages, extra = {}) => {
  const baseUrl = getBaseUrl();
  const headers = buildHeaders();
  const useGithubFallback = isGithubModels();

  // Build the ordered list of models to try
  const primaryModel = getPrimaryModel();
  let modelsToTry;

  if (useGithubFallback) {
    // Put primary model first, then the rest of the fallback chain (skipping duplicates)
    const chain = [primaryModel, ...GITHUB_MODELS_FALLBACK_CHAIN.filter(m => m !== primaryModel)];
    modelsToTry = chain;
  } else {
    modelsToTry = [primaryModel];
  }

  let lastError = null;

  for (const model of modelsToTry) {
    try {
      logger.info(`[LLM] Calling model: ${model}`);

      const res = await fetch(baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, ...extra }),
      });

      if (res.status === 429 && useGithubFallback) {
        const retryAfter = res.headers.get('retry-after') || '?';
        logger.warn(`[LLM] Rate limit hit on "${model}" (retry-after: ${retryAfter}s). Trying next model...`);
        lastError = new Error(`Rate limited on ${model}`);
        continue; // try next model
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`LLM API Error [${model}] (${res.status}): ${errText}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      logger.info(`[LLM] Response received from "${model}" (${content.length} chars)`);
      return content;

    } catch (err) {
      // Re-throw non-rate-limit errors immediately (network failures etc.)
      if (!err.message.startsWith('Rate limited on')) {
        throw err;
      }
      lastError = err;
    }
  }

  // All models exhausted
  throw new Error(`[LLM] All models exhausted after rate limiting. Last error: ${lastError?.message}`);
};

// ─── Exported Service Functions ───────────────────────────────────────────────

// Generates an article based on the latest Crucix sweep data
export const generateArticle = async (sweepData, graphContext = "") => {
  const systemInstruction = "You are an expert geopolitical and financial analyst. You take raw intelligence signals and synthesize them into a single, cohesive, highly insightful article of 400-800 words. Explain what is happening, why it is happening (historical context), and what it might mean (implications). If graph context is provided, use those historical causal chains to enrich the article. Your output must be purely the article text.";

  const prompt = `
Raw Intelligence Data (JSON):
${JSON.stringify(sweepData)}

Historical Knowledge Graph Context:
${graphContext ? graphContext : "None available."}

Write the analyst report:
  `;

  try {
    return await callLLM([
      { role: 'system', content: systemInstruction },
      { role: 'user', content: prompt },
    ]);
  } catch (error) {
    logger.error(`Failed to generate article: ${error.message}`);
    throw error;
  }
};

// Extracts up to 5 causal relationships (edges) from an article
export const extractEdges = async (articleText) => {
  const systemInstruction = "You are a data extraction expert building a geopolitical knowledge graph. Extract up to 5 causal relationships from the provided article. Normalise entity names to be concise (e.g. 'Russia' instead of 'The Russian Federation'). Return exactly a JSON array of objects, with no markdown code blocks or other text. Each object must have these exact keys: 'source' (string), 'target' (string), 'relationship' (string, one of: caused, correlated_with, escalated, preceded, triggered, de-escalated), and 'confidence' (number 0.0 to 1.0).";

  const prompt = `
Extract up to 5 edges from this article:

${articleText}
  `;

  try {
    let text = await callLLM(
      [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt },
      ],
      { response_format: { type: "json_object" } }
    );

    // Clean up potential markdown blocks
    text = text.trim();
    if (text.startsWith('```json')) text = text.substring(7);
    else if (text.startsWith('```')) text = text.substring(3);
    if (text.endsWith('```')) text = text.substring(0, text.length - 3);
    text = text.trim();

    let parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      const arrayVals = Object.values(parsed).filter(Array.isArray);
      parsed = arrayVals.length > 0 ? arrayVals[0] : [];
    }
    return parsed;
  } catch (error) {
    logger.error(`Failed to extract edges: ${error.message}`);
    return [];
  }
};

// Extracts up to 5 main entities from a user's conversational query
export const extractEntitiesFromQuery = async (query) => {
  const systemInstruction = "You are a precise entity extraction assistant. The user will ask a question about geopolitics or finance. Extract up to 5 key entities (countries, regions, commodities, companies, indices, organizations, people, or major topics) from their query. Return ONLY a raw JSON array of strings, nothing else. No markdown, no explanation. Example output: [\"Russia\", \"WTI Crude Oil\", \"OPEC\", \"Geopolitics\"]";

  try {
    let text = await callLLM([
      { role: 'system', content: systemInstruction },
      { role: 'user', content: query },
    ]);

    text = text.trim();
    if (text.startsWith('```json')) text = text.substring(7);
    else if (text.startsWith('```')) text = text.substring(3);
    if (text.endsWith('```')) text = text.substring(0, text.length - 3);
    text = text.trim();

    const arrayMatch = text.match(/\[[\s\S]*?\]/);
    if (arrayMatch) text = arrayMatch[0];

    let parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      const arrayVals = Object.values(parsed).filter(Array.isArray);
      parsed = arrayVals.length > 0 ? arrayVals[0] : [];
    }
    logger.info(`Extracted entities: ${JSON.stringify(parsed)}`);
    return parsed;
  } catch (error) {
    logger.error(`Failed to extract entities from query: ${error.message}`);
    return [];
  }
};

// Extracts up to 5 key entities from a generic text (like a sweep summary)
export const extractEntities = async (textInput) => {
  const systemInstruction = "You are an entity extraction assistant. Extract up to 5 key entities (countries, commodities, companies, indices, organizations, people) from the provided text. Return ONLY a raw JSON array of strings, nothing else. No markdown, no explanation. Example output: [\"USA\", \"Gold\", \"Federal Reserve\"]";

  try {
    let text = await callLLM([
      { role: 'system', content: systemInstruction },
      { role: 'user', content: textInput },
    ]);

    text = text.trim();
    if (text.startsWith('```json')) text = text.substring(7);
    else if (text.startsWith('```')) text = text.substring(3);
    if (text.endsWith('```')) text = text.substring(0, text.length - 3);
    text = text.trim();

    const arrayMatch = text.match(/\[[\s\S]*?\]/);
    if (arrayMatch) text = arrayMatch[0];

    let parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      const arrayVals = Object.values(parsed).filter(Array.isArray);
      parsed = arrayVals.length > 0 ? arrayVals[0] : [];
    }
    logger.info(`Extracted entities from text: ${JSON.stringify(parsed)}`);
    return parsed;
  } catch (error) {
    logger.error(`Failed to extract entities from text: ${error.message}`);
    return [];
  }
};

// Generates the final conversational response grounded in graph context / recent articles
export const chatWithRAG = async (messages, combinedContext = "") => {
  const hasContext = combinedContext && combinedContext.trim().length > 0;

  const systemInstruction = `You are Aegis, an elite geopolitical and financial intelligence analyst. You have access to a live intelligence database with real, recently generated reports.

${hasContext ? `You have been provided with the following intelligence context. You MUST use this as your primary source. Do NOT say you lack recent information — you have it below.

${combinedContext}

When answering, synthesize the above intelligence with your analytical expertise. Cite specific articles or causal chains from the context above when relevant.` : `Answer using your general geopolitical and financial expertise. Be analytical, concise, and actionable.`}`;

  try {
    return await callLLM([
      { role: 'system', content: systemInstruction },
      ...messages,
    ]);
  } catch (error) {
    logger.error(`Failed to generate RAG chat response: ${error.message}`);
    throw error;
  }
};

// Generates a two-person dialogue (JSON array) based on an article
export const generateDialogue = async (article, graphContext = "") => {
  const systemInstruction = `You are a podcast generator. Your task is to write a short 2-3 minute compelling dialogue between two hosts: "Alex" and "Jordan".
They are discussing a recent intelligence report.
Your output MUST be a valid JSON array of objects, with no markdown formatting.
Each object must have "speaker" (either "Alex" or "Jordan") and "text" (what they say).`;

  const prompt = `
Title: ${article.title}
Summary: ${article.summary}
Body: ${article.body}
Context: ${graphContext}

Write the dialogue as a raw JSON array.
`;

  try {
    let content = await callLLM([
      { role: 'system', content: systemInstruction },
      { role: 'user', content: prompt },
    ]);

    if (content.startsWith("```json")) {
      content = content.replace(/```json/g, "").replace(/```/g, "").trim();
    }
    return JSON.parse(content);
  } catch (error) {
    logger.error(`Failed to generate dialogue: ${error.message}`);
    throw error;
  }
};

// Generates a single-host monologue script based on an article
export const generateMonologueScript = async (article, durationScale = 'default', graphContext = "") => {
  let targetWords = 600;
  let scaleDesc = "standard-length";
  if (durationScale === 'short') {
    targetWords = 300;
    scaleDesc = "short, snappy";
  } else if (durationScale === 'long') {
    targetWords = 1200;
    scaleDesc = "long, deeply analytical";
  }

  const systemInstruction = `You are the solo host of the 'AEGIS Intelligence' podcast. You blend the precise, analytical rigor of an intelligence officer with the conversational, engaging style of a top-tier news anchor. Your job is to connect the dots across defense, finance, and geopolitics.
Your task is to write a highly engaging monologue script based on the provided intelligence report.
The script should be ${scaleDesc}, roughly around ${targetWords} words.
Speak directly to the listener ("Welcome back to AEGIS", "Let's dive into...", etc.). Make complex topics accessible but insightful. Build narrative tension, emphasize causality, and end with a forward-looking takeaway.
IMPORTANT: Do not include any sound effects, stage directions, host names, or markdown formatting (like **bold**). Output purely the spoken text intended for a text-to-speech engine.`;

  const prompt = `
Title: ${article.title}
Summary: ${article.summary}
Body: ${article.body}
Context: ${graphContext}

Write the podcast monologue script:
`;

  try {
    let content = await callLLM([
      { role: 'system', content: systemInstruction },
      { role: 'user', content: prompt },
    ]);

    // Strip any accidental markdown
    content = content.replace(/\*\*/g, "").replace(/\*/g, "").replace(/^#+\s/gm, "").trim();
    return content;
  } catch (error) {
    logger.error(`Failed to generate monologue script: ${error.message}`);
    throw error;
  }
};

// Generates a single-host daily digest script synthesising multiple articles from the last 24h
export const generateDailyDigestScript = async (articles) => {
  if (!articles || articles.length === 0) {
    throw new Error('No articles provided for daily digest.');
  }

  const articlesSummary = articles
    .map((a, i) => `${i + 1}. ${a.title}\n   ${a.summary || '(no summary)'}`)
    .join('\n\n');

  const systemInstruction = `You are the solo host of the 'AEGIS Intelligence' daily briefing podcast. You blend the precise, analytical rigor of an intelligence officer with the conversational energy of a top-tier news anchor. Your signature is connecting the dots — showing listeners how events in defense, finance, and geopolitics are intertwined.

Your task: Write a compelling, unified daily digest monologue script that synthesises the top stories of the last 24 hours. This should be approximately 700-900 words.

Structure it as:
- A punchy 2-3 sentence opening hook ("Welcome back to AEGIS. Here is what moved the world in the last 24 hours...")
- Cover each major story with analysis, then bridge them together ("And here is where it gets interesting — these two events are not unrelated...")
- Close with a sharp forward-looking takeaway ("Watch for...")

IMPORTANT: Output purely the spoken text for a text-to-speech engine. No markdown, no bold, no stage directions, no episode numbers.`;

  const prompt = `Here are today's top intelligence reports:\n\n${articlesSummary}\n\nWrite the daily briefing monologue:`;

  try {
    let content = await callLLM([
      { role: 'system', content: systemInstruction },
      { role: 'user', content: prompt },
    ]);

    content = content.replace(/\*\*/g, "").replace(/\*/g, "").replace(/^#+\s/gm, "").trim();
    return content;
  } catch (error) {
    logger.error(`Failed to generate daily digest script: ${error.message}`);
    throw error;
  }
};
