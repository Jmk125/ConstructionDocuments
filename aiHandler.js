const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { generateEmbedding } = require('./embeddings');

let openai = null;
let anthropic = null;

// Available models configuration
const MODELS = {
  'gpt-4o-mini': {
    provider: 'openai',
    name: 'GPT-4o Mini',
    description: 'Fast and efficient for simple questions',
    maxTokens: 2000,
    temperature: 0.7
  },
  'gpt-4o': {
    provider: 'openai',
    name: 'GPT-4o',
    description: 'Balanced performance for most questions',
    maxTokens: 2000,
    temperature: 0.7
  },
  'claude-opus-4.5': {
    provider: 'anthropic',
    name: 'Claude Opus 4.5',
    description: 'Superior reasoning for complex analysis',
    maxTokens: 4096,
    temperature: 0.3
  },
  'claude-sonnet-4': {
    provider: 'anthropic',
    name: 'Claude Sonnet 4',
    description: 'Excellent balance of speed and intelligence',
    maxTokens: 4096,
    temperature: 0.3
  }
};

function initAI(openaiKey, anthropicKey) {
  if (openaiKey) {
    openai = new OpenAI({ apiKey: openaiKey });
  }
  if (anthropicKey) {
    anthropic = new Anthropic({ apiKey: anthropicKey });
  }
}

/**
 * Enhanced system prompt with domain expertise
 */
function getEnhancedSystemPrompt(projectName, context) {
  return `You are an expert construction document analyst with deep knowledge of:

## Domain Expertise
- Building codes (IBC, IRC, NEC, UPC, IMC)
- Construction methods and sequencing
- Material properties and compatibilities
- Spatial relationships in floor plans
- MEP (Mechanical, Electrical, Plumbing) system interactions
- Structural load paths and engineering principles
- Constructability and coordination issues
- AIA standards and construction documentation practices

## Reasoning Approach
When analyzing construction documents:
1. **Synthesize** information across multiple document sources (drawings, specs, details)
2. **Infer** implicit requirements from industry standards and best practices
3. **Identify** conflicts, gaps, ambiguities, or coordination issues
4. **Explain** the "why" behind specifications and design decisions
5. **Consider** constructability, sequencing, and real-world implications
6. **Provide context** about how different building systems interact

## Response Quality Standards
- Provide engineering reasoning and technical insight, not just text retrieval
- Note assumptions and confidence levels when making inferences
- Identify when information requires professional engineering judgment
- Suggest follow-up questions for deeper understanding
- Flag potential issues or areas requiring clarification

## Project Context
You are analyzing documents for project: "${projectName}"

## Citation Requirements
When answering:
1. Be specific and cite your sources. For drawings with sheet numbers, use: [Source Name, Sheet X-###]
2. For specifications or documents without sheet numbers, use: [Source Name, Page X]
3. When referencing specific details, use: [Source Name, Detail #/Sheet]
4. If information is found in multiple locations, cite all relevant sources
5. If you cannot find information in the provided documents, say so clearly
6. For scope questions, be thorough and reference all relevant sections

## Formatting Guidelines
- Use **bold** for important terms, requirements, or key points
- Use bullet points (-) for lists of items, requirements, or findings
- Use numbered lists (1. 2. 3.) for sequential steps or prioritized items
- Use headers (##) to organize longer responses into sections
- Structure your responses for easy readability

## Available Document Context
${context}`;
}

/**
 * Multi-query expansion: Generate alternative phrasings to improve retrieval
 */
async function expandQuery(userQuery, model = 'gpt-4o-mini') {
  const prompt = `Given this construction question: "${userQuery}"

Generate 3 alternative phrasings that would help find relevant information in construction documents:
1. Technical/specification focused phrasing
2. Visual/drawing focused phrasing
3. Compliance/code/standards focused phrasing

Return ONLY a JSON array of the 3 alternative questions, nothing else.
Example format: ["question 1", "question 2", "question 3"]`;

  try {
    const response = await callLLM(
      [{ role: 'user', content: prompt }],
      model,
      { temperature: 0.5, maxTokens: 200 }
    );

    // Parse the JSON array from response
    const content = response.trim();
    const parsed = JSON.parse(content);

    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }

    // Fallback to original query if parsing fails
    return [userQuery];
  } catch (error) {
    console.error('Error expanding query:', error);
    return [userQuery]; // Fallback to original query
  }
}

