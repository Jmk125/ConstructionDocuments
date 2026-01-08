const express = require('express');
const router = express.Router();
const { getQuery, getOneQuery, runQuery } = require('../database');
const { createChat, sendMessage, getChatHistory, deleteOldChats } = require('../chatHandler');

// Get all chats for a project
router.get('/project/:projectId', (req, res) => {
  try {
    const chats = getQuery(
      'SELECT * FROM chats WHERE project_id = ? ORDER BY updated_at DESC',
      [req.params.projectId]
    );
    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new chat
router.post('/', (req, res) => {
  try {
    const { projectId, title } = req.body;
    
    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    const chatId = createChat(projectId, title);
    
    if (!chatId) {
      throw new Error('Failed to create chat');
    }
    
    const chats = getQuery('SELECT * FROM chats WHERE id = ?', [chatId]);
    const chat = chats[0];
    
    if (!chat) {
      throw new Error('Failed to retrieve created chat');
    }

    res.json(chat);
  } catch (error) {
    console.error('Error creating chat:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get chat with messages
router.get('/:chatId', (req, res) => {
  try {
    const chats = getQuery('SELECT * FROM chats WHERE id = ?', [req.params.chatId]);
    const chat = chats[0];
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const messages = getChatHistory(req.params.chatId);

    res.json({
      ...chat,
      messages
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send message in chat
router.post('/:chatId/message', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const response = await sendMessage(req.params.chatId, message);
    res.json(response);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete chat
router.delete('/:chatId', (req, res) => {
  try {
    runQuery('DELETE FROM chats WHERE id = ?', [req.params.chatId]);
    res.json({ message: 'Chat deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clean up old chats
router.post('/cleanup', (req, res) => {
  try {
    const retentionDays = parseInt(process.env.CHAT_RETENTION_DAYS) || 30;
    deleteOldChats(retentionDays);
    res.json({ message: `Deleted chats older than ${retentionDays} days` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
