import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import logger from '../utils/logger.js';

let genAI;

const getGenAI = () => {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is missing from environment variables");
    }
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
};

// Generates an article based on the latest Crucix sweep data
export const generateArticle = async (sweepData, graphContext = "") => {
  const ai = getGenAI();
  const model = ai.getGenerativeModel({
    model: "gemini-3.1-pro-preview",
    systemInstruction: "You are an expert geopolitical and financial analyst. You take raw intelligence signals and synthesize them into a single, cohesive, highly insightful article of 400-800 words. Explain what is happening, why it is happening (historical context), and what it might mean (implications). If graph context is provided, use those historical causal chains to enrich the article. Your output must be purely the article text."
  });

  const prompt = `
Raw Intelligence Data (JSON):
${JSON.stringify(sweepData)}

Historical Knowledge Graph Context:
${graphContext ? graphContext : "None available."}

Write the analyst report:
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    logger.error({ err: error }, 'Failed to generate article from Gemini');
    throw error;
  }
};

// Extracts up to 5 causal relationships (edges) from an article
export const extractEdges = async (articleText) => {
  const ai = getGenAI();
  const model = ai.getGenerativeModel({
    model: "gemini-3.1-pro-preview",
    systemInstruction: "You are a data extraction expert building a geopolitical knowledge graph. Extract up to 5 causal relationships from the provided article. Normalise entity names to be concise (e.g. 'Russia' instead of 'The Russian Federation'). Return exactly a JSON array of objects, with no markdown code blocks or other text.",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            source: { type: SchemaType.STRING, description: "Source entity name" },
            target: { type: SchemaType.STRING, description: "Target entity name" },
            relationship: {
              type: SchemaType.STRING,
              enum: ["caused", "correlated_with", "escalated", "preceded", "triggered", "de-escalated"],
              description: "The type of relationship"
            },
            confidence: { type: SchemaType.NUMBER, description: "Confidence score between 0.0 and 1.0" }
          },
          required: ["source", "target", "relationship", "confidence"]
        }
      }
    }
  });

  const prompt = `
Extract up to 5 edges from this article:

${articleText}
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    // Because responseMimeType is application/json, it should be valid JSON
    return JSON.parse(text);
  } catch (error) {
    logger.error({ err: error }, 'Failed to extract edges from Gemini');
    // We return an empty array so a failure in edge extraction doesn't crash the whole pipeline
    return [];
  }
};