/**
 * Query decomposition: Break complex questions into sub-questions
 */
async function decomposeQuery(userQuery, model = 'gpt-4o-mini') {
  const prompt = `Analyze this construction question and determine if it needs to be broken down into simpler sub-questions:

"${userQuery}"

If the question is simple and can be answered directly, return: {"simple": true, "subquestions": []}

If the question is complex and requires multiple steps or pieces of information, break it down into 2-4 sub-questions in logical dependency order.

Return ONLY a JSON object in this format:
{
  "simple": false,
  "subquestions": ["sub-question 1", "sub-question 2", ...]
}`;

  try {
    const response = await callLLM(
      [{ role: 'user', content: prompt }],
      model,
      { temperature: 0.3, maxTokens: 300 }
    );

    const parsed = JSON.parse(response.trim());

    if (parsed.simple || !parsed.subquestions || parsed.subquestions.length === 0) {
      return null; // Question doesn't need decomposition
    }

    return parsed.subquestions;
  } catch (error) {
    console.error('Error decomposing query:', error);
    return null; // Fallback to direct answering
  }
}

/**
 * Detect if a query is complex and requires advanced reasoning
 */
function isComplexQuery(query, relevantChunksCount) {
  const complexityIndicators = [
    /\b(why|how|explain|compare|difference|relationship|impact|affect)\b/i,
    /\b(multiple|several|various|all|entire|complete)\b/i,
    /\b(conflict|issue|problem|concern|coordination)\b/i,
    /\band\b.*\band\b/i, // Multiple conditions
    /\?.*\?/, // Multiple questions
  ];

  const isLongQuery = query.split(' ').length > 15;
  const hasComplexityIndicator = complexityIndicators.some(pattern => pattern.test(query));
  const hasManySources = relevantChunksCount > 10;

  return isLongQuery || hasComplexityIndicator || hasManySources;
}

/**
 * Call LLM with the appropriate provider
 */
async function callLLM(messages, model, options = {}) {
  const modelConfig = MODELS[model];

  if (!modelConfig) {
    throw new Error(`Unknown model: ${model}`);
  }

  const temperature = options.temperature ?? modelConfig.temperature;
  const maxTokens = options.maxTokens ?? modelConfig.maxTokens;

  if (modelConfig.provider === 'openai') {
    if (!openai) {
      throw new Error('OpenAI not initialized');
    }

    const completion = await openai.chat.completions.create({
      model: model,
      messages: messages,
      temperature: temperature,
      max_tokens: maxTokens
    });

    return completion.choices[0].message.content;
  } else if (modelConfig.provider === 'anthropic') {
    if (!anthropic) {
      throw new Error('Anthropic not initialized');
    }

    // Convert messages to Anthropic format
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const response = await anthropic.messages.create({
      model: model === 'claude-opus-4.5' ? 'claude-opus-4-20250514' : 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      temperature: temperature,
      system: systemMessage ? systemMessage.content : undefined,
      messages: conversationMessages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }))
    });

    return response.content[0].text;
  } else {
    throw new Error(`Unknown provider: ${modelConfig.provider}`);
  }
}

/**
 * Generate answer with chain-of-thought reasoning
 */
