import { Router } from "express";
import { v4 as uuid } from "uuid";
import multer from "multer";
import path from "path";
import fs from "fs";
import { getSkills, saveSkills } from "../services/data";
import { listInstalledSkills } from "../services/clawhub";

export const skillsRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });

skillsRouter.get("/", (_req, res) => {
  const skills = getSkills();
  // Merge in any ClawHub-installed skills not yet registered in skills.json
  try {
    const clawhubSkills = listInstalledSkills();
    let changed = false;
    for (const cs of clawhubSkills) {
      if (cs.installed && !skills.some((s) => s.name === cs.name && s.source === "clawhub")) {
        skills.push({
          id: uuid(),
          name: cs.name,
          description: cs.description || `ClawHub skill: ${cs.name}`,
          source: "clawhub" as const,
          script: cs.name,
          enabled: true,
          installedAt: new Date().toISOString(),
        });
        changed = true;
      }
    }
    if (changed) saveSkills(skills);
  } catch {}
  res.json(skills);
});

// Install skill
skillsRouter.post("/", (req, res) => {
  const skills = getSkills();
  const skill = {
    id: uuid(),
    name: req.body.name || "Untitled Skill",
    description: req.body.description || "",
    source: req.body.source || "custom",
    script: req.body.script || "",
    enabled: true,
    installedAt: new Date().toISOString(),
  };
  skills.push(skill);
  saveSkills(skills);
  res.json(skill);
});

// Toggle or update skill
skillsRouter.patch("/:id", (req, res) => {
  const skills = getSkills();
  const idx = skills.findIndex((s) => s.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "Not found" });
  Object.assign(skills[idx], req.body);
  saveSkills(skills);
  res.json(skills[idx]);
});

// Uninstall
skillsRouter.delete("/:id", (req, res) => {
  let skills = getSkills();
  skills = skills.filter((s) => s.id !== req.params.id);
  saveSkills(skills);
  res.json({ success: true });
});

// Upload SKILL.md file
skillsRouter.post("/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const content = req.file.buffer.toString("utf-8");

    // Parse frontmatter
    let name = "";
    let description = "";
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fmMatch) {
      for (const line of fmMatch[1].split("\n")) {
        const idx = line.indexOf(":");
        if (idx <= 0) continue;
        const key = line.slice(0, idx).trim().toLowerCase();
        const val = line.slice(idx + 1).trim();
        if (key === "name") name = val;
        else if (key === "description") description = val;
      }
    }

    // Fallback name from filename
    if (!name) {
      name = path.basename(req.file.originalname, path.extname(req.file.originalname));
    }

    // Save SKILL.md to skills/<name>/SKILL.md
    const skillDir = path.join(process.cwd(), "skills", name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase());
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf-8");

    // Register in skills.json
    const skills = getSkills();
    const existing = skills.find((s) => s.name === name && s.source === "custom");
    if (existing) {
      existing.script = name;
      existing.description = description || existing.description;
      saveSkills(skills);
      return res.json(existing);
    }

    const skill = {
      id: uuid(),
      name,
      description: description || `Custom skill from ${req.file.originalname}`,
      source: "custom" as const,
      script: name,
      enabled: true,
      installedAt: new Date().toISOString(),
    };
    skills.push(skill);
    saveSkills(skills);
    res.json(skill);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Browse available skills (Claude / OpenClaw catalog)
skillsRouter.get("/catalog", (_req, res) => {
  // Built-in skill catalog
  const catalog = [
    { name: "Web Search", description: "Search the web using configured search engine", source: "claude", script: "web-search" },
    { name: "Code Review", description: "Review code for quality and security issues", source: "claude", script: "code-review" },
    { name: "File Converter", description: "Convert between file formats (PDF, DOCX, CSV)", source: "claude", script: "file-converter" },
    { name: "Data Analyzer", description: "Analyze CSV/JSON data and generate charts", source: "openclaw", script: "data-analyzer" },
    { name: "API Tester", description: "Test REST APIs with custom requests", source: "openclaw", script: "api-tester" },
    { name: "Markdown Renderer", description: "Render markdown to HTML/PDF", source: "openclaw", script: "markdown-renderer" },
    { name: "Git Helper", description: "Git operations within sandbox", source: "claude", script: "git-helper" },
    { name: "Image Processor", description: "Resize, crop, and convert images", source: "openclaw", script: "image-processor" },
  ];
  res.json(catalog);
});
