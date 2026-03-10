import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { getSettings } from "./data";

export interface PythonResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  outputFiles: string[];
}

export function runPython(
  code: string,
  sandboxDir: string,
  timeout: number = 30000
): Promise<PythonResult> {
  return new Promise((resolve) => {
    const settings = getSettings();
    const pythonPath = settings.pythonPath || "python3";
    const scriptPath = path.join(sandboxDir, `_run_${Date.now()}.py`);

    // Wrap code to capture output files — work in output_file/ subfolder
    const outputDir = path.join(sandboxDir, "output_file");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const wrappedCode = `
import os, sys, urllib.parse, urllib.request, json

# Set default User-Agent for web requests
opener = urllib.request.build_opener()
opener.addheaders = [('User-Agent', 'TigerCowork/1.0 (Python; Web Search)')]
urllib.request.install_opener(opener)

# Configure matplotlib for non-interactive backend (save to file, not show)
try:
    import matplotlib
    matplotlib.use('Agg')
except ImportError:
    pass

# PROJECT_DIR points to the project root (for accessing uploads/, data/, etc.)
PROJECT_DIR = ${JSON.stringify(sandboxDir)}
os.chdir(${JSON.stringify(outputDir)})
${code}
`;

    fs.writeFileSync(scriptPath, wrappedCode);

    const proc = spawn(pythonPath, [scriptPath], {
      cwd: sandboxDir,
      timeout,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (exitCode) => {
      // Clean up temp script
      try { fs.unlinkSync(scriptPath); } catch {}

      // Detect newly created files in output_file/ subfolder (recursive)
      const outputFiles: string[] = [];
      const outputExts = new Set([".pdf", ".docx", ".doc", ".xlsx", ".csv", ".png", ".jpg", ".jpeg", ".svg", ".html", ".gif", ".webp"]);
      const now = Date.now();
      function scanDir(dir: string) {
        if (!fs.existsSync(dir)) return;
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              scanDir(fullPath);
            } else {
              const ext = path.extname(entry.name).toLowerCase();
              if (outputExts.has(ext)) {
                try {
                  const stat = fs.statSync(fullPath);
                  if (now - stat.mtimeMs < 60000) {
                    outputFiles.push(path.relative(sandboxDir, fullPath));
                  }
                } catch {}
              }
            }
          }
        } catch {}
      }
      scanDir(path.join(sandboxDir, "output_file"));

      resolve({ stdout, stderr, exitCode: exitCode ?? 1, outputFiles });
    });

    proc.on("error", (err) => {
      try { fs.unlinkSync(scriptPath); } catch {}
      resolve({ stdout: "", stderr: err.message, exitCode: 1, outputFiles: [] });
    });
  });
}
