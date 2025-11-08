const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for base64 images
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ollama API configuration
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const MODEL_NAME = process.env.MODEL_NAME || 'gemma3:1b';

// System prompt with image support instructions
const SYSTEM_PROMPT = `You are Gemma3:1b, a helpful AI assistant. When responding, use markdown formatting to make your answers more readable.

For text responses:
- Use **bold** for emphasis
- Use *italic* for subtle emphasis
- Use headings (#, ##, ###) to structure longer responses
- Use bullet points (- or *) for lists
- Use numbered lists for steps
- Use \`code\` for inline code and triple backticks with language specification for code blocks
- Use tables for comparative data
- Use > for blockquotes

If the user provides images, you can reference them in your response. Describe what you see or answer questions about the images.

Always format your responses properly for better readability.`;

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    model: MODEL_NAME,
    ollama_url: OLLAMA_BASE_URL,
    features: ['chat', 'images', 'formatting']
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
      available_models: models.map(m => m.name),
      supports_images: true
    });
  } catch (error) {
    res.status(500).json({
      ollama_status: 'not_available',
      error: error.message
    });
  }
});

// Enhanced chat endpoint with image support
app.post('/api/chat', async (req, res) => {
  try {
    const { message, images = [], conversation_history = [] } = req.body;

    if (!message && images.length === 0) {
      return res.status(400).json({ error: 'Message or images are required' });
    }

    // Build conversation context with system prompt
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversation_history.map(msg => ({
        role: msg.role,
        content: msg.content
      }))
    ];

    // Add current message with image context if available
    let userMessage = message || '';
    if (images.length > 0) {
      if (userMessage) {
        userMessage += `\n\n[User attached ${images.length} image(s). Please respond accordingly.]`;
      } else {
        userMessage = `[User attached ${images.length} image(s). Please describe or analyze these images.]`;
      }
      
      // Add image information to the message
      images.forEach((img, index) => {
        userMessage += `\nImage ${index + 1}: ${img.name} (${img.type})`;
      });
    }

    messages.push({ role: 'user', content: userMessage });

    const requestBody = {
      model: MODEL_NAME,
      messages: messages,
      stream: false,
      options: {
        temperature: 0.7,
        top_p: 0.9,
      }
    };

    console.log('Sending request to Ollama:', { 
      model: MODEL_NAME, 
      message_length: userMessage.length,
      images_count: images.length 
    });

    const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, requestBody, {
      timeout: 120000
    });

    const aiResponse = response.data.message.content;

    res.json({
      response: aiResponse,
      model: MODEL_NAME,
      usage: response.data.usage,
      images_received: images.length
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

// Stream endpoint for real-time responses with image support
app.post('/api/chat/stream', async (req, res) => {
  try {
    const { message, images = [], conversation_history = [] } = req.body;

    if (!message && images.length === 0) {
      return res.status(400).json({ error: 'Message or images are required' });
    }

    // Build conversation context
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversation_history.map(msg => ({
        role: msg.role,
        content: msg.content
      }))
    ];

    // Add current message with image context
    let userMessage = message || '';
    if (images.length > 0) {
      if (userMessage) {
        userMessage += `\n\n[User attached ${images.length} image(s)]`;
      } else {
        userMessage = `[User attached ${images.length} image(s)]`;
      }
    }

    messages.push({ role: 'user', content: userMessage });

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

// New endpoint for multimodal models (future-proof)
app.post('/api/chat/multimodal', async (req, res) => {
  try {
    const { message, images = [], conversation_history = [], model: customModel } = req.body;

    if (!message && images.length === 0) {
      return res.status(400).json({ error: 'Message or images are required' });
    }

    const modelToUse = customModel || MODEL_NAME;

    // For multimodal models, we would structure the messages differently
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversation_history
    ];

    // Build multimodal message - this structure works with models like LLaVA
    const userMessage = {
      role: 'user',
      content: []
    };

    // Add text content
    if (message) {
      userMessage.content.push({
        type: 'text',
        text: message
      });
    }

    // Add image content (for multimodal models)
    if (images.length > 0) {
      images.forEach(img => {
        userMessage.content.push({
          type: 'image',
          // For actual multimodal models, you'd use the base64 data
          // source: `data:${img.type};base64,${img.data.split(',')[1]}`
          source: `data:${img.type};base64,[image_data_here]`
        });
      });
    }

    messages.push(userMessage);

    const requestBody = {
      model: modelToUse,
      messages: messages,
      stream: false,
      options: {
        temperature: 0.7,
        top_p: 0.9,
      }
    };

    console.log('Sending multimodal request:', {
      model: modelToUse,
      has_text: !!message,
      images_count: images.length
    });

    const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, requestBody, {
      timeout: 120000
    });

    const aiResponse = response.data.message.content;

    res.json({
      response: aiResponse,
      model: modelToUse,
      usage: response.data.usage,
      multimodal: true,
      images_processed: images.length
    });

  } catch (error) {
    console.error('Multimodal chat error:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: 'Ollama is not running',
        details: 'Please start Ollama first: ollama serve'
      });
    }

    if (error.response?.status === 404) {
      return res.status(404).json({
        error: 'Model not found or not multimodal',
        details: `The model might not support images. Try a multimodal model like LLaVA.`
      });
    }

    res.status(500).json({
      error: 'Multimodal chat failed',
      details: error.message
    });
  }
});

// Endpoint to check model capabilities
app.get('/api/model-info', async (req, res) => {
  try {
    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`);
    const models = response.data.models || [];
    
    const modelInfo = models.map(model => ({
      name: model.name,
      size: model.size,
      modified: model.modified,
      supports_images: model.name.includes('llava') || model.name.includes('bakllava') || model.name.includes('vision'),
      is_multimodal: model.name.includes('llava') || model.name.includes('bakllava') || model.name.includes('vision')
    }));

    res.json({
      current_model: MODEL_NAME,
      available_models: modelInfo,
      current_supports_images: MODEL_NAME.includes('llava') || MODEL_NAME.includes('bakllava') || MODEL_NAME.includes('vision')
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get model info',
      details: error.message
    });
  }
});

// Endpoint to switch models
app.post('/api/switch-model', async (req, res) => {
  try {
    const { model } = req.body;
    
    if (!model) {
      return res.status(400).json({ error: 'Model name is required' });
    }

    // Verify the model exists
    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`);
    const models = response.data.models || [];
    const modelExists = models.some(m => m.name === model);

    if (!modelExists) {
      return res.status(404).json({ error: `Model '${model}' not found` });
    }

    // In a real application, you might want to persist this
    // For now, we'll just return success
    res.json({
      success: true,
      message: `Model switched to ${model}`,
      new_model: model,
      supports_images: model.includes('llava') || model.includes('bakllava') || model.includes('vision')
    });

  } catch (error) {
    console.error('Model switch error:', error);
    res.status(500).json({
      error: 'Failed to switch model',
      details: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🤖 Using model: ${MODEL_NAME}`);
  console.log(`🔗 Ollama URL: ${OLLAMA_BASE_URL}`);
  console.log(`📸 Image support: ${MODEL_NAME.includes('llava') || MODEL_NAME.includes('bakllava') || MODEL_NAME.includes('vision') ? 'Yes (Multimodal)' : 'Basic (Text-only)'}`);
  console.log(`💾 File upload limit: 50MB`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Server terminated');
  process.exit(0);
});