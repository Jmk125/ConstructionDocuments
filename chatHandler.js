const OpenAI = require('openai');
const { runQuery, getQuery, getOneQuery } = require('./database');
const { searchRelevantChunks, searchRelevantContent, formatChunksForContext } = require('./embeddings');
const { initAI, generateResponse, getAvailableModels } = require('./aiHandler');

let openai = null;

function initOpenAI(apiKey, anthropicKey) {
  openai = new OpenAI({ apiKey });
  // Initialize the AI handler with both API keys
  initAI(apiKey, anthropicKey);
}

/**
 * Create a new chat
 */
function createChat(projectId, title = 'New Chat') {
  runQuery(
    'INSERT INTO chats (project_id, title, created_at, updated_at) VALUES (?, ?, datetime("now"), datetime("now"))',
    [projectId, title]
  );
  
  // Get the last inserted chat
  const chats = getQuery('SELECT * FROM chats ORDER BY id DESC LIMIT 1');
  return chats[0] ? chats[0].id : null;
}

/**
 * Get chat history
 */
function getChatHistory(chatId) {
  return getQuery(
    'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC',
    [chatId]
  );
}

/**
 * Add message to chat
 */
function addMessage(chatId, role, content, citations = null) {
  runQuery(
    'INSERT INTO messages (chat_id, role, content, citations, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
    [chatId, role, content, citations ? JSON.stringify(citations) : null]
  );
  
  // Update chat's updated_at timestamp
  runQuery('UPDATE chats SET updated_at = datetime("now") WHERE id = ?', [chatId]);
}

/**
 * Resolve sheet numbers to page numbers for PDF navigation
 */
function resolveSheetNumbers(citations, projectId) {
  return citations.map(citation => {
    // If already has page number or no sheet number, return as is
    if (citation.page || !citation.sheet) {
      return citation;
    }

    // Look up the page number for this sheet number
    const result = getOneQuery(`
      SELECT c.page_number, d.filename
      FROM chunks c
      JOIN documents d ON c.document_id = d.id
      WHERE d.project_id = ?
        AND c.sheet_number = ?
        AND d.filename = ?
      LIMIT 1
    `, [projectId, citation.sheet, citation.source]);

    if (result) {
      return {
        ...citation,
        page: result.page_number,
        filename: result.filename
      };
    }

    // If no exact match found, try to find by filename only
    const fallback = getOneQuery(`
      SELECT c.page_number, c.sheet_number, d.filename
      FROM chunks c
      JOIN documents d ON c.document_id = d.id
      WHERE d.project_id = ?
        AND d.filename = ?
      LIMIT 1
    `, [projectId, citation.source]);

    if (fallback) {
      return {
        ...citation,
        page: fallback.page_number,
        filename: fallback.filename
      };
    }

    // Return citation even if we couldn't resolve (will show error to user)
    return citation;
  });
}

function collectRelatedSheetsFromCallouts(projectId, chunks) {
  const sheetNumbers = new Set(
    chunks.map(chunk => chunk.sheet_number).filter(Boolean)
  );
  const documentIds = Array.from(new Set(chunks.map(chunk => chunk.document_id)));

  if (sheetNumbers.size === 0 || documentIds.length === 0) {
    return [];
  }

  const params = [...documentIds, ...sheetNumbers, ...sheetNumbers];
  const calloutRows = getQuery(
    `
    SELECT sheet_number, target_sheet
    FROM callouts
    WHERE document_id IN (${documentIds.map(() => '?').join(', ')})
      AND (
        sheet_number IN (${Array.from(sheetNumbers).map(() => '?').join(', ')})
        OR target_sheet IN (${Array.from(sheetNumbers).map(() => '?').join(', ')})
      )
    `,
    params
  );

  const relatedSheets = new Set();
  for (const row of calloutRows) {
    if (row.sheet_number) {
      relatedSheets.add(row.sheet_number);
    }
    if (row.target_sheet) {
      relatedSheets.add(row.target_sheet);
    }
  }

  return Array.from(relatedSheets);
}

