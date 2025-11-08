const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Ollama API configuration
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const MODEL_NAME = process.env.MODEL_NAME || 'gemma3:1b';

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    model: MODEL_NAME,
    ollama_url: OLLAMA_BASE_URL
  });
});

// Check if Ollama is running and model is available
app.get('/api/check-ollama', async (req, res) => {
  try {
    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`);
    const models = response.data.models || [];
    const gemmaModel = models.find(model => model.name.includes('gemma3:1b'));
    
    res.json({
      ollama_status: 'running',
      gemma_model_available: !!gemmaModel,
      available_models: models.map(m => m.name)
    });
  } catch (error) {
    res.status(500).json({
      ollama_status: 'not_available',
      error: error.message
    });
  }
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, conversation_history = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Build conversation context
    const messages = [
      ...conversation_history,
      { role: 'user', content: message }
    ];

    const requestBody = {
      model: MODEL_NAME,
      messages: messages,
      stream: false,
      options: {
        temperature: 0.7,
        top_p: 0.9,
      }
    };

    console.log('Sending request to Ollama:', { model: MODEL_NAME, message_length: message.length });

    const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, requestBody, {
      timeout: 120000 // 2 minute timeout
    });

    const aiResponse = response.data.message.content;

    res.json({
      response: aiResponse,
      model: MODEL_NAME,
      usage: response.data.usage
    });

  } catch (error) {
    console.error('Error calling Ollama:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: 'Ollama is not running. Please start Ollama first.',
        details: 'Run: ollama serve'
      });
    }

    if (error.response) {
      return res.status(error.response.status).json({
        error: 'Ollama API error',
        details: error.response.data
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Stream endpoint for real-time responses
app.post('/api/chat/stream', async (req, res) => {
  try {
    const { message, conversation_history = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const messages = [
      ...conversation_history,
      { role: 'user', content: message }
    ];

    const requestBody = {
      model: MODEL_NAME,
      messages: messages,
      stream: true,
      options: {
        temperature: 0.7,
        top_p: 0.9,
      }
    };

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, requestBody, {
      responseType: 'stream',
      timeout: 120000
    });

    response.data.on('data', (chunk) => {
      try {
        const lines = chunk.toString().split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          const data = JSON.parse(line);
          if (data.message && data.message.content) {
            res.write(data.message.content);
          }
        }
      } catch (parseError) {
        console.error('Error parsing stream data:', parseError);
      }
    });

    response.data.on('end', () => {
      res.end();
    });

    response.data.on('error', (error) => {
      console.error('Stream error:', error);
      res.end();
    });

  } catch (error) {
    console.error('Stream setup error:', error);
    res.status(500).json({ error: 'Stream setup failed' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🤖 Using model: ${MODEL_NAME}`);
  console.log(`🔗 Ollama URL: ${OLLAMA_BASE_URL}`);
});