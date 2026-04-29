import logger from '../utils/logger.js';

const getHeaders = () => {
  if (!process.env.LLM_API_KEY) {
    throw new Error("LLM_API_KEY is missing from environment variables");
  }
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.LLM_API_KEY}`,
    'HTTP-Referer': 'https://github.com/ragavpn/aegis-backend',
    'X-Title': 'Aegis Backend',
  };
};

const getBaseUrl = () => {
  return process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1/chat/completions';
};

const getModel = () => {
  return process.env.LLM_MODEL || 'google/gemma-3-27b-it:free';
};

// Generates an article based on the latest Crucix sweep data
export const generateArticle = async (sweepData, graphContext = "") => {
  const model = getModel();
  const systemInstruction = "You are an expert geopolitical and financial analyst. You take raw intelligence signals and synthesize them into a single, cohesive, highly insightful article of 400-800 words. Explain what is happening, why it is happening (historical context), and what it might mean (implications). If graph context is provided, use those historical causal chains to enrich the article. Your output must be purely the article text.";
  
  const prompt = `
Raw Intelligence Data (JSON):
${JSON.stringify(sweepData)}

Historical Knowledge Graph Context:
${graphContext ? graphContext : "None available."}

Write the analyst report:
  `;

  try {
    const res = await fetch(getBaseUrl(), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenRouter API Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (error) {
    logger.error(`Failed to generate article from OpenRouter: ${error.message}`);
    throw error;
  }
};

// Extracts up to 5 causal relationships (edges) from an article
export const extractEdges = async (articleText) => {
  const model = getModel();
  const systemInstruction = "You are a data extraction expert building a geopolitical knowledge graph. Extract up to 5 causal relationships from the provided article. Normalise entity names to be concise (e.g. 'Russia' instead of 'The Russian Federation'). Return exactly a JSON array of objects, with no markdown code blocks or other text. Each object must have these exact keys: 'source' (string), 'target' (string), 'relationship' (string, one of: caused, correlated_with, escalated, preceded, triggered, de-escalated), and 'confidence' (number 0.0 to 1.0).";

  const prompt = `
Extract up to 5 edges from this article:

