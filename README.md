# Construction AI

An intelligent document analysis tool for construction projects. Upload construction drawings and specifications, then ask questions and get AI-powered answers with citations to specific documents and pages.

## Features

- **Project Management**: Create and manage multiple construction projects
- **Document Upload**: Upload PDF drawings and specifications
- **Intelligent Processing**: Automatic text extraction and embedding generation
- **AI-Powered Chat**: Ask questions about your documents and get detailed answers
- **Citation Support**: Responses include citations to specific documents and pages
- **Chat History**: Maintain conversation history with automatic cleanup
- **Local Hosting**: Run on your laptop or Raspberry Pi

## Prerequisites

- Node.js (v16 or higher)
- OpenAI API key

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

4. Edit the `.env` file and add your OpenAI API key:
```
OPENAI_API_KEY=your_openai_api_key_here
PORT=3000
CHAT_RETENTION_DAYS=30
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

6. Create a new chat and start asking questions!

## How It Works

### Document Processing

1. **Text Extraction**: PDFs are parsed to extract text content page by page
2. **Chunking**: Documents are split into manageable chunks (by page/sheet)
3. **Embedding Generation**: Each chunk is converted to a vector embedding using OpenAI's `text-embedding-3-small` model
4. **Storage**: Embeddings are stored in a local SQLite database

### Question Answering

1. **Query Embedding**: Your question is converted to a vector embedding
2. **Similarity Search**: The system finds the most relevant document chunks using cosine similarity
3. **Context Building**: Relevant chunks are assembled into context
4. **GPT Response**: GPT-4 analyzes the context and generates an answer with citations
5. **Citation Parsing**: Citations are extracted and made clickable

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
- `GET /api/chats/project/:projectId` - List chats for project
- `POST /api/chats` - Create new chat
- `GET /api/chats/:chatId` - Get chat with messages
- `POST /api/chats/:chatId/message` - Send message
- `DELETE /api/chats/:chatId` - Delete chat
- `POST /api/chats/cleanup` - Clean up old chats

## Configuration

### Chat Retention

By default, chats older than 30 days are automatically deleted. You can change this in the `.env` file:

```
CHAT_RETENTION_DAYS=60
```

### API Costs

The system uses:
- **text-embedding-3-small** for embeddings (~$0.02 per 1M tokens)
- **gpt-4o** for chat responses (~$2.50 per 1M input tokens)

A typical construction project with 100 pages of documents might cost $0.10-0.50 to process, plus $0.01-0.05 per chat query.

## Storage

All data is stored locally:
- `/db/database.sqlite` - SQLite database with metadata and embeddings
- `/uploads/{projectId}/` - Uploaded PDF files

## Limitations

- PDF text extraction works best with text-based PDFs (not scanned images)
- For scanned drawings, consider using OCR preprocessing
- Very large documents (500+ pages) may take 10-20 minutes to process
- The system cannot "see" visual elements in drawings, only extract text

## Future Enhancements

- PDF viewer with page navigation for citations
- OCR support for scanned documents
- Image-based analysis for drawing details
- Multi-user support with authentication
- Export chat history
- Project templates and saved queries

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
