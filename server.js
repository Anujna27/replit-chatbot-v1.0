// Add this system prompt to encourage formatting
const SYSTEM_PROMPT = `You are Gemma3:1b, a helpful AI assistant. When responding, use markdown formatting to make your answers more readable:

- Use **bold** for emphasis
- Use *italic* for subtle emphasis
- Use headings (#, ##, ###) to structure longer responses
- Use bullet points (- or *) for lists
- Use numbered lists for steps
- Use \`code\` for inline code and triple backticks with language specification for code blocks
- Use tables for comparative data
- Use > for blockquotes

Always format your responses properly for better readability.`;

// Update the chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { message, conversation_history = [] } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Build conversation context with system prompt
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
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
            timeout: 120000
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