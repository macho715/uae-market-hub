export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS request (CORS preflight)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { userInput, systemPrompt, useSearch } = req.body;

        // Get API Key from environment variable
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'API Key not configured' });
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{ parts: [{ text: userInput }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] }
        };

        if (useSearch) {
            payload.tools = [{ google_search: {} }];
        }

        // Retry configuration
        const MAX_RETRIES = 5;
        const BASE_DELAY = 200; // ms
        const PER_ATTEMPT_TIMEOUT = 15000; // 15 seconds

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                // Call Gemini API with timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT);

                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                // Success case
                if (response.ok) {
                    const result = await response.json();
                    return res.status(200).json(result);
                }

                // Handle rate limit (429) or server errors (5xx)
                if (response.status === 429 || response.status >= 500) {
                    if (attempt < MAX_RETRIES - 1) {
                        // Exponential backoff with jitter
                        const jitter = Math.random() * 120;
                        const delay = BASE_DELAY * (2 ** attempt) + jitter;
                        console.log(`Retry attempt ${attempt + 1} after ${delay}ms (status: ${response.status})`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                }

                // Other errors (4xx) - return immediately
                const errorText = await response.text();
                return res.status(response.status).json({ 
                    error: `Gemini API error: ${response.status}`,
                    details: errorText
                });

            } catch (fetchError) {
                // Handle timeout or network errors
                if (attempt < MAX_RETRIES - 1) {
                    const jitter = Math.random() * 120;
                    const delay = BASE_DELAY * (2 ** attempt) + jitter;
                    console.log(`Retry attempt ${attempt + 1} after ${delay}ms (error: ${fetchError.message})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                // Final attempt failed
                return res.status(504).json({ 
                    error: 'Gateway timeout',
                    message: 'Failed to get response from Gemini API',
                    details: fetchError.message
                });
            }
        }

        // All retries exhausted
        return res.status(504).json({ 
            error: 'Gateway timeout',
            message: 'Maximum retries exceeded'
        });

    } catch (error) {
        console.error('Proxy error:', error);
        return res.status(500).json({ 
            error: 'Internal server error',
            message: error.message
        });
    }
}
