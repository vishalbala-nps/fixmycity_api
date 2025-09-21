const express = require('express');
const router = express.Router();
const multer = require('multer');
const {GoogleGenAI,Type} = require("@google/genai")
const db = require('../db'); // Import the shared db connection
const fs = require("fs");
const path = require('path');
const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
const storage = multer({ dest: path.join(__dirname,"..",'uploads') });

const dupradii = 100; // in meters

/**
 * @openapi
 * /api/issue/summary:
 *   get:
 *     summary: Get issue summary with image and location
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *               lat:
 *                 type: number
 *               lon:
 *                 type: number
 *     responses:
 *       200:
 *         description: Issue summary with duplicate check
 *       400:
 *         description: Bad request (missing image or lat/lon)
 *       500:
 *         description: Database or Gemini error
 */
router.get('/summary', storage.single("image"), (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Request body is required' });
  }
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
  // Only consider reports within 20 meters using ST_Distance_Sphere
  db.query(
    `SELECT id, description, type 
     FROM Reports 
     WHERE status IN('submitted','progress') 
     AND ST_Distance_Sphere(location, POINT(?, ?)) <= ?`,
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
          prompt = "This is a civic issue reporting system. Check if this image matches the description '" + results[0].description + "' and category '" + results[0].type + "'. If it does, set duplicate to true. If false, describe the issue in detail to report it and categorise it.";
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
          if (rjson.duplicate === true) {
            rjson.report = dupid;
          }
          return res.status(200).json(rjson);
        }).catch(function(err) {
          console.error("Error generating content:", err);
          return res.status(500).json({ error: 'Error generating content' });
        });
      }
    }
  );
});

/**
 * @openapi
 * /api/issue:
 *   post:
 *     summary: Report a new issue or mark as duplicate
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isDuplicate:
 *                 type: boolean
 *               image:
 *                 type: string
 *               report:
 *                 type: integer
 *               description:
 *                 type: string
 *               type:
 *                 type: string
 *               lat:
 *                 type: number
 *               lon:
 *                 type: number
 *     responses:
 *       201:
 *         description: Issue reported or duplicate marked
 *       400:
 *         description: Bad request
 *       500:
 *         description: Database error
 */
router.post('/', (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body is required' });
  }
  const { isDuplicate, image, report, description, type, lat, lon } = req.body;

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

/**
 * @openapi
 * /api/issue:
 *   get:
 *     summary: Get all issues (with optional filter)
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [all, user]
 *         description: Filter issues (all or only for the logged-in user)
 *     responses:
 *       200:
 *         description: List of issues
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: integer }
 *                   dateofreport: { type: string }
 *                   type: { type: string }
 *                   description: { type: string }
 *                   count: { type: integer }
 *                   status: { type: string }
 *                   lat: { type: number }
 *                   lon: { type: number }
 *                   images:
 *                     type: array
 *                     items: { type: string }
 *       500:
 *         description: Database error
 */
router.get('/', (req, res) => {
  const { filter } = req.query;
  let sql = `
    SELECT 
      id, 
      dateofreport, 
      type, 
      description, 
      count, 
      status, 
      lat,
      lon,
      images,
      users
    FROM IssueView
    `;

  if (filter === 'user') {
    sql += ` WHERE FIND_IN_SET(?, users)`;
  }
  sql += ' ORDER BY dateofreport DESC';

  db.query(sql,[req.user], (err, results) => {
    if (err) {
      console.error("Database query error:", err);
      return res.status(500).json({ error: 'Database error' });
    }
    const formatted = results.map(r => ({
      id: r.id,
      dateofreport: r.dateofreport,
      type: r.type,
      description: r.description,
      count: r.count,
      status: r.status,
      lat: r.lat,
      lon: r.lon,
      images: r.images ? r.images.split(',') : []
      // users field intentionally omitted from response
    }));
    res.json(formatted);
  });
});

/**
 * @openapi
 * /api/issue/resolved:
 *   get:
 *     summary: Get resolved issue details by report id
 *     parameters:
 *       - in: query
 *         name: report
 *         required: true
 *         schema:
 *           type: integer
 *         description: Report id to fetch resolved issue details
 *     responses:
 *       200:
 *         description: Resolved issue details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 report: { type: integer }
 *                 dateofresolution: { type: string }
 *                 image: { type: string }
 *                 remarks: { type: string }
 *       400:
 *         description: report query parameter is required
 *       404:
 *         description: Resolved issue not found
 *       500:
 *         description: Database error
 */
router.get('/resolved', (req, res) => {
  const reportId = req.query.report;
  if (!reportId) {
    // Show all resolved issues
    db.query(
      "SELECT report, dateofresolution, image, remarks FROM ResolvedIssues",
      (err, results) => {
        if (err) {
          console.error("Database query error:", err);
          return res.status(500).json({ error: 'Database error' });
        }
        res.json(results);
      }
    );
    return;
  }
  db.query(
    "SELECT report, dateofresolution, image, remarks FROM ResolvedIssues WHERE report = ?",
    [reportId],
    (err, results) => {
      if (err) {
        console.error("Database query error:", err);
        return res.status(500).json({ error: 'Database error' });
      }
      if (!results.length) {
        return res.status(404).json({ error: 'Resolved issue not found' });
      }
      res.json(results[0]);
    }
  );
});

module.exports = router;