function expandChunksWithCallouts(chunks, projectId, maxAdditional = 6) {
  const chunkIds = new Set(chunks.map(chunk => chunk.id));
  const relatedSheets = new Set(collectRelatedSheetsFromCallouts(projectId, chunks));

  if (relatedSheets.size === 0) {
    return chunks;
  }

  const additionalChunks = getQuery(
    `
    SELECT c.*, d.filename, d.type
    FROM chunks c
    JOIN documents d ON c.document_id = d.id
    WHERE d.project_id = ?
      AND c.sheet_number IN (${Array.from(relatedSheets).map(() => '?').join(', ')})
    ORDER BY c.page_number ASC
    LIMIT ?
    `,
    [projectId, ...Array.from(relatedSheets), maxAdditional]
  ).filter(chunk => !chunkIds.has(chunk.id));

  return [...chunks, ...additionalChunks];
}

function formatVisualFindings(projectId, chunks) {
  const pageKeys = chunks.map(chunk => `${chunk.document_id}:${chunk.page_number}`);
  if (pageKeys.length === 0) {
    return '';
  }

  const findings = getQuery(
    `
    SELECT vf.*, d.filename
    FROM visual_findings vf
    JOIN documents d ON vf.document_id = d.id
    WHERE d.project_id = ?
      AND (vf.document_id || ':' || vf.page_number) IN (${pageKeys.map(() => '?').join(', ')})
    `,
    [projectId, ...pageKeys]
  );

  if (findings.length === 0) {
    return '';
  }

  const formatted = findings.map(finding => {
    const location = finding.sheet_number
      ? `Sheet ${finding.sheet_number}`
      : `Page ${finding.page_number}`;
    return `- ${finding.filename}, ${location}: ${finding.findings}`;
  }).join('\n');

  return `\n\n[Visual Findings]\n${formatted}`;
}

/**
 * Format visual findings that came from semantic search
 */
function formatVisualFindingsFromSearch(visualFindings) {
  if (visualFindings.length === 0) {
    return '';
  }

  const formatted = visualFindings.map((finding, index) => {
    const location = finding.sheet_number
      ? `Sheet ${finding.sheet_number}`
      : `Page ${finding.page_number}`;

    let findingsText = '';
    try {
      const parsed = typeof finding.findings === 'string'
        ? JSON.parse(finding.findings)
        : finding.findings;

      findingsText = parsed.summary || '';

      // Add elements if present
      if (parsed.elements && parsed.elements.length > 0) {
        const elementsSummary = parsed.elements
          .map(el => `${el.type}${el.dimensions ? ` (${el.dimensions})` : ''}`)
          .slice(0, 5)  // Limit to first 5 elements
          .join(', ');
        findingsText += `. Elements: ${elementsSummary}`;
      }

      // Add annotations if present
      if (parsed.annotations && parsed.annotations.length > 0) {
        const annotationsSummary = parsed.annotations.slice(0, 3).join('; ');
        findingsText += `. Annotations: ${annotationsSummary}`;
      }
    } catch (e) {
      findingsText = typeof finding.findings === 'string' ? finding.findings : '';
    }

    return `[Visual Finding ${index + 1}: ${finding.filename}, ${location}${finding.sheet_type ? ` (${finding.sheet_type})` : ''}]\n${findingsText}`;
  }).join('\n\n---\n\n');

  return `[Visual Analysis Findings]\n${formatted}`;
}

/**
 * Extract citations from GPT response
 * Formats:
 * - Sheet-based: [Drawing A-101, Sheet A-101] or [Drawing A-101, Sheet S-3.1]
 * - Page-based (fallback): [Section 09 90 00, Page 5]
 * - Detail-based: [Drawing A-101, Detail 3/A-101]
 */
function extractCitations(content) {
  const citations = [];

  // Pattern 1: Sheet number citations [filename, Sheet X-###]
  const sheetRegex = /\[([^\]]+?),\s*Sheet\s+([A-Z]{1,3}-\d+(?:\.\d+)?)\]/gi;
  let match;

  while ((match = sheetRegex.exec(content)) !== null) {
    citations.push({
      source: match[1].trim(),
      sheet: match[2].trim(),
      page: null, // Will be resolved later
      fullText: match[0]
    });
  }

  // Pattern 2: Detail references [filename, Detail #/X-###]
  const detailRegex = /\[([^\]]+?),\s*Detail\s+(\d+\/[A-Z]{1,3}-\d+(?:\.\d+)?)\]/gi;
  while ((match = detailRegex.exec(content)) !== null) {
    const detailRef = match[2].trim();
    const sheetMatch = detailRef.match(/\/([A-Z]{1,3}-\d+(?:\.\d+)?)/);

    citations.push({
      source: match[1].trim(),
      sheet: sheetMatch ? sheetMatch[1] : null,
      detail: detailRef,
      page: null,
      fullText: match[0]
    });
  }

  // Pattern 3: Fallback to page numbers [filename, Page #]
  const pageRegex = /\[([^\]]+?),\s*Page\s+(\d+)\]/gi;
  while ((match = pageRegex.exec(content)) !== null) {
    // Only add if not already captured as sheet citation
    const alreadyAdded = citations.some(c => c.fullText === match[0]);
    if (!alreadyAdded) {
      citations.push({
        source: match[1].trim(),
        page: parseInt(match[2]),
        sheet: null,
        fullText: match[0]
      });
    }
  }

  return citations;
}