${articleText}
  `;

  try {
    const res = await fetch(getBaseUrl(), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt }
        ],
        response_format: { type: "json_object" } // Tell the model to output JSON (not all OpenRouter models fully enforce this, but it helps)
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenRouter API Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    let text = data.choices?.[0]?.message?.content || '';
    
    // Clean up potential markdown blocks if the model ignored the system prompt
    text = text.trim();
    if (text.startsWith('\`\`\`json')) {
      text = text.substring(7);
    } else if (text.startsWith('\`\`\`')) {
      text = text.substring(3);
    }
    if (text.endsWith('\`\`\`')) {
      text = text.substring(0, text.length - 3);
    }
    
    text = text.trim();
    
    // Fallback: If OpenRouter wraps the array in an object (due to json_object enforcing an object return for some providers),
    // we should try to extract the array.
    let parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      // Find the first array value in the object
      const arrayVals = Object.values(parsed).filter(Array.isArray);
      if (arrayVals.length > 0) {
        parsed = arrayVals[0];
      } else {
        parsed = [];
      }
    }

    return parsed;
  } catch (error) {
    logger.error(`Failed to extract edges from OpenRouter: ${error.message}`);
    // We return an empty array so a failure in edge extraction doesn't crash the whole pipeline
    return [];
  }
};

// Extracts up to 5 main entities from a user's conversational query to look up in Neo4j
export const extractEntitiesFromQuery = async (query) => {
  const model = getModel();
  const systemInstruction = "You are a precise entity extraction assistant. The user will ask a question about geopolitics or finance. Extract up to 5 key entities (countries, regions, commodities, companies, indices, organizations, people, or major topics) from their query. Return ONLY a raw JSON array of strings, nothing else. No markdown, no explanation. Example output: [\"Russia\", \"WTI Crude Oil\", \"OPEC\", \"Geopolitics\"]";

  try {
    const res = await fetch(getBaseUrl(), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: query }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenRouter API Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    let text = data.choices?.[0]?.message?.content || '[]';
    
    // Clean markdown
    text = text.trim();
    if (text.startsWith('```json')) text = text.substring(7);
    else if (text.startsWith('```')) text = text.substring(3);
    if (text.endsWith('```')) text = text.substring(0, text.length - 3);
    text = text.trim();
    
    // Extract first JSON array found anywhere in the text (handles cases where model adds explanation)
    const arrayMatch = text.match(/\[[\s\S]*?\]/);
    if (arrayMatch) {
      text = arrayMatch[0];
    }

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
  const model = getModel();
  const systemInstruction = "You are an entity extraction assistant. Extract up to 5 key entities (countries, commodities, companies, indices, organizations, people) from the provided text. Return ONLY a raw JSON array of strings, nothing else. No markdown, no explanation. Example output: [\"USA\", \"Gold\", \"Federal Reserve\"]";

  try {
    const res = await fetch(getBaseUrl(), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: textInput }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenRouter API Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    let text = data.choices?.[0]?.message?.content || '[]';
    
    // Clean markdown
    text = text.trim();
    if (text.startsWith('```json')) text = text.substring(7);
    else if (text.startsWith('```')) text = text.substring(3);
    if (text.endsWith('```')) text = text.substring(0, text.length - 3);
    text = text.trim();
    
    // Extract first JSON array found anywhere in the text
    const arrayMatch = text.match(/\[[\s\S]*?\]/);
    if (arrayMatch) {
      text = arrayMatch[0];
    }

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

// Generates the final conversational response heavily grounded in Neo4j graph context or recent articles
export const chatWithRAG = async (messages, combinedContext = "") => {
  const model = getModel();
  
  const hasContext = combinedContext && combinedContext.trim().length > 0;

  const systemInstruction = `You are Aegis, an elite geopolitical and financial intelligence analyst. You have access to a live intelligence database with real, recently generated reports.

${hasContext ? `You have been provided with the following intelligence context. You MUST use this as your primary source. Do NOT say you lack recent information — you have it below.

${combinedContext}

When answering, synthesize the above intelligence with your analytical expertise. Cite specific articles or causal chains from the context above when relevant.` : `Answer using your general geopolitical and financial expertise. Be analytical, concise, and actionable.`}`;

  try {
    const apiMessages = [
      { role: 'system', content: systemInstruction },
      ...messages
    ];

    const res = await fetch(getBaseUrl(), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        model,
        messages: apiMessages
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenRouter API Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (error) {
    logger.error(`Failed to generate RAG chat response: ${error.message}`);
    throw error;
  }
};

// Generates a two-person dialogue (JSON array) based on an article
export const generateDialogue = async (article, graphContext = "") => {
  const model = getModel();
  
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
    const res = await fetch(getBaseUrl(), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenRouter API Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    let content = data.choices?.[0]?.message?.content || '[]';
    // Clean up potential markdown formatting around JSON
    if (content.startsWith("\`\`\`json")) {
      content = content.replace(/\`\`\`json/g, "").replace(/\`\`\`/g, "").trim();
    }
    return JSON.parse(content);
  } catch (error) {
    logger.error(`Failed to generate dialogue: ${error.message}`);
    throw error;
  }
};

// Generates a single-host monologue script based on an article
export const generateMonologueScript = async (article, durationScale = 'default', graphContext = "") => {
  const model = getModel();
  
  let targetWords = 600; // ~4 mins
  let scaleDesc = "standard-length";
  if (durationScale === 'short') {
    targetWords = 300; // ~2 mins
    scaleDesc = "short, snappy";
  } else if (durationScale === 'long') {
    targetWords = 1200; // ~8 mins
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
    const res = await fetch(getBaseUrl(), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenRouter API Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    let content = data.choices?.[0]?.message?.content || '';
    
    // Ensure no markdown formatting
    content = content.replace(/\\*\\*/g, "").replace(/\\*/g, "").replace(/#/g, "").trim();
    
    return content;
  } catch (error) {
    logger.error(`Failed to generate monologue script: ${error.message}`);
    throw error;
  }
};