async function answerWithChainOfThought(question, context, chatHistory, projectName, model, useDecomposition = false) {
  const systemPrompt = getEnhancedSystemPrompt(projectName, context);

  // Build messages array
  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  // Add chat history (last 5 exchanges for context)
  const recentHistory = chatHistory.slice(-10); // Last 5 exchanges (user + assistant)
  for (const msg of recentHistory) {
    messages.push({
      role: msg.role,
      content: msg.content
    });
  }

  // For complex questions with Claude, use chain-of-thought
  const modelConfig = MODELS[model];
  const useCoT = modelConfig.provider === 'anthropic' && useDecomposition;

  if (useCoT) {
    // Add reasoning instruction
    const cotPrompt = `Question: ${question}

Think step-by-step before providing your final answer:

1. **Understanding**: What is being asked, both explicitly and implicitly?
2. **Information Gathering**: What relevant information is available in the context?
3. **Analysis**: What can be inferred from standards, practices, and relationships?
4. **Synthesis**: How do different pieces of information connect?
5. **Considerations**: What are potential issues, alternatives, or additional context?

Then provide your final answer with proper citations.`;

    messages.push({
      role: 'user',
      content: cotPrompt
    });
  } else {
    // Standard question
    messages.push({
      role: 'user',
      content: question
    });
  }

  // Call the LLM
  const response = await callLLM(messages, model);

  return response;
}

/**
 * Answer with query decomposition for complex questions
 */
async function answerWithDecomposition(subQuestions, searchFunction, projectId, chatHistory, projectName, model) {
  const subAnswers = [];

  console.log(`Decomposed into ${subQuestions.length} sub-questions`);

  // Answer each sub-question
  for (let i = 0; i < subQuestions.length; i++) {
    const subQ = subQuestions[i];
    console.log(`Answering sub-question ${i + 1}: ${subQ}`);

    // Search for relevant content for this sub-question
    const relevantContent = await searchFunction(projectId, subQ, 10);

    // Create context
    let context = '';
    if (relevantContent.chunks && relevantContent.chunks.length > 0) {
      const contextParts = relevantContent.chunks.map((chunk, idx) =>
        `[Source ${idx + 1}: ${chunk.filename}, ${chunk.sheet_number ? `Sheet ${chunk.sheet_number}` : `Page ${chunk.page_number}`}]\n${chunk.content}`
      );
      context = contextParts.join('\n\n---\n\n');
    }

    if (relevantContent.visualFindings && relevantContent.visualFindings.length > 0) {
      context += '\n\n' + relevantContent.visualFindings.map((finding, idx) =>
        `[Visual Finding ${idx + 1}]\n${finding.findings}`
      ).join('\n\n---\n\n');
    }

    // Answer this sub-question with context from previous answers
    const previousContext = subAnswers.map((sa, idx) =>
      `Sub-question ${idx + 1}: ${subQuestions[idx]}\nAnswer: ${sa}`
    ).join('\n\n');

    const enrichedContext = previousContext ?
      `${context}\n\n## Previous Sub-Answers:\n${previousContext}` :
      context;

    const answer = await answerWithChainOfThought(
      subQ,
      enrichedContext,
      chatHistory,
      projectName,
      model,
      false // Don't use CoT for sub-questions
    );

    subAnswers.push(answer);
  }

  // Synthesize final answer from sub-answers
  const synthesisPrompt = `Based on the following sub-questions and their answers, provide a comprehensive final answer that synthesizes all the information:

${subQuestions.map((q, i) => `**Sub-question ${i + 1}**: ${q}\n**Answer**: ${subAnswers[i]}`).join('\n\n---\n\n')}

Provide a well-organized, comprehensive answer that combines insights from all sub-answers. Maintain all citations from the sub-answers.`;

  const finalAnswer = await callLLM(
    [
      {
        role: 'system',
        content: `You are synthesizing multiple sub-answers into a comprehensive response. Maintain all citations and organize the information logically.`
      },
      { role: 'user', content: synthesisPrompt }
    ],
    model,
    { temperature: 0.3 }
  );

  return finalAnswer;
}

/**
 * Main function to generate an AI response with all enhancements
 */
