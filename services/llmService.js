import logger from '../utils/logger.js';

const getHeaders = () => {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is missing from environment variables");
  }
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'HTTP-Referer': 'https://github.com/ragavpn/aegis-backend',
    'X-Title': 'Aegis Backend',
  };
};

const getModel = () => {
  return process.env.LLM_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';
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
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
    logger.error({ err: error }, 'Failed to generate article from OpenRouter');
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
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
    logger.error({ err: error }, 'Failed to extract edges from OpenRouter');
    // We return an empty array so a failure in edge extraction doesn't crash the whole pipeline
    return [];
  }
};
