require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./database');
const { initOpenAI: initEmbeddingsOpenAI } = require('./embeddings');
const { initOpenAI: initChatOpenAI } = require('./chatHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));
app.use(express.static('public'));

// Serve uploaded PDFs
app.use('/uploads', express.static('uploads'));

// Routes
const projectsRouter = require('./routes/projects');
const documentsRouter = require('./routes/documents');
const chatRouter = require('./routes/chat');

app.use('/api/projects', projectsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/chats', chatRouter);

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database
    console.log('Initializing database...');
    await initDatabase();
    console.log('Database initialized successfully');

    // Initialize OpenAI
    if (!process.env.OPENAI_API_KEY) {
      console.warn('WARNING: OPENAI_API_KEY not set in .env file');
      console.warn('Please create a .env file with your OpenAI API key');
    } else {
      initEmbeddingsOpenAI(process.env.OPENAI_API_KEY);
      console.log('OpenAI initialized successfully');
    }

    // Initialize Claude (optional)
    if (process.env.ANTHROPIC_API_KEY) {
      initChatOpenAI(process.env.OPENAI_API_KEY, process.env.ANTHROPIC_API_KEY);
      console.log('Claude API initialized successfully');
    } else {
      initChatOpenAI(process.env.OPENAI_API_KEY);
      console.log('Claude API not configured (ANTHROPIC_API_KEY not set)');
    }

    // Start server
    app.listen(PORT, () => {
      console.log(`\n=================================`);
      console.log(`Construction AI Server Running`);
      console.log(`=================================`);
      console.log(`Local:   http://localhost:${PORT}`);
      console.log(`Network: http://YOUR_IP:${PORT}`);
      console.log(`=================================\n`);
    });

  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

startServer();
