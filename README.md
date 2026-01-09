# Construction AI

An intelligent document analysis tool for construction projects. Upload construction drawings and specifications, then ask questions and get AI-powered answers with citations to specific documents and pages.

## Features

- **Project Management**: Create and manage multiple construction projects
- **Document Upload**: Upload PDF drawings and specifications
- **Intelligent Processing**: Automatic text extraction and embedding generation
- **Multi-Model AI Support**: Choose between GPT-4o, GPT-4o Mini, Claude Opus 4.5, and Claude Sonnet 4
- **Advanced Reasoning**: Multi-query expansion, query decomposition, and chain-of-thought reasoning
- **Domain Expertise**: Enhanced prompts with construction industry knowledge
- **AI-Powered Chat**: Ask questions about your documents and get detailed answers
- **Citation Support**: Responses include citations to specific documents and pages
- **Chat History**: Maintain conversation history with automatic cleanup
- **Local Hosting**: Run on your laptop or Raspberry Pi

## Prerequisites

- Node.js (v16 or higher)
- OpenAI API key (required)
- Anthropic API key (optional, for Claude models)

## Installation

1. Clone or download this repository

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```bash
cp .env.example .env
```

4. Edit the `.env` file and add your API keys:
```
# Required
OPENAI_API_KEY=your_openai_api_key_here

# Optional - for Claude models (Opus 4.5, Sonnet 4)
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Optional configuration
PORT=3000
CHAT_RETENTION_DAYS=30
VISION_MODEL=gpt-4o-mini
```

## Usage

1. Start the server:
```bash
npm start
```

2. Open your browser and navigate to:
```
http://localhost:3000
```

3. Create a new project

4. Upload your construction documents:
   - Specifications (PDFs)
   - Drawings (PDFs)

5. Click "Process Documents" to analyze them (this may take a few minutes)

6. Create a new chat, select your preferred AI model, and start asking questions!

## How It Works

### Document Processing

1. **Text Extraction**: PDFs are parsed to extract text content page by page
2. **Chunking**: Documents are split into manageable chunks (by page/sheet)
3. **Embedding Generation**: Each chunk is converted to a vector embedding using OpenAI's `text-embedding-3-small` model
4. **Storage**: Embeddings are stored in a local SQLite database

### Question Answering (Enhanced)

1. **Multi-Query Expansion**: Your question is automatically rephrased 3 ways (technical, visual, compliance-focused) to improve retrieval
2. **Query Decomposition**: Complex questions are broken down into simpler sub-questions
3. **Enhanced Semantic Search**: Multiple query variations find the most relevant document chunks using cosine similarity
4. **Context Building**: Relevant chunks are assembled with visual findings and OCR text
5. **Chain-of-Thought Reasoning**: For complex queries, the AI thinks step-by-step before answering
6. **Domain-Expert Response**: The AI responds with construction industry expertise, considering codes, best practices, and coordination
7. **Citation Parsing**: Citations are extracted and made clickable for easy reference

### Available AI Models

**GPT-4o Mini** - Fast and efficient for simple factual questions
- Best for: Quick lookups, simple questions
- Speed: Fastest
- Cost: Lowest

**GPT-4o** - Balanced performance for most questions
- Best for: General questions, moderate complexity
- Speed: Fast
- Cost: Moderate

**Claude Sonnet 4** - Excellent balance of speed and intelligence
- Best for: Complex analysis, detailed answers
- Speed: Fast
- Cost: Moderate

**Claude Opus 4.5** - Superior reasoning for complex analysis
- Best for: Multi-step reasoning, deep technical analysis, complex coordination issues
- Speed: Moderate
- Cost: Higher

The system automatically uses:
- **Multi-query expansion** for better document retrieval
- **Query decomposition** when questions are complex
- **Chain-of-thought reasoning** for advanced models on complex queries

## API Endpoints

### Projects
- `GET /api/projects` - List all projects
- `POST /api/projects` - Create new project
- `GET /api/projects/:id` - Get project details
- `DELETE /api/projects/:id` - Delete project

