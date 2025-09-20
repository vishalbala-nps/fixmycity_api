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
  const { lat, lon } = req.body;
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  if (typeof lat === 'undefined' || typeof lon === 'undefined') {
    // Delete the uploaded file if lat/lon are missing
    fs.unlink(req.file.path, () => {
      return res.status(400).json({ error: 'lat and lon are required' });
    });
    return;
  }
  const base64 = fs.readFileSync(req.file.path, {encoding: "base64"});
  let prompt;
  let dupid = 0;
  db.query(
    "SELECT id,description,type FROM Reports WHERE status IN('submitted','progress') AND MBRContains(ST_Buffer(POINT(?,?), ?), location)",
    [lon, lat, dupradii],
    function(err, results) {
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
          prompt = "This is a civic issue reporting system. Check if this image matches the description " + results[0].description + " and category " + results[0].type + ". If it does, set duplicate to true and retain the description and category. If not, generate desc and category based on the image.";
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
              required: ["description", "category", "duplicate"]
            }
          },
          contents: [{
            inlineData: {
              mimeType: req.file.mimetype,
              data: base64
            }
          }, { text: prompt }]
        }).then(function(r) {
          let rjson = JSON.parse(r.text);
          rjson.image = req.file.filename;
          rjson.report = dupid;
          return res.status(200).json(rjson);
        }).catch(function(err) {
          console.error("Error generating content:", err);
          return res.status(500).json({ error: 'Error generating content' });
        });
      }
    }
  );
});

router.post('/issue', (req, res) => {
  const { isDuplicate, image, report, description, type } = req.body;

  if (typeof isDuplicate === 'undefined' || !image) {
    return res.status(400).json({ error: 'isDuplicate and image are required' });
  }

  if (isDuplicate === true || isDuplicate === 'true') {
    // Duplicate: require report id
    if (!report) {
      return res.status(400).json({ error: 'report is required for duplicate issues' });
    }
    // Increment count in Reports and insert into UserReports
    db.query(
      "UPDATE Reports SET count = count + 1 WHERE id = ?",
      [report],
      function(err, updateResult) {
        if (err) {
          console.error("Database update error:", err);
          return res.status(500).json({ error: 'Database error' });
        }
        db.query(
          "INSERT INTO UserReports (user, report, imagename) VALUES (?, ?, ?)",
          [req.user, report, image],
          function(err2, result) {
            if (err2) {
              console.error("Database insert error:", err2);
              return res.status(500).json({ error: 'Database error' });
            }
            return res.status(201).json({ message: 'Duplicate issue reported', reportId: report, image });
          }
        );
      }
    );
  } else {
    // Not duplicate: require description, type, latitude, longitude
    const { lat, lon } = req.body;
    if (!description || !type || typeof lat === 'undefined' || typeof lon === 'undefined') {
      return res.status(400).json({ error: 'description, type, lat, and lon are required for new issues' });
    }
    // Insert into Reports
    db.query(
      "INSERT INTO Reports (dateofreport, type, description, location, count, status) VALUES (CURDATE(), ?, ?, POINT(?,?), 1, 'submitted')",
      [type, description, lon, lat],
      function(err, result) {
        if (err) {
          console.error("Database insert error:", err);
          return res.status(500).json({ error: 'Database error' });
        }
        const newReportId = result.insertId;
        // Insert into UserReports
        db.query(
          "INSERT INTO UserReports (user, report, imagename) VALUES (?, ?, ?)",
          [req.user, newReportId, image],
          function(err2, result2) {
            if (err2) {
              console.error("Database insert error:", err2);
              return res.status(500).json({ error: 'Database error' });
            }
            return res.status(201).json({ message: 'Issue reported', reportId: newReportId, image });
          }
        );
      }
    );
  }
});



// Add more API routes here as needed
module.exports = router;
// Add more API routes here as needed
module.exports = router;