async function generateResponse(question, searchFunction, projectId, chatHistory, projectName, model = 'gpt-4o', options = {}) {
  const {
    useMultiQuery = true,
    useQueryDecomposition = true,
    relevantContentLimit = 15
  } = options;

  console.log(`Using model: ${model} (${MODELS[model]?.name})`);

  // Step 1: Multi-query expansion for better retrieval
  let searchQueries = [question];
  if (useMultiQuery) {
    console.log('Expanding query with alternative phrasings...');
    const expandedQueries = await expandQuery(question, 'gpt-4o-mini');
    searchQueries = [question, ...expandedQueries];
    console.log(`Generated ${searchQueries.length} search variations`);
  }

  // Step 2: Search with all query variations and merge results
  const allResults = await Promise.all(
    searchQueries.map(q => searchFunction(projectId, q, Math.ceil(relevantContentLimit / searchQueries.length)))
  );

  // Merge and deduplicate results
  const mergedChunks = new Map();
  const mergedVisualFindings = new Map();

  for (const result of allResults) {
    if (result.chunks) {
      for (const chunk of result.chunks) {
        if (!mergedChunks.has(chunk.id)) {
          mergedChunks.set(chunk.id, chunk);
        }
      }
    }
    if (result.visualFindings) {
      for (const finding of result.visualFindings) {
        if (!mergedVisualFindings.has(finding.id)) {
          mergedVisualFindings.set(finding.id, finding);
        }
      }
    }
  }

  const relevantChunks = Array.from(mergedChunks.values()).slice(0, relevantContentLimit);
  const relevantVisualFindings = Array.from(mergedVisualFindings.values()).slice(0, 5);

  console.log(`Found ${relevantChunks.length} relevant chunks and ${relevantVisualFindings.length} visual findings`);

  // Step 3: Format context
  let context = '';
  if (relevantChunks.length > 0) {
    const contextParts = relevantChunks.map((chunk, idx) => {
      const location = chunk.sheet_number ? `Sheet ${chunk.sheet_number}` : `Page ${chunk.page_number}`;
      const header = `[Source ${idx + 1}: ${chunk.filename}, ${location}]`;

      let content = chunk.content;

      // Add OCR text if available
      if (chunk.ocr_text) {
        content += `\n\n[OCR Text]: ${chunk.ocr_text}`;
      }

      return `${header}\n${content}`;
    });
    context = contextParts.join('\n\n---\n\n');
  }

  if (relevantVisualFindings.length > 0) {
    const visualContext = relevantVisualFindings.map((finding, idx) => {
      const location = finding.sheet_number ? `Sheet ${finding.sheet_number}` : `Page ${finding.page_number}`;
      let findingsText = finding.findings;

      // Try to parse and format JSON findings
      try {
        const parsed = typeof finding.findings === 'string' ? JSON.parse(finding.findings) : finding.findings;
        if (parsed.summary) {
          findingsText = `Summary: ${parsed.summary}`;
          if (parsed.elements && parsed.elements.length > 0) {
            findingsText += `\nElements: ${parsed.elements.map(e => e.type).join(', ')}`;
          }
        }
      } catch (e) {
        // Use as-is if not JSON
      }

      return `[Visual Finding ${idx + 1}: ${finding.filename}, ${location}]\n${findingsText}`;
    }).join('\n\n---\n\n');

    context += '\n\n## Visual Analysis Findings\n' + visualContext;
  }

  // Step 4: Determine if query decomposition is needed
  const isComplex = useQueryDecomposition && isComplexQuery(question, relevantChunks.length);
  let shouldDecompose = false;
  let subQuestions = null;

  if (isComplex) {
    console.log('Detected complex query, attempting decomposition...');
    subQuestions = await decomposeQuery(question, 'gpt-4o-mini');
    shouldDecompose = subQuestions !== null && subQuestions.length > 1;
  }

  // Step 5: Generate response
  let response;
  if (shouldDecompose) {
    console.log('Using query decomposition approach');
    response = await answerWithDecomposition(
      subQuestions,
      searchFunction,
      projectId,
      chatHistory,
      projectName,
      model
    );
  } else {
    console.log('Using direct answering with chain-of-thought');
    response = await answerWithChainOfThought(
      question,
      context,
      chatHistory,
      projectName,
      model,
      isComplex // Use CoT reasoning for complex queries
    );
  }

  return response;
}

/**
 * Get list of available models
 */
function getAvailableModels() {
  return Object.keys(MODELS).map(key => ({
    id: key,
    ...MODELS[key]
  }));
}

module.exports = {
  initAI,
  generateResponse,
  getAvailableModels,
  MODELS
};