### Documents
- `POST /api/documents/:projectId/upload` - Upload documents
- `POST /api/documents/:projectId/process` - Process documents
- `DELETE /api/documents/:documentId` - Delete document

### Chats
- `GET /api/chats/models` - Get available AI models
- `GET /api/chats/project/:projectId` - List chats for project
- `POST /api/chats` - Create new chat
- `GET /api/chats/:chatId` - Get chat with messages
- `POST /api/chats/:chatId/message` - Send message (with optional model parameter)
- `DELETE /api/chats/:chatId` - Delete chat
- `POST /api/chats/cleanup` - Clean up old chats

## Configuration

### Chat Retention

By default, chats older than 30 days are automatically deleted. You can change this in the `.env` file:

```
CHAT_RETENTION_DAYS=60
```

### API Costs

**Document Processing:**
- **text-embedding-3-small** for embeddings (~$0.02 per 1M tokens)

**Chat Responses (varies by model):**
- **GPT-4o Mini**: ~$0.15 per 1M input tokens, ~$0.60 per 1M output tokens
- **GPT-4o**: ~$2.50 per 1M input tokens, ~$10 per 1M output tokens
- **Claude Sonnet 4**: ~$3 per 1M input tokens, ~$15 per 1M output tokens
- **Claude Opus 4.5**: ~$15 per 1M input tokens, ~$75 per 1M output tokens

**Typical Costs:**
- Processing 100 pages of documents: $0.10-0.50
- Simple chat query (GPT-4o Mini): $0.001-0.005
- Complex analysis (Claude Opus 4.5): $0.05-0.20

**Note:** Multi-query expansion and query decomposition increase token usage by 2-4x for better accuracy.

## Storage

All data is stored locally:
- `/db/database.sqlite` - SQLite database with metadata and embeddings
- `/uploads/{projectId}/` - Uploaded PDF files

## Limitations

- PDF text extraction works best with text-based PDFs (not scanned images)
- For scanned drawings, consider using OCR preprocessing
- Very large documents (500+ pages) may take 10-20 minutes to process
- The system cannot "see" visual elements in drawings, only extract text

## Advanced Features

### Multi-Query Expansion
The system automatically generates 3 alternative phrasings of your question:
- Technical/specification focused
- Visual/drawing focused
- Compliance/code focused

This dramatically improves retrieval accuracy by finding relevant information that might be missed with a single query.

### Query Decomposition
Complex questions like "What are the structural requirements for the main conference room and how do they coordinate with the MEP systems?" are automatically broken down into sub-questions, answered individually, then synthesized into a comprehensive response.

### Chain-of-Thought Reasoning
When using Claude models on complex questions, the AI:
1. Analyzes what's being asked explicitly and implicitly
2. Gathers relevant information from context
3. Infers from standards and best practices
4. Synthesizes connections between information
5. Considers issues and alternatives
6. Provides a final answer with citations

### Domain Expertise
The system is enhanced with construction industry knowledge including:
- Building codes (IBC, IRC, NEC, UPC, IMC)
- Construction methods and sequencing
- Material properties and compatibilities
- MEP system interactions
- Structural engineering principles
- Coordination and constructability

## Future Enhancements

- ✅ PDF viewer with page navigation for citations (Completed)
- ✅ Vision-based analysis for drawing details (Completed)
- ✅ Multi-model AI support (Completed)
- Multi-user support with authentication
- Export chat history
- Project templates and saved queries
- Fine-tuned embeddings for construction documents

## Troubleshooting

### "OpenAI API key not set"
Make sure you've created a `.env` file with your API key.

### "Error processing documents"
Check that your PDFs are valid and not password-protected.

### Slow processing
Large document sets take time. Processing happens in the background, so you can continue using the interface.

### Citations not working
Make sure documents have been fully processed before creating chats.

## License

MIT

## Support

For issues or questions, please create an issue in the repository.