/**
 * Enhanced search function that returns structured data for AI handler
 */
async function searchForAI(projectId, query, limit = 15) {
  const relevantContent = await searchRelevantContent(projectId, query, limit);

  // Separate chunks from visual findings
  const chunks = relevantContent
    .filter(item => item.source_type === 'chunk')
    .map(item => item);

  const visualFindings = relevantContent
    .filter(item => item.source_type === 'visual_finding')
    .map(item => item);

  // Expand chunks with callouts
  const expandedChunks = expandChunksWithCallouts(chunks, projectId);

  return {
    chunks: expandedChunks,
    visualFindings: visualFindings
  };
}

/**
 * Send message and get response
 */
async function sendMessage(chatId, userMessage, selectedModel = 'gpt-4o') {
  if (!openai) {
    throw new Error('OpenAI not initialized');
  }

  // Get chat and project info
  const chats = getQuery('SELECT * FROM chats WHERE id = ?', [chatId]);
  const chat = chats[0];
  if (!chat) {
    throw new Error('Chat not found');
  }

  const projects = getQuery('SELECT * FROM projects WHERE id = ?', [chat.project_id]);
  const project = projects[0];
  if (!project) {
    throw new Error('Project not found');
  }

  // Add user message to database
  addMessage(chatId, 'user', userMessage);

  // Search for relevant content (both chunks and visual findings)
  console.log('Searching for relevant document content (text + vision)...');
  const searchResults = await searchForAI(chat.project_id, userMessage, 15);

  if (searchResults.chunks.length === 0 && searchResults.visualFindings.length === 0) {
    const noDocsMessage = "I don't have any processed documents for this project yet. Please upload and process documents first.";
    addMessage(chatId, 'assistant', noDocsMessage);
    return {
      role: 'assistant',
      content: noDocsMessage,
      citations: []
    };
  }

  // Get chat history for context (excluding current user message)
  const history = getChatHistory(chatId).slice(0, -1);

  console.log(`Generating response using ${selectedModel}...`);

  // Use the new AI handler with all enhancements
  const assistantMessage = await generateResponse(
    userMessage,
    searchForAI,
    chat.project_id,
    history,
    project.name,
    selectedModel,
    {
      useMultiQuery: true,
      useQueryDecomposition: true,
      relevantContentLimit: 15
    }
  );

  // Extract citations
  let citations = extractCitations(assistantMessage);

  // Resolve sheet numbers to page numbers for PDF navigation
  citations = resolveSheetNumbers(citations, chat.project_id);

  // Add assistant message to database
  addMessage(chatId, 'assistant', assistantMessage, citations);

  // Auto-generate chat title if this is the first exchange
  if (history.length === 1) {
    const titlePrompt = `Generate a brief, descriptive title (5-7 words max) for a conversation that starts with this question: "${userMessage}". Just return the title, nothing else.`;
    
    try {
      const titleCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: titlePrompt }],
        max_tokens: 20
      });
      
      const title = titleCompletion.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
      runQuery('UPDATE chats SET title = ? WHERE id = ?', [title, chatId]);
    } catch (error) {
      console.error('Error generating chat title:', error);
    }
  }

  return {
    role: 'assistant',
    content: assistantMessage,
    citations: citations
  };
}

/**
 * Delete old chats based on retention policy
 */
function deleteOldChats(retentionDays) {
  const result = runQuery(`
    DELETE FROM chats 
    WHERE datetime(updated_at) < datetime('now', '-' || ? || ' days')
  `, [retentionDays]);
  
  return result;
}

module.exports = {
  initOpenAI,
  createChat,
  getChatHistory,
  sendMessage,
  deleteOldChats,
  getAvailableModels
};
