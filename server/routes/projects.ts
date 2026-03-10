import { Router } from "express";
import { getProjects, saveProjects, getSettings, Project } from "../services/data";
import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";

export const projectsRouter = Router();

// List all projects
projectsRouter.get("/", (_req, res) => {
  res.json(getProjects());
});

// Generate Docker volume mount configuration for external project folders
projectsRouter.get("/docker/mounts", (_req, res) => {
  const projects = getProjects();
  const mounts = projects
    .filter((p) => p.workingFolder && p.folderLocation === "external")
    .map((p) => {
      const containerPath = `/mnt/projects/${p.id}`;
      const accessFlag = p.folderAccess === "readonly" ? "ro" : "rw";
      return {
        projectId: p.id,
        projectName: p.name,
        hostPath: p.workingFolder,
        containerPath,
        access: p.folderAccess || "readwrite",
        volumeFlag: `${p.workingFolder}:${containerPath}:${accessFlag}`,
      };
    });

  const volumeArgs = mounts.map((m) => `-v ${m.volumeFlag}`).join(" \\\n  ");
  const dockerRun = `docker run -p 3001:3001 \\\n  ${volumeArgs} \\\n  cowork`;

  const composeVolumes = mounts.map((m) => {
    const mode = m.access === "readonly" ? "ro" : "rw";
    return `      - ${m.hostPath}:${m.containerPath}:${mode}`;
  }).join("\n");

  res.json({ mounts, dockerRun, composeVolumes });
});

// Get single project
projectsRouter.get("/:id", (req, res) => {
  const projects = getProjects();
  const project = projects.find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json(project);
});

// Create project
projectsRouter.post("/", (req, res) => {
  const { name, description, workingFolder, folderLocation, folderAccess, skills } = req.body;
  const projects = getProjects();
  const settings = getSettings();

  // Resolve working folder path based on location
  let resolvedFolder = workingFolder || "";
  const loc = folderLocation || "sandbox";
  if (loc === "sandbox" && resolvedFolder && !path.isAbsolute(resolvedFolder)) {
    const sandboxDir = settings.sandboxDir || path.resolve("sandbox");
    resolvedFolder = path.join(sandboxDir, resolvedFolder);
  }

  const project: Project = {
    id: uuid(),
    name: name || "Untitled Project",
    description: description || "",
    workingFolder: resolvedFolder,
    folderLocation: loc,
    folderAccess: loc === "sandbox" ? "full" : (folderAccess || "readwrite"),
    memory: "",
    skills: skills || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  projects.push(project);
  saveProjects(projects);

  // Create working folder if specified and doesn't exist
  if (project.workingFolder && !fs.existsSync(project.workingFolder)) {
    fs.mkdirSync(project.workingFolder, { recursive: true });
  }

  res.json(project);
});

// Update project
projectsRouter.patch("/:id", (req, res) => {
  const projects = getProjects();
  const idx = projects.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Project not found" });

  const updates = req.body;
  projects[idx] = { ...projects[idx], ...updates, updatedAt: new Date().toISOString() };
  saveProjects(projects);
  res.json(projects[idx]);
});

// Delete project
projectsRouter.delete("/:id", (req, res) => {
  let projects = getProjects();
  projects = projects.filter((p) => p.id !== req.params.id);
  saveProjects(projects);
  res.json({ ok: true });
});

// Get project memory — read from {workingFolder}/memory.md
projectsRouter.get("/:id/memory", (req, res) => {
  const projects = getProjects();
  const project = projects.find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  let content = "";
  if (project.workingFolder) {
    const memoryPath = path.join(project.workingFolder, "memory.md");
    try {
      if (fs.existsSync(memoryPath)) {
        content = fs.readFileSync(memoryPath, "utf-8");
      }
    } catch (err: any) {
      console.error(`Failed to read memory.md for project ${project.id}:`, err.message);
    }
  }
  // Fallback to stored memory if no file found
  if (!content && project.memory) {
    content = project.memory;
  }
  res.json({ content });
});

// Save project memory — write to {workingFolder}/memory.md
projectsRouter.put("/:id/memory", (req, res) => {
  const projects = getProjects();
  const idx = projects.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Project not found" });

  const content = req.body.content || "";
  const project = projects[idx];

  // Write to memory.md in the working folder
  if (project.workingFolder) {
    const memoryPath = path.join(project.workingFolder, "memory.md");
    try {
      if (!fs.existsSync(project.workingFolder)) {
        fs.mkdirSync(project.workingFolder, { recursive: true });
      }
      fs.writeFileSync(memoryPath, content, "utf-8");
    } catch (err: any) {
      console.error(`Failed to write memory.md for project ${project.id}:`, err.message);
      return res.status(500).json({ error: `Failed to write memory.md: ${err.message}` });
    }
  }

  // Also keep in project JSON as backup
  projects[idx].memory = content;
  projects[idx].updatedAt = new Date().toISOString();
  saveProjects(projects);
  res.json({ ok: true });
});

// Browse filesystem for folder picker (absolute paths)
projectsRouter.get("/browse/folders", (_req, res) => {
  const browsePath = (_req.query.path as string) || "/";
  try {
    if (!fs.existsSync(browsePath)) return res.json({ folders: [], current: browsePath });
    const stat = fs.statSync(browsePath);
    if (!stat.isDirectory()) return res.json({ folders: [], current: browsePath });

    const entries = fs.readdirSync(browsePath, { withFileTypes: true });
    const folders = entries
      .filter((e) => {
        if (!e.isDirectory()) return false;
        // Skip hidden/system dirs
        if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "__pycache__") return false;
        return true;
      })
      .map((e) => ({
        name: e.name,
        path: path.join(browsePath, e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ folders, current: browsePath, parent: path.dirname(browsePath) });
  } catch (err: any) {
    res.json({ folders: [], current: browsePath, error: err.message });
  }
});

// List files in project working folder
projectsRouter.get("/:id/files", (req, res) => {
  const projects = getProjects();
  const project = projects.find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!project.workingFolder) return res.json({ files: [] });

  const subPath = (req.query.path as string) || "";
  const fullPath = path.join(project.workingFolder, subPath);

  if (!fs.existsSync(fullPath)) return res.json({ files: [] });

  try {
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const files = entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      size: e.isDirectory() ? 0 : fs.statSync(path.join(fullPath, e.name)).size,
      path: subPath ? `${subPath}/${e.name}` : e.name,
    }));
    res.json({ files });
  } catch (err: any) {
    res.json({ files: [], error: err.message });
  }
});
