const express = require('express');
const router = express.Router();
const multer = require('multer');
const {GoogleGenAI,Type} = require("@google/genai")

const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
const storage = multer({ dest: 'uploads/' });

router.get('/issue/summary', storage.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  } else {
    const fs = require("fs");
    const base64 = fs.readFileSync(req.file.path, {encoding: "base64"});
    ai.models.generateContent({
        model: "gemini-2.0-flash-001",
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "object",
                properties: {
                    description: {
                        type: Type.STRING
                    },
                    category: {
                        type: Type.STRING,
                        enum: ["Pothole", "Streetlight", "Garbage", "Water Stagnation", "Other"]
                    }
                },
                required: ["description", "category"]
            }
        },
        contents: [{
          inlineData: {
            mimeType: req.file.mimetype,
            data: base64
          }
        }, {text: "This is a civic issue reporting system. Describe the issue in detail to report it and categorise it"}],
    }).then(function(r) {
        console.log(r)
        return res.status(200).json(JSON.parse(r.text));
    }).catch(function(err) {
        console.error("Error generating content:", err);
        return res.status(500).json({ error: 'Error generating content' });
    });
  }
});

// Add more API routes here as needed

module.exports = router;
// Add more API routes here as needed

module.exports = router;
