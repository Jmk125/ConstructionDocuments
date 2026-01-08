const express = require('express');
const router = express.Router();
const { runQuery, getQuery, getOneQuery } = require('../database');
const fs = require('fs');
const path = require('path');

// Get all projects
router.get('/', (req, res) => {
  try {
    const projects = getQuery('SELECT * FROM projects ORDER BY created_at DESC');
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single project with details
router.get('/:id', (req, res) => {
  try {
    const projects = getQuery('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    const project = projects[0];
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get documents for this project
    const documents = getQuery('SELECT * FROM documents WHERE project_id = ?', [req.params.id]);
    
    // Get chats for this project
    const chats = getQuery('SELECT * FROM chats WHERE project_id = ? ORDER BY updated_at DESC', [req.params.id]);

    res.json({
      ...project,
      documents,
      chats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new project
router.post('/', (req, res) => {
  try {
    const { name, description } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    runQuery(
      'INSERT INTO projects (name, description, created_at) VALUES (?, ?, datetime("now"))',
      [name, description || '']
    );

    // Get the last inserted project
    const projects = getQuery('SELECT * FROM projects ORDER BY id DESC LIMIT 1');
    const project = projects[0];
    
    if (!project) {
      throw new Error('Failed to retrieve created project');
    }
    
    // Create upload directory for this project
    const uploadDir = path.join(__dirname, '..', 'uploads', project.id.toString());
    const specsDir = path.join(uploadDir, 'specs');
    const drawingsDir = path.join(uploadDir, 'drawings');
    
    // Ensure directories exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    if (!fs.existsSync(specsDir)) {
      fs.mkdirSync(specsDir, { recursive: true });
    }
    if (!fs.existsSync(drawingsDir)) {
      fs.mkdirSync(drawingsDir, { recursive: true });
    }

    res.json(project);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete project
router.delete('/:id', (req, res) => {
  try {
    const projects = getQuery('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    const project = projects[0];
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Delete project directory
    const uploadDir = path.join(__dirname, '..', 'uploads', req.params.id);
    if (fs.existsSync(uploadDir)) {
      fs.rmSync(uploadDir, { recursive: true, force: true });
    }

    // Delete from database (cascades to documents, chunks, chats, messages)
    runQuery('DELETE FROM projects WHERE id = ?', [req.params.id]);

    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
