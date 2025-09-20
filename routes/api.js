const express = require('express');
const router = express.Router();
const multer = require('multer');
const {GoogleGenAI,Type} = require("@google/genai")
const db = require('../db'); // Import the shared db connection
const fs = require("fs");
const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
const storage = multer({ dest: 'uploads/' });

const dupradii = 20; // in meters

router.get('/issue/summary', storage.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  } else {
    const base64 = fs.readFileSync(req.file.path, {encoding: "base64"});
    let prompt;
    let dupid = 0;
    db.query("SELECT id,description,type FROM Reports WHERE status IN('submitted','progress') AND MBRContains(ST_Buffer(POINT(?,?), ?), location)", [req.body.lng, req.body.lat,dupradii],function(err, results) {
      if (err) {
        console.error("Database query error:", err);
        return res.status(500).json({ error: 'Database error' });
      } else {
        if (results.length === 0) {
          console.log("No nearby reports found.");
          prompt = "This is a civic issue reporting system. Describe the issue in detail to report it and categorise it. Also set duplicate to false";
        } else {
          console.log("Found nearby report");
          dupid = results[0].id;
          prompt = "This is a civic issue reporting system. Check if this image matches the description "+results[0].description+" and category "+results[0].type+" If it does, set duplicate to true and retain the description and category. If not gernerate desc and category based on the image."
        }
        console.log("Calling Gemini with prompt:", prompt);
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
                        },
                        duplicate: {
                            type: Type.BOOLEAN
                        }
                    },
                    required: ["description", "category","duplicate"]
                }
            },
            contents: [{
              inlineData: {
                mimeType: req.file.mimetype,
                data: base64
              }
            }, {text: prompt}]
        }).then(function(r) {
            let rjson = JSON.parse(r.text);
            rjson.file = req.file.filename;
            rjson.dupid = dupid
            return res.status(200).json(rjson);
        }).catch(function(err) {
            console.error("Error generating content:", err);
            return res.status(500).json({ error: 'Error generating content' });
        });
      }
    })
/*
*/
  }
});

router.get('/reports', (req, res) => {
  db.query('SELECT * FROM Reports', (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(results);
  });
});

// Add more API routes here as needed
module.exports = router;
