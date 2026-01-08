# Construction AI - Quick Start Guide

## Installation Steps

1. **Extract the project** (if you received a zip file)

2. **Open terminal/command prompt** and navigate to the project folder:
   ```bash
   cd path/to/construction-ai
   ```

3. **Install dependencies**:
   ```bash
   npm install
   ```

4. **Set up your OpenAI API key**:
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Edit `.env` and add your OpenAI API key:
     ```
     OPENAI_API_KEY=sk-your-api-key-here
     ```

5. **Start the server**:
   ```bash
   npm start
   ```

6. **Open your browser** and go to:
   ```
   http://localhost:3000
   ```

## First Time Usage

1. **Create a Project**:
   - Click "New Project"
   - Enter a name (e.g., "Smith Residence Renovation")
   - Add optional description
   - Click "Create Project"

2. **Upload Documents**:
   - Click on your project
   - Select document type (Drawings or Specifications)
   - Click "Choose Files" and select your PDFs
   - Click "Upload PDFs"

3. **Process Documents**:
   - After uploading, click "Process Documents"
   - Wait for processing to complete (may take a few minutes)
   - You'll see a success message when done

4. **Start Chatting**:
   - Click "New Chat" in the sidebar
   - Switch to the "Chat" tab
   - Ask questions about your documents!

## Example Questions

- "What is the specified roof membrane material?"
- "Show me all the fire-rated wall assemblies"
- "What are the requirements for exterior door hardware?"
- "Does the project include any seismic detailing requirements?"
- "What finish is specified for the concrete floors?"

## Tips

- **Be specific**: The more specific your question, the better the answer
- **Citations**: Click on citations to see which document/page the info came from
- **Multiple chats**: Create separate chats for different topics (materials, MEP, structural, etc.)
- **Retention**: Chats older than 30 days are automatically deleted (configurable in .env)

## Troubleshooting

**Problem**: Server won't start
- **Solution**: Make sure you've run `npm install` and set up your `.env` file

**Problem**: "Error processing documents"
- **Solution**: Check that PDFs aren't password-protected or corrupted

**Problem**: AI responses are generic/unhelpful
- **Solution**: Make sure documents are fully processed before chatting

**Problem**: Can't find information
- **Solution**: Try rephrasing your question or being more specific

## File Structure

```
construction-ai/
├── server.js              # Main server file
├── database.js            # Database initialization
├── documentProcessor.js   # PDF text extraction
├── embeddings.js          # OpenAI embeddings & search
├── chatHandler.js         # Chat & GPT integration
├── routes/                # API routes
│   ├── projects.js
│   ├── documents.js
│   └── chat.js
├── public/                # Frontend files
│   ├── index.html         # Projects page
│   ├── project.html       # Project detail page
│   ├── css/
│   │   └── styles.css
│   └── js/
│       ├── main.js
│       └── project.js
├── db/                    # SQLite database (created on first run)
├── uploads/               # Uploaded PDFs (created on first run)
└── .env                   # Your configuration (you create this)
```

## Support

For issues or questions:
1. Check the main README.md file
2. Review the troubleshooting section
3. Check your browser console for errors (F12)
4. Check the server terminal for error messages

## Cost Estimation

Processing a typical 50-page document set: ~$0.10-0.25
Each chat query: ~$0.01-0.03

Monitor your OpenAI usage at: https://platform.openai.com/usage
